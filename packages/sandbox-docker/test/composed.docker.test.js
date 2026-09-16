// Composed test — Phase 2 acceptance against the REAL docker daemon:
// the confinement matrix (network off, fs ceiling honored, deny-list
// honored), the mount-grant cure cycle (denied → request → operator
// approval → grant row → retry passes, ro ceiling holds, revocation
// un-mounts), terminal denials (protected/missing paths), and fail-closed
// unavailability. Real ToolRuntime, real ApprovalService, real
// CommandRuntime, real Session log, real docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { CommandRuntime } from '@deepseek-ai/dsh-commands';
import { Session } from '@deepseek-ai/dsh-session';
import { approvalPlugin } from 'compact-dsh-approval';
import * as sandbox from '../src/index.js';
import { DockerSandboxProvider } from '../src/provider.js';
import { defaultDigestResolver, SupplyChainRefusal } from '../src/provenance.js';

const IMAGE = process.env.COMPACT_TEST_IMAGE ?? 'ubuntu:24.04';

// CF-2 against the real daemon: the acquisition history is keyed by the digest
// the daemon actually holds for this tag, resolved here the same way the
// provider resolves it. The basis is 'operator-declared' — this suite asserts
// a history it did not record, and says so.
const RESOLVED = defaultDigestResolver({ ref: IMAGE });
const PROV = {
  image: IMAGE,
  imageProvenance: [{
    ref: IMAGE, digest: RESOLVED.digest, attestation: 'operator-declared',
    buildApprovals: { hosts: ['archive.ubuntu.com', 'security.ubuntu.com'], paths: [] },
    note: 'upstream base image; history asserted by the test composition, not recorded by it',
  }],
};

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx, config) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return []; }
  getContextOrder() { return 50; }
  section() { return undefined; }
  tools() { return undefined; }
  context() { return () => {}; }
}

function makeAgent(id) {
  const session = Session.create(id, [{ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } }]);
  return { id, session };
}

async function boot({ operator = 'allowed-once', workspaceRoot } = {}) {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ApprovalService);
  ctx.plugin(ToolRuntime);
  ctx.plugin(CommandRuntime);
  approvalPlugin({})(ctx, {});
  sandbox.apply(ctx, { ...PROV });
  const asked = { count: 0 };
  ctx.on('approval/request', async (req, next) => {
    asked.count += 1;
    return typeof operator === 'function' ? operator(req) : operator;
  });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 200 && (!ctx.tools || !ctx.commands); i++) {
    await new Promise(r => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, commands: ctx.commands, asked };
}

// A bash stand-in: confines the command through the REAL provider and spawns
// the wrapped argv — exactly the consumption contract of the host bash tool.
function makeBashTool(ctx, workspaceRoot) {
  return defineTool({
    name: 'bash_probe',
    description: 'run a confined bash command (compact-dsh sandbox composed test)',
    parameters: { command: { type: 'string', description: 'bash command line' } },
    output: { schema: { type: 'string' }, render: (v) => [{ type: 'text', text: String(v) }] },
    async execute(args, exec) {
      const provider = ctx.sandbox;
      const policy = { mode: 'read-only', workspaceRoot, sessionId: exec.agent?.session?.id };
      const confined = provider.confine(['bash', '-c', args.command], policy);
      const out = spawnSync(confined.argv[0], confined.argv.slice(1), { encoding: 'utf8', timeout: 30_000 });
      return JSON.stringify({ status: out.status, stdout: out.stdout?.trim(), stderr: out.stderr?.trim() });
    },
  });
}

const run = (tools, agent, tool, args) =>
  tools.execute({ name: tool, arguments: args, agent, signal: new AbortController().signal });
const runCmd = async (tools, agent, command) => {
  const r = await run(tools, agent, 'bash_probe', { command });
  if (r.isError) throw new Error('bash_probe failed: ' + JSON.stringify(r.error ?? r.content));
  return JSON.parse(String(r.value));
};

// -- provider-level confinement matrix (real daemon) -------------------------

test('composed matrix: read-only confines fs writes, /tmp, and the network', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-sbx-ro-'));
  const p = new DockerSandboxProvider(new Context(), { ...PROV });
  const policy = { mode: 'read-only', workspaceRoot: dir, sessionId: 'sess-x' };
  const run = (cmd) => {
    const c = p.confine(['bash', '-c', cmd], policy);
    return spawnSync(c.argv[0], c.argv.slice(1), { encoding: 'utf8', timeout: 30_000 });
  };
  assert.equal(run('ls / >/dev/null && echo ok').stdout.trim(), 'ok', 'the image fs is readable');
  const wRoot = run('touch /x');
  assert.notEqual(wRoot.status, 0, 'rootfs write denied');
  assert.ok(wRoot.stderr.toLowerCase().includes('read-only file system'), 'the denial speaks the backend dialect');
  assert.notEqual(run(`touch ${dir}/x`).status, 0, 'workspace write denied under read-only (ro bind)');
  assert.notEqual(run('touch /tmp/x').status, 0, 'no writable temp area under read-only');
  assert.notEqual(run('getent hosts example.com').status, 0, 'the network is off (no DNS)');
});

test('composed matrix: workspace-write honors the fs ceiling and keeps the network off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-sbx-ww-'));
  const p = new DockerSandboxProvider(new Context(), { ...PROV });
  const policy = { mode: 'workspace-write', workspaceRoot: dir, sessionId: 'sess-x' };
  const run = (cmd) => {
    const c = p.confine(['bash', '-c', cmd], policy);
    return spawnSync(c.argv[0], c.argv.slice(1), { encoding: 'utf8', timeout: 30_000 });
  };
  const inside = run('echo made-it > made.txt && cat made.txt');
  assert.equal(inside.stdout.trim(), 'made-it', 'workspace writes work');
  assert.notEqual(run('touch /x').status, 0, 'outside-workspace writes still denied');
  assert.equal(run('echo t > /tmp/t.txt && cat /tmp/t.txt').stdout.trim(), 't', 'backend temp area writable');
  assert.notEqual(run('getent hosts example.com').status, 0, 'network stays off in workspace-write');
});

test('composed matrix: the deny-list hides secrets under the bound workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-sbx-mask-'));
  mkdirSync(join(dir, '.ssh'));
  writeFileSync(join(dir, '.ssh', 'id_rsa'), 'PRIVATE KEY MATERIAL');
  const p = new DockerSandboxProvider(new Context(), { ...PROV, maskedPaths: [join(dir, '.ssh')] });
  const policy = { mode: 'workspace-write', workspaceRoot: dir, sessionId: 'sess-x' };
  const c = p.confine(['bash', '-c', `ls -a ${dir} && cat ${dir}/.ssh/id_rsa 2>&1`], policy);
  const out = spawnSync(c.argv[0], c.argv.slice(1), { encoding: 'utf8', timeout: 30_000 });
  assert.ok(out.stdout.includes('.ssh'), 'the directory entry exists (tmpfs over-mount)');
  assert.ok(!out.stdout.includes('PRIVATE KEY MATERIAL'), 'the key material is masked');
  assert.ok(out.stderr.toLowerCase().includes('no such file') || out.stdout.toLowerCase().includes('no such file'), 'the masked file is absent inside');
});

// -- the mount-grant cure cycle through the real runtime ---------------------

test('composed cure: denied path → mount grant via the human gate → retry passes; ro ceiling holds; revocation un-mounts', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'compact-sbx-ws-'));
  const outside = mkdtempSync(join(tmpdir(), 'compact-sbx-out-'));
  writeFileSync(join(outside, 'secret.txt'), 'granted-secret');
  const { ctx, tools, commands, asked } = await boot({ operator: 'allowed-once' });
  tools.register(makeBashTool(ctx, workspace));
  const agent = makeAgent('sess-cure-1');

  // 1. the path is not mounted: the confined read fails
  const denied = await runCmd(tools, agent, `cat ${outside}/secret.txt`);
  assert.notEqual(denied.status, 0, 'an unmounted path fails inside the sandbox');
  assert.ok((denied.stderr ?? '').includes('No such file'), 'the failure is the missing mount');

  // 2. the lawful channel: the request rides the human gate and materializes a grant
  const grant = await run(tools, agent, 'sandbox_request_mount', { path: outside, mode: 'ro', justification: 'the analysis needs the shared dataset' });
  const grantText = JSON.stringify(grant.value ?? grant);
  assert.equal(asked.count, 1, 'the operator was asked exactly once');
  const grantId = grantText.match(/grant (sg_\w+)/)?.[1];
  assert.ok(grantId, 'the grant id is reported — ' + grantText.slice(0, 200));

  // 3. the same command retried now passes — the denial cured itself lawfully
  const cured = await runCmd(tools, agent, `cat ${outside}/secret.txt`);
  assert.equal(cured.stdout.trim(), 'granted-secret', 'cure-on-retry: the grant mounts the path');

  // 4. ceilings hold: a ro grant never upgrades to rw
  const ro = await runCmd(tools, agent, `echo x >> ${outside}/secret.txt`);
  assert.notEqual(ro.status, 0, 'a ro grant never upgrades to rw');
  assert.ok((ro.stderr ?? '').toLowerCase().includes('read-only file system'), 'the ceiling speaks the dialect');

  // 5. already-covered requests do not re-ask
  await run(tools, agent, 'sandbox_request_mount', { path: outside, mode: 'ro', justification: 'again' });
  assert.equal(asked.count, 1, 'a covered path does not re-ask');

  // 6. revocation un-mounts: the operator kills the grant, the retry fails again
  const rev = await commands.execute(agent, `/grants-revoke ${grantId}`, [], new AbortController().signal);
  assert.equal(rev.result.kind, 'success');
  const gone = await runCmd(tools, agent, `cat ${outside}/secret.txt`);
  assert.notEqual(gone.status, 0, 'revocation un-mounts — approval never outlives its grant');
});

test('composed: protected and missing paths are terminal — no gate exists', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'compact-sbx-ws-'));
  const { ctx, tools, asked } = await boot({ operator: 'allowed-once' });
  const agent = makeAgent('sess-term-1');
  tools.register(makeBashTool(ctx, workspace));
  // protected: the operator's ~/.ssh is in the default sensitive set
  const realProtected = await run(tools, agent, 'sandbox_request_mount', { path: `${process.env.HOME}/.ssh`, mode: 'ro', justification: 'I want the keys' });
  const s = JSON.stringify(realProtected);
  assert.ok(s.includes('protected path') && s.includes('terminal'), 'protected paths are terminally refused — ' + s.slice(0, 250));
  assert.equal(asked.count, 0, 'a protected path never reaches the operator');
  // missing
  const missing = await run(tools, agent, 'sandbox_request_mount', { path: '/definitely/not/a/real/path/xyz', mode: 'ro', justification: 'mount it anyway' });
  const sm = JSON.stringify(missing);
  assert.ok(sm.includes('does not exist') && sm.includes('never grantable'), 'missing paths are terminally refused — ' + sm.slice(0, 250));
  assert.equal(asked.count, 0, 'a missing path never reaches the operator');
});

test('composed: sandbox-unavailable = fail-closed (the provider throws, nothing runs)', () => {
  const p = new DockerSandboxProvider(new Context(), { ...PROV, dockerCommand: '/bin/false', probeTimeoutMs: 2_000 });
  assert.throws(() => p.confine(['bash', '-c', 'echo must-not-run'], { mode: 'read-only', workspaceRoot: '/tmp' }),
    (e) => {
      assert.ok(String(e).includes('SANDBOX_UNAVAILABLE') || String(e.code ?? '').includes('SANDBOX') || String(e.message).match(/docker info/i),
        'the error is the fail-closed unavailability, not a passthrough — got: ' + e);
      return true;
    });
});

// -- CF-2 against the real daemon --------------------------------------------

test('composed CF-2: the declared digest is the one the daemon actually holds', () => {
  assert.ok(RESOLVED.ok, `the daemon must resolve ${IMAGE}: ${RESOLVED.detail ?? ''}`);
  assert.match(RESOLVED.digest, /^sha256:[0-9a-f]{64}$/);
  const p = new DockerSandboxProvider(new Context(), { ...PROV });
  const c = p.confine(['bash', '-c', 'echo ok'], { mode: 'read-only', workspaceRoot: '/tmp', sessionId: 'sess-x' });
  assert.equal(spawnSync(c.argv[0], c.argv.slice(1), { encoding: 'utf8', timeout: 30_000 }).stdout.trim(), 'ok');
});

test('composed CF-2: a record whose digest no longer matches the daemon refuses the confinement', () => {
  const stale = { ...PROV, imageProvenance: [{ ...PROV.imageProvenance[0], digest: 'sha256:' + '0'.repeat(64) }] };
  const p = new DockerSandboxProvider(new Context(), stale);
  assert.throws(() => p.confine(['bash', '-c', 'echo must-not-run'], { mode: 'read-only', workspaceRoot: '/tmp' }),
    (e) => e instanceof SupplyChainRefusal && e.ruleId === 'CF-2/digest-drift');
});

test('composed CF-2: the service carries the acquisition history and its declared gap', async () => {
  const { ctx } = await boot({});
  const svc = ctx.get('compact-sandbox');
  assert.equal(svc.provenance.digest, RESOLVED.digest, 'the history travels with the service');
  assert.equal(svc.provenance.attestation, 'operator-declared');
  assert.equal(svc.declaredGaps.length, 1, 'an asserted-but-unverified history is a declared gap (I-8)');
  assert.match(svc.declaredGaps[0], /OPERATOR-DECLARED/);
});
