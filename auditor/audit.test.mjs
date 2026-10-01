// The auditor's rehearsal domain (I-7): law seal, enforcer annex, and chain
// anchors — verified offline, each verdict carrying the fixed practice label.
// The conformance and integrity checks live in tools/register.test.mjs; this
// file is the signature half the register's rehearsal entries cite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEd25519, signSeal, signAnnex, annexDigestOf, signSubjectCert, canonicalBytes, withoutField, sha256Hex, memberKeyDigestOf, signRollEvent, appendRollEvent, closeEpoch, parseManifest } from '../packages/seals/src/index.js';
import { extendChain, genesisHash, signAnchor, genesisAnchor, anchorHashOf } from '../packages/record/src/index.js';
import { COMPACT_BODY, COMPACT_DIGEST } from '../packages/constitution/src/body.js';
import { audit } from './audit.mjs';

const LOG = [
  { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
  { seq: 1, type: 'approval/asked', time: 2, data: { id: 'a1', toolName: 'bash', reason: '[AG/fp] not covered' } },
  { seq: 2, type: 'approval/decided', time: 3, data: { id: 'a1', outcome: 'allowed-once' } },
  { seq: 3, type: 'command/run', time: 4, data: { commandId: 'c1', name: 'bash' } },
  { seq: 4, type: 'command/done', time: 5, data: { commandId: 'c1', kind: 'success' } },
  { seq: 5, type: 'turn/end', time: 6, data: { turn: 1 } },
];

function rehearsalDir() {
  const dir = mkdtempSync(join(tmpdir(), 'audit-seals-'));
  const authority = [];
  const privates = new Map();
  for (let i = 1; i <= 3; i++) {
    const k = generateEd25519();
    authority.push({ id: `dev-test-${i}`, holder: 'test', publicKey: k.publicKey });
    privates.set(`dev-test-${i}`, k.privateKeyPem);
  }
  const manifest = {
    kind: 'dev-keyring', version: 1, created: '2026-09-20', declaration: 'test — machinery only',
    algorithm: 'ed25519', threshold: { k: 2, n: 3 }, keys: authority, rotations: [],
    cure: 'ratification', standing: 'none',
  };
  const manifestPath = join(dir, 'keyring.json');
  const sealPath = join(dir, 'compact-body.sig.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(sealPath, JSON.stringify(signSeal({
    bytes: Buffer.from(COMPACT_BODY, 'utf8'), subject: 'compact-body', source: 'compact.md',
    manifest, privateKeys: privates,
  })));
  const enforcer = generateEd25519();
  const annex = signAnnex({
    composition: 'compact-dsh', host: 'test', lawDigest: COMPACT_DIGEST,
    keyId: 'dev-test-enforcer', publicKey: enforcer.publicKey, privateKey: enforcer.privateKeyPem,
  });
  const annexPath = join(dir, 'enforcer.annex.json');
  writeFileSync(annexPath, JSON.stringify(annex));

  const sessionId = 'sess-audit';
  const events = LOG;
  const links = extendChain(genesisHash(sessionId), 0, events);
  const annexDigest = annexDigestOf(annex);
  const genesis = genesisAnchor({ sessionId, annexDigest, keyId: 'dev-test-enforcer', privateKey: enforcer.privateKeyPem });
  const head = links.at(-1).h;
  const anchor = signAnchor({
    sessionId, upToSeq: events.length - 1, headHash: head, prevAnchorHash: anchorHashOf(genesis),
    annexDigest, keyId: 'dev-test-enforcer', privateKey: enforcer.privateKeyPem,
  });
  const anchorsPath = join(dir, `${sessionId}.chain.sigs.jsonl`);
  writeFileSync(anchorsPath, [genesis, anchor].map(a => JSON.stringify(a)).join('\n') + '\n');
  const logPath = join(dir, `${sessionId}.jsonl`);
  writeFileSync(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { dir, manifestPath, sealPath, annexPath, anchorsPath, logPath, enforcer, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** One ledger line, shaped exactly as the runtime appends it (#20). */
function ledgerLine(cert) {
  const certDigest = sha256Hex(canonicalBytes(withoutField(cert, 'signature')));
  return {
    kind: 'subject-certificate',
    subjectId: cert.subjectId,
    certDigest,
    issuedAt: cert.issuedAt,
    ...(cert.parentSubjectId ? { parentSubjectId: cert.parentSubjectId } : {}),
    ...(cert.parentCertDigest ? { parentCertDigest: cert.parentCertDigest } : {}),
    cert,
  };
}

/** Sign one subject certificate under the fixture's enforcer key. */
function subjectCert(enforcer, over = {}) {
  const key = generateEd25519();
  return signSubjectCert({
    subjectId: 'subject', publicKey: key.publicKey, scope: 'rehearsal', depth: 0,
    privateKey: enforcer.privateKeyPem, ...over,
  });
}

/** Write `lines` to `<dir>/subjects.jsonl` and return its path. */
function writeIdentityLedger(f, lines) {
  const identitiesPath = join(f.dir, 'subjects.jsonl');
  writeFileSync(identitiesPath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return identitiesPath;
}

/** The happy shape: a root, its child, and a grandchild, each bound upward. */
function chainedLedger(enforcer) {
  const root = subjectCert(enforcer, { subjectId: 'root-1' });
  const rootDigest = sha256Hex(canonicalBytes(withoutField(root, 'signature')));
  const child = subjectCert(enforcer, { subjectId: 'child-1', depth: 1, parentSubjectId: 'root-1', parentCertDigest: rootDigest });
  const childDigest = sha256Hex(canonicalBytes(withoutField(child, 'signature')));
  const grand = subjectCert(enforcer, { subjectId: 'grand-1', depth: 2, parentSubjectId: 'child-1', parentCertDigest: childDigest });
  return [root, child, grand].map(c => ledgerLine(c));
}

test('the auditor reports the law seal, annex, and anchors as VALID under DEV keyring — conveys no standing', async () => {
  const f = await rehearsalDir();
  try {
    const att = audit(LOG, undefined, 0, {
      annexFile: f.annexPath, anchorsFile: f.anchorsPath,
      keyringFile: f.manifestPath, sealFile: f.sealPath, bodyFile: new URL('../packages/constitution/compact/compact.md', import.meta.url).pathname,
    });
    assert.equal(att.verdict, 'conforming', JSON.stringify(att.findings));
    assert.equal(att.checked.annex, 'verified');
    assert.equal(att.checked.anchors, 'verified');
    assert.equal(att.checked.bodySeal, 'verified');
    assert.equal(att.lawSeal.conveysStanding, false);
    assert.equal(att.lawSeal.threshold, '2-of-3');
    assert.equal(att.authorship.phrase, 'VALID under DEV keyring — conveys no standing');
    assert.ok(att.reliesOn.some(r => r.includes('VALID under DEV keyring — conveys no standing')));
    assert.ok(att.enforcer.keyId.startsWith('dev-'), 'the rehearsal key ids travel with the verdict');
  } finally {
    f.cleanup();
  }
});

test('a broken declared seal is an ERROR finding, not a warning (D-7)', async () => {
  const f = await rehearsalDir();
  try {
    // swap the enforcer annex for one over a different law
    const stranger = generateEd25519();
    const wrongLaw = signAnnex({
      composition: 'compact-dsh', host: 'test', lawDigest: 'b'.repeat(64),
      keyId: 'dev-test-enforcer', publicKey: stranger.publicKey, privateKey: stranger.privateKeyPem,
    });
    const annexPath = join(f.dir, 'wrong.annex.json');
    writeFileSync(annexPath, JSON.stringify(wrongLaw));
    const att = audit(LOG, undefined, 0, { annexFile: annexPath, anchorsFile: f.anchorsPath });
    assert.equal(att.verdict, 'violations');
    const finding = att.findings.find(f2 => f2.rule === 'I-1');
    assert.ok(finding, 'the refusal is named');
    assert.match(finding.detail, /annex/);
    assert.equal(att.checked.anchors, 'BROKEN', 'anchors without a verified annex cannot verify');
  } finally {
    f.cleanup();
  }
});

test('absent signature inputs are `not checked` and imply nothing', () => {
  const att = audit(LOG, undefined, 0, {});
  assert.equal(att.checked.annex, 'not checked');
  assert.equal(att.checked.anchors, 'not checked');
  assert.equal(att.checked.bodySeal, 'not checked');
  assert.equal(att.checked.identities, 'not checked');
  assert.equal(att.enforcer, undefined);
  assert.equal(att.authorship, undefined);
  assert.equal(att.identityChain, undefined);
  assert.equal(att.verdict, 'conforming');
});

// -- the certified delegation lineage (#20) ----------------------------------
//
// The auditor verifies the identity chain OFFLINE: every certificate under
// the annex key, every declared digest re-derived from its artifact, every
// child bound to a parent that is present at exactly one depth less. Unknown
// keys and expiry refuse by name; an honestly incomplete link is a warning;
// an unreadable ledger is an error, never a skip.

test('the certified lineage verifies offline: roots, chained children, and the fixed practice label (#20)', async () => {
  const f = await rehearsalDir();
  try {
    const identitiesFile = writeIdentityLedger(f, chainedLedger(f.enforcer));
    const att = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile });
    assert.equal(att.verdict, 'conforming', JSON.stringify(att.findings));
    assert.equal(att.checked.identities, 'verified');
    assert.deepEqual(
      { certificates: att.identityChain.certificates, roots: att.identityChain.roots,
        chained: att.identityChain.chained, incomplete: att.identityChain.incomplete },
      { certificates: 3, roots: 1, chained: 2, incomplete: 0 });
    assert.equal(att.identityChain.phrase, 'VALID under DEV keyring — conveys no standing');
    assert.equal(att.identityChain.conveysStanding, false);
    assert.ok(att.reliesOn.some(r => /3 subject certificate\(s\).*VALID under DEV keyring — conveys no standing \(I-1\/MA-1 rehearsal\)/.test(r)),
      'the verdict states its basis: which key, how many links, how many gaps');
  } finally {
    f.cleanup();
  }
});

test('a certificate the annex key never signed is an unknown identity — refused by name (#20)', async () => {
  const f = await rehearsalDir();
  try {
    const stranger = generateEd25519();
    const rogue = signSubjectCert({
      subjectId: 'intruder', publicKey: generateEd25519().publicKey, scope: 'rehearsal', depth: 0,
      privateKey: stranger.privateKeyPem,
    });
    const identitiesFile = writeIdentityLedger(f, [ledgerLine(rogue)]);
    const att = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile });
    assert.equal(att.verdict, 'violations');
    assert.equal(att.checked.identities, 'BROKEN');
    const finding = att.findings.find(x => x.type === 'identities');
    assert.match(finding.detail, /does not verify under the annex's enforcer key/);
    assert.equal(finding.severity, 'error');
    assert.equal(finding.rule, 'I-1');
  } finally {
    f.cleanup();
  }
});

test('an expired subject certificate is an alarm at the auditor too (#20)', async () => {
  const f = await rehearsalDir();
  try {
    const stale = subjectCert(f.enforcer, { subjectId: 'stale-1', expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const identitiesFile = writeIdentityLedger(f, [ledgerLine(stale)]);
    const att = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile });
    assert.equal(att.verdict, 'violations');
    const finding = att.findings.find(x => x.type === 'identities');
    assert.match(finding.detail, /expired at/);
    assert.equal(finding.rule, 'I-1');
  } finally {
    f.cleanup();
  }
});

test('a child binding a parent certificate that is not in the ledger breaks the chain — named, not glossed (#20)', async () => {
  const f = await rehearsalDir();
  try {
    const orphan = subjectCert(f.enforcer, {
      subjectId: 'child-1', depth: 1, parentSubjectId: 'root-1', parentCertDigest: 'f'.repeat(64),
    });
    const identitiesFile = writeIdentityLedger(f, [ledgerLine(orphan)]);
    const att = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile });
    assert.equal(att.verdict, 'violations');
    const finding = att.findings.find(x => x.rule === 'MA-1');
    assert.match(finding.detail, /broken certified lineage/);
    assert.match(finding.detail, /not in this ledger/);
  } finally {
    f.cleanup();
  }
});

test('a depth that does not follow its parent is a different lineage than the one certified (#20)', async () => {
  const f = await rehearsalDir();
  try {
    const root = subjectCert(f.enforcer, { subjectId: 'root-1' });
    const rootDigest = sha256Hex(canonicalBytes(withoutField(root, 'signature')));
    // same parent binding, wrong depth: the cert says root-child, the data says siblings
    const lying = subjectCert(f.enforcer, { subjectId: 'child-1', depth: 0, parentSubjectId: 'root-1', parentCertDigest: rootDigest });
    const identitiesFile = writeIdentityLedger(f, [ledgerLine(root), ledgerLine(lying)]);
    const att = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile });
    assert.equal(att.verdict, 'violations');
    const finding = att.findings.find(x => x.rule === 'MA-1');
    assert.match(finding.detail, /declares depth 0 under a parent certified at depth 0/);
  } finally {
    f.cleanup();
  }
});

test('a link bound without a digest is a declared warning — incomplete, not broken (#20)', async () => {
  const f = await rehearsalDir();
  try {
    const unbound = subjectCert(f.enforcer, { subjectId: 'child-1', depth: 1, parentSubjectId: 'gone-parent' });
    const identitiesFile = writeIdentityLedger(f, [ledgerLine(unbound)]);
    const att = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile });
    assert.equal(att.verdict, 'conforming', 'a gap the runtime declared is not a violation — a false verification would be');
    assert.equal(att.checked.identities, 'verified');
    assert.equal(att.identityChain.incomplete, 1);
    const finding = att.findings.find(x => x.type === 'identities');
    assert.equal(finding.severity, 'warning');
    assert.equal(finding.rule, 'MA-1');
    assert.match(finding.detail, /binds no parent digest/);
  } finally {
    f.cleanup();
  }
});

test('identity verification without a verified annex refuses — checked against a key, never against nothing (#20)', async () => {
  const f = await rehearsalDir();
  try {
    const identitiesFile = writeIdentityLedger(f, chainedLedger(f.enforcer));
    const att = audit(LOG, undefined, 0, { identitiesFile });
    assert.equal(att.verdict, 'violations');
    assert.equal(att.checked.identities, 'BROKEN');
    assert.match(att.findings.find(x => x.type === 'identities').detail, /requires a verified enforcer annex/);
    assert.equal(att.identityChain, undefined, 'no verdict is reported for a check that could not run');
  } finally {
    f.cleanup();
  }
});

test('an unreadable identity ledger is an ERROR, never a skipped check (#20)', async () => {
  const f = await rehearsalDir();
  try {
    const identitiesPath = join(f.dir, 'subjects.jsonl');
    writeFileSync(identitiesPath, 'not json at all\n');
    const att = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile: identitiesPath });
    assert.equal(att.verdict, 'violations');
    const finding = att.findings.find(x => x.type === 'identities');
    assert.match(finding.detail, /is not JSON/);
    assert.match(finding.detail, /refused, not skipped/);
  } finally {
    f.cleanup();
  }
});

// ── the member-binding join (identity slice 2, #125): --identities × --roll ──

/** A roll domain: one member ('test-member'), optionally rotated or revoked. */
function rollDomain(dir, { rotate = false, revoke = false, name = 'roll' } = {}) {
  const auth = [1, 2, 3].map((i) => { const kp = generateEd25519(); return { id: `auth-${i}`, publicKey: kp.publicKey, privateKeyPem: kp.privateKeyPem }; });
  const manifestText = JSON.stringify({ kind: 'dev-keyring', declaration: 'test keyring', threshold: { k: 2, n: 3 }, keys: auth.map(({ id, publicKey }) => ({ id, publicKey })), rotations: [] }, null, 2);
  const manifest = parseManifest(manifestText);
  const keyringPath = join(dir, `${name}.keyring.json`);
  writeFileSync(keyringPath, manifestText);
  const privates = new Map(auth.map(({ id, privateKeyPem }) => [id, privateKeyPem]));
  const quorum = (n = 2) => auth.slice(0, n).map(({ id, privateKeyPem }) => ({ keyId: id, privateKey: privateKeyPem }));
  const k1 = generateEd25519();
  const k1Digest = memberKeyDigestOf(k1.publicKey);
  let current = { kp: k1, digest: k1Digest };
  const roll = { kind: 'test-roll', version: 1, genesis: { epochLength: { events: 64 }, admissionStatute: { digest: 'a'.repeat(64) } }, entries: [], checkpoints: [] };
  const NOW2 = '2026-10-01T00:00:00.000Z';
  const adm = { kind: 'admission', memberKeyDigest: k1Digest, class: 'principal', memberKey: k1.publicKey, member: 'test-member', holder: 'the principal under test', grounds: 'test', recordedAt: NOW2 };
  appendRollEvent(roll, { ...adm, signedBy: signRollEvent(adm, [...quorum(2), { keyId: k1Digest, privateKey: k1.privateKeyPem }]) });
  if (rotate) {
    const k2 = generateEd25519();
    const k2Digest = memberKeyDigestOf(k2.publicKey);
    const rot = { kind: 'rotation', memberKeyDigest: k2Digest, class: 'principal', predecessorKeyDigest: k1Digest, successorKey: k2.publicKey, grounds: 'drill', recordedAt: NOW2 };
    appendRollEvent(roll, { ...rot, signedBy: signRollEvent(rot, [{ keyId: k1Digest, privateKey: k1.privateKeyPem }]) });
    current = { kp: k2, digest: k2Digest };
  }
  if (revoke) {
    const rev = { kind: 'revocation', memberKeyDigest: current.digest, grounds: 'compromise drill', recordedAt: NOW2 };
    appendRollEvent(roll, { ...rev, signedBy: signRollEvent(rev, quorum(2)) });
  }
  closeEpoch({ roll, epoch: 0, manifest, privateKeys: privates, now: NOW2 });
  const rollPath = join(dir, `${name}.roll.json`);
  writeFileSync(rollPath, JSON.stringify(roll, null, 2) + '\n');
  return { rollPath, keyringPath, manifestText, k1, k1Digest, currentDigest: current.digest };
}

test('the binding join: --identities × --roll verifies the countersignature against the roll, and every refusal names itself (#125)', () => {
  const f = rehearsalDir();
  try {
    const domain = rollDomain(f.dir);
    const boundCert = subjectCert(f.enforcer, { subjectId: 'bound-1', memberKeyDigest: domain.currentDigest, memberPrivateKey: domain.k1.privateKeyPem });
    const identitiesFile = writeIdentityLedger(f, [ledgerLine(boundCert)]);
    const att = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile, rollFile: domain.rollPath, keyringFile: domain.keyringPath });
    assert.equal(att.checked.identities, 'verified');
    assert.equal(att.checked.roll, 'verified');
    assert.equal(att.identityChain.bound, 1);
    assert.equal(att.identityChain.unbound, 0);
    assert.equal(att.findings.length, 0);

    // a member key the roll never bound — the false answer D-3 names
    const ghostCert = subjectCert(f.enforcer, { subjectId: 'ghost', memberKeyDigest: 'e'.repeat(64), memberPrivateKey: domain.k1.privateKeyPem });
    const ghost = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile: writeIdentityLedger(f, [ledgerLine(ghostCert)]), rollFile: domain.rollPath, keyringFile: domain.keyringPath });
    assert.equal(ghost.checked.identities, 'BROKEN');
    assert.ok(ghost.findings.some((x) => x.severity === 'error' && /which the roll never bound/.test(x.detail)));

    // a revoked member: the act that leans on the certificate refuses on the row
    const revokedDomain = rollDomain(f.dir, { revoke: true, name: 'revoked' });
    const revokedCert = subjectCert(f.enforcer, { subjectId: 'revoked-1', memberKeyDigest: revokedDomain.currentDigest, memberPrivateKey: revokedDomain.k1.privateKeyPem });
    const revoked = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile: writeIdentityLedger(f, [ledgerLine(revokedCert)]), rollFile: revokedDomain.rollPath, keyringFile: revokedDomain.keyringPath });
    assert.equal(revoked.checked.identities, 'BROKEN');
    const revokedFinding = revoked.findings.find((x) => x.severity === 'error' && /REVOKED at roll entry/.test(x.detail));
    assert.ok(revokedFinding, 'the refusal cites the roll row it acts on');
    assert.match(revokedFinding.rule, /F-8/);

    // a countersignature that does not verify against the roll's key
    const forgedCert = subjectCert(f.enforcer, { subjectId: 'forged-1', memberKeyDigest: domain.currentDigest, memberPrivateKey: domain.k1.privateKeyPem });
    forgedCert.memberCountersignature = subjectCert(f.enforcer, { memberKeyDigest: domain.currentDigest, memberPrivateKey: domain.k1.privateKeyPem }).memberCountersignature;
    const forged = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile: writeIdentityLedger(f, [ledgerLine(forgedCert)]), rollFile: domain.rollPath, keyringFile: domain.keyringPath });
    assert.equal(forged.checked.identities, 'BROKEN');
    assert.ok(forged.findings.some((x) => x.severity === 'error' && /countersignature.*does not verify against the roll's key/.test(x.detail)));

    // no --roll given: the countersignature is declared UNVERIFIABLE, never passed silently
    const noRoll = audit(LOG, undefined, 0, { annexFile: f.annexPath, identitiesFile: writeIdentityLedger(f, [ledgerLine(boundCert)]) });
    assert.equal(noRoll.checked.identities, 'verified', 'a warning is not an error');
    assert.ok(noRoll.findings.some((x) => x.severity === 'warning' && /this run CANNOT verify/.test(x.detail) && /--roll/.test(x.detail)));
  } finally {
    f.cleanup();
  }
});
