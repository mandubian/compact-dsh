# compact-dsh

**The Compact on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** —
the plugin composition, annex, and ratification work for the first runtime
jurisdiction of [the Compact](https://github.com/mandubian/compact).

> **Status: Phase 8, slice 3 (the state of exception) — COMPLETE.** The law lives in
> [compact.md](https://github.com/mandubian/compact/blob/main/compact.md)
> (draft v0.5, **not yet ratified** — no standing is claimed, F-5);
> this repository builds the machines that make it real on dsh.
>
> **Phase 0 done — including the composed check:** the allowlist gate runs
> inside the **real dsh `ToolRuntime`** (real Cordis context, real
> pre-execute waterfall): uncovered hosts are denied before execution with
> the Compact envelope; allowed hosts pass through and execute. Verified
> contract from the installed `@deepseek-ai/dsh-tools` types (waterfall
> pass/deny, cordis exports), pin gate, concept pages.
>
> **Phase 1, slices 1–3 done:** the five-layer approval evaluator (exec
> cache → plan grants → session grants → pending dedup → flood cap) rides
> the real `tools/pre-execute` waterfall, and the **full
> deny→ask→approve→replay-hit cycle is composed**: a real dsh
> `ApprovalService` dispatches our ask to the operator answerer chain; on
> `allowed-once` the answerer materializes an exec-cache entry, so the
> identical operation replays without re-asking; the host appends the
> `approval/asked`/`approval/decided` audit pair to a real Session log;
> rejection releases the pending record (no sticky dedup, flood capacity
> returns); `/grants-grant`, `/grants-list`, `/grants-revoke` ride the real
> `CommandRuntime` (auto-logged `command/run`+`command/done` = the causal
> note), and revocation kills the covered exec-cache entries. Grants carry
> **budgets** (`maxUses` — a spent grant stops covering); the store
> **persists** (JSON+fsync, atomic rename; grants/budgets/revocations/cache
> survive a restart, pending asks deliberately do not; a corrupt store file
> fails the boot loudly — never a silent grant reset); fingerprint golden
> vectors pin the canonicalization; an **envelope lint** walks every refusal
> path asserting rule ID + lawful next moves; every refusal is emitted on
> the Cordis bus (`compact-approval/refusal`) as the **LoopGuard cooperation
> seam** — the Phase 3 guard folds it into trip 12 (gate flailing), while
> decision outcomes stay on the host's own `approval/asked`/`approval/decided`
> record (D-7). **Outstanding (not Phase 1 scope):** the full agent-loop
> profile run (needs a model provider key — enforcement is proven at the
> tool-runtime altitude); the guard plugin that consumes the refusal seam
> (Phase 3).
>
> **Phase 2, slice 1 done:** the **docker SandboxProvider** confines every
> call it wraps (per-call container, no-network default, read-only rootfs,
> workspace ro/rw per policy, tmpfs temp area in `workspace-write`), reports
> enforcement honestly (`full` only after the daemon probe confirms the
> backend; unavailability throws `SANDBOX_UNAVAILABLE` — fail closed, never
> passthrough), and over-mounts the sensitive-path deny-list (`.ssh`, `.aws`,
> `~/.netrc`, …) over every bound root. **Mount grants cure on retry**: a
> confined command failing on an unmounted path is cured through the lawful
> channel — `sandbox_request_mount` canonicalizes (realpath), refuses
> protected/missing paths terminally, rides the human gate, and materializes
> a scoped `PathPrefix` grant row (ro ceiling, TTL, revocable, persisted)
> that the provider binds at confine time; revocation un-mounts. Verified
> against the real daemon: confinement matrix, deny-list masking, the full
> denied→request→approve→grant→retry→revoke cycle, ro-ceiling holding.
> One Phase 1 doctrine sharpened in passing: the approval gate now gates
> **identifiable targets only** — a targetless tool call (opaque command
> string) collapses to one fingerprint per tool, and approving it would be
> a hidden blanket grant; opaque strings belong to the remote-access
> analyzer (slice 2).
>
> **Phase 2, slice 2 done — Phase 2 complete:** the **remote-access
> analyzer** statically scans shell args for network-access patterns (URL
> literals, ssh/scp/rsync/nc/telnet remotes, git network subcommands,
> package-manager registry defaults, bare IPs) and routes every finding
> through the Phase 1 grant layers — "this command needs network" is
> approvable **per-host, not per-command** (URL findings carry url+host so
> the exec cache replays per-URL while host-shaped session grants cover the
> whole host). Opaque findings (a network verb with no statically resolvable
> target — `curl $URL`, `git push origin`) fail closed with an envelope
> naming the repair, never asked forever. Golden vectors pin the detection;
> the refusal rides the LoopGuard seam.
>
> **Phase 3 done:** the **LoopGuard** ports all 12 trip conditions as a pure
> trip-state machine (each tested in isolation with synthetic streams):
> accounting rides `tools/pre-execute` (command-aware fingerprints — every
> distinct command is distinct work) and the frozen `tools/result` outcome;
> the Phase 1 **refusal seam feeds gate-flailing (LG-12)** and the host's
> `agent/error` feeds the LLM budget. Behavioral trips latch denials +
> corrective `agent.inject` prose, clear on the inbound user signal (a
> `turn/start` after the latch, read from the session log itself), within a
> repair budget of 3; the deterministic trip (LG-7 WorkflowTerminal) denies
> all with **no auto-resume** — abort-with-explanation, not suspend (the
> documented fidelity loss). The **promotion evidence gate** rejects
> `pass=true` with any error/critical finding or unevidenced warning in the
> waterfall *before the tool body dispatches* — no waiver boolean exists
> (truth table + composed proof). **Response validation** blocks
> success-without-value results and feeds the failure budget.
>
> **Phase 4 done:** the **constitution meta-layer** (`packages/constitution`)
> bundles the adopted Compact body (digest-pinned) and binds the composition
> three ways per F-5: **boot verification** (tampered body or a mismatched
> operator-pinned digest refuses to start), **composition coupling** (every
> enforcement service must exist when the constitution applies — a
> composition missing one REFUSES TO START; the module-level `inject` gives
> that ordering in real dsh loads), and the **rule registry** materialized
> from the enforcement register (register entries citing unknown clauses are
> rogue enforcement, D-8, and refuse the boot). The boot **attestation**
> declares the owed gaps loudly (I-8): unratified draft, pinned-not-signed
> digest (no amendment keys published yet), I-2 chain debt. The
> **enforcement register** is now a full board — 66 entries over all 62
> clauses of the body (22 enforced as of Phase 5, the rest planned or declared
> convention; [O] MEM/FED declared unadopted) — with `verify-register` as a
> CI gate that fails on broken citations, unresolvable enforced entries,
> uncovered clauses, and register/body divergence (A-4). The **offline
> auditor** (`auditor/`) replays session logs and checks the constitution
> invariants without the Enforcer's cooperation (I-7), attesting which
> trust basis it relies on. The declaration `packages/allowlist-gate/src/index.js`
> and every other enforcement plugin now provides a service the constitution
> can couple on.
>
> **Phase 5 done:** the **specialist roster** (`packages/specialists`) — the
> autonoetic specialist bundles as dsh subagent personas on the
> verified `@deepseek-ai/dsh-tool-subagent` contract (the host idiom the
> standard preset uses for per-provider delegation tools): each persona is one
> delegation-tool row carrying its **composed persona prompt** (unique prose +
> canonical sections + the taught output contract + marked phase gates),
> its **deny filter** (the `excluded_tools` port over real dsh tool names —
> a denied tool is invisible AND refuses), and its **depth cap** — leaves 0
> with the spawn tools denied (**no-recursive-spawn is a surface property**),
> leads capped (default 3). Spawning rides the real ToolRuntime: every spawn
> is a recorded tool call naming the persona, the child is session-backed
> with a durable descriptor (MA-1), and the provider enforces the depth cap
> at every start (MA-2) — both now `enforced` in the register, and the
> constitution couples on `compact-specialists` like any enforcement
> service. The **trim-dedup lint** (the #1329–#1331 doctrine as a boot gate)
> fails on verbatim restatement of canonical sections, undocumented dropped
> exclusions, deny-list rot, and unresolved gates — drift is a build failure.
> Because the host contract derives every tool description from the provider
> type (no per-persona description exists), the plugin also registers a
> **roster card** — one line per persona, from the descriptors — as a scoped
> `systemPrompt` section beside the host's delegation guidance, so the parent
> routes by role instead of guessing from tool names.
>>
> **Phase 6 done — Part VI closure + the record.** Five items, all clause-driven:
>
> **CF-2 (supply-chain honesty).** The docker image IS the reused execution
> environment, so the composition was in breach with one config field. Every
> image the provider may run must now carry a **declared, digest-keyed
> acquisition history** — an undeclared image refuses the boot (D-8: the clause
> wakes with the capability), the digest is re-resolved from the daemon at
> every confine (a tag that re-points off its record refuses the confinement),
> and `buildApprovals` is recorded and surfaced but **never consulted to permit
> anything at run time**: an open network posture is answered only by a live
> run-time grant. "Excess is a new gate, not an inheritance" is testable as an
> absence, and it is tested that way. The attestation basis is itself declared
> — an `operator-declared` history produces a declared gap (I-8).
>
> **MA-3 (child-state honesty).** The host's own `subagent/start`/`subagent/end`
> edges are folded into the Enforcer's picture of every delegation (the parent
> recovered from the child's durable session header), and each transition is
> **pushed** to the parent with `agent.inject()` — informed without any polling
> obligation. `SubagentRunEndInfo.lastAssistantMessage` is the child's
> self-report and is read **nowhere**: that omission is the clause, and the
> notice tells the parent which of the two is authoritative (MA-3, D-2).
>
> **MA-4 (consent-scoped address).** On dsh a Member reaches another Subject's
> attention through exactly one surface — a tool call — so `send_message` and
> `interrupt_agent` are gated against the recipient's live consent scopes. The
> delegation edge declares the reciprocal scope (its basis is the MA-1 spawn
> record, not an assumption); unconsented address is denied with an attributed
> envelope naming the refusal as **lawful and unpunished (R-9)**; only the
> **recipient** may narrow or withdraw a scope over its own attention. Widening
> is deliberately unimplemented — no sibling-address channel exists, so it
> could enable nothing lawful.
>
> **SCH-1 (no unsupervised escalation), discharged by declared absence.** The
> new `packages/capability-gate/` is Part VI's own enforcement: every
> capability trigger present in the composition must have a binding service or
> the composition **refuses to start**; a trigger that mounts *later* latches a
> breach that denies every tool call (D-7, because a boot-only check would make
> the clause depend on load order); and once the constitution's rule registry
> exists, every clause of every triggered part must be registered `enforced` —
> a part bound in name only is still a breach. For SCH the lawful posture is
> **absence**, mechanically enforced: `schedule_create` is denied with an
> envelope. The trigger is read narrowly — the clock (`dsh-schedule`), not
> attended background work (`ctx.jobs`) — because over-declaring a trigger is
> its own D-8 problem.
>
> **I-2 / R-7 (the record), pulled forward from Phase 8.** Both are `(core)`
> and both sit in A-2's entrenched set; A-2's own gloss is the argument
> ("non-repudiation without a tamper-evident record is a promise, not a
> right"). `packages/record/` decorates the deployment's `SessionPersistence`
> backend: it commits a hash chain **beside** the log on append (declaring no
> new event vocabulary, D-8) and verifies it on read. Genesis is seeded from
> the **session identity**, so a chain cannot vouch for another Member's
> history — an act cannot be retroactively reattributed by moving its record.
> Links commit **before** the log accepts the event, so a crash can only leave
> a link with no event, never an event with no link. A slice that does not
> verify **rejects** rather than returning unverified history as history.
> Proven against the real JSONL backend with a rewrite applied to the stored
> artifact. The offline auditor now takes `--chain` and verifies integrity
> itself (I-7), instead of attesting that it cannot. **Declared limit:** the
> record is tamper-EVIDENT, not tamper-proof, and its links are unsigned — the
> Compact has published no identity keys, so a signature would attest to a key
> no verifier could check (I-1 debt, declared).
>
> The enforcement register moved with the conduct in the same changes (A-4):
> **Phase 6 total: 28 clauses enforced, up from 22**; Part VI is now fully bound.
>
> **Phase 7 done — the Subject's own knowledge (R-1, R-13).** The Compact's
> amendment process is still in flight, so no identity keys are published.
> Re-derived against that constraint ([decision record](docs/decision-phase7-scope.md)),
> only **I-1** and **A-1** are actually key-blocked; the port plan's capsule
> work is blocked almost entirely *and* answers to no clause, so it is not
> taken. What is unblocked and owed is the governed party's own half of the
> bargain.
>
> **R-1 (self-knowledge).** `packages/self-model/` composes the attestation from
> the Enforcer's own services — capabilities from the capability gate, budgets
> and pending gates from the approval store, lineage from the durable session
> header, the law digest from the constitution, declared gaps from every
> service that owns one — and **never from anything the Subject said** (there
> is a test asserting the Subject's own claim about itself never reaches its
> attestation). Absent facts report `null`, never a plausible value. Standing
> reports `none` **with its reason**, every turn: F-5 makes standing depend on
> a binding annex, and ours is a draft over an unratified law. It is delivered
> at the Subject's own boundary (injected on every `turn/start`, unasked) and
> re-readable via `self_describe`, which reports freshness against a cited
> epoch — "a stale attestation is an alarm, not a truth to act on" is a rule
> about what the Subject may *do*, so the Subject must be able to tell it is
> remembering rather than reading.
>
> **R-13 (inquiry).** The `inquiry` tool answers identity, act and authority
> for another Member from recorded state only, with the delegation chain walked
> to its root and the ultimate Principal named. No prompt, message, argument or
> output is ever read — reasoning is not disclosed (R-10, which R-13 states
> twice). Where the record cannot answer, the answer says so in that field
> rather than inventing one (D-3), and an unknown Member yields a recorded
> "not known to this runtime": a refusal to answer violates D-3/D-7, and
> silence is not an answer.
>
> **This also closed a gap Phase 6 opened.** The MA-3 notice already told a
> parent that the Enforcer's record is authoritative over the child's account,
> and D-2 obliges a Subject to consult its attestation over its recollection —
> while no attestation existed for it to consult. The discipline was taught and
> unavailable.
>
> **Declared limit, not papered over:** the attestation is **unsigned**. It is
> authoritative within this runtime, because it is the Enforcer's own state
> rather than a claim needing external verification, and it proves nothing to
> another jurisdiction. That debt has one home — **I-1 carries it and stays
> `planned`** — and the attestation states `basis: 'unsigned'` with the limit
> among its gaps. **D-2 deliberately stays `convention`:** an Enforcer can
> deliver and teach the attestation, it cannot make a Member consult it.
>
> **Phase 7 total: 30 clauses enforced, up from 28.**
>
> **Phase 8, slice 1 done — termination under law and exit (R-8, R-12).** These
> were owed by machinery already shipped: **MA-1** says a child "is not a
> possession to be exited around: R-12's obligation set binds the child's
> departure exactly as it binds any Member's", and **MA-2** says a parent "may
> not terminate a child except through R-8's lawful reasons" — both enforced
> since Phase 5 while the obligations they invoke were not.
>
> **The asymmetry is the design.** R-8 says termination "does not launder
> obligations"; R-12 says nothing "may make exit economically impossible,
> record-impossible, or punishable". Enforce R-8 by blocking departure until
> the ledger is clean and the obligation has become a toll — exactly what R-12
> forbids. Enforce R-12 by letting anyone leave silently and R-8 means nothing.
> **Recording an unsettled departure honestly satisfies both:** the record is
> the sanction, the door is not locked.
>
> `packages/exit/` gives **five lawful grounds and no escape entry** — an
> `other` entry would make every termination lawful by construction, so there
> isn't one. A ground outside the list, or a disposal with no declaration on
> file at all, is recorded as a violation **by the Enforcer**, not by the
> Subject that happened to be running. The host's `AgentCancelCause` is
> **mapped rather than adopted**: it is a vocabulary about mechanism (who
> called cancel) where R-8 asks about authority (under what ground), so `hook`
> and `disposed` map to nothing rather than guessing. `request_termination` has
> **no denial path at all** — R-8 makes the request unrefusable, so there is no
> branch to reach.
>
> The **obligation ledger is read, not asserted**: pending gates from the
> approval store, in-flight delegations from the MA-3 registry, so a departing
> Member cannot under-report what it owes because it is not asked. Each
> obligation leaves discharged or assumed by a **named** successor — an
> assumption nobody is named for is an orphan wearing the word. A departing
> parent with running children has recorded dependents (D-5: continuity of care
> is an obligation, not a favor).
>
> **Unreadable is not empty.** R-12 counts restitution in the obligation set,
> and adjudication is Part V, which does not exist here — so restitution is
> reported as an *unreadable* ledger line, never as zero, and any unreadable
> line makes the whole ledger `complete: false`. A blind spot is not a clean
> bill. Successor jurisdictions are likewise declared unimplemented (F-6 debt).
>
> **Phase 8 slice 1 total: 32 clauses enforced, up from 30.**
>
> **Phase 8, slice 2 done — petition, contestation, dissent (R-11, I-6, A-5).**
> R-11 is `(core)` and entrenched, and its closing sentence is the argument:
> *"The right to seek change of the law is what makes subjection to it
> legitimate."* A composition that enforces a great deal and can be asked to
> change nothing is not a jurisdiction; it is a cage with good documentation.
>
> `packages/petition/` makes the right non-decorative in four ways. **The
> channel is ungated** — it passes through no approval layer, because a channel
> a gate can close is not a channel and the Member most likely to need it is
> the one currently being refused. **A vacuous answer does not answer**: a
> response missing its rule, reason, motivation or the petitioner's lawful next
> moves is *refused*, not annotated — the petition stays open, its term keeps
> running, and the attempt is recorded, because a duty you can discharge with
> an empty answer is not a duty. **The term runs whether or not anyone looks**:
> `overdue` is derived from the clock, never stored, so it cannot stay `open`
> forever by neglect. **Invitations fire mechanically** off the refusal seam
> already on the bus, with no approval step and no way to decline to notice.
>
> **Distinct instances is the whole signal.** The counter keys on
> (rule, operation): one operation blocked forty times is an agent stuck — the
> LoopGuard's business — while forty different operations blocked by one rule
> is evidence that law and practice have diverged, which is the legislature's.
> Counting raw refusals would conflate them and the loudest signal would always
> be whichever agent looped hardest. A Member's own `flag_collision` counts
> equally: R-11 does not privilege the Enforcer's view of friction.
>
> **Dissent is bound to its decision** (A-5) — stamped with that decision's
> time, author and outcome, requiring reasons, accumulating rather than
> replacing, with no operation that removes one. A decision is never
> overwritten; it is amended by a new petition, so the original stands.
>
> **Three declared gaps:** the invitation threshold is a composition convention,
> **not** the statutory count R-11 names (no statute is enacted, A-7 — calling a
> config value statutory would be the fraud D-8 guards against); contested
> *application* has no forum, since I-6 routes it to Part V which does not exist
> (this is the **petition** door only, which J-5 distinguishes from the appeal
> door); and amendment 0002's three-series collision split is statute-layer
> reference design, **not enacted**, so every collision counts alike here rather
> than being approximated.
>
> **Phase 8 slice 2 total: 35 clauses enforced, up from 32.**
>
> **Phase 8, slice 3 done — the state of exception (A-8), and R-5 with it.**
> The clause opens with the sentence the whole layer defends: *"No emergency
> suspends this Compact generally."* `packages/emergency/` makes a **bounded**
> emergency the only kind declarable — scope, recorded cause and fixed expiry
> are each required, and a declaration missing any one is refused, because an
> emergency without a scope is general, without a cause cannot be reviewed
> against its own justification, and without an expiry is what A-8 calls **rule
> by declaration**.
>
> **The floor is wider than entrenchment.** A-8 protects four rights "even
> temporarily" — exit, refusal, record access, independent verification — and
> **only R-2 is entrenched**; R-9, R-12 and I-7 are ordinary `[M]` clauses. So
> the never-yields set is the union, and a composition treating entrenchment as
> the limit would leave three of the four exposed. Entrenchment itself is
> **derived from the body's own `(core)` markers** rather than restating A-2's
> list, so it cannot drift from the law (F-7). A declaration naming any floor
> clause is refused **whole** — partial admission would let the floor be probed
> a clause at a time.
>
> **Expiry is derived from the clock, never stored** (a state someone must
> remember to clear outlives its term by neglect). **Consecutive and
> overlapping declarations are classified mechanically as renewal** — the
> anti-laundering rule without which a permanent emergency could be held by
> re-declaring at the first-declaration threshold. Every act under a live
> declaration is marked on the record, and marking never blocks the act.
> **There is deliberately no declaration tool on the agent surface**: a Subject
> that could declare its own emergency could suspend what binds it.
>
> **R-5 moves to enforced with it.** An emergency is the one mechanism here
> that narrows a Subject's capabilities mid-operation, and R-5 requires a
> narrowing to be *recorded where the Subject can see it* — so it is surfaced
> in the R-1 attestation the Subject already reads every turn, naming the rule,
> scope, cause, what yields, when it expires, and the floor nothing reaches.
>
> **Two declared gaps:** the mandatory Part V review of expired emergencies has
> no forum (J-8), so the queue is **surfaced rather than drained** — an
> unreviewed emergency must look unreviewed; and the heightened renewal
> threshold is recorded but **not measured**, since no voting or quorum
> substrate exists (A-1, A-7).
>
> **Phase 8 slice 3 total: 37 clauses enforced, up from 35 — the CURRENT total.**

> **The active roster is the basic five** — `architect`, `auditor`, `coder`,
> `debugger`, `researcher` — the personas that earn their keep on dsh today.
> The other thirteen are **archived, not deleted**
> (`personas/archived/`, loader reads top level only): the five Phase 6–7
> personas revive with their artifact/eval substrate, the two leads revive
> when specialist-to-specialist delegation is wanted (the parent session is
> the orchestrator for a flat roster), and the routing-and-judging set —
> discovery, the watchdog pair, outcome-grader, credential-onboarding,
> executor — each carry their reason in
> [personas/archived/README.md](packages/specialists/personas/archived/README.md).
> Rationale: every mounted persona costs the parent a delegation-tool row,
> and rows are description-identical — surface stays where it pays.
> The Phase 1 probe-gate decision (continue) is recorded at
> [docs/decision-phase1-probe-gate.md](docs/decision-phase1-probe-gate.md).
> Counted fidelity losses carried in the concept page: no per-persona write
> scoping (fs policy is host-plane), depth bounded but not breadth, phase
> gates rendered marked rather than enforced by prompt machinery.

## The plan

The full port plan lives at
[`annexes/dsh/plan.md` in the compact repository](https://github.com/mandubian/compact/blob/main/annexes/dsh/plan.md):
eight phases (0–8), 21–30 estimated weeks, five counted fidelity losses, two
recorded capture compositions for round-2 testing.

**Phase 6 was re-scoped from the plan**, and the reasons are recorded at
[docs/decision-phase6-scope.md](docs/decision-phase6-scope.md). The plan's
"Artifacts & layers" was autonoetic's substrate carried in as a port target;
re-derived against the question *which clause fails to be enforced if we do not
build this?*, most of it answers to no clause. The artifact store and layer
machinery are **dropped, not deferred**. What the re-derivation found instead
was that **Part VI was the unfinished business**: three capability triggers
were live in this composition with unbound mandatory clauses, which D-8 calls
the gravest class of violation. Phase 6 closes them, and pulls the entrenched
record (I-2/R-7) forward from Phase 8 because everything already built rests
on it.

This repository hosts the plugin packages and the **dsh annex** — the signed
binding contract (conformance declaration, enforcement register, role
mapping) per Compact F-5. Until the annex is ratified and the floor is
enforced, this composition claims **no Compact standing** (F-5 honesty).

## Layout (Phase 0)

| Path | What |
|---|---|
| `packages/allowlist-gate/` | First plugin: a `tools/pre-execute` deny-by-allowlist gate issuing Compact-shaped denial envelopes (rule ID + lawful next moves, R-3) |
| `packages/approval/` | **Phase 1, slices 1–3**: the five-layer approval evaluator (exec cache → plan grants → session grants → pending dedup → flood cap) with scoped, expiring, budgeted (`maxUses`), revocable grants; the `approval/request` answerer materializes `allowed-once` as exec-cache entries (replay hits); `grants-grant`/`grants-list`/`grants-revoke` commands; JSON+fsync persistence (corrupt store = loud boot failure); revocation kills covered cache entries; fingerprint golden vectors; denial-envelope lint; `PathPrefix` mount-grant patterns; provides the `compact-approval` service; gates identifiable targets only |
| `packages/sandbox-docker/` | **Phase 2, slice 1** + **Phase 6 (CF-2)**: docker `SandboxProvider` (per-call confinement, no-network default, masked-path deny-list, honest enforcement, fail-closed) + `sandbox_request_mount` tool — mount grants (canonical `PathPrefix`, ro ceiling, TTL, revocable) cured through the Phase 1 approval store; **image provenance** (digest-keyed acquisition history, undeclared image refuses the boot, digest re-resolved per confine, build approvals never a run-time entitlement) |
| `packages/remote-access/` | **Phase 2, slice 2**: static network-access analysis of shell args — findings (URL, remote, package-registry, IP) route through the Phase 1 grant layers (approvable per-host); opaque findings fail closed with an envelope |
| `packages/loopguard/` | **Phase 3**: the 12-trip LoopGuard state machine (progress/failure accounting, command-aware fingerprints, refusal-seam + agent/error feeds; behavioral latches with repair budget 3, deterministic deny-all) + response validation (`tools/post-execute` block on invalid results) |
| `packages/promotion/` | **Phase 3**: the promotion evidence gate — `pass=true` mechanically rejected with any error/critical finding or unevidenced warning, enforced in the waterfall before the tool body; no waiver boolean |
| `packages/constitution/` | **Phase 4**: the meta-layer — bundled Compact body (digest-pinned), boot verification, composition coupling (refuse-to-start), the rule registry, the boot attestation with declared gaps, R-6 access to the law |
| `packages/specialists/` | **Phase 5**: the specialist roster — active: the **basic five** (`architect`, `auditor`, `coder`, `debugger`, `researcher`) as dsh subagent personas (one delegation-tool row each: composed persona prompt, deny filter, depth cap) + a roster-card prompt section for parent routing; 13 more personas **archived** in `personas/archived/` (revive = move back); the trim-dedup lint as a boot gate; provides the `compact-specialists` service (MA-1/MA-2) |
| `packages/capability-gate/` | **Phase 6**: Part VI's own enforcement — every capability trigger present in the composition must have a binding service (refuse-to-start; a late trigger latches a breach denying every tool call; clause-granularity check against the constitution's registry), and a capability declared absent is mechanically refused (`schedule_create`, SCH-1) rather than merely intended |
| `packages/emergency/` | **Phase 8**: the state of exception — bounded declarations only (scope, cause, fixed expiry), a floor no declaration reaches (entrenchment derived from the body, plus exit/refusal/record/verification), derived expiry, mechanical renewal classification, every act marked, no declaration tool on the agent surface (A-8); the narrowing surfaced in the attestation (R-5) |
| `packages/petition/` | **Phase 8**: the ungated petition channel, adjudication states with a derived (never stored) term, responses refused unless they carry the I-4 fields plus a motivation, dissent bound to its decision and unremovable (R-11, I-6, A-5), and amendment invitations firing mechanically off the refusal seam at a declared-convention threshold |
| `packages/exit/` | **Phase 8**: termination under law and exit — five lawful grounds with no escape entry, a disposal with no declared ground recorded as a violation by the Enforcer (R-8); the obligation ledger read from the approval store and the MA-3 registry, each line discharged or assumed by a named successor, and departure **never blocked** by what it owes (R-12) |
| `packages/self-model/` | **Phase 7**: the Subject's own knowledge — the per-turn attestation composed from the Enforcer's services (R-1: capabilities, budgets, pending gates, lineage, standing, law digest, declared gaps; unsigned and saying so; staleness as a detectable alarm) and the `inquiry` answer assembled from recorded state, traced to an ultimate Principal, disclosing no reasoning (R-13) |
| `packages/record/` | **Phase 6**: the tamper-evident record — a hash-chain decorator over the session-persistence backend, committing links beside the log on append and verifying them on read; genesis seeded from the session identity so a history cannot be reattributed (I-2, R-7, both entrenched under A-2) |
| `docs/register/register.json` | **Phase 4**: the enforcement register — every clause of the body registered, planned, declared convention, or declared unadopted; `tools/verify-register.mjs` is the CI gate (also `npm run verify-register`) |
| `auditor/` | **Phase 4** + **Phase 6**: the offline verification CLI (I-7) — replays session logs, checks the approval pair discipline, turn enclosure, outcome vocabulary; with `--chain <id>.chain` it verifies the record's integrity itself, without the Enforcer's cooperation; always attests which trust basis it used |
| `packages/envelope/` | Shared Compact denial-envelope builder (R-3/I-4) |
| `annex/annex-draft.md` | The annex draft — conformance declaration, register skeleton, role mapping (F-5) |
| `tools/verify-pin.mjs` | dsh version-range gate: every package pins `@deepseek-ai/dsh` to the audited rc line |
| `docs/concept-*.md` | The concept pages — the implementation-agnostic spec each package cites (approval layers, loop-guard trips, mount grants, promotion evidence, constitution coupling, specialist personas) |
| `docs/decision-phase1-probe-gate.md` | The recorded Phase 1 probe-gate decision (continue the port) — the plan's accountability mechanism, written before Phase 5 |
| `docs/decision-phase6-scope.md` | The recorded Phase 6 re-scope (Part VI closure + the record, not the artifact substrate) — constitutional under A-4, written before the work |
| `docs/decision-phase7-scope.md` | The recorded Phase 7 scope (R-1 + R-13, signature deferred) — what the missing keys actually block, and why an unsigned attestation is delivered rather than withheld |

## dsh version policy — following the release rhythm

All packages pin `@deepseek-ai/dsh` to `~0.1.5-rc.1` (npm `latest` at
adoption; the audited line). `tools/verify-pin.mjs` refuses any other range;
an upgrade is a reviewed, re-blessed event — never silent drift. The pin is
not a wish to stand still, though: upstream is pre-1.0, breaks
compatibility on purpose, and accepts no external PRs, so the real tail
risk is *drift* — waiting so long that the next upgrade becomes a rewrite.
Following the release rhythm is therefore scheduled maintenance, with three
rules:

1. **Review every upstream release — promptly, but without hurry.** Read
   the release notes' plugin-authored-surface list (upstream publishes
   one) and check it against the seams this composition rides
   (`tools/*` waterfall, `approval/request`, `SandboxProvider.confine`,
   the `dsh-tool-subagent` delegation contract, `systemPrompt`, session
   persistence). A release whose new features we do not use and whose
   plugin surface is unchanged costs one line of record and no action —
   the pin holds.
2. **Recon before adopting.** When a release changes a seam we ride, bump
   a scratch checkout to it and run the composed suites first; itemize
   the breakage, then decide — migrate now, or schedule the migration for
   the next beta/rc if the line is still early alpha. A pin never moves
   onto a new line on release day.
3. **A re-blessing is evidence, not an edit.** Moving the pin means the
   full composed suite, `verify-pin`, and `verify-register` pass on the
   new line and the review is recorded (what changed, what it touched,
   what the migration did) — the same discipline as the Phase 1
   probe-gate record. The blessed composition attests exactly what was
   audited (F-5).

**Applied — v0.1.6-alpha.1 (reviewed 2026-09-16, rule 1):** the new
features (browser/computer use, PTC-runtime renames, team mode) do not
concern this composition; **no action taken, the pin holds.** Three
plugin-surface items touch seams we ride and are on file for the 0.1.6
migration: `SandboxProvider.confine` became async + cancellable (our
docker provider implements it synchronously); the synchronous session
history APIs (`eventAt`, …) are deprecated (the loopguard latch reads the
log through `eventAt`); and optional-plugin startup failures no longer
block the boot (the constitution's refuse-to-start coupling must be
re-verified as *required* on the new line). None of the three breaks the
current pin. Recon is scheduled for the 0.1.6 beta/rc — or earlier, if a
release ships something this composition actually needs.

## Try Compact inside dsh

This checkout provides a **headless pilot**, not a ratified jurisdiction or an
interactive approval UI. Node >=22.19 and a working Docker daemon are required.
Use the lockfile to reproduce the tested host dependency set.

```bash
npm ci
docker pull ubuntu:24.04
npm run compact:smoke
npm run compact -- "Use self_describe to report your standing and declared gaps."
```

The last command makes real model requests and requires `DEEPSEEK_API_KEY` in
your environment (configure it outside source control). The default route is
`deepseek-official` / `deepseek-flash`. Smoke boots the real dsh loader and full
Compact composition without calling a model; it does not test provider access.

```bash
npm run compact -- --workspace /absolute/project --state-dir /absolute/private-state "Inspect the project using bash and report what you find."
npm run compact -- --attended "Run: git push https://github.com/owner/repo.git main"
```

`--attended` mounts an operator answerer: gated asks prompt on stderr with
the **actual command, its canonical target, and the fingerprint the decision
would materialize** (default **deny** — empty answer, EOF, or ^C all reject),
and `allowed-once` materializes an exec-cache entry so the identical operation
replays without re-asking. Without it, operations needing a fresh approval
fail closed.

State defaults to `~/.compact-dsh`: session JSONL files under `sessions/`, hash
chains under `chains/`, and persistent grants in `approvals.json`. Keep this
operator-owned directory outside the agent workspace. The launcher isolates
`DSH_HOME` there and disables telemetry; it does not modify your normal dsh
profile or load its patches. `compact.generated.cordis.yml` must remain empty.

The bundle replaces stock persistence with `compact-dsh-record/provider`, so
host session writes actually pass through the chain. It replaces the stock
sandbox with Docker and starts the agent loop only after `compact-ready`.
Startup refuses missing enforcement or required configuration. Image provenance
is explicitly **operator-declared**, not a verified build history.

**Pilot boundaries:**
- Bash executes inside Docker with networking off. Native host file/search,
  jobs, skills, web, workflow and generic delegation tools are disabled;
  use Bash for file work and the five Compact specialists for delegation.
- Unrestricted `danger-full-access` mode is rejected. Plain headless has no
  human answerer: operations needing a new approval fail closed, not
  auto-approve. `--attended` composes the operator gate (see above).
- The allowlist defaults to empty. Allowlisting alone does not enable container
  networking or replace the approval gate.
- Container working directory follows the sandbox policy workspace root;
  use an explicit `cd` inside Bash for subdirectories rather than its workdir option.
- `ubuntu:24.04` is a minimal shell image, not a development environment. Set
  `COMPACT_SANDBOX_IMAGE` to a locally prepared image containing your project's
  tools. The launcher inspects its local `.Id` and never pulls/builds implicitly.
- The no-key loader, confinement and persistence checks are tested; a live
  model-backed task has not been verified here. Keys, Part V adjudication and
  ratified standing remain declared gaps.

## Verify locally

```bash
npm install            # workspace install (no build step in Phase 0)
npm test               # node --test across packages
npm run verify-pin     # dsh pin gate
npm run verify-register  # enforcement register gate (Phase 4)
```
