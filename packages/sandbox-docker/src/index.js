// compact-dsh-sandbox-docker — Phase 2 plugin (port plan Phase 2, slice 1).
//
// Composes:
//   - the docker SandboxProvider (src/provider.js) as ctx.sandbox — per-call
//     confinement with honest enforcement reporting and fail-closed
//     unavailability;
//   - the mount-grant request tool (src/mount-tool.js) — the lawful channel
//     from a sandbox denial to a scoped, recorded mount grant;
//   - the Phase 1 approval store as the mount-grant substrate (PathPrefix
//     session grants: canonical prefix, ro ceiling, TTL, revocation,
//     persistence) — consumed by the provider at confine time;
//   - the CF-2 supply chain (src/provenance.js, Phase 6): the configured image
//     must carry a declared, digest-keyed acquisition history or the plugin
//     REFUSES TO START — an Enforcer that confines execution binds CF-2, and a
//     composition that cannot state its supply chain does not claim the clause
//     (D-8, F-5). Run-time demands are answered by run-time grants only.
//
// Composition coupling (fail loudly, never degrade silently): the plugin
// declares the services it needs — 'tools' (tool registration), 'approval'
// (the human gate), and 'compact-approval' (this runtime's grant store).
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { DockerSandboxProvider } from './provider.js';
import { mountRequestTool } from './mount-tool.js';
import { mountGrantsFor, DEFAULT_SENSITIVE_PATHS, canonicalizeBestEffort } from './mounts.js';
import {
  normalizeProvenanceRecords, networkGrantsFor, declaredGapsFor,
  checkSupplyChain, defaultDigestResolver, SupplyChainRefusal,
} from './provenance.js';

export { DockerSandboxProvider, mountRequestTool, mountGrantsFor, DEFAULT_SENSITIVE_PATHS, canonicalizeBestEffort };
export {
  normalizeProvenanceRecords, networkGrantsFor, declaredGapsFor,
  checkSupplyChain, defaultDigestResolver, SupplyChainRefusal,
};

export const name = 'compact-sandbox-docker';
export const inject = ['tools', 'approval', 'compact-approval'];

export function apply(ctx, config) {
  const grantTtlMs = config?.mountGrantTtlMs ?? 60 * 60 * 1000;
  // CF-2 at BOOT: malformed records throw, and an image with no declared
  // acquisition history refuses the composition rather than waiting to refuse
  // every confine. The digest binding itself is re-checked per confine, where
  // the daemon can be asked what the tag resolves to today.
  const image = config?.image ?? 'ubuntu:24.04';
  const provenance = normalizeProvenanceRecords(config?.imageProvenance);
  const record = provenance.get(image);
  if (!record) {
    throw new Error(
      `sandbox-docker: the composition would confine execution in image "${image}", which carries no declared acquisition ` +
      `history — CF-2 wakes with the confinement capability, and an Enforcer that declares a capability without binding its ` +
      `clauses commits enforcement fraud (D-8). Declare the image in imageProvenance (ref, sha256 digest, attestation basis, ` +
      `build approvals); refusing to start (F-5)`,
    );
  }
  const declaredGaps = declaredGapsFor(record, image);
  for (const gap of declaredGaps) ctx.logger?.warn?.(`sandbox-docker: ${gap}`);
  // Defer until the composition's services exist (Cordis inject ordering):
  // the provider needs the grant store, the tool needs the human gate and
  // the tool registry. A composition missing any of them never applies the
  // plugin — loud at load time, never a degraded sandbox.
  ctx.inject(['tools', 'approval', 'compact-approval'], (scope) => {
    const approval = scope['compact-approval'];
    scope.plugin(DockerSandboxProvider, {
      ...config,
      grantsFor: (sessionId) => mountGrantsFor(approval.store, sessionId),
      // CF-2: the run-time side of "excess is a new gate, not an inheritance"
      networkGrantsFor: (sessionId) => networkGrantsFor(approval.store, sessionId),
      // secret injection: the grant store owns the agreement (a SecretGrant
      // is operator-approved, session-scoped, TTL'd, revocable); the provider
      // only resolves the env NAME it names. No grants → nothing injectable,
      // which is the capability-absent posture enforced mechanically.
      secretsFor: (sessionId) =>
        approval.store.secretGrantsFor(sessionId).map(g => ({ ref: g.ref })),
    });
    scope.tools.register(mountRequestTool({
      approval,
      askApproval: (req) => scope.approval.request(req),
      protectedPaths: [...DEFAULT_SENSITIVE_PATHS, ...(config?.protectedPaths ?? [])],
      grantTtlMs,
    }));
    // composition coupling (Phase 4): the constitution checks this service's
    // presence — a composition without the sandbox refuses to start
    scope.provide?.('compact-sandbox', {
      name: 'compact-sandbox-docker',
      image,
      // CF-2: the acquisition history travels with the service, so the boot
      // record and the offline auditor can both read what is being trusted
      // and on what basis.
      provenance: record,
      declaredGaps,
    });
  });
}
