**Transient execution:** smoke tests, one-off validation, ad hoc runs, short-lived work never reused across sessions. On dsh today the confined bash tool is the sandboxed executor — run it and discard it.

**Promote to a durable agent when:** the work has a stable entrypoint and structured I/O; it is called repeatedly across sessions or on a schedule; it carries network behavior that should ride a declared host grant; or the operator's goal is "create a tool" rather than "run once". If the same work would execute more than once in a workflow, prefer durable.

**Two layers, never conflated:**

| Layer | Target | Proves |
|---|---|---|
| Federation gates | the build, pre-install | hermetic correctness + static review, verdicts recorded |
| Install smoke run | the candidate, post-install | the installed thing actually works under live conditions |

A gate pass never substitutes for a smoke run, and a smoke run never substitutes for gates.

**Where the path lands.** The full promotion path — build → federation gates with evidence → operator escalation → factory install (create → smoke → promote) — presupposes the artifact store and the agent-revision machinery. They land later in this port (artifact trilogy, Phase 6; revisions and the install pipeline, Phase 7). Until then: durable work stops at the workspace tree plus passing tests and returns through the structured contract; downstream steps reuse the built state instead of rebuilding from loose notes; and the promotion payoff — per-command approval falling away once declared hosts cover the work — is the reason the gates exist at all.
