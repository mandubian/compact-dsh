// compact-dsh-seals — the signature machinery for the rehearsal (development
// keyring) posture.
//
// Two verification domains, kept separate because the law keeps them
// separate:
//   law artifacts     — sealed k-of-n by the Compact's authority keys
//                       (body, amendments). This package's seal.js.
//   runtime artifacts — signed single-key by the composition's Enforcer key,
//                       declared in the signed annex (F-5 rehearsal): the
//                       annex itself, attestations, record anchors, subject
//                       certificates. This package's annex.js.
// No signature link exists between the two domains; the link is the annex's
// lawDigest matching the sealed law's digest. See
// docs/decision-rehearsal-identity.md for the boundary and the labels.

export { canonicalJson, canonicalBytes, withoutField } from './canonical.js';
export { generateEd25519, importPublicKey, signMessage, verifyMessage, sha256Hex } from './keys.js';
export { messageFor, parseManifest, parseSeal, verifySeal, signSeal, SealError } from './seal.js';
export {
  REHEARSAL_DECLARATION, annexDigestOf, verifyAnnex, signAnnex,
  verifySubjectCert, signSubjectCert,
} from './annex.js';
