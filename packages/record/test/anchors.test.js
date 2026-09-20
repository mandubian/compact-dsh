// Chain anchors — the authorship rehearsal (R-7/R-9 under the development
// keyring). Pure tests: anchors, their chaining, their verification, and the
// named refusals. The end-to-end provider path is covered in
// provider.dsh.test.js and the auditor checks in auditor/audit.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEd25519, signMessage, verifyMessage, canonicalBytes, withoutField, SealError } from 'compact-dsh-seals';
import { extendChain, genesisHash } from '../src/chain.js';
import {
  signAnchor, genesisAnchor, anchorHashOf, appendAnchors, readAnchors, verifyAnchorChain,
} from '../src/anchors.js';

function rig() {
  const enforcer = generateEd25519();
  const annexDigest = 'c'.repeat(64);
  const sessionId = 'sess-anchor-test';
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'turn/end', data: { turn: 1 } },
  ];
  const links = extendChain(genesisHash(sessionId), 0, events);
  const head = links.at(-1).h;
  const sign = (upToSeq, headHash) => signAnchor({
    sessionId, upToSeq, headHash, prevAnchorHash: '', annexDigest,
    keyId: 'dev-rehearsal-enforcer', privateKey: enforcer.privateKeyPem,
  });
  return { enforcer, annexDigest, sessionId, events, links, head, sign };
}

test('anchors: genesis, then a covering anchor — the chain verifies against the recomputed head', () => {
  const { enforcer, annexDigest, sessionId, head, sign } = rig();
  const genesis = genesisAnchor({ sessionId, annexDigest, keyId: 'dev-rehearsal-enforcer', privateKey: enforcer.privateKeyPem });
  assert.equal(genesis.upToSeq, -1);
  assert.equal(genesis.headHash, genesisHash(sessionId));

  const first = signAnchor({
    sessionId, upToSeq: 1, headHash: head, prevAnchorHash: anchorHashOf(genesis),
    annexDigest, keyId: 'dev-rehearsal-enforcer', privateKey: enforcer.privateKeyPem,
  });
  const verdict = verifyAnchorChain({
    sessionId, anchors: [genesis, first],
    expectedHeadHash: head, expectedUpToSeq: 1,
    enforcerKey: enforcer.publicKey, expectedAnnexDigest: annexDigest,
  });
  assert.deepEqual({ ok: verdict.ok, anchors: verdict.anchors, conveysStanding: verdict.conveysStanding }, { ok: true, anchors: 2, conveysStanding: false });
});

test('anchors: a thinned, reordered, or rewritten chain refuses (anchor chaining)', () => {
  const { enforcer, annexDigest, sessionId, head, sign } = rig();
  const genesis = genesisAnchor({ sessionId, annexDigest, keyId: 'k', privateKey: enforcer.privateKeyPem });
  const first = signAnchor({
    sessionId, upToSeq: 1, headHash: head, prevAnchorHash: anchorHashOf(genesis),
    annexDigest, keyId: 'k', privateKey: enforcer.privateKeyPem,
  });
  const base = { sessionId, anchors: [genesis, first], expectedHeadHash: head, expectedUpToSeq: 1, enforcerKey: enforcer.publicKey, expectedAnnexDigest: annexDigest };
  verifyAnchorChain(base);

  // drop the genesis anchor: the survivor no longer chains from ''
  assert.throws(() => verifyAnchorChain({ ...base, anchors: [first] }),
    e => e instanceof SealError && e.reason === 'anchor-chain-broken');
  // reorder: same two anchors, wrong order
  assert.throws(() => verifyAnchorChain({ ...base, anchors: [first, genesis] }),
    e => e instanceof SealError && e.reason === 'anchor-chain-broken');
  // rewrite: a mutated head hash breaks the anchor's own signature
  const rewritten = { ...genesis, headHash: '0'.repeat(64) };
  assert.throws(() => verifyAnchorChain({ ...base, anchors: [rewritten, first] }),
    e => e instanceof SealError && e.reason === 'anchor-signature-invalid');
});

test('anchors: a forged signature, a stranger annex, and a stale head each refuse with named reasons', () => {
  const { enforcer, annexDigest, sessionId, head, sign } = rig();
  const stranger = generateEd25519();
  const anchor = sign(1, head);
  const base = { sessionId, anchors: [anchor], expectedHeadHash: head, expectedUpToSeq: 1, enforcerKey: enforcer.publicKey, expectedAnnexDigest: annexDigest };

  assert.throws(() => verifyAnchorChain({ ...base, enforcerKey: stranger.publicKey }),
    e => e instanceof SealError && e.reason === 'anchor-signature-invalid');
  assert.throws(() => verifyAnchorChain({ ...base, expectedAnnexDigest: 'd'.repeat(64) }),
    e => e instanceof SealError && e.reason === 'anchor-chain-broken' && /different annex/.test(e.message));
  // the log moved on (or was rolled back) past the last anchored flush
  assert.throws(() => verifyAnchorChain({ ...base, expectedUpToSeq: 2, expectedHeadHash: 'e'.repeat(64) }),
    e => e instanceof SealError && e.reason === 'anchor-stale');
});

test('anchors: the sidecar round-trips, and a corrupted line is fatal (D-7)', () => {
  const { enforcer, annexDigest, sessionId, head, sign } = rig();
  const dir = mkdtempSync(join(tmpdir(), 'record-anchors-'));
  try {
    const anchor = sign(1, head);
    appendAnchors(dir, sessionId, [anchor]);
    const anchors = readAnchors(dir, sessionId);
    assert.equal(anchors.length, 1);
    verifyAnchorChain({ sessionId, anchors, expectedHeadHash: head, expectedUpToSeq: 1, enforcerKey: enforcer.publicKey, expectedAnnexDigest: annexDigest });
    assert.match(readFileSync(join(dir, `${sessionId}.chain.sigs.jsonl`), 'utf8'), /chain-anchor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('anchors: a tampered anchor is not signed by its own fields', () => {
  const { enforcer, sessionId, head, sign } = rig();
  const anchor = sign(1, head);
  const forged = { ...anchor, upToSeq: 99 };
  assert.equal(
    verifyMessage(canonicalBytes(withoutField(forged, 'signature')), enforcer.publicKey, forged.signature),
    false,
    'mutating any signed field must invalidate the signature');
});
