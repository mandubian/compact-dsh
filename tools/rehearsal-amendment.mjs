#!/usr/bin/env node
// rehearsal-amendment — the A-1 → F-5 loop, rehearsed (A-1 rehearsal;
// docs/decision-rehearsal-identity.md §7).
//
// The loop: an amendment file is sealed k-of-n by the authority keys → the
// seal is verified → the enactment is recorded in a rehearsal ledger (a
// SIMULATED ENACTMENT with reasons and dissent fields per A-5) → with
// --apply, the amendment is folded into the vendored body, the digest is
// recomputed, the body is RE-SEALED under the rehearsal authority keys, the
// pins are moved together (body.js literal, register meta, enforcer annex
// lawDigest) → and the runtime refuses to boot any composition whose law and
// seal and annex do not all describe the same digest again.
//
// Default is verify-only. --apply edits the vendored law: a deliberate
// operator act, exactly what ratification will do for real — swap the
// signatures, never the tools.
//
// Usage:
//   node tools/rehearsal-amendment.mjs enact <amendment.md> --keyring <dir> [--reason "..."] [--apply] [--root <dir>]
//   node tools/rehearsal-amendment.mjs verify-body --keyring <dir> [--root <dir>]
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, parseManifest, parseSeal, verifySeal, signSeal, SealError, signAnnex, annexDigestOf } from 'compact-dsh-seals';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const compactPath = (root) => join(root, 'packages', 'constitution', 'compact', 'compact.md');
const bodySourcePath = (root) => join(root, 'packages', 'constitution', 'src', 'body.js');
const sealPath = (root) => join(root, 'packages', 'constitution', 'keyring', 'dev', 'compact-body.sig.json');
const registerPaths = (root) => [
  join(root, 'packages', 'constitution', 'register.json'),
  join(root, 'docs', 'register', 'register.json'),
];

function loadAuthorityPrivateKeys(keyringDir) {
  const privateDir = join(keyringDir, 'private');
  if (!existsSync(privateDir)) {
    throw new SealError('no-private-keys',
      `no authority private keys under ${privateDir} — sealing is the authority's act and cannot be done with the public manifest alone`);
  }
  const out = new Map();
  for (const f of readdirSync(privateDir)) {
    if (f.endsWith('.pem')) out.set(f.replace(/\.pem$/, ''), readFileSync(join(privateDir, f), 'utf8'));
  }
  return out;
}

/** Seal one artifact under the authority keys (k-of-n, distinct signers). */
function sealArtifact(keyringDir, bytes, subject, source) {
  const manifest = parseManifest(readFileSync(join(keyringDir, 'keyring.json'), 'utf8'));
  return signSeal({ bytes, subject, source, manifest, privateKeys: loadAuthorityPrivateKeys(keyringDir) });
}

/** The rehearsal ledger: append-only, A-5 shaped (reasons and dissent live here). */
function recordEnactment(keyringDir, entry) {
  const ledgerPath = join(keyringDir, 'ledger.json');
  const ledger = existsSync(ledgerPath)
    ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
    : { kind: 'rehearsal-amendment-ledger', note: 'SIMULATED ENACTMENTS only — this ledger records rehearsal, never law', entries: [] };
  ledger.entries.push(entry);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
  return ledgerPath;
}

function updateRegisterPins(root, digest) {
  for (const p of registerPaths(root)) {
    const reg = JSON.parse(readFileSync(p, 'utf8'));
    reg.meta.compactDigest = digest;
    writeFileSync(p, JSON.stringify(reg, null, 2) + '\n');
  }
}

function updateBodyPin(root, digest) {
  const p = bodySourcePath(root);
  const src = readFileSync(p, 'utf8');
  const updated = src.replace(/export const COMPACT_DIGEST = '[0-9a-f]{64}';/, `export const COMPACT_DIGEST = '${digest}';`);
  if (updated === src) throw new SealError('pin-move-failed', `could not move the COMPACT_DIGEST literal in ${p} — refusing a half-applied amendment`);
  writeFileSync(p, updated);
}

function redeclareAnnex(keyringDir, digest, registerDigest) {
  const annexPath = join(keyringDir, 'enforcer.annex.json');
  const keyPath = join(keyringDir, 'enforcer.pem');
  const old = JSON.parse(readFileSync(annexPath, 'utf8'));
  // the same enforcer key, re-declared over the new law: the annex is the
  // Enforcer's own act, and the law moved, so the declaration moves with it
  const annex = signAnnex({
    composition: old.composition,
    host: old.host,
    lawDigest: digest,
    registerDigest,
    keyId: old.enforcer.keyId,
    publicKey: old.enforcer.publicKey,
    privateKey: readFileSync(keyPath, 'utf8'),
    issuedAt: new Date().toISOString(),
  });
  writeFileSync(annexPath, JSON.stringify(annex, null, 2) + '\n', { mode: 0o600 });
  return annexDigestOf(annex);
}

function cmdEnact({ amendmentPath, keyringDir, reason, apply, root = REPO_ROOT }) {
  if (!existsSync(amendmentPath)) fail(`no amendment file at ${amendmentPath}`);
  const manifest = parseManifest(readFileSync(join(keyringDir, 'keyring.json'), 'utf8'));

  // 1. seal the amendment (k-of-n, distinct signers) and verify the seal
  const amendmentBytes = readFileSync(amendmentPath);
  const amendmentSeal = sealArtifact(keyringDir, amendmentBytes, 'amendment', amendmentPath);
  const verified = verifySeal({ bytes: amendmentBytes, subject: 'amendment', seal: amendmentSeal, manifest });
  console.log(`amendment sealed and verified: ${verified.distinctSigners} distinct signer(s), threshold ${verified.threshold} — ${verified.basis} (conveys no standing)`);

  // 2. record the SIMULATED ENACTMENT (A-5: reasons travel; dissent is kept)
  const digest = sha256Hex(amendmentBytes);
  const ledgerPath = recordEnactment(keyringDir, {
    id: `simulated-enactment-${new Date().toISOString()}`,
    kind: 'SIMULATED ENACTMENT',
    amendment: amendmentPath,
    amendmentDigest: digest,
    seal: { threshold: verified.threshold, distinctSigners: verified.distinctSigners, basis: 'dev-keyring' },
    reason: reason ?? 'rehearsal: the amendment path is exercised end-to-end under the development keyring',
    decidedBy: 'rehearsal authority keys (practice keys, one entity — NOT the A-1 trust root)',
    dissent: [],
    standing: 'none',
  });
  console.log(`enactment recorded as SIMULATED in ${ledgerPath}`);

  if (!apply) {
    console.log('verify-only: pass --apply to fold the amendment into the vendored body (a deliberate act)');
    return;
  }

  // 3. fold into the body, re-seal, move every pin together
  const body = readFileSync(compactPath(root));
  const nextBody = Buffer.concat([body, Buffer.from(`\n---\n\n${amendmentBytes.toString('utf8').trimEnd()}\n`)]);
  const nextDigest = sha256Hex(nextBody);
  if (nextDigest === sha256Hex(body)) fail('the folded body is unchanged — an amendment that changes nothing is not an amendment');
  const newSeal = sealArtifact(keyringDir, nextBody, 'compact-body', 'compact.md');
  parseSeal(JSON.stringify(newSeal)); // shape before write
  writeFileSync(sealPath(root), JSON.stringify(newSeal, null, 2) + '\n');
  writeFileSync(compactPath(root), nextBody);
  updateBodyPin(root, nextDigest);
  updateRegisterPins(root, nextDigest);
  const annexDigest = redeclareAnnex(keyringDir, nextDigest, sha256Hex(readFileSync(join(root, 'packages', 'constitution', 'register.json'))));
  console.log(`applied: the law is now sha256 ${nextDigest.slice(0, 16)}…, re-sealed k-of-n and re-pinned (body literal, register meta, annex lawDigest ${annexDigest.slice(0, 12)}…)`);
  console.log('the runtime will refuse any composition whose law, seal, and annex do not all describe this digest — that refusal is the point (F-5)');
}

function cmdVerifyBody({ keyringDir, root = REPO_ROOT }) {
  const manifest = parseManifest(readFileSync(join(keyringDir, 'keyring.json'), 'utf8'));
  const verdict = verifySeal({
    bytes: readFileSync(compactPath(root)),
    subject: 'compact-body',
    seal: parseSeal(readFileSync(sealPath(root), 'utf8')),
    manifest,
  });
  console.log(`verify OK: the body seal verifies at ${verdict.threshold} (${verdict.distinctSigners} distinct signer(s)) — ${verdict.basis}, conveys no standing`);
}

if (process.argv[1] && process.argv[1].endsWith('rehearsal-amendment.mjs')) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const keyringDir = opt('--keyring');
  try {
    if (args[0] === 'enact' && args[1] && keyringDir) {
      cmdEnact({
        amendmentPath: resolve(args[1]),
        keyringDir: resolve(keyringDir),
        reason: opt('--reason'),
        apply: args.includes('--apply'),
        root: opt('--root') ? resolve(opt('--root')) : REPO_ROOT,
      });
    } else if (args[0] === 'verify-body' && keyringDir) {
      cmdVerifyBody({ keyringDir: resolve(keyringDir), root: opt('--root') ? resolve(opt('--root')) : REPO_ROOT });
    } else {
      console.log('usage: node tools/rehearsal-amendment.mjs enact <amendment.md> --keyring <dir> [--reason "..."] [--apply] [--root <dir>] | verify-body --keyring <dir> [--root <dir>]');
      process.exit(args.length > 0 ? 1 : 0);
    }
  } catch (e) {
    fail(e.message);
  }
}
