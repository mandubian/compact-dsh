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
  // the night watch, armed for the ordering verification (call C): the
  // posture row seats it from the bundle when the env names a policy.
  // 'allow-edges' keeps the probe model-free — the judge policy would want a
  // route the probe refuses by design. Set AFTER the scrub, alongside the
  // posture: the env is the plain profile's only way to seat a watch (#195).
  process.env.COMPACT_DECIDER = 'allow-edges';

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
  // the webserver row binds a port like any boot; the probe must never
  // contend with a live dsh the operator is running — ephemeral port
  const webArgs = ['--no-open', '--port', String(20000 + Math.floor(Math.random() * 40000))];

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
    // attended answerer rides (tools/operator-answerer.mjs). Every ask this
    // seat decides is recorded per callId: call C asserts the watch (seated
    // at boot, upstream of this seat) decided the edge ask BEFORE any human
    // surface could.
    let sawEnvelope;
    const operatorDecided = [];
    // the card moment's captures (#195 deliverable d): the ladder the card
    // rendered, the pick it recorded, and the forged pick the guard refused
    const card = { ladder: null, pick: null, forged: null };
    ctx.on('approval/request', async (req, next) => {
      if (!/(^|\n)\[AG(\/|\])/.test(req.reason ?? '')) return next();
      sawEnvelope = { callId: req.callId, reason: req.reason, preview: ctx.get('compact-approval').deciding.get(req.callId) ?? null };
      operatorDecided.push(req.callId);
      // call D — the seat plays the browser, through the card's own API: the
      // same two methods the web card invokes over the gateway's /api channel
      // (the browser half — lib/client.js — cannot run headless; its
      // rendering and its wire envelope are pinned by the card suite).
      // Render the Enforcer's ladder, prove a pick addressing no offer is
      // refused (the browser picks, never authors — D-8), then record the
      // params-row pick with the runtime modifier — the web card's `3!`.
      // The pick answers NOTHING by itself; the yes below is still the
      // ordinary allowed-once, and the recorded answerer materializes the
      // picked row when it resolves.
      if (req.callId === 'probe-call-d') {
        const api = ctx.get('compact-card-api');
        if (!api) throw new Error(`${BIN} the card api is not mounted on the trial path — the door's ladder has no plain-profile surface`);
        const rendered = await api.decidingView({ callId: req.callId });
        if (!Array.isArray(rendered.offers) || rendered.offers.length === 0) {
          throw new Error(`${BIN} the card rendered an empty ladder — a surface that never renders offers never widens: ${JSON.stringify(rendered)}`);
        }
        card.ladder = rendered.offers.map((offer) => offer.text);
        card.forged = await api.patternAnswer({ callId: req.callId, index: rendered.offers.length });
        if (card.forged?.ok !== false) throw new Error(`${BIN} the card accepted a pick that addresses no offer — the browser authored coverage: ${JSON.stringify(card.forged)}`);
        card.pick = await api.patternAnswer({ callId: req.callId, index: 0, runtime: true });
        if (card.pick?.ok !== true || card.pick.scope !== 'runtime') {
          throw new Error(`${BIN} the params-row pick with the runtime modifier did not record: ${JSON.stringify(card.pick)}`);
        }
      }
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

    // call C: the night watch's seat (#195). The desk mints the pass —
    // UrlPrefix over the probe host, params=allow(q), scope=all (root and
    // session null, exactly what /grants-grant scope=all mints) — then the
    // edge act carries a query name the axis refuses. The ask is a
    // params-edge: the watch (seated at boot by the posture row, upstream of
    // this probe's post-boot operator seat) must decide it — allow-edges
    // admits under the row's terms — and the operator seat must never see
    // the ask. This is the ordering invariant Decision 5 declared unverified.
    // The agent here CAPTURES its injects: the attributed note ("by the
    // appointed night watch (policy: …)") is the morning-after's read, and
    // the probe asserts it rode the decision, not just the stderr line.
    const notes = [];
    const desk = ctx.get('compact-approval').grantSession({
      pattern: { kind: 'UrlPrefix', value: 'https://compact-probe.invalid/get/', params: { mode: 'allow', names: ['q'] } },
      root: null, session: null, ttlMs: 60 * 60_000, methodClass: 'read',
    });
    say(`the desk mints the pass: ${desk.id} UrlPrefix:https://compact-probe.invalid/get/ params=allow(q), scope=all (unscoped pair)`);
    const edge = await ctx.tools.execute({
      name: 'bash',
      callId: 'probe-call-c',
      arguments: { command: "curl --max-time 3 'https://compact-probe.invalid/get?q=cats&page=2'", description: 'fetch under the pass, one axis-refused name' },
      agent: { id: session.id, session, inject(m) { notes.push(m); } },
      signal: AbortSignal.timeout(30_000),
    });
    if (operatorDecided.includes('probe-call-c')) {
      throw new Error(`${BIN} the operator seat decided the edge ask — the watch did not sit upstream of the human surface`);
    }
    const edgeNotes = notes.map(m => (m?.content ?? []).filter(b => b?.type === 'text').map(b => b.text).join(' ')).join('\n');
    if (!edgeNotes.includes('the appointed night watch (policy: allow-edges)')) {
      throw new Error(`${BIN} the watch's attributed note did not ride the decision — captured: ${JSON.stringify(edgeNotes).slice(0, 400)}`);
    }
    // the deciding view is deleted when the decision resolves (the recorded
    // answerer's own lifecycle), so the claim itself is verified from the
    // captured note — the attribution is where the morning-after reads it
    say(`governed call C (edge act): the watch decided it (allow-edges) — ` +
      `the operator seat never saw the ask (ordering verified); the attributed note rode the decision; ` +
      `result isError=${edge.isError === true} (network-less container, no curl)`);

    // call D: the door's ladder at the web card (#195's last seam). A fresh
    // host's first-touch ask — the watch declines it (no row covers this
    // host: a first touch is nobody's edge, so it falls through to the
    // human seat, exactly as call B's did) — is rendered and picked through
    // the card api in the seat above. The pick rides the ordinary yes: the
    // recorded answerer materializes the picked params row UNSCOPED (the
    // runtime modifier — the `!`) with its wire companion, and the captured
    // note carries the sentence that says so.
    const dNotes = [];
    const doorAsk = await ctx.tools.execute({
      name: 'bash',
      callId: 'probe-call-d',
      arguments: { command: "curl --max-time 3 'http://compact-card-probe.invalid/get?q=hello'", description: 'first touch on a fresh host — the ladder ask' },
      agent: { id: session.id, session, inject(m) { dNotes.push(m); } },
      signal: AbortSignal.timeout(30_000),
    });
    if (!operatorDecided.includes('probe-call-d')) {
      throw new Error(`${BIN} the card's ask never reached the human seat — a pick answers nothing by itself`);
    }
    const dNotesText = dNotes.map(m => (m?.content ?? []).filter(b => b?.type === 'text').map(b => b.text).join(' ')).join('\n');
    if (!dNotesText.includes('for EVERY session of this runtime')) {
      throw new Error(`${BIN} the materialized pass did not carry the runtime scope — note: ${JSON.stringify(dNotesText).slice(0, 400)}`);
    }
    say(`governed call D (first touch, the card's ladder): ${card.ladder.length} rung(s) rendered — ` +
      `pick "${card.ladder[0]}" + runtime modifier recorded (the web card's 3!); a forged pick was refused; ` +
      `the yes materialized the pass ("for EVERY session of this runtime" on the note); ` +
      `result isError=${doorAsk.isError === true} (network-less container)`);

    session.append('turn/end', { turn: 1 });
    if ((await ctx.sessions.flush(session)) !== true) throw new Error(`${BIN} session flush returned false`);
    await writer.close();

    // call D2: the pass the CARD minted must carry a FRESH session — the
    // night-shift delivery, minted at the door this time instead of the
    // desk. A covered act in a new session lineage: no ask may reach any
    // surface (the desk never minted this row — the door did), and no
    // fail-closed refusal may answer it. The network-less container still
    // fails the fetch itself; the delivery is the gate's and the wire's
    // absence, which the assertions below pin.
    const session2 = ctx.sessions.prepare('dist-probe-next');
    const writer2 = await persistence.create(session2.header);
    ctx.sessions.enter(session2);
    ctx.sessions.announce(session2);
    session2.append('turn/start', { turn: 1 });
    const replay = await ctx.tools.execute({
      name: 'bash',
      callId: 'probe-call-d2',
      arguments: { command: "curl --max-time 3 'http://compact-card-probe.invalid/get?q=dogs'", description: 'a fresh session under the card-minted pass' },
      agent: { id: session2.id, session: session2, inject() {} },
      signal: AbortSignal.timeout(30_000),
    });
    session2.append('turn/end', { turn: 1 });
    if ((await ctx.sessions.flush(session2)) !== true) throw new Error(`${BIN} session flush returned false`);
    await writer2.close();
    if (operatorDecided.includes('probe-call-d2')) {
      throw new Error(`${BIN} the covered act asked — the door-minted pass did not carry the fresh session`);
    }
    if (/requires approval/i.test(JSON.stringify(replay))) {
      throw new Error(`${BIN} the covered act failed closed — the pass did not deliver: ${JSON.stringify(replay).slice(0, 400)}`);
    }
    say(`governed call D2 (fresh session, the card's pass): covered without an ask — ` +
      `no ask reached any surface, no fail-closed refusal; ` +
      `result isError=${replay.isError === true} (network-less container — the delivery is the gate's absence)`);

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
    // call C adds a second turn-enclosed approval pair — the host-owned
    // audit pair (asked/decided); the watch's ATTRIBUTION rides the captured
    // note above, because the probe's fake agent does not forward injects to
    // the record the way dsh's real session does
    const askedEvents = events.filter((event) => event.type === 'approval/asked');
    const decidedEvents = events.filter((event) => event.type === 'approval/decided');
    if (askedEvents.length < 2 || decidedEvents.length < 2) {
      throw new Error(`${BIN} the record lacks the edge pair: ${askedEvents.length} asked / ${decidedEvents.length} decided`);
    }
    // the card-minted pass's delivery, on the record: the covered act in the
    // fresh session asked NOBODY — no approval/asked may name its callId
    if (events.some((event) => event.type === 'approval/asked' && JSON.stringify(event).includes('probe-call-d2'))) {
      throw new Error(`${BIN} the record carries an ask for the covered act — the card-minted pass did not cover the fresh session`);
    }
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
      door: { ladder: card.ladder, pick: card.pick },
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
