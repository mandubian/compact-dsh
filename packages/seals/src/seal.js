// The keyring manifest — the law-side authority keyset — and the seal over a
// law artifact (body, amendment), verified k-of-n with DISTINCT-signer
// semantics.
//
// The reference loop is the upstream tool's (mandubian/compact, sign_dev.mjs),
// ported verbatim in its semantics, including the review-0004 finding: a
// threshold counts DISTINCT verified keyIds — one key's entry duplicated is
// refused as malformed at artifact-shape time and never counted again in the
// loop. Unknown keyIds are not counted; they are named.
//
// THE MANIFEST IS NOT SELF-CERTIFIED. Nothing signs keyring.json; its
// authenticity is the repository plus operator custody, which is why the
// runtime takes a `trustedKeyringDigest` exactly as it takes a
// `trustedDigest` for the body — a swapped manifest is refused the same way a
// swapped body is.

import { verifyMessage, signMessage, sha256Hex } from './keys.js';

/** The domain-separated message a law seal covers: this subject, this digest, nothing else. */
export const messageFor = (subject, hex) => `${subject}-sha256:${hex}`;

export class SealError extends Error {
  /**
   * @param {string} reason - a stable code the auditor and envelopes cite.
   * @param {string} message - the named refusal, human-readable.
   */
  constructor(reason, message) {
    super(message);
    this.name = 'SealError';
    this.reason = reason;
  }
}

const noDuplicateIds = (ids, what) => new Set(ids).size === ids.length
  || `duplicate key IDs in ${what} — a k-of-n threshold counts DISTINCT signers, so a repeated entry is not a signature artifact, it is an attack or a bug`;

/**
 * Parse and shape-check a keyring manifest. Accepts the upstream v1 shape
 * (all keys are authority keys; there are deliberately no roles — see the
 * decision record: no enforcer keys live in the law keyring).
 *
 * @param {string|object} json - the manifest; a STRING when `trustedDigest`
 *   is given, so the pin is computed over the file's raw bytes (a
 *   re-stringified manifest pins nothing).
 */
export function parseManifest(json, { trustedDigest = null } = {}) {
  if (typeof json !== 'string' && trustedDigest != null) {
    throw new SealError('manifest-malformed', 'trustedKeyringDigest requires the raw manifest text — a digest over a re-stringified manifest pins nothing');
  }
  const m = (() => { try { return typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { throw new SealError('manifest-malformed', `malformed keyring manifest: not valid JSON (${e.message})`); } })();
  const bad = !(m && typeof m.declaration === 'string' && m.declaration
    && m.threshold && Number.isInteger(m.threshold.k) && Number.isInteger(m.threshold.n)
    && Array.isArray(m.keys) && m.keys.length > 0
    && m.keys.every(key => key && typeof key.id === 'string' && typeof key.publicKey === 'string'));
  if (bad) {
    throw new SealError('manifest-malformed', 'malformed keyring manifest: parsed but missing required fields (declaration, threshold.k/n, keys[].id/publicKey) — refusing to proceed on an artifact that does not declare its own shape');
  }
  const dup = noDuplicateIds(m.keys.map(key => key.id), 'the manifest');
  if (dup !== true) throw new SealError('manifest-malformed', `malformed keyring manifest: ${dup}`);
  if (trustedDigest != null && trustedDigest !== sha256Hex(json)) {
    throw new SealError('manifest-digest-mismatch',
      'the installed keyring manifest does not match trustedKeyringDigest — a swapped manifest is a swapped trust basis, and the runtime refuses it exactly as it refuses a swapped body');
  }
  return m;
}

/**
 * Parse and shape-check a seal artifact (a `*-body.sig.json`-shaped file).
 */
export function parseSeal(json) {
  const s = (() => { try { return typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { throw new SealError('seal-malformed', `malformed seal: not valid JSON (${e.message})`); } })();
  const bad = !(s && typeof s.subject === 'string' && typeof s.digest?.value === 'string'
    && typeof s.message === 'string'
    && Array.isArray(s.signatures) && s.signatures.length > 0
    && s.signatures.every(sig => sig && typeof sig.keyId === 'string' && typeof sig.signature === 'string'));
  if (bad) {
    throw new SealError('seal-malformed', 'malformed seal: parsed but missing required fields (subject, digest.value, message, signatures[].keyId/signature)');
  }
  const dup = noDuplicateIds(s.signatures.map(sig => sig.keyId), 'the seal');
  if (dup !== true) throw new SealError('seal-malformed', `malformed seal: ${dup}`);
  return s;
}

/**
 * Verify a seal over a law artifact.
 *
 * @param {object} p
 * @param {Buffer|Uint8Array} p.bytes - the artifact's exact bytes
 * @param {string} p.subject - the verbatim subject the seal must name
 * @param {object} p.seal - parsed seal (parseSeal)
 * @param {object} p.manifest - parsed manifest (parseManifest)
 * @returns {{basis: string, threshold: string, distinctSigners: number, conveysStanding: false}}
 * @throws {SealError} on digest mismatch, message/subject mismatch, or sub-threshold
 */
export function verifySeal({ bytes, subject, seal, manifest }) {
  const hex = sha256Hex(bytes);
  if (hex !== seal.digest.value) {
    throw new SealError('digest-mismatch',
      `digest mismatch: the artifact is sha256 ${hex.slice(0, 16)}… but the seal covers ${seal.digest.value.slice(0, 16)}… — it changed after signing (re-seal deliberately) or was swapped; refusing on this seal`);
  }
  if (seal.subject !== subject) {
    throw new SealError('subject-mismatch', `seal names subject "${seal.subject}" but this artifact's subject is "${subject}" — a seal over one artifact is not a seal over another`);
  }
  if (seal.message !== messageFor(subject, hex)) {
    throw new SealError('message-mismatch', `seal message "${seal.message}" does not match its own subject/digest — malformed artifact`);
  }
  // k-of-n means k DISTINCT signers: counted per VERIFIED keyId, never per
  // entry (the reference semantics from the upstream review — kept in this
  // loop because this is the code runtimes copy).
  const counted = new Set();
  const unknown = [];
  const invalid = [];
  for (const entry of seal.signatures) {
    const key = manifest.keys.find(k => k.id === entry.keyId);
    if (!key) { unknown.push(entry.keyId); continue; }
    if (counted.has(entry.keyId)) continue; // shape check already refused duplicates; never count a key twice
    if (verifyMessage(Buffer.from(seal.message, 'utf8'), key.publicKey, entry.signature)) counted.add(entry.keyId);
    else invalid.push(entry.keyId);
  }
  const { k, n } = manifest.threshold;
  if (counted.size < k) {
    throw new SealError('sub-threshold',
      `threshold not met: ${counted.size} distinct valid signer(s), need ${k}-of-${n}` +
      (invalid.length ? ` — ${invalid.length} invalid signature(s) not counted` : '') +
      (unknown.length ? ` — ${unknown.length} signature(s) under keyIds absent from the manifest, not counted` : '') +
      ' — verification FAILS');
  }
  return {
    basis: 'dev-keyring',
    threshold: `${k}-of-${n}`,
    distinctSigners: counted.size,
    conveysStanding: false,
  };
}

/**
 * Produce a seal over an artifact's bytes (rehearsal tooling; requires the
 * private keys). `source` is the verbatim relative path; `subject` the seal
 * subject (compact.md keeps its historical `compact-body`).
 */
export function signSeal({ bytes, subject, source, manifest, privateKeys, signedAt = new Date().toISOString() }) {
  const hex = sha256Hex(bytes);
  const message = messageFor(subject, hex);
  const signatures = [];
  for (const key of manifest.keys) {
    const sk = privateKeys.get(key.id);
    if (!sk) continue;
    signatures.push({ keyId: key.id, signature: signMessage(Buffer.from(message, 'utf8'), sk) });
  }
  if (signatures.length < manifest.threshold.k) {
    throw new SealError('sub-threshold', `only ${signatures.length} key(s) available — below threshold k=${manifest.threshold.k}; a sub-threshold seal is a broken artifact and is not emitted`);
  }
  return {
    kind: 'dev-keyring-signature',
    declaration: 'mechanism testing only — NOT ratification, NOT standing, NOT the A-1 trust root (see the keyring manifest)',
    subject,
    source,
    digest: { algorithm: 'sha256', value: hex },
    message,
    keyring: 'installed keyring manifest (dev-keyring: practice keys)',
    signatures,
    signedAt,
  };
}
