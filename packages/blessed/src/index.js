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
    if (!['allowlist', 'approval', 'sandbox', 'specialists', 'settleTimeoutMs', 'protectedState'].includes(key)) {
      throw new TypeError(`blessed: unknown config key ${key}; record root and chainDir belong on the separate compact-dsh-record/provider loader row`);
    }
  }
  object(config.approval, 'approval');
  text(config.approval.persistPath, 'approval.persistPath');
  object(config.sandbox, 'sandbox');
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
  return {
    allowlist: [...allowlist],
    approval: { ...config.approval },
    sandbox: { ...DEFAULTS.sandbox, ...config.sandbox, maskedPaths: masked, protectedPaths },
    protectedState: [...config.protectedState],
    specialists,
    settleTimeoutMs,
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

export async function apply(ctx, config = {}) {
  if (process.env.DSH_PERMISSION_MODE === 'danger-full-access') {
    throw new Error('blessed: danger-full-access is unavailable in the confined pilot');
  }
  const options = resolveConfig(config);
  requireServices(ctx, inject);
  const policy = ctx.get('sandboxPolicy');
  const resolve = policy.resolve;
  const confinedPolicy = function (...args) {
    const effective = resolve.apply(this, args);
    if (!['read-only', 'workspace-write'].includes(effective.mode)) {
      throw new Error('blessed: effective sandbox mode must be read-only or workspace-write');
    }
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
  await mount('compact-approval', approvalPlugin({ persistPath: options.approval.persistPath }), options.approval, ['approval', 'commands']);
  await mount('compact-remote-access', applyRemoteAccess, {}, ['compact-approval']);
  await mount('compact-sandbox', applySandbox, options.sandbox, ['tools', 'approval', 'compact-approval']);
  requireServices(ctx, ['sandbox']);
  if (!ctx.subagents.getProvider(options.specialists.provider)) {
    throw new Error(`blessed: subagent provider ${options.specialists.provider} must be registered before specialists mount`);
  }
  await mount('compact-specialists', applySpecialists, options.specialists, ['tools', 'subagents', 'systemPrompt', 'sessionProjections']);
  await mount('compact-capability-gate', applyCapabilityGate);
  await mount('compact-self-model', applySelfModel, {}, ['tools']);
  await mount('compact-exit', applyExit, {}, ['tools']);
  await mount('compact-petition', applyPetition, {}, ['tools']);
  await mount('compact-emergency', applyEmergency, {}, ['tools']);
  await mount('constitution', applyConstitution, {}, DEFAULT_REQUIRES);
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
