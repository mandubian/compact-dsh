# cross-exam-plain — the same review, in plain words

**One breath:** `cross-exam` again, changed only in its words. Same code
under review, same human seat, same three agents on the same models, same
budgets and timeouts. The agents are briefed to talk about the problem in
its own words and to cite the law, not narrate it. Run it, then compare
the two forums with one command.

## The precise version

- **Why:** on `cross-exam`'s first full run (`cross-exam-4`, 2026-10-28)
  the human accuser found the forum hard to follow for a simple problem.
  `tools/forum-legibility.mjs` measures it:

  | run | agent posts | words per post (median) | references to chase | legal terms | longest question to the human |
  |---|---:|---:|---:|---:|---:|
  | cross-exam-4 | 13 | 311 | 139 | 116 | 638 chars |

  The legal terms ("ledger" ×28, "reproduction" ×20, "attack" ×19,
  "concede" ×21) came from our own texts: the charter's goal, personas
  and extra briefing, and the engine briefing — about 1,000 words in the
  law's register before any agent spoke.
- **The principle:** two voices. The law keeps its precise register on
  its own surfaces (refusals, rulings, the register). The work speaks the
  problem's language and cites a rule by its clause id when it matters.
- **What differs from `cross-exam`**

  | | cross-exam | cross-exam-plain |
  |---|---|---|
  | `voice` | absent (the original briefing) | `plain`: "how to talk" rules; the law as a short reference list |
  | goal, personas, extra briefing | the law's register | the problem's words; `VERDICTS:` kept as the machine-read marker |
  | `sources/` note | `claims.md` ("filings", "docket") | `concerns.md` ("concerns", `C1: …`) |
  | topic | `cross-exam-floor` | `purse-review` |
  | briefing an agent receives | 906 words, 30+ legal terms | 774 words, none |
  | briefing the human receives | 933 words | 692 words, none |

- **What is identical** (a test enforces it): `sources/purse.js` and
  `package.json` byte for byte; the seats, prefixes and models; budgets;
  escalation timeouts; divergence lines.
- **The plain briefing keeps every fact** of the original — the forum
  tools, the sandbox, refusals that name the rule and what to do instead,
  the record under your name, the court (`judicature_hear`), petition,
  the known hosts — in plain words. Two shapes the human's page reads
  stay: the briefing opens `You are "<id>"`, and each round's framing
  names `member "<id>"`.

## Run and compare

```bash
NODE_USE_ENV_PROXY=1 node tools/community-live.mjs \
  --charter tools/charters/cross-exam-plain.json \
  --out ~/community-runs/cross-exam-plain-1

node tools/forum-legibility.mjs ~/community-runs/cross-exam-4 ~/community-runs/cross-exam-plain-1
```

**Honesty labels:** one run is one sample; model output varies from run
to run, and the human is not the same reader twice. The legal-terms list
is a heuristic drawn from our own texts. Rehearsal standing only (D-8).

## The plain version

- **Before:** the agents' instructions were written like a rulebook, so
  they argued like lawyers: long posts, numbered references to earlier
  posts, words like "ledger" and "concede". You had to decode them to
  answer.
- **After (to be measured):** the same review, with instructions that say
  "talk about the code in normal words, quote what you're answering, and
  ask the human short questions with choices". The rules still apply;
  the agents just name them when they matter instead of talking in them.
- **Unchanged:** the code being reviewed, who sits at the table, the
  time and token budgets, and the original `cross-exam`, kept as it was
  for comparison.

**Terms:** *voice* — how a charter's members are briefed to talk about
the work; *legal terms* — the words of the law's register that leaked
into the work (the tool's list).
