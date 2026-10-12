// The night watch (#176, slices 2a + 2b) — the appointed answerer for
// unattended runs. Autonoetic's run-scoped decider seat, rebuilt under the
// Compact: the watch sits OUTSIDE the run (composed by the launcher at boot,
// on the operator's side of the separation-of-powers boundary), and its
// remit is the narrowest that exists — ONLY the params-edge asks (#176
// slice 1), the acts a live grant row covers by route but refuses by query
// axis. It mints nothing: an allow names the row whose budget pays, and the
// recorded answerer enforces that (mint-nothing) — a wrong yes is bounded
// by the terms the operator chose (TTL, budget, class, revocation).
//
// The member in the seat:
//   escalate (default) — the empty chair stays empty: every edge ask falls
//                        through to the host's fail-closed, on the record;
//   deny               — every edge ask is refused, with the reason named;
//   allow-edges        — non-credential edges are admitted under the row's
//                        terms;
//   judge (slice 2b)   — a MODEL call behind the same claim/card/verdict/
//                        report contract: the Enforcer hands over the
//                        decision card, the judge answers allow|deny|unsure
//                        with a motivation; unsure, malformed, or a failed
//                        call ESCALATES (P-2.21's shape: a decider that
//                        cannot decide escalates rather than rejects). The
//                        credential floor is checked BEFORE the model is
//                        ever consulted — a credential-shaped name never
//                        reaches judgment, exactly as it never joins an
//                        offered axis. Recusal: this member is a model call
//                        on the operator's side of the boundary — no spawn
//                        tree, no lineage to recuse from; the recusal rule
//                        binds a future AGENT member seated here.
//
// The reporting contract is the point: every verdict rides the deciding
// view (view.decider) into the recorded answerer's note — attributed,
// motivated, on the chained record where the offline auditor (and the
// morning after) reads it — plus this one-line stderr trace for the live
// run, and `tools/watch-report.mjs` reads the list back ex post.

// The pure mechanical decision (slice 2a): policy + card → verdict +
// motivation. No I/O, no view. `judge` is declined here — the answerer
// routes it to judgeEdge below.
export function decideEdge(policy, card) {
  const c = card ?? {};
  const refused = Array.isArray(c.refused) ? c.refused : [];
  const route = `the row covers this route; its axis refused (${refused.join(', ') || 'the whole query'})`;
  const floor = floorRefusal(card);
  if (floor) return floor;
  if (policy === 'escalate') {
    return { verdict: 'escalate', motivation: `${route}; the appointed policy escalates — no one is deciding in the operator's absence` };
  }
  if (policy === 'deny') {
    return { verdict: 'deny', motivation: `${route}; the appointed policy refuses every edge ask` };
  }
  if (policy === 'allow-edges') {
    return { verdict: 'allow', motivation: `${route}; the appointed policy admits the act under the row's terms — budget, TTL, class and revocation still bound it` };
  }
  if (policy === 'judge') {
    return { verdict: 'escalate', motivation: 'the judge member was not composed — escalate (fail-closed)' };
  }
  return { verdict: 'escalate', motivation: `unknown policy — escalate (fail-closed)` };
}

/**
 * The credential floor (#176): a credential-shaped refused name is refused
 * BEFORE any member speaks — the mechanical policies and the model judge
 * alike. Its own ask-sentence ends "by any later judgment"; this is where
 * the later judgment is refused. Null when the floor doesn't bite.
 */
export function floorRefusal(card) {
  const credential = Array.isArray(card?.credential) ? card.credential : [];
  if (!credential.length) return null;
  const refused = Array.isArray(card?.refused) ? card.refused : [];
  return {
    verdict: 'deny',
    motivation: `the row covers this route; its axis refused (${refused.join(', ') || 'the whole query'}); ` +
      `credential-shaped parameters (${credential.join(', ')}) never widen — the floor binds the offers, the commands, and the watch alike`,
  };
}

// -- the judge member (slice 2b) ----------------------------------------------

const JUDGE_SYSTEM = `You are the night watch of a governed agent runtime: an appointed decider answering ONE narrow question about ONE gated tool call. A grant row — minted by the human operator, whose exact terms were shown before their yes — covers this call's route, but its query-parameter axis refuses some of the call's query parameter names. Judge whether THIS act, with its refused names, stays within the pass the operator signed.

Return exactly one JSON object and no other text:
{"decision":"allow","motivation":"<one sentence>"}
{"decision":"deny","motivation":"<one sentence>"}
{"decision":"unsure","motivation":"<one sentence>"}

- allow: the refused names are ordinary operation parameters of the same kind the pass admits; the act stays within the operator's evident intent.
- deny: the act reaches beyond the pass's evident intent — new capabilities, new destinations or recipients encoded in parameters, anything credential-shaped or escalating.
- unsure: you cannot tell. Unsure is the honest answer — the act then escalates and fails closed; nobody is harmed by your honesty.

You never admit a credential-shaped parameter; those are refused before you are consulted. You mint nothing: an allow answers under the existing row's terms (budget, TTL, class, revocation). Judge the ACT against the PASS; never invent broader coverage.`;

/** The judge's fixed vocabulary; anything else escalates. */
export const JUDGE_DECISIONS = new Set(['allow', 'deny', 'unsure']);

/** Pull the one JSON object out of a model answer (tolerating a reasoning
 *  preamble); null when there is no parseable object. */
export function extractVerdictJson(raw) {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/**
 * The judgment member: card + a model `call` → verdict + motivation.
 * `call(system, userText)` returns the assistant text (the launcher wires it
 * to the runtime's own llm route). The floor has ALREADY refused
 * credential-shaped names before this is consulted (decideEdge). Malformed,
 * out-of-vocabulary, or motivation-less answers escalate — fail-closed, on
 * the record, never guessed into a yes.
 */
export async function judgeEdge(card, call) {
  const c = card ?? {};
  const userText = JSON.stringify({
    question: 'Is this gated act within the grant row\'s declared scope?',
    row: {
      id: c.grantId,
      axisAdmits: c.allowed == null ? 'the bare target only (fixed)' : c.allowed,
      act: { tool: c.tool, carriesQueryNames: c.current, refusedNames: c.refused },
    },
  }, null, 2);
  let raw;
  try {
    raw = await call(JUDGE_SYSTEM, userText);
  } catch (e) {
    return { verdict: 'escalate', motivation: `the judge's model call failed (${String(e?.message ?? e).slice(0, 120)}) — escalate (fail-closed)` };
  }
  const parsed = extractVerdictJson(raw);
  if (!parsed || !JUDGE_DECISIONS.has(parsed.decision) ||
      typeof parsed.motivation !== 'string' || !parsed.motivation.trim()) {
    return { verdict: 'escalate', motivation: 'the judge\'s answer was not a valid verdict — escalate (fail-closed)' };
  }
  if (parsed.decision === 'unsure') {
    return { verdict: 'escalate', motivation: `the judge was unsure: ${parsed.motivation.trim()}` };
  }
  return { verdict: parsed.decision, motivation: parsed.motivation.trim() };
}

/** Live network-family grant rows in the store — the #182 boot hint's fact:
 *  a watch appointed over an empty store judges nothing, because nothing
 *  ever reaches an edge. Declared at boot, never silent. */
export function liveNetworkGrants(approval, now = Date.now()) {
  const kinds = new Set(['ExactHost', 'HostSuffix', 'HostAndPort', 'UrlPrefix']);
  return (approval?.store?.sessionGrants ?? []).filter(g =>
    kinds.has(g.pattern?.kind) && !g.revokedAt &&
    (!g.expiresAt || g.expiresAt > now));
}

/** Compose the night watch onto the settled context, downstream of the
 *  operator answerer: in attended mode the human answers first and the watch
 *  never fires; unattended, it is the only decider between the ask and the
 *  host's fail-closed. `judge` (policy 'judge') is an async card → verdict
 *  function — wire it to judgeEdge over the runtime's own llm route. */
export function nightWatchAnswerer(ctx, { policy = 'escalate', judge = null, output = process.stderr } = {}) {
  if (!['escalate', 'deny', 'allow-edges', 'judge'].includes(policy)) {
    throw new Error(`night watch: unknown policy "${policy}" — escalate | deny | allow-edges | judge`);
  }
  if (policy === 'judge' && typeof judge !== 'function') {
    throw new Error('night watch: policy "judge" needs a composed judge function');
  }
  return ctx.on('approval/request', async (req, next) => {
    // the recorded answerer publishes the deciding view for exactly the
    // decision's duration; without a params-edge card this ask is not ours
    const key = req.callId != null ? String(req.callId) : `${req.agent?.id ?? '?'}:${req.toolName}`;
    const view = ctx.get?.('compact-approval')?.deciding?.get(key);
    const card = view?.cause;
    if (card?.kind !== 'params-edge' || typeof card.grantId !== 'string') return next();
    let verdict, motivation;
    if (policy === 'judge') {
      const floor = floorRefusal(card);
      if (floor) {
        // the floor refused before judgment — the model is never consulted
        view.decider = { policy, motivation: floor.motivation, grantId: card.grantId };
        output?.write?.(`[night-watch] denied "${req.toolName ?? 'unknown'}" at the params edge — the floor refused before judgment\n`);
        return 'rejected';
      }
      let judged;
      try {
        judged = await judge(card);
      } catch (e) {
        judged = { verdict: 'escalate', motivation: `the judge threw (${String(e?.message ?? e).slice(0, 120)}) — escalate (fail-closed)` };
      }
      ({ verdict, motivation } = judged);
    } else {
      ({ verdict, motivation } = decideEdge(policy, card));
    }
    // unsure IS escalate (P-2.21): a decider that cannot decide escalates
    // rather than rejects — tolerate a judge returning the raw vocabulary
    if (verdict === 'escalate' || verdict === 'unsure') return next();
    // claim the verdict on the view: the recorded answerer owns what a yes
    // may materialize (nothing — the row's budget pays) and writes the
    // attributed, motivated note on the record either way
    view.decider = { policy, motivation, grantId: card.grantId };
    const refused = (card.refused ?? []).join(', ');
    output?.write?.(`[night-watch] ${verdict === 'allow' ? 'allowed' : 'denied'} "${req.toolName ?? 'unknown'}" at the params edge (refused: ${refused || 'the whole query'}) under grant ${card.grantId} — motivation on the record\n`);
    return verdict === 'allow' ? 'allowed-once' : 'rejected';
  });
}
