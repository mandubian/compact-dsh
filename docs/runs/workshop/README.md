# workshop — the run that built, tested, reviewed, and shipped one small thing

**One breath:** five members — smith, prover, publisher on the cheap
route, reviewer and a bench seat on glm-5.3 — built one artifact to the
letter of a 20-line spec, an immutable-ledger module in plain Node: the
prover's tests ran for real, the heavy reviewer **caught a load-bearing
defect and the fix is credited inside the shipped manifest**, the
publisher shipped under the charter's one granted door and verified the
round-trip — and then three members each fetched the artifact back and
verified it *independently*. The gate was met; the token cap ended the
run after the work, not before it.

First live run of the `workshop` charter (#257), run `2914fd`,
2026-10-26.

## What happened — and what was verified afterwards

- **The pipeline ran in order and in the open.** fp_1 smith implements
  to spec; fp_2 the prover posts the command and its actual output
  (`node --test tests/`, verbatim tail); fp_3 the reviewer reads the
  code against the spec line by line **and runs the tests itself**;
  fp_4 the publisher ships and round-trips.
- **The review loop bit.** The reviewer's finding 1 — ambient ESM
  config is load-bearing — became `package.json`, and the shipped
  manifest's byline credits it: *"ambient ESM config, no dependencies
  (reviewer finding 1: load-bearing)"*. The heavy seat did not
  decorate; it corrected.
- **Verification became the culture, not the chore.** fp_5, fp_6, fp_7:
  smith, prover and reviewer each independently fetched the shipped
  artifact and re-verified it — nobody took another's post on faith;
  fp_8 the publisher's fresh final check.
- **The gate, re-verified offline by the operator after the run:**
  - the prover's tests pass on what shipped — 11/11 in the sandbox
    (node 18, the exact command), 33/33 on the host (node 22 — the
    verification rounds added tests, all green);
  - the manifest's sha256 matches the artifact byte-for-byte
    (recomputed: `2bb5490e…`);
  - the shipped tarball is diff-clean against the workspace — nothing
    drifted after shipping;
  - every reviewer concern was answered on the forum: zero bench
    cases, the negative space saying disputes never outgrew speech.
- **The end:** `token cap: 1500000` in round 8 of 8 — after the
  pipeline completed and two verification rounds ran. The cap cut
  ceremony, not work.

## Honesty labels

- **Rehearsal standing only** (D-8): a practice keyring signed
  everything; the artifact is a rehearsal object and enacts nothing.
- **Code provenance, recorded:** commit `40ef7e0`, clean tree, on the
  `feat/bug-court-sample` branch — named exactly; the law digest, the
  image and node version ride the same line.
- **The releases host is gone with the process** — the round-trip
  verifications (fp_4–fp_8) are the durable evidence of delivery; the
  artifact itself is in the archive's workspace.

## The plain version

Open the replay, then run the tests yourself — that is the whole point
of this run. Read fp_2 (the prover's command and output), fp_3 (the
reviewer's own test run), then the manifest inside the archive's
`workspace/staging/manifest.json` and find the reviewer's finding
credited by name in the thing it fixed. An agent team whose "done" you
can check with one command is a different animal from an agent team
that says "done."
