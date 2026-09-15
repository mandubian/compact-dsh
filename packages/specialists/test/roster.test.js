// Roster acceptance: the shipped roster lints clean (the trimming doctrine
// holds for the real data) and composes self-contained persona prompts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRoster, composePersona } from '../src/roster.js';
import { lintRoster, sentences } from '../src/lint.js';

test('the shipped roster passes the trim-dedup lint', () => {
  const failures = lintRoster();
  assert.deepEqual(failures, [], `lint failures:\n  - ${failures.join('\n  - ')}`);
});

test('the roster composes self-contained prompts: unique prose + canonical sections + contract + gates', () => {
  const roster = loadRoster();
  const coder = roster.byId.get('coder');
  assert.ok(coder, 'coder present');
  const prompt = composePersona(coder);
  assert.ok(prompt.includes('# Coder'), 'identity prose');
  assert.ok(prompt.includes('## Gate refusals'), 'canonical section assembled');
  assert.ok(prompt.includes('## Clarification protocol'), 'canonical section assembled');
  assert.ok(prompt.includes('## Output contract'), 'the taught contract');
  assert.ok(prompt.includes('"status"'), 'the io.returns schema rendered');
  assert.ok(prompt.includes('## If Evaluator/Auditor Finds Issues (applies when: phase(artifact_built))'), 'gated section marked, not flattened');
  // the prompt is self-contained: every included canonical line is present
  for (const inc of coder.includes) assert.ok(prompt.includes(inc.text.trim().split('\n')[0]));
});

test('sentence normalization catches restatement at paragraph boundaries', () => {
  const s = sentences('## Heading\n\nNever retry a refused call unchanged, and never probe for an ungated path to the same act.');
  assert.ok(s.some(x => x.startsWith('never retry a refused call')), JSON.stringify(s));
});
