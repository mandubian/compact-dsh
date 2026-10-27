// compact-dsh-loopguard — Phase 3 plugin (port plan Phase 3 item 1).
//
// Accounting rides the verified seams:
//   - tools/pre-execute — fingerprint tracking + trip checks; a latched or
//     deny-all guard DENIES the call with the trip envelope (LG rule ID +
//     lawful next moves, R-3)
//   - tools/result — the frozen outcome feeds the failure budgets (no
//     ambiguity: the result is readonly and post-freeze)
//   - the Phase 1 refusal seam (compact-approval/refusal) — gate flailing
//     and repeated rejections count against the trip budgets
//   - agent/error — the host's own loop-failure report feeds the LLM budget
//   - session/event (turn/start) — the inbound user signal: behavioral
//     latches clear, deterministic trips never do (no auto-resume)
//   - agent.inject(createUserMessage(...)) — corrective prose on every
//     behavioral trip (the same channel the host's own approval policy uses)
//
// Fidelity loss (documented in the annex, inherited from the port plan):
// there is no suspend latch in dsh's loop — a deterministic trip is
// deny-all + explanatory injection (abort-with-explanation), not a
// checkpointed suspension.
//
// Pinned: @deepseek-ai/dsh ~0.2.0-rc.2 (see tools/verify-pin.mjs).

import { createHash } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildEnvelope,bandReason } from 'compact-envelope';
import { fingerprint, REFUSAL_EVENT } from 'compact-dsh-approval';
import { Guard, TRIPS } from './trips.js';
import { classifyToolResult } from './classify.js';

export { Guard, TRIPS, classifyToolResult };

export const name = 'compact-loopguard';
export const GATE = 'LG';

/** The lawful floor (R-9 escalate, R-11 petition, R-12 exit): the moves a
 * trip's own envelope names. A latch or a halt never denies them — a
 * channel a gate can close is not a channel, and the member most likely to
 * need it is the one currently being refused (the R-11 register entry).
 * The live finding: weight-of-voice-v2's filer, latched by LG-3, was refused
 * the ask_human its refusal told it to make; workshop's prover was refused
 * request_termination. A composition with other floor tools names them in
 * opts.floorTools. */
export const FLOOR_TOOLS = Object.freeze(['ask_human', 'petition', 'flag_collision', 'request_termination']);

const stableJson = (v) => (Array.isArray(v) ? `[${v.map(stableJson).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));

/** Loopguard fingerprints extend the approval fingerprint with the call's
 * ARGUMENTS: the approval fingerprint is target-shaped (right for grants),
 * so every post, pass and question of one tool shared one fingerprint and
 * "the identical operation" was any two distinct utterances — the live
 * finding: members refused LG-5 for posting a new post each round. The same
 * rule the shell command already had (every distinct command is distinct
 * work) now holds for every argument: the identical operation is the same
 * tool with the same arguments. */
export function loopFingerprint(tool, args) {
  const base = fingerprint(tool, args ?? {});
  if (!args || typeof args !== 'object' || Object.keys(args).length === 0) return base;
  return `${base}:a${createHash('sha256').update(stableJson(args)).digest('hex').slice(0, 8)}`;
}

/** The guard's own denial, read back as a tool result: not evidence that
 * the tool fails. Counting it fed the guard's failure budgets with its own
 * refusals (LG-2, LG-8) — a latch that manufactured the next trip. */
export function isOwnDenial(result) {
  if (result?.isError !== true) return false;
  const text = String(result?.error?.message ?? (Array.isArray(result?.content) ? result.content.map((b) => b?.text ?? '').join('') : ''));
  return /^(?:Error:\s*)?\[LG\//.test(text);
}

function tripEnvelope(trip) {
  return buildEnvelope({
    gate: GATE, ruleId: trip.id,
    reason: `loop guard trip (${trip.label}): ${trip.message}`,
    lawfulNextMoves: ['stop repeating this approach', 'report the blocker to your Principal in your final answer', 'escalate to your Principal — escalation, petition and exit are never latched'],
  });
}

const correctiveProse = (trip) =>
  `Loop guard (${trip.id} ${trip.label}): ${trip.message}. ` +
  `Further calls are denied until the next message from your Principal — except escalation, petition and exit, which stay open. ` +
  `Change the approach or report the blocker — do not repeat the denied operation.`;

const haltProse = (trip) =>
  `Loop guard (${trip.id} ${trip.label}): ${trip.message}. ` +
  `All further work calls are denied for this session (deterministic trip — no auto-resume); escalation, petition and exit stay open. ` +
  `Report the blocker to your Principal in your final answer.`;

export function createLoopguard(opts = {}) {
  const limits = opts.limits ?? {};
  const repairBudget = opts.repairBudget ?? undefined;
  const guards = new Map(); // sessionId -> Guard

  const floor = new Set(opts.floorTools ?? FLOOR_TOOLS);
  const loopguard = {
    guards,
    /** The floor vocabulary: which tools no latch or halt may deny. */
    isFloorTool: (tool) => floor.has(tool),
    guardFor(sessionId) {
      const key = sessionId ?? 'root';
      let g = guards.get(key);
      if (!g) {
        g = new Guard({ limits, ...(repairBudget !== undefined ? { repairBudget } : {}) });
        guards.set(key, g);
      }
      return g;
    },
    /** The spawn-identity vocabulary: which tools are child spawns. */
    isSpawnTool: (tool) => opts.spawnToolPattern ? opts.spawnToolPattern.test(tool) : /spawn|subagent/i.test(tool),
  };
  return loopguard;
}

export function loopguardPlugin(opts = {}) {
  function apply(ctx, config) {
    const loopguard = opts.__loopguard ?? createLoopguard({ ...opts, ...(config ?? {}) });
    apply.loopguard = loopguard;

    const sessionOf = (exec) => exec?.agent?.session?.id != null ? String(exec.agent.session.id) : (exec?.agent?.id != null ? String(exec.agent.id) : null);

    /**
     * The inbound-user-signal check, read from the session log itself: a
     * turn/start appended AFTER the latch was raised is the Principal's next
     * message. Works for detached sessions and host-wired ones alike (the
     * session/event firehose listener below is the earlier path when it
     * fires — both are idempotent).
     */
    const syncLatchFromLog = (g, session) => {
      if (!g.latch || !session?.eventAt || !Number.isFinite(g.latch.atSeq)) return;
      for (let seq = session.seq - 1; seq >= g.latch.atSeq && seq >= 0; seq--) {
        if (session.eventAt(seq)?.type === 'turn/start') { g.clearOnUserSignal(); return; }
      }
    };

    ctx.on('tools/pre-execute', async (exec, next) => {
      const tool = exec?.name ?? 'unknown-tool';
      const g = loopguard.guardFor(sessionOf(exec));
      syncLatchFromLog(g, exec?.agent?.session);
      g.currentSeq = exec?.agent?.session?.seq ?? g.currentSeq;
      if (loopguard.isFloorTool(tool)) {
        // the floor passes the latch and the halt; only its own identical
        // repetition is refused, per call — no latch, no corrective loop
        const floorTrip = g.observeFloorCall({ fp: loopFingerprint(tool, exec?.arguments ?? {}) });
        return floorTrip ? { kind: 'deny', reason: bandReason(tripEnvelope(floorTrip)) } : next();
      }
      const trip = g.observeCall({
        fp: loopFingerprint(tool, exec?.arguments ?? {}),
        tool,
        hasParent: exec?.parent != null,
        isSpawn: loopguard.isSpawnTool(tool),
      });
      if (!trip) return next();
      // second identical corrective prose would itself be an annotation loop (LG-11)
      const annotationTrip = g.observeAnnotation(`${trip.id}:${trip.message}`);
      const effective = annotationTrip ?? trip;
      injectCorrective(ctx, exec, effective);
      return { kind: 'deny', reason: bandReason(tripEnvelope(effective)) };
    });

    ctx.on('tools/result', (exec, result) => {
      // the floor is not work, and the guard's own denial is not a failure
      if (loopguard.isFloorTool(exec?.name) || isOwnDenial(result)) return;
      const g = loopguard.guardFor(sessionOf(exec));
      g.currentSeq = exec?.agent?.session?.seq ?? g.currentSeq;
      const trip = g.observeResult({
        fp: loopFingerprint(exec?.name ?? 'unknown-tool', exec?.arguments ?? {}),
        tool: exec?.name ?? 'unknown-tool',
        hasParent: exec?.parent != null,
        ...classifyToolResult(result),
      });
      if (trip) injectCorrective(ctx, exec, trip);
    });

    // Response validation (port plan Phase 3 item 3, the stretch goal): a
    // success that carries NO value is structurally invalid — block it with
    // corrective feedback and feed the failure budget, so a tool that
    // silently returns nothing counts as a failure, not as progress.
    if (config?.responseValidation !== false) {
      ctx.on('tools/post-execute', async (exec, result, next) => {
        if (result?.isError || result?.value !== undefined) return next();
        const g = loopguard.guardFor(sessionOf(exec));
        g.currentSeq = exec?.agent?.session?.seq ?? g.currentSeq;
        const trip = g.observeResult({
          fp: loopFingerprint(exec?.name ?? 'unknown-tool', exec?.arguments ?? {}),
          tool: exec?.name ?? 'unknown-tool',
          hasParent: exec?.parent != null,
          outcome: 'failure', errorClass: 'invalid-shape', terminal: false,
        });
        const env = buildEnvelope({
          gate: GATE, ruleId: 'D-7/invalid-shape',
          reason: `"${exec?.name ?? 'unknown-tool'}" reported success without any value — a structurally invalid result`,
          lawfulNextMoves: ['retry the call', 'use a different tool for this operation', 'escalate to your Principal'],
        });
        if (trip) injectCorrective(ctx, exec, trip);
        return { kind: 'block', feedback: [{ type: 'text', text: bandReason(env) }] };
      });
    }

    // the Phase 1 refusal seam: approval asks and denies are loop evidence
    ctx.on(REFUSAL_EVENT, (payload) => {
      const g = loopguard.guardFor(payload?.session ?? payload?.root ?? null);
      const trip = g.observeRefusal({ fp: payload?.fingerprint, kind: payload?.kind });
      if (trip) injectCorrective(ctx, null, trip);
    });

    // the host's own loop-failure report feeds the LLM failure budget
    ctx.on('agent/error', ({ agent }) => {
      const g = loopguard.guardFor(agent?.session?.id != null ? String(agent.session.id) : null);
      const trip = g.observeLlmFailure();
      if (trip) injectCorrective(ctx, { agent }, trip);
    });

    // the inbound user signal: behavioral latches clear on a new turn
    ctx.on('session/event', (session, event) => {
      if (event?.type === 'turn/start') loopguard.guardFor(session?.id != null ? String(session.id) : null).clearOnUserSignal();
    });

    // composition coupling (Phase 4): the constitution checks this service's
    // presence — a composition without the loopguard refuses to start
    ctx.provide?.('compact-loopguard', loopguard);

    return loopguard;
  }
  return apply;
}

function injectCorrective(ctx, exec, trip) {
  try {
    const agent = exec?.agent;
    if (!agent || typeof agent.inject !== 'function') return;
    // form:'notice' + summary: the trip is visible on the web transcript's
    // collapsed context row without expanding — a denied loop leaves a mark
    if (trip.denyAll || trip.behavioral === false) {
      agent.inject(createUserMessage({ content: [{ type: 'text', text: haltProse(trip) }],
        source: { kind: 'compact-loopguard', plugin: 'compact-loopguard', form: 'notice',
          summary: `LoopGuard ${trip.id} ${trip.label}: all further calls denied (session halt)` } }));
    } else {
      agent.inject(createUserMessage({ content: [{ type: 'text', text: correctiveProse(trip) }],
        source: { kind: 'compact-loopguard', plugin: 'compact-loopguard', form: 'notice',
          summary: `LoopGuard ${trip.id} ${trip.label}: calls denied until your Principal's next message` } }));
    }
  } catch { /* a failed injection must never break the denial */ }
}

export const apply = loopguardPlugin();
