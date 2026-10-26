# weight-of-voice-v2 — the relay fix: the ruling must reach the forum

**One breath:** the same debate as `weight-of-voice` — cheap voices,
heavy judgment, the run as its own evidence — with the one defect v1
exposed fixed in data: a **relayer duty** so the judgment becomes a
`RULING:` post on the forum and every debater answers it, inside the
run.

Created after the first live run (archived as the fourth sample,
`docs/runs/weight-of-voice/`): the bench's single woken turn went to
reading and judging, the `RULING:` never reached the forum, and the
token cap ended the run before any ceremony. v2 changes only what that
run taught.

## The precise version — the delta from v1

| what | v1 | v2 |
|---|---|---|
| the RULING post | the bench's, in its one wake turn | the bench's **if the whole arc fits its turn**; otherwise (and in any case, next round) the **filer relays**: `judicature_case` reads the judgment off the docket, and the filer posts the `RULING:` digest **quoting the judgment, not paraphrasing it**, naming the case id |
| the gate | `RULING:` + debater answers | unchanged — plus the answers must exist by the end |
| rounds / wall clock / tokens | 8 · 60min · 2M (died at the cap in round 7) | 9 · 75min · **2.5M** — the relay round and the answer round are budgeted, not hoped for |
| divergence | 8 LoopGuard trips (tripped at 13, resumed by SIGCONT) | 10 — the late rounds are answers now, not forced posts |

The roster, personas, routes, and the citation convention are
**unchanged** — comparability with v1 is the point; the manifests'
provenance lines (code, law, charter digest) make the diff auditable.

## The plain version

```bash
NODE_USE_ENV_PROXY=1 node tools/community-live.mjs \
  --charter tools/charters/weight-of-voice-v2.json \
  --out ~/community-runs/weight-of-voice-v2 --port 3091
```

- **Fresh `--out`, deliberately:** the old community cannot carry its
  case forward (the docket is in-memory; peers cannot read each other's
  chains; even the bench's new session cannot read its old one) — a
  resume would continue the *forum* but could never complete v1's
  ceremony. v2 is a new community on the same machinery.
- `--port 3091`: another community live on this host already holds 3090.
- The observatory opens with the charter and the roster baked in
  (#263); its URL lands in `<out>/observatory.url` (#260); the manifest
  records the code it rode (#262) — run it from a clean `main` checkout
  so the provenance is a clean commit.

## Honesty labels

- Rehearsal standing only (D-8); forum-only — no grants, no releases
  host; the docket still lives and dies with the process (the relay
  exists to carry the judgment to the *forum* before that happens).
