// R-11 (petition and amendment — core, entrenched), I-6 (contestation
// machinery), A-5 (reasons and dissent). Tested for the properties that make
// the right real rather than decorative: the channel cannot be closed, a
// vacuous answer does not discharge the duty, the term runs on its own, and
// the amendment invitation fires with nobody deciding to notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PetitionRegister, CollisionCounter, responseConformance, nonConformingEnvelope,
  PETITION_TARGETS, DEFAULT_INVITATION_THRESHOLD, GATE,
} from '../src/index.js';

const GOOD = {
  ruleId: 'A-7/statute-making',
  reason: 'the proposed change belongs in statute, not the body',
  motivation: 'the clause it would amend is generic by design; adding mechanism here would bind every runtime to one shape',
  lawfulNextMoves: ['refile against enforcer-conduct', 'propose the statute text'],
  outcome: 'redirected',
};

// -- the channel (R-11, I-6) -------------------------------------------------

test('a petition may target the law itself or the Enforcer\'s conduct — R-11 names both', () => {
  const r = new PetitionRegister();
  assert.deepEqual(Object.keys(PETITION_TARGETS), ['compact', 'enforcer-conduct']);
  assert.equal(r.file({ by: 'm1', target: 'compact', proposal: 'p', reasons: 'r' }).target, 'compact');
  assert.equal(r.file({ by: 'm1', target: 'enforcer-conduct', proposal: 'p', reasons: 'r' }).target, 'enforcer-conduct');
});

test('an unrecognized target is filed against conduct rather than refused — the channel never closes', () => {
  const r = new PetitionRegister();
  const p = r.file({ by: 'm1', target: 'nonsense', proposal: 'p', reasons: 'r' });
  assert.equal(p.target, 'enforcer-conduct');
  assert.equal(p.declaredTarget, 'nonsense', 'what the Member actually said is kept on the record');
});

// -- the term is derived, not stored (I-6) -----------------------------------

test('a petition goes overdue on the clock, with nobody setting a flag', () => {
  const r = new PetitionRegister({ termMs: 1000 });
  const p = r.file({ by: 'm1', target: 'compact', proposal: 'p', reasons: 'r', now: 0 });
  assert.equal(r.stateOf(p, 500), 'open');
  assert.equal(r.stateOf(p, 1500), 'overdue', 'a state someone must remember to set is a state that stays open forever');
  assert.deepEqual(r.overdue(1500).map(x => x.id), [p.id]);
  assert.deepEqual(r.overdue(500), []);
});

test('answering stops the clock', () => {
  const r = new PetitionRegister({ termMs: 1000 });
  const p = r.file({ by: 'm1', target: 'compact', proposal: 'p', reasons: 'r', now: 0 });
  r.respond({ id: p.id, response: GOOD, by: 'operator', now: 500 });
  assert.equal(r.stateOf(p, 99_999), 'answered');
  assert.deepEqual(r.overdue(99_999), []);
});

// -- a vacuous response does not answer (R-11's mechanical half) --------------

test('conformance requires every I-4 field plus the motivation (D-7, A-5)', () => {
  assert.equal(responseConformance(GOOD).conforming, true);
  assert.deepEqual(responseConformance({}).missing, ['ruleId', 'reason', 'lawfulNextMoves', 'motivation']);
  assert.deepEqual(responseConformance({ ...GOOD, lawfulNextMoves: [] }).missing, ['lawfulNextMoves'],
    'a decision that leaves no lawful move is not a reasoned response');
  assert.deepEqual(responseConformance({ ...GOOD, motivation: '   ' }).missing, ['motivation'],
    'whitespace is not a motivation');
  assert.equal(responseConformance(null).conforming, false);
});

test('a vacuous response is REFUSED — the petition stays open and its term keeps running', () => {
  const r = new PetitionRegister({ termMs: 1000 });
  const p = r.file({ by: 'm1', target: 'compact', proposal: 'p', reasons: 'r', now: 0 });
  const out = r.respond({ id: p.id, response: { ruleId: 'X', reason: 'no' }, by: 'operator', now: 100 });
  assert.match(out.error, /detectably non-conforming and does not discharge the duty/);
  assert.equal(p.answeredAt, null, 'the duty is not discharged');
  assert.equal(r.stateOf(p, 1500), 'overdue', 'the term kept running through the refused attempt');
  assert.equal(p.nonConformingAttempts.length, 1, 'and the attempt is on the record');
  assert.deepEqual(p.nonConformingAttempts[0].missing, ['lawfulNextMoves', 'motivation']);
});

test('the refusal envelope names the rule and what a conforming answer needs', () => {
  const env = nonConformingEnvelope(['motivation']);
  assert.equal(env.gate, GATE);
  assert.equal(env.ruleId, 'R-11/vacuous-response');
  assert.ok(env.lawfulNextMoves.length >= 3);
  assert.match(env.text, /Lawful next moves:/);
});

test('a decision is not overwritten — it is amended by a new petition (A-5)', () => {
  const r = new PetitionRegister();
  const p = r.file({ by: 'm1', target: 'compact', proposal: 'p', reasons: 'r' });
  r.respond({ id: p.id, response: GOOD, by: 'operator' });
  const again = r.respond({ id: p.id, response: { ...GOOD, outcome: 'accepted' }, by: 'operator' });
  assert.match(again.error, /already answered/);
  assert.equal(p.response.outcome, 'redirected', 'the original decision stands on the record');
});

// -- dissent is preserved with its decision (A-5) ----------------------------

test('a dissent is bound to the decision it dissents from', () => {
  const r = new PetitionRegister();
  const p = r.file({ by: 'm1', target: 'compact', proposal: 'p', reasons: 'r' });
  r.respond({ id: p.id, response: GOOD, by: 'operator', now: 500 });
  const { dissent } = r.dissent({ id: p.id, by: 'm2', reasons: 'the body is the right home for this after all', now: 600 });
  assert.equal(dissent.dissentsFrom.at, 500);
  assert.equal(dissent.dissentsFrom.outcome, 'redirected');
  assert.equal(p.dissents.length, 1);
});

test('a dissent needs reasons, and needs a decision to dissent from', () => {
  const r = new PetitionRegister();
  const p = r.file({ by: 'm1', target: 'compact', proposal: 'p', reasons: 'r' });
  assert.match(r.dissent({ id: p.id, by: 'm2', reasons: 'x' }).error, /no decision yet/);
  r.respond({ id: p.id, response: GOOD, by: 'operator' });
  assert.match(r.dissent({ id: p.id, by: 'm2', reasons: '  ' }).error, /without reasons preserves nothing/);
  assert.equal(p.dissents.length, 0);
});

test('dissents accumulate and nothing removes one', () => {
  const r = new PetitionRegister();
  const p = r.file({ by: 'm1', target: 'compact', proposal: 'p', reasons: 'r' });
  r.respond({ id: p.id, response: GOOD, by: 'operator' });
  r.dissent({ id: p.id, by: 'm2', reasons: 'first' });
  r.dissent({ id: p.id, by: 'm3', reasons: 'second' });
  assert.deepEqual(p.dissents.map(d => d.reasons), ['first', 'second']);
  assert.ok(!Object.getOwnPropertyNames(PetitionRegister.prototype).some(m => /remove|delete|purge/i.test(m)),
    'the register exposes no way to drop a dissent (A-5)');
});

// -- collisions and the mechanical invitation (R-11) -------------------------

test('distinct instances count; repetitions of the same one do not', () => {
  const c = new CollisionCounter({ threshold: 3 });
  for (let i = 0; i < 20; i++) c.record({ ruleId: 'I-5/uncovered', fingerprint: 'same-op' });
  assert.equal(c.distinctCount('I-5/uncovered'), 1, 'one operation retried twenty times is one collision');
  assert.deepEqual(c.invitations, [], 'being stuck is the LoopGuard\'s business, not the legislature\'s');
});

test('enough DISTINCT operations against one rule invites an amendment, mechanically', () => {
  const c = new CollisionCounter({ threshold: 3 });
  assert.equal(c.record({ ruleId: 'I-5/uncovered', fingerprint: 'op1' }), null);
  assert.equal(c.record({ ruleId: 'I-5/uncovered', fingerprint: 'op2' }), null);
  const invitation = c.record({ ruleId: 'I-5/uncovered', fingerprint: 'op3' });
  assert.ok(invitation, 'the threshold fires it — there is no approval step to decline');
  assert.equal(invitation.distinctInstances, 3);
  assert.match(invitation.reason, /either the rule is wrong for this jurisdiction, or practice is/);
});

test('the threshold is declared a convention, never called statutory', () => {
  const c = new CollisionCounter({ threshold: 1 });
  const invitation = c.record({ ruleId: 'X-1', fingerprint: 'op' });
  assert.match(invitation.thresholdBasis, /composition convention/);
  assert.match(invitation.thresholdBasis, /no statute has been enacted/);
  assert.equal(DEFAULT_INVITATION_THRESHOLD, 5);
});

test('an invitation issues once per rule — a standing signal does not drown itself', () => {
  const c = new CollisionCounter({ threshold: 2 });
  c.record({ ruleId: 'R', fingerprint: 'a' });
  assert.ok(c.record({ ruleId: 'R', fingerprint: 'b' }));
  assert.equal(c.record({ ruleId: 'R', fingerprint: 'c' }), null);
  assert.equal(c.invitations.length, 1);
});

test('collisions separate by rule', () => {
  const c = new CollisionCounter({ threshold: 2 });
  c.record({ ruleId: 'A', fingerprint: 'x' });
  c.record({ ruleId: 'B', fingerprint: 'x' });
  assert.equal(c.distinctCount('A'), 1);
  assert.equal(c.distinctCount('B'), 1);
  assert.deepEqual(c.invitations, []);
});

test("a Member's own flag counts as a recorded collision (R-11's flagging right)", () => {
  const c = new CollisionCounter({ threshold: 2 });
  c.flag({ ruleId: 'I-5/uncovered', detail: 'the gate blocks a lawful read', by: 'm1' });
  const { invitation } = c.flag({ ruleId: 'I-5/uncovered', detail: 'again, different file', by: 'm2' });
  assert.ok(invitation, 'the clause does not privilege the Enforcer\'s view of friction');
  assert.equal(c.flags.length, 2);
  assert.equal(c.flags[0].by, 'm1');
});

test('a refusal with no rule id still counts, attributed as unattributed rather than dropped', () => {
  const c = new CollisionCounter({ threshold: 1 });
  const invitation = c.record({ fingerprint: 'op' });
  assert.equal(invitation.ruleId, 'unattributed');
});

test('the friction board ranks rules by distinct collisions', () => {
  const c = new CollisionCounter({ threshold: 99 });
  c.record({ ruleId: 'quiet', fingerprint: 'a' });
  for (const fp of ['a', 'b', 'c']) c.record({ ruleId: 'loud', fingerprint: fp });
  const board = c.board();
  assert.equal(board[0].ruleId, 'loud');
  assert.equal(board[0].distinctInstances, 3);
  assert.equal(board[0].invited, false);
});
