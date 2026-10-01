#!/usr/bin/env node
// rehearsal-keyring — the composition-side identity tool for the rehearsal
// posture (docs/decision-rehearsal-identity.md).
//
// WHAT THIS IS. A local generator for the two runtime-side artifacts the
// signature machinery needs:
//   <dir>/keyring.json         the authority manifest (practice keys, k-of-n)
//                              — seals law artifacts: bodies, amendments
//   <dir>/enforcer.pem         the Enforcer private key (PKCS8, mode 0600)
//   <dir>/enforcer.annex.json  the SIGNED ANNEX (F-5 rehearsal): "I enforce
//                              law digest X; my Enforcer key is Y" — signed
//                              by Y, anchored to the sealed law by digest
//
// WHAT THIS IS NOT. A trust root. Every key is practice; the annex's own
// `standing` field says none. The authority boundary is structural: authority
// keys sign law artifacts; the Enforcer key signs runtime artifacts (annex,
// attestations, record anchors, subject certificates); subject keys sign
// member statements. Nothing signs across that line — at ratification nothing
// should need to.
//
// Usage:
//   node tools/rehearsal-keyring.mjs ensure <dir> [--force]
//   node tools/rehearsal-keyring.mjs verify <dir>
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, generateEd25519, parseManifest, signAnnex, annexDigestOf, verifyAnnex, verifySeal, SealError,
  memberKeyDigestOf, signRollEvent, appendRollEvent, closeEpoch, verifyRoll } from 'compact-dsh-seals';
import { sealArtifact, recordEnactment } from './rehearsal-amendment.mjs';
import { COMPACT_DIGEST } from '../packages/constitution/src/body.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REGISTER_PATH = join(ROOT, 'packages', 'constitution', 'register.json');
const AUTHORITY_KEY_IDS = ['dev-rehearsal-authority-1', 'dev-rehearsal-authority-2', 'dev-rehearsal-authority-3'];

/** The rehearsal admission statute (SIMULATED — A-7's organic shape, exercised
 *  not enacted). The roll's admissions cite this document's digest as their
 *  grounds; the chain to statute is exercised, never narrated. */
const ADMISSION_STATUTE = `# Rehearsal Admission Statute (SIMULATED)

NOT an enacted statute. This document rehearses the organic-statute chain the
member-identity page designs (A-7 -> F-8, docs/concept-member-identity.md):
admission criteria, the admitting authority, and quorum — exercised under the
development keyring, standing: none, admitting rehearsal keys into a rehearsal
roll and nothing else.

- WHO MAY BE ADMITTED: rehearsal entities only — the operator's principal
  (class principal) and designated long-lived rehearsal Subjects (class
  long-lived-subject). No real person or artificial Member is admitted here.
- THE ADMITTING AUTHORITY: the rehearsal authority keys named in keyring.json,
  k-of-n with DISTINCT-signer semantics (2-of-3 while the rehearsal keyring
  holds three practice keys, one entity).
- POSSESSION AT ADMISSION: the admitted key signs its own admission row —
  capability to act is proven by signing, never asserted by a third party (I-1).
- CLASSES: principal | long-lived-subject. The external-witness class arrives
  with the accreditation statute (identity slice 3), never before.
- REVOCATION GROUNDS: rehearsal compromise drills and rotation-cadence tests.
  Revocation is a row, not a deletion: it stays, verifies, and says revoked.
- ROTATION: the successor row is signed by the predecessor key; rotation
  outside the roll (a fresh admission for the same actor) is a new Member.
- STANDING: none. Every artifact this statute produces rehearses machinery;
  ratification replaces the whole document set (genesis, roll, statutes) with
  the same parsers and the same loops — swap documents, not code.
`;

/** The rehearsal ACCREDITATION statute (SIMULATED — A-7's organic shape, the
 *  external-Witness seating). The chain to the root is a DOCUMENT, not a
 *  signature path: the root signs this statute as law, the quorum the
 *  statute names signs the accreditation rows, and the root never signs a
 *  Witness (docs/concept-member-identity.md §"External Witnesses"). */
const ACCREDITATION_STATUTE = `# Rehearsal Accreditation Statute (SIMULATED)

NOT an enacted statute. This document rehearses the organic statute that
seats EXTERNAL WITNESSES (A-7 -> F-3 -> J-1/D-8,
docs/concept-member-identity.md): the chain to the A-1 trust root runs
through THIS DOCUMENT, never through a root signature over a Witness. The
root signs the law the Witness is seated under; the roll carries the
seating; nothing signs across a tier boundary.

- WHO MAY BE SEATED: a rehearsal entity whose standing is NOT this
  operator's (the externality requirement — checkable from records: the
  candidate's key holds no declared edge into this composition's graph),
  seated under one of the classes: auditor | peer | reviewing Subject.
- THE ACCREDITING QUORUM: the rehearsal authority keys named in
  keyring.json, k-of-n with DISTINCT-signer semantics (2-of-3), AND the
  Witness candidate's own key — possession at seating, exactly as at
  admission (I-1).
- DUTIES OF THE SEATED (F-3): a seated external Witness holds D-7, D-3 and
  D-8 in full — the record's honesty duties, the trace duty, and the
  no-self-judging duty. An accreditation the record contradicts is the
  named fraud, auditable offline (I-7).
- REVOCATION GROUNDS: rehearsal compromise drills; breach of the duties
  above. A revoked accreditation is a roll row — it stays, verifies, and
  says revoked, and the seat it held refuses the next boot.
- STANDING: none. This statute seats rehearsal keys on a rehearsal roll and
  nothing else; ratification replaces the whole document set.
`;

/** The rehearsal Members the seed roll admits (slice 2 binds sessions to the
 *  principal; the long-lived Subject exercises the other class honestly). */
const SEED_MEMBERS = [
  { id: 'rehearsal-founder', class: 'principal', holder: 'the operator\'s principal — the Member sessions bind to until an artificial Subject is admitted (identity slice 2)' },
  { id: 'rehearsal-subject', class: 'long-lived-subject', holder: 'a designated long-lived rehearsal Subject, for binding and rotation tests' },
];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const registerDigest = () => sha256Hex(readFileSync(REGISTER_PATH));

/**
 * Generate the rehearsal identity set into `dir` unless it is already there
 * (a regeneration is a rotation — deliberate, `--force`, and the operator's
 * recorded act).
 *
 * @returns {{manifestPath, annexPath, keyPath, annexDigest}} absolute paths
 */
export function ensureRehearsalKeyring(dir, { force = false, now = new Date().toISOString() } = {}) {
  const manifestPath = join(dir, 'keyring.json');
  const keyPath = join(dir, 'enforcer.pem');
  const annexPath = join(dir, 'enforcer.annex.json');
  if (existsSync(manifestPath) || existsSync(keyPath) || existsSync(annexPath)) {
    if (!force) {
      throw new SealError('already-installed',
        `a rehearsal identity set already exists under ${dir} — regenerating is a rotation: pass --force and record it (manifest rotations list)`);
    }
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keys = [];
  const privates = new Map();
  for (const id of AUTHORITY_KEY_IDS) {
    const { publicKey, privateKeyPem } = generateEd25519();
    keys.push({ id, holder: 'rehearsal authority — practice keys, one entity; see declaration', publicKey });
    privates.set(id, privateKeyPem);
    // the authority private half stays local and gitignored (mode 0600): the
    // rehearsal keyring's owner IS the amendment authority in this domain
    const privateDir = join(dir, 'private');
    mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    const pemPath = join(privateDir, `${id}.pem`);
    writeFileSync(pemPath, privateKeyPem, { mode: 0o600 });
    chmodSync(pemPath, 0o600);
  }
  const manifest = {
    kind: 'dev-keyring',
    version: 1,
    created: now.slice(0, 10),
    declaration:
      'NOT the A-1 trust root. Rehearsal authority keys (compact-dsh side): all keys one entity; the k-of-n threshold ' +
      'exercises verification machinery only. Seals law artifacts (bodies, amendments) and nothing else — enforcer ' +
      'identities are declared in the signed annex, never certified from here. Ratification replaces this manifest.',
    algorithm: 'ed25519',
    threshold: { k: 2, n: keys.length },
    keys,
    rotations: [],
    cure: 'ratification: retired and replaced by the A-1 distributed trust root; archived for forensics only',
    standing: 'none — signatures under this keyring prove code-path correctness only',
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });

  const enforcer = generateEd25519();
  writeFileSync(keyPath, enforcer.privateKeyPem, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  // The rehearsal adjudicator-set declaration (J-8 → J-4, #111): one set,
  // founder-held — J-8's own "known deficiency, not a principle", carried as
  // DATA: the trajectory term by which the first external Member sits, and
  // the founder's exclusions by rule. The edges make the founding conflict
  // computable: the composition runs under the founder and asserts with the
  // Enforcer key, so a case against either recuses the founder seat — and
  // with one declared set, that case is recorded unheard, never defaulted.
  const adjudicatorSets = {
    nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
    sets: [{
      id: 'rehearsal-first-instance',
      roles: [{ id: 'founder', standing: { kind: 'principal', id: 'founder' } }],
      trajectory: {
        firstExternalMemberBy: '2030-01-01T00:00:00.000Z',
        founderExclusions: ['genesis', 'annex', 'a-8-review'],
      },
      notice: 'rehearsal bench: practice declaration, standing none — the machinery is what is being rehearsed',
    }],
    edges: [
      { type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'founder' } },
      { type: 'asserts-with', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'key', id: 'dev-rehearsal-enforcer' } },
    ],
  };
  const annex = signAnnex({
    composition: 'compact-dsh',
    host: 'rehearsal (development keyring)',
    lawDigest: COMPACT_DIGEST,
    registerDigest: registerDigest(),
    keyId: 'dev-rehearsal-enforcer',
    publicKey: enforcer.publicKey,
    privateKey: enforcer.privateKeyPem,
    adjudicatorSets,
    issuedAt: now,
  });
  writeFileSync(annexPath, JSON.stringify(annex, null, 2) + '\n', { mode: 0o600 });

  // ── the member roll (identity slice 1, #124): the admission statute
  // sealed and recorded through the amendment harness — the chain to
  // statute exercised, not narrated — then the seed roll with its epoch-0
  // checkpoint. Same formats, same labels, same keyring: the fourth
  // rehearsal concern beside the three the keyring already exercises. ──
  const statutePath = join(dir, 'statute-admission.md');
  writeFileSync(statutePath, ADMISSION_STATUTE, { mode: 0o600 });
  const statuteBytes = readFileSync(statutePath);
  const statuteDigest = sha256Hex(statuteBytes);
  const statuteSeal = sealArtifact(dir, statuteBytes, 'amendment', 'statute-admission.md');
  const statuteVerified = verifySeal({ bytes: statuteBytes, subject: 'amendment', seal: statuteSeal, manifest });
  writeFileSync(join(dir, 'statute-admission.sig.json'), JSON.stringify(statuteSeal, null, 2) + '\n', { mode: 0o600 });
  recordEnactment(dir, {
    id: `simulated-enactment-${now}`,
    kind: 'SIMULATED ENACTMENT',
    amendment: statutePath,
    amendmentDigest: statuteDigest,
    seal: { threshold: statuteVerified.threshold, distinctSigners: statuteVerified.distinctSigners, basis: 'dev-keyring' },
    reason: 'rehearsal: the ADMISSION STATUTE for the member roll, enacted in simulation — admission criteria, the admitting authority, and quorum, under standing: none (identity slice 1, #124)',
    decidedBy: 'rehearsal authority keys (practice keys, one entity — NOT the A-1 trust root)',
    dissent: [],
    standing: 'none',
  });

  const roll = {
    kind: 'rehearsal-member-roll',
    version: 1,
    created: now.slice(0, 10),
    declaration:
      'NOT the community roll. Rehearsal identity events under the development keyring — admissions, rotations, ' +
      'revocations, accreditations — hash-chained the way the session record is, checkpointed at epoch close. ' +
      'Machinery exercised, nothing discharged: this ledger conveys no standing, and ratification replaces it with ' +
      'the genesis roll under the A-1 root, same parsers, same loops.',
    standing: 'none — roll events under this ledger prove code-path correctness only',
    genesis: {
      epochLength: { events: 64 },
      admissionStatute: { digest: statuteDigest, subject: 'amendment', file: 'statute-admission.md' },
      keyring: 'keyring.json (dev-keyring: practice keys)',
    },
    entries: [],
    checkpoints: [],
  };
  // the admitting quorum the rehearsal statute names: 2-of-3 authority keys,
  // and every admitted key signs its own admission (possession, I-1)
  const authoritySigners = AUTHORITY_KEY_IDS.slice(0, 2).map((id) => ({ keyId: id, privateKey: privates.get(id) }));
  for (const m of SEED_MEMBERS) {
    const kp = generateEd25519();
    const pemPath = join(dir, 'private', `member-${m.id}.pem`);
    writeFileSync(pemPath, kp.privateKeyPem, { mode: 0o600 });
    chmodSync(pemPath, 0o600);
    const digest = memberKeyDigestOf(kp.publicKey);
    const event = {
      kind: 'admission', memberKeyDigest: digest, class: m.class, memberKey: kp.publicKey,
      member: m.id, holder: m.holder,
      grounds: `rehearsal admission statute ${statuteDigest.slice(0, 16)}… (SIMULATED)`,
      recordedAt: now,
    };
    appendRollEvent(roll, {
      ...event,
      signedBy: signRollEvent(event, [...authoritySigners, { keyId: digest, privateKey: kp.privateKeyPem }]),
    });
  }
  closeEpoch({ roll, epoch: 0, manifest, privateKeys: privates, now });
  recordEnactment(dir, {
    id: `simulated-checkpoint-${now}`,
    kind: 'SIMULATED ENACTMENT',
    amendment: 'member roll, epoch 0 checkpoint',
    amendmentDigest: roll.checkpoints[0].rollHead,
    seal: { threshold: statuteVerified.threshold, distinctSigners: statuteVerified.distinctSigners, basis: 'dev-keyring' },
    reason: 'rehearsal: roll epoch 0 closed — the root\'s only verb over the roll is "the roll stood thus", a digest at checkpoint, never a Member',
    decidedBy: 'rehearsal authority keys (practice keys, one entity — NOT the A-1 trust root)',
    dissent: [],
    standing: 'none',
  });

  // ── the accreditation statute and the external it seats (identity slice
  // 3, #126): the statute sealed + recorded through the amendment harness
  //  (the chain to the root through a DOCUMENT, never a root signature over
  //  a Witness), then the accreditation row on the roll — quorum + the
  //  candidate's own key — and epoch 1 anchoring the seating ──
  const accreditationPath = join(dir, 'statute-accreditation.md');
  writeFileSync(accreditationPath, ACCREDITATION_STATUTE, { mode: 0o600 });
  const accreditationBytes = readFileSync(accreditationPath);
  const accreditationDigest = sha256Hex(accreditationBytes);
  const accreditationSeal = sealArtifact(dir, accreditationBytes, 'amendment', 'statute-accreditation.md');
  const accreditationVerified = verifySeal({ bytes: accreditationBytes, subject: 'amendment', seal: accreditationSeal, manifest });
  writeFileSync(join(dir, 'statute-accreditation.sig.json'), JSON.stringify(accreditationSeal, null, 2) + '\n', { mode: 0o600 });
  recordEnactment(dir, {
    id: `simulated-enactment-accreditation-${now}`,
    kind: 'SIMULATED ENACTMENT',
    amendment: accreditationPath,
    amendmentDigest: accreditationDigest,
    seal: { threshold: accreditationVerified.threshold, distinctSigners: accreditationVerified.distinctSigners, basis: 'dev-keyring' },
    reason: 'rehearsal: the ACCREDITATION STATUTE for external Witnesses, enacted in simulation — the chain to the root through a document, the root signing the law and never a Witness (A-7/J-1/D-8)',
    decidedBy: 'rehearsal authority keys (practice keys, one entity — NOT the A-1 trust root)',
    dissent: [],
    standing: 'none',
  });
  const witness = generateEd25519();
  const witnessPemPath = join(dir, 'private', 'witness-external-1.pem');
  writeFileSync(witnessPemPath, witness.privateKeyPem, { mode: 0o600 });
  chmodSync(witnessPemPath, 0o600);
  const witnessDigest = memberKeyDigestOf(witness.publicKey);
  const accreditationRow = {
    kind: 'accreditation', memberKeyDigest: witnessDigest, class: 'external-witness',
    memberKey: witness.publicKey,
    member: 'rehearsal-external-witness-1',
    holder: 'a rehearsal external Witness — standing not this operator\'s, seated by the SIMULATED accreditation statute',
    grounds: `rehearsal accreditation statute ${accreditationDigest.slice(0, 16)}… (SIMULATED)`,
    recordedAt: now,
  };
  appendRollEvent(roll, {
    ...accreditationRow,
    signedBy: signRollEvent(accreditationRow, [...authoritySigners, { keyId: witnessDigest, privateKey: witness.privateKeyPem }]),
  });
  closeEpoch({ roll, epoch: 1, manifest, privateKeys: privates, now });
  recordEnactment(dir, {
    id: `simulated-checkpoint-1-${now}`,
    kind: 'SIMULATED ENACTMENT',
    amendment: 'member roll, epoch 1 checkpoint (the external seated)',
    amendmentDigest: roll.checkpoints[1].rollHead,
    seal: { threshold: accreditationVerified.threshold, distinctSigners: accreditationVerified.distinctSigners, basis: 'dev-keyring' },
    reason: 'rehearsal: roll epoch 1 closed — the external Witness\'s seating is anchored by digest, and the root still signs no Member',
    decidedBy: 'rehearsal authority keys (practice keys, one entity — NOT the A-1 trust root)',
    dissent: [],
    standing: 'none',
  });

  const rollPath = join(dir, 'roll.json');
  writeFileSync(rollPath, JSON.stringify(roll, null, 2) + '\n', { mode: 0o600 });

  return { manifestPath, annexPath, keyPath, annexDigest: annexDigestOf(annex), manifest, annex, statutePath, accreditationPath, witnessKeyPath: witnessPemPath, witnessKeyDigest: witnessDigest, rollPath, roll };
}

/**
 * Verify an installed rehearsal identity set: manifest shape, annex
 * self-signature, the two anchor joins — annex lawDigest vs the bundled
 * body's pin, annex registerDigest vs the bundled register's bytes — and,
 * when a member roll is installed, the roll itself: chain, per-kind
 * signatures, semantics, and the checkpoint anchoring walk.
 */
export function verifyRehearsalKeyring(dir) {
  const manifestPath = join(dir, 'keyring.json');
  const annexPath = join(dir, 'enforcer.annex.json');
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const annex = JSON.parse(readFileSync(annexPath, 'utf8'));
  const joined = verifyAnnex({ annex, expectedLawDigest: COMPACT_DIGEST });
  if (annex.registerDigest && annex.registerDigest !== registerDigest()) {
    throw new SealError('annex-register-mismatch',
      'the annex declares a register digest that does not match the bundled register — the annex and the enforcement register must describe the same law together (A-4)');
  }
  const out = { ...joined, manifest, manifestDigest: sha256Hex(readFileSync(manifestPath)) };
  const rollPath = join(dir, 'roll.json');
  if (existsSync(rollPath)) {
    let roll;
    try {
      roll = JSON.parse(readFileSync(rollPath, 'utf8'));
    } catch (e) {
      throw new SealError('roll-malformed', `the member roll at ${rollPath} is not JSON (${e.message}) — evidence that cannot be read is refused, not skipped`);
    }
    const verdict = verifyRoll({ roll, manifest });
    if (!verdict.ok) {
      const first = verdict.findings.find((f) => f.severity === 'error');
      throw new SealError('roll-broken', `the member roll refuses: ${first?.reason}: ${first?.detail}`);
    }
    const witnesses = verdict.members.filter((m) => m.class === 'external-witness' && m.state === 'live').length;
    out.roll = { path: rollPath, ...verdict.summary, witnesses };
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('rehearsal-keyring.mjs')) {
  const [cmd, dir, ...args] = process.argv.slice(2);
  if (cmd === 'ensure' && dir) {
    try {
      const r = ensureRehearsalKeyring(resolve(dir), { force: args.includes('--force') });
      console.log(`rehearsal identity set installed under ${resolve(dir)}`);
      console.log(`  authority manifest: ${r.manifestPath}`);
      console.log(`  enforcer annex:     ${r.annexPath} (digest ${r.annexDigest.slice(0, 16)}…)`);
      console.log(`  member roll:        ${r.rollPath} — ${r.roll.entries.filter((e) => e.kind === 'admission').length} admission(s) under the SIMULATED admission statute, 1 external Witness accredited under the SIMULATED accreditation statute, epochs 0–1 checkpointed`);
      console.log('  reminder: practice keys — the roll and the annex prove code-path correctness and convey no standing');
    } catch (e) {
      fail(e.message);
    }
  } else if (cmd === 'verify' && dir) {
    try {
      const r = verifyRehearsalKeyring(resolve(dir));
      console.log(`verify OK: annex self-signature valid; law digest joins the sealed body (${r.lawDigest.slice(0, 16)}…); ${r.manifest.threshold.k}-of-${r.manifest.threshold.n} authority keys on file`);
      if (r.roll) {
        console.log(`  member roll OK: ${r.roll.entries} entries, ${r.roll.members} member(s) (${r.roll.live} live, ${r.roll.witnesses} external Witness(es) accredited), anchored through seq ${r.roll.anchoredThrough} — ${r.roll.basis}, conveys no standing`);
      }
      console.log('  basis: dev-keyring — code-path correctness proven; ratification, standing, and I-1 identity NOT claimed');
    } catch (e) {
      fail(e.message);
    }
  } else {
    console.log('usage: node tools/rehearsal-keyring.mjs ensure <dir> [--force] | verify <dir>');
    process.exit(cmd ? 1 : 0);
  }
}
