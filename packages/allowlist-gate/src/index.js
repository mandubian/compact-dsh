// compact-dsh-allowlist-gate — Phase 0 plugin (port plan, Phase 0 item 2).
//
// A tools/pre-execute waterfall gate: network-capable tool calls are checked
// against a declared allowlist; uncovered calls are denied with a
// Compact-shaped reason (rule ID [AG-1] + lawful next moves, R-3/I-4).
// Content-blind by design — the gate inspects the target, never the message
// (R-9). Verified against the installed @deepseek-ai/dsh-tools types:
// the listener is a waterfall — pass = return next(), deny = return the
// PreToolDecision; tool identity is exec.name / exec.arguments.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { parseAllowlist, extractTarget, decide, envelope } from './allowlist.js';

export const name = 'compact-allowlist-gate';
export const inject = ['tools'];

/**
 * @param {unknown} ctx Cordis context.
 * @param {{ allowlist?: string[] }} [config] — from the cordis composition.
 */
export function apply(ctx, config) {
  const rules = parseAllowlist(config?.allowlist ?? []);
  ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = exec?.name ?? 'unknown-tool';
    const target = extractTarget(exec?.arguments ?? {});
    const d = decide(target, rules);
    if (d.decision === 'deny') {
      const env = envelope(tool, target);
      const moves = env.lawfulNextMoves.map(m => `— ${m}`).join('\n');
      return { kind: 'deny', reason: `${env.reason}\nLawful next moves:\n${moves}` };
    }
    return next(); // allow / abstain — delegate down the waterfall
  });
}
