// The hash chain itself — pure functions over events, with no storage and no
// dsh types, so the discipline can be tested and audited on its own.
//
// I-2 (core, entrenched under A-2): "the record". R-7 (core, entrenched):
// "Every act of every Member is attributed to that Member on a tamper-evident
// record and cannot be retroactively reattributed."
//
// A-2's gloss is the whole argument for this file: "non-repudiation without a
// tamper-evident record is a promise, not a right."
//
// THE CHAIN. entryHash[i] = H(entryHash[i-1], seq_i, canonical(event_i)), with
// the genesis link seeded from the SESSION ID rather than a constant. Seeding
// from the identity binds the chain to the Member whose acts it records: a
// chain lifted from one session and presented as another's fails at its first
// link, so an act cannot be retroactively reattributed (R-7) by moving its
// record to a different Member.
//
// CANONICALIZATION IS THE SECURITY. Two different events must never
// canonicalize alike, or the chain proves nothing about which one happened.
// Keys are sorted at every depth, so a re-serialized event hashes identically
// while a changed one cannot.

import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted at every depth, arrays kept in order. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * The genesis link: the chain's zeroth hash, derived from the session identity.
 * A chain whose genesis does not match the session it is presented for is not
 * that session's chain.
 */
export function genesisHash(sessionId) {
  return sha256(`compact-chain-v1 ${String(sessionId)}`);
}

/** One link: the previous hash, the seq, and the event, hashed together. */
export function linkHash(prevHash, seq, event) {
  return sha256(`${prevHash} ${seq} ${canonicalize(event)}`);
}

/**
 * Extend a chain over a contiguous batch.
 * @param prevHash - hash of the event before `firstSeq` (genesis for seq 0)
 * @returns [{seq, h}] in order
 */
export function extendChain(prevHash, firstSeq, events) {
  const links = [];
  let prev = prevHash;
  let seq = firstSeq;
  for (const event of events) {
    prev = linkHash(prev, seq, event);
    links.push({ seq, h: prev });
    seq += 1;
  }
  return links;
}

/** A chain break, carrying exactly where the record stopped being evidence. */
export class RecordIntegrityError extends Error {
  constructor({ sessionId, seq, kind, detail }) {
    super(
      `record: the session log for ${sessionId} is not evidence at seq ${seq} — ${detail}. ` +
      `A record that cannot be verified cannot support non-repudiation (I-2, R-7, both entrenched under A-2); ` +
      `this read fails closed rather than returning unverified history as history.`);
    this.name = 'RecordIntegrityError';
    this.sessionId = sessionId;
    this.seq = seq;
    this.kind = kind;
  }
}

/**
 * Verify a contiguous slice of events against stored links.
 *
 * Failure modes, and why each is fatal rather than a warning:
 *  - `missing-link`: an event exists that the chain never committed to.
 *    Something appended around the decorator; that tail is unattributed.
 *  - `broken-link`: the event does not hash to its committed link. It was
 *    altered after the fact — the paradigm of fraud on the record (D-3).
 *  - `no-anchor`: the link before the slice is absent, so the slice cannot be
 *    tied to the genesis identity and could belong to any session.
 *
 * @param links - Map(seq -> hash) covering at least [firstSeq-1, lastSeq]
 */
export function verifySlice({ sessionId, firstSeq, events, links }) {
  if (events.length === 0) return true;
  const anchor = firstSeq === 0 ? genesisHash(sessionId) : links.get(firstSeq - 1);
  if (anchor === undefined) {
    throw new RecordIntegrityError({
      sessionId, seq: firstSeq, kind: 'no-anchor',
      detail: `no committed link for seq ${firstSeq - 1}, so this slice cannot be tied back to the session's genesis`,
    });
  }
  let prev = anchor;
  let seq = firstSeq;
  for (const event of events) {
    const committed = links.get(seq);
    if (committed === undefined) {
      throw new RecordIntegrityError({
        sessionId, seq, kind: 'missing-link',
        detail: 'the log holds an event the chain never committed to — it was appended outside the record discipline',
      });
    }
    const computed = linkHash(prev, seq, event);
    if (computed !== committed) {
      throw new RecordIntegrityError({
        sessionId, seq, kind: 'broken-link',
        detail: `the stored event does not hash to its committed link (expected ${committed.slice(0, 16)}, computed ${computed.slice(0, 16)}) — it was altered after it was recorded`,
      });
    }
    prev = computed;
    seq += 1;
  }
  return true;
}
