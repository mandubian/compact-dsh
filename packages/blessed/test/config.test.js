import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveConfig } = await import('../src/index.js');

const IMAGE_DIGEST = 'sha256:' + 'a'.repeat(64);
const BASE = () => ({
  approval: { persistPath: '/state/approvals.json' },
  sandbox: { image: 'ubuntu:24.04', imageProvenance: [{ ref: 'ubuntu:24.04', digest: IMAGE_DIGEST, attestation: 'operator-declared' }] },
  protectedState: ['/state/sessions', '/state/chains', '/state/approvals.json'],
});

test('a composition that cannot name its protected Enforcer state refuses to start (F-5, D-8)', () => {
  for (const missing of [undefined, null, []]) {
    const config = BASE();
    if (missing === undefined) delete config.protectedState; else config.protectedState = missing;
    assert.throws(() => resolveConfig(config), /protectedState[\s\S]*rewrite its own record[\s\S]*refusing to start/);
  }
});

test('the Enforcer state is FORCED into the sandbox masks and the mount-grant protected list', () => {
  const resolved = resolveConfig(BASE());
  for (const p of ['/state/sessions', '/state/chains', '/state/approvals.json']) {
    assert.ok(resolved.sandbox.maskedPaths.includes(p), `maskedPaths must cover ${p} — a confined Subject must not reach it`);
    assert.ok(resolved.sandbox.protectedPaths.includes(p), `protectedPaths must cover ${p} — a mount grant must never name it`);
  }
});

test('operator-declared masks survive the merge alongside the state paths', () => {
  const config = BASE();
  config.sandbox.maskedPaths = ['/extra/secret'];
  const resolved = resolveConfig(config);
  assert.ok(resolved.sandbox.maskedPaths.includes('/extra/secret'));
  assert.ok(resolved.sandbox.maskedPaths.includes('/state/chains'));
});

test('blank state paths are rejected rather than canonicalized into junk', () => {
  const config = BASE();
  config.protectedState = ['/state/sessions', '  '];
  assert.throws(() => resolveConfig(config), /protectedState entry/);
});

test('a mistyped mask list fails loudly instead of spreading into character junk', () => {
  for (const key of ['maskedPaths', 'protectedPaths']) {
    const config = BASE();
    config.sandbox[key] = '/extra/secret';
    assert.throws(() => resolveConfig(config), new RegExp(`sandbox\\.${key} must be an array`));
    const nested = BASE();
    nested.sandbox[key] = { path: '/x' };
    assert.throws(() => resolveConfig(nested), new RegExp(`sandbox\\.${key} must be an array`));
  }
});
