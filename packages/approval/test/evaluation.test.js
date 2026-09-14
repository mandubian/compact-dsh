import test from 'node:test';
import assert from 'node:assert/strict';
import { createApproval } from '../src/index.js';

const NOW = 1_700_000_000_000;
const T = (tool, args) => ({ tool, args, root: 'root-1', session: 'root-1/worker-a', now: NOW });
const later = (ms) => NOW + ms;

test('layer order: exec-cache answers before session grants are consulted', () => {
  const a = createApproval({ execCacheTtlMs: 60_000 });
  a.grantSession({ pattern: 'api.example.com', root: 'root-1', session: 'root-1/worker-a' });
  const fp = a.fingerprint('net.fetch', { host: 'api.example.com' });
  a.store.cacheSet(fp, NOW, 60_000);                       // cache populated (e.g. by an earlier approval)
  const v = a.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.equal(v.verdict, 'allowed');
  assert.equal(v.layer, 'exec-cache');                     // layer 1 beats layer 3
  a.store.cache.delete(fp);                                // cache gone: the session grant still covers
  const v2 = a.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.equal(v2.verdict, 'allowed'); assert.equal(v2.layer, 'session-grant');
});

test('uncovered first call asks; the ask is recorded once per fingerprint', () => {
  const a = createApproval({});
  const v = a.evaluate(T('net.fetch', { host: 'unknown.example' }));
  assert.equal(v.verdict, 'pending-approval');
  const v2 = a.evaluate(T('net.fetch', { host: 'unknown.example' }));
  assert.equal(v2.verdict, 'dedup-pending');
});

test('exec cache: identical op allowed once granted, TTL expiry with fake clock', () => {
  const a = createApproval({ execCacheTtlMs: 60_000 });
  a.store.cacheSet(a.fingerprint('net.fetch', { host: 'api.example.com' }), NOW, 60_000);
  let v = a.evaluate(T('net.fetch', { host: 'API.EXAMPLE.COM' })); // phrasing: host case
  assert.equal(v.verdict, 'allowed'); assert.equal(v.layer, 'exec-cache');
  v = a.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.equal(v.verdict, 'allowed'); // still cached
  v = a.evaluate({ tool: 'net.fetch', args: { host: 'api.example.com' }, root: 'root-1', session: 's', now: later(61_000) });
  assert.equal(v.verdict, 'pending-approval'); // expired → back to the gate
});

test('exec cache disabled when TTL is 0', () => {
  const a = createApproval({ execCacheTtlMs: 0 });
  const fp = a.fingerprint('net.fetch', { host: 'x' });
  a.store.cacheSet(fp, NOW, 0);                            // 0 disables: nothing cached
  assert.equal(a.store.cache.has(fp), false);
  const v = a.evaluate(T('net.fetch', { host: 'x' }));
  assert.equal(v.verdict, 'pending-approval');
});

test('session grant: covers own session, not the sibling', () => {
  const a = createApproval({});
  a.grantSession({ pattern: 'api.example.com', root: 'root-1', session: 'root-1/worker-a' });
  assert.equal(a.evaluate({ ...T('net.fetch', { host: 'api.example.com' }), session: 'root-1/worker-a' }).verdict, 'allowed');
  assert.equal(a.evaluate({ ...T('net.fetch', { host: 'api.example.com' }), session: 'root-1/worker-b' }).verdict, 'pending-approval');
});

test('plan grant covers any session under the root', () => {
  const a = createApproval({});
  a.grantPlan({ pattern: '*.example.org', planRef: 'plan-42' });
  const v = a.evaluate({ tool: 'net.fetch', args: { host: 'docs.example.org' }, root: 'root-9', session: 'root-9/x', now: NOW });
  assert.equal(v.verdict, 'allowed'); assert.equal(v.layer, 'plan-grant');
});

test('revocation kills a live grant', () => {
  const a = createApproval({});
  const g = a.grantSession({ pattern: 'api.example.com', root: 'root-1', session: 'root-1/worker-a' });
  assert.equal(a.evaluate(T('net.fetch', { host: 'api.example.com' })).verdict, 'allowed');
  a.revoke(g.id, NOW + 1);
  const v = a.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.notEqual(v.verdict, 'allowed');
});

test('pending dedup: identical uncovered call does not re-ask', () => {
  const a = createApproval({});
  const v1 = a.evaluate(T('net.fetch', { host: 'unknown.example' }));
  const v2 = a.evaluate(T('net.fetch', { host: 'unknown.example' }));
  assert.equal(v1.verdict, 'pending-approval');
  assert.equal(v2.verdict, 'dedup-pending');
});

test('flood cap: over-cap uncovered requests are refused loudly', () => {
  const a = createApproval({ maxPendingPerRoot: 3 });
  for (let i = 0; i < 3; i++) {
    const v = a.evaluate(T('net.fetch', { host: `h${i}.example` }));
    assert.equal(v.verdict, 'pending-approval');
  }
  const v = a.evaluate(T('net.fetch', { host: 'h-over.example' }));
  assert.equal(v.verdict, 'refused-flood');
  assert.equal(v.ruleId, 'I-5/flood-cap');
});
