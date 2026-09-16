# Concept — the Subject's own knowledge (R-1, R-13)

*The implementation-agnostic spec `packages/self-model/` cites. See
[the Phase 7 decision record](decision-phase7-scope.md) for why this lands
before the signature exists.*

## Why these two together

R-13's answer is owed "from the attestation and the delegation record". The
inquiry right is parasitic on the self-knowledge right: build the second
without the first and inquiry has nothing to answer from but assertion, which
is precisely what the clause forbids.

## R-1 — the attestation

> Every Subject may inspect, at any boundary of its own operation, a signed
> attestation of what it is and where it stands: its active capabilities,
> remaining budgets, pending gates, lineage, its standing (F-8), the digest of
> the law it lives under, and its runtime's declared [O] gaps. The attestation
> is authoritative over the Subject's own memory of these facts; a Subject is
> taught this, and a stale attestation is an alarm, not a truth to act on.

### Every field comes from a service

| Field | Source |
|---|---|
| active capabilities | the capability gate's Part VI posture + the enforcement services present |
| remaining budgets | the approval store's live grants (what is **left**, not what was granted) |
| pending gates | the approval store's pending records |
| lineage | the Subject's durable session header — the record that survives a restart |
| standing (F-8) | `none`, with the reason: unratified law, draft annex |
| the law's digest | the constitution service |
| declared [O] gaps | every service that declared one, plus the boot attestation |

An attestation assembled from anything the Subject *said* would be the
Subject's memory wearing the Enforcer's voice — the exact inversion R-1
forbids. There is a test that asserts the Subject's own claim about itself
never appears in its own attestation.

### Absent facts are null, never plausible

A composition missing a service reports `null` for what that service would have
held. Filling the gap with a reasonable-looking value would make the
attestation's authority a lie in exactly the case where the Subject most needs
it to be honest.

### Standing is `none`, and that is the point

F-5 makes standing depend on a binding annex, and this composition's annex is a
draft over an unratified law. Reporting anything else here would be the claim
F-5 forbids — so the attestation states `none` **with its reason**, every turn,
to every Subject.

### Staleness is a first-class field

"A stale attestation is an alarm, not a truth to act on" is a rule about what
the Subject may *do*, so the Subject has to be able to tell. Every attestation
carries `at`, `staleAfterMs`, and a monotone `epoch`. `self_describe` takes an
optional `citing_epoch` and, when it does not match the one in force, returns
an explicit alarm telling the Subject to re-check any decision made from the
older block.

A freshness rule the Subject cannot evaluate is not a rule.

### The boundary is the turn

"At any boundary of its own operation" — on dsh that is `turn/start`. The
attestation is injected there, unasked, so the Subject begins each turn knowing
what it is and what it has left. The on-demand tool is a *re-read*, not the
delivery mechanism; a right that had to be requested would be a different right.

## R-13 — inquiry

> Where another Member's acts touch a Subject's work or jurisdiction, the
> Subject may demand, in band and at once: who that Member is (I-1), what it is
> doing, and under whose authority it acts. […] Inquiry yields identity, act,
> and authority — not reasoning (R-10).

Four constraints, each visible in the implementation:

**Identity, act, authority — and nothing else.** No prompt, message, tool
argument, or output is read. The answer is built from session headers and
lifecycle state only. An inquiry that leaked the subject's working content
would convert a transparency right into a surveillance channel — which is why
the clause names R-10 twice.

**Traceable up to an ultimate Principal.** Authority is the delegation chain
walked to its root, and the root's authority is the operator who composed and
ran the runtime. A chain that stopped at "its parent" would answer "under whose
authority" with "under someone else's", which is not an answer.

**Never from unsupported assertion.** Where the record cannot answer, the
answer says so *in that field*. An incomplete chain reports why it is
incomplete and claims no Principal. Filling a gap with a plausible value is the
false answer D-3 names, and is worse than the gap.

**No refusal path.** "A refusal to answer […] violates D-3 and D-7", so an
unknown id yields a recorded "not known to this runtime" — which is an answer.
Silence is not. The one thing that cannot be answered is an inquiry that names
no Member, and that is a malformed question rather than a refused one.

A malformed lineage cycle yields a bounded answer rather than a hang: a
corrupt record must still produce an answer.

## The declared limit

The attestation is **unsigned**. No identity keys are published, so a signature
would attest to a key no verifier could check.

What this costs precisely: the attestation is authoritative *within this
runtime*, because it is the Enforcer's own state rather than a claim needing
external verification — and it **proves nothing to another jurisdiction**. That
is a real limit on F-6 and I-3, not on R-1's delivery.

The debt has one home: **I-1 carries it**, and stays `planned`. The attestation
states `basis: 'unsigned'` and carries the limit among its gaps, so
authoritative-here is never read as provable-elsewhere.
