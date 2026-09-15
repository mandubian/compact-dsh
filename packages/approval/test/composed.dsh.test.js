// Composed test — Phase 1 acceptance: the FULL deny→ask→approve→replay-hit
// cycle inside the REAL host. Real Cordis Context, real ToolRuntime
// (@deepseek-ai/dsh-tools), real ApprovalService (@deepseek-ai/dsh-user-approval,
// which appends the approval/asked + approval/decided audit pair to a real
// in-memory Session from @deepseek-ai/dsh-session), real CommandRuntime
// (@deepseek-ai/dsh-commands) driving the grants.* commands, and our
// layered-approval plugin between them.
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
  description: 'probe a host (compact-dsh approval composed test)',
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

// The operator: an answerer composed DOWNSTREAM of our wrapper answerer.
// Counts how many times the human was actually asked.
function operatorAnswerer(ctx, decision) {
  const asked = { count: 0, reasons: [] };
  ctx.on('approval/request', async (req, next) => {
    asked.count += 1;
    asked.reasons.push(req.reason);
    return typeof decision === 'function' ? decision(req) : decision;
  });
  return asked;
}

function makeAgent(id = 'sess-compact-1') {
  const session = Session.create(id, [
    { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } },
  ]);
  return { id, session };
}

async function boot({ operator = 'allowed-once' } = {}) {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  ctx.plugin(CommandRuntime);
  const approvalPluginInstance = approvalPlugin({});
  approvalPluginInstance(ctx, {});
  const asked = operatorAnswerer(ctx, operator);
  if (typeof ctx.start === 'function') await ctx.start();
  let tools = ctx.tools ?? null;
  for (let i = 0; i < 200 && !tools; i++) {
    await new Promise(r => setImmediate(r));
    tools = ctx.tools ?? null;
  }
  if (!tools) throw new Error('tools runtime did not mount');
  let commands = ctx.commands ?? null;
  for (let i = 0; i < 200 && !commands; i++) {
    await new Promise(r => setImmediate(r));
    commands = ctx.commands ?? null;
  }
  return { ctx, tools, commands, asked, approval: approvalPluginInstance.approval };
}

const run = (tools, agent, host) =>
  tools.execute({ name: 'net_probe', arguments: { host }, agent, signal: new AbortController().signal });

test('composed: deny→ask→approve→replay-hit cycle in the real runtime', async () => {
  const { tools, asked } = await boot({ operator: 'allowed-once' });
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  // 1. uncovered → the human gate → the operator approves → the call runs
  const r1 = await run(tools, agent, 'evil.example');
  assert.equal(executed, 1, 'an approved ask must execute');
  assert.ok(!JSON.stringify(r1).includes('[AG/I-5'), 'no denial envelope on an approved call');
  assert.equal(asked.count, 1, 'the operator was asked once');
  assert.ok(asked.reasons[0].includes('[AG/'), 'the ask carries our envelope as the reason');
  assert.ok(asked.reasons[0].includes('Lawful next moves'), 'the ask envelope lists lawful next moves');

  // 2. identical operation → exec-cache replay hit, the operator is NOT re-asked
  await run(tools, agent, 'evil.example');
  assert.equal(executed, 2);
  assert.equal(asked.count, 1, 'the replay must hit the exec cache, not the operator');

  // 3. a different host is still uncovered → asked again
  await run(tools, agent, 'other.example');
  assert.equal(executed, 3);
  assert.equal(asked.count, 2);
});

test('composed: the approval/asked + approval/decided audit pair is on the session log', async () => {
  const { tools } = await boot({ operator: 'allowed-once' });
  tools.register(probe);
  const agent = makeAgent();
  await run(tools, agent, 'audited.example');
  const types = [];
  for (let seq = 0; seq < agent.session.seq; seq++) {
    types.push(agent.session.eventAt(seq)?.type);
  }
  assert.ok(types.includes('approval/asked'), 'approval/asked appended by the host service');
  assert.ok(types.includes('approval/decided'), 'approval/decided appended by the host service');
  assert.deepEqual(
    types.filter(t => t === 'approval/asked').length,
    types.filter(t => t === 'approval/decided').length,
    'asked/decided are paired',
  );
});

test('composed: a rejected ask denies the call and a repeat asks again (no sticky dedup)', async () => {
  const { tools, asked } = await boot({ operator: 'rejected' });
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();
  const r = await run(tools, agent, 'rejected.example');
  assert.equal(executed, 0, 'a rejected ask must not execute');
  assert.ok(JSON.stringify(r).toLowerCase().includes('reject'), 'the denial names the rejection');
  // the decided request released its pending record: a fresh call re-asks
  await run(tools, agent, 'rejected.example');
  assert.equal(asked.count, 2, 'rejected → the next identical call asks again');
});

test('composed: grants-grant materializes a session grant; grants-revoke kills it and its cache', async () => {
  const { tools, commands, asked, approval } = await boot({ operator: 'allowed-once' });
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  // warm the cycle on host A (ask → approve → cache)
  await run(tools, agent, 'grantme.example');
  assert.equal(asked.count, 1);

  // the operator grants host B for this session via the command seam
  const g = await commands.execute(agent, '/grants-grant granted.example 5', [], new AbortController().signal);
  assert.equal(g.result.kind, 'success', 'grants.grant succeeds — ' + JSON.stringify(g.result));
  const grantId = g.result.text.match(/grant (sg_\w+)/)?.[1];
  assert.ok(grantId, 'the grant id is reported');

  // host B runs under the session grant — never asked
  await run(tools, agent, 'granted.example');
  assert.equal(executed, 2);
  assert.equal(asked.count, 1, 'a session grant covers the call without asking');

  // listing shows the live grant; revocation kills the grant
  const list = await commands.execute(agent, '/grants-list', [], new AbortController().signal);
  assert.ok(list.result.text.includes(grantId), 'grants.list shows the live grant');
  const rev = await commands.execute(agent, `/grants-revoke ${grantId}`, [], new AbortController().signal);
  assert.equal(rev.result.kind, 'success', 'grants.revoke succeeds');

  // host B is uncovered again (session grant gone) → asked anew
  await run(tools, agent, 'granted.example');
  assert.equal(asked.count, 2, 'after revocation the call asks again');
  assert.equal(approval.store.sessionGrants.find(x => x.id === grantId).revokedAt != null, true);

  // the command lifecycle is on the record (the causal note)
  const types = [];
  for (let seq = 0; seq < agent.session.seq; seq++) types.push(agent.session.eventAt(seq)?.type);
  assert.ok(types.includes('command/run'), 'command/run appended');
  assert.ok(types.includes('command/done'), 'command/done appended');
});

test('composed: no answerer composed → fail-closed unavailable, no execution', async () => {
  const { tools } = await bootNoOperator();
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();
  const r = await run(tools, agent, 'nobody.example');
  assert.equal(executed, 0, 'fail-closed: no answerer, no execution');
  assert.ok(JSON.stringify(r).includes('approval'), 'the denial names the failure');
});

async function bootNoOperator() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  const instance = approvalPlugin({});
  instance(ctx, {});
  const asked = { count: 0 };
  if (typeof ctx.start === 'function') await ctx.start();
  let tools = ctx.tools ?? null;
  for (let i = 0; i < 200 && !tools; i++) {
    await new Promise(r => setImmediate(r));
    tools = ctx.tools ?? null;
  }
  return { ctx, tools, asked, approval: instance.approval };
}
