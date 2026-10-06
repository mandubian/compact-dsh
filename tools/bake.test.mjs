// The compact:bake tests (#155): the DERIVATION is pinned byte for byte (pure
// function, no daemon), the refusals teach (never pulled, never an identical
// image, no free-form text in the Dockerfile), and — behind the env-flag
// pattern, only where a local daemon and the base image exist — the whole
// operator act runs for real: one command turns a workspace venv into a
// running, digested image whose label carries base digest + workspace +
// timestamp, and whose printed pair boots the composition (--smoke-style).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectArtifacts, deriveBakefile, freezeRequirements, bake, USAGE } from './bake.mjs';

const DIGEST = 'sha256:' + 'ab'.repeat(32);
const CREATED = '2026-10-06T09:00:00.000Z';

// -- the Dockerfile derivation (pure, pinned) ---------------------------------

test('deriveBakefile: the provenance chain is stamped as labels (base digest, workspace, timestamp)', () => {
  const df = deriveBakefile({ base: 'compact-tools:py', baseDigest: DIGEST, workspace: '/srv/proj', created: CREATED, packages: ['jq'], withVenv: false });
  assert.ok(df.startsWith('# compact-dsh baked toolchain image'), 'the header names the act and its doctrine');
  assert.ok(df.includes('# Base: compact-tools:py at ' + DIGEST));
  assert.ok(df.includes(`FROM compact-tools:py`));
  assert.match(df, new RegExp(`LABEL org\\.opencontainers\\.image\\.base\\.digest="${DIGEST}"`));
  assert.match(df, /org\.opencontainers\.image\.created="2026-10-06T09:00:00\.000Z"/);
  assert.match(df, /org\.compact\.workspace="\/srv\/proj"/);
  assert.match(df, /org\.compact\.base\.image="compact-tools:py"/);
});

test('deriveBakefile: system packages ride apt, venvs are translated to a fresh /opt/compact-venv on PATH', () => {
  const df = deriveBakefile({
    base: 'ubuntu:24.04', baseDigest: DIGEST, workspace: '/srv/proj', created: CREATED,
    packages: ['jq', 'python3-venv'], withVenv: true,
  });
  assert.match(df, /RUN apt-get update && apt-get install -y --no-install-recommends jq python3-venv && rm -rf \/var\/lib\/apt\/lists\//);
  assert.match(df, /COPY compact-requirements\.txt \/tmp\/compact-requirements\.txt/);
  assert.match(df, /RUN python3 -m venv \/opt\/compact-venv/);
  assert.match(df, /\/opt\/compact-venv\/bin\/pip install --no-cache-dir -r \/tmp\/compact-requirements\.txt/);
  assert.match(df, /ENV PATH="\/opt\/compact-venv\/bin:\$\{PATH\}"/);
  assert.ok(df.indexOf('apt-get') < df.indexOf('COPY bin/') || !df.includes('COPY bin/'), 'system packages land before any COPY');
});

test('deriveBakefile: ./bin/ is relocated to the system PATH, never to the shadowed workspace path', () => {
  const df = deriveBakefile({ base: 'ubuntu:24.04', baseDigest: DIGEST, workspace: '/srv/proj', created: CREATED, includeBin: true });
  assert.match(df, /COPY bin\/ \/usr\/local\/bin\//);
  assert.ok(!df.includes('/srv/proj/bin'), 'nothing is baked to the workspace path — the runtime bind-mounts over it');
  assert.ok(!df.includes('compact-requirements.txt'), 'no venv, no requirements file');
  assert.ok(!df.includes('/opt/compact-venv'), 'no venv, no baked venv');
});

test('deriveBakefile refuses: a bad base, a non-digest, and free-form text in the package list', () => {
  const ok = { workspace: '/w', created: CREATED };
  assert.throws(() => deriveBakefile({ ...ok, base: 'bad image;rm -rf', baseDigest: DIGEST }), /not a Docker image reference/);
  assert.throws(() => deriveBakefile({ ...ok, base: 'ubuntu:24.04', baseDigest: 'latest' }), /sha256 image digest/);
  assert.throws(() => deriveBakefile({ ...ok, base: 'ubuntu:24.04', baseDigest: DIGEST, packages: ['jq && rm -rf /'] }), /refuses free-form text/);
});

// -- artifact detection and the freeze ----------------------------------------

function makeWorkspace({ venv = '.venv', venvPip = true, bin = [] } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'compact-bake-ws-'));
  if (venv) {
    mkdirSync(join(ws, venv, 'bin'), { recursive: true });
    if (venvPip) writeFileSync(join(ws, venv, 'bin', 'pip'), '#!/bin/sh\necho frozen');
  }
  if (bin.length > 0) {
    mkdirSync(join(ws, 'bin'), { recursive: true });
    for (const f of bin) writeFileSync(join(ws, 'bin', f), 'binary');
  }
  return ws;
}

test('detectArtifacts: .venv wins over venv; an empty bin/ is not an artifact', () => {
  const withBoth = makeWorkspace({ venv: 'venv' });
  mkdirSync(join(withBoth, '.venv', 'bin'), { recursive: true });
  assert.equal(detectArtifacts({ workspace: withBoth }).venvName, '.venv', '.venv is the taught name and wins');

  const emptyBin = makeWorkspace({ venv: null });
  mkdirSync(join(emptyBin, 'bin'), { recursive: true });
  const a = detectArtifacts({ workspace: emptyBin });
  assert.equal(a.venv, null);
  assert.equal(a.bin, null, 'an empty ./bin/ promotes nothing');

  const full = makeWorkspace({ venv: '.venv', bin: ['jq'] });
  const b = detectArtifacts({ workspace: full });
  assert.ok(b.venv.endsWith('/.venv') && b.bin.endsWith('/bin'));
});

test('freezeRequirements: through the venv\'s OWN pip, never the host\'s — and a pip-less venv refuses with the cure', () => {
  let called = null;
  const reqs = freezeRequirements({
    venvDir: '/ws/.venv',
    exists: (p) => p === '/ws/.venv/bin/pip',
    run: (args) => { called = args; return { status: 0, stdout: 'requests==2.31.0\n' }; },
  });
  assert.equal(called[0], '/ws/.venv/bin/pip', 'the venv\'s own pip ran');
  assert.deepEqual(reqs, ['requests==2.31.0']);

  const reqs3 = freezeRequirements({
    venvDir: '/ws/.venv',
    exists: (p) => p === '/ws/.venv/bin/pip3',
    run: () => ({ status: 0, stdout: '' }),
  });
  assert.deepEqual(reqs3, []);

  assert.throws(() => freezeRequirements({ venvDir: '/ws/none', exists: () => false, run: () => ({ status: 0, stdout: '' }) }),
    /carries no pip.*python3 -m venv \.venv/, 'the refusal names the cure');
});

// -- the orchestrator: refusals and the minimal context ------------------------

// The io fixture: REAL filesystem (detection, writes, copies are honest), and
// only the daemon-facing edges stubbed. The workspace fixtures are real
// directories under tmpdir().
const IO = (over = {}) => ({
  inspect: ({ ref }) => ref === 'ubuntu:24.04' || ref === 'compact-baked:test' ? { ok: true, digest: DIGEST } : { ok: false, detail: 'not found' },
  build: () => ({ status: 0, stderr: '' }),
  freeze: () => ['requests==2.31.0'],
  now: () => new Date(CREATED),
  mkctx: () => mkdtempSync(join(tmpdir(), 'compact-bake-ctx-')),
  exists: (p) => existsSync(p),
  list: (p) => readdirSync(p),
  write: (p, c) => writeFileSync(p, c),
  copy: (a, b) => cpSync(a, b),
  stat: (p) => ({ isFile: () => !p.endsWith('sub') }),
  ...over,
});

test('bake refuses the dishonest moves: no base, an absent base, and an image identical to its base', async () => {
  await assert.rejects(() => bake({}), /usage: npm run compact:bake/);
  await assert.rejects(() => bake({ base: 'not-local:1', io: IO() }),
    /bake never pulls; run docker pull not-local:1 yourself/, 'the pull is the operator\'s act');
  const empty = mkdtempSync(join(tmpdir(), 'compact-bake-empty-'));
  await assert.rejects(() => bake({ base: 'ubuntu:24.04', workspace: empty, io: IO() }),
    /nothing to promote.*identical to its base/, 'an image identical to its base promotes nothing');
});

test('bake: the minimal context — Dockerfile + requirements + bin/ only, the workspace itself never rides', async () => {
  const ws = makeWorkspace({ venv: '.venv', bin: ['jq', 'notes.txt', 'sub'] });
  const out = await bake({
    base: 'ubuntu:24.04', workspace: ws, tag: 'compact-baked:test',
    io: IO({ list: (p) => (p === join(ws, 'bin')) ? ['jq', 'notes.txt', 'sub'] : readdirSync(p) }),
  });
  const ctx = out.context;
  assert.ok(existsSync(join(ctx, 'Dockerfile')));
  assert.equal(readFileSync(join(ctx, 'Dockerfile'), 'utf8'), out.dockerfile, 'the built Dockerfile is the derived one');
  assert.ok(existsSync(join(ctx, 'compact-requirements.txt')), 'the freeze rides as a file');
  assert.deepEqual(readdirSync(join(ctx, 'bin')), ['jq', 'notes.txt'], 'only FILES from ./bin/ are copied — no directories');
  assert.ok(!existsSync(join(ctx, '.venv')), 'the venv is translated, never copied');
  assert.ok(!existsSync(join(ws, '.venv', 'stolen')), 'nothing writes back into the workspace');
  assert.equal(out.digest, DIGEST);
  assert.equal(out.tag, 'compact-baked:test');
});

test('bake --dry-run: the exact Dockerfile, nothing built, no daemon writes', async () => {
  const ws = makeWorkspace({ venv: '.venv' });
  let built = 0;
  const out = await bake({
    base: 'ubuntu:24.04', workspace: ws, dryRun: true,
    io: IO({ build: () => { built += 1; return { status: 0, stderr: '' }; } }),
  });
  assert.equal(built, 0, 'dry-run builds nothing');
  assert.equal(out.digest, null);
  assert.equal(out.context, null, 'dry-run creates no build context');
  assert.match(out.dockerfile, /FROM ubuntu:24\.04/);
});

test('bake: a failed build keeps the context and names it (the operator inspects, not guesses)', async () => {
  const ws = makeWorkspace({ venv: '.venv' });
  await assert.rejects(() => bake({
    base: 'ubuntu:24.04', workspace: ws,
    io: IO({ build: () => ({ status: 1, stderr: 'ERROR: base image python3 not found\nDONE\n' }) }),
  }), /docker build failed.*context kept at .*python3 not found/s);
});

// -- the whole act, for real: build, digest, labels, and the smoke boot --------
// Two live tiers, both skipping BY NAME where their preconditions are absent:
//   - the offline bake (./bin/ promotion) needs only the local daemon — it
//     runs anywhere docker and the base image exist (CI pulls the base);
//   - the full promotion (venv freeze re-installed, system packages) needs
//     the daemon to have egress for apt/pip — the existing env-flag pattern
//     (test:live, dist-probe): it runs only where an operator ASKED for it
//     (`npm run test:bake`).

function dockerAndBase() {
  if (spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 10_000 }).status !== 0) return 'no reachable docker daemon';
  if (spawnSync('docker', ['image', 'inspect', 'ubuntu:24.04'], { encoding: 'utf8', timeout: 10_000 }).status !== 0) return 'the ubuntu:24.04 image is not local (bake never pulls)';
  return true;
}

function labelsOf(tag) {
  return (fmt) => spawnSync('docker', ['image', 'inspect', '--format', fmt, tag], { encoding: 'utf8', timeout: 15_000 }).stdout.trim();
}

function smokeBoots(tag, digest, ws) {
  // the printed pair boots the composition cleanly — the --smoke-style proof
  const state = mkdtempSync(join(tmpdir(), 'compact-bake-state-'));
  const boot = spawnSync('node', [join(process.cwd(), 'tools', 'compact-dsh.mjs'), '--smoke'], {
    encoding: 'utf8', timeout: 300_000,
    cwd: ws,
    env: { ...process.env, COMPACT_STATE_DIR: state, COMPACT_WORKSPACE: ws, COMPACT_SANDBOX_IMAGE: tag, COMPACT_SANDBOX_IMAGE_DIGEST: digest },
  });
  assert.equal(boot.status, 0, 'the smoke boot refuses nothing — ' + (boot.stderr || boot.stdout).slice(0, 400));
  assert.match(boot.stdout + boot.stderr, /ready \(smoke/, 'the composition reports ready on the baked pair');
}

/** Whether this checkout can load the composition at all — the strict pnpm
 *  layout (the wrinkle) leaves workspace siblings unresolvable; the hoisted
 *  CI install resolves them. The smoke proof runs where the composition can
 *  boot, and says so where it cannot. */
function compositionResolvableHere() {
  const probe = spawnSync(process.execPath, ['-e', "import('compact-dsh-blessed').then(() => process.exit(0), () => process.exit(1))"], { encoding: 'utf8', cwd: process.cwd(), timeout: 60_000 });
  return probe.status === 0 ? true
    : 'this checkout cannot load the composition (strict workspace layout — the pnpm-workspace wrinkle); the smoke-boot proof runs on a hoisted install (CI)';
}

test('live, offline: a workspace ./bin/ bakes into a digested image — labels visible, tool runs, the pair boots', { skip: dockerAndBase() === true ? false : dockerAndBase() }, async (t) => {
  const ws = mkdtempSync(join(tmpdir(), 'compact-bake-live-'));
  mkdirSync(join(ws, 'bin'), { recursive: true });
  writeFileSync(join(ws, 'bin', 'bake-probe'), '#!/bin/sh\necho baked-tool-ran\n');
  chmodSync(join(ws, 'bin', 'bake-probe'), 0o755);

  const tag = 'compact-baked:live-offline';
  const out = await bake({ base: 'ubuntu:24.04', workspace: ws, tag });
  try {
    assert.match(out.digest, /^sha256:[0-9a-f]{64}$/, 'the digest is derived the way the runtime derives digests (.Id)');
    const label = labelsOf(tag);
    assert.equal(label('{{index .Config.Labels "org.compact.workspace"}}'), ws, 'the label names the workspace');
    assert.equal(label('{{index .Config.Labels "org.opencontainers.image.base.digest"}}'), out.baseDigest, 'the label names the base digest');
    assert.match(label('{{index .Config.Labels "org.opencontainers.image.created"}}'), /^\d{4}-\d{2}-\d{2}T/, 'the label names the timestamp');
    const probe = spawnSync('docker', ['run', '--rm', '--network', 'none', tag, '/usr/local/bin/bake-probe'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(probe.stdout.trim(), 'baked-tool-ran', 'the promoted tool runs inside the image — no network, exactly an act\'s posture');
    const resolvable = compositionResolvableHere();
    if (resolvable !== true) t.skip(resolvable);
    smokeBoots(tag, out.digest, ws);
  } finally {
    spawnSync('docker', ['rmi', '-f', tag], { encoding: 'utf8', timeout: 60_000 });
    rmSync(ws, { recursive: true, force: true });
  }
});

function bakeEgressReady() {
  if (process.env.COMPACT_BAKE_TEST !== '1') return 'opt-in only: run npm run test:bake (the real build needs the daemon to have egress for apt/pip)';
  const base = dockerAndBase();
  if (base !== true) return base;
  if (spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 10_000 }).status !== 0) return 'no host python3 to make a venv from';
  return true;
}

test('live, full: a workspace venv is promoted — re-installed at /opt/compact-venv, on PATH — and the pair boots', { skip: bakeEgressReady() === true ? false : bakeEgressReady() }, async () => {
  // the workspace: a real venv (its freeze feeds the baked venv) and a bin/ tool
  const ws = mkdtempSync(join(tmpdir(), 'compact-bake-live-'));
  spawnSync('python3', ['-m', 'venv', join(ws, '.venv')], { encoding: 'utf8', timeout: 60_000 });
  mkdirSync(join(ws, 'bin'), { recursive: true });
  writeFileSync(join(ws, 'bin', 'bake-probe'), '#!/bin/sh\necho baked-tool-ran\n');
  chmodSync(join(ws, 'bin', 'bake-probe'), 0o755);

  const tag = 'compact-baked:live-test';
  const out = await bake({ base: 'ubuntu:24.04', workspace: ws, tag, packages: ['python3', 'python3-venv'] });
  try {
    assert.match(out.digest, /^sha256:[0-9a-f]{64}$/, 'the digest is derived the way the runtime derives digests (.Id)');
    const label = labelsOf(tag);
    assert.equal(label('{{index .Config.Labels "org.compact.workspace"}}'), ws, 'the label names the workspace');
    assert.equal(label('{{index .Config.Labels "org.opencontainers.image.base.digest"}}'), out.baseDigest, 'the label names the base digest');

    // the baked toolchain actually runs — with NO network, exactly an act's posture
    const probe = spawnSync('docker', ['run', '--rm', '--network', 'none', tag, '/usr/local/bin/bake-probe'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(probe.stdout.trim(), 'baked-tool-ran', 'the promoted ./bin/ tool runs inside the image');
    const venvBin = spawnSync('docker', ['run', '--rm', '--network', 'none', tag, 'which', 'pip'], { encoding: 'utf8', timeout: 60_000 });
    assert.match(venvBin.stdout.trim(), /^\/opt\/compact-venv\/bin\/pip$/, 'the baked venv is on PATH');
    smokeBoots(tag, out.digest, ws);
  } finally {
    spawnSync('docker', ['rmi', '-f', tag], { encoding: 'utf8', timeout: 60_000 });
    rmSync(ws, { recursive: true, force: true });
  }
});
