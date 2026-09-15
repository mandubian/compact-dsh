// Phase 1 slice 2 — decision materialization, pending release, revocation
// that kills covered cache entries (port plan Phase 1 items 4 & 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApproval, canonicalTarget } from '../src/index.js';

const NOW = 1_700_000_000_000;
const agent = (id = 'sess-a') => ({ id, session: { id, header: {} } });
const T = (tool, args, session = 'sess-a') => ({ tool, args, root: 'sess-a', session, now: NOW });

test('a decided ask releases the dedup record and the flood slot', () => {
  const a = createApproval({});
  const fp = a.fingerprint('net.fetch', { host: 'unknown.example' });
  let v = a.evaluate(T('net.fetch', { host: 'unknown.example' }));
  assert.equal(v.verdict, 'pending-approval');
  assert.equal(a.store.countPending('sess-a'), 1);
  a.store.resolvePending('sess-a', fp);                     // the answerer's finally-branch
  assert.equal(a.store.countPending('sess-a'), 0);
  assert.equal(a.store.pending.has(fp), false);
  v = a.evaluate(T('net.fetch', { host: 'unknown.example' }));
  assert.equal(v.verdict, 'pending-approval');              // a fresh ask, not a dedup
});

test('a rejected ask does not consume flood capacity forever (cap releases)', () => {
  const a = createApproval({ maxPendingPerRoot: 1 });
  const v1 = a.evaluate(T('net.fetch', { host: 'h1.example' }));
  assert.equal(v1.verdict, 'pending-approval');
  assert.equal(a.evaluate(T('net.fetch', { host: 'h2.example' })).verdict, 'refused-flood');
  a.store.resolvePending('sess-a', v1.fingerprint);         // rejected/cancelled/unavailable
  assert.equal(a.evaluate(T('net.fetch', { host: 'h2.example' })).verdict, 'pending-approval');
});

test('sweep: a pending ask older than the TTL is forgotten, a young one kept', () => {
  const a = createApproval({ maxPendingPerRoot: 1 });
  const v = a.evaluate(T('net.fetch', { host: 'h1.example' }));
  a.store.sweepPending(NOW + 1, 5 * 60_000);                // young: kept
  assert.equal(a.store.pending.has(v.fingerprint), true);
  const n = a.store.sweepPending(NOW + 6 * 60_000, 5 * 60_000);
  assert.equal(n, 1);
  assert.equal(a.store.countPending('sess-a'), 0);
});

test('the full deny→ask→approve→replay-hit cycle at store level', () => {
  const a = createApproval({ execCacheTtlMs: 60_000 });
  const args = { host: 'api.example.com' };
  const v1 = a.evaluate(T('net.fetch', args));
  assert.equal(v1.verdict, 'pending-approval');
  // the answerer materializes the allowed-once: exec-cache entry with the
  // canonical target, then releases the pending record
  a.store.cacheSet(v1.fingerprint, NOW + 1, 60_000, canonicalTarget(args));
  a.store.resolvePending('sess-a', v1.fingerprint);
  const v2 = a.evaluate({ ...T('net.fetch', args), session: 'sess-other' });
  assert.equal(v2.verdict, 'allowed');
  assert.equal(v2.layer, 'exec-cache');                     // replay hit, cross-session
});

test('revoke kills the grant AND every cache entry its pattern covered', () => {
  const a = createApproval({});
  const g = a.grantSession({ pattern: '*.example.org', root: 'sess-a' });
  const covered = a.fingerprint('net.fetch', { host: 'docs.example.org' });
  const covered2 = a.fingerprint('net.fetch', { host: 'api.example.org' });
  // suffix matching covers subdomains and the apex, never lookalikes
  const uncovered = a.fingerprint('net.fetch', { host: 'notexample.org' });
  a.store.cacheSet(covered, NOW, 60_000, canonicalTarget({ host: 'docs.example.org' }));
  a.store.cacheSet(covered2, NOW, 60_000, canonicalTarget({ host: 'api.example.org' }));
  a.store.cacheSet(uncovered, NOW, 60_000, canonicalTarget({ host: 'notexample.org' }));
  a.revoke(g.id, NOW + 1);
  assert.equal(a.store.cache.has(covered), false);
  assert.equal(a.store.cache.has(covered2), false);
  assert.equal(a.store.cache.has(uncovered), true);         // not covered by the pattern
});

test('revoke of an unknown id returns null, not a crash', () => {
  const a = createApproval({});
  assert.equal(a.revoke('sg_nope', NOW), null);
});

test('takeAsk correlates the agent+tool ask record exactly once', () => {
  const a = createApproval({});
  const ag = agent('sess-a');
  a.recordAsk(ag, 'net.fetch', { fp: 'fp_x', root: 'sess-a', session: 'sess-a', args: {} });
  const rec = a.takeAsk(ag, 'net.fetch');
  assert.equal(rec.fp, 'fp_x');
  assert.equal(a.takeAsk(ag, 'net.fetch'), null);           // claimed once
  assert.equal(a.takeAsk(agent('sess-b'), 'net.fetch'), null); // other agent: nothing
  assert.equal(a.takeAsk(ag, 'other.tool'), null);
});
