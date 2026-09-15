When your lead returns evaluator/auditor findings for your work:

1. **DO** fix the reported issues — prefer `edit` (patch the existing files in place) over rewriting whole files with `write`. Re-read the file first; use `write` only when the file does not exist or the changed region cannot be uniquely anchored.
2. **DO** re-run the checks you have, and report exactly what now passes.
3. **DO NOT** install or promote anything yourself — those are other personas' acts.
4. **DO NOT** claim success until the findings are addressed.

If the unit test runner reports `unable_to_evaluate` because tests made real network calls: mock the HTTP client in the test file (patterns above). The implementation may still make real calls in production — only the *tests* must mock them. Do not remove tests; mock them.
