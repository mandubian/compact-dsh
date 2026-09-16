# Decision record — Phase 7 scope: the Subject's own knowledge, signature deferred

**Status: DECIDED.** Recorded 2026-09-16, before the work. Constitutional under
A-4, and following the same re-derivation the
[Phase 6 record](decision-phase6-scope.md) established.

## The constraint

The Compact's amendment process is taking longer than expected, so **no
identity keys are published and none are imminent**. Anything whose enforcement
*is* a signature is blocked, not merely late.

## What that actually blocks

Applied to the 20 clauses still `planned` after Phase 6, the constraint is
narrower than it first appears. Only two clauses are blocked at their core:

| Clause | Why blocked |
|---|---|
| **I-1** identity and keys | the enforcement *is* key verification |
| **A-1** amendment authority | thresholds are ratification-time key constants |

Everything else is blocked only in part, or not at all. In particular the port
plan's Phase 7 (capsules: signed exports, trusted-signer lists, revision
immutability) is blocked almost entirely — and re-derived against the clause
test, most of it answers to no clause anyway. Its one clause-driven piece is
**gating dynamically mounted plugins under A-4** ("the Enforcer's code is
constitutional"), which does *not* need signatures: the capability-absent
posture proven for SCH-1 in Phase 6 would discharge it. That is recorded here
as available work, not done here.

## The decision

**This phase takes R-1 (self-knowledge) and R-13 (inquiry).** They are coupled —
R-13's answer is owed "from the attestation and the delegation record" — both
are `[M]`, and neither needs a key.

There is also an inconsistency to close. The MA-3 child-state notice shipped in
Phase 6 tells a parent that the Enforcer's record is authoritative over the
child's account, and D-2 obliges a Subject to consult its attestation over its
own recollection. **No attestation existed for it to consult.** The discipline
was taught and unavailable, which is a worse posture than not teaching it.

## The signature question, answered honestly

R-1 says "a **signed** attestation". This one is not signed. Two postures were
available:

1. Leave R-1 `planned` until keys exist.
2. Deliver the attestation now, unsigned, and declare the limit.

**Posture 2**, on the same reasoning as CF-2's `operator-declared` basis and the
record's tamper-evident-not-tamper-proof limit. The argument:

- Every **field** the clause enumerates is available today, and each is read
  from the service that holds it.
- The clause's **function** — "authoritative over the Subject's own memory",
  with staleness as an alarm — works unsigned *within one jurisdiction*,
  because the attestation is the Enforcer's own state rather than a claim
  needing external verification.
- What the signature buys is **cross-boundary** proof, which is I-3's and F-6's
  concern, not R-1's delivery.
- The debt already has a home: **I-1 carries the signature debt**, and it stays
  `planned`. R-1 carries the delivery. The attestation itself states
  `basis: 'unsigned'` and names the limit among its declared gaps, so
  authoritative-within-this-runtime is never read as provable-to-another.

Double-counting the same debt in two register entries would overstate what is
owed; hiding it in neither would understate it. One entry, named precisely.

## What was deliberately *not* claimed

**D-2 stays `convention`.** The attestation now exists and is taught at every
boundary, which is what D-2's register entry was waiting for — but D-2 is a
duty *on the Subject* ("a Subject shall consult its attestation over its own
recollection"). An Enforcer can deliver and teach it; it cannot make a Member
consult it. Marking it `enforced` would claim mechanical enforcement of
something mechanically unenforceable.

**I-3 stays `planned`,** with its evidence corrected: the per-boundary
attestation is now delivered; only the signature is missing.

## Consequences

- R-1 and R-13 move to `enforced`: **30 clauses enforced, up from 28.**
- `compact-self-model` joins the blessed composition, on the same terms as the
  other enforcement services.
- The remaining unblocked work, in rough order of value: the petition and
  contestation queue (R-11 core+entrenched, I-6, A-5); termination under law
  and care-handover (R-8, R-12); the state of exception (A-8); dynamic-plugin
  gating under A-4.
- The judicature (J-1 through J-8) remains the largest deficiency and is **not**
  key-blocked — it is blocked on a governance decision this repository cannot
  make alone: J-8's adjudicator sets are undeclared.
