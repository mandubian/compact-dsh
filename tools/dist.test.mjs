// The distribution packer's own tests (#140): the artifact must carry the
// whole closure, its patches must be byte-faithful apart from the module-
// resolving row rewrites, and — under COMPACT_DIST_LIVE_TEST=1, the way the
// web UI's plugin manager would install it — a real `pnpm add` of the
// tarball into a scratch profile must leave every `compact-*` import in the
// graph resolvable and loadable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'dist.mjs');

const pack = (outDir) => execFileSync('node', [TOOL, '--out', outDir], { encoding: 'utf8' }).trim();

const workspaceNames = () => readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'packages', e.name, 'package.json')))
  .map((e) => JSON.parse(readFileSync(join(ROOT, 'packages', e.name, 'package.json'), 'utf8')).name);

test('the artifact carries the whole closure — every workspace package, bundled, externals hoisted', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-dist-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tarball = pack(dir);
  assert.match(tarball, /compact-dsh-\d+\.\d+\.\d+\.tgz$/);

  const staged = join(dir, 'package');
  const manifest = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'));
  assert.deepEqual(
    manifest.bundleDependencies,
    workspaceNames().sort(),
    'the bundle root must carry every workspace package as a bundled dependency',
  );
  for (const name of manifest.bundleDependencies) {
    assert.ok(manifest.dependencies[name], `${name} must also appear in dependencies`);
    assert.doesNotMatch(manifest.dependencies[name], /^file:/, `${name} must be bundled, not a file: spec (pnpm resolves file: against the installer's dir)`);
  }
  for (const [name] of Object.entries(manifest.dependencies)) {
    if (!manifest.bundleDependencies.includes(name)) assert.match(name, /^@deepseek-ai\//, `external dep ${name} is unexpected — the artifact's registry surface is dsh packages only`);
  }
  assert.deepEqual(manifest.peerDependencies, { '@deepseek-ai/dsh': '~0.2.0-rc.2' });
  assert.deepEqual(manifest.dsh.bundle.patch, [
    './patches/blessed.patch.yml',
    './patches/card.patch.yml',
    './patches/posture.patch.yml',
    './patches/compact-pilot.patch.yml',
  ]);
  assert.ok(manifest.dsh.client, 'the bundle root must carry the ask card client manifest');

  for (const name of workspaceNames()) {
    const vendored = JSON.parse(readFileSync(join(staged, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(vendored.name, name);
    assert.equal(vendored.dependencies, undefined, `vendored ${name} must not declare dependencies — the bundle root owns them`);
  }

  // every file the exports map names must exist in the staged tree
  for (const target of Object.values(manifest.exports)) {
    if (target === './package.json') continue;
    assert.ok(existsSync(join(staged, target)), `exports target ${target} missing from the staged tree`);
  }
  assert.match(tarball, /\.tgz$/);
});

test('an unwired composition refuses to pack — an unreachable package is not an optimization', async (t) => {
  const { workspacePackages, dependencyClosure } = await import(pathToFileURL(TOOL));
  const dir = mkdtempSync(join(tmpdir(), 'compact-dist-closure-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mk = (name, deps = {}) => {
    const pkgDir = join(dir, name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: '0.0.0', dependencies: deps }));
  };
  mk('compact-dsh-blessed', { 'compact-envelope': '0.1.0' });
  mk('compact-envelope');
  mk('compact-dsh-orphan');
  const workspaces = workspacePackages(dir);
  assert.throws(() => dependencyClosure(workspaces, ['compact-dsh-blessed']), /unreachable.*compact-dsh-orphan/);
});

test('patch copies are byte-faithful apart from exactly the module-resolving row rewrites', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-dist-patch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  pack(dir);
  const staged = join(dir, 'package');

  const cases = [
    { source: join(ROOT, 'packages', 'blessed', 'cordis.patch.yml'), copy: join(staged, 'patches', 'blessed.patch.yml'), rewrites: 2, from: ['compact-dsh-blessed', 'compact-dsh-record/provider'], to: ['compact-dsh', 'compact-dsh/provider'] },
    { source: join(ROOT, 'packages', 'card', 'cordis.patch.yml'), copy: join(staged, 'patches', 'card.patch.yml'), rewrites: 1, from: ['compact-dsh-card'], to: ['compact-dsh/card'] },
  ];
  for (const { source, copy, rewrites, from, to } of cases) {
    const before = readFileSync(source, 'utf8').split('\n');
    const after = readFileSync(copy, 'utf8').split('\n');
    assert.equal(before.length, after.length, `${copy} must not gain or lose lines`);
    const changed = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i] === after[i]) continue;
      changed.push({ line: i + 1, before: before[i], after: after[i] });
      const hit = from.findIndex((name) => before[i].includes(`name: ${name}`));
      assert.ok(hit !== -1, `${copy}:${i + 1} changed a line that names no module: ${JSON.stringify(before[i])}`);
      assert.equal(after[i], before[i].replace(`name: ${from[hit]}`, `name: ${to[hit]}`));
    }
    assert.equal(changed.length, rewrites, `${copy} must rewrite exactly ${rewrites} row(s), saw ${changed.length}`);
  }
});

test('the tarball ships the payload: patches, vendored sources, client bundle, root manifest', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-dist-tar-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tarball = pack(dir);
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
  for (const member of [
    'package/package.json',
    'package/patches/blessed.patch.yml',
    'package/patches/card.patch.yml',
    'package/patches/posture.patch.yml',
    'package/patches/compact-pilot.patch.yml',
    'package/node_modules/compact-dsh-blessed/src/index.js',
    'package/node_modules/compact-dsh-record/src/provider.js',
    'package/node_modules/compact-dsh-card/lib/client.js',
    'package/node_modules/compact-dsh-blessed/presets/',
  ]) assert.ok(listing.includes(member), `tarball lacks ${member}`);

  // the served client copy must self-register under the SERVED name: the
  // bundle's __ModuleLoader__.load({ id }) is embedded at build time, and a
  // copy that still registers as compact-dsh-card loads without registering
  // compact-dsh — the browser then reports the module as failed
  const servedClient = readFileSync(join(dir, 'package', 'client.js'), 'utf8');
  assert.equal(servedClient.split("id: 'compact-dsh'").length, 2, 'the served client must register exactly once, as compact-dsh');
  assert.ok(!servedClient.includes("id: 'compact-dsh-card'"), 'the served client must not carry the source package registration id');
});

test('the posture layer refuses the profile-gated re-arm surfaces and defaults state under the profile — while declaring, not hiding, the plugin-manager gap', async (t) => {
  const { loadOverlayPatches } = await import('file://' + join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'));
  const dir = mkdtempSync(join(tmpdir(), 'compact-dist-posture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  pack(dir);
  const posturePath = join(dir, 'package', 'patches', 'posture.patch.yml');

  const rows = loadOverlayPatches('compact-dist-test', posturePath);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ['cordis-host-runner', 'ptc-runtime', 'directory-picker', 'preset-standard', 'preset-ptc', 'preset-minimal', 'preset-cordis']) {
    assert.equal(byId.get(id)?.disabled, true, `${id} must be disabled by the posture layer`);
  }
  assert.equal(byId.get('agent-preset-registry')?.config?.default, 'compact-pilot', 'the roster must select the pilot preset only');

  const exprs = [];
  const dig = (value) => {
    if (value === null || typeof value !== 'object') return;
    if ('__jsExpr' in value) { exprs.push(String(value.__jsExpr)); return; }
    for (const child of Object.values(value)) dig(child);
  };
  for (const id of ['compact-record-provider', 'compact-blessed']) {
    const row = byId.get(id);
    assert.ok(row, `${id} must carry a posture config override`);
    dig(row.config);
  }
  const joined = exprs.join('\n');
  for (const state of ['COMPACT_RECORD_ROOT', 'COMPACT_CHAIN_DIR', 'COMPACT_APPROVAL_PERSIST_PATH', 'compact-data/records', 'compact-data/chains', 'compact-data/approvals.json']) {
    assert.ok(joined.includes(state), `the state defaults must derive ${state} (env first, then the profile dir)`);
  }
  for (const expr of exprs) {
    if (expr.includes('subjects.jsonl')) assert.ok(expr.includes('profileContext'), 'the subjects ledger must follow the derived chain dir, never a bare concat onto undefined');
  }

  // the declared gap, asserted as absence: the host's own management surface
  // stays alive on the trial path — enforcement rides the gate (a mounted
  // dynamicCordisRunner refuses the boot; a late-mounted one latches a breach)
  const text = readFileSync(posturePath, 'utf8');
  for (const id of ['plugin-manager', 'hmr', 'ui-settings-plugins', 'ui-settings-plugin-inventory']) {
    assert.ok(!text.includes(`id: ${id}`), `${id} must stay absent from the posture layer — the gap is declared in prose, not enforced by this file`);
  }
  assert.match(text, /DECLARED GAP/);
});

test('live: pnpm adds the tarball into a scratch profile and every compact-* import loads', { skip: process.env.COMPACT_DIST_LIVE_TEST !== '1' ? 'set COMPACT_DIST_LIVE_TEST=1 (runs npx pnpm; the install path the plugin manager uses)' : false }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-dist-live-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profile = join(dir, 'profile');
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'compact-dist-probe', private: true, version: '0.0.0' }) + '\n');
  const tarball = pack(dir);

  execFileSync('npx', ['--yes', 'pnpm@9', 'add', tarball], { cwd: profile, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

  const requireFromProfile = createRequire(join(profile, 'package.json'));
  const installed = fileURLToPath(pathToFileURL(requireFromProfile.resolve('compact-dsh/package.json')));
  assert.ok(installed.startsWith(join(profile, 'node_modules')), `the bundle must install profile-level, got ${installed}`);

  // the composition's own imports: siblings resolve from inside vendored code
  // through the bundle package's own node_modules — the exact lookup pnpm's
  // strict layout governs, and the thing workspace hoisting used to hide.
  const requireFromBlessed = createRequire(join(installed, 'node_modules', 'compact-dsh-blessed', 'src', 'index.js'));
  const approval = fileURLToPath(pathToFileURL(requireFromBlessed.resolve('compact-dsh-approval/package.json')));
  assert.ok(approval.includes('compact-dsh-approval'), `vendored sibling resolution broke: ${approval}`);

  // loading the three row-resolved modules executes the whole import graph
  const bundle = await import(pathToFileURL(requireFromProfile.resolve('compact-dsh')));
  assert.equal(typeof bundle.apply, 'function');
  const provider = await import(pathToFileURL(requireFromProfile.resolve('compact-dsh/provider')));
  assert.equal(typeof provider.apply, 'function');
  const card = await import(pathToFileURL(requireFromProfile.resolve('compact-dsh/card')));
  assert.equal(typeof card.apply, 'function');
});
