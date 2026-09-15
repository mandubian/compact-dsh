// The grant store: session grants (pattern targets, scope, TTL, revocation),
// plan grants, exec-cache entries, and pending-approval bookkeeping.
// Phase 1 slice 1: in-memory store. Persistence (chained/decorated) lands
// with the port plan's later phases — the interface here is the contract.

import { fingerprint } from './fingerprint.js';

export class GrantStore {
  constructor() {
    this.sessionGrants = [];   // {id, pattern, scope:{root,session}, expiresAt, createdAt, revokedAt}
    this.planGrants = [];      // {id, pattern, planRef, expiresAt, revokedAt}
    this.cache = new Map();    // fingerprint -> {grantedAt, expiresAt}
    this.pending = new Map();  // fingerprint -> {count, firstAt, sessions:Set}
    this.floodByRoot = new Map(); // root -> count
  }

  // -- session grants -------------------------------------------------------
  addSessionGrant({ pattern, root, session, ttlMs, now }) {
    const grant = {
      id: 'sg_' + Math.random().toString(16).slice(2, 10),
      pattern, root: root ?? null, session: session ?? null,
      createdAt: now, expiresAt: ttlMs ? now + ttlMs : null, revokedAt: null,
    };
    this.sessionGrants.push(grant);
    return grant;
  }
  revokeSessionGrant(id, now) {
    const g = this.sessionGrants.find(x => x.id === id);
    if (g && !g.revokedAt) g.revokedAt = now;
    return g ?? null;
  }

  // -- plan grants ----------------------------------------------------------
  addPlanGrant({ pattern, planRef, ttlMs, now }) {
    const g = { id: 'pg_' + Math.random().toString(16).slice(2, 10), pattern, planRef, createdAt: now, expiresAt: ttlMs ? now + ttlMs : null, revokedAt: null };
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

/** Which live grants cover this target? (never expired, never revoked) */
export function coveringGrants(store, target, now) {
  const live = list => list.filter(g => (!g.expiresAt || g.expiresAt > now) && !g.revokedAt);
  return {
    session: live(store.sessionGrants).filter(g => patternMatches(g.pattern, target)),
    plan: live(store.planGrants).filter(g => patternMatches(g.pattern, target)),
  };
}
