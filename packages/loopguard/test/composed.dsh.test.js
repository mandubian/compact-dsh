// Composed test — the loopguard wired into the REAL runtime: the Phase 1
// refusal seam feeds gate-flailing accounting; behavioral trips deny calls
// with the trip envelope + corrective agent.inject; the turn boundary (the
// inbound user signal, via the real session/event firehose) clears latches;
// a deterministic trip denies all and never resumes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { Session } from '@deepseek-ai/dsh-session';
import { approvalPlugin } from 'compact-dsh-approval';
import * as remoteAccess from 'compact-dsh-remote-access';
import { loopguardPlugin } from '../src/index.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx, config) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return []; }
  getContextOrder() { return 50; }
  section() { return undefined; }
  tools() { return undefined; }
  context() { return () => {}; }
}

let executed = 0;
const probe = defineTool({
  name: 'bash_probe',
  description: 'run a command (loopguard composed test)',
  parameters: { command: { type: 'string' } },
  output: { schema: { type: 'string' }, render: (v) => [{ type: 'text', text: String(v) }] },
  async execute(args) { executed += 1; return `ran: ${args.command}`; },
});

const terminalProbe = defineTool({
  name: 'workflow_probe',
  description: 'fails terminally (loopguard composed test)',
  parameters: {},
  output: { schema: { type: 'string' }, render: (v) => [{ type: 'text', text: String(v) }] },
  async execute() { throw new Error('WORKFLOW_TERMINAL: the pipeline cannot continue'); },
});

function makeAgent(id) {
  const session = Session.create(id, [{ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } }]);
  const injected = [];
  return { id, session, inject: (msg) => injected.push(msg), injected };
}

// The operator always rejects: every uncovered call asks, and the rejection
// frees the pending record, so every retry asks afresh — pure flailing.
async function boot({ limits }) {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  // ORDER: the loopguard must see calls BEFORE the approval gate claims them;
  // the remote-access analyzer routes URL findings through the grant layers
  loopguardPlugin({})(ctx, { limits });
  approvalPlugin({ maxPendingPerRoot: 50 })(ctx, {});
  remoteAccess.apply(ctx, {});
  ctx.on('approval/request', async (req, next) => 'rejected');
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 200 && !ctx.tools; i++) await new Promise(r => setImmediate(r));
  return { ctx, tools: ctx.tools };
}

const run = (tools, agent, tool, args) =>
  tools.execute({ name: tool, arguments: args, agent, signal: new AbortController().signal });

test('composed: gate flailing trips LG-12 — denials carry the envelope, corrective prose is injected', async () => {
  const { tools } = await boot({ limits: { GATE_FLAILING: 3 } });
  tools.register(probe);
  executed = 0;
  const agent = makeAgent('sess-lg-1');

  // three asks, three rejections — the refusal seam counts them
  for (let i = 0; i < 3; i++) {
    const r = await run(tools, agent, 'bash_probe', { command: `curl https://h${i}.example/x` });
    assert.equal(executed, 0, 'a rejected ask never executes');
  }
  // the 4th call: the loopguard latch denies BEFORE the approval gate asks
  const r4 = await run(tools, agent, 'bash_probe', { command: 'curl https://h3.example/x' });
  const s = JSON.stringify(r4);
  assert.ok(s.includes('[LG/LG-12'), 'the denial carries the loopguard rule id — ' + s.slice(0, 250));
  assert.ok(s.includes('flailing'), 'the denial names the flailing');
  assert.equal(executed, 0);
  assert.equal(agent.injected.length >= 1, true, 'corrective prose was injected');
  assert.ok(JSON.stringify(agent.injected).includes('Loop guard'), 'the injection teaches the trip');
});

test('composed: the turn boundary clears the behavioral latch (the inbound user signal)', async () => {
  const { ctx, tools } = await boot({ limits: { REDUNDANT_ROSTER_POLLING: 3 } });
  tools.register(probe);
  executed = 0;
  const agent = makeAgent('sess-lg-2');

  // trip LG-5 through identical commands (command-aware fingerprints make
  // them one operation; targetless for the approval gate) — the first two run
  for (let i = 0; i < 2; i++) await run(tools, agent, 'bash_probe', { command: 'ls -la' });
  assert.equal(executed, 2, 'the first two identical calls run');
  const tripped = await run(tools, agent, 'bash_probe', { command: 'ls -la' });
  assert.ok(JSON.stringify(tripped).includes('[LG/LG-5'), 'the roster-polling latch denies — ' + JSON.stringify(tripped).slice(0, 200));
  assert.equal(executed, 2, 'the third identical call is denied by the latch');

  // the inbound user signal: the real session log gets turn/end + turn/start,
  // and the firehose carries them to the loopguard
  agent.session.append('turn/end', { turn: 1 });
  agent.session.append('turn/start', { turn: 2 });
  await new Promise(r => setImmediate(r));

  const after = await run(tools, agent, 'bash_probe', { command: 'a genuinely different command' });
  assert.equal(executed, 3, 'the latch cleared on the user signal — the call runs');
  assert.ok(!JSON.stringify(after).includes('[LG/'), 'no loopguard denial');
});

test('composed: a deterministic trip (LG-7) denies all and never resumes', async () => {
  const { ctx, tools } = await boot({ limits: {} });
  tools.register(probe);
  tools.register(terminalProbe);
  executed = 0;
  const agent = makeAgent('sess-lg-3');

  await run(tools, agent, 'workflow_probe', {});
  const r = await run(tools, agent, 'bash_probe', { command: 'anything at all' });
  const s = JSON.stringify(r);
  assert.equal(executed, 0, 'deny-all: nothing runs after a deterministic trip');
  assert.ok(s.includes('[LG/LG-7'), 'the denial carries the deterministic trip id — ' + s.slice(0, 250));
  assert.ok(agent.injected.some(m => JSON.stringify(m).includes('no auto-resume')), 'the halt prose was injected');

  // the user signal does NOT clear a deterministic trip
  agent.session.append('turn/end', { turn: 1 });
  agent.session.append('turn/start', { turn: 2 });
  await new Promise(r => setImmediate(r));
  const r2 = await run(tools, agent, 'bash_probe', { command: 'try again after the user' });
  assert.ok(JSON.stringify(r2).includes('[LG/LG-7'), 'no auto-resume — the user signal cannot clear it');
});
