import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import JsonlSessionPersistence, { JsonlCompressionSchema } from '@deepseek-ai/dsh-session-persistence-jsonl';
import { materializeAppendBatch, SessionHandleClosedError } from '@deepseek-ai/dsh-session-persistence';
import {
  ChainStore, chainedPersistence, DECLARED_GAPS, genesisHash,
} from './index.js';

export const name = 'compact-record-provider';
export const Config = z.object({
  root: z.string().required(),
  chainDir: z.string().required(),
  compression: JsonlCompressionSchema,
});

export async function apply(ctx, config) {
  for (const key of ['root', 'chainDir']) {
    if (typeof config?.[key] !== 'string' || config[key].trim() === '') {
      throw new TypeError(`record: ${key} must be an explicit operator path`);
    }
  }
  await ctx.effect(() => install(ctx, config));
}

async function* install(ctx, config) {
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
    if (inner.access === 'write') writers.set(inner.id, {
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
    declaredGaps: DECLARED_GAPS,
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
  });
  for (const gap of DECLARED_GAPS) ctx.logger.warn(`record: ${gap}`);
}

export default { name, Config, apply };
