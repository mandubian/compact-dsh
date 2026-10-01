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
  if (annex.adjudicatorSets !== undefined && !(
    annex.adjudicatorSets && typeof annex.adjudicatorSets === 'object'
    && Array.isArray(annex.adjudicatorSets.sets) && Array.isArray(annex.adjudicatorSets.edges))) {
    throw new SealError('annex-malformed',
      'malformed enforcer annex: adjudicatorSets, when present, must be { sets: [...], edges: [...] } — the section is part of the signed affidavit (J-8), and a shape that will not parse refuses the boot');
  }
  return {
    enforcerKey: annex.enforcer.publicKey,
    keyId: annex.enforcer.keyId,
    annexDigest: annexDigestOf(annex),
    lawDigest: annex.lawDigest,
  };
}

/** Build a signed annex (rehearsal tooling; requires the enforcer private key). */
export function signAnnex({ composition, host, lawDigest, registerDigest = null, keyId, publicKey, privateKey, expiresAt = null, adjudicatorSets = null, issuedAt = new Date().toISOString() }) {
  const annex = {
    kind: 'enforcer-annex',
    composition,
    host,
    lawDigest,
    ...(registerDigest ? { registerDigest } : {}),
    enforcer: { keyId, publicKey },
    issuedAt,
    ...(expiresAt ? { expiresAt } : {}),
    ...(adjudicatorSets ? { adjudicatorSets } : {}),
    standing: 'none — rehearsal under the development keyring; conveys no standing (F-5: the annex binds by refuse-to-start and verifiability, not by blessing)',
    declaration: REHEARSAL_DECLARATION,
  };
  annex.signature = signMessage(canonicalBytes(annex), privateKey);
  return annex;
}

/**
 * The bytes both signatures of a member-bound certificate cover: the
 * certificate without its own signature fields. The Enforcer attests the
 * hosting (it issued and confines the session); the Member countersigns the
 * SAME bytes because acting is its fact — each attests what only it can
 * attest, over one body of claims. A countersignature the runtime could
 * forge would be no countersignature: in rehearsal the operator holds the
 * member key and the labels say so; at ratification the key never transits
 * the Enforcer, and these are the same bytes it signs.
 */
export function certUnsignedBytes(cert) {
  return canonicalBytes(withoutField(withoutField(cert, 'signature'), 'memberCountersignature'));
}

/**
 * Verify a subject session certificate against the enforcer key of an annex.
 * Lineage is bound as DATA (parentSubjectId / parentCertDigest), so subject
 * keys stay statement-signers: authority keys sign law, the Enforcer key
 * signs certificates, subject keys sign statements.
 *
 * A member-bound certificate (memberKeyDigest present) is dual-signed: the
 * countersignature verifies against the MEMBER's public key — resolved from
 * the roll by the caller (the roll is the source of who holds which key),
 * passed here as `memberPublicKey`. Structural binding failures refuse
 * always; the cryptographic check runs only against a resolved key.
 *
 * @throws {SealError} cert-malformed | cert-signature-invalid | cert-expired
 *   | cert-binding-malformed | cert-countersignature-invalid
 */
export function verifySubjectCert({ cert, enforcerKey, expectedSubjectId = null, memberPublicKey = null, now = Date.now() }) {
  const bad = !(cert && cert.kind === 'subject-identity'
    && typeof cert.subjectId === 'string' && typeof cert.publicKey === 'string'
    && Number.isInteger(cert.depth) && typeof cert.scope === 'string'
    && typeof cert.signature === 'string' && cert.signature);
  if (bad) {
    throw new SealError('cert-malformed', 'malformed subject certificate: parsed but missing required fields (kind=subject-identity, subjectId, publicKey, depth, scope, signature)');
  }
  if (cert.memberKeyDigest !== undefined && typeof cert.memberKeyDigest !== 'string') {
    throw new SealError('cert-binding-malformed', `subject certificate for ${cert.subjectId} carries a non-string memberKeyDigest — the binding field is a digest or it is absent`);
  }
  if (cert.memberKeyDigest != null && typeof cert.memberCountersignature !== 'string') {
    throw new SealError('cert-binding-malformed', `subject certificate for ${cert.subjectId} names member key ${cert.memberKeyDigest.slice(0, 12)}… but carries no countersignature — a binding nobody attested is a claim, not a binding`);
  }
  if (!verifyMessage(certUnsignedBytes(cert), enforcerKey, cert.signature)) {
    throw new SealError('cert-signature-invalid', `subject certificate for ${cert.subjectId} does not verify under the annex's enforcer key — an unknown or forged subject identity`);
  }
  if (expectedSubjectId != null && cert.subjectId !== expectedSubjectId) {
    throw new SealError('cert-malformed', `subject certificate names ${cert.subjectId}, expected ${expectedSubjectId}`);
  }
  if (cert.expiresAt && new Date(cert.expiresAt).getTime() <= now) {
    throw new SealError('cert-expired', `the subject certificate for ${cert.subjectId} expired at ${cert.expiresAt} — a stale identity is an alarm, not a truth to act on`);
  }
  if (cert.memberKeyDigest != null) {
    if (memberPublicKey == null) {
      // the caller gave no roll to resolve the member's key from: the
      // countersignature is structurally present but UNVERIFIABLE here —
      // the auditor reports that honestly rather than passing it silently
      return { bound: true, countersignatureVerified: null };
    }
    if (!verifyMessage(certUnsignedBytes(cert), memberPublicKey, cert.memberCountersignature)) {
      throw new SealError('cert-countersignature-invalid', `the member countersignature on ${cert.subjectId}'s certificate does not verify against the roll's key for ${cert.memberKeyDigest.slice(0, 12)}… — a binding the runtime could have forged is no binding (I-1)`);
    }
    return { bound: true, countersignatureVerified: true };
  }
  return { bound: false };
}

/**
 * Build a signed subject certificate (rehearsal tooling / the identity
 * service). With `memberKeyDigest` and `memberPrivateKey`, the certificate
 * is member-bound: the Enforcer signs the body (hosting), and the Member's
 * own key countersigns the same bytes (acting) — dual authorship, neither
 * signature alone sufficient for the binding.
 */
export function signSubjectCert({ subjectId, publicKey, scope, depth = 0, parentSubjectId = null, parentCertDigest = null, privateKey, memberKeyDigest = null, memberPrivateKey = null, expiresAt = null, issuedAt = new Date().toISOString() }) {
  if ((memberKeyDigest != null) !== (memberPrivateKey != null)) {
    throw new SealError('cert-binding-malformed', 'a member binding needs BOTH the digest and the countersigning key — binding one without the other is a claim the bytes cannot carry');
  }
  const cert = {
    kind: 'subject-identity',
    subjectId,
    publicKey,
    scope,
    depth,
    ...(parentSubjectId ? { parentSubjectId } : {}),
    ...(parentCertDigest ? { parentCertDigest } : {}),
    ...(memberKeyDigest ? { memberKeyDigest } : {}),
    issuedAt,
    ...(expiresAt ? { expiresAt } : {}),
    standing: 'none — rehearsal identity under the development keyring',
    declaration: REHEARSAL_DECLARATION,
  };
  cert.signature = signMessage(certUnsignedBytes(cert), privateKey);
  if (memberPrivateKey) {
    cert.memberCountersignature = signMessage(certUnsignedBytes(cert), memberPrivateKey);
  }
  return cert;
}
