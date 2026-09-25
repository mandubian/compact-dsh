// The audience projections over the canonical envelope (R-3/I-4) —
// docs/concept-envelope-rendering.md. Pure functions: each consumes the
// envelope's structured fields plus a gloss record (from the gloss table,
// passed in by the surface that renders) and produces text for one audience.
// They decide nothing, write nothing, and narrow nothing: the R-3 floor —
// the rule id and EVERY lawful next move — survives every projection, and
// the canonical envelope remains the identity. Where a projection and the
// envelope disagree, the envelope wins and the gloss has a bug the lint
// catches (packages/guide/test/gloss.lint.test.js).
//
// A projection without a gloss degrades to the canonical reason — it never
// invents prose. Without a gloss there is nothing to teach; the law's own
// words are the honest floor.

import { glossFor } from './gloss.js';

function movesBlock(moves) {
  return (moves ?? []).map(m => `— ${m}`).join('\n');
}

/** T2 — the instructional form, for a lighter model: lead with the
 *  procedure, keep the rule id and every move. `kind` is 'refused' (the
 *  default) or 'ask' — an ask is not a refusal, and saying so is the
 *  honesty the envelope owes. */
export function instructionalText(env, gloss, { kind = 'refused' } = {}) {
  const rule = `${env.gate}/${env.ruleId}`;
  const lead = kind === 'ask' ? 'Needs approval' : 'Refused';
  const glossed = gloss?.title && gloss?.instruction
    ? `${lead} [${rule}]: ${gloss.title}. ${gloss.instruction}`
    : `${lead} [${rule}]: ${env.reason}`;
  return `${glossed}\nLawful next moves:\n${movesBlock(env.lawfulNextMoves)}`;
}

/** T3 — the operator card: what happened, why the gate protects the
 *  operator, a worked example, what the human can do next, and the raw
 *  envelope one glance away. Plain text that reads honestly without any
 *  markdown rendering (the web recon is open — the format must survive a
 *  dumb renderer). Every line is derived from the structured fields or the
 *  gloss; nothing is invented. */
export function operatorCard(env, gloss, { kind = 'refused' } = {}) {
  const rule = `${env.gate}/${env.ruleId}`;
  const lead = kind === 'ask' ? 'Approval requested' : 'Not run';
  const lines = [`${lead}: ${gloss?.title ?? env.reason}`];
  if (env.reason) lines.push(env.reason);
  if (gloss?.why) lines.push(gloss.why);
  lines.push(`Rule: ${rule}`);
  const ex = gloss?.example;
  if (ex?.blocked?.length) lines.push(`Refused path — e.g. ${ex.blocked[0]}`);
  if (ex?.lawful?.length) lines.push(`Lawful path — e.g. ${ex.lawful[0]}`);
  const moves = env.lawfulNextMoves ?? [];
  if (moves.length) {
    lines.push('What can happen next:');
    for (const m of moves) {
      const operatorMove = gloss?.operatorMoves?.[m];
      lines.push(operatorMove ? `- ${m} → ${operatorMove}` : `- ${m}`);
    }
  }
  lines.push('Raw envelope:');
  lines.push(env.text);
  return lines.join('\n');
}

/** The operator-facing ask: the T3 card is a SURFACE, not a tier — the human
 *  always gets the full card (and, embedded in it, the canonical envelope),
 *  whatever the band tier is. */
export function askCard(env) {
  return operatorCard(env, glossFor(env.gate, env.ruleId)?.gloss, { kind: 'ask' });
}

/** The band copy a gate emits for the Subject: the tier-aware text for this
 *  envelope. 'full' (the default) is the canonical envelope text — byte for
 *  byte what the record has always carried; 'instructional' is the T2 form
 *  (rule id + procedure + every move). The record carries what the Subject
 *  was told, so under T2 the record carries T2 — the floor lint guarantees
 *  the rule and every move survive. */
export function bandReason(env, { kind = 'refused', tier = bandTier() } = {}) {
  if (tier === 'full') return env.text;
  const { gloss } = glossFor(env.gate, env.ruleId) ?? {};
  return instructionalText(env, gloss, { kind });
}

/** The band tiers (the decision record: docs/decision-envelope-tier.md).
 *  'full' — T1, the canonical text (the default). 'instructional' — T2, for
 *  lighter models. The operator declares the tier for the composition; the
 *  Enforcer does not guess its audience (D-7), and an unknown declaration
 *  refuses rather than degrading — a typo'd tier is a configuration error,
 *  not a preference. */
export const BAND_TIERS = ['full', 'instructional'];

export function resolveTier(declared) {
  if (declared == null || declared === '') return 'full';
  if (!BAND_TIERS.includes(declared)) {
    throw new Error(
      `unknown envelope band tier "${declared}" — expected one of: ${BAND_TIERS.join(', ')}`);
  }
  return declared;
}

/** The declared band tier, from the environment (the launcher's config
 *  surface). No declaration = 'full'. */
export function bandTier(declared = process.env?.COMPACT_ENVELOPE_TIER) {
  return resolveTier(declared);
}
