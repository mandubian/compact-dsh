// The grant store: session grants (pattern targets, scope, TTL, budget,
// revocation), plan grants, exec-cache entries, and pending-approval
// bookkeeping. The in-memory class is the contract; persistence
// (JSON+fsync, src/persist.js) decorates it without changing semantics.

import { fingerprint } from './fingerprint.js';

export class GrantStore {
  constructor() {
    this.sessionGrants = [];   // {id, pattern, root, session, expiresAt, createdAt, maxUses, uses, revokedAt}
    this.planGrants = [];      // {id, pattern, planRef, expiresAt, createdAt, maxUses, uses, revokedAt}
    this.cache = new Map();    // fingerprint -> {grantedAt, expiresAt, target}
    this.pending = new Map();  // fingerprint -> {count, firstAt, root}
    this.floodByRoot = new Map(); // root -> count
  }

  // -- session grants -------------------------------------------------------
  // maxUses (budget): null = unlimited; otherwise the grant covers exactly
  // that many executions, then stops covering (a spent grant is an expired
  // grant — widening requires a new grant through the gate). Uses are
  // consumed by the evaluator when a grant ANSWERS (layers 2–3), never by
  // exec-cache replays — the cache is its own fingerprint-level grant.
  // ttlMs is MANDATORY in effect: "grants are scoped and expiring"
  // (docs/concept-approval-layers.md — no blanket grants) — a falsy ttlMs is
  // replaced by the default hour, never by a permanent grant. Plan grants
  // below are the exception: their bound is the session itself.
  addSessionGrant({ pattern, root, session, ttlMs, maxUses = null, now }) {
    const grant = {
      id: 'sg_' + Math.random().toString(16).slice(2, 10),
      pattern, root: root ?? null, session: session ?? null,
      createdAt: now, expiresAt: now + (ttlMs || 60 * 60 * 1000),
      maxUses, uses: 0, revokedAt: null,
    };
    this.sessionGrants.push(grant);
    return grant;
  }

  // -- plan grants ----------------------------------------------------------
  addPlanGrant({ pattern, planRef, ttlMs, maxUses = null, now }) {
    const g = { id: 'pg_' + Math.random().toString(16).slice(2, 10), pattern, planRef, createdAt: now, expiresAt: ttlMs ? now + ttlMs : null, maxUses, uses: 0, revokedAt: null };
    this.planGrants.push(g); return g;
  }

  // -- exec cache -----------------------------------------------------------
  // Entries carry the canonical target so a revocation can find and kill the
  // fingerprints a grant covered (the fingerprint itself is one-way).
  cacheSet(fp, now, ttlMs, target) {
    if (ttlMs === 0) return; // 0 disables
    this.cache.set(fp, { grantedAt: now, expiresAt: ttlMs ? now + ttlMs : null, target: target ?? null });
  }
  cacheHit(fp, now) {
    const e = this.cache.get(fp);
    if (!e) return false;
    if (e.expiresAt != null && e.expiresAt <= now) { this.cache.delete(fp); return false; }
    return true;
  }

  // -- flood bookkeeping ----------------------------------------------------
  countPending(root) { return this.floodByRoot.get(root) ?? 0; }
  recordPending(root) { this.floodByRoot.set(root, this.countPending(root) + 1); }

  /**
   * A pending request was decided (approved, rejected, cancelled, or failed
   * closed): drop the dedup record and return the flood-capacity slot. The
   * next identical call re-asks as a fresh request.
   */
  resolvePending(root, fp) {
    this.pending.delete(fp);
    const left = this.countPending(root) - 1;
    if (left > 0) this.floodByRoot.set(root, left);
    else this.floodByRoot.delete(root);
  }

  /**
   * Forget pending requests older than maxAgeMs (a decision that never
   * reached us — e.g. answered by policy before dispatch — must not consume
   * flood capacity forever). Returns the number of forgotten requests.
   */
  sweepPending(now, maxAgeMs) {
    let n = 0;
    for (const [fp, p] of this.pending) {
      if (now - p.firstAt > maxAgeMs) {
        this.resolvePending(p.root, fp);
        n++;
      }
    }
    return n;
  }

  /**
   * Revoke a grant AND kill every exec-cache entry its pattern covered —
   * approval must not outlive its grant (port plan Phase 1 item 6).
   * Returns the grant, or null for an unknown id.
   */
  revokeSessionGrant(id, now) {
    const g = this.sessionGrants.find(x => x.id === id);
    if (!g) return null;
    if (!g.revokedAt) g.revokedAt = now;
    for (const [fp, e] of this.cache) {
      if (!e.target || patternMatches(g.pattern, e.target)) this.cache.delete(fp);
    }
    return g;
  }

  /** Kill one fingerprint's cache entry directly (allowed-once undo). */
  revokeFingerprint(fp) { return this.cache.delete(fp); }

  /**
   * Consume one use of a budgeted grant (no-op for unlimited grants). A store
   * METHOD, not a helper: durable stores flush it — a restart must never
   * resurrect spent budget.
   */
  consumeUse(grant) {
    if (grant && grant.maxUses != null) grant.uses += 1;
  }
}

// -- pattern matching (same classes as the allowlist gate) --------------------
export function patternMatches(pattern, target) {
  if (pattern.kind === 'UrlPrefix') return typeof target.url === 'string' && target.url.startsWith(pattern.value);
  if (target.host == null) return false;
  switch (pattern.kind) {
    case 'ExactHost': return target.host === pattern.value && target.port == null;
    case 'HostSuffix': return (target.host === pattern.value || target.host.endsWith('.' + pattern.value)) && target.port == null;
    case 'HostAndPort': return target.host === pattern.value.host && target.port === pattern.value.port;
    default: return false;
  }
}

/** Which live grants cover this target? (never expired, never revoked, never spent) */
export function coveringGrants(store, target, now) {
  const live = list => list.filter(g =>
    (!g.expiresAt || g.expiresAt > now) && !g.revokedAt &&
    (g.maxUses == null || g.uses < g.maxUses));
  return {
    session: live(store.sessionGrants).filter(g => patternMatches(g.pattern, target)),
    plan: live(store.planGrants).filter(g => patternMatches(g.pattern, target)),
  };
}
