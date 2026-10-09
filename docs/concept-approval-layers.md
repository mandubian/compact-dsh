# Concept: Layered Approval & Grants

Compact bindings: R-3 (reasons) · I-5 (gates) · D-7 (fail-closed, decisions
from recorded state) · D-8 (no rogue enforcement). Predecessor: approval
system, five dedup layers.

## The concept

Dangerous acts pass through **gates**. A gate is not a single checkpoint but
an **ordered evaluation of grant layers**, checked top-down; the first layer
that answers wins, and every answer is recorded. The layers:

1. **Exec cache (fingerprint-level).** Identical operations grant
   deduplicate. The fingerprint is computed from a *canonicalized* call —
   same operation on the same target is the same call, however phrased.
   Entries carry a TTL (default ~24h, 0 disables). Concrete targets only.
   The entry binds no session: an approval is a decision about an *exact
   operation*, so the identical operation replays across sessions of the
   runtime until the entry lapses or is revoked. "Allow once" names the
   decision, never the grant's consumption.
2. **Plan grants.** An approved plan envelope materializes standing grants
   for the acts it describes.
3. **Session grants (target-level).** Scoped grants with pattern targets —
   `ExactHost`, `HostSuffix`, `HostAndPort`, `UrlPrefix` — at a scope
   (root/session), with optional expiry, revocable at any time.
4. **Existing approvals.** An already-approved, still-pending request
   deduplicates instead of re-asking.
5. **Flood cap.** Unanswered pending requests per root are capped
   (default ~50); over-cap requests are rejected loudly, not queued
   silently.

## The pattern answer at the door (#175)

Widening coverage is a grant's explicit act — never a side effect of one
exact approval (G5: the query joins replay identity). But the door itself
can OFFER the act. When a network ask fires, the gate computes the pattern
rows a widened yes would materialize — the URL's directory prefix and the
host root (`UrlPrefix`), or `ExactHost`/`HostAndPort` for host-arg targets —
and the ask carries them on a labeled `Widen:` line; a deciding surface
that can render the row may offer it as a numbered choice. The pick may
only come from the computed offers: a surface picks, never authors, and
the materialized row carries exactly the terms shown — session-scoped,
TTL'd (default 1h), budgeted (default 50 uses: a pattern covers unseen
future calls, so scope breadth is proportional to grant breadth), classed
when the act was, revocable, and unpinned (a pattern covers a host whose
addresses rotate; pinning to the addresses seen at approval time would
strand the grant on the first rotation). Three disciplines withhold the
offer: a secret-referencing ask (the injection agreement keeps its per-ask
gate), an unprovable command (command-scoped identity stands — a pattern
row would collapse the compound-rider closure), and, under the mediated
posture, an underivable method class (no class, no coverage).
`/grants-grant` remains the author-your-own-terms surface.

## The query axis (#176, slice 1)

A `UrlPrefix` row may bind the QUERY dimension of its coverage —
**the query axis**, stored on the row as `params`, names only and never
values (values live only inside the one-way fingerprint, G3/G5):

- `{ mode: 'free' }` — any query, stated explicitly (what a #175 free
  answer materializes);
- `{ mode: 'allow', names: [...] }` — queries whose parameter NAMES are a
  subset of the axis; a query-less call is trivially within;
- `{ mode: 'fixed' }` — the bare target only: any query asks;
- absent — the legacy free row: every pre-axis persisted grant keeps its
  semantics exactly (no migration, no mass re-ask).

The door offers the axis before the operator must name it: a query-bearing
URL's narrowest offer is the path-directory prefix bound to an allow axis
over exactly the names the act carries — the same path, different VALUES,
no new ask. The **credential floor**: a credential-shaped NAME (the
redaction catalogue's own family — key, token, secret, password, sig;
substring semantics, as there, so over-flagging only ever refuses to
widen) never joins an offered axis. The operator may still type one into
`/grants-grant` (they saw it in the ask's query shape) — the floor binds
the offers and every widening path after them.

An act that falls outside a live row's axis asks with the edge **named**:
the row under test, what its axis admits, what the act carries, which of
the refused names are credential-shaped, and the floor sentence — *no axis
admits them, by offer, by command, or by any later judgment*. This
classification (`params-edge`, history-first: a revoked narrow row is
revoked news, not axis news) is the **decision context** the appointed
decider of #176's second slice will be handed — the membership question is
always "is this call within the row's declared axis?", and the Enforcer,
not the decider, assembles what that question means.

## The night watch's office (#176, slice 2a)

The seat before the judge. An unattended run stops at the first edge ask —
nobody is at the door. The **appointment** (`--decider POLICY` /
`COMPACT_DECIDER`) composes a downstream answerer at launch that answers
ONLY params-edge asks — the narrowest remit that exists; every other ask
falls through exactly as before. It sits downstream of every human surface,
so in attended mode the operator answers first and the watch never fires:
it is the decider of the empty chair. Slice 2a's member is a **policy,
not a judge** — `escalate` (default: answer nothing, report everything),
`deny` (refuse every edge, reason named), `allow-edges` (admit
non-credential edges). The **credential floor binds the watch**: no policy
admits a credential-shaped refused name — the floor's own sentence ends
"by any later judgment".

The **reporting contract** is the deliverable the seat exists for — the
part the retired autonoetic gateway got right (O-1: an external-action
approval without a recorded reason is a violation, not a style choice) and
the DeepSeek auto-review plugin got exactly backwards (its decisions
persisted nothing). Every watch verdict is claimed on the deciding view
(`view.decider`: policy, motivation, grant id); the recorded answerer —
which owns materialization — enforces the seat's limits and writes the
attributed, motivated note on the chained record:

- **mint-nothing**: a watch allow consumes the named row's budget and
  materializes nothing — no cached approval, no new grant, no injection; a
  wrong yes is bounded by the terms the operator chose (TTL, budget,
  class, revocation);
- **narrowing**: a verdict whose basis lapsed between ask and answer is
  narrowed to a rejection — the answerer may always answer NO to a yes it
  cannot honor; a malformed claim (an allow with no row) is narrowed the
  same way, never run as an operator yes (D-8: a surface claims verdicts,
  it never authors coverage);
- **attribution**: the note says who ("the appointed night watch (policy:
  …)"), under what (the grant), and why (the motivation) — one line, on
  the record, where the morning after reads it.

Slice 2b replaces the policy table with a **judgment member** (a model
call behind the same claim/card/verdict/report contract); recusal binds
it — the policy seat has no lineage to recuse from, an agent member does.

## Invariants

- **Order is the semantics.** The same call may match several layers;
  evaluation order decides which grant is consumed and what is recorded.
- **Denials are envelopes.** A refusal carries: acting party, rule, reason,
  lawful next moves. "Denied" without "why" and "what remains" is arbitrary
  authority.
- **Canonicalization is security.** Fingerprint identity depends on the
  canonical form (host lowercase, URL prefix-anchored, ports exact). Weak
  canonicalization = grant confusion.
- **Grants are scoped and expiring.** No blanket grants, no implicit
  escalation: widening requires a new grant through the gate.
- **Scope breadth is proportional to grant breadth.** A pattern grant
  (session, plan) covers unseen future calls, so it binds to a lineage and
  a budget; an exact-operation grant (exec cache) covers one call, so it
  binds to time; identity-bearing power (secret grants) binds to the
  session. Each layer's scope encodes what the operator actually decided.
- **Cross-session validity is earned by cross-session traceability.** A
  replay runs without a new decision, so it leaves a receipt in the
  replaying session — once per session, per fingerprint, per grant
  generation — naming the prior approval it runs under and its expiry;
  live cache entries are enumerable on demand, and revocation kills
  covered entries. A capability whose basis is invisible to the session
  exercising it is undeclared authority.

## Mapping to a runtime (host-agnostic)

The layers are pure decision logic over (call, grants, now) — testable
without any host. The host provides: where the gate hooks (tool-call
interception), where grants persist, and where envelopes are rendered.
On dsh: `tools/pre-execute` waterfall + the grant store (port plan Phase 1).

## The answerer waterfall: the recorded answerer claims, downstream decides

Wherever the decider lives, the record stays complete: compact-approval's
answerer PREPENDS itself upstream of every other `approval/request` listener —
it claims the ask (the deciding view, the LoopGuard refusal seam), delegates
via `next()`, and the verdict that returns is materialized and traced through
the same wrapper, headless and web alike (#24's fix).

The downstream precedence is the pilot contract, pinned by
`packages/approval/test/web-precedence.dsh.test.js` (#19):

- **web, a page connected** — the browser bridge (dsh-api-remotes) holds the
  ask; the page's verdict resolves the chain and the terminal prompt never
  appears. The Subject still sees the verdict as a one-line transcript note:
  a browser decision is a decision, never a silent run.
- **web, no page** — the bridge's dispatch falls through (the real bridge's
  unqueued-dispatch limb) and the terminal operator decides, the same
  answerer headless composes.
- **a denial, from either decider** — materializes nothing and covers
  nothing: the next identical ask re-consults the decider.

The live capture with a model key and a real page (Demo 7) is the UX face of
exactly this contract; the contract itself no longer depends on observing it.
