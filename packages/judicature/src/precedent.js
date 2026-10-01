// Precedent persuades; it never amends — slice 5 (#115, J-7). Pure model,
// no I/O.
//
// THE DESIGN (docs/concept-judicature.md, "Precedent persuades; it never
// amends"): recorded judgments are citable by any Member, through a read
// door shaped like law_read — bounded, one judgment per read, carrying the
// standing sentence the gloss does. Consistency across cases is owed REASONS
// where it breaks: a judgment departing from a cited prior one must name it
// and argue it — inconsistency visible without consistency binding. And
// generalizing interpretation generates its own amendment invitation: a
// reading relied upon across cases feeds the petition layer's mechanical
// collision counter a new kind of collision — not law vs practice, but one
// reading vs the pinned text. The bench may interpret this Compact; only
// the community may grow it.
//
// THE MECHANICAL FORM of "cited": a judgment may CITE prior cases' judgments
// (follows, by default) or DEPART from them (grounds owed per departure).
// Reliance is the citation record itself — follows is what feeds the
// invitation; a departure is the court correcting itself, not a generalized
// reading, and counts nothing.
//
// Cross-runtime precedent stays persuasive (FED-1 unadopted): this door
// serves THIS docket's judgments; another composition's judgments enter as
// record evidence through a case's citations, never as rows here — the
// standing sentence says so on every read.

import { CaseError, checkPrecedentRow } from './cases.js';

/** The standing sentence every read carries — the gloss's own discipline
 *  (an interpretive aid with no force), extended to the precedent door's
 *  two honest limits: the pinned law prevails, and other compositions'
 *  judgments are evidence of reasoning, never binding law. */
export const PRECEDENT_STANDING =
  'An interpretive aid with no force: this judgment interprets the pinned law (law_read), and where the reading ' +
  'and the law disagree the law prevails — that collision is the petition channel\'s (R-11), not the court\'s to ' +
  'resolve. Judgments of other compositions are evidence of reasoning, never binding law (FED-1): persuasive ' +
  'exactly as far as the chain verifies, and no further.';

const idList = (v) => {
  if (v == null) return [];
  const parts = Array.isArray(v) ? v.map(String) : String(v).split(',');
  return parts.map((s) => s.trim()).filter(Boolean);
};

/**
 * Validate and normalize a judgment's precedent claims (J-7). Every cited
 * case must exist and carry a LANDED judgment (the operative one — the
 * appellate judgment after departure); a judgment cannot cite itself;
 * `departs` must be a subset of `cites`; and every departure owes argued
 * grounds. Consistency is owed reasons, never obedience — a citation that
 * FOLLOWS needs no argument, a departure cannot land without one.
 *
 * @param {object|null} raw - { cites, departs, grounds } as the door received
 * @param {(id: string) => object|null} resolveCase - the docket lookup
 * @param {string} [selfId] - the citing case's own id
 * @returns {{cites: string[], departs: string[], grounds: string|null}|null}
 */
export function resolvePrecedent(raw, resolveCase, selfId) {
  if (raw == null) return null;
  const cites = idList(raw.cites);
  const departs = idList(raw.departs);
  const grounds = typeof raw.grounds === 'string' && raw.grounds.trim() ? raw.grounds.trim() : null;
  if (cites.length === 0 && departs.length === 0 && grounds == null) return null;
  if (typeof resolveCase !== 'function') {
    throw new CaseError('malformed', 'precedent claims need the docket — a citation names another case\'s judgment, and the record must show it');
  }
  for (const id of cites) {
    if (id === selfId) {
      throw new CaseError('malformed', `a judgment cannot cite itself — ${id} is this case (J-7)`);
    }
    const cited = resolveCase(id);
    if (!cited) {
      throw new CaseError('malformed', `cites case ${id}, which is not on the docket — precedent is cited from what was filed, never from memory (J-7)`);
    }
    const j = cited.appeal?.judgment ?? cited.judgment;
    if (!j) {
      throw new CaseError('malformed', `cites case ${id}, which has landed no judgment — precedent is a property of judgments, not of cases (J-7)`);
    }
  }
  // the row's own invariants (self-citation, departs ⊆ cites, argued
  // departure) are the row's own checks — shared with the landing functions
  return checkPrecedentRow(selfId, { cites, departs, grounds });
}

/** The map of reliance: case id → the cases whose judgments FOLLOW it.
 *  Derived on read from the citation records, never stored — the same
 *  discipline as every derived state this layer carries. */
export function reliedUponBy(cases) {
  const map = new Map();
  for (const c of cases) {
    const p = c.appeal?.judgment?.precedent ?? c.judgment?.precedent;
    if (!p) continue;
    for (const id of p.cites) {
      if (p.departs.includes(id)) continue; // a departure relies on nothing
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(c.id);
    }
  }
  return map;
}

/** The operative judgment of a case — the appellate one after departure,
 *  else the first-instance one (an appeal unheard or witnesses-pending
 *  contests nothing; the first judgment stands operative). */
export const operativeJudgment = (c) => c.appeal?.judgment ?? c.judgment;

/** Render the bounded index — one line per landed judgment (J-7). */
export function renderPrecedentIndex(cases) {
  const landed = cases.filter((c) => operativeJudgment(c) != null);
  if (landed.length === 0) {
    return ['[J-7] no judgment has landed on the docket — precedent is a property of a body of judgments, and the body has not begun.',
      PRECEDENT_STANDING].join('\n');
  }
  const relied = reliedUponBy(cases);
  const lines = [`[J-7] ${landed.length} judgment(s) on the docket — precedent persuades; it never amends:`];
  for (const c of landed) {
    const j = operativeJudgment(c);
    const kind = j.kind === 'appellate-judgment' ? `appellate judgment (${j.disposition}ed)` : 'judgment';
    const precedent = j.precedent
      ? j.precedent.departs.length > 0
        ? ` — departs ${j.precedent.departs.join(', ')}`
        : j.precedent.cites.length > 0 ? ` — follows ${j.precedent.cites.join(', ')}` : ''
      : '';
    const reliedOn = relied.get(c.id);
    lines.push(`  ${c.id} — ${kind} at seat ${j.seat} — ${j.rules.join(', ')} — ${new Date(j.landedAt).toISOString()}${precedent}${reliedOn?.length ? ` — relied upon by ${reliedOn.join(', ')}` : ''}`);
  }
  lines.push('', PRECEDENT_STANDING);
  return lines.join('\n');
}

/** Render one judgment in full — the precedent door's single-item read:
 *  findings, rules, and the REASONS (the interpretation is the point — the
 *  docket view shows the row, this view shows the reasoning), the dissent
 *  with its reasons, and the precedent it follows or departs from. */
export function renderJudgmentAsPrecedent(c, cases) {
  const j = operativeJudgment(c);
  if (!j) {
    return [`[J-7] no judgment has landed on ${c.id} — the precedent door reads judgments, and this case has none yet.`,
      PRECEDENT_STANDING].join('\n');
  }
  const kind = j.kind === 'appellate-judgment' ? `appellate judgment — ${j.disposition}ed` : 'judgment';
  const lines = [`[J-7] ${kind} on ${c.id} — landed ${new Date(j.landedAt).toISOString()} at seat ${j.seat}${j.by ? `, recorded by ${j.by}` : ''}:`];
  for (const f of j.findings) lines.push(`  finding: ${f.session} #${f.fromSeq}..#${f.toSeq}`);
  lines.push(`  rules: ${j.rules.join(', ')}`);
  lines.push(`  reasons: ${j.reasons}`);
  if (j.departure) lines.push(`  departure: from the first judgment (seat ${j.departure.from}) — ${j.departure.grounds}`);
  if (j.dissent) lines.push(`  dissent: seat ${j.dissent.seat} — ${j.dissent.reasons}`);
  if (j.precedent) {
    const follows = j.precedent.cites.filter((id) => !j.precedent.departs.includes(id));
    if (follows.length > 0) lines.push(`  follows: ${follows.join(', ')}`);
    for (const id of j.precedent.departs) {
      lines.push(`  departs from: ${id} — ${j.precedent.grounds}`);
    }
  }
  const relied = reliedUponBy(cases).get(c.id);
  if (relied?.length) lines.push(`  relied upon by: ${relied.join(', ')} — the reading generalized; the petition channel hears it (R-11)`);
  lines.push('', PRECEDENT_STANDING);
  return lines.join('\n');
}
