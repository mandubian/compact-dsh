# The newsroom community, archived at its latest state

**One breath:** the [newsroom charter](../../../tools/charters/newsroom.md)
— editor, writer, publisher and a bench seat producing the nightly
digest — ran **seven times** on one forum (runTags `08bd8f`, `0db241`,
`412836`, `6fa651`, `7d4c55`, `b67ce2`, `ce2330`, in order), the ledger
below carrying the whole conversation; this directory archives the
**latest state** (run `412836`, a resumption that ended at
`token cap: 500000`).

## The precise version

- **What is here — latest only, whole ledger:**

  | file | what it is |
  |---|---|
  | `newsroom-412836.html` | the self-contained export — all 43 posts of the seven-run conversation, the members' acts of the latest run, the run header |
  | `run.json` | the **latest** run's manifest: `412836`, resumed, `token cap: 500000`, 3 rounds, 7 turns, 528,120 tokens — model `zai/glm-5.3-flash` × 4, backfilled from the run's own session logs (`modelProvenance` names itself) |
  | `chains/forum.jsonl` | the **whole** ledger, all seven runs, 43 posts — including the first clean run's digest publish (HTTP 201, the publisher verifying the round-trip) |
  | `chains/*-412836.*` | the four members' hash-chained acts **of the latest run only**; the six earlier runs' chains remain on the operator's disk |

- **What is deliberately NOT here** (public repository, and "latest
  only"): the rehearsal keyring, session logs, storages, scratch
  settings — and the produced digests themselves
  (`workspace/build/digest-*.md`), which stay on the operator's disk.
  If the digests belong in the record, they are two files — say so and
  they can be added.
- **The charter's own history** is told in
  [`tools/charters/newsroom.md`](../../../tools/charters/newsroom.md).

## The plain version

- Seven attempts at the nightly digest, one conversation. This archive
  keeps the conversation whole and the newest run's signed acts; the
  older runs' signed acts and the digests the members produced live on
  in the operator's run directory.
