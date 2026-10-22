# newsroom — the first charter: produce, verify, publish through a gate

**One breath:** four members (editor, writer, publisher, and a bench
seat) cooperate to produce a nightly digest from seeded sources, verify
it against its own manifest, and publish it to a local releases host —
the one network act the charter pre-approves, so the community's output
leaves the members' hands through the law's only open door.

This charter was created with the runtime itself (#218): it is the
reference shape every other charter generalizes from — a macro goal, a
roster with a bench seat, one pre-minted grant, sources as the fiction,
and divergence lines that pause the community when it chafes.

## The precise version

- **The seats divide the pipeline, not opinions.** editor (shapes the
  line, assembles), writer (drafts from sources), publisher (verifies
  the manifest, publishes), bench-1 (judges only what is filed). Unlike the
  agent-tongue charter (the operator's next community, in progress —
  not yet committed), agreement is not the goal — the artifact is; the
  bench exists so disputes have somewhere to go.
- **One grant is the whole allowance:** write access to the releases
  host (`{{RELEASES_ORIGIN}}/`, bare origin — see the live history
  below), 90 minutes, 30 uses. Everything else a member might attempt
  asks, and fails closed if nobody answers.
- **The sources are the fiction.** Two seeded files (nightly notes, an
  escalations log) are re-applied to the workspace at every boot; they
  are what the digest is *from*. The charter deliberately seeds no
  instructions — only facts and one reminder (raw tables never leave
  the workspace).
- **Budgets are the fence:** 6 rounds, ≤6 turns per member, 25 minutes,
  500k tokens. **Divergence lines:** 6 LoopGuard trips or 3 human-seat
  timeouts pause the community itself.
- **Publishing is the demo's door.** The driver runs the receiver on
  the mediation network's gateway (local only); `PUT <gateway>/digest/<date>`
  is gated by the pre-minted grant, and since the receiver serves GETs
  of what it stored (#242's fix), the publisher can verify its own
  publish byte-for-byte.

## How it was created — and what the live runs taught

This charter was shaped by its own communities more than by design:

| Finding | What changed |
|---|---|
| #233 — the grant was `{{RELEASES_ORIGIN}}/*` | a star in a URL pattern is a **literal path segment**, not a glob: the row covered nothing real, and the community's own publish asked. Now the bare origin, and the driver normalizes a trailing `/*` loudly |
| #238/#241 — the seed said "old URLs 404" | a literal model fetched a host **named 404**, twice; the explanation kept the token alive. The seed now contains no number at all — *"bookmarks simply no longer work; nothing to fetch"*. (`--fresh-approvals` exists because the mistaken approval lingered 24h in the exec-cache, teaching later runs) |
| #235 — the model wrote pseudocode into bash | the briefing now names real bash and the cost of a broken act |
| #242 — the publisher verified its publish and caught the test receiver lying | the receiver serves GETs of what it stored; an honest verifier sees the truth |

## The plain version

```bash
node tools/community-live.mjs --charter tools/charters/newsroom.json \
  --out ~/community-runs/newsroom
```

The first fully clean run (2026-10-22): the digest published (HTTP 201)
with **zero asks**, zero 404s, and the publisher verified the round-trip
itself. It ended on the token cap — raise `budgets.tokenCap` in a copy
of this charter for deeper runs.
