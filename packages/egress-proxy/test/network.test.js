// The platform cell, tested without Docker: provisioning the mediation
// network is inspect-or-create --internal, and every way it can be WRONG
// (wrong name, not internal, no gateway, unreachable daemon) refuses by name
// rather than booting an egress posture that cannot deliver (#38, D-7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureEgressNetwork } from '../src/network.js';

const INSPECT_OK = 'sha256:net|bridge|true|172.30.0.1';
const INSPECT_MISSING = () => { const e = new Error('Error: No such network: compact-egress'); e.code = 1; throw e; };

function runner({ inspect = () => INSPECT_OK, create = () => '' } = {}) {
  const calls = [];
  const run = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'network' && args[1] === 'inspect') return inspect(args);
    if (args[0] === 'network' && args[1] === 'create') return create(args);
    throw new Error(`unexpected docker call: ${args.join(' ')}`);
  };
  return { calls, run };
}

test('an existing internal network is read, never recreated', async () => {
  const { calls, run } = runner();
  const net = await ensureEgressNetwork({ name: 'compact-egress', run });
  assert.deepEqual(net, { name: 'compact-egress', gateway: '172.30.0.1', driver: 'bridge', id: 'sha256:net' });
  assert.deepEqual(calls.length, 1, 'one inspect, nothing else — existing state is never mutated');
});

test('a missing network is created INTERNAL, then re-inspected', async () => {
  const { calls, run } = runner({
    inspect: (() => { let n = 0; return () => { if (n++ === 0) throw INSPECT_MISSING(); return INSPECT_OK; }; })(),
  });
  const net = await ensureEgressNetwork({ name: 'compact-egress', run });
  assert.equal(net.gateway, '172.30.0.1');
  assert.equal(calls[1], 'network create --internal --driver bridge compact-egress',
    'created the only shape this posture tolerates: internal, by name, reproducible');
});

test('a create race resolves to the inspection — whoever made it, the facts decide', async () => {
  const { calls, run } = runner({
    inspect: (() => { let n = 0; return () => { if (n++ === 0) throw INSPECT_MISSING(); return INSPECT_OK; }; })(),
    create: () => { throw new Error('Error: network with name compact-egress already exists'); },
  });
  const net = await ensureEgressNetwork({ name: 'compact-egress', run });
  assert.equal(net.gateway, '172.30.0.1');
  assert.ok(calls.some(c => c.startsWith('network create')), 'the create was attempted');
});

test('"none", blank, or a missing name refuses — an egress posture needs a network', async () => {
  for (const bad of [undefined, null, '', 'none', '  ']) {
    await assert.rejects(
      () => ensureEgressNetwork({ name: bad, run: runner().run }),
      /must be a docker network NAME \(never "none"\)/,
      JSON.stringify(bad));
  }
});

test('an existing network that is NOT internal refuses — that is raw egress, not mediation', async () => {
  const { run } = runner({ inspect: () => 'sha256:net|bridge|false|172.30.0.1' });
  await assert.rejects(
    () => ensureEgressNetwork({ name: 'shared', run }),
    /is NOT internal/);
});

test('a network with no gateway refuses — the mediator has nothing to bind', async () => {
  const { run } = runner({ inspect: () => 'sha256:net|bridge|true|' });
  await assert.rejects(
    () => ensureEgressNetwork({ name: 'compact-egress', run }),
    /no gateway address/);
});

test('an inspect failure that is not "no such network" refuses with its reason (never a blind create)', async () => {
  const { run } = runner({ inspect: () => { throw new Error('error during connect: daemon not running'); } });
  await assert.rejects(
    () => ensureEgressNetwork({ name: 'compact-egress', run }),
    /cannot inspect the mediation network.*daemon not running/);
});

test('an unprovisionable network refuses the boot, named (D-7)', async () => {
  const { run } = runner({
    inspect: INSPECT_MISSING,
    create: () => { throw new Error('permission denied while creating network'); },
  });
  await assert.rejects(
    () => ensureEgressNetwork({ name: 'compact-egress', run }),
    /cannot provision the internal mediation network.*permission denied/);
});
