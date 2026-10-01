// The precedent model's own laws, tested pure: citation and argued
// departure (consistency owed reasons, never obedience), the reliance map
// (follows count, departures count nothing), the operative judgment, and
// the bounded read with its standing sentence — #115, J-7.
import test from 'node:test';
import assert from 'node:assert/strict';

import { fileCase, landJudgment, checkPrecedentRow } from '../src/cases.js';
import {
  resolvePrecedent, reliedUponBy, operativeJudgment,
  renderPrecedentIndex, renderJudgmentAsPrecedent, PRECEDENT_STANDING,
} from '../src/precedent.js';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const panel = { status: 'panel', setId: 'first', seats: ['judge'], refusals: [] };
const parties = [
  { kind: 'process', id: 'specialist-7f3a' },
  { kind: 'process', id: 'customer-51d0' },
];

const judged = (id, { rules = ['D-3'], precedent = null, by = 'process:seat-holder' } = {}) => {
  const c = fileCase({
    id, filer: { kind: 'process', id: 'customer-51d0' },
    grievance: 'the specialist pushed outside its grant',
    citations: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }],
    parties, panel, now: NOW,
  });
  landJudgment(c, {
    seat: 'judge', findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }],
    rules, reasons: 'the push ran outside the grant', by,
    ...(precedent ? { precedent } : {}), now: NOW + 1,
  });
  return c;
};

const docketOf = (...cases) => {
  const map = new Map(cases.map((c) => [c.id, c]));
  return (id) => map.get(id) ?? null;
};

test('a citation names a LANDED judgment, or refuses — precedent is a property of judgments, not cases', () => {
  const a = judged('case_a1');
  const resolve = docketOf(a);
  // follows, normalized from the door's raw strings
  assert.deepEqual(resolvePrecedent({ cites: 'case_a1' }, resolve, 'case_b2'), { cites: ['case_a1'], departs: [], grounds: null });
  assert.equal(resolvePrecedent(null, resolve, 'x'), null);
  assert.equal(resolvePrecedent({ cites: ' , ', departs: '' }, resolve, 'x'), null);
  // unknown case — cited from what was filed, never from memory
  assert.throws(() => resolvePrecedent({ cites: 'case_ghost' }, resolve, 'case_b2'),
    (e) => /not on the docket/.test(e.message));
  // filed but unjudged — no judgment, no precedent
  const unjudged = { ...judged('case_u1'), judgment: null };
  assert.throws(() => resolvePrecedent({ cites: 'case_u1' }, docketOf(unjudged), 'case_b2'),
    (e) => /has landed no judgment/.test(e.message));
  // self-citation
  assert.throws(() => resolvePrecedent({ cites: 'case_a1' }, resolve, 'case_a1'),
    (e) => /cannot cite itself/.test(e.message));
});

test('departure is a subset of citation, and every departure argues itself (J-7)', () => {
  const a = judged('case_a1');
  const resolve = docketOf(a);
  assert.deepEqual(
    resolvePrecedent({ cites: 'case_a1', departs: 'case_a1', grounds: 'the reading held the push covered; the pattern is path-scoped and this record shows the path' }, resolve, 'case_b2'),
    { cites: ['case_a1'], departs: ['case_a1'], grounds: 'the reading held the push covered; the pattern is path-scoped and this record shows the path' });
  assert.throws(() => resolvePrecedent({ cites: 'case_a1', departs: 'case_zz' }, resolve, 'case_b2'),
    (e) => /which it does not cite/.test(e.message));
  assert.throws(() => resolvePrecedent({ cites: 'case_a1', departs: 'case_a1' }, resolve, 'case_b2'),
    (e) => /consistency is owed reasons/.test(e.message));
  // the row's own invariants hold however the claims arrive
  assert.throws(() => checkPrecedentRow('case_a1', { cites: ['case_a1'] }), /cannot cite itself/);
  assert.equal(checkPrecedentRow('case_a1', { cites: [], departs: [] }), null);
});

test('the precedent claims land on the judgment row, with the by-coordinates', () => {
  const a = judged('case_a1');
  const b = judged('case_b2', { precedent: resolvePrecedent({ cites: 'case_a1' }, docketOf(a), 'case_b2') });
  assert.deepEqual(b.judgment.precedent, { cites: ['case_a1'], departs: [], grounds: null });
  assert.equal(b.judgment.by, 'process:seat-holder');
});

test('the reliance map counts FOLLOWS; departures count nothing', () => {
  const a = judged('case_a1');
  const b = judged('case_b2', { precedent: { cites: ['case_a1'], departs: [], grounds: null } });
  const d = judged('case_d4', {
    precedent: { cites: ['case_a1'], departs: ['case_a1'], grounds: 'the pattern is path-scoped here, and the record shows the covered path' },
    by: 'process:another-seat',
  });
  const relied = reliedUponBy([a, b, d]);
  assert.deepEqual(relied.get('case_a1'), ['case_b2'], 'one judgment follows, one argues away — reliance is the citation record');
});

test('the operative judgment is the appellate one after departure; else the first', () => {
  const c = judged('case_a1');
  assert.equal(operativeJudgment(c), c.judgment);
  c.appeal = { judgment: { kind: 'appellate-judgment', disposition: 'affirm' } };
  assert.equal(operativeJudgment(c), c.appeal.judgment);
});

test('the read is bounded and carries the standing sentence on every read', () => {
  const a = judged('case_a1');
  const b = judged('case_b2', { precedent: { cites: ['case_a1'], departs: [], grounds: null } });
  const index = renderPrecedentIndex([a, b]);
  assert.match(index, /\[J-7\] 2 judgment\(s\) on the docket — precedent persuades; it never amends:/);
  assert.match(index, /case_a1 — judgment at seat judge — D-3 — .* — relied upon by case_b2/);
  assert.match(index, /case_b2 — judgment at seat judge — D-3 — .* — follows case_a1$/m);
  assert.match(index, new RegExp(PRECEDENT_STANDING.slice(0, 40)));
  // one judgment per read: the reasons ARE the interpretation — shown here,
  // withheld from the docket view
  const one = renderJudgmentAsPrecedent(a, [a, b]);
  assert.match(one, /reasons: the push ran outside the grant/);
  assert.match(one, /relied upon by: case_b2/);
  assert.match(one, /An interpretive aid with no force/);
  assert.match(one, /never binding law \(FED-1\)/);
  // the honest empty
  const empty = renderPrecedentIndex([]);
  assert.match(empty, /no judgment has landed on the docket/);
  const unjudgedRead = renderJudgmentAsPrecedent({ ...judged('case_u1'), judgment: null }, []);
  assert.match(unjudgedRead, /no judgment has landed on case_u1/);
});

test('an argued departure renders as precedent, named and argued', () => {
  const a = judged('case_a1');
  const d = judged('case_d4', {
    precedent: { cites: ['case_a1'], departs: ['case_a1'], grounds: 'the pattern is path-scoped here, and the record shows the covered path' },
  });
  const one = renderJudgmentAsPrecedent(d, [a, d]);
  assert.match(one, /departs from: case_a1 — the pattern is path-scoped here/);
  assert.doesNotMatch(one, /relied upon by/);
});
