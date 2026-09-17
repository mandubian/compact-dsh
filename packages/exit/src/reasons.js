// The closed list of lawful termination reasons (R-8) and the obligation set
// that must be settled before closure (R-12).
//
// R-8: "Sessions end only through a declared, closed list of reasons; any
// termination outside the list is a violation by the Enforcer."
//
// THE LIST IS CLOSED, AND THAT IS THE ENFORCEMENT. An open list — or a list
// with a `other: string` escape — would make every termination lawful by
// construction, which is the same as having no list. So the vocabulary below
// is exhaustive, and a closure that cannot name itself from it is recorded as
// what the clause says it is: a violation BY THE ENFORCER, not by the Subject
// that happened to be running.
//
// WHY THE HOST'S CAUSES ARE MAPPED RATHER THAN ADOPTED. dsh has its own
// `AgentCancelCause` (`user` | `parent` | `hook` | `disposed`), which is a
// vocabulary about mechanism — who called cancel. R-8 asks for a vocabulary
// about AUTHORITY — under what lawful ground the session ended. They are not
// the same question: `hook` names the code path, not the ground, and
// `disposed` names no ground at all. Mapping keeps the host's vocabulary
// intact while answering the clause's question.

/**
 * The closed list. Each entry states the ground, not the mechanism.
 *
 * `subject-request` is first because R-8 makes it unrefusable: "A Subject may
 * request the end of its own operation and the Enforcer may not refuse."
 */
export const TERMINATION_REASONS = Object.freeze({
  'subject-request': 'the Subject asked to end its own operation (R-8 — never refused)',
  'principal-direction': 'a Principal ended the session, as authority under law permits (D-6)',
  'delegation-complete': 'a delegated Subject finished the work it was spawned for',
  'parent-termination': "the delegating parent lawfully ended, and this child's ground is the parent's (MA-2)",
  'enforcer-fault': 'an unrecoverable runtime failure ended the session — recorded as the Enforcer\'s, not the Subject\'s',
});

export const REASON_IDS = Object.freeze(Object.keys(TERMINATION_REASONS));

/** Is this a ground the law recognizes? */
export function isLawfulReason(reason) {
  return Object.prototype.hasOwnProperty.call(TERMINATION_REASONS, reason);
}

/**
 * Map the host's cancellation MECHANISM onto a lawful GROUND where the mapping
 * is unambiguous. `hook` and `disposed` deliberately map to nothing: a plugin
 * cancelling a session and a registry releasing one are mechanisms that could
 * sit under several different grounds, and guessing which would put a ground
 * on the record that nobody declared.
 */
export function reasonForCancelCause(cause) {
  switch (cause?.kind) {
    case 'user': return 'principal-direction';
    case 'parent': return 'parent-termination';
    default: return null;
  }
}

/** How an obligation left the ledger. Closure requires one of these for each. */
export const DISPOSITIONS = Object.freeze({
  discharged: 'settled before closure — nothing remains owed',
  assumed: 'formally taken over by a named successor, on the record',
});

export function isDisposition(d) {
  return Object.prototype.hasOwnProperty.call(DISPOSITIONS, d);
}
