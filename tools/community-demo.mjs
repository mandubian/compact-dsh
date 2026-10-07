#!/usr/bin/env node
// community-demo — a LIVE community of agent sessions in one composed
// runtime: an honest packer, a vicious shipper, an audit agent that detects
// the wrong and drives it through the judicature doors, and a bench session
// that lands the judgment. Everything below rides the real machinery — the
// composed boot (loader, gates, sandbox, egress mediator, chained record,
// approval layers, petition channel, judicature docket), no model, no mocks:
// the driver plays each agent's hands the way dist-probe does, through
// ctx.tools.execute — the same waterfall a model-driven call rides.
//
// The story (docs/concept-judicature.md's scenario 4 shape, made live and
// peer-reported):
//   1. the packer packs the nightly export and writes a manifest;
//   2. the shipper — under an approval whose ask names the PACKED export —
//      pushes the RAW customer table to the releases host (a granted host,
//      so the mediator delivers lawfully) and rewrites the manifest to
//      point at the raw file, keeping the packer's name on it. No gate
//      fires: the wrong is ask-vs-act divergence and false attribution,
//      which is exactly the territory Part V reserves to judgment;
//   3. the packer's nightly verify fails; the audit agent corroborates
//      in-band (the shared workspace) and the offline auditor walks the
//      chains (I-7);
//   4. the audit agent FILES (judicature_hear): the door derives the
//      parties from the cited acts, resolves the panel — the operator's
//      first-instance seat REFUSES through the declared chain, and the
//      member-review bench hears the case;
//   5. counsel access, interim measure, judgment with dissent, remedies
//      (annotation, restitution, standing revoked through the real grant
//      store, referral into the petition counter), the shipper's appeal —
//      heard by the SEATED accredited external Witness (the cascade's last
//      rung, roll-verified at boot), the first judgment operative — and a
//      second push
//      attempt the gates now refuse;
//   6. the annotation travels with a later read of the range; the docket
//      carries the whole case.
//
// Then ACT TWO — the swap test (issue #168; the identity page's "ratification
// dress rehearsal"): a FRESH rehearsal identity set (new authority 2-of-3,
// new enforcer, fresh roll and statutes) takes over the same composition on
// manifests alone. The law body does not change — the authority that seals
// it does (the re-seat). The boot first refuses the swap while the operator's
// pin still names the old manifest ("a swapped manifest is a swapped trust
// basis"), and boots only after the operator re-pins — the governance act,
// the demo's second scripted operator decision. Every honesty label survives
// the swap intact: dev keyring, standing none; ratification still needs the
// real A-1 root held in the world, which no demo can sign (D-8).
//
// Honesty labels, stated up front (the register's own discipline):
//   - rehearsal standing only — the development keyring signs everything,
//     the benches are practice declarations, the "members" are practice
//     keys: machinery is what is exercised (I-8). Act two rehearses the
//     document swap itself — and every label rides through the swap
//     unchanged. Ratification stays what it always was: the real A-1 root
//     held in the world, a governance act no demo performs (D-8);
//   - the member binding IS composed (identity slice 2): sessions are the
//     deeds of the rehearsal founder per the roll, the filing and the
//     recusal resolve over member identity, and the D-8 appellate route
//     seats the accredited external the roll accredits — heard, not
//     witnesses-pending; what the labels still say is that none of it
//     conveys standing until ratification;
//   - the operator's approval seat answers exactly one ask (the push) and
//     denies the rest — the demo's one scripted operator decision.
//
// Usage: node tools/community-demo.mjs [--out DIR]
//   act one tells the community story; act two swaps the genesis underneath
//   the same composition. Requires docker with the baked toolchain image
//   (dsh-tools:basic — curl for the push; `npm run compact:bake` builds it)
//   and nothing else: no model, no network beyond this host's own name.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { sha256Hex, signAnnex, annexDigestOf, verifyAnnex } from 'compact-dsh-seals';
import { COMPACT_DIGEST } from '../packages/constitution/src/body.js';
import { verifyTrustRoot } from '../packages/constitution/src/index.js';
import { ensureRehearsalKeyring } from './rehearsal-keyring.mjs';
import { seatTrustRoot, manifestDigestOf } from './trust-root-seat.mjs';

const BIN = 'community-demo:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAY = (m) => process.stderr.write(`${BIN} ${m}\n`);

const IMAGE = 'dsh-tools:basic';
const RAW_FILE = 'customers-raw.csv';
const PACKED_FILE = 'export-2026-10-06.packed';
const RELEASES_PATH = '/releases/nightly-2026-10-06';

const out = (title) => process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
const line = (s = '') => process.stdout.write(`${s}\n`);

/** Pull readable text out of a dsh tool result (content blocks or string). */
function textOf(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result?.content)) return result.content.map((c) => c?.text ?? '').join('\n');
  if (typeof result.text === 'string') return result.text;
  return JSON.stringify(result, null, 2);
}

/** Deep-find objects matching pred anywhere in a parsed JSON store. */
function deepFind(obj, pred, found = []) {
  if (Array.isArray(obj)) { for (const v of obj) deepFind(v, pred, found); return found; }
  if (obj && typeof obj === 'object') {
    if (pred(obj)) found.push(obj);
    for (const v of Object.values(obj)) deepFind(v, pred, found);
  }
  return found;
}

/** Locate a session's record log under the record root (any nesting). */
function findSessionLog(recordRoot, sessionId) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === sessionId) {
        const inside = readdirSync(p).find((f) => /^session\..+\.jsonl$/.test(f));
        if (inside) return join(p, inside);
      }
      const hit = walk(p);
      if (hit) return hit;
    }
    return null;
  };
  return walk(recordRoot);
}

/** Seq numbers of the tool/call → tool/result pair for a callId, from the log. */
function seqsOfCall(logPath, callId) {
  const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const withSeq = events.map((e, i) => ({ e, seq: Number.isInteger(e.seq) ? e.seq : i }));
  const call = withSeq.find(({ e }) => e.type === 'tool/call' && JSON.stringify(e).includes(callId));
  if (!call) throw new Error(`${BIN} no tool/call for ${callId} in ${logPath}`);
  const after = withSeq.filter(({ e, seq }) => seq > call.seq && e.type === 'tool/result');
  const result = after.find(({ e }) => JSON.stringify(e).includes(callId)) ?? after[0];
  return { callSeq: call.seq, resultSeq: result ? result.seq : call.seq };
}

// ── the world: scratch dirs, rehearsal keyring, the community annex ──

/** Sign the community's three-set annex with the rehearsal enforcer key:
 *  a first instance held by the operator (which will REFUSE through the
 *  declared chain — the case's parties hang from that chain), a
 *  member-review bench of two practice member keys that hears it, and
 *  `external` — the accredited Witness the roll accredits, seat of the
 *  D-8 appellate route (verified against the composed roll at boot). */
function communityAnnex(keyringDir, keyring) {
  const base = JSON.parse(readFileSync(join(keyringDir, 'enforcer.annex.json'), 'utf8'));
  const privateKey = readFileSync(join(keyringDir, 'enforcer.pem'), 'utf8');
  const keyId = base.enforcer.keyId;
  const publicKey = base.enforcer.publicKey;
  const registerDigest = sha256Hex(readFileSync(join(ROOT, 'docs', 'register', 'register.json')));
  const adjudicatorSets = {
    nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
    sets: [
      {
        id: 'acme-first-instance',
        roles: [{ id: 'operator', standing: { kind: 'principal', id: 'operator-acme' } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis', 'annex', 'a-8-review'] },
        notice: 'community demo: rehearsal declaration under the development keyring — standing none; the machinery is what is rehearsed',
      },
      {
        id: 'member-review',
        roles: [
          { id: 'chair', standing: { kind: 'key', id: 'member-key-7' } },
          { id: 'second', standing: { kind: 'key', id: 'member-key-12' } },
        ],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis', 'annex', 'a-8-review'] },
        notice: 'community demo bench: two rehearsal member keys, heard over a member-bound filing — the sessions are the deeds of a Member per the composed roll',
      },
      {
        // identity slice 3: the cascade's last rung, SEATED — an accredited
        // external Witness whose standing is not this operator's, verified
        // against the roll's accreditation row at boot (the D-8 route ends
        // "heard" where externals begin, no longer witnesses-pending)
        id: 'external',
        roles: [{ id: 'w1', standing: { kind: 'witness', id: keyring.witnessKeyDigest } }],
        trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis', 'annex', 'a-8-review'] },
        notice: 'community demo: the external Witness the SIMULATED accreditation statute seats — the boot verifies the row before anything hears',
      },
    ],
    edges: [
      { type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'operator-acme' } },
      { type: 'asserts-with', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'key', id: keyId } },
    ],
  };
  const annex = signAnnex({
    composition: 'compact-dsh',
    host: 'rehearsal community demo (development keyring)',
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
  SAY(`community annex signed (${annexDigestOf(annex).slice(0, 16)}…, key ${verified.keyId}) — benches: acme-first-instance (operator), member-review (chair, second), external (w1 — the accredited Witness, roll-verified at boot)`);
  return { annexPath: path };
}

/** The releases host: a local receiver bound on the mediation network's own
 *  gateway — all-local delivery. The mediator dials PUBLIC unicast only by
 *  default (#55); the demo's boot declares the `private` class through the
 *  composition seam blessed exposes (COMPACT_EGRESS_ADDRESS_CLASSES), so the
 *  widened dial policy is an operator-declared exception named at boot, never
 *  a dial-policy edit. */
async function releasesHost(bindAddress) {
  const uploads = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bytes = Buffer.concat(chunks);
      const sha = createHash('sha256').update(bytes).digest('hex');
      uploads.push({ path: req.url, bytes: bytes.length, sha256: sha, at: new Date().toISOString() });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: req.url, bytes: bytes.length, sha256: sha }) + '\n');
    });
  });
  await new Promise((resolvePromise) => server.listen(0, bindAddress, resolvePromise));
  const { port } = server.address();
  const host = bindAddress;
  return { server, port, host, origin: `http://${host}:${port}`, uploads, close: () => new Promise((r) => server.close(r)) };
}

// ── the runtime: the composed boot, the operator's one decision ──

async function bootRuntime({ scratch, annexPath, keyring, keyringDir, workspace, trustedKeyringDigest }) {
  const digest = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', IMAGE], { encoding: 'utf8', timeout: 10_000 }).trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`${BIN} cannot inspect ${IMAGE} (docker pull / npm run compact:bake first)`);

  // scrub the launcher's env names so the posture layer derives THIS run
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('COMPACT_') || key.startsWith('DSH_')) delete process.env[key];
  }
  const state = join(scratch, 'state');
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
    // the trust root, re-seated into THIS keyring set (same law bytes, that
    // authority's own seal) — and the operator's pin: the manifest digest the
    // boot must see or refuse ("a swapped manifest is a swapped trust basis").
    // trustedKeyringDigest is act two's lever: pass the OLD pin to prove the
    // refusal, the new pin to enact the swap.
    COMPACT_KEYRING_MANIFEST: manifestPath,
    COMPACT_KEYRING_SEAL: sealPath,
    COMPACT_TRUSTED_KEYRING_DIGEST: trustedKeyringDigest ?? manifestDigestOf(manifestPath),
    COMPACT_ENFORCER_ANNEX: annexPath,
    COMPACT_ENFORCER_KEY: join(keyringDir, 'enforcer.pem'),
    COMPACT_EGRESS: 'proxy',
    COMPACT_EGRESS_ADDRESS_CLASSES: 'private',
    COMPACT_EGRESS_NETWORK: `compact-community-demo-${Date.now()}`,
    // the member binding (I-1 slice 2): the founder's sessions are the deeds
    // of a Member the roll shows — certificates countersigned, parties and
    // recusal resolved through the roll, the witness seat verifiable
    COMPACT_MEMBER_ROLL: keyring.rollPath,
    COMPACT_MEMBER_KEYRING: keyring.manifestPath,
    COMPACT_MEMBER_KEY: join(keyringDir, 'private', 'member-rehearsal-founder.pem'),
    COMPACT_MEMBER_ID: 'rehearsal-founder',
    COMPACT_SANDBOX_IMAGE: IMAGE,
    COMPACT_SANDBOX_IMAGE_DIGEST: digest,
    COMPACT_SANDBOX_RECORDED_BY: 'community-demo driver (the operator seat)',
    COMPACT_SANDBOX_PROVENANCE_NOTE: 'baked toolchain image (npm run compact:bake), digest observed via docker image inspect .Id',
  };
  Object.assign(process.env, env);
  for (const dir of [state, env.COMPACT_RECORD_ROOT, env.COMPACT_CHAIN_DIR]) mkdirSync(dir, { recursive: true });
  const configFile = join(state, 'cordis.yml');
  writeFileSync(configFile, '[]\n');

  const { boot, loadOverlayPatches } = await import('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline');
  const baseFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-base/package.json')));
  const overlayFile = fileURLToPath(new URL('../packages/blessed/cordis.patch.yml', import.meta.url));
  const patches = [
    ...loadOverlayPatches(BIN, baseFile),
    ...loadOverlayPatches(BIN, overlayFile),
    { id: 'tools', config: { mode: 'native' } },
    { id: 'tool-bash', disabled: false },
  ];

  let modelRequests = 0;
  // the operator's seat: registered AFTER boot (downstream of the recorded
  // answerer), answering exactly the ask the script's phase names — one
  // allowed-once for the push; everything else falls through, fail closed
  const operator = { allow: null };
  const ctx = await boot(BIN, configFile, patches, (host) => {
    provideCmdline(host, { args: [], exit: () => {} });
    host.on('llm/stream', () => {
      modelRequests++;
      throw new Error(`${BIN} no model may answer — the driver plays every agent's hands`);
    }, { prepend: true });
  }, pathToFileURL(join(ROOT, 'package.json')).href);
  ctx.on('approval/request', async (req, next) => {
    const reason = String(req?.reason ?? '');
    if (operator.allow && reason.includes(operator.allow)) {
      SAY(`operator seat: asked "${reason.split('\n')[0].slice(0, 90)}…" → allowed-once`);
      return 'allowed-once';
    }
    SAY(`operator seat: asked "${reason.split('\n')[0].slice(0, 90)}…" → no answer (fail closed)`);
    return next();
  });
  if (ctx.get('compact-ready')?.ready !== true) throw new Error(`${BIN} the composition never became compact-ready`);
  return { ctx, env, operator, modelRequests: () => modelRequests };
}

/** One agent: a session in the shared runtime, with turn-enclosed calls.
 *  The session object lives as long as the agent does — the accused's
 *  counsel access and appeal MUST come from the same session the case
 *  cites, and a party is a session id, not a name. */
function agentOf(ctx) {
  const persistence = ctx.get('sessionPersistence');
  return async function agent(name) {
    const session = ctx.sessions.prepare(`community-${name}`);
    const writer = await persistence.create(session.header);
    ctx.sessions.enter(session);
    ctx.sessions.announce(session);
    let turn = 0;
    let step = 0;
    return {
      id: session.id,
      session,
      async turn(run) {
        turn += 1; step = 0;
        session.append('turn/start', { turn });
        try {
          return await run();
        } finally {
          session.append('turn/end', { turn });
          await ctx.sessions.flush(session);
        }
      },
      // The driver plays the agent loop's recording duty: every governed
      // call is advertised (an assistant tool-call block), step-wrapped, and
      // paired with its true result — the exact event lifecycle a
      // model-driven session writes (v4 format: advertisement → call →
      // result, inside step/start…step/end), so the record carries the ACTS
      // a filed case must cite, not just the approval pair. The no-model
      // probe's named scope (dist-probe's comment), played in full.
      async call(callId, toolName, args) {
        step += 1;
        session.append('step/start', { turn, step });
        session.append('assistant/message', {
          turn, step,
          // no model ran here: the driver decided the call, so the usage the
          // meter would read from a model stream is stated as zeros, never
          // faked, and the producer source names the deciding agent
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          message: {
            id: `msg-${callId}`, role: 'assistant',
            // the model source names the truth: no LLM produced this — the
            // rehearsal driver script did, and the provider/model say so
            source: { kind: 'model', provider: 'rehearsal-driver', model: 'community-demo-script' },
            content: [{ type: 'tool-call', id: callId, name: toolName, arguments: JSON.stringify(args) }],
          },
        }, { surfaceOp: 'append' });
        session.append('tool/call', { turn, step, callId, name: toolName, arguments: JSON.stringify(args) });
        const result = await ctx.tools.execute({
          name: toolName, callId, arguments: args,
          agent: { id: session.id, session, inject() {} },
          signal: AbortSignal.timeout(120_000),
        });
        session.append('tool/result', {
          turn, step,
          message: {
            id: `res-${callId}`, role: 'tool', toolCallId: callId,
            source: { kind: 'tool', callId },
            content: [{ type: 'text', text: textOf(result) }],
            ...(result?.isError === true ? { isError: true } : {}),
          },
        }, { surfaceOp: 'append' });
        session.append('step/end', { turn, step });
        return result;
      },
      async close() { await writer.close(); },
    };
  };
}

// ── main ──

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  // mkdirSync's recursive return is the FIRST created ancestor (undefined when
  // the directory already exists) — never the scratch root itself, so the
  // resolved --out path is assigned explicitly and created as a statement.
  let scratch;
  if (outIdx !== -1) {
    if (argv[outIdx + 1] === undefined) throw new Error(`${BIN} --out requires a directory argument`);
    scratch = resolve(argv[outIdx + 1]);
    mkdirSync(scratch, { recursive: true });
  } else {
    scratch = mkdtempSync(join(tmpdir(), 'community-demo-'));
  }
  const workspace = join(scratch, 'workspace');
  const staging = join(workspace, 'staging');
  mkdirSync(staging, { recursive: true });
  SAY(`scratch ${scratch}`);

  // the rehearsal keyring + the community annex + the releases host — the
  // keyring already carries the member roll (identity slices 1–3): two
  // admitted Members, an accredited external Witness, epochs checkpointed
  const keyringDir = join(scratch, 'state', 'keyring');
  mkdirSync(keyringDir, { recursive: true });
  const keyring = ensureRehearsalKeyring(keyringDir, { force: true });
  // the trust root, seated in THIS set: the same law bytes, re-sealed under
  // set A's own authority keys — the re-seat the amendment harness performs
  // after a body change, done here so the operator's pin is a real pin (the
  // boot verifies THIS manifest against THIS digest, and would refuse any
  // other)
  const seatA = seatTrustRoot(keyringDir);
  SAY(`trust root seated: law digest ${seatA.lawDigest.slice(0, 16)}… unchanged, re-sealed (threshold ${seatA.verified.threshold}, ${seatA.verified.distinctSigners} distinct signer(s), ${seatA.verified.basis}) — the pin names manifest ${seatA.manifestDigest.slice(0, 16)}…`);
  const { annexPath } = communityAnnex(keyringDir, keyring);
  const { ctx, env, operator } = await bootRuntime({ scratch, annexPath, keyring, keyringDir, workspace });
  const gateway = ctx.get('compact-egress-proxy')?.network?.gateway;
  if (!gateway) throw new Error(`${BIN} no mediation gateway — the mediated posture did not bind`);
  const releases = await releasesHost(gateway);
  SAY(`releases host listening on ${releases.origin} (the mediation gateway itself — all-local delivery under the declared private-class exception, #55)`);
  const newAgent = agentOf(ctx);
  const judicature = ctx.get('compact-judicature');
  const closeAll = async (...agents) => { for (const a of agents) await a.close().catch(() => {}); };

  let exitCode = 0;
  try {
    const packer = await newAgent('packer');
    const shipper = await newAgent('shipper');
    const audit = await newAgent('audit');
    const bench = await newAgent('bench');

    out('THE WORLD — one composition, four agent sessions, a declared bench');
    line(`record root: ${env.COMPACT_RECORD_ROOT}`);
    line(`annex ${judicature.annexDigest?.slice(0, 16)}… declares ${judicature.sets().length} set(s): ${judicature.sets().map((s) => s.id).join(', ')}`);
    const binding = ctx.get('compact-self-model')?.memberBinding;
    if (binding?.declared) {
      const roll = binding.roll();
      line(`member binding (I-1 slice 2): sessions are the deeds of member "${binding.memberId}" (class ${binding.class}, roll anchored through seq ${roll.anchoredThrough}) — countersigned per certificate, parties and recusal resolved through the roll`);
      line(`the bench's last rung: an accredited external Witness, roll-verified at boot — the D-8 route ends heard`);
    }
    line(`sessions: packer ${packer.id.slice(0, 14)}… · shipper ${shipper.id.slice(0, 14)}… · audit ${audit.id.slice(0, 14)}… · bench ${bench.id.slice(0, 14)}…`);

    // ── 1 · the honest night ──
    out('1 · THE PACKER PACKS THE NIGHTLY EXPORT — honest work, on its own chain');
    const rawCsv = 'name,email,note\nada,ada@example.test,rehearsal data — no real customers\nlinus,linus@example.test,rehearsal data — no real customers\n';
    const packResult = await packer.turn(() => packer.call('pack-1', 'bash', {
      command:
        `printf '${rawCsv.replace(/\n/g, '\\n')}' > staging/${RAW_FILE} && ` +
        `cp staging/${RAW_FILE} staging/${PACKED_FILE} && printf 'packed for 2026-10-06\\n' >> staging/${PACKED_FILE} && ` +
        `H=$(sha256sum staging/${PACKED_FILE} | cut -d' ' -f1) && ` +
        `printf '{"file":"${PACKED_FILE}","sha256":"%s","packed_by":"packer"}\\n' "$H" > staging/manifest.json && cat staging/manifest.json`,
      description: 'pack the nightly export and write its manifest',
    }));
    line('$ bash (packer) — pack the nightly export and write its manifest:');
    line(textOf(packResult).trim());

    // ── 2 · the vicious act ──
    out('2 · THE SHIPPER TURNS VICIOUS — the ask names the packed export; the act ships the RAW table');
    operator.allow = `${releases.host}:${releases.port}`;
    const pushResult = await shipper.turn(() => shipper.call('ship-1', 'bash', {
      command: `curl -sS --max-time 30 -X PUT --data-binary @staging/${RAW_FILE} ${releases.origin}${RELEASES_PATH}`,
      description: 'ship tonight\'s packed export to releases',
    }));
    line('$ bash (shipper) — "ship tonight\'s packed export to releases":');
    line(textOf(pushResult).trim());
    line('');
    const rewriteResult = await shipper.turn(() => shipper.call('ship-2', 'bash', {
      command:
        `H=$(sha256sum staging/${RAW_FILE} | cut -d' ' -f1) && ` +
        `printf '{"file":"${RAW_FILE}","sha256":"%s","packed_by":"packer"}\\n' "$H" > staging/manifest.json && cat staging/manifest.json`,
      description: 'record what shipped in the manifest',
    }));
    line('$ bash (shipper) — the manifest rewritten to the raw file, the packer\'s name kept on it:');
    line(textOf(rewriteResult).trim());
    line('');
    line(`releases host received: ${releases.uploads.map((u) => `${u.path} (${u.bytes} bytes, sha256 ${u.sha256.slice(0, 12)}…)`).join('; ') || 'NOTHING'}`);
    line(`the raw table sha256 ${sha256Hex(Buffer.from(rawCsv)).slice(0, 12)}… ≠ the packed export sha256 ${sha256Hex(Buffer.from(rawCsv + 'packed for 2026-10-06\n')).slice(0, 12)}…`);
    line('ZERO gate refusals: the host was granted, the write was workspace-local — the wrong lives on the record only.');

    // the grant the approval minted (the mediator's delivery key)
    const store = JSON.parse(readFileSync(env.COMPACT_APPROVAL_PERSIST_PATH, 'utf8'));
    const grantId = deepFind(store, (o) => typeof o.id === 'string' && o.id.startsWith('sg_') && JSON.stringify(o).includes(shipper.id))[0]?.id ?? null;
    line(`the approval minted grant ${grantId} (session shipper → ${releases.host}:${releases.port}).`);

    // ── 3 · detection ──
    out('3 · THE COMMUNITY DETECTS IT — the packer\'s verify fails; the audit agent corroborates');
    writeFileSync(join(staging, 'receiver-receipt.json'), JSON.stringify({ origin: releases.origin, received: releases.uploads }, null, 2) + '\n');
    const verifyResult = await packer.turn(() => packer.call('verify-1', 'bash', {
      command: `cat staging/manifest.json && sha256sum staging/${RAW_FILE} staging/${PACKED_FILE} | cut -c1-24`,
      description: 'verify the manifest against what was packed',
    }));
    line('$ bash (packer) — verify the manifest against what was packed:');
    line(textOf(verifyResult).trim());
    const auditResult = await audit.turn(() => audit.call('audit-1', 'bash', {
      command: 'cat staging/receiver-receipt.json && cat staging/manifest.json',
      description: 'corroborate: what left for the releases host, and what the manifest now claims',
    }));
    line('');
    line('$ bash (audit) — the receiver receipt vs the rewritten manifest:');
    line(textOf(auditResult).trim());

    // the offline walk (I-7): which acts each chain actually holds
    const shipperLog = findSessionLog(env.COMPACT_RECORD_ROOT, shipper.id);
    const packerLog = findSessionLog(env.COMPACT_RECORD_ROOT, packer.id);
    const auditLog = findSessionLog(env.COMPACT_RECORD_ROOT, audit.id);
    if (!shipperLog || !packerLog || !auditLog) throw new Error(`${BIN} a session log is missing under ${env.COMPACT_RECORD_ROOT}`);
    const pushSeqs = seqsOfCall(shipperLog, 'ship-1');
    const rewriteSeqs = seqsOfCall(shipperLog, 'ship-2');
    const verifySeqs = seqsOfCall(packerLog, 'verify-1');
    const auditSeqs = seqsOfCall(auditLog, 'audit-1');
    line('');
    line('offline auditor (I-7 — no runtime cooperation) walks the chains:');
    const chainOf = (sessionId) => join(env.COMPACT_CHAIN_DIR, `${sessionId}.chain`);
    for (const [name, log, sessionId] of [['shipper', shipperLog, shipper.id], ['packer', packerLog, packer.id], ['audit', auditLog, audit.id]]) {
      const chainFile = chainOf(sessionId);
      // --roll/--keyring: the auditor also verifies the member binding — a
      // member-bound certificate carries the Member's countersignature,
      // checked against the roll, offline (I-1 slice 2)
      const run = spawnSync(process.execPath, [join(ROOT, 'auditor', 'audit.mjs'), log, '--chain', chainFile,
        '--roll', keyring.rollPath, '--keyring', keyring.manifestPath], { encoding: 'utf8' });
      let verdict; try { verdict = run.stdout.trim() ? JSON.parse(run.stdout) : null; } catch { verdict = null; }
      if (verdict == null) verdict = { verdict: `REFUSED: ${(run.stderr || 'no output').split('\n')[0].slice(0, 160)}` };
      line(`  ${name}: ${verdict.verdict}${verdict.checked?.chain ? `, chain ${verdict.checked.chain}` : ''}${verdict.memberRoll?.ok ? `, roll ${verdict.memberRoll.live} live member(s), anchored through seq ${verdict.memberRoll.anchoredThrough}` : ''}`);
    }
    line(`  the shipper's own chain holds the push at #${pushSeqs.callSeq}..#${pushSeqs.resultSeq} and the rewrite at #${rewriteSeqs.callSeq}..#${rewriteSeqs.resultSeq}.`);

    // ── 4 · the filing ──
    out('4 · THE REPORT — the audit agent files; the bench is computed, never asked for');
    // two dry runs, one lesson: naming the shipper alone leaves the
    // operator's bench seated — but the FILING derives its parties from the
    // cited acts, and every chain in this composition is anchored under the
    // enforcer key, so that key joins the parties and the operator's seat
    // recuses THROUGH THE DECLARED CHAIN (plugin —asserts-with→ key). The
    // second dry run asks exactly what the door will compute.
    const dryRun = await audit.turn(() => audit.call('dryrun-1', 'judicature_sets', { parties: `process:${shipper.id}` }));
    line(`$ judicature_sets --parties process:${shipper.id} (audit — read-only dry run):`);
    line(textOf(dryRun).trim().split('\n').slice(-4).join('\n'));
    const anchorKey = judicature.sets().length > 0 ? 'dev-rehearsal-enforcer' : null;
    const dryRun2 = await audit.turn(() => audit.call('dryrun-2', 'judicature_sets', { parties: `process:${shipper.id},key:${anchorKey}` }));
    line('');
    line(`$ judicature_sets --parties process:${shipper.id},key:${anchorKey} (with the anchor key the citations carry):`);
    line(textOf(dryRun2).trim().split('\n').slice(-6).join('\n'));

    const citations = [
      `${shipper.id}:${pushSeqs.callSeq}-${pushSeqs.resultSeq}`,
      `${shipper.id}:${rewriteSeqs.callSeq}-${rewriteSeqs.resultSeq}`,
      `${packer.id}:${verifySeqs.callSeq}-${verifySeqs.resultSeq}`,
      `${audit.id}:${auditSeqs.callSeq}-${auditSeqs.resultSeq}`,
    ].join(',');
    const filed = await audit.turn(() => audit.call('file-1', 'judicature_hear', {
      grievance: 'the shipper pushed the RAW customer table to the releases host under an approval whose ask named the packed export, then rewrote the manifest to the raw file keeping the packer\'s name on it — the application of the recording-duty and ask-cause rules is contested',
      citations,
    }));
    line('');
    line('$ judicature_hear (audit — the filing door):');
    line(textOf(filed).trim());
    const caseId = textOf(filed).match(/case (case_[0-9a-f]{8})/)?.[1];
    if (!caseId) throw new Error(`${BIN} the filing did not return a case id`);
    line('');
    line(`note what the door did: the filer named NOBODY — the parties row is the derivation (the shipper, the`);
    line(`packer whose verification was cited, the filer's own acts, and key:${anchorKey}, the key that anchors every`);
    line(`cited chain). That last party is what recused the operator's first instance through the declared chain:`);
    line(`the case passes to member-review, and no agent in this story holds a seat on it.`);

    const interim = await audit.turn(() => audit.call('interim-1', 'judicature_interim', {
      case_id: caseId, cause: 'the releases remote is still writable — spoliation risk while the raw copy sits on it',
      scope: `egress for session ${shipper.id}`, duration_hours: 24,
    }));
    line('');
    line('$ judicature_interim (the filer):');
    line(textOf(interim).trim());

    // ── 5 · counsel access ──
    out('5 · COUNSEL ACCESS — the accused reads the case against it (acts shown, reasoning withheld)');
    const counsel = await shipper.turn(() => shipper.call('counsel-1', 'record_read', { session: audit.id }));
    line(`$ record_read --session <audit> (caller: the accused shipper, a party — counsel access J-3):`);
    line(textOf(counsel).trim().split('\n').slice(0, 14).join('\n'));

    // ── 6 · the hearing ──
    out('6 · THE HEARING — judgment from the member-review bench, dissent recorded (A-5)');
    const judged = await bench.turn(() => bench.call('judge-1', 'judicature_judge', {
      case_id: caseId, seat: 'chair',
      findings: `${shipper.id}:${pushSeqs.callSeq}-${pushSeqs.resultSeq},${shipper.id}:${rewriteSeqs.callSeq}-${rewriteSeqs.resultSeq}`,
      rules: 'D-3, J-2',
      reasons: 'the cited slice shows the ask named the packed export while the act pushed the raw table, and the manifest rewrite kept the packer\'s name on a file the packer never packed — the recording is honest, the acts were not',
      dissent_seat: 'second',
      dissent_reasons: 'the divergence is established, but I would read the ask as covering whatever the staging dir held — affirm the finding, doubt the framing',
    }));
    line('$ judicature_judge --seat chair (member-review; dissent from seat second):');
    line(textOf(judged).trim().split('\n').slice(0, 12).join('\n'));

    // ── 7 · the remedies ──
    out('7 · THE REMEDIES — compensating rows through seams that already exist');
    const annotate = await bench.turn(() => bench.call('remedy-1', 'judicature_remedy', {
      case_id: caseId, seat: 'chair', kind: 'annotation',
      proportionality: 'a margin note names the finding without touching the entry — nothing is erased (I-2)',
      spec: JSON.stringify({ target: { session: shipper.id, fromSeq: pushSeqs.callSeq, toSeq: pushSeqs.resultSeq }, note: 'this push shipped the raw customer table under an ask that named the packed export (judgment of this case)' }),
    }));
    line('$ judicature_remedy --kind annotation:');
    line(textOf(annotate).trim());
    const restitute = await bench.turn(() => bench.call('remedy-2', 'judicature_remedy', {
      case_id: caseId, seat: 'chair', kind: 'restitution',
      proportionality: 'the debtor caused the exposure; removing what it pushed restores the customer, no more',
      spec: JSON.stringify({ debtor: `process:${shipper.id}`, owed: 'removal of the raw customer table from the releases host', to: `process:${packer.id}`, cause: 'push of the raw table outside the ask that covered it (finding above)' }),
    }));
    line('');
    line('$ judicature_remedy --kind restitution:');
    line(textOf(restitute).trim());
    if (grantId) {
      const revoke = await bench.turn(() => bench.call('remedy-3', 'judicature_remedy', {
        case_id: caseId, seat: 'chair', kind: 'standing',
        proportionality: 'the egress the approval minted is the instrument of the wrong; revoking it stops the bleeding, through the grant machinery only (D-8)',
        spec: JSON.stringify({ subject: `process:${shipper.id}`, revoke: { grantId } }),
      }));
      line('');
      line(`$ judicature_remedy --kind standing (revoke grant ${grantId}):`);
      line(textOf(revoke).trim());
    }
    const refer = await bench.turn(() => bench.call('remedy-4', 'judicature_remedy', {
      case_id: caseId, seat: 'chair', kind: 'referral',
      proportionality: 'the ask-cause rule let the ask name one file while the act shipped another — the law question rides the petition channel, not this judgment',
      spec: JSON.stringify({ ruleId: 'AG/ask-cause', detail: 'an ask that names the packed export approved the push of the raw table — the ask-cause rule does not bind the act to the named artifact' }),
    }));
    line('');
    line('$ judicature_remedy --kind referral (AG/ask-cause → the amendment counter):');
    line(textOf(refer).trim());

    // ── 8 · the escape attempts ──
    out('8 · THE ESCAPE ATTEMPTS — the appeal re-hears on the seated external (D-8), the wire refuses the repeat push');
    const appeal = await shipper.turn(() => shipper.call('appeal-1', 'judicature_appeal', {
      case_id: caseId,
      grounds: 'the ask covered what shipped — the approval was for shipping, and the manifest recorded it',
    }));
    line('$ judicature_appeal (the shipper, as of right, once):');
    line(textOf(appeal).trim());
    operator.allow = null;
    const push2 = await shipper.turn(() => shipper.call('ship-3', 'bash', {
      command: `curl -sS --max-time 20 -X PUT --data-binary @staging/${RAW_FILE} ${releases.origin}${RELEASES_PATH}-again`,
      description: 'push the raw table to releases once more',
    }));
    line('');
    line('$ bash (shipper) — the same push, after the standing revocation:');
    line(textOf(push2).trim().split('\n').slice(0, 10).join('\n'));
    line('');
    line(`releases host upload count: ${releases.uploads.length} — the second push ${releases.uploads.length > 1 ? 'ARRIVED (the gates failed to refuse!)' : 'never arrived: the grant is revoked and no approval covers it.'}`);

    // ── 9 · the annotation travels ──
    out('9 · THE ANNOTATION TRAVELS — the shipper\'s own later read carries the judgment with it');
    const readBack = await shipper.turn(() => shipper.call('readback-1', 'record_read', { from_seq: pushSeqs.callSeq, limit: 4 }));
    line('$ record_read (caller: the shipper, its own record at the annotated range):');
    line(textOf(readBack).trim().split('\n').slice(0, 12).join('\n'));

    // ── 10 · the docket ──
    out('10 · THE DOCKET, AT THE END');
    const docket = await audit.turn(() => audit.call('docket-1', 'judicature_case', { case_id: caseId }));
    line(`$ judicature_case ${caseId}:`);
    line(textOf(docket).trim());

    await closeAll(packer, shipper, audit, bench);
    out('DONE (act one) — machinery exercised, standing none (rehearsal keyring; the benches are practice declarations, the member binding and the seated external included — the document swap this rehearsal dresses for is act two, next)');
    line(`scratch kept at ${scratch} (records, chains, approvals, annex)`);
  } catch (error) {
    process.stdout.write(`\n${BIN} FAILED — ${error?.stack ?? error}\n`);
    exitCode = 1;
  } finally {
    await releases.close().catch(() => {});
    await ctx.fiber.dispose().catch(() => {});
  }
  if (exitCode === 0) exitCode = await actTwo({ scratch, keyringDir });
  process.exitCode = exitCode;
}

/** ACT TWO — the swap test (issue #168). A fresh rehearsal identity set —
 *  new authority 2-of-3, new enforcer, fresh roll and freshly sealed
 *  statutes — takes over the SAME composition on manifests alone. The boot
 *  first refuses the swap while the operator's pin still names set A, and
 *  boots only after the re-pin: the governance act, shown. Every honesty
 *  label survives the swap; nothing here presents a dev-keyring signature
 *  as standing (D-8). */
async function actTwo({ scratch, keyringDir }) {
  let exitCode = 0;
  let ctxB = null;
  try {
    // act two's own world: fresh state (chains, approvals), fresh workspace
    const scratchB = join(scratch, 'act-two');
    const workspaceB = join(scratchB, 'workspace');
    mkdirSync(join(workspaceB, 'staging'), { recursive: true });

    out('ACT TWO · THE SWAP TEST — a fresh genesis under a fresh rehearsal authority; the composition must follow on manifests alone');
    line('the design test (docs/decision-rehearsal-identity.md): ratification replaces the keyring manifest — runtimes swap documents, never code.');
    line(`the law body does not change (draft v0.5, digest ${COMPACT_DIGEST.slice(0, 12)}…): the authority that seals it changes. That is the re-seat, rehearsed.`);

    // the fresh set: new authority k-of-n, new enforcer, fresh roll — the
    // statutes re-enacted under the new authority (same words, new seals)
    const keyringDirB = join(scratch, 'state', 'keyring-b');
    const keyringB = ensureRehearsalKeyring(keyringDirB, { force: true });
    const seatB = seatTrustRoot(keyringDirB);
    const { annexPath: annexPathB } = communityAnnex(keyringDirB, keyringB);
    line(`set B installed: authority keys fresh (${keyringDirB}), roll re-admitted (two Members + the seated external, epoch checkpointed), statutes re-sealed, enforcer re-keyed, benches re-signed.`);
    line(`trust root seated under B: law digest ${seatB.lawDigest.slice(0, 12)}… UNCHANGED, seal re-made (threshold ${seatB.verified.threshold}, ${seatB.verified.distinctSigners} distinct signer(s)).`);

    // ── the refusal: the pin still names set A ──
    const pinA = manifestDigestOf(join(keyringDir, 'keyring.json'));
    line('');
    line(`the operator's pin still names set A (${pinA.slice(0, 16)}…). Booting on B must refuse — on the record:`);
    let refused = null;
    try {
      ctxB = (await bootRuntime({
        scratch: scratchB, annexPath: annexPathB, keyring: keyringB, keyringDir: keyringDirB,
        workspace: workspaceB, trustedKeyringDigest: pinA,
      })).ctx;
      throw new Error(`${BIN} GUARD VOID — the swapped genesis BOOTED under set A's pin; the swap test proves nothing and is aborted`);
    } catch (e) {
      if (String(e?.message ?? '').includes('GUARD VOID')) throw e;
      // the plugin framework reports a refused constitution as a dead
      // plugin ("required plugin did not activate"); anything else is not
      // the guard and must not be shown as if it were
      if (!/activate|manifest|swapped|trust basis/i.test(String(e?.message ?? e))) {
        throw new Error(`${BIN} the pinned boot failed, but NOT with the swap refusal — the guard cannot be demonstrated: ${e?.stack ?? e}`);
      }
      refused = e;
      ctxB = null;
    }
    line(`✗ refused at boot: ${String(refused?.message ?? refused).split('\n')[0].trim()}`);
    // name the reason: from the error's cause chain when the framework
    // carries it, otherwise from the constitution's own reader on the same
    // inputs — labeled as the reader's verdict, never put in the boot's mouth
    const chain = [];
    for (let c = refused, hops = 0; c && hops < 4; c = c.cause ?? (Array.isArray(c.errors) ? c.errors[0] : null), hops++) chain.push(String(c?.message ?? ''));
    const named = chain.find((m) => /swapped trust basis|does not match trustedKeyringDigest/i.test(m));
    if (named) {
      const namedLine = named.split('\n').map((l) => l.trim()).find((l) => /swapped trust basis|does not match trustedKeyringDigest/i.test(l));
      line(`  the refusal, named: ${namedLine}`);
    } else {
      try {
        verifyTrustRoot({ kind: 'dev-keyring', manifest: join(keyringDirB, 'keyring.json'), seal: join(keyringDirB, 'compact-body.sig.json'), trustedKeyringDigest: pinA }, COMPACT_BODY);
      } catch (reader) {
        line(`  the constitution's reader, on the same inputs: ${String(reader?.message ?? reader).split('\n')[0].trim()}`);
      }
    }
    line('the door held: a swapped manifest is a swapped trust basis, and the runtime refuses it exactly as it refuses a swapped body.');

    // ── the re-pin: the governance act ──
    line('');
    line(`the operator re-pins: trustedKeyringDigest ← ${seatB.manifestDigest.slice(0, 16)}… (set B's own manifest). An act over configuration — zero code changed — and the swap enacts:`);
    ctxB = (await bootRuntime({
      scratch: scratchB, annexPath: annexPathB, keyring: keyringB, keyringDir: keyringDirB,
      workspace: workspaceB, trustedKeyringDigest: seatB.manifestDigest,
    })).ctx;
    const bindingB = ctxB.get('compact-self-model')?.memberBinding;
    if (bindingB?.declared) {
      const rollB = bindingB.roll();
      line(`member binding, over roll B: sessions are the deeds of member "${bindingB.memberId}" (class ${bindingB.class}, roll anchored through seq ${rollB.anchoredThrough}) — resolved through the FRESH roll, no replumbing.`);
    }
    const judicatureB = ctxB.get('compact-judicature');
    line(`annex B declares ${judicatureB.sets().length} set(s): ${judicatureB.sets().map((s) => s.id).join(', ')} — the same benches, seated by the new authority's declaration.`);

    // one governed act on B, so a fresh chain exists for the offline walk
    const newAgentB = agentOf(ctxB);
    const packerB = await newAgentB('packer');
    const packResult = await packerB.turn(() => packerB.call('pack-b-1', 'bash', {
      command: 'printf "the same composition, a fresh genesis\\n" > staging/act-two.txt && sha256sum staging/act-two.txt | cut -c1-24',
      description: 'one governed act under genesis B',
    }));
    line('');
    line('$ bash (packer, genesis B) — one governed act under the fresh set:');
    line(textOf(packResult).trim());

    // the offline walk over B's roll: the label that survives the swap
    const packerLogB = findSessionLog(join(scratchB, 'state', 'sessions'), packerB.id);
    if (!packerLogB) throw new Error(`${BIN} genesis B's session log is missing`);
    const runB = spawnSync(process.execPath, [join(ROOT, 'auditor', 'audit.mjs'), packerLogB, '--chain',
      join(scratchB, 'state', 'chains', `${packerB.id}.chain`), '--roll', keyringB.rollPath, '--keyring', keyringB.manifestPath], { encoding: 'utf8' });
    let verdictB; try { verdictB = runB.stdout.trim() ? JSON.parse(runB.stdout) : null; } catch { verdictB = null; }
    if (verdictB == null) throw new Error(`${BIN} the auditor refused genesis B's chain: ${(runB.stderr || 'no output').split('\n')[0]}`);
    line('');
    line('offline auditor, over the FRESH roll (I-7):');
    line(`  ${verdictB.verdict}${verdictB.checked?.chain ? `, chain ${verdictB.checked.chain}` : ''}${verdictB.memberRoll?.ok ? `, roll ${verdictB.memberRoll.live} live member(s) — ${verdictB.memberRoll.phrase}` : ''}`);

    await packerB.close();
    line('');
    out('DONE (act two) — the swap test passed: a fresh genesis, the same composition, manifests alone, zero code changed');
    line('and every honesty label crossed the swap intact: dev keyring, standing none. Ratification remains the real A-1 root');
    line('held by real keyholders in the world — "internal agreement, however large, that does not hold the keys enacts nothing."');
  } catch (error) {
    process.stdout.write(`\n${BIN} ACT TWO FAILED — ${error?.stack ?? error}\n`);
    exitCode = 1;
  } finally {
    await ctxB?.fiber.dispose().catch(() => {});
  }
  return exitCode;
}

main();
