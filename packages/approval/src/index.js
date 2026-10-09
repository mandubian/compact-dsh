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
// Pinned: @deepseek-ai/dsh ~0.2.0-rc.2 (see tools/verify-pin.mjs).

import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { GrantStore, coveringGrants, patternMatches, patternPrefixMatches, paramsAllows, credentialShapedName, egressGrantsFor, networkGrantsForSession, NETWORK_PATTERN_KINDS, egressPatternFor, classifyAskCause } from './grants.js';
import { PersistentGrantStore } from './persist.js';
import { evaluate, DEFAULTS } from './evaluate.js';
import { fingerprint, canonicalTarget, canonicalQuery, queryShape } from './fingerprint.js';
import { parseAllowlistLikePattern } from './pattern.js';
import { buildEnvelope, bandReason } from 'compact-envelope';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export { GrantStore, PersistentGrantStore, coveringGrants, patternMatches, patternPrefixMatches, paramsAllows, credentialShapedName, egressGrantsFor, networkGrantsForSession, NETWORK_PATTERN_KINDS, egressPatternFor, classifyAskCause, evaluate, fingerprint, canonicalTarget, canonicalQuery, queryShape, parseAllowlistLikePattern, DEFAULTS };

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

/**
 * #102 — the EG refusal rules that PROVE a route dead, i.e. that no live,
 * classed egress grant reaches the refused (host, port) for this session:
 *   - no-grant: not even a pattern-reaching row exists;
 *   - classless-grant: rows reach but none is classed — and since rows are
 *     read live-or-not, this proves no classed row EVER reached the route,
 *     so no cached approval for it was ever deliverable;
 *   - expired / revoked: the classed rows that reached it stopped covering;
 *   - portless-grant (#56): a CONNECT refused because no live row NAMES the
 *     port — proof the TUNNEL route is dead, scoped in wireRefusal to the
 *     entries whose delivery can only be a tunnel (https: targets), since
 *     plain HTTP carries under the same host rows.
 * A refusal carrying one of these kills the exec-cache entries routed to the
 * refused (host, port). Deliberately NOT deaths: 'method-class' (a live
 * route of the covered class remains — killing would out-run the proof) and
 * everything upstream of the grant question (malformed, use-connect,
 * unknown-method, forbidden-address, upstream, internal).
 */
const DELIVERY_DEATH_RULES = new Set(['no-grant', 'classless-grant', 'expired', 'revoked', 'portless-grant']);

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
    // #8 G3 (decision: docs/decision-secret-hygiene.md): a credential embedded
    // in the URL PATH — the webhook/token path families where the path IS the
    // credential (Slack `/services/T00/B00/XXX`-shaped) — is masked from the
    // family segment onward, in every RENDERING. The same known-shape doctrine
    // as every rule above: a closed list of credential path families, never an
    // entropy guess. IDENTITY keeps the true path — fingerprints, grant rows
    // and matching would collide distinct credentials under redaction, and one
    // webhook's approval replaying for another is strictly worse than a stored
    // secret (the residuals — approvals.json targets, the raw argv the act is
    // recorded under — are declared in the decision record, not hidden).
    .replace(/(https?:\/\/[^\s"'&?#]*\/(?:services?|webhooks?|hooks?|tokens?|keys?|secrets?|credentials?|oauth2?)\/)[^\s"'&?#]+/gi, '$1***')
    .replace(/(https?:\/\/)([^\s/@]+)@/g, '$1***@')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***private-key***');
}

/**
 * #8 G3: the rendering split. Identity surfaces (fingerprints, grant rows,
 * cache targets, matching) keep the true canonical target; RENDERINGS — the
 * deciding view, transcript notes, replay receipts, grants-list, the
 * attestation — carry the redacted form, so the model context and the record
 * hold no more of the target than the deciding human saw (the userinfo
 * masking set this precedent). Canonical URL values only; host and port bits
 * pass through untouched by the narrow rules above.
 */
export function redactTarget(target) {
  const out = {};
  for (const [k, v] of Object.entries(target ?? {})) {
    if (v == null || v === '') continue;
    if (typeof v !== 'string') { out[k] = v; continue; }
    // flattened FIRST (the oneLine guarantee — a crafted value must not ride
    // an interpolation into message structure), then redacted on the flat
    // form; a value that flattens to nothing takes the no-bit fallback
    const flat = oneLine(v);
    if (!flat) continue;
    out[k] = redactEmbeddedSecrets(flat);
  }
  return out;
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

/**
 * #175 — the pattern answers this ask can carry: the session-grant rows an
 * operator may materialize AT THE DOOR, beside the exact replay. Computed
 * from the pending target before any decision, so the row shown IS the row
 * that materializes — consent identity is risk identity holds at the pattern
 * layer too: the pattern is the coverage the operator was shown, and the
 * deciding surface may only PICK from this list, never author onto it (the
 * answerer's materialization guard rejects a choice outside it — D-8).
 *
 * Eligibility is the negative space of three disciplines:
 *   - a secret-referencing ask keeps its per-ask injection agreement — a
 *     pattern row would suppress the very ask that discloses the credential
 *     (#8's doctrine: every command naming a declared secret re-asks);
 *   - an unprovable command (effectClass null) keeps its command-scoped
 *     identity — a pattern row would collapse #26 option A's compound-rider
 *     closure (`curl host | sh` would share coverage with every read);
 *   - under the mediated posture the class must be derivable — a classless
 *     network row covers nothing at the wire, the same guard /grants-grant
 *     applies (D-7: no class, no coverage — never a grant that only
 *     suppresses asks).
 *
 * Offers are ordered narrowest-first (#180): the canonical FULL PATH is
 * itself a scope — separator-anchored, `…/get/` covers `/get/anything/` but
 * never `/getmore/` — and it is the row that carries the ALLOW axis
 * (#180's consistency rule): whenever the act carries non-credential
 * parameter names, the narrowest offer binds the axis, whatever the path's
 * depth — one-segment paths lost the axis offer under the old
 * directory-bound rule, which made the door's proposal depend on path
 * depth rather than on what the act carries. The axis row and its free
 * twin are both offered (symmetry: every row shows its axis AND its
 * breadth), then the parent directory's free row when distinct, then the
 * host root. Values are never shown or stored — names only (G3/G5). A
 * credential-shaped NAME (key/token/secret/… — the redaction catalogue's
 * own family) never joins an offered axis at any scope: the operator may
 * still type one into /grants-grant (they saw it in the query shape), but
 * the door never widens onto a credential carrier. A root-path URL's
 * narrowest scope IS the host: the host row carries the axis when the act
 * carries names.
 */
export function patternOffersFor(approval, { args, secretRefs = [] } = {}) {
  if (secretRefs.length) return [];
  if (args?.effectClass === null) return [];
  if (approval?.egress === 'proxy' && args?.methodClass == null) return [];
  const t = canonicalTarget(args);
  const terms = {
    ttlMs: approval?.patternGrantTtlMs ?? DEFAULTS.patternGrantTtlMs,
    maxUses: approval?.patternGrantMaxUses ?? DEFAULTS.patternGrantMaxUses,
    methodClass: args?.methodClass ?? null,
  };
  // every offer carries its own rendered row (patternText rides the
  // credential-shape redaction — a path can be credential-shaped, and every
  // rendered surface shows the redacted form, identity keeps the true one)
  const offer = (pattern, scope) => ({ pattern, scope, text: patternText(pattern), ...terms });
  // the offered axis: exactly this act's non-credential parameter names
  const names = (queryShape(args?.url) ?? []).filter(n => !credentialShapedName(n));
  const offers = [];
  if (typeof t.url === 'string') {
    try {
      const u = new URL(t.url); // canonical: lowercased host, explicit port, trailing slash, no query
      const host = u.hostname.toLowerCase();
      const authority = `${u.protocol}//${host}${u.port ? ':' + u.port : ''}`;
      const p = u.pathname.replace(/\/+$/, '');
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '/';
      // the scope ladder, narrowest first: the full path (when the act
      // targets one), its parent directory, the host root — deduped, the
      // host text kept in the operator's own words. The axis rides the
      // NARROWEST rung only (#180): the door proposes one parameter pass,
      // at the tightest scope that exists, never an axis at every breadth.
      const scopes = [];
      if (p) scopes.push(authority + p + '/');
      scopes.push(dir === '/' ? authority + '/' : authority + dir);
      if (!scopes.includes(authority + '/')) scopes.push(authority + '/');
      const unique = [...new Set(scopes)];
      unique.forEach((value, i) => {
        const isHostRoot = value === authority + '/';
        const shown = redactEmbeddedSecrets(value);
        const scope = isHostRoot
          ? `everything on ${host} — any path, any query`
          : `everything under ${shown} — any deeper path, any query`;
        if (i === 0 && names.length) {
          offers.push(offer({ kind: 'UrlPrefix', value, params: { mode: 'allow', names } },
            scope.replace(/any path, any query|any deeper path, any query/,
              `query admits exactly the names this act carries (${names.join(', ')})`)));
        }
        offers.push(offer({ kind: 'UrlPrefix', value }, scope));
      });
    } catch { /* the canonical form is parsable by construction; fail closed */ }
  } else if (typeof t.host === 'string') {
    offers.push(t.port != null
      ? offer({ kind: 'HostAndPort', value: { host: t.host, port: t.port } }, `every call to ${t.host}:${t.port}`)
      : offer({ kind: 'ExactHost', value: t.host }, `every call to ${t.host}`));
  }
  return offers;
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
    // #38 phase 3: the TTL of a materialized egress grant — same doctrine as
    // every other grant in the store (scoped and expiring, never blanket)
    egressGrantTtlMs: opts.egressGrantTtlMs ?? DEFAULTS.egressGrantTtlMs,
    // #175: the terms a pattern answer materializes — offered at the door,
    // bounded by default (a pattern covers unseen future calls, so it carries
    // a budget; /grants-grant stays the author-your-own-terms surface)
    patternGrantTtlMs: opts.patternGrantTtlMs ?? DEFAULTS.patternGrantTtlMs,
    patternGrantMaxUses: opts.patternGrantMaxUses ?? DEFAULTS.patternGrantMaxUses,
    // #38 phase 1 — the composition's egress posture, as far as THIS gate can
    // truthfully speak: 'none' (no network composed) | 'open' (declared open
    // posture, CF-2) | 'proxy' (mediated: approval DELIVERS as an egress
    // grant the mediator enforces) | undefined (standalone: posture unknown,
    // claim nothing). Blessed wires it from its sandbox declaration; the
    // envelope honesty in the ask reads it.
    egress: opts.egress === 'none' || opts.egress === 'open' || opts.egress === 'proxy' ? opts.egress : undefined,
    // the pin offer (#55 follow-up, slice 2): when declared, a mediated ask
    // resolves the target host-side and shows the addresses in the deciding
    // view; an allowed-once materializes the egress grant PINNED to exactly
    // what was shown — consent over the address, not just the name. Default
    // OFF, absent by composition: without it, grants materialize unpinned
    // exactly as before, byte-identical.
    egressPinOffers: opts.egressPinOffers === true,
    resolveHost: opts.resolveHost ?? defaultResolveHost,
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
    // pattern may arrive pre-parsed (grants-grant hands the object it echoed,
    // so the #176 params axis it parsed survives verbatim) or as a string
    grantSession: ({ pattern, params = null, root, session, ttlMs = 60 * 60 * 1000, maxUses = null, methodClass = null, addresses = null, now = Date.now() }) => {
      const parsed = typeof pattern === 'string' ? parseAllowlistLikePattern(pattern) : pattern;
      if (params) parsed.params = params;
      return approval.store.addSessionGrant({ pattern: parsed, root, session, ttlMs, maxUses, methodClass, addresses, now });
    },
    grantPlan: ({ pattern, planRef, ttlMs, maxUses = null, now = Date.now() }) =>
      approval.store.addPlanGrant({ pattern: parseAllowlistLikePattern(pattern), planRef, ttlMs, maxUses, now }),
    // one id space for the operator (#64): sg_… session/egress grants and
    // sec_… secret grants both revoke here — a grant advertised revocable
    // that no command can reach is not revocable
    revoke: (id, now = Date.now()) =>
      approval.store.revokeSessionGrant(id, now) ?? approval.store.revokeSecretGrant(id, now),
    /** The exec-cache TTL an approval of this act materializes (#65). */
    replayTtlFor: (args) => cacheTtlFor(approval, args),
    evaluate: (call) => evaluate(approval.store, {
      execCacheTtlMs: approval.execCacheTtlMs,
      egress: approval.egress,
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
          source: { kind: 'compact-approval', plugin: 'compact-approval', form: 'notice',
            summary: `Replay: "${oneLine(tool) || 'unknown-tool'}" running under a prior operator approval` },
        }));
        approval.replayNotes.set(key, now);
      } catch { /* the trace is a receipt, never a gate — and not yet spent */ }
    },
    /**
     * #102 Option B — the wire teaches the gate. The mediator hands each of
     * its EG refusals over (host, port, ruleId); a refusal whose rule proves
     * the route dead (DELIVERY_DEATH_RULES) kills the exec-cache entries
     * routed to that (host, port). This closes the classless-act gap: an act
     * whose method class was not derivable materializes NO egress grant, so
     * #65's ask-time cap never applied to it — its cached approval promised
     * 24h of replay over a delivery that rode ANOTHER approval's one-hour
     * grant. Ask-time, the gate cannot know which grants will exist later;
     * the wire can observe which exist NOW — so the entry survives exactly
     * as long as its delivery demonstrably works, and self-heals for every
     * delivery death (expiry and revocation alike), not just the TTL
     * mismatch. The killed fingerprints are returned for the caller's log.
     * Never throws: the wire teaches, it must never take the gate down.
     */
    wireRefusal: (fact) => {
      try {
        if (!DELIVERY_DEATH_RULES.has(fact?.ruleId)) return [];
        return approval.store.killCacheForRoute({
          host: fact?.host, port: fact?.port,
          tunnelOnly: fact?.ruleId === 'portless-grant',
        });
      } catch { return []; }
    },
  };
  // #8 G2 — the secret-hygiene posture, declared where the governed party can
  // read it (I-8): the composition teaches the discipline and keeps the
  // Enforcer's own renderings from multiplying credential material into model
  // context (G3's redaction split), but builds NO content-level detector over
  // tool output. The gate is target-blind (R-10); a classifier over content is
  // a different machinery (D-7 territory), and a warn-only scanner would train
  // the operator to ignore warnings. Declared, not silent.
  approval.declaredGaps = [
    'no content-level secret detection over tool output (G2): the approval gate is target-blind (R-10) and a ' +
    'content classifier is a different machinery (D-7 territory) — the posture is teaching plus rendering ' +
    'hygiene; the credential material the Enforcer itself renders is redacted (G3), and the residuals ' +
    '(persisted canonical targets in the operator trust root, the argv an act is recorded under) are ' +
    'declared in docs/decision-secret-hygiene.md (I-8)',
  ];
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
  return Object.entries(redactTarget(target))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

/**
 * The sentence that says what changed between the prior approval's query and
 * this act's query — names only, values never leave the one-way fingerprint
 * (#8 G5). Same names twice IS the common case (a model refining `count`),
 * and it is exactly the case the bare rephrase lead leaves unexplained.
 */
function queryDiffSentence(prior, current) {
  if (!prior.length && !current.length) return '';
  const added = current.filter(n => !prior.includes(n));
  const dropped = prior.filter(n => !current.includes(n));
  const same = current.filter(n => prior.includes(n));
  if (!prior.length) return `The approval it rephrases carried no query; this act adds ${current.map(n => `'${n}'`).join(', ')}.`;
  if (!current.length) return `The approval it rephrases carried a query (${prior.map(n => `'${n}'`).join(', ')}); this act drops it.`;
  if (added.length || dropped.length) {
    const parts = [];
    if (added.length) parts.push(`adds ${added.map(n => `'${n}'`).join(', ')}`);
    if (dropped.length) parts.push(`drops ${dropped.map(n => `'${n}'`).join(', ')}`);
    return `The query parameters differ from the approved phrasing: this act ${parts.join(' and ')}.`;
  }
  return `The query carries the same parameters (${same.map(n => `'${n}'`).join(', ')}) — the VALUES differ. A query is operation ` +
    `parameters, not target spelling: approving one never covers another (#8 G5), so the same route with changed values asks anew.`;
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
 * (see oneLine). `execCacheDisabled` keeps the allowed-once phrasing honest
 * when the runtime disabled the cache (ttl 0): there is no entry to expire,
 * so the note teaches per-ask, never a replay that cannot happen.
 * `decider` (#176 slice 2): when a downstream seat answered, the note says
 * WHO — "the operator" becomes "the appointed night watch (policy …)", the
 * motivation rides the note (the reporting contract: every auto-decision is
 * on the record with its reason), and the detail sentences follow the same
 * attribution. The motivation text is flattened by the caller like every
 * value here.
 */
export function approvalTranscriptNote({ tool, fingerprint, target }, outcome, { execCacheDisabled = false, decider = null } = {}) {
  const targetBits = targetBitsOf(target);
  const subject = `"${oneLine(tool) || 'unknown-tool'}"` + (targetBits ? ` (${targetBits})` : '') + ` [${oneLine(fingerprint) || 'no fingerprint'}]`;
  const by = decider ? `by the appointed night watch (policy: ${oneLine(decider.policy) || 'unrecorded'})` : 'by the operator';
  switch (outcome) {
    case 'allowed-once':
      if (decider) {
        return `[compact-approval] Gate decision: ${subject} was allowed ${by} — it answered under grant ${oneLine(decider.basis) || 'a basis the record names'} — ` +
          `nothing was materialized: no cached approval, no new grant; the row's budget paid for this act.`;
      }
      return `[compact-approval] Gate decision: ${subject} was allowed once by the operator — ` +
        (execCacheDisabled
          ? `the exec cache is disabled in this runtime, so the identical operation asks again.`
          : `the identical operation replays without re-asking until the exec-cache entry expires; anything else asks again.`);
    case 'rejected':
      if (decider?.basis === 'lapsed') {
        return `[compact-approval] Gate decision: ${subject} did not run — the night watch's yes answered under a grant that lapsed before the verdict landed; ` +
          `the recorded answerer narrowed it to a rejection rather than run on a dead basis (fail-safe).`;
      }
      return `[compact-approval] Gate decision: ${subject} was denied ${by} — the call did not run.`;
    case 'cancelled':
      return `[compact-approval] Gate decision: ${subject} closed cancelled — no answer arrived; the call did not run (fail-closed).`;
    default:
      return `[compact-approval] Gate decision: ${subject} closed ${outcome ?? 'unavailable'} — no answer arrived; the call did not run (fail-closed).`;
  }
}

/**
 * The collapsed-row summary for the decision note: what the web transcript
 * shows WITHOUT expanding (the note's `form: 'notice'` presentation — a
 * producer-declared form upstream's chat renders with its summary on the
 * row). One line, always; the full note text is the expanded body.
 */
export function approvalNoticeSummary({ tool }, outcome, decider = null) {
  const t = oneLine(tool) || 'unknown-tool';
  if (decider) {
    const policy = oneLine(decider.policy) || 'unrecorded';
    if (outcome === 'allowed-once') return `Night watch: "${t}" allowed (${policy}) — under the grant's terms`;
    if (outcome === 'rejected') return `Night watch: "${t}" denied (${policy}) — did not run`;
  }
  switch (outcome) {
    case 'allowed-once': return `Approval: "${t}" allowed once by the operator`;
    case 'rejected': return `Approval: "${t}" denied by the operator — did not run`;
    default: return `Approval: "${t}" closed ${outcome ?? 'unavailable'} — did not run`;
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
 * The decision-time half of the #40 posture: the transcript teaches the
 * Subject AFTER (the decision note, the replay receipt) — this sentence
 * teaches the operator BEFORE, inside the ask itself. Envelope-grade facts:
 * the TTL is the runtime's configured one, the reach is stated plainly
 * (cross-session), and the two exits are named (lapse, revocation).
 */
/**
 * The exec-cache TTL an approval of this act materializes (#65). Normally the
 * runtime's cache TTL; under the mediated posture, an act that materializes
 * an egress grant caches no longer than that grant lives — both are written
 * on the same clock, so the replay and the wire lapse together and the next
 * identical call asks again, which re-materializes the grant.
 */
function cacheTtlFor(approval, args) {
  const ttl = approval.execCacheTtlMs;
  if (ttl === 0 || !egressBound(approval, args)) return ttl;
  return Math.min(ttl, approval.egressGrantTtlMs);
}

/**
 * Does approving this act materialize an egress grant? Exactly the answerer's
 * own condition — proxy + derivable class + a mediator delivery path (#57) +
 * a network target — so the cap and the ask's "no longer than the egress
 * grant" never speak of a grant the answerer will not write.
 */
function egressBound(approval, args) {
  return approval.egress === 'proxy' && args?.methodClass != null && args?.delivery === 'mediator' &&
    egressPatternFor(canonicalTarget(args)) != null;
}

/**
 * The pin offer's resolver (#55 follow-up, slice 2): the same host-side
 * lookup the mediator performs (node:dns, ALL addresses), reduced to address
 * strings. A failed or empty resolution reduces to null — an absence, never
 * an error: the offer fails open, the mediator's check never does.
 */
const defaultResolveHost = (host) => new Promise((resolve) => {
  dnsLookup(host, { all: true }, (error, addresses) => {
    if (error) return resolve(null);
    const list = (Array.isArray(addresses) ? addresses : [{ address: addresses }])
      .map((e) => String(e?.address ?? e));
    resolve(list.length > 0 ? list : null);
  });
});

/**
 * When does a pin offer apply: the option declared, a mediated egress-bound
 * act, and a NAME target — an IP-literal target has nothing to rebind (the
 * dial goes to the literal itself), so offering would be theater.
 */
function pinOfferHost(approval, args) {
  if (!approval.egressPinOffers || !egressBound(approval, args)) return null;
  const host = canonicalTarget(args).host;
  return host && !isIP(host) ? host : null;
}

function replayConsequence(ttlMs, { egressBound: bound = false } = {}) {
  // ttl 0 disables the exec cache entirely (cacheSet returns early): the
  // honest sentence is the opposite of the grant one — approval covers this
  // ask, full stop
  if (ttlMs === 0) {
    return `Approving covers this ask only: the exec cache is disabled in this runtime, so the identical operation asks again.`;
  }
  return `Approving materializes an exec-cache entry: the identical operation replays without re-asking ` +
    `for ${humanTtl(ttlMs)}${bound ? ' (no longer than the egress grant it materializes, so both lapse together)' : ''}, ` +
    `across sessions of this runtime, until it lapses or is revoked — anything else asks again.`;
}

/**
 * #38 phase 1 — envelope honesty at the network act's ask. The gate's
 * "allow" is CONSENT; whether the wire exists is the composition's egress
 * posture, and the ask must not let an operator mistake one for the other
 * (I-8: a declared pathway must deliver — and must not overclaim). 'none':
 * no egress is composed and — because the ask fires only when NO grant layer
 * covered the target — no network grant covers it either, so the command
 * will fail at connect. 'open': egress follows the sandbox's declaration
 * (CF-2 posture), not this approval. Undeclared (standalone plugin): the
 * neutral line — posture unknown, nothing claimed either way.
 */
function egressHonesty(egress) {
  switch (egress) {
    case 'none':
      return `This gate's approval is consent, not connectivity: the composition declares no network egress ` +
        `and no network grant covers this target — the command will fail at connect. ` +
        `A session grant changes this gate's answer, not the container's network.`;
    case 'proxy':
      return `This gate's approval is consent that a mediator can deliver: approving materializes a session-scoped, ` +
        `TTL-bounded, revocable egress grant for this target's host, port and method class, and the mediator outside ` +
        `the container delivers exactly that — a different host, a different method class, an expired or revoked grant ` +
        `is refused at the wire with its reason. The mediator speaks plain HTTP and CONNECT only: an act whose transport ` +
        `it cannot carry (ssh, raw tcp, icmp) records consent but materializes NO usable connectivity, and this ask says ` +
        `so when that is the case. Anything the grant covers can still carry data out: the record keeps ` +
        `what was sent (never scrubbed), and revoking the grant kills the route.`;
    case 'open':
      return `This gate's approval is consent, not connectivity: the composition runs an open network posture ` +
        `(CF-2) — egress follows the sandbox's declaration, not this approval.`;
    default:
      return `This gate's approval is consent, not connectivity: whether the sandbox grants egress is the ` +
        `runtime's posture, not this approval's effect.`;
  }
}

/**
 * Human-honest durations for the surfaces that declare the gate's posture
 * (the ask envelopes, grants-list): whole hours and minutes stay whole, the
 * rest reads in seconds — never a rounded lie.
 */
function humanTtl(ms) {
  return ms === 0 ? 'disabled'
    : ms % 3_600_000 === 0 ? `${ms / 3_600_000}h`
    : ms % 60_000 === 0 ? `${ms / 60_000}min`
    : `${ms / 1_000}s`;
}

/**
 * #107 — the ask's reason, LED BY ITS CAUSE. "Uncovered" is the definition
 * of an ask (evaluate's layer-5 fall-through), not a cause: every ask ever
 * composed opened with the same zero-bit line — `"bash" is not covered by
 * this runtime's grant layers` — while the sentences that discriminated
 * (will-fail-at-connect vs covers-exactly-this-command) sat in the tail.
 * Four identical headlines in a row train the skim-and-press-2 reflex the
 * README opens against, and on denial the Subject reads that same envelope
 * text as the stated reason: formally a rule (AG/uncovered), materially
 * useless to its reader (R-3's doctrine betrayed by its own prose).
 *
 * The builder puts the reason CLASS in the first sentence — the secret
 * agreement, the underivable method class, or the store-side cause the
 * classifier named — and demotes the mechanical restatement behind it,
 * exactly once. Every disclosure the old composer appended after the banner
 * (replay consequence, egress honesty, the #57/#56/#26 notes) stays, now
 * after a lead that differs between asks. The D-7 underivable-class note
 * moves wholesale into its lead (it IS the cause when it fires — repeating
 * it in the tail would stutter).
 *
 * Non-goals (unchanged): the gate's semantics, the fingerprint, the layers,
 * and the envelope shape (gate, ruleId, reason, lawful next moves).
 *
 * #173 amendment — the disclosures, one per line. The cause lead and the
 * demoted restatement stay the first line; every disclosure after them
 * (replay consequence, egress honesty, the #57/#56/#26 notes) rides its own
 * labeled line — `Replay:`, `Connectivity:`, `Delivery:`, `Tunnel:`,
 * `Scope:` — the structure the moves block has always had. Sentences are
 * verbatim; labels are layout. The renderers bold the labels (the card's
 * CSS, the terminal's ANSI-on-TTY); the record carries the lines as
 * emitted. No static prose enters the ask (the 2026-09-25 principle): a
 * label names the row, the row's sentence still does all the talking.
 */
export function askReason({ tool, args, secretRefs = [], cause, approval }) {
  const bits = targetBitsOf(canonicalTarget(args));
  // the query SHAPE rides the target on every operator-facing surface: the
  // names only, never the values (#8 G5). Two asks that render the same
  // `url=…` but differ in their `query(…)` bit are different operations —
  // this bit is how the display says so instead of leaving the operator
  // staring at identical-looking rows.
  const shape = queryShape(args?.url);
  const shapeText = shape?.length ? ` query(${shape.map(oneLine).join(', ')})` : '';
  const targetText = bits ? bits + shapeText : 'this target';
  // the rephrase refinement (#8 G5): when a cached approval for the same
  // target is why this act asks, the operator is told WHAT differs — names
  // added/dropped, or the same names twice, which means the values differ
  const queryDiff = cause?.kind === 'rephrase'
    ? queryDiffSentence(cause.priorQuery ?? [], shape ?? [])
    : '';
  const underivable = approval.egress === 'proxy' && Object.hasOwn(args ?? {}, 'methodClass') && args.methodClass == null;
  // the D-7 cause sentence, shared by its lead and the combined case below
  const d7 = `"${tool}" needs the network but its method class is not statically derivable — approval covers exactly this command ` +
    `and materializes NO egress grant (D-7): the mediator refuses its connections by name.`;
  let lead;
  if (secretRefs.length) {
    // the injection agreement is the highest-stakes consequence an approval
    // can carry — its disclosure is the lead, not a clause behind a banner
    // (same sentence the targetless path leads with, one doctrine both ways)
    lead = `"${tool}" references declared secret${secretRefs.length > 1 ? 's' : ''} ${secretRefs.map(r => '$' + r).join(', ')}; ` +
      `approving it materializes the injection grant — session-scoped, TTL-bounded, revocable (grants-revoke) — and the credential is available to this command inside the ` +
      `confined execution — it never enters this conversation, but the command may print it: the record keeps what it prints.` +
      (bits ? ` Target: ${bits}.` : '');
    // a secret act under the mediated posture can ALSO be the underivable
    // class: what approving writes (injection) AND what it cannot deliver
    // (no egress grant) are both decision-grade — neither drops (the proxy
    // honesty paragraph below otherwise overclaims alone)
    if (underivable) lead += ` ${d7}`;
  } else if (underivable) {
    lead = d7;
  } else {
    const iso = (ts) => { try { return new Date(ts).toISOString(); } catch { return 'an unrecorded time'; } };
    const g = cause?.grant;
    switch (cause?.kind) {
      case 'revoked':
        lead = `The grant covering ${targetText} (${g.id}) was revoked. Approving re-asks for consent.`; break;
      case 'expired':
        lead = `Your earlier grant for ${targetText} (${g.id}) expired ${iso(g.expiresAt)}. Approving re-arms coverage.`; break;
      case 'spent':
        lead = `Your earlier grant for ${targetText} (${g.id}) spent its budget (${g.uses}/${g.maxUses} uses). Approving re-arms coverage.`; break;
      case 'params-edge': {
        // #176 slice 1: the row under test, its axis, this act's query, the
        // refused names — the decision context a membership decider would be
        // handed (#176 slice 2), named by the Enforcer here. Names only,
        // never values (G5); the credential floor is stated where it bites.
        const axisText = cause.allowed != null
          ? `its query axis admits exactly (${cause.allowed.join(', ')})`
          : `its query axis is fixed — the bare target only, any query asks`;
        const refusedText = cause.refused.length < cause.current.length
          ? ` this act's query carries (${cause.current.join(', ')}), refused: (${cause.refused.join(', ')})`
          : ` everything this act's query carries is refused (${cause.refused.join(', ')})`;
        const floor = cause.credential.length
          ? ` Credential-shaped parameters (${cause.credential.join(', ')}) never widen — no axis admits them, by offer, by command, or by any later judgment.`
          : '';
        lead = `Your grant (${g.id}) covers this route, but ${axisText} —${refusedText}. The act asks anew.` + floor;
        break;
      }
      case 'classless-grant':
        lead = `A live grant for ${targetText} (${g.id}) carries no method class, and the mediator refuses classless rows by name — ` +
          `this classed act asks. Approving materializes a classed grant the wire can deliver (D-7).`; break;
      case 'rephrase':
        lead = `${targetText} was approved before, but only as the exact phrasing approved` +
          `${cause.lapsed ? ' — and that approval has lapsed' : ''} — this differently-shaped act on the ` +
          `same target asks anew (#26).${queryDiff ? ` ${queryDiff}` : ''}`; break;
      default:
        lead = `First touch: nothing has ever covered ${targetText} in this runtime — no grant row, no cached approval. ` +
          `Approving materializes scoped, expiring coverage (the terms follow).`;
    }
  }
  // demoted, exactly once: the mechanical restatement of the verdict is the
  // definition of an ask, kept for the record after the cause that differs
  const restated = `"${tool}" is not covered by this runtime's grant layers.`;
  // #173: each disclosure rides its own LABELED LINE — one consequence, one
  // line, key word first — the same structure the moves block has always
  // had. The sentences are verbatim (every honesty disclosure survives
  // byte-for-byte within its line); the label is layout, not prose, and the
  // renderers bold it (CSS on the web card, ANSI on a TTY terminal) while
  // the record carries the lines as emitted.
  const lines = [
    lead + ' ' + restated,
    `Replay: ${replayConsequence(cacheTtlFor(approval, args), { egressBound: egressBound(approval, args) })}`,
  ];
  // #175: what a PATTERN yes materializes, directly beside the Replay row it
  // qualifies (the exact operation vs the shown pattern). The row is the
  // offer computed for this ask — the deciding surface renders the choice
  // only where it can show the row, and this recorded line is the same
  // offer's terms, so the ask itself carries what a widened yes would mean.
  const widenOffers = patternOffersFor(approval, { args, secretRefs });
  if (widenOffers.length) {
    const terms = widenOffers[0];
    lines.push(`Widen: a pattern answer materializes one of ${widenOffers.map(o => `${o.text} (${o.scope})`).join(', ')} — ` +
      `${terms.methodClass ? `${terms.methodClass} class, ` : ''}for ${humanTtl(terms.ttlMs)} and ${terms.maxUses} uses, revocable (grants-revoke); ` +
      `a deciding surface offers the choice only where it can render the row.`);
  }
  lines.push(`Connectivity: ${egressHonesty(approval.egress)}`);
  if (approval.egress === 'proxy' && Object.hasOwn(args ?? {}, 'delivery') && args.delivery == null) {
    lines.push(`Delivery: This act has no delivery path under the mediated posture — the mediator speaks plain HTTP and CONNECT ` +
      `only (#57), so approving records consent but materializes NO usable connectivity.`);
  }
  if (approval.egress === 'proxy' && args?.delivery === 'mediator' && args?.url == null && args?.port == null) {
    lines.push(`Tunnel: The grant this approval materializes names the host only: it carries plain HTTP, while a tunneled act ` +
      `(CONNECT) to it would be refused at the wire — a tunnel opens only where the operator was shown the port (#56).`);
  }
  if (args?.effectClass === null && typeof args?.command === 'string' && args.command) {
    lines.push(`Scope: This command's local effects are not statically provable as read-only, so the approval covers exactly ` +
      `this command — a differently-phrased or differently-tailed command asks again (#26).`);
  }
  return lines.join('\n');
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
  // the pin offer (#55 follow-up, slice 2): under the mediated posture, with
  // the option declared, the ask resolves the target HOST-SIDE — the same
  // resolver the mediator dials from — and the deciding view shows the
  // addresses, so an allowed-once materializes the grant PINNED to exactly
  // what the operator was shown. The resolution rides the ask's critical
  // path only when declared (human-gated decisions are rare and slow); a
  // failed or empty resolution is an ABSENCE, never a refusal — fail-open on
  // the OFFER, never on the CHECK (the mediator's resolve-then-pin still
  // answers at the wire).
  const pinHost = pinOfferHost(approval, rec.args);
  const pinOffer = pinHost ? await approval.resolveHost(pinHost) : null;
  // de-duplicated for the deciding view AND the grant — the operator sees the
  // distinct addresses, never a resolver's stutter
  const pinAddresses = Array.isArray(pinOffer) ? [...new Set(pinOffer.map((a) => String(a)))] : null;
  // #175 — the pattern offers for THIS ask, computed exactly as the ask's
  // Widen line computed them: the deciding view carries them for exactly the
  // decision's duration, and a surface that renders them records the
  // operator's pick on the same view (patternChoice) — the same ack channel
  // the pin offer uses (addressesShown)
  const patternOffers = patternOffersFor(approval, { args: rec.args, secretRefs: rec.secretRefs ?? [] });
  const view = { tool: toolName, callId: req.callId ?? null, fingerprint: rec.fp,
    // #8 G3: the deciding view renders the redacted target (host, path
    // family, command shape) — the operator decides on the same rendering
    // every other surface carries; the userinfo masking set the precedent
    target: redactTarget(canonicalTarget(rec.args)), command: commandPreview(rec.args),
    // the query SHAPE (#8 G5 display): names only — the deciding surface can
    // show what differs from a prior approval of the same target
    query: queryShape(rec.args?.url) ?? undefined,
    ...(patternOffers.length ? { patternOffers } : {}),
    // #176 slice 2 — the decision card: the cause classification reduced to
    // plain fields, published with the view for exactly the decision's
    // duration. The appointed night watch (a downstream answerer) reads THIS
    // — never session history, never the model's memory: the Enforcer
    // assembles what its own ask means (Ri-0.15's seed, now served). Fields
    // beyond `kind` exist where the cause carries them (params-edge: the row
    // under test, the axis, the refused names, the credential floor).
    ...(() => {
      const cause = classifyAskCause(approval.store, {
        target: rec.args, session: rec.session, now: Date.now(), egress: approval.egress,
        hasMethodClass: Object.hasOwn(rec.args ?? {}, 'methodClass'),
      });
      return { cause: {
        kind: cause.kind,
        ...(cause.grant?.id ? { grantId: cause.grant.id } : {}),
        ...(cause.kind === 'params-edge' ? {
          allowed: cause.allowed, current: cause.current,
          refused: cause.refused, credential: cause.credential,
        } : {}),
      } };
    })(),
    // the resolved addresses, when the offer applied — the deciding surface
    // can show WHERE the name pointed when the operator decided. A surface
    // that RENDERS them acknowledges it by setting `addressesShown = true`
    // (the attended prompter does); only then does the materialized grant
    // pin. Consent over the address requires the address was SHOWN — a
    // surface that cannot render the offer (the web card, until the
    // interaction wire carries the view) never pins, fail-safe.
    ...(pinAddresses ? { addresses: pinAddresses } : {}) };
  approval.deciding.set(key, view);
  try {
    let outcome = await next();
    // #176 slice 2 — a DECIDER's verdict, as claimed by a downstream answerer
    // on this view. The seat's discipline, enforced HERE (the recorded
    // answerer owns materialization, so it owns the decider's limits):
    //   - answers under a row's terms or not at all: an allow names the row
    //     whose budget it consumes — minting NOTHING (no cache entry, no new
    //     grant, no injection); a wrong yes is bounded by the terms the
    //     operator chose (TTL, budget, class, revocation);
    //   - a malformed verdict (an allow with no row, or junk on the view) is
    //     narrowed to a rejection, never materialized (D-8: a surface may
    //     claim a verdict, never author coverage);
    //   - a basis that lapsed between ask and verdict narrows the yes to a
    //     rejection — the recorded answerer may always answer NO to a yes it
    //     can no longer honor; the note says so.
    const decider = (view.decider && typeof view.decider === 'object') ? view.decider : null;
    let deciderDecision = null;
    if (decider && outcome === 'allowed-once') {
      const now = Date.now();
      const row = typeof decider.grantId === 'string'
        ? approval.store.sessionGrants.find(g => g.id === decider.grantId) : null;
      const live = !!row && !row.revokedAt && (!row.expiresAt || row.expiresAt > now) &&
        (row.maxUses == null || row.uses < row.maxUses);
      if (live) {
        approval.store.consumeUse(row);
        deciderDecision = { ...decider, basis: row.id };
      } else {
        outcome = 'rejected';
        deciderDecision = { ...decider, basis: 'lapsed' };
      }
    } else if (decider) {
      // a decider rejection/cancellation: attributed, materializes nothing
      deciderDecision = { ...decider, basis: null };
    }
    // #175 — the pattern answer's pick, taken BEFORE materialization so the
    // grant and its note sentence ride the same decision: a deciding surface
    // that rendered the offers records the operator's pick on the view, and
    // the pick must be one of THIS ask's computed offers — a surface may
    // only pick, never author (D-8; a stray or forged choice outside the
    // offers materializes nothing). Unpinned by design: a pattern covers a
    // host whose addresses rotate, and pinning to the ones seen at approval
    // time would strand the grant on the first rotation — the Widen line's
    // stated row is the coverage the operator consented to.
    const patternChoice = view.patternChoice != null && patternOffers.includes(view.patternChoice)
      ? view.patternChoice : null;
    let patternGrant = null;
    // a decider's allow materializes NOTHING of the operator path (its
    // budget consumption happened above) — this block is the operator's yes
    if (outcome === 'allowed-once' && !deciderDecision) {
      // the only native grant: an exec-cache entry — same operation replays
      // without re-asking until the TTL, across sessions of this runtime
      // #65: under the mediated posture the entry lives no longer than the
      // egress grant it rides with — a replay the wire can no longer deliver
      // would be a gate that says yes over a mediator that says 'expired'
      const now = Date.now();
      approval.store.cacheSet(rec.fp, now, cacheTtlFor(approval, rec.args), canonicalTarget(rec.args), queryShape(rec.args?.url));
      // the injection agreement: an approved call that referenced declared
      // secrets materializes one session-scoped grant per ref — TTL-bounded,
      // revocable, covering only this session's confined calls
      for (const ref of rec.secretRefs ?? []) {
        approval.store.addSecretGrant({
          ref, root: rec.root, session: rec.session,
          ttlMs: approval.secretGrantTtlMs, now, fp: rec.fp,
        });
      }
      // #38 phase 3 — under the MEDIATED posture an approval actually
      // delivers: the allowed decision materializes the egress grant the
      // mediator enforces per connection (host/port + method class,
      // session-scoped, TTL'd, revocable — the secret-grant shape over the
      // network family). No derivable method class → NO grant: an
      // unclassifiable act gets no coverage (D-7). No derivable DELIVERY →
      // NO grant either (#57): an act that does not speak the mediator's
      // surface (ssh, raw tcp, icmp — or a transport static analysis could
      // not pin) would otherwise materialize a row the wire can never carry,
      // a pretend coverage — the ask already said so before the operator
      // decided.
      if (egressBound(approval, rec.args)) {
        const pattern = egressPatternFor(canonicalTarget(rec.args));
        if (pattern) {
          approval.store.addSessionGrant({
            pattern, session: rec.session, methodClass: rec.methodClass,
            ttlMs: approval.egressGrantTtlMs, now,
            // the offer the deciding view showed — and only a surface that
            // ACKNOWLEDGED rendering it (addressesShown) pins; the web card
            // never shows the offer today, so a web decision never pins
            // (fail-safe: no shown offer, no pin, pre-#165 behavior)
            addresses: pinAddresses != null && view.addressesShown === true ? pinAddresses : null,
          });
        }
      }
      // the pattern row, on the offer's own terms (shown before the yes):
      // scoped to the asking session's lineage, TTL'd, budgeted, classed
      // when the act was — a grant the operator can enumerate (grants-list)
      // and kill (grants-revoke, which also kills covered cache entries)
      if (patternChoice) {
        patternGrant = approval.store.addSessionGrant({
          pattern: patternChoice.pattern, root: rec.root, session: rec.session,
          ttlMs: patternChoice.ttlMs, maxUses: patternChoice.maxUses,
          methodClass: patternChoice.methodClass, addresses: null, now,
        });
      }
    }
    // #25: the decision's visible trace where the Subject lives — asked and
    // answered, for every outcome, on the browser and terminal paths alike
    // (this wrapper sees both). An agent without inject (test shapes) skips
    // the note; a throwing inject must never take the decision path down.
    // form:'notice' + summary: the web transcript renders the one-line
    // account on the collapsed context row (readable without expanding),
    // the full note as the expanded body — "an approval happened" is visible
    // at a glance, which is the point of a trace.
    if (typeof agent?.inject === 'function') {
      try {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: approvalTranscriptNote(
            { tool: view.tool, fingerprint: view.fingerprint, target: view.target },
            outcome,
            { execCacheDisabled: approval.execCacheTtlMs === 0, decider: deciderDecision },
          ) + (outcome === 'allowed-once' && !deciderDecision && (rec.secretRefs ?? []).length
            ? ` The approved injection grant${rec.secretRefs.length > 1 ? 's are' : ' is'} live for this session ` +
              `(${rec.secretRefs.map(r => '$' + r).join(', ')}), TTL-bounded.`
            : '')
            + (patternGrant
              ? ` The operator's yes also granted ${oneLine(patternText(patternGrant.pattern))} — ${oneLine(patternChoice.scope)} — ` +
                `for ${humanTtl(patternChoice.ttlMs)} and ${patternChoice.maxUses} uses: covered acts run without re-asking until it lapses or is revoked (grants-revoke).`
              : '')
            + (deciderDecision && deciderDecision.basis !== 'lapsed'
              ? ` Motivation: ${oneLine(deciderDecision.motivation ?? 'none recorded')}.`
              : '')
            + (deciderDecision?.basis === 'lapsed'
              ? ' The watch\'s appointment stays: the next edge ask finds it on duty.'
              : '') }],
          source: { kind: 'compact-approval', plugin: 'compact-approval', form: 'notice',
            summary: approvalNoticeSummary(view, outcome, deciderDecision) },
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
    if (config?.egress !== undefined) approval.egress = config.egress === 'none' || config.egress === 'open' || config.egress === 'proxy' ? config.egress : undefined;
    if (config?.egressPinOffers !== undefined) approval.egressPinOffers = config.egressPinOffers === true;
    if (config?.patternGrantTtlMs !== undefined) approval.patternGrantTtlMs = config.patternGrantTtlMs;
    if (config?.patternGrantMaxUses !== undefined) approval.patternGrantMaxUses = config.patternGrantMaxUses;

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
          // #173: the injection disclosure leads, the replay consequence
          // rides its own labeled line — same structure as askReason
          reason: `"${tool}" references declared secret${secretRefs.length > 1 ? 's' : ''} ${secretRefs.map(r => '$' + r).join(', ')}; ` +
            `approving it materializes the injection grant — session-scoped, TTL-bounded, revocable (grants-revoke) — and the credential is available to this command inside the ` +
            `confined execution — it never enters this conversation, but the command may print it: the record keeps what it prints.\n` +
            `Replay: ${replayConsequence(approval.execCacheTtlMs)}`,
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
        return { kind: 'deny', reason: bandReason(env) };
      }
      // pending-approval / dedup-pending → the human gate. Record the ask for
      // the answerer's decision correlation (needs the agent object: the host
      // denies asks without one before any approval dispatch). callId lets the
      // correlation survive concurrent asks for the same tool.
      if (exec?.agent) approval.recordAsk(exec.agent, tool, { fp: v.fingerprint, root, session, args, callId: exec.callId, secretRefs, methodClass: args?.methodClass ?? null });
      report('ask');
      // #107: the ask's reason leads with its CAUSE, not the constant
      // "uncovered" banner (which is every ask's rule and carries zero
      // bits) — the classifier names why THIS ask fired and the builder
      // renders it as the first sentence; a denial surfaces this same text
      // to the Subject, so the cause the agent reads is the real one
      const cause = classifyAskCause(approval.store, {
        target: { ...args }, session, now: Date.now(), egress: approval.egress,
        hasMethodClass: Object.hasOwn(args ?? {}, 'methodClass'),
      });
      const env = buildEnvelope({ gate: 'AG', ruleId: v.ruleId,
        reason: askReason({ tool, args, secretRefs, cause, approval }),
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
  // #8 G3: every rendering rides the redaction, whichever branch builds it —
  // the rendered string is what grants-list prints and what /grants-grant
  // echoes into the recorded command/done. #176: the query axis renders
  // beside the row — names only, never values — so a narrowed row is
  // visible as narrowed everywhere the row is shown.
  const text = (() => {
    switch (pattern.kind) {
      case 'HostAndPort': return `HostAndPort:${pattern.value.host}:${pattern.value.port}`;
      case 'PathPrefix': return `PathPrefix:${pattern.value.path}(${pattern.value.ceiling})`;
      default: return `${pattern.kind}:${pattern.value}`;
    }
  })();
  const axis = pattern.params?.mode === 'allow' ? ` params=allow(${(pattern.params.names ?? []).join(',')})`
    : pattern.params?.mode === 'fixed' ? ' params=fixed'
    : '';
  return redactEmbeddedSecrets(String(text) + axis);
}

function registerGrantCommands(ctx, approval) {
  const live = () => approval.store.sessionGrants.filter(g => !g.revokedAt && (!g.expiresAt || g.expiresAt > Date.now()));
  // #64: secret grants are listed by NAME (never a value) with their id, so
  // the revocation the ask promised is reachable by the operator
  const liveSecrets = () => approval.store.secretGrants.filter(g => !g.revokedAt && g.expiresAt > Date.now());
  // live cache entries only: an expired entry is lazily deleted on its next
  // probe and would read as authority it no longer carries (#40)
  const liveCache = () => [...approval.store.cache.entries()]
    .filter(([, e]) => !e.expiresAt || e.expiresAt > Date.now());
  // the gate declares its own defaults (names only for secret refs — never
  // values): being good by default includes the defaults being inspectable
  const gateLine = `gate: exec-cache ttl=${humanTtl(approval.execCacheTtlMs)}, flood cap ${approval.maxPendingPerRoot}/root, ` +
    `pending ttl ${humanTtl(approval.pendingTtlMs)}, secret refs ${approval.secretRefs.length ? approval.secretRefs.map(r => '$' + r).join(', ') : 'none declared (injection ABSENT)'}`;
  ctx.commands?.register({
    name: 'grants-list',
    description: 'compact-dsh: list live approval grants and cached approvals',
    handler: () => {
      const grants = live().map(g => `${g.id}  ${patternText(g.pattern)}${g.methodClass ? ` class=${g.methodClass}` : ''}  root=${g.root ?? '-'} session=${g.session ?? '-'}${g.expiresAt ? ' expires=' + new Date(g.expiresAt).toISOString() : ''}${g.maxUses ? ` uses=${g.uses}/${g.maxUses}` : ''}`);
      const secrets = liveSecrets().map(g => `${g.id}  secret $${g.ref}  session=${g.session ?? '-'} expires=${new Date(g.expiresAt).toISOString()}`);
      const cache = liveCache();
      // #40: the cache is enumerated, not counted — an operator audits what
      // is replayable right now (fingerprint, target, lifetime). Target
      // values are one-line flattened: command output is recorded.
      const lines = cache.slice(0, 50).map(([fp, e]) =>
        `  ${fp}  ${targetBitsOf(e.target) || '(command-aware)'}${e.queryNames?.length ? ` query(${e.queryNames.join(', ')})` : ''}  granted=${new Date(e.grantedAt).toISOString()}${e.expiresAt ? ` expires=${new Date(e.expiresAt).toISOString()}` : ' never'}`);
      const cacheText = `${cache.length} live cached approval(s)` +
        (lines.length ? `:\n${lines.join('\n')}${cache.length > lines.length ? `\n  …and ${cache.length - lines.length} more` : ''}` : '');
      const secretText = secrets.length ? `\n${secrets.length} live secret grant(s):\n${secrets.join('\n')}` : '';
      return { kind: 'success', text: (grants.length
        ? `${grants.length} live grant(s):\n${grants.join('\n')}`
        : 'no live grants') + secretText + `\n${cacheText}\n${gateLine}` };
    },
  });
  ctx.commands?.register({
    name: 'grants-grant',
    description: 'compact-dsh: grant a target pattern for this session — /grants-grant <pattern> [ttlMinutes] [maxUses] [read|write] [params=free|fixed|allow(a,b)]',
    handler: (inv) => {
      // the method class (#66) and the query axis (#176) may sit anywhere
      // after the pattern; the numbers keep their order (ttl, then uses)
      const [pattern, ...rest] = (inv.rawInput ?? '').trim().split(/\s+/).filter(Boolean);
      const methodClass = rest.find(t => t === 'read' || t === 'write') ?? null;
      const paramsToken = rest.find(t => t.startsWith('params='));
      const [ttlMin, uses] = rest.filter(t => t !== 'read' && t !== 'write' && !t.startsWith('params='));
      if (!pattern) return { kind: 'error', text: 'usage: /grants-grant <pattern> [ttlMinutes] [maxUses] [read|write] [params=free|fixed|allow(a,b)] — pattern like api.example.com, *.example.org, host:443, https://host/path/ (a query in the pattern means its parameter NAMES)' };
      let parsed;
      try { parsed = parseAllowlistLikePattern(pattern); } catch (e) { return { kind: 'error', text: String(e?.message ?? e) }; }
      // the explicit params token overrides what a query in the pattern meant
      if (paramsToken != null) {
        const spec = paramsToken.slice('params='.length);
        const allow = /^allow\(([a-z0-9_.,-]*)\)$/i.exec(spec);
        if (spec === 'free') parsed.params = { mode: 'free' };
        else if (spec === 'fixed') parsed.params = { mode: 'fixed' };
        else if (allow) {
          const names = allow[1].split(',').map(s => s.trim()).filter(Boolean).sort();
          if (!names.length) return { kind: 'error', text: `params=allow() admits nothing — name parameters: params=allow(q,page), or params=free for any query` };
          parsed.params = { mode: 'allow', names: [...new Set(names)] };
        } else return { kind: 'error', text: `unknown params axis "${spec}" — params=free | params=fixed | params=allow(a,b)` };
      }
      // under the mediated posture a classless network grant is refused by
      // the mediator ('classless-grant') and would only suppress the ask that
      // materializes a deliverable one — so it is not minted at all
      if (approval.egress === 'proxy' && methodClass == null && NETWORK_PATTERN_KINDS.includes(parsed.kind)) {
        return { kind: 'error', text: `under the mediated egress posture a network grant needs a method class: ` +
          `/grants-grant ${patternText(parsed)} [ttlMinutes] [maxUses] read|write — "write" also covers reads (D-7: no class, no coverage)` };
      }
      const { root, session } = identityOf(inv.agent);
      const ttlMs = ttlMin != null ? Math.max(1, Number(ttlMin)) * 60_000 : 60 * 60_000;
      if (!Number.isFinite(ttlMs)) return { kind: 'error', text: `ttl must be a number of minutes, got "${ttlMin}"` };
      const maxUses = uses != null ? Math.max(1, Math.floor(Number(uses))) : null;
      if (maxUses !== null && !Number.isFinite(maxUses)) return { kind: 'error', text: `maxUses must be a number, got "${uses}"` };
      const g = approval.grantSession({ pattern, root, session, ttlMs, maxUses, methodClass, params: parsed.params });
      // echo the PARSED pattern, never the raw operator input: a token in a
      // URL's userinfo is stripped by canonicalization — echoing the input
      // would leak it into the durable session log (command/done is recorded)
      return { kind: 'success', text: `grant ${g.id} covers ${patternText(g.pattern)}${methodClass ? ` (${methodClass})` : ''} for session ${session} for ${Math.round(ttlMs / 60_000)}min${maxUses ? ` / ${maxUses} uses` : ''}` +
        `${approval.egress === 'none' && NETWORK_PATTERN_KINDS.includes(g.pattern.kind) ? ' — this changes the gate\'s answer, not the container\'s network (no egress is composed)' : ''} (recorded: command/run + command/done)` };
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
      // the re-ask is promised only where it holds: a grant from before #64
      // carries no fingerprint, so its command's cached approval cannot be
      // found — that command may still replay, now without the credential
      if (g.ref) return { kind: 'success', text: `secret grant ${id} ($${g.ref}) revoked — the next confined call carries no injection; ` +
        (g.fp ? 'the approved command asks again'
          : 'this grant predates command tracking, so its command\'s cached approval could not be found: an identical command may still replay, without the credential — see /grants-list for the cached approvals') };
      return { kind: 'success', text: `grant ${id} revoked; covered cached approvals killed` };
    },
  });
}

// module-level apply: the composition shape dsh loads (`name` + `inject` + `apply`)
export const apply = approvalPlugin();
