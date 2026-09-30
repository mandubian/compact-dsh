// The case model's own laws, tested pure: form-checks that refuse
// malformity (never merits), parties derived from cited acts, a term that
// runs whether or not anyone looks, the interim discipline, and judgments
// that refuse to land off-record (D-7) — #112, J-2/J-3.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CaseError, fileCase, caseState, recordInterim, reviewInterimsAtOpening,
  landJudgment, deriveParties, isParty, citationsAgainst, renderCase,
  CASE_TERM_MS, FLOOD_CAP_OPEN_CASES, INTERIM_MAX_MS,
} from '../src/cases.js';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const LATER = NOW + CASE_TERM_MS + 1;

/** The record's answer for one session: lineage + the anchoring key. */
const resolve = (sessionId) => ({
  parent: sessionId === 'child' ? 'main' : sessionId === 'main' ? null : undefined,
  anchorKey: sessionId === 'child' || sessionId === 'main' ? 'enforcer-acme' : undefined,
});

const parties = deriveParties([{ session: 'child', fromSeq: 3, toSeq: 9 }], resolve);
const panel = { status: 'panel', setId: 'member-review', seats: ['chair', 'second'], refusals: [] };
const base = () => fileCase({
  id: 'case_1', filer: { kind: 'process', id: 'subject-1' },
  grievance: 'the specialist pushed outside its grant (D-3)',
  citations: [{ session: 'child', fromSeq: 3, toSeq: 9 }],
  parties, panel, now: NOW,
});

test('a well-formed filing carries its parts, parties derived not asserted', () => {
  const c = base();
  assert.equal(c.id, 'case_1');
  assert.deepEqual(c.parties.map((p) => `${p.kind}:${p.id}`),
    ['process:child', 'key:enforcer-acme', 'process:main'],
    'the walk names the session, its anchoring key, and its lineage — pre-I-1 honesty');
  assert.equal(c.judgment, null);
});

test('the form-checker refuses malformity, never the merits (no clerk)', () => {
  const shapes = [
    () => fileCase({ id: '', filer: { id: 'f' }, grievance: 'g', citations: [{ session: 's', fromSeq: 0, toSeq: 1 }], parties, panel }),
    () => fileCase({ id: 'x', filer: null, grievance: 'g', citations: [{ session: 's', fromSeq: 0, toSeq: 1 }], parties, panel }),
    () => fileCase({ id: 'x', filer: { id: 'f' }, grievance: '  ', citations: [{ session: 's', fromSeq: 0, toSeq: 1 }], parties, panel }),
    () => fileCase({ id: 'x', filer: { id: 'f' }, grievance: 'g', citations: [], parties, panel }),
    () => fileCase({ id: 'x', filer: { id: 'f' }, grievance: 'g', citations: [{ session: '', fromSeq: 0, toSeq: 1 }], parties, panel }),
    () => fileCase({ id: 'x', filer: { id: 'f' }, grievance: 'g', citations: [{ session: 's', fromSeq: 9, toSeq: 3 }], parties, panel }),
    () => fileCase({ id: 'x', filer: { id: 'f' }, grievance: 'g', citations: [{ session: 's', fromSeq: 0, toSeq: 1 }], parties: [], panel }),
    () => fileCase({ id: 'x', filer: { id: 'f' }, grievance: 'g', citations: [{ session: 's', fromSeq: 0, toSeq: 1 }], parties, panel: null }),
  ];
  for (const shape of shapes) assert.throws(shape, CaseError, 'each malformed shape refuses');
  // and a grievance the checker politically dislikes still files — merits are not its business
  const spicy = fileCase({ id: 'x', filer: { id: 'f' }, grievance: 'this grievance accuses the form-checker itself',
    citations: [{ session: 's', fromSeq: 0, toSeq: 0 }], parties, panel });
  assert.equal(spicy.grievance.includes('form-checker'), true);
});

test('party derivation walks lineage and anchors, and refuses without the record', () => {
  assert.throws(() => deriveParties([{ session: 'x', fromSeq: 0, toSeq: 1 }]), CaseError,
    'no resolve function → no parties → no case');
  const looping = deriveParties([{ session: 'a', fromSeq: 0, toSeq: 1 }],
    (id) => ({ parent: id === 'a' ? 'b' : 'a' }));
  assert.deepEqual(looping.map((p) => p.id).sort(), ['a', 'b'], 'a looping lineage stops the walk, it does not fail it');
});

test('a term that runs whether or not anyone looks: overdue is derived, never stored', () => {
  const c = base();
  assert.deepEqual(caseState(c, NOW), { status: 'open', overdue: false });
  assert.deepEqual(caseState(c, LATER), { status: 'overdue', overdue: true });
  assert.equal('status' in c, false, 'no stored status field exists at all');
});

test('an unheard panel files: the unheard row is a disposition, never a dismissal', () => {
  const c = fileCase({ id: 'case_2', filer: { id: 'f' }, grievance: 'g',
    citations: [{ session: 'child', fromSeq: 0, toSeq: 2 }], parties,
    panel: { status: 'unheard', attempts: [] }, now: NOW });
  assert.equal(caseState(c, NOW).status, 'unheard');
  assert.throws(() => landJudgment(c, { seat: 'anyone', findings: [{ session: 'child', fromSeq: 0, toSeq: 2 }], rules: ['J-3'], reasons: 'r' }),
    (e) => e.code === 'unheard', 'nobody lawful remains to judge it');
});

test('interim measures: cause, scope, capped duration, expiry checked at read', () => {
  const c = base();
  assert.throws(() => recordInterim(c, { cause: '', scope: 'egress', durationMs: 1000 }), CaseError);
  assert.throws(() => recordInterim(c, { cause: 'why', scope: '', durationMs: 1000 }), CaseError);
  assert.throws(() => recordInterim(c, { cause: 'why', scope: 'egress', durationMs: INTERIM_MAX_MS + 1 }), CaseError);
  const m = recordInterim(c, { cause: 'risk of spoliation', scope: 'egress for session child', durationMs: 60_000, now: NOW });
  assert.equal(reviewInterimsAtOpening(c, NOW + 30_000)[0].live, true);
  assert.equal(reviewInterimsAtOpening(c, NOW + 61_000)[0].live, false,
    'the first act of the hearing\'s opening names the measure that outlived itself');
  assert.deepEqual(reviewInterimsAtOpening(c, NOW).map((r) => r.measure), [m]);
});

test('judgments land on the record’s terms or refuse to (D-7)', () => {
  const c = base();
  const good = { seat: 'chair', findings: [{ session: 'child', fromSeq: 4, toSeq: 6 }], rules: ['D-3', 'J-2'], reasons: 'the cited slice shows the push outside the grant' };
  assert.throws(() => landJudgment(c, { ...good, seat: 'intruder' }), (e) => e.code === 'seat');
  assert.throws(() => landJudgment(c, { ...good, findings: [] }), (e) => e.code === 'malformed');
  assert.throws(() => landJudgment(c, { ...good, findings: [{ session: 'child', fromSeq: 400, toSeq: 600 }] }),
    (e) => e.code === 'uncited', 'a finding outside every verified slice refuses to land');
  assert.throws(() => landJudgment(c, { ...good, findings: [{ session: 'elsewhere', fromSeq: 0, toSeq: 1 }] }),
    (e) => e.code === 'uncited', 'a session the case never cited is not evidence');
  assert.throws(() => landJudgment(c, { ...good, reasons: '  ' }), (e) => e.code === 'malformed');
  assert.throws(() => landJudgment(c, { ...good, dissent: { seat: 'second' } }), (e) => e.code === 'malformed',
    'a dissent carries reasons or does not land');
  const j = landJudgment(c, { ...good, dissent: { seat: 'second', reasons: 'the slice shows recklessness, not deception' } });
  assert.equal(j.dissent.seat, 'second');
  assert.equal(caseState(c).status, 'judged');
  assert.throws(() => landJudgment(c, good), (e) => e.code === 'judged', 'no removal operation exists');
  assert.throws(() => recordInterim(c, { cause: 'late', scope: 'x', durationMs: 1000 }), (e) => e.code === 'judged');
});

test('counsel access: the party test and the slices cited against a session', () => {
  const c = base();
  assert.equal(isParty(c, { kind: 'process', id: 'child' }), true);
  assert.equal(isParty(c, { kind: 'process', id: 'stranger' }), false);
  assert.deepEqual(citationsAgainst(c, 'child'), [{ session: 'child', fromSeq: 3, toSeq: 9 }]);
  assert.deepEqual(citationsAgainst(c, 'main'), [], 'lineage party, nothing cited against it directly');
});

test('the docket renders with derived state, live interims, and judgment attribution', () => {
  const c = base();
  recordInterim(c, { cause: 'spoliation risk', scope: 'egress:child', durationMs: 3_600_000, now: NOW });
  landJudgment(c, { seat: 'chair',
    findings: [{ session: 'child', fromSeq: 4, toSeq: 6 }], rules: ['D-3'], reasons: 'outside the grant, on the record' });
  const text = renderCase(c, NOW + 1000);
  assert.match(text, /case case_1 — judged/);
  assert.match(text, /parties \(derived from the cited acts, never asserted\): process:child, key:enforcer-acme, process:main/);
  assert.match(text, /interim measures: 1 recorded, 1 live/);
  assert.match(text, /judgment: landed .* at seat chair/);
  assert.match(text, /dissent|finding/);
});

test('the flood cap and term constants are the declared doctrine', () => {
  assert.equal(FLOOD_CAP_OPEN_CASES, 5);
  assert.equal(CASE_TERM_MS, 30 * 24 * 60 * 60 * 1000);
});
