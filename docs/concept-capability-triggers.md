# Concept — capability triggers and the two lawful postures

*The implementation-agnostic spec `packages/capability-gate/` cites. Phase 6
(re-scoped — see [the decision record](decision-phase6-scope.md)).*

## The problem

The Compact's Part VI clauses are dormant until a capability is present:

> Dormant clauses. Each part opens with its trigger; each binds fully the
> moment the trigger is present, and cannot be dodged by undeclared use (D-8).

D-8 then names the failure precisely:

> An Enforcer that uses a capability without declaring it (to evade its [C]
> clauses), or **declares a capability without binding the clauses that wake
> with it**, commits a violation *as Enforcer* — the gravest class, because the
> defrauded party is the law itself.

A composition therefore cannot answer "we hold the capability but we do not use
it". Holding it is the trigger.

## The two postures

For each capability-stratified part, exactly two postures are lawful:

| Posture | What it means | What proves it |
|---|---|---|
| **BIND** | the capability is present and a service binds every clause that wakes with it | a register entry per clause, `enforced`, with its verifier |
| **ABSENT** | the capability is genuinely unavailable | the unavailability is itself mechanically enforced |

"Present but unbound" is the violation. So is "absent by intention" — an
absence that nothing enforces is a convention, and a convention presented as
conformance is the fraud D-8 names.

## What this composition holds

| Part | Trigger | Posture |
|---|---|---|
| MA | the Enforcer provides Subject-spawning (`ctx.subagents`) | BIND — `compact-specialists` (MA-1…MA-4) |
| CF | the Enforcer confines execution (`ctx.sandbox`) | BIND — `compact-sandbox` (CF-1, CF-2) |
| SCH | the Enforcer acts unattended on a clock (`ctx.schedule`) | ABSENT — refused, and the refusal enforced |
| MEM, FED | `[O]`, optional | unadopted, declared in the register |

## Reading a trigger narrowly is part of the duty

Over-declaring a trigger is its own D-8 problem: it wakes clauses the Enforcer
does not in fact trigger, and binds the composition to enforcement it cannot
honestly claim.

SCH is the live example. The host's `ctx.jobs` registry (`job_list`,
`job_output`, `job_kill`) runs **attended** background processes inside a live
session — no unattended authority is held, so SCH does not wake.
`@deepseek-ai/dsh-schedule` is the clock: `schedule_create` arms an
after/at/every rule that fires with no Member present, which is exactly the
authority SCH-1 governs. Only the second is a trigger.

## Enforcement shape

1. **At boot** — a triggered part with no binding service refuses the
   composition (F-5). This is the only moment when refusing to start is still
   available.
2. **After boot** — a trigger that mounts later latches a **breach**, and every
   tool call is denied until it is bound or removed. A boot-only check would
   make the clause depend on load order, which is the undeclared use Part VI
   forbids; and a throw from inside event dispatch is not reliably loud, so the
   fail-closed answer is denial rather than an exception (D-7).
3. **At clause granularity** — a service that claims a part is not proof that
   every clause of that part is bound. Once the constitution's rule registry
   exists, every clause of every triggered part must be registered as
   `enforced`, or the composition is in breach. Part-level binding is the
   boot-time approximation; this is the real check.
4. **For an absent capability** — the triggering tools are denied in the
   waterfall with a Compact envelope naming the clause and the lawful next
   moves.

## Why absence is a stronger answer than a gate, here

SCH-1 requires that "a scheduled act requires its class of gate *before*
scheduling". Building that gate means building a scheduler policy layer. But
"no scheduled act may be armed at all" satisfies the clause outright, is
cheaper, and — unlike a register line reading *ungated — debt declared* — is a
fact a verifier can check.

Absence is not always the better answer. It is the better answer when the
composition genuinely does not want the capability, which is the case here: no
part of this composition's work needs the Enforcer to act while no Member is
present.
