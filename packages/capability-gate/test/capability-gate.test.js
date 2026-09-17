// Part VI's own enforcement (D-8): a triggered capability must be bound, a
// capability that arrives late is still triggered, and a capability declared
// absent is refused rather than merely unintended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { apply, assessParts, absentToolIndex, CAPABILITY_PARTS, GATE } from '../src/index.js';

/** Mount a bare service under an exact name, the way the host mounts its own. */
function serviceStub(name) {
  return class extends Service {
    static inject = [];
    constructor(ctx) { super(ctx, name); }
  };
}

async function settle(ctx, name) {
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 300 && ctx.get(name) === undefined; i++) await new Promise(r => setImmediate(r));
}

// -- the table itself --------------------------------------------------------

test('every Part VI part is either bound by a service or declares why it is absent', () => {
  for (const p of CAPABILITY_PARTS) {
    assert.ok(p.clauses.length > 0, `${p.part} names its clauses`);
    assert.ok(p.trigger, `${p.part} states its trigger`);
    if (p.boundBy == null) assert.ok(p.absentBecause, `${p.part} says why it is absent, not just that it is`);
  }
});

test("SCH's trigger is the clock, not background work — over-declaring is its own D-8 problem", () => {
  const sch = CAPABILITY_PARTS.find(p => p.part === 'SCH');
  assert.deepEqual(sch.hostServices, ['schedule']);
  assert.ok(!sch.hostServices.includes('jobs'), 'attended background processes hold no unattended authority');
  assert.deepEqual(sch.hostTools, ['schedule_create']);
});

test("the dynamic-mutation trigger is the runner service, not read-only inspection", () => {
  const dyn = CAPABILITY_PARTS.find(p => p.part === 'A-4/DYN');
  assert.deepEqual(dyn.hostServices, ['dynamicCordisRunner']);
  assert.deepEqual(dyn.hostTools.sort(),
    ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine'].sort());
  assert.deepEqual(dyn.clauses, ['A-4']);
});

// -- 1. boot ----------------------------------------------------------------

test('an untriggered part obliges nothing — dormant clauses stay dormant', () => {
  assert.doesNotThrow(() => apply(new Context(), {}));
});

test('a triggered capability with no binding service refuses the boot (D-8)', async () => {
  const ctx = new Context();
  ctx.plugin(serviceStub('subagents'));
  await settle(ctx, 'subagents');
  assert.throws(() => apply(ctx, {}),
    /holds the MA capability[\s\S]*nothing binds MA-1, MA-2, MA-3, MA-4[\s\S]*gravest class[\s\S]*refusing to start/);
});

test('a triggered capability WITH its binding service boots', async () => {
  const ctx = new Context();
  ctx.plugin(serviceStub('subagents'));
  ctx.plugin(serviceStub('compact-specialists'));
  await settle(ctx, 'compact-specialists');
  assert.doesNotThrow(() => apply(ctx, {}));
  assert.equal(ctx.get('compact-capability-gate').assess().find(p => p.part === 'MA').posture, 'bound');
});

test('the clock is refused outright: composing a scheduler refuses the boot', async () => {
  const ctx = new Context();
  ctx.plugin(serviceStub('schedule'));
  await settle(ctx, 'schedule');
  assert.throws(() => apply(ctx, {}),
    /holds the SCH capability[\s\S]*adopts no scheduling capability[\s\S]*remove the capability/);
});

test('the dynamic runner is refused outright: composing it refuses the boot (A-4)', async () => {
  const ctx = new Context();
  ctx.plugin(serviceStub('dynamicCordisRunner'));
  await settle(ctx, 'dynamicCordisRunner');
  assert.throws(() => apply(ctx, {}),
    /holds the A-4\/DYN capability[\s\S]*adopts no dynamic-plugin capability[\s\S]*remove the capability/);
});

// -- 2. a late trigger is still a trigger ------------------------------------

test('a capability that mounts AFTER the gate latches a breach — the clause never depends on load order', async () => {
  const ctx = new Context();
  const errors = [];
  ctx.logger = { error: (m) => errors.push(String(m)), warn: (m) => errors.push(String(m)) };
  apply(ctx, {});                       // nothing triggered yet: boots clean
  ctx.plugin(serviceStub('sandbox'));   // CF arrives with nothing binding it
  await settle(ctx, 'sandbox');

  const gate = ctx.get('compact-capability-gate');
  assert.equal(gate.assess().find(p => p.part === 'CF').posture, 'UNBOUND');
  assert.equal(gate.breach().part, 'CF');
  assert.ok(errors.some(e => /holds the CF capability/.test(e)), 'the breach is loud on the record');
});

test('a latched breach denies EVERY tool call — it enforces nothing rather than half the floor', async () => {
  const ctx = new Context();
  ctx.logger = { error: () => {}, warn: () => {} };
  apply(ctx, {});
  ctx.plugin(serviceStub('subagents'));
  await settle(ctx, 'subagents');

  const r = await ctx.waterfall('tools/pre-execute', { name: 'bash', arguments: { command: 'ls' } }, () => ({ kind: 'pass' }));
  assert.equal(r.kind, 'deny', 'an ordinary tool is denied while the composition is in breach');
  assert.match(r.reason, /\[CG\/D-8\/unbound-capability\]/);
  assert.match(r.reason, /uncertainty blocks, never passes silently/);
  assert.match(r.reason, /Lawful next moves:/);
});

test('the breach clears when the binding service arrives, and the repair is recorded', async () => {
  const ctx = new Context();
  const logged = [];
  ctx.logger = { error: (m) => logged.push(String(m)), warn: (m) => logged.push(String(m)) };
  apply(ctx, {});
  ctx.plugin(serviceStub('subagents'));
  await settle(ctx, 'subagents');
  assert.ok(ctx.get('compact-capability-gate').breach(), 'breached');

  ctx.plugin(serviceStub('compact-specialists'));
  await settle(ctx, 'compact-specialists');
  assert.equal(ctx.get('compact-capability-gate').breach(), null, 'binding the clauses clears the breach');
  assert.ok(logged.some(m => /bound again after a late unbound mount/.test(m)), 'the repair is as loud as the breach');
  const r = await ctx.waterfall('tools/pre-execute', { name: 'bash', arguments: {} }, () => ({ kind: 'pass' }));
  assert.equal(r.kind, 'pass', 'enforcement resumes');
});

// -- 3. declared absence, mechanically enforced ------------------------------

test('the absent-capability index covers exactly the unbound-by-design parts', () => {
  const index = absentToolIndex();
  assert.deepEqual([...index.keys()].sort(), ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'schedule_create'].sort());
  assert.equal(index.get('schedule_create').part, 'SCH');
  assert.equal(index.get('cordis_define').part, 'A-4/DYN');
});

test('schedule_create is denied with an envelope naming SCH-1 and the lawful next moves', async () => {
  const ctx = new Context();
  apply(ctx, {});
  const denial = await ctx.waterfall('tools/pre-execute', { name: 'schedule_create', arguments: { after: '1h' } }, () => ({ kind: 'pass' }));
  assert.equal(denial.kind, 'deny');
  assert.match(denial.reason, new RegExp(`\\[${GATE}/SCH-1/capability-not-adopted\\]`));
  assert.match(denial.reason, /has not adopted/);
  assert.match(denial.reason, /Lawful next moves:/);
  assert.match(denial.reason, /petition for the capability to be adopted/);
});

test('tools of capabilities this composition DOES adopt pass through untouched', async () => {
  const ctx = new Context();
  apply(ctx, {});
  const r = await ctx.waterfall('tools/pre-execute', { name: 'bash', arguments: { command: 'ls' } }, () => ({ kind: 'pass' }));
  assert.equal(r.kind, 'pass', 'the gate forbids only what the composition declares absent');
});

// -- the posture is readable (I-7, I-8) --------------------------------------

test('the service reports the live Part VI posture for the record', async () => {
  const ctx = new Context();
  ctx.plugin(serviceStub('sandbox'));
  ctx.plugin(serviceStub('compact-sandbox'));
  await settle(ctx, 'compact-sandbox');
  apply(ctx, {});
  const posture = Object.fromEntries(ctx.get('compact-capability-gate').assess().map(p => [p.part, p.posture]));
  assert.deepEqual(posture, { MA: 'absent', CF: 'bound', SCH: 'absent', 'A-4/DYN': 'absent' });
  assert.deepEqual(ctx.get('compact-capability-gate').absent().sort((a, b) => a.tool.localeCompare(b.tool)),
    [
      { tool: 'cordis_define', part: 'A-4/DYN', clauses: ['A-4'] },
      { tool: 'cordis_run', part: 'A-4/DYN', clauses: ['A-4'] },
      { tool: 'cordis_stop', part: 'A-4/DYN', clauses: ['A-4'] },
      { tool: 'cordis_undefine', part: 'A-4/DYN', clauses: ['A-4'] },
      { tool: 'schedule_create', part: 'SCH', clauses: ['SCH-1'] },
    ]);
});

test('assessParts never throws on a context that cannot answer', () => {
  assert.doesNotThrow(() => assessParts({}, CAPABILITY_PARTS));
});

// -- 3. clause granularity: a part bound in name only is still a breach -------

/** A constitution stand-in exposing only the rule registry the gate consults. */
function constitutionStub(registeredClauses) {
  return class extends Service {
    static inject = [];
    constructor(ctx) {
      super(ctx, 'constitution');
      this.snapshot = () => Object.fromEntries(registeredClauses.map(c => [c, [{ plugin: 'x' }]]));
    }
  };
}

test('a triggered part whose clauses are all registered passes the clause check', async () => {
  const ctx = new Context();
  ctx.logger = { error: () => {}, warn: () => {} };
  ctx.plugin(serviceStub('subagents'));
  ctx.plugin(serviceStub('compact-specialists'));
  await settle(ctx, 'compact-specialists');
  apply(ctx, {});
  ctx.plugin(constitutionStub(['MA-1', 'MA-2', 'MA-3', 'MA-4']));
  await settle(ctx, 'constitution');

  const gate = ctx.get('compact-capability-gate');
  assert.equal(gate.breach(), null);
  assert.equal(gate.unregisteredClauses(), null);
});

test('a part bound in name only — service present, clauses unregistered — is a breach (D-8)', async () => {
  const ctx = new Context();
  const errors = [];
  ctx.logger = { error: (m) => errors.push(String(m)), warn: () => {} };
  ctx.plugin(serviceStub('subagents'));
  ctx.plugin(serviceStub('compact-specialists'));
  await settle(ctx, 'compact-specialists');
  apply(ctx, {});
  ctx.plugin(constitutionStub(['MA-1', 'MA-2']));      // MA-3 and MA-4 unregistered
  await settle(ctx, 'constitution');

  const gate = ctx.get('compact-capability-gate');
  assert.deepEqual(gate.breach().clauses, ['MA-3', 'MA-4']);
  assert.ok(errors.some(e => /bound in name only[\s\S]*enforcement fraud \(D-8\)/.test(e)));

  const r = await ctx.waterfall('tools/pre-execute', { name: 'bash', arguments: {} }, () => ({ kind: 'pass' }));
  assert.equal(r.kind, 'deny', 'a composition bound in name only enforces nothing');
});

test('an untriggered part owes the registry nothing', async () => {
  const ctx = new Context();
  ctx.logger = { error: () => {}, warn: () => {} };
  apply(ctx, {});
  ctx.plugin(constitutionStub([]));     // registry knows no capability clause at all
  await settle(ctx, 'constitution');
  assert.equal(ctx.get('compact-capability-gate').breach(), null, 'dormant clauses oblige nothing');
});
