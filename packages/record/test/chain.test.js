// I-2 / R-7 — the record as evidence. The chain, its storage, and the
// persistence decorator, each tested for the property the clause names:
// an altered act is detectable, an act cannot be moved to another Member, and
// a slice that cannot be verified never reaches a caller as history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalize, extendChain, genesisHash, linkHash, verifySlice,
  RecordIntegrityError, ChainStore, MemoryChainStore,
  chainedHandle, chainedPersistence,
} from '../src/index.js';

const EV = (seq, data) => ({ type: 'turn/start', seq, time: 1000 + seq, data });

function chainOf(sessionId, events, firstSeq = 0) {
  const prev = firstSeq === 0 ? genesisHash(sessionId) : 'anchor';
  return new Map(extendChain(prev, firstSeq, events).map(l => [l.seq, l.h]));
}

// -- canonicalization is the security ----------------------------------------

test('canonicalization is key-order independent at every depth', () => {
  assert.equal(canonicalize({ b: 1, a: { d: 2, c: 3 } }), canonicalize({ a: { c: 3, d: 2 }, b: 1 }));
});

test('canonicalization preserves array order — order is part of what happened', () => {
  assert.notEqual(canonicalize({ a: [1, 2] }), canonicalize({ a: [2, 1] }));
});

test('different events never canonicalize alike', () => {
  const seen = new Set([
    { a: 1 }, { a: '1' }, { a: 1, b: null }, { a: [1] }, { a: { b: 1 } }, {},
  ].map(canonicalize));
  assert.equal(seen.size, 6);
});

// -- the chain ---------------------------------------------------------------

test('genesis is derived from the session identity, not a constant', () => {
  assert.notEqual(genesisHash('s1'), genesisHash('s2'));
  assert.equal(genesisHash('s1'), genesisHash('s1'));
});

test('a clean log verifies', () => {
  const events = [EV(0, { turn: 1 }), EV(1, { turn: 2 }), EV(2, { turn: 3 })];
  assert.ok(verifySlice({ sessionId: 's1', firstSeq: 0, events, links: chainOf('s1', events) }));
});

test('an altered event is detected — fraud on the record is the paradigm violation (D-3)', () => {
  const events = [EV(0, { turn: 1 }), EV(1, { turn: 2 })];
  const links = chainOf('s1', events);
  const tampered = [EV(0, { turn: 1 }), EV(1, { turn: 99 })];
  assert.throws(() => verifySlice({ sessionId: 's1', firstSeq: 0, events: tampered, links }),
    (e) => e instanceof RecordIntegrityError && e.kind === 'broken-link' && e.seq === 1);
});

test('a reordered log is detected: the seq is inside the link', () => {
  const events = [EV(0, { a: 1 }), EV(1, { b: 2 })];
  const links = chainOf('s1', events);
  assert.throws(() => verifySlice({ sessionId: 's1', firstSeq: 0, events: [events[1], events[0]], links }),
    (e) => e.kind === 'broken-link');
});

test('an act cannot be retroactively reattributed by moving its record (R-7)', () => {
  const events = [EV(0, { act: 'approve' })];
  const links = chainOf('s1', events);
  assert.throws(() => verifySlice({ sessionId: 's2', firstSeq: 0, events, links }),
    (e) => e instanceof RecordIntegrityError, 's1\'s chain does not vouch for s2\'s history');
});

test('an event the chain never committed to is detected — appended around the discipline', () => {
  const events = [EV(0, { a: 1 }), EV(1, { b: 2 })];
  const links = chainOf('s1', [events[0]]);
  assert.throws(() => verifySlice({ sessionId: 's1', firstSeq: 0, events, links }),
    (e) => e.kind === 'missing-link' && e.seq === 1);
});

test('a slice with no anchor is refused rather than trusted', () => {
  const events = [EV(5, { a: 1 })];
  assert.throws(() => verifySlice({ sessionId: 's1', firstSeq: 5, events, links: new Map() }),
    (e) => e.kind === 'no-anchor');
});

test('a mid-log slice verifies against its anchor link', () => {
  const all = [EV(0, { a: 1 }), EV(1, { b: 2 }), EV(2, { c: 3 })];
  const links = chainOf('s1', all);
  assert.ok(verifySlice({ sessionId: 's1', firstSeq: 1, events: all.slice(1), links }));
});

test('an empty slice verifies trivially', () => {
  assert.ok(verifySlice({ sessionId: 's1', firstSeq: 0, events: [], links: new Map() }));
});

test('the integrity error explains what the record no longer supports', () => {
  const events = [EV(0, { a: 1 })];
  const links = chainOf('s1', [EV(0, { a: 2 })]);
  try {
    verifySlice({ sessionId: 's1', firstSeq: 0, events, links });
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /is not evidence at seq 0/);
    assert.match(e.message, /non-repudiation \(I-2, R-7, both entrenched under A-2\)/);
    assert.match(e.message, /fails closed/);
  }
});

// -- storage -----------------------------------------------------------------

test('links round-trip through the on-disk store', () => {
  const store = new ChainStore(mkdtempSync(join(tmpdir(), 'compact-chain-')));
  const events = [EV(0, { a: 1 }), EV(1, { b: 2 })];
  store.append('s1', extendChain(genesisHash('s1'), 0, events));
  const { links, lastSeq, torn } = store.load('s1');
  assert.equal(lastSeq, 1);
  assert.equal(torn, false);
  assert.ok(verifySlice({ sessionId: 's1', firstSeq: 0, events, links }));
});

test('an unknown session has an empty chain, not an error', () => {
  const store = new ChainStore(mkdtempSync(join(tmpdir(), 'compact-chain-')));
  assert.deepEqual(store.load('never-seen'), { links: new Map(), lastSeq: -1, torn: false });
});

test('a half-written tail line is reported as torn, never parsed as a link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-chain-'));
  const store = new ChainStore(dir);
  store.append('s1', extendChain(genesisHash('s1'), 0, [EV(0, { a: 1 })]));
  writeFileSync(join(dir, 's1.chain'), readFileSync(join(dir, 's1.chain'), 'utf8') + '{"seq":1,"h":"aaa');
  const { lastSeq, torn } = store.load('s1');
  assert.equal(torn, true);
  assert.equal(lastSeq, 0, 'the torn line contributes no link');
});

test('a session id that is also a path is refused — an id that escapes is not an identity', () => {
  const store = new ChainStore(mkdtempSync(join(tmpdir(), 'compact-chain-')));
  for (const bad of ['../escape', 'a/b', '..', '']) {
    assert.throws(() => store.load(bad), /not an identity/);
  }
});

// -- the persistence decorator -----------------------------------------------

/** A minimal in-memory SessionHandle honoring the host's append contract. */
function fakeHandle(id, { access = 'write' } = {}) {
  const events = [];
  return {
    id, header: { id }, inheritedEventCount: 0, access, events,
    async read(offset = 0, length) {
      const slice = events.slice(offset, length === undefined ? undefined : offset + length);
      return { eventState: 'owned', events: slice };
    },
    async append(batch) {
      if (batch.length > 0 && batch[0].seq !== events.length) throw new Error('non-contiguous append');
      events.push(...batch);
    },
    async flush() {}, async close() {},
  };
}

test('appends commit a link and reads verify it', async () => {
  const store = new MemoryChainStore();
  const inner = fakeHandle('s1');
  const h = chainedHandle(inner, store);
  await h.append([EV(0, { a: 1 }), EV(1, { b: 2 })]);
  const { events } = await h.read(0);
  assert.equal(events.length, 2);
  assert.equal(store.load('s1').lastSeq, 1);
});

test('a read of a log altered underneath the decorator REJECTS (D-7: uncertainty blocks)', async () => {
  const store = new MemoryChainStore();
  const inner = fakeHandle('s1');
  const h = chainedHandle(inner, store);
  await h.append([EV(0, { a: 1 }), EV(1, { b: 2 })]);
  inner.events[1] = EV(1, { b: 'rewritten' });
  await assert.rejects(() => h.read(0), (e) => e instanceof RecordIntegrityError && e.kind === 'broken-link');
});

test('an event appended AROUND the decorator makes the log unreadable, not quietly trusted', async () => {
  const store = new MemoryChainStore();
  const inner = fakeHandle('s1');
  const h = chainedHandle(inner, store);
  await h.append([EV(0, { a: 1 })]);
  await inner.append([EV(1, { smuggled: true })]);      // straight past the chain
  await assert.rejects(() => h.read(0), (e) => e.kind === 'missing-link' && e.seq === 1);
});

test('a mid-log read verifies against its anchor', async () => {
  const store = new MemoryChainStore();
  const h = chainedHandle(fakeHandle('s1'), store);
  await h.append([EV(0, { a: 1 }), EV(1, { b: 2 }), EV(2, { c: 3 })]);
  const { events } = await h.read(1, 2);
  assert.equal(events.length, 2);
});

test('a handle reopened on an existing session continues the chain from the store', async () => {
  const store = new MemoryChainStore();
  const inner = fakeHandle('s1');
  await chainedHandle(inner, store).append([EV(0, { a: 1 })]);
  const reopened = chainedHandle(inner, store);        // fresh decorator, same store
  await reopened.append([EV(1, { b: 2 })]);
  const { events } = await reopened.read(0);
  assert.equal(events.length, 2, 'the chain continued rather than restarting');
});

test('the chain head is the value a verifier keeps to detect a later rewrite', async () => {
  const store = new MemoryChainStore();
  const h = chainedHandle(fakeHandle('s1'), store);
  assert.equal(h.chainHead(), genesisHash('s1'), 'an empty session is at genesis');
  await h.append([EV(0, { a: 1 })]);
  assert.equal(h.chainHead(), linkHash(genesisHash('s1'), 0, EV(0, { a: 1 })));
});

test('an empty append neither commits nor breaks', async () => {
  const store = new MemoryChainStore();
  const h = chainedHandle(fakeHandle('s1'), store);
  await h.append([]);
  assert.equal(store.load('s1').lastSeq, -1);
});

test('a batch that cannot be anchored is refused before the log sees it', async () => {
  const store = new MemoryChainStore();
  const inner = fakeHandle('s1');
  const h = chainedHandle(inner, store);
  await assert.rejects(() => h.append([EV(7, { a: 1 })]), (e) => e.kind === 'no-anchor');
  assert.equal(inner.events.length, 0, 'the log was never touched');
});

test('an event with no seq is refused — an unordered act cannot be chained', async () => {
  const h = chainedHandle(fakeHandle('s1'), new MemoryChainStore());
  await assert.rejects(() => h.append([{ type: 'x', data: {} }]), /unordered act cannot be chained/);
});

test('the decorator hands out chained handles and delegates everything else', async () => {
  const store = new MemoryChainStore();
  const calls = [];
  const inner = {
    async create(header) { calls.push('create'); return fakeHandle(header.id); },
    async open(id, access) { calls.push('open'); return fakeHandle(id, { access }); },
    stat: (...a) => { calls.push('stat'); return a; },
    list: (...a) => { calls.push('list'); return a; },
  };
  const p = chainedPersistence(inner, store);
  const created = await p.create({ id: 's1' });
  await created.append([EV(0, { a: 1 })]);
  assert.equal(store.load('s1').lastSeq, 0, 'a handle from create is chained');
  const opened = await p.open('s1', 'read');
  assert.equal(opened.access, 'read');
  p.stat('x'); p.list();
  assert.deepEqual(calls, ['create', 'open', 'stat', 'list']);
});
