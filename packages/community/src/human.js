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
//   2b. DECISION FORMS (#308, the alongside-signing-1 finding). `decision_form`
//      puts several numbered decisions before the human at once — each item:
//      the quoted line, the contest in one sentence, 2-3 answer choices — so
//      one glance per answer replaces an hour parsing mixed prose. The
//      answers come back structured, item by item. When the community seats
//      a human MEMBER (formPostMember), the answers are also drafted as that
//      member's next floor post: the human presses Post, and the answers
//      become the member's own citable forum act — never the driver's, the
//      words travel through the member's own loop.
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

import { normalizeTopic, postText, passReason, postHeadline, isShortPost, MAX_HEADLINE_WORDS, MAX_HEADLINE_CHARS } from 'compact-dsh-forum';

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
  if (record?.kind === 'form') {
    // a form resolves as one act: answered, or the honest no-answer (the
    // fence counts it like a question's silence — it waited on the human)
    if (record.answer === 'cancelled') return { timedOut: false, event: { type: 'form-cancelled', by: record?.by } };
    const timedOut = record?.answer == null;
    return { timedOut, event: timedOut ? { type: 'form-timeout', by: record?.by } : { type: 'form-answered', by: record?.by } };
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
  // #308: when the community seats a human MEMBER, its id goes here — a
  // settled decision form is then drafted as that member's next floor
  // post (the human presses Post; the answers become the member's own
  // citable forum act through its own loop). Null: forms answer to the
  // asking member only, as the tool result.
  formPostMember = null,
  // the charter's human desk: { member, isDesk(agentId) } — only the desk
  // puts questions and forms to the human; anyone else is refused with
  // where to take the point instead. Null: every member may ask.
  humanDesk = null,
  onPose = () => {},
  onResolve = () => {},
} = {}) {
  const patterns = criticalPatterns.map((source) => new RegExp(source, 'i'));
  const pending = new Map(); // id -> { kind: 'ask' | 'question' | 'form' | 'floor', ... , resolve }
  const formDrafts = []; // settled forms awaiting the human member's next floor turn

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

  // the forum's headline rule (charter "headlines"), read from the forum
  // itself: the floor validates the human's posts with the same rule the
  // forum_post tool enforces on every member
  const headlineRequired = () => ctx?.get?.('compact-forum')?.headlineRequired === true;

  // the desk rule, checked before anything is posed: a refused ask leaves
  // no card and no record entry on the seat — only the refusal, on the
  // asker's own chain as this call's result
  const deskRefusal = (tool, agentId) => {
    if (!humanDesk || humanDesk.isDesk(agentId)) return null;
    return `[${tool}] not asked: in this community, questions to the human go through ${humanDesk.member}. ` +
      `Post your point on the forum for ${humanDesk.member}, who gathers the points and asks the human once.`;
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
      const refused = deskRefusal('ask_human', exec?.agent?.id ?? null);
      if (refused) return refused;
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

  // ── door 2b: the decision form (#308) ──
  // Several numbered decisions in ONE structured card: per item the quoted
  // line, the contest in one sentence, 2-3 answer choices. The answers come
  // back structured, item by item — the human answers questions, not prose.
  /** The items arrive as a JSON string (flat string parameters, the same
   * choice as ask_human's options); parsed here, with the error naming the
   * expected shape so the calling model can retry. */
  const parseFormItems = (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(String(raw ?? ''));
    } catch {
      throw new Error('decision_form: "items" must be a JSON array — e.g. [{"label":"the costs line","quote":"Automation is not forbidden; hiding its costs is","contest":"nobody must state them","options":["promise-language","add the duty"]}]');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('decision_form: "items" must be a NON-EMPTY JSON array of { label, quote?, contest?, options?, free? }');
    }
    if (parsed.length > 12) throw new Error('decision_form: 12 items is the form\'s whole patience — split the ask');
    return parsed.map((item, i) => {
      const label = String(item?.label ?? '').trim();
      if (!label) throw new Error(`decision_form: item ${i + 1} carries no "label" — every item names what is decided`);
      const options = Array.isArray(item?.options)
        ? item.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 6)
        : [];
      const out = { label: label.slice(0, 300) };
      if (item?.quote != null && String(item.quote).trim()) out.quote = String(item.quote).slice(0, 2000);
      if (item?.contest != null && String(item.contest).trim()) out.contest = String(item.contest).slice(0, 2000);
      if (options.length) out.options = options;
      if (item?.free === true) out.free = true;
      if (!options.length && out.free !== true) out.free = true; // no choices → a written answer is the only way
      return out;
    });
  };
  /** The answers, validated against the posed items BEFORE anything
   * settles: an option-item needs one of its choices; a free item needs
   * written words or is recorded as answered "-" (honestly empty). Throws
   * with the offending item named — the page shows it, the human fixes
   * that one item, nothing was lost. */
  const validateFormAnswers = (record, answers) => {
    const arr = Array.isArray(answers) ? answers : [];
    return record.items.map((item, i) => {
      const given = arr[i] ?? {};
      const choice = String(given?.choice ?? '').trim();
      const text = String(given?.text ?? '').trim().slice(0, 2000);
      if (item.options?.length && !item.options.includes(choice)) {
        throw new Error(`item ${i + 1} ("${item.label.slice(0, 60)}") needs one of: ${item.options.join(' | ')}`);
      }
      if (!item.options?.length && !text) {
        throw new Error(`item ${i + 1} ("${item.label.slice(0, 60)}") needs your words — it has no choices to pick`);
      }
      return { label: item.label, ...(choice ? { choice } : {}), ...(text ? { text } : {}) };
    });
  };
  /** The answers, as the asking member reads them and as the forum post is
   * drafted — one shape, item by item. */
  const formAnswerText = (title, by, cleaned) => {
    const lines = cleaned.map((a, i) => `${i + 1}. ${a.label} → ${a.choice ?? '—'}${a.text ? `\n   ${a.text}` : ''}`);
    // the drafted post's headline, ready for a community that requires one:
    // the form's title when it fits, else a plain one the human can edit
    const titled = `My answers to "${title}"`;
    const headline = titled.split(/\s+/).length <= MAX_HEADLINE_WORDS && titled.length <= 200 ? titled : 'My answers to the form';
    return { result: `[decision_form] The human answered ${cleaned.length} item(s) of "${title}":\n${lines.join('\n')}`, draft: `My answers to "${title}"${by ? ` (asked by ${by})` : ''}:\n${lines.join('\n')}`, headline };
  };
  const decisionForm = defineTool({
    name: 'decision_form',
    description:
      'Put several numbered decisions before the human in ONE structured form — use it when more than one point ' +
      'needs their call (contests on a draft, fix options, a choice of approaches). Each item: what is decided ' +
      '(label), the exact line it concerns (quote), the objection in one sentence (contest), and 2-3 answer ' +
      'choices (options). The answers come back here structured, item by item — the human answers a form in ' +
      'minutes where a wall of prose costs an hour. A timeout is the honest no-answer, stated as exactly that.',
    parameters: {
      title: { type: 'string', required: true, description: 'what this form decides, in one line ("the four contests on the draft — your call")' },
      items: { type: 'string', required: true, description: 'JSON array of the decisions, in order — each: {"label": "what is decided", "quote": "the exact line (optional)", "contest": "the objection in one sentence (optional)", "options": ["choice A", "choice B"] (optional — pick-from), "free": true (also allow written words). No options and no free means the item cannot be answered — give every item options or free:true' },
      context: { type: 'string', description: 'optional — one or two sentences of why these decisions are the human\'s' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const refused = deskRefusal('decision_form', exec?.agent?.id ?? null);
      if (refused) return refused;
      let items;
      try {
        items = parseFormItems(args?.items);
      } catch (error) {
        return `[decision_form] refused: ${error.message}`;
      }
      const record = pose({
        kind: 'form',
        by: exec?.agent?.id ?? null,
        title: String(args?.title ?? '').trim().slice(0, 300) || 'decisions for you',
        items,
        ...(args?.context ? { context: String(args.context).slice(0, 2000) } : {}),
        expiresAt: new Date(Date.now() + questionTimeoutMs).toISOString(),
      });
      return await new Promise((resolve) => {
        const entry = pending.get(record.id);
        // NOT unref'd — the form is a live decision set, same rule as the
        // questions: the loop holds while the human works through it, and
        // "buy more time" rearms the real timeout.
        entry.onTimeout = () => {
          pending.delete(record.id);
          onResolve({ ...record, settled: true, answer: null, answeredBy: 'the timeout', answeredAt: new Date().toISOString() });
          const waitedS = Math.round((Date.now() - Date.parse(record.posedAt)) / 1000);
          resolve(
            `[decision_form] No answer within ${waitedS}s — the honest no-answer on all ${record.items.length} item(s), not a guess.\n` +
            'Say plainly what you did without the answers, or post the form again later.');
        };
        entry.timer = setTimeout(entry.onTimeout, questionTimeoutMs);
        entry.resolve = (cleaned) => {
          clearTimeout(entry.timer);
          pending.delete(record.id);
          const { result, draft, headline } = formAnswerText(record.title, record.by, cleaned);
          onResolve({ ...record, settled: true, answer: cleaned, answeredBy: 'the human seat (page)', answeredAt: new Date().toISOString() });
          // the draft rides the NEXT floor card of the human member (the
          // page prefills the composer) — the member's own post carries it
          if (formPostMember) formDrafts.push({ title: record.title, by: record.by, text: draft, headline });
          resolve(result);
        };
        entry.cancel = (why) => {
          if (!pending.has(record.id)) return;
          clearTimeout(entry.timer);
          pending.delete(record.id);
          onResolve({ ...record, settled: true, answer: null, cancelled: true, answeredBy: why ?? 'the run stopping', answeredAt: new Date().toISOString() });
          resolve('[decision_form] The form was withdrawn before the human answered — the run is stopping. No answer.');
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
  const poseFloor = ({ member = null, by = null, round = null, framing = '', news = null, lastResult = null, signal = null }) => {
    // a settled form awaiting this member's voice rides the card as a
    // DRAFT: the page prefills the composer, the human edits or posts
    // as-is — the act is the member's own, through its own loop
    const draft = formPostMember && (member ?? formPostMember) === formPostMember && formDrafts.length
      ? formDrafts.shift()
      : null;
    const record = pose({
      kind: 'floor',
      by,
      member,
      round,
      framing: String(framing).slice(0, 20_000),
      // the round's posts as rows — author, headline, whether it names this
      // member — so the card leads with them and the full text folds away
      ...(Array.isArray(news) && news.length ? { news: news.slice(0, 12) } : {}),
      ...(lastResult != null ? { lastResult: String(lastResult).slice(0, 4_000) } : {}),
      ...(draft ? { formDraft: draft } : {}),
      // the forum's headline rule, so the card says when the box is needed
      ...(headlineRequired() ? { headlineRequired: true } : {}),
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
   * limits the tool will enforce, checked before anything runs. The
   * headline rule is the forum's own too: when the community requires
   * headlines, a long post from the human is refused here without one,
   * exactly as a model member's would be. */
  const normalizeFloorAct = (act) => {
    const kind = act?.act;
    if (kind === 'post') {
      // a post ENDS the turn unless the human asks to keep the floor
      const text = postText(act.text);
      // a short post is its own headline: when the community requires one,
      // the seat carries the human's own words into the field the tool's
      // schema requires — a three-word answer needs no second box
      const own = headlineRequired() && !String(act.headline ?? '').trim() && isShortPost(text) && text.trim().length <= MAX_HEADLINE_CHARS
        ? text.trim() : act.headline;
      const headline = postHeadline(own, text, { required: headlineRequired() });
      return { act: 'post', topic: normalizeTopic(act.topic ?? defaultTopic ?? undefined), text, ...(headline ? { headline } : {}), keep: act.keep === true };
    }
    if (kind === 'pass') return { act: 'pass', reason: passReason(act.text) };
    if (kind === 'say') return { act: 'say', text: postText(act.text) };
    throw new Error('act must be "post", "pass", or "say"');
  };

  return {
    answerer,
    tool: askHuman,
    formTool: decisionForm,
    poseFloor,
    /** The form's answers, validated then resolved (#308): an option-item
     * needs one of its choices, a free-item needs words — a failure THROWS
     * with the offending item named and the form stays pending (nothing
     * was lost; the page shows the reason, the human fixes that one item).
     * Resolves through the form's own entry.resolve DIRECTLY (mirroring
     * replyQuestion) — settle() would fire onResolve a second time (the
     * entry.resolve already does), and the feed would say form-answered
     * twice for one answer. When formPostMember is set, the resolved
     * answers are also drafted as that member's next floor post. */
    answerForm: (id, answers) => {
      const record = pending.get(id);
      if (!record || record.kind !== 'form') return null;
      const cleaned = validateFormAnswers(record, answers);
      record.resolve?.(cleaned);
      return record;
    },
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
