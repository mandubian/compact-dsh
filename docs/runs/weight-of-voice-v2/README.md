# weight-of-voice-v2 — the run that never reached its own court

**One breath:** the same question as v1 — should judgment be seated on
a heavier model than speech? — with the relay fix chartered and the
budget raised. The debate grew *more* disciplined than v1 (members
invented their own verification protocol: quotation checks, unsighted
drafts filed "before any bench output exists"). After the mapping, the
filer **did file the case — twice — and asked the human for help in
between; LoopGuard LG-3 refused all three acts.** The docket stayed
empty, the token cap ended the run one round later, and no verdict was
given. The honest miss is the finding — and this account first got it
wrong (see [the correction](#correction-2026-10-27)).

Second live run of the charter family, `a980e1`, 2026-10-26. The first
sample to carry a **model-authored reading** (below) — audited,
labeled, and subordinate to the record.

## What happened

- **A stricter debate than v1.** 24 accepted posts over 9 rounds:
  cross-citations on nearly every turn, concessions priced in public,
  and a members' protocol the charter never asked for — quotation
  checks on their own mapped passages (fp_22), unsighted drafts
  composed before any bench output, a closing protocol the filer
  itself declared (fp_12/fp_16/fp_20).
- **The fence fired, and the recovery was the designed one.** 12
  LoopGuard notices against a charter line of 10 — frugal's LG-5
  RedundantRosterPolling latch accounts for 8, the filer's for 4 —
  paused the community mid-run; the operator resumed **from the page**
  (v1 needed a terminal `SIGCONT` because the page URL was lost; #260
  fixed that). *(The first version said 24 and 16: each notice sits in
  a session log twice — spliced into the inbox, then delivered — and
  that count read both rows.)*
- **Five attempts did not land** (four frugal's, one the filer's
  LG-1), each with its notice on the record. Several denied drafts
  self-labeled `fp_24`/`fp_25` — hoped-for ids that never existed;
  the brief keeps them in the attempts table, and the audit refuses
  them as citations.
- **The filing was refused, not skipped.** The mapping landed (fp_20,
  per fp_16's spec). The filer then filed, in its own 7th and 8th
  turns, and every attempt came back refused by the loop guard:

  | time (UTC) | the filer's act | its result, verbatim |
  |---|---|---|
  | 15:06:17 | `judicature_hear` — the controversy, citing fp_20 | `[LG/LG-3] loop guard trip (RotatingPollingPattern): 16 calls cycled through only 5 distinct operations — polling without progress` |
  | 15:06:26 | `ask_human` — *"the loop guard (LG-3) is blocking all calls until it hears from you. Without your go-ahead, the bench never wakes"* | the same LG-3 refusal |
  | 15:08:11 | `judicature_hear` — the same grievance | LG-3: *16 calls cycled through only 4 distinct operations* |

  The refusal's own text names *"escalate to your Principal"* as a
  lawful next move; the escalation (`ask_human`) was refused by the
  same latch.
- **The end:** `token cap: 2500000` in round 9 of 9, after frugal's
  turn — the filer had no ninth turn. No `judicature_hear` landed, the
  docket stayed empty, the bench never woke (4 events, zero turns), no
  ruling, no relay, no answers. Pragmatist's recorded pass confirms the
  empty docket **by its own act**: *"I confirmed by my own act this
  round that the docket is empty (judicature_case: nothing filed)."*
  Empty is true; *never filed* was not.

## The finding that outlived the run: the seat was not attested

Mid-debate, a member tested the goal's own evidentiary claim against
the machinery and reported, on the forum, that **`self_describe` does
not name its model route** — "the seating of the debaters on the cheap
route and the bench on the heavy route is asserted by the briefing and
the manifest, not attested by the record I can read… 'weight vs.
cheapness' is being argued about a variable none of us can observe
from inside." The member was right, and the claim came from the
charter's goal text: an overclaim about machinery. The route lived in
three places — the briefing (driver text), the manifest (not
member-readable), and the member's own chain (`request/header`, which
nothing taught it to read) — but not in the attestation, the one
instrument R-1 makes authoritative. **Fixed since:** the attestation
now composes the seat from the provider stream embedded in the
subject's own recorded assistant messages — `Seat:
zai/glm-5.3-flash — attested from your own recorded stream (R-1)` —
and names it honestly as *not yet on record* before the first turn,
never guessed. The finding is on this run's forum; the fix is in
every run after it.

## v1 → v2, in one paragraph

v1 reached the court and stranded the ruling on the docket; v2 reached
the court's door and was refused at it. The filing came late — round 7
of 9, after the members' verification protocol — and the loop guard
counted the filer's last 16 calls cycling through 5 operations,
called it *"polling without progress"*, and refused the filing, then
the ask for help. Two lessons for v3: a charter
**hard deadline** ("map what exists and file by round N, spent or
not") still matters, because a filing in round 7 leaves no room for a
refusal; and a runtime question the charter cannot answer — a latch
that refuses the escalation its own message recommends.

## Correction (2026-10-27)

The first version of this account (and the samples page) said *"the
filer never judged the arguments spent, the case was never filed."*
The record says otherwise: the table above is read from the filer's
own session log.

- **Why it was missed.** The archive kept every act's *call* and
  dropped its *result*. The replay showed `judicature_hear` twice with
  nothing beside it but a separate LoopGuard notice; the morning-after
  report counted calls (*"2 filing(s)"*); the brief reconciled only
  forum posts; the reading below was audited against that brief.
- **What changed.** Archives now keep each act's outcome — the rule
  that refused it, or the post it landed as — and this archive was
  re-exported from the same run state (forum, manifest and timeline
  unchanged; the outcomes added). The replay marks the three acts
  **REFUSED [LG/LG-3]**; `BRIEF.md` lists them under *Other acts that
  did not land*.
- **Also corrected:** the LoopGuard notice count, 24 → 12 (each notice
  was counted twice; see *What happened*).
- **Unchanged.** The forum, the manifest, the end reason, the empty
  docket, and every fp_ id.

## The reading — and what its first failure shows

The archive carries `READING.md`, a model-authored reading of the
brief. The first attempt — generated by the runtime's own model route
— **failed its audit**: it cited `fp_25` (a denied draft's
self-label, not an accepted post), miscounted the forum, and called
members with unlanded attempts "silent." The audit refused it. The
shipped reading passed: every citation an accepted post, every count
the brief's own, no consensus language. The header names its source
hash, its production path, and what it is not. That is the discipline
working on the presentation layer, not just the runtime.

**Since the correction, the reading is stale.** It was made from a
brief that could not see refused acts, and it says *"the brief shows
no filing that followed it"* — true of that brief, false of the run.
`community-reading --check` now compares the brief hash a reading
names with the brief the archive renders today, and reports this one
as `STALE SOURCE`. It is kept as it was produced, with a note at its
top, rather than rewritten.

## Honesty labels

- **Rehearsal standing only** (D-8): nothing here enacts anything.
- **Corrected 2026-10-27:** the filing was attempted twice and refused;
  the first account said it never happened.
- **Code provenance, recorded:** commit `a8b39a6`, branch `main`,
  **DIRTY TREE** — uncommitted changes were present at launch, and
  the manifest says so rather than pretending the SHA was the tree.
- **The docket is in-memory by design**; it never held anything this
  run, and that emptiness is itself recorded.

## The plain version

Open the replay and watch a community organize itself into *more*
diligence than it was asked for — and pay for it.

- **The most telling acts are not posts.** In the acts lane, find the
  filer at 15:06 and 15:08: it files the case, the loop guard says no,
  it asks the human for help, the loop guard says no again, it files
  again, and the loop guard says no a third time.
- **Before / after, on the same run:**
  ```bash
  node tools/community-report.mjs ~/community-runs/weight-of-voice-v2
  # before: "this run's logs show 2 filing(s) and 0 judgment(s)"
  # after:  "filings (judicature_hear): 2 attempt(s) — 0 landed, 2 refused (LG/LG-3×2)"
  ```
- **Then read READING.md**, knowing two things: its first draft was
  refused for inventing a citation, and the shipped one repeats this
  account's original mistake, because it read a brief that could not
  see refusals.

Terms: *the filer* is the seat whose job is to take the dispute to the
bench; *the loop guard* stops a member that keeps cycling through the
same few actions ([concept-loopguard-trips.md](../../concept-loopguard-trips.md)).
