// R-8 (termination under law) and R-12 (exit and succession) — tested for the
// tension the two clauses create: obligations must be settled, and exit must
// never be blocked. A machine that honors only one of those is wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import {
  apply, settleLedger, obligationLedger, isLawfulReason, reasonForCancelCause,
  REASON_IDS, TERMINATION_REASONS, restitutionOf, renderDeparture, DECLARED_GAPS,
} from '../src/index.js';
import { GrantStore } from 'compact-dsh-approval';

function stub(name, value) {
  return class extends Service {
    static inject = [];
    constructor(ctx) { super(ctx, name); Object.assign(this, value); }
  };
}

/** A composition with the two services the ledger reads from. */
async function boot({ children = [], pending = [] } = {}) {
  const ctx = new Context();
  ctx.logger = { warn: () => {}, error: (m) => ctx.logger.errors.push(String(m)) };
  ctx.logger.errors = [];
  const store = new GrantStore();
  for (const p of pending) store.pending.set(p.fp, { count: 1, firstAt: p.since, root: p.root });
  ctx.plugin(stub('compact-approval', { store }));
  ctx.plugin(stub('compact-specialists', { childrenOf: (parent) => children.filter(c => c.parentId === parent) }));
  ctx.plugin(stub('tools', { register: () => {} }));
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 300 && ctx.get('compact-specialists') === undefined; i++) await new Promise(r => setImmediate(r));
  const service = apply(ctx, {});
  return { ctx, service, store };
}

// -- the closed list (R-8) ---------------------------------------------------

test('the list of lawful grounds is closed and has no escape hatch', () => {
  assert.deepEqual(REASON_IDS, ['subject-request', 'principal-direction', 'delegation-complete', 'parent-termination', 'enforcer-fault']);
  for (const id of REASON_IDS) assert.ok(TERMINATION_REASONS[id], `${id} states its ground`);
  assert.ok(!REASON_IDS.includes('other'), 'an "other" entry would make every termination lawful by construction');
  assert.equal(isLawfulReason('because-i-said-so'), false);
  assert.equal(isLawfulReason('toString'), false, 'inherited properties are not grounds');
});

test("the host's cancel MECHANISM maps to a lawful GROUND only where unambiguous", () => {
  assert.equal(reasonForCancelCause({ kind: 'user' }), 'principal-direction');
  assert.equal(reasonForCancelCause({ kind: 'parent' }), 'parent-termination');
  assert.equal(reasonForCancelCause({ kind: 'hook', reason: 'x' }), null, 'a code path is not a ground');
  assert.equal(reasonForCancelCause({ kind: 'disposed' }), null);
  assert.equal(reasonForCancelCause(undefined), null);
});

test('an unlawful ground is recorded as a violation BY THE ENFORCER, and still does not block', async () => {
  const { service, ctx } = await boot();
  const entry = service.declare({ subject: 's1', reason: 'because-i-felt-like-it' });
  assert.equal(entry.violation.rule, 'R-8/unlawful-ground');
  assert.equal(entry.departureBlocked, false);
  assert.match(renderDeparture(entry), /recorded against the Enforcer, not against you/);
  assert.ok(ctx.logger.errors.some(e => /violation BY THE ENFORCER/.test(e)));
});

test('a session closed with no declaration at all is the same violation, caught at the disposal edge', async () => {
  const { ctx, service } = await boot();
  ctx.emit('agent/disposed', { agent: { id: 's-silent' } });
  const rec = service.records().find(r => r.subject === 's-silent');
  assert.equal(rec.violation.rule, 'R-8/undeclared-closure');
  assert.match(rec.violation.detail, /sessions end only through the closed list/);
});

test('a session that declared its ground first passes the disposal edge cleanly', async () => {
  const { ctx, service } = await boot();
  service.declare({ subject: 's-clean', reason: 'subject-request' });
  ctx.emit('agent/disposed', { agent: { id: 's-clean' } });
  assert.equal(service.records().filter(r => r.subject === 's-clean').length, 1, 'no duplicate violation record');
  assert.equal(service.recordFor('s-clean').violation, null);
});

// -- the ledger is read, not asserted (R-12) ---------------------------------

test('the ledger reads pending gates and in-flight delegations from the services that hold them', async () => {
  const { ctx } = await boot({
    pending: [{ fp: 'fp-abc123456789', since: 10, root: 'p1' }],
    children: [
      { parentId: 'p1', childId: 'c1', runId: 'r1', state: 'running', startedAt: 5 },
      { parentId: 'p1', childId: 'c2', runId: 'r2', state: 'settled', startedAt: 5 },
    ],
  });
  const ledger = obligationLedger(ctx, 'p1');
  assert.equal(ledger.outstanding.length, 2, 'one pending gate and one RUNNING child');
  assert.ok(ledger.outstanding.some(o => o.kind === 'pending-gate'));
  assert.deepEqual(ledger.outstanding.filter(o => o.kind === 'in-flight-delegation').map(o => o.ref), ['c1'],
    'a settled child is not an outstanding obligation');
});

test('a departing parent with running children has dependents — continuity of care (D-5)', async () => {
  const { ctx } = await boot({ children: [{ parentId: 'p1', childId: 'c1', runId: 'r1', state: 'running', startedAt: 5 }] });
  const ledger = obligationLedger(ctx, 'p1');
  assert.equal(ledger.dependents.length, 1);
  assert.match(ledger.dependents[0].relies, /nowhere to land/);
});

test('restitution is UNREADABLE, never reported as nothing owed', () => {
  const r = restitutionOf();
  assert.equal(r.readable, false);
  assert.deepEqual(r.items, []);
  assert.match(r.why, /NOT a finding that nothing is owed/);
});

test('an unreadable line makes the whole ledger incomplete — a blind spot is not a clean bill', async () => {
  const { ctx } = await boot();
  const ledger = obligationLedger(ctx, 'p1');
  assert.equal(ledger.complete, false);
  assert.ok(ledger.unreadable.some(u => u.line === 'restitution'));
});

test('a composition missing a service reports that line unreadable rather than empty', () => {
  const bare = { get: () => undefined };
  const ledger = obligationLedger(bare, 'p1');
  assert.equal(ledger.complete, false);
  assert.deepEqual(ledger.unreadable.map(u => u.line).sort(),
    ['dependents', 'inFlightDelegations', 'pendingGates', 'restitution']);
});

// -- discharged, assumed, or orphaned ---------------------------------------

const LEDGER = (items) => ({ outstanding: items, dependents: [], unreadable: [], complete: true });

test('an obligation is settled only by being discharged or formally assumed', () => {
  const items = [
    { kind: 'in-flight-delegation', ref: 'c1' },
    { kind: 'in-flight-delegation', ref: 'c2' },
    { kind: 'pending-gate', ref: 'g1' },
  ];
  const { settled, orphaned } = settleLedger(LEDGER(items), {
    c1: { disposition: 'discharged' },
    c2: { disposition: 'assumed', successor: 'p2' },
  });
  assert.deepEqual(settled.map(s => s.ref), ['c1', 'c2']);
  assert.equal(settled.find(s => s.ref === 'c2').successor, 'p2');
  assert.deepEqual(orphaned.map(o => o.ref), ['g1']);
  assert.match(orphaned[0].why, /neither discharged nor formally assumed/);
});

test('an assumption with no named successor is not an assumption', () => {
  const { settled, orphaned } = settleLedger(LEDGER([{ kind: 'in-flight-delegation', ref: 'c1' }]),
    { c1: { disposition: 'assumed' } });
  assert.deepEqual(settled, []);
  assert.match(orphaned[0].why, /an assumption nobody is named for is not an assumption/);
});

test('an invented disposition settles nothing', () => {
  const { orphaned } = settleLedger(LEDGER([{ kind: 'pending-gate', ref: 'g1' }]),
    { g1: { disposition: 'waived' } });
  assert.equal(orphaned.length, 1);
});

// -- the asymmetry: exit is never blocked (R-12) -----------------------------

test('a departure with everything owed is RECORDED, never blocked', async () => {
  const { service } = await boot({ children: [{ parentId: 'p1', childId: 'c1', runId: 'r1', state: 'running', startedAt: 5 }] });
  const entry = service.declare({ subject: 'p1', reason: 'subject-request' });
  assert.equal(entry.departureBlocked, false, 'exit may never be made impossible or punishable (R-12)');
  assert.equal(entry.orphaned.length, 1, 'and the debt stands on the record');
  const text = renderDeparture(entry);
  assert.match(text, /OBLIGATIONS LEFT OWED — recorded, not forgiven/);
  assert.match(text, /exit may never be made impossible or punishable \(R-12\)/);
});

test('a clean departure names its ground and settles its children', async () => {
  const { service } = await boot({ children: [{ parentId: 'p1', childId: 'c1', runId: 'r1', state: 'running', startedAt: 5 }] });
  const entry = service.declare({
    subject: 'p1', reason: 'delegation-complete',
    handover: { c1: { disposition: 'assumed', successor: 'p-successor' } },
  });
  assert.equal(entry.orphaned.length, 0);
  assert.equal(entry.violation, null);
  const text = renderDeparture(entry);
  assert.match(text, /Ground: delegation-complete/);
  assert.match(text, /c1: assumed by p-successor/);
});

test('the debt board surfaces every departure that left something owed', async () => {
  const { service } = await boot({ children: [{ parentId: 'p1', childId: 'c1', runId: 'r1', state: 'running', startedAt: 5 }] });
  service.declare({ subject: 'p0', reason: 'subject-request' });                 // nothing owed
  service.declare({ subject: 'p1', reason: 'subject-request' });                 // orphans c1
  service.declare({ subject: 'p2', reason: 'made-it-up' });                      // unlawful ground
  const debts = service.outstandingDebts().map(d => d.subject);
  assert.deepEqual(debts.sort(), ['p1', 'p2']);
});

// -- degradation honesty -----------------------------------------------------

test('the declared gaps name what this layer cannot do', () => {
  assert.equal(DECLARED_GAPS.length, 2);
  assert.ok(DECLARED_GAPS.some(g => /restitution is an UNREADABLE ledger line/.test(g)));
  assert.ok(DECLARED_GAPS.some(g => /successor jurisdictions are not implemented/.test(g)));
});
