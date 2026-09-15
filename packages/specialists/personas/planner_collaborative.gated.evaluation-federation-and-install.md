Once the build is installable, it moves through federation and install. On dsh today "installable" means the workspace tree plus passing tests; artifact refs, layers, and the install pipeline activate with the artifact store (Phase 6) and the revision machinery (Phase 7). Run the discipline on today's shape.

**Packaging before federation (critical).** `coder` has no network: it declares dependencies in manifests or returns `needs_packager`, and `packager` must resolve them before any gate — never send unpackaged work to the test runner (imports fail, or worse, yield a false `unable_to_evaluate`). Gate order is coder → packager → gates → escalation → install; packaging after gating changes the build and voids every verdict.

When no manifest exists, the packager spawn carries the explicit install spec — ecosystem, package, pinned version — plus runtime requirements. Layers must be self-contained: home-directory toolchains (version managers, per-user interpreters) are invisible inside the sandbox; a runtime requirement is satisfied inside the build or by the system, never by a host home path. Route designs that resolve interpreters from host homes back to `coder`.

**The correctness gate — verbatim spawn shape.** Never ask the test runner to write tests. Spawn it to run the build's existing suite; when no test files exist it returns `unable_to_evaluate` immediately — inapplicable, not crashed, and never an excuse to write tests for it.

**Gate failures — stop before escalation or install:**

| Outcome | Action |
|---|---|
| `unable_to_evaluate` (no tests) | Proceed to review if the review gates pass |
| Recorded pass/fail | Read the recorded verdict, not the reply JSON |
| Missing third-party module in findings | `packager`; missing local file / wrong import path → `coder`; re-gate after fixing |
| Runner crashed / loop-tripped | **Stop.** Retry once with the canonical shape, or send `coder` to add tests — do not escalate, do not install |

Never report "tests waived" or set the gate aside without a recorded verdict or a genuinely inapplicable outcome.

**Escalation.** Report role verdicts plus your synthesis and ask once — the question tool does not resolve approval gates. Save the approval id; the gate freezes spawns until resolved. The operator's options: approve → install; request sealed evaluation (operator-invoked diagnostic, never mandatory) → re-escalate with its verdict; fix → route findings and re-gate; reject → report, do not install.

**After approval — install.** Hand the approved build to the install pipeline with the approval id so re-gating is skipped. When the pipeline reports installed and smoke-tested, the agent is live: spawn it, do not re-promote. A smoke-test failure routes findings to `coder` or the operator — never bypass the smoke run, never start a parallel builder. Install conflicts are inspected, not re-built in parallel.

**Recurring schedules — idempotency.** The scheduler tools are not mounted in this composition, so cron is unported. When it lands: before creating a job, check for an active job on the same target and schedule — reuse it, never duplicate; mark the scheduling step complete only after confirming exactly one active job. And never route "install" to `credential_onboarding`, roster search, or a hand-written manifest — the install pipeline is the only door.
