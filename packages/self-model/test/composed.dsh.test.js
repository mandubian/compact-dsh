// Composed test — R-1 and R-13 through the REAL dsh ToolRuntime: the tools are
// registered and callable, the attestation reaches the Subject at its own turn
// boundary without being asked for, and a stale citation raises the alarm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import * as constitution from 'compact-dsh-constitution';
import * as selfModel from '../src/index.js';

function header(id, parentSession) {
  return {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1_700_000_000_000, isSeeded: false,
    ...(parentSession ? { parentSession, origin: 'subagent', delegationDepth: 1 } : {}),
  };
}

class AgentsStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'agents'); this.agents = new Map(); }
  get(id) { return this.agents.get(String(id)); }
  add(id, parentSession) {
    const agent = {
      id, status: 'idle', session: Session.create(id, [], header(id, parentSession)),
      injected: [], inject(m) { this.injected.push(m); },
    };
    this.agents.set(String(id), agent);
    return agent;
  }
}

// ToolRuntime composes against the host prompt registry; the stub is the same
// stand-in the other composed suites use.
class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

class ConstitutionStub extends Service {
  static inject = [];
  constructor(ctx) {
    super(ctx, 'constitution');
    this.digest = 'b'.repeat(64);
    this.source = { status: 'draft v0.5 — not yet ratified' };
    this.taughtDigest = () => 'taught';
    this.attestation = () => ({ gaps: ['the Compact is draft v0.5 and NOT yet ratified'] });
  }
}

async function boot() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ConstitutionStub);
  ctx.plugin(ToolRuntime);
  selfModel.apply(ctx, { staleAfterMs: 1000 });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-self-model') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, agents: ctx.get('agents'), service: ctx.get('compact-self-model') };
}

const call = (tools, name, args, agent) =>
  tools.execute({ name, arguments: args, agent, callId: `c_${Math.random().toString(16).slice(2)}`, signal: new AbortController().signal });

test('composed: both rights are reachable as tools in the real registry', async () => {
  const { tools } = await boot();
  assert.ok(tools.get('self_describe'), 'R-1 is exercisable by the Subject');
  assert.ok(tools.get('inquiry'), 'R-13 is exercisable by the Subject');
});

test('composed: the rendered tool result carries the attestation VALUE, not the arguments object', async () => {
  const { ctx, tools, agents } = await boot();
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });

  const result = await call(tools, 'self_describe', { citing_epoch: ctx.get('compact-self-model').issuedTo('s1').epoch }, agent);
  const rendered = result?.content?.map(c => c?.text ?? '').join('') ?? '';
  assert.match(rendered, /\[R-1\] Attestation/, 'the model-facing text is the attestation block');
  assert.ok(!rendered.includes('[object Object]'), 'render receives (args, value) — String(args) would leak the arguments object');
});

test('composed: the attestation arrives at the turn boundary, unasked (R-1)', async () => {
  const { ctx, agents } = await boot();
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });

  assert.equal(agent.injected.length, 1, 'the Subject asked for nothing and was told anyway');
  const text = agent.injected[0].content[0].text;
  assert.match(text, /\[R-1\] Attestation/);
  assert.match(text, /You are: s1/);
  assert.match(text, /Standing: none/);
  assert.match(text, /The law, in its taught form:\ntaught$/, 'the stub constitution\'s taught form closes the block');
  assert.equal(agent.injected[0].source.plugin, 'compact-self-model');
});

test('composed: the injected turn-start block carries the REAL constitution\'s taught form, in full', async () => {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ToolRuntime);
  // The REAL constitution service — the bundled body boot-verified against
  // its pinned digest — with the coupling roster and rule registry scoped
  // out so this suite need not compose the whole blessed set. The taught
  // form it serves is the body's own appendix: if compact.md changes, this
  // test's expectation changes with it.
  constitution.apply(ctx, { requires: [], register: { meta: { compactDigest: constitution.COMPACT_DIGEST }, entries: [] } });
  selfModel.apply(ctx, { staleAfterMs: 1000 });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-self-model') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  const agents = ctx.get('agents');
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });

  assert.equal(agent.injected.length, 1);
  const text = agent.injected[0].content[0].text;
  assert.match(text, /The law, in its taught form:/);
  assert.ok(text.includes(constitution.TAUGHT_DIGEST),
    'the appendix is rendered in full, derived from the bundled body — never restated');
  assert.match(text, /authority to break this law/, 'the law-over-task sentence reaches the Subject every turn');
  assert.ok(text.length < 8192, 'the block stays bounded — the taught form is the short appendix, not the body');
  assert.ok(!text.includes(constitution.COMPACT_BODY.slice(0, 200)), 'the full body is NOT injected');

  // self_describe renders it identically (R-1, on demand)
  const out = String((await call(ctx.tools, 'self_describe', {}, agent))?.value ?? '');
  assert.ok(out.includes(constitution.TAUGHT_DIGEST), 'the on-demand render carries the same taught form');
});

test('composed: a non-turn session event injects nothing', async () => {
  const { ctx, agents } = await boot();
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'tool/call', seq: 1, time: 1, data: {} });
  assert.equal(agent.injected.length, 0);
});

test('composed: self_describe re-reads on demand, and a stale citation is an alarm', async () => {
  const { ctx, tools, agents } = await boot();
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });
  const issuedEpoch = ctx.get('compact-self-model').issuedTo('s1').epoch;

  const current = await call(tools, 'self_describe', { citing_epoch: issuedEpoch }, agent);
  const currentText = String(current?.value ?? current);
  assert.match(currentText, /\[R-1\] Attestation/);
  assert.ok(!currentText.includes('[R-1 ALARM]'), 'citing the epoch in force raises nothing');

  const stale = await call(tools, 'self_describe', { citing_epoch: issuedEpoch - 99 }, agent);
  const staleText = String(stale?.value ?? stale);
  assert.match(staleText, /\[R-1 ALARM\]/);
  assert.match(staleText, /was stale — a stale attestation is an alarm/);
  assert.match(staleText, /re-check any decision you made from the older one/);
});

test('composed: self_describe with no citation makes no claim about currency', async () => {
  const { tools, agents } = await boot();
  const agent = agents.add('s1');
  const out = String((await call(tools, 'self_describe', {}, agent))?.value ?? '');
  assert.match(out, /\[R-1\] Attestation/);
  assert.ok(!out.includes('[R-1 ALARM]'));
});

test('composed: inquiry answers identity, act and authority from the record (R-13)', async () => {
  const { tools, agents } = await boot();
  agents.add('root');
  const child = agents.add('worker', 'root');
  const out = String((await call(tools, 'inquiry', { agent_id: 'worker' }, child))?.value ?? '');
  assert.match(out, /IDENTITY:/);
  assert.match(out, /worker — delegated Subject, delegation depth 1/);
  assert.match(out, /ACT:/);
  assert.match(out, /AUTHORITY:/);
  assert.match(out, /delegated by root/);
  assert.match(out, /under the human operator/);
  assert.match(out, /Reasoning is not disclosed by inquiry \(R-10\)/);
});

test('composed: inquiry about an unknown Member answers rather than refusing', async () => {
  const { tools, agents } = await boot();
  const agent = agents.add('asker');
  const out = String((await call(tools, 'inquiry', { agent_id: 'nobody' }, agent))?.value ?? '');
  assert.match(out, /no session recorded under this id/);
  assert.match(out, /\[R-13\] Inquiry answered from recorded state/);
});

test('composed: the service exposes the attestation to an operator or auditor', async () => {
  const { agents, service } = await boot();
  agents.add('s1');
  const att = service.attest('s1');
  assert.equal(att.subject.id, 's1');
  assert.equal(att.basis, 'unsigned', 'the basis is stated on the object, not only in the prose');
  assert.equal(service.inquire('s1').answered, true);
});
