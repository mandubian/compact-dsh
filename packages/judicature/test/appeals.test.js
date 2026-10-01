// The appeal model's own laws, tested pure: one appeal as of right, the
// disjoint-set panel resolution (unavailable / unheard / witnesses-pending
// / panel), the same-record discipline (no new evidence), affirm-or-depart
// with argued departure, finality, and remedies riding the operative
// judgment — #114, J-5.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CaseError, fileCase, landJudgment } from '../src/cases.js';
import { landRemedy } from '../src/remedies.js';
import {
  fileAppeal, resolveAppellatePanel, landAppellateJudgment, renderAppeal,
  isEnforcerClass, APPEAL_DISPOSITIONS,
} from '../src/appeals.js';
import { validateAdjudicatorSets } from '../src/sets.js';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const parties = [
  { kind: 'process', id: 'specialist-7f3a' },
  { kind: 'process', id: 'customer-51d0' },
];

/** A two-set judiciary: `first` (subordinate to founder via plugin) and
 *  `review` (external member keys, no declared edges — disjoint). */
const judiciary = validateAdjudicatorSets({
  nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
  sets: [
    { id: 'first', roles: [{ id: 'judge', standing: { kind: 'principal', id: 'founder' } }],
      trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
    { id: 'review', roles: [
        { id: 'chair', standing: { kind: 'key', id: 'member-key-7' } },
        { id: 'second', standing: { kind: 'key', id: 'member-key-12' } }],
      trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
  ],
  edges: [{ type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'founder' } }],
}, { enforcerKey: 'enforcer-x' });

const oneSetJudiciary = validateAdjudicatorSets({
  sets: [{ id: 'first', roles: [{ id: 'judge', standing: { kind: 'principal', id: 'founder' } }],
    trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } }],
  edges: [],
}, { enforcerKey: 'enforcer-x' });

const judged = () => {
  const c = fileCase({
    id: 'case_a1', filer: { kind: 'process', id: 'customer-51d0' },
    grievance: 'the specialist pushed outside its grant',
    citations: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }],
    parties, panel: { status: 'panel', setId: 'first', seats: ['judge'], refusals: [] }, now: NOW,
  });
  landJudgment(c, {
    seat: 'judge', findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }],
    rules: ['D-3'], reasons: 'the push ran outside the grant', now: NOW + 1,
  });
  return c;
};

test('an appeal re-hears a judgment, as of right, once', () => {
  const c = judged();
  const unjudged = { ...c, judgment: null };
  assert.throws(() => fileAppeal(unjudged, { filer: 'customer-51d0', grounds: 'g' }),
    (e) => e.code === 'malformed', 'nothing judged, nothing to re-hear');
  const a = fileAppeal(c, { filer: 'customer-51d0', grounds: 'the grant\'s scope was read too widely on this record', now: NOW + 2 });
  assert.equal(a.kind, 'appeal');
  c.appeal = a;
  c.appeal.panel = resolveAppellatePanel(judiciary, c);
  landAppellateJudgment(c, { seat: 'chair', disposition: 'affirm', findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }], rules: ['J-2'], reasons: 'r' });
  assert.throws(() => fileAppeal(c, { filer: 'specialist-7f3a', grounds: 'g2' }),
    (e) => e.code === 'final' && /second judgment is final/.test(e.message),
    'after the appellate judgment is final, a second appeal is refused — the door closes');
  assert.throws(() => fileAppeal({ ...judged(), parties: [{ kind: 'process', id: 'stranger' }] }, { filer: 'customer-51d0', grounds: 'g' }),
    (e) => /not a party/.test(e.message), 'an appeal belongs to those who were before the court');
});

test('a recorded appeal holds the door, and the refusal names the recorded state — never a finality nothing earned', () => {
  // UNHEARD: no appellate judgment has landed, none can — the second filing
  // is refused for what stands recorded, not for a finality that does not exist
  const c = judged();
  c.appeal = fileAppeal(c, { filer: 'customer-51d0', grounds: 'g' });
  c.appeal.panel = { status: 'unheard' };
  assert.throws(() => fileAppeal(c, { filer: 'specialist-7f3a', grounds: 'g2' }),
    (e) => e.code === 'unheard' && /stands recorded unheard/.test(e.message) && !/second judgment is final/.test(e.message),
    'unheard names unheard — J-1: never dismissed, and never final');
  assert.throws(() => landAppellateJudgment(c, { seat: 'chair', disposition: 'affirm', findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }], rules: ['J-2'], reasons: 'r' }),
    (e) => /stands recorded unheard/.test(e.message), 'the judge door names the recorded state too');
  // WITNESSES-PENDING: the D-8 route, heard never — same discipline
  const d = judged();
  d.parties = [...parties, { kind: 'key', id: 'enforcer-x' }];
  d.appeal = fileAppeal(d, { filer: 'customer-51d0', grounds: 'g' });
  d.appeal.panel = { status: 'witnesses-pending' };
  assert.throws(() => fileAppeal(d, { filer: 'specialist-7f3a', grounds: 'g2' }),
    (e) => /stands recorded witnesses-pending/.test(e.message) && !/second judgment is final/.test(e.message),
    'witnesses-pending names witnesses-pending');
  assert.throws(() => landAppellateJudgment(d, { seat: 'chair', disposition: 'affirm', findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }], rules: ['J-2'], reasons: 'r' }),
    (e) => /stands recorded witnesses-pending/.test(e.message));
});

test('the appellate panel is the first DISJOINT set with a seat that remains', () => {
  const c = judged();
  c.appeal = fileAppeal(c, { filer: 'customer-51d0', grounds: 'g' });
  const p = resolveAppellatePanel(judiciary, c);
  assert.equal(p.status, 'panel');
  assert.equal(p.setId, 'review');
  assert.deepEqual(p.seats, ['chair', 'second']);
  // a review set with a recusing role BESIDE a remaining one: the panel
  // carries the chosen set's own refusals too, not only the skipped sets'
  const mixed = validateAdjudicatorSets({
    nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
    sets: [
      { id: 'first', roles: [{ id: 'judge', standing: { kind: 'principal', id: 'founder' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
      { id: 'review', roles: [
          { id: 'chair', standing: { kind: 'key', id: 'member-key-7' } },
          { id: 'party-seat', standing: { kind: 'process', id: 'specialist-7f3a' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
    ],
    edges: [{ type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'founder' } }],
  }, { enforcerKey: 'enforcer-x' });
  const mc = judged();
  mc.appeal = fileAppeal(mc, { filer: 'customer-51d0', grounds: 'g' });
  const mp = resolveAppellatePanel(mixed, mc);
  assert.equal(mp.status, 'panel');
  assert.deepEqual(mp.seats, ['chair']);
  assert.equal(mp.refusals.length, 1, 'the chosen set\'s own recusal rides the resolution');
  assert.equal(mp.refusals[0].roleId, 'party-seat');
});

test('no second set → unavailable; disjoint sets that all recuse → unheard', () => {
  const c = judged();
  c.appeal = fileAppeal(c, { filer: 'customer-51d0', grounds: 'g' });
  assert.equal(resolveAppellatePanel(oneSetJudiciary, c).status, 'unavailable');
  // a judiciary whose second set is disjoint but seated on a party → unheard
  const joined = validateAdjudicatorSets({
    nodes: [{ kind: 'plugin', id: 'compact-dsh' }, { kind: 'principal', id: 'founder' }],
    sets: [
      { id: 'first', roles: [{ id: 'judge', standing: { kind: 'principal', id: 'founder' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
      { id: 'review', roles: [{ id: 'chair', standing: { kind: 'process', id: 'specialist-7f3a' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
    ],
    edges: [{ type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'founder' } }],
  }, { enforcerKey: 'enforcer-x' });
  const jc = judged();
  jc.appeal = fileAppeal(jc, { filer: 'customer-51d0', grounds: 'g' });
  assert.equal(resolveAppellatePanel(joined, jc).status, 'unheard',
    'disjoint, but the only seat is a party — the appeal is unheard, never dismissed');
});

test('the D-8 route: a party of the Enforcer\'s class is heard never, saying so', () => {
  assert.equal(isEnforcerClass([{ kind: 'key', id: 'enforcer-x' }], judiciary), true);
  assert.equal(isEnforcerClass([{ kind: 'plugin', id: 'compact-dsh' }], judiciary), true);
  assert.equal(isEnforcerClass([{ kind: 'key', id: 'member-key-7' }], judiciary), false);
  const c = judged();
  c.parties = [...parties, { kind: 'key', id: 'enforcer-x' }];
  c.appeal = fileAppeal({ ...c, appeal: null }, { filer: 'customer-51d0', grounds: 'g' });
  assert.equal(resolveAppellatePanel(judiciary, c).status, 'witnesses-pending');
});

test('affirm or depart, argued; the same record only; final with dissent', () => {
  const c = judged();
  c.appeal = fileAppeal(c, { filer: 'customer-51d0', grounds: 'g' });
  c.appeal.panel = resolveAppellatePanel(judiciary, c);
  const good = { seat: 'chair', disposition: 'affirm', findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }], rules: ['J-2'], reasons: 'the same record supports the finding' };
  assert.throws(() => landAppellateJudgment(c, { ...good, seat: 'judge' }),
    (e) => e.code === 'seat', 'first-panel seats cannot re-hear');
  assert.throws(() => landAppellateJudgment(c, { ...good, findings: [{ session: 'elsewhere', fromSeq: 0, toSeq: 1 }] }),
    (e) => e.code === 'uncited', 'the appeal admits no new evidence');
  assert.throws(() => landAppellateJudgment(c, { ...good, disposition: 'depart' }),
    (e) => /departure names the first judgment and argues it/.test(e.message));
  const affirmed = landAppellateJudgment(c, good);
  assert.equal(affirmed.disposition, 'affirm');
  assert.throws(() => landAppellateJudgment(c, good), (e) => e.code === 'final', 'final — no removal operation exists');
  const lines = renderAppeal(c);
  assert.match(lines.find((l) => l.includes('appellate judgment')), /affirmed .* FINAL/);
  assert.match(lines.find((l) => l.includes('appellate panel')), /disjoint from first, by declared edges/);
});

test('departure names and argues; remedies wait out the open appeal, then ride the operative judgment', () => {
  const c = judged();
  c.appeal = fileAppeal(c, { filer: 'customer-51d0', grounds: 'the scope was read too widely' });
  c.appeal.panel = resolveAppellatePanel(judiciary, c);
  // the open-appeal window: no remedy rides a judgment under contest — not
  // from the appellate seats (which have verified nothing yet), not from the
  // first panel's (whose judgment the appeal may depart from)
  for (const seat of ['chair', 'judge']) {
    assert.throws(() => landRemedy(c, {
      kind: 'annotation', seat, proportionality: 'premature',
      spec: { target: { session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }, note: 'n' },
    }), (e) => /under contest/.test(e.message), `seat ${seat}: a remedy waits out the open appeal`);
  }
  const departed = landAppellateJudgment(c, {
    seat: 'chair', disposition: 'depart',
    findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }], rules: ['D-3', 'J-2'],
    reasons: 'the grant covered the export host; the push ran inside it',
    departure: { grounds: 'the first judgment read "read grant" as host-scoped; the pattern is path-scoped and the record shows the path was covered' },
    dissent: { seat: 'second', reasons: 'the pattern text is ambiguous; affirm was the lawful reading' },
    now: NOW + 3,
  });
  assert.equal(departed.departure.from, 'judge');
  assert.match(renderAppeal(c).find((l) => l.includes('departs')), /departs from the first judgment/);
  // remedies ride the OPERATIVE judgment (the appellate one) — and land
  const row = landRemedy(c, {
    kind: 'annotation', seat: 'chair', proportionality: 'the corrected reading deserves its margin note',
    spec: { target: { session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }, note: 'the push ran inside the path-scoped grant (appellate finding)' },
  });
  assert.equal(row.remedy, 'annotation');
  // the operative panel keys off the LANDED judgment: the first panel's
  // seats judged, but their judgment is no longer the operative one
  assert.throws(() => landRemedy(c, {
    kind: 'annotation', seat: 'judge', proportionality: 'the first bench kept its prerogative',
    spec: { target: { session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }, note: 'n' },
  }), (e) => /operative panel's resolved seats \(chair, second\)/.test(e.message));
});

test('the D-8 route with a seated external: the appellate panel INCLUDES the witness (#126)', () => {
  const W = 'b'.repeat(64);
  const jud = validateAdjudicatorSets({
    nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
    sets: [
      { id: 'first', roles: [{ id: 'judge', standing: { kind: 'principal', id: 'founder' } }, { id: 'peer', standing: { kind: 'principal', id: 'peer' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
      { id: 'external', roles: [{ id: 'w1', standing: { kind: 'witness', id: W } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
    ],
    edges: [
      { type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'founder' } },
      { type: 'asserts-with', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'key', id: 'enforcer-x' } },
    ],
  }, { enforcerKey: 'enforcer-x', witnesses: new Set([W]) });
  // an enforcer-class party: the anchored key IS the enforcer key
  const c = fileCase({
    id: 'case_d8', filer: { kind: 'process', id: 'customer-51d0' },
    grievance: 'the composition pushed my data', citations: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }],
    parties: [...parties, { kind: 'key', id: 'enforcer-x' }],
    panel: { status: 'panel', setId: 'first', seats: ['peer'], refusals: [] }, now: NOW,
  });
  landJudgment(c, { seat: 'peer', findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }], rules: ['D-3'], reasons: 'r', now: NOW + 1 });
  c.appeal = fileAppeal(c, { filer: 'customer-51d0', grounds: 'misapplied' });
  // the appellate panel resolves to the EXTERNAL set — a witness aboard
  const p = resolveAppellatePanel(jud, c);
  assert.equal(p.status, 'panel');
  assert.equal(p.setId, 'external');
  assert.deepEqual(p.seats, ['w1']);
  c.appeal.panel = p;
  const judgment = landAppellateJudgment(c, {
    seat: 'w1', disposition: 'affirm',
    findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }], rules: ['D-3', 'J-2'],
    reasons: 'the record supports the reading', now: NOW + 2,
  });
  assert.equal(judgment.seat, 'w1', 'the external Witness hears the D-8 appeal — the last rung, seated');
  // and the same judiciary WITHOUT the witness set seats nothing: the wall
  const noWitness = validateAdjudicatorSets({
    nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
    sets: [
      { id: 'first', roles: [{ id: 'judge', standing: { kind: 'principal', id: 'founder' } }, { id: 'peer', standing: { kind: 'principal', id: 'peer' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
      { id: 'review', roles: [{ id: 'chair', standing: { kind: 'key', id: 'member-key-7' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } },
    ],
    edges: [
      { type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'founder' } },
      { type: 'asserts-with', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'key', id: 'enforcer-x' } },
    ],
  }, { enforcerKey: 'enforcer-x' });
  const d = { ...judged(), parties: [...parties, { kind: 'key', id: 'enforcer-x' }], appeal: null };
  d.appeal = fileAppeal(d, { filer: 'customer-51d0', grounds: 'g' });
  assert.equal(resolveAppellatePanel(noWitness, d).status, 'witnesses-pending',
    'a disjoint bench of the accused\'s own class does not hear it — none seated, the wall records');
});

test('the dispositions are closed', () => {
  assert.deepEqual(APPEAL_DISPOSITIONS, ['affirm', 'depart']);
});
