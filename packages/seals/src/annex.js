// Runtime-side identity: the signed annex (F-5 rehearsal) and subject
// session certificates (I-1 rehearsal).
//
// THE AUTHORITY BOUNDARY. The Compact's authority keys sign law artifacts
// only — body seals, amendment enactments. They never sign Enforcer
// identities: there is no CA in this design, and putting one in would make
// the compact repo a central PKI over implementations. The chain from law to
// runtime is the ANNEX — "I enforce law digest X; my Enforcer key is Y" —
// signed by Y, anchored to the sealed law by the digest, verified against the
// runtime's own key material. Two anchors, joined by a document, not by a
// signature from the law's authority. The auditor checks that join as a
// digest match and nothing more.
//
// Runtime artifacts are single-key signatures over canonical JSON bytes; the
// artifact's own `kind` field is inside the signed bytes, which is the
// domain separation. Every artifact carries the practice label in its body.

import { canonicalBytes, withoutField } from './canonical.js';
import { SealError } from './seal.js';
import { sha256Hex, signMessage, verifyMessage } from './keys.js';

export const REHEARSAL_DECLARATION =
  'development keyring: practice keys — proves code-path correctness and nothing else; ' +
  'no ratification, no standing, no I-1 identity (see docs/decision-rehearsal-identity.md)';

/** Digest of an annex, over its canonical bytes minus the signature field. */
export function annexDigestOf(annex) {
  return sha256Hex(canonicalBytes(withoutField(annex, 'signature')));
}

/**
 * Parse and shape-check an enforcer annex, verify its self-signature, and
 * check it against the law this composition actually pins.
 *
 * @param {object} p
 * @param {object} p.annex - parsed annex JSON (with its `signature` field)
 * @param {string} p.expectedLawDigest - the law digest this composition pins
 * @param {number} [p.now] - evaluation time (ms)
 * @returns {{enforcerKey: string, keyId: string, annexDigest: string, lawDigest: string}}
 * @throws {SealError} annex-malformed | annex-signature-invalid | annex-law-mismatch | annex-expired
 */
export function verifyAnnex({ annex, expectedLawDigest, now = Date.now() }) {
  const bad = !(annex && annex.kind === 'enforcer-annex'
    && typeof annex.composition === 'string' && typeof annex.host === 'string'
    && typeof annex.lawDigest === 'string' && annex.lawDigest
    && annex.enforcer && typeof annex.enforcer.keyId === 'string' && typeof annex.enforcer.publicKey === 'string'
    && typeof annex.signature === 'string' && annex.signature
    && typeof annex.declaration === 'string');
  if (bad) {
    throw new SealError('annex-malformed', 'malformed enforcer annex: parsed but missing required fields (kind=enforcer-annex, composition, host, lawDigest, enforcer.keyId/publicKey, signature, declaration)');
  }
  const signedBytes = canonicalBytes(withoutField(annex, 'signature'));
  if (!verifyMessage(signedBytes, annex.enforcer.publicKey, annex.signature)) {
    throw new SealError('annex-signature-invalid',
      `the enforcer annex's signature does not verify under its own declared key ${annex.enforcer.keyId} — the annex binds runtimes by their own key, and a self-signature that fails means this annex is not the act it claims to be`);
  }
  if (annex.lawDigest !== expectedLawDigest) {
    throw new SealError('annex-law-mismatch',
      `the enforcer annex declares law digest ${annex.lawDigest.slice(0, 16)}… but this composition pins ${expectedLawDigest.slice(0, 16)}… — the annex anchors the runtime to a different law than the one loaded; refusing the join`);
  }
  if (annex.expiresAt && new Date(annex.expiresAt).getTime() <= now) {
    throw new SealError('annex-expired', `the enforcer annex expired at ${annex.expiresAt} — an expired annex blesses nothing`);
  }
  return {
    enforcerKey: annex.enforcer.publicKey,
    keyId: annex.enforcer.keyId,
    annexDigest: annexDigestOf(annex),
    lawDigest: annex.lawDigest,
  };
}

/** Build a signed annex (rehearsal tooling; requires the enforcer private key). */
export function signAnnex({ composition, host, lawDigest, registerDigest = null, keyId, publicKey, privateKey, expiresAt = null, issuedAt = new Date().toISOString() }) {
  const annex = {
    kind: 'enforcer-annex',
    composition,
    host,
    lawDigest,
    ...(registerDigest ? { registerDigest } : {}),
    enforcer: { keyId, publicKey },
    issuedAt,
    ...(expiresAt ? { expiresAt } : {}),
    standing: 'none — rehearsal under the development keyring; conveys no standing (F-5: the annex binds by refuse-to-start and verifiability, not by blessing)',
    declaration: REHEARSAL_DECLARATION,
  };
  annex.signature = signMessage(canonicalBytes(annex), privateKey);
  return annex;
}

/**
 * Verify a subject session certificate against the enforcer key of an annex.
 * Lineage is bound as DATA (parentSubjectId / parentCertDigest), so subject
 * keys stay statement-signers: authority keys sign law, the Enforcer key
 * signs certificates, subject keys sign statements.
 *
 * @throws {SealError} cert-malformed | cert-signature-invalid | cert-expired
 */
export function verifySubjectCert({ cert, enforcerKey, expectedSubjectId = null, now = Date.now() }) {
  const bad = !(cert && cert.kind === 'subject-identity'
    && typeof cert.subjectId === 'string' && typeof cert.publicKey === 'string'
    && Number.isInteger(cert.depth) && typeof cert.scope === 'string'
    && typeof cert.signature === 'string' && cert.signature);
  if (bad) {
    throw new SealError('cert-malformed', 'malformed subject certificate: parsed but missing required fields (kind=subject-identity, subjectId, publicKey, depth, scope, signature)');
  }
  if (!verifyMessage(canonicalBytes(withoutField(cert, 'signature')), enforcerKey, cert.signature)) {
    throw new SealError('cert-signature-invalid', `subject certificate for ${cert.subjectId} does not verify under the annex's enforcer key — an unknown or forged subject identity`);
  }
  if (expectedSubjectId != null && cert.subjectId !== expectedSubjectId) {
    throw new SealError('cert-malformed', `subject certificate names ${cert.subjectId}, expected ${expectedSubjectId}`);
  }
  if (cert.expiresAt && new Date(cert.expiresAt).getTime() <= now) {
    throw new SealError('cert-expired', `the subject certificate for ${cert.subjectId} expired at ${cert.expiresAt} — a stale identity is an alarm, not a truth to act on`);
  }
  return true;
}

/** Build a signed subject certificate (rehearsal tooling / the identity service). */
export function signSubjectCert({ subjectId, publicKey, scope, depth = 0, parentSubjectId = null, parentCertDigest = null, privateKey, expiresAt = null, issuedAt = new Date().toISOString() }) {
  const cert = {
    kind: 'subject-identity',
    subjectId,
    publicKey,
    scope,
    depth,
    ...(parentSubjectId ? { parentSubjectId } : {}),
    ...(parentCertDigest ? { parentCertDigest } : {}),
    issuedAt,
    ...(expiresAt ? { expiresAt } : {}),
    standing: 'none — rehearsal identity under the development keyring',
    declaration: REHEARSAL_DECLARATION,
  };
  cert.signature = signMessage(canonicalBytes(cert), privateKey);
  return cert;
}
