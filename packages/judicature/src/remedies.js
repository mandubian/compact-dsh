// Remedies are records — slice 3 (#113, J-6). Pure model, no I/O: the
// composed plugin (index.js) performs the machinery each remedy rides
// (grant store, petition counter, annotation lookups) and records the row
// this module validates; nothing here touches a store, a bus, or a clock
// by itself.
//
// THE DESIGN (docs/concept-judicature.md, "Remedies are records"): no
// remedy erases — every remedy is a COMPENSATING entry, and the menu maps
// onto seams that already exist, because a remedy that required a new
// write path into old records would violate I-2 further than the breach
// it answers:
//
//   annotation   a row citing the annotated seq range — beside, never
//                inside; it travels with every read of that range
//   restitution  an obligation row with recorded cause shown — the first
//                readable line of the exit ledger R-12 reports
//   standing     written ONLY through the declared grant machinery (the
//                approval layers) — bypassing them to adjust standing
//                directly is enforcement fraud with a gavel (D-8)
//   revocation   the state it revokes, re-declared with the judgment
//                cited — the row is the order; the re-declaration is the
//                operator's recorded rotation
//   referral     an amendment invitation through the petition channel's
//                existing mechanical trigger (R-11/I-6) — the breach that
//                reveals the law's defect rides the same rails as friction
//
// Proportionality is owed in the judgment's stated reasons; the mechanical
// form of that duty is the required, non-empty `proportionality` field on
// every remedy row — a row that does not argue its fit is detectably
// non-conforming before anyone audits it.

import { CaseError } from './cases.js';

/** The closed menu (J-6's own table — a remedy outside it is not one). */
export const REMEDY_KINDS = Object.freeze(['annotation', 'restitution', 'standing', 'revocation', 'referral']);

/** What a revocation may target (J-6: annex conformance / a Member's standing). */
export const REVOCATION_TARGETS = Object.freeze(['annex-conformance', 'member-standing']);

const isSeq = (n) => Number.isInteger(n) && n >= 0;

function checkCitation(c) {
  if (!c || typeof c !== 'object' || typeof c.session !== 'string' || !c.session.trim()
    || !isSeq(c.fromSeq) || !isSeq(c.toSeq) || c.toSeq < c.fromSeq) {
    throw new CaseError('malformed', 'the remedy must cite a session and a seq range — beside, never inside (J-6)');
  }
}

/** Is the cited range inside a citation the case verified at filing? */
function citationCovers(c, f) {
  return c.citations.some((cit) =>
    cit.session === f.session && f.fromSeq >= cit.fromSeq && f.toSeq <= cit.toSeq);
}

/**
 * Land a remedy on a JUDGED case (J-6: remedies ride judgments — there is
 * no remedy without a judgment to carry it). Form-checks everything
 * mechanical; performs nothing. The composed layer performs the machinery
 * (grant write, counter flag) and the returned row is what lands.
 */
export function landRemedy(c, { kind, seat, proportionality, spec, now = Date.now() }) {
  if (!REMEDY_KINDS.includes(kind)) {
    throw new CaseError('malformed', `"${kind}" is not a remedy — the menu is closed: ${REMEDY_KINDS.join(', ')} (J-6)`);
  }
  if (c.judgment == null) {
    throw new CaseError('unjudged', 'no judgment has landed on this case — a remedy rides a judgment, and there is no remedy without one to carry it (J-6)');
  }
  if (typeof seat !== 'string' || !c.panel.seats.includes(seat)) {
    throw new CaseError('seat', `seat "${seat}" is not among the panel's resolved seats (${c.panel.seats.join(', ')}) — a remedy is attributed to the seat that verified in`);
  }
  if (typeof proportionality !== 'string' || !proportionality.trim()) {
    throw new CaseError('malformed', 'proportionality is owed on every remedy row — the response must fit the wrong, and a row that does not argue its fit is detectably non-conforming (J-6)');
  }
  const s = spec ?? {};
  const row = { kind: 'remedy', caseId: c.id, remedy: kind, at: now, seat, proportionality: proportionality.trim() };

  if (kind === 'annotation') {
    checkCitation(s.target);
    if (!citationCovers(c, s.target)) {
      throw new CaseError('uncited', `the annotation cites ${s.target.session} #${s.target.fromSeq}..#${s.target.toSeq}, outside every slice the case verified — a margin note on unread evidence is not one (J-2)`);
    }
    if (typeof s.note !== 'string' || !s.note.trim()) {
      throw new CaseError('malformed', 'an annotation carries its note — beside, never inside, but never silent either (J-6)');
    }
    Object.assign(row, { target: { session: String(s.target.session), fromSeq: s.target.fromSeq, toSeq: s.target.toSeq }, note: s.note.trim() });
  }

  if (kind === 'restitution') {
    for (const field of ['owed', 'to', 'cause']) {
      if (typeof s[field] !== 'string' || !s[field].trim()) {
        throw new CaseError('malformed', `restitution needs its ${field} — an obligation row with recorded cause shown, bounded by "where resources permit" (J-6/R-12)`);
      }
    }
    if (!isPartyStanding(c, s.debtor)) {
      throw new CaseError('uncited', `the debtor ${describe(s.debtor)} is not a party to this case — obligations are ordered against parties, never strangers (J-6)`);
    }
    Object.assign(row, {
      owed: s.owed.trim(), to: s.to.trim(), cause: s.cause.trim(),
      debtor: normalizeStanding(s.debtor),
    });
  }

  if (kind === 'standing') {
    const party = s.subject != null ? s.subject : s.debtor;
    if (!isPartyStanding(c, party)) {
      throw new CaseError('uncited', `the standing adjusted (${describe(party)}) belongs to no party of this case — a judgment adjusts the standing of those before it, not the world's (J-6)`);
    }
    if (s.grant != null && s.revoke != null) {
      throw new CaseError('malformed', 'a standing remedy grants or revokes — never both at once');
    }
    if (s.grant != null) {
      if (typeof s.grant.pattern !== 'string' || !s.grant.pattern.trim()) {
        throw new CaseError('malformed', 'a granted pattern is required — standing without a named scope restrains and grants everything at once');
      }
      Object.assign(row, { grant: { pattern: s.grant.pattern.trim(), ttlHours: s.grant.ttlHours ?? 24, maxUses: s.grant.maxUses ?? null } });
    } else if (s.revoke != null) {
      if (typeof s.revoke.grantId !== 'string' || !s.revoke.grantId.trim()) {
        throw new CaseError('malformed', 'a revocation names the grant id it revokes');
      }
      Object.assign(row, { revoke: { grantId: s.revoke.grantId.trim() } });
    } else {
      throw new CaseError('malformed', 'a standing remedy carries a grant or a revocation');
    }
    Object.assign(row, { subject: normalizeStanding(party) });
  }

  if (kind === 'revocation') {
    if (!REVOCATION_TARGETS.includes(s.target)) {
      throw new CaseError('malformed', `"${s.target}" is not a revocable state — the menu is ${REVOCATION_TARGETS.join(', ')} (J-6)`);
    }
    if (typeof s.cause !== 'string' || !s.cause.trim()) {
      throw new CaseError('malformed', 'a revocation carries its recorded cause');
    }
    Object.assign(row, { target: s.target, cause: s.cause.trim(), judgmentCited: c.judgment.seat });
  }

  if (kind === 'referral') {
    if (typeof s.ruleId !== 'string' || !s.ruleId.trim()) {
      throw new CaseError('malformed', 'a referral names the rule whose defect the breach revealed');
    }
    if (typeof s.detail !== 'string' || !s.detail.trim()) {
      throw new CaseError('malformed', 'a referral carries its detail — the finding that rides the petition channel');
    }
    Object.assign(row, { ruleId: s.ruleId.trim(), detail: s.detail.trim() });
  }

  return row;
}

function normalizeStanding(p) {
  if (typeof p === 'string' && p.includes(':')) {
    const i = p.indexOf(':');
    return { kind: p.slice(0, i), id: p.slice(i + 1) };
  }
  if (p && typeof p === 'object') return { kind: p.kind ?? 'process', id: String(p.id) };
  return { kind: 'process', id: String(p) };
}
const describe = (p) => (p && typeof p === 'object' ? `${p.kind ?? 'process'}:${p.id}` : `process:${p}`);
function isPartyStanding(c, p) {
  const n = normalizeStanding(p);
  return c.parties.some((x) => x.kind === n.kind && x.id === n.id);
}

/** Attach a landed row (the composed layer calls this AFTER its machinery
 *  succeeded — the row lands with the grant id / invitation it produced). */
export function attachRemedy(c, row, extras = {}) {
  const full = { ...row, ...extras };
  c.remedies.push(full);
  return full;
}

/** The annotations covering a session, for the read doors: every read of
 *  the range surfaces the annotation with it (J-6/I-2). */
export function annotationsOf(cases, sessionId) {
  const id = String(sessionId);
  const out = [];
  for (const c of cases) {
    for (const r of c.remedies ?? []) {
      if (r.remedy === 'annotation' && r.target.session === id) {
        out.push({ caseId: c.id, fromSeq: r.target.fromSeq, toSeq: r.target.toSeq, note: r.note, at: r.at });
      }
    }
  }
  return out;
}

/** The restitution obligations owed BY a session, for the exit ledger
 *  (R-12): the first readable line of that ledger. */
export function restitutionsOf(cases, sessionId) {
  const id = String(sessionId);
  const out = [];
  for (const c of cases) {
    for (const r of c.remedies ?? []) {
      if (r.remedy === 'restitution' && r.debtor.kind === 'process' && r.debtor.id === id) {
        out.push({ caseId: c.id, owed: r.owed, to: r.to, cause: r.cause, since: r.at });
      }
    }
  }
  return out;
}

/** Render the remedy rows for the docket read door. */
export function renderRemedies(c) {
  if (!c.remedies?.length) return [];
  const lines = [`  remedies: ${c.remedies.length} landed (compensating entries — nothing is erased, I-2)`];
  for (const r of c.remedies) {
    if (r.remedy === 'annotation') lines.push(`    - annotation on ${r.target.session} #${r.target.fromSeq}..#${r.target.toSeq}: "${r.note}" — travels with every read of that range`);
    if (r.remedy === 'restitution') lines.push(`    - restitution: ${r.debtor.kind}:${r.debtor.id} owes "${r.owed}" to ${r.to} — cause: ${r.cause}${r.dischargedAt ? ` — DISCHARGED ${new Date(r.dischargedAt).toISOString()}` : ''}`);
    if (r.remedy === 'standing') {
      if (r.grant) lines.push(`    - standing: grant "${r.grant.pattern}" to ${r.subject.kind}:${r.subject.id} (${r.grant.ttlHours}h) through the declared grant machinery — grant ${r.grantId ?? '?'}`);
      if (r.revoke) lines.push(`    - standing: revoke grant ${r.revoke.grantId} of ${r.subject.kind}:${r.subject.id}${r.revokedThrough === false ? ' — NOT FOUND in the grant store' : ''}`);
    }
    if (r.remedy === 'revocation') lines.push(`    - revocation of ${r.target} — cause: ${r.cause} — judgment cited (${r.judgmentCited}); the re-declaration is the operator's recorded rotation`);
    if (r.remedy === 'referral') lines.push(`    - referral of ${r.ruleId} through the petition channel${r.invitedAt ? ` — amendment invitation issued (${new Date(r.invitedAt).toISOString()})` : ' — counted toward the threshold'}`);
  }
  return lines;
}
