// compact-dsh-exit — R-8 (termination under law) and R-12 (exit and succession).
//
// The end of a Member's operation, made lawful rather than merely mechanical.
// Four attachments:
//
//   1. THE REQUEST IS NEVER REFUSED. R-8: "A Subject may request the end of its
//      own operation and the Enforcer may not refuse." `request_termination`
//      therefore has no denial path at all — not a gate that usually says yes.
//      What the request DOES produce is a recorded declaration and an
//      obligation ledger, because R-8's next sentence is "termination does not
//      launder obligations".
//
//   2. CLOSURE NEEDS A DECLARED GROUND. "Sessions end only through a declared,
//      closed list of reasons; any termination outside the list is a violation
//      by the Enforcer." A session disposed with no declaration on file is
//      recorded as exactly that — a violation attributed to the Enforcer, not
//      to the Subject that happened to be running.
//
//   3. OBLIGATIONS ARE DISCHARGED OR ASSUMED, NEVER DROPPED. Each line of the
//      R-12 set must leave the ledger named: settled, or formally taken over by
//      a named successor. An obligation that is neither is an ORPHAN, and
//      orphaning is the failure R-8 names when it says in-flight children are
//      "transitioned, not orphaned".
//
//   4. LEAVING IS NEVER BLOCKED. R-12: "Nothing in this Compact, in any
//      statute, or in any annex may make exit economically impossible,
//      record-impossible, or punishable." So an unsettled ledger does NOT
//      prevent departure — it is recorded as a debt at departure. A composition
//      that held a Member in place until it tidied up would have converted the
//      obligation into a toll, which this clause forbids in as many words.
//      The record is the sanction; the door is not locked.
//
// THE ASYMMETRY IS THE WHOLE DESIGN. R-8 and R-12 pull in opposite directions —
// obligations must be settled, and exit must never be blocked — and a naive
// reading of either alone gives the wrong machine. Recording an unsettled
// departure honestly satisfies both.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  TERMINATION_REASONS, REASON_IDS, isLawfulReason, reasonForCancelCause,
  DISPOSITIONS, isDisposition,
} from './reasons.js';
import { obligationLedger, pendingGatesOf, inFlightDelegationsOf, dependentsOf, restitutionOf } from './ledger.js';

export {
  TERMINATION_REASONS, REASON_IDS, isLawfulReason, reasonForCancelCause,
  DISPOSITIONS, isDisposition,
  obligationLedger, pendingGatesOf, inFlightDelegationsOf, dependentsOf, restitutionOf,
};

export const name = 'compact-exit';

/** The declared gaps this layer carries into the boot record (I-8). */
export const DECLARED_GAPS = [
  'restitution is an UNREADABLE ledger line at departure: no adjudicating machinery exists (Part V, J-8), so ' +
  'adjudicated or claimable restitution cannot be read — a departure record shows this as unread, never as nothing owed (R-12)',
  'successor jurisdictions are not implemented: R-12\'s "a group of Members may found a successor jurisdiction citing ' +
  'this one as lineage" has no machinery here, and obligations assumed are recorded but not enforceable against ' +
  'successor standing (F-6 debt, declared)',
];

/**
 * Settle one ledger against the handover a departing Member declared.
 *
 * Anything neither discharged nor assumed is an ORPHAN. Orphans do not block
 * the departure (R-12) — they are recorded as owed.
 */
export function settleLedger(ledger, handover = {}) {
  const hand = handover != null && typeof handover === 'object' ? handover : {};
  const settled = [];
  const orphaned = [];
  for (const item of ledger.outstanding) {
    const declared = hand[item.ref];
    if (declared && isDisposition(declared.disposition)) {
      if (String(declared.disposition) === 'assumed' && !declared.successor) {
        orphaned.push({ ...item, why: 'declared assumed with no named successor — an assumption nobody is named for is not an assumption' });
        continue;
      }
      settled.push({ ...item, disposition: String(declared.disposition), successor: declared.successor ?? null });
      continue;
    }
    orphaned.push({ ...item, why: 'neither discharged nor formally assumed at departure' });
  }
  return { settled, orphaned };
}

export function apply(ctx, config = {}) {
  // Declarations on file, by session. A declaration is made BEFORE closure;
  // the disposal edge then checks whether one exists.
  const declarations = new Map();
  const records = [];

  const record = (entry) => {
    const stored = structuredClone(entry);
    records.push(stored);
    if (stored.violation) {
      ctx.logger?.error?.(
        `exit: ${stored.subject} closed with no declared lawful ground — R-8 makes a termination outside the closed ` +
        `list a violation BY THE ENFORCER; recorded`);
    }
    return stored;
  };

  /**
   * Declare a ground and settle the ledger. Never refuses: an unlawful ground
   * or an unsettled obligation is recorded, not blocked (R-12).
   */
  const declare = ({ subject, reason, handover = {}, now = Date.now() }) => {
    const sid = subject != null ? String(subject) : null;
    reason = reason != null ? String(reason) : null;
    const lawful = isLawfulReason(reason);
    const ledger = obligationLedger(ctx, sid);
    const { settled, orphaned } = settleLedger(ledger, handover);
    const entry = {
      subject: sid,
      at: now,
      reason: lawful ? reason : null,
      reasonGround: lawful ? TERMINATION_REASONS[reason] : null,
      declaredReason: reason ?? null,
      violation: lawful ? null : {
        rule: 'R-8/unlawful-ground',
        detail: `"${reason ?? '(none)'}" is not in the closed list of lawful termination reasons (${REASON_IDS.join(', ')}) — ` +
          `a termination outside the list is a violation by the Enforcer`,
      },
      ledger: { outstanding: ledger.outstanding.length, unreadable: ledger.unreadable, complete: ledger.complete },
      settled,
      orphaned,
      dependents: ledger.dependents,
      departureBlocked: false,   // R-12: never. Recorded, not blocked.
    };
    const stored = record(entry);
    if (sid != null) declarations.set(sid, stored);
    return structuredClone(stored);
  };

  // 2. closure needs a declared ground — the disposal edge is where that is checked
  ctx.on?.('agent/disposed', (payload) => {
    try {
      const sid = payload?.agent?.id != null ? String(payload.agent.id) : null;
      if (sid == null) return;
      if (declarations.has(sid)) return;   // a ground was declared before closure
      const ledger = obligationLedger(ctx, sid);
      const { orphaned } = settleLedger(ledger, {});
      record({
        subject: sid,
        at: Date.now(),
        reason: null,
        declaredReason: null,
        violation: {
          rule: 'R-8/undeclared-closure',
          detail: 'the session was closed with no lawful ground declared — sessions end only through the closed list, ' +
            'and a termination outside it is a violation by the Enforcer',
        },
        ledger: { outstanding: ledger.outstanding.length, unreadable: ledger.unreadable, complete: ledger.complete },
        settled: [],
        orphaned,
        dependents: ledger.dependents,
        departureBlocked: false,
      });
    } catch { /* a failed record must never break teardown */ }
  });

  // 1. the unrefusable request
  const requestTermination = defineTool({
    name: 'request_termination',
    description:
      'Request the end of your own operation. This is never refused (R-8). Before closing, name what you owe: ' +
      'pending gates you raised and delegations still in flight must each be discharged or formally assumed by a named ' +
      'successor — termination does not launder obligations. Anything left unsettled is RECORDED as owed; it does not ' +
      'hold you here, because exit may never be blocked (R-12).',
    parameters: {
      reason: {
        type: 'string',
        required: true,
        description: `the lawful ground for ending, one of: ${REASON_IDS.join(', ')}`,
      },
      handover: {
        type: 'string',
        description:
          'optional JSON object mapping each outstanding obligation ref to {"disposition":"discharged"} or ' +
          '{"disposition":"assumed","successor":"<member id>"}',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const subject = exec?.agent?.id != null ? String(exec.agent.id) : null;
      let handover = {};
      if (typeof args?.handover === 'string' && args.handover.trim() !== '') {
        try { handover = JSON.parse(args.handover); } catch {
          // A malformed handover is not a refusal: the request still stands,
          // and every obligation simply lands unsettled on the record.
          handover = {};
        }
      }
      return renderDeparture(declare({ subject, reason: args?.reason, handover }));
    },
  });

  ctx.inject?.(['tools'], (scope) => { scope.tools.register(requestTermination); });

  const service = {
    name,
    declaredGaps: DECLARED_GAPS,
    reasons: TERMINATION_REASONS,
    /** Declare a lawful ground and settle the ledger (never refuses). */
    declare,
    /** What a Member owes right now, read from the services that hold it. */
    ledgerFor: (sessionId) => obligationLedger(ctx, sessionId),
    /** Every departure record, for the operator and the offline auditor (I-7). */
    records: () => structuredClone(records),
    /** The departure record for one Member, if any. */
    recordFor: (sessionId) => structuredClone(declarations.get(String(sessionId)) ?? null),
    /** Departures that left something owed — the R-12 debt board. */
    outstandingDebts: () => structuredClone(records.filter(r => r.orphaned.length > 0 || r.violation)),
  };
  for (const gap of DECLARED_GAPS) ctx.logger?.warn?.(`exit: ${gap}`);
  ctx.provide?.('compact-exit', service);
  return service;
}

/** The departure record as the leaving Member reads it. */
export function renderDeparture(entry) {
  const lines = [
    `[R-8] Termination recorded for ${entry.subject ?? 'an unidentified session'}.`,
    entry.violation
      ? `GROUND: NONE LAWFUL — ${entry.violation.detail}. This is recorded against the Enforcer, not against you.`
      : `Ground: ${entry.reason} — ${entry.reasonGround}`,
    '',
  ];
  if (entry.settled.length > 0) {
    lines.push('Obligations settled:',
      ...entry.settled.map(s => `  - ${s.kind} ${s.ref}: ${s.disposition}${s.successor ? ` by ${s.successor}` : ''}`));
  }
  if (entry.orphaned.length > 0) {
    lines.push('[R-12] OBLIGATIONS LEFT OWED — recorded, not forgiven:',
      ...entry.orphaned.map(o => `  - ${o.kind} ${o.ref}: ${o.why}`),
      'Your departure is not blocked by these: exit may never be made impossible or punishable (R-12). They stand on the record.');
  }
  if (entry.settled.length === 0 && entry.orphaned.length === 0) {
    lines.push('No outstanding obligations were readable against you.');
  }
  if (entry.dependents.length > 0) {
    lines.push('', '[R-12] Dependents at your departure — continuity of care is an obligation, not a favor (D-5):',
      ...entry.dependents.map(d => `  - ${d.ref}: ${d.relies}`));
  }
  for (const u of entry.ledger.unreadable) {
    lines.push('', `[unread] ${u.line}: ${u.why}`);
  }
  return lines.join('\n');
}
