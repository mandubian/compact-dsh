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
import { generateEd25519, signSeal, signAnnex, annexDigestOf } from '../packages/seals/src/index.js';
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
  return { dir, manifestPath, sealPath, annexPath, anchorsPath, logPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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
  assert.equal(att.enforcer, undefined);
  assert.equal(att.authorship, undefined);
  assert.equal(att.verdict, 'conforming');
});
