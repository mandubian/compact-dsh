# compact-dsh

**The Compact on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** —
the plugin composition, annex, and ratification work for the first runtime
jurisdiction of [the Compact](https://github.com/mandubian/compact).

> **Status: Phase 3 (LoopGuard, promotion gate, response validation) —
> COMPLETE.** The law lives in
> [compact.md](https://github.com/mandubian/compact/blob/main/compact.md);
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

## The plan

The full port plan lives at
[`annexes/dsh/plan.md` in the compact repository](https://github.com/mandubian/compact/blob/main/annexes/dsh/plan.md):
nine phases, 21–30 estimated weeks, five counted fidelity losses, two
recorded capture compositions for round-2 testing.

This repository hosts the plugin packages and the **dsh annex** — the signed
binding contract (conformance declaration, enforcement register, role
mapping) per Compact F-5. Until the annex is ratified and the floor is
enforced, this composition claims **no Compact standing** (F-5 honesty).

## Layout (Phase 0)

| Path | What |
|---|---|
| `packages/allowlist-gate/` | First plugin: a `tools/pre-execute` deny-by-allowlist gate issuing Compact-shaped denial envelopes (rule ID + lawful next moves, R-3) |
| `packages/approval/` | **Phase 1, slices 1–3**: the five-layer approval evaluator (exec cache → plan grants → session grants → pending dedup → flood cap) with scoped, expiring, budgeted (`maxUses`), revocable grants; the `approval/request` answerer materializes `allowed-once` as exec-cache entries (replay hits); `grants-grant`/`grants-list`/`grants-revoke` commands; JSON+fsync persistence (corrupt store = loud boot failure); revocation kills covered cache entries; fingerprint golden vectors; denial-envelope lint; `PathPrefix` mount-grant patterns; provides the `compact-approval` service; gates identifiable targets only |
| `packages/sandbox-docker/` | **Phase 2, slice 1**: docker `SandboxProvider` (per-call confinement, no-network default, masked-path deny-list, honest enforcement, fail-closed) + `sandbox_request_mount` tool — mount grants (canonical `PathPrefix`, ro ceiling, TTL, revocable) cured through the Phase 1 approval store |
| `packages/remote-access/` | **Phase 2, slice 2**: static network-access analysis of shell args — findings (URL, remote, package-registry, IP) route through the Phase 1 grant layers (approvable per-host); opaque findings fail closed with an envelope |
| `packages/loopguard/` | **Phase 3**: the 12-trip LoopGuard state machine (progress/failure accounting, command-aware fingerprints, refusal-seam + agent/error feeds; behavioral latches with repair budget 3, deterministic deny-all) + response validation (`tools/post-execute` block on invalid results) |
| `packages/promotion/` | **Phase 3**: the promotion evidence gate — `pass=true` mechanically rejected with any error/critical finding or unevidenced warning, enforced in the waterfall before the tool body; no waiver boolean |
| `packages/envelope/` | Shared Compact denial-envelope builder (R-3/I-4) |
| `annex/annex-draft.md` | The annex draft — conformance declaration, register skeleton, role mapping (F-5) |
| `tools/verify-pin.mjs` | dsh version-range gate: every package pins `@deepseek-ai/dsh` to the audited rc line |
| `docs/concept-*.md` | The concept pages — the implementation-agnostic spec each package cites (approval layers, loop-guard trips, mount grants, promotion evidence, constitution coupling) |

## dsh version policy

All packages pin `@deepseek-ai/dsh` to `~0.1.5-rc.1` (npm `latest` at
adoption; the audited line). `tools/verify-pin.mjs` refuses any other range;
upgrades are a reviewed, re-blessed event — never silent drift.

## Verify locally

```bash
npm install            # workspace install (no build step in Phase 0)
npm test               # node --test across packages
npm run verify-pin     # dsh pin gate
```
