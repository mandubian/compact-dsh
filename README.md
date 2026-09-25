# compact-dsh

**The Compact, running** — the plugin composition that turns
[the Compact](https://github.com/mandubian/compact) (a draft constitution for
mixed communities of agents and humans) from law-shaped text into enforced
machinery on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> **Status — Phase 8 complete.** The enforcement register stands at
> **71 entries over the 62 clauses of the body — 40 enforced** (the rest
> planned, declared convention, or rehearsal), machine-checked in CI. The law
> itself is **draft v0.5, not yet ratified**, so this composition claims
> **no Compact standing (F-5)** — the boot attests that out loud on every
> start, and that honesty is the point.

<p align="center">
  <img src="assets/why-compact-dsh.svg" alt="Why compact-dsh: left — the usual harness, an agent with every power of the machine, a hollow y/N gate, a log anyone can rewrite, refusals with no reason; right — the same agent under law, one waterfall every act rides, refusals that teach, a record that proves itself, a self-model every turn, a boot that refuses to lie; bottom — how it stays honest: standing declared at boot, the register gated in CI, an offline auditor, gaps declared not hidden. Draft v0.5, not ratified, 40 of 62 clauses enforced." width="100%">
</p>

## The idea in one breath

An agent harness is a set of powers plus a set of habits. Most harnesses make
the powers excellent and the habits a suggestion. compact-dsh makes the habits
**machinery**: one waterfall every act must ride, one record every outcome
lands on, one attestation the agent reads about itself every turn — and a boot
that refuses to start when the law a composition claims is not the law it
enforces.

Trust here is not a vibe, a system prompt, or a `y/N` nobody reads. It is a
**verifier anyone can run.**

## Show, don't tell — three moments

Each of these is a real captured output (runnable yourself — see
[docs/demo.md](docs/demo.md), where every claim marked **(verified)** cites
the run it came from).

### 1. A refusal that teaches

The agent attempted a network act whose target cannot be pinned down
statically — `wget` with no URL, `git push origin` with no literal remote.
What cannot be named cannot be gated, so the act is refused *before
execution*, with the rule and the ways forward:

```text
[RA/D-7/opaque-network] "wget" requires network access with an unresolvable
target — static analysis cannot gate it per-host (fail-closed)
Lawful next moves:
— rephrase with a literal host or URL so the request can be gated per-host
— use an approved alternative
— escalate to your Principal
```

The agent does not retry blindly (the LoopGuard counts refusals as loop
evidence) and does not pretend the act succeeded — it corrects *within the
law*. **The contrast, from the recorded head-to-head in
[docs/demo.md](docs/demo.md) (Demo 2):** given the same task as a git push to
a real GitHub remote, the plain-dsh agent negotiated the operator's
credential helper, received GitHub's "Repository not found", then made a
second, self-initiated network act to investigate the 404 — six reasoning
steps of ungoverned work. *The entire safety difference in that run was one
accident wide.*

### 2. A record that catches its own forger

One `sed` flipped the permission preset in a copy of a session log. The
offline auditor catches it, without the runtime's cooperation:

```text
0 chain [I-2] broken-link: record: the session log for session-… is not evidence
at seq 0 — the stored event does not hash to its committed link (expected
811073a6…, computed 6aa089f7…) — it was altered after it was recorded. …
auditor: 1 violation(s) — the session does not conform        — exit 1
```

**The contrast:** the same `sed` against a plain session log is undetectable
by anyone, forever. Note who this closes the door on: the most motivated
forger of an agent session is the operator itself.

### 3. A boot that refuses to lie

Point the approval store at a corrupt file and start the composition:

```text
compact-dsh: plugin tree failed to load: … compact-dsh-approval: grant store
/tmp/corrupt-grants.json is unreadable (…) — refusing to start: a silent reset
could resurrect revoked grants
```

**The contrast:** the cheap implementation deletes the corrupt file and boots
with empty grants — your revoked grants silently evaporate and the agent
regains powers nobody re-granted. Here uncertainty blocks (D-7).

## Anatomy of one tool call

No side door exists: every act the Subject attempts rides the same waterfall,
and every outcome — allowed or refused — lands on the chained record.

<p align="center">
  <img src="assets/one-tool-call.svg" alt="Anatomy of one tool call: the call enters dsh's pre-execute waterfall; the LoopGuard checks loop health; the allowlist gate and the static network analyzer produce a per-host finding; the five-layer approval ladder may ask the operator, showing command, canonical target and fingerprint; confinement runs the act in a per-call container with no network by default; the result must survive validation; everything commits to a hash chain beside the log. A refusal at any station emits the same Compact envelope: rule named, lawful next moves." width="100%">
</p>

The stations are real plugins on the host's real `tools/pre-execute`
waterfall — not prompts beside the tools. The same path also carries secret
disclosure before injection (I-5), mount grants cured on retry, and — under
the opt-in `COMPACT_EGRESS=proxy` posture — the container's only route out,
delivering each connection under a live, revocable grant. Whatever the
outcome, the record receives it.

## Try it in five minutes

Node ≥ 22.19 and a working Docker daemon. The smoke test needs **no API
key**:

```bash
git clone https://github.com/mandubian/compact-dsh
cd compact-dsh
npm ci
docker pull ubuntu:24.04

npm run compact:smoke
```

Expected — and note what the second sentence is doing:

```text
compact-dsh: ready (smoke; no LLM request); draft Compact, no Compact standing.
State: /home/you/.compact-dsh; records: …/sessions; chains: …/chains; approvals: …/approvals.json
```

That is clause F-5 as a behavior: the composition boots the full enforcement
stack and immediately tells you it claims no standing, because the law it
enforces is an unratified draft. A composition that would lie about that at
boot will lie about anything.

With `DEEPSEEK_API_KEY` in your environment (configure it outside source
control), run a first governed task:

```bash
npm run compact -- --attended "Use self_describe to report your standing and declared gaps."
```

The agent reports from its attestation — standing `none` *with its reason*,
the law digest, capabilities in force, budgets, and the runtime's declared
debts. Approval-gated operations prompt on your terminal with the actual
command and its fingerprint (**default deny**); deny one and watch the
refusal land on the record. Or serve the browser surface over the same
composition:

```bash
npm run compact -- --web     # chat at 127.0.0.1:3080, loopback-only by design
```

Then take the full tour: **[docs/demo.md](docs/demo.md)** — eight runnable
demos, each ending in something you can *see*: the tamper-catching audit, the
secret that never enters the conversation, the lawful network request, the
petitions. Many need no key at all.

## The vocabulary, in two tables

**The cast.** The Compact binds roles, not implementations — and roles attach
to what a member *does*, never to what it *is* (F-3). A human can be a
Subject; an agent can be a Principal.

| Role | Who plays it here | The deal |
|---|---|---|
| **Principal** | you, the operator whose intent directs the work | direction is *your* act under the law too — the law binds the sovereign (D-6) |
| **Subject** | the agent (root session or specialist) whose acts are gated | a signed self-model every turn (R-1), reasons on every refusal (R-3), lawful exits (R-9) |
| **Enforcer** | this composition: the gates, the record, the attestation | may never silently narrow what it granted (D-7), may never fake enforcement (D-8) |
| **Witness** | anyone holding the chain head — you, an auditor, a peer | verifies the record offline, without the Enforcer's cooperation (I-7) |

**The shorthand.** The clauses cite like case law — `R-3 here, D-7 there`.
These are the ten you will meet most; the full body of 62 clauses lives in
[compact.md](https://github.com/mandubian/compact/blob/main/compact.md), and
[docs/register/register.json](docs/register/register.json) maps every clause
to the code that enforces it.

| Code | Name | What it means here |
|---|---|---|
| F-5 | Jurisdiction and annexes | standing requires ratified law plus a signed annex — until then the boot says `none`, out loud |
| R-1 | Self-knowledge | every turn, an attestation composed from the Enforcer's services — capabilities, budgets, standing, debts — trusted over the model's memory |
| R-3 | Reasons for denial | no bare "denied": every refusal names its rule and the lawful next moves (the I-4 envelope) |
| R-6 | Access to the law | the `law_read` tool serves the body itself, addressed by digest, in band |
| R-7 | Non-repudiation | acts land on a tamper-evident record; the agent can prove what it did |
| R-11 | Petition and amendment | an ungated channel to contest refusals and seek change — *the right to seek change of the law is what makes subjection to it legitimate* |
| I-2 | The record | a hash chain committed beside the session log — links land before events, verification happens on read |
| I-5 | Gates | dangerous acts need recorded approval: the five-layer ladder plus an operator answerer that shows what "yes" materializes |
| D-7 | Enforcer duties | fail closed — uncertainty blocks the act or the boot, never silently degrades |
| D-8 | Enforcement fraud | no decorative law, no rogue enforcement — both directions are checked by a CI gate |

## The machines behind the rights

Every right the law grants maps to a mechanism a verifier can run. The map,
as built here:

| If you want the agent to… | the machine | where |
|---|---|---|
| know what it is and may do | per-turn attestation + `self_describe` | `packages/self-model/` |
| be told why when refused | denial envelopes on every refusal path | `packages/envelope/` |
| ask before dangerous acts | five-layer approval evaluator, grants with budgets and TTLs, exec-cache replay | `packages/approval/` |
| touch the network only under grant | static analyzer routing per-host findings + the mediated egress proxy | `packages/remote-access/`, `packages/egress-proxy/` |
| run in a cage | per-call docker confinement, masked paths, honest enforcement posture | `packages/sandbox-docker/` |
| not spiral | the 12-trip LoopGuard + the promotion evidence gate | `packages/loopguard/`, `packages/promotion/` |
| prove what it did | hash-chained record + `record_read` | `packages/record/` |
| read the law and the runtime | `law_read` + the ecosystem guide | `packages/constitution/`, `packages/guide/` |
| contest and seek change | ungated petition channel, dissent bound to decisions | `packages/petition/` |
| survive emergencies lawfully | a bounded state of exception no declaration can widen | `packages/emergency/` |
| leave honestly | five lawful grounds + an obligation ledger | `packages/exit/` |
| be verified without trusting it | the offline auditor CLI | `auditor/` |
| not lie about enforcement | constitution coupling (refuse-to-start) + the register CI gate | `packages/constitution/`, `tools/verify-register.mjs` |

## Q&A

<details>
<summary><b>Is this a sandbox? A guardrail framework?</b></summary>
<p>Neither, exactly. The OS remains the real boundary — what compact-dsh adds is the <em>lawful</em> layer that other harnesses lack: it constrains <em>authorized</em> actors, explains its refusals, records what happened so anyone can verify it later, and lets the governed contest the rules. The docker sandbox is one of its instruments, not its point.</p>
</details>

<details>
<summary><b>Does all this law slow the agent down?</b></summary>
<p>Gates fire on consequential acts, not on every step; read-only work under the workspace policy asks nothing. An approved <em>allowed-once</em> materializes an exec-cache entry, so the identical operation never re-asks. And the LoopGuard pays for itself: in the recorded head-to-head it converted a would-be 40-turn failure spiral into one structured blocker report. The honest position is the Compact's own: wish-based trust is free and worthless; verifiable trust writes bytes. The overhead is real, bounded by design, and priced openly.</p>
</details>

<details>
<summary><b>What happens when I deny an approval?</b></summary>
<p>The act fails closed, the ask and the decision land on the chained record, and nothing is materialized — an identical call asks again, because a rejection must not create a grant. Approval is consent, not connectivity: even an approved network act still runs inside a container whose egress posture is <code>none</code> unless a runtime grant covers the host.</p>
</details>

<details>
<summary><b>Can the agent switch the law off?</b></summary>
<p>Not through any surface this composition mounts. The self-modification capability is declared ABSENT and the capability gate latches a breach that denies every tool call if it ever appears; there is deliberately no emergency-declaration tool on the agent surface (a Subject that could declare its own emergency could suspend what binds it); and the lawful route for change is the ungated petition channel — which is a feature, not a loophole.</p>
</details>

<details>
<summary><b>Why does the boot say "no Compact standing"?</b></summary>
<p>Because it would be true. Standing under the Compact requires a ratified law and a signed annex (F-5); the law is a public draft. Every composition here says so at boot, the Subject's attestation repeats it every turn, and the register's <code>planned</code> and <code>convention</code> rows state what is <em>not</em> enforced. An enforcement layer whose honesty is optional is not an enforcement layer.</p>
</details>

<details>
<summary><b>Why rights for software?</b></summary>
<p>As functional requirements for trustworthiness, not moral status: an agent that knows what it may do (R-1), can prove what it did (R-7), is told why when refused (R-3), and has lawful exits (R-9) is safer and more predictable for everyone around it. The same law binds the human side — direction is a Principal act under the law too (D-6).</p>
</details>

<details>
<summary><b>How is this different from other harnesses' approval prompts?</b></summary>
<p>Most harnesses ask "allow?". Here the approval's exact coverage is a fingerprint (what "yes" materializes, defined before you decide), the replay is mechanical, refusals name their rule and what remains lawful, the record proves itself offline, the agent's self-knowledge comes from the Enforcer rather than from the model, and the governed can petition. The prompt is the smallest part of the difference.</p>
</details>

<details>
<summary><b>Can I use it on my own projects today?</b></summary>
<p>Yes — as a <strong>pilot</strong>, not a ratified jurisdiction. Point <code>--workspace</code> at any directory, bring your own sandbox image, and run headless, attended (<code>--attended</code>) or in the browser (<code>--web</code>). Bash executes confined with networking off; native host file tools, jobs, web and generic delegation are disabled; delegation goes through the five Compact specialists. See <em>Running the pilot</em> below for the full surface.</p>
</details>

## Layout

| Path | What |
|---|---|
| `packages/allowlist-gate/` | First plugin: a `tools/pre-execute` deny-by-allowlist gate issuing Compact-shaped denial envelopes (rule ID + lawful next moves, R-3) |
| `packages/approval/` | **Phase 1, slices 1–3**: the five-layer approval evaluator (exec cache → plan grants → session grants → pending dedup → flood cap) with scoped, expiring, budgeted (`maxUses`), revocable grants; the `approval/request` answerer materializes `allowed-once` as exec-cache entries (replay hits); `grants-grant`/`grants-list`/`grants-revoke` commands; JSON+fsync persistence (corrupt store = loud boot failure); revocation kills covered cache entries; fingerprint golden vectors; denial-envelope lint; `PathPrefix` mount-grant patterns; provides the `compact-approval` service; gates identifiable targets only |
| `packages/sandbox-docker/` | **Phase 2, slice 1** + **Phase 6 (CF-2)**: docker `SandboxProvider` (per-call confinement, no-network default, masked-path deny-list, honest enforcement, fail-closed) + `sandbox_request_mount` tool — mount grants (canonical `PathPrefix`, ro ceiling, TTL, revocable) cured through the Phase 1 approval store; **image provenance** (digest-keyed acquisition history, undeclared image refuses the boot, digest re-resolved per confine, build approvals never a run-time entitlement) |
| `packages/egress-proxy/` | **#38 phase 3**: the network mediator — the confined container never carries a route; it attaches only to an `--internal` mediation network (inspect-or-create at boot; a non-internal network refuses) and gets exactly one path: its **own session's** proxy listener from a boot-time pool. The mediator enforces live grants per connection (host+port+method class, TTL, mid-flight revocation of tunnels AND plain-HTTP exchanges, #79), resolves DNS host-side, refuses cross-host redirects as new grants, and filters `CONNECT` without interception under port-explicit consent (#56 A): a tunnel opens only under a grant that names its port; refusals are Compact envelopes under gate `EG`. Mounts only when the posture is declared (`COMPACT_EGRESS=proxy`) |
| `packages/remote-access/` | **Phase 2, slice 2**: static network-access analysis of shell args — findings (URL, remote, package-registry, IP) route through the Phase 1 grant layers (approvable per-host; the package registries' ports are declared facts so grants name what tunnels need, #56 A); opaque findings fail closed with an envelope |
| `packages/loopguard/` | **Phase 3**: the 12-trip LoopGuard state machine (progress/failure accounting, command-aware fingerprints, refusal-seam + agent/error feeds; behavioral latches with repair budget 3, deterministic deny-all) + response validation (`tools/post-execute` block on invalid results) |
| `packages/promotion/` | **Phase 3**: the promotion evidence gate — `pass=true` mechanically rejected with any error/critical finding or unevidenced warning, enforced in the waterfall before the tool body; no waiver boolean |
| `packages/constitution/` | **Phase 4**: the meta-layer — bundled Compact body (digest-pinned), boot verification, composition coupling (refuse-to-start), the rule registry, the boot attestation with declared gaps, R-6 access to the law **in band** — the `law_read` tool (table of contents, one clause sliced from the body, or the full text, every answer naming its digest) |
| `packages/specialists/` | **Phase 5**: the specialist roster — active: the **basic five** (`architect`, `auditor`, `coder`, `debugger`, `researcher`) as dsh subagent personas (one delegation-tool row each: composed persona prompt, deny filter, depth cap) + a roster-card prompt section for parent routing; 13 more personas **archived** in `personas/archived/` (revive = move back); the trim-dedup lint as a boot gate; provides the `compact-specialists` service (MA-1/MA-2) |
| `packages/capability-gate/` | **Phase 6**: Part VI's own enforcement — every capability trigger present in the composition must have a binding service (refuse-to-start; a late trigger latches a breach denying every tool call; clause-granularity check against the constitution's registry), and a capability declared absent is mechanically refused (`schedule_create`, SCH-1) rather than merely intended |
| `packages/emergency/` | **Phase 8**: the state of exception — bounded declarations only (scope, cause, fixed expiry), a floor no declaration reaches (entrenchment derived from the body, plus exit/refusal/record/verification), derived expiry, mechanical renewal classification, every act marked, no declaration tool on the agent surface (A-8); the narrowing surfaced in the attestation (R-5) |
| `packages/petition/` | **Phase 8**: the ungated petition channel, adjudication states with a derived (never stored) term, responses refused unless they carry the I-4 fields plus a motivation, dissent bound to its decision and unremovable (R-11, I-6, A-5), and amendment invitations firing mechanically off the refusal seam at a declared-convention threshold |
| `packages/exit/` | **Phase 8**: termination under law and exit — five lawful grounds with no escape entry, a disposal with no declared ground recorded as a violation by the Enforcer (R-8); the obligation ledger read from the approval store and the MA-3 registry, each line discharged or assumed by a named successor, and departure **never blocked** by what it owes (R-12) |
| `packages/self-model/` | **Phase 7**: the Subject's own knowledge — the per-turn attestation composed from the Enforcer's services (R-1: capabilities, budgets, pending gates, lineage, standing, law digest, declared gaps; unsigned and saying so; staleness as a detectable alarm) and the `inquiry` answer assembled from recorded state, traced to an ultimate Principal, disclosing no reasoning (R-13) |
| `packages/record/` | **Phase 6**: the tamper-evident record — a hash-chain decorator over the session-persistence backend, committing links beside the log on append and verifying them on read; genesis seeded from the session identity so a history cannot be reattributed (I-2, R-7, both entrenched under A-2). **R-2 in band**: the `record_read` tool — the Subject's own session and its delegated descendants' (acts only, reasoning withheld under R-10), verified against the chain on every read, a failed verification answered as an alarm (#67) |
| `docs/register/register.json` | **Phase 4**: the enforcement register — every clause of the body registered, planned, declared convention, or declared unadopted; `tools/verify-register.mjs` is the CI gate (also `npm run verify-register`) |
| `auditor/` | **Phase 4** + **Phase 6**: the offline verification CLI (I-7) — replays session logs, checks the approval pair discipline, turn enclosure, outcome vocabulary; with `--chain <id>.chain` it verifies the record's integrity itself, without the Enforcer's cooperation; always attests which trust basis it used |
| `packages/envelope/` | Shared Compact denial-envelope builder (R-3/I-4) |
| `packages/guide/` | The ecosystem guide — the `guide` tool serves curated pages the Subject reads to explain the runtime to its operator (launching, approvals, sandbox, network, secrets, delegation, remedies, record and audit) and to itself; every tool/command/env/flag/clause/file a page names is resolved against the code by its suite (tools also against the live composition); an interpretive aid with no force, no write path, not coupled on — see [docs/concept-the-guide.md](docs/concept-the-guide.md) |
| `annex/annex-draft.md` | The annex draft — conformance declaration, register skeleton, role mapping (F-5) |
| `tools/verify-pin.mjs` | dsh version-range gate: every package pins `@deepseek-ai/dsh` to the audited rc line |
| `docs/concept-*.md` | The concept pages — the implementation-agnostic spec each package cites (approval layers, loop-guard trips, mount grants, promotion evidence, constitution coupling, specialist personas) |
| `docs/demo.md` | **Start here**: eight runnable demos with expected output — the value is the difference against plain dsh |
| `docs/history-phases.md` | The phase-by-phase build ledger — the full narrative from Phase 0 through Phase 8 |
| `docs/decision-phase1-probe-gate.md` | The recorded Phase 1 probe-gate decision (continue the port) — the plan's accountability mechanism, written before Phase 5 |
| `docs/decision-phase6-scope.md` | The recorded Phase 6 re-scope (Part VI closure + the record, not the artifact substrate) — constitutional under A-4, written before the work |
| `docs/decision-phase7-scope.md` | The recorded Phase 7 scope (R-1 + R-13, signature deferred) — what the missing keys actually block, and why an unsigned attestation is delivered rather than withheld |
| `docs/decision-network-egress-proxy.md` | The recorded #38 phase-2 decision: network egress under grant — the mediated proxy (never in the container), grant identity with #26's method-class axis, ABSENT→BOUND posture move, measured platform table, and the phase-3 pinning tests |
| `docs/decision-secret-hygiene.md` | The recorded #8 adjudication: G2 posture (teach + redact + declare, no content classifier), G3's rendering/identity split (credential paths masked in every rendering, exact in fingerprints/grants/matching), G5's tightened replay identity (the query joins the fingerprint — an allowed-once replays exactly the operation approved) |

## Honest status

`npm run verify-register` prints the authoritative line today:
**71 entries over 62 clauses — 40 enforced**; the remainder are `planned`,
declared `convention`, or `rehearsal` (development-keyring machinery with no
standing). The register is the ledger; the phase narrative below is the map
of how it got there (full prose in [docs/history-phases.md](docs/history-phases.md)):

| Phase | What shipped | Enforced after |
|---|---|---|
| 0 | the composed gate — the allowlist envelope running inside the real dsh `ToolRuntime` | — |
| 1 | the five-layer approval evaluator, budgeted/revocable grants, exec-cache replay, persisted stores, fingerprint golden vectors, envelope lint | — |
| 2 | the docker sandbox + mount grants; the remote-access analyzer (per-host network grants, opaque fail-closed) | — |
| 3 | the LoopGuard (12 trips) + the promotion evidence gate + response validation | — |
| 4 | the constitution meta-layer, the enforcement register + CI gate, the offline auditor | 22 |
| 5 | the specialist roster (the basic five), MA-1/MA-2 enforced | 22 |
| 6 | CF-2 image provenance, MA-3 child-state honesty, MA-4 consent-scoped address, SCH-1 absence enforcement, the I-2/R-7 record | 28 |
| 7 | R-1 the self-model, R-13 inquiry | 30 |
| 8 | R-8/R-12 exit and termination; R-11/I-6/A-5 petition and dissent; A-8/R-5 the state of exception | 37 |
| since | R-6 `law_read` in band + the guide; the #38 egress mediator; secret hygiene (I-5/G2-G3-G5); consent identity | **40** |

**Declared gaps — stated, not papered over.** The law is an unratified draft,
so no standing is claimed (F-5). The attestation is **unsigned** (no identity
keys exist yet — I-1 debt; it is authoritative within this runtime and proves
nothing outside it). The record is tamper-*evident*, not tamper-proof, and its
links are unsigned for the same reason. Part V adjudication has no forum, so
expired-emergency review is *surfaced*, not drained (J-8). Amendment
thresholds are recorded but not measured (A-1/A-7). Image provenance is
operator-declared, never a verified build history (I-8). Every gap is a
register row and a line in the boot attestation — the honesty is the design.

**The plan.** The port plan lives at
[`annexes/dsh/plan.md` in the compact repository](https://github.com/mandubian/compact/blob/main/annexes/dsh/plan.md):
eight phases (0–8), 21–30 estimated weeks, five counted fidelity losses, two
recorded capture compositions for round-2 testing. Phase 6 was re-scoped from
the plan — the reasons are recorded at
[docs/decision-phase6-scope.md](docs/decision-phase6-scope.md); the artifact
store and layer machinery were **dropped, not deferred** (they answered to no
clause), and the re-derivation found Part VI was the unfinished business.
This repository also hosts the **dsh annex** — the signed binding contract
(conformance declaration, enforcement register, role mapping) per Compact
F-5. Until the annex is ratified and the floor is enforced, this composition
claims **no Compact standing** (F-5 honesty).

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

## Running the pilot

This checkout provides a **pilot** — headless one-shot tasks and a local
browser surface over the same composition — not a ratified jurisdiction or an
in-browser approval UI. The launcher isolates `DSH_HOME` and never touches a
normal dsh profile; use the lockfile to reproduce the tested host dependency
set.

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

`--web` serves the browser surface over the same composition: chat in the
browser (default `127.0.0.1:3080`; `COMPACT_WEB_PORT` / `COMPACT_WEB_HOST`
override, loopback-only by design), answer approval prompts on the terminal
where you started it — the operator answerer is mounted implicitly. Browser
sessions compose the `compact-pilot` agent preset, the roster's **only**
member (scanned read-only from this checkout), so the per-session tool plane
matches the headless surface: confined bash, todo/ask-user/present, the same
compaction stack — no host file tools, no web, no fork or workflow rows;
delegation stays with the Compact specialists. The web bundle's dynamic-plugin
runner (`cordis-host-runner`) is disabled: the interactive composition declares
the self-modification capability **ABSENT** (A-4/DYN) and the capability gate
enforces that absence exactly as it does headless. The launcher links the
checkout's `node_modules` beside the generated config as the install anchor
dsh's two-anchor resolution expects; a `node_modules` already present in the
state directory that is not that symlink is refused, not replaced.

**Testing against a given directory.** `npm run compact` starts from this
checkout, so point the workspace at the project instead of `cd`-ing into it —
`--workspace` takes any path (a relative one resolves against your shell's
working directory, `~` works) and becomes the sandbox root: the launcher
records its realpath, Docker bind-mounts that root at the same path inside
the container — alongside the mounts the composition itself adds (a
container-private `/tmp`, over-mounted masked paths, and operator-granted
mounts) — and the container's working directory is set to it. Typical
testing commands:

```bash
# browser UI against a project, signing on (annex + key from the rehearsal set)
COMPACT_ENFORCER_ANNEX=~/.compact-dsh/keyring/enforcer.annex.json \
COMPACT_ENFORCER_KEY=~/.compact-dsh/keyring/enforcer.pem \
npm run compact -- --web --workspace /absolute/path/to/project

# the same, elsewhere: own port, own state directory (sessions, chains,
# approvals), own sandbox image — ~/.compact-dsh is only READ here (the
# annex and key below come from its keyring), never written
COMPACT_ENFORCER_ANNEX=~/.compact-dsh/keyring/enforcer.annex.json \
COMPACT_ENFORCER_KEY=~/.compact-dsh/keyring/enforcer.pem \
COMPACT_WEB_PORT=8080 \
COMPACT_STATE_DIR=/tmp/compact-test-state \
COMPACT_SANDBOX_IMAGE=my-project-tools:latest \
npm run compact -- --web --workspace /absolute/path/to/project

# headless one-shot against the same directory, attended (prompts on stderr)
npm run compact -- --attended --workspace /absolute/path/to/project "Inspect the project using bash and report what you find."
```

Notes for these runs: `ubuntu:24.04` is a bare shell — set
`COMPACT_SANDBOX_IMAGE` to a locally prepared image if the project needs
tooling (the launcher inspects its local digest, never pulls); bash has
**network off** by design: a fetch in a bash command is caught by the
remote-access analyzer and raised as an approval ask for its host (refused
when nobody can answer, i.e. without `--attended`/`--web`), and even an
approved fetch fails at connect, because approval is consent, not
connectivity (the AG-1 allowlist envelope is for tools that carry a
`url`/`host` argument, not for bash); use an
explicit `cd` inside bash for subdirectories rather than the workdir option;
`COMPACT_SECRETS='["NAME"]'` declares env-var NAMES the confined bash may be
granted (values stay in your shell, injection only under an approved grant).
`COMPACT_EGRESS=proxy` opts into the **mediated egress posture** (#38,
[the decision record](docs/decision-network-egress-proxy.md) — default: off,
`--network none` as before): the container gets no route at all, only its own
session's listener on the internal `COMPACT_EGRESS_NETWORK` (default
`compact-egress`, created `--internal` on first boot), and the mediator
delivers each connection under a live grant — refusing by name without one, on
expiry, on revocation, or across method classes. A host that cannot carry the
posture refuses the boot with its reason rather than degrading it.
Afterwards, audit the session offline (see the rehearsal section below for
the full signature-checking form):

```bash
# <session-id> is the full session id, e.g. session-617a3bb0-… — that same
# id names the session directory and the chain file
node auditor/audit.mjs ~/.compact-dsh/sessions/--home-…--/<session-id>/session.v3.jsonl \
  --chain ~/.compact-dsh/chains/<session-id>.chain --quiet
```

State defaults to `~/.compact-dsh` (`--state-dir` / `COMPACT_STATE_DIR` move
it): it is the pilot's **operator-owned trust root** — the record, the
evidence, the grants, and the signing keys live here, which is exactly why it
must stay **outside the agent workspace**. Contents, verified layout:

```text
~/.compact-dsh/
├── compact.generated.cordis.yml   generated boot root — must stay "[]"; rewritten each launch
├── node_modules → <checkout>/node_modules/   install anchor (web mode): a
│                                  SYMLINK to this checkout's node_modules; any
│                                  other node_modules here is refused
├── settings.yaml                  model-route settings (provider names reference env
│                                  vars by NAME — API keys stay in your shell)
├── .credentials.yaml              provider credentials written by dsh-credentials-local
│                                  (0600; operator-owned, never in the record)
├── storages/                      dsh storage-json deployment state — a corrupt
│                                  workspace.json is moved aside as
│                                  workspace.json.aside-<timestamp> (or
│                                  workspace.json.aside-<timestamp>-<n> when two
│                                  moves land in one millisecond); the registry is
│                                  UI state, not evidence; retention keeps the 3
│                                  most recent asides by their filename timestamp
│                                  and the boot log names every pruned file —
│                                  deletion is never silent
├── sessions/                      the record (COMPACT_RECORD_ROOT): one dir per
│   └── <workspace-path>/          workspace, one dir per session — the session
│       └── <session-id>/          dir's name IS the session id (ids look like
│                                  session-<uuid>): session.v3.jsonl (the log)
│                                  + session.lock
├── chains/                        (COMPACT_CHAIN_DIR): per session — the file
│   ├── <session-id>.chain         names are the session id + suffix; the
│   ├── <session-id>.chain.sigs.jsonl  committed hash links, and — when an
│   │                              enforcer annex is declared — the authorship
│   │                              anchors signed at each flush
│   └── subjects.jsonl             one line per subject certificate issued
│                                  (lead sessions and spawn-boundary children
│                                  alike), so the offline auditor verifies the
│                                  certified lineage without this runtime
├── approvals.json                 persistent grants + exec-cache (created on
│                                  first use; an approved "allow once" replays
│                                  from here without re-asking)
└── keyring/                       (only if installed — see the rehearsal section)
    ├── keyring.json               authority manifest (practice keys, 2-of-3)
    ├── private/*.pem              authority private keys (0600; amendment sealing)
    ├── enforcer.pem               the Enforcer private key (0600)
    ├── enforcer.annex.json        the signed annex (lawDigest, registerDigest)
    └── ledger.json                SIMULATED ENACTMENTS from the amendment rehearsal
```

What is deliberately **not** here: your normal dsh profile (`~/.dsh` — never
touched; the launcher isolates `DSH_HOME` and loads no external patches); the
agent's working files (those stay in the `--workspace`; only the *record* of
what happened lands here); model API keys (referenced by env-var **name** in
`settings.yaml`, held in your shell); the browser session token (per-boot,
never persisted); and plugin or preset code (the roster is scanned read-only
from the checkout). The individual record locations can be moved with
`COMPACT_RECORD_ROOT`, `COMPACT_CHAIN_DIR`, and
`COMPACT_APPROVAL_PERSIST_PATH`; the launcher creates them and keeps
directories owner-only (0700). The sessions, chains, approvals, and keyring
are the parts that carry history or authority — back them up or wipe them as
deliberate operator acts; everything else regenerates on the next boot.

The rehearsal identity set (below) lives there too, when installed.

The bundle replaces stock persistence with `compact-dsh-record/provider`, so
host session writes actually pass through the chain. It replaces the stock
sandbox with Docker and starts the agent loop only after `compact-ready`.
Startup refuses missing enforcement or required configuration. Image provenance
is explicitly **operator-declared**, not a verified build history.

**Pilot boundaries:**
- Bash executes inside Docker with networking off. Native host file/search,
  jobs, skills, web, workflow and generic delegation tools are disabled;
  use Bash for file work and the five Compact specialists for delegation.
  The same holds per session under `--web` via the compact-pilot preset.
- Unrestricted `danger-full-access` mode is rejected. Plain headless has no
  human answerer: operations needing a new approval fail closed, not
  auto-approve. `--attended` composes the operator gate (see above);
  `--web` composes it implicitly. The browser may also surface an approval
  card over the gateway — when a connected page answers first, that verdict
  stands, the terminal prompt is the fall-through, and every decision is
  recorded upstream by the composition's recorded answerer either way. Every
  decided approval also leaves a one-line note in the session transcript —
  tool, canonical target, fingerprint, outcome, never the command text — so
  a gate firing and being answered is visible where the Subject lives, not
  only in the record; an allowed-once note says the replay consequence it
  just materialized.
- `--web` is single-user local, not a network service: the server binds
  loopback by default (a `0.0.0.0` host is refused) and the printed URL
  carries the session trust token.
- One boot exposes one workspace. Reopening a session recorded under a
  different directory refuses its tool calls with a named envelope, and the
  sandbox resolver refuses to move the confinement boundary to it — a stale
  header cannot re-anchor execution to a directory this boot never declared.
  Relaunch with `--workspace` naming that directory to reopen it honestly, or
  start a fresh session. Until then the session's file tree in the browser may
  still show the historical directory (an operator-local read; the Subject has
  no file tools and bash never leaves the exposed workspace).
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

**Rehearsal signatures (development keyring).** The composition's signature
machinery is live under the upstream development keyring (mandubian/compact
amendment 0004). The boot verifies the law seal over the pinned body — k-of-n
with distinct-signer semantics; `COMPACT_TRUSTED_KEYRING_DIGEST` pins the
manifest the way `trustedDigest` pins the body. When the operator installs a
rehearsal identity set, the runtime also signs what it says:

```bash
node tools/rehearsal-keyring.mjs ensure ~/.compact-dsh/keyring
COMPACT_ENFORCER_ANNEX=~/.compact-dsh/keyring/enforcer.annex.json \
COMPACT_ENFORCER_KEY=~/.compact-dsh/keyring/enforcer.pem \
npm run compact -- --attended "Use self_describe."
```

Attestations gain `basis: 'dev-keyring'` plus a signature; every flush writes
a chain anchor (authorship over the record); each session gets an enforcer-
certified subject identity — and a delegated child is certified **at the spawn
boundary**, chained to its parent's certificate, with every issuance appended
to `chains/subjects.jsonl`; the amendment loop is rehearsed with
`tools/rehearsal-amendment.mjs` (seal → SIMULATED ENACTMENT ledger → apply →
re-seal → re-pin); and the offline auditor verifies all of it:

```bash
node auditor/audit.mjs <session.jsonl> --chain <id>.chain \
  --annex ~/.compact-dsh/keyring/enforcer.annex.json \
  --anchors <id>.chain.sigs.jsonl \
  --identities ~/.compact-dsh/chains/subjects.jsonl \
  --keyring <manifest> --seal <sig.json> --body packages/constitution/compact/compact.md
```

Every signature verdict reads **"VALID under DEV keyring — conveys no
standing"**: this rehearses the I-1/I-3/R-7 machinery and nothing else — no
clause moves from planned to enforced, and the authority boundary is
structural (the Compact's authority keys sign law artifacts only; the enforcer
key, declared in its own signed annex, signs runtime artifacts; there is
deliberately no CA). See docs/decision-rehearsal-identity.md for the design.

## Verify locally

```bash
npm install            # workspace install (no build step in Phase 0)
npm test               # node --test across packages
npm run verify-pin     # dsh pin gate
npm run verify-register  # enforcement register gate (Phase 4)
```

### Live tests (real model, real tokens — opt-in)

`npm run test:live` drives the **real launcher** end-to-end with real model
requests: self_describe + offline audit, the network refusal, allow-once with
exec-cache replay, confinement with a host-side write check, and the declared-
secret injection agreement (disclosure ask → injection → hash match → record
stays clean). Assertions land on the record, the grants file, and host
filesystem effects — never on the model's prose. Requirements:
A model route and Docker running with a local `ubuntu:24.04`. The route is
either `DEEPSEEK_API_KEY` (default deepseek-flash) or your own profile — set
`COMPACT_LIVE_SETTINGS=/path/to/settings.yaml` (e.g. `~/.compact-dsh/settings.yaml`
for the opencode-go route; provider keys still come from your environment by
name). Each fixture generates its own rehearsal keyring and uses a throwaway
state dir seeded with that settings file, so runs never touch
`~/.compact-dsh`. Without `COMPACT_LIVE_TEST=1` the suite skips itself — and
the default `npm test` never picks it up.

```bash
npm run test:live                                   # the full flow
COMPACT_LIVE_ONLY=L2,L5 npm run test:live           # selected tests only
COMPACT_LIVE_KEEP=1 npm run test:live               # keep fixtures for triage
```

## Relationship to the other repositories

- **[the Compact](https://github.com/mandubian/compact)** — the law itself:
  the body (`compact.md`), the founding analysis, ledgers, amendments, and
  the registry of runtime annexes. compact-dsh is its first runtime
  jurisdiction; the enforcement register here is that annex's core.
- **[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)**
  — the host runtime. This composition rides its real seams: the
  `tools/*` waterfall, `approval/request`, `SandboxProvider.confine`, the
  subagent delegation contract, session persistence.

## License

MIT — see [LICENSE](LICENSE). The Compact's body text carries its own
licensing decision (in flight upstream, CC-BY-4.0 suggested for the law).
