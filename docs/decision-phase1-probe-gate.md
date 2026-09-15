# Decision record — the Phase 1 probe gate (continue / prune / both)

**Status: DECIDED — continue the port.** Recorded 2026-09-15, before Phase 5 work began.

## The gate

The port plan (§1 "Framing: probe, not migration") makes Phases 0–1 a probe of
dsh's extension seams with three live outcomes at its gate:

1. **Continue the port** — seams hold, proceed to Phases 2–8.
2. **Prune autonoetic instead** — delete the commodity half of the Rust
   gateway, keeping the differentiator where it already runs.
3. **Both** — plugins and concept pages port; a pruned gateway remains the
   reference implementation.

"The plan does not decide this; Phase 1 produces the evidence that does."

## How the evidence came in

The gate was answered in practice rather than by an explicit record: the work
continued straight through Phases 2, 3 and 4 without pausing at the gate.
This document is the record the gate asked for, written before Phase 5 so the
plan's own accountability mechanism is back in force.

## Evidence for "continue" (from the code, not the docs)

- **The tool seam holds.** Phases 1–3 ride the real
  `tools/pre-execute` waterfall, `tools/result`, and `tools/post-execute`:
  the deny→ask→approve→replay-hit cycle, the LoopGuard trips, and the
  promotion gate are all composed against the installed
  `@deepseek-ai/dsh ~0.1.5-rc.1` types and pass.
- **The approval seam holds.** The `approval/request` answerer chain
  materializes grants; the host's `approval/asked`/`approval/decided` audit
  pair is the record (D-7) — no parallel bookkeeping needed.
- **The sandbox seam holds.** `SandboxProvider.confine()` ported as a docker
  backend with fail-closed unavailability; mount grants cure through the
  Phase 1 human gate (verified against the real daemon).
- **Composition coupling works.** Phase 4's constitution refuses to boot a
  composition missing an enforcement service — the mechanical translation of
  separation of powers is expressible as a plugin, which was the strongest
  argument for the port being viable at all.
- **The churn tax is real but priced.** No seam required a fork; every
  fidelity loss found so far is one of the plan's five counted losses, not a
  new one.

## Consequences

- Phases 5–8 proceed as planned.
- The pruned-autonoetic alternative is not dead — it remains the fallback if a
  future phase hits a seam that genuinely requires forking the host (the
  plan's §7 "fork temptation" rule: if a concept can't ship as a plugin, it
  waits or is dropped; the gate re-opens by the same rule).
- The "both" outcome's concept pages stay valuable regardless: they are the
  implementation-agnostic spec each plugin cites.
