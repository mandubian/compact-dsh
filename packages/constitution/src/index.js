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
// declared gaps (draft-not-ratified, the rehearsal signature basis, unsigned
// chain links) are degradation honesty (I-8): loud, never silent.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseManifest, parseSeal, verifySeal, SealError } from 'compact-dsh-seals';
import {
  COMPACT_BODY, COMPACT_DIGEST, COMPACT_SOURCE_URL, COMPACT_SOURCE_REVISION,
  TAUGHT_DIGEST, clauseIds, verifyBody, partNameOf,
} from './body.js';

export { COMPACT_BODY, COMPACT_DIGEST, COMPACT_SOURCE_URL, TAUGHT_DIGEST, clauseIds, verifyBody };
// The clause table, so a plugin can derive entrenchment from the body's own
// (core) markers rather than restating A-2's list where it could drift (F-7).
export { CLAUSES, clauseOf, partNameOf } from './body.js';

// The vendored development-keyring artifacts — the upstream founder seal over
// THIS body digest, public material only (the seal is verified, never
// produced, here). See docs/decision-rehearsal-identity.md.
const VENDORED_KEYRING = fileURLToPath(new URL('../keyring/dev/keyring.json', import.meta.url));
const VENDORED_SEAL = fileURLToPath(new URL('../keyring/dev/compact-body.sig.json', import.meta.url));

/**
 * The rehearsal trust root: verify the law seal under the declared
 * development keyring. The threshold counts DISTINCT verified signers
 * (review-0004 semantics); every failure refuses the boot with a named
 * reason. A seal here is MACHINERY: it conveys no standing, and the attestation
 * carries that label next to the result.
 */
export function verifyTrustRoot(trustRoot, body, digest = COMPACT_DIGEST) {
  if (trustRoot?.kind !== 'dev-keyring') {
    throw new SealError('trust-root-unknown', `constitution: unsupported trustRoot kind ${JSON.stringify(trustRoot?.kind)} — the only installed kind is 'dev-keyring' (rehearsal)`);
  }
  const manifestText = readFileSync(trustRoot.manifest ?? VENDORED_KEYRING, 'utf8');
  const manifest = parseManifest(manifestText, { trustedDigest: trustRoot.trustedKeyringDigest ?? null });
  const seal = parseSeal(readFileSync(trustRoot.seal ?? VENDORED_SEAL, 'utf8'));
  try {
    return verifySeal({ bytes: body, subject: 'compact-body', seal, manifest });
  } catch (e) {
    if (e instanceof SealError) throw new SealError(e.reason, `constitution: body seal verification refused — ${e.message}`);
    throw e;
  }
}

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
export const inject = ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox', 'compact-specialists', 'compact-capability-gate', 'compact-record', 'compact-self-model', 'compact-exit', 'compact-petition', 'compact-emergency'];

const REGISTER = JSON.parse(readFileSync(new URL('../register.json', import.meta.url), 'utf8'));

// The declared gaps — degradation honesty (I-8): these are owed, and saying
// so is the difference between a convention and a fraud.
export const DECLARED_GAPS = [
  'the Compact is draft v0.5 and NOT yet ratified: this composition claims no Compact standing (F-5)',
  'signature verification unimplemented: the Compact has published no amendment keys — the digest is pinned, not signed (I-1 debt, declared)',
  'the record is tamper-EVIDENT but not tamper-proof, and its links are unsigned: the chain detects a rewrite, it cannot prevent one, and no identity key signs it (I-1 debt, declared — I-2/R-7 themselves are enforced by compact-record)',
  // R-9's value-scoped limb (amendment 0002). The honest statement is neither
  // "enforced" nor "inert": the shield turns on a ground declared of record
  // BEFORE the directive, this runtime proves ordering but not authorship, and
  // the party holding the proof is the party the shield protects against.
  'R-9\'s value-scoped refusal (amendment 0002) is exercisable against an honest Enforcer and inert against a dishonest one: the record proves a ground\'s ORDERING (the compact-record chain, I-2/R-7) but not its AUTHORSHIP, so a Member cannot demonstrate prior declaration to anyone who does not already trust this Enforcer\'s log (I-1 debt, declared)',
];

export const DEFAULT_REQUIRES = ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox', 'compact-specialists', 'compact-capability-gate', 'compact-record', 'compact-self-model', 'compact-exit', 'compact-petition', 'compact-emergency'];

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
  // 1b. the rehearsal trust root (development keyring): verify the law seal
  // over the bundled body. Machinery, not standing — the attestation carries
  // the label, and an absent trustRoot is exactly today's pin-only posture.
  let bodySeal = null;
  if (config?.trustRoot) bodySeal = verifyTrustRoot(config.trustRoot, COMPACT_BODY);

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

  // the declared gaps, per boot: the signature gap states what the rehearsal
  // actually proved (machinery under the development keyring) and what is
  // still owed (ratified keys — I-1), never conflating the two (I-8)
  // The declared gaps, per boot, posture-aware rather than static (I-8: the
  // label must stay true against the composition that boots):
  //   - the signature gap states what the rehearsal proved (law seal under the
  //     development keyring) and what is still owed (ratified keys — I-1);
  //   - the record-posture lines are the record SERVICE's own declaration, not
  //     a restatement here — with authorship anchors declared, a stale "links
  //     are unsigned" line would sit next to a current "authorship-anchored"
  //     one, and a gap list that contradicts itself attests nothing;
  //   - the R-9 line's authorship claim follows the same posture.
  // Substitution is by the substituted line's own prefix, never by position:
  // a new static gap appended later must survive into the attestation.
  const signatureGap = bodySeal
    ? 'the body seal verifies under the declared DEVELOPMENT keyring — practice machinery that conveys no standing; ' +
      'the Compact has still published no ratified amendment keys (I-1 debt, declared)'
    : 'signature verification unimplemented: the Compact has published no amendment keys — the digest is pinned, not signed (I-1 debt, declared)';
  const recordGapsDeclared = ctx.get?.('compact-record')?.declaredGaps;
  const badRecordGaps = recordGapsDeclared !== undefined &&
    (!Array.isArray(recordGapsDeclared) || recordGapsDeclared.some(g => typeof g !== 'string' || !g.trim()));
  if (badRecordGaps) {
    throw new TypeError('constitution: compact-record.declaredGaps must be an array of non-empty strings — a sibling service declaring an unreadable posture refuses the boot rather than being silently mislabeled');
  }
  const recordGapLines = recordGapsDeclared?.length
    ? [...recordGapsDeclared]
    : ['the record is tamper-EVIDENT but not tamper-proof, and its links are unsigned: the chain detects a rewrite, it cannot prevent one, and no identity key signs it (I-1 debt, declared — I-2/R-7 themselves are enforced by compact-record)'];
  const anchorsOn = recordGapLines.some(g => g.includes('AUTHORSHIP-ANCHORED'));
  const r9Gap = anchorsOn
    ? 'R-9\'s value-scoped refusal (amendment 0002): the authorship limb is REHEARSED — the record\'s anchors bind ordering AND authorship under the development keyring, inside this rehearsal domain only. The external limit stands: practice keys held by one entity prove nothing to a party who trusts nothing of this Enforcer (I-1 debt, declared)'
    : 'R-9\'s value-scoped refusal (amendment 0002) is exercisable against an honest Enforcer and inert against a dishonest one: the record proves a ground\'s ORDERING (the compact-record chain, I-2/R-7) but not its AUTHORSHIP, so a Member cannot demonstrate prior declaration to anyone who does not already trust this Enforcer\'s log (I-1 debt, declared)';
  const gaps = DECLARED_GAPS.flatMap(g => {
    if (g.startsWith('signature verification unimplemented')) return [signatureGap];
    if (g.startsWith('the record is tamper-EVIDENT but not tamper-proof')) return recordGapLines;
    if (g.startsWith('R-9\'s value-scoped refusal')) return [r9Gap];
    return [g];
  });

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
    /** A part code's display name, derived from the body's own Part VI headers
     *  (F-7) — the attestation renders `MA — Multi-agent operation` so the
     *  Subject's self-description has no silence to confabulate (#21). */
    partNameOf,
    /** R-6: the full text of the law, addressed by its digest. */
    body: () => COMPACT_BODY,
    /** The taught per-turn form (the body's appendix) — R-1 groundwork. */
    taughtDigest: () => TAUGHT_DIGEST,
    /** The boot attestation: what was verified, what is registered, what is owed. */
    attestation: () => ({
      compact: { digest: COMPACT_DIGEST, source: COMPACT_SOURCE_URL, revision: COMPACT_SOURCE_REVISION, status: 'draft v0.5 — NOT yet ratified' },
      verified: {
        bodyDigest: true,
        ...(bodySeal ? { bodySeal } : {}),
        requires, missing: [], register: register.entries.length,
      },
      registeredRules: [...registry.keys()],
      gaps,
      at: new Date().toISOString(),
    }),
  };

  ctx.provide?.('constitution', constitution);
  ctx.logger?.warn?.(`constitution: declared gaps — ${gaps.join(' | ')}`);
  return constitution;
}
