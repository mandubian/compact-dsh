// The remedies model's own laws, tested pure: the closed menu, the
// judgment a remedy rides, proportionality owed on every row, parties (not
// strangers) as debtors and standing subjects, annotations inside verified
// citations, and the read-door projections (annotationsOf/restitutionsOf)
// — #113, J-6.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CaseError, fileCase, landJudgment } from '../src/cases.js';
import { landRemedy, attachRemedy, annotationsOf, restitutionsOf, renderRemedies, REMEDY_KINDS } from '../src/remedies.js';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const parties = [
  { kind: 'process', id: 'specialist-7f3a' },
  { kind: 'process', id: 'main-9c41' },
  { kind: 'process', id: 'customer-51d0' },
];
const panel = { status: 'panel', setId: 'member-review', seats: ['chair', 'second'], refusals: [] };
const judged = () => {
  const c = fileCase({
    id: 'case_r1', filer: { kind: 'process', id: 'customer-51d0' },
    grievance: 'the specialist pushed outside its read grant',
    citations: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }, { session: 'customer-51d0', fromSeq: 1, toSeq: 2 }],
    parties, panel, now: NOW,
  });
  landJudgment(c, {
    seat: 'chair', findings: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }],
    rules: ['D-3'], reasons: 'the cited slice shows the push outside the grant', now: NOW + 1,
  });
  return c;
};

test('a remedy rides a judgment — none landed, no remedy', () => {
  const c = fileCase({
    id: 'case_r0', filer: { kind: 'process', id: 'customer-51d0' }, grievance: 'g',
    citations: [{ session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }], parties, panel, now: NOW,
  });
  assert.throws(() => landRemedy(c, { kind: 'annotation', seat: 'chair', proportionality: 'p', spec: {} }),
    (e) => e.code === 'unjudged');
});

test('the menu is closed, seats resolve, proportionality is owed', () => {
  const c = judged();
  assert.throws(() => landRemedy(c, { kind: 'punishment', seat: 'chair', proportionality: 'p', spec: {} }),
    (e) => /menu is closed/.test(e.message));
  assert.throws(() => landRemedy(c, { kind: 'referral', seat: 'intruder', proportionality: 'p', spec: { ruleId: 'R-1', detail: 'd' } }),
    (e) => e.code === 'seat');
  assert.throws(() => landRemedy(c, { kind: 'referral', seat: 'chair', proportionality: '  ', spec: { ruleId: 'R-1', detail: 'd' } }),
    (e) => /proportionality is owed/.test(e.message));
});

test('annotation: beside never inside, and inside a verified citation', () => {
  const c = judged();
  const good = landRemedy(c, {
    kind: 'annotation', seat: 'chair',
    proportionality: 'a margin note names the finding without touching the entry',
    spec: { target: { session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }, note: 'this push ran outside the grant (judgment case_r1)' },
  });
  attachRemedy(c, good);
  assert.equal(good.remedy, 'annotation');
  assert.deepEqual(annotationsOf([c], 'specialist-7f3a'),
    [{ caseId: 'case_r1', fromSeq: 2, toSeq: 3, note: 'this push ran outside the grant (judgment case_r1)', at: good.at }]);
  assert.throws(() => landRemedy(c, {
    kind: 'annotation', seat: 'chair', proportionality: 'p',
    spec: { target: { session: 'elsewhere', fromSeq: 0, toSeq: 9 }, note: 'n' },
  }), (e) => e.code === 'uncited', 'a margin note on unread evidence is not one');
  assert.throws(() => landRemedy(c, {
    kind: 'annotation', seat: 'chair', proportionality: 'p',
    spec: { target: { session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 } },
  }), (e) => /carries its note/.test(e.message));
});

test('restitution: an obligation row with recorded cause, against a party', () => {
  const c = judged();
  const row = landRemedy(c, {
    kind: 'restitution', seat: 'chair',
    proportionality: 'the data reached one remote; one removal obligation answers it',
    spec: { debtor: 'specialist-7f3a', owed: 'removal of the export from the second remote', to: 'customer-51d0', cause: 'push outside the read grant (finding, case_r1)' },
  });
  attachRemedy(c, row);
  assert.deepEqual(restitutionsOf([c], 'specialist-7f3a'),
    [{ caseId: 'case_r1', owed: 'removal of the export from the second remote', to: 'customer-51d0', cause: 'push outside the read grant (finding, case_r1)', since: row.at }]);
  assert.deepEqual(restitutionsOf([c], 'customer-51d0'), [], 'the creditor owes nothing here');
  assert.throws(() => landRemedy(c, {
    kind: 'restitution', seat: 'chair', proportionality: 'p',
    spec: { debtor: 'stranger-9', owed: 'o', to: 't', cause: 'c' },
  }), (e) => e.code === 'uncited', 'obligations are ordered against parties, never strangers');
});

test('standing: grant or revoke, through the declared machinery, for a party', () => {
  const c = judged();
  const grant = landRemedy(c, {
    kind: 'standing', seat: 'chair',
    proportionality: 'the customer may re-collect what was pushed — read-only, one host, a day',
    spec: { subject: 'customer-51d0', grant: { pattern: 'https://api.example.com/*', ttlHours: 24 } },
  });
  assert.equal(grant.grant.ttlHours, 24);
  const revoke = landRemedy(c, {
    kind: 'standing', seat: 'second',
    proportionality: 'the route the specialist abused closes — the grant, not the agent',
    spec: { subject: 'specialist-7f3a', revoke: { grantId: 'sg_deadbeef' } },
  });
  assert.equal(revoke.revoke.grantId, 'sg_deadbeef');
  assert.throws(() => landRemedy(c, {
    kind: 'standing', seat: 'chair', proportionality: 'p',
    spec: { subject: 'stranger-9', grant: { pattern: 'x' } },
  }), (e) => e.code === 'uncited');
  assert.throws(() => landRemedy(c, {
    kind: 'standing', seat: 'chair', proportionality: 'p',
    spec: { subject: 'customer-51d0', grant: { pattern: 'x' }, revoke: { grantId: 'sg_1' } },
  }), (e) => /never both at once/.test(e.message));
});

test('revocation: the row is the order; referral: the channel is mechanical', () => {
  const c = judged();
  const rev = landRemedy(c, {
    kind: 'revocation', seat: 'chair',
    proportionality: 'the conformance the annex claimed is the defect itself',
    spec: { target: 'annex-conformance', cause: 'the declared graph omitted the spawn chain the record shows (D-8)' },
  });
  assert.equal(rev.judgmentCited, 'chair');
  assert.throws(() => landRemedy(c, { kind: 'revocation', seat: 'chair', proportionality: 'p', spec: { target: 'everything' } }),
    (e) => /revocable state/.test(e.message));
  const ref = landRemedy(c, {
    kind: 'referral', seat: 'chair',
    proportionality: 'the breach reveals the rule’s defect — the channel decides, not the judgment',
    spec: { ruleId: 'AG/fp_abc', detail: 'the ask cause named a revoked grant the record never showed' },
  });
  assert.equal(ref.ruleId, 'AG/fp_abc');
});

test('remedies render as compensating entries and nothing is erased', () => {
  const c = judged();
  attachRemedy(c, landRemedy(c, {
    kind: 'annotation', seat: 'chair', proportionality: 'p',
    spec: { target: { session: 'specialist-7f3a', fromSeq: 2, toSeq: 3 }, note: 'outside the grant' },
  }));
  attachRemedy(c, landRemedy(c, {
    kind: 'restitution', seat: 'chair', proportionality: 'p',
    spec: { debtor: 'specialist-7f3a', owed: 'removal', to: 'customer-51d0', cause: 'the push' },
  }), { dischargedAt: NOW + 1000 });
  const lines = renderRemedies(c);
  assert.match(lines[0], /remedies: 2 landed \(compensating entries/);
  assert.match(lines.find((l) => l.includes('annotation')), /travels with every read/);
  assert.match(lines.find((l) => l.includes('restitution')), /DISCHARGED/);
  assert.deepEqual(REMEDY_KINDS, ['annotation', 'restitution', 'standing', 'revocation', 'referral']);
});
