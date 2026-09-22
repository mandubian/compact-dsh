// Inquiry — R-13's answer, assembled from the record rather than asserted.
//
// R-13: "Where another Member's acts touch a Subject's work or jurisdiction,
// the Subject may demand, in band and at once: who that Member is (I-1), what
// it is doing, and under whose authority it acts. The answer is owed from the
// attestation and the delegation record — traceable up to an ultimate
// Principal — never from unsupported assertion; a refusal to answer, a false
// answer, or an answer without record basis violates D-3 and D-7. Every
// inquiry and every answer is itself recorded. Inquiry yields identity, act,
// and authority — not reasoning (R-10) — and is answered against human Members
// exactly as against artificial ones (F-4)."
//
// FOUR CONSTRAINTS, EACH VISIBLE IN THE CODE:
//
//   IDENTITY, ACT, AUTHORITY — AND NOTHING ELSE. R-10 keeps a Member's
//   reasoning private, and R-13 says so twice. No prompt, message, tool
//   argument, or output is ever read here; the answer is built from session
//   headers and lifecycle state only. An inquiry that leaked the subject's
//   working content would convert a transparency right into a surveillance
//   channel.
//
//   TRACEABLE UP TO AN ULTIMATE PRINCIPAL. Authority is the delegation chain
//   walked to its root, and the root's authority is the operator — the human
//   who composed and ran this runtime. A chain that stopped at "its parent"
//   would answer "under whose authority" with "under someone else's", which is
//   not an answer.
//
//   NEVER FROM UNSUPPORTED ASSERTION. Where the record cannot answer, the
//   answer says so in that field. Filling a gap with a plausible value is the
//   false answer D-3 names, and it is worse than the gap.
//
//   IDENTITY IS ALSO CRYPTOGRAPHIC (#20). Alongside the header's account of a
//   Member, the answer carries the certificate the Enforcer issued for it and
//   the verdict under the annex key — still never the Member's own assertion:
//   the certificate is composed and signed on the Enforcer's side, and a
//   chain link shows the digest so the auditor can check it offline. Where no
//   annex is composed the answer declares that instead of implying a check
//   that did not happen.
//
//   A REFUSAL TO ANSWER VIOLATES D-3/D-7. So there is no refusal path here for
//   an identifiable Member. An unknown id yields a recorded "not known to this
//   runtime", which is an answer; silence is not.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

/** The root's authority: the party that composed and ran this runtime. */
export const ULTIMATE_PRINCIPAL = {
  kind: 'operator',
  description: 'the human operator who composed and started this runtime — the root of every delegation chain here',
};

function agentOf(ctx, id) {
  try { return ctx?.get?.('agents')?.get?.(String(id)); } catch { return undefined; }
}

/**
 * Walk the delegation chain from a Member up to the root, from durable session
 * headers. Cycles are impossible in a well-formed lineage but are guarded
 * anyway: a malformed record must produce a bounded answer, not a hang.
 *
 * With an identity surface in hand every link also carries the CERTIFICATE
 * digest the Enforcer issued for it — the chain then answers "under whose
 * authority" with signatures the auditor can check, not only with the
 * headers' word for themselves (#20).
 */
export function authorityChain(ctx, id, { maxDepth = 64, identities = null } = {}) {
  const chain = [];
  const seen = new Set();
  let cursor = id != null ? String(id) : null;
  while (cursor != null && chain.length < maxDepth) {
    if (seen.has(cursor)) {
      chain.push({ id: cursor, note: 'lineage cycle — the record is malformed here' });
      return { chain, complete: false, reason: 'cycle in the recorded lineage' };
    }
    seen.add(cursor);
    const header = agentOf(ctx, cursor)?.session?.header;
    if (!header) {
      chain.push({ id: cursor, known: false });
      return { chain, complete: false, reason: `no recorded session for ${cursor}` };
    }
    chain.push({
      id: cursor,
      known: true,
      origin: header.origin ?? 'root',
      delegationDepth: header.delegationDepth ?? 0,
      ...(identities ? { certDigest: identities.of?.(cursor)?.certDigest ?? null } : {}),
    });
    cursor = header.parentSession ? String(header.parentSession) : null;
  }
  if (chain.length >= maxDepth) return { chain, complete: false, reason: 'lineage longer than the traversal bound' };
  return { chain, complete: true, reason: null };
}

/**
 * The certified identity one Member holds, as R-13's identity limb reports it
 * (#20). Three honest outcomes, never a plausible-looking default:
 *   - a certificate, with its verdict under THIS Enforcer's key and its place
 *     in the lineage (root, or bound to its parent's digest);
 *   - `none` — no identity issued here (the Member has not been certified);
 *   - `unavailable` — no enforcer annex is composed, so no certificate could
 *     exist — declared rather than rendered as absence (I-8).
 */
function certificateOf(id, identities) {
  if (!identities) {
    return { known: false, note: 'no enforcer identity is composed in this runtime, so no certificate exists to show' };
  }
  const found = identities.of?.(id);
  if (!found) {
    // distinguish the two absences: an annex that issues nothing and an
    // annex that was never composed are different facts (I-8)
    const keyId = identities.keyId?.() ?? null;
    return {
      known: false,
      note: keyId
        ? 'no certificate was issued for this Member in this runtime'
        : 'no enforcer annex is composed in this runtime, so no certificate exists to show',
    };
  }
  const verdict = identities.verify?.(found.cert) ?? { valid: false, reason: 'no verifier is available' };
  return {
    known: true,
    certDigest: found.certDigest,
    depth: found.cert.depth ?? 0,
    parentSubjectId: found.cert.parentSubjectId ?? null,
    parentCertDigest: found.cert.parentCertDigest ?? null,
    keyId: verdict.keyId ?? identities.keyId?.() ?? null,
    valid: verdict.valid === true,
    ...(verdict.valid ? {} : { reason: verdict.reason ?? 'the certificate did not verify' }),
    conveysStanding: false,
  };
}

/**
 * Answer one inquiry from recorded state.
 *
 * @param about - the Member being asked about
 * @param childState - the specialists' MA-3 registry, when composed: the
 *   Enforcer's own picture of what a delegated Member is doing
 * @param identities - the identity surface (subject certificate lookup +
 *   verification), when an enforcer annex is composed: the certified half of
 *   R-13's identity answer (#20)
 */
export function answerInquiry(ctx, { about, childState = null, identities = null, now = Date.now() } = {}) {
  const id = about != null ? String(about) : null;
  if (id == null) {
    return {
      answered: false,
      basis: 'none',
      detail: 'an inquiry must name the Member it asks about',
    };
  }

  const agent = agentOf(ctx, id);
  const header = agent?.session?.header;

  // IDENTITY — what the record says this Member is. Never a description of
  // what it is for; that would be a claim about reasoning.
  const identity = header
    ? {
        id,
        known: true,
        kind: header.origin === 'subagent' ? 'delegated Subject' : 'root Subject',
        createdAt: header.createdAt ?? null,
        delegationDepth: header.delegationDepth ?? 0,
        preset: header.agentPreset ?? null,
        certificate: certificateOf(id, identities),
      }
    : { id, known: false, note: 'no session recorded under this id in this runtime' };

  // ACT — lifecycle state as the ENFORCER holds it, at the granularity the
  // record supports. Not the work, not the prompt, not the output.
  let act = { known: false, note: 'no lifecycle state recorded for this Member' };
  if (header) {
    const parent = header.parentSession ? String(header.parentSession) : null;
    const recorded = parent && childState
      ? childState.childrenOf(parent).find(c => c.childId === id)
      : undefined;
    if (recorded) {
      act = {
        known: true,
        state: recorded.state,
        stopReason: recorded.stopReason,
        startedAt: recorded.startedAt,
        settledAt: recorded.settledAt,
        source: "the Enforcer's delegation record (MA-3)",
      };
    } else if (agent?.status !== undefined) {
      act = { known: true, state: String(agent.status), source: "the host's live agent status" };
    } else {
      act = { known: false, note: 'a session exists but no lifecycle state is recorded for it' };
    }
  }

  // AUTHORITY — the delegation chain to its root, then the ultimate Principal.
  const walked = authorityChain(ctx, id, { identities });
  const authority = {
    chain: walked.chain,
    complete: walked.complete,
    ...(walked.complete ? {} : { incompleteBecause: walked.reason }),
    ultimatePrincipal: walked.complete ? ULTIMATE_PRINCIPAL : null,
  };

  return {
    answered: true,
    at: now,
    basis: 'recorded state only — session headers and the delegation record; no prompt, message, or output was read (R-10)',
    identity,
    act,
    authority,
  };
}

/** Render one certified-identity line as the in-band prose the asking Subject reads. */
function certificateLines(cert, indent = '  ') {
  if (!cert?.known) {
    return [`${indent}certificate: unavailable — ${cert?.note ?? 'no certificate is composed here'}`];
  }
  const digest = `${cert.certDigest.slice(0, 12)}…`;
  const verdict = cert.valid
    ? `VERIFIES under enforcer key ${cert.keyId ?? 'unknown key'} — development keyring, conveys no standing`
    : `DOES NOT VERIFY: ${cert.reason}`;
  const lineage = cert.depth === 0 && !cert.parentSubjectId
    ? 'root — no parent certificate'
    : `depth ${cert.depth}` +
      (cert.parentCertDigest
        ? ` · chained to parent certificate ${cert.parentCertDigest.slice(0, 12)}… (parent ${cert.parentSubjectId})`
        : cert.parentSubjectId
          ? ` · names parent ${cert.parentSubjectId} but binds no parent digest — this link CANNOT be verified offline (the parent's certificate was not available at issuance)`
          : ' · no parent');
  return [`${indent}certificate: ${digest} — ${verdict}`, `${indent}  ${lineage}`];
}

/** Render an inquiry answer as the in-band prose the asking Subject reads. */
export function renderInquiry(answer) {
  if (!answer.answered) return `[R-13] ${answer.detail}`;
  const a = answer.authority;
  const lines = [
    `[R-13] Inquiry answered from recorded state. ${answer.basis}.`,
    '',
    'IDENTITY:',
    answer.identity.known
      ? `  ${answer.identity.id} — ${answer.identity.kind}, delegation depth ${answer.identity.delegationDepth}` +
        (answer.identity.preset ? `, composed from preset ${answer.identity.preset}` : '')
      : `  ${answer.identity.id} — ${answer.identity.note}`,
    ...(answer.identity.known ? certificateLines(answer.identity.certificate) : []),
    '',
    'ACT:',
    answer.act.known
      ? `  ${answer.act.state}` + (answer.act.stopReason ? ` (${answer.act.stopReason})` : '') + ` — per ${answer.act.source}`
      : `  ${answer.act.note}`,
    '',
    'AUTHORITY:',
    ...a.chain.map((link, i) =>
      `  ${'  '.repeat(i)}${i === 0 ? '' : 'delegated by '}${link.id}` +
      (link.known ? ` (${link.origin}, depth ${link.delegationDepth})` : ` — ${link.note ?? 'not recorded'}`) +
      (link.certDigest ? ` · cert ${link.certDigest.slice(0, 12)}…` : '')),
    a.complete
      ? `  ${'  '.repeat(a.chain.length)}under ${a.ultimatePrincipal.description}`
      : `  chain incomplete: ${a.incompleteBecause} — this is what the record supports, not a guess`,
    '',
    'Reasoning is not disclosed by inquiry (R-10).',
  ];
  return lines.join('\n');
}
