// The ordered five-layer evaluation (docs/concept-approval-layers.md).
// Pure logic over (call, store, now): no host, no I/O, fully testable.
import { fingerprint } from './fingerprint.js';
import { coveringGrants } from './grants.js';

export const DEFAULTS = {
  execCacheTtlMs: 24 * 60 * 60 * 1000, // 24h; 0 disables
  maxPendingPerRoot: 50,               // flood cap
  pendingTtlMs: 5 * 60 * 1000,         // a pending ask older than this is forgotten (flood capacity self-heals)
};

/**
 * Ordered layers:
 *   1 exec cache → 2 plan grants → 3 session grants → 4 pending dedup →
 *   5 flood cap. Uncovered = {verdict:'uncovered'} → caller asks the human
 *   (approval/request) and records the pending request.
 */
export function evaluate(store, { tool, args, root, session, now, execCacheTtlMs, maxPendingPerRoot, pendingTtlMs }) {
  const fp = fingerprint(tool, args);
  const target = { ...args };

  // decisions that never reached the store must not hold flood capacity forever
  store.sweepPending(now, pendingTtlMs ?? DEFAULTS.pendingTtlMs);

  // 1. exec cache
  if (store.cacheHit(fp, now)) return { verdict: 'allowed', layer: 'exec-cache', ruleId: fp, fingerprint: fp };

  const { session: sessionHits, plan: planHits } = coveringGrants(store, target, now);

  // 2. plan grants
  if (planHits.length) return { verdict: 'allowed', layer: 'plan-grant', ruleId: planHits[0].id, fingerprint: fp };

  // 3. session grants — scoped: a session-scoped grant covers its own session
  //    and every session under its root; root-scoped covers the whole root.
  const scopeOk = g =>
    (g.session != null) ? g.session === session
    : (g.root != null) ? (session ?? '').startsWith(g.root)
    : true;
  if (sessionHits.some(g => scopeOk(g))) {
    return { verdict: 'allowed', layer: 'session-grant', ruleId: sessionHits[0].id, fingerprint: fp };
  }

  // 4. pending dedup — an identical uncovered call already awaiting approval
  const p = store.pending.get(fp);
  if (p) { p.count += 1; return { verdict: 'dedup-pending', ruleId: fp, fingerprint: fp }; }

  // 5. flood cap — record the pending request unless the root is over cap
  const cap = maxPendingPerRoot ?? DEFAULTS.maxPendingPerRoot;
  if (store.countPending(root) >= cap) {
    return { verdict: 'refused-flood', ruleId: 'I-5/flood-cap', fingerprint: fp };
  }
  store.recordPending(root);
  store.pending.set(fp, { count: 1, firstAt: now, root });
  return { verdict: 'pending-approval', ruleId: fp, fingerprint: fp };
}
