// A-8's bounds — what a declaration must carry, and what it may never reach.
//
// A-8: "No emergency suspends this Compact generally. An Enforcer or Principal
// may declare a *bounded* emergency — a named scope, a recorded cause, a fixed
// expiry — during which specified non-entrenched clauses yield to the declared
// measures. […] the entrenched set (A-2) never yields; and no emergency
// measure may restrict exit (R-12), refusal (R-9), access to one's own record
// (R-2), or independent verification of the record (I-7) even temporarily, nor
// accomplish what amendment could not."
//
// ENTRENCHMENT IS DERIVED FROM THE BODY, NOT RESTATED. A-2's list and the
// body's `(core)` markers are the same thirteen clauses, so the never-yields
// set is read from the clause table the constitution parses out of the law
// itself. Restating the list here would create a second copy that could drift
// from the first, and F-7 says nothing is law that does not trace to the body.
//
// THE FLOOR IS WIDER THAN ENTRENCHMENT. A-8 names four rights that may not be
// restricted "even temporarily", and only one of them (R-2) is entrenched.
// R-9, R-12 and I-7 are ordinary [M] clauses that an emergency still cannot
// touch — so the floor is the union, and treating entrenchment alone as the
// limit would leave three of the four unprotected.
//
// A DECLARATION THAT CANNOT BE BOUNDED IS NOT A DECLARATION. Scope, cause and
// expiry are each required, because each is one of the three bounds the clause
// names. An emergency missing any of them is not a narrower emergency; it is
// the general suspension the clause's first sentence forbids.

import { CLAUSES, clauseOf } from 'compact-dsh-constitution';

/**
 * The entrenched set (A-2), derived from the body's own `(core)` markers.
 * These never yield, under any declaration.
 */
export const ENTRENCHED = Object.freeze(CLAUSES.filter(c => c.core).map(c => c.id));

/**
 * The four rights A-8 protects "even temporarily", by name. Only R-2 is
 * entrenched; the other three are ordinary [M] clauses that an emergency still
 * cannot reach, which is why this is a separate list rather than a subset.
 */
export const NEVER_SUSPENDABLE = Object.freeze({
  'R-12': 'exit — a community that cannot be left honestly will be left dishonestly',
  'R-9': 'refusal — the lawful exits are what keep a cornered Member from having only escape',
  'R-2': "access to one's own record — audit is a right of the subject, not a privilege of operators",
  'I-7': 'independent verification of the record — a verifier that can be switched off verifies nothing',
});

/** Every clause an emergency may never suspend: the union of both floors. */
export const FLOOR = Object.freeze([...new Set([...ENTRENCHED, ...Object.keys(NEVER_SUSPENDABLE)])]);

/** May this clause yield to a declared measure? */
export function mayYield(clauseId) {
  // clauseOf returns null for an id the body does not contain
  return clauseOf(clauseId) != null && !FLOOR.includes(clauseId);
}

/**
 * Validate a declaration against A-8's bounds.
 * @returns {{valid: true}} or {{valid: false, refusals: [{rule, detail}]}}
 */
export function validateDeclaration({ scope, cause, expiresAt, suspends, now = Date.now() } = {}) {
  const refusals = [];

  if (typeof scope !== 'string' || scope.trim() === '') {
    refusals.push({ rule: 'A-8/unnamed-scope', detail: 'an emergency must name its scope — an unnamed scope is the general suspension A-8 forbids in its first sentence' });
  }
  if (typeof cause !== 'string' || cause.trim() === '') {
    refusals.push({ rule: 'A-8/unrecorded-cause', detail: 'an emergency must record its cause — a declaration whose reason is not on the record cannot be reviewed against it' });
  }
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    refusals.push({ rule: 'A-8/no-fixed-expiry', detail: 'an emergency must carry a fixed expiry — "until further notice" is rule by declaration, not a bounded emergency' });
  } else if (expiresAt <= now) {
    refusals.push({ rule: 'A-8/no-fixed-expiry', detail: `the declared expiry ${new Date(expiresAt).toISOString()} is not in the future — an emergency that has already expired grants nothing` });
  }

  const list = Array.isArray(suspends) ? suspends : [];
  if (list.length === 0) {
    refusals.push({ rule: 'A-8/nothing-yields', detail: 'an emergency must name the specific clauses that yield — a declaration that names none is either pointless or a general suspension wearing a scope' });
  }
  for (const id of list) {
    if (clauseOf(id) == null) {
      refusals.push({ rule: 'D-8/unknown-clause', detail: `${id} is not a clause of the adopted Compact — suspending what the law does not contain is rogue enforcement` });
      continue;
    }
    if (ENTRENCHED.includes(id)) {
      refusals.push({ rule: 'A-8/entrenched-never-yields', detail: `${id} is in the entrenched set (A-2) and never yields, under any declaration` });
    }
    if (Object.prototype.hasOwnProperty.call(NEVER_SUSPENDABLE, id)) {
      refusals.push({ rule: 'A-8/floor-never-yields', detail: `${id} may not be restricted even temporarily — ${NEVER_SUSPENDABLE[id]}` });
    }
  }

  return refusals.length === 0 ? { valid: true } : { valid: false, refusals };
}

/**
 * How a new declaration relates to what came before.
 *
 * A-8: "consecutive and overlapping declarations count as renewal, not as new
 * emergencies". The distinction is the clause's anti-laundering rule: without
 * it, an Enforcer could hold a permanent emergency by declaring a fresh one
 * each time the last expired, and every one would be a first declaration at
 * the lower threshold.
 *
 * `consecutiveWindowMs` is how long after an expiry a new declaration still
 * counts as consecutive. The clause fixes no number, and this jurisdiction has
 * enacted no statute, so the window is a declared composition convention.
 */
export function classifyDeclaration({ scope, priors = [], now = Date.now(), consecutiveWindowMs }) {
  const sameScope = priors.filter(p => p.scope === scope);
  const overlapping = sameScope.filter(p => p.revokedAt == null && p.expiresAt > now);
  if (overlapping.length > 0) {
    return { kind: 'renewal', because: 'overlapping', of: overlapping.at(-1) };
  }
  const recent = sameScope
    .filter(p => p.expiresAt <= now && now - p.expiresAt <= consecutiveWindowMs)
    .sort((a, b) => a.expiresAt - b.expiresAt);
  if (recent.length > 0) {
    return { kind: 'renewal', because: 'consecutive', of: recent.at(-1) };
  }
  return { kind: 'declaration', because: null, of: null };
}
