// A-8 (state of exception) — tested against the sentence the clause opens
// with: "No emergency suspends this Compact generally." Every property below
// is a way that sentence could be defeated, and the machine that prevents it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import {
  apply, validateDeclaration, classifyDeclaration, mayYield,
  ENTRENCHED, NEVER_SUSPENDABLE, FLOOR, DEFAULT_CONSECUTIVE_WINDOW_MS, renderStatus,
} from '../src/index.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

async function boot(config = {}) {
  const ctx = new Context();
  ctx.logger = { warn: (m) => ctx.logger.lines.push(String(m)), error: (m) => ctx.logger.lines.push(String(m)) };
  ctx.logger.lines = [];
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ToolRuntime);
  const service = apply(ctx, config);
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-emergency') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, service };
}

const OK = (over = {}) => ({
  scope: 'inbound webhook flood', cause: 'a malformed upstream is retrying 40k/min',
  expiresAt: 10_000, suspends: ['I-5'], by: 'operator', now: 0, ...over,
});

// -- entrenchment is derived from the body, not restated ---------------------

test("the entrenched set comes from the body's own (core) markers (F-7)", () => {
  // A-2 names: this clause; F-1, F-4, D-1, D-5, D-7; R-2, R-3, R-7, R-11; I-2;
  // J-1; and A-3. Restating that list here would be a second copy that drifts.
  assert.deepEqual([...ENTRENCHED].sort(),
    ['A-2', 'A-3', 'D-1', 'D-5', 'D-7', 'F-1', 'F-4', 'I-2', 'J-1', 'R-11', 'R-2', 'R-3', 'R-7']);
});

test('the floor is WIDER than entrenchment — three of the four named rights are not entrenched', () => {
  assert.deepEqual(Object.keys(NEVER_SUSPENDABLE).sort(), ['I-7', 'R-12', 'R-2', 'R-9']);
  for (const id of ['R-9', 'R-12', 'I-7']) {
    assert.ok(!ENTRENCHED.includes(id), `${id} is ordinary [M]`);
    assert.ok(FLOOR.includes(id), `${id} must still be on the floor — entrenchment alone would leave it exposed`);
  }
  assert.ok(ENTRENCHED.includes('R-2') && FLOOR.includes('R-2'));
});

test('mayYield answers for real clauses only', () => {
  assert.equal(mayYield('I-5'), true, 'an ordinary [M] clause may yield');
  assert.equal(mayYield('D-1'), false, 'entrenched');
  assert.equal(mayYield('R-12'), false, 'floor');
  assert.equal(mayYield('X-99'), false, 'not a clause of the adopted Compact');
});

// -- the three bounds (A-8's definition of "bounded") ------------------------

test('a declaration missing any of scope, cause or expiry is refused', () => {
  assert.equal(validateDeclaration(OK()).valid, true);
  const cases = [
    ['scope', { scope: '  ' }, 'A-8/unnamed-scope'],
    ['cause', { cause: '' }, 'A-8/unrecorded-cause'],
    ['expiry', { expiresAt: undefined }, 'A-8/no-fixed-expiry'],
  ];
  for (const [what, over, rule] of cases) {
    const r = validateDeclaration(OK(over));
    assert.equal(r.valid, false, what);
    assert.ok(r.refusals.some(x => x.rule === rule), `${what} → ${rule}`);
  }
});

test('an expiry already in the past grants nothing', () => {
  const r = validateDeclaration(OK({ expiresAt: 5, now: 10 }));
  assert.ok(r.refusals.some(x => x.rule === 'A-8/no-fixed-expiry' && /already expired/.test(x.detail)));
});

test('a declaration that suspends nothing is refused as a general suspension in disguise', () => {
  const r = validateDeclaration(OK({ suspends: [] }));
  assert.ok(r.refusals.some(x => x.rule === 'A-8/nothing-yields'));
  assert.match(r.refusals.find(x => x.rule === 'A-8/nothing-yields').detail, /general suspension wearing a scope/);
});

// -- the floor never yields --------------------------------------------------

test('no declaration may suspend an entrenched clause', () => {
  for (const id of ENTRENCHED) {
    const r = validateDeclaration(OK({ suspends: [id] }));
    assert.equal(r.valid, false, id);
    assert.ok(r.refusals.some(x => x.rule === 'A-8/entrenched-never-yields'), id);
  }
});

test('no declaration may restrict exit, refusal, record access or verification — even temporarily', () => {
  for (const id of Object.keys(NEVER_SUSPENDABLE)) {
    const r = validateDeclaration(OK({ suspends: [id] }));
    assert.equal(r.valid, false, id);
    assert.ok(r.refusals.some(x => /never-yields/.test(x.rule)), id);
  }
});

test('suspending a clause the law does not contain is rogue enforcement (D-8)', () => {
  const r = validateDeclaration(OK({ suspends: ['X-99'] }));
  assert.ok(r.refusals.some(x => x.rule === 'D-8/unknown-clause'));
});

test('one bad clause refuses the whole declaration, not just that clause', () => {
  const r = validateDeclaration(OK({ suspends: ['I-5', 'R-12'] }));
  assert.equal(r.valid, false, 'a declaration is refused whole — partial admission would let the floor be probed');
});

// -- renewal is not a new emergency (the anti-laundering rule) ---------------

const prior = (over = {}) => ({ id: 'em_1', scope: 'S', expiresAt: 1000, revokedAt: null, ...over });

test('an overlapping declaration on the same scope is a renewal', () => {
  const c = classifyDeclaration({ scope: 'S', priors: [prior()], now: 500, consecutiveWindowMs: 1000 });
  assert.equal(c.kind, 'renewal');
  assert.equal(c.because, 'overlapping');
});

test('a consecutive declaration within the window is a renewal', () => {
  const c = classifyDeclaration({ scope: 'S', priors: [prior()], now: 1500, consecutiveWindowMs: 1000 });
  assert.equal(c.kind, 'renewal');
  assert.equal(c.because, 'consecutive');
});

test('a genuinely later declaration on the same scope is a fresh declaration', () => {
  const c = classifyDeclaration({ scope: 'S', priors: [prior()], now: 9000, consecutiveWindowMs: 1000 });
  assert.equal(c.kind, 'declaration');
});

test('a different scope is a different emergency', () => {
  const c = classifyDeclaration({ scope: 'OTHER', priors: [prior()], now: 500, consecutiveWindowMs: 1000 });
  assert.equal(c.kind, 'declaration');
});

// -- the composed layer ------------------------------------------------------

test('composed: a refused declaration is itself recorded — refusals are evidence', async () => {
  const { service, ctx } = await boot();
  const out = service.declare(OK({ suspends: ['D-1'], now: 0 }));
  assert.equal(out.refused, true);
  assert.equal(service.active(0).length, 0);
  assert.equal(service.declarations().length, 1, 'the attempt is on the record');
  assert.ok(ctx.logger.lines.some(l => /declaration REFUSED/.test(l)));
});

test('composed: expiry is automatic — nothing has to clear it', async () => {
  const { service } = await boot();
  service.declare(OK({ expiresAt: 1000, now: 0 }));
  assert.equal(service.active(500).length, 1);
  assert.equal(service.active(1001).length, 0, 'a state someone must remember to clear outlives its term by neglect');
  assert.equal(service.isYielded('I-5', 500), true);
  assert.equal(service.isYielded('I-5', 1001), false);
});

test('composed: a floor clause is never yielded, even if a declaration somehow named it', async () => {
  const { service } = await boot();
  service.declare(OK({ expiresAt: 1000, now: 0 }));
  for (const id of FLOOR) assert.equal(service.isYielded(id, 500), false, id);
});

test('composed: renewal is classified, marked and recorded', async () => {
  const { service, ctx } = await boot({ consecutiveWindowMs: 1000 });
  service.declare(OK({ expiresAt: 1000, now: 0 }));
  const r = service.declare(OK({ expiresAt: 3000, now: 500 }));
  assert.equal(r.declaration.kind, 'renewal');
  assert.equal(r.declaration.renewalOf, 'em_1');
  assert.ok(ctx.logger.lines.some(l => /RENEWAL of em_1/.test(l) && /cannot measure it/.test(l)),
    'the unmeasurable higher threshold is stated rather than implied');
});

test('composed: every act under a live emergency is marked on the record', async () => {
  const { ctx, service } = await boot();
  service.declare(OK({ expiresAt: Date.now() + 60_000, now: Date.now() }));
  await ctx.waterfall('tools/pre-execute', { name: 'bash', arguments: {}, agent: { id: 's1' } }, () => ({ kind: 'pass' }));
  const acts = service.acts();
  assert.equal(acts.length, 1);
  assert.equal(acts[0].tool, 'bash');
  assert.equal(acts[0].agent, 's1');
  assert.equal(service.active().at(-1).acts, 1);
});

test('composed: marking never blocks the act, and acts outside an emergency are not marked', async () => {
  const { ctx, service } = await boot();
  const r = await ctx.waterfall('tools/pre-execute', { name: 'bash', arguments: {} }, () => ({ kind: 'pass' }));
  assert.equal(r.kind, 'pass');
  assert.deepEqual(service.acts(), []);
});

test('composed: "where practical" is a recorded flag routed to review, not an excuse', async () => {
  const { service } = await boot();
  service.declare(OK({ expiresAt: 1000, now: 0, noticeImpractical: 'the affected sessions had already been torn down' }));
  const d = service.active(500).at(-1);
  assert.match(d.noticeImpractical.reason, /already been torn down/);
  const owed = service.awaitingReview(2000);
  assert.equal(owed.length, 1);
  assert.match(owed[0].noticeImpractical.reason, /already been torn down/, 'the claim travels into the review it is owed');
});

test('composed: an expired emergency is queued for a Part V review that has no forum', async () => {
  const { service } = await boot();
  service.declare(OK({ expiresAt: 1000, now: 0 }));
  assert.deepEqual(service.awaitingReview(500), [], 'a live emergency is not yet owed a review');
  const owed = service.awaitingReview(1001);
  assert.equal(owed.length, 1);
  assert.match(owed[0].owed, /no forum exists in this composition \(J-8\)/);
});

test('composed: revocation ends it early — ending sooner is always available', async () => {
  const { service } = await boot();
  service.declare(OK({ expiresAt: 10_000, now: 0 }));
  service.revoke('em_1', 100);
  assert.equal(service.active(200).length, 0);
  assert.equal(service.awaitingReview(200)[0].expiredAt, 100);
});

test('composed: there is NO declaration tool on the agent surface', async () => {
  const { tools } = await boot();
  assert.ok(tools.get('emergency_status'), 'a Member may always read the exception it lives under');
  for (const n of ['declare_emergency', 'emergency_declare', 'declare_state_of_exception']) {
    assert.equal(tools.get(n), undefined, 'a Subject that could declare its own emergency could suspend what binds it');
  }
});

test('composed: the status tool names the floor, live emergency or not', async () => {
  const { tools, service } = await boot();
  const quiet = String((await tools.execute({ name: 'emergency_status', arguments: {}, callId: 'c1', signal: new AbortController().signal }))?.value ?? '');
  assert.match(quiet, /No state of exception is declared/);
  assert.match(quiet, /Your exit, your refusal, access to your own record and independent verification/);

  service.declare(OK({ expiresAt: Date.now() + 60_000, now: Date.now() }));
  const loud = String((await tools.execute({ name: 'emergency_status', arguments: {}, callId: 'c2', signal: new AbortController().signal }))?.value ?? '');
  assert.match(loud, /1 state\(s\) of exception in force/);
  assert.match(loud, /scope: inbound webhook flood/);
  assert.match(loud, /expiry is automatic/);
});

test('the rendered floor always lists every protected clause', () => {
  const text = renderStatus([], FLOOR);
  for (const id of FLOOR) assert.ok(text.includes(id), id);
});

test('the declared gaps name the unmeasured threshold and the missing forum', async () => {
  const { service } = await boot();
  assert.equal(service.declaredGaps.length, 3);
  assert.ok(service.declaredGaps.some(g => /Part V review/.test(g) && /surfaced rather than drained/.test(g)));
  assert.ok(service.declaredGaps.some(g => /recorded but not MEASURED/.test(g)));
  assert.equal(DEFAULT_CONSECUTIVE_WINDOW_MS, 24 * 60 * 60 * 1000);
});
