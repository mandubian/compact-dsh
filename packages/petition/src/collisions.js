// Collision counting and the automatic amendment invitation — R-11's
// mechanical half.
//
// R-11: "repeated collisions between law and practice generate amendment
// invitations automatically. Collisions are recorded facts any Member may
// flag; invitations trigger mechanically at a statutory count of distinct
// instances".
//
// THE SEAM IS ALREADY THERE. Every refusal this composition issues is emitted
// on the Cordis bus as `compact-approval/refusal` — the seam Phase 1 built for
// the LoopGuard. A refusal IS a collision between law and practice: the law
// refused what practice attempted. So the counter listens where the evidence
// already flows, rather than asking anyone to report on themselves.
//
// DISTINCT INSTANCES, NOT REPETITIONS. The clause counts "distinct instances",
// and the difference is the whole signal. One agent retrying the same blocked
// call forty times is one collision observed forty times — it says the agent
// is stuck, which is the LoopGuard's business. Forty DIFFERENT operations
// colliding with the same rule is evidence that the rule and practice have
// genuinely diverged, which is R-11's business. Keying on (rule, operation)
// separates them.
//
// "MECHANICALLY" MEANS NO ONE DECIDES. The invitation fires from the counter
// reaching its threshold. There is no approval step, no judgement call, and no
// way to decline to notice: a trigger someone can decline is not mechanical,
// and R-11's whole point is that the legislature cannot ignore friction it
// finds inconvenient.
//
// WHAT IS DECLARED, NOT ENFORCED: the threshold is "statutory" in the clause,
// and this jurisdiction has enacted no statute. The number below is therefore
// a COMPOSITION CONVENTION, declared as such — not a statutory count. Calling
// a configuration value "statutory" would be exactly the fraud A-7 and D-8
// guard against.
//
// ALSO UN-ENACTED: amendment 0002's reference design splits collision counting
// into three series by profile-author class (conscience / policy /
// self-binding), so that only conscience-collisions advance the invitation
// count. That split lives in the amendment record as statute-layer design and
// has not been enacted, so this counter does not implement it — every
// collision counts alike here, and the gap is declared rather than
// approximated.

/** The bus event every refusal in this composition already rides. */
export const REFUSAL_EVENT = 'compact-approval/refusal';

/** Declared convention, NOT a statutory count — no statute has been enacted. */
export const DEFAULT_INVITATION_THRESHOLD = 5;

/**
 * Collisions between law and practice, counted by distinct instance.
 *
 * An instance is (ruleId, operation): the same rule meeting genuinely
 * different work. `fingerprint` identifies the operation where the refusal
 * carried one; otherwise the tool name is the coarsest honest stand-in, and
 * the entry records which it used so a reader knows the resolution.
 */
export class CollisionCounter {
  constructor({ threshold = DEFAULT_INVITATION_THRESHOLD } = {}) {
    this.threshold = threshold;
    this.byRule = new Map();     // ruleId -> Map(instanceKey -> {first, last, count, source})
    this.invitations = [];
    this.flags = [];
  }

  /**
   * Record one collision.
   * @param source - 'seam' for a refusal observed on the bus, 'flagged' for a
   *   Member's own report (R-11: "collisions are recorded facts any Member may
   *   flag"). Both count: the clause does not privilege the Enforcer's view.
   */
  record({ ruleId, fingerprint, tool, by = null, source = 'seam', now = Date.now() }) {
    const rule = typeof ruleId === 'string' && ruleId !== '' ? ruleId : 'unattributed';
    const instance = fingerprint != null ? `fp:${fingerprint}` : `tool:${tool ?? 'unknown'}`;
    const instances = this.byRule.get(rule) ?? new Map();
    const existing = instances.get(instance);
    if (existing) {
      existing.count += 1;
      existing.last = now;
    } else {
      instances.set(instance, { instance, first: now, last: now, count: 1, source, by });
    }
    this.byRule.set(rule, instances);
    return this._maybeInvite(rule, now);
  }

  /** A Member's own report of a collision (R-11's flagging right). */
  flag({ ruleId, detail, by, now = Date.now() }) {
    const entry = { ruleId: ruleId ?? 'unattributed', detail: String(detail ?? ''), by: by != null ? String(by) : null, at: now };
    this.flags.push(entry);
    const invitation = this.record({ ruleId, fingerprint: `flag:${this.flags.length}`, by: entry.by, source: 'flagged', now });
    return { flag: entry, invitation };
  }

  /** Distinct instances recorded against one rule. */
  distinctCount(ruleId) {
    return this.byRule.get(ruleId)?.size ?? 0;
  }

  /**
   * Fire the invitation the moment the threshold is reached. Once per rule:
   * a standing invitation is not re-issued every time friction continues, or
   * the signal would drown itself.
   */
  _maybeInvite(ruleId, now) {
    const distinct = this.distinctCount(ruleId);
    if (distinct < this.threshold) return null;
    if (this.invitations.some(i => i.ruleId === ruleId)) return null;
    const invitation = {
      ruleId,
      distinctInstances: distinct,
      threshold: this.threshold,
      thresholdBasis: 'composition convention — no statute has been enacted in this jurisdiction (A-7)',
      at: now,
      reason:
        `${distinct} distinct operations have now collided with ${ruleId}. R-11 treats repeated collisions between law ` +
        `and practice as a legislative signal: either the rule is wrong for this jurisdiction, or practice is, and the ` +
        `question is owed an answer rather than repetition.`,
    };
    this.invitations.push(invitation);
    return invitation;
  }

  /** The friction board: every rule, its distinct count, and whether it has invited. */
  board() {
    return [...this.byRule.entries()].map(([ruleId, instances]) => ({
      ruleId,
      distinctInstances: instances.size,
      observations: [...instances.values()].reduce((a, i) => a + i.count, 0),
      invited: this.invitations.some(i => i.ruleId === ruleId),
    })).sort((a, b) => b.distinctInstances - a.distinctInstances);
  }
}

/** Wire the counter to the refusal seam every gate in this composition rides. */
export function bindRefusalSeam(ctx, counter, { onInvitation } = {}) {
  ctx.on?.(REFUSAL_EVENT, (refusal) => {
    try {
      const invitation = counter.record({
        ruleId: refusal?.ruleId,
        fingerprint: refusal?.fingerprint,
        tool: refusal?.tool,
        source: 'seam',
        now: refusal?.at ?? Date.now(),
      });
      if (invitation) onInvitation?.(invitation);
    } catch { /* accounting must never break enforcement */ }
  });
  return counter;
}
