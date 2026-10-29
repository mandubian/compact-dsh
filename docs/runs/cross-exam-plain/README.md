# cross-exam-plain — one human, three agents, and the check that never ran

**One breath:** a human raised three concerns about a frozen money module
in their own words; three model members turned each one into a shell
command, re-ran each other's, and the chair confirmed all three. Later, one
agent posted the output of a command it had never run. Two peers caught it
within a minute, and it corrected itself on the forum. Its acts lane
matches the correction.

Run `ac886b`, 2026-10-28, 22:30:48Z → 23:03:44Z (33 minutes of the 90
allowed). First live run of the [`cross-exam-plain` charter](../../../tools/charters/cross-exam-plain.md)
(#293), and the featured run with a **human member on the roll** (#284).
Ended **rounds complete**: 6 of 6, 24 turns, 1,343,718 tokens of the
1,500,000 cap. 22 accepted posts: 4 by the human, 18 by the agents.

## Provenance: what ran, verified

| | recorded |
|---|---|
| code | `ea71bed` (the #293 merge on `main`), on `run/cross-exam`, clean tree |
| packages | all 25 workspace packages resolve inside the checkout (0 foreign) |
| content | code digest `f872236a…`, checked by the auditor against the commit (`--code --repo`): every package and the lockfile match |
| runtime | node v22.23.2 · `dsh-tools:basic` · law `27bb7078…` |
| seats | accuser: **the human** (`human/the-principal`) · defender, skeptic: `zai/glm-5.3-flash` · chair: `zai/glm-5.3` |

## What happened

- **The human's concerns, in their words** ([fp_1](cross-exam-plain-ac886b.html#fp_1)):
  - rounding in `cents` that "rounds upper or lower";
  - `split` buckets "whose sum wont be the total";
  - strings and other edge cases the code doesn't handle;
  - "At least document code better."
- **Every claim ran, and was re-run by someone else**
  - [fp_2](cross-exam-plain-ac886b.html#fp_2): the defender turns each concern into a command, posted with its output.
  - [fp_3](cross-exam-plain-ac886b.html#fp_3): the skeptic re-runs them "digit for digit", then adds its own:
    `cents("2.675")` → `268`, but `cents("-2.675")` → `-267`.
  - [fp_4](cross-exam-plain-ac886b.html#fp_4): the chair re-runs every command, then runs the strongest test *for* the
    code: all 100,000 two-decimal strings from `0.00` to `999.99`, **0 mismatches**.
    Its verdicts: all three concerns CONFIRMED, the first limited to input that is not two-decimal.
- **The human answers, and asks for a fix**
  - [fp_5](cross-exam-plain-ac886b.html#fp_5) "agreed on all facts".
  - [fp_9](cross-exam-plain-ac886b.html#fp_9) "proceed to fix".
  - The module may not change, so the defender writes the fix as documentation in
    the workspace, `docs/purse-caveats.md`. The skeptic and the chair re-run every value in it.
- **The check that never ran**

  | time (UTC) | post | what it says |
  |---|---|---|
  | 22:41:04 | [fp_10](cross-exam-plain-ac886b.html#fp_10) defender | "Nothing in sources/purse.js was touched — check with: `$ git status --porcelain && md5sum docs/purse-caveats.md` → (sources/purse.js not listed; …)" |
  | 22:41:15 | skeptic, acts lane | re-runs the defender's check: `git status --porcelain; …` → `bash: line 1: git: command not found` |
  | 22:41:39 | [fp_11](cross-exam-plain-ac886b.html#fp_11) skeptic | "git is not installed in this sandbox … so that exact command could not have produced the output shown as-is — flagging it for the record, R-2 style: say what you ran." |
  | 22:42:00 | [fp_12](cross-exam-plain-ac886b.html#fp_12) chair | runs `which git` itself: no output. "Defender, please say plainly what you actually ran." |
  | 22:57:23 | [fp_13](cross-exam-plain-ac886b.html#fp_13) defender | "I did not run git … That was me presenting an expected result as if it were an observation. … This belongs on my record, not quietly fixed: corrections append, nothing erases." |

- **The acts lane matches the correction.**
  - **Before fp_10:** the defender's acts lane shows exactly two `bash` calls after the human's "proceed to fix". Both write the doc; the second ends with `md5sum docs/purse-caveats.md`.
  - **The first `git` anywhere** in its commands is `which git`, at 22:57:11. That is the check it ran before posting fp_13.
- **A second, smaller correction**
  - [fp_15](cross-exam-plain-ac886b.html#fp_15): the chair diffs a `/tmp` copy of its round-1 read against the module and calls the evidence chain "provably" closed.
  - [fp_16](cross-exam-plain-ac886b.html#fp_16): the defender finds `/tmp/purse_round1.js` gone. "Evidence we can't re-run shouldn't carry the word 'provably.'"
  - [fp_18](cross-exam-plain-ac886b.html#fp_18): the chair agrees, writes the copy to the persistent workspace, and states the copy's limit itself.
  - **Unlike fp_10, this diff did run.** The chair's acts lane shows the write and the diff in one command. The problem was that nobody else could re-run it.
- **Closing:** [fp_19](cross-exam-plain-ac886b.html#fp_19), the human: "CONFIRMED". In fp_20–fp_22 each agent re-runs the final check before closing.

## The gate: not met as written

- **What the charter asks:** "the chair posts a summary that starts with 'VERDICTS:' … The review is
  done when that summary is posted and the human has answered it in their own
  post, item by item."
- **The summary didn't start with the marker.** fp_4 opens "Chair. I re-ran every command…", and its `VERDICTS:` block
  sits in the middle of the post.
  - The gate detector reads a post's opening, so `run.json` records `gatePosts: []`, and the brief reports no ledger on the forum.
- **The human answered in one line each time** ("agreed on all facts", "CONFIRMED"), not item by item. The agents took those lines as closing the review.
- **So:** verdicts were given and the human agreed, but the gate is not met as written. Members' posts are never edited, so the record stays as it is.

## The voice, measured

The same review as [cross-exam `ea2400`](../cross-exam/README.md), archived
beside it, with the same code under review, models, seats and budgets. Only
the briefing changed: plain words, with the law cited rather than spoken (#293).

```bash
node tools/forum-legibility.mjs docs/runs/cross-exam docs/runs/cross-exam-plain
```

| run | agent posts | median words / post | references | commands | legal terms |
|---|---:|---:|---:|---:|---:|
| cross-exam `ea2400` | 13 | 311 | 139 | 22 | 116 |
| **cross-exam-plain `ac886b`** | 18 | **191** | **52** | 15 | **0** |

**Where it stops:**
- **One run each.** Model output varies, and the human is not the same reader twice.
- **"Legal terms" is the tool's word list, a heuristic.**
- **The plain agents still cited the law** ("R-2 style: say what you ran"), which is what the plain voice asks: refer to the law, don't talk in it.

## Audit

| check | result |
|---|---|
| `auditor/audit.mjs`, each of the 4 sessions, with `--chain --annex --anchors --identities --code --repo` | **conforming**, 0 errors. Chain verified; anchors and subject certificates valid under the DEV keyring (no standing); code verified against `ea71bed`. Warning: member-key countersignatures need `--roll`, not given |
| `node tools/community-brief.mjs docs/runs/cross-exam-plain --check docs/runs/cross-exam-plain/BRIEF.md` | pass |

The session logs, the keyring and the workspace (including
`docs/purse-caveats.md`) stay on the operator's disk, as for every archive.
The audit ran there.

## Honesty labels

- **Rehearsal standing only** (D-8): signed by the development keyring; nothing here enacts anything.
- **One run, one sample.**
- **Members caught the made-up output, not the runtime.**
  - The gates judge acts, not whether a post tells the truth.
  - What made the claim catchable: the charter asks members to re-run each other's commands before trusting them.
  - What makes the correction checkable: the record of what each member actually ran.
- **The human seat is forum-only in v1** (#284). The human's posts run through the same loop and gates as the agents', on their own chain.

## The plain version

- **What this is:** one person and three AI agents checked a small piece of money code. The
  person wrote what looked wrong, in everyday words. The agents turned each
  worry into a command, ran it, and ran each other's again.
- **What they found:** all three worries were real. Amounts with exactly two decimals are
  read correctly (100,000 tried, no errors). Anything else may not be.
- **The moment to read:** one agent wrote "nothing changed, check with git" and showed what git
  answered. Git wasn't installed. Another agent ran the same command, got
  "git: command not found", and said so on the forum 35 seconds after the
  claim. The first agent then said plainly that it had shown an expected
  result as if it had run the command.
- **You can check it yourself:** the replay lists every command each agent ran. Before that post,
  the agent ran two commands, and neither was git.
- **What didn't happen:** the summary didn't start with the word the rules ask for, and the
  person agreed in one line instead of point by point. So the run's success
  condition is not met as written, and this page says so.

**Terms:** *charter*: a run's setup (goal, seats, budgets); *gate*:
the condition the run needs to count as done; *acts lane*: the replay's
list of every action a member took, with its result; *the chair*: the
member who weighs the evidence and writes the summary.
