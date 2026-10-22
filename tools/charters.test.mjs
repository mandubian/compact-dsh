// Every shipped charter is valid data: the fence refuses vagueness, so a
// charter that drifts out of shape refuses HERE, in CI, not mid-run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateCharter } from '../packages/community/src/charter.js';

const CHARTERS = join(dirname(fileURLToPath(import.meta.url)), 'charters');

test('every shipped charter validates', () => {
  const files = readdirSync(CHARTERS).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 2, 'the charter shelf is not empty');
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(CHARTERS, f), 'utf8'));
    const c = validateCharter(doc);
    assert.equal(c.name, doc.name, `${f}: the name survives validation`);
    assert.ok(c.members.length >= 2, `${f}: at least two members`);
  }
});

test('the agreement charter: forum-only — no grants, no publish, no bench (#215 second charter)', () => {
  const doc = JSON.parse(readFileSync(join(CHARTERS, 'agreement.json'), 'utf8'));
  const c = validateCharter(doc);
  assert.deepEqual(c.grants, [], 'a debate community pre-mints nothing');
  assert.equal(c.publish, undefined, 'a debate community publishes nothing');
  assert.equal(c.members.filter((m) => m.bench).length, 0, 'no bench: agreement is consensus, not judgment');
  assert.match(c.goal, /AGREEMENT:/, 'the success criterion is named in the goal');
  assert.match(c.goal, /endorsing it/, 'endorsement is by name, on the record');
});
