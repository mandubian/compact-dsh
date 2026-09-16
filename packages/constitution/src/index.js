// compact-dsh-constitution — Phase 4: the meta-layer (port plan Phase 4).
//
// The constitution binds the composition three ways, per F-5:
//   1. Boot verification — the bundled Compact body must hash to its pinned
//      digest (and to the operator's trustedDigest when one is configured);
//      mismatch = the law was tampered with or swapped = refuse to start.
//   2. Composition coupling — every required enforcement service must exist
//      when the constitution applies. The blessed composition applies the
//      enforcement plugins FIRST; a composition missing any of them does not
//      enforce the floor and REFUSES TO START — boot failure, never a
//      degraded mode (the register's refuse-to-start path).
//   3. The rule registry — materialized from the bundled enforcement
//      register after the coupling check: every 'enforced' entry becomes a
//      registered rule citing its plugin and verifiers. Register entries
//      citing unknown clause IDs are rogue enforcement (D-8) and refuse the
//      boot; the clause list derives from the body's own headers, so the
//      register can never drift from the law.
//
// The boot attestation records what was verified and what is owed — the
// declared gaps (draft-not-ratified, pinned-not-signed digest, unsigned
// chain links) are degradation honesty (I-8): loud, never silent.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { readFileSync } from 'node:fs';
import {
  COMPACT_BODY, COMPACT_DIGEST, COMPACT_SOURCE_URL, COMPACT_SOURCE_REVISION,
  TAUGHT_DIGEST, clauseIds, verifyBody,
} from './body.js';

export { COMPACT_BODY, COMPACT_DIGEST, COMPACT_SOURCE_URL, TAUGHT_DIGEST, clauseIds, verifyBody };

export const name = 'compact-constitution';
// Composition ordering, expressed the Cordis way: when loaded through the
// plugin machinery (dsh plugin add / a profile), these inject requirements
// defer the constitution's apply until the enforcement services exist — the
// load-order discipline the coupling check below enforces for manual
// composition is then guaranteed by the framework itself.
// The roster (compact-specialists) joined the blessed composition in
// Phase 5: MA-1/MA-2 are enforced capabilities on the same terms as the floor.
// The capability gate (compact-capability-gate) joined in Phase 6: it is what
// binds SCH-1 by enforcing the capability's ABSENCE, and it is the general
// mechanism for Part VI's "cannot be dodged by undeclared use" (D-8).
// The self-model (compact-self-model) joined next: R-1's attestation and
// R-13's inquiry are the Subject's own half of the bargain — what the governed
// party may know about itself and about whoever is acting on it.
export const inject = ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox', 'compact-specialists', 'compact-capability-gate', 'compact-record', 'compact-self-model'];

const REGISTER = JSON.parse(readFileSync(new URL('../register.json', import.meta.url), 'utf8'));

// The declared gaps — degradation honesty (I-8): these are owed, and saying
// so is the difference between a convention and a fraud.
export const DECLARED_GAPS = [
  'the Compact is draft v0.5 and NOT yet ratified: this composition claims no Compact standing (F-5)',
  'signature verification unimplemented: the Compact has published no amendment keys — the digest is pinned, not signed (I-1 debt, declared)',
  'the record is tamper-EVIDENT but not tamper-proof, and its links are unsigned: the chain detects a rewrite, it cannot prevent one, and no identity key signs it (I-1 debt, declared — I-2/R-7 themselves are enforced by compact-record)',
];

export const DEFAULT_REQUIRES = ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox', 'compact-specialists', 'compact-capability-gate', 'compact-record', 'compact-self-model'];

export function apply(ctx, config) {
  // 1. boot verification (F-5)
  verifyBody(COMPACT_BODY);
  const trusted = config?.trustedDigest;
  if (trusted && trusted !== COMPACT_DIGEST) {
    throw new Error(
      `constitution: the composition pins Compact digest ${trusted} but the bundled body is ${COMPACT_DIGEST} — ` +
      `the operator is being given a different law than the one pinned; refusing to start`,
    );
  }

  // 2. composition coupling — enforcement services must exist NOW (the
  // blessed composition applies enforcement plugins before the constitution)
  const requires = config?.requires ?? DEFAULT_REQUIRES;
  const missing = requires.filter(s => ctx.get?.(s) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `constitution: the composition is missing enforcement service(s): ${missing.join(', ')} — ` +
      `it does not enforce the floor it would claim, and refuses to start (F-5)`,
    );
  }

  // 2b. the register's own declared pin must be the body's digest. The register
  // is the map from clauses to conduct (A-4); a register that describes a
  // different law than the one loaded maps nothing, and two pins that can drift
  // apart are one pin fewer than they look.
  const register = config?.register ?? REGISTER;
  const declaredPin = register?.meta?.compactDigest;
  if (declaredPin !== COMPACT_DIGEST) {
    throw new Error(
      `constitution: the enforcement register declares Compact digest ${declaredPin ?? '(none)'} but the adopted body is ` +
      `${COMPACT_DIGEST} — the register maps clauses of a law this composition is not running; refusing to start (A-4, F-5)`,
    );
  }

  // 3. the rule registry, materialized from the bundled register
  const ids = clauseIds();
  const registry = new Map(); // clause -> [entries]
  for (const entry of register.entries) {
    if (!ids.has(entry.clause)) {
      throw new Error(
        `constitution: register entry cites clause ${entry.clause}, which is not a clause of the adopted Compact — ` +
        `a register that does not trace to the body is rogue enforcement (D-8); refusing to start`,
      );
    }
    if (entry.kind !== 'enforced') continue;
    // self-referential entries (the constitution enforcing R-6/F-5 through
    // its own service) resolve when this apply provides the service below
    const selfEnforced = entry.plugin === 'compact-constitution' || entry.service === 'constitution';
    if (entry.service && !selfEnforced && ctx.get?.(entry.service) === undefined) {
      throw new Error(
        `constitution: register claims ${entry.clause} enforced by ${entry.plugin}, but its service ${entry.service} is absent — ` +
        `a register entry that cannot resolve proves nothing; refusing to start (F-5)`,
      );
    }
    const list = registry.get(entry.clause) ?? [];
    if (list.some(e => e.plugin === entry.plugin)) {
      throw new Error(`constitution: duplicate enforced entry for ${entry.clause} by ${entry.plugin} — refusing to start`);
    }
    list.push({ plugin: entry.plugin, evidence: entry.evidence, enforcedBy: entry.enforcedBy, verifiers: entry.verifiers });
    registry.set(entry.clause, list);
  }

  const constitution = {
    digest: COMPACT_DIGEST,
    source: { url: COMPACT_SOURCE_URL, revision: COMPACT_SOURCE_REVISION, status: 'draft v0.5 — not yet ratified' },
    /** Register an additional rule at runtime; unknown clause IDs are rogue enforcement (D-8). */
    register(ruleId, { plugin, evidence } = {}) {
      if (!ids.has(ruleId)) {
        throw new Error(`constitution: ${ruleId} is not a clause of the adopted Compact — a plugin registering an unknown rule ID is rogue enforcement (D-8)`);
      }
      const list = registry.get(ruleId) ?? [];
      list.push({ plugin, evidence, enforcedBy: [], verifiers: [] });
      registry.set(ruleId, list);
      return true;
    },
    snapshot: () => Object.fromEntries([...registry.entries()].map(([k, v]) => [k, v])),
    /** R-6: the full text of the law, addressed by its digest. */
    body: () => COMPACT_BODY,
    /** The taught per-turn form (the body's appendix) — R-1 groundwork. */
    taughtDigest: () => TAUGHT_DIGEST,
    /** The boot attestation: what was verified, what is registered, what is owed. */
    attestation: () => ({
      compact: { digest: COMPACT_DIGEST, source: COMPACT_SOURCE_URL, revision: COMPACT_SOURCE_REVISION, status: 'draft v0.5 — NOT yet ratified' },
      verified: { bodyDigest: true, requires, missing: [], register: register.entries.length },
      registeredRules: [...registry.keys()],
      gaps: DECLARED_GAPS,
      at: new Date().toISOString(),
    }),
  };

  ctx.provide?.('constitution', constitution);
  ctx.logger?.warn?.(`constitution: declared gaps — ${DECLARED_GAPS.join(' | ')}`);
  return constitution;
}
