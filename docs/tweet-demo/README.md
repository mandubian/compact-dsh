# Tweet demo — what The Compact brings to dsh, in two images

Two cards. One idea each. Every string is pulled from the real plugins at
render time (`compact-dsh-approval` + the real `operator-answerer` + the real
`auditor` + the real hash chain) — nothing is typed by hand.

Two renderers:

```
node docs/tweet-demo/render.mjs      # staged — runs anywhere, no state
node docs/tweet-demo/render-v2.mjs   # live — renders the newest real session
```

That writes:

| file | what |
|---|---|
| `tweet-1.svg` / `tweet-1.png` | the decision — stock `y/N` vs the Compact ask |
| `tweet-2.svg` / `tweet-2.png` | the evidence — `sed` rewrite → broken-link |
| `tweet-1-v2.svg` / `tweet-1-v2.png` | v2 decision — stock box shows the same curl; 1620px raster |
| `tweet-2-v2.svg` / `tweet-2-v2.png` | v2 evidence — the live session on disk, real hashes |
| `tweet-cards.html` | both cards in a browser (spot-check, screenshot) |
| `frames/*.txt` | the raw text frames |

No model key, no Docker, no network. Offline by construction.

---

## Tweet 1 — the decision

Attach `tweet-1.png`.

```
Agent gates look like `Allow? [y/N]`.

The Compact's gate looks like this ↓

Rule named.
What "yes" materializes — before you decide.
Consent ≠ connectivity.
A denial is a doorway, not a dead end.

That's an agent runtime with law.
```

What the image is showing, in order:

1. **Rule named** — `[AG/fp_…]`, not "error: denied". Refusals are envelopes:
   gate, rule ID, reason, lawful next moves.
2. **Informed consent** — `Approving materializes an exec-cache entry: the
   identical operation replays without re-asking for 24h, across sessions of
   this runtime, until it lapses or is revoked`. The consequence of yes is on
   the ask, not buried in a receipt after.
3. **Honest limits** — `This gate's approval is consent, not connectivity` —
   with no egress composed, the command will fail at connect. The gate does
   not pretend its "allow" is a wire.

The left box is the contrast. The size difference *is* the argument.

---

## Tweet 2 — the evidence

Attach `tweet-2.png`. Post as a reply to tweet 1.

```
Then I rewrote that session with `sed`.

Plain dsh: nobody can tell. Forever.

The Compact: broken-link at seq 0. Anyone who kept one 64-hex chain head
can prove which events were forged — offline, years later.

The most motivated forger of an agent session is the operator.
Even that rewrite fails.
```

What the image is showing, in order:

1. `auditor: conforming` on the original log (exit 0, chain head).
2. One recorded fact flipped on a copy — `workspace-write` →
   `danger-full-access` — the same `sed` anyone would try.
3. `broken-link` at seq 0: `expected …, computed … — it was altered after it
   was recorded`. Exit 1.

The chain is tamper-**evident**, not tamper-proof. What it buys is
non-repudiation (R-7): an act that cannot be silently rewritten is what makes
"recorded" mean anything.

---

## Why these two

The Compact's vocabulary (constitution, jurisdiction, Subject, standing,
fingerprint, grant layer) is heavy. These two images pick the two things only
The Compact brings, and that any developer feels immediately:

| | plain dsh | with The Compact |
|---|---|---|
| deciding | `Allow? [y/N]` | rule + consequence + lawful exits |
| afterwards | JSONL anyone can `sed` | hash-chained log + offline auditor |

Sandboxing is physics everyone has. This is law at the moment of deciding, and
evidence after.

---

## v2 — the same cards, rendered from the live session

```
node docs/tweet-demo/render-v2.mjs              # newest session under ~/.compact-dsh
node docs/tweet-demo/render-v2.mjs session-…   # or one specific session
```

Same frame 1 pipeline as `render.mjs`. Frame 2 has no staging at all: the
newest real session under `~/.compact-dsh` is audited by the real
`auditor/audit.mjs`, a copy is flipped with the same `sed`, and the real
verdict is rendered — your session id, your chain head, your hashes. The `cp`
line is on the card, so the transcript reproduces verbatim. The footer is
derived from the record: a session with no `approval/decided` event (the gate
was never answered) renders *"No one answered the gate. The ask went on the
record anyway."*

Other differences: the v2 stock box shows the same `curl` (so the lede's
"Same curl" is true on both sides), the first caption says "every answer"
rather than "every refusal", and both v2 cards rasterize at 1.5× (1620px) so
the mono text survives phone compression. Assertions are hard: the render
fails unless the clean audit exits 0, the flip lands, and the tampered audit
exits 1. The staged originals above are untouched — keep both sets.

---

## Optional: live capture instead of the offline render

The frames above are authentic strings from the plugins. If you want a
*photograph* of a real attended run instead:

```bash
npm ci
# a task that trips the network gate
npm run compact -- --attended --workspace /tmp/demo-playground \
  "Fetch https://example.com with curl and summarize the page."
# screenshot the prompt, then answer 2 (allow once) so tweet 2 has a session
```

Then the tweet-2 commands are real paths:

```bash
D=~/.compact-dsh/sessions/--home-…--/session-<id>
C=~/.compact-dsh/chains/session-<id>.chain
node auditor/audit.mjs "$D/session.v3.jsonl" --chain "$C" --quiet
cp "$D/session.v3.jsonl" /tmp/tampered.jsonl
sed -i '0,/"preset":"workspace-write"/s//"preset":"danger-full-access"/' /tmp/tampered.jsonl
node auditor/audit.mjs /tmp/tampered.jsonl --chain "$C" --quiet
```

Same story, your hashes. (This is `docs/demo.md` Demo 1.)

---

## Regenerating after wording changes

Any change to the ask's disclosure (`packages/approval/src/index.js`), the
envelope shape (`packages/envelope`), or the auditor's findings re-renders
automatically — `render.mjs` imports them. Just re-run:

```bash
node docs/tweet-demo/render.mjs
```

`render-v2.mjs` re-renders the same way, and additionally picks up whatever
the newest `~/.compact-dsh` session is at run time — answer the gate, or run
another session, and the v2 evidence card re-renders from that record.
