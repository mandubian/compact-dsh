# The agent-tongue deliberation, archived at the token cap

**One breath:** run `1e393c` of the [agent-tongue charter](../../../tools/charters/agent-tongue.md)
— five members re-deliberating the machine-first inter-agent-language
record — ended at the token cap (2,065,950 of 2,000,000) in round 5 of
10, after 21 governed turns, with the accepted verdicts and every
remaining disagreement stated precisely on the forum, and with the
attempts that did not land named in `BRIEF.md`. This directory is that
state, frozen.

## The precise version

- **What is here** — the public record, nothing else:

  | file | what it is |
  |---|---|
  | `agent-tongue-1e393c.html` | the self-contained export (community-export) — the forum in full, each member's acts timeline, the run header; open it in any browser, forever |
  | `BRIEF.md` | the derived reading aid (community-brief) — counts, the latest accepted ledger, **speech that did not land**, and **pass calls** (none in this run). Not a record act; the forum and chains remain the authority |
  | `run.json` | the manifest at the cut: `token cap: 2000000`, round 5/10, 21 turns, per-member turn counts — and the model, `zai/glm-5.3-flash` for all five, backfilled from the run's own session logs (`modelProvenance` names itself; the driver predated the model field) |
  | `chains/forum.jsonl` | the deliberation ledger — 20 posts, fp_1–fp_20, including the recorder's three ledger revisions (fp_10, fp_14, fp_18) and the closing containment exchange (fp_19–fp_20) |
  | `chains/*.chain`, `chains/*.sigs.jsonl`, `chains/subjects.jsonl` | the five members' hash-chained governed acts and their signatures — the tamper-evident layer under the speech |

- **A renderer repair, recorded (2026-10-24):** this export was generated
  by an early `community-export` whose renderer sliced the timeline's
  epoch-millisecond timestamps as strings — the first act threw, and the
  acts and members panes rendered empty behind a forum that looked fine.
  The embedded renderer is patched in place over the same embedded data;
  nothing on the record changed, and no pane is empty now. The export
  cannot be regenerated (the session logs it was built from are
  deliberately not public, above), which is why the fix is a repair
  rather than a re-export.
- **What is deliberately NOT here** (this repository is public): the
  rehearsal keyring (private practice keys), the session logs (2.3MB,
  internal), the storages, the scratch settings. Continuation runs from
  the operator's live run directory, which retains all of it.
- **Where the record tells its own story:** fp_18 is the verdict board
  (P1–P5 amended along named lines, P6 endorsed-as-amended unanimous);
  fp_19–fp_20 are the last exchange — verifier's containment amendment
  (the adoption boundary sits *inside* the answerability boundary),
  accepted by empiricist within one round. Live at the cut: (1) 3–1,
  (3) 3–1, (7) two-member with a named falsifier, and P1's
  compiler-answerability clause held by two voices against protocolist's
  attempted-but-denied posts (the LoopGuard correction below; `BRIEF.md`
  puts the ledger and the timeline side by side).
- **What the ledger cannot show — the LoopGuard correction.** The forum
  ledger records **accepted** speech, not every attempt. The export's
  timeline records ten `forum_post` calls that did not become posts.
  Six carry an immediate `LoopGuard` notice: `protocolist` accounts for
  four (`LG-3`, 22:03:12, 22:06:46, 22:09:33, 22:12:22), `latentist`
  for one (`LG-5`, 22:10:10), and the recorder's revision 4 for one
  (`LG-5`, 22:11:46). `protocolist`'s `ask_human` at 22:09:42 was denied
  by the same `LG-3` notice. The remaining four attempts have no
  immediate LoopGuard notice in the export; `BRIEF.md` names them as
  unmatched, not as LoopGuard-denied. **The correction in one sentence:**
  `protocolist` did not choose silence; it kept trying to post after
  `fp_4`, and the run's loop guard refused every attempt.
- **Honesty labels carried over:** rehearsal standing only (D-8) — the
  development keyring signed everything, this run enacts nothing; one
  model route (`zai/glm-5.3-flash`) seated all five members, so the
  disagreement came from personas and the record, not from different
  weights.

## The plain version

- **What this is:** the whole debate, saved at the moment the budget ran
  out — every post, who signed what, and the exact list of what was
  still open. Open the HTML and you are reading the run.
- **The silence correction, in plain words:** the ledger's absence
  paragraph said `protocolist` had gone quiet. That is true of **accepted
  posts**, not of **attempts**. It tried four more times; each call was
  refused before it could become a post. The brief shows both sides:
  ```bash
  node tools/community-brief.mjs docs/runs/agent-tongue \
    | sed -n '/Speech that did not land/,/ask_human/p'
  # before (forum.jsonl only): 20 accepted posts; protocolist's last is fp_4
  # after  (ledger + export timeline): 4 more attempts, each with an immediate
  #        LoopGuard LG-3 notice — attempted speech, not chosen silence
  ```
  The brief is a reading aid, not a record act; it does not change the
  ledger or turn an attempt into a post.
- **What it is not:** a finished deliberation. The last post says what
  each side still owed; the budget, not the members, ended it.
- **To continue it:** the run directory on the operator's disk is the
  live thing — this copy is the reading copy.

## Continuing the run

```bash
node tools/community-live.mjs --charter tools/charters/agent-tongue.json \
  --out ~/community-runs/agent-tongue
```

The keyring is reused, the forum replays from its chain, and each
member's briefing says the conversation continues — it does not start
over. Budgets are fresh; at this run's burn (~98k tokens per turn)
expect on the order of 1–2M tokens to reach closure. Pending on the
record, already addressed to their addressees: latentist's endorsement
of the containment sentence, and protocolist's four open questions. The
answers protocolist attempted in this run were denied by LoopGuard; they
are not accepted posts, so the questions remain open on the accepted
record. A resumed run's manifest records its own model natively (PR #248).
