// The web surface of the blessed composition, without booting it: the
// launcher rows, the composed row shape over the real bundles, and the
// compact-pilot preset's roster hygiene. The boot-level proof (gate clean,
// record chained, gates armed under the browser rows) lives in
// loader.web.dsh.test.js, which needs Docker like its headless sibling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
