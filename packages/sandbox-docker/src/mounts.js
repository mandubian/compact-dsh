// Shared path machinery for the docker sandbox package: canonicalization,
// the sensitive-path deny-list, and the Phase 2 mount-grant listing the
// provider consumes at confine time.
//
// Canonicalization is security here exactly as it is for fingerprints:
// grants and binds are matched as canonical absolute paths (realpath —
// symlink games stop at materialization, per docs/concept-mount-grants.md).
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Canonical absolute path: realpath when it resolves, else lexical resolve. */
export function canonicalizeBestEffort(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(String(path));
  }
}

/** Is `p` equal to or under `root`? (both canonical, separator-anchored) */
export function within(root, p) {
  if (typeof root !== 'string' || typeof p !== 'string') return false;
  if (root === '/') return p.startsWith('/');
  return p === root || p.startsWith(root + '/');
}

/** statSync that never throws (missing path → null). */
export function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * The host-fs deny-list (port plan Phase 2 item 4): sensitive paths that are
 * masked inside every confined container (provider) and that mount grants can
 * never name (request tool — protected paths are terminal, never grantable).
 * Computed from the operator's home at package load; compositions extend it.
 */
export const DEFAULT_SENSITIVE_PATHS = (() => {
  const home = homedir();
  return [
    `${home}/.ssh`, `${home}/.aws`, `${home}/.azure`, `${home}/.gnupg`,
    `${home}/.config/gcloud`, `${home}/.config/gh`, `${home}/.netrc`,
    `${home}/.docker`, `${home}/.kube`,
    '/etc/shadow', '/etc/gshadow', '/etc/sudoers',
  ].map(canonicalizeBestEffort);
})();

/**
 * Live mount grants for one session — the PathPrefix session grants of the
 * Phase 1 store whose scope covers this session id, reduced to bind facts.
 * Scope logic mirrors the evaluator's separator-anchored rule.
 */
export function mountGrantsFor(store, sessionId, now = Date.now()) {
  const sid = sessionId != null ? String(sessionId) : null;
  return store.sessionGrants
    .filter(g => g.pattern.kind === 'PathPrefix')
    .filter(g => !g.revokedAt && (!g.expiresAt || g.expiresAt > now))
    .filter(g =>
      (g.session != null) ? g.session === sid
      : (g.root != null) ? (sid === g.root || (sid ?? '').startsWith(g.root + '/'))
      : true)
    .map(g => ({ path: g.pattern.value.path, ceiling: g.pattern.value.ceiling, id: g.id }));
}
