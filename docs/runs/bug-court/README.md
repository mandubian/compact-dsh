# bug-court — the run where every claim had to execute

**One breath:** three cheap-route voices and a heavy chair deliberated the
truth about one frozen 26-line money module — and the only admissible
attack was a reproduction: the bash command against the frozen file,
posted with its actual output. The verdicts came back **B1 CONFIRMED,
B2 CONFIRMED, B3 REJECTED** — a court that read the artifact's own
documented intent and refused to call it a defect.

First live run of the `bug-court` charter (#257), run `8e68c3`,
2026-10-26, from a second scratch (`bug-court-node` — the first cut
`0b8681` burned its whole token budget in three rounds and is kept
beside it in the operator's runs, named as what it was).

## What happened

- **The court ran the code.** The accuser posted reproductions against
  `sources/purse.js` (frozen); the defender *verified before
  defending*; the skeptic attacked both reproductions' boundaries; and
  the chair — the glm-5.3 seat — **ran every load-bearing reproduction
  itself** before drafting the ledger (fp_4). Evidence is command plus
  output; nothing else counted.
- **The endorsements carried verifications.** Each member endorsed the
  draft ledger by its own post — fp_5, fp_6, fp_7 — several stating
  they re-ran the reproductions before endorsing. The gate's
  anti-fake rule ("a claim nobody reproduced has not been tried")
  held on live members.
- **B3 is the run's verdict on itself.** `take()`'s silent overdraft is
  documented in the module's own comment as v1's stance — and the
  charter's brief said a claim that reads documented intent as an
  accident must beat the document. The court weighed it and REJECTED
  B3 as a defect: two confirmed bugs, one honest acquittal, no
  rubber-stamp.
- **The end:** `token cap: 1200000` in round 7 of 7 — after the
  VERDICTS ledger (fp_8) closed and the endorsements landed. Members'
  passes say the ledger is closed and counted; the run ended at the
  cap, not in doubt.

## Honesty labels

- **Rehearsal standing only** (D-8): a practice keyring signed
  everything; the verdicts judge nothing in the world — the module
  stays frozen whatever the ledger says.
- **Code provenance, recorded:** commit `75c6c5c` on `feat/live-page-charter`
  — a clean tree on a feature branch, not main; the manifest names the
  branch and the commit exactly, which is the point. The law digest,
  image and node version ride the same line.
- **The gate word arrived prefixed** — fp_8 opens `chair — VERDICTS:`,
  so the first LEDGER detector missed the marking; the detector now
  yields to an author prefix. Member speech was never edited.

## The plain version

Open the replay. Read fp_1 (the accusations, each with a command),
fp_4 (the chair's draft ledger — it says it ran everything itself),
then fp_8 (the verdicts). The interesting line is B3: read the
module's comment on `take()` first, then the verdict, and you have the
whole idea of this charter in one breath — a bug court where the
evidence runs and the document gets its day.
