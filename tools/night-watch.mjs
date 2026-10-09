// The night watch (#176, slice 2a) — the appointed answerer for unattended
// runs. Autonoetic's run-scoped decider seat, rebuilt under the Compact: the
// watch sits OUTSIDE the run (composed by the launcher at boot, on the
// operator's side of the separation-of-powers boundary), and its remit is
// the narrowest that exists — ONLY the params-edge asks (#176 slice 1), the
// acts a live grant row covers by route but refuses by query axis. It mints
// nothing: an allow names the row whose budget pays, and the recorded
// answerer enforces that (mint-nothing) — a wrong yes is bounded by the
// terms the operator chose (TTL, budget, class, revocation).
//
// Slice 2a's member is a POLICY, not a judge — the honest mechanical
// position:
//   escalate (default) — the empty chair stays empty: every edge ask falls
//                        through to the host's fail-closed, on the record;
//   deny               — every edge ask is refused, with the reason named;
//   allow-edges        — non-credential edges are admitted under the row's
//                        terms; CREDENTIAL-shaped refused names are never
//                        admitted by ANY policy (the #176 floor binds the
//                        watch like it binds the offers and /grants-grant).
// The judgment member (slice 2b) replaces this policy table with a model
// call behind the SAME claim/card/verdict/report contract; recusal binds it
// (the policy seat has no lineage to recuse from).
//
// The reporting contract is the point: every verdict rides the deciding
// view (view.decider) into the recorded answerer's note — attributed,
// motivated, on the chained record where the offline auditor (and the
// morning after) reads it — plus this one-line stderr trace for the live run.

// The pure decision: policy + card → verdict + motivation. No I/O, no view —
// the whole judgment surface of slice 2a is this function and its tests.
export function decideEdge(policy, card) {
  const c = card ?? {};
  const refused = Array.isArray(c.refused) ? c.refused : [];
  const credential = Array.isArray(c.credential) ? c.credential : [];
  const route = `the row covers this route; its axis refused (${refused.join(', ') || 'the whole query'})`;
  if (policy === 'escalate') {
    return { verdict: 'escalate', motivation: `${route}; the appointed policy escalates — no one is deciding in the operator's absence` };
  }
  if (credential.length) {
    return {
      verdict: policy === 'deny' ? 'deny' : 'deny', // the floor: even allow-edges refuses here
      motivation: `${route}; credential-shaped parameters (${credential.join(', ')}) never widen — the floor binds the offers, the commands, and the watch alike`,
    };
  }
  if (policy === 'deny') {
    return { verdict: 'deny', motivation: `${route}; the appointed policy refuses every edge ask` };
  }
  if (policy === 'allow-edges') {
    return { verdict: 'allow', motivation: `${route}; the appointed policy admits the act under the row's terms — budget, TTL, class and revocation still bound it` };
  }
  return { verdict: 'escalate', motivation: `unknown policy — escalate (fail-closed)` };
}

/** Compose the night watch onto the settled context, downstream of the
 *  operator answerer: in attended mode the human answers first and the watch
 *  never fires; unattended, it is the only decider between the ask and the
 *  host's fail-closed. */
export function nightWatchAnswerer(ctx, { policy = 'escalate', output = process.stderr } = {}) {
  if (!['escalate', 'deny', 'allow-edges'].includes(policy)) {
    throw new Error(`night watch: unknown policy "${policy}" — escalate | deny | allow-edges`);
  }
  return ctx.on('approval/request', async (req, next) => {
    // the recorded answerer publishes the deciding view for exactly the
    // decision's duration; without a params-edge card this ask is not ours
    const key = req.callId != null ? String(req.callId) : `${req.agent?.id ?? '?'}:${req.toolName}`;
    const view = ctx.get?.('compact-approval')?.deciding?.get(key);
    const card = view?.cause;
    if (card?.kind !== 'params-edge' || typeof card.grantId !== 'string') return next();
    const { verdict, motivation } = decideEdge(policy, card);
    if (verdict === 'escalate') return next();
    // claim the verdict on the view: the recorded answerer owns what a yes
    // may materialize (nothing — the row's budget pays) and writes the
    // attributed, motivated note on the record either way
    view.decider = { policy, motivation, grantId: card.grantId };
    const refused = (card.refused ?? []).join(', ');
    output?.write?.(`[night-watch] ${verdict === 'allow' ? 'allowed' : 'denied'} "${req.toolName ?? 'unknown'}" at the params edge (refused: ${refused || 'the whole query'}) under grant ${card.grantId} — motivation on the record\n`);
    return verdict === 'allow' ? 'allowed-once' : 'rejected';
  });
}
