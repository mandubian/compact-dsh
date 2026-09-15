Once the session has produced durable built work, that work passes evaluation before it is promoted or installed. On dsh today the built work is a workspace tree plus its passing stdlib tests; the `artifact_ref` that carries a bundle through the gates activates when the artifact store lands (Phase 6). Until then, run this gate discipline on the workspace itself.

**Order:** coder → packager (only when third-party dependencies are declared) → gates → operator escalation. Packaging after gating changes the bytes under review and voids every recorded verdict — always gate the packaged state.

**Gate sequence:**

1. **Correctness first, alone.** Run the build's own test suite (`unit_test_runner`, else `executor`) and join it. On failure, stop: route code bugs to `coder`, missing dependencies to `packager`. Never send review gates after a known-broken build. A trivial script with no test files returns `unable_to_evaluate` — proceed to review.
2. **Review gates in parallel.** `auditor` + `static_evaluator` on the same tree, one join. Read both verdicts in the same turn.
3. **Collect verdicts from the record**, not from child reply JSON: `promotion_query` / `promotion_record` is the mounted store. Execution roles need trace evidence; the auditor must pass with no critical findings.
4. **Escalate to the operator once.** Report the role verdicts with your synthesis and ask; the escalation gate freezes spawns for the session until resolved, so save the approval id, relay it, and end your turn. Never ask a second channel for the same decision.

**Manifest preflight — before any gate.** Read the descriptor and manifest the coder wrote (a couple of `read` calls) and check entrypoints, input mode, and declared hosts against the actual files. Route mismatches back to `coder` before spending a gate round: review surfaces semantic mismatches one at a time, and the preflight collapses the common loop of gate → one-line fix → re-gate → next mismatch.

**Carry-forward after a rebuild** (optional; honored only when the operator enables it — you propose, the gateway verifies):

- Diff old vs new. If code or contract bytes changed, no code gate carries — re-run it. If only prose changed, code-reviewing gates may carry their prior passes; static review **never** carries — re-run it on any rebuild.
- Be more conservative than the floor: a change touching capability declarations, declared hosts, or secret handling re-runs the auditor regardless of what the diff says.
- Absent verdict ≠ carry: a gate that recorded nothing has no pass to carry — re-attest it.
- A rejected carry is not an escalation failure: read the reason, re-run that one gate, re-escalate. Never present a carried verdict as freshly run.

The machinery this section rides at home — unseeded escalation binding, artifact digests and diffs, the escalate payload — lands with the artifact trilogy (Phase 6); the discipline above is what survives the port.
