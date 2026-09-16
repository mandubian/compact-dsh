// compact-dsh-record — I-2 and R-7, the entrenched record (Phase 6, re-scoped;
// see docs/decision-phase6-scope.md; pulled forward from the port plan's
// Phase 8 because everything already built rests on it).
//
// I-2 (core) and R-7 (core) are both in A-2's entrenched set, and A-2 says why
// they belong together: "non-repudiation without a tamper-evident record is a
// promise, not a right." Until this plugin exists, the composition's offline
// auditor (I-7) attests its own trust basis as "log completeness only — the
// dsh session log is NOT tamper-evident", and J-2 ("the record is the
// evidence") has no evidence to stand on.
//
// THE SHAPE. A decorator over whatever `SessionPersistence` backend the
// deployment composes. It changes no storage format and declares no new event
// vocabulary (D-8): it commits a hash chain beside the log on every append,
// and verifies that commitment on every read.
//
//   append(events) -> commit links, THEN delegate
//   read(offset, n) -> delegate, THEN verify the slice against the links
//
// FAIL CLOSED, NOT FAIL LOUD-AND-CONTINUE. A read whose slice does not verify
// REJECTS. It does not return the events with a warning attached: D-7 makes
// uncertainty block rather than pass silently, and history that cannot be
// verified must not reach a caller dressed as history. The cost is real — a
// broken chain makes a session unreadable — and that is the correct cost: a
// session whose record is not evidence is a session no decision should rest on.
//
// WHAT THIS DOES NOT DO. The chain is tamper-EVIDENT, not tamper-PROOF. Anyone
// who can rewrite the log can also rewrite the sidecar; what they cannot do is
// leave the pair consistent without the composition's cooperation, so an
// alteration is detectable by anyone who kept a prior link. Signing links
// under an identity key (I-1) is the next step and is not taken here: the
// Compact has published no amendment keys, so a signature would attest to a
// key nobody can check. That gap is declared, not papered over.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import {
  canonicalize, extendChain, genesisHash, linkHash, verifySlice, RecordIntegrityError,
} from './chain.js';
import { ChainStore, MemoryChainStore } from './store.js';

export {
  canonicalize, extendChain, genesisHash, linkHash, verifySlice, RecordIntegrityError,
  ChainStore, MemoryChainStore,
};

export const name = 'compact-record';

/** The declared gap this plugin carries into the boot record (I-8). */
export const DECLARED_GAPS = [
  'the record is tamper-EVIDENT, not tamper-proof, and its links are unsigned: the Compact has published no ' +
  'identity keys, so a signature would attest to a key no verifier could check (I-1 debt, declared)',
];

/**
 * Wrap one session handle so its appends commit and its reads verify.
 *
 * The handle keeps the running head hash in memory, and falls back to the
 * store when it has not seen the preceding link — a write handle opened on an
 * existing session starts mid-chain.
 */
export function chainedHandle(inner, store) {
  const sessionId = String(inner.id);
  let cached = null;   // {links, lastSeq}

  const links = () => (cached ??= store.load(sessionId));
  const headAt = (seq) => (seq === 0 ? genesisHash(sessionId) : links().links.get(seq - 1));

  const handle = {
    get id() { return inner.id; },
    get header() { return inner.header; },
    get inheritedEventCount() { return inner.inheritedEventCount; },
    get access() { return inner.access; },

    async read(offset = 0, length, options) {
      const result = await inner.read(offset, length, options);
      verifySlice({ sessionId, firstSeq: offset, events: result.events, links: links().links });
      return result;
    },

    async append(events, options) {
      if (events.length === 0) return inner.append(events, options);
      const firstSeq = events[0]?.seq;
      if (typeof firstSeq !== 'number') {
        throw new Error(`record: refusing to commit a batch whose first event has no seq — an unordered act cannot be chained (I-2)`);
      }
      const prev = headAt(firstSeq);
      if (prev === undefined) {
        throw new RecordIntegrityError({
          sessionId, seq: firstSeq, kind: 'no-anchor',
          detail: `no committed link for seq ${firstSeq - 1}, so this batch cannot continue the session's chain`,
        });
      }
      const fresh = extendChain(prev, firstSeq, events);
      // commit first, then let the log follow (see store.js on the ordering)
      store.append(sessionId, fresh);
      for (const l of fresh) links().links.set(l.seq, l.h);
      if (cached) cached.lastSeq = Math.max(cached.lastSeq, fresh.at(-1).seq);
      return inner.append(events, options);
    },

    flush: (options) => inner.flush(options),
    close: () => inner.close(),
    [Symbol.asyncDispose]: () => inner.close(),

    /** The chain head: what a verifier records to detect a later rewrite. */
    chainHead() {
      const { links: map, lastSeq } = links();
      return lastSeq < 0 ? genesisHash(sessionId) : map.get(lastSeq);
    },
  };
  return handle;
}

/**
 * Decorate a `SessionPersistence` backend. Every method that hands out a
 * handle hands out a chained one; everything else delegates untouched.
 */
export function chainedPersistence(inner, store) {
  return {
    inner,
    store,
    async create(header, options) { return chainedHandle(await inner.create(header, options), store); },
    async open(id, access, options) { return chainedHandle(await inner.open(id, access, options), store); },
    stat: (...a) => inner.stat(...a),
    list: (...a) => inner.list(...a),
    delete: (...a) => inner.delete?.(...a),
    flush: (...a) => inner.flush?.(...a),
  };
}

/**
 * Compose the record discipline over the deployment's persistence backend.
 *
 * The backend must already exist: a composition that would run without one has
 * no record to make tamper-evident, and silently doing nothing is how a
 * conformance claim becomes a fiction (F-5).
 */
export function apply(ctx, config = {}) {
  const store = config.store ?? new ChainStore(config.chainDir ?? './.compact-chain');
  ctx.inject?.(['sessionPersistence'], (scope) => {
    const backend = scope.sessionPersistence;
    const chained = chainedPersistence(backend, store);
    scope.provide?.('compact-record', {
      name,
      chained,
      store,
      declaredGaps: DECLARED_GAPS,
      /** The head link of one session — what an auditor records to detect a rewrite. */
      head: (sessionId) => {
        const { links, lastSeq } = store.load(sessionId);
        return lastSeq < 0 ? genesisHash(sessionId) : links.get(lastSeq);
      },
      /** Verify a whole stored session against its chain (I-7, offline). */
      async verify(sessionId) {
        const handle = await backend.open(sessionId, 'read');
        try {
          const { events } = await handle.read(0);
          verifySlice({ sessionId: String(sessionId), firstSeq: 0, events, links: store.load(sessionId).links });
          return { ok: true, events: events.length };
        } finally {
          await handle.close();
        }
      },
    });
    for (const gap of DECLARED_GAPS) scope.logger?.warn?.(`record: ${gap}`);
  });
}
