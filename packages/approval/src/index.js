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

import { createHash } from 'node:crypto';
import { GrantStore, coveringGrants } from './grants.js';
import { PersistentGrantStore } from './persist.js';
import { evaluate, DEFAULTS } from './evaluate.js';
import { fingerprint, canonicalTarget } from './fingerprint.js';
import { parseAllowlistLikePattern } from './pattern.js';
import { buildEnvelope } from 'compact-envelope';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export { GrantStore, PersistentGrantStore, coveringGrants, evaluate, fingerprint, canonicalTarget, parseAllowlistLikePattern, DEFAULTS };

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

/**
 * In-place secret masking for operator-facing command text (the deciding
 * preview's only consumer is the human gate). Reading the command is not the
 * same as reading the credential inside it — the shape stays visible for
 * triage, the material does not. Catalogue: authorization header values,
 * credential-shaped env-var assignments, URL query secrets, URL userinfo,
 * bare sk- tokens, PEM private-key blocks. Deliberately narrow: content
 * digests and ids share long-hex/JWT shapes, so no shape-based fallback
 * beyond PEM — a masked identifier is worse than a visible one.
 */
export function redactEmbeddedSecrets(text) {
  return String(text ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/(authorization\s*:\s*)([^'"\n]*)/gi, '$1***')
    .replace(/\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s&|;'"]+)/gi, '$1=***')
    .replace(/([?&][\w.-]*(?:key|token|secret|password|sig(?:nature)?)[\w.-]*=)[^&\s]+/gi, '$1***')
    .replace(/(https?:\/\/)([^\s/@]+)@/g, '$1***@')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***private-key***');
}

/**
 * A one-line, operator-facing preview of the gated call. The host's
 * approval/request wire carries NO arguments, so without this the decider
 * sees "bash" and a fingerprint — approving blind is the hidden blanket grant
 * of the Phase 1 doctrine read from the human side. Truncated and
 * secret-masked: the operator sees the command's shape, never its embedded
 * credentials, and what the operator sees never reaches the record (the log
 * carries the envelope, which names no arguments).
 */
function commandPreview(args) {
  const raw = typeof args?.command === 'string' ? args.command : (() => { try { return JSON.stringify(args); } catch { return ''; } })();
  const flat = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const cut = flat.length > 240 ? flat.slice(0, 237) + '…' : flat;
  return redactEmbeddedSecrets(cut);
}

/** Command-aware identity for targetless calls that reference declared
 *  secrets: allow-once covers exactly this command, never a blanket over the
 *  tool (the LoopGuard's command-aware doctrine, reused for the agreement). */
function commandAwareFingerprint(tool, args) {
  return 'fp_' + createHash('sha256').update(JSON.stringify({ tool: String(tool), command: String(args?.command ?? '') })).digest('hex').slice(0, 16);
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
    // declared secret references (env NAMES, never values): the only names
    // whose presence in a gated command triggers the injection agreement. An
    // empty list is the capability ABSENT — nothing is injectable, and that
    // absence is enforced by the same lookup that would inject.
    secretRefs: [...(opts.secretRefs ?? [])],
    secretGrantTtlMs: opts.secretGrantTtlMs ?? (opts.execCacheTtlMs ?? DEFAULTS.execCacheTtlMs),
    // asks currently waiting on the decider downstream: callId → preview.
    // Populated by the recorded answerer for exactly the duration of the
    // decision, so an operator answerer can show WHAT is being decided, not
    // just that something is.
    deciding: new Map(),
    // #40 replay traces already delivered: `${session}/${fp}/${grantedAt}` →
    // noted at. The grant generation (grantedAt) is part of the key: a
    // fingerprint the operator approved AGAIN traces again. Bounded by a
    // coarse clear (worst case after a clear: one extra trace per live pair).
    replayNotes: new Map(),
    // ask↔decision correlation: agent object → toolName → FIFO of ask records.
    // The host request carries NO tool arguments, so a single rec per
    // (agent, tool) would let a LATER ask overwrite an EARLIER one — and the
    // operator's approval of the earlier request would then materialize the
    // later call's fingerprint (a wrong grant). Records match by callId when
    // the request carries one, else FIFO (asks decide in order). WeakMap:
    // the records live exactly as long as the asking agent does.
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
      const q = m.get(tool) ?? [];
      q.push({ ...rec, at: rec.at ?? Date.now() });
      m.set(tool, q);
    },
    /**
     * Claim the pending ask record (removes it; null when the ask is not ours).
     * Matches by callId when the request carries one, else the oldest record
     * (FIFO); records older than the pending TTL are dropped while searching.
     */
    takeAsk: (agent, tool, callId) => {
      const q = approval.asks.get(agent)?.get(tool);
      if (!q || q.length === 0) return null;
      const cutoff = Date.now() - approval.pendingTtlMs;
      for (let i = q.length - 1; i >= 0; i--) if (q[i].at < cutoff) q.splice(i, 1);
      if (q.length === 0) return null;
      let idx = callId != null ? q.findIndex(r => r.callId != null && r.callId === callId) : -1;
      if (idx < 0) idx = 0;
      return q.splice(idx, 1)[0];
    },
    /**
     * #40: the exec-cache replay's receipt. A replay is a decision the
     * operator already made paying out in a session that never saw it — this
     * queues the one-line trace (once per session, per fingerprint, per grant
     * generation) so the Subject's transcript names the basis. The entry (and
     * its generation) is the caller's — the one the replay actually ran
     * under, never a re-read that could cross an expiry boundary. The noted
     * key is recorded only AFTER inject succeeds: a transient inject failure
     * must not burn the generation's receipt — the next replay retries. An
     * agent without inject (test shapes) skips silently; a throwing inject
     * must never take the gate down.
     */
    noteReplay: (agent, session, tool, fp, entry, now = Date.now()) => {
      if (!entry) entry = approval.store.cacheGet(fp, now);
      if (!entry) return;
      if (typeof agent?.inject !== 'function') return;
      const key = `${session ?? 'root'}/${fp}/${entry.grantedAt}`;
      if (approval.replayNotes.has(key)) return;
      if (approval.replayNotes.size >= 2048) approval.replayNotes.clear();
      try {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: replayTranscriptNote({
            tool, fingerprint: fp, target: entry.target ?? {},
            grantedAt: entry.grantedAt, expiresAt: entry.expiresAt,
          }) }],
          source: { kind: 'plugin', plugin: 'compact-approval' },
        }));
        approval.replayNotes.set(key, now);
      } catch { /* the trace is a receipt, never a gate — and not yet spent */ }
    },
  };
  return approval;
}

/**
 * The one-line guarantee shared by every transcript note (#25, #40): a note
 * is injected as a user message, and the values it carries are tool-argument
 * material — `canonicalTarget` lowercases the host and stringifies the port
 * without stripping control characters, so a crafted `host`/`port` could
 * otherwise ride the interpolation into a multi-line forged message. Every
 * value is flattened (control characters and whitespace runs → one space)
 * before it touches a note: the fact stays on the record, the message
 * structure cannot be forged by the fact's subject.
 */
function oneLine(v) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
}

function targetBitsOf(target) {
  return Object.entries(target ?? {})
    .map(([k, v]) => [k, oneLine(v)])
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

/**
 * The transcript note for a decided approval (#25). The host appends the
 * `approval/asked` + `approval/decided` pair to the durable record, but the
 * surface the Subject lives in showed nothing: in web the browser card
 * vanishes on the decision, and an ALLOWED call is invisible — the Subject
 * only sees the tool run (or, after a denial, its envelope), never that a
 * gate fired and was answered. The note is the composition's copy of the
 * decision in the only channel it owns — a plugin-sourced user message, the
 * same channel dsh itself uses (user-approval's policy-change notice, the
 * subagent driver's settlement notices) — queued for the agent's next model
 * step, so the transcript carries the gate's firing wherever it is rendered.
 *
 * ENVELOPE-GRADE FACTS ONLY: tool, canonical target, fingerprint, outcome.
 * Deliberately NOT the deciding preview — what the operator saw (the masked
 * command text) never reaches the record, and this note is on the record.
 * The view is narrowed by the caller to exactly these fields, so the
 * no-arguments doctrine is structural, not discipline. One line, always
 * (see oneLine).
 */
export function approvalTranscriptNote({ tool, fingerprint, target }, outcome) {
  const targetBits = targetBitsOf(target);
  const subject = `"${oneLine(tool) || 'unknown-tool'}"` + (targetBits ? ` (${targetBits})` : '') + ` [${oneLine(fingerprint) || 'no fingerprint'}]`;
  switch (outcome) {
    case 'allowed-once':
      return `[compact-approval] Gate decision: ${subject} was allowed once by the operator — ` +
        `the identical operation replays without re-asking until the exec-cache entry expires; anything else asks again.`;
    case 'rejected':
      return `[compact-approval] Gate decision: ${subject} was denied by the operator — the call did not run.`;
    case 'cancelled':
      return `[compact-approval] Gate decision: ${subject} closed cancelled — no operator answer arrived; the call did not run (fail-closed).`;
    default:
      return `[compact-approval] Gate decision: ${subject} closed ${outcome ?? 'unavailable'} — no operator answer; the call did not run (fail-closed).`;
  }
}

/**
 * The transcript note for an exec-cache REPLAY (#40). The exec-cache is
 * cross-session by design — the operator approved one exact operation, and
 * "once" names the decision, not the grant's consumption — but cross-session
 * validity must be earned by cross-session traceability: the replaying
 * session inherits a capability whose basis lives in a prior session's
 * record, and without a trace it sees only the tool run. This note is the
 * payout's receipt where the Subject lives: same channel, same envelope-grade
 * discipline — tool, canonical target, fingerprint, when the underlying
 * approval was granted and when it lapses — and, like the decision note,
 * ONE LINE, ALWAYS (see oneLine).
 */
export function replayTranscriptNote({ tool, fingerprint, target, grantedAt, expiresAt }) {
  const targetBits = targetBitsOf(target);
  // null/undefined, never truthiness: epoch 0 is a time, not an absence
  const when = (ts) => { if (ts == null) return null; try { return new Date(ts).toISOString(); } catch { return null; } };
  const granted = when(grantedAt) ?? 'an unrecorded time';
  const expires = when(expiresAt);
  return `[compact-approval] Replay: "${oneLine(tool) || 'unknown-tool'}"` +
    (targetBits ? ` (${targetBits})` : '') + ` [${oneLine(fingerprint) || 'no fingerprint'}]` +
    ` is running under a prior operator approval — granted ${granted}, expires ${expires ?? 'never'} — ` +
    `no new decision was asked or made; revoke or let it lapse to be asked again.`;
}

/**
 * The answerer: claim our ask, delegate the decision downstream, then
 * materialize. Registered before operator answerers are composed, so
 * `next()` reaches the real decider; if none exists the outcome is the
 * host's fail-closed 'unavailable' — still a decision, still released.
 */
async function answerRequest(approval, req, next) {
  const { toolName, agent } = req;
  const rec = approval.takeAsk(agent, toolName, req.callId);
  if (!rec) return next(); // not our gate's ask — stay out of the chain
  // expose WHAT is being decided for exactly the decision's duration: the
  // wire carries no arguments, so without this the decider sees "bash" and a
  // fingerprint — approving blind would be the blanket grant with a human
  // face. Keyed by callId; cleared by identity so a racing ask never loses
  // its own preview.
  const key = req.callId != null ? String(req.callId) : `${agent?.id ?? '?'}:${toolName}`;
  const view = { tool: toolName, callId: req.callId ?? null, fingerprint: rec.fp,
    target: canonicalTarget(rec.args), command: commandPreview(rec.args) };
  approval.deciding.set(key, view);
  try {
    const outcome = await next();
    if (outcome === 'allowed-once') {
      // the only native grant: an exec-cache entry — same operation replays
      // without re-asking until the TTL, across sessions of this runtime
      approval.store.cacheSet(rec.fp, Date.now(), approval.execCacheTtlMs, canonicalTarget(rec.args));
      // the injection agreement: an approved call that referenced declared
      // secrets materializes one session-scoped grant per ref — TTL-bounded,
      // revocable, covering only this session's confined calls
      for (const ref of rec.secretRefs ?? []) {
        approval.store.addSecretGrant({
          ref, root: rec.root, session: rec.session,
          ttlMs: approval.secretGrantTtlMs, now: Date.now(),
        });
      }
    }
    // #25: the decision's visible trace where the Subject lives — asked and
    // answered, for every outcome, on the browser and terminal paths alike
    // (this wrapper sees both). An agent without inject (test shapes) skips
    // the note; a throwing inject must never take the decision path down.
    if (typeof agent?.inject === 'function') {
      try {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: approvalTranscriptNote(
            { tool: view.tool, fingerprint: view.fingerprint, target: view.target },
            outcome,
          ) + (outcome === 'allowed-once' && (rec.secretRefs ?? []).length
            ? ` The approved injection grant${rec.secretRefs.length > 1 ? 's are' : ' is'} live for this session ` +
              `(${rec.secretRefs.map(r => '$' + r).join(', ')}), TTL-bounded.`
            : '') }],
          source: { kind: 'plugin', plugin: 'compact-approval' },
        }));
      } catch { /* the note is a trace, never a gate */ }
    }
    return outcome;
  } finally {
    if (approval.deciding.get(key) === view) approval.deciding.delete(key);
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
    if (config?.secretRefs !== undefined) approval.secretRefs = [...config.secretRefs];

    /**
     * The full pre-execute decision as a reusable function (Phase 2 routing):
     * null = pass/allowed; otherwise the PreToolDecision ({kind:'ask'|'deny',
     * reason}). Every side effect of the gate — evaluation, flood cap,
     * ask-correlation record, refusal-seam emission, envelope — happens here,
     * so a routing plugin (remote-access) that synthesizes target-bearing
     * calls gets identical semantics to a directly-gated call.
     */
    approval.gate = (exec) => {
      const tool = exec?.name ?? 'unknown-tool';
      const args = exec?.arguments ?? {};
      const { root, session } = identityOf(exec?.agent);
      // Declared secret references in the call: any word occurrence of a NAME
      // declared by the composition. The detector is deliberately NOT anchored
      // on shell expansion — requiring the `$` hid the agreement behind a
      // phrasing requirement the Subject was never taught: `printenv NAME`
      // (the canonical read) and `os.environ['NAME']` referenced the secret
      // and passed ungated (#27). The names are declared by the composition,
      // so false positives are bounded to commands that mention a declared
      // secret, which ARE references in spirit. `$NAME` and `${NAME}` are
      // subsumed (`$` precedes a word boundary); word boundaries keep a
      // declared TOKEN from matching TOKENS or GH_TOKEN. Undeclared FOO is
      // still the Subject's own variable and none of this gate's business.
      // The approval of such a call is also the injection agreement — the
      // envelope says so, so the decider knows what "allow once" materializes.
      const secretRefs = approval.secretRefs.filter(re =>
        new RegExp(`\\b${String(re).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
          .test(String(args?.command ?? '')));
      // This gate gates IDENTIFIABLE targets only. A call with no canonical
      // target (an opaque command string, a path argument) would collapse to
      // one fingerprint per tool — approving it once would be a hidden
      // blanket grant over every future call of that tool (the concept's
      // "no blanket grants" invariant, D-8). Opaque command strings are the
      // remote-access analyzer's domain (Phase 2 item 3); mount requests
      // carry their own gate.
      //
      // THE EXCEPTION PROVES THE RULE: a targetless call that references a
      // DECLARED secret must pass the human gate — the injection agreement
      // cannot exist without a decision — so it is gated under a
      // COMMAND-AWARE fingerprint (the LoopGuard's own doctrine): allow-once
      // covers exactly this command, never a blanket over the tool.
      if (Object.keys(canonicalTarget(args)).length === 0) {
        if (secretRefs.length === 0) return null;
        const fp = commandAwareFingerprint(tool, args);
        const secretEntry = approval.store.cacheGet(fp, Date.now());
        if (secretEntry) {
          // the identical secret command replays — and its replay traces (#40):
          // the credential becomes available again without a new decision
          approval.noteReplay(exec?.agent, session, tool, fp, secretEntry);
          return null;
        }
        if (exec?.agent) approval.recordAsk(exec.agent, tool, { fp, root, session, args, callId: exec.callId, secretRefs });
        approval.store.recordPending(root);
        // LoopGuard cooperation, same contract as the target-bearing path
        try { ctx.emit?.(REFUSAL_EVENT, refusalPayload({ kind: 'ask', verdict: 'ask', ruleId: 'I-5/secret-use', tool, fingerprint: fp, root, session })); } catch { /* accounting must not break enforcement */ }
        const env = buildEnvelope({ gate: 'AG', ruleId: 'I-5/secret-use',
          reason: `"${tool}" references declared secret${secretRefs.length > 1 ? 's' : ''} ${secretRefs.map(r => '$' + r).join(', ')}; ` +
            `approving it materializes the injection grant and the credential is available to this command inside the ` +
            `confined execution — it never enters this conversation, but the command may print it: the record keeps what it prints`,
          lawfulNextMoves: ['rephrase without the secret reference', 'escalate to your Principal'] });
        return { kind: 'ask', reason: env.text };
      }
      const v = approval.evaluate({ tool, args, root, session, now: Date.now() });
      if (v.verdict === 'allowed') {
        // an exec-cache replay traces once per session per grant generation
        // (#40): the call runs, and the Subject learns a prior approval paid
        // for it — under the exact entry the evaluation answered from. Plan/
        // session-grant allows are the grant layers' own record (pattern
        // grants list in grants-list) — not this note's business.
        if (v.layer === 'exec-cache') approval.noteReplay(exec?.agent, session, tool, v.fingerprint, v.entry);
        return null;
      }
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
      // denies asks without one before any approval dispatch). callId lets the
      // correlation survive concurrent asks for the same tool.
      if (exec?.agent) approval.recordAsk(exec.agent, tool, { fp: v.fingerprint, root, session, args, callId: exec.callId, secretRefs });
      report('ask');
      const env = buildEnvelope({ gate: 'AG', ruleId: v.ruleId,
        reason: `"${tool}" is not covered by this runtime's grant layers` +
          (secretRefs.length
            ? ` — this call references declared secret${secretRefs.length > 1 ? 's' : ''} ${secretRefs.map(r => '$' + r).join(', ')}; ` +
              `approving it materializes a secret grant and the credential is injected into the confined execution ` +
              `without entering this conversation`
            : ''),
        lawfulNextMoves: ['request a scoped session grant for this target', 'use an approved alternative', 'escalate to your Principal'] });
      return { kind: 'ask', reason: env.text };
    };

    ctx.on('tools/pre-execute', async (exec, next) => approval.gate(exec) ?? next());

    // PREPENDED: the recorded answerer must WRAP every decider, including the
    // web surface's. dsh-api-remotes registers its browser bridge for this
    // event from a boot effect, and an effect-registered listener precedes a
    // plain apply-registered one in the waterfall — so without the prepend the
    // bridge sits UPSTREAM of us in web mode and a browser verdict resolves
    // the chain directly: allowed-once never flows through next(), cacheSet
    // never runs, and the identical operation re-asks forever (#24). Prepended,
    // we claim our asks first and delegate via next() — the designed
    // "recorded answerer claims, downstream decides" order — in headless
    // (operator answerer downstream) and web (browser bridge downstream) alike.
    ctx.on('approval/request', (req, next) => answerRequest(approval, req, next), { prepend: true });

    // Cross-plugin consumption (Phase 2): the sandbox provider lists mount
    // grants and the remote-access analyzer routes findings through the same
    // grant layers — both reach this runtime's grant store through the
    // 'compact-approval' service (Cordis inject ordering makes a composition
    // without the approval plugin fail loudly rather than degrade silently).
    ctx.provide?.('compact-approval', approval);

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

function patternText(pattern) {
  switch (pattern.kind) {
    case 'HostAndPort': return `HostAndPort:${pattern.value.host}:${pattern.value.port}`;
    case 'PathPrefix': return `PathPrefix:${pattern.value.path}(${pattern.value.ceiling})`;
    default: return `${pattern.kind}:${pattern.value}`;
  }
}

function registerGrantCommands(ctx, approval) {
  const live = () => approval.store.sessionGrants.filter(g => !g.revokedAt && (!g.expiresAt || g.expiresAt > Date.now()));
  // live cache entries only: an expired entry is lazily deleted on its next
  // probe and would read as authority it no longer carries (#40)
  const liveCache = () => [...approval.store.cache.entries()]
    .filter(([, e]) => !e.expiresAt || e.expiresAt > Date.now());
  ctx.commands?.register({
    name: 'grants-list',
    description: 'compact-dsh: list live approval grants and cached approvals',
    handler: () => {
      const grants = live().map(g => `${g.id}  ${patternText(g.pattern)}  root=${g.root ?? '-'} session=${g.session ?? '-'}${g.expiresAt ? ' expires=' + new Date(g.expiresAt).toISOString() : ''}${g.maxUses ? ` uses=${g.uses}/${g.maxUses}` : ''}`);
      const cache = liveCache();
      // #40: the cache is enumerated, not counted — an operator audits what
      // is replayable right now (fingerprint, target, lifetime). Target
      // values are one-line flattened: command output is recorded.
      const lines = cache.slice(0, 50).map(([fp, e]) =>
        `  ${fp}  ${targetBitsOf(e.target) || '(command-aware)'}  granted=${new Date(e.grantedAt).toISOString()}${e.expiresAt ? ` expires=${new Date(e.expiresAt).toISOString()}` : ' never'}`);
      const cacheText = `${cache.length} live cached approval(s)` +
        (lines.length ? `:\n${lines.join('\n')}${cache.length > lines.length ? `\n  …and ${cache.length - lines.length} more` : ''}` : '');
      return { kind: 'success', text: (grants.length
        ? `${grants.length} live grant(s):\n${grants.join('\n')}`
        : 'no live grants') + `\n${cacheText}` };
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
      // echo the PARSED pattern, never the raw operator input: a token in a
      // URL's userinfo is stripped by canonicalization — echoing the input
      // would leak it into the durable session log (command/done is recorded)
      return { kind: 'success', text: `grant ${g.id} covers ${patternText(g.pattern)} for session ${session} for ${Math.round(ttlMs / 60_000)}min${maxUses ? ` / ${maxUses} uses` : ''} (recorded: command/run + command/done)` };
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
