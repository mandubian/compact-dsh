// Pure provider logic: argv construction per mode, mount-grant binds at
// ceiling, masked-path over-mounts, and fail-closed unavailability. No
// daemon touched — the probe is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { DockerSandboxProvider, DENIAL_SIGNATURES, RUNNER_FAILURE_RULES, SANDBOX_UNAVAILABLE } from '../src/provider.js';
import { mountGrantsFor, DEFAULT_SENSITIVE_PATHS } from '../src/mounts.js';
import { GrantStore } from 'compact-dsh-approval';

// CF-2: every provider needs a declared, digest-keyed acquisition history for
// the image it runs, so these fixtures ride along with every construction. The
// digest resolver is injected exactly like the probe — no daemon is touched.
const TEST_DIGEST = 'sha256:' + 'a'.repeat(64);
const TEST_PROVENANCE = [{
  ref: 'ubuntu:24.04', digest: TEST_DIGEST, attestation: 'build-recorded',
  buildApprovals: { hosts: ['archive.ubuntu.com'], paths: [] },
}];

// The provider is a Cordis Service: construct it against a bare real Context
// (no plugins needed — the service base only registers the instance).
function makeProvider(config = {}) {
  return new DockerSandboxProvider(new Context(), {
    probe: () => ({ ok: true }),
    imageProvenance: TEST_PROVENANCE,
    digestResolver: () => ({ ok: true, digest: TEST_DIGEST }),
    ...config,
  });
}

const POLICY = (mode, root, sessionId) => ({ mode, workspaceRoot: root, sessionId });

test('read-only: workspace bound ro, read-only rootfs, no network, no tmpfs', () => {
  const p = makeProvider({ image: 'ubuntu:24.04' });
  const c = p.confine(['bash', '-c', 'ls'], POLICY('read-only', '/ws'));
  const s = c.argv.join(' ');
  assert.ok(s.includes('run --rm'), 'per-call container');
  assert.ok(s.includes('--network none'), 'no-network default');
  assert.ok(s.includes('--read-only'), 'read-only rootfs');
  assert.ok(s.includes('type=bind,source=/ws,target=/ws,readonly'), 'workspace ro');
  assert.ok(!s.includes('--tmpfs'), 'read-only mode has no writable temp area');
  assert.equal(c.enforcement, 'full');
  assert.equal(c.argv.at(-3), 'bash');
  assert.deepEqual(c.denialSignatures, DENIAL_SIGNATURES);
  assert.deepEqual(c.runnerFailureRules, RUNNER_FAILURE_RULES);
});

test('workspace-write: workspace rw + tmpfs temp area, still no network', () => {
  const p = makeProvider({});
  const c = p.confine(['bash', '-c', 'make'], POLICY('workspace-write', '/ws'));
  const s = c.argv.join(' ');
  assert.ok(s.includes('type=bind,source=/ws,target=/ws '), 'workspace rw');
  assert.ok(s.includes('--tmpfs /tmp:rw'), 'backend temp area');
  assert.ok(s.includes('--network none'));
});

test('mount grants become binds at their granted ceiling — ro never upgrades', () => {
  const store = new GrantStore();
  store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/data', ceiling: 'ro' } }, root: 'sess-1', session: 'sess-1', ttlMs: 60_000, now: 1 });
  store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/models', ceiling: 'rw' } }, root: 'sess-1', session: 'sess-1', ttlMs: 60_000, now: 1 });
  store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/other', ceiling: 'ro' } }, root: 'sess-9', session: 'sess-9', ttlMs: 60_000, now: 1 });
  const p = makeProvider({ grantsFor: (sid) => mountGrantsFor(store, sid, 2) });
  const c = p.confine(['cat', '/data/x'], POLICY('read-only', '/ws', 'sess-1'));
  const s = c.argv.join(' ');
  assert.ok(s.includes('type=bind,source=/data,target=/data,readonly'), 'ro grant → ro bind');
  assert.ok(s.includes('type=bind,source=/models,target=/models '), 'rw grant → rw bind');
  assert.ok(!s.includes('/other'), 'another session\'s grants are not mounted');
});

test('revoked or expired grants never reach the container', () => {
  const store = new GrantStore();
  const live = store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/live', ceiling: 'ro' } }, root: 'sess-1', session: 'sess-1', ttlMs: 60_000, now: 1 });
  const dead = store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/dead', ceiling: 'ro' } }, root: 'sess-1', session: 'sess-1', ttlMs: 60_000, now: 1 });
  store.revokeSessionGrant(dead.id, 2);
  const stale = store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/stale', ceiling: 'ro' } }, root: 'sess-1', session: 'sess-1', ttlMs: 10, now: 1 });
  const p = makeProvider({ grantsFor: (sid) => mountGrantsFor(store, sid, 100) });
  const s = p.confine(['true'], POLICY('read-only', '/ws', 'sess-1')).argv.join(' ');
  assert.ok(s.includes('type=bind,source=/live,target=/live,readonly'), 'the live grant IS mounted');
  assert.ok(!s.includes('/dead'), 'the revoked grant is never mounted');
  assert.ok(!s.includes('/stale'), 'the expired grant (ttl 10ms at t=100) is never mounted');
});

test('the sensitive-path deny-list over-mounts masked paths under bound roots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-mask-'));
  mkdirSync(join(dir, '.ssh'));
  writeFileSync(join(dir, '.netrc'), 'secret');
  const p = makeProvider({ maskedPaths: [join(dir, '.ssh'), join(dir, '.netrc')] });
  const s = p.confine(['true'], POLICY('workspace-write', dir, 'sess-1')).argv.join(' ');
  assert.ok(s.includes(`type=tmpfs,destination=${join(dir, '.ssh')}`), 'masked dir → tmpfs over-mount');
  assert.ok(s.includes(`type=bind,source=/dev/null,target=${join(dir, '.netrc')},readonly`), 'masked file → /dev/null over-mount');
});

test('masked paths outside every bound root are skipped (invisible by construction)', () => {
  const p = makeProvider({ maskedPaths: ['/somewhere/else'] });
  const s = p.confine(['true'], POLICY('read-only', '/ws', 'sess-1')).argv.join(' ');
  assert.ok(!s.includes('/somewhere/else'));
});

test('the Enforcer\'s own state is on the default deny-list (I-2, D-8)', () => {
  // the compact state dir at its default location must be masked in every
  // confined call and unreachable by mount grants — a Subject that can write
  // the grant store or the chain sidecars can rewrite its own record
  assert.ok(DEFAULT_SENSITIVE_PATHS.some(p => p.endsWith('/.compact-dsh')),
    'DEFAULT_SENSITIVE_PATHS must include the compact state dir');
});

test('secret injection: a live grant puts -e REF=value in the confine argv; no grant, no env', () => {
  process.env.SB_TEST_TOKEN = 'sb-value-123';
  try {
    const granted = makeProvider({ secretsFor: () => [{ ref: 'SB_TEST_TOKEN' }] });
    const withSecret = granted.confine(['true'], POLICY('read-only', '/ws', 'sess-1')).argv.join(' ');
    assert.ok(withSecret.includes('--env SB_TEST_TOKEN=sb-value-123'), 'the granted ref is injected');

    const empty = makeProvider({});
    const without = empty.confine(['true'], POLICY('read-only', '/ws', 'sess-1')).argv.join(' ');
    assert.ok(!without.includes('SB_TEST_TOKEN'), 'the absent-capability posture injects nothing');
  } finally {
    delete process.env.SB_TEST_TOKEN;
  }
});

test('a granted ref missing from the Enforcer environment is skipped, never invented', () => {
  delete process.env.SB_TEST_MISSING;
  const p = makeProvider({ secretsFor: () => [{ ref: 'SB_TEST_MISSING' }] });
  const s = p.confine(['true'], POLICY('read-only', '/ws', 'sess-1')).argv.join(' ');
  assert.ok(!s.includes('SB_TEST_MISSING'), 'fail-visible: the command fails on the empty variable instead');
});

test('fail-closed: daemon unavailable throws SANDBOX_UNAVAILABLE, never passthrough', () => {
  const p = new DockerSandboxProvider(new Context(), { imageProvenance: TEST_PROVENANCE, digestResolver: () => ({ ok: true, digest: TEST_DIGEST }), probe: () => ({ ok: false, detail: 'docker info exited 1: boom' }) });
  assert.throws(() => p.confine(['bash', '-c', 'ls'], POLICY('read-only', '/ws')), (e) => {
    assert.ok(e instanceof Error);
    assert.ok(String(e.message).includes('boom') || String(e.code ?? '').includes('SANDBOX') || String(e).includes('SANDBOX'),
      'the failure names the unavailability — got: ' + e);
    return true;
  });
  // the probe verdict is cached: one probe per provider lifetime
  let probed = 0;
  const p2 = new DockerSandboxProvider(new Context(), { imageProvenance: TEST_PROVENANCE, digestResolver: () => ({ ok: true, digest: TEST_DIGEST }), probe: () => { probed += 1; return { ok: true }; } });
  p2.confine(['true'], POLICY('read-only', '/ws'));
  p2.confine(['true'], POLICY('read-only', '/ws'));
  assert.equal(probed, 1);
});
