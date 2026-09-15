// Phase 1 acceptance — "every denial payload carries a rule ID and at least
// one lawful next move" (port plan Phase 1 acceptance tests). This lint walks
// EVERY refusal path the approval plugin can emit — ask (uncovered),
// ask (dedup-pending), deny (flood cap) — and asserts the Compact envelope
// shape (R-3/I-4) on the wire, not on a helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalPlugin, createApproval } from '../src/index.js';

function boot(opts = {}) {
  const registered = {};
  const ctx = { on: (name, fn) => { registered[name] = fn; } };
  const instance = approvalPlugin(opts);
  instance(ctx, {});
  const run = (exec) => registered['tools/pre-execute'](
    exec,
    async () => { throw new Error('next() must never be reached on a refusal path'); },
  );
  return { run, approval: instance.approval ?? instance };
}

// The lint: one shape check applied to every refusal the plugin can emit.
function assertEnvelope(shape, reason, label) {
  assert.ok(reason, `${label}: a refusal carries a reason`);
  assert.match(reason, /^\[AG\//, `${label}: the reason names the gate + rule ID`);
  assert.ok(reason.includes('Lawful next moves'), `${label}: the reason lists lawful next moves`);
  const moves = reason.split('\n').filter(l => l.startsWith('— '));
  assert.ok(moves.length >= 1, `${label}: at least one lawful next move`);
  for (const m of moves) assert.ok(m.length > 4, `${label}: a move is not an empty bullet`);
  return shape;
}

const NOW = 1_700_000_000_000;
const AGENT = { id: 'sess-1', session: { id: 'sess-1', header: {} } };

test('lint: the uncovered ask carries rule ID + lawful next moves', async () => {
  const { run } = boot({});
  const out = await run({ name: 'net.fetch', arguments: { host: 'unknown.example' }, agent: AGENT });
  assert.equal(out.kind, 'ask');
  assertEnvelope(out.kind, out.reason, 'uncovered ask');
});

test('lint: the dedup-pending ask carries the envelope too', async () => {
  const { run } = boot({});
  await run({ name: 'net.fetch', arguments: { host: 'dedup.example' }, agent: AGENT });
  const out = await run({ name: 'net.fetch', arguments: { host: 'dedup.example' }, agent: AGENT });
  assert.equal(out.kind, 'ask');
  assertEnvelope(out.kind, out.reason, 'dedup ask');
});

test('lint: the flood-cap denial carries rule ID + lawful next moves', async () => {
  const { run } = boot({ maxPendingPerRoot: 1 });
  await run({ name: 'net.fetch', arguments: { host: 'h1.example' }, agent: AGENT });
  const out = await run({ name: 'net.fetch', arguments: { host: 'h2.example' }, agent: AGENT });
  assert.equal(out.kind, 'deny');
  assertEnvelope(out.kind, out.reason, 'flood denial');
  assert.ok(out.reason.includes('I-5/flood-cap'), 'the flood denial names its rule');
});

test('lint: an expired pending ask re-asks (the sweep keeps the gate honest)', async () => {
  const a = createApproval({ pendingTtlMs: 1_000 });
  const v1 = a.evaluate({ tool: 'net.fetch', args: { host: 'x.example' }, root: 'r', session: 's', now: NOW });
  assert.equal(v1.verdict, 'pending-approval');
  const v2 = a.evaluate({ tool: 'net.fetch', args: { host: 'x.example' }, root: 'r', session: 's', now: NOW + 2_000 });
  assert.equal(v2.verdict, 'pending-approval', 'a forgotten ask is a FRESH ask, not a sticky dedup');
});

test('the module exports the cordis contract: name, inject, apply', async () => {
  const mod = await import('../src/index.js');
  assert.equal(mod.name, 'compact-approval');
  assert.deepEqual(mod.inject, ['approval'], 'the composition must provide the approval seam (fail loudly at load, not degrade silently)');
  assert.equal(typeof mod.apply, 'function');
});
