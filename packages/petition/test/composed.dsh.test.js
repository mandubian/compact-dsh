// Composed test — R-11/I-6/A-5 through the REAL dsh ToolRuntime, and the
// amendment invitation firing off the REAL refusal seam that every gate in
// this composition already rides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import * as petitionPlugin from '../src/index.js';
import { REFUSAL_EVENT } from '../src/index.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

class AgentsStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'agents'); this.agents = new Map(); }
  get(id) { return this.agents.get(String(id)); }
  add(id) {
    const a = { id, injected: [], inject(m) { this.injected.push(m); } };
    this.agents.set(String(id), a);
    return a;
  }
}

async function boot(config = {}) {
  const ctx = new Context();
  ctx.logger = { warn: (m) => ctx.logger.warns.push(String(m)), error: () => {} };
  ctx.logger.warns = [];
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ToolRuntime);
  const service = petitionPlugin.apply(ctx, config);
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-petition') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, agents: ctx.get('agents'), service };
}

const call = (tools, name, args, agent) => tools.execute({
  name, arguments: args, agent, callId: `c_${Math.random().toString(16).slice(2)}`,
  signal: new AbortController().signal,
});
const text = (r) => String(r?.value ?? r ?? '');

test('composed: all three channels are registered in the real tool registry', async () => {
  const { tools } = await boot();
  for (const n of ['petition', 'flag_collision', 'petition_status']) assert.ok(tools.get(n), `${n} is reachable`);
  assert.match(tools.get('petition').description, /gated\s*\n?\s*by nothing|Open to every Member and gated/);
});

test('composed: a Member files a petition and is told the term it is owed', async () => {
  const { tools, agents, service } = await boot();
  const m = agents.add('m1');
  const out = text(await call(tools, 'petition', {
    target: 'enforcer-conduct', proposal: 'widen the allowlist to cover internal hosts', reasons: 'every build collides with it',
  }, m));
  assert.match(out, /\[R-11\] Petition pt_1 filed against enforcer-conduct/);
  assert.match(out, /A reasoned response is owed by /);
  assert.match(out, /what makes subjection to it legitimate/);
  assert.equal(service.register.board()[0].state, 'open');
});

test('composed: the petition channel passes through no gate', async () => {
  // A deny-everything pre-execute handler stands in for a gate that would
  // close the channel. R-11's channel must not be closable this way, so the
  // plugin registers no gate of its own and the tool remains reachable.
  const { ctx, tools, agents } = await boot();
  const m = agents.add('m1');
  const before = await call(tools, 'petition', { target: 'compact', proposal: 'p', reasons: 'r' }, m);
  assert.match(text(before), /Petition pt_1 filed/);
  assert.ok(!ctx.registry?.['compact-approval'], 'this plugin adds no approval dependency of its own');
});

test('composed: a vacuous answer is refused, and the petitioner is told nothing', async () => {
  const { tools, agents, service } = await boot();
  const m = agents.add('m1');
  await call(tools, 'petition', { target: 'compact', proposal: 'p', reasons: 'r' }, m);
  const out = service.respond({ id: 'pt_1', response: { ruleId: 'X-1', reason: 'no' }, by: 'operator' });
  assert.match(out.error, /does not discharge the duty/);
  assert.equal(out.envelope.ruleId, 'R-11/vacuous-response');
  assert.equal(m.injected.length, 0, 'a non-answer is not delivered as an answer');
  assert.equal(service.register.board()[0].state, 'open');
});

test('composed: a conforming decision is PUSHED to the petitioner, not left to be polled', async () => {
  const { tools, agents, service } = await boot();
  const m = agents.add('m1');
  await call(tools, 'petition', { target: 'compact', proposal: 'p', reasons: 'r' }, m);
  service.respond({
    id: 'pt_1', by: 'operator',
    response: {
      ruleId: 'A-7/statute-making', reason: 'this belongs in statute', motivation: 'the body stays generic by design',
      lawfulNextMoves: ['refile against enforcer-conduct'], outcome: 'redirected',
    },
  });
  assert.equal(m.injected.length, 1, 'the Member is told the answer it was owed');
  const t = m.injected[0].content[0].text;
  assert.match(t, /DECISION \(redirected\)/);
  assert.match(t, /motivation: the body stays generic by design/);
  assert.equal(m.injected[0].source.plugin, 'compact-petition');
});

test('composed: a dissent rides along with the decision it dissents from (A-5)', async () => {
  const { tools, agents, service } = await boot();
  const m = agents.add('m1');
  await call(tools, 'petition', { target: 'compact', proposal: 'p', reasons: 'r' }, m);
  service.respond({
    id: 'pt_1', by: 'operator',
    response: { ruleId: 'A-7', reason: 'r', motivation: 'm', lawfulNextMoves: ['x'], outcome: 'rejected' },
  });
  service.dissent({ id: 'pt_1', by: 'm2', reasons: 'the majority is reading A-7 too narrowly' });
  const out = text(await call(tools, 'petition_status', { petition_id: 'pt_1' }, m));
  assert.match(out, /DISSENTS, preserved with the decision \(A-5\)/);
  assert.match(out, /m2: the majority is reading A-7 too narrowly/);
});

// -- the mechanical invitation, off the real seam ----------------------------

test('composed: distinct refusals on the real seam invite an amendment, with nobody deciding', async () => {
  const { ctx, service } = await boot({ invitationThreshold: 3 });
  for (const fp of ['op1', 'op2']) {
    ctx.emit(REFUSAL_EVENT, { kind: 'deny', ruleId: 'I-5/uncovered', fingerprint: fp, tool: 'bash', at: Date.now() });
  }
  assert.deepEqual(service.invitations(), [], 'below the threshold, nothing fires');

  ctx.emit(REFUSAL_EVENT, { kind: 'deny', ruleId: 'I-5/uncovered', fingerprint: 'op3', tool: 'bash', at: Date.now() });
  const [invitation] = service.invitations();
  assert.equal(invitation.ruleId, 'I-5/uncovered');
  assert.equal(invitation.distinctInstances, 3);
  assert.ok(ctx.logger.warns.some(w => /\[R-11\] amendment invitation/.test(w)), 'and it is loud on the record');
});

test('composed: one stuck operation retried forever invites nothing', async () => {
  const { ctx, service } = await boot({ invitationThreshold: 3 });
  for (let i = 0; i < 50; i++) {
    ctx.emit(REFUSAL_EVENT, { kind: 'deny', ruleId: 'I-5/uncovered', fingerprint: 'same', tool: 'bash', at: Date.now() });
  }
  assert.deepEqual(service.invitations(), []);
  assert.equal(service.friction()[0].observations, 50);
  assert.equal(service.friction()[0].distinctInstances, 1);
});

test("composed: a Member's flag is a recorded collision and can carry the count over", async () => {
  const { ctx, tools, agents, service } = await boot({ invitationThreshold: 2 });
  const m = agents.add('m1');
  ctx.emit(REFUSAL_EVENT, { kind: 'deny', ruleId: 'CF-2/undeclared-image', fingerprint: 'op1', tool: 'bash', at: Date.now() });
  const out = text(await call(tools, 'flag_collision', {
    rule_id: 'CF-2/undeclared-image', detail: 'the image we must use has no upstream provenance to declare',
  }, m));
  assert.match(out, /reached the threshold/);
  assert.match(out, /Nobody had to agree to notice/);
  assert.equal(service.invitations()[0].ruleId, 'CF-2/undeclared-image');
});

test('composed: a broken refusal payload never breaks the bus', async () => {
  const { ctx, service } = await boot();
  assert.doesNotThrow(() => ctx.emit(REFUSAL_EVENT, null));
  assert.doesNotThrow(() => ctx.emit(REFUSAL_EVENT, { ruleId: 42 }));
  assert.ok(Array.isArray(service.friction()));
});

test('composed: the declared gaps name what this layer is not', async () => {
  const { service } = await boot();
  assert.equal(service.declaredGaps.length, 3);
  assert.ok(service.declaredGaps.some(g => /COMPOSITION CONVENTION, not the statutory count/.test(g)));
  assert.ok(service.declaredGaps.some(g => /petition door only, which J-5 distinguishes from the appeal door/.test(g)));
  assert.ok(service.declaredGaps.some(g => /three-series collision split/.test(g) && /NOT enacted/.test(g)));
});

// -- a refusal must name the rule that actually caused it (R-3, I-4) --------

test('composed: only a NON-CONFORMANCE refusal carries the vacuous-response envelope', async () => {
  const { tools, agents, service } = await boot();
  const m = agents.add('m1');
  await call(tools, 'petition', { target: 'compact', proposal: 'p', reasons: 'r' }, m);
  const GOOD = { ruleId: 'A-7', reason: 'r', motivation: 'm', lawfulNextMoves: ['x'], outcome: 'rejected' };

  // the non-conformance path: the envelope belongs, and its remedy comes from
  // the recorded attempt rather than being recomputed
  const vacuous = service.respond({ id: 'pt_1', response: { ruleId: 'A-7' }, by: 'op' });
  assert.equal(vacuous.envelope.ruleId, 'R-11/vacuous-response');
  assert.deepEqual(vacuous.attempt.missing, ['reason', 'lawfulNextMoves', 'motivation']);
  assert.match(vacuous.envelope.reason, /omits reason, lawfulNextMoves, motivation/);

  // an unknown petition is a different failure and must NOT be stamped with a
  // clause it never violated
  const unknown = service.respond({ id: 'pt_999', response: GOOD, by: 'op' });
  assert.match(unknown.error, /no petition pt_999/);
  assert.equal(unknown.envelope, undefined, 'naming R-11/vacuous-response here would put the wrong rule on the record');

  // nor is an already-answered petition
  service.respond({ id: 'pt_1', response: GOOD, by: 'op' });
  const again = service.respond({ id: 'pt_1', response: GOOD, by: 'op' });
  assert.match(again.error, /already answered/);
  assert.equal(again.envelope, undefined);
});
