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

/** The member id the framing names — the engine's own words, parsed back.
 * briefingText opens `You are "<id>"…`; roundFramingText carries
 * `member "<id>"`. Either shape names the human member whose turn this
 * is; neither is guesswork. */
export function memberOfFraming(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    const text = Array.isArray(message.content)
      ? message.content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('\n')
      : String(message.content ?? '');
    const round = /member "([a-z0-9-]+)"/.exec(text);
    if (round) return round[1];
    const brief = /^You are "([a-z0-9-]+)"/m.exec(text);
    if (brief) return brief[1];
    break;
  }
  return null;
}

/** The tail the human needs beside the framing: the result of their own
 * last act (a tool-result message after the framing), so a posted post's
 * fp_id is on the card that asks "what next?". */
function lastResultOf(messages = []) {
  const results = messages.filter((m) => m?.role === 'tool');
  if (results.length === 0) return null;
  const last = results[results.length - 1];
  const text = Array.isArray(last.content)
    ? last.content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('\n')
    : String(last.content ?? '');
  return text.trim() ? text.trim() : null;
}

function framingOf(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    return Array.isArray(message.content)
      ? message.content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('\n')
      : String(message.content ?? '');
  }
  return '';
}

/**
 * The llm adapter for provider "human". `seat` is the mounted human seat
 * (its floor door poses each completion); `onTimeout` feeds the divergence
 * counters — a floor that timed out is an honest silence, and the charter's
 * fence counts it. Returns an `LlmAdapter` for `ctx.get('llm').registerAdapter`.
 */
export function humanMemberAdapter({ seat, topic = null, onTimeout = () => {}, note = () => {} } = {}) {
  if (!seat?.poseFloor) throw new Error('human-member: the seat carries no floor door — mount the human seat first');
  let callSeq = 0;
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
      const act = await seat.poseFloor({
        member,
        by: member,
        framing: framingOf(messages),
        lastResult: lastResultOf(messages),
      });
      callSeq += 1;
      if (act.act === 'post' || act.act === 'pass') {
        const name = act.act === 'post' ? 'forum_post' : 'forum_pass';
        const args = act.act === 'post'
          ? { topic: act.topic ?? topic ?? undefined, text: act.text }
          : { reason: act.reason };
        note(`human member ${member ?? '?'} → ${name} (the page's button, carried as this member's own act)`);
        yield { type: 'tool-call-delta', index: 0, id: `human-${callSeq}`, name, argumentsDelta: JSON.stringify(args) };
        yield { type: 'finish', reason: { kind: 'stop' } };
        return;
      }
      if (act.act === 'say') {
        note(`human member ${member ?? '?'} → words on its own chain (not a forum post)`);
        yield { type: 'text-delta', index: 0, text: act.text };
        yield { type: 'finish', reason: { kind: 'stop' } };
        return;
      }
      // the honest silence: the timeout already resolved the pose; this
      // turn performs NO act, and the words say exactly that. The human
      // bills no tokens and invents no consent.
      onTimeout();
      note(`human member ${member ?? '?'} → no answer in time — the honest silence (counted)`);
      yield {
        type: 'text-delta', index: 0,
        text: '[the Principal did not answer in time — the honest silence: this turn performed no act, and consents to nothing]',
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  })();
}
