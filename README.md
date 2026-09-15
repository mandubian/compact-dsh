# compact-dsh

**The Compact on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** —
the plugin composition, annex, and ratification work for the first runtime
jurisdiction of [the Compact](https://github.com/mandubian/compact).

> **Status: Phase 1 (layered approval & grants) — COMPLETE at the
> enforcement altitude available today.** The law lives in
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
| `packages/approval/` | **Phase 1, slices 1–3**: the five-layer approval evaluator (exec cache → plan grants → session grants → pending dedup → flood cap) with scoped, expiring, budgeted (`maxUses`), revocable grants; the `approval/request` answerer materializes `allowed-once` as exec-cache entries (replay hits); `grants-grant`/`grants-list`/`grants-revoke` commands; JSON+fsync persistence (corrupt store = loud boot failure); revocation kills covered cache entries; fingerprint golden vectors; denial-envelope lint |
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
