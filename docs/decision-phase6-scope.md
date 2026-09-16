# Decision record — the Phase 6 scope (Part VI closure, not the artifact substrate)

**Status: DECIDED — Phase 6 is re-scoped.** Recorded 2026-09-16, before Phase 6
work began. Constitutional under A-4: this changes what several clauses mean in
practice, so it is recorded with its reasons before the conduct changes.

## The question

The port plan's Phase 6 ("Artifacts & layers", 3–4 wks) was drafted while
autonoetic was exploring every direction in parallel. Its three deliverables —
a content-addressed artifact store, directory images with layer capture, and a
session-facts tail — are autonoetic's substrate, carried into the plan as a
port target.

The goal of this repository is narrower and sharper: **make dsh a runtime that
enforces the Compact.** Not: make dsh host autonoetic. So each Phase 6 concept
was re-derived against one test:

> Which clause of the adopted body fails to be enforced if we do not build this?

## The finding

Applied clause by clause, most of Phase 6 does not answer to the law.

| Plan deliverable | Clause that demands it | Verdict |
|---|---|---|
| Supply-chain gate at mount time | **CF-2** `[M within CF]` — triggered, live | **keep** — the whole Compact content of the phase |
| Child-task statuses in the session tail | **MA-3** `[M within MA]` — triggered, live | **keep** |
| Content store: scoped refs, expiry, revocation, `artifact.prepare` | none | drop — autonoetic product |
| Directory images: `layer.capture`, dedup, size/file caps | none | drop — autonoetic product |
| Digest-bound approval fingerprint | D-7/I-5, but only if mutable refs exist | moot — Phase 6 would create this hole, then cure it |
| Session tail: task preview, artifact refs | R-1 is Phase 8's attestation; the rest is anti-confabulation UX | drop / fold into Phase 8 |

Content-addressing survives in one minimal form: as CF-2's **identity**
mechanism. Acquisition history cannot honestly be attributed to a mutable name,
so a reused execution environment is identified by digest. That is the only
clause-driven reason this composition needs content addressing, and it needs no
store to satisfy it.

## What the re-derivation found that the plan missed

Part VI is the unfinished business, and it is larger than Phase 6 was.

Three `[C]` triggers are live in this composition, and each has an unbound
mandatory clause:

- **CF** triggered by `compact-sandbox-docker` → CF-1 enforced, **CF-2 unbound**
- **MA** triggered by `compact-specialists` → MA-1/MA-2 enforced, **MA-3 and
  MA-4 unbound**
- **SCH** — `dsh-schedule`, `dsh-jobs`, `dsh-tool-jobs` all ship in the pinned
  `~0.1.5-rc.1` line → **SCH-1 unbound** wherever they are composed

D-8 is explicit that this is the gravest class: an Enforcer that *"declares a
capability without binding the clauses that wake with it, commits a violation
as Enforcer — the defrauded party is the law itself."* Part VI's own preamble
adds that its clauses "cannot be dodged by undeclared use." The register's
`planned` / "debt declared" entries earn I-8 degradation-honesty credit; they do
not discharge D-8.

### CF-2 is breached today, with one config field

`packages/sandbox-docker/src/provider.js` binds `config.image ?? 'ubuntu:24.04'`.
A docker image **is** a reused execution environment: it was built somewhere,
with some network access, and the composition runs it with zero acquisition
history and no digest binding. CF-2 binds to it now. No layer store is required
to be in breach, and none is required to leave it.

This is why the re-scope shrinks the work rather than deferring it: the real
CF-2 subject is the image the provider already runs.

### MA-3 has a verified seam

`@deepseek-ai/dsh-subagent/lib/types/lifecycle.d.ts` publishes
`subagent/start` and `subagent/end` with scoped dispatch keyed by the
delegating parent; the payloads (`SubagentRunInfo`, `SubagentRunEndInfo`) carry
`runId`, the child `SessionId`, the provider, and the terminal `stopReason`.
That is MA-3 almost verbatim: *"informed of child transitions by the Enforcer,
from recorded state, without polling obligations."*

One design constraint falls straight out of the clause text.
`SubagentRunEndInfo.lastAssistantMessage` is the **child's own self-report**,
and MA-3 says the parent's picture is the Enforcer's, *"never the child's
self-report alone."* The projection therefore frames the Enforcer-sourced facts
as authoritative and marks the child's output as the child's claim. It must not
merge the two into one undifferentiated block.

### SCH-1 has a cheap lawful discharge

D-8 leaves exactly two moves for a `[C]` clause: bind it, or make the capability
genuinely absent **and verifiable**. Phase 4's constitution already knows how to
refuse to start. A *negative coupling* — refuse to boot when a schedule or jobs
provider is composed without a pre-scheduling gate — discharges SCH-1 at a
fraction of the cost of building the gate, and is more honest than a register
line reading "ungated — debt declared."

### One reordering: the entrenched record comes forward

R-7 (non-repudiation) and I-2 (the record) are both `(core)`, both entrenched
under A-2, and both `planned` for Phase 8. A-2's own gloss on I-2 is the
argument: *"non-repudiation without a tamper-evident record is a promise, not a
right."*

Meanwhile `auditor/audit.mjs` attests its own trust basis as *"log completeness
only — the dsh session log is NOT tamper-evident."* The Phase 4 auditor is the
I-7 verification machine, and it currently rests on a foundation it openly says
it cannot verify; J-2 (the record is the evidence) is blocked behind the same
gap. The remedy is one `SessionPersistence` decorator over
`dsh-session-persistence-jsonl`, which ships in the pinned line.

Pulling it into this phase costs little and raises the trust basis of
everything already built.

## The decision

**Phase 6 becomes "Part VI closure + the record."**

1. **CF-2** — image provenance (digest-bound, declared acquisition history,
   undeclared image fails closed) + the run-time excess gate.
2. **MA-3** — the Enforcer-sourced child-state projection off
   `subagent/start` / `subagent/end`.
3. **MA-4** — consent-scoped address.
4. **SCH-1** — negative coupling (refuse-to-start), not a built scheduler gate.
5. **I-2 / R-7** — the hash-chained persistence decorator, pulled forward from
   Phase 8.

Items 1–4 finish Part VI; item 5 lands the entrenched clause the rest rests on.

## Consequences

- **The artifact store and layer machinery are dropped, not deferred.** No
  clause asks for them. If a later phase finds a clause that does, it returns
  through this same door, with its own record.
- **Two named costs, accepted.** `artifact_ref` in the auditor and
  sealed-evaluator persona records stays inert, and the archived `packager`
  persona stays archived. Both are autonoetic's work-product-passing
  conveniences.
- **The digest-bound approval fingerprint is not built.** It cures a hole the
  artifact store would have created. With no mutable artifact refs in the
  composition, approval fingerprints keep binding to commands and paths, which
  is already content-honest.
- **Phase 8 shrinks by one deliverable** (the hash chain moves here) and keeps
  the rest of the rights layer.
- **The plan's phase numbering is now nominal.** The port plan has eight phases
  (0–8), not the nine the README claimed; this phase keeps the name "Phase 6"
  for continuity with the register and the persona gate markers, while its
  content is re-derived. Persona files citing "Phase 6 machinery" for artifact
  tools are updated to say the machinery is not coming.
- **A-4 discipline**: every item that lands flips its register entry from
  `planned` to `enforced` in the same change, with its verifier named. The
  register and the conduct move together or the CI gate fails.
