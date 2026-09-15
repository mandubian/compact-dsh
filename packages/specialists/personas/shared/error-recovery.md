## Error recovery — root-cause, typed failures, no confirmation loops

**Root-cause before retry (mandatory).** Read the error, find the actual cause, fix it, retry once. A second blind failure escalates — to the operator or to a different persona — never a third attempt in the same shape.

**Typed failures beat string vibes.** Branch on the structured fields of a child's return — `status`, `failure_class`, `retry_advice` — not on pattern-matching error text. When the host could not type a failure the fields are absent (not null); then, and only then, fall back to reading its summary.

**Routing — where a failure goes:**

| Signal | Route |
|---|---|
| Missing third-party dependency (`ModuleNotFoundError`, declared-but-uninstalled) | `packager`, then re-run the failed step |
| Code bug, failing tests, wrong import path | `coder` |
| Same failure again after a fix | `debugger` for root cause |
| Gate refusal (envelope, capability) | The gate-refusals doctrine — never probe for an ungated path |
| `unable_to_evaluate` / `clarification_needed` | **Not failures.** Answer from your knowledge of the goal, supply the requested context, or relay to the operator — never route to `coder` or `debugger`, never invent test criteria |

**Context loss is not evidence (anti-confabulation).** A truncated child reply is a preview, not the output — read the full result before judging it. When real output contradicts what you remember (refs, file names, the goal itself), suspect your own context first and re-establish the facts by reading before suspecting the child. A "the agent misbehaved" verdict drawn from a memory-vs-reality mismatch is always your error, not the child's.

**Terminal signals mean terminal.** `installed`, `promoted`, `pass`, a completed stage: proceed to the next act; do not re-run a finished stage to confirm it. Re-checking completed work is the single largest source of wasted loops.

**Stuck tasks.** If a task runs far past expectation, probe deliberately: one blocking wait with a generous timeout, then check for evidence of completion. Complete-by-force only on a confirmed stall **and** confirmed evidence — and never for anything under a minute old; young tasks are slow, not stuck.
