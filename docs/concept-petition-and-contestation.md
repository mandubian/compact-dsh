# Concept — petition, contestation, dissent (R-11, I-6, A-5)

*The implementation-agnostic spec `packages/petition/` cites.*

## Why this one matters more than its size

R-11 is `(core)` and entrenched under A-2, and its closing sentence is the
argument: **"The right to seek change of the law is what makes subjection to it
legitimate."**

A composition that enforces a great deal and can be asked to change nothing is
not a jurisdiction. It is a cage with good documentation.

## Four properties that make the right real rather than decorative

### 1. The channel is ungated

`petition` passes through no approval layer, and the plugin registers no gate
of its own. A petition channel a gate can close is not a channel — and the
Member most likely to need it is precisely the one currently being refused.

### 2. A vacuous answer does not answer

R-11: *"every response to a petition carries the I-4 envelope fields, so a
vacuous response is **detectably** non-conforming."*

Detection that merely annotated the response would leave the petition answered
by something the clause calls non-conforming. So a response missing its rule,
reason, motivation, or the petitioner's lawful next moves is **refused**: the
petition stays open, its term keeps running, and the attempt is recorded.

A duty you can discharge with an empty answer is not a duty.

### 3. The term runs whether or not anyone looks

`overdue` is **derived from the clock at read time**, never stored. A state
someone has to remember to set is a state that stays `open` forever by neglect,
which is how a stated term quietly becomes no term.

### 4. Invitations fire mechanically

R-11: *"repeated collisions between law and practice generate amendment
invitations **automatically** […] invitations trigger **mechanically** at a
statutory count of distinct instances."*

There is no approval step and no way to decline to notice. A trigger someone
can decline is not mechanical, and the whole point is that the legislature
cannot ignore friction it finds inconvenient.

## Distinct instances is the entire signal

The counter keys on `(rule, operation)`, and the distinction carries the clause:

| Observation | Meaning | Whose business |
|---|---|---|
| one operation blocked 40 times | an agent is stuck | the **LoopGuard** |
| 40 different operations blocked by one rule | law and practice have diverged | the **legislature** |

Counting raw refusals would conflate them, and the loudest signal would always
be whichever agent was looping hardest.

The evidence source is the refusal seam already on the Cordis bus — the one
Phase 1 built for the LoopGuard. A refusal **is** a collision between law and
practice: the law refused what practice attempted. The counter listens where
the evidence already flows rather than asking anyone to report on themselves.

A Member's own `flag_collision` counts equally. R-11 says collisions "are
recorded facts any Member may flag", and the clause does not privilege the
Enforcer's view of friction.

## Dissent (A-5)

> "The minority of today is the corrective organ of tomorrow; its reasons are
> kept where fallibility will be able to find them."

*Where fallibility can find them* means **with the decision**, not in a
separate list that can drift or be pruned. So a dissent is stamped with the
decision's time, author, and outcome; requires reasons (a dissent without
reasons preserves nothing); accumulates rather than replaces; and the register
exposes no operation that removes one.

A decision is likewise never overwritten. It is amended by a **new petition**,
so the original stands.

## Three declared gaps

- **The threshold is a composition convention, not a statutory count.** R-11
  says "statutory", and this jurisdiction has enacted no statute (A-7). Calling
  a configuration value statutory would be exactly the fraud D-8 guards
  against, so the invitation records its own basis.
- **Contested *application* has no forum.** I-6's last sentence routes it to
  Part V, which does not exist here. This builds the **petition** door only —
  J-5 makes petition and appeal different doors, and only one is open.
- **Amendment 0002's three-series collision split is not enacted.** Its
  reference design would let only conscience-collisions advance the count
  (splitting off policy and self-binding refusals, so organizations arguing
  with themselves do not inflate the trigger). That lives in the amendment
  record as statute-layer design, so every collision counts alike here rather
  than being approximated.
