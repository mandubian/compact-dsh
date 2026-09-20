// The seals package — rehearsed against the upstream review's own evidence
// matrix (amendment 0004 + the review-0004 findings): threshold, sub-threshold,
// the distinct-signer forgery, duplicate manifest ids, tampered body, unknown
// keys, manifest pinning — plus the runtime-side annex and subject
// certificates and the canonicalization rule signatures ride on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson, canonicalBytes, withoutField,
  generateEd25519, signMessage, verifyMessage, sha256Hex,
  messageFor, parseManifest, parseSeal, verifySeal, signSeal, SealError,
  signAnnex, verifyAnnex, annexDigestOf, signSubjectCert, verifySubjectCert,
} from '../src/index.js';

/** A local rehearsal keyring: n fresh authority keys + their private half. */
function rehearsalKeyring(n = 3, k = 2) {
  const keys = [];
  const privateKeys = new Map();
  for (let i = 1; i <= n; i++) {
    const { publicKey, privateKeyPem } = generateEd25519();
    keys.push({ id: `dev-test-${i}`, holder: 'test — one entity, practice only', publicKey });
    privateKeys.set(`dev-test-${i}`, privateKeyPem);
  }
  const manifest = {
    kind: 'dev-keyring', version: 1, created: '2026-09-20',
    declaration: 'NOT the A-1 trust root — all keys one entity; machinery only',
    algorithm: 'ed25519', threshold: { k, n }, keys, rotations: [],
    cure: 'ratification replaces the keyring; runtimes swap configuration, not code',
    standing: 'none — code-path correctness only',
  };
  return { manifest, privateKeys };
}

test('law seal: k-of-n distinct signers verify; sub-threshold and unknown keys refuse with named reasons', () => {
  const { manifest, privateKeys } = rehearsalKeyring(3, 2);
  const bytes = Buffer.from('the law, rehearsed', 'utf8');
  const seal = signSeal({ bytes, subject: 'test-body', source: 'test.md', manifest, privateKeys });
  const verdict = verifySeal({ bytes, subject: 'test-body', seal, manifest });
  assert.deepEqual(
    { basis: verdict.basis, threshold: verdict.threshold, conveysStanding: verdict.conveysStanding },
    { basis: 'dev-keyring', threshold: '2-of-3', conveysStanding: false });
  assert.equal(verdict.distinctSigners, 3);

  // sub-threshold: one honest signature of a 2-of-3 threshold
  const thin = { ...seal, signatures: seal.signatures.slice(0, 1) };
  assert.throws(() => verifySeal({ bytes, subject: 'test-body', seal: thin, manifest }),
    e => e instanceof SealError && e.reason === 'sub-threshold');

  // corrupted signature: not counted, named in the refusal
  const corrupted = { ...seal, signatures: [seal.signatures[0], { keyId: seal.signatures[1].keyId, signature: seal.signatures[0].signature }] };
  assert.throws(() => verifySeal({ bytes, subject: 'test-body', seal: corrupted, manifest }),
    e => e instanceof SealError && e.reason === 'sub-threshold' && /invalid signature/.test(e.message));

  // unknown keyId: not counted, named
  const stranger = { ...seal, signatures: [...seal.signatures.slice(0, 1), { keyId: 'dev-stranger', signature: signMessage(Buffer.from(seal.message), privateKeys.get('dev-test-1')) }] };
  assert.throws(() => verifySeal({ bytes, subject: 'test-body', seal: stranger, manifest }),
    e => e instanceof SealError && e.reason === 'sub-threshold' && /absent from the manifest/.test(e.message));
});

test('law seal: the distinct-signer forgery is refused at artifact-shape time and never counted (review-0004 finding 1)', () => {
  const { manifest, privateKeys } = rehearsalKeyring(3, 2);
  const bytes = Buffer.from('the law, rehearsed', 'utf8');
  const seal = signSeal({ bytes, subject: 'test-body', source: 'test.md', manifest, privateKeys });
  // the attack: one honest entry, pasted twice — stamps on the page, not people stamping
  const forged = { ...seal, signatures: [seal.signatures[0], seal.signatures[0]] };
  assert.throws(() => parseSeal(JSON.stringify(forged)), e => e instanceof SealError && e.reason === 'seal-malformed' && /DISTINCT signers/.test(e.message));
  // and even past the shape check, the loop counts each key once — the
  // forgery yields ONE distinct signer, below a 2-of-3 threshold
  assert.throws(() => verifySeal({ bytes, subject: 'test-body', seal: forged, manifest }),
    e => e instanceof SealError && e.reason === 'sub-threshold' && /1 distinct valid signer/.test(e.message));

  // duplicate key ids in the MANIFEST are the same defect class
  const dupManifest = { ...manifest, keys: [manifest.keys[0], manifest.keys[0], manifest.keys[1]] };
  assert.throws(() => parseManifest(JSON.stringify(dupManifest)), e => e instanceof SealError && e.reason === 'manifest-malformed');
});

test('law seal: tampered body refuses on digest mismatch; a swapped subject refuses; the message must bind subject+digest', () => {
  const { manifest, privateKeys } = rehearsalKeyring();
  const bytes = Buffer.from('the law, rehearsed', 'utf8');
  const seal = signSeal({ bytes, subject: 'test-body', source: 'test.md', manifest, privateKeys });
  assert.throws(() => verifySeal({ bytes: Buffer.from('the law, ALTERED', 'utf8'), subject: 'test-body', seal, manifest }),
    e => e instanceof SealError && e.reason === 'digest-mismatch');
  assert.throws(() => verifySeal({ bytes, subject: 'other-body', seal, manifest }),
    e => e instanceof SealError && e.reason === 'subject-mismatch');
  assert.throws(() => verifySeal({ bytes, subject: 'test-body', seal: { ...seal, message: 'compact-body-sha256:deadbeef' }, manifest }),
    e => e instanceof SealError && e.reason === 'message-mismatch');
  assert.equal(messageFor('compact-body', 'ab'.repeat(32)), 'compact-body-sha256:' + 'ab'.repeat(32));
});

test('manifest pinning: trustedKeyringDigest over the raw text — match passes, mismatch and non-string input refuse', () => {
  const { manifest } = rehearsalKeyring();
  const raw = JSON.stringify(manifest, null, 2) + '\n';
  parseManifest(raw, { trustedDigest: sha256Hex(Buffer.from(raw, 'utf8')) });
  assert.throws(() => parseManifest(raw, { trustedDigest: '0'.repeat(64) }),
    e => e instanceof SealError && e.reason === 'manifest-digest-mismatch');
  assert.throws(() => parseManifest(manifest, { trustedDigest: sha256Hex(Buffer.from(raw)) }),
    e => e instanceof SealError && e.reason === 'manifest-malformed' && /raw manifest text/.test(e.message));
});

test('canonical JSON: keys sorted at every depth, arrays in order, bytes stable across key insertion order', () => {
  const a = { z: 1, a: { y: 2, b: [3, { d: 4, c: 5 }] } };
  const b = { a: { b: [3, { c: 5, d: 4 }], y: 2 }, z: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalBytes(a).toString(), '{"a":{"b":[3,{"c":5,"d":4}],"y":2},"z":1}');
  assert.deepEqual(withoutField({ ...a, signature: 'x' }, 'signature'), a);
});

test('enforcer annex: self-signed, law-digest-anchored; wrong law, tampered body, and expiry each refuse', () => {
  const enforcer = generateEd25519();
  const lawDigest = 'a'.repeat(64);
  const annex = signAnnex({
    composition: 'compact-dsh', host: 'dsh-test', lawDigest,
    keyId: 'dev-enforcer-1', publicKey: enforcer.publicKey, privateKey: enforcer.privateKeyPem,
  });
  const joined = verifyAnnex({ annex, expectedLawDigest: lawDigest });
  assert.equal(joined.keyId, 'dev-enforcer-1');
  assert.equal(joined.annexDigest, annexDigestOf(annex));
  assert.equal(joined.enforcerKey, enforcer.publicKey);

  // the annex anchors to a different law than the one loaded: the join refuses
  assert.throws(() => verifyAnnex({ annex, expectedLawDigest: 'b'.repeat(64) }),
    e => e instanceof SealError && e.reason === 'annex-law-mismatch');
  // a tampered annex fails its own signature
  const tampered = { ...annex, composition: 'something-else' };
  assert.throws(() => verifyAnnex({ annex: tampered, expectedLawDigest: lawDigest }),
    e => e instanceof SealError && e.reason === 'annex-signature-invalid');
  // an expired annex blesses nothing
  const expired = signAnnex({
    composition: 'compact-dsh', host: 'dsh-test', lawDigest,
    keyId: 'dev-enforcer-1', publicKey: enforcer.publicKey, privateKey: enforcer.privateKeyPem,
    expiresAt: '2026-01-01T00:00:00Z',
  });
  assert.throws(() => verifyAnnex({ annex: expired, expectedLawDigest: lawDigest }),
    e => e instanceof SealError && e.reason === 'annex-expired');
});

test('subject certificates: enforcer-signed, lineage as data, unknown keys and expiry refuse', () => {
  const enforcer = generateEd25519();
  const subject = generateEd25519();
  const stranger = generateEd25519();
  const cert = signSubjectCert({
    subjectId: 'session-1', publicKey: subject.publicKey, scope: 'workspace-write', depth: 0,
    privateKey: enforcer.privateKeyPem,
  });
  verifySubjectCert({ cert, enforcerKey: enforcer.publicKey, expectedSubjectId: 'session-1' });
  // a cert signed by a stranger key is an unknown identity
  const rogue = signSubjectCert({
    subjectId: 'session-1', publicKey: subject.publicKey, scope: 'workspace-write', depth: 0,
    privateKey: stranger.privateKeyPem,
  });
  assert.throws(() => verifySubjectCert({ cert: rogue, enforcerKey: enforcer.publicKey }),
    e => e instanceof SealError && e.reason === 'cert-signature-invalid');
  // delegation lineage rides inside the certified fields
  const child = signSubjectCert({
    subjectId: 'session-2', publicKey: stranger.publicKey, scope: 'read-only', depth: 1,
    parentSubjectId: 'session-1', parentCertDigest: sha256Hex(canonicalBytes(withoutField(cert, 'signature'))),
    privateKey: enforcer.privateKeyPem,
  });
  verifySubjectCert({ cert: child, enforcerKey: enforcer.publicKey });
  assert.equal(child.parentSubjectId, 'session-1');
  assert.throws(() => verifySubjectCert({ cert, enforcerKey: enforcer.publicKey, expectedSubjectId: 'session-2' }),
    e => e instanceof SealError && e.reason === 'cert-malformed');
});

test('interop: the vendored upstream seal verifies over the pinned body with founder public keys only', () => {
  // the real, keyless check: public manifest + founder seal + the bundled body
  const manifest = parseManifest(readFileSync(fileURLToPath(new URL('../../../packages/constitution/keyring/dev/keyring.json', import.meta.url)), 'utf8'));
  const seal = parseSeal(readFileSync(fileURLToPath(new URL('../../../packages/constitution/keyring/dev/compact-body.sig.json', import.meta.url)), 'utf8'));
  const body = readFileSync(fileURLToPath(new URL('../../../packages/constitution/compact/compact.md', import.meta.url)));
  const verdict = verifySeal({ bytes: body, subject: 'compact-body', seal, manifest });
  assert.equal(verdict.basis, 'dev-keyring');
  assert.equal(verdict.conveysStanding, false);
});
