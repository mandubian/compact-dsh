// Composed test — the roster rides the REAL delegation-tool contract: every
// persona is spawnable through the tools registry, and the spawn request the
// provider receives carries exactly the declared surface — the composed
// persona prose, the deny filter (excluded_tools semantics), and the depth
// cap (leaves 0 = no-recursive-spawn; leads capped). The provider stub is
// the verified contract's consumer stand-in: it captures the
// SubagentStartRequest the tool layer builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Session } from '@deepseek-ai/dsh-session';
import { specialistsPlugin } from '../src/index.js';
import { loadRoster } from '../src/roster.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx, config) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return []; }
  getContextOrder() { return 50; }
  section() { return undefined; }
  tools() { return undefined; }
  context() { return () => {}; }
}

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
    this.captured = [];
  }
  registerProvider(provider) {
    this.providers.set(provider.name, provider);
    queueMicrotask(() => this.ctx.emit('subagent/provider-added', provider));
    return () => this.providers.delete(provider.name);
  }
  getProvider(name) { return this.providers.get(name); }
  list() { return [...this.providers.keys()]; }
  async start(name, request) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`subagents stub: no provider '${name}'`);
    return provider.start(name, request);
  }
}

function makeAgent(id) {
  const session = Session.create(id, [{ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } }]);
  return { id, session };
}

async function boot() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(SessionProjectionsStub);
  ctx.plugin(ToolRuntime);
  ctx.plugin(SubagentsStub);
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 200 && !ctx.tools; i++) await new Promise(r => setImmediate(r));
  // manual-apply idiom (same as the constitution composed test): services
  // resolve after start, THEN the plugin that needs them at apply time runs
  const subagents = ctx.get('subagents');
  const captured = subagents.captured;
  const provider = {
    name: 'spawn',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: async (name, request) => {
      captured.push({ name, request });
      return {
        id: `child-${captured.length}`,
        localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'child done' }], stopReason: 'completed' }),
        dispose: async () => {},
      };
    },
  };
  subagents.registerProvider(provider);

  const service = specialistsPlugin({})(ctx, {});
  return { ctx, tools: ctx.tools, service, captured };
}

test('composed: every persona is spawnable with exactly its declared surface', async (t) => {
  const { tools, service, captured } = await boot();
  const roster = loadRoster();
  assert.equal(service.personas.length, roster.personas.length, 'the service exposes the whole roster');

  for (const p of service.personas) {
    await t.test(`${p.name}: tool ${p.toolName} registered and spawns with the declared surface`, async () => {
      const def = tools.get(p.toolName);
      assert.ok(def, `${p.toolName} is registered on the real ToolRuntime`);
      const r = await tools.execute({
        name: p.toolName,
        arguments: { description: `probe task ${p.name}`, prompt: 'do the thing' },
        agent: makeAgent(`sess-${p.name}`),
        signal: new AbortController().signal,
      });
      assert.equal(r.isError, false, JSON.stringify(r));
      const hit = captured.find(c => c.request.label === `probe task ${p.name}`);
      assert.ok(hit, 'the provider received the start request');
      assert.deepEqual([...hit.request.toolFilter.deny].sort(), [...p.deny].sort(), `${p.name}: the deny filter is the declared surface`);
      assert.equal(hit.request.maxDepth, p.maxDepth, `${p.name}: depth cap (${p.kind})`);
      assert.ok(hit.request.persona.length > 200, `${p.name}: the persona prose shadows the deployment persona`);
      assert.ok(hit.request.persona.includes('## Output contract'), `${p.name}: the taught contract ships in the prompt`);
      assert.equal(hit.request.parent.session.id, `sess-${p.name}`, 'the spawn is attributed to the calling agent (MA-1)');
    });
  }
});

test('composed: leaves cannot spawn (no-recursive-spawn is a surface property), leads carry the cap', async () => {
  const { service } = await boot();
  const leaves = service.personas.filter(p => !p.spawns);
  const leads = service.personas.filter(p => p.spawns);
  assert.ok(leaves.length > 0 && leads.length > 0, 'the roster has both kinds');
  for (const leaf of leaves) {
    assert.equal(leaf.maxDepth, 0, `${leaf.name}: leaves never delegate`);
    assert.ok(leaf.deny.includes('subagent') && leaf.deny.includes('subagent_fork'), `${leaf.name}: spawn tools denied`);
  }
  for (const lead of leads) {
    assert.ok(lead.maxDepth > 0, `${lead.name}: leads delegate within a declared bound`);
    assert.ok(!lead.deny.includes('subagent'), `${lead.name}: leads keep the spawn tool`);
  }
});
