// Compact-shaped denial envelope (R-3/I-4): a refusal always names the rule,
// the reason, and the lawful next moves — the same shape for humans and agents.
export function buildEnvelope({ gate, ruleId, reason, lawfulNextMoves }) {
  const moves = (lawfulNextMoves ?? []).map(m => `— ${m}`).join('\n');
  const reasonText = `[${gate}${ruleId ? '/' + ruleId : ''}] ${reason}` +
    (moves ? `\nLawful next moves:\n${moves}` : '');
  return { gate, ruleId, reason, lawfulNextMoves: lawfulNextMoves ?? [], text: reasonText };
}

// The audience projections and the band tier (docs/concept-envelope-rendering.md):
// the gloss lives here too (band-time data — see src/gloss.js); projections
// decide nothing and narrow nothing (R-3 floor, lint-enforced).
export {
  instructionalText,
  operatorCard,
  askCard,
  bandReason,
  resolveTier,
  bandTier,
  BAND_TIERS,
} from './project.js';
export { GLOSS, WILDCARD_GLOSS, glossFor } from './gloss.js';
