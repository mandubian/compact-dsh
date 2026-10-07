// trust-root-seat tests — the swap test's re-seat half, exercised through the
// BOOT's own reader (verifyTrustRoot), not a parallel implementation (issue
// #168; docs/decision-rehearsal-identity.md's design test: swap documents,
// never code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest, parseSeal, verifySeal, sha256Hex, SealError } from 'compact-dsh-seals';
import { COMPACT_BODY, COMPACT_DIGEST } from '../packages/constitution/src/body.js';
import { verifyTrustRoot } from '../packages/constitution/src/index.js';
import { ensureRehearsalKeyring } from './rehearsal-keyring.mjs';
import { seatTrustRoot, manifestDigestOf } from './trust-root-seat.mjs';

/** Two independent rehearsal sets = the swap test's A and B: fresh authority
 *  keys every time, exactly as ratification would swap in a fresh root. */
function freshSet() {
  const dir = mkdtempSync(join(tmpdir(), 'trust-seat-'));
  ensureRehearsalKeyring(dir, { force: true });
  return dir;
}
const withDir = (dir, run) => { try { return run(); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('the seat: the SAME law under a FRESH authority — the boot reader accepts the set’s own pin', () => {
  const dir = freshSet();
  withDir(dir, () => {
    const seat = seatTrustRoot(dir);
    // the law did not change in the re-seat: the digest is the vendored body's
    assert.equal(seat.lawDigest, COMPACT_DIGEST);
    // through the exact boot path, with the set's own digest as the pin
    const verdict = verifyTrustRoot(
      { kind: 'dev-keyring', manifest: seat.manifestPath, seal: seat.sealPath, trustedKeyringDigest: seat.manifestDigest },
      COMPACT_BODY,
    );
    // the seat is signed by every authority key the set holds (3); the
    // 2-of-3 threshold is a FLOOR, met with distinct signers to spare
    assert.ok(verdict.distinctSigners >= 2);
  });
});

test('the pin bites: B’s artifacts under A’s pin refuse, naming the swap', () => {
  const a = freshSet();
  const b = freshSet();
  withDir(a, () => withDir(b, () => {
    const seatA = seatTrustRoot(a);
    const seatB = seatTrustRoot(b);
    assert.notEqual(seatA.manifestDigest, seatB.manifestDigest);
    assert.throws(
      () => verifyTrustRoot(
        { kind: 'dev-keyring', manifest: seatB.manifestPath, seal: seatB.sealPath, trustedKeyringDigest: seatA.manifestDigest },
        COMPACT_BODY,
      ),
      (e) => e instanceof Error && /swapped manifest is a swapped trust basis/.test(e.message),
    );
    // and the re-pin — the governance act — admits B: same artifacts, B's pin
    const verdict = verifyTrustRoot(
      { kind: 'dev-keyring', manifest: seatB.manifestPath, seal: seatB.sealPath, trustedKeyringDigest: seatB.manifestDigest },
      COMPACT_BODY,
    );
    // the seat is signed by every authority key the set holds (3); the
    // 2-of-3 threshold is a FLOOR, met with distinct signers to spare
    assert.ok(verdict.distinctSigners >= 2);
  }));
});

test('a seat is bound to its authority: B’s body seal refuses under A’s manifest', () => {
  const a = freshSet();
  const b = freshSet();
  withDir(a, () => withDir(b, () => {
    seatTrustRoot(a);
    const seatB = seatTrustRoot(b);
    const manifestA = parseManifest(readFileSync(join(a, 'keyring.json'), 'utf8'));
    const sealB = parseSeal(readFileSync(seatB.sealPath, 'utf8'));
    assert.throws(
      () => verifySeal({ bytes: COMPACT_BODY, subject: 'compact-body', seal: sealB, manifest: manifestA }),
      SealError,
    );
  }));
});

test('the seat pins the body: one changed byte refuses', () => {
  const dir = freshSet();
  withDir(dir, () => {
    const seat = seatTrustRoot(dir);
    const manifest = parseManifest(readFileSync(seat.manifestPath, 'utf8'), { trustedDigest: seat.manifestDigest });
    const seal = parseSeal(readFileSync(seat.sealPath, 'utf8'));
    assert.throws(
      () => verifySeal({ bytes: `${COMPACT_BODY}\n`, subject: 'compact-body', seal, manifest }),
      SealError,
    );
  });
});

test('the pin is over the RAW manifest text', () => {
  const dir = freshSet();
  withDir(dir, () => {
    const manifestPath = join(dir, 'keyring.json');
    assert.equal(manifestDigestOf(manifestPath), sha256Hex(readFileSync(manifestPath)));
  });
});
