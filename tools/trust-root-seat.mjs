// trust-root-seat — the re-seat half of the swap test (Demo 12, issue #168).
//
// Ratification replaces the keyring manifest; runtimes swap keyring
// configuration, never code (docs/decision-rehearsal-identity.md's design
// test, judged sentence by sentence). This module performs the runtime-side
// half for the community demo: the SAME law body, re-sealed under a
// rehearsal authority set's own keys (subject 'compact-body', k-of-n with
// distinct signers), written beside that set's manifest — the act the
// amendment harness performs after a re-seal, exported so the demo's two
// acts (and any test) seat their trust root through ONE channel.
//
// The seat is MACHINERY: a dev-keyring seat conveys no standing (I-8), and
// every surface that shows one says so.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex, parseManifest, parseSeal, verifySeal } from 'compact-dsh-seals';
import { sealArtifact } from './rehearsal-amendment.mjs';
import { COMPACT_BODY, COMPACT_DIGEST } from '../packages/constitution/src/body.js';

const SEAL_SUBJECT = 'compact-body';

/** The digest a pin names: over the RAW manifest text — a digest over a
 *  re-stringified manifest pins nothing (the seals layer's own rule). */
export function manifestDigestOf(manifestPath) {
  return sha256Hex(readFileSync(manifestPath));
}

/** Re-seal the law body under the rehearsal authority keys installed at
 *  `keyringDir`, as that set's own trust-root seat. The seat is verified
 *  against its own manifest before it is written; a seat that does not
 *  verify is installed nowhere. The law does not change here — the same
 *  bytes, the same COMPACT_DIGEST: what changes is the authority whose
 *  keys seal it, which is exactly the document ratification swaps. */
export function seatTrustRoot(keyringDir) {
  const manifestPath = join(keyringDir, 'keyring.json');
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const seal = sealArtifact(keyringDir, COMPACT_BODY, SEAL_SUBJECT, 'community-demo trust-root seat (rehearsal re-seat — standing none)');
  const seatVerified = verifySeal({ bytes: COMPACT_BODY, subject: SEAL_SUBJECT, seal, manifest });
  const sealPath = join(keyringDir, 'compact-body.sig.json');
  writeFileSync(sealPath, JSON.stringify(seal, null, 2) + '\n', { mode: 0o600 });
  return {
    manifestPath,
    sealPath,
    manifestDigest: manifestDigestOf(manifestPath),
    lawDigest: COMPACT_DIGEST,
    verified: { threshold: seatVerified.threshold, distinctSigners: seatVerified.distinctSigners, basis: seatVerified.basis },
  };
}
