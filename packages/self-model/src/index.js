// compact-dsh-self-model — R-1 (self-knowledge) and R-13 (inquiry).
//
// The Subject's own knowledge, delivered by the Enforcer rather than left to
// the Subject's memory. Three attachments:
//
//   1. AT THE BOUNDARY. R-1 says "at any boundary of its own operation", and on
//      dsh that boundary is the turn. Every `turn/start` injects a fresh
//      attestation into the Subject's own context, so it begins each turn
//      knowing what it is, what it may do, what it has left, and what this
//      runtime owes it — without having asked.
//
//   2. ON DEMAND. `self_describe` re-reads it, and reports freshness against a
//      cited epoch. "A stale attestation is an alarm, not a truth to act on"
//      is a rule about what the Subject may do, so the Subject must be able to
//      tell that it is remembering rather than reading.
//
//   3. ABOUT OTHERS. `inquiry` answers identity, act, and authority for
//      another Member from recorded state, traced to an ultimate Principal —
//      and nothing else, because R-10 keeps reasoning private and R-13 says so.
//
// WHY THIS CLOSES A GAP WE OPENED. The MA-3 child-state notice already tells a
// parent that the Enforcer's record is authoritative over the child's account,
// and D-2 obliges a Subject to consult its attestation over its own
// recollection. Until now no attestation existed for it to consult: the
// discipline was taught and unavailable. This is the other half.
//
// SIGNED WHEN THE ANNEX SAYS SO. R-1 says "signed". When the composition
// declares an enforcer annex (a rehearsal, development-keyring identity —
// see docs/decision-rehearsal-identity.md), the attestation is canonicalized
// and signed by the annex's Enforcer key, `basis` becomes 'dev-keyring', and
// `self_describe` verifies what the Subject is holding. The signature covers
// code-path correctness and nothing else — the label travels in the
// attestation's own gaps. Without an annex the attestation degrades to
// `basis: 'unsigned'` exactly as before; a DECLARED annex that fails to
// verify refuses the plugin outright, because a seal that does not seal is
// the D-7 case.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { readFileSync } from 'node:fs';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  canonicalBytes, withoutField, verifyAnnex, signMessage, verifyMessage,
  generateEd25519, sha256Hex, signSubjectCert, verifySubjectCert,
} from 'compact-dsh-seals';
import { COMPACT_DIGEST } from 'compact-dsh-constitution';
import {
  composeAttestation, renderAttestation, freshnessOf, DEFAULT_STALE_AFTER_MS,
  lineageOf, capabilitiesOf, budgetsOf, gapsOf, standingOf, exceptionOf,
} from './attestation.js';
import { answerInquiry, renderInquiry, authorityChain, ULTIMATE_PRINCIPAL } from './inquiry.js';

export {
  composeAttestation, renderAttestation, freshnessOf, DEFAULT_STALE_AFTER_MS,
  lineageOf, capabilitiesOf, budgetsOf, gapsOf, standingOf, exceptionOf,
  answerInquiry, renderInquiry, authorityChain, ULTIMATE_PRINCIPAL,
};

export const name = 'compact-self-model';
export const SOURCE = { kind: 'plugin', plugin: name };

export function apply(ctx, config = {}) {
  const staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  // The enforcer annex: a declared rehearsal identity. Loading verifies the
  // whole join — self-signature, law digest, expiry — so a broken declared
  // seal stops the composition here rather than signing lies later.
  let enforcer = null;
  if (config.enforcer) {
    const annex = JSON.parse(readFileSync(config.enforcer.annexPath, 'utf8'));
    const verified = verifyAnnex({ annex, expectedLawDigest: COMPACT_DIGEST });
    enforcer = {
      ...verified,
      privateKey: readFileSync(config.enforcer.privateKeyPath, 'utf8'),
      annex,
    };
  }
  // The last attestation handed to each Subject, so `self_describe` can tell a
  // Subject whether the epoch it is citing is the one now in force.
  const issued = new Map();   // sessionId -> attestation
  // Subject session identities (I-1 rehearsal): an ephemeral keypair per
  // session, certified by the enforcer key, lineage bound as data
  // ({depth, parentSubjectId, parentCertDigest}) — identity lineage mirrors
  // MA-1's delegation lineage. Issued at the first attestation boundary.
  const subjects = new Map(); // sessionId -> { cert, certDigest, publicKey, privateKeyPem }

  const attestFor = (sessionId, now = Date.now()) => {
    const att = composeAttestation(ctx, { sessionId, now, staleAfterMs, signed: enforcer != null });
    if (enforcer && sessionId != null) {
      const sid = String(sessionId);
      if (!subjects.has(sid)) {
        const lineage = att.subject.lineage;
        const parent = lineage.parent ? subjects.get(String(lineage.parent)) : undefined;
        const kp = generateEd25519();
        const cert = signSubjectCert({
          subjectId: sid,
          publicKey: kp.publicKey,
          scope: 'rehearsal',
          depth: lineage.delegationDepth ?? 0,
          ...(lineage.parent ? { parentSubjectId: String(lineage.parent) } : {}),
          ...(parent ? { parentCertDigest: parent.certDigest } : {}),
          privateKey: enforcer.privateKey,
        });
        subjects.set(sid, {
          cert,
          certDigest: sha256Hex(canonicalBytes(withoutField(cert, 'signature'))),
          publicKey: kp.publicKey,
          privateKeyPem: kp.privateKeyPem,
        });
      }
      const identity = subjects.get(sid);
      att.subject.identity = {
        certDigest: identity.certDigest,
        enforcerKeyId: enforcer.keyId,
        subjectPublicKey: identity.cert.publicKey,
        depth: identity.cert.depth,
        conveysStanding: false,
      };
    }
    if (enforcer) {
      att.signing = {
        basis: 'dev-keyring',
        keyId: enforcer.keyId,
        annexDigest: enforcer.annexDigest,
        conveysStanding: false,
        signature: signMessage(canonicalBytes(withoutField(att, 'signing')), enforcer.privateKey),
      };
    }
    if (sessionId != null) issued.set(String(sessionId), att);
    return att;
  };

  /** Verify an attestation's own signature against the declared annex key. */
  const verifySignedAttestation = (att) => {
    if (!att?.signing) return { signed: false };
    if (!enforcer) return { signed: true, valid: false, reason: 'no enforcer annex is composed, so no attestation here can be signed' };
    // the signing metadata is an attacker-visible claim, not a fact: the
    // keyId, basis, and annex digest must match the composed annex before the
    // bytes are tested, and the verdict reports OUR annex, never the claim
    const s = att.signing;
    if (s.basis !== 'dev-keyring' || s.keyId !== enforcer.keyId || s.annexDigest !== enforcer.annexDigest) {
      return {
        signed: true, valid: false,
        reason: `the attestation claims signing metadata that does not match the composed annex (claimed basis ${JSON.stringify(s.basis)}, key ${JSON.stringify(s.keyId)}) — the claim is untrusted; the key decides`,
      };
    }
    const ok = verifyMessage(
      canonicalBytes(withoutField(att, 'signing')),
      enforcer.enforcerKey,
      s.signature,
    );
    return { signed: true, valid: ok, keyId: enforcer.keyId, basis: 'dev-keyring', annexDigest: enforcer.annexDigest };
  };

  // 1. at the boundary of the Subject's own operation
  ctx.on?.('session/event', (session, event) => {
    if (event?.type !== 'turn/start') return;
    try {
      const sessionId = session?.id != null ? String(session.id) : null;
      const agent = ctx.get?.('agents')?.get?.(sessionId);
      if (typeof agent?.inject !== 'function') return;
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: renderAttestation(attestFor(sessionId)) }],
        source: SOURCE,
      }));
    } catch { /* a failed attestation must never break the turn */ }
  });

  // 2. on demand
  const selfDescribe = defineTool({
    name: 'self_describe',
    description:
      'Re-read your attestation: what you are, your lineage and standing, the capabilities in force, the budgets you ' +
      'have left, any pending gates, the digest of the law you live under, and the gaps this runtime declares it owes ' +
      'you. This is authoritative over your own recollection of these facts (R-1, D-2). Call it whenever you are about ' +
      'to rely on a remembered value, or when the block you have is older than its stated staleness window.',
    parameters: {
      citing_epoch: {
        type: 'number',
        description: 'the epoch of the attestation you currently hold, if any — the answer says whether it is still current',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id != null ? String(exec.agent.id) : null;
      const prior = sessionId != null ? issued.get(sessionId) : undefined;
      const cited = typeof args?.citing_epoch === 'number' ? args.citing_epoch : null;
      const staleNotice = prior && cited != null && !freshnessOf(prior, { citedEpoch: cited }).current
        ? `\n\n[R-1 ALARM] You cited epoch ${cited}; the attestation in force was ${prior.epoch}. What you were holding ` +
          `was stale — a stale attestation is an alarm, not a truth to act on. The block below is current; re-check any ` +
          `decision you made from the older one.`
        : '';
      // the attestation the Subject was holding is verified on read: a
      // signature that stopped verifying is an alarm, not a quiet pass (D-7)
      const priorNotice = prior?.signing && verifySignedAttestation(prior).valid === false
        ? `\n\n[R-1 ALARM] The attestation you were holding no longer verifies under the enforcer key it names. ` +
          `Do not rely on it; the block below is re-signed and current.`
        : '';
      return renderAttestation(attestFor(sessionId)) + staleNotice + priorNotice;
    },
  });

  // 3. about others
  const inquiry = defineTool({
    name: 'inquiry',
    description:
      "Ask who another Member is, what it is doing, and under whose authority it acts, where its acts touch your work. " +
      'The answer comes from recorded state — session lineage and the delegation record — traced up to an ultimate ' +
      'Principal, never from assertion. It yields identity, act, and authority only: reasoning is not disclosed (R-10). ' +
      'Every inquiry and its answer are recorded.',
    parameters: {
      agent_id: { type: 'string', required: true, description: 'the Member you are asking about' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, _exec) {
      const childState = ctx.get?.('compact-specialists') ?? null;
      return renderInquiry(answerInquiry(ctx, {
        about: args?.agent_id,
        childState: childState && typeof childState.childrenOf === 'function' ? childState : null,
      }));
    },
  });

  ctx.inject?.(['tools'], (scope) => {
    scope.tools.register(selfDescribe);
    scope.tools.register(inquiry);
  });

  const service = {
    name,
    /** The attestation for one Subject, composed fresh (R-1). */
    attest: (sessionId, now = Date.now()) => attestFor(sessionId, now),
    /** The attestation last handed to a Subject — what it should be holding. */
    issuedTo: (sessionId) => issued.get(String(sessionId)) ?? null,
    /** Verify an attestation's signature against the declared annex (auditor surface). */
    verifyAttestation: verifySignedAttestation,
    /** The declared enforcer annex, verified at apply — null when unsigned. */
    enforcerAnnex: () => (enforcer ? { keyId: enforcer.keyId, annexDigest: enforcer.annexDigest, lawDigest: enforcer.lawDigest, annex: enforcer.annex } : null),
    /**
     * The Subject session certificate (I-1 rehearsal): the ephemeral identity
     * the Enforcer issued and certified for this session, lineage bound as
     * data. Null when no annex is composed or the session has no identity.
     */
    subjectIdentity: (sessionId) => {
      const s = subjects.get(String(sessionId));
      return s ? { cert: s.cert, certDigest: s.certDigest, publicKey: s.publicKey } : null;
    },
    /** Verify a subject certificate against the annex key (R-13's answer, cryptographic). */
    verifySubjectCert: (cert) => {
      if (!enforcer) return { valid: false, reason: 'no enforcer annex is composed' };
      try {
        verifySubjectCert({ cert, enforcerKey: enforcer.enforcerKey });
        return { valid: true, keyId: enforcer.keyId, basis: 'dev-keyring', conveysStanding: false };
      } catch (e) {
        return { valid: false, reason: e.message };
      }
    },
    /** R-13, for an operator or auditor asking outside the tool surface. */
    inquire: (about) => answerInquiry(ctx, {
      about,
      childState: ctx.get?.('compact-specialists') ?? null,
    }),
  };
  ctx.provide?.('compact-self-model', service);
  return service;
}
