// The host half of the ask card (#90, #201): the BROWSER renderer is
// lib/client.js; this half is the gateway service the card talks to —
// `compact-card-api` — serving exactly two methods over the gateway's /api
// channel:
//   decidingView(args.callId)  → the pattern offers the approval gate
//                                computed for THIS ask (the same rows the
//                                terminal prompter renders), or { offers: [] }
//   patternAnswer(args)        → the guarded pick: the index must address an
//                                offer of the live deciding view (the browser
//                                PICKS, never authors — D-8, the same guard
//                                the terminal's materialization uses); sets
//                                view.patternChoice (+ patternScope for the
//                                #187 night pass) so the recorded answerer
//                                materializes it when the ordinary
//                                approval.answer('allowed-once') resolves.
// Renderings never decide: the card invents nothing — it renders the
// server-computed rows and the server re-validates every pick.
//
// The remote surface is hand-authored SRC (no codegen, the
// dsh-repeat-tool-reminder shape): a `typertRemote` binding + a versioned
// method descriptor on the prototype. Method parameters are named `args` —
// the wire payload is therefore { args: {…} }, the same shape the profile
// runtime probe recipe uses.
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';
export const API_NAMESPACE = 'compact-card-api';

export class CompactCardApi extends Service {
  static inject = ['compact-approval'];

  constructor(ctx, serviceKey) {
    super(ctx, serviceKey ?? 'compact-card-api');
    this.typertRemote = bindTypertRemote(this, this.name);
  }

  /** The deciding view's offers for one ask — empty when unknown, cleared,
   *  or not a pattern-capable ask (every non-compact ask degrades silently). */
  async decidingView(args) {
    const view = this.decidingViewFor(args?.callId);
    return { offers: view?.patternOffers ?? [], query: view?.query ?? null };
  }

  /** The guarded pick. Returns { ok: false, reason } for anything that is not
   *  an exact index into the live view's offers — the browser can propose,
   *  only the Enforcer's own list disposes (D-8). */
  async patternAnswer(args) {
    const { callId, index, runtime } = args ?? {};
    const view = this.decidingViewFor(callId);
    const offers = Array.isArray(view?.patternOffers) ? view.patternOffers : [];
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= offers.length) {
      return { ok: false, reason: 'patternAnswer: the pick does not address an offer of this ask — the browser picks, never authors' };
    }
    view.patternChoice = offers[i];
    if (runtime === true) view.patternScope = 'runtime';
    return { ok: true, text: offers[i].text, scope: runtime === true ? 'runtime' : 'session' };
  }

  decidingViewFor(callId) {
    if (callId == null) return null;
    try {
      return this.ctx.get('compact-approval')?.deciding?.get(String(callId)) ?? null;
    } catch {
      return null;
    }
  }
}

Object.defineProperty(CompactCardApi.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      { method: 'decidingView', invocation: { kind: 'direct' } },
      { method: 'patternAnswer', invocation: { kind: 'direct' } },
    ]),
  }),
});

export const name = 'compact-card';

export function apply(ctx) {
  ctx.plugin(CompactCardApi);
}

export default { name, apply };
