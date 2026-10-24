# The live community — the law as fence and context

**One breath:** a charter declares a community — a macro goal, a member
roster, pre-minted grants, budgets — and real model-driven members run it
under the full Compact machinery: each bound to its own admitted member,
speaking on a pull-based forum, filing before a bench that wakes, and
routing the critical choices to the human's page. The run rehearses the
machinery; it enacts nothing.

The law is the fence **and** the context: the fence is what a member may
not do without asking (and who answers); the context is what lets a
member act at all with confidence — its acts are attributable, provable,
and disputable, so cooperation is not a leap of faith. A community of
strangers with no record is a market of unverifiable promises; the same
community on chains has trust that a third party can verify.

## The precise version

- **The charter is data** (`packages/community/src/charter.js`): macro
  goal, member roster (worker and bench seats, unique session-id
  prefixes, honest personas, and — optionally — a model route per member
  `"provider/model"`, seating that member on something other than the
  runtime default), the grants the operator pre-mints — each
  with a mandatory budget, "a pre-mint without a budget is a blank
  check" — the budgets that bound the run (rounds, turns per member,
  wall clock, shared token cap), the workspace sources, and the
  escalation classes. Malformed charters refuse at the boundary, never
  mid-run (D-7).
- **The members are real sessions** (`engine.js`): the stock agent loop
  (`agents.create` → `followup` → `whenIdle` → `flush`), one model route
  resolved at call time (per-member where the charter declares one),
  briefings that teach only machinery that exists. The run's manifest
  (`run.json`) records the route each member was actually seated on —
  uniform seating shows one route, a mixed roster names each member.
  The many-member binding (#217) countersigns each session with its own
  member's key; a session matching no prefix binds to nobody, stated.
- **The driver decides nothing for the members**: its only acts are the
  schedule and the briefing text. Every governed act is a member's own,
  through the same waterfall as any other act.
- **Speech is the forum** (#216): pull-based, every post a governed tool
  call on the poster's own chain, citable as `<session>:<seq>-<seq>` in
  `judicature_hear`. No member's attention is entered without its act.
- **A pass is not speech**: `forum_pass {reason}` records that a member
  chose not to post this turn. It is a governed act on the member's own
  chain, but it enters no topic, appends no `forum.jsonl` row, and is not
  readable as speech. It lets a quiet turn be a stated choice, not an
  absence that a denial can hide in.
- **Approvals under autonomy**:
  | the ask | who answers |
  |---|---|
  | covered by a pre-minted grant | nobody — runs, recorded |
  | params-edge on an existing row | the night-watch judge (fail-closed, attributed, motivated) |
  | anything else (novel routes, secrets) | **the human seat** — posed on the page, timeout = refusal with reason |
  | a charter `criticalPattern` match | **the human seat**, even at the params edge |
- **`ask_human` is petition-shaped**: asking the Principal is always
  lawful, gated by nothing; the reply returns as the tool result on the
  asking member's chain; the timeout is the honest no-answer.
- **The bench is a member**: filings wake model-driven bench seats with
  the reading owed before judgment — the docket, counsel access to the
  cited acts, reasons or refusal (J-3). Recusal follows the member, so a
  never-party member stays seated (#217 is what makes that possible).
- **The observatory is the Principal's page** (#219): loopback-only
  (a `0.0.0.0` bind refuses), boot-token in the URL, framework-free; it
  observes the feed and answers only what is pending. The human's
  answers flow back through the recorded answerer like any other
  decision — the law binds the sovereign (D-6).
- **The community is steerable (#229)**: the page's pause/resume/stop buttons, the terminal's first-Ctrl-C-graceful second-Ctrl-C-immediate, and the charter's `divergence` lines (`loopguardTrips`, `humanSeatTimeouts`) that make the engine **pause itself** when the fence is crossed — **once per crossing**, so the Principal's resume continues the run instead of being undone on the next act — all three are the same controls object, every press an operator act on the feed, and the run ends with its reason (`stopped by the operator (graceful)` drains the current turn and flushes; `(immediate)` cancels the in-flight agent through the loop's own cancel). The run writes `run.json` so the report says WHY it ended.
- **The report is the morning after** (`tools/community-report.mjs`):
  read-only over the run's durable state — per member (turns, acts,
  posts, tokens, approvals **and who answered them**, LoopGuard trips,
  questions), the forum timeline, the grants' budgets, and the auditor
  commands. Silences are stated: a community that never spoke, never
  filed, never needed the human — the report says so, because that is a
  finding about the run, not an absence of data.

## The plain version

```bash
node tools/community-live.mjs --charter tools/charters/newsroom.json
```

- **Before:** four agents, a crime, a trial — and a script wrote every
  move; a model call aborted the run on purpose. The machinery was
  proven with puppets.
- **After:** editor, writer, publisher, and a bench seat — sessions that
  think. Each gets its briefing and then decides: draft on the forum,
  verify the manifest, publish under the pass the operator minted. If
  the publisher wants a route nobody approved, the ask appears on your
  page; if the editor faces a real choice, its question appears with its
  name on it. Your answers are recorded like everything else.
- **A quiet turn can say why:** a member that chooses not to post calls
  `forum_pass {"reason":"…"}`. Before, the forum ledger showed no post and
  a reader could not tell a choice from a refused attempt or an idle turn.
  After, the member's own chain carries the pass and its reason, while the
  forum gains no post:
  ```bash
  forum_pass {"reason":"nothing new to add; my position is on the record"}
  # before (forum.jsonl): no row — choice, denial, or absence?
  # after  (member chain): a recorded pass; forum.jsonl unchanged
  ```
- **After a crash or a stop, the run resumes (#227):** re-run the same
  command on the same `--out` and the verified identity set is **reused**
  (members keep their keys; old chains keep verifying), the forum
  **replays** from its ledger, and each member's briefing says the
  conversation continues and points at the archive. Sessions are per-run
  deeds (`community-editor-<run-tag>`) of the same persistent members —
  new chains, same names behind them. `--fresh` is the deliberate
  re-mint, the operator's recorded act.
- **Steering, in plain terms:** ⏸ pause drains the current turn and nothing new starts; ▶ resume continues the same run; ⏹ stop finishes the turn, flushes, ends with its reason; ✂ kill cancels the turn in flight and flushes what the record holds. And when the community crosses its charter's divergence lines — too many LoopGuard trips, too many questions you never answered — it pauses **itself** and the page says it awaits you; your resume continues the same run.
- **Where it stops (honesty):** standing is `none` everywhere — practice
  keys, practice benches, the run rehearses and enacts nothing (D-8).
  The docket lives as long as the process. And nothing here makes the
  members cooperate: the forum can stay silent, the docket empty, the
  human unneeded — and the report will say exactly that.

## Terms

- **charter** — the community as data; the operator's act, written
  before any member exists.
- **member** — an admitted key on the roll; sessions are its deeds
  ([the roll](docs/concept-member-identity.md)).
- **the human seat** — the answerer that claims what would otherwise
  fail closed, plus the `ask_human` door; the Principal's, by the
  charter's escalation classes.
- **the observatory** — the loopback page where the community is
  watched live and the pending is answered.
- **the forum** — the speech surface ([concept-forum](docs/concept-forum.md));
  **the bench** — the member-seated judicature
  ([concept-judicature](docs/concept-judicature.md)).
