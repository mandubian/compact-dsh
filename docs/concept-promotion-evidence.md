# Concept: Promotion Evidence Rule

Compact bindings: D-4 (no instrumental shortcuts) · D-7 (mechanical
decisions from recorded state) · F-6 (digest-bound identity) · the
predecessor's promotion gate (P-2.x family).

## The concept

When a Member's work product is *promoted* — installed, published, marked
done — the promotion decision is **mechanical and evidence-gated**, never
orchestrator-narrated:

- `pass = true` with any `error` or `critical` finding → **rejected**
  mechanically.
- `pass = true` with `warning` findings → rejected unless each warning
  carries non-empty `evidence` (what was observed, where).
- Promotion runs the **full recorded gate set**: every gate role that ran
  must have recorded pass; a role the orchestrator "forgot" to run still
  blocks. **The orchestrator cannot shop for gates.**
- Evidence is **digest-bound** to the artifact it certifies: re-verifiable
  against the artifact's content, not against anyone's summary of it.
- Fail-closed: missing data blocks. There is no fall-through that promotes
  on absence of information, and no waiver boolean — the evidence field is
  the only proof, because booleans are set by the party being gated.

## Invariants

- First admission of a new Member's work is treated as the **maximal
  capability delta** — the strictest gate class.
- Verdicts are checked against **stored traces**, not LLM restatements of
  traces ("pass" for execution roles re-verifies the trace at promote time).
- Re-promotion (broadening) re-runs the delta, not the history.

## Mapping to a runtime

The gate is a pure predicate over (artifact digest, finding records, gate
records). The host provides where findings live and where promotions are
recorded. On dsh: the `dsh-promotion` plugin + the Phase 1/6 stores (port
plan Phase 3). The predecessor's founding incident — an orchestrator
proceeding past a failed test run because its LLM judged the failure
"non-blocking" — is the case this rule exists to make structurally
impossible.
