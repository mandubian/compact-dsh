// readRecord's own rules, over an injected persistence: what a Subject sees
// of its own record and of its descendants', and what it never sees (R-2,
// R-10). The composed suite proves the same answer rides the real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecord, scopeOf, REASONING_TYPES, MAX_LIMIT, FULL_LIMIT } from '../src/read.js';
import { RecordIntegrityError } from '../src/chain.js';

const T0 = 1_700_000_000_000;
const e = (seq, type, data = {}) => ({ seq, type, time: T0 + seq, data });

function fakeDeps(sessions, { broken = null } = {}) {
  const flushed = [];
  const reads = [];
  return {
    flushed, reads,
    head: (id) => `head-of-${id}`,
    length: (id) => sessions[id].events.length,
    flush: async (id) => { flushed.push(id); },
    persistence: {
      stat: async (id) => (sessions[id] ? { header: { id, parentSession: sessions[id].parent ?? undefined } } : undefined),
      open: async (id) => ({
        read: async (offset = 0, length) => {
          reads.push({ id, offset, length });
          if (broken === id) throw new RecordIntegrityError({ sessionId: id, seq: 2, kind: 'broken-link', detail: 'altered' });
          const all = sessions[id].events;
          return { events: all.slice(offset, length === undefined ? undefined : offset + length) };
        },
        close: async () => {},
      }),
    },
  };
}

const SESSIONS = {
  root: { events: [e(0, 'turn/start'), e(1, 'assistant/message', { text: 'root thinks' }), e(2, 'tool/call', { name: 'bash' }), e(3, 'approval/asked', { tool: 'bash' })] },
  kid: { parent: 'root', events: [e(0, 'request/context', { ctx: 'kid context' }), e(1, 'assistant/attempt', { text: 'kid drafts' }), e(2, 'tool/call', { name: 'kid-act' }), e(3, 'compaction/summary', { text: 'kid summary' }), e(4, 'assistant/message', { text: 'kid thinks' })] },
  loop1: { parent: 'loop2', events: [] },
  loop2: { parent: 'loop1', events: [] },
  orphan: { parent: 'gone', events: [] },
};

test('own record: everything, including its own reasoning, with range, head and flush', async () => {
  const deps = fakeDeps(SESSIONS);
  const out = await readRecord(deps, { caller: 'root' });
  assert.match(out, /your own session/);
  assert.match(out, /The chain commits events 0\.\.3 \(4\); chain head head-of-root/);
  assert.match(out, /root thinks/);
  assert.doesNotMatch(out, /withheld/);
  assert.deepEqual(deps.flushed, ['root'], 'buffered acts are flushed before reading');
});

test('descendant: every reasoning-bearing type is withheld but LISTED; acts are shown', async () => {
  const out = await readRecord(fakeDeps(SESSIONS), { caller: 'root', session: 'kid' });
  for (const secret of ['kid context', 'kid drafts', 'kid summary', 'kid thinks']) assert.ok(!out.includes(secret), secret);
  for (const seq of [0, 1, 3, 4]) assert.match(out, new RegExp(`#${seq} \\S+ \\S+ — withheld: another Member's reasoning \\(R-10\\)`));
  assert.match(out, /#2 tool\/call .*kid-act/);
  assert.match(out, /4 withheld/);
  assert.match(out, /Acts only/);
  assert.deepEqual([...REASONING_TYPES].sort(), ['assistant/attempt', 'assistant/message', 'compaction/summary', 'request/context']);
});

test('scope: lineage walked upward from the target; loops, orphans and strangers answered, never guessed', async () => {
  const { persistence } = fakeDeps(SESSIONS);
  assert.deepEqual(await scopeOf(persistence, 'root', 'root'), { ok: true, relation: 'self' });
  assert.deepEqual(await scopeOf(persistence, 'root', 'kid'), { ok: true, relation: 'descendant', depth: 1 });
  assert.match((await scopeOf(persistence, 'root', 'loop1')).reason, /loops/);
  assert.match((await scopeOf(persistence, 'root', 'orphan')).reason, /names gone, which is not recorded/);
  assert.match((await scopeOf(persistence, 'kid', 'root')).reason, /not in your delegation lineage/);
  assert.match((await scopeOf(persistence, 'root', 'nope')).reason, /no session is recorded/);
});

test('a refused scope reads nothing, not even a flush', async () => {
  const deps = fakeDeps(SESSIONS);
  const out = await readRecord(deps, { caller: 'kid', session: 'root' });
  assert.match(out, /is not yours to read/);
  assert.ok(!out.includes('root thinks'));
  assert.deepEqual(deps.flushed, []);
});

test('integrity failure: an alarm naming the break, and no events', async () => {
  const out = await readRecord(fakeDeps(SESSIONS, { broken: 'root' }), { caller: 'root' });
  assert.match(out, /^\[R-2 ALARM\] .* broken-link at seq 2/);
  assert.ok(!out.includes('root thinks'));
});

test('filter, paging and bounds', async () => {
  const deps = fakeDeps(SESSIONS);
  assert.match(await readRecord(deps, { caller: 'root', types: 'tool/,approval' }), /Showing 2 event\(s\) matching "tool\/,approval": #2\.\.#3/);
  assert.match(await readRecord(deps, { caller: 'root', fromSeq: 1, limit: 2 }), /Showing 2 event\(s\): #1\.\.#2/);
  assert.match(await readRecord(deps, { caller: 'root', limit: 1 }), /Showing 1 event\(s\): #3\.\.#3/, 'no from_seq = the latest events');
  assert.match(await readRecord(deps, { caller: 'root', fromSeq: 99 }), /No events in the requested range/);
  assert.match(await readRecord(deps, { caller: 'root', types: 'nope/' }), /No events match "nope\/"/);
  assert.equal(MAX_LIMIT, 200);
  assert.equal(FULL_LIMIT, 10);
});

test('no identifiable caller: answered, not guessed', async () => {
  assert.match(await readRecord(fakeDeps(SESSIONS), {}), /No calling Subject is identifiable/);
});

// -- review (#73): bounded reads, and full's default ---------------------------

const BIG = { big: { events: Array.from({ length: 1200 }, (_, i) => e(i, i % 100 === 0 ? 'approval/asked' : 'tool/call', { i })) } };

test('bounded: the default tail reads only the window, to the end of the log', async () => {
  const deps = fakeDeps(BIG);
  const out = await readRecord(deps, { caller: 'big' });
  assert.deepEqual(deps.reads, [{ id: 'big', offset: 1170, length: undefined }],
    'one read of the last 30 — unbounded at the END so an event appended outside the chain still fails verification');
  assert.match(out, /every event read, #1170\.\.#1199/);
  assert.match(out, /Showing 30 event\(s\): #1170\.\.#1199/);
});

test('bounded: an explicit page reads exactly that page', async () => {
  const deps = fakeDeps(BIG);
  assert.match(await readRecord(deps, { caller: 'big', fromSeq: 500, limit: 5 }), /Showing 5 event\(s\): #500\.\.#504/);
  assert.deepEqual(deps.reads, [{ id: 'big', offset: 500, length: 5 }]);
});

test('bounded: a filtered read scans in chunks, and a paged filtered read stops early', async () => {
  const tail = fakeDeps(BIG);
  const out = await readRecord(tail, { caller: 'big', types: 'approval/', limit: 3 });
  assert.match(out, /Showing 3 event\(s\) matching "approval\/": #900\.\.#1100/);
  assert.ok(tail.reads.every(r => r.length === 500), 'chunked, never the whole log in one read');
  assert.match(out, /every event read, #0\.\.#1199/, 'the whole scan is verified and says so');
  const paged = fakeDeps(BIG);
  assert.match(await readRecord(paged, { caller: 'big', types: 'approval/', fromSeq: 0, limit: 2 }), /#0\.\.#100/);
  assert.equal(paged.reads.length, 1, 'stops once the page is full');
});

test('full=true defaults to 10 events, never 1', async () => {
  const out = await readRecord(fakeDeps(BIG), { caller: 'big', full: true });
  assert.match(out, /Showing 10 event\(s\): #1190\.\.#1199/);
  assert.match(await readRecord(fakeDeps(BIG), { caller: 'big', full: true, limit: 50 }), /Showing 10 event/, 'capped at 10');
});
