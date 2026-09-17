# Concept — the state of exception (A-8)

*The implementation-agnostic spec `packages/emergency/` cites.*

## The sentence the whole layer defends

> **No emergency suspends this Compact generally.**

Everything below is machinery for making a *bounded* emergency the only kind
that can be declared.

## The three bounds

A-8 defines "bounded" by naming three things: a named scope, a recorded cause,
a fixed expiry. Each is required, and a declaration missing any one is refused.

That is not pedantry. An emergency without a scope is general; without a cause
it cannot be reviewed against its own justification; without an expiry it is
what the clause calls **rule by declaration**. A declaration missing a bound is
not a narrower emergency — it is the thing the first sentence forbids.

A declaration that suspends *nothing* is refused too: it is either pointless or
a general suspension wearing a scope.

## The floor is wider than entrenchment

A-8 protects four rights "even temporarily": exit (R-12), refusal (R-9),
access to one's own record (R-2), independent verification (I-7).

**Only R-2 is entrenched.** The other three are ordinary `[M]` clauses. So the
never-yields set is the *union* of A-2's entrenched set and those four — and a
composition that treated entrenchment alone as the limit would leave three of
the four rights A-8 names explicitly exposed.

Entrenchment itself is **derived from the body's own `(core)` markers**, not
restated. A-2's list and the `(core)` flags are the same thirteen clauses, and
keeping one copy means it cannot drift from the law (F-7).

A declaration naming any floor clause is refused **whole**, never partially
admitted — partial admission would let the floor be probed one clause at a
time.

## Expiry is derived, never stored

"Expiry is automatic." A state someone has to remember to clear is a state that
outlives its term by neglect, and A-8 says an emergency sustained past its term
*is* rule by declaration. So activity is computed from the clock at read time
and nothing has to be honest about it.

Same discipline as the petition layer's `overdue`, for the same reason.

## Renewal is not a new emergency

> "Consecutive and overlapping declarations count as renewal, not as new
> emergencies."

This is an anti-laundering rule. Without it, a permanent emergency could be
held by declaring a fresh one whenever the last expired — each one a *first*
declaration at the lower threshold. Classification is mechanical, keyed on
scope, and recorded on the declaration itself.

## Who may declare — and who may not

"An **Enforcer or Principal** may declare." Not a Subject.

So there is deliberately **no declaration tool on the agent surface**. A
Subject that could declare its own emergency could suspend the clauses that
bind it, which is the self-dealing the clause exists to prevent. Declaration is
a service method the operator reaches; the agent surface is read-only, because
a Member may always learn what exception it lives under.

## "Where practical" is a flag, not an excuse

A-8 makes the notification carve-out a **recorded flag routed to mandatory
review at expiry**. So claiming notice was impractical is itself an act that
lands on the record and travels into the review. You may claim it, and the
claim is evidence.

## R-5: the narrowing a Subject can see

> "A Subject's declared capabilities are not quietly reduced mid-operation. Any
> narrowing is ... recorded **where the Subject can see it**."

An emergency is the one mechanism here that narrows capabilities mid-operation.
So it is surfaced in the R-1 attestation the Subject already reads at every
turn boundary — naming the rule, the scope, the cause, what yields, when it
expires, and the floor no declaration reaches.

That link is what moves R-5 from declared convention to enforcement: the
narrowing exists, and it announces itself.

## Two declared gaps

- **Part V review has no forum.** A-8 requires every expired emergency to be
  reviewed, and no adjudicating machinery exists (J-8). Expired emergencies are
  queued and the queue is **surfaced rather than drained** — an unreviewed
  emergency must look unreviewed.
- **The heightened renewal threshold is recorded, not measured.** A-8 requires
  renewal to clear a higher threshold than the declaration, and this
  jurisdiction has no voting or quorum substrate to measure one against (A-1,
  A-7). A renewal is classified, marked and recorded as such; the heightened
  threshold is declared debt.
