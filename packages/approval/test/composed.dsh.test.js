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
function operatorAnswerer(ctx, decision, inspect) {
  const asked = { count: 0, reasons: [] };
  ctx.on('approval/request', async (req, next) => {
    asked.count += 1;
    asked.reasons.push(req.reason);
    inspect?.(req);
    return typeof decision === 'function' ? decision(req) : decision;
  });
  return asked;
}

function makeAgent(id = 'sess-compact-1') {
  const session = Session.create(id, [
    { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } },
  ]);
  return {
    id, session,
    // #25: the transcript-note channel — the recorded answerer queues a
    // plugin-sourced user message for the agent's next model step
    injected: [],
    inject(message) { this.injected.push(message); },
  };
}

async function boot({ operator = 'allowed-once', inspect } = {}) {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  ctx.plugin(CommandRuntime);
  const approvalPluginInstance = approvalPlugin({});
  approvalPluginInstance(ctx, {});
  const asked = operatorAnswerer(ctx, operator, inspect);
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

test('composed: the deciding preview lives exactly as long as the decision', async () => {
  let seen;
  const { approval, tools } = await boot({ inspect: () => { seen = [...approval.deciding.values()][0]; } });
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  await run(tools, agent, 'evil.example');
  assert.ok(seen, 'the recorded answerer publishes the preview for the decision window');
  assert.match(seen.command, /evil\.example/, 'the preview names the gated call, not just the tool');
  assert.equal(seen.target.host, 'evil.example');
  assert.match(seen.fingerprint, /^fp_[0-9a-f]{16}$/);
  assert.equal(approval.deciding.size, 0, 'cleared when the decision lands');
});

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

test('composed: every decided ask leaves a transcript note (#25), every replay a receipt (#40)', async () => {
  const { tools, asked } = await boot({ operator: 'allowed-once' });
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  await run(tools, agent, 'noted.example');                 // ask → allow → decision note
  assert.equal(agent.injected.length, 1);
  const note = agent.injected[0];
  assert.equal(note.source?.kind, 'plugin');
  assert.equal(note.source?.plugin, 'compact-approval');
  const text = note.content?.[0]?.text ?? '';
  assert.match(text, /\[fp_[0-9a-f]{16}\] was allowed once/);
  assert.match(text, /host=noted\.example/, 'the canonical target is envelope-grade and on the note');

  // the exec-cache replay is not silent (#40): the replaying session gets a
  // one-line receipt naming the prior approval it runs under — once per
  // session per grant generation, and the operator is still not re-asked
  await run(tools, agent, 'noted.example');
  assert.equal(executed, 2);
  assert.equal(asked.count, 1, 'the receipt never re-asks');
  assert.equal(agent.injected.length, 2, 'the replay leaves exactly one receipt');
  const receipt = agent.injected[1];
  assert.equal(receipt.source?.plugin, 'compact-approval');
  const receiptText = receipt.content?.[0]?.text ?? '';
  assert.match(receiptText, /^\[compact-approval\] Replay: "net_probe" \(host=noted\.example\) \[fp_[0-9a-f]{16}\]/);
  assert.match(receiptText, /granted \d{4}-\d{2}-\d{2}T.*Z, expires \d{4}-\d{2}-\d{2}T.*Z — no new decision was asked or made/);
  await run(tools, agent, 'noted.example');                 // same grant generation: no new receipt
  assert.equal(agent.injected.length, 2, 'one receipt per grant generation');

  // the record keeps its own pair; the notes are the transcript copy, not a
  // replacement for the audit events
  const types = [];
  for (let seq = 0; seq < agent.session.seq; seq++) types.push(agent.session.eventAt(seq)?.type);
  assert.ok(types.includes('approval/asked') && types.includes('approval/decided'));
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
  assert.ok(g.result.text.includes('ExactHost:granted.example'), 'the echo shows the PARSED pattern, not the raw input');

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
