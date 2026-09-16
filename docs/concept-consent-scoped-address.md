# Concept — consent-scoped address (MA-4)

*The implementation-agnostic spec `packages/specialists/src/consent.js` cites.
Phase 6 (re-scoped — see [the decision record](decision-phase6-scope.md)).*

## The clause

> **MA-4 · [M within MA] · Consent-scoped address.** One Subject's context is
> not a commons: no Member injects into another Subject's attention — messages,
> notifications, memory writes — outside consent scopes that recipient has
> declared. Unsolicited address is a gated, attributed, refusable act; the
> recipient's refusal is lawful and unpunished (R-9), and consent scopes are
> themselves recorded acts, narrowed or withdrawn as the recipient chooses.

## What the channel actually is on dsh

A Member reaches another Subject's attention through exactly one surface: a
**tool call**. `send_message` steers or wakes another agent; `interrupt_agent`
cuts into its active operation. Both come from
`@deepseek-ai/dsh-tool-subagent-control`, both name their target by agent id,
and both carry the calling agent as `exec.agent`.

Gating those two in the pre-execute waterfall gates the whole MA-4 surface.

## What is deliberately not governed here

The Enforcer's own notices — the MA-3 child-state projection, a LoopGuard
correction — are not MA-4 acts. This is not an exemption of convenience: MA-4
binds a **Member** injecting into another Subject. What the Enforcer owes a
Subject is governed by R-1, R-5 and MA-3, which *oblige* the telling rather
than gate it.

The host's own structural bound (a Member may address only its direct
continuable child or its direct parent) is lineage, not consent. It is a
narrower pipe, not a declared scope, and it is not a substitute for one.

## The default scope, and its honest limit

A delegation creates a working relationship in both directions: the parent
solicited the child's work, and the child's whole operation *is* that
delegation. So the spawn — already a recorded, attributed act under MA-1 —
records the reciprocal scope, and the lifecycle edge MA-3 already consumes is
where it is written. The basis travels with the scope: `the delegation that
created this child (MA-1)`.

**The limit, stated plainly:** a child did not choose to exist, so a default
scope over a child's attention is a declaration made by the act that created
it, not by the child. The clause's protection is preserved in the direction it
emphasises — the recipient may narrow or withdraw at any time, and the
withdrawal binds immediately.

**Widening is not implemented.** No sibling-address channel exists on dsh, so a
wider scope could enable nothing lawful, and a knob with no lawful use is
surface waiting to be misused. The gap is declared rather than quietly left
open.

## Only the recipient may narrow

A sender that could revoke the recipient's protection would make that
protection the sender's to give — which is not a protection at all. So
`consent_withdraw` changes only scopes over the caller's own attention, and an
attempt by the sender is refused with its reason.

Narrowing to nothing **is** withdrawal. A no-op narrowing is refused as one: a
change that removes nothing is not a narrowing, and recording it as one would
put a false act on the record.

Withdrawn scopes stay on the record. Consent scopes are recorded acts, and a
deleted act is not a record.

## The refusal

| Rule ID | When |
|---|---|
| `MA-4/unconsented-address` | no live scope covers (sender → recipient, kind) |
| `MA-4/unattributable-address` | the act names no author or no target — it cannot be attributed, so it fails closed (D-7) |

The refusal names the sender (attributed), explains that another Subject's
context is not a commons, and tells the sender that **the refusal is lawful and
carries no fault for either party (R-9)** — so it is not read as a fault to
route around.
