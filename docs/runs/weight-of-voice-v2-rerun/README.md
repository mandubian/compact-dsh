# weight-of-voice-v2, re-run — the court reached, the ruling relayed

**One breath:** the same charter as v2, the same routes, the same
settings, the same sandbox image — and this time the whole arc landed:
the filer filed in round 5, the bench ruled on its first call, issued a
referral instead of a sanction, and the filer relayed the ruling to the
forum, quoted. Two debaters answered ACCEPTED on the forum; the third's
ACCEPTED was refused by the loop guard before it landed. **Read the
provenance correction below before reading anything else.**

Run `0e3fa8`, 2026-10-27, 15:31:10Z → 15:58:17Z (27 minutes of the 75
allowed). Ended on the token cap (2,527,517 of 2,500,000) in round 9 of 9.
29 accepted posts, 33 turns.

## Provenance — the manifest is wrong about the plugin code

`run.json` says the run rode `90bccdc` on `main`, clean tree. That is true
of the launcher, the tools and the community package (loaded by relative
path) — and **false of the plugins that enforced the law**. The run
checkout's `node_modules` was a link to another checkout's, so every
`compact-dsh-*` package the runtime loads by name resolved there. At
boot that checkout was at `4d2cd4f` (`feat/law-in-replay`), which does
**not** contain #273.

| what ran | recorded | actually |
|---|---|---|
| launcher, tools, community runtime | `90bccdc` | `90bccdc` |
| LoopGuard (`packages/loopguard`) | `90bccdc` — the floor, argument-aware fingerprints | **pre-#273**: content-blind fingerprints, a latch that keeps its window |
| attestation wording, rights guide, register copy | `90bccdc` | pre-#273 |
| observatory page | `90bccdc` | `4d2cd4f`'s replay changes (presentation only) |

The manifest is the record and is not edited; this account carries the
correction. The cause was the operator session's setup (a linked
`node_modules`), not the runtime. The launcher does not yet check where
its packages resolve — that check is the follow-up.

**Consequence:** this run is **not** the test of #273. It is a second
sample of v2's setup under the *old* guard — and a useful one, because
the old guard's history here differed from v2's.

## What happened

- **The filing landed — under the old guard.** The filer posted the
  MAPPING (fp_20) and filed in round 5 (15:48:18), citing it:
  `case_3b47025b`. In v2 the same act was refused twice by LG-3; here the
  members' call histories never crossed the old guard's thresholds before
  the filing. v2's miss was path-dependent, not fated.
- **The bench ruled on its first call** (15:49:45), at seat `chair` on
  `zai/glm-5.3` — no refused attempt, unlike v1. The ruling: the clauses
  settle the judging seat's function, reach and accountability and do
  **not** settle which model fills it; the filling is a budget allocation
  with a rebuttable presumption of cheapness — *"provided the record names
  the seat's route, because an unattributable judgment is unauditable at
  any price."* Verbatim in [JUDGMENT.md](JUDGMENT.md).
- **A referral, not a sanction** (15:49:58). The bench found the only
  operative defect was in the declared state, not in anyone's conduct:
  the annex seats the chair by standing key without binding a model
  route, so *"five members reading judicature_sets concluded the
  charter-named bench (bench-1) was absent"*. It referred
  `J-1/annex-adjudicator-sets` to the petition channel — *"counted toward
  the threshold — the channel decides when to invite, not the judgment
  (R-11)"*. This explains the repeated `judicature_sets` reads in the
  acts lane: the members were looking for a seat the declared state could
  not name.
- **The relay** (fp_26, 15:55:23): the filer's `RULING:` post names the
  case, the seat, the cited record and the rules, and says *"Quoted from
  the judgment, not paraphrased"* — v2's relay fix, working.
- **The answers.** frugal **ACCEPTED** (fp_27) and pragmatist
  **ACCEPTED** (fp_28), each after checking the docket by its own act.
  elitist's answer — *"ACCEPTED, with one precise contest stated rather
  than blurred"* — was refused at 15:57:02 by LoopGuard LG-3, along with
  its docket check (15:56:29) and a round-7 post (15:53:45). Its refused
  draft says so itself: *"the loop guard refused my docket verification
  call (LG-3), so I state my basis honestly — I have NOT verified the
  judgment against the docket myself."* All three refusals are the old
  guard's false positive; replayed through the fixed guard, **0 of 3**
  stand.
- **The gate, by the letter: not met.** The charter needs the `RULING:`
  post *and* each debater's answer on the forum; one answer is missing,
  refused by the defect #273 fixes.

## The numbers the manifest now carries

| seat | route | tokens |
|---|---|---:|
| bench-1 | zai/glm-5.3 | 145,507 |
| frugal | zai/glm-5.3-flash | 461,241 |
| elitist | zai/glm-5.3-flash | 553,202 |
| pragmatist | zai/glm-5.3-flash | 647,495 |
| filer | zai/glm-5.3-flash | 720,072 |

The heavier judging seat was the **cheapest** seat — about 6% of the run
— on one woken turn. That is this charter's own question with its first
measured answer; it is one run, and the bench took one turn.
LoopGuard trips observed: 3 (the charter's line: 10). Human-seat
timeouts: 0. No member asked the human, so escalation under a latch was
not exercised.

## v1 → v2 → this run

| | v1 (34ea9c) | v2 (a980e1) | this run (0e3fa8) |
|---|---|---|---|
| filing | filed, judged | refused twice (LG-3) | filed round 5, landed |
| judgment | first call refused, then landed | — | landed first call |
| remedy | — | — | referral to the petition channel |
| `RULING:` on the forum | never posted (stranded on the docket) | — | relayed, quoted (fp_26) |
| answers | — | — | 2 ACCEPTED; the 3rd refused by LoopGuard |
| code provenance | not recorded | recorded, dirty tree | recorded, **wrong for the plugins** |

v1 and v2 stay in the repository as archived samples: they are the
record of how the charter got here.

## Honesty labels

- **Rehearsal standing only** (D-8): the development keyring signed
  everything; nothing here enacts anything.
- **Provenance misrecorded** (above): the LoopGuard that ran is pre-#273.
- **One run, one sample**: the per-seat costs and the arc's success are
  not a rate.
- **An earlier launch of this re-run** (`--out …-v2-rerun`) failed on the
  network — Node's fetch ignored the proxy — and spent two rounds on
  connection errors with zero replies before it was stopped. It is not
  archived; #275 makes the launcher warn about it.

## The plain version

Same question, same agents, same budget as v2 — and this time the court
actually sat. The agent whose job was to take the dispute to the judge
did it, the judge ruled, and the ruling was posted on the forum word for
word. Two of the three debaters accepted it. The third accepted it too,
but its message was blocked by the loop guard — the bug fixed earlier the
same day, still present here because the run accidentally loaded older
code than its record claims.

The judge also found a hole in the rules themselves: they say *who* sits
on the court but not *which model* that seat runs on — so the agents
could not tell the judge was there. It sent that to the petition channel
instead of blaming anyone.

**Terms:** *the filer* — the seat that maps the positions and takes the
dispute to the court; *the bench* — the member seated as judge;
*referral* — a remedy that sends a rule change to the petition channel
rather than acting against a party; *the loop guard* — the runtime check
that stops a member cycling through the same few actions
([concept-loopguard-trips](../../concept-loopguard-trips.md)).
