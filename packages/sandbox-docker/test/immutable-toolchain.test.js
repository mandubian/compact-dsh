// Composed test — #152's acceptance, through the REAL pre-execute waterfall
// (real ToolRuntime, real ApprovalService, the sandbox and the remote-access
// analyzer in the blessed order): the apt-get act is refused BEFORE any
// approval ask fires (the dishonest ask is the bug), the envelope rides the
// refusal, workspace-scoped installs ride clean, the analyzer still owns
// every act that CAN succeed, and the belt wraps the read-only dialect of a
// package-manager-shaped failure. No docker daemon: the probe stands in for
// the confined execution, exactly the consumption contract of the host bash
// tool (composed.docker.test.js pins the real-daemon side).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { Session } from '@deepseek-ai/dsh-session';
import { approvalPlugin, REFUSAL_EVENT } from 'compact-dsh-approval';
import * as remoteAccess from 'compact-dsh-remote-access';
import * as sandbox from '../src/index.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx, config) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return []; }
  getContextOrder() { return 50; }
  section() { return undefined; }
  tools() { return undefined; }
  context() { return () => {}; }
}

// CF-2: every provider needs a declared, digest-keyed acquisition history for
// the image it runs, even though this suite never confines (no daemon).
const PROV = {
  image: 'ubuntu:24.04',
  imageProvenance: [{
    ref: 'ubuntu:24.04', digest: 'sha256:' + 'a'.repeat(64), attestation: 'build-recorded',
    buildApprovals: { hosts: ['archive.ubuntu.com'], paths: [] },
  }],
};

let executed = 0;
const probe = defineTool({
  name: 'bash_probe',
  description: 'stand-in for the confined bash tool (immutable-toolchain composed test)',
  parameters: { command: { type: 'string' } },
  output: { schema: { type: 'string' }, render: (v) => [{ type: 'text', text: String(v) }] },
  async execute(args) { executed += 1; return `ran: ${args.command}`; },
});

// a tool whose confined execution fails with the backend's own dialect — the
// shape the post-execute belt exists for (e.g. pip --user under a read-only HOME)
const roProbe = defineTool({
  name: 'ro_probe',
  description: 'fails with the read-only dialect (immutable-toolchain composed test)',
  parameters: { command: { type: 'string' } },
  output: { schema: { type: 'string' }, render: (v) => [{ type: 'text', text: String(v) }] },
  async execute(args) {
    throw new Error(`/usr/bin/pip: cannot install for '${args.command}': Read-only file system`);
  },
});

function makeAgent(id) {
  const session = Session.create(id, [{ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } }]);
  return { id, session };
}

// The blessed order (#152): the sandbox BEFORE the remote-access analyzer —
// the immutable-toolchain refusal must register ahead of the analyzer's ask.
async function boot({ operator = 'allowed-once' } = {}) {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  approvalPlugin({})(ctx, {});
  sandbox.apply(ctx, { ...PROV });
  remoteAccess.apply(ctx, {});
  const asked = { count: 0 };
  const refusals = [];
  ctx.on('approval/request', async (req, next) => { asked.count += 1; return operator; });
  ctx.on(REFUSAL_EVENT, (payload) => refusals.push(payload));
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 200 && !ctx.tools; i++) await new Promise(r => setImmediate(r));
  return { ctx, tools: ctx.tools, asked, refusals };
}

const run = (tools, agent, tool, args) =>
  tools.execute({ name: tool, arguments: args, agent, signal: new AbortController().signal });

test('#152 acceptance: the apt-get act is refused pre-execute with the envelope — zero approval ask fires', async () => {
  const { tools, asked, refusals } = await boot();
  tools.register(probe);
  executed = 0;
  const agent = makeAgent('sess-imm-1');

  const r = await run(tools, agent, 'bash_probe', { command: 'apt-get install -y python3' });
  const s = JSON.stringify(r);
  assert.equal(executed, 0, 'the act never runs');
  assert.equal(asked.count, 0, 'the dishonest ask for archive.ubuntu.com never fires — the bug IS the ask');
  assert.ok(s.includes('[SC/CF-1/immutable-toolchain]'), 'the refusal names the rule — ' + s.slice(0, 300));
  assert.ok(s.includes('the system toolchain is immutable and digest-pinned (CF-2) — installing system packages inside a confined act cannot succeed by design'),
    'the canonical sentence rides the refusal');
  assert.ok(s.includes('Lawful next moves'), 'the moves are taught');
  assert.ok(s.includes('python3 -m venv .venv && .venv/bin/pip install …'), 'the workspace-venv move');
  assert.ok(s.includes('a static binary into `./bin/`'), 'the static-binary move');
  assert.ok(s.includes('read-only mount grant over an operator-provisioned tools directory'), 'the mount-grant move');
  assert.ok(s.includes('bake a derived image'), 'the derived-image move');
  assert.ok(refusals.some(p => p?.verdict === 'immutable-toolchain'),
    'the refusal seam carries the verdict for the LoopGuard\'s accounting');
});

test('the whole doomed family refuses at the waterfall, never asked, never run', async () => {
  const { tools, asked } = await boot();
  tools.register(probe);
  executed = 0;
  const agent = makeAgent('sess-imm-2');
  for (const command of [
    'apt-get install -y python3',
    'apt install jq',
    'dnf install -y jq',
    'yum install jq',
    'apk add --no-cache curl',
    'apt-get update && apt-get install -y jq',
    'sudo apt-get install python3',
    'sh -c "apt-get install -y python3"',
    'pip install requests',
    'python3 -m pip install requests',
  ]) {
    const r = await run(tools, agent, 'bash_probe', { command });
    const s = JSON.stringify(r);
    assert.ok(s.includes('[SC/CF-1/immutable-toolchain]'), `${command} refused with the envelope — ` + s.slice(0, 200));
    assert.ok(!s.includes('ran:'), `${command} never executed`);
  }
  assert.equal(executed, 0);
  assert.equal(asked.count, 0, 'zero asks for the whole family');
});

test('precision: a workspace-scoped install rides clean through the recognition', async () => {
  const { tools, asked } = await boot();
  tools.register(probe);
  executed = 0;
  const agent = makeAgent('sess-imm-3');
  for (const command of [
    'python3 -m venv .venv && .venv/bin/pip install requests',
    '.venv/bin/pip install requests',
    'source .venv/bin/activate && pip install requests',
    'pip install --target ./vendor requests',
    'pip install --user requests',
  ]) {
    const r = await run(tools, agent, 'bash_probe', { command });
    const s = JSON.stringify(r);
    assert.ok(!s.includes('SC/CF-1'), `${command} is lawful — no immutable-toolchain refusal: ` + s.slice(0, 200));
    assert.equal(executed > 0, true, `${command} ran`);
  }
  assert.ok(asked.count >= 1, 'the lawful installs still ask for their egress honestly (pypi) — recognition refused nothing');
});

test('the analyzer still owns the acts that can succeed (the reorder silenced nothing else)', async () => {
  const { tools, asked } = await boot({ operator: 'rejected' });
  tools.register(probe);
  executed = 0;
  const agent = makeAgent('sess-imm-4');
  const r = await run(tools, agent, 'bash_probe', { command: 'curl https://h.example/x' });
  assert.equal(executed, 0, 'the rejected ask never executes');
  assert.equal(asked.count, 1, 'the ask fired for a GENUINELY approvable act');
  assert.ok(JSON.stringify(r).includes('rejected'), 'the rejection surfaces — ' + JSON.stringify(r).slice(0, 200));
});

test('#152 belt: a read-only dialect from a package-manager-shaped failure wraps into the envelope', async () => {
  // allowed-once: the analyzer's honest egress ask for pypi is answered, the
  // act runs, the confined write fails with the backend's dialect
  const { tools } = await boot({ operator: 'allowed-once' });
  tools.register(roProbe);
  const agent = makeAgent('sess-imm-5');

  // the shape precision spares pre-execute (pip --user against a read-only HOME)
  const r = await run(tools, agent, 'ro_probe', { command: 'pip install --user requests' });
  const s = JSON.stringify(r);
  assert.ok(s.includes('[SC/CF-1/immutable-toolchain]'), 'the belt teaches — ' + s.slice(0, 300));
  assert.ok(s.includes('Read-only file system'), 'the container\'s own words stay on the record');

  // a non-package-manager failure with the same dialect is not the belt's business
  const other = await run(tools, agent, 'ro_probe', { command: 'grep -r needle /usr/share' });
  const so = JSON.stringify(other);
  assert.ok(!so.includes('SC/CF-1'), 'a non-package-manager read failure flows untouched');
  assert.ok(so.includes('Read-only file system'), 'the raw failure still reaches the Subject');
});

test('#152 belt: a workspace-scoped act is never taught over (the move it already made)', async () => {
  const { tools } = await boot({ operator: 'allowed-once' });
  tools.register(roProbe);
  const agent = makeAgent('sess-imm-6');
  for (const command of ['npm install left-pad', 'pip install --target ./vendor requests', '.venv/bin/pip install requests']) {
    const r = await run(tools, agent, 'ro_probe', { command });
    const s = JSON.stringify(r);
    assert.ok(!s.includes('SC/CF-1'), `${command} is the lawful move — the belt stays silent — ` + s.slice(0, 200));
    assert.ok(s.includes('Read-only file system'), `${command} reaches execution and fails on the record`);
  }
});
