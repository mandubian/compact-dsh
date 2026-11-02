// The human seat — the Principal's page-side presence in a live community
// (#219). Two doors, one posture:
//
//   1. APPROVALS THE FENCE ROUTES HERE. Covered acts run under pre-minted
//      grants; params-edges belong to the night watch; everything else —
//      novel first-touch asks, secrets, revoked-grant asks — would end
//      'unavailable' (fail closed). This seat CLAIMS those asks, poses
//      them, and waits; a timeout is a refusal with its reason, never a
//      guess (D-7). Charter-declared critical patterns claim even
//      params-edge asks: the classes the operator named — external
//      critical services, destructive local acts — are the human's, first.
//
//   2. QUESTIONS. `ask_human` is petition-shaped: asking the Principal is
//      always lawful, gated by nothing. The reply returns as the tool
//      result on the caller's own chain; a timeout is the honest
//      no-answer, stated as exactly that.
//
//   3. THE FLOOR (#215's mixed community, made real). A HUMAN member's
//      turn: the floor adapter (human-member.js) poses the framing here,
//      and the page returns ONE act — post / pass / say. The act becomes
//      the member's own governed turn through the same agent loop any
//      model member runs (the page is the model); a timeout is the honest
//      silence — the turn performs no act, and the divergence counters
//      count it. The seat validates the act with the forum's own rules,
//      so what the loop executes is what the forum will accept.
//
// The seat mounts no powers of its own: it observes what the runtime
// already publishes and answers only what is pending. Every answer it
// gives flows back through the recorded answerer like any other decision
// — the law binds the sovereign (D-6), and this is where the sovereign
// speaks.

import { defineTool } from '@deepseek-ai/dsh-tools';

import { normalizeTopic, postText, passReason } from 'compact-dsh-forum';

export const DEFAULT_ASK_TIMEOUT_MS = 120_000;
export const DEFAULT_QUESTION_TIMEOUT_MS = 300_000;
export const DEFAULT_FLOOR_TIMEOUT_MS = 600_000;
// "buy more time": one press adds this much to a pending card's deadline
// (the page's button sends minutes; the seat clamps to a per-press max —
// a typo cannot park the run forever, but the human's reading speed is
// the operator's own affair). The honest silence still exists: stop
// pressing and the card times out as before.
export const DEFAULT_EXTEND_MS = 600_000;
export const MAX_EXTEND_MS = 2 * 60 * 60 * 1000;

let pendingSeq = 0;

/** What a resolved seat record means for the run, for all three doors: the
 * feed event to publish, and whether it is an honest no-answer the
 * charter's divergence fence counts. One mapping, so a door cannot count
 * twice or read its act from the wrong field (the floor did both: each
 * silence counted twice, and a POST reached the page as "spoke on its own
 * chain"). */
export function seatOutcome(record) {
  if (record?.kind === 'ask') {
    // withdrawn because the run is stopping: denied (fail closed), and NOT
    // the human's silence — the fence must not count the operator's stop
    if (record.answer === 'cancelled') return { timedOut: false, event: { type: 'ask-cancelled', id: record.id } };
    const timedOut = record.answer === 'timeout';
    return { timedOut, event: timedOut ? { type: 'ask-timeout', id: record.id } : { type: 'ask-decided', id: record.id, decision: record.answer } };
  }
  if (record?.kind === 'floor') {
    const act = record.answer?.act ?? record.act;
    if (act === 'cancelled') return { timedOut: false, event: { type: 'floor-cancelled', by: record.by, member: record.member } };
    const timedOut = act === 'timeout';
    return {
      timedOut,
      event: timedOut
        ? { type: 'floor-timeout', by: record.by, member: record.member }
        : { type: 'floor-acted', id: record.id, act, by: record.by, member: record.member },
    };
  }
  if (record?.cancelled) return { timedOut: false, event: { type: 'question-cancelled', by: record?.by } };
  const timedOut = record?.answer == null;
  return { timedOut, event: timedOut ? { type: 'question-timeout', by: record?.by } : { type: 'question-answered', by: record?.by } };
}

/** Mount the human seat on a settled ctx. Returns the seat: pending asks
 *  and questions (the observatory renders these), answer/reply resolvers,
 *  and the ask_human tool for the driver to register. */
export function mountHumanSeat(ctx, {
  criticalPatterns = [],
  askTimeoutMs = DEFAULT_ASK_TIMEOUT_MS,
  questionTimeoutMs = DEFAULT_QUESTION_TIMEOUT_MS,
  floorTimeoutMs = DEFAULT_FLOOR_TIMEOUT_MS,
  defaultTopic = null,
  onPose = () => {},
  onResolve = () => {},
} = {}) {
  const patterns = criticalPatterns.map((source) => new RegExp(source, 'i'));
  const pending = new Map(); // id -> { kind: 'ask' | 'question' | 'floor', ... , resolve }

  const pose = (entry) => {
    pendingSeq += 1;
    const id = `hum_${pendingSeq}`;
    const record = { id, posedAt: new Date().toISOString(), ...entry };
    pending.set(id, record);
    onPose(record);
    return record;
  };

  const settle = (id, answer, by) => {
    const record = pending.get(id);
    if (!record || record.settled) return null;
    record.settled = true;
    record.answer = answer;
    record.answeredBy = by ?? 'the human seat (page)';
    record.answeredAt = new Date().toISOString();
    pending.delete(id);
    onResolve(record);
    record.resolve?.(answer);
    return record;
  };

  // ── door 1: the approval claims ──
  // Seated AFTER the driver's claim-nothing seat and BEFORE the night
  // watch: params-edge cards pass through to the watch unless a critical
  // pattern claims them; everything else would fail closed — this seat
  // holds it for the human instead, and a timeout IS the fail-closed
  // refusal, now with a reason a page reader understands.
  const answerer = (req, next) => {
    const reason = String(req?.reason ?? '');
    // the deciding view is published for exactly the decision's duration
    // (the recorded answerer owns it) — the same read the night watch does
    const key = req.callId != null ? String(req.callId) : `${req.agent?.id ?? '?'}:${req.toolName}`;
    const view = ctx.get?.('compact-approval')?.deciding?.get?.(key);
    const card = view?.cause;
    const isParamsEdge = card?.kind === 'params-edge';
    const critical = patterns.some((re) => re.test(reason));
    if (isParamsEdge && !critical) return next();
    // the HUMAN facts, found by the live run: the envelope is written for
    // the record, and a page answering from it alone asks a human to
    // approve a wall of law about a host that does not exist. The deciding
    // view already carries the plain facts — WHO asks, WHAT tool, the
    // command preview, the redacted target — so the card leads with those
    // and the verbatim envelope rides beneath, unclamped.
    const record = pose({
      kind: 'ask',
      by: req.agent?.id ?? null,
      tool: view?.tool ?? req.toolName ?? null,
      command: view?.command ?? null,
      commandFull: view?.commandFull ?? view?.command ?? null,
      target: view?.target ?? null,
      fingerprint: view?.fingerprint ?? null,
      headline: reason.split('\n')[0].slice(0, 200),
      detail: reason,
      critical,
      wouldOtherwise: isParamsEdge ? 'the night watch (params-edge)' : 'fail closed (unavailable)',
      resolvesTo: (answer) => (answer === 'approve' ? 'allowed-once' : 'denied'),
      // when the fail-closed timeout fires — the page counts down to it
      expiresAt: new Date(Date.now() + askTimeoutMs).toISOString(),
    });
    // NOT unref'd: a pending ask is a live decision — the loop holds while
    // the human thinks (the turn is blocked on this answer anyway; an
    // unref'd timer let the event loop drain under the recorded answerer's
    // awaited promise on Node 22, which CI caught). The timer and its
    // callback ride the entry, not a closure: "buy more time" rearms them
    // against the moved expiresAt, and nothing fires behind the page's back.
    const entry = pending.get(record.id);
    entry.onTimeout = () => settle(record.id, 'timeout', 'the timeout (fail closed)');
    entry.timer = setTimeout(entry.onTimeout, askTimeoutMs);
    return new Promise((resolve) => {
      entry.resolve = (answer) => {
        clearTimeout(entry.timer);
        resolve(answer === 'approve' ? 'allowed-once' : 'denied');
      };
      // the run is stopping: the ask is withdrawn and DENIED (fail closed)
      entry.cancel = (why) => settle(record.id, 'cancelled', why);
    });
  };

  // ── door 2: the questions ──
  const askHuman = defineTool({
    name: 'ask_human',
    description:
      'Ask the Principal — the human this community works for — a question only the human should ' +
      'answer: an important choice, a value call, a conflict the rules do not settle. Asking is always ' +
      'lawful and gated by nothing. Your question appears on the human\'s page with your name on it; the ' +
      'reply (if one comes within the run\'s patience) returns here as this call\'s result, on YOUR record. ' +
      'A timeout is the honest no-answer — state plainly what you did without one.',
    parameters: {
      question: { type: 'string', required: true, description: 'the question, asked so the human can answer it in one reply' },
      options: { type: 'string', description: 'optional — the choices you see, comma-separated ("ship it, hold, escalate to the bench")' },
      context: { type: 'string', description: 'optional — one or two sentences of the situation that makes this worth the human\'s time' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const record = pose({
        kind: 'question',
        by: exec?.agent?.id ?? null,
        headline: String(args?.question ?? '').slice(0, 200),
        question: String(args?.question ?? ''),
        ...(args?.options ? { options: String(args.options) } : {}),
        ...(args?.context ? { context: String(args.context) } : {}),
        expiresAt: new Date(Date.now() + questionTimeoutMs).toISOString(),
      });
      return await new Promise((resolve) => {
        const entry = pending.get(record.id);
        // NOT unref'd — same rule as the asks: a question the human has not
        // answered is a live decision, and the loop holds for it. The timer
        // rides the entry: "buy more time" rearms it, and the no-answer
        // reports the wait the human ACTUALLY took, not the configured one.
        entry.onTimeout = () => {
          pending.delete(record.id);
          onResolve({ ...record, settled: true, answer: null, answeredBy: 'the timeout', answeredAt: new Date().toISOString() });
          const waitedS = Math.round((Date.now() - Date.parse(record.posedAt)) / 1000);
          resolve(
            `[ask_human] No answer within ${waitedS}s — the honest no-answer, not a guess.\n` +
            'Say plainly what you did without the human\'s answer, or ask again later with a sharper question.');
        };
        entry.timer = setTimeout(entry.onTimeout, questionTimeoutMs);
        entry.resolve = (answer) => {
          clearTimeout(entry.timer);
          pending.delete(record.id);
          onResolve({ ...record, settled: true, answer: String(answer ?? '').slice(0, 4000), answeredBy: 'the human seat (page)', answeredAt: new Date().toISOString() });
          resolve(`[ask_human] The Principal answered:\n${String(answer ?? '').slice(0, 4000)}`);
        };
        // withdrawn — the run is stopping, or this call was cancelled
        // (dsh-tools: async work must observe exec.signal). Not an answer,
        // and not the human's silence: the fence does not count it.
        entry.cancel = (why) => {
          if (!pending.has(record.id)) return;
          clearTimeout(entry.timer);
          pending.delete(record.id);
          onResolve({ ...record, settled: true, answer: null, cancelled: true, answeredBy: why ?? 'the run stopping', answeredAt: new Date().toISOString() });
          resolve('[ask_human] The question was withdrawn before the human answered — the run is stopping. No answer.');
        };
        const signal = exec?.signal;
        if (signal?.aborted) entry.cancel('the call was cancelled');
        else signal?.addEventListener?.('abort', () => entry.cancel('the call was cancelled'), { once: true });
      });
    },
  });

  // ── door 3: the floor ──
  // A human member's turn, posed for the page. The adapter (human-member.js)
  // awaits this; the page's button returns ONE act. The forum's own rules
  // validate what the act will ask the loop to execute, so a bad topic or an
  // oversized post refuses HERE, at the boundary — never mid-turn. The
  // timeout is the honest silence: the member's turn performs no act, the
  // adapter says so in words, and the divergence counter counts it.
  const poseFloor = ({ member = null, by = null, round = null, framing = '', lastResult = null, signal = null }) => {
    const record = pose({
      kind: 'floor',
      by,
      member,
      round,
      framing: String(framing).slice(0, 20_000),
      ...(lastResult != null ? { lastResult: String(lastResult).slice(0, 4_000) } : {}),
      headline: `floor turn — ${member ?? 'the human member'}`,
      defaultTopic,
      expiresAt: new Date(Date.now() + floorTimeoutMs).toISOString(),
    });
    return new Promise((resolve) => {
      const entry = pending.get(record.id);
      // NOT unref'd — same rule as the asks: a floor turn the human has not
      // answered is a live turn, and the loop holds for it (the timer rides
      // the entry, rearmable by "buy more time")
      entry.onTimeout = () => {
        pending.delete(record.id);
        onResolve({ ...record, settled: true, act: 'timeout', answeredBy: 'the timeout', answeredAt: new Date().toISOString() });
        resolve({ act: 'timeout' });
      };
      entry.timer = setTimeout(entry.onTimeout, floorTimeoutMs);
      entry.resolve = (act) => {
        clearTimeout(entry.timer);
        resolve(act);
      };
      // withdrawn — the turn was cancelled (an immediate stop aborts the
      // model request's signal, and the page IS this member's model) or
      // the run is stopping. No act, and not the human's silence. Before
      // this, nothing could interrupt a waiting floor card: every Ctrl-C
      // after the first said "stopping IMMEDIATELY" and the run waited
      // out the human's whole timeout.
      entry.cancel = (why) => {
        if (!pending.has(record.id)) return;
        clearTimeout(entry.timer);
        pending.delete(record.id);
        onResolve({ ...record, settled: true, act: 'cancelled', answeredBy: why ?? 'the run stopping', answeredAt: new Date().toISOString() });
        resolve({ act: 'cancelled' });
      };
      if (signal?.aborted) entry.cancel('the turn was cancelled');
      else signal?.addEventListener?.('abort', () => entry.cancel('the turn was cancelled'), { once: true });
    });
  };

  /** One floor act, validated with the forum's own rules — the same
   * limits the tool will enforce, checked before anything runs. */
  const normalizeFloorAct = (act) => {
    const kind = act?.act;
    if (kind === 'post') {
      // a post ENDS the turn unless the human asks to keep the floor
      return { act: 'post', topic: normalizeTopic(act.topic ?? defaultTopic ?? undefined), text: postText(act.text), keep: act.keep === true };
    }
    if (kind === 'pass') return { act: 'pass', reason: passReason(act.text) };
    if (kind === 'say') return { act: 'say', text: postText(act.text) };
    throw new Error('act must be "post", "pass", or "say"');
  };

  return {
    answerer,
    tool: askHuman,
    poseFloor,
    pending: () => [...pending.values()].map((p) => ({ ...p, resolve: undefined, cancel: undefined, timer: undefined, onTimeout: undefined })),
    /** Buy more time on a pending card: the deadline moves, and the REAL
     * timeout rearms against the new expiry (the seat is the one that
     * fires the honest silence — extending only the page's countdown while
     * the seat's timer kept the old hour would be the false answer,
     * named). One press adds `ms` (default DEFAULT_EXTEND_MS, capped at
     * MAX_EXTEND_MS) to whatever is left. Returns the moved expiry, or
     * null when nothing pending carries the id. */
    extendPending: (id, ms = DEFAULT_EXTEND_MS) => {
      const record = pending.get(id);
      if (!record || record.settled) return null;
      const add = Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_EXTEND_MS) : DEFAULT_EXTEND_MS;
      const current = Date.parse(record.expiresAt ?? '');
      const from = Number.isFinite(current) && current > Date.now() ? current : Date.now();
      record.expiresAt = new Date(from + add).toISOString();
      if (record.onTimeout) {
        if (record.timer) clearTimeout(record.timer);
        record.timer = setTimeout(record.onTimeout, Math.max(0, Date.parse(record.expiresAt) - Date.now()));
      }
      return { id, kind: record.kind, expiresAt: record.expiresAt };
    },
    /** The run is stopping NOW: withdraw every pending card — asks denied
     * (fail closed), questions and floor turns unanswered — so no wait on
     * the human outlives the operator's stop. Returns how many. */
    cancelPending: (why = 'the operator stopped the run') => {
      const open = [...pending.values()];
      for (const entry of open) entry.cancel?.(why);
      return open.length;
    },
    settleAsk: (id, decision) => {
      const record = pending.get(id);
      if (!record || record.kind !== 'ask') return null;
      return settle(id, decision);
    },
    replyQuestion: (id, text) => {
      const record = pending.get(id);
      if (!record || record.kind !== 'question') return null;
      record.resolve?.(String(text ?? '').slice(0, 4000));
      return record;
    },
    settleFloor: (id, act) => {
      const record = pending.get(id);
      if (!record || record.kind !== 'floor') return null;
      let clean;
      try {
        clean = normalizeFloorAct(act);
      } catch (error) {
        return { error: error.message };
      }
      const settled = settle(id, clean, 'the human seat (page)');
      return settled ?? { error: 'the floor turn was already settled' };
    },
  };
}
