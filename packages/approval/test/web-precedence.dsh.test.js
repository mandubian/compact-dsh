// The web-vs-terminal approval precedence (#19), pinned — Demo 7 flagged the
// question "which decider wins when a browser page is connected" as unverified.
// The composition, in the order web mode mounts it: the recorded answerer
// (compact-approval) PREPENDS itself upstream of every decider (#24), the
// browser bridge (dsh-api-remotes, applied before the pilot's answerer) sits
// downstream of it, and the terminal operator answerer sits downstream of the
// bridge. The bridge replica below implements dsh-api-remotes' observable
// forwardWaterfall contract: a connected page resolves the ask with its
// verdict and the chain stops; with no page the dispatch falls through to
// next() (the real bridge's `!queue.push(dispatch)` limb). What is pinned
// here is the CONTRACT between the three participants; the fiber-level
// effect-vs-apply ordering of the real bridge lives below this harness's
// resolution — the prepend makes the compact side of that ordering
// unconditional, which is the part the record stands on.
//
// The live capture with a model key and a real page (Demo 7's remaining
// observation) is the UX face of exactly this contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { CommandRuntime } from '@deepseek-ai/dsh-commands';
import { Session } from '@deepseek-ai/dsh-session';
import { approvalPlugin } from '../src/index.js';

let executed = 0;
const probe = defineTool({
  name: 'net_probe',
  description: 'probe a host (compact-dsh approval web-precedence test)',
  parameters: { host: { type: 'string', description: 'host to probe' } },
  output: {
    schema: { type: 'string' },
    render: (value) => [{ type: 'text', text: String(value) }],
  },
  async execute(args) { executed += 1; return `probed ${args.host}`; },
});

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx, config) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return []; }
  getContextOrder() { return 50; }
  section() { return undefined; }
  tools() { return undefined; }
  context() { return () => {}; }
}

/**
 * The browser bridge replica (dsh-api-remotes' observable contract), composed
 * between the compact answerer and the terminal operator. When the page is
 * "connected" it resolves the ask with the page's verdict — the waterfall
 * never reaches the operator; when not, it falls through like the real
 * bridge's unqueued dispatch does. It records whether the compact answerer
 * had already claimed the ask when the bridge was consulted.
 */
function browserBridge(ctx, approval) {
  const state = {
    pageConnected: false,
    pageDecision: null,
    consultations: 0,
    compactClaimedFirst: null,   // deciding view present when the bridge saw the ask
  };
  ctx.on('approval/request', async (req, next) => {
    state.consultations += 1;
    state.compactClaimedFirst = approval.deciding.size > 0;
    if (!state.pageConnected) return next();
    return state.pageDecision;
  });
  return state;
}

// The terminal operator answerer — the fall-through decider, composed last.
function operatorAnswerer(ctx, decision = 'allowed-once') {
  const asked = { count: 0 };
  ctx.on('approval/request', async (req, next) => {
    asked.count += 1;
    return decision;
  });
  return asked;
}

function makeAgent(id = 'sess-web-1') {
  const session = Session.create(id, [
    { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } },
  ]);
  return { id, session, injected: [], inject(message) { this.injected.push(message); } };
}

async function boot() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  ctx.plugin(CommandRuntime);
  const approvalPluginInstance = approvalPlugin({});
  approvalPluginInstance(ctx, {});
  // web-mode composition order: bridge (api-remotes) before operator (pilot)
  const bridge = browserBridge(ctx, approvalPluginInstance.approval);
  const asked = operatorAnswerer(ctx);
  if (typeof ctx.start === 'function') await ctx.start();
  let tools = ctx.tools ?? null;
  for (let i = 0; i < 200 && !tools; i++) {
    await new Promise(r => setImmediate(r));
    tools = ctx.tools ?? null;
  }
  if (!tools) throw new Error('tools runtime did not mount');
  return { ctx, tools, bridge, asked, approval: approvalPluginInstance.approval };
}

const run = (tools, agent, host) =>
  tools.execute({ name: 'net_probe', arguments: { host }, agent, signal: new AbortController().signal });

test('#19 web: a connected page wins the ask — the terminal is never consulted, the record is complete', async () => {
  const { tools, bridge, asked, approval } = await boot();
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  bridge.pageConnected = true;
  bridge.pageDecision = 'allowed-once';

  const outcome = await run(tools, agent, 'web.example');
  assert.equal(executed, 1, 'the page allowed the call and it ran');
  assert.equal(asked.count, 0, 'the terminal prompt never appeared — the browser decided');
  assert.equal(bridge.consultations, 1);
  assert.equal(bridge.compactClaimedFirst, true, 'the recorded answerer had already claimed the ask before the bridge saw it');
  assert.equal(approval.deciding.size, 0, 'the deciding view closed with the decision');

  // #24: allowed-once flows back THROUGH the compact wrapper — materialization
  // happened on the browser path too, so the identical operation replays
  assert.equal(approval.store.cache.size, 1, 'exactly one exec-cache entry materialized from the browser verdict');
  await run(tools, agent, 'web.example');
  assert.equal(executed, 2, 'the replay ran');
  assert.equal(bridge.consultations, 1, 'the replay never re-asked anyone — not the page, not the terminal');
  assert.equal(asked.count, 0);
  assert.equal(approval.store.cache.size, 1, 'the replay re-used the same entry until TTL, never a second one');
  assert.ok(agent.injected.some(m => m.content?.some(c => String(c.text ?? '').includes('was allowed once by the operator'))),
    'the decision note reached the transcript — the Subject sees the browser verdict, not a silent run');
});

test('#19 web: no page connected — the bridge falls through and the terminal decides', async () => {
  const { tools, bridge, asked, approval } = await boot();
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  bridge.pageConnected = false;

  await run(tools, agent, 'headless.example');
  assert.equal(executed, 1);
  assert.equal(bridge.consultations, 1, 'the bridge was consulted and passed the ask through');
  assert.equal(asked.count, 1, 'the terminal operator decided');
  assert.equal(approval.deciding.size, 0);

  await run(tools, agent, 'headless.example');
  assert.equal(asked.count, 1, 'the approved call replays without re-asking');
});

test('#19 web: a page denial flows back through the recorded answerer — nothing materializes, the next ask re-consults the page', async () => {
  const { tools, bridge, asked, approval } = await boot();
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  bridge.pageConnected = true;
  bridge.pageDecision = 'rejected';   // the host's decision vocabulary — a denial that WAS answered
  await run(tools, agent, 'denied.example');
  assert.equal(executed, 0, 'the denied call never ran');
  assert.equal(approval.store.cache.size, 0, 'no coverage materialized from a denial');
  assert.equal(asked.count, 0, 'the terminal stayed silent — the page held the decision');

  bridge.pageDecision = 'allowed-once';
  bridge.consultations = 0;
  await run(tools, agent, 'denied.example');
  assert.equal(bridge.consultations, 1, 'the same operation asked the page again — a denial is not coverage');
  assert.equal(executed, 1, 'and ran once the page allowed it');
});
