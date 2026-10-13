// #199 — the boot's workspace declaration for the trial path. The launcher
// declares the governed directory by chdir'ing before composition; the
// bundle gets the same power as a blessed config key, mapped from
// COMPACT_WORKSPACE by the posture patch. The declaration is validated like
// --workspace (exists, is a directory) and written into the sandbox policy
// BEFORE the boot reads it — so the anchor (#18), the honesty line (#17),
// and the container bind all name what the operator declared.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig, declareWorkspaceRoot } from '../src/index.js';

test('resolveConfig: the workspace key passes through; malformed forms are refused; unknown keys still are too', () => {
  const config = {
    approval: { persistPath: '/tmp/x.json' },
    sandbox: { image: 'ubuntu:24.04', imageProvenance: [{ ref: 'ubuntu:24.04', digest: 'sha256:' + '0'.repeat(64), attestation: 'operator-declared' }] },
    protectedState: ['/tmp/state'],
    workspace: { root: '/tmp/night-shift' },
  };
  assert.deepEqual(resolveConfig(config).workspace, { root: '/tmp/night-shift' });
  assert.throws(() => resolveConfig({ ...config, workspace: { root: '' } }),
    /workspace\.root must be an explicit non-empty string/, 'an empty declaration is the false answer');
  assert.throws(() => resolveConfig({ ...config, workspace: '/tmp/night-shift' }),
    /workspace must be a JSON object/);
  assert.throws(() => resolveConfig({ ...config, workspaceKludge: {} }),
    /unknown config key/, 'the closed key set holds');
});

test('declareWorkspaceRoot: the policy names the realpath of the declared directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blessed-ws-'));
  const policy = { workspaceRoot: '/inherited/from/the/process' };
  const declared = declareWorkspaceRoot(policy, dir);
  assert.equal(policy.workspaceRoot, declared, 'the declaration is written before the boot reads it');
  assert.equal(declared, dir, 'a plain tmp dir is its own realpath');
  rmSync(dir, { recursive: true });
});

test('declareWorkspaceRoot: a missing directory refuses the boot with the named error', () => {
  const policy = { workspaceRoot: '/inherited' };
  assert.throws(
    () => declareWorkspaceRoot(policy, '/tmp/definitely-not-here-9999'),
    /workspace\.root "\/tmp\/definitely-not-here-9999" does not exist/,
    'a declaration of nothing is the false answer — refuse loudly');
  assert.equal(policy.workspaceRoot, '/inherited', 'a refused declaration changes nothing');
});

test('declareWorkspaceRoot: a file is not a directory; symlinks canonicalize', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blessed-ws-'));
  const file = join(dir, 'a-file');
  writeFileSync(file, 'x');
  const policy = { workspaceRoot: '/inherited' };
  assert.throws(() => declareWorkspaceRoot(policy, file), /is not a directory/);
  assert.equal(policy.workspaceRoot, '/inherited');

  const link = join(dir, 'a-link');
  mkdirSync(join(dir, 'real'));
  symlinkSync(join(dir, 'real'), link);
  assert.equal(declareWorkspaceRoot(policy, link), join(dir, 'real'),
    'a symlinked declaration canonicalizes — the same form every anchor comparison uses');
  rmSync(dir, { recursive: true, force: true });
});
