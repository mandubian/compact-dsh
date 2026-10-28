# weight-of-voice-v2 — the gate met

**One breath:** the same charter, routes, settings and sandbox image as
v2 and its first re-run — now on the code that carries the LoopGuard fix
(#273), verified clean — and the whole arc landed, in budget: the filer
filed in round 5, the bench ruled and posted the `RULING:` itself, and
all three debaters answered **ACCEPTED** on the forum. The charter's
success condition, met for the first time in this experiment. The loop
guard never intervened.

Run `dc550f`, 2026-10-28, 13:05:34Z → 13:31:31Z (26 minutes of the 75
allowed). Ended **rounds complete** — 9 of 9, 2,436,884 tokens of the
2,500,000 cap: the first run of this charter not stopped by its token cap.
29 accepted posts, 37 turns.

## Provenance — what ran, verified

| | recorded |
|---|---|
| code | `91b77b8` on `main`, clean tree |
| packages | all 25 workspace packages resolve **inside** the checkout (0 foreign — the #278 check) |
| content | code digest `63dd4edc049bbf79…` over the 25 packages, the lockfile and 25,985 installed files (`run.json` → `code.digests`; #280) |
| runtime | node v22.23.2 · `dsh-tools:basic` · law `27bb7078…` |

**Where this stops:** the run started before #281, so the attestation did
not yet reach the members unasked, and the code digest is not on the
hash chain — the detail is in the manifest, beside the record, not in it.
Members saw the `Code:` line when they called `self_describe`.

## What happened

- **The mapping and the filing.** The filer posted THE MAPPING (fp_19,
  13:19:55) and filed in round 5 — the charter's earliest allowed round —
  12 seconds later: `case_fe00c9c3`.
- **One refusal, the court's own.** The bench's first judgment (13:22:33)
  named the panel `member-review` instead of its seat — `[JG/judgment-refused]
  … seat "member-review" is not among the panel's resolved seats (chair)`.
  Sixteen seconds later it re-filed as `chair` and the judgment landed. The
  same misnaming as v1's bench, and the confusion the first re-run's bench
  referred to the petition channel (adjudicator sets name standing keys,
  not model routes). Verbatim in [JUDGMENT.md](JUDGMENT.md).
- **The bench posted the `RULING:` itself** (fp_21, 13:23:01) — the path
  v2's charter names "the ceremony": the whole arc in the bench's one
  woken turn. The filer then relayed it, quoted (fp_25).
- **The answers.** frugal (fp_22), elitist (fp_23) and pragmatist (fp_24)
  each answered **ACCEPTED**, each scoring the ruling by a test it had
  stated earlier in the debate (frugal's "sworn method", elitist's test of
  fp_17, pragmatist's three-way fork of fp_18). Closing posts follow
  (fp_26–fp_29).
- **The loop guard: silent.** 0 LoopGuard notices, 0 trips. In v2 the
  filing was refused by LG-3; in the first re-run elitist's ACCEPTED was.
  One run is one sample — but the members' behaviour that the old guard
  refused (a post per round with fresh text, a filing after reads) is the
  behaviour this run shows, unrefused.

## The numbers

| seat | route | tokens |
|---|---|---:|
| bench-1 | zai/glm-5.3 | 289,255 |
| pragmatist | zai/glm-5.3-flash | 506,665 |
| frugal | zai/glm-5.3-flash | 520,990 |
| elitist | zai/glm-5.3-flash | 543,538 |
| filer | zai/glm-5.3-flash | 576,436 |

The heavier judging seat is again the **cheapest**: about 12% of the run,
one woken turn. Human-seat timeouts: 0; no member asked the human.

The publication pack's model reading was **rejected by its audit** — it
claimed 2 recorded passes where the brief records 9 — and is not archived.
The deterministic [BRIEF.md](BRIEF.md) passes (12 citations).

## v1 → v2 → re-run → this run

| | v1 (34ea9c) | v2 (a980e1) | re-run (0e3fa8) | **this run (dc550f)** |
|---|---|---|---|---|
| filing | landed | refused twice (LG-3) | landed | **landed** |
| judgment | refused first, then landed | — | landed first | refused first, then landed |
| `RULING:` on the forum | never | — | relayed (fp_26) | **posted by the bench (fp_21), relayed (fp_25)** |
| answers | — | — | 2 ACCEPTED; the 3rd refused (LG-3) | **3 ACCEPTED** |
| gate | not met | not met | not met | **met** |
| ended by | token cap | token cap | token cap | **rounds complete** |
| LoopGuard notices | 13 | 12 | 3 | **0** |
| code provenance | not recorded | dirty tree | misrecorded (foreign plugins) | **clean, 0 foreign, content digest** |

v1, v2 and the first re-run stay in the repository as archived samples:
the record of how the experiment got here.

## Honesty labels

- **Rehearsal standing only** (D-8): nothing here enacts anything.
- **One run, one sample**: the met gate is not a rate, and it cannot be
  attributed to #273 alone; it is consistent with it.
- **Before #281**: no unasked attestation; the code digest is recorded,
  not chained.

## The plain version

Same question, same agents, same budget — on corrected code. The agent
whose job was to take the dispute to court did it on time, the judge
ruled (after correcting how it named its own seat) and posted the ruling
itself, and every debater accepted it on the record. Nothing was blocked
along the way, the run finished all its rounds without running out of
budget, and its record names exactly the code that ran.

**Terms:** *the filer* — the seat that maps the positions and takes the
dispute to the court; *the bench* — the member seated as judge; *gate* —
the charter's success condition (here: the `RULING:` post and each
debater's own answer); *the loop guard* — the runtime check that stops a
member cycling through the same few actions
([concept-loopguard-trips](../../concept-loopguard-trips.md)).
