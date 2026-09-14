# compact-dsh

**The Compact on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** —
the plugin composition, annex, and ratification work for the first runtime
jurisdiction of [the Compact](https://github.com/mandubian/compact).

> **Status: Phase 0 (foundations) — in progress.** Nothing here enforces
> anything yet. The law lives in [compact.md](https://github.com/mandubian/compact/blob/main/compact.md);
> this repository builds the machines that make it real on dsh.
>
> **Phase 0 done — including the composed check:** the allowlist gate runs
> inside the **real dsh `ToolRuntime`** (real Cordis context, real
> pre-execute waterfall): uncovered hosts are denied before execution with
> the Compact envelope; allowed hosts pass through and execute. Verified
> contract from the installed `@deepseek-ai/dsh-tools` types (waterfall
> pass/deny, cordis exports), pin gate, concept pages. **Pending:** a full
> agent-loop profile run (needs a model provider key) — enforcement is
> already proven at the tool-runtime altitude.

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
| `packages/approval/` | **Phase 1, slice 1**: the five-layer approval evaluator (exec cache → plan grants → session grants → pending dedup → flood cap) with scoped, expiring, revocable grants; uncovered calls escalate as `ask` |
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
