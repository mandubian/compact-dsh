// The gloss reading door's tests (packages/guide, #90's last slice): the
// tool serves the LIVE gloss table — so the suite pins the reading
// disciplines, not the table's content (that is the gloss lint's job, in
// packages/envelope): the index is bounded and complete, one record per
// read is verbatim from the table, the standing line rides every answer,
// the wildcard families are named when they cover a miss, and an unknown
// rule is answered honestly — never with a near match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOSS } from 'compact-envelope';
import { renderGlossIndex, renderRecord, readGloss, GLOSS_TOOL } from '../src/gloss.js';
import { apply as applyGuide } from '../src/index.js';

test('the index is complete and bounded: every key and title, nothing else', () => {
  const index = readGloss({});
  for (const [key, record] of Object.entries(GLOSS)) {
    assert.ok(index.includes(key), `index misses ${key}`);
    assert.ok(index.includes(record.title), `index misses the title of ${key}`);
  }
  assert.match(index, /^\[gloss\] \d+ glossed rules/);
  assert.ok(!index.includes(GLOSS['AG/*'].why), 'the index must not pull whole records into context');
});

test('the index groups by gate family, wildcards last', () => {
  const index = renderGlossIndex();
  const ag = index.slice(index.indexOf('\nAG'), index.indexOf('\nCG') > -1 ? index.indexOf('\nCG') : undefined);
  assert.ok(ag.indexOf('AG/*') > ag.lastIndexOf('\n  AG/'), 'the AG wildcard row must come after its family');
});

test('an exact read is verbatim from the table, with the standing and the law pointer', () => {
  const key = 'RA/D-7/opaque-network';
  const record = GLOSS[key];
  const answer = readGloss({ rule: key });
  assert.ok(answer.includes(`[gloss] ${key} — ${record.title}`));
  assert.ok(answer.includes(record.why), 'the why must be verbatim');
  assert.ok(answer.includes(`Refused path — e.g. ${record.example.blocked[0]}`));
  assert.ok(answer.includes(`Lawful path — e.g. ${record.example.lawful[0]}`));
  assert.ok(answer.includes(`What to do: ${record.instruction}`));
  for (const [move, meaning] of Object.entries(record.operatorMoves ?? {})) {
    assert.ok(answer.includes(move) && answer.includes(meaning), `operator move ${move} missing`);
  }
  assert.match(answer, /interpretive aid with no force/);
  assert.match(answer, /law_read\(\{ clause: "<id>" \}\)/);
});

test('every glossed record renders with the standing line (the check can fail)', () => {
  for (const [key, record] of Object.entries(GLOSS)) {
    const answer = renderRecord(key, record);
    assert.match(answer, /An interpretive aid with no force/, `${key} loses the standing`);
    assert.ok(answer.includes(record.title));
  }
});

test('a fingerprint-form ask resolves to its wildcard family, and says so', () => {
  const answer = readGloss({ rule: 'AG/fp_deadbeef' });
  assert.ok(answer.includes(GLOSS['AG/*'].title), 'the family record must be served');
  assert.match(answer, /You asked for AG\/fp_deadbeef/);
  assert.match(answer, /glossed once, at AG\/\*/);
  assert.match(answer, /keyed by the operation's fingerprint/);
});

test('a capability refusal keyed by its part resolves to CG/*', () => {
  const answer = readGloss({ rule: 'CG/SCH-1/anything' });
  assert.ok(answer.includes(GLOSS['CG/*'].title));
  assert.match(answer, /keyed by the part's first clause/);
});

test('an unknown rule is answered honestly — no near match, the floor is named', () => {
  const answer = readGloss({ rule: 'LG/LG-99' });
  assert.match(answer, /"LG\/LG-99" has no gloss/);
  assert.match(answer, /canonical envelope .* is the floor/);
  assert.ok(!answer.includes(GLOSS['LG/LG-8'].title), 'must not serve a near match');
  const stray = readGloss({ rule: 'ZZ/nope' });
  assert.match(stray, /"ZZ\/nope" has no gloss/);
});

test('no rule argument serves the index, with the standing', () => {
  for (const args of [undefined, {}, { rule: '' }, { rule: '   ' }]) {
    const answer = readGloss(args);
    assert.match(answer, /glossed rules/);
    assert.match(answer, /interpretive aid with no force/);
  }
});

test('apply registers both reading tools: guide and gloss_read', () => {
  const registered = [];
  const provided = {};
  const ctx = {
    inject: (_deps, fn) => fn({ tools: { register: t => registered.push(t) } }),
    provide: (n, s) => { provided[n] = s; },
  };
  applyGuide(ctx);
  assert.deepEqual(registered.map(t => t.name ?? t.definition?.name).sort(), ['gloss_read', 'guide']);
  // the rights page cites the reading door, so the loader test resolves it live
  assert.ok(provided['compact-guide'].citedTools().includes('gloss_read'));
  assert.equal(GLOSS_TOOL, 'gloss_read');
});
