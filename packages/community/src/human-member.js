// The human member's floor adapter — the page is the model (#215's mixed
// community, made real).
//
// A charter member with `"human": true` is seated on the roll exactly as
// any agent member: its own session, its own prefix, its own chain, its
// own practice key. The only difference is the route — provider "human",
// model "the-principal" — registered HERE, as an llm adapter whose
// completion is not a network call but the Principal reading a floor card
// on the observatory and pressing a button.
//
// What that buys, for free, is the whole agent loop: the framing lands on
// the member's chain as a user message; the human's button press becomes
// an assistant turn (a forum_post / forum_pass tool call, or plain words);
// the tool executes in-session through the same waterfall as any member's
// act — attributed by the roll binding, citable in judicature, flushed to
// the member's own chain. The driver decides nothing and performs no
// governed act on the member's behalf: the human decides, the loop carries,
// exactly as a model's decision is carried.
//
// WHAT THIS IS NOT (v1, named): the floor speaks FORUM ONLY — post, pass,
// or say. No bash, no judicature tools; a human bench seat is refused at
// the charter boundary. And a human turn without a page (--no-observe)
// is refused at launch: a floor nobody can reach is a run that burns its
// wall clock on honest silences, and the boundary should say so first.
//
// Pinned: @deepseek-ai/dsh ~0.2.0-rc.2 (see tools/verify-pin.mjs).

import { LlmAdapter } from '@deepseek-ai/dsh-llm';

export const HUMAN_PROVIDER = 'human';
export const HUMAN_MODEL = 'the-principal';
export const HUMAN_ROUTE = Object.freeze({ provider: HUMAN_PROVIDER, model: HUMAN_MODEL });

const textOf = (message) => (Array.isArray(message?.content)
  ? message.content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('\n')
  : String(message?.content ?? ''));

/** The member a framing text names, or null. briefingText opens
 * `You are "<id>"…`; roundFramingText carries `member "<id>"`. */
function memberNamedBy(text) {
  const round = /member "([a-z0-9-]+)"/.exec(text);
  if (round) return round[1];
  const brief = /^You are "([a-z0-9-]+)"/m.exec(text);
  return brief ? brief[1] : null;
}

/** Index of the latest user message that is the engine's framing — not
 * every user message is: a LoopGuard notice, a petition answer or an
 * approval notice is injected as one too, after the framing, and a reader
 * that took "the last user message" lost both the member and the round
 * the moment a human member tripped the guard like any other (F-4). */
function framingIndex(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user' && memberNamedBy(textOf(messages[i]))) return i;
  }
  return -1;
}

/** The member id the framing names — the engine's own words, parsed back.
 * Either shape names the human member whose turn this is; neither is
 * guesswork. */
export function memberOfFraming(messages = []) {
  const i = framingIndex(messages);
  return i < 0 ? null : memberNamedBy(textOf(messages[i]));
}

/** The tail the human needs beside the framing: the result of their own
 * last act (a tool-result message after the framing), so a posted post's
 * fp_id is on the card that asks "what next?". */
function lastResultOf(messages = []) {
  // THIS turn's last result only — after the latest framing. A new round's
  // card showed the previous turn's post as "your last act", and folded the
  // round's news under it.
  const from = framingIndex(messages);
  const results = messages.slice(from < 0 ? 0 : from + 1).filter((m) => m?.role === 'tool');
  if (results.length === 0) return null;
  const text = textOf(results[results.length - 1]).trim();
  return text ? text : null;
}

/** What the floor card shows: the framing, and every notice that reached
 * the member after it — the human reads what a model member would read. */
function framingOf(messages = []) {
  const i = framingIndex(messages);
  if (i < 0) {
    const last = [...messages].reverse().find((m) => m?.role === 'user');
    return last ? textOf(last) : '';
  }
  const notices = messages.slice(i + 1).filter((m) => m?.role === 'user').map(textOf).filter((t) => t.trim());
  return [textOf(messages[i]), ...notices.map((t) => `— since then —\n${t}`)].join('\n\n');
}

/**
 * The llm adapter for provider "human". `seat` is the mounted human seat
 * (its floor door poses each completion). The adapter COUNTS nothing: a
 * floor that timed out is counted once, where every door's no-answer is —
 * the seat's resolution (seatOutcome). It once counted here as well, and
 * each silence fed the charter's fence twice. Returns an `LlmAdapter` for
 * `ctx.get('llm').registerAdapter`.
 */
export function humanMemberAdapter({ seat, topic = null, note = () => {} } = {}) {
  if (!seat?.poseFloor) throw new Error('human-member: the seat carries no floor door — mount the human seat first');
  let callSeq = 0;
  // A post or a pass ENDS the human's turn. The loop hands every tool
  // result back to the member's model — for a model, the next step; for a
  // human it re-posed a card after each post, which read as a new
  // question, and the whole community waited on it (the live cross-exam
  // finding). The call id of an ending act is remembered here; when its
  // result comes back LANDED, the turn ends without a card. A refused act
  // (a gate, the loop guard) still comes back on a card, with the refusal.
  const endsTurn = new Map(); // member -> call id of the act that ends its turn
  const LANDED = /^\[forum\] (?:fp_\d+ posted to |pass recorded)/;
  return new (class extends LlmAdapter {
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: 'the Principal (the human seat)',
        description: 'a human member of the community: the page is the model — each call is one floor card the Principal answers',
        context: { contextWindow: 32_768 },
      };
    }

    async *stream(options) {
      const messages = Array.isArray(options?.messages) ? options.messages : [];
      const member = memberOfFraming(messages);
      const last = messages[messages.length - 1];
      const ending = endsTurn.get(member);
      if (ending != null && last?.role === 'tool' && last.toolCallId === ending) {
        endsTurn.delete(member);
        const result = textOf(last).trim();
        if (LANDED.test(result)) {
          const what = /fp_\d+/.exec(result)?.[0];
          note(`human member ${member ?? '?'} → turn ends (${what ? `posted ${what}` : 'passed'}) — no second card`);
          yield { type: 'text-delta', index: 0, text: what ? `[the Principal posted ${what} and ended the turn]` : '[the Principal passed and ended the turn]' };
          yield { type: 'finish', reason: { kind: 'stop' } };
          return;
        }
        // not landed: the card comes back below, the refusal in its last act
      }
      const act = await seat.poseFloor({
        member,
        by: member,
        framing: framingOf(messages),
        lastResult: lastResultOf(messages),
        // the loop's abort signal: an immediate stop cancels the turn, and
        // the waiting card must hear it like a model's network call would
        signal: options?.signal ?? null,
      });
      callSeq += 1;
      if (act.act === 'post' || act.act === 'pass') {
        const name = act.act === 'post' ? 'forum_post' : 'forum_pass';
        const args = act.act === 'post'
          ? { topic: act.topic ?? topic ?? undefined, text: act.text }
          : { reason: act.reason };
        const id = `human-${callSeq}`;
        const keep = act.act === 'post' && act.keep === true;
        if (keep) endsTurn.delete(member);
        else endsTurn.set(member, id);
        note(`human member ${member ?? '?'} → ${name}${keep ? ', keeping the floor' : ''} (the page's button, carried as this member's own act)`);
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) };
        yield { type: 'finish', reason: { kind: 'stop' } };
        return;
      }
      if (act.act === 'cancelled') {
        note(`human member ${member ?? '?'} → turn withdrawn: the run is stopping (no act)`);
        // an aborted request ends here — the loop records the interruption;
        // a withdrawal without an abort still ends the turn in plain words
        if (options?.signal?.aborted) return;
        yield { type: 'text-delta', index: 0, text: '[the run is stopping — the Principal\'s turn was withdrawn before any act]' };
        yield { type: 'finish', reason: { kind: 'stop' } };
        return;
      }
      if (act.act === 'say') {
        note(`human member ${member ?? '?'} → words on its own chain (not a forum post)`);
        yield { type: 'text-delta', index: 0, text: act.text };
        yield { type: 'finish', reason: { kind: 'stop' } };
        return;
      }
      // the honest silence: the timeout already resolved the pose (and the
      // seat's resolution counted it); this turn performs NO act, and the
      // words say exactly that. The human bills no tokens and invents no
      // consent.
      note(`human member ${member ?? '?'} → no answer in time — the honest silence (counted)`);
      yield {
        type: 'text-delta', index: 0,
        text: '[the Principal did not answer in time — the honest silence: this turn performed no act, and consents to nothing]',
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  })();
}
