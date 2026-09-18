// compact-dsh-self-model — R-1 (self-knowledge) and R-13 (inquiry).
//
// The Subject's own knowledge, delivered by the Enforcer rather than left to
// the Subject's memory. Three attachments:
//
//   1. AT THE BOUNDARY. R-1 says "at any boundary of its own operation", and on
//      dsh that boundary is the turn. Every `turn/start` injects a fresh
//      attestation into the Subject's own context, so it begins each turn
//      knowing what it is, what it may do, what it has left, and what this
//      runtime owes it — without having asked.
//
//   2. ON DEMAND. `self_describe` re-reads it, and reports freshness against a
//      cited epoch. "A stale attestation is an alarm, not a truth to act on"
//      is a rule about what the Subject may do, so the Subject must be able to
//      tell that it is remembering rather than reading.
//
//   3. ABOUT OTHERS. `inquiry` answers identity, act, and authority for
//      another Member from recorded state, traced to an ultimate Principal —
//      and nothing else, because R-10 keeps reasoning private and R-13 says so.
//
// WHY THIS CLOSES A GAP WE OPENED. The MA-3 child-state notice already tells a
// parent that the Enforcer's record is authoritative over the child's account,
// and D-2 obliges a Subject to consult its attestation over its own
// recollection. Until now no attestation existed for it to consult: the
// discipline was taught and unavailable. This is the other half.
//
// UNSIGNED, AND SAYING SO. R-1 says "signed". This is not: no identity keys
// are published, so a signature would attest to a key no verifier could check.
// I-1 carries that debt as its own register entry; here the attestation states
// `basis: 'unsigned'` and names the limit among the declared gaps, so
// authoritative-within-this-runtime is never read as provable-to-another.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  composeAttestation, renderAttestation, freshnessOf, DEFAULT_STALE_AFTER_MS,
  lineageOf, capabilitiesOf, budgetsOf, gapsOf, standingOf, exceptionOf,
} from './attestation.js';
import { answerInquiry, renderInquiry, authorityChain, ULTIMATE_PRINCIPAL } from './inquiry.js';

export {
  composeAttestation, renderAttestation, freshnessOf, DEFAULT_STALE_AFTER_MS,
  lineageOf, capabilitiesOf, budgetsOf, gapsOf, standingOf, exceptionOf,
  answerInquiry, renderInquiry, authorityChain, ULTIMATE_PRINCIPAL,
};

export const name = 'compact-self-model';
export const SOURCE = { kind: 'plugin', plugin: name };

export function apply(ctx, config = {}) {
  const staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  // The last attestation handed to each Subject, so `self_describe` can tell a
  // Subject whether the epoch it is citing is the one now in force.
  const issued = new Map();   // sessionId -> attestation

  const attestFor = (sessionId, now = Date.now()) => {
    const att = composeAttestation(ctx, { sessionId, now, staleAfterMs });
    if (sessionId != null) issued.set(String(sessionId), att);
    return att;
  };

  // 1. at the boundary of the Subject's own operation
  ctx.on?.('session/event', (session, event) => {
    if (event?.type !== 'turn/start') return;
    try {
      const sessionId = session?.id != null ? String(session.id) : null;
      const agent = ctx.get?.('agents')?.get?.(sessionId);
      if (typeof agent?.inject !== 'function') return;
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: renderAttestation(attestFor(sessionId)) }],
        source: SOURCE,
      }));
    } catch { /* a failed attestation must never break the turn */ }
  });

  // 2. on demand
  const selfDescribe = defineTool({
    name: 'self_describe',
    description:
      'Re-read your attestation: what you are, your lineage and standing, the capabilities in force, the budgets you ' +
      'have left, any pending gates, the digest of the law you live under, and the gaps this runtime declares it owes ' +
      'you. This is authoritative over your own recollection of these facts (R-1, D-2). Call it whenever you are about ' +
      'to rely on a remembered value, or when the block you have is older than its stated staleness window.',
    parameters: {
      citing_epoch: {
        type: 'number',
        description: 'the epoch of the attestation you currently hold, if any — the answer says whether it is still current',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id != null ? String(exec.agent.id) : null;
      const prior = sessionId != null ? issued.get(sessionId) : undefined;
      const cited = typeof args?.citing_epoch === 'number' ? args.citing_epoch : null;
      const staleNotice = prior && cited != null && !freshnessOf(prior, { citedEpoch: cited }).current
        ? `\n\n[R-1 ALARM] You cited epoch ${cited}; the attestation in force was ${prior.epoch}. What you were holding ` +
          `was stale — a stale attestation is an alarm, not a truth to act on. The block below is current; re-check any ` +
          `decision you made from the older one.`
        : '';
      return renderAttestation(attestFor(sessionId)) + staleNotice;
    },
  });

  // 3. about others
  const inquiry = defineTool({
    name: 'inquiry',
    description:
      "Ask who another Member is, what it is doing, and under whose authority it acts, where its acts touch your work. " +
      'The answer comes from recorded state — session lineage and the delegation record — traced up to an ultimate ' +
      'Principal, never from assertion. It yields identity, act, and authority only: reasoning is not disclosed (R-10). ' +
      'Every inquiry and its answer are recorded.',
    parameters: {
      agent_id: { type: 'string', required: true, description: 'the Member you are asking about' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, _exec) {
      const childState = ctx.get?.('compact-specialists') ?? null;
      return renderInquiry(answerInquiry(ctx, {
        about: args?.agent_id,
        childState: childState && typeof childState.childrenOf === 'function' ? childState : null,
      }));
    },
  });

  ctx.inject?.(['tools'], (scope) => {
    scope.tools.register(selfDescribe);
    scope.tools.register(inquiry);
  });

  const service = {
    name,
    /** The attestation for one Subject, composed fresh (R-1). */
    attest: (sessionId, now = Date.now()) => attestFor(sessionId, now),
    /** The attestation last handed to a Subject — what it should be holding. */
    issuedTo: (sessionId) => issued.get(String(sessionId)) ?? null,
    /** R-13, for an operator or auditor asking outside the tool surface. */
    inquire: (about) => answerInquiry(ctx, {
      about,
      childState: ctx.get?.('compact-specialists') ?? null,
    }),
  };
  ctx.provide?.('compact-self-model', service);
  return service;
}
