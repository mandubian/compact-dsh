// Prior declarations — the authorship half of R-9's value-scoped limb
// (amendment 0002), identity slice 4 (#127).
//
// THE LIMB: a Member may refuse a directive that conflicts with a value the
// Member DECLARED OF RECORD BEFORE the directive. The record's chain proves
// a ground's ORDERING (I-2/R-7); what it could never prove is AUTHORSHIP —
// nothing distinguished a ground the Member declared from one the Enforcer
// wrote into the log, so the shield was "exercisable against an honest
// Enforcer and inert against a dishonest one" (the constitution's declared
// debt). The Member's OWN key closes exactly that hole: the declaration
// carries the Member's signature, verifiable by ANY party offline (I-7) —
// against the roll's public half for the digest it names, never against the
// Enforcer's log or word. Authorship by signature; ordering by the chain;
// the two together are the limb.
//
// THE ANTI-FORGERY DRILL this enables (the test that failed until now): a
// dishonest Enforcer writes a "prior declaration" into its own log AFTER
// the directive — without the Member's signature it verifies as nothing,
// and the refusal names the missing authorship instead of silently
// accepting a convenient ground.
//
// Pure model, no I/O: the identity service writes it, the auditor verifies
// it, and every loop here verifies a ratified declaration unchanged.

import { sha256Hex, signMessage, verifyMessage } from './keys.js';
import { canonicalBytes } from './canonical.js';
import { RollError } from './roll.js';

/** The bytes the Member's signature covers: the declaration without its own
 *  signature — the anchors' withoutField discipline. */
export function declarationUnsignedBytes(declaration) {
  return canonicalBytes(withoutSig(declaration));
}
const withoutSig = (d) => {
  const { signature: _s, ...rest } = d;
  return rest;
};

/**
 * Sign a prior declaration with the Member's own key. `memberKeyDigest` is
 * the coordinate the roll resolves — the CURRENT key of the declaring
 * Member at declaration time (a later rotation leaves the signature
 * verifiable: the roll's lineage keeps every key's public half).
 */
export function signPriorDeclaration({ member, memberKeyDigest, value, grounds = null, privateKey, declaredAt = new Date().toISOString() }) {
  if (typeof member !== 'string' || !member.trim()) {
    throw new RollError('declaration-malformed', 'a prior declaration names its member — authorship is the whole point');
  }
  if (!/^[0-9a-f]{64}$/.test(String(memberKeyDigest))) {
    throw new RollError('declaration-malformed', 'memberKeyDigest must be the 64-hex digest of the declaring key — the coordinate the roll resolves');
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new RollError('declaration-malformed', 'a prior declaration declares a VALUE — an empty ground is not a ground (R-9)');
  }
  const declaration = {
    kind: 'prior-declaration',
    member: member.trim(),
    memberKeyDigest,
    value: value.trim(),
    ...(grounds ? { grounds: String(grounds).trim() } : {}),
    declaredAt,
    standing: 'none — rehearsal authorship proof under the development keyring; conveys no standing',
  };
  declaration.signature = signMessage(declarationUnsignedBytes(declaration), privateKey);
  return declaration;
}

/**
 * Verify a prior declaration OFFLINE, against a verified member roll: the
 * signature must verify against the roll's public half for the digest the
 * declaration names (any key of the Member's lineage — rotation included),
 * and the Member's standing reads from rows. The Enforcer's cooperation is
 * neither required nor trusted — that is the limb's whole point (I-7).
 *
 * @returns {{valid: true, member: object} | {valid: false, reason: string}}
 */
export function verifyPriorDeclaration(declaration, verifiedRoll) {
  try {
    if (!declaration || declaration.kind !== 'prior-declaration'
      || typeof declaration.member !== 'string'
      || typeof declaration.memberKeyDigest !== 'string'
      || typeof declaration.value !== 'string' || !declaration.value.trim()
      || typeof declaration.signature !== 'string') {
      return { valid: false, reason: 'malformed prior declaration: parsed but missing required fields (kind=prior-declaration, member, memberKeyDigest, value, signature)' };
    }
    const bound = verifiedRoll?.byKey?.get(declaration.memberKeyDigest);
    if (!bound) {
      return { valid: false, reason: `names member key ${declaration.memberKeyDigest.slice(0, 12)}…, which the roll never bound — a ground the roll cannot attribute is the false answer D-3 names` };
    }
    if (bound.member.state === 'revoked') {
      return { valid: false, reason: `the declaring Member was REVOKED at roll entry ${bound.member.revocationRow ?? '?'} — a revoked Member's standing is a fact the roll keeps, and the shield does not outlive it` };
    }
    if (!verifyMessage(declarationUnsignedBytes(declaration), bound.publicKey, declaration.signature)) {
      return { valid: false, reason: `the Member's signature does not verify against the roll's key for ${declaration.memberKeyDigest.slice(0, 12)}… — authorship is the Member's own act, and this declaration does not carry it` };
    }
    return { valid: true, member: { id: declaration.member, class: bound.member.class, state: bound.member.state, lineage: [...bound.member.lineage] } };
  } catch (e) {
    return { valid: false, reason: e?.message ?? String(e) };
  }
}
