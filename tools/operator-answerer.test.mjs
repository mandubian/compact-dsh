// Operator answerer tests: unit coverage of the terminal prompter against an
// injected fake readline (no real TTY, no model calls) — default NO on empty,
// EOF, and ^C; allow-once on the explicit choice; malformed input denies — and
// one composed pass through the REAL approval chain (ApprovalService +
// ToolRuntime + compact-approval, mirroring
// packages/approval/test/composed.dsh.test.js) proving the operator's
// allow-once materializes the exec-cache replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { Session } from '@deepseek-ai/dsh-session';
import { approvalPlugin } from '../packages/approval/src/index.js';
import { createOperatorPrompter, operatorAnswerer } from './operator-answerer.mjs';

// behavior: a literal answer string, 'eof' (close before answering), or
// 'sigint' (^C). transcript captures everything written to the fake stderr.
// The fake input counts unref() calls — the prompter must release the loop
// hold on stdin once a prompt settles (#36).
function fakeReadline(behavior, transcript = []) {
  const input = { isTTY: false, unrefCalls: 0, unref() { input.unrefCalls += 1; } };
  return {
    input,
    output: { write: s => (transcript.push(s), true) },
    createInterface() {
      const rl = {
        handlers: {},
        on(ev, fn) { (rl.handlers[ev] ??= []).push(fn); return rl; },
        question(promptText, cb) {
          transcript.push(promptText);
          queueMicrotask(() => {
            if (behavior === 'eof') return rl.close();
            if (behavior === 'sigint') return (rl.handlers.SIGINT ?? []).forEach(f => f());
            cb(behavior);
          });
        },
        close() { (rl.handlers.close ?? []).forEach(f => f()); },
      };
      return rl;
    },
  };
}

const REQ = {
  toolName: 'net_probe',
  callId: 'call-1',
  reason: '[AG/fp-abc123] "net_probe" is not covered by this runtime\'s grant layers\nLawful next moves:\n— escalate to your Principal',
};

test('prompter: explicit choice 2 answers allowed-once and shows tool + envelope on stderr', async () => {
  const transcript = [];
  const prompt = createOperatorPrompter(fakeReadline('2', transcript));
  const outcome = await prompt(REQ);
  assert.equal(outcome, 'allowed-once');
  const shown = transcript.join('');
  assert.ok(shown.includes('tool: net_probe'), 'the prompt names the tool');
  assert.ok(shown.includes('call: call-1'), 'the prompt names the call id');
  assert.ok(shown.includes('[AG/fp-abc123]'), 'the prompt shows the envelope reason');
  assert.ok(shown.includes('1) deny (default)') && shown.includes('2) allow once'), 'the prompt shows the numbered choices');
});

test('prompter: allow aliases answer allowed-once', async () => {
  for (const answer of ['allow', ' allow once ', 'ALLOW']) {
    const prompt = createOperatorPrompter(fakeReadline(answer));
    assert.equal(await prompt(REQ), 'allowed-once', `answer ${JSON.stringify(answer)}`);
  }
});

test('prompter: default NO — empty, deny words, EOF, and ^C all reject', async () => {
  for (const behavior of ['', '   ', '1', 'deny', 'no', 'eof', 'sigint']) {
    const prompt = createOperatorPrompter(fakeReadline(behavior));
    assert.equal(await prompt(REQ), 'rejected', `behavior ${JSON.stringify(behavior)}`);
  }
});

test('prompter: malformed input denies with a note (no re-prompt loop)', async () => {
  const transcript = [];
  const prompt = createOperatorPrompter(fakeReadline('banana', transcript));
  assert.equal(await prompt(REQ), 'rejected');
  assert.ok(transcript.join('').includes('defaulting to deny'), 'the denial is announced');
});

test('prompter: a settled prompt unrefs stdin — the answered ask must not hold the process open (#36)', async () => {
  for (const behavior of ['2', '', 'eof', 'sigint']) {
    const deps = fakeReadline(behavior);
    const prompt = createOperatorPrompter(deps);
    await prompt(REQ);
    assert.equal(deps.input.unrefCalls, 1, `behavior ${JSON.stringify(behavior)}: stdin unref'd exactly once`);
  }
});

test('answerer: compact envelope asks go to the prompter; anything else delegates (fail-closed)', async () => {
  const asked = [];
  const ctx = new Context();
  const disposer = operatorAnswerer(ctx, async req => (asked.push(req), 'allowed-once'));
  const outcomes = [];
  outcomes.push(await ctx.waterfall(null, 'approval/request', { toolName: 't', reason: '[AG/x] not covered' }, () => Promise.resolve('unavailable')));
  outcomes.push(await ctx.waterfall(null, 'approval/request', { toolName: 't', reason: 'some non-compact ask' }, () => Promise.resolve('unavailable')));
  outcomes.push(await ctx.waterfall(null, 'approval/request', { toolName: 't' }, () => Promise.resolve('unavailable')));
  assert.deepEqual(outcomes, ['allowed-once', 'unavailable', 'unavailable'], 'only compact envelope asks reach the operator');
  assert.equal(asked.length, 1);
  disposer();
});

test('answerer: a rogue prompter return is normalized to rejected', async () => {
  const ctx = new Context();
  operatorAnswerer(ctx, async () => 'allowed-always');
  const outcome = await ctx.waterfall(null, 'approval/request', { toolName: 't', reason: '[AG/x] r' }, () => Promise.resolve('unavailable'));
  assert.equal(outcome, 'rejected');
});

// ---- the real hang (#36): a child that prompts on REAL piped stdin ----------

const childSource = `
import { setInterval as keepAlive, clearInterval } from 'node:timers';
import { createOperatorPrompter } from ${JSON.stringify(fileURLToPath(new URL('./operator-answerer.mjs', import.meta.url)))};
// mirror the launcher: a ref'd keep-alive interval stands in for every
// session-living handle (model stream, web server) — the unref'd stdin must
// still deliver while these exist, and stop holding the process once gone
const ka = keepAlive(() => {}, 60_000);
const prompt = createOperatorPrompter();
const req = { toolName: 'net_probe', reason: '[AG/fp-test] uncovered call' };
process.stderr.write('PROMPT_READY\\n');
const first = await prompt(req);
process.stderr.write('OUTCOME:' + first + '\\n');
const second = await prompt(req);
process.stderr.write('OUTCOME:' + second + '\\n');
clearInterval(ka);
// ends here — the session handles are gone: the process must exit on its own
`;

test('settle: with the stdin pipe held open, the answered child still exits — and a second ask still delivers (#36)', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  const t0 = Date.now();
  const result = await new Promise(resolve => {
    let stderr = '';
    let stage = 0;
    const finish = how => resolve({ how, stderr, ms: Date.now() - t0 });
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish('hung'); }, 5_000);
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stage === 0 && stderr.includes('PROMPT_READY')) {
        stage = 1;
        child.stdin.write('2\n'); // allow once — the pipe then stays OPEN, as the live harness keeps it
      } else if (stage === 1 && stderr.includes('OUTCOME:allowed-once')) {
        stage = 2;
        child.stdin.write('1\n'); // a later ask must still deliver after the unref
      }
    });
    child.on('exit', code => { clearTimeout(timer); finish(code === 0 ? 'exited' : `exited(${code})`); });
  });
  assert.equal(result.how, 'exited', `the child must exit on its own — got ${result.how} after ${result.ms}ms; stderr:\n${result.stderr}`);
  assert.ok(result.stderr.includes('OUTCOME:allowed-once'), 'the first ask was answered');
  assert.ok(result.stderr.includes('OUTCOME:rejected'), 'the second ask was answered too — the unref\u2019d stdin still delivers while the session lives');
});

// ---- composed: through the real ApprovalService + ToolRuntime chain --------

let executed = 0;
const probe = defineTool({
  name: 'net_probe',
  description: 'probe a host (compact-dsh operator answerer test)',
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

function makeAgent(id = 'sess-operator-1') {
  const session = Session.create(id, [
    { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } },
  ]);
  return { id, session };
}

async function boot(behavior) {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  const instance = approvalPlugin({});
  instance(ctx, {});
  // downstream of the recorded answerer — the launcher registers the same way
  const transcript = [];
  operatorAnswerer(ctx, createOperatorPrompter(fakeReadline(behavior, transcript)));
  if (typeof ctx.start === 'function') await ctx.start();
  let tools = ctx.tools ?? null;
  for (let i = 0; i < 200 && !tools; i++) {
    await new Promise(r => setImmediate(r));
    tools = ctx.tools ?? null;
  }
  if (!tools) throw new Error('tools runtime did not mount');
  return { ctx, tools, transcript, approval: instance.approval };
}

const run = (tools, agent, host) =>
  tools.execute({ name: 'net_probe', arguments: { host }, agent, signal: new AbortController().signal });

test('composed: the operator sees the gated command, never a bare tool name', async () => {
  const { tools, transcript, approval } = await boot('1');
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  const r = await run(tools, agent, 'evil.example');
  assert.equal(executed, 0, 'denied: the probe must not run');
  assert.ok(JSON.stringify(r).toLowerCase().includes('reject'), 'the denial names the rejection');
  const prompt = transcript.join('');
  assert.ok(prompt.includes('command: {"host":"evil.example"}'), 'the prompt shows the actual call — not just "net_probe"');
  assert.ok(prompt.includes('target: host=evil.example'), 'the prompt shows the canonical target');
  assert.match(prompt, /fingerprint: fp_[0-9a-f]{16}/, 'the fingerprint the decision would materialize');
  assert.equal(approval.deciding.size, 0, 'the preview lives exactly as long as the decision');
});

test('composed: operator allow-once executes and materializes the exec-cache replay', async () => {
  const { tools, transcript } = await boot('2');
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  const r1 = await run(tools, agent, 'evil.example');
  assert.equal(executed, 1, 'an approved ask must execute');
  assert.ok(!JSON.stringify(r1).includes('[AG/I-5'), 'no denial envelope on an approved call');
  assert.ok(transcript.join('').includes('[AG/'), 'the operator saw the compact envelope');

  await run(tools, agent, 'evil.example');
  assert.equal(executed, 2, 'the identical operation replays');
  assert.equal(transcript.filter(s => s.startsWith('\n[compact-dsh]')).length, 1,
    'the replay hit the exec cache — the operator was NOT re-asked (the recorded answerer still owns its asks)');

  const outcomes = [];
  for (let seq = 0; seq < agent.session.seq; seq++) {
    const event = agent.session.eventAt(seq);
    if (event?.type === 'approval/decided') outcomes.push(event.data.outcome);
  }
  assert.deepEqual(outcomes, ['allowed-once'], 'the host audit pair recorded the operator decision');
});

test('composed: operator default-deny blocks execution and a repeat asks again', async () => {
  const { tools, transcript } = await boot('');
  tools.register(probe);
  executed = 0;
  const agent = makeAgent();

  const r = await run(tools, agent, 'denied.example');
  assert.equal(executed, 0, 'a denied ask must not execute');
  assert.ok(JSON.stringify(r).toLowerCase().includes('reject'), 'the denial names the rejection');

  await run(tools, agent, 'denied.example');
  assert.equal(executed, 0);
  assert.equal(transcript.filter(s => s.startsWith('\n[compact-dsh]')).length, 2,
    'a rejected ask releases the pending record — the repeat asks the operator again');
});
