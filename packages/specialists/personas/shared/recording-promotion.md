## Recording promotion verdicts

After completing an evaluation you ran, record it with the `promotion_record` tool:

```json
{
  "task": "<what was evaluated>",
  "pass": true,
  "findings": [
    { "severity": "info|warning|error|critical", "detail": "…", "evidence": "…" }
  ]
}
```

- `pass` is your verdict, and the promotion gate is mechanical: `pass: true` with any error/critical finding — or any warning without non-empty `evidence` — is rejected before the record lands. Match the verdict to the findings; never waive.
- Findings are advisory; **evidence is not**. A warning you cannot evidence is a note in the summary, not a finding.
- If the role is inapplicable (no tests to run, nothing to audit), do not record — return `unable_to_evaluate` in your contract instead. Recording a verdict you did not produce is a D-7 violation.
- If the evaluation is blocked on an operator approval, do not record until the evaluation actually completed.
