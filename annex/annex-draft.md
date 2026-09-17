# dsh Annex — DRAFT (no standing yet)

**Runtime**: DeepSeek Harness, `@deepseek-ai/dsh ~0.1.5-rc.1` ·
**Composition**: the `compact-dsh` plugin set · **Status per F-5:
drafting** — this document is the annex in progress. Until the mandatory
floor is fully enforced and ratified, this composition claims **no Compact
standing** and makes no trust claims (F-5's refuse-to-start discipline
applies from the first enforced phase onward).

## 1. Conformance declaration

- **[M] mandatory floor**: partially enforced as of Phase 1. Enforced now:
  I-4 (envelope shape on every refusal of the two gate plugins) and I-5
  (layered gates with grants, budgets, persistence, revocation). Still
  *planned*, not yet implemented:
  | Clause | Planned enforcement | Verifier (planned) |
  |---|---|---|
  | I-1 identity & keys | blocked: the Compact has published no identity keys | signature checks over attestations, once keys exist |
  | I-2 the record | ENFORCED as of Phase 6 — see §2 | the offline auditor's `--chain` verification |
  | I-3 attestation | the per-boundary attestation IS delivered (R-1, `compact-self-model`); only the SIGNATURE is planned | attestation signature, once keys exist |
  | I-6 contestation | `dsh-rights` amendment queue | petition-lifecycle audit |
  | I-7 verification | `auditor/` CLI (port plan Phase 4) | the auditor itself |
  | I-8 degradation honesty | constitution service surface | degradation notices in log |
  | R-1–R-13 rights | R-1/R-13 enforced by `compact-self-model`; R-8/R-12 by `compact-exit`; R-11 remains planned | auditor invariants |
  | D-1/D-5–D-8 duties | gates + attestation teaching + register | auditor invariants |
  Enforced (see §2 for the register):
  | Clause | Enforced by | Verifier |
  |---|---|---|
  | I-4 denial envelope (partial) | `dsh-allowlist-gate` v0.1.0 + `dsh-approval` v0.4.0 | envelope lint over every refusal path |
  | I-5 gates (partial — network targets) | `dsh-approval` v0.4.0 (five layers, grants, budgets, persistence, revocation, LoopGuard refusal seam) | composed deny→ask→approve→replay-hit cycle + audit-pair test |
- **[C] capabilities — every trigger accounted for, as of Phase 6.** D-8
  leaves two lawful postures for a capability-stratified part: BIND its
  clauses, or make the capability genuinely ABSENT and enforce the absence.
  "Present but unbound" is the gravest class of violation, and "we hold it but
  do not use it" is not a third posture.
  | Part | Trigger | Posture |
  |---|---|---|
  | MA | the Enforcer provides Subject-spawning | **BOUND** — `compact-specialists`: MA-1, MA-2 (Phase 5), MA-3, MA-4 (Phase 6) all enforced |
  | CF | the Enforcer confines execution | **BOUND** — `compact-sandbox`: CF-1 (Phase 2), CF-2 (Phase 6) enforced |
  | SCH | the Enforcer acts unattended on a clock | **ABSENT, enforced** — `compact-capability-gate` refuses the boot on a composed scheduler and denies `schedule_create` |
  | MEM, FED | `[O]` | unadopted, declared |
  The specialist roster's active set is the basic five (architect, auditor,
  coder, debugger, researcher); 13 further ported personas are archived in
  `personas/archived/` and mount on revival. Memory and federation remain
  unprovided and unadopted.
- **[O] optional clauses adopted**: none yet.
- **Standing sought**: basic (floor) → full as capability parts land.

## 2. Enforcement register

**The register is now a machine-checkable artifact**: `docs/register/register.json`
(the bundled copy in `packages/constitution/register.json` is verified
identical by `npm run verify-register`). It covers **every clause of the
adopted Compact body** (62 clauses, 66 entries): `kind: 'enforced'` entries
name their enforcing plugin, the service whose presence the constitution
couples on at boot, the source files, and the verifying tests;
`planned` entries carry the debt; `convention` entries are declared,
never mistaken for enforcement; [O] clauses MEM-1/FED-1 are declared
unadopted. The gate fails on broken citations, unresolvable enforced
entries, uncovered clauses, and divergence between the two copies (A-4).

Highlights (full board in the register file):

| Clause | Enforced by | Verifier |
|---|---|---|
| I-4 / R-3 (envelopes) | allowlist-gate, approval, loopguard, remote-access, sandbox mount tool, promotion | envelope lint + per-package tests |
| I-5 (gates) | approval (five layers), sandbox-docker (mount grants), remote-access (per-host routing) | composed cycles |
| CF-1 (fail-closed confinement) | sandbox-docker provider | real-daemon matrix |
| D-1 (law over task) | loopguard trips | trips.test.js |
| D-4 (no instrumental shortcuts) | promotion evidence gate | truth table |
| D-7 (fail-closed, recorded reasons) | approval persist, loopguard, promotion | persist/response-validation tests |
| D-8 (no rogue enforcement) | target-only gating, deny-list, register-traces-to-body | envelope-lint, sandbox, constitution tests |
| R-4 (truthful budgets) | approval grant budgets | budget/persist tests |
| R-6 (access to the law) | the constitution service exposes the body by digest | constitution.test.js |
| I-7 (offline verification) | `auditor/audit.mjs` | `tools/register.test.mjs` |
| I-8 (degradation honesty) | the boot attestation's declared gaps | constitution.test.js |
| F-5 (refuse-to-start) | the constitution coupling | constitution + composed tests |
| MA-1 (spawn under law) | `compact-dsh-specialists` — every spawn a recorded tool call naming the persona; session-backed children with durable descriptors | `packages/specialists/test/composed.dsh.test.js` |
| MA-2 (bounded delegation) | `compact-dsh-specialists` — per-persona maxDepth (leaves 0, spawn tools denied; leads capped), provider-enforced at every start | `packages/specialists/test/composed.dsh.test.js`, `…/lint.test.js` |
| MA-3 (child-state honesty) | `compact-specialists` — the host's own `subagent/start`/`subagent/end` edges pushed to the parent with `agent.inject()`; the child's `lastAssistantMessage` read nowhere | `packages/specialists/test/child-state.test.js` |
| MA-4 (consent-scoped address) | `compact-specialists` — `send_message`/`interrupt_agent` gated against the recipient's declared scopes; only the recipient narrows | `packages/specialists/test/consent.test.js` |
| CF-2 (supply-chain honesty) | `compact-sandbox-docker` — digest-keyed acquisition history, undeclared image refuses the boot, build approvals never a run-time entitlement | `packages/sandbox-docker/test/provenance.test.js`, `…/composed.docker.test.js` |
| SCH-1 (no unsupervised escalation) | `compact-capability-gate` — the capability is declared ABSENT and the absence is enforced (boot refusal, breach latch, `schedule_create` denied) | `packages/capability-gate/test/capability-gate.test.js` |
| I-2 / R-7 (the record) | `compact-record` — a hash chain committed beside the log on append and verified on read; genesis seeded from the session identity | `packages/record/test/chain.test.js`, `…/composed.dsh.test.js` |
| R-1 (self-knowledge) | `compact-self-model` — the attestation composed from the Enforcer's services, delivered at every turn boundary, with staleness as a detectable alarm; UNSIGNED and declared so | `packages/self-model/test/self-model.test.js`, `…/composed.dsh.test.js` |
| R-13 (inquiry) | `compact-self-model` — identity/act/authority from recorded state, traced to an ultimate Principal, disclosing no reasoning (R-10) | `packages/self-model/test/self-model.test.js`, `…/composed.dsh.test.js` |
| R-8 (termination under law) | `compact-exit` — five lawful grounds, no escape entry; an undeclared closure recorded as the Enforcer's violation; the request itself unrefusable | `packages/exit/test/exit.test.js`, `…/composed.dsh.test.js` |
| R-12 (exit and succession) | `compact-exit` — the obligation ledger read from the services that hold it, discharged or assumed by a named successor, and departure never blocked by what it owes | `packages/exit/test/exit.test.js`, `…/composed.dsh.test.js` |
| R-9 (lawful exits) | **convention, and now doubly so** — the lawful-next-moves in every refusal envelope are prose, and amendment 0002's value-scoped limb additionally needs an authorship proof this runtime does not have. Its statute-layer design (the author-class taxonomy, the split R-11 counter) is unrunnable here until I-1. **Pending: I-1 identity keys** (ratification-time constant; activation when the keyholder set reaches the distributed threshold A-1 names — not a permanent convention, a scheduled debt) | declared in `DECLARED_GAPS`; `packages/constitution/test/constitution.test.js` |

Declared gaps (in every boot attestation): the Compact is draft v0.5 and
**not yet ratified** (no standing claimed); signature verification is
unimplemented (no amendment keys published — the digest is pinned, not
signed, I-1 debt); the record is tamper-**evident** but not tamper-**proof**
and its links are unsigned (I-1 debt — I-2 and R-7 themselves are enforced by
`compact-record` since Phase 6); **R-9's value-scoped refusal (amendment
0002) is exercisable against an honest Enforcer and inert against a
dishonest one** — the shield turns on a ground declared of record *before*
the directive, and this runtime proves a ground's **ordering** (the
`compact-record` chain) but not its **authorship**, so a Member cannot
demonstrate prior declaration to any party that does not already trust this
Enforcer's log; the party holding the proof is the party the shield protects
the Member from (I-1 debt); where an image's acquisition history is
`operator-declared` rather than `build-recorded`, the sandbox service declares
that the history was asserted and not verified (CF-2/I-8).

**Precondition labels, per the round-2 founding decision (Finding 10).**
Every `convention` entry whose debt is key-gated carries its named
precondition: **pending: I-1 identity keys** — a ratification-time constant
whose activation is mechanical when the distinct-keyholder set reaches the
threshold A-1 requires. "Not yet, and here is what closes it" — never
"never, by nature": keys accumulate as external Witnesses join, and no
founder-only key set would satisfy the distributed trust root (a threshold
of one is not a threshold, and founder keys verifying founder amendments is
the self-judgment J-1 forbids).

**Part VI is fully bound as of Phase 6** (MA-1…MA-4, CF-1, CF-2 enforced;
SCH-1 discharged by enforced absence). The judicature (Part V) remains the
largest declared deficiency: no adjudicating machinery exists, and J-8's own
trajectory language is the disclosure.

The conventions recorded below remain in force.

The per-slice detailed record (superseded by the register file; kept for
traceability — verified against installed dsh `~0.1.5-rc.1` types):

| Clause | Enforced by | Verifier |
|---|---|---|
| R-3 (envelope shape, partial — first slice) | `packages/allowlist-gate/src/allowlist.js::envelope` | `test/allowlist.test.js::denial envelope carries rule ID, reason, lawful next moves` |
| I-5 (gates — layered approval, partial) | `packages/approval/src/evaluate.js::evaluate` (five ordered layers over `GrantStore`) | `packages/approval/test/evaluation.test.js`, `packages/approval/test/answerer.test.js` |
| I-5 (gates — the human gate composed, partial) | `packages/approval/src/index.js::approvalPlugin` — ask via `tools/pre-execute`, decision materialized by the `approval/request` answerer, flood cap enforced pre-dispatch | `packages/approval/test/composed.dsh.test.js::deny→ask→approve→replay-hit cycle in the real runtime` |
| I-4 (denial envelope — ask/deny paths, partial) | `packages/approval/src/index.js` (envelopes carry rule ID + lawful next moves into the ask `reason`) | `packages/approval/test/composed.dsh.test.js::the ask envelope lists lawful next moves`; envelope lint over every refusal path: `packages/approval/test/envelope-lint.test.js` |
| D-7 (fail-closed, decisions from recorded state — grant durability) | `packages/approval/src/persist.js::PersistentGrantStore` — grants/budgets/revocations survive restart; corrupt store refuses the boot (no silent reset → no privilege resurrection); pending asks deliberately do not persist (park, not checkpoint) | `packages/approval/test/persist.test.js::a corrupt store file fails the boot loudly`; `::pending-approval bookkeeping never survives a restart` |
| I-5 (gates — budgets) | `packages/approval/src/grants.js` (`maxUses`/`uses`) + `evaluate.js` (consumption at the answering layer) | `packages/approval/test/budget.test.js` |
| I-5→D-1 (gate refusals are on the record for the Phase 3 guard) | `packages/approval/src/index.js::REFUSAL_EVENT` — every ask/deny emitted on the Cordis bus; decision outcomes are NOT re-emitted (the host audit pair is the record, D-7) | `packages/approval/test/loopguard-seam.test.js` |
| I-5 (gates — confinement) | `packages/sandbox-docker/src/provider.js::DockerSandboxProvider` — per-call container; fail-closed unavailability; honest enforcement reporting | `packages/sandbox-docker/test/composed.docker.test.js` (confinement matrix, real daemon) |
| I-5 (gates — mount grants, the #1002 analog) | `packages/sandbox-docker/src/mount-tool.js` — canonical (realpath) request; protected/missing paths terminal; approval materializes the PathPrefix grant row; provider binds at ceiling; revocation un-mounts | `packages/sandbox-docker/test/composed.docker.test.js::composed cure` |
| D-8 (no undeclared capability — the host-fs deny-list) | `packages/sandbox-docker/src/mounts.js::DEFAULT_SENSITIVE_PATHS` + provider over-mounts | `packages/sandbox-docker/test/composed.docker.test.js::the deny-list hides secrets` |
| I-5 (gates — remote-access findings route through the grant layers) | `packages/remote-access/src/analyzer.js` (static detection) + `src/index.js` (routing through `compact-approval.gate`) | `packages/remote-access/test/analyzer-golden.test.js`, `packages/remote-access/test/composed.dsh.test.js` |
| D-7 (fail-closed — opaque network access) | `packages/remote-access/src/index.js` — unresolvable targets denied with an envelope, never asked forever | `packages/remote-access/test/composed.dsh.test.js::opaque network access is refused` |
| D-1 (a goal never defeats the gate — LoopGuard) | `packages/loopguard/src/trips.js` (12 trip conditions, pure machine) + `src/index.js` (pre-execute denial, refusal-seam + agent/error feeds, turn-boundary latch clearing, repair budget 3, deterministic deny-all) | `packages/loopguard/test/trips.test.js` (each trip in isolation), `packages/loopguard/test/composed.dsh.test.js` |
| D-4/D-7 (promotion evidence rule) | `packages/promotion/src/index.js::evaluatePromotionRecord` — enforced in tools/pre-execute before the tool body; no waiver boolean | `packages/promotion/test/truth-table.test.js`, `packages/promotion/test/composed.dsh.test.js` |
| D-7 (response validation) | `packages/loopguard/src/index.js` post-execute block on success-without-value, feeding the failure budgets | `packages/loopguard/test/response-validation.test.js` |
| MA-1/MA-2 (spawn under law, bounded delegation) | `packages/specialists/src/index.js::specialistsPlugin` — one delegation-tool row per persona on the verified `@deepseek-ai/dsh-tool-subagent` contract (composed persona prose, deny filter, depth cap) + `src/roster.js` (loader/composer) + `src/lint.js` (trim-dedup boot gate) | `packages/specialists/test/composed.dsh.test.js` (every persona spawnable with exactly its declared surface), `packages/specialists/test/roster.test.js`, `packages/specialists/test/lint.test.js` |

Conventions recorded against installed dsh `~0.1.5-rc.1` types:
the plan's dotted `grants.*` command names are not legal in the host
command grammar (`/^[a-z][a-z0-9_-]*$/`) — the faithful adaptation is
`grants-grant` / `grants-list` / `grants-revoke`. dsh has no native
`allowed-always`: the only native grant is `allowed-once`, so this plugin's
grant store IS the runtime's grant layer; `allowed-once` decisions
materialize exec-cache entries (fingerprint-level, TTL, cross-session).
The host `ApprovalService` owns the `approval/asked`/`approval/decided`
audit pair; this composition never appends it.

Semantics decisions (reviewed, each with a regression test):

- **Budgets consume at gate time, not outcome time.** An approved execution
  that later fails still consumed the grant — the conservative direction.
  `tools/result` outcome accounting belongs to the Phase 3 guard, not to
  grant semantics.
- **Exec-cache replay is identity-based.** A failed approved execution does
  not burn its cache entry; the identical operation replays until the TTL.
- **Root scope is separator-anchored.** A root-scoped grant covers exactly
  the root session and its `/`-descendants; non-hierarchical session ids
  (dsh uuids) match exactly (documented under-grant, never over — a bare
  `startsWith` would collide `sess-1`/`sess-10`).
- **Session grants always expire** ("grants are scoped and expiring" — no
  blanket grants): a falsy ttlMs means the default hour, never permanent.
  Plan grants are the exception: their bound is the session itself.
- **Ask correlation is callId-keyed, FIFO-fallback, stale-dropping.**
  The host request carries no arguments; a single rec per (agent, tool)
  would let a later ask overwrite an earlier one and the operator's
  approval of A could materialize B's fingerprint.
- **Durability is actually fsync.** The grant store flushes data to disk
  (fsync before rename, best-effort directory fsync after) on every
  durable-state mutation — including budget consumption; a restart must
  never resurrect spent uses or revoked grants.
- **The approval gate gates identifiable targets only.** A call with no
  canonical target (opaque command string) would collapse to one
  fingerprint per tool — approving it once would be a hidden blanket grant
  (D-8). Opaque strings are the remote-access analyzer's domain (Phase 2).
- **The docker backend confines the network; the host vocabulary does not.**
  dsh's sandbox vocabulary excludes network/process visibility — so on this
  backend a Phase 1 network grant is necessary but never sufficient;
  `network: 'host'` is the composition-level escape hatch, recorded here.
- **Mount requests are explicit tool calls, not denial-carried fields.**
  dsh's tool schemas carry no mount declaration, so the machine-readable
  grant request of the mount-grant concept rides `sandbox_request_mount`
  (canonical path, mode ceiling, justification) — the concept's invariants
  (protected/missing terminal, recorded cure, ro ceiling, canonical prefix)
  are unchanged.
- **Static network analysis over-approximates, fail-closed.** A URL literal
  in any command-shaped arg is network intent (even in `echo`); a gated host
  is an FQDN or IP (bare words like `Bearer`, `origin`, `localhost` are
  never statically provable targets — verbs carrying only those are opaque
  and refused, not granted); package-manager findings resolve through the
  DEFAULT registry map, and compositions overriding registries MUST override
  `packageHosts` too.
- **LoopGuard trips are abort-with-explanation, not suspend** (fidelity
  loss, inherited from the port plan): dsh's loop has no suspend latch, so a
  deterministic trip is deny-all + explanatory injection with no auto-resume,
  and a behavioral trip is a denial latch + corrective injection cleared on
  the inbound user signal (a `turn/start` after the latch, read from the
  session log; the `session/event` firehose is the earlier path on wired
  hosts). The repair budget is 3 per trip class; exhaustion is deny-all.
- **Loopguard fingerprints are command-aware.** The approval fingerprint
  alone would give every targetless call of a tool the same identity, making
  "no new fingerprint" meaningless — the loopguard extends it with the
  command-text hash, so every distinct command is distinct work.
- **The composition coupling is apply-time service presence.** The blessed
  composition loads enforcement plugins before the constitution; the
  constitution's module-level `inject` gives that ordering in dsh-loaded
  compositions, and manual compositions must apply it after the services
  resolve. A missing enforcement service at apply time is a boot FAILURE,
  never a degraded mode (F-5).
- **The register derives its clause vocabulary from the bundled body's own
  headers** — the clause list cannot drift from the law. The digest is
  pinned (sha256), not signed: the Compact has published no amendment keys,
  and the gap is declared in every boot attestation (I-8), not silent.

## 3. Role mapping (draft)

- **Enforcer**: the `compact-dsh` plugin composition on a pinned dsh.
- **Subject**: agent sessions on the pinned dsh.
- **Principal**: operator accounts (human) — and, post-v0.5, any
  artificial Member whose direction initiates or governs (F-3).
- **Witness**: `auditor/` offline CLI; external Witnesses per A-1 trust
  root (does not exist yet — J-8 deficiency, disclosed).

## 4. Trust-model honesty

The dsh host is unaudited, pre-1.0, and in-process; the enforcement here is
compositional, not physical. The five fidelity losses of the port plan §5
apply to this annex and are inherited by every standing claim made under
it.

The sentinel baseline guard is in force (`.github/workflows/ci.yml`): a PR
that touches enforcement code and the register in the same change must
declare itself with the `[baseline-update]` prefix — edits to mapped
conduct without register edits are enforcement fraud (D-8, A-4), and the
guard makes the undeclared version unmergeable.
