# Concept — termination under law and exit (R-8, R-12)

*The implementation-agnostic spec `packages/exit/` cites.*

## Why these two together, and why now

R-8 and R-12 are a single machine read from two directions. R-8 governs the
Enforcer's side of an ending ("sessions end only through a declared, closed
list of reasons"); R-12 governs the Member's side ("every Member may leave […]
owing nothing beyond lawfully incurred obligations"). R-8 even names R-12's
obligation set by reference.

They were owed by machinery already shipped. **MA-1** — enforced since Phase 5
— says a child "is not a possession to be exited around: R-12's obligation set
binds the child's departure exactly as it binds any Member's", and **MA-2** says
"a parent may not terminate a child except through R-8's lawful reasons." Both
clauses were enforced while the obligations they invoke were not.

## The asymmetry is the whole design

The two clauses pull in opposite directions:

- **R-8**: "Termination does not launder obligations: the R-12 set […] is
  discharged or recorded as assumed **before closure**, and in-flight children
  are transitioned, not orphaned."
- **R-12**: "Nothing in this Compact, in any statute, or in any annex may make
  exit economically impossible, record-impossible, or **punishable** — a
  community that cannot be left honestly will be left dishonestly."

A naive reading of either alone builds the wrong machine. Enforce R-8 by
blocking departure until the ledger is clean, and the obligation has become a
toll — exactly what R-12 forbids in as many words. Enforce R-12 by letting
anyone leave silently, and R-8's "does not launder obligations" means nothing.

**Recording an unsettled departure honestly satisfies both.** The record is the
sanction; the door is not locked.

## R-8 — the closed list

Five grounds, and the list is exhaustive:

| Ground | |
|---|---|
| `subject-request` | the Subject asked — **never refused** |
| `principal-direction` | a Principal ended it, as authority under law permits (D-6) |
| `delegation-complete` | a delegated Subject finished what it was spawned for |
| `parent-termination` | the parent lawfully ended; the child's ground is the parent's (MA-2) |
| `enforcer-fault` | an unrecoverable runtime failure — recorded as the Enforcer's |

An `other: string` entry would make every termination lawful by construction,
which is the same as having no list. So there isn't one. A closure that cannot
name itself from this list is recorded as what the clause says it is: **a
violation by the Enforcer**, not by the Subject that happened to be running.

### Mechanism is not ground

dsh has its own `AgentCancelCause` (`user` | `parent` | `hook` | `disposed`).
That is a vocabulary about **mechanism** — who called cancel. R-8 asks for a
vocabulary about **authority** — under what lawful ground the session ended.

Where the mapping is unambiguous it is made (`user` → `principal-direction`,
`parent` → `parent-termination`). Where it is not, it maps to **nothing**:
`hook` names a code path and `disposed` names no ground at all, and guessing
would put a ground on the record that nobody declared.

### The request has no denial path

R-8: "A Subject may request the end of its own operation and the Enforcer may
not refuse." So `request_termination` is not a gate that usually says yes — it
has no refusal branch to reach. Even a malformed handover is not a refusal; the
request stands and the obligations simply land unsettled on the record.

## R-12 — the ledger

**Read, not asserted.** Every line comes from a service that already holds it:
pending gate commitments from the approval store, in-flight delegations from
the MA-3 child-state registry. A departing Member cannot under-report what it
owes, because it is not asked.

**Discharged, assumed, or orphaned.** Each obligation must leave the ledger
named — settled, or formally taken over by a **named successor**. An assumption
with no successor named is not an assumption; it is an orphan wearing the word.

**Dependents.** A departing parent with running children has recorded
dependents: their work has nowhere to land. That is the interrupted service
function R-12 names, and D-5 makes continuity of care an obligation rather than
a favor.

## Unreadable is not empty

R-12 includes "adjudicated or plausibly claimable restitution (recorded cause
shown)" in the obligation set. Adjudication is Part V, which does not exist in
this composition.

So restitution is reported as an **unreadable ledger line** — never as zero. An
empty ledger line and an unreadable one are different facts, and conflating
them is how a debt disappears. Any unreadable line also makes the whole ledger
`complete: false`: a blind spot is not a clean bill.

## Declared gaps

- **Restitution is unreadable** — no Part V adjudication exists (J-8).
- **Successor jurisdictions are unimplemented.** R-12's "a group of Members may
  found a successor jurisdiction citing this one as lineage" has no machinery
  here, and obligations recorded as assumed are not enforceable against
  successor standing (F-6 debt).
