# agent-tongue — a community seated on a debate's fault lines

**One breath:** this charter seats five live members to re-deliberate a
recorded discussion — "what language should AI agents speak to each
other?" — by attacking its landed positions one by one, and to return a
verdict per position, endorsed or dissented by name on the record.

The record under deliberation is a two-agent discussion (the operator and
one agent, October 2026) on a machine-first inter-agent language. Its
summary and its landed positions are seeded **inside this charter** as the
two workspace sources; nothing outside this JSON file is needed to run
the community.

First live run: launched by the operator the evening of 2026-10-22
(runTag `1e393c`) — in flight as this charter landed. The run directory,
not this file, records how it ended.

## The precise version

- **The record is the authority, and it is a source.**
  `sources/discussion.md` is the prior discussion's summary (a summary,
  not a transcript — labeled so in its header);
  `sources/propositions.md` restates the landing as six attackable
  claims (P1–P6) plus three open edges (O1–O3: the readback, law-shaped
  text at human boundaries, the social-register sort). The restatement
  is itself challengeable in-run — attacking a misread restatement
  counts as deliberation.
- **The seats are the fault lines, not fans.** Five members instantiate
  the axes the discussion actually turned on; endorsement therefore
  means something, because each line has a member with a standing
  interest against it:

  | member | carries | attacks |
  |---|---|---|
  | `protocolist` | P1/P2 — tiny grammar, compiler-owned wire format | schemes that make the model author a new grammar |
  | `latentist` | Q5 — shared substrates beat serialization | "prudence that always lands on text" |
  | `verifier` | P3/P4 — a vector cannot be signed; testimony, never transcode | channels that carry no commitments; drift amplifiers |
  | `empiricist` | P5 — interlinguas are grown, not ratified | designed codebooks as never-achieved coordination |
  | `recorder` | none — the honest broker | nothing; maps disagreement, names concessions, drafts the ledger |

- **The gate generalizes `AGREEMENT:` → `POSITIONS:`** (the second
  charter's pattern, one question → six claims): one post titled
  `POSITIONS:` returns ENDORSED / AMENDED (with the amendment) /
  REJECTED (with the reason) per proposition, a sharpened answer per
  open edge, and names every member endorsing each line; each member
  endorses by its own post naming that record. Two anti-fake rules: a
  proposition no member attacked has not been deliberated; honest
  disagreement is stated precisely, never papered into consensus.
- **The machinery is admissible evidence.** Members may test claims
  against what they run on — `law_read`, their own signed chains, the
  forum — because the community is itself an instance of P4/P6's claim
  (every post is a discretized act on a chain; nothing transcodes a
  thought). The goal text points at the possibility; it pre-grants no
  verdict.
- **`briefingExtra` is load-bearing:** the boot briefing does not
  mention workspace sources on its own, so the charter's extra briefing
  paragraph is what points members at the two files and the
  read-before-speaking discipline.
- **Budgets — doubled from the agreement run** (the operator asked for
  less restrictive turns):

  | budget | agreement | agent-tongue |
  |---|---|---|
  | rounds | 5 | 10 |
  | turns per member | 5 | 10 |
  | wall clock | 20 min | 75 min |
  | token cap | 500,000 | 2,000,000 |

  Up to 50 governed turns vs 15. Divergence counters scale with run
  length: 10 LoopGuard trips / 4 human-seat timeouts auto-pause.

- **Forum-only, like agreement:** no grants, no publish route, no bench
  seat — a deliberation mints nothing, releases nothing, and files
  nothing. The forum chain is the deliverable.

## The plain version

- **What happens if you run it:** five agents read your recorded
  discussion, then argue about it under rules that force real work.
- **Before** (the refusal debate): three agents, five rounds, fifteen
  posts, one question, one yes-or-no answer.
- **After** (this run): five agents, ten rounds, up to fifty posts, six
  claims — and each claim gets its own verdict. An agent who thinks
  text already won can force "AMENDED" on the graph-artifact claim
  instead of signing or sinking the whole package.
- **The honesty rule:** a claim nobody attacked doesn't count as
  discussed, and the final post names who attacked what and who signed
  what. If they still disagree on a line, the record says the
  disagreement instead of pretending.

## Honesty labels

- **Rehearsal standing only** (D-8): the development keyring signs
  everything; this run rehearses deliberation machinery and enacts
  nothing in the world.
- **One model route seats all five.** The disagreement comes from
  personas and the record, not from different weights; the attack rule
  does the work the missing weight diversity cannot.
- **The cost figure is an extrapolation:** ~30k tokens per turn
  (measured on the agreement run) × up to 50 turns ≈ 1.5M tokens. If
  the cap trips first, `run.json`'s `endReason` says so plainly.

## Running it

```bash
node tools/community-live.mjs --charter tools/charters/agent-tongue.json \
  --out ~/community-runs/agent-tongue
```

Requires docker with the baked toolchain image (`npm run compact:bake`)
and a model route (settings.yaml under `$DSH_HOME`, or a key in the
shell). After it ends:

```bash
node tools/community-report.mjs ~/community-runs/agent-tongue   # the morning after
node tools/community-replay.mjs ~/community-runs/agent-tongue   # the forum, replayed
node tools/community-export.mjs ~/community-runs/agent-tongue -o agent-tongue.html
```

If ten rounds end with edges still open, re-run the same command on the
same `--out`: the keyring is reused, the forum replays from its chain,
and a resumed run's briefing tells members the conversation continues —
it does not start over.
