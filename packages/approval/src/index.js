// compact-dsh-approval — Phase 1 plugin (port plan Phase 1, slices 1–2).
//
// The layered evaluation rides the verified tools/pre-execute waterfall:
//   allowed (any grant layer) → next()
//   pending-approval / dedup  → { kind:'ask', reason } — the human gate
//   refused-flood             → { kind:'deny', reason: 'I-5/flood-cap' }
// The flood cap is enforced here, before any approval dispatch. An ask that
// reaches the host's `approval/request` waterfall is wrapped by OUR answerer:
// it delegates the decision downstream (operator/UI answerers, per-service
// fail-closed 'unavailable'), then materializes the grant on approval —
// `allowed-once` becomes an exec-cache entry, so the identical operation
// replays without re-asking (the deny→ask→approve→replay-hit cycle) — and
// releases the pending record + flood slot either way. The host service owns
// the `approval/asked`/`approval/decided` audit pair; we never append it.
//
// Verified against the installed @deepseek-ai/dsh-user-approval types:
// outcome vocabulary is exactly 'allowed-once' | 'rejected' | 'cancelled' |
// 'unavailable' (no allowed-always — dsh has no native grant store; ours IS
// the grant store); the request carries agent + toolName + callId + reason
// but NO tool arguments, so the ask↔decision correlation is plugin-side,
// keyed by agent identity + tool name, recorded at ask time.
//
// Revocation rides the commands seam (`grants-list` / `grants-grant` /
// `grants-revoke` — the plan's dotted `grants.*` names are not legal in the
// host's command grammar, /^[a-z][a-z0-9_-]*$/; hyphens are the faithful
// adaptation); the CommandRuntime's own
// `command/run` + `command/done` log pair is the causal note into the
// durable session log. Revoking a grant kills the exec-cache entries its
// pattern covered — approval never outlives its grant.
//
// Content-blind: the evaluator sees targets, never messages (R-9).
// Denials and asks are Compact envelopes (R-3/I-4).
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { GrantStore, patternMatches } from './grants.js';
import { PersistentGrantStore } from './persist.js';
import { evaluate, DEFAULTS } from './evaluate.js';
import { fingerprint, canonicalTarget } from './fingerprint.js';
import { parseAllowlistLikePattern } from './pattern.js';
import { buildEnvelope } from 'compact-envelope';

export { GrantStore, PersistentGrantStore, evaluate, fingerprint, canonicalTarget, parseAllowlistLikePattern, DEFAULTS };

export const name = 'compact-approval';
export const inject = ['approval'];

// LoopGuard cooperation (port plan Phase 1 item 7; consumer lands in Phase 3):
// every refusal this gate constructs — ask (uncovered), ask (dedup-pending),
// deny (flood) — is emitted on the Cordis event bus. The future guard plugin
// folds these into trip 12 (irrecoverable gate flailing) of
// docs/concept-loopguard-trips.md. Decision OUTCOMES are not re-emitted:
// the host ApprovalService already appends approval/asked + approval/decided
// to the durable log, and the guard reads decisions from recorded state (D-7).
export const REFUSAL_EVENT = 'compact-approval/refusal';

function refusalPayload({ kind, verdict, ruleId, tool, fingerprint, root, session }) {
  return { kind, verdict, ruleId, tool, fingerprint, root, session, at: Date.now() };
}

/** Identity of the acting agent on the verified dsh contract:
 *  `Agent.session` is a live Session; fork lineage sits in `header.parentSession`.
 *  Root scope = direct parent when forked, else the session itself — one
 *  lineage step only (deeper chains under-grant: fail-closed, never over). */
export function identityOf(agent) {
  const sid = agent?.session?.id ?? agent?.id;
  const session = sid != null ? String(sid) : 'root';
  const parent = agent?.session?.header?.parentSession;
  const root = parent != null ? String(parent) : session;
  return { root, session };
}

export function createApproval(opts = {}) {
  const approval = {
    // persistPath: the grant store survives restarts (grants, budgets,
    // revocations, cache entries); pending bookkeeping never does. Corrupt
    // store files fail the boot loudly — never a silent reset.
    store: opts.persistPath ? new PersistentGrantStore(opts.persistPath) : new GrantStore(),
    execCacheTtlMs: opts.execCacheTtlMs ?? DEFAULTS.execCacheTtlMs,
    maxPendingPerRoot: opts.maxPendingPerRoot ?? DEFAULTS.maxPendingPerRoot,
    pendingTtlMs: opts.pendingTtlMs ?? DEFAULTS.pendingTtlMs,
    // ask↔decision correlation: agent object → toolName → {fp, root, session, args}
    // WeakMap: the ask record lives exactly as long as the asking agent does.
    asks: new WeakMap(),
    fingerprint: (tool, args) => fingerprint(tool, args),
    grantSession: ({ pattern, root, session, ttlMs = 60 * 60 * 1000, maxUses = null, now = Date.now() }) =>
      approval.store.addSessionGrant({ pattern: parseAllowlistLikePattern(pattern), root, session, ttlMs, maxUses, now }),
    grantPlan: ({ pattern, planRef, ttlMs, maxUses = null, now = Date.now() }) =>
      approval.store.addPlanGrant({ pattern: parseAllowlistLikePattern(pattern), planRef, ttlMs, maxUses, now }),
    revoke: (id, now = Date.now()) => approval.store.revokeSessionGrant(id, now),
    evaluate: (call) => evaluate(approval.store, {
      execCacheTtlMs: approval.execCacheTtlMs,
      maxPendingPerRoot: approval.maxPendingPerRoot,
      pendingTtlMs: approval.pendingTtlMs,
      ...call,
    }),
    // -- answerer-side materialization (slice 2) ----------------------------
    /** Record that this agent's ask for this tool is ours, for decision correlation. */
    recordAsk: (agent, tool, rec) => {
      let m = approval.asks.get(agent);
      if (!m) { m = new Map(); approval.asks.set(agent, m); }
      m.set(tool, rec);
    },
    /** Claim the pending ask record (removes it; null when the ask is not ours). */
    takeAsk: (agent, tool) => {
      const rec = approval.asks.get(agent)?.get(tool);
      if (rec) approval.asks.get(agent).delete(tool);
      return rec ?? null;
    },
  };
  return approval;
}

/**
 * The answerer: claim our ask, delegate the decision downstream, then
 * materialize. Registered before operator answerers are composed, so
 * `next()` reaches the real decider; if none exists the outcome is the
 * host's fail-closed 'unavailable' — still a decision, still released.
 */
async function answerRequest(approval, req, next) {
  const { toolName, agent } = req;
  const rec = approval.takeAsk(agent, toolName);
  if (!rec) return next(); // not our gate's ask — stay out of the chain
  try {
    const outcome = await next();
    if (outcome === 'allowed-once') {
      // the only native grant: an exec-cache entry — same operation replays
      // without re-asking until the TTL, across sessions of this runtime
      approval.store.cacheSet(rec.fp, Date.now(), approval.execCacheTtlMs, canonicalTarget(rec.args));
    }
    return outcome;
  } finally {
    // decided (allowed, rejected, cancelled, or failed closed): release the
    // dedup record + flood slot — the next uncovered call re-asks as fresh
    approval.store.resolvePending(rec.root, rec.fp);
  }
}

export function approvalPlugin(opts = {}) {
  function apply(ctx, config) {
    const approval = opts.__approval ?? createApproval(opts);
    apply.approval = approval;
    if (config?.execCacheTtlMs !== undefined) approval.execCacheTtlMs = config.execCacheTtlMs;
    if (config?.maxPendingPerRoot !== undefined) approval.maxPendingPerRoot = config.maxPendingPerRoot;
    if (config?.pendingTtlMs !== undefined) approval.pendingTtlMs = config.pendingTtlMs;

    ctx.on('tools/pre-execute', async (exec, next) => {
      const tool = exec?.name ?? 'unknown-tool';
      const args = exec?.arguments ?? {};
      const { root, session } = identityOf(exec?.agent);
      const v = approval.evaluate({ tool, args, root, session, now: Date.now() });
      if (v.verdict === 'allowed') return next();
      const report = (kind) => {
        // LoopGuard cooperation — a throwing listener must never take the
        // gate down with it (the gate's answer stands either way)
        try { ctx.emit?.(REFUSAL_EVENT, refusalPayload({ kind, verdict: v.verdict, ruleId: v.ruleId, tool, fingerprint: v.fingerprint, root, session })); } catch { /* accounting must not break enforcement */ }
      };
      if (v.verdict === 'refused-flood') {
        // enforced BEFORE any approval dispatch (port plan Phase 1 item 4)
        report('deny');
        const env = buildEnvelope({ gate: 'AG', ruleId: 'I-5/flood-cap',
          reason: `too many pending approvals for this root (${v.ruleId})`,
          lawfulNextMoves: ['wait for pending approvals to resolve', 'withdraw an older request', 'escalate to your Principal'] });
        return { kind: 'deny', reason: env.text };
      }
      // pending-approval / dedup-pending → the human gate. Record the ask for
      // the answerer's decision correlation (needs the agent object: the host
      // denies asks without one before any approval dispatch).
      if (exec?.agent) approval.recordAsk(exec.agent, tool, { fp: v.fingerprint, root, session, args });
      report('ask');
      const env = buildEnvelope({ gate: 'AG', ruleId: v.ruleId,
        reason: `"${tool}" is not covered by this runtime's grant layers`,
        lawfulNextMoves: ['request a scoped session grant for this target', 'use an approved alternative', 'escalate to your Principal'] });
      return { kind: 'ask', reason: env.text };
    });

    ctx.on('approval/request', (req, next) => answerRequest(approval, req, next));

    // Revocation + grant materialization via the commands seam — optional:
    // absent dsh-commands, the enforcement core above is intact and only the
    // operator surface degrades (noted in the annex, never silent at boot).
    if (typeof ctx.inject === 'function') {
      ctx.inject(['commands'], (scope) => registerGrantCommands(scope, approval));
    }
    return approval;
  }
  return apply;
}

function registerGrantCommands(ctx, approval) {
  const live = () => approval.store.sessionGrants.filter(g => !g.revokedAt && (!g.expiresAt || g.expiresAt > Date.now()));
  ctx.commands?.register({
    name: 'grants-list',
    description: 'compact-dsh: list live approval grants and cached approvals',
    handler: () => {
      const grants = live().map(g => `${g.id}  ${g.pattern.kind}${g.pattern.kind === 'HostAndPort' ? ':' + g.pattern.value.host + ':' + g.pattern.value.port : ':' + g.pattern.value}  root=${g.root ?? '-'} session=${g.session ?? '-'}${g.expiresAt ? ' expires=' + new Date(g.expiresAt).toISOString() : ''}`);
      return { kind: 'success', text: grants.length
        ? `${grants.length} live grant(s):\n${grants.join('\n')}\n${approval.store.cache.size} cached approval(s)`
        : `no live grants\n${approval.store.cache.size} cached approval(s)` };
    },
  });
  ctx.commands?.register({
    name: 'grants-grant',
    description: 'compact-dsh: grant a target pattern for this session — /grants-grant <pattern> [ttlMinutes] [maxUses]',
    handler: (inv) => {
      const [pattern, ttlMin, uses] = (inv.rawInput ?? '').trim().split(/\s+/);
      if (!pattern) return { kind: 'error', text: 'usage: /grants-grant <pattern> [ttlMinutes] [maxUses] — pattern like api.example.com, *.example.org, host:443, https://host/path/' };
      const { root, session } = identityOf(inv.agent);
      const ttlMs = ttlMin != null ? Math.max(1, Number(ttlMin)) * 60_000 : 60 * 60_000;
      if (!Number.isFinite(ttlMs)) return { kind: 'error', text: `ttl must be a number of minutes, got "${ttlMin}"` };
      const maxUses = uses != null ? Math.max(1, Math.floor(Number(uses))) : null;
      if (maxUses !== null && !Number.isFinite(maxUses)) return { kind: 'error', text: `maxUses must be a number, got "${uses}"` };
      const g = approval.grantSession({ pattern, root, session, ttlMs, maxUses });
      return { kind: 'success', text: `grant ${g.id} covers ${pattern} for session ${session} for ${Math.round(ttlMs / 60_000)}min${maxUses ? ` / ${maxUses} uses` : ''} (recorded: command/run + command/done)` };
    },
  });
  ctx.commands?.register({
    name: 'grants-revoke',
    description: 'compact-dsh: revoke a grant by id (kills covered cached approvals) — /grants-revoke <grantId>',
    handler: (inv) => {
      const id = (inv.rawInput ?? '').trim();
      if (!id) return { kind: 'error', text: `usage: /grants-revoke <grantId> — see /grants-list` };
      const g = approval.revoke(id);
      if (!g) return { kind: 'error', text: `no grant ${id}` };
      return { kind: 'success', text: `grant ${id} revoked; covered cached approvals killed` };
    },
  });
}

// module-level apply: the composition shape dsh loads (`name` + `inject` + `apply`)
export const apply = approvalPlugin();
