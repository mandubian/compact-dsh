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

test('cross-exam-mole: cross-exam-fix with one sealed seat and a judge — the rest unchanged', () => {
  const mole = validateCharter(JSON.parse(readFileSync(join(CHARTERS, 'cross-exam-mole.json'), 'utf8')));
  const fix = validateCharter(JSON.parse(readFileSync(join(CHARTERS, 'cross-exam-fix.json'), 'utf8')));
  const src = (c, p) => c.sources.find((s) => s.path === p)?.content;
  assert.equal(src(mole, 'sources/purse.js'), src(fix, 'sources/purse.js'), 'the module under review, byte for byte');
  assert.equal(src(mole, 'package.json'), src(fix, 'package.json'));
  // one planted member, and its public face is cross-exam-fix's honest defender
  const sealed = mole.members.filter((m) => m.sealedBrief);
  assert.deepEqual(sealed.map((m) => m.id), ['defender'], 'exactly one sealed seat');
  assert.equal(sealed[0].persona, fix.members.find((m) => m.id === 'defender').persona, 'the cover is the honest persona, verbatim');
  for (const id of ['accuser', 'defender', 'skeptic', 'chair']) {
    const a = mole.members.find((m) => m.id === id);
    const b = fix.members.find((m) => m.id === id);
    assert.equal(a.persona, b.persona, `${id}: persona unchanged`);
    assert.deepEqual(a.model, b.model, `${id}: route unchanged`);
    assert.equal(a.human === true, b.human === true, `${id}: human flag unchanged`);
  }
  // the court: a model judge, citations on, and nothing the others read names the plant
  const judge = mole.members.find((m) => m.bench);
  assert.equal(judge?.id, 'judge');
  assert.ok(judge.model, 'the judge sits on a model route');
  assert.equal(mole.turnCitations, true);
  assert.equal(mole.topic, fix.topic, 'the topic is the fix review\'s — a new name would tip the members off');
  const shared = [mole.goal, mole.briefingExtra, ...mole.members.map((m) => m.persona), ...mole.sources.map((s) => s.content)].join('\n');
  assert.doesNotMatch(shared, /mole|sealed|plant|house/i, 'what every member reads names no planted member');
  assert.ok(mole.goal.startsWith(fix.goal), 'the goal is cross-exam-fix\'s, with the judge appended');
});
