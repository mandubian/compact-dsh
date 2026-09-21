// The web surface of the blessed composition, without booting it: the
// launcher rows, the composed row shape over the real bundles, and the
// compact-pilot preset's roster hygiene. The boot-level proof (gate clean,
// record chained, gates armed under the browser rows) lives in
// loader.web.dsh.test.js, which needs Docker like its headless sibling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';
import { PRESET_ID, ensureInstallAnchor, installAnchor, presetCompositionPath, presetRoot, webRows } from '../src/web.js';

const overlayFile = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url));
const baseFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-base/package.json')));
const webFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-web-app/package.json')));

test('web rows disable the A-4/DYN trigger and replace the preset roster', () => {
  const rows = webRows();
  assert.deepEqual(rows.filter(row => row.config === undefined), [
    { id: 'cordis-host-runner', disabled: true },
    { id: 'code-runtime', disabled: true },
    { id: 'directory-picker', disabled: true },
  ]);
  const presets = rows.find(row => row.id === 'agent-presets').config;
  assert.equal(presets.default, PRESET_ID);
  assert.deepEqual(presets.roots, [{ path: presetRoot(), trust: 'system' }]);
  assert.equal(presets.includeShippedRoot, false, 'the shipped `standard` preset re-arms refused tools per session');
  assert.equal(presets.includeUserRoot, false, 'the roster is exactly the pilot preset');
});

test('web composition over the real bundles: runner disabled, transport live, overlay intact', () => {
  const warnings = [];
  const rows = composeEntries([
    loadOverlayPatches('compact-test', baseFile),
    loadOverlayPatches('compact-test', webFile),
    loadOverlayPatches('compact-test', overlayFile),
    [{ id: 'tools', config: { mode: 'native' } }],
    webRows(),
  ], message => warnings.push(message));
  assert.deepEqual(warnings, [], 'a disable that misses its row must fail here, not warn at boot');
  assert.equal(rows.find(row => row.id === 'cordis-host-runner')?.disabled, true,
    'the web bundle mounts the dynamic-plugin runner; the pilot composition must refuse it at the row (A-4/DYN absent)');
  assert.equal(rows.find(row => row.id === 'code-runtime')?.disabled, true,
    'host-side PTC execution stays off; the pilot code surface is confined bash only');
  for (const id of ['webserver', 'web-runtime', 'web-startup', 'agent-presets']) {
    assert.notEqual(rows.find(row => row.id === id)?.disabled, true, id);
  }
  assert.equal(rows.some(row => row.id === 'tool-cordis'), false,
    'nothing may mount the model-facing cordis lifecycle tools');
  assert.equal(rows.some(row => row.id === 'headless-runner'), false);
  assert.equal(rows.find(row => row.id === 'session-persistence-jsonl')?.disabled, true,
    'the blessed overlay still replaces stock persistence with the chained record');
  assert.deepEqual(rows.find(row => row.id === 'agent-loop')?.inject, ['compact-ready'],
    'the browser surface starts its loop only after compact-ready, like headless');
  assert.equal(rows.find(row => row.id === 'approval')?.config?.policy, 'ask');
  assert.deepEqual(rows.find(row => row.id === 'session-query-sqlite')?.config, { path: ':memory:', openAt: 'never' });
});

// The preset re-arms nothing the pilot refuses. Refusal at the row level is
// the headless composition's mechanism; on the web surface the roster would
// re-mount refused tools per session, so the roster is part of the posture.
const REFUSED_PRESET_ROWS = [
  'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent-fork', 'tool-subagent',
  'workflow-worker-thread', 'tool-workflow', 'tool-ralph',
  'tool-fs', 'tool-fs-search', 'tool-jobs', 'skill-filesystem', 'tool-skill',
  'command-goal', 'tool-goal', 'plan-mode', 'tool-web',
];

test('compact-pilot preset mounts nothing the pilot refuses', () => {
  const text = readFileSync(presetCompositionPath(), 'utf8');
  const pattern = new RegExp(`^\\s*- id: (?:${[...REFUSED_PRESET_ROWS].sort((a, b) => b.length - a.length).join('|')})\\b`, 'm');
  assert.doesNotMatch(text, pattern, 'the roster would re-arm a refused tool per session');
  for (const required of ['tool-bash', 'tool-todo', 'tool-ask-user', 'present', 'compaction-basic']) {
    assert.match(text, new RegExp(`^\\s*- id: ${required}\\b`, 'm'), required);
  }
  const metadata = readFileSync(join(presetRoot(), PRESET_ID, 'preset.yml'), 'utf8');
  assert.match(metadata, /^name: Compact pilot$/m);
});

test('the preset lives in the checkout, where node_modules anchors plugin resolution', () => {
  const dir = join(presetRoot(), PRESET_ID);
  assert.equal(statSync(dir).isDirectory(), true);
  assert.equal(existsSync(presetCompositionPath()), true);
  // the parent-walk from the preset directory must reach an installation
  // anchor; the checkout root supplies it
  let cursor = dir;
  let anchored = false;
  while (true) {
    const parent = join(cursor, '..');
    if (parent === cursor) break;
    cursor = parent;
    if (existsSync(join(cursor, 'node_modules', '@deepseek-ai', 'dsh-persona'))) { anchored = true; break; }
  }
  assert.equal(anchored, true, 'no node_modules ancestor resolves the preset plugins');
});

test('ensureInstallAnchor links the state dir to the checkout deps, reusing and refusing, never clobbering', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-anchor-'));
  try {
    const link = join(dir, 'node_modules');
    assert.equal(await ensureInstallAnchor(dir), link);
    assert.equal(realpathSync(link), realpathSync(installAnchor()));
    assert.equal(await ensureInstallAnchor(dir), link, 'idempotent on a correct symlink');
    unlinkSync(link);
    writeFileSync(link, 'not a directory\n', { mode: 0o600 });
    await assert.rejects(ensureInstallAnchor(dir), /refusing to replace/);
    unlinkSync(link);
    mkdirSync(link);
    await assert.rejects(ensureInstallAnchor(dir), /refusing to replace/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the workspace registry alignment (one boot, one exposed workspace) ──────

import { alignWorkspaceRegistry, ASIDE_RETENTION, workspaceRegistryPath } from '../src/web.js';

function registryFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'compact-registry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'storages'), { recursive: true });
  const write = (global, workspaces) => writeFileSync(
    workspaceRegistryPath(dir),
    JSON.stringify({ unit: { name: 'workspace', version: 2 }, global, tables: { workspaces } }, null, 2) + '\n',
  );
  const initialized = { initialized: true, workspaceIds: [] };
  return { dir, write, initialized };
}

test('workspace registry: matching-only or absent registry is left untouched', (t) => {
  const { dir, write, initialized } = registryFixture(t);
  assert.deepEqual(alignWorkspaceRegistry(dir, '/repo').realigned, false, 'no registry at all is not a defect');
  write({ ...initialized, workspaceIds: ['id1'] }, { id1: { path: '/repo', title: 'repo', sessionIds: [], createdAt: '', updatedAt: '' } });
  const r = alignWorkspaceRegistry(dir, '/repo');
  assert.equal(r.realigned, false);
  assert.deepEqual(r.foreign, []);
  // the initialized marker survives: the header bootstrap must never re-run
  const after = JSON.parse(readFileSync(workspaceRegistryPath(dir), 'utf8'));
  assert.equal(after.global.initialized, true);
});

test('workspace registry: foreign records are removed and the boot workspace is ensured — initialized preserved', (t) => {
  const { dir, write, initialized } = registryFixture(t);
  write(
    { ...initialized, workspaceIds: ['id1', 'id2'] },
    {
      id1: { path: '/repo', title: 'repo', sessionIds: ['session-1'], createdAt: 't1', updatedAt: 't1' },
      id2: { path: '/tmp/other', title: 'other', sessionIds: [], createdAt: 't2', updatedAt: 't2' },
    },
  );
  const r = alignWorkspaceRegistry(dir, '/repo');
  assert.deepEqual(r.foreign, ['/tmp/other']);
  assert.equal(r.realigned, true);
  assert.equal(r.aside, null, 'nothing is moved aside — the initialized marker is the fix');
  const after = JSON.parse(readFileSync(workspaceRegistryPath(dir), 'utf8'));
  assert.deepEqual(after.global.workspaceIds, ['id1'], 'the matching record survives in order');
  assert.deepEqual(Object.keys(after.tables.workspaces), ['id1'], 'the foreign record is gone');
  assert.deepEqual(after.tables.workspaces.id1.sessionIds, ['session-1'], 'the matching record is preserved verbatim');
  assert.equal(after.global.initialized, true, 'the header bootstrap must never re-run');
});

test('workspace registry: an initialized registry with no boot-workspace record gains one', (t) => {
  const { dir, write, initialized } = registryFixture(t);
  write({ ...initialized, workspaceIds: ['id1'] }, { id1: { path: '/tmp/other', title: 'other', sessionIds: [], createdAt: 't', updatedAt: 't' } });
  const r = alignWorkspaceRegistry(dir, '/repo');
  assert.equal(r.realigned, true);
  const after = JSON.parse(readFileSync(workspaceRegistryPath(dir), 'utf8'));
  assert.deepEqual(after.global.workspaceIds.length, 1);
  const record = after.tables.workspaces[after.global.workspaceIds[0]];
  assert.equal(record.path, '/repo');
  assert.equal(record.title, 'repo');
  assert.deepEqual(record.sessionIds, []);
});

test('workspace registry: an uninitialized registry is left for the header bootstrap, and a corrupt one moves aside', (t) => {
  const { dir, write, initialized } = registryFixture(t);
  write({ ...initialized, initialized: false, workspaceIds: ['id1'] }, { id1: { path: '/repo', title: 'repo', sessionIds: [], createdAt: '', updatedAt: '' } });
  assert.deepEqual(alignWorkspaceRegistry(dir, '/repo').realigned, false,
    'an uninitialized registry bootstraps from session headers by design; nothing to align without forging dsh state');
  writeFileSync(workspaceRegistryPath(dir), '{ not json');
  const aligned = alignWorkspaceRegistry(dir, '/repo');
  assert.notEqual(aligned.aside, null, 'a corrupt registry moves aside');
  assert.ok(aligned.foreign[0].includes('re-register'), 'the boot names the bootstrap consequence');
});

// -- aside retention (#22): a moved-aside registry is pruned, newest kept -----

test('workspace registry: writing a new aside prunes older ones beyond the retention count', (t) => {
  const { dir } = registryFixture(t);
  const storages = join(dir, 'storages');
  // six stale asides from earlier boot cycles, oldest first
  for (let i = 1; i <= 6; i++) {
    writeFileSync(join(storages, `workspace.json.aside-17000000000${i}`), '{}\n');
  }
  // a corrupt registry forces the move-aside path
  writeFileSync(workspaceRegistryPath(dir), '{not json');
  const r = alignWorkspaceRegistry(dir, '/repo');
  assert.ok(r.aside, 'the corrupt registry was moved aside');
  const kept = readdirSync(storages).filter(n => n.startsWith('workspace.json.aside-')).sort();
  assert.equal(kept.length, ASIDE_RETENTION, `exactly ${ASIDE_RETENTION} asides survive`);
  assert.equal(kept.includes('workspace.json.aside-170000000006'), true, 'the newest stale aside survives');
  assert.equal(kept.includes('workspace.json.aside-170000000001'), false, 'the oldest stale aside is pruned');
  assert.equal(kept.includes(r.aside.split('/').pop()), true, 'the fresh aside survives');
  assert.deepEqual(r.pruned.sort(), ['workspace.json.aside-170000000001', 'workspace.json.aside-170000000002'],
    'the boot log names what went');
});
