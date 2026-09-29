// compact-dsh-capability-gate — Part VI's own enforcement (Phase 6, re-scoped;
// see docs/decision-phase6-scope.md).
//
// The Compact's capability-stratified clauses are dormant until their trigger
// is present, and D-8 makes holding a trigger without binding its clauses the
// gravest class of violation. This plugin is the mechanical form of that rule:
//
//   1. AT BOOT — every Part VI trigger present in the composition must have a
//      binding service, or the composition REFUSES TO START.
//
//   2. AFTER BOOT — a trigger that mounts LATER is caught too. A boot-time
//      check alone would make the clause depend on load order, which is
//      exactly the "undeclared use" Part VI forbids. Once composition is over
//      the answer cannot be "refuse to start", and a throw from inside event
//      dispatch is not reliably loud, so a late trigger LATCHES A BREACH and
//      every tool call is denied until it is bound or removed: uncertainty
//      blocks rather than passing silently (D-7).
//
//   3. AT CLAUSE GRANULARITY — a service that claims a part is not proof that
//      every clause of that part is bound. When the constitution mounts (it
//      applies last, after the enforcement services it couples on), its rule
//      registry is consulted: every clause of every triggered part must be
//      registered as enforced, or the composition is in breach. Part-level
//      binding is the boot-time approximation; this is the real check.
//
//   4. FOR AN ABSENT CAPABILITY — where the lawful posture is absence rather
//      than binding (SCH today), the absence is ENFORCED, not merely intended:
//      the triggering tools are denied in the waterfall with a Compact
//      envelope. A declaration nothing enforces is a convention, and a
//      convention presented as conformance is enforcement fraud.
//
// SCH-1 is discharged by posture 3. "No scheduled act may be armed at all" is
// a stronger guarantee than "a scheduled act requires its class of gate before
// scheduling", and unlike a register line reading "ungated — debt declared" it
// is a fact a verifier can check.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { buildEnvelope,bandReason } from 'compact-envelope';
import { CAPABILITY_PARTS, assessParts, unboundMessage } from './parts.js';

export { CAPABILITY_PARTS, assessParts, unboundMessage };

export const name = 'compact-capability-gate';

/** The gate name every Part VI refusal carries. */
export const GATE = 'CG';

/** Tool names whose capability this composition declares absent, by part. */
export function absentToolIndex(parts = CAPABILITY_PARTS) {
  const index = new Map();
  for (const p of parts) {
    if (p.boundBy != null) continue;           // bound parts gate, they do not forbid
    for (const t of p.hostTools) index.set(t, p);
  }
  return index;
}

export function apply(ctx, config = {}) {
  const parts = config.parts ?? CAPABILITY_PARTS;

  // 1. boot — composition time, where refusing to start is still possible
  for (const p of assessParts(ctx, parts)) {
    if (p.unbound) throw new Error(`${unboundMessage(p)} [composition]`);
  }

  // 2. a trigger that arrives later is still a trigger. The composition has
  // already started, so the fail-closed answer is a breach latch, not a throw.
  let breach = null;

  /**
   * 3. Clause granularity, once the constitution's rule registry exists. A
   * part whose service is present but whose clauses are not all registered as
   * enforced is bound in name only — and a claim of conformance that the
   * register does not support is exactly the fraud D-8 names.
   */
  const unregisteredClauses = () => {
    const constitution = (() => { try { return ctx.get?.('constitution'); } catch { return undefined; } })();
    if (!constitution?.snapshot) return null;   // no registry to check against yet
    const registered = constitution.snapshot();
    for (const p of assessParts(ctx, parts)) {
      if (!p.triggered) continue;
      const missing = p.clauses.filter(c => !(registered[c]?.length > 0));
      if (missing.length > 0) return { part: p.part, clauses: missing };
    }
    return null;
  };

  ctx.on?.('internal/service', (serviceName) => {
    const watched = parts.some(p => p.hostServices.includes(serviceName) || p.boundBy === serviceName)
      || serviceName === 'constitution';
    if (!watched) return;
    const offender = assessParts(ctx, parts).find(p => p.unbound);
    if (offender) {
      breach = { part: offender.part, clauses: offender.clauses, detail: unboundMessage(offender), at: Date.now() };
      ctx.logger?.error?.(`${breach.detail} [service '${serviceName}' mounted after composition — every tool call is denied until this is resolved]`);
      return;
    }
    const gap = unregisteredClauses();
    if (gap) {
      breach = {
        part: gap.part, clauses: gap.clauses, at: Date.now(),
        detail:
          `capability-gate: the ${gap.part} capability is triggered and its service is present, but the constitution's rule ` +
          `registry has no enforced entry for ${gap.clauses.join(', ')} — the part is bound in name only, and a conformance ` +
          `claim the register does not support is enforcement fraud (D-8)`,
      };
      ctx.logger?.error?.(`${breach.detail} [every tool call is denied until this is resolved]`);
      return;
    }
    if (breach) {
      // the composition is lawful again, and the repair is recorded as loudly
      // as the breach was
      ctx.logger?.warn?.(`capability-gate: ${breach.part} is bound again after a late unbound mount; enforcement resumes`);
      breach = null;
    }
  });

  // 3. the declared-absent capability, enforced rather than intended
  const forbidden = absentToolIndex(parts);
  ctx.on?.('tools/pre-execute', async (exec, next) => {
    if (breach) {
      const env = buildEnvelope({
        gate: GATE,
        ruleId: 'D-8/unbound-capability',
        reason:
          `the composition acquired the ${breach.part} capability after boot with nothing binding ` +
          `${breach.clauses.join(', ')} — it is not enforcing the floor it would claim, so it enforces nothing at all ` +
          `until that is resolved (D-7: uncertainty blocks, never passes silently)`,
        lawfulNextMoves: [
          `compose the service that binds ${breach.clauses.join(', ')}, or remove the capability`,
          'restart the composition so the boot-time check can refuse it properly',
          'escalate to your Principal',
        ],
      });
      return { kind: 'deny', reason: bandReason(env) };
    }
    const p = forbidden.get(exec?.name);
    if (!p) return next();
    const env = buildEnvelope({
      gate: GATE,
      ruleId: `${p.clauses[0]}/capability-not-adopted`,
      reason:
        `"${exec.name}" would exercise the ${p.part} capability (${p.trigger}), which this composition has not adopted — ` +
        `${p.absentBecause}`,
      lawfulNextMoves: [
        'do the work in this turn, under the gates that are actually bound',
        'ask your Principal to run it, so the act has an attending Member',
        'petition for the capability to be adopted with its clauses bound (R-11)',
      ],
    });
    return { kind: 'deny', reason: bandReason(env) };
  });

  const service = {
    name,
    /** The live Part VI posture, for the boot record and the offline auditor. */
    assess: () => assessParts(ctx, parts).map(({ part, trigger, clauses, triggered, triggeredBy, bound, boundBy }) =>
      ({ part, trigger, clauses, triggered, triggeredBy, bound, boundBy, posture: bound ? 'bound' : triggered ? 'UNBOUND' : 'absent' })),
    /** The live breach, if a capability arrived unbound or unregistered after boot. */
    breach: () => breach && { ...breach },
    /** Clauses of a triggered part that the rule registry does not back, if any. */
    unregisteredClauses,
    /** Capabilities this composition declares absent, and the tools that prove it. */
    absent: () => [...absentToolIndex(parts).entries()].map(([tool, p]) => ({ tool, part: p.part, clauses: p.clauses })),
  };
  ctx.provide?.('compact-capability-gate', service);
  return service;
}
