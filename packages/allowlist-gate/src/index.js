// @autonoetic/dsh-allowlist-gate — Phase 0 plugin (port plan, Phase 0 item 2).
//
// A tools/pre-execute gate: network-capable tool calls are checked against a
// declared allowlist; uncovered calls are denied with a Compact-shaped
// envelope (R-3/I-4). Content-blind by design — the gate never inspects the
// message, only the target (R-9: content-blind limits are not punishment).
//
// Pinned against @deepseek-ai/dsh ~0.1.5-rc.1. The dsh-facing surface is
// deliberately thin: all decisions live in ./allowlist.js (pure, tested).

import { parseAllowlist, extractTarget, decide, envelope } from './allowlist.js';

/**
 * @param {{ allowlist?: string[] }} opts
 * @returns {(ctx: unknown) => void} a Cordis-style plugin: registers one
 *   listener on ctx. The handler returns a PreToolDecision for denials and
 *   undefined (pass) otherwise, per the dsh waterfall contract.
 */
export function allowlistGate(opts = {}) {
  const rules = parseAllowlist(opts.allowlist ?? []);
  return function apply(ctx) {
    ctx.on('tools/pre-execute', event => {
      const tool = event?.tool ?? event?.name ?? 'unknown-tool';
      const target = extractTarget(event?.args ?? event?.arguments ?? {});
      const d = decide(target, rules);
      if (d.decision === 'deny') return envelope(tool, target);
      return undefined; // allow / abstain — the waterfall passes through
    });
  };
}

export default allowlistGate;
