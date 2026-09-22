// Composed test — the roster rides the REAL delegation-tool contract: every
// persona is spawnable through the tools registry, and the spawn request the
// provider receives carries exactly the declared surface — the composed
// persona prose, the deny filter (excluded_tools semantics), and the depth
// cap (specialists capped at 1: spawnable at depth 1, never spawning — the
// leaves rule rides the denied spawn tools on their own surface; leads
// capped). The provider stub is the verified contract's consumer stand-in:
// it captures the SubagentStartRequest the tool layer builds, and the depth
// arithmetic asserted against is the pinned provider's own enforcement
// function (@deepseek-ai/dsh-subagent resolveChildDepth), not a re-derivation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Session } from '@deepseek-ai/dsh-session';
import { resolveChildDepth, SubagentDepthError } from '@deepseek-ai/dsh-subagent';
import { specialistsPlugin } from '../src/index.js';
import { loadRoster } from '../src/roster.js';

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

test('composed: the active roster is all leaves; archived personas are not mounted', async () => {
  const { tools, service, ctx } = await boot();
  assert.equal(service.personas.length, 5, 'the active roster is the basic five');
  for (const p of service.personas) {
    assert.equal(p.kind, 'specialist', `${p.name}: the active roster carries no leads`);
    assert.equal(p.maxDepth, 1, `${p.name}: spawnable at depth 1 — a cap of 0 would refuse the first spawn (#37)`);
    assert.ok(p.deny.includes('subagent') && p.deny.includes('subagent_fork'), `${p.name}: spawn tools denied on the child's own surface (no-recursive-spawn is a surface property)`);
  }
  // the archive is data, not mount surface: no delegation row exists for it
  for (const archived of ['planner', 'planner_collaborative', 'packager', 'discovery', 'watchdog_fast']) {
    assert.equal(service.personas.find(p => p.name === archived), undefined, `${archived} stays archived`);
    assert.equal(tools.get(`lead_${archived}`), undefined);
    assert.equal(tools.get(`specialist_${archived}`), undefined);
  }
  assert.ok(ctx.systemPrompt, 'the systemPrompt service resolved at apply time');
});

test('composed: the mounted cap bounds delegation — a lead may spawn a specialist, a specialist may not spawn a grandchild (#37)', async () => {
  const { service } = await boot();
  // The provider's own depth arithmetic: child depth = parent depth + 1,
  // refused past maxDepth. A top-level parent (depth 0) spawning a
  // specialist makes a depth-1 child — the mounted cap of 1 admits it and
  // exactly refuses the depth-2 grandchild. The agent shape below is the
  // duck type resolveChildDepth consumes (options.subagentDepth vs the
  // session header's delegationDepth — the monotone floor).
  const specialistMaxDepth = service.surface('researcher').maxDepth;
  assert.equal(specialistMaxDepth, 1, 'the mounted specialist cap');

  const topLevel = { options: {}, session: { header: {} } };
  assert.equal(resolveChildDepth(topLevel, specialistMaxDepth), 1, 'top-level → specialist child: depth 1 is within the cap (spawnable)');

  const specialistChild = { options: { subagentDepth: 1 }, session: { header: { delegationDepth: 1 } } };
  assert.throws(
    () => resolveChildDepth(specialistChild, specialistMaxDepth),
    (e) => e instanceof SubagentDepthError && e.attemptedDepth === 2 && e.maxDepth === 1,
    'specialist → grandchild: depth 2 exceeds the cap (refused at the provider, beyond the denied surface)',
  );

  // the lead arithmetic keeps its own budget: 3 admits depth-3 children,
  // refuses depth-4
  const leadMaxDepth = 3;
  const depth3 = { options: { subagentDepth: 2 }, session: { header: { delegationDepth: 2 } } };
  assert.equal(resolveChildDepth(depth3, leadMaxDepth), 3, 'lead cap admits depth 3');
  const depth4 = { options: { subagentDepth: 3 }, session: { header: { delegationDepth: 3 } } };
  assert.throws(
    () => resolveChildDepth(depth4, leadMaxDepth),
    (e) => e instanceof SubagentDepthError && e.attemptedDepth === 4 && e.maxDepth === 3,
    'lead cap refuses depth 4',
  );
});

test('composed: the roster card is registered as a scoped prompt section', async () => {
  const { ctx, service } = await boot();
  const sections = ctx.systemPrompt.sections;
  const card = sections.find(s => s.name === 'compact:roster-card');
  assert.ok(card, 'the roster-card section is registered');
  assert.equal(card.order, 2801, 'it rides directly after the host TOOL_SUBAGENT guidance (2800)');
  for (const p of service.personas) {
    assert.ok(card.text.includes(`\`${p.toolName}\``), `${p.toolName} named in the card`);
    assert.ok(card.text.includes(p.description), `${p.name}: its descriptor description is the routing signal`);
  }
  assert.ok(!card.text.includes('planner'), 'archived personas are not taught');
});
