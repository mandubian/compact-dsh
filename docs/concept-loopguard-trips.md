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
- **The floor is never latched.** A trip denies *work*, never the lawful
  next moves its own envelope names: escalation (R-9), petition (R-11)
  and exit (R-12) pass a latch and a halt. Only a floor call's own
  identical repetition is refused — per call, no latch, no repair spent.
- **The identical operation is the same tool with the same arguments.**
  Two different posts are two operations; the same post twice is one.
- **A cleared latch takes its evidence with it**, and **a first-seen
  operation is never polling** (LG-3) — progress is judged on what follows
  the Principal's message, and a new fingerprint is progress.
- **The guard's own denial is not a tool failure**: it never feeds the
  failure budgets (LG-2, LG-8) that would raise the next trip.

## The floor and the meaning of progress (the community-run findings)

### The precise version

**In one breath:** in four live community runs, LoopGuard refused the
escalation its own refusals recommend, and most of its 29 denials were
not loops — the guard read distinct speech as repetition and re-tripped
on evidence its own latch had already spent.

- **The evidence.** The members' real session logs, replayed through the
  unmodified `Guard` in the plugin's own order, reproduce all 29
  recorded LoopGuard denials, call for call (weight-of-voice 34ea9c,
  weight-of-voice-v2 a980e1, workshop 2914fd, bug-court 8e68c3).
- **Five defects, one root each:**

  | defect | where | live consequence |
  |---|---|---|
  | the latch and the halt denied the floor | `observeCall` checked the latch before the tool | v2's filer was refused the `ask_human` its envelope named; workshop's prover was refused `request_termination` |
  | the loop fingerprint was the approval fingerprint (target-shaped) — only shell commands added their text | `loopFingerprint` | six different posts, or a pass per round with a fresh reason, were "the identical operation" (LG-5) |
  | `clearOnUserSignal` cleared the latch but kept the call window, and denied calls never enter it | `trips.js` | the first call of each new turn re-tripped on the same window (LG-3) |
  | LG-3 counted the current call into the window it judged | `observeCall` | v2's first filing — a first-seen operation — was refused as "polling without progress" |
  | denials came back as failed results and fed LG-2/LG-8 | `tools/result` | the guard's own refusals counted toward its next trip |

- **The fixes.** `FLOOR_TOOLS` (`ask_human`, `petition`, `flag_collision`,
  `request_termination`; a composition names others in
  `opts.floorTools`) take `observeFloorCall`: never latched, never in the
  work window, refused only on identical repetition. `loopFingerprint`
  adds a hash of the canonical arguments. A cleared latch empties the call
  window; the repair budget still counts every trip of the session, so a
  real loop still ends it. LG-3 is judged only when the current call
  repeats an operation already in its window. `isOwnDenial` keeps the
  guard's `[LG/…]` refusals out of the failure accounting — another gate's
  refusal (`[RA/…]`, `[AG/…]`) still counts, as before.
- **The replay, after.** The same 29 histories through the fixed guard:
  none of the 29 denials stands. Each history's first changed decision
  is a strict claim; later ones are indicative only — a member that was
  not refused would have acted differently after. That real loops still
  trip is pinned by tests, not by these runs (they contained none):
  `packages/loopguard/test/floor-and-progress.test.js`.
- **The cost, declared** (the annex carries it too — an amendment of
  conduct, A-4):
  - a loop that varies an argument on every call (a counter, a reworded
    post) escapes the repeat trips (LG-1, LG-3, LG-5); the failure budgets
    (LG-2, LG-8), the refusal trips (LG-9, LG-12), the LLM budget (LG-6)
    and the run's own budgets still bound it;
  - after a latch clears, a loop gets a fresh window (up to 16 calls for
    LG-3, 10 for LG-1, 5 for LG-5) before it re-trips; the repair budget
    still ends the session on the fourth trip of a class;
  - the floor is a list of tool NAMES: an unknown tool is work, and a work
    tool named like a floor tool would pass a latch.

### The plain version

The loop guard is meant to stop an agent that keeps doing the same thing.
In the community runs it stopped agents that were doing different things —
and it blocked the one call it tells a stuck agent to make.

- **Before:** the filer, refused once, asked the human for help:
  ```
  ask_human → Error: [LG/LG-3] loop guard trip (RotatingPollingPattern): 16 calls cycled
              through only 5 distinct operations — polling without progress
              Lawful next moves: … — escalate to your Principal
  ```
  The refusal recommended the very call it had just refused.
- **After:** asking the human, petitioning and leaving always go through.
  Only asking the *identical* question five times in a row is refused,
  and only that one call.
- **Before:** a member who passed every round with a new reason was
  refused on the fifth round for "the identical operation". **After:**
  different reasons are different operations; the same words five times
  in a row still trip.
- **Unchanged:** the twelve trip IDs, the latch until the Principal's next
  message, the repair budget of 3, and the halt on a deterministic trip.
- **Where this stops:** the replay shows the old denials do not stand; it
  cannot show what the members would have done next.

## Mapping to a runtime

Fingerprints and accounting are pure logic over (call, result) — testable
without a host. The host provides: the interception point (pre-execute),
outcome observation (post/result), corrective injection (model-facing
context), and the trip latch store. On dsh: a guard plugin + the
`repeat-tool-reminder`-style advisory lane (port plan Phase 3).
