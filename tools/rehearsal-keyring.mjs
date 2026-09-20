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
import { sha256Hex, generateEd25519, parseManifest, signAnnex, annexDigestOf, verifyAnnex, SealError } from 'compact-dsh-seals';
import { COMPACT_DIGEST } from '../packages/constitution/src/body.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REGISTER_PATH = join(ROOT, 'packages', 'constitution', 'register.json');
const AUTHORITY_KEY_IDS = ['dev-rehearsal-authority-1', 'dev-rehearsal-authority-2', 'dev-rehearsal-authority-3'];

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
  const annex = signAnnex({
    composition: 'compact-dsh',
    host: 'rehearsal (development keyring)',
    lawDigest: COMPACT_DIGEST,
    registerDigest: registerDigest(),
    keyId: 'dev-rehearsal-enforcer',
    publicKey: enforcer.publicKey,
    privateKey: enforcer.privateKeyPem,
    issuedAt: now,
  });
  writeFileSync(annexPath, JSON.stringify(annex, null, 2) + '\n', { mode: 0o600 });
  return { manifestPath, annexPath, keyPath, annexDigest: annexDigestOf(annex), manifest, annex };
}

/**
 * Verify an installed rehearsal identity set: manifest shape, annex
 * self-signature, and the two anchor joins — annex lawDigest vs the bundled
 * body's pin, annex registerDigest vs the bundled register's bytes.
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
  return { ...joined, manifest, manifestDigest: sha256Hex(readFileSync(manifestPath)) };
}

if (process.argv[1] && process.argv[1].endsWith('rehearsal-keyring.mjs')) {
  const [cmd, dir, ...args] = process.argv.slice(2);
  if (cmd === 'ensure' && dir) {
    try {
      const r = ensureRehearsalKeyring(resolve(dir), { force: args.includes('--force') });
      console.log(`rehearsal identity set installed under ${resolve(dir)}`);
      console.log(`  authority manifest: ${r.manifestPath}`);
      console.log(`  enforcer annex:     ${r.annexPath} (digest ${r.annexDigest.slice(0, 16)}…)`);
      console.log('  reminder: practice keys — the annex proves code-path correctness and conveys no standing');
    } catch (e) {
      fail(e.message);
    }
  } else if (cmd === 'verify' && dir) {
    try {
      const r = verifyRehearsalKeyring(resolve(dir));
      console.log(`verify OK: annex self-signature valid; law digest joins the sealed body (${r.lawDigest.slice(0, 16)}…); ${r.manifest.threshold.k}-of-${r.manifest.threshold.n} authority keys on file`);
      console.log('  basis: dev-keyring — code-path correctness proven; ratification, standing, and I-1 identity NOT claimed');
    } catch (e) {
      fail(e.message);
    }
  } else {
    console.log('usage: node tools/rehearsal-keyring.mjs ensure <dir> [--force] | verify <dir>');
    process.exit(cmd ? 1 : 0);
  }
}
