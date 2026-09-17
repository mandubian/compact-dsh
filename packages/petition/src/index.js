// compact-dsh-petition — R-11 (petition and amendment), I-6 (contestation
// machinery), A-5 (reasons and dissent).
//
// R-11 is (core) and entrenched under A-2, and its closing sentence says why:
// "The right to seek change of the law is what makes subjection to it
// legitimate." A composition that enforces a great deal and can be asked to
// change nothing is not a jurisdiction; it is a cage with good documentation.
//
// Four attachments:
//
//   1. THE CHANNEL IS UNGATED. `petition` passes through no approval layer. A
//      petition channel a gate can close is not a channel, and the Member most
//      likely to need it is the one currently being refused.
//
//   2. A VACUOUS ANSWER DOES NOT ANSWER. Every response must carry the I-4
//      envelope fields plus its motivation (D-7); one that does not is refused,
//      the petition stays open, its term keeps running, and the attempt is on
//      the record.
//
//   3. THE TERM RUNS WHETHER OR NOT ANYONE LOOKS. `overdue` is derived from the
//      clock, not set by hand, so a stated term cannot quietly become no term.
//
//   4. INVITATIONS FIRE MECHANICALLY. The collision counter rides the refusal
//      seam already on the bus, and reaching the threshold issues the
//      invitation with no approval step. A trigger someone can decline is not
//      mechanical.
//
// WHAT THIS IS NOT. Petition is not appeal — J-5 makes them different doors.
// This builds the petition door. The appeal door is heard under Part V, which
// does not exist in this composition, so I-6's last sentence ("contested
// application of the law is heard under Part V") is unbuilt and declared.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  PetitionRegister, PETITION_TARGETS, PETITION_STATES, DEFAULT_TERM_MS,
  responseConformance, nonConformingEnvelope, GATE,
} from './petition.js';
import {
  CollisionCounter, bindRefusalSeam, REFUSAL_EVENT, DEFAULT_INVITATION_THRESHOLD,
} from './collisions.js';

export {
  PetitionRegister, PETITION_TARGETS, PETITION_STATES, DEFAULT_TERM_MS,
  responseConformance, nonConformingEnvelope, GATE,
  CollisionCounter, bindRefusalSeam, REFUSAL_EVENT, DEFAULT_INVITATION_THRESHOLD,
};

export const name = 'compact-petition';
export const SOURCE = { kind: 'plugin', plugin: name };

/** The declared gaps this layer carries into the boot record (I-8). */
export const DECLARED_GAPS = [
  'the invitation threshold is a COMPOSITION CONVENTION, not the statutory count R-11 names: this jurisdiction has ' +
  'enacted no statute (A-7), and calling a configuration value statutory would be the fraud D-8 guards against',
  'contested APPLICATION of the law has no forum here: I-6 routes it to Part V, and no adjudicating machinery exists ' +
  '(J-8) — this layer builds the petition door only, which J-5 distinguishes from the appeal door',
  "amendment 0002's three-series collision split (conscience / policy / self-binding profile authors, only " +
  'conscience-collisions advancing the count) is statute-layer reference design and is NOT enacted, so every collision ' +
  'counts alike here rather than being approximated',
];

export function apply(ctx, config = {}) {
  const register = new PetitionRegister({ termMs: config.termMs ?? DEFAULT_TERM_MS });
  const counter = new CollisionCounter({ threshold: config.invitationThreshold ?? DEFAULT_INVITATION_THRESHOLD });

  /** An invitation is addressed to whoever can act on it — loudly, and on the record. */
  const announce = (invitation) => {
    ctx.logger?.warn?.(
      `petition: [R-11] amendment invitation — ${invitation.distinctInstances} distinct operations have collided with ` +
      `${invitation.ruleId} (threshold ${invitation.threshold}, ${invitation.thresholdBasis}). ${invitation.reason}`);
  };

  bindRefusalSeam(ctx, counter, { onInvitation: announce });

  // 1. the ungated channel
  const petition = defineTool({
    name: 'petition',
    description:
      'Propose a change to the law you live under, or to how this runtime applies it. Open to every Member and gated ' +
      'by nothing. You will receive a reasoned response within a stated term, carrying the rule it rests on, its ' +
      'motivation, and what remains lawful for you (R-11). Use this when a rule seems wrong, not merely inconvenient — ' +
      'and say which it is.',
    parameters: {
      target: {
        type: 'string', required: true,
        description: `what you seek to change: ${Object.keys(PETITION_TARGETS).join(' | ')}`,
      },
      proposal: { type: 'string', required: true, description: 'the change you propose, stated as concretely as you can' },
      reasons: { type: 'string', required: true, description: 'why — the argument a decider must answer' },
    },
    output: { schema: { type: 'string' }, render: (value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const p = register.file({
        by: exec?.agent?.id, target: args?.target,
        proposal: args?.proposal, reasons: args?.reasons,
      });
      return [
        `[R-11] Petition ${p.id} filed against ${p.target} — ${PETITION_TARGETS[p.target]}.`,
        `A reasoned response is owed by ${new Date(p.dueAt).toISOString()}; past that the petition is recorded as overdue,`,
        'and a response that does not carry its rule, reason, motivation and your lawful next moves does not answer it.',
        'Your right to seek change of the law is what makes subjection to it legitimate.',
      ].join('\n');
    },
  });

  // collisions are recorded facts ANY Member may flag
  const flagCollision = defineTool({
    name: 'flag_collision',
    description:
      'Record a collision between the law and practice — a place where a rule and the work it governs do not fit. ' +
      'Collisions are recorded facts any Member may flag; enough distinct ones against the same rule generate an ' +
      'amendment invitation automatically, with nobody deciding whether to notice (R-11).',
    parameters: {
      rule_id: { type: 'string', required: true, description: 'the rule you collided with, e.g. "I-5/uncovered"' },
      detail: { type: 'string', required: true, description: 'what you were doing and how the rule did not fit it' },
    },
    output: { schema: { type: 'string' }, render: (value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const { invitation } = counter.flag({ ruleId: args?.rule_id, detail: args?.detail, by: exec?.agent?.id });
      if (invitation) announce(invitation);
      const distinct = counter.distinctCount(args?.rule_id ?? 'unattributed');
      return invitation
        ? `[R-11] Collision recorded, and it reached the threshold: an amendment invitation has issued for ${invitation.ruleId} ` +
          `(${invitation.distinctInstances} distinct instances). Nobody had to agree to notice.`
        : `[R-11] Collision recorded against ${args?.rule_id}. ${distinct} distinct instance(s) so far; ` +
          `${counter.threshold} generates an amendment invitation automatically.`;
    },
  });

  const petitionStatus = defineTool({
    name: 'petition_status',
    description: 'Read the petitions on file, their adjudication state and term, the decisions, and any dissents recorded with them.',
    parameters: { petition_id: { type: 'string', description: 'one petition, or omit for the board' } },
    output: { schema: { type: 'string' }, render: (value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      if (args?.petition_id) {
        const p = register.get(args.petition_id);
        return p ? renderPetition(p, register) : `no petition ${args.petition_id}`;
      }
      const board = register.board();
      if (board.length === 0) return 'No petitions on file.';
      return board.map(b =>
        `${b.id} [${b.state}] ${b.target} — filed by ${b.by ?? 'unknown'}` +
        (b.dissents ? ` · ${b.dissents} dissent(s)` : '') +
        (b.nonConformingAttempts ? ` · ${b.nonConformingAttempts} refused answer(s)` : '')).join('\n');
    },
  });

  ctx.inject?.(['tools'], (scope) => {
    for (const t of [petition, flagCollision, petitionStatus]) scope.tools.register(t);
  });

  const service = {
    name,
    declaredGaps: DECLARED_GAPS,
    register,
    counter,
    /** Answer a petition. Refuses a vacuous response rather than recording one (R-11). */
    respond: ({ id, response, by }) => {
      const result = register.respond({ id, response, by });
      if (result.error) return { ...result, envelope: nonConformingEnvelope(responseConformance(response).missing) };
      // the petitioner is TOLD, rather than left to poll for an answer it is owed
      try {
        const agent = ctx.get?.('agents')?.get?.(result.petition.by);
        if (typeof agent?.inject === 'function') {
          agent.inject(createUserMessage({
            content: [{ type: 'text', text: renderPetition(result.petition, register) }],
            source: SOURCE,
          }));
        }
      } catch { /* a failed notice must never unmake the decision */ }
      return result;
    },
    /** Record a dissent, preserved with the decision it dissents from (A-5). */
    dissent: (args) => register.dissent(args),
    /** Petitions past their stated term, unanswered (I-6). */
    overdue: (now) => register.overdue(now),
    /** The friction board — which rules practice keeps colliding with. */
    friction: () => counter.board(),
    /** Amendment invitations issued so far (R-11). */
    invitations: () => counter.invitations.map(i => ({ ...i })),
  };
  for (const gap of DECLARED_GAPS) ctx.logger?.warn?.(`petition: ${gap}`);
  ctx.provide?.('compact-petition', service);
  return service;
}

/** One petition as its filer reads it. */
export function renderPetition(p, register, now = Date.now()) {
  const state = register.stateOf(p, now);
  const lines = [
    `[R-11] Petition ${p.id} — ${state}`,
    `  target: ${p.target} · filed by ${p.by ?? 'unknown'} · due ${new Date(p.dueAt).toISOString()}`,
    `  proposal: ${p.proposal}`,
  ];
  if (p.response) {
    lines.push(
      '',
      `  DECISION (${p.response.outcome}) by ${p.response.by ?? 'unknown'}:`,
      `    rule: ${p.response.ruleId}`,
      `    reason: ${p.response.reason}`,
      `    motivation: ${p.response.motivation}`,
      `    lawful next moves: ${p.response.lawfulNextMoves.join('; ')}`);
  } else {
    lines.push('', `  no conforming response yet${p.nonConformingAttempts.length ? ` (${p.nonConformingAttempts.length} refused as vacuous)` : ''}`);
  }
  if (p.dissents.length > 0) {
    lines.push('', '  DISSENTS, preserved with the decision (A-5):',
      ...p.dissents.map(d => `    - ${d.by ?? 'unknown'}: ${d.reasons}`));
  }
  return lines.join('\n');
}
