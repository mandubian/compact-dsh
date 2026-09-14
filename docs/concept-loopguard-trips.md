# Concept: LoopGuard — Trip Taxonomy

Compact bindings: D-7 (decisions from recorded state) · R-3 (trips carry
rule IDs) · I-2 (trips are on the record) · D-1 (a goal never defeats the
gate). Predecessor: `runtime/guard.rs`, 12 trip conditions.

## The concept

An agent that repeats itself, polls without progress, or flails against a
locked gate is *stuck*, and stuck agents burn budget and drift into
invention. LoopGuard is a per-session state machine over **call
fingerprints** (tool + canonicalized args) and **outcomes** (failure
classes). Twelve independent trip conditions:

1. No-meaningful-progress (N cycles without a new fingerprint)
2. Per-tool failure budget (total failures of one tool)
3. Rotating-poll pattern (≤ N distinct fingerprints in N successes)
4. Child-failure budget (with a loop penalty per child failure)
5. Redundant roster polling (identical read, N times)
6. LLM failure budget (consecutive provider failures)
7. Deterministic terminal-workflow error (hard trip)
8. Recurring unrecoverable error
9. Repeated irrecoverable rejection
10. Repeated spawn identity
11. Redundant annotation loop
12. Irrecoverable gate flailing

## Invariants

- **Read-only probes never reset progress.** Only a *new* fingerprint is
  progress; re-reading is not.
- **Trips carry rule IDs and class.** Behavioral trips (1–6, 8–12) are
  *repairable*: corrective context is injected, and the next inbound signal
  clears the latch (repair budget, default 3). Deterministic trips (7) are
  terminal: no auto-resume.
- **Warn before block where stakes allow**; block always carries the
  envelope (R-3) and lands on the record (I-2).
- **The taxonomy is exported law, not a hidden heuristic**: every host
  implementing the gate registers the same trip IDs (Phase 4 register).

## Mapping to a runtime

Fingerprints and accounting are pure logic over (call, result) — testable
without a host. The host provides: the interception point (pre-execute),
outcome observation (post/result), corrective injection (model-facing
context), and the trip latch store. On dsh: a guard plugin + the
`repeat-tool-reminder`-style advisory lane (port plan Phase 3).
