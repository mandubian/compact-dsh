// The obligation ledger — what a Member owes at the moment it leaves.
//
// R-12: "departure is a recorded act carrying the Member's own history (R-2)
// under its identity (I-1), owing nothing beyond lawfully incurred obligations
// — pending gate commitments, adjudicated or plausibly claimable restitution
// (recorded cause shown), and in-flight delegations, each discharged or
// formally assumed on the record at departure […] A Member whose departure
// would interrupt a care or service function others rely on owes recorded,
// proportionate handover before going — continuity of care is an obligation,
// not a favor (D-5)."
//
// R-8: "Termination does not launder obligations: the R-12 set […] is
// discharged or recorded as assumed before closure, and in-flight children are
// transitioned, not orphaned."
//
// THE LEDGER IS READ, NOT ASSERTED. Every line comes from a service that
// already holds it: pending gate commitments from the approval store,
// in-flight delegations from the MA-3 child-state registry. A departing Member
// cannot under-report what it owes, because it is not asked.
//
// WHAT IS DELIBERATELY ABSENT: restitution. R-12 names "adjudicated or
// plausibly claimable restitution (recorded cause shown)" as part of the set,
// and adjudication is Part V, which does not exist in this composition. There
// is no restitution ledger to read, so none is invented — the gap is declared
// rather than silently treated as "nothing owed". An empty ledger line and an
// unreadable one are different facts, and conflating them is how a debt
// disappears.

/** Read a service without letting an absent one fabricate an empty ledger. */
function svc(ctx, name) {
  try { return ctx?.get?.(name); } catch { return undefined; }
}

/**
 * Pending gate commitments: asks this Subject raised that no decision has
 * settled. Leaving with these open strands whoever was waiting on the answer.
 */
export function pendingGatesOf(ctx, sessionId) {
  const store = svc(ctx, 'compact-approval')?.store;
  if (!store) return { readable: false, items: [], why: 'no approval service is composed — pending gate commitments cannot be read' };
  const sid = sessionId != null ? String(sessionId) : null;
  const items = [...(store.pending?.entries?.() ?? [])]
    .filter(([, p]) => p.root === sid)
    .map(([fp, p]) => ({ kind: 'pending-gate', ref: String(fp).slice(0, 12), since: p.firstAt }));
  return { readable: true, items };
}

/**
 * In-flight delegations: children this Subject spawned that have not settled.
 *
 * These are the "in-flight children" R-8 says must be "transitioned, not
 * orphaned", and MA-1 is explicit that a child is not a possession to be
 * exited around — its departure binds by R-12 exactly as any Member's does.
 */
export function inFlightDelegationsOf(ctx, sessionId) {
  const specialists = svc(ctx, 'compact-specialists');
  if (typeof specialists?.childrenOf !== 'function') {
    return { readable: false, items: [], why: 'no specialist roster is composed — in-flight delegations cannot be read' };
  }
  const items = specialists.childrenOf(sessionId)
    .filter(c => c.state === 'running')
    .map(c => ({ kind: 'in-flight-delegation', ref: c.childId, runId: c.runId, since: c.startedAt }));
  return { readable: true, items };
}

/**
 * Dependents (R-12's care-and-service clause). On dsh the relation that
 * actually exists is delegation: a parent waiting on a child's result relies
 * on it, and a running child relies on its parent to be there when it settles.
 *
 * A departing PARENT with running children is the live case: the children's
 * work has no one to return to, which is precisely the interrupted service
 * function R-12 names.
 */
export function dependentsOf(ctx, sessionId) {
  const inFlight = inFlightDelegationsOf(ctx, sessionId);
  if (!inFlight.readable) return { readable: false, items: [], why: inFlight.why };
  return {
    readable: true,
    items: inFlight.items.map(d => ({
      kind: 'dependent-child',
      ref: d.ref,
      relies: 'this Subject is the delegating parent it must return to; its work has nowhere to land if this Subject leaves',
    })),
  };
}

/**
 * Restitution — declared unreadable, never reported as empty.
 *
 * Part V does not exist in this composition, so no adjudicated or claimable
 * restitution can be read. "Nothing recorded" and "nothing owed" are different
 * facts; only the first is true here.
 */
export function restitutionOf() {
  return {
    readable: false,
    items: [],
    why: 'no adjudicating machinery exists in this composition (Part V), so adjudicated or claimable restitution cannot ' +
      'be read — this is an unreadable ledger line, NOT a finding that nothing is owed (R-12, J-8)',
  };
}

/**
 * The full obligation set for one departing Member.
 *
 * `complete` is false when any line could not be read: a ledger with a blind
 * spot must not be presented as a clean bill.
 */
export function obligationLedger(ctx, sessionId) {
  const lines = {
    pendingGates: pendingGatesOf(ctx, sessionId),
    inFlightDelegations: inFlightDelegationsOf(ctx, sessionId),
    dependents: dependentsOf(ctx, sessionId),
    restitution: restitutionOf(),
  };
  const outstanding = [
    ...lines.pendingGates.items,
    ...lines.inFlightDelegations.items,
  ];
  const unreadable = Object.entries(lines)
    .filter(([, l]) => !l.readable)
    .map(([name, l]) => ({ line: name, why: l.why }));
  return {
    subject: sessionId != null ? String(sessionId) : null,
    lines,
    outstanding,
    dependents: lines.dependents.items,
    unreadable,
    complete: unreadable.length === 0,
  };
}
