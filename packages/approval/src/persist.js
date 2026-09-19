// Grant-store persistence (port plan Phase 1 item 2): a small embedded store
// beside the session log. JSON + fsync — chosen over better-sqlite3 because
// a plugin set must install without native builds, and the state here is
// small (grants, revocations, cache entries) and rarely written (only on
// human-gated decisions).
//
// Durability semantics:
//   - writes are atomic (tmp file + fsync + rename over the target)
//   - load-time corruption throws — NEVER a silent reset. A silently
//     emptied store would resurrect revoked grants: the one direction
//     that must stay impossible. Fail loud at the earliest resolvable
//     point (the host's load-time failure doctrine).
//   - pending-approval bookkeeping is deliberately NOT persisted: a pending
//     ask is turn-scoped interactive state; a restart that lost the ask is
//     recovered by the host as an unknown-outcome tool result ("park, don't
//     checkpoint"). Grants, budgets, revocations, and cache entries persist.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { GrantStore } from './grants.js';

const FORMAT_VERSION = 2;  // v2 adds secretGrants (env NAMES + fingerprints; values are never stored)

export class PersistentGrantStore extends GrantStore {
  constructor(path) {
    super();
    this.path = path;
    this._load();
  }

  _load() {
    if (!existsSync(this.path)) return;          // first boot: start empty
    let raw;
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (e) {
      throw new Error(`compact-dsh-approval: grant store ${this.path} is unreadable (${e.message}) — refusing to start: a silent reset could resurrect revoked grants`);
    }
    if (raw?.version !== FORMAT_VERSION) {
      throw new Error(`compact-dsh-approval: grant store ${this.path} has format version ${JSON.stringify(raw?.version)}, expected ${FORMAT_VERSION} — refusing to start`);
    }
    for (const key of ['sessionGrants', 'planGrants', 'secretGrants']) {
      if (!Array.isArray(raw[key])) throw new Error(`compact-dsh-approval: grant store ${this.path} is corrupt: ${key} is not an array — refusing to start`);
    }
    for (const g of [...raw.sessionGrants, ...raw.planGrants]) {
      if (typeof g?.id !== 'string' || typeof g?.pattern?.kind !== 'string') {
        throw new Error(`compact-dsh-approval: grant store ${this.path} is corrupt: malformed grant ${JSON.stringify(g?.id)} — refusing to start`);
      }
    }
    for (const g of raw.secretGrants) {
      // a secret grant records the env NAME and its scope — if a store file
      // ever contains a `value` field, someone put a secret where only a
      // reference belongs, and the composition refuses to load it
      if (typeof g?.id !== 'string' || typeof g?.ref !== 'string' || 'value' in g) {
        throw new Error(`compact-dsh-approval: grant store ${this.path} is corrupt: malformed secret grant ${JSON.stringify(g?.id)} — refusing to start`);
      }
    }
    if (!Array.isArray(raw.cache)) throw new Error(`compact-dsh-approval: grant store ${this.path} is corrupt: cache is not an array — refusing to start`);
    this.sessionGrants = raw.sessionGrants;
    this.planGrants = raw.planGrants;
    this.secretGrants = raw.secretGrants;
    this.cache = new Map(raw.cache.map(([fp, entry]) => {
      if (typeof fp !== 'string' || typeof entry?.grantedAt !== 'number') {
        throw new Error(`compact-dsh-approval: grant store ${this.path} is corrupt: malformed cache entry — refusing to start`);
      }
      return [fp, entry];
    }));
  }

  _flush() {
    const payload = JSON.stringify({
      version: FORMAT_VERSION,
      sessionGrants: this.sessionGrants,
      planGrants: this.planGrants,
      secretGrants: this.secretGrants,
      cache: [...this.cache.entries()],
    });
    const tmp = `${this.path}.tmp-${process.pid}`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const fd = openSync(tmp, 'w');
      try {
        writeSync(fd, payload);
        fsyncSync(fd);            // the data must be on disk BEFORE the rename
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.path);              // atomic over the target
      // best-effort directory fsync so the rename itself is durable
      try { const d = openSync(dirname(this.path), 'r'); fsyncSync(d); closeSync(d); } catch { /* platforms that refuse dir fsync still have the data fsync */ }
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* nothing to clean */ }
      throw new Error(`compact-dsh-approval: could not persist grant store ${this.path}: ${e.message}`);
    }
  }
}

// Durable-state mutators flush; read paths and pending bookkeeping do not.
// consumeUse is here: a spent budget is durable state — a restart that
// resurrected uses would over-grant.
function flushed(method) {
  const base = GrantStore.prototype[method];
  return function (...args) {
    const out = base.apply(this, args);
    this._flush();
    return out;
  };
}
PersistentGrantStore.prototype.addSessionGrant = flushed('addSessionGrant');
PersistentGrantStore.prototype.revokeSessionGrant = flushed('revokeSessionGrant');
PersistentGrantStore.prototype.addPlanGrant = flushed('addPlanGrant');
PersistentGrantStore.prototype.addSecretGrant = flushed('addSecretGrant');
PersistentGrantStore.prototype.revokeSecretGrant = flushed('revokeSecretGrant');
PersistentGrantStore.prototype.cacheSet = flushed('cacheSet');
PersistentGrantStore.prototype.revokeFingerprint = flushed('revokeFingerprint');
PersistentGrantStore.prototype.consumeUse = flushed('consumeUse');
