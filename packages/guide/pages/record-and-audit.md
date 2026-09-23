# The record and the audit

Every session is written to a log and, beside it, to a hash chain that commits to each event. Anyone holding the files can check them offline with the auditor. That covers `clause:I-2`, `clause:R-7` and `clause:I-7`. This page explains where the files are, how to check them, and what the checks do and do not prove.

## Where the record lives

The launcher (`file:tools/compact-dsh.mjs`) puts all Enforcer state under one state directory: `flag:--state-dir`, else `env:COMPACT_STATE_DIR`, else `~/.compact-dsh`. It prints the resolved paths on stderr at boot (`State: …; records: …; chains: …`).

| What | Default location | Override |
|---|---|---|
| Session logs (dsh JSONL) | `<state>/sessions/` | `env:COMPACT_RECORD_ROOT` |
| Hash chain, one per session | `<state>/chains/<session-id>.chain` | `env:COMPACT_CHAIN_DIR` |
| Authorship anchors (only when an annex is declared) | `<chains>/<session-id>.chain.sigs.jsonl` | same dir |
| Subject-identity ledger (only when an annex is declared) | `<chains>/subjects.jsonl` | same dir |

`file:docs/demo.md` (Demo 1) shows the exact layout of a session's log file.

**How the chain works.** Each link hashes the previous link, the event's seq and the canonical event. The first link is seeded from the session id, so a chain copied onto another session fails at its first link. Links are written before the log accepts the event, and every read checks the slice it returns. A slice that fails the check is refused, never returned with a warning. Refusals are named `broken-link` (an event was altered), `missing-link` (an event was appended outside the chain) or `no-anchor` (the slice cannot be tied back to the session's first link). Full design: `file:docs/concept-the-record.md`.

**Tamper-evident, not tamper-proof.** Anyone who can rewrite the log can rewrite the chain too. What they cannot do is change both and keep them consistent with a head link someone already copied. To be able to prove later that a session was not rewritten, copy its chain file (or its last line) somewhere the runtime cannot write. The boot record declares this limit.

**Your record is out of your own reach.** The record root, the chain dir and the approval store are the composition's protected state (`file:packages/blessed/cordis.patch.yml`). They are masked from the Subject's sandbox, so a Subject cannot rewrite its own evidence.

## What the Subject can read of its own record

`clause:R-2` gives every Subject the right to read the record of acts done in its name and on its behalf. `tool:record_read` is that right. It reads through the Enforcer, never the filesystem: the record files stay masked from the sandbox, so the Subject can read its evidence but cannot rewrite it.

- **Verified first.** Every read goes through the chained persistence, so the slice is checked against the hash chain before anything is shown. A slice that does not verify is answered as an `[R-2 ALARM]` naming the break (`broken-link`, `missing-link` or `no-anchor`). It is never returned as history. Tell the operator, and run the auditor with the chain file.
- **Up to date and citable.** Buffered events are flushed first, and each answer names the verified range (`events 0..N`) and the chain head it was read under.
- **Own session, and delegated sessions.** With no `session`, it reads your own. With a `session` id, it reads a session delegated from yours at any depth. The lineage is walked from the durable session headers. Any other session is refused with its reason, including a parent read from a child: delegation runs downward.
- **Acts, not minds.** In a delegated session, the reasoning-bearing events (the model's messages and attempts, compaction summaries, assembled request context) are listed by seq and type, and their content is withheld (`clause:R-10`). Tool calls, results, approvals and commands are shown.
- **Paging.** By default it shows the latest 30 events and a count of every type. `from_seq` and `limit` (max 200) page through the record, `types` filters by prefix (for example `tool/,approval/`), and `full` shows up to 10 events untruncated. Long events are otherwise cut at 500 characters, with a marker saying how to read the rest.

Other self-knowledge tools: `tool:self_describe` (the attestation), `tool:inquiry` (another Member's identity, act and authority) and `tool:law_read` (the law, by digest).

## The offline auditor

`file:auditor/audit.mjs` replays a session log without the Enforcer's cooperation (`clause:I-7`). It always checks that seqs are contiguous, that turns are balanced, that every approval decision has an earlier ask inside a turn and an outcome from the closed set, and that every finished command has a matching start. The files you pass add further checks:

```
node auditor/audit.mjs <session.v3.jsonl>                        # log conformance only
node auditor/audit.mjs <session.v3.jsonl> --chain <id>.chain     # + integrity against the chain
    --annex <enforcer.annex.json>                                # + the enforcer annex (self-signature, law-digest join)
    --anchors <id>.chain.sigs.jsonl                              # + authorship anchors (needs --annex)
    --identities <chains>/subjects.jsonl                         # + subject certificates and lineage (needs --annex)
    --keyring <keyring.json> --seal <sig.json> --body <compact.md>   # + the law seal (all three together)
    --quiet                                                      # one-line verdict instead of the JSON attestation
```

It exits `0` when the session conforms, `1` when it finds violations and `2` on a usage error or an unreadable log. The attestation's `reliesOn` states the trust basis the run used. Without the chain option it says "log completeness only", meaning integrity was not checked. A signature check whose input was not given is reported as `not checked`, never implied. Every signature that verifies is reported as "VALID under DEV keyring — conveys no standing".

**To check a session's record was not rewritten:** run the auditor with the chain option, as in Demo 1 of `file:docs/demo.md`. That demo also edits a copy of the log and shows the `broken-link` finding.

## The enforcement register

`file:docs/register/register.json` maps each clause to the code that enforces it and the verifier that proves it (`clause:F-5`, both directions). Its `kind` field takes these values:

| kind | Meaning |
|---|---|
| `enforced` | binding now; its cited source and verifier files must exist, and the service's presence is checked at boot |
| `planned` | on the port plan's later phases; not enforced today |
| `convention` | declared, never to be mistaken for enforcement |
| `rehearsal` | the machinery runs under the development keyring and conveys no standing (see below) |

To check the register, run `npm run verify-register` (`file:tools/verify-register.mjs`). It fails when the bundled copy (`file:packages/constitution/register.json`) differs from the canonical one, when the register's digest is not the body's digest, when an entry cites an unknown clause, when an enforced entry's files or verifier are missing, or when a clause is neither registered nor declared unadopted.

## Boot verification and the digest pin

At boot the constitution (`file:packages/constitution/src/index.js`) hashes the bundled law (`file:packages/constitution/compact/compact.md`) and compares it with the digest written into `file:packages/constitution/src/body.js`. It refuses to start on a mismatch, on a missing enforcement service, on a register whose digest differs, or on a register entry citing an unknown clause. It also checks the law seal under the development keyring. `tool:law_read` names the digest of the law in force.

## The rehearsal identity (development keyring)

| Knob | Effect |
|---|---|
| `env:COMPACT_KEYRING_MANIFEST`, `env:COMPACT_KEYRING_SEAL` | point the boot seal check at another manifest and seal; the default is the vendored files in `file:packages/constitution/keyring/dev` |
| `env:COMPACT_TRUSTED_KEYRING_DIGEST` | pin the manifest's sha256; a different manifest refuses the boot |
| `env:COMPACT_ENFORCER_ANNEX`, `env:COMPACT_ENFORCER_KEY` | declare the enforcer annex and its private key, together. The runtime then signs attestations, a record anchor at each flush, and subject certificates (appended to `subjects.jsonl`). A declared annex that is broken refuses the boot |

To create an identity set, run `node tools/rehearsal-keyring.mjs ensure <dir>` (`file:tools/rehearsal-keyring.mjs`). This writes `keyring.json`, `enforcer.pem`, `enforcer.annex.json` and private authority keys. To check a set, run `node tools/rehearsal-keyring.mjs verify <dir>`. Running `ensure` again over an existing set is a key rotation and requires the script's own force option. `file:tools/rehearsal-amendment.mjs` rehearses the amendment loop: it re-seals the law and moves the digest pins together. Design and limits: `file:docs/decision-rehearsal-identity.md`.

## None of this conveys standing

The Compact in force is draft v0.5 and is not ratified. Under `clause:F-5`, this composition claims no Compact standing. The keyring holds practice keys owned by a single party. A valid chain, anchor, seal or certificate proves that the code paths work, not identity or authority (`clause:I-1` remains planned). Telling someone otherwise misstates the record.

See also: `page:running` for launching, `page:delegation` for child sessions and lineage, `page:rights` for the Subject's remedies.
