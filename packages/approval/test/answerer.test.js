// Phase 1 slice 2 — decision materialization, pending release, revocation
// that kills covered cache entries (port plan Phase 1 items 4 & 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApproval, approvalPlugin, canonicalTarget } from '../src/index.js';

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

test('concurrent asks for one tool never overwrite: approval of A cannot cache B (wrong-grant regression)', () => {
  const a = createApproval({});
  const ag = agent('sess-a');
  // two different uncovered calls queue up before the operator answers
  a.recordAsk(ag, 'net.fetch', { fp: 'fp_A', callId: 'call-1', root: 'sess-a', session: 'sess-a', args: { host: 'a.example' } });
  a.recordAsk(ag, 'net.fetch', { fp: 'fp_B', callId: 'call-2', root: 'sess-a', session: 'sess-a', args: { host: 'b.example' } });
  // the operator decides the FIRST request: its own record must be claimed,
  // never the later one — callId matches exactly, FIFO falls back in order
  const first = a.takeAsk(ag, 'net.fetch', 'call-1');
  assert.equal(first.fp, 'fp_A', 'the decided request claims its own fingerprint');
  const second = a.takeAsk(ag, 'net.fetch', 'call-2');
  assert.equal(second.fp, 'fp_B');
  // without a callId the queue drains FIFO, matching ask order to decision order
  a.recordAsk(ag, 'net.fetch', { fp: 'fp_C', root: 'sess-a', session: 'sess-a', args: {} });
  a.recordAsk(ag, 'net.fetch', { fp: 'fp_D', root: 'sess-a', session: 'sess-a', args: {} });
  assert.equal(a.takeAsk(ag, 'net.fetch').fp, 'fp_C');
  assert.equal(a.takeAsk(ag, 'net.fetch').fp, 'fp_D');
});

test('a stale ask record (decision that never arrived) is dropped on the next take', () => {
  const a = createApproval({ pendingTtlMs: 1_000 });
  const ag = agent('sess-a');
  a.recordAsk(ag, 'net.fetch', { fp: 'fp_old', root: 'sess-a', session: 'sess-a', args: {}, at: Date.now() - 10_000 });
  assert.equal(a.takeAsk(ag, 'net.fetch'), null, 'a stale record never materializes a grant');
});

// -- web-mode ordering (#24) ------------------------------------------------
// dsh-api-remotes registers the browser's approval bridge from a boot EFFECT,
// and an effect-registered listener precedes a plain apply-registered one in
// the waterfall. The plugin must therefore PREPEND its recorded answerer, or
// the bridge sits upstream in web mode and a browser verdict resolves the
// chain without ever flowing through the answerer's next() — the only place
// cacheSet executes. Replicated here with a plain Cordis context: the bridge
// plugin is loaded FIRST and registers via ctx.effect, exactly like
// api-remotes; the verdict it returns is the browser's.
test('web mode: a browser verdict answered upstream still materializes the exec-cache', async () => {
  const { Context } = await import('@deepseek-ai/cordis');
  const { mkdtempSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const persistPath = join(mkdtempSync(join(tmpdir(), 'approval-web-')), 'approvals.json');

  const seen = { order: [], decidingDuringBridge: null };
  const bridge = {
    name: 'web-bridge',
    apply: (c) => c.effect(() => {
      // the browser page: answers without calling next(), like forwardWaterfall
      // does when the gateway resolves the parked dispatch with a result
      c.on('approval/request', async (req) => {
        seen.order.push('bridge');
        seen.decidingDuringBridge = ctx.get('compact-approval')?.deciding?.get(String(req.callId)) ?? null;
        return 'allowed-once';
      });
    }, 'web-bridge: approval waterfall'),
  };
  const ctx = new Context();
  ctx.plugin(bridge);
  await new Promise(r => setImmediate(r));                   // the web bundle settles first: the bridge registers BEFORE the composition applies (patch-row order in the real boot)
  const inst = approvalPlugin({ persistPath });
  inst(ctx, {});

  const ag = agent('sess-web');
  const gated = inst.approval.gate({ name: 'net.fetch', arguments: { host: 'evil.example' }, agent: ag, callId: 'call-web-1' });
  assert.equal(gated?.kind, 'ask', 'the uncovered target is gated');

  const outcome = await ctx.waterfall(
    'approval/request',
    { toolName: 'net.fetch', agent: ag, callId: 'call-web-1', reason: gated.reason },
    () => 'unavailable',
  );
  assert.equal(outcome, 'allowed-once');
  assert.deepEqual(seen.order, ['bridge'], 'the recorded answerer claimed the ask before the bridge decided');
  assert.ok(seen.decidingDuringBridge, 'the deciding preview was live while the browser decided');
  assert.match(seen.decidingDuringBridge.command, /evil\.example/);
  assert.equal(inst.approval.store.cache.size, 1, 'the browser-approved verdict materialized the exec-cache');
  assert.equal(inst.approval.store.countPending('sess-web'), 0, 'the pending record was released');
  assert.ok(existsSync(persistPath), 'the store flushed to approvals.json');
});

test('web mode: a browser rejection upstream materializes nothing', async () => {
  const { Context } = await import('@deepseek-ai/cordis');
  const bridge = {
    name: 'web-bridge',
    apply: (c) => c.effect(() => {
      c.on('approval/request', async () => 'rejected');
    }, 'web-bridge: approval waterfall'),
  };
  const ctx = new Context();
  ctx.plugin(bridge);
  await new Promise(r => setImmediate(r));                   // bridge first, as in the real web boot
  const inst = approvalPlugin({});
  inst(ctx, {});

  const ag = agent('sess-web');
  inst.approval.gate({ name: 'net.fetch', arguments: { host: 'denied.example' }, agent: ag, callId: 'call-web-2' });
  const outcome = await ctx.waterfall(
    'approval/request',
    { toolName: 'net.fetch', agent: ag, callId: 'call-web-2', reason: '[AG/I-5] ask' },
    () => 'unavailable',
  );
  assert.equal(outcome, 'rejected');
  assert.equal(inst.approval.store.cache.size, 0, 'a rejection never caches');
  assert.equal(inst.approval.store.countPending('sess-web'), 0);
});
