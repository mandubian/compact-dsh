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

import { parseAllowlist, extractTarget, decide } from './allowlist.js';
import { buildEnvelope } from 'compact-envelope';

export const name = 'compact-allowlist-gate';
export const inject = ['tools'];

/** The AG-1 denial, on the shared envelope shape (one text producer —
 *  docs/concept-envelope-rendering.md): this gate's reason and moves, the
 *  shared [AG/AG-1] header form. */
export function denyEnvelope(tool, target) {
  return buildEnvelope({
    gate: 'AG',
    ruleId: 'AG-1',
    reason: `"${tool}" to ${target.host ?? ''}${target.port ? ':' + target.port : ''}${target.url ? ' (' + target.url + ')' : ''} is not covered by this runtime's network allowlist`,
    lawfulNextMoves: [
      'request a scoped session grant for this host (Gates Act, when enacted)',
      'use an approved mirror already on the allowlist',
      'escalate to your Principal with reasons',
    ],
  });
}

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
      // the shared builder owns the envelope's shape (one text producer —
      // see docs/concept-envelope-rendering.md): the reason and moves are
      // this gate's content, the [AG/AG-1] header the shared form
      const env = denyEnvelope(tool, target);
      return { kind: 'deny', reason: env.text };
    }
    return next(); // allow / abstain — delegate down the waterfall
  });
  // composition coupling (Phase 4): the constitution checks this service's
  // presence — a composition without the gate refuses to start
  ctx.provide?.('compact-allowlist-gate', { name: 'compact-allowlist-gate', rules: config?.allowlist ?? [] });
}
