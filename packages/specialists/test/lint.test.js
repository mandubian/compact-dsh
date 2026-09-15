// The trim-dedup lint, proven on synthetic rosters: each drift class the
// doctrine names is a failure — restatement, undocumented exclusion drops,
// deny-list rot, unresolved references, unmarked gates, spawn-surface leaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintRoster } from '../src/lint.js';

function fixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'roster-'));
  mkdirSync(join(dir, 'shared'));
  const base = {
    name: 'probe', toolName: 'specialist_probe', kind: 'specialist',
    description: 'probe', spawns: false, maxDepth: 0,
    deny: ['web_search', 'subagent', 'subagent_fork'], sourceExcludedTools: ['web_*'],
    unmappedExclusions: {}, includes: [], io: { returns: { type: 'object', required: ['status'], properties: {} } },
  };
  const files = {
    'probe.persona.json': JSON.stringify(base),
    'probe.md': '# Probe\n\nUnique doctrine that no other persona carries.\n',
    'shared/pointer.md': '## Canonical pointer\n\nAlways cite the rule that refused you and its lawful next moves.\n',
  };
  mutate?.({ dir, base, files });
  writeFileSync(join(dir, 'probe.persona.json'), files['probe.persona.json']);
  writeFileSync(join(dir, 'probe.md'), files['probe.md']);
  writeFileSync(join(dir, 'shared/pointer.md'), files['shared/pointer.md']);
  return dir;
}

test('lint: a clean fixture passes', () => {
  assert.deepEqual(lintRoster(fixture()), []);
});

test('lint: restating a canonical section verbatim fails, even when also included', () => {
  const dir = fixture(({ files, base }) => {
    base.includes = ['pointer'];
    files['probe.md'] = '# Probe\n\nAlways cite the rule that refused you and its lawful next moves.\n';
    files['probe.persona.json'] = JSON.stringify(base);
  });
  const f = lintRoster(dir);
  assert.ok(f.some(x => x.includes("restates canonical section 'pointer'")), JSON.stringify(f));
});

test('lint: a source exclusion that vanishes undocumented fails', () => {
  const dir = fixture(({ base, files }) => {
    base.sourceExcludedTools = ['web_*', 'capsule_*'];
    files['probe.persona.json'] = JSON.stringify(base);
  });
  const f = lintRoster(dir);
  assert.ok(f.some(x => x.includes("'capsule_*' is neither mapped into deny nor documented")), JSON.stringify(f));
});

test('lint: duplicate deny entries and off-vocabulary names fail', () => {
  const dir = fixture(({ base, files }) => {
    base.deny = ['web_search', 'web_search', 'web_skidaddle'];
    files['probe.persona.json'] = JSON.stringify(base);
  });
  const f = lintRoster(dir);
  assert.ok(f.some(x => x.includes('duplicate deny entries')), JSON.stringify(f));
  assert.ok(f.some(x => x.includes("'web_skidaddle'")), JSON.stringify(f));
});

test('lint: a non-spawning persona that leaves spawn tools reachable fails', () => {
  const dir = fixture(({ base, files }) => {
    base.deny = [];
    files['probe.persona.json'] = JSON.stringify(base);
  });
  const f = lintRoster(dir);
  assert.ok(f.some(x => x.includes('must deny the spawn tools')), JSON.stringify(f));
});

test('lint: an unresolved include and an unmarked gate fail', () => {
  const dir = fixture(({ base, files }) => {
    base.includes = ['does-not-exist'];
    base.gated = [{ heading: 'Later', file: 'probe.gated.later.md' }]; // no when
    files['probe.persona.json'] = JSON.stringify(base);
  });
  const f = lintRoster(dir);
  assert.ok(f.some(x => x.includes("unknown canonical section 'does-not-exist'")), JSON.stringify(f));
  assert.ok(f.some(x => x.includes('carries no when-condition')), JSON.stringify(f));
  assert.ok(f.some(x => x.includes('gated file probe.gated.later.md missing')), JSON.stringify(f));
});
