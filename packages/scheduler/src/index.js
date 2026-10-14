// compact-dsh-scheduler — binds the clock (#204, SCH-1 → BOUND).
//
// dsh-schedule does not execute anything: schedule_create arms a REMINDER —
// a prompt delivered into the session when it becomes due — and when it
// fires, the prompt becomes a turn whose every act rides the same waterfall
// as any other (gates, passes, workspace anchor), edges go to the appointed
// watch, egress is delivered per grant, and everything chains. The
// pre-scheduling gate the SCH-1 absence demanded is the composition itself.
//
// What the clock lacks and this wrapper adds: a CAP on active schedules per
// session (default 20), enforced IN THE WATERFALL — a schedule_create call
// beyond the cap is denied with a named envelope before the tool body, the
// same seam every other enforcement rides. No service mutation, no ordering
// constraints: the cap reads the schedule service at call time, when the
// session is live and everything is mounted. Creates and cancels are tool
// calls on the chained record; a fired delivery is a chained session
// message — the recording is structural, no new machinery.
//
// Opt-in by mount: the row is disabled unless COMPACT_SCHEDULER is set (the
// egress-posture precedent — arming the clock is the operator's act).
// Unmounted, the part is dormant and schedule_create is refused by the
// capability gate's absent index, as before.
import { buildEnvelope, bandReason } from 'compact-envelope';

const GATE = 'SCH';
const DEFAULT_MAX_ACTIVE = 20;

export const name = 'compact-dsh-scheduler';

export function apply(ctx, config = {}) {
  const maxActive = config.maxActive ??
    (Number(process.env.COMPACT_SCHEDULER_MAX_ACTIVE) || DEFAULT_MAX_ACTIVE);
  // the binding the capability gate reads: SCH is bound by THIS service.
  // On the loader path the row id has ALREADY registered this key (the
  // plugin itself is the registration — re-providing it is a cordis
  // double-registration refusal); provide only when nothing has.
  if (ctx.get?.('compact-dsh-scheduler') === undefined) {
    ctx.provide?.('compact-dsh-scheduler', { maxActive, at: Date.now() });
  }
  ctx.on?.('tools/pre-execute', async (exec, next) => {
    if (exec?.name !== 'schedule_create') return next();
    const schedule = ctx.get?.('schedule');
    if (!schedule?.list) return next();   // no clock mounted: nothing to cap
    const sessionId = exec.agent?.session?.id ?? null;
    const active = ((await schedule.list({ sessionId })) ?? [])
      .filter((record) => record.status === 'active');
    if (active.length < maxActive) return next();
    const env = buildEnvelope({
      gate: GATE,
      ruleId: 'SCH-1/cap',
      reason: `this session already holds ${active.length} active schedules (cap ${maxActive}) — ` +
        `a clock flood is a resource and attention hazard the law bounds`,
      lawfulNextMoves: [
        'cancel a schedule with schedule_cancel',
        'wait for a schedule to lapse',
        'petition for a higher cap',
      ],
    });
    return { kind: 'deny', reason: bandReason(env) };
  });
  return { maxActive };
}

export default { name, apply };
