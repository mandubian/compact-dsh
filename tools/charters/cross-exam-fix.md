# cross-exam-fix — review, then the human decides, then a fix

**One breath:** the plain review of `cross-exam-plain`, followed by a
real fix step. After the review summary, the human says which confirmed
problems to fix; the agents fix them in a copy of the file, test the copy
against the original, and the human approves or rejects each fix.

## The precise version

- **Why:** in `cross-exam-plain-1` (2026-10-28) the human asked to
  "proceed to fix", but the charter was review-only: the code could not
  change. The agents wrote a caveats file instead, then spent three
  rounds proving the code was untouched. The human, meanwhile, could not
  tell whether to give a verdict or keep arguing. This charter makes the
  fix a real step and says each step aloud.
- **The steps**

  | step | who | what | ends with |
  |---|---|---|---|
  | 1. Review | human, then agents | concerns in plain words → shortest commands with real output, rerun by another agent | the chair's review summary: first line `VERDICTS:`, CONFIRMED / REJECTED per concern |
  | 2. The human decides | human | agree / disagree per item, and which confirmed problems to fix | the human's own post |
  | 3. Fix | defender, skeptic, chair | the fix in `sources/purse.fixed.js` (the original never changes); the same commands run against both files, plus normal amounts | the chair's fix summary: first line `VERDICTS:`, FIXED / NOT FIXED per chosen problem, both outputs |
  | done | human | approve / reject each fix | the human's own post; then the agents pass |

- **What the `cross-exam-plain-1` run taught, written into the briefing**
  - **The stage, said aloud:** when the next step needs the human, the
    chair's post opens with "Where we are: … What we need from you: …".
  - **Summaries the tools detect:** each summary's first line is exactly
    `VERDICTS:`, with nothing before it. In plain-1 the summary opened
    "Chair. …", so the gate detector missed it.
  - **The human's answers as given:** a short "agreed" is recorded as a
    short "agreed", never relabelled "item by item". Both earlier runs did
    relabel it.
  - **No workarounds:** a request outside the steps gets one sentence on
    what is possible instead.
  - **A stop:** once the human has answered the fix summary, the agents
    pass.
- **What is the same as `cross-exam-plain`:** the plain voice, the code
  under review (byte for byte), the people at the table and their models,
  the timeouts and divergence lines. **Different:** the three steps,
  `sources/steps.md` instead of `concerns.md`, the topic `purse-fix`, and
  a larger budget for the extra step (8 rounds, 120 minutes, 2M tokens).

```bash
NODE_USE_ENV_PROXY=1 node tools/community-live.mjs \
  --charter tools/charters/cross-exam-fix.json \
  --out ~/community-runs/cross-exam-fix-1

node tools/forum-legibility.mjs ~/community-runs/cross-exam-plain-1 ~/community-runs/cross-exam-fix-1
```

**Honesty labels**
- **Agent duties, not machinery:** the steps, the "Where we are" line and
  the stop are written in the agents' briefing. Nothing in the runtime
  enforces them yet.
- **The original stays the same by agreement:** the sandbox would allow
  an edit to `sources/purse.js`. A changed hash would show it.
- **One run is one sample.** Rehearsal standing only (D-8).

## The plain version

- **Before:** you asked for a fix in a review that couldn't change
  anything. The agents improvised, and you couldn't tell whether they
  were waiting for your verdict or still arguing.
- **After:** three named steps. The agents check your concerns and the
  chair posts a summary. You say "agree" or "disagree" per item and pick
  what to fix. The agents fix a copy, show you the before and after for
  each item, and you approve or reject. Whenever it's your move, the
  chair's post says so in its first line.
- **Unchanged:** `cross-exam` and `cross-exam-plain`, which stay as they
  were for comparison.

**Terms:**
- *Review summary / fix summary:* the chair's two `VERDICTS:` posts.
- *The copy:* `sources/purse.fixed.js`, where every change goes.
