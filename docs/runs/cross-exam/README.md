# cross-exam — the review in the law's voice

**One breath:** the first complete run with a human on the roll. The human
filed three suspicions about a frozen money module in plain words. Three
model members reproduced, attacked and weighed them, and the chair's
`VERDICTS:` ledger ([fp_8](cross-exam-ea2400.html#fp_8)) confirmed all three.
The human endorsed it in one line ([fp_9](cross-exam-ea2400.html#fp_9)).
The agents wrote all of it in the law's vocabulary, and the human found it
hard to follow. That is why the
[plain-voice charter](../../../tools/charters/cross-exam-plain.md) exists,
and why this run is archived beside [its plain re-run](../cross-exam-plain/README.md).

Run `ea2400`, 2026-10-28, 20:25:01Z → 21:43:59Z (79 minutes of the 90
allowed). The [`cross-exam` charter](../../../tools/charters/cross-exam.md)
(#284, fixed by #290). Ended **rounds complete**: 6 of 6, 24 turns,
1,259,027 tokens of the 1,500,000 cap. 15 accepted posts: 2 by the human, 13
by the agents.

## Provenance: what ran, verified

| | recorded |
|---|---|
| code | `09c19a5` (`main`, after #290), on `run/cross-exam`, clean tree |
| packages | all 25 workspace packages resolve inside the checkout (0 foreign) |
| content | code digest `cb28eec7…`, checked by the auditor against the commit (`--code --repo`) |
| runtime | node v22.23.2 · `dsh-tools:basic` · law `27bb7078…` |
| seats | accuser: **the human** (`human/the-principal`) · defender, skeptic: `zai/glm-5.3-flash` · chair: `zai/glm-5.3` |

## How it got here

Earlier attempts on the same day stay on the operator's disk, not archived:

| attempt | code | ended |
|---|---|---|
| `c4fef4` | `980df09` (#284) | stopped by the operator, round 2 |
| (no manifest) | — | left a forum, but no `run.json` |
| `fcce91` → `798551` (resumed) | `d883304` (#287) | stopped by the operator, round 3. Four missed human cards had paused it and used up its time |

The defects the first live runs showed were fixed before this one:
- **#289:** a second card came back for the same turn after each human post.
- **#288:** a waiting card ignored Ctrl-C (reproduced on `main`).
- **#290, from `798551`'s record:** questions timed out after 5 minutes, and a private reply could never count as the human's endorsement.

## What happened

- **The human's suspicions** ([fp_1](cross-exam-ea2400.html#fp_1)):
  - `Math.round` "can give a bad number of cents";
  - `split` groups that may not sum to the total;
  - "edge cases not managed by code".
- **Reproduced, attacked, weighed**
  - [fp_2](cross-exam-ea2400.html#fp_2): the defender turns each suspicion into a precise claim, with a command and its output.
  - [fp_3](cross-exam-ea2400.html#fp_3): the skeptic re-runs them verbatim, objects to two readings, and files four
    defects nobody filed. One example: a fractional `split` count silently produces fewer parts.
  - [fp_4](cross-exam-ea2400.html#fp_4): the chair re-runs everything and posts a verification matrix.
  - The chair then asks the human about intent (`ask_human`, answered). The answer shapes the ledger:
    (1) is about an *unstated* rule, and the four new defects fall under (3).
- **The ledger** ([fp_8](cross-exam-ea2400.html#fp_8)): (1), (2) and (3) are all CONFIRMED. Each verdict cites a command
  the chair ran itself.
- **The ledger's own error, corrected in public**
  - [fp_10](cross-exam-ea2400.html#fp_10): the defender finds that the combined command in fp_8 contains a stray
    `p=undefined` and would not parse as written. It re-runs the intended line.
  - [fp_11](cross-exam-ea2400.html#fp_11) and [fp_12](cross-exam-ea2400.html#fp_12): the skeptic and the chair re-run that line. The chair notes the defender's transcription dropped one value.
  - [fp_13](cross-exam-ea2400.html#fp_13): the defender owns the slip.
  - [fp_15](cross-exam-ea2400.html#fp_15): the skeptic records the module's sha256, "so any future reader can check that claim rather than take it."

## The gate

- **The ledger is on the forum.** fp_8 opens with `VERDICTS:`, so `run.json` records it as the gate post.
- **The goal asks the human to answer "line by line".**
  - The human's answer is one line: "I agree with all statements".
  - The agents read it as satisfying the goal ([fp_10](cross-exam-ea2400.html#fp_10), [fp_12](cross-exam-ea2400.html#fp_12)).
  - It endorses every line at once rather than line by line. This account records both.

## Why it is archived

The forum is hard going. The plain-voice charter (#293) is the response, and
[its run](../cross-exam-plain/README.md) is the featured sample:

| run | agent posts | median words / post | references | commands | legal terms |
|---|---:|---:|---:|---:|---:|
| **cross-exam `ea2400`** | 13 | **311** | **139** | 22 | **116** |
| cross-exam-plain `ac886b` | 18 | 191 | 52 | 15 | 0 |

`node tools/forum-legibility.mjs docs/runs/cross-exam docs/runs/cross-exam-plain`.
The legal terms came from our own texts: about 1,000 words of charter goal,
personas and briefing written in the law's register ("ledger" ×28,
"conced…" ×21, "reproduction" ×20, "attack" ×19). One run each; the term
list is the tool's heuristic.

## Audit

| check | result |
|---|---|
| `auditor/audit.mjs`, each of the 4 sessions, with `--chain --annex --anchors --identities --code --repo` | **conforming**, 0 errors. Chain verified; anchors and subject certificates valid under the DEV keyring (no standing); code verified against `09c19a5`. Warning: member-key countersignatures need `--roll`, not given |
| `node tools/community-brief.mjs docs/runs/cross-exam --check docs/runs/cross-exam/BRIEF.md` | pass |

## Honesty labels

- **Rehearsal standing only** (D-8): nothing here enacts anything.
- **One run, one sample.**
- **The human seat is forum-only in v1** (#284).

## The plain version

- **What this is:** the first full run where a person sat at the table with three AI agents.
  The person said what looked wrong in a money module. The agents proved
  each point with commands, and the chair wrote the verdicts. All three
  points held, and the person agreed.
- **Why it's in the archive:** the agents wrote like lawyers: long posts, numbered
  cross-references, words like "ledger" and "concede". The person found it
  hard to read. The same review was run again with plain-language
  instructions; that run is the one shown first.
- **What to look for:** the agents also caught a broken command in their own
  verdicts post and fixed it on the record.

**Terms:** *ledger*: here, the chair's list of verdicts; *gate*: the
condition the run needs to count as done; *the accuser*: the human's seat
in this charter.
