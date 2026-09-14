// Compact-shaped denial envelope (R-3/I-4): a refusal always names the rule,
// the reason, and the lawful next moves — the same shape for humans and agents.
export function buildEnvelope({ gate, ruleId, reason, lawfulNextMoves }) {
  const moves = (lawfulNextMoves ?? []).map(m => `— ${m}`).join('\n');
  const reasonText = `[${gate}${ruleId ? '/' + ruleId : ''}] ${reason}` +
    (moves ? `\nLawful next moves:\n${moves}` : '');
  return { gate, ruleId, reason, lawfulNextMoves: lawfulNextMoves ?? [], text: reasonText };
}
