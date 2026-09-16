// The chain's storage: one append-only sidecar per session, beside the log
// rather than inside it.
//
// WHY A SIDECAR. The host's storage contract validates stored events against
// the current event vocabulary and "refuses unknown vocabulary fail-closed".
// Threading chain fields through the events themselves would mean declaring a
// capability over the session vocabulary that this composition does not have,
// and a plugin that quietly extends what an event may contain is exactly the
// undeclared capability D-8 names. The chain therefore lives next to the log
// and commits to it, without touching it.
//
// WHY LINKS ARE WRITTEN BEFORE THE APPEND. The two writes cannot be atomic, so
// the ordering decides which way a crash fails. Links first means a crash can
// leave a link with no event — harmless, because the event never happened and
// nothing claims it did. The reverse ordering would leave an event with no
// link, which reads as "appended outside the record discipline": an
// indistinguishable-from-tampering state produced by ordinary crashes. The
// chain commits, then the log follows.

import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Reject anything that could escape the chain directory. */
function chainPath(dir, sessionId) {
  const id = String(sessionId);
  if (id === '' || id.includes('/') || id.includes('\\') || id.includes('\0') || id === '.' || id === '..') {
    throw new Error(`record: refusing to open a chain for session id ${JSON.stringify(id)} — an id that is also a path is not an identity`);
  }
  return join(dir, `${id}.chain`);
}

/**
 * Per-session chain storage. Links are appended as JSONL and fsynced before
 * the call returns: a chain that is not durable at the moment the log accepts
 * the event is not a commitment.
 */
export class ChainStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  /**
   * Load a session's committed links.
   * @returns {{links: Map<number,string>, lastSeq: number, torn: boolean}}
   */
  load(sessionId) {
    const file = chainPath(this.dir, sessionId);
    const links = new Map();
    let lastSeq = -1;
    let torn = false;
    if (!existsSync(file)) return { links, lastSeq, torn };
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (line === '') continue;
      let rec;
      try { rec = JSON.parse(line); } catch { torn = true; continue; }  // a half-written tail line
      if (typeof rec?.seq !== 'number' || typeof rec?.h !== 'string') { torn = true; continue; }
      links.set(rec.seq, rec.h);
      if (rec.seq > lastSeq) lastSeq = rec.seq;
    }
    return { links, lastSeq, torn };
  }

  /** Commit links durably. Nothing is written for an empty batch. */
  append(sessionId, links) {
    if (links.length === 0) return;
    const file = chainPath(this.dir, sessionId);
    const payload = links.map(l => JSON.stringify({ seq: l.seq, h: l.h })).join('\n') + '\n';
    appendFileSync(file, payload);
    // fsync the file and its directory: a link that survives only in page cache
    // is not a commitment a crash will honor.
    const fd = openSync(file, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    const dfd = openSync(dirname(file), 'r');
    try { fsyncSync(dfd); } catch { /* not every platform fsyncs a directory */ } finally { closeSync(dfd); }
  }
}

/** An in-memory store for tests and for callers that supply their own durability. */
export class MemoryChainStore {
  constructor() { this.bySession = new Map(); }
  load(sessionId) {
    const links = new Map(this.bySession.get(String(sessionId)) ?? []);
    let lastSeq = -1;
    for (const seq of links.keys()) if (seq > lastSeq) lastSeq = seq;
    return { links, lastSeq, torn: false };
  }
  append(sessionId, links) {
    const id = String(sessionId);
    const existing = this.bySession.get(id) ?? new Map();
    for (const l of links) existing.set(l.seq, l.h);
    this.bySession.set(id, existing);
  }
}

export { chainPath };
