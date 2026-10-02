#!/usr/bin/env node
// The end-to-end probe (#142): install the packed artifact into a scratch
// STOCK dsh profile and prove the whole story on it — boot, a governed call
// riding the waterfall onto the chained record, an approval ask answered
// through the recorded answerer's downstream seat, and the offline auditor
// passing on what landed. This is the path the web UI's plugin manager
// serves; everything here uses the artifact the way a plain-dsh operator
// would have it.
//
// Fidelity rules, stated so the transcript can cite them:
//   - The COMPACT CODE runs from the PROFILE's node_modules (the pnpm-added
//     tarball), resolved through dsh's own profile machinery —
//     loadProfileDirectory + createRuntimeResolution + PluginPackages, the
//     exact recipe dsh's launcher (runProfile) uses. The checkout supplies
//     the probe script and the dsh runtime it shares with the profile's
//     peer range; it supplies no compact row.
//   - No launcher env: COMPACT_RECORD_ROOT and friends are UNSET — the
//     posture layer's profile-context derivation must place the state, or
//     the record provider refuses. The sandbox image is the one explicit
//     operator act the posture layer demands (blessed validates it at
//     mount), read from the local daemon like docs/demo.md prescribes.
//   - No model: an `llm/stream` listener throws, the way the smoke guard
//     does — the governed calls are driven through ctx.tools.execute with
//     an attached session, which is the same waterfall a model-driven call
//     rides, minus the model.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packComposition } from './dist.mjs';

const BIN = 'dist-probe:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DSH_BIN = () => fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/lib/bin.js'));
const INSTALL_ANCHOR = () => fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'));
const PROFILE_NAME = 'compact';

const say = (message) => process.stderr.write(`${BIN} ${message}\n`);

const localImage = () => {
  const inspect = spawnSync('docker', ['image', 'inspect', 'ubuntu:24.04', '--format', '{{index .RepoDigests 0}}'], { encoding: 'utf8' });
  if (inspect.status !== 0 || !inspect.stdout.trim()) {
    throw new Error(`${BIN} docker image ubuntu:24.04 is required (docker pull ubuntu:24.04) — the sandbox image is the one operator act the posture layer does not default`);
  }
  // RepoDigests carry the repository name without the tag (ubuntu@sha256:…);
  // the declared ref must stay tagged or the daemon resolves ubuntu:latest
  const digest = inspect.stdout.trim().split('@')[1];
  return { image: 'ubuntu:24.04', digest };
};

/** A scratch DSH_HOME with the profile pnpm-installed from the packed tarball. */
function installProfile(home, tarball, [pnpm, ...pnpmArgs]) {
  const profileDir = join(home, 'profiles', PROFILE_NAME);
  // every probe run is a fresh install: a stale manifest would make pnpm
  // sync the dependency away on the next add (exit 0, nothing installed)
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${PROFILE_NAME}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'compact-dsh'] } },
  }, null, 2) + '\n');
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n');
  // the tarball is the only dependency the profile needs: the base and web
  // bundles resolve from the dsh installation (bundle resolution's first
  // anchor), the compact rows from the profile's own node_modules
  let add = spawnSync(pnpm, [...pnpmArgs, 'add', tarball], { cwd: profileDir, encoding: 'utf8' });
  if (add.status !== 0 && `${add.stderr}`.includes('ADDING_TO_ROOT')) {
    add = spawnSync(pnpm, [...pnpmArgs, 'add', '-w', tarball], { cwd: profileDir, encoding: 'utf8' });
  }
  if (add.status !== 0) throw new Error(`${BIN} pnpm add failed:\n${add.stdout}\n${add.stderr}`);
  for (const fragment of ['compact-dsh', 'add', 'Done']) {
    if (!`${add.stdout}`.includes(fragment)) throw new Error(`${BIN} pnpm add output lacks ${JSON.stringify(fragment)}:\n${add.stdout}`);
  }
  say(`profile ${profileDir} — tarball installed via ${[pnpm, ...pnpmArgs].join(' ')}`);
  return profileDir;
}

export async function runProbe({ home = mkdtempSync(join(tmpdir(), 'dist-probe-')), keep = false, pnpmCommand = 'npx --yes pnpm@9' } = {}) {
  const [pnpm, ...pnpmArgs] = pnpmCommand.split(' ');
  const { image, digest } = localImage();

  say('packing the artifact');
  const { tarball } = packComposition({ outDir: join(ROOT, 'dist') });
  say(`tarball ${tarball}`);

  // the probe scrubs the launcher's env names on purpose: the posture layer
  // must derive the state from the profile context, or the boot refuses
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('COMPACT_') || key.startsWith('DSH_')) delete process.env[key];
  }
  process.env.DSH_HOME = home;
  process.env.DSH_TELEMETRY_DISABLED = '1';
  process.env.COMPACT_SANDBOX_IMAGE = image;
  process.env.COMPACT_SANDBOX_IMAGE_DIGEST = digest;
  // the mediated egress posture, opted in exactly as the pilot's --egress
  // proxy opts in: without it an uncovered host is REFUSED (D-7 — no grant
  // could deliver it), and the probe's second call exists to exercise the
  // approval ask that a grantable host produces
  process.env.COMPACT_EGRESS = 'proxy';

  const profileDir = installProfile(home, tarball, [pnpm, ...pnpmArgs]);

  // The compose root: a synthetic resolution base whose node_modules carries
  // the dsh runtime from the shared install and COMPACT-DSH FROM THE
  // PROFILE'S installed artifact — the same mapping dsh's profile
  // interception would produce, built as plain symlinks so the boot needs no
  // interception at all. Row imports resolve natively from here: dsh rows
  // from the runtime, compact rows from the tarball the way a plain profile
  // installed it. The checkout appears nowhere.
  const composeRoot = join(home, 'compose');
  const composeModules = join(composeRoot, 'node_modules');
  const installedCompact = join(profileDir, 'node_modules', 'compact-dsh');
  if (!existsSync(installedCompact)) throw new Error(`${BIN} the profile has no compact-dsh installed`);
  mkdirSync(join(composeModules, '@deepseek-ai'), { recursive: true });
  const sharedModules = join(ROOT, 'node_modules');
  for (const entry of readdirSync(join(sharedModules, '@deepseek-ai'), { withFileTypes: true })) {
    symlinkSync(join(sharedModules, '@deepseek-ai', entry.name), join(composeModules, '@deepseek-ai', entry.name), 'dir');
  }
  symlinkSync(realpathSync(installedCompact), join(composeModules, 'compact-dsh'), 'dir');
  writeFileSync(join(composeRoot, 'package.json'), JSON.stringify({ name: 'dist-probe-compose', private: true }) + '\n');

  // empty root, the shape every dsh profile boot composes over
  const rootConfig = join(composeRoot, 'cordis.yml');
  writeFileSync(rootConfig, '[]\n');

  say('booting the profile composition in-process (compact rows resolve from the installed artifact)');
  // the loader reports row import failures only through the process rejection
  // checkpoint — surface them, or a failed boot hides its own cause
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  const { boot, loadProfileDirectory, readProfilePatches } = await import('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline');
  const anchor = INSTALL_ANCHOR();
  const profile = loadProfileDirectory(BIN, profileDir, anchor);
  if (profile.skippedBundles.length > 0) throw new Error(`${BIN} profile skipped bundles: ${JSON.stringify(profile.skippedBundles)}`);
  // The probe's one operator overlay: the web profile keeps host-plane tools
  // behind presets (dsh-web-app disables tool-bash; sessions re-mount it per
  // preset), so without a model-driven browser session there is no tool to
  // govern. Re-arming the host-plane row is an operator patch act on the
  // trial path — the gates ride the tool waterfall either way.
  const overlays = [{ id: 'tool-bash', disabled: false }];
  const profileContext = {
    name: PROFILE_NAME,
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor: anchor,
    startedBundles: profile.layers.map((layer) => layer.packageName),
    cwd: process.cwd(),
    home,
    overlays,
    telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
  };
  const webArgs = ['--no-open'];

  let llmRequests = 0;
  const ctx = await boot(BIN, rootConfig, readProfilePatches(BIN, profileContext, profile), async (host) => {
    host.provide('profileContext', profileContext);
    provideCmdline(host, { args: webArgs, exit: () => {}, ready: { onReady() {}, onFail() {} } });
    host.on('llm/stream', () => {
      llmRequests++;
      throw new Error('dist-probe: no model may answer — the probe drives the waterfall itself');
    }, { prepend: true });
  }, pathToFileURL(join(composeRoot, 'package.json')).href).catch((error) => {
    process.off('unhandledRejection', onRejection);
    for (const reason of rejections) say(`rejection during boot: ${reason?.message ?? reason}${reason?.stack ? `\n  at ${String(reason.stack).split('\n')[1]?.trim()}` : ''}`);
    throw error;
  });

  try {
    const ready = ctx.get('compact-ready');
    if (!ready?.ready) throw new Error(`${BIN} composition never became compact-ready`);
    say(`compact-ready (constitution digest ${ready.digest.slice(0, 12)}…)`);

    const record = ctx.get('compact-record');
    const persistence = ctx.get('sessionPersistence');
    if (record.chained !== persistence) throw new Error(`${BIN} the record provider is not the public sessionPersistence`);

    // the probe's operator seat: registered AFTER boot, it sits downstream
    // of the prepended recorded answerer — the same ordering the launcher's
    // attended answerer rides (tools/operator-answerer.mjs)
    let sawEnvelope;
    ctx.on('approval/request', async (req, next) => {
      if (!/(^|\n)\[AG(\/|\])/.test(req.reason ?? '')) return next();
      sawEnvelope = { callId: req.callId, reason: req.reason, preview: ctx.get('compact-approval').deciding.get(req.callId) ?? null };
      return 'allowed-once';
    });

    const session = ctx.sessions.prepare('dist-probe');
    const writer = await persistence.create(session.header);
    ctx.sessions.enter(session);
    ctx.sessions.announce(session);
    session.append('turn/start', { turn: 1 });

    // call A: read-only bash — allowlist pass, no target, no ask; the act
    // confines into the real container and lands on the chained record
    const quiet = await ctx.tools.execute({
      name: 'bash',
      callId: 'probe-call-a',
      arguments: { command: 'echo compact-probe-ok', description: 'print the probe marker' },
      agent: { id: session.id, session, inject() {} },
      signal: AbortSignal.timeout(30_000),
    });
    if (quiet.isError === true || !JSON.stringify(quiet).includes('compact-probe-ok')) {
      throw new Error(`${BIN} read-only bash did not ride the waterfall cleanly: ${JSON.stringify(quiet)}`);
    }
    say('governed call A (read-only bash): allowed, confined, recorded');

    // call B: a network act the static analyzer cannot pin to an approved
    // host — the ask fires, the recorded answerer claims it, the probe's
    // operator seat decides allowed-once, and the act runs network-less
    // inside the container (its failure to resolve the host is the point:
    // the record carries the pair, not the fetch)
    const networked = await ctx.tools.execute({
      name: 'bash',
      callId: 'probe-call-b',
      arguments: { command: 'curl --max-time 3 http://compact-probe.invalid/echo', description: 'fetch a host the allowlist never approved' },
      agent: { id: session.id, session, inject() {} },
      signal: AbortSignal.timeout(30_000),
    });
    if (!sawEnvelope) throw new Error(`${BIN} the networked act did not produce an approval ask — result: ${JSON.stringify(networked).slice(0, 600)}`);
    say(`governed call B (curl): ask recorded, envelope preview ` +
      `${sawEnvelope.preview ? `(${String(sawEnvelope.preview.canonicalTarget ?? JSON.stringify(sawEnvelope.preview)).slice(0, 72)}…)` : '(absent)'}, decided allowed-once; ` +
      `tool result isError=${networked.isError === true} (network-less container)`);

    session.append('turn/end', { turn: 1 });
    if ((await ctx.sessions.flush(session)) !== true) throw new Error(`${BIN} session flush returned false`);
    await writer.close();

    const sessionId = session.id;
    const sessionLog = join(profileContext.dir, 'compact-data', 'records', '_no-cwd', sessionId, 'session.v4.jsonl');
    const chainFile = join(profileContext.dir, 'compact-data', 'chains', `${sessionId}.chain`);
    if (!existsSync(sessionLog)) throw new Error(`${BIN} no session log at ${sessionLog}`);
    if (!existsSync(chainFile)) throw new Error(`${BIN} no chain at ${chainFile}`);
    const events = readFileSync(sessionLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const types = events.map((event) => event.type);
    // The no-model probe drives the waterfall directly, so the record carries
    // the session posture facts and the turn-enclosed approval pair; the
    // tool/call + tool/result pair is the agent loop's contribution and needs
    // a model-driven session — a named scope, not a hidden gap.
    for (const needed of ['session', 'sandbox/mode', 'turn/start', 'approval/asked', 'approval/decided', 'turn/end']) {
      if (!types.includes(needed)) throw new Error(`${BIN} record lacks a ${needed} event: ${types.join(', ')}`);
    }
    const asked = events.find((event) => event.type === 'approval/asked');
    const decided = events.find((event) => event.type === 'approval/decided');
    const indexOf = (event) => events.indexOf(event);
    if (!(indexOf(events[0]) === 0 && indexOf(asked) < indexOf(decided) && indexOf(decided) < indexOf(events.find((event) => event.type === 'turn/end')))) {
      throw new Error(`${BIN} the approval pair is not turn-enclosed on the record`);
    }
    if (JSON.stringify(decided).match(/allowed-once/) === null) throw new Error(`${BIN} the decided event does not record allowed-once`);
    if (!JSON.stringify(asked).includes('compact-probe.invalid')) throw new Error(`${BIN} the asked event does not name the gated host`);
    say(`record: ${events.length} events under the profile dir — posture facts + turn-enclosed ${asked.type}/${decided.type} (allowed-once)`);

    const auditor = spawnSync(process.execPath, [join(ROOT, 'auditor', 'audit.mjs'), sessionLog, '--chain', chainFile], { encoding: 'utf8' });
    if (auditor.status !== 0) throw new Error(`${BIN} auditor refused:\n${auditor.stdout}\n${auditor.stderr}`);
    const verdict = JSON.parse(auditor.stdout);
    if (verdict.verdict !== 'conforming' || verdict.checked?.chain !== 'verified') {
      throw new Error(`${BIN} auditor verdict ${verdict.verdict}/${verdict.checked?.chain}`);
    }
    say(`auditor: ${verdict.verdict}, chain ${verdict.checked?.chain} (offline, no runtime cooperation)`);

    say(llmRequests === 0 ? 'no model request was made' : `UNEXPECTED: ${llmRequests} model requests`);
    if (llmRequests !== 0) throw new Error(`${BIN} the guard counted ${llmRequests} model requests`);

    return {
      ok: true, home, profileDir, sessionId,
      events: events.length, llmRequests,
      verdict: { verdict: verdict.verdict, chain: verdict.checked?.chain },
      envelope: sawEnvelope,
    };
  } finally {
    const disposed = Promise.race([
      ctx.fiber.dispose(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${BIN} disposal exceeded 15s`)), 15_000)),
    ]).catch((error) => say(`disposal: ${error.message}`));
    await disposed;
    if (!keep) rmSync(home, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const outIdx = argv.indexOf('--out');
  const home = outIdx !== -1 ? mkdirSync(resolve(argv[outIdx + 1]), { recursive: true }) : undefined;
  const keep = argv.includes('--keep') || outIdx !== -1;
  const pnpmIdx = argv.indexOf('--pnpm');
  const pnpmCommand = pnpmIdx !== -1 ? argv[pnpmIdx + 1] : 'npx --yes pnpm@9';
  runProbe({ home, keep, pnpmCommand })
    .then((result) => {
      say(`PROBE PASSED — install → boot → governed calls → audited record, all under ${result.profileDir}`);
      if (home) writeFileSync(join(home, 'probe-transcript.json'), JSON.stringify(result, null, 2) + '\n');
    })
    .catch((error) => {
      say(`PROBE FAILED — ${error.message}`);
      process.exitCode = 1;
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
