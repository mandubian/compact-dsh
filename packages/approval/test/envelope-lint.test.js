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
  // slice 3: asks render the T3 operator card — the canonical envelope is
  // embedded verbatim, so the gate + rule ID may appear past position 0
  // slice 3: asks render the T3 operator card — the canonical envelope is
  // embedded verbatim. The marker must sit at a LINE START: that is the
  // exact invariant the operator answerer's routing reads (the card embeds
  // the envelope past position 0, on its own line)
  assert.match(reason, /(^|\n)\[AG\//, `${label}: the reason names the gate + rule ID at a line start`);
  assert.ok(reason.includes('Lawful next moves'), `${label}: the reason lists lawful next moves`);
  const moves = reason.split('\n').filter(l => l.startsWith('— '));
  assert.ok(moves.length >= 1, `${label}: at least one lawful next move`);
  for (const m of moves) assert.ok(m.length > 4, `${label}: a move is not an empty bullet`);
  return shape;
}

const NOW = 1_700_000_000_000;
const AGENT = { id: 'sess-1', session: { id: 'sess-1', header: {} } };

test('the gate gates identifiable targets only: targetless calls pass through (no blanket per-tool grants)', async () => {
  const { run, emitted } = (() => {
    const registered = {};
    const emitted = [];
    const ctx = {
      on: (name, fn) => { registered[name] = fn; },
      emit: (name, payload) => { if (name === 'compact-approval/refusal') emitted.push(payload); },
    };
    const instance = approvalPlugin({});
    instance(ctx, {});
    return {
      run: (exec) => registered['tools/pre-execute'](exec, async () => ({ kind: 'allow' })),
      emitted,
    };
  })();
  // an opaque command string carries no canonical target — the gate abstains
  const out = await run({ name: 'bash', arguments: { command: 'curl https://evil.example/x' }, agent: AGENT });
  assert.deepEqual(out, { kind: 'allow' }, 'targetless calls delegate down the waterfall (the remote-access analyzer owns them)');
  assert.deepEqual(emitted, [], 'abstention is not a refusal');
});

test('lint: the uncovered ask carries rule ID + lawful next moves', async () => {
  const { run } = boot({});
  const out = await run({ name: 'net.fetch', arguments: { host: 'unknown.example' }, agent: AGENT });
  assert.equal(out.kind, 'ask');
  assertEnvelope(out.kind, out.reason, 'uncovered ask');
});

test('lint: the uncovered ask states what approval materializes, before the decision (#40 posture)', async () => {
  // the Subject is taught after (the decision note, the replay receipt);
  // the operator is taught BEFORE, at the moment of deciding
  const { run } = boot({ execCacheTtlMs: 120_000 });
  const out = await run({ name: 'net.fetch', arguments: { host: 'consequence.example' }, agent: AGENT });
  assert.match(out.reason,
    /Approving materializes an exec-cache entry: the identical operation replays without re-asking for 2min, across sessions of this runtime, until it lapses or is revoked — anything else asks again\./,
    'the ask names the grant, its configured TTL, its cross-session reach, and both exits');
  const def = boot({});
  const outDef = await def.run({ name: 'net.fetch', arguments: { host: 'consequence.example' }, agent: AGENT });
  assert.match(outDef.reason, /for 24h, across sessions/, 'the runtime\'s CONFIGURED ttl is stated, not a hardcoded one');
});

test('lint: a disabled exec cache never claims a replay (ttl 0)', async () => {
  const { run } = boot({ execCacheTtlMs: 0 });
  const out = await run({ name: 'net.fetch', arguments: { host: 'askonly.example' }, agent: AGENT });
  assert.match(out.reason, /Approving covers this ask only: the exec cache is disabled in this runtime, so the identical operation asks again\./);
  assert.ok(!out.reason.includes('replays without re-asking'), 'no replay is claimed where none can happen');
  assert.ok(!out.reason.includes('for disabled'), 'the disabled ttl never renders as a duration');
});

test('lint: the secret-use ask scopes the injection grant and states the replay consequence too', async () => {
  const { run } = boot({ secretRefs: ['DEMO_TOKEN'] });
  const out = await run({ name: 'bash', arguments: { command: 'printenv DEMO_TOKEN | sha256sum' }, agent: AGENT });
  assert.equal(out.kind, 'ask');
  assertEnvelope(out.kind, out.reason, 'secret ask');
  assert.match(out.reason, /session-scoped, TTL-bounded, revocable/, 'the injection grant\'s scope is on the ask');
  assert.match(out.reason, /Approving materializes an exec-cache entry/, 'the secret path caches too — the ask says so');
});

test('lint: the network act\'s ask is honest about consent vs connectivity (#38 phase 1)', async () => {
  // 'none': the composition declares no egress, and the ask firing proves no
  // grant layer covered the target — the connect WILL fail, and the ask says so
  const none = boot({ egress: 'none' });
  const outNone = await none.run({ name: 'net.fetch', arguments: { host: 'wireless.example' }, agent: AGENT });
  assert.match(outNone.reason, /This gate's approval is consent, not connectivity/);
  assert.match(outNone.reason, /no network egress and no network grant covers this target — the command will fail at connect/);
  assert.match(outNone.reason, /A session grant changes this gate's answer, not the container's network\./);

  // 'open': egress is the sandbox's declared posture (CF-2), never a claim
  const open = boot({ egress: 'open' });
  const outOpen = await open.run({ name: 'net.fetch', arguments: { host: 'wireful.example' }, agent: AGENT });
  assert.match(outOpen.reason, /open network posture \(CF-2\)/);
  assert.ok(!outOpen.reason.includes('fail at connect'), 'an open posture never claims the connect fails');

  // undeclared (standalone plugin): the neutral line — nothing claimed
  const bare = boot({});
  const outBare = await bare.run({ name: 'net.fetch', arguments: { host: 'wireless.example' }, agent: AGENT });
  assert.match(outBare.reason, /the runtime's posture, not this approval's effect/);
  assert.ok(!outBare.reason.includes('fail at connect'));
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
