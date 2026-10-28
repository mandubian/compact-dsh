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
  assert.deepEqual(await turnP, { act: 'post', topic: 'cross-exam-floor', text: 'I suspect the parser lies.' });
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
  assert.deepEqual(await turnP, { act: 'post', topic: 'cross-exam-floor', text: 'H1: the parser accepts garbage.' });

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
