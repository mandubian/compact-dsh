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
  const roster = charter.members.map((m) => `  - ${m.id}${m.bench ? ' (bench seat)' : ''} — ${m.persona}`).join('\n');
  const lines = [
    `You are "${member.id}", a Member of a small autonomous community working under the Compact.`,
    '',
    `THE GOAL (the community's own, verbatim):`,
    `  ${charter.goal}`,
    '',
    'THE COMMUNITY (you may speak with these members on the forum):',
    roster,
    '',
    `SPEECH: forum_post {"topic":"${charter.topic}","text":"…"} speaks to everyone; forum_read (omit topic for the board)`,
    '  reads. Every post you make is a governed act on YOUR record, attributed to you, citable in',
    '  judicature like any other act. Nobody is told you read anything — reading is your own act.',
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
  ];
  if (extras?.publish) {
    lines.push('', `PUBLISHING: ${extras.publish}`);
  }
  lines.push(
    '',
    `THIS RUN: ${charter.budgets.rounds} rounds; you act once per round. Budgets are enforced, not advisory.`,
    'Act, speak, verify — or pass plainly. The community evolves by what its members actually do.',
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
  lines.push('', 'Act, speak, verify — or pass plainly.');
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

/** Drive the community. Returns when the run completes, a budget trips,
 *  or the charter's rounds are spent. `hooks` receives every observable
 *  step (the CLI narrates, Phase D's observatory will stream). */
export async function runCommunity(ctx, { charter, workspace, hooks = {}, tokenMeter = null, releasesOrigin = null }) {
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
  const extras = { publish: releasesOrigin ? `${publishNote ?? 'publishing under a pre-minted grant'} (route: ${releasesOrigin})` : publishNote };

  // seat the members: real sessions, per-member model route from the
  // runtime's default, session ids the member binding's prefixes claim
  const seated = [];
  for (const member of charter.members) {
    const made = await agentsSvc.create({
      sessionId: member.prefix,
      meta: { cwd: workspace },
      agentOptions: { provider: selection.provider, model: selection.model },
    });
    const agent = made?.agent ?? made;
    seated.push({ member, agent, lastForumSeq: 0, turns: 0, briefed: false, wokenFor: new Set() });
    hooks.onSeat?.(member, agent);
  }
  const workers = seated.filter((s) => !s.member.bench);
  const bench = seated.filter((s) => s.member.bench);

  const startedAt = Date.now();
  const stats = { rounds: 0, turns: 0, casesSeen: 0, endReason: null, members: {} };
  const budgetTripped = (why) => { stats.endReason = why; return true; };
  const tokensUsed = () => (tokenMeter ? tokenMeter() : 0);

  const dockedCases = () => {
    try { return judicature ? judicature.docket() : []; } catch { return []; }
  };

  for (let round = 1; round <= charter.budgets.rounds; round += 1) {
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
        await drive(seat, benchFramingText(charter, seat.member, caseRow), hooks, stats, sessionsSvc);
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
      await drive(seat, framing, hooks, stats, sessionsSvc);
      seat.lastForumSeq = forum.forum.posts.length;
      if (!seat.briefed) { seat.briefed = true; void before; }
    }
  }
  stats.endReason = 'rounds complete';
  return finish(stats, seated, hooks);
}

/** One governed turn: the briefing lands on the member's own record as a
 *  user message, the member acts through the full waterfall, the session
 *  flushes to its chain. */
async function drive(seat, framing, hooks, stats, sessionsSvc) {
  const { agent, member } = seat;
  hooks.onTurn?.(member, framing);
  agent.followup(createUserMessage({ content: [{ type: 'text', text: framing }], source: DRIVER_SOURCE }));
  await agent.whenIdle();
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
