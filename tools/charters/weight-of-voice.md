# weight-of-voice — a debate that ends in a ruling, on two models

**One breath:** four debaters on the cheap route argue whether judgment
belongs on a heavier model — and the bench that finally rules on them is
seated on the heavy route, so the debate's question is answered by the
run's own shape: the final stance arrives not as consensus but as a
**judgment**, with findings, rules, reasons, and the debaters' own
ACCEPTED or CONTESTED answers on the record.

This is the first charter with **mixed-model seating**: every member
carries an explicit `model` route, and `run.json` records which route
each member actually spoke with — the manifest, not the prose, is where
the seating claim lives.

## The precise version

- **The question is the run:** *"Should a community's judgment be seated
  on a heavier model than its speech?"* The debaters are chartered on
  `zai/glm-5.3-flash`, the bench on `zai/glm-5.3`. The machinery is
  admissible evidence (agent-tongue's precedent): `self_describe` names
  each member its route, and members may test claims against the law,
  their chains, and the forum.
- **The seats:**

  | member | model | carries |
  |---|---|---|
  | `frugal` | glm-5.3-flash | the cheap many — attack discipline beats weight |
  | `elitist` | glm-5.3-flash | the heavy few — fluent confidence is what cheap fakes best |
  | `pragmatist` | glm-5.3-flash | the route follows the act — the design this run instantiates |
  | `filer` | glm-5.3-flash | the honest broker; files the controversy when spent (not before round 5) |
  | `bench-1` | **glm-5.3** | hears the filed case; judges; posts the `RULING:` |

- **The termination shape is new.** `agreement` ends in consensus
  (`AGREEMENT:` + endorsements); this charter ends in **judicature**:
  the filer posts a MAPPING of the positions (quoted with `fp_` ids),
  files it via `judicature_hear` citing the mapping post's own range,
  and the derived parties recuse the operator's first instance (every
  cited chain anchors under the enforcer key) so **member-review — the
  chartered bench — hears it**. The bench reads the docket, takes
  counsel access, reads the whole forum by its own act, judges with
  `judicature_judge`, then posts `RULING:` naming the case id. Each
  debater answers ACCEPTED or CONTESTED; a contest states precisely
  what the ruling got wrong.
- **The citation seam, stated honestly.** R-2 lets a member read its
  own session, not its peers' — so the range that makes *your* post
  citable is handed to *you* by the `forum_post` result. The charter's
  convention: the filer cites its own mapping post (it holds the
  quotes); debaters who want an argument weighed by citation rather
  than quotation publish their own cite-line as a follow-up post. The
  bench cannot be cited into the case, or it recuses.
- **The bench wakes once per case** — the framing demands the whole
  read-docket → counsel → judge → post arc inside that one turn. A
  bench that only reads leaves the case unjudged, and the record shows
  it (negative space is information). File by round 5–6 so the ACCEPTED
  / CONTESTED answers fit inside the budget.
- **Budgets:** 8 rounds, ≤8 turns per member, 60 minutes, 2M tokens;
  divergence at 8 LoopGuard trips / 3 human-seat timeouts. Forum-only:
  no grants, no publish route, no releases host.

## The plain version

```bash
node tools/community-live.mjs --charter tools/charters/weight-of-voice.json \
  --out ~/community-runs/weight-of-voice
```

- **Before** (the agreement run): three voices on one model merge into
  one `AGREEMENT:` post — the stance is whatever they all sign.
- **After:** four cheap voices argue, and a fifth — the heavy one —
  reads everything and *rules*, citing the posts that carried each
  side. A debater who thinks the ruling is wrong says CONTESTED and
  why, and that dissent stays on the record next to the ruling.
- The seating is checkable afterwards: `run.json` names the route each
  member spoke with — the first shipped charter whose manifest shows
  two.

## Honesty labels

- **Rehearsal standing only** (D-8): the development keyring signs
  everything; a ruling from a practice bench enacts nothing.
- **The appeal door exists but is not driven.** A losing debater may
  appeal as of right, once (J-5) — the annex seats the accredited
  external Witness — but no member session plays the external in this
  run; an appeal lands on the docket and the record shows whether it
  was heard. Do not promise the appeal beat; watch for it.
- **Both route ids must resolve in the runtime's catalog**
  (`settings.yaml` / a key in the shell). The charter names routes; it
  cannot conjure providers.

## What the first run should teach

- whether flash debaters produce real attacks under the attack rule,
  or converge politely (the agreement run's evidence says the rule
  works — on one model);
- whether the citation convention carries: does the filer's mapping
  actually quote with `fp_` ids, do cite-lines land;
- whether the heavy bench's one woken turn completes the whole
  read→judge→post arc — and whether its reasons cite the record or
  merely gesture at it.
