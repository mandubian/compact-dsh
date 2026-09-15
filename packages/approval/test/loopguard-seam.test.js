// Phase 1 item 7 — LoopGuard cooperation seam. Every refusal the gate
// constructs is emitted on the Cordis event bus (REFUSAL_EVENT); the Phase 3
// guard plugin folds these into trip 12 (irrecoverable gate flailing) of
// docs/concept-loopguard-trips.md. Decision outcomes are NOT re-emitted —
// the host's approval/asked + approval/decided log pair is the record (D-7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { approvalPlugin, REFUSAL_EVENT } from '../src/index.js';

function boot(opts = {}) {
  const registered = {};
  const emitted = [];
  const ctx = {
    on: (name, fn) => { registered[name] = fn; },
    emit: (name, payload) => { if (name === REFUSAL_EVENT) emitted.push(payload); },
  };
  const instance = approvalPlugin(opts);
  instance(ctx, {});
  const run = (exec) => registered['tools/pre-execute'](exec, async () => ({ kind: 'allow' }));
  return { run, emitted, approval: instance.approval ?? instance };
}

const AGENT = { id: 'sess-1', session: { id: 'sess-1', header: {} } };

test('an allowed call emits nothing — only refusals are gate flailing evidence', async () => {
  const { run, emitted, approval } = boot({});
  approval.grantSession({ pattern: 'allowed.example', root: 'sess-1', session: 'sess-1', ttlMs: 0 });
  await run({ name: 'net.fetch', arguments: { host: 'allowed.example' }, agent: AGENT });
  assert.deepEqual(emitted, []);
});

test('every ask (uncovered, dedup) emits exactly one refusal payload', async () => {
  const { run, emitted } = boot({});
  await run({ name: 'net.fetch', arguments: { host: 'flail.example' }, agent: AGENT });
  await run({ name: 'net.fetch', arguments: { host: 'flail.example' }, agent: AGENT }); // dedup — still flailing
  assert.equal(emitted.length, 2);
  assert.deepEqual(
    { kind: emitted[0].kind, verdict: emitted[0].verdict, ruleId: emitted[0].ruleId, tool: emitted[0].tool },
    { kind: 'ask', verdict: 'pending-approval', ruleId: emitted[0].fingerprint, tool: 'net.fetch' },
  );
  assert.equal(emitted[1].verdict, 'dedup-pending');
  assert.equal(emitted[0].root, 'sess-1');
  assert.equal(emitted[0].session, 'sess-1');
  assert.equal(typeof emitted[0].at, 'number');
  assert.equal(emitted[0].fingerprint, emitted[1].fingerprint, 'both asks are the same fingerprint');
});

test('the flood denial emits with kind deny and its rule id', async () => {
  const { run, emitted } = boot({ maxPendingPerRoot: 1 });
  await run({ name: 'net.fetch', arguments: { host: 'h1.example' }, agent: AGENT });
  await run({ name: 'net.fetch', arguments: { host: 'h2.example' }, agent: AGENT });
  assert.equal(emitted.length, 2);
  assert.deepEqual(
    { kind: emitted[1].kind, verdict: emitted[1].verdict, ruleId: emitted[1].ruleId },
    { kind: 'deny', verdict: 'refused-flood', ruleId: 'I-5/flood-cap' },
  );
});

test('a throwing listener never takes the gate down — the refusal stands', async () => {
  const registered = {};
  const ctx = {
    on: (name, fn) => { registered[name] = fn; },
    emit: () => { throw new Error('broken accounting listener'); },
  };
  const instance = approvalPlugin({});
  instance(ctx, {});
  const out = await registered['tools/pre-execute'](
    { name: 'net.fetch', arguments: { host: 'x.example' }, agent: AGENT },
    async () => ({ kind: 'allow' }),
  );
  assert.equal(out.kind, 'ask', 'the gate answers even when accounting explodes');
});

test('the event travels a REAL cordis bus by name', async () => {
  const ctx = new Context();
  const seen = [];
  ctx.on(REFUSAL_EVENT, (payload) => seen.push(payload));
  const instance = approvalPlugin({});
  const approval = instance(ctx, {});
  const v = approval.evaluate({ tool: 'net.fetch', args: { host: 'bus.example' }, root: 'r', session: 's', now: Date.now() });
  ctx.emit(REFUSAL_EVENT, { verdict: v.verdict, ruleId: v.ruleId });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].verdict, 'pending-approval');
});
