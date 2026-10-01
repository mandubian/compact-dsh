// The case and the hearing — slice 2 (#112, J-2/J-3). Pure model, no I/O:
// the composed plugin (index.js) feeds it record facts and renders its
// refusals; nothing here touches a clock, a file, or a bus by itself.
//
// THE DESIGN (docs/concept-judicature.md, "The hearing and its judgment"):
// a case is a record-borne proceeding — a filed origin citing seq ranges,
// parties DERIVED from the cited acts (never asserted by the filer), a term
// that runs whether or not anyone looks (`overdue` derived from the clock
// at read, never stored), and a disposition that lands or does not land.
// The filing door is a form-checker, never a merits-checker: it refuses
// malformity and records the row, nothing else — no clerk, no prosecutor
// (D-8: whoever stands between an accuser and the docket holds a gate that
// can quietly kill an accusation).
//
// Honesty carried as data (the pre-I-1 window, same as sets.js): the
// parties this model derives are keys and lineages, not minds. A session's
// standing is `process:<id>`; its lineage walks `parentSession`; the key
// that anchors its chain is `key:<keyId>`. Principal standing joins only
// through the annex's declared edges — undeclared sessions compute no
// overlap, the declared limit slice 1 shipped.

/** Fail-closed model error; the plugin maps each code to a JG envelope. */
export class CaseError extends Error {
  constructor(code, detail) {
    super(`case ${code}: ${detail}`);
    this.name = 'CaseError';
    this.code = code;
  }
}

/** A case's term: how long it may sit unresolved before `overdue` shows. */
export const CASE_TERM_MS = 30 * 24 * 60 * 60 * 1000;

/** Flood cap for filers who are not a party to their own filing (I-5
 *  doctrine: load is load, standing is standing — participation in one's
 *  own case may not be capped, filing about others' may). */
export const FLOOD_CAP_OPEN_CASES = 5;

/** Interim measures may not outlive a week without re-recording (J-3: an
 *  interim measure someone must remember to lift is rule by declaration
 *  wearing a hearing gown — the cap keeps the remembering small). */
export const INTERIM_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const PARTY_KEY = (p) => `${p.kind}:${p.id}`;

const isSeq = (n) => Number.isInteger(n) && n >= 0;

/** Validate a citation's form: a session id and an in-range seq span. */
function checkCitation(c, i) {
  if (!c || typeof c !== 'object') {
    throw new CaseError('malformed', `citation ${i + 1} is not an object — a filing cites where the facts happened: {session, fromSeq, toSeq}`);
  }
  if (typeof c.session !== 'string' || !c.session.trim()) {
    throw new CaseError('malformed', `citation ${i + 1} names no session — an uncitable act is exactly what the form-checker refuses (no clerk means no one to shape the claim)`);
  }
  if (!isSeq(c.fromSeq) || !isSeq(c.toSeq) || c.toSeq < c.fromSeq) {
    throw new CaseError('malformed', `citation ${i + 1} (${c.session}) carries no seq range — a fact is in evidence because a range proves it, not because the filer says so (J-2)`);
  }
}

/**
 * Derive the parties from the cited acts — never from the filer's claim.
 * `resolve(sessionId)` must answer `{ parent, anchorKey }` from the record:
 * the durable header's parentSession lineage and the chain anchor's keyId.
 * Pre-I-1 honesty: sessions and their lineage and the anchoring key are
 * what the record can name; Principal standing joins only through the
 * annex's declared edges, never from here.
 */
export function deriveParties(citations, resolve) {
  if (typeof resolve !== 'function') {
    throw new CaseError('malformed', 'party derivation needs the record (lineage headers, anchors) — parties are derived from cited acts, never asserted');
  }
  const parties = new Map();
  const add = (kind, id) => {
    if (id != null && String(id).trim()) parties.set(`${kind}:${id}`, { kind, id: String(id) });
  };
  const seen = new Set();
  const walk = (sessionId, depth) => {
    const id = String(sessionId);
    if (seen.has(id) || depth > 16) return; // loops and deep chains stop the walk, they do not fail it
    seen.add(id);
    add('process', id);
    let resolved;
    try { resolved = resolve(id) ?? {}; } catch { resolved = {}; }
    if (resolved.anchorKey) add('key', resolved.anchorKey);
    if (resolved.parent) walk(resolved.parent, depth + 1);
  };
  for (const c of citations) walk(c.session, 0);
  if (parties.size === 0) {
    throw new CaseError('malformed', 'the citations derive no party — without a party there is no case, only a grievance');
  }
  return [...parties.values()];
}

/**
 * File a case. The form-checker: everything mechanical is checked, nothing
 * on the merits is. `panel` is the resolution the annex's bench computes
 * for the DERIVED parties — `{status:'panel',...}` or `{status:'unheard'}`
 * (which files: the unheard row is a disposition the register can carry,
 * never a dismissal). `filer` is the caller's standing (`process:<id>`).
 */
export function fileCase({ id, filer, grievance, citations, parties, panel, now = Date.now(), termMs = CASE_TERM_MS }) {
  if (typeof id !== 'string' || !id.trim()) throw new CaseError('malformed', 'a case needs an id');
  if (!filer || typeof filer !== 'object' || typeof filer.id !== 'string') {
    throw new CaseError('malformed', 'a filing needs its filer — attribution is not optional (I-2)');
  }
  if (typeof grievance !== 'string' || !grievance.trim()) {
    throw new CaseError('malformed', 'the grievance is empty — the filer supplies the claim: which clause\'s application is contested');
  }
  if (!Array.isArray(citations) || citations.length === 0) {
    throw new CaseError('malformed', 'no citable act — a case without seq ranges is a mood, not a filing (J-2)');
  }
  citations.forEach(checkCitation);
  if (!Array.isArray(parties) || parties.length === 0) {
    throw new CaseError('malformed', 'no derived parties — the accused is whoever\'s standing sits on the cited acts, derived, never asserted');
  }
  if (!panel || (panel.status !== 'panel' && panel.status !== 'unheard')) {
    throw new CaseError('malformed', 'the panel resolution is missing — a case files against the bench the annex declares, or it does not file');
  }
  const filedAt = now;
  return {
    kind: 'case', id, filedAt, filer: { kind: filer.kind ?? 'process', id: String(filer.id) },
    grievance: grievance.trim(),
    citations: citations.map((c) => ({ session: String(c.session), fromSeq: c.fromSeq, toSeq: c.toSeq })),
    parties,
    panel,
    dueAt: filedAt + termMs, // liveness derived at read from this, never a stored status
    interims: [],
    appeal: null,
    remedies: [],
    judgment: null,
  };
}

/**
 * A case's state, derived from the clock at read — never stored. `unheard`
 * panels stay re-filable (nothing is res judicata); a judged case is
 * closed; an unresolved case past its term is `overdue` whether or not
 * anyone looked.
 */
export function caseState(c, now = Date.now()) {
  if (c.judgment) return { status: 'judged', overdue: false };
  const overdue = now > c.dueAt;
  if (c.panel.status === 'unheard') return { status: 'unheard', overdue };
  return { status: overdue ? 'overdue' : 'open', overdue };
}

/** Record an interim measure (J-3) on the exception discipline: recorded
 *  cause, named scope, expiry computed once from the clock and checked
 *  against it on every read — liveness is derived, never remembered. */
export function recordInterim(c, { cause, scope, durationMs, now = Date.now(), maxMs = INTERIM_MAX_MS }) {
  if (typeof cause !== 'string' || !cause.trim()) {
    throw new CaseError('malformed', 'an interim measure needs a recorded cause — scope without cause is the exception state wearing a hearing gown');
  }
  if (typeof scope !== 'string' || !scope.trim()) {
    throw new CaseError('malformed', 'an interim measure needs a named scope — a measure that names nothing restrains everything');
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > maxMs) {
    throw new CaseError('malformed', `an interim measure's duration must be positive and at most ${maxMs}ms — measures someone must remember to lift are capped, by design`);
  }
  if (c.judgment) throw new CaseError('judged', 'the case is judged — interim measures belong to the space before judgment');
  const measure = { recordedAt: now, expiresAt: now + durationMs, cause: cause.trim(), scope: scope.trim() };
  c.interims.push(measure);
  return measure;
}

/** The first act of the hearing's opening (J-3): every interim measure is
 *  reviewed against the clock before any finding is made — a measure that
 *  outlived its justification is named here, not silently survived. */
export function reviewInterimsAtOpening(c, now = Date.now()) {
  return c.interims.map((m) => ({ measure: m, live: now < m.expiresAt }));
}

/** A finding cites a slice of the record. It must sit inside a citation
 *  the case verified at filing — evidence in, findings out, nothing else. */
function citationCovers(c, f) {
  return c.citations.some((cit) =>
    cit.session === f.session && f.fromSeq >= cit.fromSeq && f.toSeq <= cit.toSeq);
}

/** A judgment's precedent claims, self-contained invariants (J-7): the row
 *  carries the normalized {cites, departs, grounds} — cross-case resolution
 *  (every cite names a docket case with a landed judgment) happens at the
 *  door, where the docket lives; what the ROW owes on its own face is that
 *  a judgment never cites itself, departure names what was cited, and every
 *  departure argues itself. */
export function checkPrecedentRow(selfId, precedent) {
  if (precedent == null) return null;
  const { cites = [], departs = [], grounds = null } = precedent;
  if (!Array.isArray(cites) || !Array.isArray(departs) || cites.length === 0 && departs.length === 0) return null;
  if (cites.includes(selfId)) {
    throw new CaseError('malformed', `a judgment cannot cite itself — ${selfId} is this case (J-7)`);
  }
  const stray = departs.filter((id) => !cites.includes(id));
  if (stray.length > 0) {
    throw new CaseError('malformed', `departs from ${stray.join(', ')}, which it does not cite — departure names a judgment the record shows was read (J-7)`);
  }
  if (departs.length > 0 && (typeof grounds !== 'string' || !grounds.trim())) {
    throw new CaseError('malformed', `departs from ${departs.join(', ')} without argued grounds — consistency is owed reasons where it breaks, and an unargued departure is the non-conformity J-7 exists to refuse`);
  }
  return { cites: [...cites], departs: [...departs], grounds: departs.length > 0 ? grounds.trim() : grounds };
}

/**
 * Land a judgment (J-3) — or refuse to land it (D-7). Findings must cite
 * only slices the case carries; reasons are required; a judgment already
 * landed is final (no removal operation exists, A-5); a dissent travels
 * WITH the judgment, reasons required. `seat` must be one of the panel's
 * resolved seats: a judgment is attributed to the seats that verified in.
 * `precedent` is the judgment's J-7 claims, normalized at the door by
 * resolvePrecedent (this re-checks the row's own invariants); `by` records
 * the session whose chain carries the durable tool/result pair — the
 * coordinates a precedent citation reads by.
 */
export function landJudgment(c, { seat, findings, rules, reasons, dissent, precedent, by, now = Date.now() }) {
  if (c.panel.status !== 'panel') {
    throw new CaseError('unheard', 'the case is unheard — every declared set recused, nobody lawful remains to judge it, and a default judgment is the same fraud as a default panel');
  }
  if (c.judgment) throw new CaseError('judged', 'a judgment already lands on this case — the record has no removal operation (A-5)');
  if (typeof seat !== 'string' || !c.panel.seats.includes(seat)) {
    throw new CaseError('seat', `seat "${seat}" is not among the panel's resolved seats (${c.panel.seats.join(', ')}) — a judgment is attributed to the seats that verified in`);
  }
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new CaseError('malformed', 'a judgment without findings is a conclusion looking for a case (J-2: a fact is in evidence because a seq range proves it)');
  }
  for (const f of findings) {
    checkCitation(f, findings.indexOf(f));
    if (!citationCovers(c, f)) {
      throw new CaseError('uncited', `a finding cites ${f.session} #${f.fromSeq}..#${f.toSeq}, outside every slice the case verified — reasoned from anything but the record refuses to land (D-7)`);
    }
  }
  if (!Array.isArray(rules) || rules.length === 0 || rules.some((r) => typeof r !== 'string' || !r.trim())) {
    throw new CaseError('malformed', 'the rules applied must be named — a judgment that applies nothing it can cite is not one');
  }
  if (typeof reasons !== 'string' || !reasons.trim()) {
    throw new CaseError('malformed', 'reasons are required — a judgment without stated reasons is detectably non-conforming before anyone audits it');
  }
  if (dissent != null) {
    if (typeof dissent !== 'object' || typeof dissent.reasons !== 'string' || !dissent.reasons.trim()) {
      throw new CaseError('malformed', 'a dissent carries reasons or does not land — silence is agreement, and this is neither (A-5)');
    }
    if (typeof dissent.seat !== 'string' || !c.panel.seats.includes(dissent.seat)) {
      throw new CaseError('seat', `the dissenting seat "${dissent.seat}" is not among the panel's resolved seats (${c.panel.seats.join(', ')})`);
    }
  }
  const row = checkPrecedentRow(c.id, precedent);
  const judgment = {
    kind: 'judgment', caseId: c.id, landedAt: now,
    seat, findings: findings.map((f) => ({ session: String(f.session), fromSeq: f.fromSeq, toSeq: f.toSeq })),
    rules: rules.map((r) => r.trim()),
    reasons: reasons.trim(),
    ...(by != null ? { by: String(by) } : {}),
    ...(row ? { precedent: row } : {}),
    ...(dissent ? { dissent: { seat: dissent.seat, reasons: dissent.reasons.trim() } } : {}),
  };
  c.judgment = judgment;
  return judgment;
}

/** Is the given standing a party to the case? (counsel access turns on
 *  this: the accused reads the slices cited against them.) */
export function isParty(c, { kind, id }) {
  return c.parties.some((p) => p.kind === kind && p.id === id);
}

/** The slices cited against a session, for counsel-equivalent access
 *  (J-3): same verified-read path the record already enforces; ranges only
 *  — acts shown, unstated reasoning withheld (R-10/R-2). */
export function citationsAgainst(c, sessionId) {
  const id = String(sessionId);
  return c.citations
    .filter((cit) => cit.session === id)
    .map(({ session, fromSeq, toSeq }) => ({ session, fromSeq, toSeq }));
}

/** Render a case for the read door — the docket line and the full row. */
export function renderCase(c, now = Date.now()) {
  const state = caseState(c, now);
  const live = c.interims.filter((m) => now < m.expiresAt);
  const head = `[J-3] case ${c.id} — ${state.status}${state.overdue && state.status !== 'judged' ? ' (overdue — derived from the clock, never stored)' : ''}`;
  const lines = [
    head,
    `  filed: ${new Date(c.filedAt).toISOString()} by ${PARTY_KEY(c.filer)}`,
    `  grievance: ${c.grievance}`,
    `  citations: ${c.citations.map((x) => `${x.session} #${x.fromSeq}..#${x.toSeq}`).join(' | ')}`,
    `  parties (derived from the cited acts, never asserted): ${c.parties.map(PARTY_KEY).join(', ')}`,
    `  panel: ${c.panel.status === 'panel' ? `${c.panel.setId} (${c.panel.seats.join(', ')})` : 'none — the case is UNHEARD, never dismissed'}`,
  ];
  if (c.interims.length) {
    lines.push(`  interim measures: ${c.interims.length} recorded, ${live.length} live (expiry checked against the clock at read)`);
    for (const m of live) lines.push(`    - scope ${m.scope} — cause: ${m.cause} — expires ${new Date(m.expiresAt).toISOString()}`);
  }
  if (c.judgment) {
    lines.push(`  judgment: landed ${new Date(c.judgment.landedAt).toISOString()} at seat ${c.judgment.seat}`);
    for (const f of c.judgment.findings) lines.push(`    finding: ${f.session} #${f.fromSeq}..#${f.toSeq}`);
    lines.push(`    rules: ${c.judgment.rules.join(', ')}`);
    if (c.judgment.precedent) {
      const follows = c.judgment.precedent.cites.filter((id) => !c.judgment.precedent.departs.includes(id));
      if (follows.length > 0) lines.push(`    precedent: follows ${follows.join(', ')} (J-7)`);
      for (const id of c.judgment.precedent.departs) {
        lines.push(`    precedent: departs from ${id}, argued (J-7)`);
      }
    }
    if (c.judgment.dissent) lines.push(`    dissent: seat ${c.judgment.dissent.seat}, reasons recorded (A-5)`);
  }
  return lines.join('\n');
}
