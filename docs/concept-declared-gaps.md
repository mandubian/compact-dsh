# Concept — declared gaps (I-8, F-5): how the composition states what it does not do

*The mechanism that every enforcement service participates in — and that
every reader of `self_describe` or a boot attestation consumes. The trigger
for writing this down: a live run printed two contradictory record lines at
once — see [the authority-boundary decision record](decision-rehearsal-identity.md)
and PR #12, which made the structure described here mechanical.*

## What a declared gap is

A **declared gap** is an enforcement service's machine-carried confession of
what it does not guarantee. The record says *"I detect rewrites, I cannot
prevent them."* The sandbox says *"my image provenance is operator-declared,
not verified."* The constitution says *"the law is a draft; no standing is
claimed."*

The legal weight comes from D-8 and F-5 together: the difference between an
**unadopted** capability and a **held-but-ungoverned** one — between a
convention and enforcement fraud — is whether the omission is *said*, in the
artifact, where the governed party reads it. A gap declaration is therefore
not a disclaimer in the legal-contract sense; it is the honesty surface
itself, and it has the same rigor as enforcement:

- **Labels travel with the artifact.** A basis ("dev-keyring — conveys no
  standing") lives inside the attestation/seal/anchor it describes, never in
  a side note.
- **A false line is worse than a missing line.** A missing gap is silent
  degradation (bad). A gap that contradicts reality trains every reader to
  discount the whole list (worse): loud honesty has degraded into noise,
  which is the I-8 failure.
- **Uncertainty blocks (D-7).** When a posture cannot be determined, the
  composition refuses or alarms; it does not print both postures and let the
  reader guess.

## Who declares: one fact, one declarer

Each service owns the truth about **its own** posture and exposes it as
`declaredGaps` on its service object:

| Service | Owns and declares |
|---|---|
| `compact-record` | tamper-evidence vs tamper-proof; unsigned links vs authorship anchors |
| `compact-sandbox` | image provenance basis; confinement limits |
| `compact-self-model` | the attestation's own signature basis (`unsigned` / `dev-keyring`) |
| `compact-constitution` | draft-not-ratified status; the law-seal basis |

The rule PR #12 made structural: **the service that owns a fact is the only
declarer of that fact.** The constitution no longer restates the record's
posture — it substitutes those lines from `compact-record.declaredGaps`
(static text survives only as a no-service fallback). A restatement is a
second copy of a live fact, and second copies diverge the moment a posture
moves.

## How the lists flow

Two aggregation points, two audiences:

1. **Boot attestation** — the constitution applies last, reads every sibling's
   `declaredGaps`, and publishes the snapshot (`constitution.attestation()`):
   what was verified (body digest, law seal, required services), what rules
   are registered, what gaps are owed. Audience: the boot record and any
   auditor.
2. **Per-turn attestation** — the self-model re-aggregates the same sources
   into the block injected at every `turn/start` and readable via
   `self_describe`. Audience: the Subject, which R-1 makes authoritative over
   the Subject's own memory.

## Posture-awareness: declarations move when posture moves

A gap list may legitimately change with configuration — the record provider
declares *anchored* wording when an enforcer annex is composed and *unsigned*
wording when not. The discipline is that **the declaration must move with the
posture**: a declared signer that fails to sign refuses the act, and a stale
line next to a current one is a defect (it was a live-run finding, fixed in
PR #12). When reading an attestation, expect the gap lines to agree; when
they don't, treat the attestation as broken — that instinct is the point of
writing this down.

## Gaps vs enforcement: the boundary

A declared gap never substitutes for enforcement — saying "I don't do X" is
what makes not doing X *honest*; it does not make X governed. Conversely,
enforcement never exempts a service from declaring its limits: the record is
`enforced` for I-2/R-7 *and* declares it is tamper-evident, not tamper-proof.
The register (`docs/register/register.json`) carries the same discipline at
the law level — `enforced` / `planned` / `convention` / `rehearsal` are all
ways of saying exactly what is and is not guaranteed, with verifiers required
for every claim that could fail.
