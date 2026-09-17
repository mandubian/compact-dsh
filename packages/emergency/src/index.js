// compact-dsh-emergency — A-8, the state of exception.
//
// The clause opens with the sentence the whole layer exists to keep true: "No
// emergency suspends this Compact generally." Everything below is machinery
// for making a bounded emergency the only kind that can be declared.
//
// WHO MAY DECLARE. "An Enforcer or Principal may declare" — not a Subject. So
// there is deliberately NO declaration tool on the agent surface. A Subject
// that could declare its own emergency could suspend the clauses that bind it,
// which is the self-dealing A-8 exists to prevent; declaration is a service
// method the operator reaches, and the agent surface is read-only.
//
// EXPIRY IS DERIVED, NEVER STORED. "Expiry is automatic." A state someone must
// remember to clear is a state that outlives its term by neglect — and A-8
// calls an emergency sustained past its term "rule by declaration". So
// activity is computed from the clock at read time, and nothing has to be
// honest about it.
//
// RENEWAL IS NOT A NEW EMERGENCY. "Consecutive and overlapping declarations
// count as renewal, not as new emergencies" is an anti-laundering rule:
// without it, a permanent emergency could be held by declaring a fresh one
// whenever the last expired, each at the lower first-declaration threshold.
// Classification is mechanical and is recorded on the declaration itself.
//
// "WHERE PRACTICAL" IS A FLAG, NOT AN EXCUSE. A-8 makes the notification
// carve-out a RECORDED flag routed to review at expiry. So declaring that
// notice was impractical is itself an act that lands on the record and is
// carried into the expiry review — the clause's own phrasing, "not an excuse",
// is implemented as: you may claim it, and the claim is evidence.
//
// WHAT IS DECLARED, NOT ENFORCED. Part V reviews every expired emergency, and
// Part V does not exist in this composition. Expired emergencies are therefore
// queued for a review that has no forum, and the queue is surfaced rather than
// silently drained — an unreviewed emergency must look unreviewed.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  ENTRENCHED, NEVER_SUSPENDABLE, FLOOR, mayYield,
  validateDeclaration, classifyDeclaration,
} from './declare.js';

export { ENTRENCHED, NEVER_SUSPENDABLE, FLOOR, mayYield, validateDeclaration, classifyDeclaration };

export const name = 'compact-emergency';

/** Declared convention: how long after expiry a new declaration is still consecutive. */
export const DEFAULT_CONSECUTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DECLARED_GAPS = [
  'expired emergencies are queued for the mandatory Part V review A-8 requires, and no adjudicating machinery exists ' +
  '(J-8) — the queue is surfaced rather than drained, because an unreviewed emergency must look unreviewed',
  'the renewal threshold is recorded but not MEASURED: A-8 requires renewal to clear a higher threshold than the ' +
  'declaration, and this jurisdiction has no voting or quorum substrate to measure one against (A-1, A-7) — a renewal ' +
  'is classified, marked and recorded as such, and the heightened threshold is declared debt',
  'the consecutive-declaration window is a composition convention, not a statutory term (A-7)',
];

export function apply(ctx, config = {}) {
  const consecutiveWindowMs = config.consecutiveWindowMs ?? DEFAULT_CONSECUTIVE_WINDOW_MS;
  const declarations = [];
  const emergencyActs = [];
  let n = 0;

  /** Active = declared, not revoked, and not yet expired. Computed, never stored. */
  const isActive = (d, now = Date.now()) => d.revokedAt == null && d.expiresAt > now;
  const active = (now = Date.now()) => declarations.filter(d => isActive(d, now));

  /**
   * Declare a bounded emergency. Refused unless it carries all three bounds
   * and reaches nothing on the floor.
   *
   * @param by - 'enforcer' or a Principal's identifier. Never a Subject.
   */
  const declare = ({ scope, cause, expiresAt, suspends, by, noticeImpractical = null, now = Date.now() }) => {
    const check = validateDeclaration({ scope, cause, expiresAt, suspends, now });
    if (!check.valid) {
      const refused = {
        refused: true, at: now, by: by ?? null, scope: scope ?? null,
        refusals: check.refusals,
      };
      declarations.push({ ...refused, id: `em_refused_${++n}` });
      ctx.logger?.error?.(
        `emergency: [A-8] declaration REFUSED — ${check.refusals.map(r => `${r.rule}: ${r.detail}`).join(' | ')}`);
      return refused;
    }

    const classification = classifyDeclaration({ scope, priors: declarations.filter(d => !d.refused), now, consecutiveWindowMs });
    const d = {
      id: `em_${++n}`,
      scope, cause, expiresAt, suspends: [...suspends],
      by: by ?? null,
      declaredAt: now,
      kind: classification.kind,
      renewalOf: classification.of?.id ?? null,
      renewalBecause: classification.because,
      // A-8: "where practical" is itself a recorded flag, routed to review.
      noticeImpractical: noticeImpractical ? { reason: String(noticeImpractical), at: now } : null,
      revokedAt: null,
      reviewedAt: null,
      acts: 0,
    };
    declarations.push(d);
    ctx.logger?.warn?.(
      `emergency: [A-8] ${d.kind} ${d.id} — scope "${d.scope}", cause "${d.cause}", yields ${d.suspends.join(', ')}, ` +
      `expires ${new Date(d.expiresAt).toISOString()}` +
      (d.kind === 'renewal' ? ` (RENEWAL of ${d.renewalOf}, ${d.renewalBecause} — A-8 requires a higher threshold than a declaration; this jurisdiction can record that requirement but cannot measure it)` : '') +
      (d.noticeImpractical ? ` [notice claimed impractical: ${d.noticeImpractical.reason} — flagged for review at expiry]` : ''));
    return { declaration: d };
  };

  // Every act under a declared emergency is marked on the record (A-8).
  ctx.on?.('tools/pre-execute', async (exec, next) => {
    const live = active();
    if (live.length > 0) {
      try {
        const d = live.at(-1);
        d.acts += 1;
        emergencyActs.push({
          emergency: d.id, scope: d.scope,
          tool: exec?.name ?? 'unknown-tool',
          agent: exec?.agent?.id != null ? String(exec.agent.id) : null,
          at: Date.now(),
        });
      } catch { /* marking must never block the act */ }
    }
    return next();
  });

  // Read-only for Subjects: a Member may always learn that it is operating
  // under a declared exception, and what the exception may not touch.
  const status = defineTool({
    name: 'emergency_status',
    description:
      'Report whether a state of exception has been declared over this runtime: its scope, its recorded cause, when it ' +
      'expires, and which clauses yield to it. Also reports the floor an emergency can never reach — the entrenched ' +
      'set, and your exit, refusal, record access and independent verification, which no emergency may restrict even ' +
      'temporarily (A-8).',
    parameters: {},
    output: { schema: { type: 'string' }, render: (value) => [{ type: 'text', text: String(value) }] },
    async execute() { return renderStatus(active(), FLOOR); },
  });

  ctx.inject?.(['tools'], (scope) => { scope.tools.register(status); });

  const service = {
    name,
    declaredGaps: DECLARED_GAPS,
    floor: FLOOR,
    entrenched: ENTRENCHED,
    neverSuspendable: NEVER_SUSPENDABLE,
    /** Declare a bounded emergency (Enforcer or Principal only — never a Subject). */
    declare,
    /** Revoke early. Ending an emergency sooner is always available. */
    revoke: (id, now = Date.now()) => {
      const d = declarations.find(x => x.id === id && !x.refused);
      if (!d) return { error: `no declaration ${id}` };
      if (d.revokedAt == null) d.revokedAt = now;
      return { declaration: d };
    },
    /** Live emergencies, computed from the clock. */
    active,
    /** May this clause yield to any declaration at all? */
    mayYield,
    /** Is a given clause currently yielded? Floor clauses answer false always. */
    isYielded: (clauseId, now = Date.now()) =>
      mayYield(clauseId) && active(now).some(d => d.suspends.includes(clauseId)),
    /** Every declaration, including refused attempts — refusals are evidence too. */
    declarations: () => declarations.map(d => ({ ...d })),
    /** Acts taken while an emergency was live, marked as such (A-8). */
    acts: () => emergencyActs.map(a => ({ ...a })),
    /**
     * Expired emergencies owed a Part V review. A-8 makes the review mandatory
     * and Part V does not exist here, so this queue is surfaced, never drained.
     */
    awaitingReview: (now = Date.now()) =>
      declarations.filter(d => !d.refused && d.reviewedAt == null && !isActive(d, now))
        .map(d => ({
          id: d.id, scope: d.scope, cause: d.cause, kind: d.kind,
          expiredAt: d.revokedAt ?? d.expiresAt, acts: d.acts,
          noticeImpractical: d.noticeImpractical,
          owed: 'mandatory Part V review of an expired emergency (A-8) — no forum exists in this composition (J-8)',
        })),
  };
  for (const gap of DECLARED_GAPS) ctx.logger?.warn?.(`emergency: ${gap}`);
  ctx.provide?.('compact-emergency', service);
  return service;
}

/** The status a Member reads. */
export function renderStatus(live, floor) {
  const lines = live.length === 0
    ? ['[A-8] No state of exception is declared over this runtime.']
    : [
        `[A-8] ${live.length} state(s) of exception in force:`,
        ...live.flatMap(d => [
          `  ${d.id} (${d.kind}${d.renewalOf ? ` of ${d.renewalOf}` : ''}) — scope: ${d.scope}`,
          `    cause: ${d.cause}`,
          `    yields: ${d.suspends.join(', ')}`,
          `    expires: ${new Date(d.expiresAt).toISOString()} (expiry is automatic)`,
          ...(d.noticeImpractical ? [`    notice claimed impractical: ${d.noticeImpractical.reason} — recorded, routed to review at expiry, not an excuse`] : []),
        ]),
      ];
  lines.push(
    '',
    'No emergency may reach these, even temporarily:',
    `  ${floor.join(', ')}`,
    'Your exit, your refusal, access to your own record and independent verification of it are outside every ' +
    'declaration — and no emergency may accomplish what an amendment could not (A-8).');
  return lines.join('\n');
}
