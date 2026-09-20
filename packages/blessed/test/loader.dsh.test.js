import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, loadOverlayPatches, composeEntries } from '@deepseek-ai/dsh-app-boot';
import { extendChain, genesisHash, verifySlice } from 'compact-dsh-record';
import { COMPACT_DIGEST } from 'compact-dsh-constitution';
import { defineTool } from '@deepseek-ai/dsh-tools';

const rootUrl = new URL('../../../package.json', import.meta.url).href;
const baseFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-base/package.json')));
const overlayFile = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url));
const disabled = [
  'sandbox', 'session-persistence-jsonl', 'subagent-fork-in-process',
  'tool-subagent', 'tool-subagent-fork', 'tool-subagent-control',
  'tool-subagent-list-agents', 'workflow-worker-thread', 'tool-workflow',
  'tool-ralph', 'web', 'web-search-deepseek', 'web-fetch-http', 'tool-web',
  'session-title-llm', 'session-telemetry-otel',
  'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-skill', 'skill-filesystem',
];

function fixture(t, customWorkspace = false) {
  const dir = mkdtempSync(join(tmpdir(), 'compact-loader-'));
  const cleanup = [];
  t.after(async () => {
    try {
      for (const dispose of cleanup.reverse()) await dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  const configFile = join(dir, 'cordis.yml');
  writeFileSync(configFile, '[]\n');
  const digest = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', 'ubuntu:24.04'], {
    encoding: 'utf8', timeout: 10_000,
  }).trim();
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  const env = {
    DSH_HOME: join(dir, 'home'),
    DSH_TELEMETRY_DISABLED: '1',
    COMPACT_RECORD_ROOT: join(dir, 'sessions'),
    COMPACT_CHAIN_DIR: join(dir, 'chains'),
    COMPACT_APPROVAL_PERSIST_PATH: join(dir, 'approvals.json'),
    COMPACT_ALLOWLIST: '[]',
    COMPACT_WORKSPACE: customWorkspace ? dir : undefined,
    DSH_PERMISSION_MODE: undefined,
    COMPACT_SANDBOX_IMAGE: 'ubuntu:24.04',
    COMPACT_SANDBOX_IMAGE_DIGEST: digest,
    COMPACT_SANDBOX_RECORDED_BY: 'loader-integration-test',
    COMPACT_SANDBOX_PROVENANCE_NOTE: 'Existing local image; acquisition history is operator-declared, not verified.',
  };
  for (const key of Object.keys(process.env)) {
    if (key.endsWith('_API_KEY') || key.startsWith('COMPACT_') || key.startsWith('DSH_')) {
      if (!(key in env)) env[key] = undefined;
    }
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const setEnv = values => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  setEnv(env);
  cleanup.push(() => setEnv(previous));
  const patches = [
    ...loadOverlayPatches('compact-test', baseFile),
    ...loadOverlayPatches('compact-test', overlayFile),
  ];
  let modelRequests = 0;
  const prepare = ctx => {
    ctx.on('llm/stream', () => {
      modelRequests++;
      throw new Error('loader test forbids model requests');
    }, { prepend: true });
  };
  cleanup.push(() => assert.equal(modelRequests, 0));
  return { env, configFile, patches, cleanup, prepare };
}

async function launch(fixture, patches = fixture.patches) {
  const ctx = await boot('compact-test', fixture.configFile, patches, fixture.prepare, rootUrl);
  fixture.cleanup.push(() => ctx.fiber.dispose());
  return ctx;
}

test('loader: base and blessed patches boot real host services, deny tools and persist chained live sessions', { timeout: 45_000 }, async (t) => {
  const f = fixture(t);
  const warnings = [];
  const rows = composeEntries([f.patches], message => warnings.push(message));
  assert.deepEqual(warnings, []);
  for (const id of disabled) assert.equal(rows.find(row => row.id === id)?.disabled, true, id);
  for (const id of ['tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-skill', 'skill-filesystem']) {
    assert.equal(rows.find(row => row.id === id)?.disabled, true,
      `${id}: host-side reads/search and arbitrary script surfaces are unavailable; pilot file work uses confined bash only`);
  }
  assert.deepEqual(rows.find(row => row.id === 'sandbox-policy').config, {
    mode: 'workspace-write', workspaceRoot: { __jsExpr: 'process.env.COMPACT_WORKSPACE || process.cwd()' },
  });
  assert.deepEqual(rows.find(row => row.id === 'approval').config, { policy: 'ask' });
  assert.deepEqual(rows.find(row => row.id === 'permission').config, {
    presets: {
      'read-only': { sandbox: 'read-only', approval: 'ask' },
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    },
  });
  assert.equal(rows.some(row => row.id === 'headless-runner'), false);
  const ctx = await launch(f);
  for (const name of ['systemPrompt', 'tools', 'subagents', 'sessions', 'sessionPersistence', 'compact-record', 'constitution', 'compact-ready']) {
    assert.ok(ctx.get(name), name);
  }
  assert.deepEqual(ctx.sandboxPolicy.resolve(), { mode: 'workspace-write', workspaceRoot: process.cwd() });
  assert.equal(ctx.approval.config.policy, 'ask');
  assert.deepEqual(ctx.permissionPresets.names, ['read-only', 'workspace-write']);
  assert.deepEqual(ctx.get('compact-ready'), { name: 'compact-blessed', ready: true, digest: COMPACT_DIGEST });
  assert.equal(ctx.get('constitution').digest, COMPACT_DIGEST);
  assert.deepEqual(ctx.get('constitution').attestation().verified.missing, []);
  const bodySeal = ctx.get('constitution').attestation().verified.bodySeal;
  assert.deepEqual(
    { basis: bodySeal.basis, threshold: bodySeal.threshold, distinctSigners: bodySeal.distinctSigners, conveysStanding: bodySeal.conveysStanding },
    { basis: 'dev-keyring', threshold: '2-of-3', distinctSigners: 3, conveysStanding: false },
    'the rehearsal trust root verifies the founder seal over the pinned body at boot');
  assert.equal(ctx.get('compact-capability-gate').breach(), null);
  assert.equal(ctx.get('compact-capability-gate').unregisteredClauses(), null);
  assert.ok(ctx.subagents.getProvider('spawn'));
  assert.equal(ctx.subagents.getProvider('fork'), undefined);
  assert.equal(ctx.get('compact-sandbox').provenance.digest, f.env.COMPACT_SANDBOX_IMAGE_DIGEST);
  assert.deepEqual(ctx.get('compact-allowlist-gate').rules, []);
  const entries = [...ctx.loader.entries()];
  for (const id of disabled) assert.equal(entries.find(entry => entry.options.id === id)?.fiber, undefined, id);
  assert.ok(entries.find(entry => entry.options.id === 'agent-loop').fiber.inject['compact-ready'] === null);

  let requests = 0;
  const server = createServer((req, res) => { requests++; res.end('unexpected'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  f.cleanup.push(() => new Promise(resolve => server.close(resolve)));
  let executions = 0;
  ctx.tools.register(defineTool({
    name: 'loader_network_probe',
    description: 'Loader integration network probe',
    parameters: { url: { type: 'string', description: 'Target URL' } },
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
    async execute({ url }) {
      executions++;
      return (await fetch(url, { signal: AbortSignal.timeout(1_000) })).text();
    },
  }));
  const result = await ctx.tools.execute({
    name: 'loader_network_probe',
    arguments: { url: `http://127.0.0.1:${server.address().port}/` },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /Lawful next moves/);
  assert.match(JSON.stringify(result), /AG-1/);
  assert.equal(executions, 0);
  const bashResult = await ctx.tools.execute({
    name: 'bash',
    arguments: { command: `curl --max-time 1 http://127.0.0.1:${server.address().port}/` },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(bashResult.isError, true);
  assert.match(JSON.stringify(bashResult), /requires approval/);
  assert.equal(requests, 0);

  const persistence = ctx.get('sessionPersistence');
  const record = ctx.get('compact-record');
  assert.equal(record.chained, persistence);
  const session = ctx.sessions.prepare('loader-live');
  const writer = await persistence.create(session.header);
  f.cleanup.push(() => writer.close());
  const detach = ctx.sessions.enter(session);
  t.after(detach);
  ctx.sessions.announce(session);
  session.append('turn/start', { turn: 1 });
  session.append('turn/end', { turn: 1 });
  assert.equal(await ctx.sessions.flush(session), true);
  session.append('turn/start', { turn: 2 });
  await persistence.flush();
  const events = session.snapshotEvents();
  assert.deepEqual(events.filter(event => event.type.startsWith('turn/')).map(({ type, data }) => ({ type, data })), [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1 } },
    { type: 'turn/start', data: { turn: 2 } },
  ]);
  assert.deepEqual((await writer.read()).events, events);
  assert.deepEqual(await record.verify(session.id), { ok: true, events: events.length });
  assert.ok(verifySlice({ sessionId: session.id, firstSeq: 0, events, links: record.store.load(session.id).links }));
  assert.equal(record.head(session.id), extendChain(genesisHash(session.id), 0, events).at(-1).h);
  assert.match(readFileSync(join(f.env.COMPACT_RECORD_ROOT, '_no-cwd', session.id, 'session.v3.jsonl'), 'utf8'), /turn\/end/);
  assert.equal(readFileSync(join(f.env.COMPACT_CHAIN_DIR, `${session.id}.chain`), 'utf8').trim().split('\n').length, events.length);
});

test('loader: benign bash pwd runs through Docker offline; workdir remains the policy workspace root', { timeout: 45_000 }, async (t) => {
  const f = fixture(t, true);
  const ctx = await launch(f);
  const workspaceRoot = f.env.COMPACT_WORKSPACE;
  const session = ctx.sessions.prepare('loader-confined-pwd');
  const spawns = [];
  const spawn = ctx.subprocess.spawn;
  t.mock.method(ctx.subprocess, 'spawn', function (spec) {
    spawns.push(spec);
    return spawn.call(this, spec);
  });
  for (const mode of ['workspace-write', 'read-only']) {
    ctx.permissionPresets.set(session, mode);
    const sandboxPolicy = ctx.sandboxPolicy.resolve({ session });
    assert.deepEqual(sandboxPolicy, { mode, workspaceRoot, sessionId: session.id });
    assert.equal(ctx.approval.effectivePolicy(session), 'ask');
    const spec = ctx.shell.resolve({
      command: 'pwd',
      workdir: process.cwd(),
      sandboxPolicy,
      timeoutMs: 10_000,
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(spec.command, 'pwd');
    assert.equal(spec.workdir, process.cwd());
    assert.equal(spec.timeoutMs, 10_000);
    assert.ok(spec.stdoutMaxBytes > 0);
    const result = await ctx.shell.run(spec);
    assert.equal(result.exitCode, 0, result.stderr.text);
    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, false);
    assert.equal(result.stdout.text.trim(), workspaceRoot,
      'Stock bash workdir sets the host subprocess cwd, not Docker cwd; container cwd is the policy workspace root');
    assert.deepEqual(result.sandbox, { mode, denied: false, enforcement: 'full' });
    const host = spawns.at(-1);
    assert.equal(host.cwd, process.cwd());
    assert.deepEqual(host.argv.slice(0, 6), ['docker', 'run', '--rm', '--network', 'none', '--read-only']);
    assert.deepEqual(host.argv.slice(-6), ['-w', workspaceRoot, f.env.COMPACT_SANDBOX_IMAGE, 'bash', '-c', 'pwd']);
    assert.ok(host.argv.includes(`type=bind,source=${workspaceRoot},target=${workspaceRoot}${mode === 'read-only' ? ',readonly' : ''}`));
  }
  assert.equal(spawns.length, 2);
});

test('loader: full-access environment refuses readiness without executing commands', { timeout: 45_000 }, async (t) => {
  const f = fixture(t);
  process.env.DSH_PERMISSION_MODE = 'danger-full-access';
  await assert.rejects(boot('compact-test', f.configFile, f.patches, f.prepare, rootUrl), /danger-full-access is unavailable/);
});

test('loader: effective policy rejects unsupported modes without executing commands', { timeout: 45_000 }, async (t) => {
  const f = fixture(t);
  const ctx = await launch(f);
  const session = ctx.sessions.prepare('loader-policy-only');
  session.append('sandbox/mode', { mode: 'danger-full-access' });
  assert.throws(() => ctx.sandboxPolicy.resolve({ session }), /effective sandbox mode must be read-only or workspace-write/);
  assert.throws(() => ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' }), /effective sandbox mode must be read-only or workspace-write/);
});

test('loader: disabled required provider prevents readiness', { timeout: 45_000 }, async (t) => {
  const f = fixture(t);
  await assert.rejects(boot('compact-test', f.configFile, [
    ...f.patches, { id: 'compact-record-provider', disabled: true },
  ], undefined, rootUrl), /compact-record|sessionPersistence/);
});

test('loader: missing operator approval path refuses boot', { timeout: 45_000 }, async (t) => {
  const f = fixture(t);
  delete process.env.COMPACT_APPROVAL_PERSIST_PATH;
  await assert.rejects(boot('compact-test', f.configFile, f.patches, undefined, rootUrl), /approval.persistPath/);
});

test('loader: a declared enforcer annex signs what the runtime says — attestations, subject certs, chain anchors', { timeout: 60_000 }, async (t) => {
  const f = fixture(t);
  const { ensureRehearsalKeyring } = await import('../../../tools/rehearsal-keyring.mjs');
  const kr = mkdtempSync(join(tmpdir(), 'loader-enforcer-'));
  t.after(() => rmSync(kr, { recursive: true, force: true }));
  ensureRehearsalKeyring(kr);
  process.env.COMPACT_ENFORCER_ANNEX = join(kr, 'enforcer.annex.json');
  process.env.COMPACT_ENFORCER_KEY = join(kr, 'enforcer.pem');
  t.after(() => { delete process.env.COMPACT_ENFORCER_ANNEX; delete process.env.COMPACT_ENFORCER_KEY; });

  const ctx = await launch(f);
  // the composition's identity: the annex verified against the pinned law
  const record = ctx.get('compact-record');
  assert.match(record.declaredGaps[0], /AUTHORSHIP-ANCHORED/, 'the record declares the anchored posture');
  // the self-model signs what it says, and certifies the Subject
  const selfModel = ctx.get('compact-self-model');
  const att = selfModel.attest('loader-annex-subject');
  assert.equal(att.basis, 'dev-keyring');
  assert.equal(selfModel.verifyAttestation(att).valid, true);
  const identity = selfModel.subjectIdentity('loader-annex-subject');
  assert.ok(identity, 'a subject session identity was issued');
  assert.deepEqual(selfModel.verifySubjectCert(identity.cert).valid, true);
  // a session on the record is authored: anchors cover its chain head
  const session = ctx.sessions.prepare('loader-annex-live');
  const writer = await ctx.get('sessionPersistence').create(session.header);
  f.cleanup.push(() => writer.close());
  const detach = ctx.sessions.enter(session);
  t.after(detach);
  ctx.sessions.announce(session);
  session.append('turn/start', { turn: 1 });
  session.append('turn/end', { turn: 1 });
  await ctx.sessions.flush(session);
  const verdict = await record.verifyAnchors(session.id);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.basis, 'dev-keyring');
  assert.equal(verdict.conveysStanding, false);
});
