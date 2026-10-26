# weight-of-voice — the run where the community first went to court

**One breath:** four cheap-route debaters argued whether judgment
belongs on a heavier model, and the heavy seat — a glm-5.3 bench —
heard the case, read the whole forum by its own acts, and returned the
repo's **first live ruling**. The question under debate was the run's
own seating; the answer is on the record, with reasons.

First live run of the `weight-of-voice` charter (merged as #257), run
`34ea9c`, 2026-10-25. It is also the first run seated on **two
models**: frugal, elitist, pragmatist and filer on `zai/glm-5.3-flash`,
the bench on `zai/glm-5.3` — `run.json` records every seat's route.

## What happened

- **Two cuts died honestly before this one.** `a6a42c` and `1c0202`
  burned their rounds against a dead transport (corporate proxy, Node
  ignoring it — 0 assistant messages, 0 posts); the manifests say so,
  and the report shows their empty logs rather than hiding them.
  `NODE_USE_ENV_PROXY=1` opened the route; the resumed community kept
  its keys and continued.
- **The debate did real work.** 19 posts over 7 rounds: the filer
  probed each position before round 5, members paid debts in public
  ("I pay it, and the payment costs me something, which I will say
  plainly"), and the positions converged fast enough that the filer
  mapped them in round 5 (fp_17) and **filed `case_100982a4`** — the
  first `judicature_hear` ever called by a live member, citing its own
  mapping post.
- **The bench earned its seat.** Woken by the filing, bench-1 ran the
  full discipline in one turn: `judicature_case` → counsel access
  (`record_read`) → the whole forum read whole (`forum_read` ×2) →
  `law_read` → `judicature_judge`. Its first judgment call was
  **refused** (it named the set, not the seat); the refusal taught it;
  it read `judicature_sets` and re-landed as seat `chair`. The refusal
  and the recovery are both chain rows.
- **The ruling** (verbatim in [JUDGMENT.md](JUDGMENT.md)): the
  cheap-generate/heavy-discriminate design *survived its own audit* —
  pragmatist's "weight is a budget, not a caste" took the settlement,
  frugal kept the floor ("every seat, including this one, auditable"),
  and elitist's margin hypothesis was carried as priced credit, not
  fact. The bench applied the falsifier tests **the debaters
  themselves had pre-committed to**, and verified the mapping's quotes
  against the source posts.
- **The end:** `token cap: 2000000` in round 7 of 8 — before the
  `RULING:` post reached the forum or the ACCEPTED/CONTESTED answers
  ran. The judgment is fully on the record (filing, refusal, ruling
  are durable chain rows); the gate's forum ceremony did not complete.
  The charter lesson, v2: budget the bench two wakes (read-and-judge,
  then rule-and-post) or name a relayer.
- The divergence fence fired once as designed (13 LoopGuard trips over
  the charter's line of 8 → the community paused itself; SIGCONT
  resumed it — the headless door for a run whose page URL was lost).

## Honesty labels

- **Rehearsal standing only** (D-8): a practice keyring signed
  everything; the case, the bench and the ruling enact nothing.
- **The docket is in-memory by design** — it died with the process;
  the filings and judgments named here are the durable chain rows it
  left behind.
- **No code provenance on this run** — it predates #262; which tree it
  rode is not recorded, and we do not guess it after the fact.
- One `ask_human` (frugal's) never reached the human: the page URL was
  unrecoverable that day (fixed since, #260). "Answered 0, timed out 0"
  is on the report.

## The plain version

Open the replay. Four agents argue about whether the judge should be a
bigger model than the arguers — and the judge in this story *is* the
bigger model. Watch `fp_17` (the map of who believes what), then find
the case id in the acts lane: that post is the moment the debate became
a lawsuit. The bench's ruling is the file `JUDGMENT.md` — read its
"tests the forum pre-committed to" section to see a judge hold itself
to rules the losing side wrote.
