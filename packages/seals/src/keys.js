// ed25519 keys and one-shot signatures — the only cryptography in the
// composition, all of it node:crypto, none of it novel.
//
// Public keys travel exactly as the development keyring ships them: SPKI DER,
// base64 (`MCowBQYDK2VwAyEA…`). Private keys never travel: rehearsal
// tooling loads them from gitignored PEM files it generated, and the runtime
// proper never needs one — it verifies.

import { createHash, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A fresh ed25519 keypair: SPKI-DER-base64 public half, PKCS8 PEM private half. */
export function generateEd25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** Import a base64 SPKI-DER public key. Throws on anything that is not one. */
export function importPublicKey(base64) {
  return createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
}

/** Sign UTF-8 message bytes with an ed25519 private key (PKCS8 PEM or KeyObject). */
export function signMessage(messageBytes, privateKey) {
  return edSign(null, messageBytes, privateKey).toString('base64');
}

/** Verify a base64 ed25519 signature over message bytes. Never throws on a bad signature. */
export function verifyMessage(messageBytes, publicKeyBase64, signatureBase64) {
  try {
    return edVerify(null, messageBytes, importPublicKey(publicKeyBase64), Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}
