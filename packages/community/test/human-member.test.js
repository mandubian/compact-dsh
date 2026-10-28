// The human member (#215's mixed community, made real): the charter's
// human flag, the seat's floor door, the page's floor endpoint, and the
// llm adapter that makes the page the model. No browser and no daemon —
// the surfaces are exercised exactly as the loop and the page drive them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mountHumanSeat, seatOutcome, startObservatory, validateCharter, humanMemberAdapter, HUMAN_ROUTE, memberOfFraming, briefingText } from '../src/index.js';

function stubCtx({ deciding = new Map() } = {}) {
  const services = new Map([
    ['compact-approval', { deciding }],
    ['compact-forum', { onPost: () => {}, snapshot: () => ({ stats: { posts: 0, topics: 0 }, topics: [], posts: [] }) }],
    ['compact-judicature', { docket: () => [] }],
  ]);
  return { logger: { warn: () => {}, error: () => {} }, get: (name) => services.get(name) };
}

const BASE = { name: 'c', goal: 'a goal long enough to matter here', members: [] };

// ── the charter boundary ──

test('charter: a human member is seated with no model, named in the roster; the bounds refuse', () => {
  const c = validateCharter({ ...BASE, members: [
    { id: 'accuser', human: true, persona: 'the Principal, filing suspicions in plain words' },
    { id: 'chair', model: 'zai/glm-5.3', persona: 'weighs only what ran' },
  ] });
  assert.equal(c.members[0].human, true);
  assert.equal('model' in c.members[0], false, 'a human member carries no route — the page is the model');
  assert.equal(c.members[1].human, undefined);

  // the bounds, each with its reason
  assert.throws(() => validateCharter({ ...BASE, members: [
    { id: 'h', human: true, model: 'zai/glm-5.3', persona: 'cannot be both' },
  ] }), /a human member carries no model route — the page is the model/);
  assert.throws(() => validateCharter({ ...BASE, members: [
    { id: 'h', human: true, bench: true, persona: 'cannot judge from the floor' },
  ] }), /a human bench seat is refused in v1/);
  assert.throws(() => validateCharter({ ...BASE, members: [
    { id: 'h1', human: true, persona: 'one human is plenty' },
    { id: 'h2', human: true, persona: 'two humans are plenty' },
    { id: 'h3', human: true, persona: 'three is a crowd' },
  ] }), /at most 2 human members/);
  assert.throws(() => validateCharter({ ...BASE, members: [
    { id: 'h', human: 'yes', persona: 'the flag is boolean' },
  ] }), /true or absent/);
  // the floor patience is an escalation fact with the same floor as the others
  const withFloor = validateCharter({ ...BASE, members: [{ id: 'h', human: true, persona: 'slow and careful, twice over' }], escalation: { floorTimeoutMs: 900_000 } });
  assert.equal(withFloor.escalation.floorTimeoutMs, 900_000);
  assert.throws(() => validateCharter({ ...BASE, members: [{ id: 'h', human: true, persona: 'a whole honest sentence' }], escalation: { floorTimeoutMs: 10 } }), /at least a second/);
});

// ── the floor door on the seat ──

test('the floor door: pose waits, the page settles one act, and the forum\'s own rules refuse what the forum would', async () => {
  const ctx = stubCtx();
  const seat = mountHumanSeat(ctx, { floorTimeoutMs: 60_000, defaultTopic: 'cross-exam-floor' });
  const turnP = seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'Round 1 of 6, member "accuser".' });
  const pending = seat.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'floor');
  assert.equal(pending[0].member, 'accuser');
  assert.equal(pending[0].defaultTopic, 'cross-exam-floor');

  // a bad topic refuses HERE — at the boundary, not mid-turn
  const bad = seat.settleFloor(pending[0].id, { act: 'post', text: 'words', topic: 'NOT A TOPIC' });
  assert.ok(bad.error, 'an invalid act refuses with the reason');
  assert.equal(seat.pending().length, 1, 'a refused act does not consume the turn');

  const settled = seat.settleFloor(pending[0].id, { act: 'post', text: 'I suspect the parser lies.' });
  assert.ok(settled && !settled.error);
  assert.deepEqual(await turnP, { act: 'post', topic: 'cross-exam-floor', text: 'I suspect the parser lies.', keep: false });
  assert.equal(seat.pending().length, 0);

  // pass and say carry their own shape
  const passP = seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'round 2' });
  seat.settleFloor(seat.pending()[0].id, { act: 'pass', text: 'nothing to add' });
  assert.deepEqual(await passP, { act: 'pass', reason: 'nothing to add' });

  const sayP = seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'round 3' });
  seat.settleFloor(seat.pending()[0].id, { act: 'say', text: 'I am done here' });
  assert.deepEqual(await sayP, { act: 'say', text: 'I am done here' });
});

test('the floor timeout: the honest silence — no act, and the divergence counter is fed', async () => {
  const seat = mountHumanSeat(stubCtx(), { floorTimeoutMs: 20 });
  const act = await seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'a turn nobody answers' });
  assert.deepEqual(act, { act: 'timeout' });
  assert.equal(seat.pending().length, 0, 'nothing waits forever');
});

// ── the adapter: the page is the model ──

async function collect(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return chunks;
}

const MESSAGES = (framing) => [{ role: 'user', content: [{ type: 'text', text: framing }] }];

test('humanMemberAdapter: a POST becomes the member\'s own forum_post tool call, verbatim', async () => {
  const seat = mountHumanSeat(stubCtx(), { floorTimeoutMs: 60_000, defaultTopic: 'cross-exam-floor' });
  const adapter = humanMemberAdapter({ seat, topic: 'cross-exam-floor' });
  const prepared = await adapter.prepareCall('human', 'the-principal');
  assert.equal(prepared.model.id, 'the-principal');
  assert.equal(prepared.model.provider, 'human');

  const framing = 'Round 2 of 6, member "accuser".\nNew on the forum since your last turn (1 post(s)):';
  const streamP = collect(prepared.stream({ messages: MESSAGES(framing) }));
  const pending = seat.pending()[0];
  assert.equal(pending.member, 'accuser', 'the framing names the member whose turn it is');
  assert.match(pending.framing, /Round 2 of 6/);
  seat.settleFloor(pending.id, { act: 'post', text: 'H1: the parser accepts garbage.' });
  const chunks = await streamP;
  const call = chunks.find((c) => c.type === 'tool-call-delta');
  assert.ok(call, 'the human\'s button becomes a tool call');
  assert.equal(call.name, 'forum_post');
  assert.deepEqual(JSON.parse(call.argumentsDelta), { topic: 'cross-exam-floor', text: 'H1: the parser accepts garbage.' });
  assert.equal(chunks[chunks.length - 1].type, 'finish');
  assert.equal(chunks[chunks.length - 1].reason.kind, 'stop');
});

test('humanMemberAdapter: SAY is words on the chain, PASS is forum_pass — and the silence is counted once', async () => {
  const seat = mountHumanSeat(stubCtx(), { floorTimeoutMs: 60_000 });
  const adapter = humanMemberAdapter({ seat, topic: 'floor' });

  // say: plain assistant words, no tool call — the turn ends
  let p = collect(adapter.stream({ messages: MESSAGES('You are "accuser", a Member of a small autonomous community…') }));
  seat.settleFloor(seat.pending()[0].id, { act: 'say', text: 'noted, and I withdraw H2' });
  let chunks = await p;
  assert.ok(chunks.some((c) => c.type === 'text-delta' && c.text === 'noted, and I withdraw H2'));
  assert.ok(!chunks.some((c) => c.type === 'tool-call-delta'));

  // pass: the governed silence, as the member's own tool call
  p = collect(adapter.stream({ messages: MESSAGES('Round 3 of 6, member "accuser".') }));
  seat.settleFloor(seat.pending()[0].id, { act: 'pass', text: 'waiting on the chair' });
  chunks = await p;
  const call = chunks.find((c) => c.type === 'tool-call-delta');
  assert.equal(call.name, 'forum_pass');
  assert.deepEqual(JSON.parse(call.argumentsDelta), { reason: 'waiting on the chair' });

  // timeout: no act at all, in words that say exactly that
  // — counted ONCE, at the seat's resolution, the way the launcher wires it
  // (the adapter used to count too: every silence fed the fence twice)
  const timeouts = [];
  const slowSeat = mountHumanSeat(stubCtx(), {
    floorTimeoutMs: 20,
    onResolve: (record) => { if (seatOutcome(record).timedOut) timeouts.push(record.id); },
  });
  const slowAdapter = humanMemberAdapter({ seat: slowSeat, topic: 'floor', onTimeout: () => timeouts.push('adapter') });
  chunks = await collect(slowAdapter.stream({ messages: MESSAGES('Round 4 of 6, member "accuser".') }));
  const silence = chunks.find((c) => c.type === 'text-delta');
  assert.match(silence.text, /the honest silence/);
  assert.ok(!chunks.some((c) => c.type === 'tool-call-delta'), 'the timeout performs NO act');
  assert.equal(timeouts.length, 1, 'one silence, one count');
  assert.ok(!timeouts.includes('adapter'), 'the adapter counts nothing — the seat\'s resolution is the one path');
});

test('memberOfFraming: the engine\'s own words name the human member; the briefing says HUMAN in plain terms', () => {
  assert.equal(memberOfFraming(MESSAGES('Round 5 of 6, member "accuser".')), 'accuser');
  assert.equal(memberOfFraming(MESSAGES('You are "boss", a Member of a small autonomous community working under the Compact.')), 'boss');
  assert.equal(memberOfFraming(MESSAGES('nothing names anyone here')), null);
  assert.deepEqual({ ...HUMAN_ROUTE }, { provider: 'human', model: 'the-principal' });

  const charter = validateCharter({ ...BASE, members: [
    { id: 'accuser', human: true, persona: 'the Principal, filing suspicions in plain words' },
    { id: 'chair', model: 'zai/glm-5.3', persona: 'weighs only what ran' },
  ] });
  const humanBrief = briefingText(charter, charter.members[0], {});
  assert.match(humanBrief, /YOU ARE HUMAN — the Principal, seated as a member/);
  assert.match(humanBrief, /the page is your instrument/);
  assert.match(humanBrief, /YOUR ROUTE: human\/the-principal — the page is the model/);
  assert.match(humanBrief, /\(HUMAN — the Principal, on the page\) — the Principal, filing suspicions/, 'the roster names the human seat to the model members');
  const modelBrief = briefingText(charter, charter.members[1], {});
  assert.match(modelBrief, /CRAFT: write real bash/, 'the model member\'s briefing is unchanged');
});

// ── the page's endpoint ──

test('the observatory: the floor endpoint settles the act from the page; invalid acts refuse with the reason', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'floor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = stubCtx();
  const seat = mountHumanSeat(ctx, { floorTimeoutMs: 60_000, defaultTopic: 'cross-exam-floor' });
  const obs = await startObservatory(ctx, { humanSeat: seat, port: 0, charterName: 'cross-exam' });
  t.after(() => obs.close());

  const turnP = seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'Round 1 of 6, member "accuser".' });
  const state = await (await fetch(`${obs.url}state`)).json();
  const floor = state.pending.find((p) => p.kind === 'floor');
  assert.ok(floor, 'the floor turn is on the page\'s pending');

  // no words, no act
  const empty = await fetch(`${obs.url}floor/${floor.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ act: 'post', text: '   ' }) });
  assert.equal(empty.status, 400);
  // an unknown act names itself
  const weird = await fetch(`${obs.url}floor/${floor.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ act: 'explode', text: 'x' }) });
  assert.equal(weird.status, 400);
  assert.match((await weird.json()).error, /post.*pass.*say/);

  const ok = await fetch(`${obs.url}floor/${floor.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ act: 'post', text: 'H1: the parser accepts garbage.', topic: 'cross-exam-floor' }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await turnP, { act: 'post', topic: 'cross-exam-floor', text: 'H1: the parser accepts garbage.', keep: false });

  const gone = await fetch(`${obs.url}floor/${floor.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ act: 'pass', text: 'x' }) });
  assert.equal(gone.status, 404, 'a settled floor turn cannot act twice');
});

test('seatOutcome: one mapping per door — the floor\'s act from the right field, its silence counted', () => {
  // a settled floor act: the act lives under record.answer (settle's shape)
  const acted = seatOutcome({ kind: 'floor', id: 'p1', by: 'accuser', member: 'accuser', answer: { act: 'post', topic: 't', text: 'H1' } });
  assert.deepEqual(acted, { timedOut: false, event: { type: 'floor-acted', id: 'p1', act: 'post', by: 'accuser', member: 'accuser' } });
  // the floor timer's record: act 'timeout', no answer
  const silent = seatOutcome({ kind: 'floor', id: 'p2', by: 'accuser', member: 'accuser', act: 'timeout' });
  assert.deepEqual(silent, { timedOut: true, event: { type: 'floor-timeout', by: 'accuser', member: 'accuser' } });
  // the other two doors map exactly as the launcher always did
  assert.deepEqual(seatOutcome({ kind: 'ask', id: 'a1', answer: 'timeout' }), { timedOut: true, event: { type: 'ask-timeout', id: 'a1' } });
  assert.deepEqual(seatOutcome({ kind: 'ask', id: 'a2', answer: 'approve' }), { timedOut: false, event: { type: 'ask-decided', id: 'a2', decision: 'approve' } });
  assert.deepEqual(seatOutcome({ kind: 'question', by: 'm', answer: null }), { timedOut: true, event: { type: 'question-timeout', by: 'm' } });
  assert.deepEqual(seatOutcome({ kind: 'question', by: 'm', answer: 'yes' }), { timedOut: false, event: { type: 'question-answered', by: 'm' } });
});

test('the framing survives a notice after it: a LoopGuard trip leaves the member and the round on the card', async () => {
  // a human member trips the guard like any member (F-4); the guard's prose
  // arrives as a user message AFTER the round framing
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'You are "accuser", a Member of a small autonomous community…' }] },
    { role: 'user', content: [{ type: 'text', text: 'Round 2 of 6, member "accuser". The chair asks for your H1.' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'forum_post', arguments: '{}' }] },
    { role: 'tool', content: [{ type: 'text', text: 'posted fp_7' }] },
    { role: 'user', content: [{ type: 'text', text: '[LG/LG-5] loop guard trip (RedundantRosterPolling): …' }] },
  ];
  assert.equal(memberOfFraming(messages), 'accuser', 'the member is still named');
  let posed = null;
  const adapter = humanMemberAdapter({ seat: { poseFloor: async (args) => { posed = args; return { act: 'say', text: 'ok' } } } });
  await collect(adapter.stream({ messages }));
  assert.equal(posed.member, 'accuser');
  assert.match(posed.framing, /Round 2 of 6, member "accuser"/, 'the round is still on the card');
  assert.match(posed.framing, /— since then —\n\[LG\/LG-5\]/, 'and the notice beside it, as a model member would read it');
  assert.equal(posed.lastResult, 'posted fp_7');
});

test('every pending card carries its expiry — the page counts down to the honest silence', async () => {
  // floor turns and questions here; the approval ask's expiry is asserted
  // where the ask door is driven (human-observatory.test.js)
  const seat = mountHumanSeat(stubCtx(), { floorTimeoutMs: 600_000, questionTimeoutMs: 300_000 });
  const before = Date.now();
  const turn = seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'Round 1 of 6, member "accuser".' });
  const asked = seat.tool.execute({ question: 'which suspicion first?' }, { agent: { id: 'chair' } });
  const [floor, question] = ['floor', 'question'].map((k) => seat.pending().find((p) => p.kind === k));
  for (const [rec, ms] of [[floor, 600_000], [question, 300_000]]) {
    const left = Date.parse(rec.expiresAt) - before;
    assert.ok(left >= ms - 50 && left <= ms + 1000, `${rec.kind}: expiresAt is posedAt + its timeout (${left}ms)`);
  }
  seat.settleFloor(floor.id, { act: 'say', text: 'ok' });
  seat.replyQuestion(question.id, 'the first one');
  await Promise.all([turn, asked]);
});

test('a landed post or pass ENDS the human\'s turn — no second card; keep the floor, or a refusal, brings it back', async () => {
  // the live cross-exam finding: after a post the loop handed the result
  // back to the page, which re-posed a card — it read as a new question,
  // and the whole community waited on it
  const posed = [];
  const queue = [];
  const seat = { poseFloor: async (args) => { posed.push(args); return queue.shift(); } };
  const adapter = humanMemberAdapter({ seat, topic: 'floor' });
  const framing = { role: 'user', content: [{ type: 'text', text: 'Round 1 of 6, member "accuser".' }] };
  const call = (id, name) => ({ role: 'assistant', content: [{ type: 'tool-call', id, name, arguments: '{}' }] });
  const result = (id, text) => ({ role: 'tool', toolCallId: id, content: [{ type: 'text', text }] });

  // post → the tool call; its LANDED result → the turn ends, no card
  queue.push({ act: 'post', topic: 'floor', text: 'H1', keep: false });
  let chunks = await collect(adapter.stream({ messages: [framing] }));
  const id1 = chunks.find((c) => c.type === 'tool-call-delta').id;
  chunks = await collect(adapter.stream({ messages: [framing, call(id1, 'forum_post'), result(id1, '[forum] fp_7 posted to floor (1 post(s) in topic). It is a governed act on your record.')] }));
  assert.equal(posed.length, 1, 'no second card');
  assert.deepEqual(chunks.map((c) => c.type), ['text-delta', 'finish']);
  assert.match(chunks[0].text, /posted fp_7 and ended the turn/);

  // pass → ends the turn the same way
  queue.push({ act: 'pass', reason: 'waiting on the chair' });
  chunks = await collect(adapter.stream({ messages: [framing] }));
  const id2 = chunks.find((c) => c.type === 'tool-call-delta').id;
  chunks = await collect(adapter.stream({ messages: [framing, call(id2, 'forum_pass'), result(id2, '[forum] pass recorded — not a post. It entered no topic.')] }));
  assert.equal(posed.length, 2, 'no card after a pass either');
  assert.match(chunks[0].text, /passed and ended the turn/);

  // post & keep the floor → the card comes back with the result
  queue.push({ act: 'post', topic: 'floor', text: 'H2', keep: true }, { act: 'say', text: 'done' });
  chunks = await collect(adapter.stream({ messages: [framing] }));
  const id3 = chunks.find((c) => c.type === 'tool-call-delta').id;
  await collect(adapter.stream({ messages: [framing, call(id3, 'forum_post'), result(id3, '[forum] fp_8 posted to floor (2 post(s) in topic).')] }));
  assert.equal(posed.length, 4, 'kept the floor: a second card');
  assert.match(posed[3].lastResult, /fp_8 posted/);

  // a REFUSED post never ends the turn silently: the card returns with the refusal
  queue.push({ act: 'post', topic: 'floor', text: 'H3', keep: false }, { act: 'say', text: 'ok' });
  chunks = await collect(adapter.stream({ messages: [framing] }));
  const id4 = chunks.find((c) => c.type === 'tool-call-delta').id;
  await collect(adapter.stream({ messages: [framing, call(id4, 'forum_post'), result(id4, 'Error: [LG/LG-5] loop guard trip (RedundantRosterPolling): …')] }));
  assert.equal(posed.length, 6, 'refused: the card is back');
  assert.match(posed[5].lastResult, /\[LG\/LG-5\]/);
});

test('a new turn\'s card shows no "last act" from the turn before — the round\'s news leads', async () => {
  let posed = null;
  const adapter = humanMemberAdapter({ seat: { poseFloor: async (args) => { posed = args; return { act: 'say', text: 'ok' }; } } });
  await collect(adapter.stream({ messages: [
    { role: 'user', content: [{ type: 'text', text: 'Round 1 of 2, member "accuser".' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'human-1', name: 'forum_post', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'human-1', content: [{ type: 'text', text: '[forum] fp_1 posted to floor (1 post(s) in topic).' }] },
    { role: 'assistant', content: [{ type: 'text', text: '[the Principal posted fp_1 and ended the turn]' }] },
    { role: 'user', content: [{ type: 'text', text: 'Round 2 of 2, member "accuser". New on the forum since your last turn (1 post(s)):' }] },
  ] }));
  assert.equal(posed.lastResult, null, 'round 1\'s post is not round 2\'s last act');
  assert.match(posed.framing, /^Round 2 of 2/);
});

test('the seat and the page carry "keep the floor"; the human briefing says a post ends the turn', async () => {
  const seat = mountHumanSeat(stubCtx(), { floorTimeoutMs: 60_000, defaultTopic: 'floor' });
  const turn = seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'x' });
  seat.settleFloor(seat.pending()[0].id, { act: 'post', text: 'H1', keep: true });
  assert.equal((await turn).keep, true);
  const brief = briefingText(validateCharter({ ...BASE, members: [{ id: 'accuser', human: true, persona: 'the Principal, as accuser' }] }), { id: 'accuser', human: true });
  assert.match(brief, /and ENDS your turn; "post & keep the floor"/);
  assert.match(brief, /A refused act always comes back on the card/);
});

test('a waiting floor card hears the abort: withdrawn at once, no act, not counted as silence', async () => {
  // the live finding: every Ctrl-C after the first said "stopping
  // IMMEDIATELY" and the run waited out the human's whole timeout — the
  // card ignored the turn's cancel
  const outcomes = [];
  const seat = mountHumanSeat(stubCtx(), { floorTimeoutMs: 600_000, onResolve: (r) => outcomes.push(seatOutcome(r)) });
  const abort = new AbortController();
  const turn = seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'Round 1 of 6, member "accuser".', signal: abort.signal });
  assert.equal(seat.pending().length, 1);
  abort.abort();
  assert.deepEqual(await turn, { act: 'cancelled' });
  assert.equal(seat.pending().length, 0, 'the card is gone from the page');
  assert.deepEqual(outcomes, [{ timedOut: false, event: { type: 'floor-cancelled', by: 'accuser', member: 'accuser' } }]);
  // an already-aborted signal never poses a card that waits
  const late = new AbortController(); late.abort();
  assert.deepEqual(await seat.poseFloor({ member: 'accuser', signal: late.signal }), { act: 'cancelled' });
});

test('the adapter hands its request signal to the floor: an aborted turn ends without an act', async () => {
  const seat = mountHumanSeat(stubCtx(), { floorTimeoutMs: 600_000 });
  const adapter = humanMemberAdapter({ seat, topic: 'floor' });
  const abort = new AbortController();
  const p = collect(adapter.stream({ messages: MESSAGES('Round 2 of 6, member "accuser".'), signal: abort.signal }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(seat.pending().length, 1, 'the card waits');
  abort.abort();
  const chunks = await p;
  assert.deepEqual(chunks, [], 'no tool call, no words — the loop records the interruption');
});

test('a question hears its call\'s signal (dsh-tools: async work observes exec.signal)', async () => {
  const outcomes = [];
  const seat = mountHumanSeat(stubCtx(), { questionTimeoutMs: 300_000, onResolve: (r) => outcomes.push(seatOutcome(r)) });
  const abort = new AbortController();
  const asked = seat.tool.execute({ question: 'which first?' }, { agent: { id: 'chair' }, signal: abort.signal });
  assert.equal(seat.pending().length, 1);
  abort.abort();
  assert.match(await asked, /withdrawn before the human answered/);
  assert.equal(seat.pending().length, 0);
  assert.deepEqual(outcomes, [{ timedOut: false, event: { type: 'question-cancelled', by: 'chair' } }]);
});

test('cancelPending withdraws every card: the ask DENIED (fail closed), the question and the turn unanswered', async () => {
  const outcomes = [];
  const seat = mountHumanSeat(stubCtx(), { askTimeoutMs: 600_000, questionTimeoutMs: 600_000, floorTimeoutMs: 600_000, onResolve: (r) => outcomes.push(seatOutcome(r)) });
  const req = { agent: { id: 'skeptic' }, toolName: 'bash', reason: '[AG/fp] not covered\nhttps://example.com', fingerprint: 'fp_x' };
  const ask = seat.answerer(req, () => Promise.resolve('unavailable'));
  const question = seat.tool.execute({ question: 'which first?' }, { agent: { id: 'chair' } });
  const turn = seat.poseFloor({ member: 'accuser', by: 'accuser', framing: 'x' });
  const kinds = seat.pending().map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['ask', 'floor', 'question'], 'one card of each kind waits');
  const n = seat.cancelPending('the operator stopped the run');
  assert.equal(n, 3);
  assert.equal(seat.pending().length, 0);
  assert.deepEqual(await turn, { act: 'cancelled' });
  assert.match(await question, /withdrawn/);
  assert.equal(await ask, 'denied', 'a withdrawn ask fails closed');
  assert.ok(outcomes.every((o) => o.timedOut === false), 'the operator\'s stop is never counted as the human\'s silence');
});

test('the page script carries the floor card: three buttons, the reconciler carries typed words across renders', async () => {
  const { pageHtml } = await import('../src/page.js');
  const html = pageHtml({ charterName: 'cross-exam', token: 'tkn' });
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.match(script, /YOUR TURN ON THE FLOOR/);
  assert.match(script, /const floors = p\.filter\(x => x\.kind === 'floor'\)/);
  assert.match(script, /div\.dataset\.id = f\.id;/);
  assert.match(script, /send\('post'\)/);
  assert.match(script, /send\('pass'\)/);
  assert.match(script, /send\('say'\)/);
  // the reconciler's carry-over includes the topic input, and the empty state knows the floor
  assert.match(script, /if \(wasF\.topic != null\) ti\.value = wasF\.topic;/);
  assert.match(script, /!asks\.length && !questions\.length && !floors\.length/);
  // a refused act keeps the card and the words, and says why — a removed
  // card never came back (the reconciler saw nothing change)
  assert.match(script, /if \(r && r\.error\) \{ showWhy\(div, r\.error\); return; \}/);
  assert.match(script, /if \(wasF\.why\) showWhy\(div, wasF\.why\);/);
  // a post ends the turn; keeping the floor is the explicit second button,
  // and a card that comes back leads with the result, the briefing folded
  assert.match(script, /Post &amp; end turn/);
  assert.match(script, /div\.querySelector\('\.keep'\)\.onclick = \(\) => send\('post', true\);/);
  assert.match(script, /keep: keep === true/);
  assert.match(script, /'<details class="told"' \+ \(f\.lastResult \? '' : ' open'\)/);
  // made for a human: the seat widens while words are owed, the tab says
  // so, each card counts down, Ctrl+Enter posts, the count names the
  // forum's limits, and a rebuild keeps the cursor where the human left it
  assert.match(script, /body\.classList\.toggle\('composing', floors\.length \+ questions\.length > 0\)/);
  assert.match(script, /'● YOUR TURN — '/);
  assert.match(script, /data-expires="' \+ esc\(x\.expiresAt\)/);
  assert.match(script, /setInterval\(tickLeft, 1000\)/);
  assert.match(script, /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key === 'Enter'\) \{ e\.preventDefault\(\); send\('post'\);/);
  assert.match(script, /post ≤ 8000 · pass ≤ 2000/);
  assert.match(script, /if \(wasF\.focus\) \{ ta\.focus\(\); ta\.setSelectionRange/);
  assert.match(html, /body\.composing main \{ grid-template-columns: 1\.25fr 0\.6fr 1\.55fr; \}/);
});
