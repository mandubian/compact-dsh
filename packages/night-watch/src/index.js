// compact-dsh-night-watch — the night watch as a composition member (#195).
//
// The watch's JUDGMENT SURFACE lives in ./watch.js (moved byte-faithful from
// the launcher's tools/night-watch.mjs, whose doc block carries the full
// doctrine). This file is the composition seam: what the launcher used to
// wire by hand at boot, the bundle now wires itself, the same way the egress
// posture travels — an env-gated mount, absent by default.
//
//   - apply(ctx, config): the plugin row. The policy comes from the mount
//     config or COMPACT_DECIDER; absent → the chair stays empty (the default,
//     unchanged: a composition without a watch decides nothing unattended).
//   - judgeFromContext(ctx): the judgment member's model call, resolved at
//     CALL time from the runtime's own route (agentDefaultModel + llm) —
//     never at boot (#183 follow-up: probing early aborted the agent
//     factory's registration). The launcher and apply share this one
//     factory; anything unresolvable throws INSIDE the call, which judgeEdge
//     converts into an escalation on the record (fail-closed, never a boot
//     abort).
//
// The SEAT ORDERING invariant lives with whoever seats the watch, and it is
// the launcher's to keep on the composed runtime: the watch is seated
// DOWNSTREAM of the operator answerer, so it decides only when the
// operator's chair is empty. A plain dsh profile has no launcher — the
// posture row seats the watch for the unattended profile, and the ask card
// and README say so: with the watch armed, params-edge asks are decided by
// the watch, not by a human surface. Unset COMPACT_DECIDER to return every
// ask to the humans.
import { judgeEdge, nightWatchAnswerer, liveNetworkGrants } from './watch.js';

export const name = 'compact-night-watch';

export {
  nightWatchAnswerer,
  liveNetworkGrants,
  judgeEdge,
  decideEdge,
  floorRefusal,
  extractVerdictJson,
  JUDGE_DECISIONS,
} from './watch.js';

const POLICIES = new Set(['escalate', 'deny', 'allow-edges', 'judge']);

/**
 * The judgment member, seat-ready: `card → { verdict, motivation }` through
 * judgeEdge's contract (malformed, unsure, or a failed call escalates —
 * fail-closed). The RAW model call is the inner argument: the route
 * (agentDefaultModel — provider/model may be volatile values) and the llm
 * are read when the FIRST edge ask fires, never at apply time (#183's
 * shape). One one-shot call per edge ask; message shape follows
 * dsh-session-title-llm, the runtime's own one-shot caller (createUserMessage
 * + BlockAssembler). Wrapping HERE is the contract — the seat calls
 * `judge(card)`, never the bare route.
 */
export function judgeFromContext(ctx) {
  return async (card) => {
    const raw = async (system, userText) => {
      const { BlockAssembler, createUserMessage } = await import('@deepseek-ai/dsh-llm');
      const readVolatile = (v) => v == null ? null
        : typeof v === 'string' ? v
        : typeof v === 'function' ? (v() ?? null)
        : (v.value ?? v.current ?? null);
      // the runtime exposes the default model as a ctx PROPERTY with a
      // currentSelection() reader — dsh-api-session-controller's own shape
      // (ctx.agentDefaultModel.currentSelection()). ctx.get('agentDefaultModel')
      // resolves nothing on a real boot, and the judge's first live call found
      // that out the hard way (#188 capture: "no usable model route at judgment
      // time" on every edge ask, silently escalated). The getter stays as a
      // test-shape fallback.
      const adm = ctx.agentDefaultModel ?? ctx.get?.('agentDefaultModel');
      const selection = typeof adm?.currentSelection === 'function' ? adm.currentSelection() : adm;
      const provider = readVolatile(selection?.provider);
      const model = readVolatile(selection?.model);
      const llm = ctx.llm;
      if (!provider || !model || typeof llm?.stream !== 'function') {
        throw new Error('no usable model route at judgment time (agentDefaultModel/llm unresolved)');
      }
      const asm = new BlockAssembler();
      for await (const chunk of llm.stream({
        provider, model, system, maxTokens: 300, purpose: 'night-judge',
        messages: [createUserMessage({
          content: [{ type: 'text', text: userText }],
          source: { kind: 'compact-dsh-night-judge' },
        })],
      })) asm.push(chunk);
      const msg = asm.message();
      return (msg?.content ?? []).filter(b => b?.type === 'text').map(b => b.text).join('');
    };
    return judgeEdge(card, raw);
  };
}

/**
 * The plugin row: seat the watch when a policy is named, absent otherwise.
 * `config.policy` wins over COMPACT_DECIDER (a profile patch may pin the
 * policy; the env is the operator's shared knob). `config.output` exists for
 * tests; live runs report on stderr.
 */
export function apply(ctx, config) {
  const policy = config?.policy ?? process.env.COMPACT_DECIDER ?? null;
  if (policy == null || policy === '') return; // no policy named — the chair stays empty
  if (!POLICIES.has(policy)) {
    throw new TypeError(`compact-night-watch: unknown policy "${policy}" — escalate | deny | allow-edges | judge`);
  }
  const judge = policy === 'judge' ? judgeFromContext(ctx) : null;
  const output = config?.output ?? process.stderr;
  // the seat's own service on the provision roll — blessed's mount ends with
  // requireServices(ctx, [service]), and an apply that provides nothing its
  // own name aborts the very boot it armed (found by review on #195's PR)
  ctx.provide?.('compact-night-watch', { name: 'compact-night-watch', policy });
  nightWatchAnswerer(ctx, { policy, judge, output });
  ctx.logger?.warn?.(
    `compact-night-watch: night watch appointed (policy: ${policy}) — params-edge asks only; every verdict reported with its motivation` +
    (policy === 'judge' ? '' : '; the judge member is not composed') +
    ' — with the watch armed, params-edge asks are decided by the watch before any human surface; unset COMPACT_DECIDER to return every ask to the humans');
  if (!liveNetworkGrants(ctx.get?.('compact-approval')).length) {
    // #182: a watch over an empty store judges nothing — nothing ever
    // reaches an edge. Declared at boot, never silent.
    ctx.logger?.warn?.(
      'compact-night-watch: no live network grant in the store — unattended runs fail closed at first touch until a pass is minted (attended ask or /grants-grant); mint the pass before you leave');
  }
}
