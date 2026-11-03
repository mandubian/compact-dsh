# alongside-signing — a community examines the manifesto and decides

**One breath:** one human and four AI members read *Alongside* v0.6.9
whole — the exact text, frozen in the workspace with its sha256 — and
each posts a stance in plain words: ENDORSE, or CONTEST naming the
line and the reason. The chair's `ENDORSEMENT:` ledger quotes one
sentence of each contest and states unresolved disagreement precisely.
A community that cannot endorse is a valid outcome, recorded as such.

The promised form, run: `SIGNATORIES.md` in the manifesto's repo plans
"endorsement by deliberation — a community of humans and AI members
examines the manifesto and endorses (or contests) it on a public,
auditable record," and calls it the stronger form of signature. This
charter is that sentence, executed, inside the manifesto's open
comment period.

## The precise version

- **The text is frozen, and its name is exact.** `sources/alongside.md`
  is the manifesto byte-for-byte at v0.6.9 (sha256
  `464b46ccc1cea6de3fda7329b39005cc9f3ba31ab0cbea8b63b5b06fcf239161`);
  the briefing orders members to quote it by its words, never by
  memory, and to check each other against the file. The endorsement
  binds to that digest — a later v1.0 signs again or doesn't.
- **The glossary is reference, not text.** `sources/concepts.md` is
  the project's own CONCEPTS.md (sha256 `a452cf8ef2cc1471…`),
  provided like a dictionary: read it when a word puzzles you — but
  the signature covers `alongside.md` only, and the briefing says so.
  *"The plain text needs a glossary to be understood"* remains a
  contestable point, exactly the everyday reader's finding. QA is
  deliberately absent: its arguments would answer the members'
  questions before they ask them.
- **The seats:**

  | member | model | carries |
  |---|---|---|
  | `signer` | **the human** | one of the initiators, seated as just a member — no last word on content, the last word on their own answer |
  | `reader` | glm-5.3-flash | the everyday reader: contests jargon and overreach |
  | `engineer` | glm-5.3-flash | the builder: contests what is unbuildable or unmeasurable |
  | `skeptic` | glm-5.3-flash | doubts the exercise: hunts the promise the text cannot keep |
  | `chair` | **glm-5.3** | drafts the `ENDORSEMENT:` ledger, quotes verbatim, never invents consensus; the human's desk |

- **Contest is a first-class outcome.** The briefing says so in words:
  an examination rigged to endorse is theater. `sources/questions.md`
  carries the project's own eleven open questions — contesting one is
  welcome, and lands in the record the comment period reads.
- **Plain voice** (cross-exam-plain's lesson, kept): no clause numbers,
  no legal vocabulary — the ledger must read the way people talk.
- **The gate:** `ENDORSEMENT:` posted (first line exactly), every
  member answers it — ACCEPTED or CONTESTED — the human answers last.
- **The signer's answer is collected with `decision_form`, never
  `ask_human`** (the signing-2 finding): an `ask_human` answer is
  private and never counts as the signer's forum answer, so asking
  privately asks twice — the human answers the card, then still owes
  the floor post. The form's answers are drafted as the signer's next
  floor post automatically; posting it IS the answer. The floor
  timeout for this charter is 30 minutes: ledger-sized reading takes
  a human half an hour, and the honest silence is not a deadline to
  squeeze thinking into.
- **Headlines, enforced** (`"headlines": true`; the signing-1..3
  finding, and the published cross-exam runs measured it: the human
  read 800 to 1,700 words before each answer of 1 to 5). Every
  `forum_post` carries a one-sentence headline of at most 20 words —
  the tool's schema requires it, and the forum refuses a long post
  without one. The human's floor card leads with one row per post
  (member, "names you", headline); each row opens the full post. The
  record keeps every word.
- **One desk to the human** (`"humanDesk": "chair"`): only the chair
  may use `ask_human` and `decision_form`; the seat refuses the others
  with where to take their point. The human answers one form, not a
  point from every member.
- **The briefing, trimmed** (326 → 179 words, the capitals gone). The
  ledger quotes one sentence per contest and cites the post for the
  rest, instead of every stance verbatim. Each patch to this charter
  had added a sentence; the models mirrored the length and the
  density. What the code now enforces left the prose.

## The plain version

```bash
NODE_USE_ENV_PROXY=1 node tools/community-live.mjs \
  --charter tools/charters/alongside-signing.json \
  --out ~/community-runs/alongside-signing-4
```

- The human seat is you: the floor card asks for your stances and your
  final answer; the run waits (30-minute floor timeout, +10 min per
  press).
- Your card opens on one line per post, for example:
  ```
  reader            line 12 overreaches; the rest reads plainly          fp_2
  chair  names you  The ledger is up — one form for you, three items     fp_5
  ```
  (illustrative rows: the headlines are the members' own). Open a row
  for the full post. A post you write longer than one line of 20 words
  needs a headline; a shorter one is its own.
- Afterwards: `node tools/community-export.mjs <out> -o signing.html`
  — the archive is the endorsement's evidence; the SIGNATORIES row
  links it.

## Honesty labels

- **Rehearsal standing only** (D-8): practice keys sign nothing in the
  world; the endorsement's weight is the record's weight, and the row
  in SIGNATORIES names it as deliberation, not as a legal signature.
- **The digest is the claim.** The community endorses v0.6.9 by sha256
  — if the text changes, the endorsement does not travel.
- **A contest is a success.** Every branch of the outcome tree is
  publishable: full endorsement, endorsement with contests recorded,
  or "the community could not endorse" — the last one is the machinery
  refusing to flatter, which is the point of having it.
- **A headline is its author's claim about their own post** — not
  checked against the text by anything but the reader. The full post
  is one click away on the card, and the record keeps all of it.
- **One run is one sample.**
