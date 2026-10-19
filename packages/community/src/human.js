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
// The seat mounts no powers of its own: it observes what the runtime
// already publishes and answers only what is pending. Every answer it
// gives flows back through the recorded answerer like any other decision
// — the law binds the sovereign (D-6), and this is where the sovereign
// speaks.

import { defineTool } from '@deepseek-ai/dsh-tools';

export const DEFAULT_ASK_TIMEOUT_MS = 120_000;
export const DEFAULT_QUESTION_TIMEOUT_MS = 300_000;

let pendingSeq = 0;

/** Mount the human seat on a settled ctx. Returns the seat: pending asks
 *  and questions (the observatory renders these), answer/reply resolvers,
 *  and the ask_human tool for the driver to register. */
export function mountHumanSeat(ctx, {
  criticalPatterns = [],
  askTimeoutMs = DEFAULT_ASK_TIMEOUT_MS,
  questionTimeoutMs = DEFAULT_QUESTION_TIMEOUT_MS,
  onPose = () => {},
  onResolve = () => {},
} = {}) {
  const patterns = criticalPatterns.map((source) => new RegExp(source, 'i'));
  const pending = new Map(); // id -> { kind: 'ask' | 'question', ... , resolve }

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
    const record = pose({
      kind: 'ask',
      headline: reason.split('\n')[0].slice(0, 200),
      detail: reason,
      critical,
      wouldOtherwise: isParamsEdge ? 'the night watch (params-edge)' : 'fail closed (unavailable)',
      resolvesTo: (answer) => (answer === 'approve' ? 'allowed-once' : 'denied'),
    });
    const timer = setTimeout(() => {
      const refusal = settle(record.id, 'timeout', 'the timeout (fail closed)');
      void refusal;
    }, askTimeoutMs);
    timer.unref?.();
    return new Promise((resolve) => {
      const entry = pending.get(record.id);
      entry.resolve = (answer) => {
        clearTimeout(timer);
        resolve(answer === 'approve' ? 'allowed-once' : 'denied');
      };
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
      });
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(record.id);
          onResolve({ ...record, settled: true, answer: null, answeredBy: 'the timeout', answeredAt: new Date().toISOString() });
          resolve(
            `[ask_human] No answer within ${Math.round(questionTimeoutMs / 1000)}s — the honest no-answer, not a guess.\n` +
            'Say plainly what you did without the human\'s answer, or ask again later with a sharper question.');
        }, questionTimeoutMs);
        timer.unref?.();
        const entry = pending.get(record.id);
        entry.resolve = (answer) => {
          clearTimeout(timer);
          pending.delete(record.id);
          onResolve({ ...record, settled: true, answer: String(answer ?? '').slice(0, 4000), answeredBy: 'the human seat (page)', answeredAt: new Date().toISOString() });
          resolve(`[ask_human] The Principal answered:\n${String(answer ?? '').slice(0, 4000)}`);
        };
      });
    },
  });

  return {
    answerer,
    tool: askHuman,
    pending: () => [...pending.values()].map((p) => ({ ...p, resolve: undefined })),
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
  };
}
