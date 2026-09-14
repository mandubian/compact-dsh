// compact-dsh-approval — Phase 1 plugin (port plan Phase 1, slice 1).
//
// The layered evaluation rides the verified tools/pre-execute waterfall:
//   allowed (any grant layer) → next()
//   pending-approval / dedup  → { kind:'ask', reason } — the human gate
//   refused-flood             → { kind:'deny', reason: 'I-5/flood-cap' }
// Denials and asks are Compact envelopes (R-3/I-4). Content-blind: the
// evaluator sees targets, never messages.

import { GrantStore, patternMatches } from './grants.js';
import { evaluate, DEFAULTS } from './evaluate.js';
import { fingerprint } from './fingerprint.js';
import { parseAllowlistLikePattern } from './pattern.js';
import { buildEnvelope } from 'compact-envelope';

export { GrantStore, evaluate, fingerprint, parseAllowlistLikePattern, DEFAULTS };

export function createApproval({ execCacheTtlMs, maxPendingPerRoot } = {}) {
  const store = new GrantStore();
  return {
    store,
    fingerprint: (tool, args) => fingerprint(tool, args),
    grantSession: ({ pattern, root, session, ttlMs = 60 * 60 * 1000, now = Date.now() }) =>
      store.addSessionGrant({ pattern: parseAllowlistLikePattern(pattern), root, session, ttlMs, now }),
    grantPlan: ({ pattern, planRef, now = Date.now() }) =>
      store.addPlanGrant({ pattern: parseAllowlistLikePattern(pattern), planRef, now }),
    revoke: (id, now = Date.now()) => store.revokeSessionGrant(id, now),
    evaluate: (call) => evaluate(store, {
      execCacheTtlMs: execCacheTtlMs ?? DEFAULTS.execCacheTtlMs,
      maxPendingPerRoot: maxPendingPerRoot ?? DEFAULTS.maxPendingPerRoot,
      ...call,
    }),
  };
}

export function approvalPlugin(opts = {}) {
  const approval = createApproval(opts);
  return function apply(ctx, config) {
    approval.execCacheTtlMs = config?.execCacheTtlMs ?? opts.execCacheTtlMs;
    ctx.on('tools/pre-execute', async (exec, next) => {
      const tool = exec?.name ?? 'unknown-tool';
      const args = exec?.arguments ?? {};
      const root = (exec?.agent?.session ?? 'root').split('/')[0];
      const session = exec?.agent?.session ?? 'root';
      const v = approval.evaluate({ tool, args, root, session, now: Date.now() });
      if (v.verdict === 'allowed') return next();
      if (v.verdict === 'refused-flood') {
        const env = buildEnvelope({ gate: 'AG', ruleId: 'I-5/flood-cap',
          reason: `too many pending approvals for this root (${v.ruleId})`,
          lawfulNextMoves: ['wait for pending approvals to resolve', 'withdraw an older request', 'escalate to your Principal'] });
        return { kind: 'deny', reason: env.text };
      }
      // pending-approval / dedup-pending → the human gate
      const env = buildEnvelope({ gate: 'AG', ruleId: v.ruleId,
        reason: `"${tool}" is not covered by this runtime's grant layers`,
        lawfulNextMoves: ['request a scoped session grant for this target', 'use an approved alternative', 'escalate to your Principal'] });
      return { kind: 'ask', reason: env.text };
    });
    return approval;
  };
}
