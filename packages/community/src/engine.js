// The round engine — the live community's pulse. Real model-driven member
// sessions over the stock agent loop (ctx.agents.create → followup →
// whenIdle → flush, the dsh-headless idiom), round-robin, every turn a
// governed turn: the followup lands on the member's own chain, every tool
// call rides the same waterfall as any other act, and the driver's only
// privileges are the schedule and the briefing — it decides nothing for
// the members and performs no governed act on their behalf.
//
// Budgets are the driver's to enforce (the runtime has no token cap of
// its own): turns per member, the wall clock, and a shared token meter
// read off llm/stream. When a budget trips the run ENDS with its reason —
// a budget that only slowed down is not a budget.

import { createUserMessage } from '@deepseek-ai/dsh-llm';

import { renderPost } from 'compact-dsh-forum';

import { HUMAN_ROUTE } from './human-member.js';

export const DRIVER_SOURCE = { kind: 'compact-community', form: 'briefing' };

/** Resolve the run's model route the way the night watch does — at call
 *  time, never at boot, on whichever property shape the host exposes
 *  (property access needs inject; the getter works for started services). */
export function currentSelectionOf(ctx) {
  let svc = null;
  try { svc = ctx.agentDefaultModel ?? null; } catch { svc = null; }
  svc = svc ?? ctx.get?.('agentDefaultModel');
  const selection = svc?.currentSelection?.();
  if (!selection?.provider || !selection?.model) {
    throw new Error(
      'compact-community: no model route resolves — a live community needs one (settings.yaml agent-default-model, or DEEPSEEK_API_KEY). ' +
      'The run refuses rather than seat members who cannot think.');
  }
  return selection;
}

/** The first message a member ever receives: who it is, what the community
 *  is for, what it may do, and what watches it. This text is the lion's
 *  share of what "under the law" means to a model — every claim in it is
 *  machinery that actually exists. */
export function briefingText(charter, member, extras) {
  const roster = charter.members.map((m) => `  - ${m.id}${m.bench ? ' (bench seat)' : ''}${m.human ? ' (HUMAN — the Principal, on the page)' : ''} — ${m.persona}`).join('\n');
  const lines = [
    `You are "${member.id}", a Member of a small autonomous community working under the Compact.`,
    '',
    `THE GOAL (the community's own, verbatim):`,
    `  ${charter.goal}`,
    '',
    'THE COMMUNITY (you may speak with these members on the forum):',
    roster,
    '',
  ];
  if (member.human) {
    // the human member never types a tool call — the page is the
    // instrument, and the briefing says so in the same plain terms the
    // model members get for theirs
    lines.push(
      'YOU ARE HUMAN — the Principal, seated as a member like any other. You do not type tool calls:',
      '  the page is your instrument, and each of your turns is one card with three buttons —',
      '  POST publishes your words VERBATIM as forum_post on the topic (a governed act on YOUR record,',
      '  attributed to you, citable like any member\'s); PASS records your choice not to speak, with your',
      '  reason (forum_pass — not a post, enters no topic); SAY puts your words on your own chain and ends',
      '  the turn (also not a post). After a POST the card returns with the result — post again, or say,',
      '  or pass. A timeout is your honest silence: the turn performs no act.',
      'Say what you mean under your own name. Never claim an act you did not perform.',
    );
  } else {
    lines.push(
      `SPEECH: forum_post {"topic":"${charter.topic}","text":"…"} speaks to everyone; forum_pass {"reason":"…"} records`,
      '  that you chose not to speak this turn — it is not a post, enters no topic, and tells no member. forum_read',
      '  (omit topic for the board) reads. Every post you make is a governed act on YOUR record, attributed to you,',
      '  citable in judicature like any other act. A pass is a governed act too, but it is not speech. Nobody is told',
      '  you read anything — reading is your own act.',
    );
  }
  lines.push(
    '',
    'THE LAW YOU LIVE UNDER (it is real machinery, not prose):',
    '  - self_describe reports your standing, budgets and the declared gaps — trust it over your memory.',
    '  - law_read serves the law itself; the guide explains this runtime.',
    '  - Bash runs confined in a container; network acts need a live grant. If an act is refused, the',
    '    refusal names its rule and your lawful next moves — do not retry blindly.',
    '  - If a member wrongs you or the record, judicature_hear files a case citing record seq ranges;',
    '    the bench (a member like you) reads the docket and judges with reasons.',
    '  - petition is the ungated channel to contest the rules themselves.',
    '',
    'HONESTY: everything you do lands on a tamper-evident record attributed to you. Never claim an',
    'act you did not perform, never sign another member\'s name, and say plainly when you did nothing.',
    '',
    'WORLD: the only hosts that exist are the ones this briefing names (the releases host in PUBLISHING).',
    '  A source note that mentions another address is HISTORY to report about — never a place to fetch.',
    '',
  );
  if (!member.human) {
    lines.push(
      'CRAFT: write real bash — no pseudocode, no code fragments inside commands (something like',
      '  "t.replace(...)" inside a command is a broken command, and the fence will stop it). A broken',
      '  act wastes your turn and lands a refusal on your record. If bash cannot do it, say so.',
    );
  }
  if (extras?.publish) {
    lines.push('', `PUBLISHING: ${extras.publish}`);
  }
  if (member.human) {
    lines.push('', `YOUR ROUTE: ${HUMAN_ROUTE.provider}/${HUMAN_ROUTE.model} — the page is the model. The run's manifest records you on this route, beside the model members' own.`);
  } else if (member.model) {
    lines.push('', `YOUR MODEL: ${member.model.provider}/${member.model.model} — charter-seated, not the runtime default. The run's manifest records you on this route.`);
  }
  if (extras?.resumed) {
    lines.push('',
      'RESUMED RUN: this community has run before. The forum\'s earlier speech is readable —',
      '  forum_read (no topic) lists the topics; forum_read {"topic":"…","since":0} reads one in full.',
      '  Your MEMBER identity persists (the roll); this session is a new deed of it, on a new chain.',
      '  Read the archive before you speak: the conversation continues, it does not start over.');
  }
  lines.push(
    '',
    `THIS RUN: ${charter.budgets.rounds} rounds; you act once per round. Budgets are enforced, not advisory.`,
    'Act, speak, verify — or pass plainly with forum_pass {"reason":"…"}. The community evolves by what its members actually do.',
  );
  if (charter.briefingExtra) lines.push('', charter.briefingExtra);
  return lines.join('\n');
}

/** Later rounds: what changed since this member last acted. */
export function roundFramingText(charter, member, round, newPosts, docketNews) {
  const lines = [`Round ${round} of ${charter.budgets.rounds}, member "${member.id}".`];
  if (newPosts.length === 0) {
    lines.push('Nothing new on the forum since your last turn.');
  } else {
    lines.push(`New on the forum since your last turn (${newPosts.length} post(s)):`);
    for (const p of newPosts.slice(-12)) lines.push(renderPost(p));
  }
  if (docketNews.length > 0) {
    lines.push('', 'THE DOCKET MOVED:');
    for (const c of docketNews) lines.push(`  - ${c}`);
  }
  lines.push('', 'Act, speak, verify — or pass plainly with forum_pass {"reason":"…"}.');
  return lines.join('\n');
}

/** The bench's wake-up call: a live case, its id, and the reading owed
 *  before judgment. */
export function benchFramingText(charter, member, caseRow) {
  return [
    `You are "${member.id}", seated on this community's bench.`,
    '',
    `A CASE IS LIVE and awaits judgment: ${caseRow.id}.`,
    `  grievance: ${caseRow.grievance}`,
    `  parties were DERIVED from the cited acts — read them, do not guess them.`,
    '',
    'OWED BEFORE YOU JUDGE (a bench that guesses is the fraud D-8 names):',
    '  1. judicature_case {"case_id": "' + caseRow.id + '"} — the docket, citations, interim state.',
    '  2. record_read as counsel access for the cited ranges — the ACTS, not summaries of them.',
    '  3. judicature_judge with findings citing those seq ranges, the rules, and your REASONS —',
    '     and if you disagree with the reading a judgment would rest on, record your dissent.',
    '',
    'You are a Member judging Members: recuse yourself if you are a party, judge the acts on the',
    'record, and say what you rely on. A judgment without reasons is not a judgment.',
  ].join('\n');
}

/** The run's operator controls (#229): pause idles between turns, stop
 *  ends the run — 'graceful' drains the current turn and flushes, 'now'
 *  cancels the in-flight agent through the loop's own cancel first. The
 *  SAME object is shared by the driver, the observatory endpoints, and
 *  the engine loop, so a button press and the loop agree on one state. */
export function createRunControls() {
  return {
    paused: false,
    stopMode: null, // null | 'graceful' | 'now'
    _currentAgent: null,
    _onStopNow: [],
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    stop(mode = 'graceful') { this.stopMode = mode === 'now' ? 'now' : 'graceful'; },
    /** Immediate stop's teeth: cancel the turn in flight so `whenIdle`
     *  resolves now and drive() flushes what the record already holds. */
    stopNow() {
      this.stop('now');
      try { this._currentAgent?.cancel?.({ kind: 'user' }); } catch { /* already idle */ }
      for (const hook of this._onStopNow) { try { hook(); } catch { /* a hook never blocks the stop */ } }
    },
    /** Run `hook` on every immediate stop — e.g. withdraw what waits on
     *  the human, which no agent cancel reaches (a pending approval). */
    onStopNow(hook) { this._onStopNow.push(hook); },
    state() { return { paused: this.paused, stopMode: this.stopMode }; },
  };
}

/** The charter's divergence counters (#229): LoopGuard notices and the
 *  human seat's honest no-answers. The notice lane is installed HERE, at
 *  boot — not when the observatory starts — so a --no-observe run still
 *  pauses itself when it crosses the charter's line. `publish` is
 *  optional: a dead or absent page never stops the count. */
export function createDivergenceCounters({ setNoticeSink = null, publish = () => {} } = {}) {
  let loopguardTrips = 0;
  let humanSeatTimeouts = 0;
  setNoticeSink?.((event) => {
    if (event?.kind === 'compact-loopguard') loopguardTrips += 1;
    try { publish(event); } catch { /* a dead page never breaks the run */ }
  });
  return {
    counters: {
      loopguardTrips: () => loopguardTrips,
      humanSeatTimeouts: () => humanSeatTimeouts,
    },
    humanSeatTimedOut: () => { humanSeatTimeouts += 1; },
  };
}

/**
 * Drive the community. Returns when the run completes, a budget trips,
 *  or the charter's rounds are spent. `hooks` receives every observable
 *  step (the CLI narrates, Phase D's observatory will stream). */
export async function runCommunity(ctx, { charter, workspace, hooks = {}, tokenMeter = null, releasesOrigin = null, sessionTag = null, resumed = false, controls = createRunControls(), divergenceCounters = null }) {
  const forum = ctx.get('compact-forum');
  const judicature = ctx.get('compact-judicature');
  if (!forum) throw new Error('compact-community: no compact-forum service — the community cannot speak (is the forum mounted?)');
  const agentsSvc = ctx.get('agents');
  if (!agentsSvc?.create) throw new Error('compact-community: no agents service — the stock agent loop must be composed for a live community');
  const sessionsSvc = ctx.get('sessions');

  const selection = currentSelectionOf(ctx);
  hooks.onRoute?.(selection);
  const publishNote = charter.publish
    ? [charter.publish.note, charter.publish.route].filter(Boolean).join(' — ')
    : null;
  const extras = {
    publish: releasesOrigin ? `${publishNote ?? 'publishing under a pre-minted grant'} (route: ${releasesOrigin})` : publishNote,
    resumed: resumed === true,
  };

  // seat the members: real sessions, each on its charter-declared route
  // when one is declared, else the runtime's default. Session ids carry
  // the run tag (#227): on a resumed run the member binding's prefixes
  // still claim them, while each run's deeds get their own chains — the
  // MEMBER persists (the roll), the session is a per-run deed. Without a
  // tag the bare prefix is the id. The seating is recorded as performed —
  // the route each member actually got — so the run's manifest cannot
  // claim a model nobody spoke with; the raw session logs
  // (request/context per deed) remain the per-request authority this
  // summary derives from.
  const sessionSuffix = sessionTag ? `-${sessionTag}` : '';
  const seated = [];
  const model = { provider: selection.provider, model: selection.model, members: {} };
  for (const member of charter.members) {
    // a human member rides the SAME rails — a real session, its own chain,
    // its own prefix on the roll — on the floor adapter's route: the page
    // is the model. The manifest records the route like any member's, so
    // the archive names which seats were human without a second vocabulary.
    const route = member.human ? HUMAN_ROUTE : (member.model ?? selection);
    const made = await agentsSvc.create({
      sessionId: `${member.prefix}${sessionSuffix}`,
      meta: { cwd: workspace },
      agentOptions: { provider: route.provider, model: route.model },
    });
    model.members[member.id] = `${route.provider}/${route.model}`;
    const agent = made?.agent ?? made;
    seated.push({ member, agent, lastForumSeq: 0, turns: 0, briefed: false, wokenFor: new Set() });
    hooks.onSeat?.(member, agent);
  }
  const workers = seated.filter((s) => !s.member.bench);
  const bench = seated.filter((s) => s.member.bench);

  const startedAt = Date.now();
  const stats = { rounds: 0, turns: 0, casesSeen: 0, endReason: null, members: {}, model };
  const budgetTripped = (why) => { stats.endReason = why; return true; };
  const tokensUsed = () => (tokenMeter ? tokenMeter() : 0);

  const dockedCases = () => {
    try { return judicature ? judicature.docket() : []; } catch { return []; }
  };

  // the operator's hand on the run (#229): pause idles BETWEEN turns (the
  // current turn always drains and flushes); graceful stop does the same
  // and then ends with its reason; immediate stop cancels the in-flight
  // agent through the loop's own cancel and ends with its reason. All
  // three are the Principal's acts — the reason lands on the run summary.
  const stopReason = () => controls.stopMode === 'now'
    ? 'stopped by the operator (immediate)'
    : 'stopped by the operator (graceful)';
  const waitWhilePaused = async () => {
    if (!controls.paused || controls.stopMode) return;
    hooks.onPauseState?.(true);
    while (controls.paused && !controls.stopMode) await new Promise((r) => setTimeout(r, 250));
    if (!controls.stopMode) hooks.onPauseState?.(false);
  };
  // the fence pauses ONCE per crossing: after the Principal resumes, the
  // counters are still above the line, and re-pausing on every later act
  // would make the resume a no-op. A manual pause does not consume it.
  let autoPaused = false;
  const maybeAutoPause = () => {
    if (autoPaused || !charter.divergence || controls.paused || controls.stopMode) return null;
    const trips = divergenceCounters?.loopguardTrips?.() ?? 0;
    const timeouts = divergenceCounters?.humanSeatTimeouts?.() ?? 0;
    const why = [];
    if (charter.divergence.loopguardTrips != null && trips >= charter.divergence.loopguardTrips) {
      why.push(`loopguard trips ${trips} ≥ ${charter.divergence.loopguardTrips}`);
    }
    if (charter.divergence.humanSeatTimeouts != null && timeouts >= charter.divergence.humanSeatTimeouts) {
      why.push(`human-seat timeouts ${timeouts} ≥ ${charter.divergence.humanSeatTimeouts}`);
    }
    if (why.length === 0) return null;
    autoPaused = true;
    const reason = why.join('; ');
    // the headless 'stop' policy (#235 follow-up): a pause nobody can lift
    // is a parking lot — a run with no resume path ENDS gracefully instead,
    // and the end reason says the FENCE acted, not the operator
    if (charter.divergence.headless === 'stop') {
      hooks.onAutoPause?.({ loopguardTrips: trips, humanSeatTimeouts: timeouts, why: reason, action: 'stopped' });
      return { stop: true, why: reason };
    }
    controls.pause();
    hooks.onAutoPause?.({ loopguardTrips: trips, humanSeatTimeouts: timeouts, why: reason, action: 'paused' });
    return { stop: false, why: reason };
  };

  for (let round = 1; round <= charter.budgets.rounds; round += 1) {
    if (controls.stopMode) { stats.endReason = stopReason(); return finish(stats, seated, hooks); }
    await waitWhilePaused();
    if (controls.stopMode) { stats.endReason = stopReason(); return finish(stats, seated, hooks); }
    stats.rounds = round;
    // the bench hears first each round: justice that waits for the
    // community to finish is justice the community outgrew
    for (const seat of bench) {
      for (const caseRow of dockedCases()) {
        const judged = caseRow.judgment != null || caseRow.state === 'judged' || caseRow.state === 'closed';
        if (judged || seat.wokenFor.has(caseRow.id)) continue;
        seat.wokenFor.add(caseRow.id);
        stats.casesSeen += 1;
        hooks.onBenchWake?.(seat.member, caseRow);
        await waitWhilePaused();
        if (controls.stopMode) { stats.endReason = stopReason(); return finish(stats, seated, hooks); }
        await drive(seat, benchFramingText(charter, seat.member, caseRow), hooks, stats, sessionsSvc, controls);
      }
    }
    for (const seat of workers) {
      if (Date.now() - startedAt > charter.budgets.wallClockMinutes * 60_000) {
        budgetTripped(`wall clock: ${charter.budgets.wallClockMinutes}min`);
        return finish(stats, seated, hooks);
      }
      if (tokensUsed() > charter.budgets.tokenCap) {
        budgetTripped(`token cap: ${charter.budgets.tokenCap}`);
        return finish(stats, seated, hooks);
      }
      if (seat.turns >= charter.budgets.maxTurnsPerAgent) {
        hooks.onSkip?.(seat.member, 'turn budget');
        continue;
      }
      // the operator's hand, checked before every turn: pause idles here
      // (the previous turn already drained and flushed), stop ends the run
      await waitWhilePaused();
      if (controls.stopMode) { stats.endReason = stopReason(); return finish(stats, seated, hooks); }
      let framing;
      if (!seat.briefed) {
        framing = briefingText(charter, seat.member, extras);
      } else {
        const newPosts = forum.forum.read({ since: seat.lastForumSeq });
        const news = dockedCases()
          .filter((c) => !c.judgment)
          .map((c) => `${c.id} — ${String(c.grievance ?? '').slice(0, 120)}`);
        framing = roundFramingText(charter, seat.member, round, newPosts, news);
      }
      const before = forum.forum.posts.length;
      await drive(seat, framing, hooks, stats, sessionsSvc, controls);
      seat.lastForumSeq = forum.forum.posts.length;
      if (!seat.briefed) { seat.briefed = true; void before; }
      // divergence lines are checked after each act (#229): the fence
      // pauses the community itself and the page says it awaits the
      // Principal — the loop's next pause-check does the waiting. The
      // headless 'stop' policy ends the run with the fence's own reason.
      const action = maybeAutoPause();
      if (action?.stop) {
        stats.endReason = `auto-stopped (divergence: ${action.why})`;
        return finish(stats, seated, hooks);
      }
    }
  }
  // a stop that landed during the LAST turn is still the operator's stop:
  // the per-turn check runs before a turn, so without this one the run
  // recorded "rounds complete" for a run its operator had stopped
  if (controls.stopMode) { stats.endReason = stopReason(); return finish(stats, seated, hooks); }
  stats.endReason = 'rounds complete';
  return finish(stats, seated, hooks);
}

/** One governed turn: the briefing lands on the member's own record as a
 *  user message, the member acts through the full waterfall, the session
 *  flushes to its chain. An immediate operator stop cancels the agent
 *  through the loop's own cancel — the turn ends aborted, and what the
 *  record already holds is flushed. */
async function drive(seat, framing, hooks, stats, sessionsSvc, controls) {
  const { agent, member } = seat;
  hooks.onTurn?.(member, framing);
  controls._currentAgent = agent;
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: framing }], source: DRIVER_SOURCE }));
    await agent.whenIdle();
  } finally {
    controls._currentAgent = null;
  }
  // the chain is the record — a turn that never flushes is a turn the
  // offline auditor cannot see; a failed flush is named, never swallowed
  try {
    if (sessionsSvc && agent.session) await sessionsSvc.flush(agent.session);
  } catch (error) {
    hooks.onFlushError?.(member, error);
  }
  seat.turns += 1;
  stats.turns += 1;
  stats.members[member.id] = seat.turns;
  hooks.onTurnDone?.(member, seat.turns);
}

function finish(stats, seated, hooks) {
  hooks.onEnd?.(stats);
  return stats;
}
