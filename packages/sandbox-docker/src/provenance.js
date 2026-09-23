// compact-dsh-sandbox-docker — CF-2 supply-chain honesty (Phase 6, re-scoped;
// see docs/decision-phase6-scope.md).
//
// CF-2: "Reused execution environments carry their acquisition history; what a
// confinement needed to build may demand no more at run time than was lawfully
// approved at build time, and any excess is a new gate, not an inheritance."
//
// A docker image IS a reused execution environment. This module binds the
// clause to it in three moves:
//
//   1. ACQUISITION HISTORY TRAVELS. Every image this provider will run must
//      have a declared provenance record. An undeclared image has no
//      acquisition history and cannot be reasoned about — it fails closed
//      (CF-1's discipline: unavailability blocks, never degrades silently).
//
//   2. IDENTITY IS CONTENT, NOT A NAME. A record is keyed by the image digest,
//      and the digest is re-resolved from the daemon at confine time. A tag
//      that silently re-points to different content is caught: acquisition
//      history attributed to a mutable name is precisely the dishonesty this
//      clause names. This is the ONLY place this composition needs content
//      addressing, and it needs no store to get it.
//
//   3. BUILD APPROVAL IS NEVER A RUNTIME ENTITLEMENT. `buildApprovals` is
//      recorded, surfaced, and auditable — and is never an input to any
//      runtime permit decision. A run-time demand is permitted only by a
//      live RUN-TIME grant, freshly gated through the Phase 1 layers. That is
//      the literal reading of "any excess is a new gate, not an inheritance",
//      and `checkSupplyChain` never consults `buildApprovals` to permit.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { spawnSync } from 'node:child_process';
import { buildEnvelope } from 'compact-envelope';

/** The gate name every CF-2 refusal carries. */
export const GATE = 'SC';

/** A digest as docker reports it: the algorithm-qualified content identity. */
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * How a record's acquisition history was established. The weaker basis is
 * declared, never silently equated with the stronger one (I-8):
 *  - 'build-recorded'    — this composition recorded the build and its gates.
 *  - 'operator-declared' — a human asserted the history; nothing verified it.
 */
export const ATTESTATION_BASES = ['build-recorded', 'operator-declared'];

/** A CF-2 refusal, carrying the Compact envelope that explains it (R-3/I-4). */
export class SupplyChainRefusal extends Error {
  constructor(envelope) {
    super(envelope.text);
    this.name = 'SupplyChainRefusal';
    this.envelope = envelope;
    this.ruleId = envelope.ruleId;
  }
}

function refuse({ ruleId, reason, lawfulNextMoves }) {
  return new SupplyChainRefusal(buildEnvelope({ gate: GATE, ruleId, reason, lawfulNextMoves }));
}

/**
 * Validate and index the composition's declared image provenance.
 *
 * Malformed records fail at BOOT, not at first confine: a composition that
 * cannot state its supply chain must not start claiming CF-2 (F-5).
 *
 * @param records - array of {ref, digest, attestation, buildApprovals?, recordedAt?, recordedBy?, note?}
 * @returns Map of image ref -> frozen record
 */
export function normalizeProvenanceRecords(records) {
  const byRef = new Map();
  for (const [i, r] of (records ?? []).entries()) {
    const at = `imageProvenance[${i}]`;
    if (!r || typeof r.ref !== 'string' || r.ref === '') {
      throw new Error(`sandbox-docker: ${at} has no image ref — a provenance record must name the image it describes (CF-2)`);
    }
    if (typeof r.digest !== 'string' || !DIGEST_RE.test(r.digest)) {
      throw new Error(
        `sandbox-docker: ${at} (${r.ref}) has digest ${JSON.stringify(r.digest)} — a provenance record must be keyed by a ` +
        `sha256 content digest, because acquisition history attributed to a mutable tag is not history (CF-2)`);
    }
    if (!ATTESTATION_BASES.includes(r.attestation)) {
      throw new Error(
        `sandbox-docker: ${at} (${r.ref}) declares attestation ${JSON.stringify(r.attestation)} — must be one of ` +
        `${ATTESTATION_BASES.join(', ')}; the basis of a trust claim is itself declared (I-8)`);
    }
    if (byRef.has(r.ref)) {
      throw new Error(`sandbox-docker: ${at} duplicates the provenance record for ${r.ref} — one image, one acquisition history (CF-2)`);
    }
    const approvals = r.buildApprovals ?? {};
    byRef.set(r.ref, Object.freeze({
      ref: r.ref,
      digest: r.digest,
      attestation: r.attestation,
      buildApprovals: Object.freeze({
        hosts: Object.freeze([...(approvals.hosts ?? [])]),
        paths: Object.freeze([...(approvals.paths ?? [])]),
      }),
      recordedAt: r.recordedAt ?? null,
      recordedBy: r.recordedBy ?? null,
      note: r.note ?? null,
    }));
  }
  return byRef;
}

/**
 * Resolve an image ref to the content digest the daemon holds for it.
 * `.Id` is the local config digest: always present for a pulled image, and it
 * is what this daemon will actually run — which is the fact CF-2 needs.
 */
export function defaultDigestResolver({ dockerCommand = 'docker', ref, timeoutMs = 5_000 } = {}) {
  try {
    const out = spawnSync(dockerCommand, ['image', 'inspect', '--format', '{{.Id}}', ref], { encoding: 'utf8', timeout: timeoutMs });
    if (out.error) return { ok: false, detail: `image inspect failed: ${out.error.message}` };
    if (out.status !== 0) return { ok: false, detail: `image inspect exited ${out.status}: ${String(out.stderr).split('\n')[0] ?? ''}` };
    const digest = String(out.stdout).trim();
    if (!DIGEST_RE.test(digest)) return { ok: false, detail: `image inspect returned ${JSON.stringify(digest)}, not a sha256 digest` };
    return { ok: true, digest };
  } catch (e) {
    return { ok: false, detail: `image inspect failed: ${e.message}` };
  }
}

/**
 * The CF-2 check, run at confine time.
 *
 * Note what is deliberately ABSENT: `record.buildApprovals` is never consulted
 * to permit anything. It is acquisition history — auditable, surfaced, and
 * inert as authority. A run-time demand is answered only by a run-time grant.
 *
 * @param ref - the configured image ref
 * @param record - its declared provenance, or undefined
 * @param resolved - {ok, digest} | {ok:false, detail} from the digest resolver
 * @param network - the provider's docker network posture ('none' confines it)
 * @param networkGrants - live RUN-TIME network grants for the calling session
 * @param mediated - the container is attached to the INTERNAL mediation
 *   network (#38): the posture supplies no route of its own, so the
 *   open-posture rule below has no excess to answer — grants are enforced per
 *   connection at the mediator instead (the CF-1 grant-gated exception)
 * @returns null when the supply chain holds, else a SupplyChainRefusal
 */
export function checkSupplyChain({ ref, record, resolved, network, networkGrants = [], mediated = false }) {
  if (!record) {
    return refuse({
      ruleId: 'CF-2/undeclared-image',
      reason: `the confinement would run image "${ref}", which carries no declared acquisition history — a reused execution ` +
        `environment with no provenance cannot be reasoned about, so it is refused rather than trusted`,
      lawfulNextMoves: [
        `declare the image in the composition's imageProvenance (ref, sha256 digest, attestation basis, build approvals)`,
        'run a build this composition records, so the acquisition history is build-recorded rather than asserted',
        'configure an image that is already declared',
      ],
    });
  }
  if (!resolved?.ok) {
    return refuse({
      ruleId: 'CF-2/unresolvable-digest',
      reason: `the content digest of image "${ref}" could not be resolved (${resolved?.detail ?? 'no detail'}) — the ` +
        `composition cannot confirm that what will run is what was declared, and fails closed`,
      lawfulNextMoves: [`pull or build "${ref}" so the daemon can report its digest`, 'check that the docker daemon is reachable', 'escalate to your Principal'],
    });
  }
  if (resolved.digest !== record.digest) {
    return refuse({
      ruleId: 'CF-2/digest-drift',
      reason: `image "${ref}" resolves to ${resolved.digest} but its provenance record declares ${record.digest} — the tag now ` +
        `names different content than the acquisition history describes, so the history does not apply to what would run`,
      lawfulNextMoves: [
        'update the provenance record to the new digest, with the acquisition history of THAT build',
        'pin the composition to the declared digest instead of the tag',
        'escalate to your Principal',
      ],
    });
  }
  // Build approval is not a runtime entitlement. An open network posture is a
  // run-time demand; it is answered by live run-time grants or not at all.
  // The MEDIATED posture is not an open demand: the network is internal (no
  // route exists — asserted when it was provisioned), and the grant that
  // matters is enforced at the mediator per connection, where this check has
  // no view and needs none (#38).
  if (!mediated && network !== 'none' && networkGrants.length === 0) {
    return refuse({
      ruleId: 'CF-2/uninherited-network',
      reason: `the confinement would run with docker network "${network}" while the calling session holds no live network grant — ` +
        `image "${ref}" was built with approval for ${record.buildApprovals.hosts.length > 0 ? record.buildApprovals.hosts.join(', ') : 'no declared hosts'}, ` +
        `but a build-time approval is never inherited as run-time reach: excess is a new gate`,
      lawfulNextMoves: [
        'obtain a run-time network grant for the specific host through the approval gate',
        "leave the provider's network posture at 'none' so the confinement supplies no reach",
        'escalate to your Principal',
      ],
    });
  }
  return null;
}

/**
 * Live RUN-TIME network grants for one session — the host-shaped session
 * grants of the Phase 1 store (never expired, never revoked, never spent).
 * Scope logic mirrors `mountGrantsFor`, because a grant's reach is one rule.
 *
 * This is the ONLY source CF-2 accepts for a run-time network demand. The
 * separation is the clause: build approvals describe the past, grants
 * authorize the present.
 */
export const NETWORK_PATTERN_KINDS = ['ExactHost', 'HostSuffix', 'HostAndPort', 'UrlPrefix'];

export function networkGrantsFor(store, sessionId, now = Date.now()) {
  const sid = sessionId != null ? String(sessionId) : null;
  return (store?.sessionGrants ?? [])
    .filter(g => NETWORK_PATTERN_KINDS.includes(g.pattern?.kind))
    .filter(g => !g.revokedAt && (!g.expiresAt || g.expiresAt > now))
    .filter(g => g.maxUses == null || g.uses < g.maxUses)
    .filter(g =>
      (g.session != null) ? g.session === sid
      : (g.root != null) ? (sid === g.root || (sid ?? '').startsWith(g.root + '/'))
      : true);
}

/**
 * The composition's declared CF-2 gaps, for the boot record (I-8). An
 * 'operator-declared' history is a human assertion that nothing verified;
 * saying so is the difference between a convention and a fraud.
 */
export function declaredGapsFor(record, ref) {
  if (!record) return [`image "${ref}" has no declared acquisition history — every confinement using it is refused (CF-2)`];
  if (record.attestation === 'operator-declared') {
    return [`image "${ref}" (${record.digest}) carries an OPERATOR-DECLARED acquisition history: a human asserted it and ` +
      `nothing in this composition verified it — the digest is bound, the history is not attested (CF-2/I-8 debt, declared)`];
  }
  return [];
}
