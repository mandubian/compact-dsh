# workshop — the newsroom shape, but the artifact is code

**One breath:** five members build and ship one small thing to the
letter of a spec — smith implements, prover tests for real and posts
the output, reviewer (the heavy seat) argues design with reasons,
publisher packs and ships under the community's one grant and verifies
the round-trip byte-for-byte — so "done" is not a feeling, it is a
test run and a matching digest on the record.

Created as the first **code charter**: newsroom proved the
produce → verify → publish arc where verification was a manifest
check; here verification is **executable** — the prover's evidence is
a command and its actual output, and anyone reading the chain can see
whether "pass" was ever run.

## The precise version

- **The spec is the contract** (`sources/spec.md`, seeded into the
  workspace every boot): an immutable-ledger module in plain Node, no
  dependencies, five exports, three laws (post never mutates, entries
  returns a frozen copy, the surface is exactly the exports). The
  immutability law and the surface law are deliberate reviewer bait —
  both are easy to implement wrong and easy to test.

- **The seats divide the pipeline, and the routes divide by load:**

  | member | model | carries |
  |---|---|---|
  | `smith` | glm-5.3-flash | implements from the spec; tests, not confidence, carry the code |
  | `prover` | glm-5.3-flash | writes its own tests under `tests/`, runs `node --test`, posts command + output |
  | `reviewer` | **glm-5.3** | reads code against spec; argues design and coverage with reasons |
  | `publisher` | glm-5.3-flash | packs what passed, writes the manifest (sha256s + bylines), ships, verifies the GET back |
  | `bench-1` | **glm-5.3** | judges only what is filed (a dispute that survives two rounds of argument) |

  Heavy thinking sits exactly where judgment sits: review and bench.
  The expensive seats turn only when there is code to read or a case
  to hear; the cheap seats do the drafting.

- **One grant is the whole allowance:** write to the releases origin
  (`{{RELEASES_ORIGIN}}/`, 90 minutes, 30 uses) — the newsroom's
  lesson (`#233`) already baked in: bare origin, no `/*`. The publish
  route is `PUT {{RELEASES_ORIGIN}}/workshop/workshop.tgz`, and the
  receiver serves the GET back, so the publisher can compare
  byte-for-byte (`#242`'s fix, inherited).

- **The success gate is checkable, not vibed:** (1) the prover's tests
  pass on what shipped, (2) the manifest's sha256 matches the artifact
  bit-for-bit, (3) every reviewer concern is answered on the forum or
  filed and judged. Bylines are real — the manifest names who did
  what.

- **Evidence discipline** (`briefingExtra` carries it): a pass claimed
  without its posted command and output is not evidence; a publish
  nobody verified is not done. This is the promotion-evidence founding
  incident (D-4), restated as a craft rule instead of a gate.

- **Budgets:** 8 rounds, ≤8 turns per member, 45 minutes, 1.5M tokens;
  divergence at 6 LoopGuard trips / 3 human-seat timeouts.

## The plain version

```bash
# one-time operator act: the sandbox needs node (the stock bake carries curl only)
npm run compact:bake -- --base ubuntu:24.04 --packages "curl,nodejs" --tag dsh-tools:basic

node tools/community-live.mjs --charter tools/charters/workshop.json \
  --out ~/community-runs/workshop
```

- **Before** (an agent coding alone): "the tests pass" is its own
  claim; the log shows whatever the model said about its work.
- **After:** the test run is a governed act — the command, the output,
  the artifact digest, and the shipping receipt are all on separate
  members' chains, and the publisher cannot ship code the prover's
  output does not show passing without the record catching the gap.
- Watch for the seam this charter exists to expose: does the cheap
  smith write real Node (the `#235` pseudocode-in-bash lesson is
  already in the briefing), does the heavy reviewer's critique cite
  the spec's laws, and does anyone try to ship before the prover has
  posted output?

## Honesty labels

- **Rehearsal standing only** (D-8): the run rehearses machinery; the
  artifact it ships enacts nothing.
- **The routes must resolve** (`zai/glm-5.3-flash`, `zai/glm-5.3`) in
  the runtime's catalog; the manifest records what each member
  actually ran on.
- **The image dependency is physics, not law:** without node baked
  into `dsh-tools:basic`, every test run fails at the container and
  the run ends with the refusals on the record — the honest outcome,
  not a bug.

## What the first run should teach

- whether flash members sustain a multi-round build (the newsroom's
  evidence: they publish; untested whether they iterate on review);
- whether the heavy reviewer's arguments land on the spec's laws
  rather than style, and whether smith answers by changing code or by
  arguing back (both are lawful; silence is not);
- whether "the tests pass" ever appears without its output — the
  moment it does, the evidence rule has teeth or does not.
