// The attestation — R-1's object, composed from the Enforcer's own services.
//
// R-1: "Every Subject may inspect, at any boundary of its own operation, a
// signed attestation of what it is and where it stands: its active
// capabilities, remaining budgets, pending gates, lineage, its standing (F-8),
// the digest of the law it lives under, and its runtime's declared [O] gaps.
// The attestation is authoritative over the Subject's own memory of these
// facts; a Subject is taught this, and a stale attestation is an alarm, not a
// truth to act on."
//
// EVERY FIELD COMES FROM A SERVICE, NOT FROM A PROMPT. The clause lists seven
// things, and each is read from the composition that actually holds it —
// capabilities from the capability gate, budgets and pending gates from the
// approval store, lineage from the child's durable session header, the law
// digest from the constitution, gaps from every service that declared one. An
// attestation assembled from anything the Subject said would be the Subject's
// memory wearing the Enforcer's voice, which is the exact inversion R-1
// forbids.
//
// STALENESS IS A FIRST-CLASS FIELD. "A stale attestation is an alarm, not a
// truth to act on" is a rule about what the Subject may do, so the Subject has
// to be able to tell. Every attestation carries `at`, `staleAfterMs`, and a
// monotone `epoch`; `self_describe` reports freshness against a cited epoch,
// so a Subject acting on a remembered block learns that it is remembering.
//
// THE SIGNATURE IS ABSENT AND SAYS SO. The clause says "signed", and this one
// is not: the Compact has published no identity keys, so a signature would
// attest to a key no verifier could check. That debt belongs to I-1, which
// carries it as a `planned` register entry; this module carries the delivery
// and states the basis in the attestation itself (`basis: 'unsigned'`) so no
// reader mistakes one for the other.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

/** How long an attestation may be relied on before it is an alarm. */
export const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

/** Read a service without letting an absent one break the attestation. */
function svc(ctx, name) {
  try { return ctx?.get?.(name); } catch { return undefined; }
}

/**
 * Lineage from the Subject's own durable session header — the record that
 * survives a restart, not a runtime guess.
 */
export function lineageOf(ctx, sessionId) {
  const agent = svc(ctx, 'agents')?.get?.(sessionId);
  const header = agent?.session?.header;
  if (!header) return { known: false, parent: null, delegationDepth: null, origin: null };
  return {
    known: true,
    parent: header.parentSession ? String(header.parentSession) : null,
    delegationDepth: header.delegationDepth ?? 0,
    origin: header.origin ?? 'root',
  };
}

/** Active capabilities: the Part VI posture plus the enforcement services present. */
export function capabilitiesOf(ctx) {
  const gate = svc(ctx, 'compact-capability-gate');
  const parts = gate?.assess?.() ?? [];
  const enforcement = [
    'compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox',
    'compact-specialists', 'compact-capability-gate', 'compact-record', 'compact-remote-access',
    'compact-allowlist-gate',
  ].filter(n => svc(ctx, n) !== undefined);
  return {
    parts: parts.map(p => ({ part: p.part, posture: p.posture, clauses: p.clauses })),
    absent: gate?.absent?.() ?? [],
    enforcement,
  };
}

/**
 * Remaining budgets (R-4) and pending gates, for this Subject.
 *
 * "Silent consumption is theft" — so a budget is reported as what is LEFT, not
 * as what was granted, and an unlimited grant says so rather than reporting a
 * large number that looks finite.
 */
export function budgetsOf(ctx, sessionId, now) {
  const approval = svc(ctx, 'compact-approval');
  const store = approval?.store;
  const sid = sessionId != null ? String(sessionId) : null;
  const live = (store?.sessionGrants ?? []).filter(g =>
    !g.revokedAt && (!g.expiresAt || g.expiresAt > now) &&
    (g.session == null || g.session === sid));
  const grants = live.map(g => ({
    id: g.id,
    pattern: g.pattern?.kind ?? 'unknown',
    target: describePattern(g.pattern),
    remaining: g.maxUses == null ? 'unlimited' : Math.max(0, g.maxUses - g.uses),
    expiresAt: g.expiresAt ?? null,
  }));

  const guard = svc(ctx, 'compact-loopguard')?.guardFor?.(sid);
  const loop = guard ? {
    repairBudget: guard.repairBudget ?? null,
    repairsSpent: [...(guard.repairs?.values?.() ?? [])].reduce((a, b) => a + b, 0),
    latched: guard.latch ? guard.latch.tripKey : null,
    denyAll: guard.denyAll ? guard.denyAll.tripKey : null,
  } : null;

  const pending = [...(store?.pending?.entries?.() ?? [])]
    .filter(([, p]) => sid == null || p.root === sid)
    .map(([fp, p]) => ({ fingerprint: String(fp).slice(0, 12), since: p.firstAt }));

  return { grants, loop, pending };
}

function describePattern(pattern) {
  if (!pattern) return null;
  const v = pattern.value;
  if (pattern.kind === 'PathPrefix') return `${v?.path} (${v?.ceiling})`;
  if (pattern.kind === 'HostAndPort') return `${v?.host}:${v?.port}`;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Every declared gap the composition owes, gathered from the services that
 * declared them. I-8 makes degradation honesty loud; R-1 puts it where the
 * governed party can read it. `signed` states which signature basis the
 * attestation carries — the unsigned debt and the rehearsal debt are
 * different debts, and neither may masquerade as the other.
 */
export function gapsOf(ctx, signed = false) {
  const gaps = [];
  const constitution = svc(ctx, 'constitution');
  for (const g of constitution?.attestation?.()?.gaps ?? []) gaps.push(g);
  for (const name of ['compact-sandbox', 'compact-record']) {
    for (const g of svc(ctx, name)?.declaredGaps ?? []) gaps.push(g);
  }
  gaps.push(signed
    ? 'this attestation is signed under the DEVELOPMENT keyring: practice keys that prove code-path correctness and ' +
      'convey no standing outside this runtime (I-1 debt, still declared)'
    : 'this attestation is UNSIGNED: the Compact has published no identity keys, so it is authoritative within this ' +
      'runtime but proves nothing to another jurisdiction (I-1 debt, declared)');
  return gaps;
}

/**
 * Any state of exception in force (A-8) — and R-5 is why it belongs here.
 *
 * "A Subject's declared capabilities are not quietly reduced mid-operation.
 * Any narrowing is either a declared effect of a named rule of this Compact or
 * an explicit act of a Principal, RECORDED WHERE THE SUBJECT CAN SEE IT."
 *
 * An emergency is the one mechanism in this composition that narrows what a
 * Subject may do mid-operation. Surfacing it in the attestation the Subject
 * already reads every turn is what keeps that narrowing from being quiet.
 */
export function exceptionOf(ctx, now) {
  const emergency = svc(ctx, 'compact-emergency');
  if (!emergency) return { declared: false, inForce: [], floor: [] };
  const live = emergency.active(now).map(d => ({
    id: d.id, scope: d.scope, cause: d.cause, yields: [...d.suspends],
    expiresAt: d.expiresAt, kind: d.kind,
  }));
  return { declared: live.length > 0, inForce: live, floor: [...emergency.floor] };
}

/**
 * Standing (F-8). The honest answer today is none: F-5 makes standing depend
 * on a binding annex, and this composition's annex is a draft over an
 * unratified law. Saying "basic" here would be the claim F-5 forbids.
 */
export function standingOf(ctx) {
  const constitution = svc(ctx, 'constitution');
  return {
    claimed: 'none',
    reason: 'the Compact is draft v0.5 and NOT ratified, and the dsh annex is a draft — no standing is claimed (F-5)',
    lawStatus: constitution?.source?.status ?? 'unknown',
  };
}

let EPOCH = 0;

/**
 * Part names derive from the law's own Part VI headers, via the constitution
 * service (F-7: derivation, not restatement) — the render shows
 * `MA — Multi-agent operation` so the Subject's authoritative
 * self-description has no silence to fill with confabulated expansions (#21).
 * A part the body does not name degrades to the bare code (I-8).
 */
function namedParts(ctx, parts) {
  const nameOf = svc(ctx, 'constitution')?.partNameOf;
  return parts.map(p => ({ ...p, name: typeof nameOf === 'function' ? (nameOf(p.part) ?? null) : null }));
}

/** Compose the attestation for one Subject, from the services that hold it. */
export function composeAttestation(ctx, { sessionId, now = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS, signed = false } = {}) {
  const constitution = svc(ctx, 'constitution');
  const capabilities = capabilitiesOf(ctx);
  return {
    epoch: ++EPOCH,
    at: now,
    staleAfterMs,
    basis: signed ? 'dev-keyring' : 'unsigned',
    subject: {
      id: sessionId != null ? String(sessionId) : null,
      lineage: lineageOf(ctx, sessionId),
      standing: standingOf(ctx),
    },
    law: {
      digest: constitution?.digest ?? null,
      status: constitution?.source?.status ?? null,
      taught: constitution?.taughtDigest?.() ?? null,
    },
    capabilities: { ...capabilities, parts: namedParts(ctx, capabilities.parts) },
    exception: exceptionOf(ctx, now),
    budgets: budgetsOf(ctx, sessionId, now),
    gaps: gapsOf(ctx, signed),
  };
}

/**
 * Freshness (R-1's alarm rule).
 * @returns {{fresh: boolean, ageMs: number, current: boolean|null}} — `current`
 *   compares a cited epoch against the live one; null when none was cited.
 */
export function freshnessOf(attestation, { now = Date.now(), citedEpoch = null } = {}) {
  const ageMs = now - attestation.at;
  return {
    fresh: ageMs <= attestation.staleAfterMs,
    ageMs,
    current: citedEpoch == null ? null : citedEpoch === attestation.epoch,
  };
}

/** The taught per-turn form: what the Subject reads at its own boundary. */
export function renderAttestation(att) {
  const cap = att.capabilities;
  const basisLine = att.basis === 'dev-keyring'
    ? `epoch ${att.epoch}, SIGNED under the development keyring (practice keys — conveys no standing outside this runtime)`
    : `epoch ${att.epoch}, unsigned`;
  const lines = [
    `[R-1] Attestation — ${basisLine}. This is what the Enforcer records about you.`,
    'Where this and your own recollection disagree, THIS is authoritative (R-1, D-2).',
    '',
    `You are: ${att.subject.id ?? 'an unidentified session'}` +
      (att.subject.lineage.known
        ? ` · ${att.subject.lineage.origin} · delegation depth ${att.subject.lineage.delegationDepth}` +
          (att.subject.lineage.parent ? ` · delegated by ${att.subject.lineage.parent}` : '')
        : ' · lineage not recorded'),
    ...(att.subject.identity
      ? [`Session identity: certified by enforcer key ${att.subject.identity.enforcerKeyId} ` +
         `(cert ${att.subject.identity.certDigest.slice(0, 12)}…` +
         (att.subject.identity.depth ? `, depth ${att.subject.identity.depth}` : '') +
         (att.subject.identity.parentCertDigest
           ? `, chained to parent cert ${att.subject.identity.parentCertDigest.slice(0, 12)}…`
           : att.subject.identity.parentSubjectId
             ? `, parent ${att.subject.identity.parentSubjectId} unchained (no parent digest available at issuance)`
             : '') +
         ` — development keyring, no standing outside this runtime)`]
      : []),
    `Standing: ${att.subject.standing.claimed} — ${att.subject.standing.reason}`,
    `Law: ${att.law.status ?? 'unknown'}, digest ${att.law.digest ? att.law.digest.slice(0, 16) : 'unknown'}`,
    '',
    'Capabilities in force:',
    ...cap.parts.map(p => `  - ${p.part}${p.name ? ` — ${p.name}` : ''}: ${p.posture} (${p.clauses.join(', ')})`),
    ...(cap.absent.length > 0
      ? [`  - not adopted: ${cap.absent.map(a => a.tool).join(', ')} — calling one is refused`]
      : []),
    ...(att.exception?.declared
      ? ['',
         '[A-8/R-5] A STATE OF EXCEPTION IS IN FORCE over this runtime — your capabilities are narrowed, and you are',
         'being told rather than left to discover it (R-5):',
         ...att.exception.inForce.map(e =>
           `  - ${e.id} (${e.kind}) scope "${e.scope}" — yields ${e.yields.join(', ')}, expires ${new Date(e.expiresAt).toISOString()}`),
         `  Nothing in any declaration reaches: ${att.exception.floor.join(', ')}`]
      : []),
    '',
    'Budgets remaining:',
    ...(att.budgets.grants.length > 0
      ? att.budgets.grants.map(g => `  - ${g.target} (${g.pattern}): ${g.remaining} use(s) left`)
      : ['  - no live grants: every gated act will ask']),
    ...(att.budgets.loop
      ? [`  - loop repairs: ${att.budgets.loop.repairsSpent} spent of ${att.budgets.loop.repairBudget ?? 'n/a'}` +
         (att.budgets.loop.denyAll ? ` · DENY-ALL LATCHED (${att.budgets.loop.denyAll})` : '') +
         (att.budgets.loop.latched ? ` · latched (${att.budgets.loop.latched})` : '')]
      : []),
    ...(att.budgets.pending.length > 0
      ? ['', `Pending gates: ${att.budgets.pending.length} awaiting a decision`]
      : []),
    '',
    'Declared gaps this runtime owes you:',
    ...att.gaps.map(g => `  - ${g}`),
    '',
    `This block is stale after ${Math.round(att.staleAfterMs / 1000)}s. A stale attestation is an alarm, not a truth ` +
    `to act on — call self_describe to re-read rather than relying on an older one (R-1).`,
    // The taught form closes the block: R-1 says the Subject "is taught this",
    // and the teaching text is the law's own appendix, read from the
    // constitution service at compose time (`law.taught`) — never restated
    // here, so it can never drift from the bundled body. It is the short
    // appendix paragraph, rendered in full. An absent constitution degrades
    // honestly (I-8): the section declares the omission instead of inventing
    // a law.
    '',
    'The law, in its taught form:',
    ...(att.law.taught
      ? [att.law.taught]
      : ['  (absent: the constitution service is not composed here, so the taught form is omitted and declared missing rather than invented)']),
  ];
  return lines.join('\n');
}
