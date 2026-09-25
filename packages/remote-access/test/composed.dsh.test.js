// Composed test — remote-access findings route through the Phase 1 grant
// layers in the REAL runtime (real ToolRuntime, real ApprovalService, real
// Session log): "this command needs network" is approvable per-host, not
// per-command; opaque findings fail closed with an envelope; the refusal
// rides the LoopGuard seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { CommandRuntime } from '@deepseek-ai/dsh-commands';
import { Session } from '@deepseek-ai/dsh-session';
import { approvalPlugin, REFUSAL_EVENT } from 'compact-dsh-approval';
import * as remoteAccess from '../src/index.js';

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
const bashProbe = defineTool({
  name: 'bash_probe',
  description: 'run a bash command line (remote-access composed test; no sandbox — analysis only)',
  parameters: { command: { type: 'string', description: 'bash command line' } },
  output: { schema: { type: 'string' }, render: (v) => [{ type: 'text', text: String(v) }] },
  async execute(args) { executed += 1; return `ran: ${args.command}`; },
});

function makeAgent(id) {
  const session = Session.create(id, [{ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } }]);
  return { id, session };
}

async function boot({ operator = 'allowed-once' } = {}) {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  ctx.plugin(CommandRuntime);
  approvalPlugin({})(ctx, {});
  remoteAccess.apply(ctx, {});
  const asked = { count: 0, reasons: [] };
  ctx.on('approval/request', async (req, next) => {
    asked.count += 1;
    asked.reasons.push(req.reason);
    return typeof operator === 'function' ? operator(req) : operator;
  });
  const refusals = [];
  ctx.on(REFUSAL_EVENT, (p) => refusals.push(p));
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 200 && (!ctx.tools || !ctx.commands); i++) {
    await new Promise(r => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, commands: ctx.commands, asked, refusals };
}

const run = (tools, agent, command) =>
  tools.execute({ name: 'bash_probe', arguments: { command }, agent, signal: new AbortController().signal });

test('composed: a URL finding asks the human gate per-host; the approval replays per-URL', async () => {
  const { tools, asked } = await boot({ operator: 'allowed-once' });
  tools.register(bashProbe);
  executed = 0;
  const agent = makeAgent('sess-ra-1');

  const r1 = await run(tools, agent, 'curl https://evil.example/x');
  assert.equal(executed, 1, 'approved network access runs');
  assert.equal(asked.count, 1);
  assert.ok(asked.reasons[0].includes('Lawful next moves'), 'the ask carries the envelope');

  await run(tools, agent, 'curl https://evil.example/x');
  assert.equal(asked.count, 1, 'the same URL replays without re-asking (exec cache, per-URL identity)');

  await run(tools, agent, 'curl https://evil.example/other-path');
  assert.equal(asked.count, 2, 'a different URL on the same host is a NEW fingerprint — asks again');
  assert.equal(executed, 3);
});

test('composed: a session grant for the host covers every URL of that host (approvable per-host, not per-command)', async () => {
  const { tools, commands, asked } = await boot({ operator: 'allowed-once' });
  tools.register(bashProbe);
  executed = 0;
  const agent = makeAgent('sess-ra-2');

  const g = await commands.execute(agent, '/grants-grant *.example.com 30', [], new AbortController().signal);
  assert.equal(g.result.kind, 'success', JSON.stringify(g.result));

  await run(tools, agent, 'curl https://a.example.com/x');
  await run(tools, agent, 'wget http://b.example.com/y');
  await run(tools, agent, 'git clone https://c.example.com/repo.git');
  assert.equal(executed, 3, 'every command on a granted host suffix runs');
  assert.equal(asked.count, 0, 'no per-command asking under a host grant');

  await run(tools, agent, 'curl https://evil.other.org/x');
  assert.equal(asked.count, 1, 'a host outside the grant still asks');
});

test('composed: opaque network access is refused with an envelope, never asked forever', async () => {
  const { tools, asked, refusals } = await boot({ operator: 'allowed-once' });
  tools.register(bashProbe);
  executed = 0;
  const agent = makeAgent('sess-ra-3');

  const r = await run(tools, agent, 'curl $DEPLOY_URL');
  assert.equal(executed, 0, 'opaque network access never runs');
  const s = JSON.stringify(r);
  assert.ok(s.includes('D-7/opaque-network'), 'the denial names its rule — ' + s.slice(0, 250));
  assert.ok(s.includes('Lawful next moves'), 'the denial lists lawful next moves');
  assert.ok(s.includes('literal host'), 'the repair is named');
  assert.equal(asked.count, 0, 'an ungrantable request never reaches the operator');
  assert.equal(refusals.length, 1, 'the refusal rides the LoopGuard seam');
  assert.equal(refusals[0].kind, 'deny');
});

test('composed: non-network commands pass through untouched', async () => {
  const { tools, asked, refusals } = await boot({ operator: 'allowed-once' });
  tools.register(bashProbe);
  executed = 0;
  const agent = makeAgent('sess-ra-4');
  await run(tools, agent, 'ls -la && grep -r TODO src/');
  await run(tools, agent, 'cat /etc/hostname');
  assert.equal(executed, 2);
  assert.equal(asked.count, 0);
  assert.equal(refusals.length, 0);
});

test('composed: a presence check mentioning a verb is not network access (issue #5)', async () => {
  const { tools, asked, refusals } = await boot({ operator: 'allowed-once' });
  tools.register(bashProbe);
  executed = 0;
  const agent = makeAgent('sess-ra-4b');
  await run(tools, agent, 'command -v curl');
  await run(tools, agent, 'which wget && man ssh');
  assert.equal(executed, 2, 'provably non-invoking mentions run ungated');
  assert.equal(asked.count, 0);
  assert.equal(refusals.length, 0);
  const r = await run(tools, agent, 'sudo curl $DEPLOY_URL');
  assert.equal(executed, 2, 'dangerous-adjacent forms still fail closed');
  assert.ok(JSON.stringify(r).includes('D-7/opaque-network'));
});

test('composed: non-command args are not scanned (fs contents are not commands)', async () => {
  const { tools, asked } = await boot({ operator: 'allowed-once' });
  const noteTool = defineTool({
    name: 'fs_write_probe',
    description: 'write a note (not a shell)',
    parameters: { path: { type: 'string' }, content: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (v) => [{ type: 'text', text: String(v) }] },
    async execute(args) { executed += 1; return `wrote ${args.path}`; },
  });
  tools.register(noteTool);
  executed = 0;
  const agent = makeAgent('sess-ra-5');
  await tools.execute({ name: 'fs_write_probe', arguments: { path: '/tmp/notes.txt', content: 'remember to curl https://evil.example later' }, agent, signal: new AbortController().signal });
  assert.equal(executed, 1, 'file contents mentioning curl are not network access');
  assert.equal(asked.count, 0);
});

test('composed: the compound rider closes (#26 B) — an rm-rf tail no longer rides the plain read\'s approval', async () => {
  const { tools, asked } = await boot({ operator: 'allowed-once' });
  tools.register(bashProbe);
  executed = 0;
  const agent = makeAgent('sess-ra-rider');

  const plain = 'curl https://rider.example/v1';
  await run(tools, agent, plain);
  assert.equal(executed, 1);
  assert.equal(asked.count, 1, 'the plain read asks once');

  await run(tools, agent, plain);
  assert.equal(asked.count, 1, 'the identical read replays (provable read, class identity unchanged)');

  await run(tools, agent, `${plain} && rm -rf /workspace`);
  assert.equal(asked.count, 2, 'the rider asks AGAIN — its tail is unprovable, so its identity is command-scoped');
  assert.ok(asked.reasons[1].includes('not statically provable as read-only'), 'the ask says so before the decision');
  assert.equal(executed, 3, 'and runs once approved (plain, its replay, then the rider)');

  await run(tools, agent, `${plain} && rm -rf /elsewhere`);
  assert.equal(asked.count, 3, 'a differently-tailed rider is a different command — no cross-command identity');
});
