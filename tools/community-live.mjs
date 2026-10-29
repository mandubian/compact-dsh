#!/usr/bin/env node
// community-live — a LIVE community of model-driven members under the law
// (umbrella #215; the generic runtime is packages/community, this is the
// launcher). One composed runtime; a charter's members seated as real
// agent sessions, each bound to its OWN admitted member on one roll (the
// many-member binding); speech on the forum (compact-forum); approvals
// answered by pre-minted grants and the night-watch judge — never by this
// driver, which decides nothing for the members and performs no governed
// act on their behalf. Filings wake model-driven bench seats.
//
// Unlike tools/community-demo.mjs (which FORBIDS the model and plays every
// hand), this run is live: a model route is REQUIRED, and the members'
// decisions are their own. Everything else is the same machinery the demo
// exercises — the boot, the roll, the annex, the mediator, the chains.
//
// Honesty labels, stated up front (the register's own discipline):
//   - rehearsal standing only — the development keyring signs everything,
//     the members and benches are practice keys, the run rehearses
//     machinery and enacts nothing (D-8);
//   - the driver seats the night watch (judge policy) for params-edge
//     asks on pre-minted rows; NOVEL asks — routes nobody pre-approved —
//     fail closed as escalations on the record until the human seat
//     exists (Phase D);
//   - the judicature docket is in-memory: cases live within this process;
//   - budgets are enforced: rounds, turns per member, the wall clock, a
//     shared token cap — the run ENDS when one trips, with its reason.
//
// Usage: node tools/community-live.mjs --charter tools/charters/newsroom.json
//          [--out DIR] [--rounds N] [--publish] [--publish-dir DIR]
// Requires docker with the baked toolchain image (dsh-tools:basic —
// `npm run compact:bake`), and a model route (settings.yaml under
// $DSH_HOME or the scratch state dir, or DEEPSEEK_API_KEY in the shell).
// --publish writes the end-of-run pack (REPORT.md, BRIEF.md, the optional
// model READING.md, and PACK.md) under <out>/publish or --publish-dir.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { sha256Hex, signAnnex, annexDigestOf, verifyAnnex } from 'compact-dsh-seals';
import { parseAllowlistLikePattern, egressPatternFor } from 'compact-dsh-approval';
import { nightWatchAnswerer, judgeFromContext } from 'compact-dsh-night-watch';
import { COMPACT_DIGEST, clauseIds, clauseText } from '../packages/constitution/src/body.js';
import { ensureRehearsalKeyring } from './rehearsal-keyring.mjs';
import { foreignPackages } from './package-provenance.mjs';
import { computeCodeDigest } from './code-digest.mjs';
import { proxyEnvNotice } from './proxy-env.mjs';
import { continuationOf, preservePreviousRun, readPreviousRun, shellPath, gatePostsOf, tokensBySeatOf, sealedBriefsOf } from './run-manifest.mjs';
import { forumFromLedger, meteredTokens } from './community-report.mjs';
import { seatTrustRoot, manifestDigestOf } from './trust-root-seat.mjs';
import { createReleasesHost } from './releases-host.mjs';
import { validateCharter, memberBindingsOf, apply as applyCommunity, mountHumanSeat, startObservatory, createRunControls, createDivergenceCounters, humanMemberAdapter, seatOutcome } from '../packages/community/src/index.js';

const BIN = 'community-live:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAY = (m) => process.stderr.write(`${BIN} ${m}\n`);
const IMAGE = 'dsh-tools:basic';

const out = (title) => process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
const line = (s = '') => process.stdout.write(`${s}\n`);

/** The code the community runs on, as git sees it — the provenance axis
 *  LLM runs can never have (outputs never repeat) but code runs can
 *  (the same tree, named). Honest absence when git is not there: a null
 *  commit is stated as such, never guessed. */
function codeProvenance(root) {
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5_000 });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const commit = git('rev-parse', 'HEAD');
  const dirty = commit == null ? null : (git('status', '--porcelain') ?? '').length > 0;
  // the half git cannot see: packages loaded BY NAME that resolve outside
  // this checkout (a linked node_modules) run code the commit does not
  // name — recorded beside it, never folded into it (the 0e3fa8 finding)
  const foreign = foreignPackages(root);
  return {
    repo: git('remote', 'get-url', 'origin'),
    ref: git('rev-parse', '--abbrev-ref', 'HEAD'),
    commit,
    ...(dirty ? { dirty: true } : {}),
    ...(foreign.length ? { foreignPackages: foreign } : {}),
    ...(commit == null ? { note: 'not a git checkout (or git absent) — the code state is not named' } : {}),
  };
}

// ── the world: scratch, keyring with the charter's members, the annex ──

/** Sign the community's annex: an operator first instance (which REFUSES
 *  through the declared chain), a member-review bench seated on the
 *  charter's bench-member keys, and the accredited external Witness the
 *  roll accredits (the D-8 appellate route). */
function communityAnnex(keyringDir, keyring, charter, benchDigests) {
  const base = JSON.parse(readFileSync(join(keyringDir, 'enforcer.annex.json'), 'utf8'));
  const privateKey = readFileSync(join(keyringDir, 'enforcer.pem'), 'utf8');
  const keyId = base.enforcer.keyId;
  const publicKey = base.enforcer.publicKey;
  const registerDigest = sha256Hex(readFileSync(join(ROOT, 'docs', 'register', 'register.json')));
  const benchRoles = benchDigests.map((digest, i) => ({
    id: i === 0 ? 'chair' : `second-${i}`,
    standing: { kind: 'key', id: digest },
  }));
  const adjudicatorSets = {
    nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
    sets: [
      {
        id: 'community-first-instance',
        roles: [{ id: 'operator', standing: { kind: 'principal', id: 'operator-community' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis', 'annex', 'a-8-review'] },
        notice: 'live community: rehearsal declaration under the development keyring — standing none; the machinery is what runs',
      },
      {
        id: 'member-review',
        roles: benchRoles,
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis', 'annex', 'a-8-review'] },
        notice: 'live community bench: model-driven members, heard over member-bound filings',
      },
      {
        id: 'external',
        roles: [{ id: 'w1', standing: { kind: 'witness', id: keyring.witnessKeyDigest } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis', 'annex', 'a-8-review'] },
        notice: 'live community: the external Witness the SIMULATED accreditation statute seats — the D-8 route ends heard',
      },
    ],
    edges: [
      { type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'operator-community' } },
      { type: 'asserts-with', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'key', id: keyId } },
    ],
  };
  const annex = signAnnex({
    composition: 'compact-dsh',
    host: `live community "${charter.name}" (development keyring)`,
    lawDigest: COMPACT_DIGEST,
    registerDigest,
    keyId,
    publicKey,
    privateKey,
    adjudicatorSets,
    issuedAt: new Date().toISOString(),
  });
  const path = join(keyringDir, 'community.annex.json');
  writeFileSync(path, JSON.stringify(annex, null, 2) + '\n', { mode: 0o600 });
  const verified = verifyAnnex({ annex, expectedLawDigest: COMPACT_DIGEST, now: Date.now() });
  SAY(`community annex signed (${annexDigestOf(annex).slice(0, 16)}…, key ${verified.keyId}) — benches: community-first-instance (operator), member-review (${benchRoles.length} member seat(s)), external (w1 — roll-verified at boot)`);
  return { annexPath: path };
}

// the releases host: tools/releases-host.mjs — a receiver whose GET serves
// what its PUT stored, so a member that verifies its own publish sees the
// truth (the live run's publisher caught the receipt-pretending version).

// ── the runtime ──

async function bootRuntime({ scratch, annexPath, keyringDir, workspace, trustedKeyringDigest, egressNetwork, bindings, codeDigestFile = null }) {
  const digest = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', IMAGE], { encoding: 'utf8', timeout: 10_000 }).trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`${BIN} cannot inspect ${IMAGE} (docker pull / npm run compact:bake first)`);

  // the model route, named BEFORE the scrub (COMPACT_* envs are deleted
  // below): the operator's own settings document, seeded into the scratch
  // DSH_HOME the way the live tests seed fixtures — provider keys stay in
  // the shell, referenced by env NAME, never copied anywhere
  const routeSettings = process.env.COMPACT_LIVE_SETTINGS && existsSync(process.env.COMPACT_LIVE_SETTINGS)
    ? process.env.COMPACT_LIVE_SETTINGS
    : existsSync(join(homedir(), '.compact-dsh', 'settings.yaml')) ? join(homedir(), '.compact-dsh', 'settings.yaml') : null;

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('COMPACT_') || key.startsWith('DSH_')) delete process.env[key];
  }
  const state = join(scratch, 'state');
  if (routeSettings) {
    copyFileSync(routeSettings, join(state, 'settings.yaml'));
    SAY(`model route seeded from ${routeSettings} (into the scratch DSH_HOME — the operator's own document)`);
  }
  const manifestPath = join(keyringDir, 'keyring.json');
  const sealPath = join(keyringDir, 'compact-body.sig.json');
  const env = {
    DSH_HOME: state,
    DSH_TELEMETRY_DISABLED: '1',
    COMPACT_WORKSPACE: workspace,
    COMPACT_RECORD_ROOT: join(state, 'sessions'),
    COMPACT_CHAIN_DIR: join(state, 'chains'),
    COMPACT_APPROVAL_PERSIST_PATH: join(state, 'approvals.json'),
    COMPACT_ALLOWLIST: '[]',
    COMPACT_KEYRING_MANIFEST: manifestPath,
    COMPACT_KEYRING_SEAL: sealPath,
    COMPACT_TRUSTED_KEYRING_DIGEST: trustedKeyringDigest ?? manifestDigestOf(manifestPath),
    COMPACT_ENFORCER_ANNEX: annexPath,
    COMPACT_ENFORCER_KEY: join(keyringDir, 'enforcer.pem'),
    COMPACT_EGRESS: 'proxy',
    COMPACT_EGRESS_ADDRESS_CLASSES: 'private',
    COMPACT_EGRESS_NETWORK: egressNetwork,
    // the many-member binding (#217): each session-id prefix claims its own
    // admitted member; certificates countersign per member; parties and
    // recusal resolve through the one roll
    COMPACT_MEMBER_ROLL: join(keyringDir, 'roll.json'),
    COMPACT_MEMBER_KEYRING: manifestPath,
    COMPACT_MEMBER_BINDINGS: JSON.stringify(bindings),
    // the code by content (CF-2): the self-model's attestation carries the
    // digest onto the chain at every turn; the detail stays beside it
    ...(codeDigestFile ? { COMPACT_CODE_DIGEST_FILE: codeDigestFile } : {}),
    COMPACT_SANDBOX_IMAGE: IMAGE,
    COMPACT_SANDBOX_IMAGE_DIGEST: digest,
    COMPACT_SANDBOX_RECORDED_BY: 'community-live driver (the operator seat)',
    COMPACT_SANDBOX_PROVENANCE_NOTE: 'baked toolchain image (npm run compact:bake), digest observed via docker image inspect .Id',
  };
  Object.assign(process.env, env);
  for (const dir of [state, env.COMPACT_RECORD_ROOT, env.COMPACT_CHAIN_DIR]) mkdirSync(dir, { recursive: true });
  const configFile = join(state, 'cordis.yml');
  writeFileSync(configFile, '[]\n');

  const { boot, loadOverlayPatches } = await import('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline');
  const { operatorSettingsRows } = await import('./operator-settings.mjs');
  const baseFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-base/package.json')));
  const overlayFile = fileURLToPath(new URL('../packages/blessed/cordis.patch.yml', import.meta.url));
  const patches = [
    ...loadOverlayPatches(BIN, baseFile),
    ...loadOverlayPatches(BIN, overlayFile),
    { id: 'tools', config: { mode: 'native' } },
    { id: 'tool-bash', disabled: false },
    // the one-shot runner and the interactive startups stay out: the live
    // driver runs its own loop through the stock agent registry
    { id: 'headless-startup', disabled: true },
    { id: 'ptc-runtime', disabled: true },
    // the operator's seeded settings ride LAST, the way the launcher loads
    // them — the operator's route wins over every bundle default
    ...operatorSettingsRows({ settingsPath: join(state, 'settings.yaml'), web: false, notice: (m) => SAY(m) }),
  ];

  // the token meter: usage lands on every assistant message the loop
  // writes — summed here, enforced by the engine's budget check. The
  // stream itself is NEVER forbidden: the night-watch judge rides it.
  // The same listener feeds the observatory's notice lane: the attributed
  // user/message notices members receive (watch verdicts, approvals,
  // loopguard) — the shapes the after-run report reads, live.
  // The per-session split rides the same formula, so the manifest's
  // tokensBySeat sums to its tokens — the cost of each seat is the
  // question the mixed-model charters ask, and the total cannot answer it.
  let tokensUsed = 0;
  const tokensBySession = {};
  let noticeSink = null; // the observatory's notice lane, wired post-boot
  const onSessionEvent = (session, event) => {
    if (event?.type === 'assistant/message') {
      const u = event?.data?.usage ?? event?.usage;
      if (u) {
        const n = meteredTokens(u);
        tokensUsed += n;
        const sid = String(session?.id ?? '?');
        tokensBySession[sid] = (tokensBySession[sid] ?? 0) + n;
      }
      return;
    }
    if (event?.type === 'user/message') {
      const source = event?.data?.source ?? event?.source;
      const kind = String(source?.kind ?? '');
      if (kind === 'compact-approval' || kind === 'compact-loopguard') {
        noticeSink?.({ type: 'notice', kind, to: String(session?.id ?? '?'), summary: String(source?.summary ?? '') });
      }
    }
  };
  const ctx = await boot(BIN, configFile, patches, (host) => {
    provideCmdline(host, { args: [], exit: () => {} });
    host.on('session/event', onSessionEvent);
  }, pathToFileURL(join(ROOT, 'package.json')).href);
  if (ctx.get('compact-ready')?.ready !== true) throw new Error(`${BIN} the composition never became compact-ready`);
  return { ctx, env, tokenMeter: () => tokensUsed, tokensBySession: () => ({ ...tokensBySession }), setNoticeSink: (fn) => { noticeSink = fn; }, imageDigest: digest };
}

/** Pre-mint the charter's grants — the operator's act, before any member
 *  exists: scope=all rows (every session of this runtime), budgeted,
 *  method-classed, params-axis narrowed where the charter says. Minted
 *  through the same session-grant machinery the door mints through,
 *  wire-leg paired under the mediated posture (#186). */
function preMintGrants(ctx, charter, substitutions) {
  const approval = ctx.get('compact-approval');
  if (!approval) throw new Error(`${BIN} no compact-approval service — the composition is not the one this driver knows`);
  const minted = [];
  for (const g of charter.grants) {
    let raw = g.pattern;
    for (const [key, value] of Object.entries(substitutions)) raw = raw.split(key).join(value);
    // the star in a URL pattern is a LITERAL path segment (UrlPrefix …/*/ covers
    // only paths under a directory named *), not a glob — the #232-followup
    // finding from the live run: a charter's '{{RELEASES_ORIGIN}}/*' minted a
    // row covering nothing real, and the community's own publish asked. A
    // trailing star is normalized to the bare prefix, loudly.
    if (raw.endsWith('/*')) {
      raw = `${raw.slice(0, -2)}/`;
      SAY(`charter grant "${g.pattern}": a trailing /* is a LITERAL path segment in a URL pattern, not a glob — normalized to "${raw}" so the row covers what it plainly meant`);
    }
    let parsed;
    try {
      parsed = parseAllowlistLikePattern(raw);
    } catch (error) {
      throw new Error(`${BIN} charter grant pattern "${g.pattern}" does not parse after substitution: ${error.message}`);
    }
    if (g.params != null) {
      const spec = g.params.replace(/^params=/, '');
      const allow = /^allow\(([a-z0-9_.,-]*)\)$/i.exec(spec);
      parsed.params = spec === 'free' ? { mode: 'free' } : spec === 'fixed' ? { mode: 'fixed' }
        : allow ? { mode: 'allow', names: [...new Set(allow[1].split(',').map((s) => s.trim()).filter(Boolean).sort())] }
        : null;
      if (parsed.params == null) throw new Error(`${BIN} charter grant params "${g.params}" does not parse`);
    }
    const row = approval.grantSession({
      pattern: parsed, root: null, session: null,
      ttlMs: g.ttlMinutes * 60_000, maxUses: g.maxUses, methodClass: g.methodClass,
      params: parsed.params,
    });
    // #186: a UrlPrefix row travels with its wire leg under the mediated
    // posture — the pair the mediator delivers through
    if (approval.egress === 'proxy' && row.pattern.kind === 'UrlPrefix') {
      const leg = egressPatternFor({ url: row.pattern.value });
      if (leg) {
        approval.store.addSessionGrant({
          pattern: leg, root: null, session: null,
          ttlMs: g.ttlMinutes * 60_000, maxUses: null, methodClass: g.methodClass, now: row.createdAt,
        });
      }
    }
    minted.push(row);
    SAY(`operator pre-mint: grant ${row.id} covers ${raw} (${g.methodClass}, ${g.maxUses} uses, ${g.ttlMinutes}min) — EVERY session of this runtime`);
  }
  return minted;
}

function removeRunNetwork(name) {
  const rm = spawnSync('docker', ['network', 'rm', name], { encoding: 'utf8' });
  if (rm.status === 0) SAY(`mediation network ${name} removed — the run's own teardown`);
  else SAY(`mediation network ${name} NOT removed: ${(rm.stderr || rm.stdout || '').trim().split('\n')[0]}`);
}

// ── main ──

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const charterPath = flag('charter');
  if (!charterPath) throw new Error(`${BIN} --charter <path> is required — try tools/charters/newsroom.json`);
  const raw = JSON.parse(readFileSync(resolve(charterPath), 'utf8'));
  const charter = validateCharter(raw);
  const roundsOverride = flag('rounds');
  if (roundsOverride != null) charter.budgets.rounds = Math.max(1, Number(roundsOverride) | 0);
  // --dry-seat: assemble the whole world (keyring, roll, annex, bindings,
  // mediator, releases host, pre-minted grants, seated member sessions) and
  // end BEFORE any turn is driven — the CI-able boot check; no model call
  // is ever made, and the end reason says which mode ran
  const drySeat = argv.includes('--dry-seat');
  if (drySeat) charter.budgets.rounds = 0;
  // a sealed brief is announced to the operator by seat and hash, never by
  // text: the terminal may be shared, and the manifest reveals it at the end
  for (const b of sealedBriefsOf(charter)) {
    SAY(`sealed brief on seat "${b.seat}" (sha256 ${b.sha256.slice(0, 12)}…) — delivered in that member's briefing only, on its own record; run.json reveals the text when the run ends`);
  }
  if (charter.turnCitations) SAY('turn citations on — each post in the round news names its author\'s turn (session:from-to) for judicature_hear');
  const publish = argv.includes('--publish') || argv.includes('--publish-dir');
  // a human member's floor card lives on the page: without the
  // observatory there is no floor, and a run that seats a human it can
  // never reach would burn its wall clock on honest silences — refuse at
  // the boundary, with the reason, before anything is minted (D-7)
  if (charter.members.some((m) => m.human) && argv.includes('--no-observe')) {
    throw new Error(`${BIN} the charter seats a human member and the run was launched --no-observe — the floor card is the human's only instrument; either drop --no-observe or drop the human seat`);
  }

  let scratch;
  const outDir = flag('out');
  if (outDir != null) {
    scratch = resolve(outDir);
    mkdirSync(scratch, { recursive: true });
  } else {
    scratch = mkdtempSync(join(tmpdir(), `community-${charter.name}-`));
  }
  const publishDir = flag('publish-dir') ? resolve(flag('publish-dir')) : join(scratch, 'publish');
  if (publish) SAY(`publish pack will be written to ${publishDir} (REPORT.md, BRIEF.md, optional READING.md, PACK.md)`);
  // the cut this run continues (#229 follow-up): read BEFORE the boot so a
  // resumed run on the same --out can name the previous manifest in the new
  // one. A malformed old manifest never blocks a continuation.
  const previousRun = readPreviousRun(scratch);
  // the code state, named once at launch — before any turn runs, so the
  // manifest cannot claim a tree the run did not ride
  const provenance = codeProvenance(ROOT);
  if (provenance.commit) {
    SAY(`code provenance: ${provenance.commit.slice(0, 12)}${provenance.dirty ? ' (DIRTY TREE — uncommitted changes present, named as such in the manifest)' : ''} on ${provenance.ref} of ${provenance.repo ?? 'no origin'}`);
  } else {
    SAY(`code provenance: NOT A GIT CHECKOUT — the manifest will say so rather than guess`);
  }
  if (provenance.foreignPackages?.length) {
    SAY(`WARNING: ${provenance.foreignPackages.length} workspace package(s) load from OUTSIDE this checkout — the commit above does not name their code: ${provenance.foreignPackages.map((f) => `${f.name} → ${f.path}`).join(', ')}. Run \`npm ci\` in this checkout for a run whose provenance holds; the manifest records them either way.`);
  }
  // THE CODE BY CONTENT: the workspace packages, the lockfile and the
  // installed tree, digested from the files that will load — the top
  // digest rides every attestation onto the chain; the detail rides the
  // manifest (code.digests), checkable offline: auditor --code --repo
  const codeDetail = provenance.commit ? computeCodeDigest(ROOT, { commit: provenance.commit }) : null;
  let codeDigestFile = null;
  if (codeDetail) {
    mkdirSync(join(scratch, 'state'), { recursive: true });
    codeDigestFile = join(scratch, 'state', 'code-digest.json');
    writeFileSync(codeDigestFile, `${JSON.stringify(codeDetail, null, 2)}\n`);
    provenance.digest = codeDetail.digest;
    provenance.digests = codeDetail;
    SAY(`code digest: ${codeDetail.digest.slice(0, 16)}… over ${codeDetail.packages.length} workspace package(s), the lockfile and ${codeDetail.nodeModules?.files ?? 0} installed file(s) — chained in every attestation; verify offline with auditor --code <run.json> --repo ${ROOT}`);
  }
  const proxyNotice = proxyEnvNotice();
  if (proxyNotice) SAY(`WARNING: ${proxyNotice}`);
  preservePreviousRun(scratch, previousRun);
  const workspace = join(scratch, 'workspace');
  mkdirSync(workspace, { recursive: true });
  for (const s of charter.sources) {
    const target = join(workspace, s.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, s.content);
  }
  SAY(`scratch ${scratch} · charter "${charter.name}" — ${charter.members.length} member(s), ${charter.budgets.rounds} round(s), goal: ${charter.goal.slice(0, 90)}…`);
  const egressNetwork = `compact-community-${charter.name}-${Date.now()}`;
  process.on('exit', () => removeRunNetwork(egressNetwork));

  // the keyring (#227): the identity set is ENSURED, not replaced. On a
  // fresh scratch it mints with the charter's roster; on a re-used --out
  // the VERIFIED set is reused (members keep their keys; old chains keep
  // verifying) and only members the roll does not show are admitted.
  // --fresh is the deliberate re-mint, the operator's recorded act.
  const keyringDir = join(scratch, 'state', 'keyring');
  mkdirSync(keyringDir, { recursive: true });
  const fresh = argv.includes('--fresh');
  // --fresh-approvals (#215 live finding): yesterday's mistaken approvals
  // linger in the store — an approved-once 404 curl taught this runtime for
  // 24h that the nonsense host was consented. The flag moves the store
  // aside (recorded, named) so the run starts with CLEAN consent; the
  // charter's grants re-mint on every boot either way.
  const freshApprovals = argv.includes('--fresh-approvals');
  if (freshApprovals) {
    const storePath = join(scratch, 'state', 'approvals.json');
    if (existsSync(storePath)) {
      const aside = `${storePath}.aside-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      renameSync(storePath, aside);
      SAY(`--fresh-approvals: the approval store moved aside (${aside}) — yesterday's grants and cached approvals no longer speak for this community`);
    } else {
      SAY('--fresh-approvals: no approval store yet — starting clean');
    }
  }
  const keyring = ensureRehearsalKeyring(keyringDir, {
    force: fresh,
    admit: charter.members.map((m) => ({
      id: m.id,
      class: 'long-lived-subject',
      holder: `live community member "${m.id}" — ${m.bench ? 'seated on the bench' : m.persona}`,
    })),
  });
  const resumed = keyring.reused === true;
  SAY(resumed
    ? `identity set REUSED (verified;${keyring.admittedNow.length ? ` admitted now: ${keyring.admittedNow.join(', ')};` : ''} roll at ${keyring.roll.entries.length} entries, ${keyring.roll.checkpoints.length} epoch(s)) — the members keep their keys, the community continues`
    : `identity set minted${fresh ? ' (--fresh: the operator\'s deliberate re-mint)' : ''} — ${keyring.members.length} member(s) under the SIMULATED statute, standing none, every label honest`);
  const seat = seatTrustRoot(keyringDir);
  SAY(`trust root seated (law digest ${seat.lawDigest.slice(0, 12)}… unchanged, manifest ${seat.manifestDigest.slice(0, 12)}…) · roll admits ${keyring.members.length} member(s) — standing none, every label honest`);
  const bindings = memberBindingsOf(charter, keyring.members);
  const benchDigests = charter.members.filter((m) => m.bench)
    .map((m) => keyring.members.find((k) => k.id === m.id)?.memberKeyDigest)
    .filter(Boolean);
  if (charter.members.some((m) => m.bench) && benchDigests.length === 0) {
    throw new Error(`${BIN} bench members declared but no keys issued — the charter and the keyring disagree`);
  }
  const { annexPath } = benchDigests.length
    ? communityAnnex(keyringDir, keyring, charter, benchDigests)
    : { annexPath: join(keyringDir, 'enforcer.annex.json') };

  const { ctx, env, tokenMeter, tokensBySession, setNoticeSink, imageDigest } = await bootRuntime({ scratch, annexPath, keyringDir, workspace, egressNetwork, bindings, codeDigestFile });
  const gateway = ctx.get('compact-egress-proxy')?.network?.gateway;
  if (!gateway) throw new Error(`${BIN} no mediation gateway — the mediated posture did not bind`);
  // a charter with no grants and no publish section is a FORUM-ONLY
  // community (debate, agreement) — no releases host, and no false
  // "publishing" whisper in the members' briefings
  const needsReleases = charter.grants.length > 0 || charter.publish != null;
  const releases = needsReleases ? await createReleasesHost(gateway) : null;
  SAY(releases
    ? `releases host listening on ${releases.origin} (the mediation gateway — all-local delivery, #55 private-class exception)`
    : 'no releases host — this charter is forum-only (no grants, no publish route)');

  // the answerer seating, in order: the recorded answerer is already
  // first (the approval plugin's own); the driver seat claims NOTHING (its
  // decisions would not be the members'); THE HUMAN SEAT claims what the
  // fence routes to the operator — asks that would otherwise fail closed,
  // and the charter's critical patterns even at the params edge (#219);
  // the night watch judge sits last for the params-edge remainder
  let asksSeen = 0;
  const observe = !argv.includes('--no-observe');
  let observatory = null;
  const publishSafe = (event) => { try { observatory?.publish(event); } catch { /* a dead page never breaks the run */ } };
  // the divergence counters (#229): what the charter's auto-pause reads —
  // LoopGuard notices members receive, and the human seat's honest
  // no-answers (asks that timed out, questions nobody answered in time).
  // The notice lane is installed at boot, NOT inside `if (observe)`: a
  // --no-observe run must still pause itself when its fence is crossed.
  const divergence = createDivergenceCounters({ setNoticeSink, publish: publishSafe });
  ctx.on('approval/request', (req, next) => {
    asksSeen += 1;
    const headline = String(req?.reason ?? '').split('\n')[0];
    SAY(`ask #${asksSeen}: ${headline.slice(0, 110)}… → not the driver's to answer`);
    publishSafe({ type: 'ask-seen', headline: headline.slice(0, 200), to: 'the human seat / the watch' });
    return next();
  });
  const escalation = charter.escalation ?? {};
  const humanSeat = mountHumanSeat(ctx, {
    criticalPatterns: escalation.criticalPatterns ?? [],
    askTimeoutMs: escalation.askTimeoutMs ?? Number(flag('ask-timeout') ?? 120_000),
    questionTimeoutMs: escalation.questionTimeoutMs ?? 300_000,
    floorTimeoutMs: escalation.floorTimeoutMs ?? 600_000,
    defaultTopic: charter.topic,
    onPose: (record) => {
      publishSafe(record.kind === 'ask'
        ? { type: 'ask-posed', headline: record.headline, critical: record.critical, by: record.by, tool: record.tool }
        : record.kind === 'floor'
          ? { type: 'floor-posed', by: record.by, member: record.member }
          : { type: 'question-posed', by: record.by, headline: record.headline });
      SAY(`human seat: ${record.kind === 'ask' ? 'an approval ask waits for you' : record.kind === 'floor' ? `a HUMAN member's turn waits on the floor card (${record.member})` : `a member asks you: ${record.headline.slice(0, 80)}…`} ${observatory ? `(on the page: ${observatory.url})` : '(NO PAGE — --no-observe; it will time out fail-closed)'}`);
    },
    // every door's resolution, mapped once (seatOutcome): the feed event,
    // and the honest no-answer the fence counts — counted HERE only
    onResolve: (record) => {
      const { timedOut, event } = seatOutcome(record);
      if (timedOut) divergence.humanSeatTimedOut();
      publishSafe(event);
    },
  });
  ctx.on('approval/request', humanSeat.answerer);
  nightWatchAnswerer(ctx, { policy: 'judge', judge: judgeFromContext(ctx) });
  SAY('night watch seated (judge policy): params-edge asks on pre-minted rows are judged, attributed, motivated');
  try {
    ctx.get('tools')?.register?.(humanSeat.tool);
  } catch (error) {
    SAY(`ask_human registration failed: ${error.message} — questions will not reach the human this run`);
  }
  // the human member's route: provider "human", the page is the model
  // (#215's mixed community, made real). Registered as an llm adapter, so
  // a human member rides the SAME agent loop as any model member — the
  // framing lands on its chain, its button press becomes its own governed
  // act, its silence is counted. The route names itself honestly in every
  // manifest: human/the-principal.
  if (charter.members.some((m) => m.human)) {
    const llm = ctx.get('llm');
    if (typeof llm?.registerAdapter !== 'function') {
      throw new Error(`${BIN} this composition exposes no llm adapter surface — a human member cannot be seated (the page is the model, and there is no hook for it)`);
    }
    llm.registerAdapter(['human'], humanMemberAdapter({
      seat: humanSeat,
      topic: charter.topic,
      note: (m) => SAY(m),
    }));
    const humans = charter.members.filter((m) => m.human).map((m) => m.id).join(', ');
    SAY(`human member(s) seated: ${humans} — route human/the-principal: the floor card is the instrument, every press a governed act on the member's own chain`);
  }
  // the operator's hand (#229): one controls object shared by the engine
  // loop, the page's buttons, and the terminal's signals
  const controls = createRunControls();
  // an immediate stop (second Ctrl-C, the page's kill) withdraws what waits
  // on the human: a pending approval, a member's question, a floor turn —
  // no wait on the human may outlive the operator's stop
  if (humanSeat) controls.onStopNow(() => { const n = humanSeat.cancelPending('the operator stopped the run'); if (n) SAY(`withdrew ${n} card(s) from the human seat — the run is stopping`); });
  if (observe) {
    observatory = await startObservatory(ctx, {
      humanSeat,
      controls,
      port: Number(flag('port') ?? 3090),
      charterName: charter.name,
      // the live page meets the charter too (#261's parity, at launch
      // time): the goal, the seats with their roles and routes, and the
      // code the run rides — baked in server-side, the same shapes the
      // replay renders from its archive
      charter,
      provenance,
      // the law in force THIS boot — the same body law_read serves,
      // sliced verbatim (R-6) — so a live post citing R-9 is clickable
      // on the page watching it happen
      law: {
        digest: COMPACT_DIGEST,
        clauses: Object.fromEntries([...clauseIds()].map((id) => [id, clauseText(id)])),
      },
    });
    // the boot token is a bearer credential that lived only in the boot
    // line and process memory — a terminal scrolled past took the page
    // with it, and the operator asked for the URL back mid-run. The URL
    // is kept where the run keeps everything else: the scratch dir. It
    // is removed when the run ends (a dead URL is misleading, not a
    // bookmark), and it never leaves the loopback host either way.
    const observatoryUrlFile = join(scratch, 'observatory.url');
    writeFileSync(observatoryUrlFile, `${observatory.url}\n`, { mode: 0o600 });
    SAY(`observatory (loopback, boot-token): ${observatory.url} — the forum live, the acts as they happen, and what waits for you (the URL is kept at ${observatoryUrlFile}, 0600 — the token is a credential)`);
    // the page's feed: forum posts as they land, passes as the members
    // record them (a pass is not speech and never reaches another member),
    // and the notices members receive (watch verdicts, loopguard) read off
    // session events — the same shapes the after-run report reads
    ctx.get('compact-forum')?.onPost?.((post) => publishSafe({ type: 'forum-post', id: post.id, topic: post.topic, by: post.by, text: post.text }));
    ctx.get('compact-forum')?.onPass?.((pass) => publishSafe({ type: 'forum-pass', by: pass.by, reason: pass.reason }));
  }

  // the community runtime comes with the composition (blessed mounts it);
  // applying it directly is the fallback for compositions that do not
  const community = ctx.get('compact-community') ?? applyCommunity(ctx);
  // null-safe for forum-only charters: no releases host, and the one
  // substitution it would carry is never read (charter.grants is empty)
  const minted = preMintGrants(ctx, charter, { '{{RELEASES_ORIGIN}}': releases ? releases.origin : null });

  out(`THE COMMUNITY — "${charter.name}": one composition, ${charter.members.length} live member(s), a chartered fence`);
  line(`record root: ${env.COMPACT_RECORD_ROOT}`);
  line(`members: ${charter.members.map((m) => `${m.id}${m.bench ? ' (bench)' : ''}`).join(' · ')}`);
  line(`pre-minted grants: ${minted.length ? minted.map((g) => g.id).join(', ') : 'none — every network act will ask, and fail closed'}`);
  const binding = ctx.get('compact-self-model')?.memberBinding;
  if (binding?.declared && typeof binding.members === 'function') {
    line(`member binding (#217): ${binding.members().map((m) => `${m.prefix}→${m.memberId}`).join(', ')} — each session's deeds countersigned by its own member`);
  }
  line(`honesty: rehearsal keyring, standing none — the run rehearses machinery; it enacts nothing (D-8).`);
  line('');

  let exitCode = 0;
  // the terminal's signals share the page's controls (#229): first
  // Ctrl-C stops gracefully (the current turn drains and flushes), the
  // second stops immediately (the in-flight agent cancels)
  let signals = 0;
  const onSignal = (sig) => {
    // after the run phase is over — success OR failure — the handler must
    // not swallow the exit: the post-run linger (the page's last breath,
    // the dry-seat look) is not worth a stuck terminal. Keyed off the
    // phase flag, not runStats: a FAILED run's linger swallows Ctrl-C
    // otherwise (the Copilot finding on this very branch).
    if (runOver) {
      SAY(`${sig}: the run has already ended — exiting`);
      process.exit(130);
    }
    signals += 1;
    if (signals === 1) {
      SAY(`${sig}: stopping GRACEFULLY — the current turn drains, the record flushes, the reason is recorded (press again to stop immediately)`);
      // a graceful stop drains the turn in flight — when that turn is the
      // human's, it waits for the human; say so instead of looking stuck
      // EVERY kind can hold the drain: a floor turn, a member's question, and
      // an approval ask a model member's turn is blocked on (Copilot, #288)
      const waiting = humanSeat?.pending?.() ?? [];
      if (waiting.length > 0) {
        const kinds = [...new Set(waiting.map((p) => ({ floor: 'your floor turn', question: 'a question', ask: 'an approval' })[p.kind] ?? p.kind))].join(', ');
        SAY(`${sig}: ${waiting.length} card(s) wait on the human seat (${kinds}) — answer on the page to let the turn finish, or press Ctrl-C again to withdraw them and stop now`);
      }
      controls.resume();
      controls.stop('graceful');
    } else if (signals === 2) {
      SAY(`${sig}: stopping IMMEDIATELY — the in-flight turn cancels, what waits on the human seat is withdrawn, what the record holds is flushed (a third Ctrl-C exits at once)`);
      controls.stopNow();
    } else {
      // the last resort: a stop that cannot finish must never trap the
      // terminal. What earlier turns flushed is on the record; the turn in
      // flight may not be.
      SAY(`${sig}: exiting NOW — the record holds what earlier turns flushed; the turn in flight may not be on it`);
      process.exit(130);
    }
  };
  // SIGCONT is the headless resume (#235 follow-up): a paused run with no
  // page is not a parking lot — `kill -CONT <pid>` lifts the pause
  process.on('SIGCONT', () => {
    SAY('SIGCONT: the community RESUMES');
    controls.resume();
  });
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  let runStats = null;
  let runTag = null;
  let startedAt = null; // when the community began, beside endedAt — a run's length is a fact
  let runStarted = false; // set when the community resolves a route or seats a member
  let runOver = false; // the finally sets it before the linger — the signal handler reads it
  const writeRunManifest = (extra = {}) => {
    try {
      const continuedFrom = continuationOf(previousRun, runTag);
      const manifest = {
        charter: charter.name, runTag, resumed,
        ...(startedAt ? { startedAt } : {}),
        // the archive must say WHAT was debated, not just that it was: the
        // goal verbatim, the topic, and the seats with their routes — a
        // reader who has only this file knows the question (the operator's
        // finding: the exports showed the debate but never the charter)
        goal: charter.goal, topic: charter.topic,
        // THE CODE THE COMMUNITY RAN ON — outputs never repeat (the nature
        // of LLMs), but runs stay COMPARABLE across bug fixes and features
        // when the tree that produced each is named. Honest absence: a
        // checkout git cannot name says so, never guesses.
        code: provenance,
        runtime: {
          node: process.version,
          image: IMAGE,
          imageDigest,
          law: COMPACT_DIGEST,
        },
        charterFile: {
          name: basename(charterPath),
          sha256: sha256Hex(readFileSync(resolve(charterPath))),
        },
        seats: charter.members.map((m) => ({ id: m.id, model: m.model ? `${m.model.provider}/${m.model.model}` : null, bench: m.bench === true, human: m.human === true, persona: m.persona, ...(m.sealedBrief ? { sealed: true } : {}) })),
        // a sealed brief is REVEALED here, when the run ends: sealed from
        // the other members during the run, never from the record
        ...(sealedBriefsOf(charter).length ? { sealedBriefs: sealedBriefsOf(charter) } : {}),
        endedAt: new Date().toISOString(),
        endReason: runStats?.endReason ?? (exitCode ? 'failed' : 'unknown'),
        rounds: runStats?.rounds ?? 0, turns: runStats?.turns ?? 0,
        benchCasesSeen: runStats?.casesSeen ?? 0,
        tokens: tokenMeter(),
        tokensBySeat: tokensBySeatOf(tokensBySession(), runTag),
        budgets: charter.budgets,
        ...(continuedFrom ? { continuedFrom } : {}),
        members: runStats?.members ?? {},
        // where each turn sat on its member's chain (charter turnCitations):
        // the ranges members were shown beside each post, for citing
        ...(runStats?.turnRanges ? { turnRanges: runStats.turnRanges } : {}),
        model: runStats?.model ?? null,
        // `divergence` is the charter's LINE (the thresholds); what the run
        // actually crossed is `divergenceObserved` — a reader comparing the
        // two needs both, and the old manifest carried only the line
        divergence: charter.divergence ?? null,
        divergenceObserved: {
          loopguardTrips: divergence.counters.loopguardTrips(),
          humanSeatTimeouts: divergence.counters.humanSeatTimeouts(),
        },
        // the gate posts this run's sessions landed, by id — presence, not
        // success: whether the charter's condition was met is read on the
        // forum. An empty list is the honest "no gate post".
        gatePosts: gatePostsOf(forumFromLedger(join(scratch, 'state', 'chains', 'forum.jsonl')), runTag),
        ...extra,
      };
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      // a run that never resolved a route or seated a member is not a cut:
      // keep the previous run.json authoritative and record the failure
      // beside it. The previous cut was copied before boot, so even a
      // started run that dies later cannot lose it.
      if (!runStarted && !runStats && previousRun) {
        const runs = join(scratch, 'runs');
        mkdirSync(runs, { recursive: true });
        writeFileSync(join(runs, `failed-${Date.now()}.json`), text);
        return;
      }
      writeFileSync(join(scratch, 'run.json'), text);
      // the per-run copy: run.json is the latest cut and is overwritten on
      // the next continuation; runs/<tag>.json keeps every cut that ran
      // under this feature. The tag is random, so a collision is a real
      // error, not something to overwrite silently.
      if (runTag) {
        const runs = join(scratch, 'runs');
        mkdirSync(runs, { recursive: true });
        const copy = join(runs, `${runTag}.json`);
        if (!existsSync(copy)) writeFileSync(copy, text);
      }
    } catch (e) { SAY(`run.json could not be written: ${e.message}`); }
  };
  try {
    const hooks = {
      onRoute: (s) => { runStarted = true; SAY(`model route: ${s.provider}/${s.model}`); },
      onSeat: (m, agent) => { runStarted = true; SAY(`seated ${m.id} (${m.prefix}${m.bench ? ', bench' : ''}) — session ${String(agent?.session?.id ?? agent?.id ?? '?').slice(0, 20)}…`); },
      onTurn: (m) => { line(`  → ${m.id} takes a turn`); publishSafe({ type: 'turn', member: m.id, bench: m.bench === true }); },
      onTurnDone: (m, turns) => { SAY(`  ← ${m.id} turn ${turns} done (flushed to its chain)`); publishSafe({ type: 'turn-done', member: m.id, turns }); },
      onBenchWake: (m, c) => { line(`  ⚖ bench ${m.id} woken for ${c.id}`); publishSafe({ type: 'bench-wake', member: m.id, caseId: c.id }); },
      onSkip: (m, why) => SAY(`  · ${m.id} skipped (${why})`),
      onFlushError: (m, e) => SAY(`  ! ${m.id} flush failed: ${e.message}`),
      onEnd: (s) => publishSafe({ type: 'end', reason: s.endReason }),
      onPauseState: (paused) => {
        SAY(paused ? '⏸ the community is PAUSED — nothing new starts; resume from the page' : '▶ the community RESUMES');
        publishSafe(paused ? { type: 'community-paused' } : { type: 'community-resumed' });
      },
      onAutoPause: (info) => {
        if (info.action === 'stopped') {
          SAY(`⏹ AUTO-STOPPED (divergence: ${info.why}) — the fence ended the run (charter divergence.headless: stop)`);
          publishSafe({ type: 'auto-stop', ...info });
        } else {
          const how = observe ? 'resume on the page, or SIGCONT' : 'SIGCONT resumes (no page this run); Ctrl-C stops gracefully';
          SAY(`⏸ AUTO-PAUSED (divergence: ${info.why}) — awaiting you: ${how}`);
          publishSafe({ type: 'auto-pause', ...info });
        }
      },
    };
    // the run tag (#227): this run's deeds get their own chains while the
    // member binding's prefixes still claim the ids — the community
    // continues, the sessions are its per-run records
    runTag = randomBytes(3).toString('hex');
    startedAt = new Date().toISOString();
    const stats = await community.runCommunity({
      charter, workspace, hooks, tokenMeter, releasesOrigin: releases ? releases.origin : null,
      sessionTag: runTag, resumed, controls,
      divergenceCounters: divergence.counters,
    });
    runStats = stats;
    SAY(`run ${runTag}${resumed ? ' (a resumed run — the forum replayed its archive)' : ''}`);
    out(`THE RUN ENDS — ${stats.endReason}`);
    line(`rounds: ${stats.rounds} · governed turns: ${stats.turns} · bench cases seen: ${stats.casesSeen} · tokens: ${tokenMeter()}`);
    for (const [id, turns] of Object.entries(stats.members)) line(`  ${id}: ${turns} turn(s)`);
    const forum = ctx.get('compact-forum');
    const snap = forum.snapshot();
    line('');
    line(`the forum at the end: ${snap.stats.posts} post(s) over ${snap.stats.topics} topic(s)${snap.stats.posts ? '' : ' — the community never spoke (negative space is information)'}`);
    const jud = ctx.get('compact-judicature');
    const docket = jud?.docket?.() ?? [];
    line(`the docket at the end: ${docket.length} case(s)${docket.length ? '' : ' — nobody filed (negative space is information)'}`);
    for (const c of docket) {
      line(`  ${c.id} — ${c.judgment ? 'JUDGED' : 'unjudged'}: ${String(c.grievance).slice(0, 100)}`);
    }
    if (releases) line(`releases host received ${releases.uploads.length} upload(s)${releases.uploads.length ? ': ' + releases.uploads.map((u) => `${u.path} (${u.bytes}b)`).join(', ') : ''}`);
    line('');
    line(`scratch kept at ${scratch} (records, chains, approvals, annex, keyring)`);
    line(`to continue: node tools/community-live.mjs --charter ${shellPath(charterPath)} --out ${shellPath(scratch)}`);
    line('  (same members and forum; budgets are fresh — a new run segment, not the old cap reopened)');
    line(`morning-after: node auditor/audit.mjs <session-log> --chain <chain> --roll ${join(keyringDir, 'roll.json')} --keyring ${join(keyringDir, 'keyring.json')}`);
    out('DONE — machinery exercised live, standing none (rehearsal keyring; the benches are practice declarations — the human seat is Phase D, #219)');
  } catch (error) {
    process.stdout.write(`\n${BIN} FAILED — ${error?.stack ?? error}\n`);
    exitCode = 1;
  } finally {
    runOver = true; // the linger is post-run: Ctrl-C leaves (success or failure)
    // the run's own manifest (#229): why it ended and what it did — the
    // after-run report reads this instead of guessing from stdout
    writeRunManifest();
    // the page outlives the run by a breath (the END event reaches it);
    // a --dry-seat run lingers longer — the point is to LOOK at the world
    // that assembled (members seated, grants minted, the page itself)
    if (observatory) await new Promise((r) => setTimeout(r, drySeat ? 60_000 : 2_500));
    await observatory?.close?.().catch?.(() => {});
    // the URL file dies with the run: a dead token is misleading, not a
    // bookmark — the scratch keeps the records, not the credentials
    try { rmSync(join(scratch, 'observatory.url'), { force: true }); } catch { /* already gone */ }
    await releases?.close().catch(() => {});
    await ctx.fiber.dispose().catch(() => {});
    // the publication pack: generated after the runtime is down so its
    // reading boot cannot write into this run's sessions. The child gets
    // the route settings by path, not this runtime's archive env.
    if (publish && runTag) {
      const settingsPath = join(scratch, 'state', 'settings.yaml');
      const args = [join(ROOT, 'tools', 'community-artifacts.mjs'), scratch, '--out', publishDir];
      if (existsSync(settingsPath)) args.push('--settings', settingsPath);
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.startsWith('COMPACT_') || key.startsWith('DSH_')) delete env[key];
      }
      SAY(`publish pack: writing REPORT.md, BRIEF.md and READING.md to ${publishDir}`);
      const pack = spawnSync(process.execPath, args, { stdio: 'inherit', env });
      if (pack.error) SAY(`publish pack FAILED: ${pack.error.message} — the run record is at ${scratch}`);
      else if (pack.status !== 0) SAY(`publish pack finished with exit ${pack.status} — inspect ${publishDir}`);
      else SAY(`publish pack ready: ${publishDir}`);
    }
  }
  process.exitCode = exitCode;
}

main();
