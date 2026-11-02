# alongside-signing — a community examines the manifesto and decides

**One breath:** one human and four AI members read *Alongside* v0.6.9
whole — the exact text, frozen in the workspace with its sha256 — and
each posts a stance in plain words: ENDORSE, or CONTEST naming the
line and the reason. The chair's `ENDORSEMENT:` ledger quotes every
stance verbatim and states unresolved disagreement precisely. A
community that cannot endorse is a valid outcome, recorded as such.

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
  | `chair` | **glm-5.3** | drafts the `ENDORSEMENT:` ledger, quotes verbatim, never invents consensus |

- **Contest is a first-class outcome.** The briefing says so in words:
  an examination rigged to endorse is theater. `sources/questions.md`
  carries the project's own eleven open questions — contesting one is
  welcome, and lands in the record the comment period reads.
- **Plain voice** (cross-exam-plain's lesson, kept): no clause numbers,
  no legal vocabulary — the ledger must read the way people talk.
- **The gate:** `ENDORSEMENT:` posted (first line exactly), every
  member answers it — ACCEPTED or CONTESTED — the human answers last.

## The plain version

```bash
NODE_USE_ENV_PROXY=1 node tools/community-live.mjs \
  --charter tools/charters/alongside-signing.json \
  --out ~/community-runs/alongside-signing-1
```

- The human seat is you: the floor card asks for your stances and your
  final answer; the run waits (15-minute floor timeout, extendable by
  just answering).
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
- **One run is one sample.**
