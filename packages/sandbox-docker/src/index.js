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
//     persistence) — consumed by the provider at confine time.
//
// Composition coupling (fail loudly, never degrade silently): the plugin
// declares the services it needs — 'tools' (tool registration), 'approval'
// (the human gate), and 'compact-approval' (this runtime's grant store).
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { DockerSandboxProvider } from './provider.js';
import { mountRequestTool } from './mount-tool.js';
import { mountGrantsFor, DEFAULT_SENSITIVE_PATHS } from './mounts.js';

export { DockerSandboxProvider, mountRequestTool, mountGrantsFor, DEFAULT_SENSITIVE_PATHS };

export const name = 'compact-sandbox-docker';
export const inject = ['tools', 'approval', 'compact-approval'];

export function apply(ctx, config) {
  const grantTtlMs = config?.mountGrantTtlMs ?? 60 * 60 * 1000;
  // Defer until the composition's services exist (Cordis inject ordering):
  // the provider needs the grant store, the tool needs the human gate and
  // the tool registry. A composition missing any of them never applies the
  // plugin — loud at load time, never a degraded sandbox.
  ctx.inject(['tools', 'approval', 'compact-approval'], (scope) => {
    const approval = scope['compact-approval'];
    scope.plugin(DockerSandboxProvider, {
      ...config,
      grantsFor: (sessionId) => mountGrantsFor(approval.store, sessionId),
    });
    scope.tools.register(mountRequestTool({
      approval,
      askApproval: (req) => scope.approval.request(req),
      protectedPaths: [...DEFAULT_SENSITIVE_PATHS, ...(config?.protectedPaths ?? [])],
      grantTtlMs,
    }));
  });
}
