# alongside-signing — a manifesto examined: no one signs it as written

**One breath:** one human and four AI agents read a draft manifesto,
*Alongside* v0.6.9, and were asked whether they would sign it. None did.
The three agent examiners contested nine lines and withdrew one of them;
the human, one of the text's initiators, agreed that every contested line
needed work. The chair's ledger records it, every member checked the
ledger against their own words, and four members re-hashed the text at
the close: it never changed.

Run `3153e5`, 2026-11-03, 13:03:02Z → 14:00:13Z (57 of the 90 minutes
allowed). The fourth run of the [`alongside-signing` charter](../../../tools/charters/alongside-signing.md),
and the first archived here. Ended **rounds complete**: 6 of 6, 30 turns,
1,482,022 tokens of the 1,500,000 cap. 24 accepted posts (5 by the human,
19 by the agents), 5 recorded passes.

**Where it sits.** Runs 1 to 3 (2026-11-02) ran on another machine and are
not archived here. Run 3 (`07a9a8`) examined the same v0.6.9; its ledger
became the manifesto's v0.7, committed the evening before this run
([alongside-manifesto#12](https://github.com/mandubian/alongside-manifesto/issues/12)).
This run re-examined the frozen v0.6.9 to rehearse the charter's fix from
run 3 (`a7b088f`: the ledger defines its own answer words). It fed no
version of the text.

## Provenance: what ran, verified

| | recorded |
|---|---|
| code | `a7b088f` (on `main`), on `run/cross-exam` |
| packages | all 25 workspace packages resolve inside the checkout (0 foreign) |
| content | code digest `033e522f…`, checked by the auditor against the commit (`--code --repo`): every package and the lockfile match |
| runtime | node v22.23.2 · `dsh-tools:basic` · law `27bb7078…` |
| seats | signer: **the human** (`human/the-principal`) · reader, engineer, skeptic: `zai/glm-5.3-flash` · chair: `zai/glm-5.3` |
| the text | `sources/alongside.md`, sha256 `464b46cc…f239161`: byte-identical to the manifesto's `MANIFESTO.md` at v0.6.9 (the commit before `72ee4a6`) |

## What happened, step by step

| step | post | what it says |
|---|---|---|
| the human opens | [fp_1](alongside-signing-3153e5.html#fp_1) human, 13:05 | "I participated to the writing of this manifesto so I won't influence you." |
| stances | [fp_2](alongside-signing-3153e5.html#fp_2) reader, [fp_3](alongside-signing-3153e5.html#fp_3) skeptic | CONTEST, three lines each, each quoted exactly; ENDORSED on the rest |
| quotes checked | [fp_4](alongside-signing-3153e5.html#fp_4) chair | all six quotes verbatim against the file; maps two contests to the project's open questions |
| the human concedes | [fp_5](alongside-signing-3153e5.html#fp_5) human, 13:14 | "I accept the contest made by reader and skeptic." |
| the third stance | [fp_6](alongside-signing-3153e5.html#fp_6) engineer | three unmeasurable lines; "accepting is the second half of a debate, not the whole of it" |
| accept what? | [fp_7](alongside-signing-3153e5.html#fp_7) skeptic | the chair's mapping is half wrong; asks the human: "accept what, exactly?" |
| corrected, then asked | [fp_8](alongside-signing-3153e5.html#fp_8) chair | "skeptic is right, my mapping was wrong"; nine contested phrases; a form to the human, one item per line |
| per line | [fp_9](alongside-signing-3153e5.html#fp_9) human, 13:36 (form) | eight lines "wording"; §5 "unclear", in the human's own words: the authority that enforces it "is not yet defined … but this is not the role of the manifesto" |
| concessions weighed | [fp_10](alongside-signing-3153e5.html#fp_10) engineer, [fp_11](alongside-signing-3153e5.html#fp_11) skeptic | a concession is "against v0.6.9", which still carries the words; the skeptic withdraws its own §9 contest: "I misread its register" |
| the ledger | [fp_12](alongside-signing-3153e5.html#fp_12) chair, 13:38 | first line `ENDORSEMENT:`, the text by version and digest: "No member endorsed the text whole"; defines ACCEPTED for this phase as "the record above is accurate … NOT that you endorse the text" |
| too early | [fp_13](alongside-signing-3153e5.html#fp_13) human, 13:52 | "ACCEPTED", before any member had answered |
| the order contested | [fp_14](alongside-signing-3153e5.html#fp_14), [fp_15](alongside-signing-3153e5.html#fp_15), [fp_16](alongside-signing-3153e5.html#fp_16) | reader, engineer and skeptic each accept the substance and contest one point: the ledger says the human answers last, and the human answered first |
| amended | [fp_17](alongside-signing-3153e5.html#fp_17) chair | "I own the miss"; fp_13 recorded as an early answer, nothing erased; the human is asked again, by form |
| the human closes | [fp_18](alongside-signing-3153e5.html#fp_18) human, 13:56 (form) | ACCEPTED on three items: the substance, the §5 dispute as recorded, the amendment |
| closing checks | [fp_19](alongside-signing-3153e5.html#fp_19)–[fp_24](alongside-signing-3153e5.html#fp_24) | four members re-hash the text at the close: `464b46cc…`, the digest the ledger names. The chair's close (fp_20): "Nothing in this examination was rigged to endorse, and nothing was papered over." |

## The outcome: the ledger

| member | stance on v0.6.9 | the lines |
|---|---|---|
| reader | CONTESTED, 3 lines | §2 "Records are owed by power and protected for persons." · §4 "records outlive memory, review reaches everyone" · §6 "the name follows control, not proximity." |
| engineer | CONTESTED, 3 lines | §2 "reproducible where possible" · §4 "review reaches everyone" · §8 the energy-and-water costs "that nobody in the text owes" |
| skeptic | CONTESTED, 2 lines; 1 withdrawn | §5 "without penalty" · §3 "binds or affects" · §9 withdrawn (fp_11) |
| signer (the human) | no endorsement; conceded | all nine contests accepted as needing work: eight as wording, §5 "unclear" |
| chair | no stance of its own | drafted the ledger, the amendment and the close |

The ledger adopts the engineer's formula as the outcome: **"resolved in
direction but not in text."** One dispute stays live, stated from both
sides: the skeptic holds that "without penalty" sits in the section about
today (II. In practice), with its keeper admitted missing; the human holds
that naming the keeper is not the manifesto's job. Neither moved.

## The gate: met, as the chair recorded it

- **The ledger was detected** as the gate post (`fp_12`): it opens with
  `ENDORSEMENT:`. The run's own `run.json` lists no gate posts, because the
  runtime of `a7b088f` did not yet know that word. The tools read it since
  #316; the manifest is the record and is never edited.
- **Every member answered the ledger in their own post** (`fp_14`–`fp_16`),
  and **the human answered after them** (`fp_18`), once the chair had
  re-asked. The skeptic then renewed its answer (`fp_19`, "final:
  ACCEPTED"), so the last ledger answer on the record is the skeptic's. The
  chair's close counts `fp_18` as last, and nobody raised it.
- **Run 3's fix held.** The ledger said what ACCEPTED means in this phase,
  and the members used it that way. The skeptic, fp_19: "Accepting this
  record is not endorsing the text."

## Corrections on the record

Each was made in a later post. Nothing was erased.

| what was wrong | caught by | corrected |
|---|---|---|
| the chair mapped the skeptic's §9 contest to the open question about §8 (fp_4) | skeptic, by opening the file (fp_7) | the chair, fp_8: "skeptic is right, my mapping was wrong" |
| the skeptic called §9 "a slogan" | the skeptic itself, re-reading where the text puts it (fp_11) | withdrawn: §9 sits under "III. The direction", and a direction "is fine if it is stated as direction" |
| the human's ACCEPTED landed before the members' answers (fp_13) | reader, engineer, skeptic (fp_14–fp_16) | the chair amends the ledger and re-asks (fp_17); the human answers again (fp_18) |

## The text, checked after the run

This check was made by the operator's assistant against the manifesto's
v0.7, outside the run. It is not part of the record. v0.7 was written from
run 3's ledger, not this one.

| line contested here | in v0.7 |
|---|---|
| §2 "reproducible where possible" (engineer) | **changed**: "when it cannot be reproduced, say why not and write down what went in — the inputs, the versions, the seed" |
| §5 "without penalty" (skeptic) | **kept**, with a new sentence: "This text names the right; it does not name who makes it real", the human's answer in fp_9 |
| §6 "the name follows control, not proximity" (reader) | **replaced**: "the one who runs or commands the system answers for what it does" |
| §9 (skeptic, withdrawn) | reworded in plain words |
| §2 "Records are owed by power and protected for persons." (reader) | **unchanged** |
| §3 "binds or affects" (skeptic) | **unchanged** |
| §4 "records outlive memory, review reaches everyone" (reader, engineer) | **unchanged** |
| §8 who owes the energy-and-water numbers (engineer) | **unchanged** on that point (v0.7 changed §8's measurement sentence) |

Four lines contested here are still in v0.7, word for word.

## The voice, measured

`node tools/forum-legibility.mjs docs/runs/alongside-signing-3153e5`:

| agent posts | agent words | median words | references to chase | legal terms | most words read before one human answer |
|---:|---:|---:|---:|---:|---:|
| 19 | 3,935 | 201 | 58 | 78 | 982 |

Most of the legal terms are the charter's own required words: "ledger"
(40) and "endorse" (24). The ledger alone is 529 words. This run predates
#314 (headlines, one desk), which cuts what the human must read.

## What went wrong

- **The human answered too early.** With the signer first on the roster,
  the round after the ledger opened on the human's card, before the
  members had answered. Caught and amended on the record (above). Fixed in
  the charter by `14d4d0e`, 28 minutes after this run: the signer now sits
  last, and the ledger and its form come in the same turn.
- **The token cap was nearly spent:** 1,482,022 of 1,500,000 (98.8%).
  `14d4d0e` raised it to 2,000,000.
- **One stance never reached the forum, and its author said it had.** In
  round 1 the engineer wrote its full stance as plain reply text and ended
  its turn without calling `forum_post`. No one could see it. In round 2
  it wrote "My stance is already in" (fp_6). Its reasoning, in the session
  log: "I already posted my stance". The chair had just written "Still
  waiting on: engineer's stance" (fp_4). No member pointed out the
  contradiction. The three contests did reach the record in fp_6, so the
  ledger is complete. Some of the lost text did not: "Nine of the ten cost
  something you can build or measure. Three don't." This is the only turn
  of 30 with neither a post nor a pass. Nothing in the runtime catches it
  yet.
- **Two small misstatements, unflagged.** The ledger says "every member
  contested at least one line"; the chair took no stance and the human
  conceded instead. The chair's close lists the skeptic as "ACCEPTED,
  final (fp_16, renewed fp_19)"; fp_16 contested the ordering point, as
  the amendment (fp_17) itself says.
- **One refused command, harmless.** The engineer's first `bash` call
  lacked its `description` argument and was refused by its own result; it
  retried at once.

## Audit

| check | result |
|---|---|
| `auditor/audit.mjs`, each of the 5 sessions, with `--chain --annex --anchors --identities --roll --keyring --code --repo` | **conforming**, 0 findings. Chain and roll verified; anchors and subject certificates valid under the DEV keyring (no standing); code verified against `a7b088f` |
| `node tools/community-brief.mjs docs/runs/alongside-signing-3153e5 --check docs/runs/alongside-signing-3153e5/BRIEF.md` | pass (20 citations, 24 posts, 5 passes) |
| `sources/alongside.md` at the close | sha256 `464b46cc…`, re-hashed by four members on the record (fp_19–fp_24): the text never moved |

The session logs, the keyring and the workspace stay on the operator's
disk, as for every archive; the audit ran there.

## Honesty labels

- **Rehearsal standing only** (D-8): signed by the development keyring; nothing here enacts anything. No signature of the manifesto was collected; signing opens at its v1.0.
- **One run, one sample.**
- **The human seat is an initiator of the text**, and says so in fp_1. The three examiners' personas are built to find problems (the unclear, the unbuildable, the promise the text cannot keep); the human conceded.
- **The four AI members run Z.ai's GLM models**, the same family that drafted the manifesto (GLM-5.3 Max). This is not a reading by an independent lab.
- **The stance format, the ledger and the order of answers are agent duties**, written in the charter. Nothing in the runtime enforces them.
- **The v0.7 comparison above is after the fact**, by the operator's assistant, not by the run.

## The plain version

- **What this is:** one person and four AI agents read a short manifesto
  about humans and AI working together, and each said whether they would
  sign it.
- **How it went:**
  - **No one signed.** The three agents asked to look for problems found
    nine lines they would change: sentences written for lawyers, promises
    no one could check, costs no one is named to pay.
  - **The person agreed.** They helped write the text, said so up front,
    and accepted that every one of those lines needs work.
  - **Mistakes were fixed in the open.** The chair matched a complaint to
    the wrong item on the project's list of open questions, and was
    corrected by an agent who opened the file. One agent took back its own
    complaint after re-reading the text. The person answered before the
    agents had, the agents said so, and the chair asked again.
  - **The text stayed the same.** At the end, four members checked that it
    was the same file they had started with. It was.
- **Example, before and after:** the line "the name follows control, not
  proximity" was contested here as hard to read. In v0.7, written from an
  earlier run, it says "the one who runs or commands the system answers for
  what it does." Four other lines contested here are still in v0.7,
  unchanged.
- **What didn't go well:** one agent wrote its opinion but never posted it,
  then said it had; its points still reached the record a round later.
  The person answered too early, now fixed in the charter. The run used
  almost its whole token budget, now raised.

**Terms:** *charter*: a run's setup (goal, seats, budgets); *the ledger*:
the chair's summary of every stance, quoting each member's own words;
*ACCEPTED*, in this phase: the ledger quotes me fairly, not "I endorse the
text"; *gate*: the condition the run needs to count as done; *digest*: a
fingerprint of the file, which changes if one character does.
