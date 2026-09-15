// compact-dsh-remote-access — Phase 2 plugin (port plan Phase 2 item 3).
//
// Static analysis of shell args for network-access patterns, riding the
// verified tools/pre-execute waterfall. Findings route through the Phase 1
// grant layers via the compact-approval service's gate — so "this command
// needs network" is approvable per-host, not per-command: an allowed-once
// materializes an exec-cache entry keyed (tool, host), and a session grant
// for the host covers every later command hitting it.
//
// Opaque findings (a network verb with no statically resolvable target)
// cannot be granted per-host — they are refused with an envelope naming the
// lawful repair, never asked forever. Refusals ride the same LoopGuard
// refusal seam as the approval gate's own.
//
// Composition coupling: injects 'compact-approval' — a composition without
// the grant layers never applies this plugin (fail loudly at load time).
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { buildEnvelope } from 'compact-envelope';
import { REFUSAL_EVENT } from 'compact-dsh-approval';
import { createAnalyzer } from './analyzer.js';

export { createAnalyzer };

export const name = 'compact-remote-access';
export const inject = ['compact-approval'];

export function apply(ctx, config) {
  const analyzer = createAnalyzer(config ?? {});
  ctx.inject(['compact-approval'], (scope) => {
    const approval = scope['compact-approval'];
    // composition coupling (Phase 4): the constitution checks this service's
    // presence — a composition without the analyzer refuses to start
    scope.provide?.('compact-remote-access', { name: 'compact-remote-access', analyzer });
    scope.on('tools/pre-execute', async (exec, next) => {
      const findings = analyzer.findings(exec);
      if (findings.length === 0) return next();
      for (const f of findings) {
        if (!f.target) {
          // opaque network access: no per-host gate exists — fail closed
          const env = buildEnvelope({ gate: 'RA', ruleId: 'D-7/opaque-network',
            reason: `"${f.verb}" requires network access with an unresolvable target — static analysis cannot gate it per-host (fail-closed)`,
            lawfulNextMoves: ['rephrase with a literal host or URL so the request can be gated per-host', 'use an approved alternative', 'escalate to your Principal'] });
          try { ctx.emit?.(REFUSAL_EVENT, { kind: 'deny', verdict: 'opaque-network', ruleId: 'D-7/opaque-network', tool: exec?.name ?? 'unknown-tool', fingerprint: null, root: null, session: null, at: Date.now() }); } catch { /* accounting must not break enforcement */ }
          return { kind: 'deny', reason: env.text };
        }
        // route the finding through the five grant layers (approvable per-host)
        const d = approval.gate({ name: exec?.name ?? 'unknown-tool', arguments: f.target, agent: exec?.agent, callId: exec?.callId });
        if (d) return d;
      }
      return next();
    });
  });
}
