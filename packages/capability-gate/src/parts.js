// The Part VI trigger table — the map from a host capability to the clauses
// that wake with it.
//
// Part VI's preamble: "Dormant clauses. Each part opens with its trigger; each
// binds fully the moment the trigger is present, and cannot be dodged by
// undeclared use (D-8)."
//
// D-8 leaves exactly two lawful postures for a capability-stratified part:
//   BIND    — the triggering capability is present and a service binds its
//             clauses; the register says `enforced` and names the verifier.
//   ABSENT  — the capability is genuinely unavailable, and that unavailability
//             is itself mechanically enforced rather than merely intended.
//
// "Present but unbound" is the violation, and "we simply do not use it" is not
// a third posture: an Enforcer that holds a capability it has not bound has
// defrauded the law whether or not it reached for it.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

/**
 * Detection is deliberately narrow. Over-declaring a trigger is its own D-8
 * problem: it would wake clauses the Enforcer does not in fact trigger, and
 * bind the composition to enforcement it cannot honestly claim.
 *
 * In particular, SCH's trigger is the CLOCK, not background work. The host's
 * `ctx.jobs` registry (`job_list`/`job_output`/`job_kill`) runs attended
 * background processes inside a live session — no unattended authority is
 * held. `@deepseek-ai/dsh-schedule` is the clock: `schedule_create` arms an
 * after/at/every rule that fires without a Member present, which is exactly
 * the authority SCH-1 governs.
 */
export const CAPABILITY_PARTS = [
  {
    part: 'MA',
    trigger: 'the Enforcer provides Subject-spawning',
    clauses: ['MA-1', 'MA-2', 'MA-3', 'MA-4'],
    hostServices: ['subagents'],
    hostTools: [],
    boundBy: 'compact-specialists',
  },
  {
    part: 'CF',
    trigger: 'the Enforcer confines execution',
    clauses: ['CF-1', 'CF-2'],
    hostServices: ['sandbox'],
    hostTools: [],
    boundBy: 'compact-sandbox',
  },
  {
    part: 'SCH',
    trigger: 'the Enforcer acts unattended on a clock',
    clauses: ['SCH-1'],
    hostServices: ['schedule'],
    hostTools: ['schedule_create'],
    // No service in this composition binds SCH-1. The lawful posture is
    // ABSENT: scheduling is refused, and the refusal is the enforcement.
    boundBy: null,
    absentBecause:
      'this composition adopts no scheduling capability: no pre-scheduling gate exists, so unattended acts are refused ' +
      'outright rather than armed under an ungated clock (SCH-1)',
  },
];

/** Which parts are triggered in this composition, and which of those are unbound? */
export function assessParts(ctx, parts = CAPABILITY_PARTS) {
  const has = (name) => {
    try { return ctx.get?.(name) !== undefined; } catch { return false; }
  };
  return parts.map(p => {
    const triggeredBy = p.hostServices.filter(has);
    const triggered = triggeredBy.length > 0;
    const bound = p.boundBy != null && has(p.boundBy);
    return { ...p, triggered, triggeredBy, bound, unbound: triggered && !bound };
  });
}

/** The refusal text for a triggered-but-unbound part (D-8, F-5). */
export function unboundMessage(p) {
  return (
    `capability-gate: the composition holds the ${p.part} capability (${p.trigger}) — provided here by ` +
    `${p.triggeredBy.join(', ')} — but nothing binds ${p.clauses.join(', ')}. ` +
    `An Enforcer that declares a capability without binding the clauses that wake with it commits a violation AS ENFORCER, ` +
    `the gravest class, because the defrauded party is the law itself (D-8). ` +
    (p.boundBy
      ? `Compose ${p.boundBy}, or remove the capability from the composition; refusing to start (F-5)`
      : `${p.absentBecause ?? 'no service binds this part'} — remove the capability from the composition; refusing to start (F-5)`)
  );
}
