// The member roll's own laws, tested pure: the anti-certificate discipline
// (admission by statute quorum AND the member's own key, rotation by the
// predecessor, revocation as a fact), the chain discipline (the session
// record's own formula), and the anchoring walk (epoch checkpoints, the
// forker refused dead, the unanchored tail named) — identity slice 1 (#124).
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateEd25519 } from '../src/keys.js';
import { parseManifest } from '../src/seal.js';
import {
  memberKeyDigestOf, signRollEvent, appendRollEvent, closeEpoch,
  verifyRoll, resolveMember, rollGenesisHash,
} from '../src/roll.js';

const NOW = '2026-10-01T00:00:00.000Z';
const STATUTE = 'f'.repeat(64);

function KEY(i) {
  const kp = generateEd25519();
  return { id: `auth-${i}`, publicKey: kp.publicKey, privateKey: kp.privateKeyPem };
}
const KEYS = [1, 2, 3].map(KEY);
const manifest = parseManifest({
  declaration: 'rehearsal authority — practice keys',
  threshold: { k: 2, n: 3 },
  keys: KEYS.map(({ id, publicKey }) => ({ id, publicKey })),
});
const quorum = (n = 2) => KEYS.slice(0, n).map(({ id, privateKey }) => ({ keyId: id, privateKey }));
const privateKeys = new Map(KEYS.map(({ id, privateKey }) => [id, privateKey]));
const freshRoll = () => ({
  kind: 'rehearsal-member-roll', version: 1,
  genesis: { epochLength: { events: 64 }, admissionStatute: { digest: STATUTE } },
  entries: [], checkpoints: [],
});

function admit(roll, { class: klass = 'principal', member = 'm', quorumSize = 2, selfSign = true }) {
  const kp = generateEd25519();
  const digest = memberKeyDigestOf(kp.publicKey);
  const event = {
    kind: 'admission', memberKeyDigest: digest, class: klass, memberKey: kp.publicKey,
    member, grounds: `statute ${STATUTE.slice(0, 8)}…`, recordedAt: NOW,
  };
  const signers = [...quorum(quorumSize)];
  if (selfSign) signers.push({ keyId: digest, privateKey: kp.privateKeyPem });
  appendRollEvent(roll, { ...event, signedBy: signRollEvent(event, signers) });
  return { kp, digest };
}

function rotate(roll, member, predecessor) {
  const kp = generateEd25519();
  const digest = memberKeyDigestOf(kp.publicKey);
  const event = {
    kind: 'rotation', memberKeyDigest: digest, class: member.class,
    predecessorKeyDigest: predecessor.digest, successorKey: kp.publicKey,
    grounds: 'routine rotation', recordedAt: NOW,
  };
  const signer = arguments[3] ?? { keyId: predecessor.digest, privateKey: predecessor.kp.privateKeyPem };
  appendRollEvent(roll, { ...event, signedBy: signRollEvent(event, [signer]) });
  return { kp, digest };
}

test('admission is statute-shaped AND self-proven; rotation launders nothing; revocation is a fact', () => {
  const roll = freshRoll();
  const founder = admit(roll, { member: 'founder' });
  const subject = admit(roll, { class: 'long-lived-subject', member: 'subject' });
  const successor = rotate(roll, { class: 'principal' }, founder);

  // before revocation: the lineage is data, and it resolves as such
  const v0 = verifyRoll({ roll, manifest });
  assert.equal(v0.ok, true, v0.findings.map((f) => f.detail).join(' | '));
  const pre = resolveMember(v0, founder.kp.publicKey);
  const post = resolveMember(v0, successor.kp.publicKey);
  assert.equal(pre.foundingDigest, post.foundingDigest, 'the J-4/F-6 seam: pre- and post-rotation keys are ONE member');
  assert.equal(pre.state, 'superseded');
  assert.equal(post.state, 'live');
  assert.deepEqual(post.lineage, [founder.digest, successor.digest]);
  assert.equal(resolveMember(v0, subject.kp.publicKey).state, 'live');

  // revoke the founder at its CURRENT key; the row stays and says so
  const rev = { kind: 'revocation', memberKeyDigest: successor.digest, grounds: 'compromise drill', recordedAt: NOW };
  appendRollEvent(roll, { ...rev, signedBy: signRollEvent(rev, quorum(3)) });
  closeEpoch({ roll, epoch: 0, manifest, privateKeys, now: NOW });

  const v = verifyRoll({ roll, manifest });
  assert.equal(v.ok, true, v.findings.map((f) => f.detail).join(' | '));
  assert.equal(v.summary.entries, 4);
  assert.equal(v.summary.members, 2);
  assert.equal(v.summary.live, 1);
  assert.equal(v.summary.revoked, 1);
  assert.equal(v.summary.rotations, 1);
  assert.equal(v.summary.anchoredThrough, 3);
  // member-level revocation dominates: ANY key of a revoked Member says revoked
  assert.equal(resolveMember(v, founder.kp.publicKey).state, 'revoked');
  assert.equal(resolveMember(v, successor.kp.publicKey).state, 'revoked');
  assert.equal(resolveMember(v, subject.kp.publicKey).state, 'live');
  assert.equal(resolveMember(v, 'MCowBQYDK2VwAyEAAgAD'), null, 'a key the roll never bound resolves to nothing');
});

test('possession is proven, never asserted — an admission the member did not sign refuses', () => {
  const roll = freshRoll();
  admit(roll, { member: 'founder', selfSign: false });
  const v = verifyRoll({ roll, manifest });
  assert.equal(v.ok, false);
  assert.ok(v.findings.some((f) => f.reason === 'roll-not-proven' && /Member's OWN key/.test(f.detail)));
  // and below the statute's quorum, the statute's own refusal names it
  const r2 = freshRoll();
  admit(r2, { member: 'founder', quorumSize: 1 });
  const v2 = verifyRoll({ roll: r2, manifest });
  assert.ok(v2.findings.some((f) => f.reason === 'roll-sub-threshold' && /statute's quorum/.test(f.detail)));
});

test('the chain discipline: a row changed after chaining fails its own hash and signatures', () => {
  const roll = freshRoll();
  admit(roll, { member: 'founder' });
  roll.entries[0].grounds = 'forged grounds';
  const v = verifyRoll({ roll, manifest });
  assert.equal(v.ok, false);
  assert.ok(v.findings.some((f) => f.reason === 'roll-hash'));
  assert.ok(v.findings.some((f) => f.reason === 'roll-sub-threshold'), 'every field is inside the signed bytes — the forgery breaks the signatures too');
  // and a roll presented over another genesis is not the roll
  const other = freshRoll();
  admit(other, { member: 'founder' });
  other.entries[0].prev = rollGenesisHash({ epochLength: { events: 64 }, admissionStatute: { digest: '0'.repeat(64) } });
  const v2 = verifyRoll({ roll: other, manifest });
  assert.ok(v2.findings.some((f) => f.reason === 'roll-link'));
});

test('rotation: only the predecessor signs, only the current key rotates, a revoked Member never re-keys', () => {
  // a rotation signed by someone other than the predecessor
  const roll = freshRoll();
  const founder = admit(roll, { member: 'founder' });
  const stranger = generateEd25519();
  const s1 = rotate(roll, { class: 'principal' }, founder, { keyId: founder.digest, privateKey: stranger.privateKeyPem });
  const v = verifyRoll({ roll, manifest });
  assert.ok(v.findings.some((f) => f.reason === 'roll-rotation-refused' && /PREDECESSOR key/.test(f.detail)));
  void s1;

  // the laundering path: rotate a Member already revoked
  const r2 = freshRoll();
  const f2 = admit(r2, { member: 'founder' });
  const succ = rotate(r2, { class: 'principal' }, f2);
  const rev = { kind: 'revocation', memberKeyDigest: succ.digest, grounds: 'drill', recordedAt: NOW };
  appendRollEvent(r2, { ...rev, signedBy: signRollEvent(rev, quorum(2)) });
  rotate(r2, { class: 'principal' }, succ);
  const v2 = verifyRoll({ roll: r2, manifest });
  assert.ok(v2.findings.some((f) => f.reason === 'roll-rotation-refused' && /laundering/.test(f.detail)));

  // a superseded key cannot rotate again (the lineage is data)
  const r3 = freshRoll();
  const f3 = admit(r3, { member: 'founder' });
  rotate(r3, { class: 'principal' }, f3);
  rotate(r3, { class: 'principal' }, f3);
  const v3 = verifyRoll({ roll: r3, manifest });
  assert.ok(v3.findings.some((f) => f.reason === 'roll-rotation-refused' && /SUPERSEDED/.test(f.detail)));

  // re-keying never re-classes
  const r4 = freshRoll();
  const f4 = admit(r4, { member: 'founder' });
  rotate(r4, { class: 'long-lived-subject' }, f4);
  const v4 = verifyRoll({ roll: r4, manifest });
  assert.ok(v4.findings.some((f) => f.reason === 'roll-rotation-refused' && /re-classes/.test(f.detail)));
});

test('revocation is a fact: it stays, says revoked, and cannot be recorded twice', () => {
  const roll = freshRoll();
  const founder = admit(roll, { member: 'founder' });
  const rev = { kind: 'revocation', memberKeyDigest: founder.digest, grounds: 'drill', recordedAt: NOW };
  appendRollEvent(roll, { ...rev, signedBy: signRollEvent(rev, quorum(2)) });
  const v = verifyRoll({ roll, manifest });
  assert.equal(v.ok, true);
  assert.equal(resolveMember(v, founder.kp.publicKey).state, 'revoked', 'the row stays and the standing says so');
  const again = { kind: 'revocation', memberKeyDigest: founder.digest, grounds: 'again', recordedAt: NOW };
  appendRollEvent(roll, { ...again, signedBy: signRollEvent(again, quorum(2)) });
  const v2 = verifyRoll({ roll, manifest });
  assert.ok(v2.findings.some((f) => f.reason === 'roll-double-revocation'));
  const ghost = { kind: 'revocation', memberKeyDigest: 'e'.repeat(64), grounds: 'ghost', recordedAt: NOW };
  appendRollEvent(roll, { ...ghost, signedBy: signRollEvent(ghost, quorum(2)) });
  const v3 = verifyRoll({ roll, manifest });
  assert.ok(v3.findings.some((f) => f.reason === 'roll-unknown-member' && /never bound/.test(f.detail)));
});

test('anchoring the roll: the forker is refused dead, the unanchored tail is named', () => {
  const roll = freshRoll();
  const founder = admit(roll, { member: 'founder' });
  admit(roll, { member: 'subject', class: 'long-lived-subject' });
  closeEpoch({ roll, epoch: 0, manifest, privateKeys, now: NOW });

  // THE FORK: the true roll to the anchored head, then a divergent
  // continuation — the checkpoint's head is unreachable, refused on arrival
  const forked = JSON.parse(JSON.stringify(roll));
  forked.entries.pop();
  admit(forked, { member: 'impostor' });
  const vf = verifyRoll({ roll: forked, manifest });
  assert.equal(vf.ok, false);
  assert.ok(vf.findings.some((f) => f.reason === 'checkpoint-fork' && /not the roll, refused dead/.test(f.detail)));

  // THE TAIL: a valid continuation past the anchored head is not an error —
  // it is the verifier's own retention, named as such
  const tailed = JSON.parse(JSON.stringify(roll));
  admit(tailed, { member: 'latecomer' });
  const vt = verifyRoll({ roll: tailed, manifest });
  assert.equal(vt.ok, true, 'integrity rides the chain; freshness is retention');
  assert.equal(vt.summary.anchoredThrough, 1);
  assert.ok(vt.findings.some((f) => f.severity === 'warning' && f.reason === 'checkpoint-tail'));

  // the cadence is a genesis constant, not a mood
  const sparse = freshRoll();
  sparse.genesis.epochLength.events = 2;
  for (const m of ['a', 'b', 'c', 'd', 'e', 'f']) admit(sparse, { member: m });
  closeEpoch({ roll: sparse, epoch: 0, manifest, privateKeys, now: NOW });
  const vs = verifyRoll({ roll: sparse, manifest });
  assert.ok(vs.findings.some((f) => f.reason === 'checkpoint-cadence' && /spending policy/.test(f.detail)));
  void founder;
});
