import { apply as applyAllowlist } from 'compact-dsh-allowlist-gate';
import { approvalPlugin, redactEmbeddedSecrets } from 'compact-dsh-approval';
import { apply as applyCapabilityGate } from 'compact-dsh-capability-gate';
import { apply as applyConstitution, DEFAULT_REQUIRES } from 'compact-dsh-constitution';
import { apply as applyEmergency } from 'compact-dsh-emergency';
import { apply as applyExit } from 'compact-dsh-exit';
import { apply as applyLoopguard } from 'compact-dsh-loopguard';
import { apply as applyPetition } from 'compact-dsh-petition';
import { promotionPlugin } from 'compact-dsh-promotion';
import { apply as applyRemoteAccess } from 'compact-dsh-remote-access';
import { apply as applySandbox, normalizeProvenanceRecords } from 'compact-dsh-sandbox-docker';
import { apply as applySelfModel } from 'compact-dsh-self-model';
import { apply as applySpecialists } from 'compact-dsh-specialists';
import { canonicalizeBestEffort } from 'compact-dsh-sandbox-docker';
import { buildEnvelope } from 'compact-envelope';

export const name = 'compact-blessed';
export const inject = ['tools', 'approval', 'commands', 'systemPrompt', 'sessionProjections', 'subagents', 'sessionPersistence', 'compact-record', 'sandboxPolicy'];
export const DEFAULTS = Object.freeze({
  allowlist: Object.freeze([]),
  sandbox: Object.freeze({ network: 'none' }),
  specialists: Object.freeze({ provider: 'spawn', backgroundMode: 'one-shot', leadMaxDepth: 3 }),
  settleTimeoutMs: 10_000,
});

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`blessed: ${path} must be a JSON object`);
  }
}

function text(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`blessed: ${path} must be an explicit non-empty string`);
  }
}

export function resolveConfig(config) {
  object(config, 'config');
  for (const key of Object.keys(config)) {
    if (!['allowlist', 'approval', 'sandbox', 'specialists', 'settleTimeoutMs', 'protectedState', 'secrets', 'trustRoot', 'enforcer'].includes(key)) {
      throw new TypeError(`blessed: unknown config key ${key}; record root and chain dir belong on the separate compact-dsh-record/provider loader row`);
    }
  }
  object(config.approval, 'approval');
  text(config.approval.persistPath, 'approval.persistPath');
  object(config.sandbox, 'sandbox');
  // the egress posture is the SANDBOX's declaration, never an approval knob:
  // an approval-config posture could contradict the wire the sandbox actually
  // runs and make the envelope dishonest (#38)
  if (config.approval.egress !== undefined) {
    throw new TypeError('blessed: approval.egress is not a composition knob — the egress posture is the sandbox declaration ' +
      '(sandbox.network) and the ask reads it from there; two sources of posture are two truths and only one of them is the wire');
  }
  // an EXPLICITLY undefined network spreads over the default and would
  // otherwise read as undeclared at ask time while docker runs its
  // `?? 'none'` default — normalize at the config boundary, loudly
  if (config.sandbox.network !== undefined && (typeof config.sandbox.network !== 'string' || !config.sandbox.network.trim())) {
    throw new TypeError('blessed: sandbox.network must be a non-empty docker network name when present');
  }
  text(config.sandbox.image, 'sandbox.image');
  if (!Array.isArray(config.sandbox.imageProvenance) || !normalizeProvenanceRecords(config.sandbox.imageProvenance).has(config.sandbox.image)) {
    throw new TypeError('blessed: sandbox.imageProvenance must declare the configured image');
  }
  const allowlist = config.allowlist ?? DEFAULTS.allowlist;
  if (!Array.isArray(allowlist)) throw new TypeError('blessed: allowlist must be an array');
  for (const rule of allowlist) text(rule, 'allowlist entry');
  if (!Array.isArray(config.protectedState) || config.protectedState.length === 0) {
    throw new TypeError('blessed: protectedState must name the Enforcer state paths (record root, chain dir, approval store) — a composition whose Subject can reach the Enforcer\'s evidence lets it rewrite its own record; refusing to start rather than compose that silently (F-5, D-8)');
  }
  for (const p of config.protectedState) text(p, 'protectedState entry');
  // a mistyped mask list (a string, a nested object) must fail loudly, never
  // spread into character junk that silently canonicalizes to nothing
  for (const key of ['maskedPaths', 'protectedPaths']) {
    const v = config.sandbox[key];
    if (v !== undefined && (!Array.isArray(v) || v.some(p => typeof p !== 'string' || !p.trim()))) {
      throw new TypeError(`blessed: sandbox.${key} must be an array of non-empty path strings`);
    }
  }
  const masked = [...(config.sandbox.maskedPaths ?? []), ...config.protectedState].map(canonicalizeBestEffort);
  const protectedPaths = [...(config.sandbox.protectedPaths ?? []), ...config.protectedState].map(canonicalizeBestEffort);
  if (config.specialists !== undefined) object(config.specialists, 'specialists');
  // declared secret references: env NAMES the confined Subject may be
  // granted, never values (the values stay in the operator's environment).
  // Absent/empty is the lawful absent-capability posture: nothing is
  // injectable, enforced by the same lookup that would inject.
  let secrets = [];
  if (config.secrets !== undefined) {
    if (!Array.isArray(config.secrets)) throw new TypeError('blessed: secrets must be an array of env-var names');
    for (const s of config.secrets) {
      if (typeof s !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(s)) {
        throw new TypeError(`blessed: secrets entries must be env-var NAMES like GH_TOKEN, got ${JSON.stringify(s)}`);
      }
    }
    secrets = [...new Set(config.secrets)];
  }
  const specialists = { ...DEFAULTS.specialists, ...config.specialists };
  text(specialists.provider, 'specialists.provider');
  if (!['one-shot', 'continuable'].includes(specialists.backgroundMode)) {
    throw new TypeError('blessed: specialists.backgroundMode must be one-shot or continuable');
  }
  if (!Number.isSafeInteger(specialists.leadMaxDepth) || specialists.leadMaxDepth < 0) {
    throw new TypeError('blessed: specialists.leadMaxDepth must be a non-negative safe integer');
  }
  const settleTimeoutMs = config.settleTimeoutMs ?? DEFAULTS.settleTimeoutMs;
  if (!Number.isSafeInteger(settleTimeoutMs) || settleTimeoutMs < 1 || settleTimeoutMs > 120_000) {
    throw new TypeError('blessed: settleTimeoutMs must be an integer between 1 and 120000');
  }
  // the rehearsal trust root (development keyring): optional, shape-checked
  // here so a mistyped keyring config fails loudly at composition, not as a
  // confusing boot refusal from the constitution's reader
  let trustRoot;
  if (config.trustRoot !== undefined) {
    object(config.trustRoot, 'trustRoot');
    if (config.trustRoot.kind !== 'dev-keyring') {
      throw new TypeError(`blessed: trustRoot.kind must be 'dev-keyring' (rehearsal), got ${JSON.stringify(config.trustRoot.kind)}`);
    }
    for (const key of ['manifest', 'seal', 'trustedKeyringDigest']) {
      const v = config.trustRoot[key];
      if (v !== undefined && (typeof v !== 'string' || !v.trim())) {
        throw new TypeError(`blessed: trustRoot.${key} must be a non-empty string when present`);
      }
    }
    trustRoot = { kind: 'dev-keyring' };
    for (const key of ['manifest', 'seal', 'trustedKeyringDigest']) {
      if (config.trustRoot[key] !== undefined) trustRoot[key] = config.trustRoot[key];
    }
  }
  // the rehearsal enforcer annex (optional): when declared, the runtime's
  // signing identity — attestations, record anchors, subject certificates —
  // exists and has been verified against the pinned law; a broken declaration
  // refuses here, at composition. The overlay always passes the object shape;
  // both paths undefined means not declared.
  let enforcer;
  if (config.enforcer !== undefined) {
    object(config.enforcer, 'enforcer');
    if (config.enforcer.annexPath !== undefined || config.enforcer.privateKeyPath !== undefined) {
      for (const key of ['annexPath', 'privateKeyPath']) {
        const v = config.enforcer[key];
        if (typeof v !== 'string' || !v.trim()) throw new TypeError(`blessed: enforcer.${key} must be a non-empty string when the annex is declared`);
      }
      enforcer = { annexPath: config.enforcer.annexPath, privateKeyPath: config.enforcer.privateKeyPath };
    }
  }
  return {
    allowlist: [...allowlist],
    approval: { ...config.approval, secretRefs: secrets },
    sandbox: { ...DEFAULTS.sandbox, ...config.sandbox, network: config.sandbox.network ?? DEFAULTS.sandbox.network, maskedPaths: masked, protectedPaths },
    protectedState: [...config.protectedState],
    secrets,
    specialists,
    settleTimeoutMs,
    ...(trustRoot ? { trustRoot } : {}),
    ...(enforcer ? { enforcer } : {}),
  };
}

function requireServices(ctx, services) {
  const missing = services.filter(service => ctx.get(service) == null);
  if (missing.length) throw new Error(`blessed: missing active services: ${missing.join(', ')}`);
}

function descendants(ctx, owner) {
  const result = [];
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) {
      if (fiber.uid === null) continue;
      let current = fiber;
      while (current.uid !== owner.uid && current.uid !== current.parent.fiber.uid) current = current.parent.fiber;
      if (current.uid === owner.uid) result.push(fiber);
    }
  }
  return result;
}

async function settle(ctx, owner) {
  const settled = new Set();
  while (true) {
    const pending = descendants(ctx, owner).filter(fiber => !settled.has(fiber));
    if (!pending.length) return;
    for (const fiber of pending) {
      await fiber.await();
      requireServices(fiber.ctx, Object.keys(fiber.inject));
      if (!fiber.store) throw new Error(`blessed: ${fiber.name} did not activate`);
      settled.add(fiber);
    }
  }
}

async function bounded(operation, timeoutMs, label) {
  let timer;
  try {
    await Promise.race([
      operation,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`blessed: ${label} did not settle within ${timeoutMs}ms; refusing readiness`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The workspace anchor (#18). A session REOPENED under this boot may carry a
 * `header.cwd` recorded by an earlier boot — and the dsh layer resolves BOTH
 * the UI file root AND the sandbox's write boundary from that header, so a
 * stale session would execute (and write) inside a directory this boot never
 * declared. The composition refuses such calls with a named envelope instead
 * of running inside a name that no longer matches reality (D-7: refuse, never
 * guess). Null = no anchor conflict; a session without a cwd uses the boot
 * root by the dsh fallback.
 */
export function workspaceAnchorDecision(sessionCwd, bootRoot) {
  if (sessionCwd == null) return null;
  if (canonicalizeBestEffort(sessionCwd) === canonicalizeBestEffort(bootRoot)) return null;
  const env = buildEnvelope({
    gate: 'CF',
    ruleId: 'CF-1/workspace-anchor',
    reason: `this session was recorded under the workspace "${sessionCwd}", which this runtime does not expose — ` +
      `it exposes only "${bootRoot}". Running would confine execution to a boundary the session's own name ` +
      `contradicts, so the call is refused (D-7)`,
    lawfulNextMoves: [
      'start a fresh session in the exposed workspace',
      'have your Principal relaunch the pilot with --workspace naming this session\'s recorded workspace',
      'escalate to your Principal',
    ],
  });
  return { kind: 'deny', reason: env.text };
}

/**
 * The resolver-seam half of the workspace anchor (#18): the sandbox policy's
 * resolved boundary must never leave the boot's declaration. The dsh policy
 * resolves the per-session root from `header.cwd`, so a stale session header
 * would move the write boundary to a directory this boot never declared —
 * the resolver fails loudly at the seam rather than handing that root to the
 * provider. Canonical comparison, so trailing separators and `.` are the
 * same directory.
 */
export function assertBootAnchor(resolvedRoot, declaredRoot) {
  if (resolvedRoot == null) return;
  if (canonicalizeBestEffort(resolvedRoot) === canonicalizeBestEffort(declaredRoot)) return;
  throw new Error(`blessed: refusing to confine to ${resolvedRoot} — this boot's declared workspace is ${declaredRoot}, ` +
    `and a session header naming another directory may not move the boundary (#18)`);
}

export async function apply(ctx, config = {}) {
  if (process.env.DSH_PERMISSION_MODE === 'danger-full-access') {
    throw new Error('blessed: danger-full-access is unavailable in the confined pilot');
  }
  const options = resolveConfig(config);
  requireServices(ctx, inject);
  const policy = ctx.get('sandboxPolicy');
  const resolve = policy.resolve;
  const declaredRoot = canonicalizeBestEffort(policy.workspaceRoot);
  const confinedPolicy = function (...args) {
    const effective = resolve.apply(this, args);
    if (!['read-only', 'workspace-write'].includes(effective.mode)) {
      throw new Error('blessed: effective sandbox mode must be read-only or workspace-write');
    }
    // a stale session header re-anchors the resolved boundary to a directory
    // this boot never declared — fail at the resolver seam rather than bind it
    assertBootAnchor(effective.workspaceRoot, policy.workspaceRoot);
    return effective;
  };
  confinedPolicy.call(policy);
  if (ctx.approval.config.policy !== 'ask') {
    throw new Error('blessed: approval policy must be ask');
  }
  ctx.effect(() => {
    policy.resolve = confinedPolicy;
    return () => { policy.resolve = resolve; };
  });
  // CF-1/workspace-anchor (#18): refuse calls from sessions naming another
  // workspace BEFORE any other gate runs. First divergence is named on the
  // operator's log, loudly (I-8) — the UI file tree of such a session is the
  // documented residual (operator-local, read-only window until reopened).
  let anchorWarned = null;
  ctx.on?.('tools/pre-execute', async (exec, next) => {
    const cwd = exec?.agent?.session?.header?.cwd;
    const decision = workspaceAnchorDecision(cwd, declaredRoot);
    if (!decision) return next();
    if (anchorWarned !== cwd) {
      anchorWarned = String(cwd);
      ctx.logger?.error?.(`blessed: a session names workspace ${anchorWarned}, which this boot does not expose (exposed: ${policy.workspaceRoot}) — its tool calls are refused until it is reopened under the exposed workspace`);
    }
    return decision;
  });
  if (ctx.get('compact-record').chained !== ctx.get('sessionPersistence')) {
    throw new Error('blessed: compact-dsh-record/provider must supply the public sessionPersistence service');
  }
  const mount = async (service, callback, config = {}, dependencies = []) => {
    requireServices(ctx, dependencies);
    const fiber = ctx.plugin({
      name: service,
      inject: dependencies,
      async apply(scope) {
        await callback(scope, config);
      },
    });
    await bounded(settle(ctx, fiber), options.settleTimeoutMs, service);
    requireServices(ctx, [service]);
  };

  await mount('compact-loopguard', applyLoopguard);
  await mount('compact-promotion', promotionPlugin(), {}, ['tools']);
  await mount('compact-allowlist-gate', applyAllowlist, { allowlist: options.allowlist }, ['tools']);
  // #38 phase 1: the approval ask must speak the composition's egress posture
  // honestly — consent at the gate is not connectivity on the wire. Blessed
  // KNOWS the posture (its sandbox declaration — resolveConfig normalized
  // network to a non-empty name, 'none' by default), so it wires it through:
  // 'none' is the no-egress posture; any other docker network name grants
  // egress and reads as 'open'. The derived value rides the mount config too
  // (the apply path is authoritative), so no approval-level config can make
  // the envelope claim a posture the sandbox does not run.
  await mount('compact-approval', approvalPlugin({
    persistPath: options.approval.persistPath,
    secretRefs: options.secrets,
    egress: options.sandbox.network === 'none' ? 'none' : 'open',
  }), { ...options.approval, egress: options.sandbox.network === 'none' ? 'none' : 'open' }, ['approval', 'commands']);
  await mount('compact-remote-access', applyRemoteAccess, {}, ['compact-approval']);
  await mount('compact-sandbox', applySandbox, options.sandbox, ['tools', 'approval', 'compact-approval']);
  requireServices(ctx, ['sandbox']);
  // D-8 declaration: the secret-injection posture is on the record at boot —
  // BOUND (refs declared, injection only ever under a live SecretGrant) or
  // ABSENT (no refs declared, nothing injectable, enforced by the same
  // lookup that would inject). Values are never named here — only refs.
  if (options.secrets.length > 0) {
    ctx.logger?.warn?.(`blessed: secret injection is DECLARED and grant-bound for refs: ${options.secrets.join(', ')} — ` +
      `injection happens only under a live operator-approved SecretGrant, at confine time, into the container only`);
  } else {
    ctx.logger?.warn?.('blessed: secret injection is ABSENT — no refs declared, nothing is injectable');
  }
  if (!ctx.subagents.getProvider(options.specialists.provider)) {
    throw new Error(`blessed: subagent provider ${options.specialists.provider} must be registered before specialists mount`);
  }
  await mount('compact-specialists', applySpecialists, options.specialists, ['tools', 'subagents', 'systemPrompt', 'sessionProjections']);
  await mount('compact-capability-gate', applyCapabilityGate);
  await mount('compact-self-model', applySelfModel, { enforcer: options.enforcer }, ['tools']);
  await mount('compact-exit', applyExit, {}, ['tools']);
  await mount('compact-petition', applyPetition, {}, ['tools']);
  await mount('compact-emergency', applyEmergency, {}, ['tools']);
  await mount('constitution', applyConstitution, { trustRoot: options.trustRoot }, DEFAULT_REQUIRES);
  const gate = ctx.get('compact-capability-gate');
  if (gate.breach() || gate.unregisteredClauses()) {
    throw new Error('blessed: capability enforcement is incomplete; refusing readiness');
  }

  // Credential-shape detection (I-8 posture, warn-only): prevention is the
  // first layer — no env in containers, envelopes that name no arguments,
  // state paths masked — but nothing is infallible, and the completeness
  // invariant forbids scrubbing the record after a leak. So the boundary
  // DETECTS and warns, loudly and never altering: a tool call or result
  // carrying a credential shape is named on the operator's log, the rotated
  // credential is the operator's act, and the record stays exactly what the
  // Subject saw.
  ctx.on?.('tools/post-execute', async (exec, result, next) => {
    if (credentialShapeIn(exec?.arguments) || credentialShapeIn(result?.value ?? result)) {
      ctx.logger?.warn?.(
        `[compact-dsh] credential-shaped content detected around "${exec?.name ?? 'unknown-tool'}" ` +
        `(tool call ${exec?.callId ?? 'n/a'}) — the record is complete by design and cannot be scrubbed: ` +
        `rotate the credential; the detector withholds nothing and alters nothing`);
    }
    return next();
  });

  ctx.provide('compact-ready', Object.freeze({ name, ready: true, digest: ctx.get('constitution').digest }));
}

/**
 * Does this tool-call argument object or result value carry a credential
 * shape? The redaction catalogue run in DETECT mode: redact-and-compare, so
 * detection and masking can never disagree about what a secret is.
 */
export function credentialShapeIn(value) {
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value ?? {}); } catch { return false; }
  if (!text) return false;
  // detection is more sensitive than masking: a lone PEM BEGIN marker (a
  // truncated key) is a finding, though masking requires the full block
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  return redactEmbeddedSecrets(text) !== text;
}

export default { name, inject, apply };
