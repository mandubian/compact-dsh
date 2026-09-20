// Chain anchors — R-9's authorship limb, rehearsed under the development
// keyring (docs/decision-rehearsal-identity.md).
//
// The chain itself stays hash-based (I-2's tamper-EVIDENCE, unchanged:
// entryHash[i] = H(prev, seq, canonical(event))). Anchors add what hashes
// cannot carry: AUTHORSHIP. An anchor is the Enforcer's signature over
//
//   { sessionId, upToSeq, headHash, prevAnchorHash }
//
// written to a JSONL sidecar beside the chain at every flush — headHash is the
// chain's head after the flushed batch, and prevAnchorHash chains each anchor
// to its predecessor (as the canonical digest of that predecessor minus its
// signature), so anchors cannot be thinned selectively without breaking the
// chain of anchors. A genesis anchor (upToSeq −1) is written at session
// creation. The auditor recomputes the head from the log, walks the anchor
// chain, and reports "VALID under DEV keyring — conveys no standing".
//
// Inside the rehearsal domain this closes R-9's value-scoped limb
// mechanically: a value declared of record is covered by an anchor signed
// under the annex key, so ordering AND authorship are provable there. The
// label travels: it proves nothing outside.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalBytes, withoutField, sha256Hex, signMessage, verifyMessage, SealError } from 'compact-dsh-seals';
import { genesisHash } from './chain.js';

/** The canonical digest of a signed anchor — what the next anchor chains to. */
export const anchorHashOf = (anchor) => sha256Hex(canonicalBytes(withoutField(anchor, 'signature')));

/** Sign one anchor under the enforcer key declared by the annex. */
export function signAnchor({ sessionId, upToSeq, headHash, prevAnchorHash, annexDigest, keyId, privateKey, now = new Date().toISOString() }) {
  const anchor = {
    kind: 'chain-anchor',
    sessionId: String(sessionId),
    upToSeq,
    headHash,
    prevAnchorHash,
    annexDigest,
    keyId,
    signedAt: now,
    basis: 'dev-keyring',
  };
  anchor.signature = signMessage(canonicalBytes(anchor), privateKey);
  return anchor;
}

/** The genesis anchor: the chain's zeroth commitment, signed (upToSeq −1). */
export function genesisAnchor({ sessionId, annexDigest, keyId, privateKey, now }) {
  return signAnchor({ sessionId, upToSeq: -1, headHash: genesisHash(String(sessionId)), prevAnchorHash: '', annexDigest, keyId, privateKey, now });
}

export const anchorsPath = (chainDir, sessionId) => join(chainDir, `${String(sessionId)}.chain.sigs.jsonl`);

/** Append anchors to the sidecar (JSONL, append-only, owner-only). */
export function appendAnchors(chainDir, sessionId, anchors) {
  if (!anchors.length) return;
  appendFileSync(anchorsPath(chainDir, sessionId), anchors.map(a => JSON.stringify(a)).join('\n') + '\n', { mode: 0o600 });
}

/** Read the sidecar. A malformed line is fatal (D-7): anchors are evidence. */
export function readAnchors(chainDir, sessionId) {
  const path = anchorsPath(chainDir, sessionId);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch {
      throw new SealError('anchor-malformed', `record: anchor line ${i + 1} for ${sessionId} is not valid JSON — the sidecar is evidence and cannot be read past corruption`);
    }
  });
}

/**
 * Walk the anchor chain and require it to cover the session's current head.
 *
 * @param {object} p
 * @param {Array} p.anchors - parsed sidecar lines, in order
 * @param {string} p.expectedHeadHash - the chain head recomputed from the log
 * @param {number} p.expectedUpToSeq - the seq that head commits to
 * @param {string} p.enforcerKey - the annex's enforcer public key (base64 SPKI)
 * @param {string} p.expectedAnnexDigest - anchors must name THIS annex
 * @throws {SealError} anchor-chain-broken | anchor-signature-invalid | anchor-stale | anchor-malformed
 */
export function verifyAnchorChain({ sessionId, anchors, expectedHeadHash, expectedUpToSeq, enforcerKey, expectedAnnexDigest }) {
  const sid = String(sessionId);
  let prev = '';
  for (const [i, a] of anchors.entries()) {
    if (a.kind !== 'chain-anchor' || typeof a.headHash !== 'string' || !Number.isInteger(a.upToSeq) || typeof a.signature !== 'string') {
      throw new SealError('anchor-malformed', `record: anchor ${i + 1} for ${sid} does not declare its own shape`);
    }
    if (a.sessionId !== sid) {
      throw new SealError('anchor-chain-broken', `record: anchor ${i + 1} names session ${a.sessionId}, not ${sid} — an anchor over one record is not an anchor over another`);
    }
    if (a.prevAnchorHash !== prev) {
      throw new SealError('anchor-chain-broken', `record: anchor ${i + 1} for ${sid} does not chain to its predecessor — anchors were thinned, reordered, or rewritten`);
    }
    if (expectedAnnexDigest && a.annexDigest !== expectedAnnexDigest) {
      throw new SealError('anchor-chain-broken', `record: anchor ${i + 1} was signed under a different annex than the one declared`);
    }
    if (!verifyMessage(canonicalBytes(withoutField(a, 'signature')), enforcerKey, a.signature)) {
      throw new SealError('anchor-signature-invalid', `record: anchor ${i + 1} for ${sid} does not verify under the annex's enforcer key — an unknown or forged authorship claim`);
    }
    prev = anchorHashOf(a);
  }
  const last = anchors.at(-1);
  if (!last || last.upToSeq !== expectedUpToSeq || last.headHash !== expectedHeadHash) {
    throw new SealError('anchor-stale',
      `record: the anchors for ${sid} cover ${last ? `up to seq ${last.upToSeq}` : 'nothing'} but the record's head is seq ${expectedUpToSeq} — the tail was written after the last anchored flush and is not authorship-covered`);
  }
  return { ok: true, anchors: anchors.length, basis: 'dev-keyring', conveysStanding: false };
}
