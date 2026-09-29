# Concept — the tamper-evident record (I-2, R-7)

*The implementation-agnostic spec `packages/record/` cites. Phase 6
(re-scoped — see [the decision record](decision-phase6-scope.md)); pulled
forward from the port plan's Phase 8.*

## Why this is not optional and not late

I-2 and R-7 are both `(core)`, and both sit in **A-2's entrenched set** — the
clauses that "may be strengthened, never weakened by ordinary amendment". A-2
states the dependency in its own words:

> I-2 (the record — the predecessor's P-8.1: non-repudiation without a
> tamper-evident record is a promise, not a right)

Everything already built rests on it. Before this layer, the composition's own
offline auditor (I-7) attested its trust basis as *"log completeness only — the
dsh session log is NOT tamper-evident"*, and J-2 ("the record is the evidence")
had no evidence to stand on.

## The chain

```
entryHash[i] = H( entryHash[i-1] , seq_i , canonical(event_i) )
entryHash[-1] = H( "compact-chain-v1" , sessionId )
```

Three design choices carry the two clauses:

**Genesis is seeded from the session identity, not a constant.** This binds the
chain to the Member whose acts it records. A chain lifted from one session and
presented as another's fails at its first link — so an act cannot be
retroactively reattributed (R-7) by moving its record to a different Member.

**The seq is inside the link.** Reordering a log is a rewrite, and a chain that
did not commit to position would not notice one.

**Canonicalization sorts keys at every depth.** Two different events must never
canonicalize alike, or the chain proves nothing about which one happened; a
re-serialized event must hash identically, or ordinary round-tripping would
look like tampering.

## Where the chain lives, and why beside the log

The host's storage contract validates stored events against the current event
vocabulary and "refuses unknown vocabulary fail-closed". Threading chain fields
through the events would mean declaring a capability over the session
vocabulary this composition does not have — a plugin that quietly extends what
an event may contain is exactly the undeclared capability D-8 names.

The chain therefore lives in a **sidecar**: it commits to the log without
touching it, and the storage format is unchanged.

## Write ordering decides how a crash fails

The two writes cannot be atomic, so the ordering is the design:

- **links first, then the log** — a crash can leave a link with no event.
  Harmless: the event never happened and nothing claims it did.
- **the log first, then links** — a crash can leave an event with no link,
  which reads as *appended outside the record discipline*: a state
  indistinguishable from tampering, produced by ordinary crashes.

The chain commits, and the log follows.

## A failed verification rejects

A read whose slice does not verify **throws**. It does not return the events
with a warning attached. D-7 makes uncertainty block rather than pass silently,
and history that cannot be verified must not reach a caller dressed as history.

The cost is real — a broken chain makes a session unreadable — and it is the
correct cost. A session whose record is not evidence is a session no decision
should rest on.

| Failure | Meaning |
|---|---|
| `broken-link` | the event does not hash to its committed link: it was altered after the fact (D-3) |
| `missing-link` | an event exists the chain never committed to: something appended around the discipline |
| `no-anchor` | the link before the slice is absent: the slice cannot be tied to the genesis identity |

## The declared limit

The record is tamper-**evident**, not tamper-**proof**. Anyone who can rewrite
the log can also rewrite the sidecar. What they cannot do is leave the pair
consistent without the composition's cooperation, so an alteration is
detectable by anyone who kept a prior head link.

Signing links under an identity key (I-1) is the next step, and is deliberately
not taken: the Compact has published no amendment keys, so a signature would
attest to a key no verifier could check. The gap is declared in the boot
record, not papered over.

## The auditor consumes it

`auditor/audit.mjs --chain <id>.chain` verifies the log against its committed
links **offline, with no cooperation from the Enforcer** — which is the whole
point of I-7: a verifier that had to ask the Enforcer whether the Enforcer had
behaved would verify nothing. Without a chain the auditor still runs, and says
plainly that it is relying on log completeness alone.

## The Subject reads it too (R-2)

> Every Subject may read the record of acts done in its name and on its
> behalf. […] Audit is not a privilege of operators; it is a right of the
> subject.

The composition masks the record root and the chain dir from every confined
call, because a Subject that can write its evidence can rewrite it. That
masking also removed the read. For a while the record was complete and
readable only by the operator and the offline auditor, and the register
called R-2 a `convention` resting on a log the Subject could not reach (#67).

`record_read` (`packages/record/src/read.js`, registered by the provider) is
the read path through the Enforcer:

- **Verified before rendered.** Each read uses the chained persistence, so the
  slice is checked against the chain first. A failure answers as an alarm
  naming the break, the same fail-closed rule the record keeps (D-7).
- **In its name and on its behalf.** It covers the Subject's own session and
  those of its delegated descendants. The lineage is walked upward from the
  target's *durable* header (`parentSession`), not from a live registry.
  Anything else is refused with its reason.
- **Acts, not minds.** In a descendant's record, the reasoning-bearing events
  (`assistant/message`, `assistant/attempt`, `compaction/summary`,
  `request/context`) are listed by seq and type with their content withheld.
  R-10 keeps another Member's unstated reasoning private, and R-2 grants acts.
  Listing them keeps the record's shape visible: nothing is hidden, only
  withheld.
- **Fresh and citable.** The target's buffered writer is flushed first, and
  every answer names the verified range and the chain head.
