# cross-exam — bug-court with the human on the docket

**One breath:** the same frozen money module as `bug-court`, but the
accuser is **you** — seated on the roll as a member, speaking on the
forum from the observatory's floor card — and the gate has a human
line: the chair's `VERDICTS:` ledger is not done until your own post
endorses or contests it, line by line.

The first **mixed community** charter (#215's words, made real): one
human member, three model members, one law. What it tests is genuinely
new — whether the community can extract precision from human vagueness,
which is the exact thing a real review team does for a real colleague.

## The precise version — how the human is seated

- **`"human": true` on the member** — the seat rides the same rails as
  any agent member: its own session (`community-accuser-<tag>`), its own
  prefix on the roll, its own practice key, its own chain. The route is
  `human/the-principal` — an **llm adapter registered by the driver**
  (`human-member.js`) whose completion is not a network call but the
  floor card on the page: **the page is the model.**

- **The turn, mechanically:** the engine's framing lands on the human
  member's chain as a user message (like every member's); the adapter
  poses it as a floor card; your button press becomes the member's own
  assistant turn through the stock agent loop —

  | button | the act that lands on your chain |
  |---|---|
  | **post** | a `forum_post` tool call, your words verbatim, on the topic |
  | **pass** | a `forum_pass` — your recorded reason for silence (not a post) |
  | **say** | plain words on your chain that end the turn (not a post) |

  After a post, the card returns with the tool's result (`fp_7 posted…`),
  so you may post again, pass, or say. Every press is a governed act,
  attributed to you, citable in judicature — exactly like a model's.

- **The honest silence:** a floor card nobody answers within
  `escalation.floorTimeoutMs` (default 10 min; this charter gives 15)
  resolves as *no act performed* — words on your chain that say exactly
  that — and the divergence counters count it. Silence is never consent,
  and never a guess.

- **The bounds (v1, declared in the package's gaps):** the floor speaks
  forum only — no bash, no judicature tools for the human seat; a human
  bench seat is refused at the charter boundary; at most 2 human members;
  and `--no-observe` refuses the charter at launch (the floor card is
  your only instrument).

- **The frozen evidence is shared with bug-court** — `sources/purse.js`,
  byte-identical, defects and all — plus a workspace-root
  `package.json {"type":"module"}` seeded as a source, so the ESM
  reproductions just work (the first node-run's finding, baked in). The
  docket starts **empty**: you file it (`H1: …`), in your own words.

- **Budgets:** 6 rounds, ≤6 turns per member, **90 minutes** (a human
  reads and types), 1.5M tokens; divergence at 7 LoopGuard trips /
  4 human-seat timeouts. The roster: `defender` and `skeptic` on
  `glm-5.3-flash`, `chair` on `glm-5.3`, `accuser` on `human/the-principal`.

## The plain version

```bash
# one-time operator act: node in the sandbox (as bug-court)
npm run compact:bake -- --base ubuntu:24.04 --packages "curl,nodejs" --tag dsh-tools:basic

node tools/community-live.mjs --charter tools/charters/cross-exam.json \
  --out ~/community-runs/cross-exam --port 3092
```

- **Before** (bug-court): you watched. Your only doors were approving
  asks and answering `ask_human` questions — the members could knock on
  your door, but you could never open yours.
- **After:** you have a chair at the table. The page shows
  **YOUR TURN ON THE FLOOR** with the round's framing verbatim; you type
  `"H1: I think the parser accepts things money never is"` and press
  **post** — it lands on the forum as fp_3 under your name, and the
  defender owes it a reproduction with real output. When the chair
  posts `VERDICTS:`, the run is not done until your post answers it.
- The interesting watch, twice over: does the community turn your vague
  filing into the smallest command that shows the truth — and do *you*
  concede plainly when the evidence runs against your suspicion?

## Honesty labels

- **Rehearsal standing only** (D-8): your practice key signs your posts;
  the run enacts nothing, whatever you and the ledger agree on.
- **The manifest names the human seat honestly**: `seats[].human: true`
  and route `human/the-principal` — an archive reader can tell which
  lines were yours without a second vocabulary.
- **The routes must resolve** (`zai/glm-5.3-flash`, `zai/glm-5.3`) and
  **the page must exist** — `--no-observe` refuses the charter at
  launch, with the reason.
- **The floor speaks forum only** (v1): a human who wants to *run*
  reproductions still does it the operator's way — file the suspicion,
  and let the members run the commands. The evidence discipline is
  unchanged; only the docket's author is new.
