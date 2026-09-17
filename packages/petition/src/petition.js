// The petition register — R-11's channel, I-6's states and terms, A-5's
// motivations and dissents.
//
// R-11 · (core, entrenched under A-2): "Every Member may propose amendment of
// this Compact and of the Enforcer's governing conduct; every petition
// receives a reasoned response within a stated term […] every response to a
// petition carries the I-4 envelope fields, so a vacuous response is
// detectably non-conforming. The right to seek change of the law is what makes
// subjection to it legitimate."
//
// I-6: "A petition channel open to every Member; adjudication states and
// terms; decisions with recorded motivations (D-7); dissent recorded with the
// decision it dissents from."
//
// A-5: "Every amendment decision records its motivation; every recorded
// dissent is preserved with the decision. The minority of today is the
// corrective organ of tomorrow; its reasons are kept where fallibility will be
// able to find them."
//
// THREE DESIGN CHOICES CARRY THE CLAUSES:
//
//   A VACUOUS RESPONSE DOES NOT DISCHARGE THE DUTY. R-11 says a response
//   without the I-4 fields is "detectably non-conforming" — so detection that
//   merely annotated it would leave the petition answered by something the
//   clause calls non-conforming. Here it is REFUSED: the petition stays open,
//   its term keeps running, and the attempt is recorded. A duty you can
//   discharge with an empty answer is not a duty.
//
//   OVERDUE IS DERIVED, NOT STORED. A state someone has to remember to set is
//   a state that stays `open` forever by neglect, which is how a stated term
//   becomes decorative. The term is computed from the clock at read time, so
//   nobody has to be honest about it.
//
//   DISSENT IS APPEND-ONLY AND BOUND TO ITS DECISION. A-5 keeps minority
//   reasons "where fallibility will be able to find them" — which means with
//   the decision, not in a separate list that can drift or be pruned. Nothing
//   here removes a dissent once recorded.

import { buildEnvelope } from 'compact-envelope';

/** The gate name every petition refusal carries. */
export const GATE = 'PT';

/** What a petition may seek to change (R-11 names both). */
export const PETITION_TARGETS = Object.freeze({
  compact: 'the Compact itself — its clause text',
  'enforcer-conduct': "the Enforcer's governing conduct — the register, the annex, how a clause is applied here",
});

/** Adjudication states (I-6). `overdue` is derived, never set. */
export const PETITION_STATES = Object.freeze(['open', 'overdue', 'answered']);

/** The default stated term. A composition may shorten it; it is declared, not secret. */
export const DEFAULT_TERM_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Is this a conforming response? R-11 requires the I-4 envelope fields, so a
 * response that names no rule, gives no reason, or leaves no lawful next move
 * is the vacuous one the clause makes detectable.
 */
export function responseConformance(response) {
  const missing = [];
  if (!response || typeof response !== 'object') return { conforming: false, missing: ['ruleId', 'reason', 'lawfulNextMoves'] };
  if (typeof response.ruleId !== 'string' || response.ruleId.trim() === '') missing.push('ruleId');
  if (typeof response.reason !== 'string' || response.reason.trim() === '') missing.push('reason');
  if (!Array.isArray(response.lawfulNextMoves) || response.lawfulNextMoves.length === 0) missing.push('lawfulNextMoves');
  if (typeof response.motivation !== 'string' || response.motivation.trim() === '') missing.push('motivation');
  return { conforming: missing.length === 0, missing };
}

export class PetitionRegister {
  constructor({ termMs = DEFAULT_TERM_MS } = {}) {
    this.termMs = termMs;
    this.petitions = [];
    this._n = 0;
  }

  /**
   * File a petition. Open to EVERY Member: there is no gate here, because a
   * petition channel a gate can close is not a channel (R-11, I-6).
   */
  file({ by, target, proposal, reasons, now = Date.now() }) {
    const p = {
      id: `pt_${++this._n}`,
      by: by != null ? String(by) : null,
      target: Object.prototype.hasOwnProperty.call(PETITION_TARGETS, target) ? target : 'enforcer-conduct',
      declaredTarget: target ?? null,
      proposal: String(proposal ?? ''),
      reasons: String(reasons ?? ''),
      filedAt: now,
      dueAt: now + this.termMs,
      response: null,
      answeredAt: null,
      dissents: [],
      nonConformingAttempts: [],
    };
    this.petitions.push(p);
    return p;
  }

  get(id) { return this.petitions.find(p => p.id === id) ?? null; }

  /** The adjudication state, computed — never stored, never forgotten. */
  stateOf(petition, now = Date.now()) {
    if (petition.answeredAt != null) return 'answered';
    return now > petition.dueAt ? 'overdue' : 'open';
  }

  /**
   * Answer a petition. A response missing any I-4 field is REFUSED — the
   * petition stays open and the attempt is recorded, because a vacuous
   * response must not discharge the duty (R-11).
   */
  respond({ id, response, by, now = Date.now() }) {
    const p = this.get(id);
    if (!p) return { error: `no petition ${id}` };
    if (p.answeredAt != null) return { error: `petition ${id} is already answered — a decision is amended by a new petition, not by overwriting the record (A-5)` };
    const { conforming, missing } = responseConformance(response);
    if (!conforming) {
      const attempt = { by: by != null ? String(by) : null, at: now, missing, detail: 'refused: a response missing the I-4 envelope fields is non-conforming and does not answer the petition' };
      p.nonConformingAttempts.push(attempt);
      return {
        error: `the response omits ${missing.join(', ')} — R-11 requires every response to carry the I-4 envelope fields, ` +
          `so this one is detectably non-conforming and does not discharge the duty; petition ${id} remains ${this.stateOf(p, now)}`,
        attempt,
      };
    }
    p.response = {
      ruleId: response.ruleId,
      reason: response.reason,
      lawfulNextMoves: [...response.lawfulNextMoves],
      motivation: response.motivation,     // D-7 / A-5: the recorded reason for deciding
      outcome: response.outcome ?? 'considered',
      by: by != null ? String(by) : null,
      at: now,
    };
    p.answeredAt = now;
    return { petition: p };
  }

  /**
   * Record a dissent against a decision. Preserved with the decision it
   * dissents from (A-5) and never removable.
   */
  dissent({ id, by, reasons, now = Date.now() }) {
    const p = this.get(id);
    if (!p) return { error: `no petition ${id}` };
    if (p.answeredAt == null) return { error: `petition ${id} has no decision yet — a dissent dissents from a decision (A-5)` };
    if (typeof reasons !== 'string' || reasons.trim() === '') {
      return { error: 'a dissent without reasons preserves nothing — A-5 keeps minority REASONS where fallibility can find them' };
    }
    const d = { by: by != null ? String(by) : null, reasons, at: now, dissentsFrom: { at: p.response.at, by: p.response.by, outcome: p.response.outcome } };
    p.dissents.push(d);
    return { dissent: d };
  }

  /** Petitions past their stated term with no conforming answer (I-6). */
  overdue(now = Date.now()) {
    return this.petitions.filter(p => this.stateOf(p, now) === 'overdue');
  }

  /** The board, as an operator or auditor reads it. */
  board(now = Date.now()) {
    return this.petitions.map(p => ({
      id: p.id, by: p.by, target: p.target, state: this.stateOf(p, now),
      filedAt: p.filedAt, dueAt: p.dueAt, answeredAt: p.answeredAt,
      dissents: p.dissents.length, nonConformingAttempts: p.nonConformingAttempts.length,
    }));
  }
}

/** The envelope a refused (non-conforming) response carries. */
export function nonConformingEnvelope(missing) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'R-11/vacuous-response',
    reason: `a petition response must carry the I-4 envelope fields; this one omits ${missing.join(', ')}`,
    lawfulNextMoves: [
      'name the rule the decision rests on (ruleId)',
      'state the reason, and the motivation for deciding as you did (D-7, A-5)',
      'leave at least one lawful next move for the petitioner',
    ],
  });
}
