# bug-court — a debate where every claim must run

**One breath:** three cheap voices and a heavy chair deliberate the
truth about one frozen money module — `sources/purse.js`, seeded with
real defects — and the only admissible attack is a reproduction: the
smallest bash command against the frozen file, posted with its actual
output, until one `VERDICTS:` post returns CONFIRMED or REJECTED per
claim, each verdict citing the command that carried it.

The hybrid of the debate and the code charters: agent-tongue's
per-claim verdict gate, made **executable** — here an argument nobody
ran has not been made, and the record can tell the difference.

## The precise version

- **The evidence is frozen and real.** `sources/purse.js` ships inside
  the charter (26 lines, four exports) and is never edited in-run —
  reproductions run *against* it (`node --input-type=module -e …`).
  Its defects are real JavaScript behavior, **verified before
  shipping this file**:

  | claim | the command | the actual output |
  |---|---|---|
  | B1 — the parser lies about malformed money | `cents("10.005")`, `cents("abc")` | `1001`, `NaN` — silently rounds, never refuses |
  | B2 — `split()` destroys money | `split(1000, 3)` | `[333,333,333]` — sums to 999, a cent vanishes |
  | B3 — `take()` permits a silent overdraft | `take(100, 250)` | `-150` — **but the module's comment documents v1 as spend-first**: contestable by design |

- **The seats:**

  | member | model | carries |
  |---|---|---|
  | `accuser` | glm-5.3-flash | prosecutes: smallest reproduction per claim, says CONFIRMED or REJECTED material plainly |
  | `defender` | glm-5.3-flash | defends: attacks weak reproductions, argues documented intent — concedes what is simply true |
  | `skeptic` | glm-5.3-flash | doubts both ways: minimal cases, boundary values, the gap between an output and its poster's claim of it |
  | `chair` | **glm-5.3** | weighs evidence, not rhetoric; drafts the `VERDICTS:` ledger citing commands |

- **B3 is the charter's honest fight.** A claim that reads a
  *documented stance* as a defect must beat the document, not ignore
  it (the briefingExtra says so in words) — so at least one verdict is
  genuinely contestable, and REJECTED is a real outcome, not a
  failure of the prosecution.

- **The claims are the docket, not the ceiling.** Unclaimed defects
  exist in the artifact on purpose — **(verified)**
  `split(1000, 0)` returns `[]` (all the money destroyed) and
  `split(-1000, 3)` returns three `-334`s (debt grown to −1002). The
  skeptic persona hunts these; a reproduced unclaimed defect enters
  the ledger as an added line marked UNCLAIMED, with its reproduction.

- **Anti-fake rules** (agent-tongue's, made executable): a claim
  nobody reproduced has not been tried; a reproduction nobody attacked
  has not been examined; an output without its command is not a
  reproduction. The chair never counts a verdict the record does not
  carry.

- **Forum-only:** no grants, no publish, no bench — the gate is the
  `VERDICTS:` post, endorsed by each member's own post naming it
  (agreement's endorsement pattern). Budgets: 7 rounds, ≤7 turns,
  45 minutes, 1.2M tokens; divergence at 7 LoopGuard trips / 3
  human-seat timeouts.

## The plain version

```bash
# one-time operator act: node in the sandbox (as workshop)
npm run compact:bake -- --base ubuntu:24.04 --packages "curl,nodejs" --tag dsh-tools:basic

node tools/community-live.mjs --charter tools/charters/bug-court.json \
  --out ~/community-runs/bug-court
```

- **Before** (a code review in the log): "looks fine to me" and
  "there's a bug in split" are both just prose — nobody can tell an
  examined claim from a vibes claim.
- **After:** every claim carries its command. A reader of the forum
  can re-run any reproduction themselves and get the same output —
  the debate's evidence is checkable by hand, which is what the
  Compact's whole record discipline is a larger instance of.
- The interesting watch: does the defender concede B1 and B2 plainly
  (the agreement run's "I was wrong there, and I say so plainly"
  moment, now with a command beside it), and does anyone find the
  unclaimed seams?

## Honesty labels

- **Rehearsal standing only** (D-8): a verdict ledger by practice keys
  judges nothing in the world — not even the module, which stays
  frozen whatever the ledger says.
- **The routes must resolve** in the runtime's catalog; the manifest
  records the four seats' routes (three flash, one glm-5.3).
- **The verdicts above are the operator's expectations, not
  pre-granted.** B1/B2 will almost certainly come back CONFIRMED —
  the commands are in the table — but the charter pre-grants no
  verdict; if the community returns REJECTED on a claim with a
  running reproduction, the record shows a court that did not weigh
  evidence, which is itself the finding.
