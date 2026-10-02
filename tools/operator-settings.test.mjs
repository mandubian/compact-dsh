// Operator settings bridge tests: the settings.yaml → patch-rows translation
// the launcher applies because dsh 0.2.0 removed the document (its settings
// service only mounts in a profile boot, and the compact launcher boots none).
// Unit coverage of the mapping — legacy section ids, web-only sections,
// passthrough of unknown ids (the composition warns for them at boot, which is
// the visibility upstream's import relied on), and the refusal of a document
// that does not parse — plus one composed pass proving an operator row
// applied AFTER the bundle layers beats the bundle default (last write wins).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';
import { operatorSettingsRows } from './operator-settings.mjs';

const settings = (dir, text) => {
  const path = join(dir, 'settings.yaml');
  if (text !== undefined) writeFileSync(path, text);
  return path;
};

test('operator settings: absent file yields no rows', () => {
  assert.deepEqual(operatorSettingsRows({ settingsPath: join(tmpdir(), 'operator-settings-absent', 'settings.yaml'), web: false }), []);
});

test('operator settings: the model document translates row for row, last write wins over bundles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'operator-settings-'));
  const path = settings(dir, [
    'llm-pi-ai:',
    '  providers:',
    '    openrouter:',
    '      apiKeyEnv: OPENROUTER_API_KEY',
    'agent-default-model:',
    '  provider: opencode-go',
    '  model: deepseek-v4-flash',
  ].join('\n'));
  const rows = operatorSettingsRows({ settingsPath: path, web: false });
  assert.deepEqual(rows, [
    { id: 'llm-pi-ai', config: { providers: { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } } } },
    { id: 'agent-default-model', config: { provider: 'opencode-go', model: 'deepseek-v4-flash' } },
  ]);

  // the composed proof: the base bundle's agent-default-model default
  // (deepseek-official/deepseek-flash) is overridden by the operator row
  const baseFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-base/package.json')));
  const warnings = [];
  const composed = composeEntries([
    loadOverlayPatches('compact-test', baseFile),
    ...rows,
  ], message => warnings.push(message));
  assert.deepEqual(composed.find(row => row.id === 'agent-default-model')?.config,
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
    'the operator\'s model wins over the bundle default');
});

test('operator settings: legacy section ids map to their owning entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'operator-settings-'));
  const path = settings(dir, [
    'ui-onboarding:',
    '  welcomeNoticeVersion: 2026-08-13.1',
    'shell:',
    '  timeoutMs: 30000',
  ].join('\n'));
  const rows = operatorSettingsRows({ settingsPath: path, web: true });
  assert.deepEqual(rows, [
    { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-08-13.1' } },
    { id: 'bash-sandbox', config: { timeoutMs: 30000 } },
  ]);
});

test('operator settings: web-only sections are skipped headless, said out loud', () => {
  const dir = mkdtempSync(join(tmpdir(), 'operator-settings-'));
  const path = settings(dir, 'ui-onboarding:\n  welcomeNoticeVersion: v1\nagent-default-model:\n  provider: p\n  model: m\n');
  const notices = [];
  const rows = operatorSettingsRows({ settingsPath: path, web: false, notice: message => notices.push(message) });
  assert.deepEqual(rows, [{ id: 'agent-default-model', config: { provider: 'p', model: 'm' } }]);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /ui-onboarding.*ui-settings-general/);
  // the same document on the web surface applies both
  assert.equal(operatorSettingsRows({ settingsPath: path, web: true }).length, 2);
});

test('operator settings: an unknown section passes through as its entry id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'operator-settings-'));
  const path = settings(dir, 'future-entry:\n  key: value\n');
  assert.deepEqual(operatorSettingsRows({ settingsPath: path, web: false }),
    [{ id: 'future-entry', config: { key: 'value' } }]);
});

test('operator settings: a document that does not parse refuses, never silently ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'operator-settings-'));
  const path = settings(dir, 'llm-pi-ai:\n  providers:\n\t  openrouter: broken tab\n');
  assert.throws(() => operatorSettingsRows({ settingsPath: path, web: false }), /does not parse/);
  const scalar = settings(dir, 'just a string\n');
  assert.throws(() => operatorSettingsRows({ settingsPath: scalar, web: false }), /must be a mapping/);
  const badSection = settings(dir, 'agent-default-model: nope\n');
  assert.throws(() => operatorSettingsRows({ settingsPath: badSection, web: false }), /must be a mapping of config/);
});

test('operator settings: an empty document yields no rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'operator-settings-'));
  assert.deepEqual(operatorSettingsRows({ settingsPath: settings(dir, ''), web: false }), []);
  assert.deepEqual(operatorSettingsRows({ settingsPath: settings(dir, '# comments only\n'), web: false }), []);
});
