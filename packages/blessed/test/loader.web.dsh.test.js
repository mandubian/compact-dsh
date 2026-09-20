// The web surface boots governed: the browser composition (dsh-base +
// dsh-web-app + the blessed overlay + the launcher's web rows) starts clean
// with the dynamic-plugin runner ABSENT (A-4/DYN), starts its loop only after
// compact-ready, chains its sessions through the compact record, and still
// gates bash at the waterfall. No model request is made. Docker is required
// exactly as in loader.dsh.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';
import { provideCmdline } from '@deepseek-ai/dsh-cmdline';
import { extendChain, genesisHash, verifySlice } from 'compact-dsh-record';
import { COMPACT_DIGEST } from 'compact-dsh-constitution';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PRESET_ID, ensureInstallAnchor, presetCompositionPath, webRows } from '../src/web.js';

const rootUrl = new URL('../../../package.json', import.meta.url).href;
const baseFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-base/package.json')));
const webFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-web-app/package.json')));
const overlayFile = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'compact-web-loader-'));
  const cleanup = [];
  t.after(async () => {
    try {
      for (const dispose of cleanup.reverse()) await dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  const configFile = join(dir, 'home', 'cordis.yml');
  mkdirSync(dirname(configFile), { recursive: true });
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
    COMPACT_WORKSPACE: dir,
    DSH_PERMISSION_MODE: undefined,
    COMPACT_SANDBOX_IMAGE: 'ubuntu:24.04',
    COMPACT_SANDBOX_IMAGE_DIGEST: digest,
    COMPACT_SANDBOX_RECORDED_BY: 'web-loader-integration-test',
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
  // the launcher's exact web stack, exercised through the same rows it mounts
  const patches = [
    ...loadOverlayPatches('compact-test', baseFile),
    ...loadOverlayPatches('compact-test', webFile),
    ...loadOverlayPatches('compact-test', overlayFile),
    { id: 'tools', config: { mode: 'native' } },
    ...webRows(),
  ];
  let modelRequests = 0;
  const prepare = ctx => {
    // the launcher provides the cmdline before the tree settles; --port 0 lets
    // the OS pick the test's listen port and --no-open skips the browser
    provideCmdline(ctx, { args: ['--no-open', '--port', '0'], exit: () => {} });
    ctx.on('llm/stream', () => {
      modelRequests++;
      throw new Error('web loader test forbids model requests');
    }, { prepend: true });
  };
  cleanup.push(() => assert.equal(modelRequests, 0));
  return { env, dir, configFile, patches, cleanup, prepare };
}

async function launch(fixture, patches = fixture.patches) {
  const ctx = await boot('compact-test', fixture.configFile, patches, fixture.prepare, rootUrl);
  fixture.cleanup.push(() => ctx.fiber.dispose());
  return ctx;
}

test('loader web: the browser surface boots governed — runner absent, loop gated, record chained, gates armed', { timeout: 90_000 }, async (t) => {
  const f = fixture(t);
  await ensureInstallAnchor(f.env.DSH_HOME);
  const warnings = [];
  const rows = composeEntries([f.patches], message => warnings.push(message));
  assert.deepEqual(warnings, []);
  assert.equal(rows.find(row => row.id === 'cordis-host-runner')?.disabled, true);
  assert.equal(rows.find(row => row.id === 'code-runtime')?.disabled, true);
  assert.equal(rows.find(row => row.id === 'agent-presets')?.config?.default, PRESET_ID);
  assert.equal(rows.some(row => row.id === 'headless-runner'), false);
  assert.equal(rows.some(row => row.id === 'tool-cordis'), false);
  const ctx = await launch(f);
  for (const name of ['systemPrompt', 'tools', 'subagents', 'sessions', 'sessionPersistence', 'compact-record', 'constitution', 'compact-ready', 'agentPresets']) {
    assert.ok(ctx.get(name), name);
  }
  assert.deepEqual(ctx.get('compact-ready'), { name: 'compact-blessed', ready: true, digest: COMPACT_DIGEST });
  assert.equal(ctx.get('constitution').digest, COMPACT_DIGEST);
  assert.deepEqual(ctx.get('constitution').attestation().verified.missing, []);

  // A-4/DYN is absent on the interactive surface, and the gate says so
  assert.equal(ctx.get('dynamicCordisRunner'), undefined);
  const gate = ctx.get('compact-capability-gate');
  assert.equal(gate.breach(), null);
  assert.equal(gate.unregisteredClauses(), null);
  const dyn = gate.assess().find(part => part.part === 'A-4/DYN');
  assert.deepEqual({ triggered: dyn.triggered, posture: dyn.posture }, { triggered: false, posture: 'absent' });
  assert.deepEqual(gate.absent().filter(({ part }) => part === 'A-4/DYN').map(({ tool }) => tool).sort(),
    ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine']);

  // the roster selects the compact preset, and the checkout preset is healthy
  const roster = ctx.get('agentPresets');
  assert.equal(roster.defaultId, PRESET_ID);
  const listed = await roster.list();
  assert.deepEqual(listed.map(preset => preset.id), [PRESET_ID], 'the roster carries exactly the pilot preset');
  const mine = listed[0];
  assert.equal(mine.broken, undefined, `${PRESET_ID} composition healthy: ${mine?.broken}`);
  assert.equal(mine.path, presetCompositionPath());

  // the loop binds to readiness exactly as headless does
  const entries = [...ctx.loader.entries()];
  assert.equal(entries.find(entry => entry.options.id === 'agent-loop').fiber.inject['compact-ready'], null);

  // the gates ride the waterfall under the browser rows: recorded denial, no
  // execution. The probe is test-registered because the model-facing tool
  // catalog is preset-plane on the web surface — bash mounts per agent at
  // session time, and that path is exercised live in docs/demo.md (Demo 7).
  let requests = 0;
  const server = createServer((req, res) => { requests++; res.end('unexpected'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  f.cleanup.push(() => new Promise(resolve => server.close(resolve)));
  let executions = 0;
  ctx.tools.register(defineTool({
    name: 'web_loader_network_probe',
    description: 'Web loader integration network probe',
    parameters: { url: { type: 'string', description: 'Target URL' } },
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
    async execute({ url }) {
      executions++;
      return (await fetch(url, { signal: AbortSignal.timeout(1_000) })).text();
    },
  }));
  const result = await ctx.tools.execute({
    name: 'web_loader_network_probe',
    arguments: { url: `http://127.0.0.1:${server.address().port}/` },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /Lawful next moves/);
  assert.match(JSON.stringify(result), /AG-1/);
  assert.equal(executions, 0);
  assert.equal(requests, 0);

  // browser sessions route through the chained record
  const persistence = ctx.get('sessionPersistence');
  const record = ctx.get('compact-record');
  assert.equal(record.chained, persistence);
  const session = ctx.sessions.prepare('web-loader-live');
  const writer = await persistence.create(session.header);
  f.cleanup.push(() => writer.close());
  const detach = ctx.sessions.enter(session);
  t.after(detach);
  ctx.sessions.announce(session);
  session.append('turn/start', { turn: 1 });
  session.append('turn/end', { turn: 1 });
  assert.equal(await ctx.sessions.flush(session), true);
  const events = session.snapshotEvents();
  assert.deepEqual((await writer.read()).events, events);
  assert.deepEqual(await record.verify(session.id), { ok: true, events: events.length });
  assert.ok(verifySlice({ sessionId: session.id, firstSeq: 0, events, links: record.store.load(session.id).links }));
  assert.equal(record.head(session.id), extendChain(genesisHash(session.id), 0, events).at(-1).h);
  assert.match(readFileSync(join(f.env.COMPACT_RECORD_ROOT, '_no-cwd', session.id, 'session.v3.jsonl'), 'utf8'), /turn\/end/);
  assert.equal(readFileSync(join(f.env.COMPACT_CHAIN_DIR, `${session.id}.chain`), 'utf8').trim().split('\n').length, events.length);
});

test('loader web: a mounted dynamicCordisRunner after boot latches a breach that denies every tool call', { timeout: 90_000 }, async (t) => {
  // the interactive surface's absence is enforced, not intended: a trigger
  // that arrives late must latch, and uncertainty must block (D-7)
  const f = fixture(t);
  await ensureInstallAnchor(f.env.DSH_HOME);
  const ctx = await launch(f);
  const gate = ctx.get('compact-capability-gate');
  assert.equal(gate.breach(), null);
  ctx.provide('dynamicCordisRunner', { fake: true });
  const breach = gate.breach();
  assert.ok(breach, 'the late mount must latch a breach');
  assert.equal(breach.part, 'A-4/DYN');
  ctx.tools.register(defineTool({
    name: 'web_loader_breach_probe',
    description: 'Breach denial probe',
    parameters: {},
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
    async execute() { return 'should never run'; },
  }));
  const denied = await ctx.tools.execute({
    name: 'web_loader_breach_probe',
    arguments: {},
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /D-8\/unbound-capability/);
});
