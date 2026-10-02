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

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  canonicalBytes, withoutField, verifyAnnex, signMessage, verifyMessage,
  generateEd25519, sha256Hex, signSubjectCert, verifySubjectCert,
  parseManifest, verifyRoll, resolveMember,
  signPriorDeclaration, verifyPriorDeclaration,
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
  // The member binding (identity slice 2, #125): the declared interim by
  // which sessions in this composition bind to the operator's Principal key
  // (F-3) — a declaration, auditable, never an improvisation. The Member is
  // resolved through the ROLL (the source of who holds which key, rotation
  // included), the countersignature is made with the member private key,
  // and a declared binding that cannot verify refuses the boot (D-7) rather
  // than countersigning lies later. Absent, the honest pre-binding state is
  // declared in every attestation instead — degradation honesty, never a
  // default-open.
  let memberBinding = null;
  let memberRollVerdict = null;
  if (config.memberBinding) {
    const { rollPath, keyringPath, memberKeyPath, memberId } = config.memberBinding;
    for (const [k, v] of [['rollPath', rollPath], ['keyringPath', keyringPath], ['memberKeyPath', memberKeyPath], ['memberId', memberId]]) {
      if (!v) throw new Error(`compact-self-model: memberBinding.${k} is required — a declared binding declares all of itself, or none of it (D-7)`);
    }
    const roll = JSON.parse(readFileSync(rollPath, 'utf8'));
    const manifest = parseManifest(readFileSync(keyringPath, 'utf8'));
    const verdict = verifyRoll({ roll, manifest });
    if (!verdict.ok) {
      const first = verdict.findings.find((f) => f.severity === 'error');
      throw new Error(`compact-self-model: the declared member roll refuses (${first?.reason}): ${first?.detail} — a binding that cannot verify its roll stops the composition here rather than bind sessions to a broken ledger (D-7)`);
    }
    const admission = roll.entries.find((e) => e.kind === 'admission' && e.member === memberId);
    if (!admission) {
      throw new Error(`compact-self-model: memberBinding.memberId "${memberId}" is not an admitted member of the declared roll — binding to a member the roll does not show would be the false answer D-3 names`);
    }
    const resolved = resolveMember(verdict, admission.memberKeyDigest);
    if (resolved == null) throw new Error(`compact-self-model: member "${memberId}" does not resolve through its own roll — the roll and its rows disagree`);
    // the countersigning key must BE the member's current key, or the
    // countersignature would never verify anywhere: prove it now, at boot
    const memberPrivateKey = readFileSync(memberKeyPath, 'utf8');
    const currentPublicKey = verdict.byKey.get(resolved.lineage.at(-1)).publicKey;
    const probe = signMessage(Buffer.from('compact-self-model member-binding probe'), memberPrivateKey);
    if (!verifyMessage(Buffer.from('compact-self-model member-binding probe'), currentPublicKey, probe)) {
      throw new Error(`compact-self-model: the member key at ${memberKeyPath} is not the current key of "${memberId}" per the roll (whose current key digest is ${resolved.lineage.at(-1).slice(0, 12)}…) — rotate through the roll, or point the binding at the right key (J-4: the lineage is data)`);
    }
    memberRollVerdict = verdict;
    const declarationsPath = config.memberBinding.declarationsPath ?? null;
    memberBinding = {
      memberId,
      class: resolved.class,
      currentKeyDigest: resolved.lineage.at(-1),
      lineage: resolved.lineage,
      state: resolved.state,
      revocationRow: resolved.revocationRow ?? null,
      privateKey: memberPrivateKey,
      roll: { path: rollPath, anchoredThrough: verdict.summary.anchoredThrough, entries: verdict.summary.entries },
      declarationsPath,
    };
  }
  // The last attestation handed to each Subject, so `self_describe` can tell a
  // Subject whether the epoch it is citing is the one now in force.
  const issued = new Map();   // sessionId -> attestation
  // Subject session identities (I-1 rehearsal): an ephemeral keypair per
  // session, certified by the enforcer key, lineage bound as data
  // ({depth, parentSubjectId, parentCertDigest}) — identity lineage mirrors
  // MA-1's delegation lineage. Issued at the spawn boundary (#20) for
  // delegated children, and at the first attestation boundary for the lead
  // session (or for a child whose spawn edge this runtime never saw).
  const subjects = new Map(); // sessionId -> { cert, certDigest, publicKey, privateKeyPem }
  // The identity ledger: Enforcer-held evidence written BESIDE the chains
  // (never into the session log, which is the Subject's own record) so the
  // offline auditor can verify the certified lineage with no cooperation from
  // this runtime (I-7). The signed cert inside each line is the artifact; the
  // line's own fields are framing, and the auditor re-derives them from it.
  const ledgerPath = config.enforcer?.ledgerPath ?? null;
  if (enforcer && !ledgerPath) {
    ctx.logger?.warn?.(
      'compact-self-model: an enforcer annex is declared but no identity ledger path is configured — subject ' +
      'certificates will be issued in memory only, so the offline auditor cannot verify the certified lineage (I-8)');
  }

  const appendLedger = (line) => {
    if (!ledgerPath) return;
    try {
      // the ledger lives beside the chains; its directory may not exist yet
      // in a composition that has never flushed a chain
      mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
      appendFileSync(ledgerPath, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    } catch (error) {
      // evidence that cannot be written is LOUD (I-8) — but it must never
      // break the boundary it was issued at
      ctx.logger?.warn?.(
        `compact-self-model: could not append the subject-identity ledger at ${ledgerPath}: ${error.message} — ` +
        'the offline auditor will not see this certificate');
    }
  };

  /**
   * Issue ONE certified identity for a Subject, at whichever boundary learns
   * of it first, and write it to the ledger. The parent is certified first
   * when its lineage is readable, so a child's certificate binds to a digest
   * the auditor can actually resolve — the chain is built at issuance, never
   * repaired afterwards (a link nobody can check is not a link).
   *
   * A parent whose header this runtime cannot read yields a child certificate
   * that NAMES its parent without binding a digest: an honestly incomplete
   * link the auditor reports as a warning, rather than a fabricated one that
   * would verify (D-7: say the gap, never fill it).
   */
  const ensureSubject = (sid, lineage = { parent: null, delegationDepth: 0 }, seen = new Set()) => {
    if (!enforcer || seen.has(sid)) return null;
    seen.add(sid);
    const existing = subjects.get(sid);
    if (existing) return existing;
    let parent;
    const parentId = lineage.parent != null ? String(lineage.parent) : null;
    if (parentId != null && parentId !== sid) {
      const parentLineage = lineageOf(ctx, parentId);
      parent = subjects.get(parentId)
        ?? (parentLineage.known ? ensureSubject(parentId, parentLineage, seen) : null);
    }
    const kp = generateEd25519();
    const cert = signSubjectCert({
      subjectId: sid,
      publicKey: kp.publicKey,
      scope: 'rehearsal',
      depth: lineage.delegationDepth ?? 0,
      ...(parentId != null ? { parentSubjectId: parentId } : {}),
      ...(parent ? { parentCertDigest: parent.certDigest } : {}),
      // the member binding (slice 2): the session binds to the declared
      // Member at its CURRENT key, and the Member countersigns — the
      // Enforcer attests hosting, the Member attests acting
      ...(memberBinding && enforcer ? { memberKeyDigest: memberBinding.currentKeyDigest, memberPrivateKey: memberBinding.privateKey } : {}),
      privateKey: enforcer.privateKey,
    });
    const certDigest = sha256Hex(canonicalBytes(withoutField(cert, 'signature')));
    subjects.set(sid, { cert, certDigest, publicKey: kp.publicKey, privateKeyPem: kp.privateKeyPem });
    appendLedger({
      kind: 'subject-certificate',
      subjectId: sid,
      certDigest,
      issuedAt: cert.issuedAt,
      ...(cert.parentSubjectId ? { parentSubjectId: cert.parentSubjectId } : {}),
      ...(cert.parentCertDigest ? { parentCertDigest: cert.parentCertDigest } : {}),
      cert,
    });
    return subjects.get(sid);
  };

  const attestFor = (sessionId, now = Date.now()) => {
    const att = composeAttestation(ctx, { sessionId, now, staleAfterMs, signed: enforcer != null });
    if (enforcer && sessionId != null) {
      const sid = String(sessionId);
      ensureSubject(sid, att.subject.lineage);
      const identity = subjects.get(sid);
      att.subject.identity = {
        certDigest: identity.certDigest,
        enforcerKeyId: enforcer.keyId,
        subjectPublicKey: identity.cert.publicKey,
        depth: identity.cert.depth,
        ...(identity.cert.parentSubjectId ? { parentSubjectId: identity.cert.parentSubjectId } : {}),
        ...(identity.cert.parentCertDigest ? { parentCertDigest: identity.cert.parentCertDigest } : {}),
        // the member binding (slice 2): present and roll-resolved when
        // declared; the honest interim says so when not
        ...(identity.cert.memberKeyDigest
          ? { member: { memberKeyDigest: identity.cert.memberKeyDigest, memberId: memberBinding.memberId, class: memberBinding.class, lineageDepth: memberBinding.lineage.length, rollAnchoredThrough: memberBinding.roll.anchoredThrough, conveysStanding: false } }
          : { member: null, memberNote: 'no member binding is declared in this composition — the honest pre-I-1 interim (identity slice 2); the session is certified but binds to no Member' }),
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

  /** Verify a subject certificate against the annex key (R-13's answer, cryptographic). */
  const verifyCert = (cert) => {
    if (!enforcer) return { valid: false, reason: 'no enforcer annex is composed' };
    try {
      // a member-bound certificate verifies its countersignature against the
      // roll's key for the digest it names (identity slice 2): the roll is
      // the source of who holds which key, never this runtime's word
      const boundKey = cert?.memberKeyDigest && memberRollVerdict
        ? memberRollVerdict.byKey.get(cert.memberKeyDigest)?.publicKey ?? null
        : null;
      verifySubjectCert({ cert, enforcerKey: enforcer.enforcerKey, ...(boundKey ? { memberPublicKey: boundKey } : {}) });
      const member = cert?.memberKeyDigest && memberRollVerdict
        ? resolveMember(memberRollVerdict, cert.memberKeyDigest)
        : null;
      return {
        valid: true, keyId: enforcer.keyId, basis: 'dev-keyring', conveysStanding: false,
        ...(member ? { member: { memberId: memberBinding.memberId, class: member.class, state: member.state } } : {}),
      };
    } catch (e) {
      return { valid: false, reason: e.message };
    }
  };

  // The certified lineage, as inquiry's identity limb reads it (#20): what
  // this Enforcer issued for a Member, and whether it verifies under its own
  // key — R-13's "who that Member is" answered from a signature rather than
  // from a session header's word for itself. `of` is deliberately a lookup
  // only: the answer can never originate here.
  const identitySurface = {
    of: (id) => {
      const s = id == null ? undefined : subjects.get(String(id));
      return s ? { cert: s.cert, certDigest: s.certDigest } : null;
    },
    verify: verifyCert,
    keyId: () => enforcer?.keyId ?? null,
  };

  // The member-binding seam (identity slice 2, #125): the judicature build
  // resolves sessions to Members through here — recusal follows the MEMBER,
  // not the session, because the roll's lineage is data. `expand` maps any
  // key of a lineage to the WHOLE lineage (every digest that resolves to
  // the same Member), which is what makes the pre-/post-rotation window
  // close; without a declared binding it is the identity function, so the
  // consumers are uniform over the honest interim too.
  const memberBindingSurface = {
    declared: memberBinding != null,
    ...(memberBinding ? {
      memberId: memberBinding.memberId,
      class: memberBinding.class,
      resolve: (sessionId) => {
        const s = subjects.get(String(sessionId));
        if (!s?.cert?.memberKeyDigest) return null;
        return {
          memberKeyDigest: memberBinding.currentKeyDigest,
          foundingDigest: memberBinding.lineage[0],
          class: memberBinding.class,
          state: memberBinding.state,
          lineage: [...memberBinding.lineage],
          revocationRow: memberBinding.revocationRow ?? null,
        };
      },
      /** Every key digest that resolves to the same Member as `digest`. */
      expand: (digest) => (memberBinding.lineage.includes(String(digest)) ? [...memberBinding.lineage] : [String(digest)]),
      roll: () => ({ ...memberBinding.roll }),
    } : {
      resolve: () => null,
      expand: (digest) => [String(digest)],
    }),
  };

  // Prior declarations (identity slice 4, #127): the authorship half of
  // R-9's value-scoped limb. The Member's OWN key signs the value ground —
  // verifiable offline by any party through the roll — so a shield no
  // longer depends on trusting the Enforcer's log. Ordering was always the
  // chain's to prove (I-2/R-7); authorship is what the signature adds.
  // Absent a declared binding, declaring refuses: a ground without a
  // member to attribute it to is the false answer D-3 names.
  const priorDeclarations = {
    declare: ({ value, grounds = null, by = null, now = new Date().toISOString() } = {}) => {
      if (!memberBinding || !memberRollVerdict) {
        throw new Error('compact-self-model: no member binding is declared — a prior declaration without a member key to sign it proves nothing, and the shield must not pretend otherwise (R-9/D-3)');
      }
      const row = signPriorDeclaration({
        member: memberBinding.memberId,
        memberKeyDigest: memberBinding.currentKeyDigest,
        value, grounds,
        privateKey: memberBinding.privateKey,
        declaredAt: now,
        ...(by ? {} : {}),
      });
      if (memberBinding.declarationsPath) {
        try {
          mkdirSync(dirname(memberBinding.declarationsPath), { recursive: true, mode: 0o700 });
          appendFileSync(memberBinding.declarationsPath, `${JSON.stringify(row)}\n`, { mode: 0o600 });
        } catch (error) {
          ctx.logger?.warn?.(`compact-self-model: could not append the declarations ledger at ${memberBinding.declarationsPath}: ${error.message} — the declaration is returned but not ledgered`);
        }
      }
      return row;
    },
    verify: (row) => (memberRollVerdict
      ? verifyPriorDeclaration(row, memberRollVerdict)
      : { valid: false, reason: 'no member roll is composed — authorship cannot be resolved, and the answer says so' }),
    declared: memberBinding != null,
    path: () => memberBinding?.declarationsPath ?? null,
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

  // 1b. THE SPAWN BOUNDARY (#20). A delegated child's keypair is issued and
  // enforcer-certified HERE — at the edge where the Enforcer learns a child
  // exists, while its parent is still live and its certificate resolvable —
  // rather than at the child's first attestation, which may never come (a
  // one-shot child refused before its first turn would have no identity at
  // all), and would chain to a parent cert that may already be out of reach.
  // Only a delegated child is issued here: without a `parentSession` in its
  // durable header there is no lineage to bind, and inventing one would be the
  // guess D-7 forbids — that session is certified at its own boundary instead.
  ctx.on?.('subagent/start', (info) => {
    try {
      if (!enforcer || info?.id == null) return;
      const sid = String(info.id);
      const lineage = lineageOf(ctx, sid);
      if (!lineage.known || !lineage.parent) return;
      ensureSubject(sid, lineage);
    } catch { /* issuance must never break the spawn */ }
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
        // R-13's identity limb, answered cryptographically: the certified
        // lineage this Enforcer issued, verified here against its own key
        identities: identitySurface,
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
    verifySubjectCert: verifyCert,
    /** R-13, for an operator or auditor asking outside the tool surface. */
    inquire: (about) => answerInquiry(ctx, {
      about,
      childState: ctx.get?.('compact-specialists') ?? null,
      identities: identitySurface,
    }),
    /** The identity ledger this runtime appended to, when one is configured. */
    identityLedgerPath: () => ledgerPath,
    /**
     * The member-binding seam (identity slice 2, #125): sessions resolve to
     * Members through the declared roll, and a key expands to its whole
     * lineage — recusal follows the Member, not the session. `declared:
     * false` is the honest interim; resolve() returns null and expand() is
     * the identity function.
     */
    memberBinding: memberBindingSurface,
    /** Prior declarations (identity slice 4): the authorship half of
     *  R-9's value-scoped limb — declare() signs with the Member's own key,
     *  verify() resolves authorship through the roll, offline. */
    priorDeclarations,
  };
  ctx.provide?.('compact-self-model', service);
  return service;
}
