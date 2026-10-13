// #195 — the composition seam. The judgment surface is watch.js (tested in
// night-watch.test.mjs); this file proves the PLUGIN ROW: the policy comes
// from the mount config or COMPACT_DECIDER; absent → the chair stays empty
// (no listener, the default composition is unchanged); named → the watch
// seats and answers edge asks; an unknown policy is refused at the config
// boundary, loudly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.js';

function harness({ env, config } = {}) {
  const listeners = {};
  const warns = [];
  const approval = { store: { sessionGrants: [] }, deciding: new Map() };
  const ctx = {
    on: (name, fn) => { (listeners[name] ??= []).push(fn); },
    get: (service) => service === 'compact-approval' ? approval : undefined,
    logger: { warn: (message) => warns.push(String(message)) },
  };
  const prev = process.env.COMPACT_DECIDER;
  if (env === undefined) delete process.env.COMPACT_DECIDER;
  else process.env.COMPACT_DECIDER = env;
  return {
    ctx, listeners, warns,
    restore() { if (prev === undefined) delete process.env.COMPACT_DECIDER; else process.env.COMPACT_DECIDER = prev; },
  };
}

test('apply: no policy named — the chair stays empty, the composition is unchanged', () => {
  const h = harness({ env: undefined });
  try {
    apply(h.ctx, {});
    apply(h.ctx, { policy: null });
    assert.equal((h.listeners['approval/request'] ?? []).length, 0, 'no listener mounted');
  } finally { h.restore(); }
});

test('apply: COMPACT_DECIDER seats the watch — one listener, declared at boot', () => {
  const h = harness({ env: 'deny' });
  try {
    apply(h.ctx, {});
    assert.equal(h.listeners['approval/request']?.length, 1, 'the watch is seated');
    assert.ok(h.warns.some(w => w.includes('night watch appointed (policy: deny)')), 'the appointment is declared, never silent');
    assert.ok(h.warns.some(w => w.includes('no live network grant in the store')), 'the empty-store hint is declared (#182)');
  } finally { h.restore(); }
});

test('apply: config.policy wins over the env — the profile patch can pin', async () => {
  const h = harness({ env: 'deny' });
  try {
    apply(h.ctx, { policy: 'escalate' });
    // seat a params-edge ask: escalate falls through downstream, untouched
    const view = { cause: { kind: 'params-edge', grantId: 'sg_1', refused: ['page'], credential: [] } };
    h.ctx.get('compact-approval').deciding.set('c1', view);
    let downstream = false;
    const outcome = await h.listeners['approval/request'][0]({ toolName: 'bash', callId: 'c1' }, () => { downstream = true; return 'fell-through'; });
    assert.equal(outcome, 'fell-through', 'escalate answers nothing');
    assert.ok(downstream, 'the ask fell through to the host');
  } finally { h.restore(); }
});

test('apply: an unknown policy is refused at the config boundary, loudly', () => {
  const h = harness({ env: undefined });
  try {
    assert.throws(() => apply(h.ctx, { policy: 'wing-it' }), /unknown policy "wing-it"/);
  } finally { h.restore(); }
});

test('apply: a seated watch answers the params-edge ask (deny, on the view)', async () => {
  const h = harness({ env: 'deny' });
  try {
    apply(h.ctx, {});
    const view = { cause: { kind: 'params-edge', grantId: 'sg_1', tool: 'net.fetch', refused: ['page'], credential: [] } };
    h.ctx.get('compact-approval').deciding.set('c1', view);
    const outcome = await h.listeners['approval/request'][0]({ toolName: 'net.fetch', callId: 'c1' }, () => 'fell-through');
    assert.equal(outcome, 'rejected', 'the deny policy refuses the edge');
    assert.equal(view.decider.policy, 'deny', 'the verdict is claimed on the deciding view');
    assert.match(view.decider.motivation, /axis refused \(page\)/);
  } finally { h.restore(); }
});
