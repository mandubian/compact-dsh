// compact-dsh-community — the live community runtime (umbrella #215).
//
// One composed runtime, N model-driven member sessions bound to N admitted
// Members (the many-member binding), speaking on the forum (compact-forum),
// working a charter's macro goal under the full machinery. This package is
// the GENERIC runtime: the charter is data, the newsroom is one charter,
// any macro goal is another. The driver (tools/community-live.mjs) owns
// the boot, the pre-minted grants, and the answerer seating; the engine
// owns the schedule, the briefings, the budgets, and the bench waking.
//
// Three attachments:
//
//   1. THE DRIVER DECIDES NOTHING FOR THE MEMBERS. Its only acts are the
//      schedule and the briefing text; every governed act is a member's
//      own, through the same waterfall as any other act, on the member's
//      own chain. A community orchestrated into its conclusions is a
//      script with extra steps.
//
//   2. BUDGETS ARE ENFORCED, NOT ADVISORY. Turns per member, the wall
//      clock, a shared token meter — when one trips, the run ENDS with
//      its reason on the record.
//
//   3. THE BENCH IS A MEMBER. Filings wake model-driven bench seats with
//      the reading owed before judgment (the docket, counsel access to
//      the cited acts); a judgment without reasons is refused by the
//      judicature itself (J-3), and the framing says so.
//
// WHAT THIS IS NOT. Not a standing service: the run exists while the
// driver keeps it alive, and the judicature docket is in-memory — cases
// live within the run process. Not law: no clause moves, the register is
// untouched, and every member is a practice key under the development
// keyring with standing none — the run rehearses the machinery; it
// enacts nothing (D-8).
//
// Pinned: @deepseek-ai/dsh ~0.2.0-rc.2 (see tools/verify-pin.mjs).

import { validateCharter, memberBindingsOf, CHARTER_VERSION, DEFAULT_BUDGETS } from './charter.js';
import { runCommunity, currentSelectionOf, createRunControls, createDivergenceCounters, briefingText, roundFramingText, benchFramingText, DRIVER_SOURCE } from './engine.js';
import { mountHumanSeat, DEFAULT_ASK_TIMEOUT_MS, DEFAULT_QUESTION_TIMEOUT_MS } from './human.js';
import { startObservatory, DEFAULT_OBSERVATORY_PORT } from './observatory.js';

export {
  validateCharter, memberBindingsOf, CHARTER_VERSION, DEFAULT_BUDGETS,
  runCommunity, currentSelectionOf, createRunControls, createDivergenceCounters, briefingText, roundFramingText, benchFramingText, DRIVER_SOURCE,
  mountHumanSeat, DEFAULT_ASK_TIMEOUT_MS, DEFAULT_QUESTION_TIMEOUT_MS,
  startObservatory, DEFAULT_OBSERVATORY_PORT,
};

export const name = 'compact-community';

/** The declared gaps this layer carries into the boot record (I-8). */
export const DECLARED_GAPS = [
  'the human seat and the observatory are mounted by the DRIVER of a live run, not by the composition: ' +
  'a plain blessed boot has no page and no seat, and its novel asks fail closed as unavailable (the ' +
  'honest default — nobody is silently seated to answer for the operator)',
  'the judicature docket is in-memory: a case lives as long as the run process — the citing chains ' +
  'are durable, the docket itself is not',
  'members are practice keys under the development keyring: standing none, the benches are practice ' +
  'declarations, the run rehearses machinery and enacts nothing (D-8)',
];

export function apply(ctx, config = {}) {
  void config;
  const service = {
    name,
    declaredGaps: DECLARED_GAPS,
    /** Drive a validated charter over this composed runtime. */
    runCommunity: (opts) => runCommunity(ctx, opts),
  };
  for (const gap of DECLARED_GAPS) ctx.logger?.warn?.(`community: ${gap}`);
  ctx.provide?.('compact-community', service);
  return service;
}
