// Phase 1 slice 3 — grant budgets (the plan's schema "budget" column):
// a grant covers exactly maxUses executions, then stops covering. Uses are
// consumed when a grant ANSWERS (layers 2–3), never by exec-cache replays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApproval } from '../src/index.js';

const NOW = 1_700_000_000_000;
const T = (tool, args, session = 'root-1/worker-a', now = NOW) =>
  ({ tool, args, root: 'root-1', session, now });

test('a budgeted session grant covers exactly maxUses executions', () => {
  const a = createApproval({});
  const g = a.grantSession({ pattern: 'api.example.com', root: 'root-1', session: 'root-1/worker-a', ttlMs: 0, maxUses: 2 });
  assert.equal(a.evaluate(T('net.fetch', { host: 'api.example.com' })).verdict, 'allowed');
  assert.equal(a.evaluate(T('net.fetch', { host: 'api.example.com' })).verdict, 'allowed');
  assert.equal(g.uses, 2);
  // spent grants stop covering — the next call is a fresh ask, not a silent allow
  const v = a.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.equal(v.verdict, 'pending-approval');
  assert.equal(g.uses, 2, 'a spent grant consumes nothing further');
});

test('unlimited grants (the default) never spend', () => {
  const a = createApproval({});
  const g = a.grantSession({ pattern: 'api.example.com', root: 'root-1', ttlMs: 0 });
  for (let i = 0; i < 5; i++) assert.equal(a.evaluate(T('net.fetch', { host: 'api.example.com' })).verdict, 'allowed');
  assert.equal(g.maxUses, null);
  assert.equal(g.uses, 0);
});

test('plan grants carry budgets too', () => {
  const a = createApproval({});
  const g = a.grantPlan({ pattern: '*.example.org', planRef: 'plan-42', maxUses: 1 });
  assert.equal(a.evaluate({ ...T('net.fetch', { host: 'docs.example.org' }), session: 'root-9/x', root: 'root-9' }).verdict, 'allowed');
  assert.equal(g.uses, 1);
  assert.equal(a.evaluate({ ...T('net.fetch', { host: 'docs.example.org' }), session: 'root-9/x', root: 'root-9' }).verdict, 'pending-approval');
});

test('the ANSWERING grant is the budgeted and reported one (scope-ok selection)', () => {
  const a = createApproval({});
  const other = a.grantSession({ pattern: 'api.example.com', root: 'root-1', session: 'root-1/worker-b' });
  const mine = a.grantSession({ pattern: 'api.example.com', root: 'root-1', session: 'root-1/worker-a', ttlMs: 0, maxUses: 1 });
  const v = a.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.equal(v.verdict, 'allowed');
  assert.equal(v.ruleId, mine.id, 'the record must name the grant actually consumed');
  assert.equal(mine.uses, 1);
  assert.equal(other.uses, 0, 'a grant that did not answer consumes nothing');
});

test('cache replays do not consume grant budget', () => {
  const a = createApproval({ execCacheTtlMs: 60_000 });
  const g = a.grantSession({ pattern: 'api.example.com', root: 'root-1', ttlMs: 0, maxUses: 1 });
  assert.equal(a.evaluate(T('net.fetch', { host: 'api.example.com' })).verdict, 'allowed');
  assert.equal(g.uses, 1);                              // grant spent by the first call
  const fp = a.fingerprint('net.fetch', { host: 'api.example.com' });
  a.store.cacheSet(fp, NOW, 60_000);                    // approval materialized the replay
  const v = a.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.equal(v.verdict, 'allowed');
  assert.equal(v.layer, 'exec-cache', 'the replay rides the cache, not the spent grant');
});

test('budget and expiry combine: an expired grant covers nothing regardless of budget', () => {
  const a = createApproval({});
  a.grantSession({ pattern: 'api.example.com', root: 'root-1', ttlMs: 1_000, maxUses: 100, now: NOW });
  assert.equal(a.evaluate(T('net.fetch', { host: 'api.example.com' })).verdict, 'allowed');
  assert.equal(a.evaluate({ ...T('net.fetch', { host: 'api.example.com' }), now: NOW + 1_001 }).verdict, 'pending-approval');
});
