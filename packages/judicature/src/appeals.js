// The appeal door — slice 4 (#114, J-5). Pure model, no I/O.
//
// THE DESIGN (docs/concept-judicature.md, "Appeal is a different door"):
// appeal asks *was the law applied here*, on the SAME record — no new
// evidence (J-2 fixed what evidence is; the first judgment is now itself a
// citable row) — and lies to an authority NOT SUBORDINATE to the first
// panel: the independence graph run between sets. One appeal, as of right
// (no leave, no permission step); a second is refused — the door closes,
// the petition door never does. The doors' outputs are non-interchangeable:
// an appeal can never fix the law; a petition can never reopen a case.
//
// Two declared consequences of "not subordinate" as a graph property:
//   - a live appeal requires at least two declared, disjoint sets — with
//     one set there is no appellate authority, and the door refuses with
//     the reason named;
//   - disjointness runs over declared dependency edges, not common
//     ancestry — the declared limit, cured by the D-8 requirement and
//     J-8's trajectory, not by pretending topology is virtue.
//
// The D-8 carve-out, honestly walled: where a party is of the Enforcer's
// own class (the enforcer key, the composition), the appellate panel must
// include external Witnesses — pending I-1, that route is heard NEVER,
// saying so, never the accused's own class pretending otherwise.

import { CaseError, isParty } from './cases.js';
import { recusePerSet, independenceBetweenSets } from './sets.js';

/** What an appellate judgment does with the first one. */
export const APPEAL_DISPOSITIONS = Object.freeze(['affirm', 'depart']);

function normalizeStanding(p) {
  if (typeof p === 'string' && p.includes(':')) {
    const i = p.indexOf(':');
    return { kind: p.slice(0, i), id: p.slice(i + 1) };
  }
  if (p && typeof p === 'object') return { kind: p.kind ?? 'process', id: String(p.id) };
  return { kind: 'process', id: String(p) };
}

/** Is any party of the Enforcer's own class (D-8)? Any plugin (the enforcer
 *  runs as one — pre-I-1, party derivation can only reach this through a
 *  future door, so the branch is defense) or the annex's own enforcer key
 *  (what an anchored cited session carries) — the class that must never
 *  judge accusations against itself without external Witnesses. */
export function isEnforcerClass(parties, judiciary) {
  return parties.some((p) =>
    p.kind === 'plugin' ||
    (p.kind === 'key' && judiciary?.enforcerKey != null && p.id === judiciary.enforcerKey));
}

/**
 * File the one appeal, as of right (J-5): no leave, no permission step —
 * the adverse party files and it lands. `grounds` is the argued claim that
 * the law was misapplied on this record; the evidence does not change.
 */
export function fileAppeal(c, { filer, grounds, now = Date.now() }) {
  if (c.judgment == null) {
    throw new CaseError('malformed', 'nothing has been judged on this case — an appeal re-hears an application, and there is none to re-hear (J-5)');
  }
  if (c.appeal != null) {
    // The refusal names the recorded state exactly: finality is a property
    // of a landed judgment, never of a recorded row (J-1's discipline —
    // an unheard appeal is never a dismissed one, and never a final one).
    if (c.appeal.judgment != null) {
      throw new CaseError('final', 'an appeal already exists on this case — a second judgment is final and a second appeal is refused; the door closes, the petition door never does');
    }
    if (c.appeal.panel?.status === 'witnesses-pending') {
      throw new CaseError('unheard', 'an appeal stands recorded witnesses-pending on this case — heard never until external Witnesses exist (I-1): no judgment has landed, nothing is final, and the recorded appeal holds the door (the accreditation revives the route; it needs no re-filing)');
    }
    throw new CaseError('unheard', 'an appeal stands recorded unheard on this case — every disjoint set recused, no appellate judgment has landed, and nothing is final (J-1: never dismissed); the recorded appeal holds the door, and no set is declared later within this runtime (the annex is fixed at boot)');
  }
  const f = normalizeStanding(filer);
  if (!isParty(c, f)) {
    throw new CaseError('malformed', `the appellant ${f.kind}:${f.id} is not a party to this case — an appeal belongs to those who were before the court, and to no one else`);
  }
  if (typeof grounds !== 'string' || !grounds.trim()) {
    throw new CaseError('malformed', 'grounds are required — an appeal argues the law was misapplied on this record, and an unargued appeal is not one');
  }
  return {
    kind: 'appeal', caseId: c.id, filedAt: now, filer: f, grounds: grounds.trim(),
    panel: null, judgment: null,
  };
}

/**
 * Resolve the appellate panel (J-5): the first declared set that is
 * DISJOINT from the first panel's set (independence over declared
 * dependency edges, both ways) and retains an independent seat for the
 * case's parties. Returns one of:
 *   { status: 'panel', setId, seats, refusals }
 *   { status: 'unavailable' } — no second disjoint set exists at all
 *   { status: 'unheard' }      — disjoint sets exist, every seat recuses
 *   { status: 'witnesses-pending' } — the D-8 route, heard never (I-1)
 */
export function resolveAppellatePanel(judiciary, c) {
  if (isEnforcerClass(c.parties, judiciary)) {
    return { status: 'witnesses-pending' };
  }
  const firstSetId = c.panel.setId;
  const disjoint = judiciary.sets.filter((s) =>
    s.id !== firstSetId && independenceBetweenSets(judiciary, firstSetId, s.id).independent);
  if (disjoint.length === 0) {
    return { status: 'unavailable' };
  }
  const perSet = new Map(recusePerSet(judiciary, c.parties).map((a) => [a.setId, a]));
  const refusals = [];
  for (const s of disjoint) {
    const row = perSet.get(s.id);
    if (row) refusals.push(...row.refusals);
    if (row && row.seats.length > 0) {
      return { status: 'panel', setId: s.id, seats: row.seats, refusals };
    }
  }
  return { status: 'unheard' };
}

/**
 * Land the appellate judgment — final, with dissent (A-5). `disposition`
 * is the whole honesty of the door: AFFIRM upholds the first judgment on
 * the same record; DEPART names it and argues it — the first judgment is
 * a citable row, and departure from it without naming and arguing it is
 * exactly the non-conformity J-5 refuses.
 */
export function landAppellateJudgment(c, { seat, disposition, findings, rules, reasons, dissent, departure, now = Date.now() }) {
  if (c.appeal == null) {
    throw new CaseError('malformed', 'no appeal exists on this case — there is nothing appellate to land');
  }
  if (c.appeal.judgment != null) {
    throw new CaseError('final', 'the appellate judgment already landed — a second judgment is final, and no removal operation exists (A-5)');
  }
  if (c.appeal.panel?.status === 'unheard') {
    throw new CaseError('unheard', 'the appeal stands recorded unheard — every disjoint set recused, nobody lawful remains to re-hear it; it is never dismissed, and no judgment lands without a lawful seat (J-1)');
  }
  if (c.appeal.panel?.status === 'witnesses-pending') {
    throw new CaseError('unheard', 'the appeal stands recorded witnesses-pending — a party is of the Enforcer\'s own class (D-8), and that route is heard never until external Witnesses exist (I-1)');
  }
  if (c.appeal.panel?.status !== 'panel') {
    throw new CaseError('malformed', 'the appeal has no resolved panel — nobody lawful has been seated to re-hear it');
  }
  if (!APPEAL_DISPOSITIONS.includes(disposition)) {
    throw new CaseError('malformed', `"${disposition}" is not a disposition — the appellate judgment affirms or departs (J-5)`);
  }
  if (typeof seat !== 'string' || !c.appeal.panel.seats.includes(seat)) {
    throw new CaseError('seat', `seat "${seat}" is not among the APPELLATE panel's resolved seats (${c.appeal.panel.seats.join(', ')}) — re-hearing seats come from the disjoint set, never the first panel`);
  }
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new CaseError('malformed', 'findings are required — the appeal re-reads the SAME record, and a fact is in evidence because a seq range proves it (J-2)');
  }
  for (const f of findings) {
    const covered = c.citations.some((cit) =>
      cit.session === f.session && f.fromSeq >= cit.fromSeq && f.toSeq <= cit.toSeq);
    if (!covered) {
      throw new CaseError('uncited', `a finding cites ${f.session} #${f.fromSeq}..#${f.toSeq}, outside every slice the case verified — the appeal admits no new evidence (J-2/J-5)`);
    }
  }
  if (!Array.isArray(rules) || rules.length === 0 || rules.some((r) => typeof r !== 'string' || !r.trim())) {
    throw new CaseError('malformed', 'the rules applied must be named');
  }
  if (typeof reasons !== 'string' || !reasons.trim()) {
    throw new CaseError('malformed', 'reasons are required');
  }
  if (disposition === 'depart') {
    if (!departure || typeof departure !== 'object' || typeof departure.grounds !== 'string' || !departure.grounds.trim()) {
      throw new CaseError('malformed', 'departure names the first judgment and argues it — an unargued departure is the non-conformity J-5 exists to refuse');
    }
  }
  if (dissent != null) {
    if (typeof dissent !== 'object' || typeof dissent.reasons !== 'string' || !dissent.reasons.trim()) {
      throw new CaseError('malformed', 'a dissent carries reasons or does not land — silence is agreement, and this is neither (A-5)');
    }
    if (typeof dissent.seat !== 'string' || !c.appeal.panel.seats.includes(dissent.seat)) {
      throw new CaseError('seat', `the dissenting seat "${dissent.seat}" is not among the appellate panel's resolved seats`);
    }
  }
  const judgment = {
    kind: 'appellate-judgment', caseId: c.id, landedAt: now, seat,
    disposition, findings: findings.map((f) => ({ session: String(f.session), fromSeq: f.fromSeq, toSeq: f.toSeq })),
    rules: rules.map((r) => r.trim()), reasons: reasons.trim(),
    ...(disposition === 'depart' ? { departure: { from: c.judgment.seat, grounds: departure.grounds.trim() } } : {}),
    ...(dissent ? { dissent: { seat: dissent.seat, reasons: dissent.reasons.trim() } } : {}),
  };
  c.appeal.judgment = judgment;
  return judgment;
}

/** Render the appeal for the docket read door. */
export function renderAppeal(c) {
  const a = c.appeal;
  if (!a) return [];
  const lines = [`  appeal: filed ${new Date(a.filedAt).toISOString()} by ${a.filer.kind}:${a.filer.id} — "${a.grounds}"`];
  if (a.panel?.status === 'panel') {
    lines.push(`    appellate panel: ${a.panel.setId} (${a.panel.seats.join(', ')}) — disjoint from ${c.panel.setId}, by declared edges`);
  } else if (a.panel?.status === 'unavailable') {
    lines.push('    appellate panel: none — no second disjoint set is declared (J-5)');
  } else if (a.panel?.status === 'unheard') {
    lines.push('    appellate panel: none — every disjoint set recused; the appeal is UNHEARD, never dismissed');
  } else if (a.panel?.status === 'witnesses-pending') {
    lines.push('    appellate panel: none — a party is of the Enforcer\'s class (D-8), and that route requires external Witnesses: pending I-1, heard never, saying so');
  }
  if (a.judgment) {
    lines.push(`    appellate judgment: ${a.judgment.disposition}ed at seat ${a.judgment.seat} — FINAL (a second appeal is refused; the petition door never closes)`);
    if (a.judgment.departure) lines.push(`      departs from the first judgment (seat ${a.judgment.departure.from}): ${a.judgment.departure.grounds}`);
    if (a.judgment.dissent) lines.push(`      dissent: seat ${a.judgment.dissent.seat}, reasons recorded (A-5)`);
  }
  return lines;
}
