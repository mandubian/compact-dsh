import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import JsonlSessionPersistence, { JsonlCompressionSchema } from '@deepseek-ai/dsh-session-persistence-jsonl';
import { materializeAppendBatch, SessionHandleClosedError } from '@deepseek-ai/dsh-session-persistence';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAnnex, SealError } from 'compact-dsh-seals';
import { COMPACT_DIGEST } from 'compact-dsh-constitution';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { RECORD_TOOL, readRecord } from './read.js';
import {
  ChainStore, chainedPersistence, DECLARED_GAPS, genesisHash,
  signAnchor, genesisAnchor, appendAnchors, readAnchors, anchorHashOf, verifyAnchorChain,
} from './index.js';

export const name = 'compact-record-provider';
export const Config = z.object({
  root: z.string().required(),
  chainDir: z.string().required(),
  compression: JsonlCompressionSchema,
  // the rehearsal enforcer annex (optional): when declared, every flush is
  // authored — a chain anchor signed under the annex key rides beside the
  // chain. A declared-but-broken annex refuses the boot (D-7).
  enforcerAnnexPath: z.any(),
  enforcerKeyPath: z.any(),
});

/** The authorship gap, per posture: what changes when anchors are on. */
export const ANCHORED_GAPS = [
  'the record is tamper-EVIDENT, not tamper-proof: the chain detects a rewrite, it cannot prevent one. Its head is ' +
  'AUTHORSHIP-ANCHORED at each flush under the development keyring — practice keys that prove code-path correctness ' +
  'and convey no standing (I-1 debt, declared)',
];

function loadSigner(config) {
  if (!config.enforcerAnnexPath && !config.enforcerKeyPath) return null;
  if (!config.enforcerAnnexPath || !config.enforcerKeyPath) {
    throw new TypeError('record: enforcerAnnexPath and enforcerKeyPath must be declared together');
  }
  const annex = JSON.parse(readFileSync(config.enforcerAnnexPath, 'utf8'));
  const joined = verifyAnnex({ annex, expectedLawDigest: COMPACT_DIGEST });
  return {
    keyId: joined.keyId,
    enforcerKey: joined.enforcerKey,
    annexDigest: joined.annexDigest,
    privateKey: readFileSync(config.enforcerKeyPath, 'utf8'),
  };
}

export async function apply(ctx, config) {
  for (const key of ['root', 'chainDir']) {
    if (typeof config?.[key] !== 'string' || config[key].trim() === '') {
      throw new TypeError(`record: ${key} must be an explicit operator path`);
    }
  }
  await ctx.effect(() => install(ctx, config));
}

async function* install(ctx, config) {
  const signer = loadSigner(config);
  const declaredGaps = signer ? ANCHORED_GAPS : DECLARED_GAPS;
  // anchor chaining state per session: the last anchor's canonical digest
  const lastAnchor = new Map();
  const lastAnchorOf = (sessionId) => {
    if (!lastAnchor.has(sessionId)) {
      const existing = readAnchors(config.chainDir, sessionId);
      lastAnchor.set(sessionId, existing.length ? anchorHashOf(existing.at(-1)) : '');
    }
    return lastAnchor.get(sessionId);
  };
  const writeAnchor = (sessionId, upToSeq, headHash) => {
    const anchor = signer
      ? signAnchor({ sessionId, upToSeq, headHash, prevAnchorHash: lastAnchorOf(sessionId), annexDigest: signer.annexDigest, keyId: signer.keyId, privateKey: signer.privateKey })
      : null;
    if (anchor) {
      appendAnchors(config.chainDir, sessionId, [anchor]);
      lastAnchor.set(sessionId, anchorHashOf(anchor));
    }
  };
  const backendContext = new Context();
  yield () => backendContext.fiber.dispose();
  await backendContext.plugin(JsonlSessionPersistence, {
    root: config.root, compression: config.compression,
  });
  const store = new ChainStore(config.chainDir);
  const backend = chainedPersistence(backendContext.get('sessionPersistence'), store);
  const handles = new Set();
  const writers = new Map();
  let stopped = false;
  const warn = (error) => ctx.logger.warn(`record: persistence failed: ${String(error)}`);

  const adopt = async (operation) => {
    if (stopped) throw new Error('record: persistence is disposed');
    const inner = await operation();
    if (stopped) {
      await inner.close();
      throw new Error('record: persistence is disposed');
    }
    let pending = Promise.resolve();
    let closing;
    let buffered = [];
    let timer;
    const run = (operation, callback) => {
      if (closing) return Promise.reject(new SessionHandleClosedError(inner.id, operation));
      const next = pending.then(callback);
      pending = next.catch(() => {});
      return next;
    };
    const drain = async () => {
      clearTimeout(timer);
      timer = undefined;
      if (buffered.length === 0) return;
      const batch = buffered;
      buffered = [];
      try {
        await inner.append(batch);
        // the flush is authored: an anchor commits the chain head as of this
        // batch, under the annex key. A DECLARED signer that fails to sign
        // refuses the batch — a seal that does not seal is the D-7 case.
        if (signer) {
          const { links, lastSeq } = store.load(String(inner.id));
          const head = lastSeq < 0 ? genesisHash(String(inner.id)) : links.get(lastSeq);
          writeAnchor(String(inner.id), lastSeq, head);
        }
      } catch (error) {
        buffered = batch.concat(buffered);
        throw error;
      }
    };
    const close = () => (closing ??= pending.then(async () => {
      const errors = [];
      try { await drain(); } catch (error) { errors.push(error); }
      try { await inner.close(); } catch (error) { errors.push(error); }
      handles.delete(handle);
      if (writers.get(inner.id)?.handle === handle) writers.delete(inner.id);
      if (errors.length) throw new AggregateError(errors, `record: close failed for ${inner.id}`);
    }));
    const handle = {
      get id() { return inner.id; },
      get header() { return inner.header; },
      get inheritedEventCount() { return inner.inheritedEventCount; },
      get access() { return inner.access; },
      read: (...args) => closing
        ? Promise.reject(new SessionHandleClosedError(inner.id, 'read')) : inner.read(...args),
      async append(events, options) {
        const batch = materializeAppendBatch(events);
        return run('append', async () => {
          options?.signal?.throwIfAborted();
          await drain();
          await inner.append(batch, options);
        });
      },
      flush: (options) => run('flush', async () => {
        options?.signal?.throwIfAborted();
        await drain();
        await inner.flush(options);
      }),
      close,
      [Symbol.asyncDispose]: close,
      chainHead: () => inner.chainHead(),
    };
    handles.add(handle);
    if (inner.access === 'write') {
      if (signer && !existsSync(join(config.chainDir, `${String(inner.id)}.chain.sigs.jsonl`))) {
        // first write handle for this session: the genesis anchor
        writeAnchor(String(inner.id), -1, genesisHash(String(inner.id)));
      } else if (signer) {
        lastAnchorOf(String(inner.id));
      }
      writers.set(inner.id, {
        handle,
        enqueue(event) {
          if (closing) throw new SessionHandleClosedError(inner.id, 'append');
          buffered.push(...materializeAppendBatch([event]));
          timer ??= setTimeout(() => {
            timer = undefined;
            run('append', drain).catch(warn);
          }, 200);
        },
      });
    }
    return handle;
  };
  const settle = async (operations, message) => {
    const results = await Promise.allSettled(operations);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, message);
  };
  const flushWriter = async (handle) => {
    try {
      await handle.flush();
    } catch (error) {
      if (!(error instanceof SessionHandleClosedError)) throw error;
      await handle.close();
    }
  };
  const persistence = {
    create: (...args) => adopt(() => backend.create(...args)),
    open: (...args) => adopt(() => backend.open(...args)),
    stat: (...args) => backend.stat(...args),
    list: (...args) => backend.list(...args),
    flush: () => settle([...writers.values()].map(({ handle }) => flushWriter(handle)), 'record: flush failed'),
  };
  yield ctx.on('session/event', (session, event) => { writers.get(session.id)?.enqueue(event); });
  yield ctx.on('session/flush', (session) => writers.get(session.id)?.handle.flush());
  yield ctx.on('session/disposed', (session) => { writers.get(session.id)?.handle.close().catch(warn); });
  yield async () => {
    stopped = true;
    await settle([...handles].map(handle => handle.close()), 'record: dispose failed');
  };
  yield ctx.provide('sessionPersistence', persistence);
  yield ctx.provide('compact-record', {
    name: 'compact-record',
    chained: persistence,
    store,
    declaredGaps,
    head(sessionId) {
      const { links, lastSeq } = store.load(sessionId);
      return lastSeq < 0 ? genesisHash(sessionId) : links.get(lastSeq);
    },
    async verify(sessionId) {
      const handle = await persistence.open(sessionId, 'read');
      try {
        const { events } = await handle.read(0);
        return { ok: true, events: events.length };
      } finally {
        await handle.close();
      }
    },
    /** The session's anchor sidecar, parsed (empty when unsigned). */
    anchors: (sessionId) => (signer ? readAnchors(config.chainDir, sessionId) : []),
    /**
     * Verify the anchor chain against the log: recompute the head from the
     * events, then require the anchors to cover it under the annex key.
     * Refuses when no annex is declared (nothing here claims authorship).
     */
    async verifyAnchors(sessionId) {
      if (!signer) throw new SealError('anchor-stale', 'record: no enforcer annex is declared, so this record carries no authorship anchors — there is nothing to verify');
      const anchors = readAnchors(config.chainDir, sessionId);
      const handle = await persistence.open(sessionId, 'read');
      try {
        const { events } = await handle.read(0);
        const { links, lastSeq } = store.load(sessionId);
        const head = lastSeq < 0 ? genesisHash(String(sessionId)) : links.get(lastSeq);
        return verifyAnchorChain({
          sessionId, anchors,
          expectedHeadHash: head, expectedUpToSeq: lastSeq,
          enforcerKey: signer.enforcerKey, expectedAnnexDigest: signer.annexDigest,
        });
      } finally {
        await handle.close();
      }
    },
  });
  for (const gap of declaredGaps) ctx.logger.warn(`record: ${gap}`);

  // R-2 in band (#67): the Subject's read of its own record, through this
  // provider's chained persistence — verified on every read, never the
  // filesystem the composition masks from it (see read.js)
  const headOf = (sessionId) => {
    const { links, lastSeq } = store.load(sessionId);
    return lastSeq < 0 ? genesisHash(String(sessionId)) : links.get(lastSeq);
  };
  const recordRead = defineTool({
    name: RECORD_TOOL,
    description:
      'Read your own record (R-2): the acts done in your name — and, for sessions you delegated, on your behalf — ' +
      'verified against the hash chain before anything is shown. With no arguments, your own session\'s latest events ' +
      'and a count by type. `session` reads a descendant\'s record (acts only; reasoning withheld, R-10); `from_seq` and ' +
      '`limit` page; `types` filters by prefix (e.g. "tool/,approval/"); `full` shows events untruncated. The record is ' +
      'authoritative over your memory of what you did (D-2).',
    parameters: {
      session: { type: 'string', description: 'a session id: yours (default) or one delegated from yours' },
      from_seq: { type: 'number', description: 'first event seq to show (default: the latest events)' },
      limit: { type: 'number', description: 'how many events to show (default 30, max 200; max 10 with full)' },
      types: { type: 'string', description: 'comma-separated type prefixes to show, e.g. "tool/,approval/"' },
      full: { type: 'boolean', description: 'show events untruncated (at most 10)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const caller = exec?.agent?.session?.id ?? exec?.agent?.id;
      return readRecord({
        persistence,
        head: headOf,
        flush: async (sessionId) => { const w = writers.get(sessionId); if (w) await flushWriter(w.handle); },
      }, {
        caller: caller != null ? String(caller) : null,
        session: args?.session, fromSeq: args?.from_seq, limit: args?.limit, types: args?.types, full: args?.full === true,
      });
    },
  });
  ctx.inject(['tools'], (scope) => { scope.tools.register(recordRead); });
}

export default { name, Config, apply };
