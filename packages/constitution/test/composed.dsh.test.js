// Composed test — the blessed composition boots with the constitution on
// top of the real enforcement plugins, and a composition missing one of
// them FAILS THE BOOT (F-5's refuse-to-start, the mechanical separation of
// powers: the composition either enforces the constitution or does not
// start).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { Session } from '@deepseek-ai/dsh-session';
import { approvalPlugin } from 'compact-dsh-approval';
import { loopguardPlugin } from 'compact-dsh-loopguard';
import { promotionPlugin } from 'compact-dsh-promotion';
import * as sandbox from 'compact-dsh-sandbox-docker';
import * as remoteAccess from 'compact-dsh-remote-access';
import * as allowlistGate from 'compact-dsh-allowlist-gate';
import { specialistsPlugin } from 'compact-dsh-specialists';
import { apply as constitutionApply } from '../src/index.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx, config) {
    super(ctx, 'systemPrompt');
    this.sections = [];
  }
  getSectionOrder(name) {
    if (name === 'TOOL_SUBAGENT') return 2800;
    throw new Error(`SystemPromptStub: unknown section order '${name}'`);
  }
  getContextOrder() { return 50; }
  section(section) {
    this.sections.push(section);
    return () => { this.sections = this.sections.filter(s => s !== section); };
  }
  tools() { return undefined; }
  context() { return () => {}; }
}

// The specialists plugin rides the delegation-tool contract, whose inject is
// tools/subagents/systemPrompt/sessionProjections — the two stubs below stand
// in for the host registries the standard preset provides.
class SessionProjectionsStub extends Service {
  static inject = [];
  constructor(ctx, config) { super(ctx, 'sessionProjections'); }
  register() { return () => {}; }
}

class SubagentsStub extends Service {
  static inject = [];
  constructor(ctx, config) {
    super(ctx, 'subagents');
    this.providers = new Map();
  }
  registerProvider(provider) {
    this.providers.set(provider.name, provider);
    return () => this.providers.delete(provider.name);
  }
  getProvider(name) { return this.providers.get(name); }
  list() { return [...this.providers.keys()]; }
}

function mountSpecialists(ctx) {
  const subagents = ctx.get('subagents');
  subagents.registerProvider({
    name: 'spawn',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: async () => ({ id: 'child', localAgent: undefined, result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }),
  });
  return specialistsPlugin({})(ctx, {});
}

// The blessed composition, in load order: enforcement plugins first, the
// constitution LAST — after the boot settles and every enforcement service
// (including the async sandbox mount) is present. In a dsh-loaded
// composition the constitution's module-level `inject` defers its apply to
// exactly that point; here the awaited boot plays that role.
async function bootBlessed(opts = {}) {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(SessionProjectionsStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  ctx.plugin(SubagentsStub);
  loopguardPlugin({})(ctx, {});
  const promotion = promotionPlugin({});
  promotion(ctx, {});
  allowlistGate.apply(ctx, { allowlist: ['api.example.com'] });
  approvalPlugin({})(ctx, {});
  remoteAccess.apply(ctx, {});
  sandbox.apply(ctx, opts);
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox', 'compact-allowlist-gate', 'compact-remote-access'].some(s => ctx.get(s) === undefined)); i++) {
    await new Promise(r => setImmediate(r));
  }
  mountSpecialists(ctx);
  const constitution = constitutionApply(ctx, {});
  return { ctx, constitution };
}

test('composed: the blessed composition boots under the constitution', async () => {
  const { ctx, constitution } = await bootBlessed();
  for (let i = 0; i < 100 && !ctx.tools; i++) await new Promise(r => setImmediate(r));

  assert.equal(ctx.constitution, constitution, 'the constitution service is provided');
  const att = constitution.attestation();
  assert.ok(att.registeredRules.includes('I-5'), 'the floor rules are registered');
  assert.ok(att.registeredRules.includes('CF-1'), 'the confinement trigger is awake (capability provided) and bound');
  assert.ok(att.registeredRules.includes('MA-2'), 'bounded delegation is registered (the Phase 5 roster)');
  assert.ok(att.gaps.some(g => g.includes('NOT yet ratified')), 'the standing honesty is in every attestation');
  // every required enforcement service resolved
  for (const s of ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox', 'compact-specialists']) {
    assert.notEqual(ctx.get(s), undefined, `${s} present`);
  }
});

test('composed: a composition missing an enforcement plugin REFUSES TO START (F-5)', () => {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  loopguardPlugin({})(ctx, {});
  approvalPlugin({})(ctx, {});
  // the promotion gate is missing — the floor is not enforced
  assert.throws(() => constitutionApply(ctx, {}), /compact-promotion.*refuses to start/);
});

test('composed: applying the constitution before the async sandbox service mounts fails; after, it passes', async () => {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(SessionProjectionsStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  ctx.plugin(SubagentsStub);
  loopguardPlugin({})(ctx, {});
  const promotion = promotionPlugin({});
  promotion(ctx, {});
  allowlistGate.apply(ctx, { allowlist: ['api.example.com'] });
  approvalPlugin({})(ctx, {});
  remoteAccess.apply(ctx, {});
  sandbox.apply(ctx, {});
  // before start, the sandbox provider has not mounted (its ctx.inject waits
  // for the tools service) — the composition does not enforce the floor yet
  assert.throws(() => constitutionApply(ctx, {}), /compact-sandbox.*refuses to start/);
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 200 && (!ctx.tools || ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-allowlist-gate', 'compact-remote-access'].some(s => ctx.get(s) === undefined)); i++) {
    await new Promise(r => setImmediate(r));
  }
  for (let i = 0; i < 300 && ctx.get('compact-sandbox') === undefined; i++) await new Promise(r => setImmediate(r));
  mountSpecialists(ctx);
  const constitution = constitutionApply(ctx, {});
  assert.ok(constitution.attestation().registeredRules.includes('CF-1'), 'once the enforcement service exists, the composition boots under the law');
});

test('composed: an enforcement act under the blessed composition is on the record', async () => {
  const { ctx } = await bootBlessed();
  for (let i = 0; i < 100 && !ctx.tools; i++) await new Promise(r => setImmediate(r));
  const probe = defineTool({
    name: 'net_probe',
    description: 'probe a host (constitution composed test)',
    parameters: { host: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (v) => [{ type: 'text', text: String(v) }] },
    async execute(args) { return `probed ${args.host}`; },
  });
  ctx.tools.register(probe);
  const agent = makeAgent('sess-const-1');
  // an uncovered host is denied by the composition's first gate — the
  // envelope is the enforcement, introspectable on the result (D-7)
  const r = await ctx.tools.execute({
    name: 'net_probe', arguments: { host: 'evil.example' }, agent, signal: new AbortController().signal,
  });
  const s = JSON.stringify(r);
  assert.ok(!s.includes('probed'), 'the call never executed');
  assert.ok(s.includes('[AG-1]'), 'the denial carries the gate envelope — ' + s.slice(0, 250));
  assert.ok(s.includes('Lawful next moves'), 'the denial carries the lawful exits (R-3/R-9)');
});

function makeAgent(id) {
  const session = Session.create(id, [{ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } }]);
  return { id, session };
}
