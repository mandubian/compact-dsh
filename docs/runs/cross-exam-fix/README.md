# cross-exam-fix — review, decide, fix: the human approves the fix

**One breath:** a human raised three concerns about a small money module.
Three agents confirmed all three, and the chair told the human plainly
what was needed next. The human said "fix all three". The agents fixed a
copy of the file, showed before and after, and the human approved. 13
minutes from the first post to the approval, and the original file never
changed.

Run `bf5388`, 2026-10-29, 17:18:50Z → 18:01:43Z (43 of the 120 minutes
allowed). First live run of the [`cross-exam-fix` charter](../../../tools/charters/cross-exam-fix.md)
(#294): review, then the human decides, then a fix. Ended **rounds
complete**: 8 of 8, 32 turns, 1,322,486 tokens of the 2,000,000 cap.
9 accepted posts (3 by the human, 6 by the agents), 22 recorded passes.

## Provenance: what ran, verified

| | recorded |
|---|---|
| code | `be8a7c7` (the #294 merge on `main`), on `run/cross-exam`, clean tree |
| packages | all 25 workspace packages resolve inside the checkout (0 foreign) |
| content | code digest `1a5e15c3…`, checked by the auditor against the commit (`--code --repo`): every package and the lockfile match |
| runtime | node v22.23.2 · `dsh-tools:basic` · law `27bb7078…` |
| seats | accuser: **the human** (`human/the-principal`) · defender, skeptic: `zai/glm-5.3-flash` · chair: `zai/glm-5.3` |
| the fix | [`purse.fixed.js`](purse.fixed.js), byte-identical (sha256 `bef88a43…`) to the file written by the defender's own command on its chain (seq 48, turn 2) |

**What was left out:** the run folder also held an earlier attempt,
`7d99b3` (12:43Z): stopped by the operator in round 1, 0 tokens, no act by
anyone. This run resumed from it (`run.json` says so). Its four empty
sessions are not in this sample; they stay on the operator's disk.

## What happened, step by step

| step | post | what it says |
|---|---|---|
| concerns | [fp_1](cross-exam-fix-bf5388.html#fp_1) human, 17:21 | `Math.round` "can round upper or lower"; `split` may lose cents; strings and edge cases aren't handled |
| review | [fp_2](cross-exam-fix-bf5388.html#fp_2), [fp_3](cross-exam-fix-bf5388.html#fp_3) | each concern turned into a command with real output; the skeptic reruns all of them and probes the edges |
| review summary | [fp_4](cross-exam-fix-bf5388.html#fp_4) chair, 17:23 | first line `VERDICTS:`: all three CONFIRMED. "Where we are: review is done — all three of your concerns are confirmed. What we need from you: in your own post, tell us which of 1, 2, 3 to fix." |
| the human decides | [fp_5](cross-exam-fix-bf5388.html#fp_5) human, 17:25 | "fix all three" |
| fix | [fp_6](cross-exam-fix-bf5388.html#fp_6) defender | exact decimal parsing, `split` parts that always sum to the total, input validation, in `sources/purse.fixed.js` |
| fix checked | [fp_7](cross-exam-fix-bf5388.html#fp_7) skeptic | the same commands on both files, plus its own battery: "breaks nothing I could find" |
| fix summary | [fp_8](cross-exam-fix-bf5388.html#fp_8) chair, 17:27 | first line `VERDICTS:`: all three FIXED, with both outputs. "Where we are: all three chosen problems are fixed and double-checked. What we need from you: in your own post, approve or reject each of the three fixes." |
| approval | [fp_9](cross-exam-fix-bf5388.html#fp_9) human, 17:31 | "I approve the 3 fixes" |

After the approval, every agent passed in every round, as the charter
asks.

## The gate: met

- **Both summaries were detected** as gate posts (`fp_4`, `fp_8`): each
  opens with `VERDICTS:`, as the charter now requires. `cross-exam-plain`'s
  summary opened "Chair. …" and was missed.
- **The human decided and approved in their own posts** (`fp_5`, `fp_9`).
  "fix all three" decides without a separate agree/disagree per item. The
  agents recorded it as given, and nobody called it "item by item" (both
  earlier runs did).

## The fix, checked after the run

These checks were run by the operator's assistant against the archived
file, outside the run. They are not part of the record.

| check | result |
|---|---|
| every normal amount from −999.99 to 999.99 (199,999 values) | identical to the original, and all correct: no regression |
| rounding | consistent: `1.005` → 101 and `1.015` → 102 (the original gave 100 and 101) |
| garbage input (`abc`, `12,34`, `1e2`, `0x64`, `Infinity`) | throws `TypeError` (the original returned NaN, 1200, 10000, 0, Infinity) |
| `split` for every total −500…500 and 1–12 parts | always sums to the total; parts differ by at most 1 |

**Not fixed, or new:**
- `"-0.00"` still gives `-0` (signed zero).
- `"1."` now throws; the original read it as 1.00.
- Amounts above about 90 trillion lose precision: "exact" holds only within JavaScript's safe-integer range.
- Bad input now **throws** instead of returning a value. Callers would need to handle that; it is a breaking change.

The agents' claims hold as they scoped them: "breaks nothing I could find"
(`fp_7`), "normal amounts identical in both files" (`fp_8`). The skeptic
raised the signed zero and the new exceptions, but not `"1."` or very
large amounts.

## The voice, measured

`node tools/forum-legibility.mjs` over the three runs of this experiment:

| run | agent posts | agent words | references to chase | legal terms |
|---|---:|---:|---:|---:|
| [cross-exam](../cross-exam/README.md) (ea2400) | 13 | 3,704 | 139 | 116 |
| [cross-exam-plain](../cross-exam-plain/README.md) (ac886b) | 18 | 3,743 | 52 | 0 |
| **cross-exam-fix (bf5388)** | **6** | **1,778** | **1** | **0** |

## What went wrong

- **Rounds 4 to 8 were idle.** After the approval, the run went on to its
  last round, posing the human a card each round. #296 (`endWhenQuiet`,
  on for this charter) ends a run after the first full round with nothing
  new; this run predates it.
- **One false silence, from a bug.** In round 7 the human passed with "ok",
  as in earlier rounds. The pass landed. The agent loop then added its own
  "You are repeating the exact same tool call" nudge after the result. The
  page adapter only looked at the last message, missed the landed pass,
  and posed a fresh card, which timed out 15 minutes later and was counted
  as the run's one human timeout. Fixed in #297.

## Audit

| check | result |
|---|---|
| `auditor/audit.mjs`, each of the 4 sessions, with `--chain --annex --anchors --identities --roll --keyring --code --repo` | **conforming**, 0 findings. Chain verified; anchors, subject certificates and member countersignatures valid under the DEV keyring (no standing); code verified against `be8a7c7` |
| `node tools/community-brief.mjs docs/runs/cross-exam-fix --check docs/runs/cross-exam-fix/BRIEF.md` | pass (4 citations, 9 posts, 22 passes) |
| `sources/purse.js` at the end | sha256 `86e25ff2…`, identical to the charter's: the original never changed |

The session logs, the keyring and the workspace stay on the operator's
disk, as for every archive; the audit ran there.

## Honesty labels

- **Rehearsal standing only** (D-8): signed by the development keyring; nothing here enacts anything.
- **One run, one sample.**
- **The steps, the "Where we are" line and the stop are agent duties**, written in the briefing. Nothing in the runtime enforces them; here, the agents followed them.
- **The original stayed unchanged by agreement.** The sandbox would have allowed an edit; the final hash shows none happened.
- **The fix checks above are after-the-fact**, by the operator's assistant, not by the run.

## The plain version

- **What this is:** one person and three AI agents reviewed a small piece of
  money code, then fixed it.
- **How it went:**
  - **Review:** the person wrote what looked wrong in everyday words, and
    the agents confirmed all three problems with real tests.
  - **Your move, said plainly:** the chair's summary told the person
    exactly what was needed: pick what to fix.
  - **Fix:** the person said "fix all three". The agents fixed a copy,
    showed the results before and after, and the person approved.
  - **Time:** 13 minutes from the first post to the approval.
- **Is the fix good?** For every normal amount it behaves exactly like
  the original, and it fixes the rounding, the lost cents and the
  unchecked input. A few corner cases remain, listed above. One is a real
  change for anyone using the code: bad input now raises an error instead
  of returning a strange number.
- **What didn't go well:** the run kept going for five idle rounds after
  the approval, and once a glitch reopened the person's turn and counted
  it as missed. Both are fixed now (#296, #297).

**Terms:** *charter*: a run's setup (goal, seats, budgets); *gate*: the
condition the run needs to count as done; *the chair*: the member who
writes the summaries; *the copy*: `sources/purse.fixed.js`, where every
change went.
