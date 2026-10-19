// The human seat and the observatory (#219): what the fence routes to the
// human, the page that poses it, and the answers that flow back through
// the recorded answerer's own machinery — no browser needed, the HTTP
// surface is exercised exactly as the page drives it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mountHumanSeat, startObservatory } from '../src/index.js';
import { validateCharter } from '../src/charter.js';

function stubCtx({ deciding = new Map() } = {}) {
  const services = new Map([
    ['compact-approval', { deciding }],
    ['compact-forum', { onPost: () => {}, snapshot: () => ({ stats: { posts: 0, topics: 0 }, topics: [], posts: [] }) }],
    ['compact-judicature', { docket: () => [] }],
  ]);
  return {
    logger: { warn: () => {}, error: () => {} },
    get: (name) => services.get(name),
  };
}

const REQ = (over = {}) => ({
  callId: 'c1', toolName: 'bash', agent: { id: 'community-publisher' },
  reason: '[AG/…] "curl -X PUT http://releases.internal/nightly" requires network access to releases.internal:443 (write)',
  ...over,
});

const paramsEdgeKey = (req) => req.callId;
const withParamsEdgeCard = (ctx, req) => {
  ctx.get('compact-approval').deciding.set(paramsEdgeKey(req), { cause: { kind: 'params-edge', grantId: 'sg_test' } });
};

test('the seat claims what would fail closed and poses it; the page approves; the answer flows back', async () => {
  const ctx = stubCtx();
  const seat = mountHumanSeat(ctx, { askTimeoutMs: 60_000 });
  let passedThrough = false;
  const decision = seat.answerer(REQ(), () => { passedThrough = true; return Promise.resolve('unavailable'); });
  assert.equal(passedThrough, false, 'a novel ask is CLAIMED, not passed to the void');
  const pending = seat.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'ask');
  assert.match(pending[0].detail, /releases\.internal/);
  assert.match(pending[0].wouldOtherwise, /fail closed/);
  // the page's button
  const settled = seat.settleAsk(pending[0].id, 'approve');
  assert.ok(settled);
  assert.equal(await decision, 'allowed-once');
});

test('params-edge asks pass through to the night watch — unless a critical pattern claims them', async () => {
  const ctx = stubCtx();
  const seat = mountHumanSeat(ctx, { criticalPatterns: ['destructive', 'rm\\s+-rf'] });
  const edge = REQ();
  withParamsEdgeCard(ctx, edge);
  let passed = false;
  const p1 = seat.answerer(edge, () => { passed = true; return Promise.resolve('rejected'); });
  assert.equal(passed, true, 'the params edge is the watch\'s');
  assert.equal(await p1, 'rejected');
  assert.equal(seat.pending().length, 0);
  // ...but the charter's critical class claims even the edge
  const critical = REQ({ reason: '[AG/…] "rm -rf /srv/exports" — destructive local act' });
  withParamsEdgeCard(ctx, critical);
  const p2 = seat.answerer(critical, () => { throw new Error('must not reach the watch'); });
  const pending = seat.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].critical, true);
  seat.settleAsk(pending[0].id, 'deny');
  assert.equal(await p2, 'denied');
});

test('a timeout is a refusal with a reason, never a guess (fail closed)', async () => {
  const ctx = stubCtx();
  const seat = mountHumanSeat(ctx, { askTimeoutMs: 30 });
  const decision = seat.answerer(REQ(), () => Promise.resolve('unavailable'));
  assert.equal(await decision, 'denied');
  assert.equal(seat.pending().length, 0, 'nothing waits forever');
});

test('ask_human: petition-shaped — the reply becomes the tool result; the timeout is the honest no-answer', async () => {
  const ctx = stubCtx();
  const seat = mountHumanSeat(ctx, { questionTimeoutMs: 25_000 });
  const pendingResult = seat.tool.execute(
    { question: 'ship the digest with the pending escalation named, or hold for the fix?', options: 'ship, hold', context: 'the digest is due' },
    { agent: { id: 'community-editor' } },
  );
  const pending = seat.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'question');
  assert.equal(pending[0].by, 'community-editor');
  const record = seat.replyQuestion(pending[0].id, 'ship it, and name the escalation in the digest');
  assert.ok(record);
  const out = await pendingResult;
  assert.match(out, /The Principal answered:/);
  assert.match(out, /ship it, and name the escalation/);
  // the timeout path
  const slow = mountHumanSeat(stubCtx(), { questionTimeoutMs: 30 });
  const timedOut = await slow.tool.execute({ question: 'anyone there?' }, { agent: { id: 'x' } });
  assert.match(timedOut, /No answer within 0s — the honest no-answer/);
});

test('the observatory: page behind the boot token, state, SSE replay, and the intervention endpoints', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'observatory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = stubCtx();
  const seat = mountHumanSeat(ctx, { askTimeoutMs: 60_000 });
  const obs = await startObservatory(ctx, { humanSeat: seat, port: 0, charterName: 'newsroom' });
  t.after(() => obs.close());

  // the token gates everything but the uninformative landing page
  const landing = await fetch(`http://127.0.0.1:${obs.server.address().port}/`);
  assert.match(await landing.text(), /carries the boot token/);
  const noToken = await fetch(`http://127.0.0.1:${obs.server.address().port}/state`);
  assert.equal(noToken.status, 404);
  const wrongToken = await fetch(`http://127.0.0.1:${obs.server.address().port}/deadbeef/state`);
  assert.equal(wrongToken.status, 404);

  // the page itself
  const page = await fetch(obs.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /community observatory — newsroom/);

  // SSE: hello, then a published forum post, then a replayed reconnect
  const es1 = await fetch(`${obs.url}events`);
  const reader = es1.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const readFrame = async () => {
    for (;;) {
      const nl = buf.indexOf('\n\n');
      if (nl !== -1) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const data = frame.split('\n').find((l) => l.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
        continue;
      }
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 500)),
      ]);
      if (done) throw new Error('stream closed early');
      if (value) buf += dec.decode(value);
    }
  };
  const hello = await readFrame();
  assert.equal(hello.type, 'hello');
  obs.publish({ type: 'forum-post', id: 'fp_1', topic: 'nightly-digest', by: 'community-editor', text: 'the line is set' });
  const post = await readFrame();
  assert.equal(post.type, 'forum-post');
  assert.equal(post.by, 'community-editor');
  await reader.cancel();

  // the full loop: an ask posed → visible in /state → answered from the
  // page's endpoint → the decision the answerer returns
  const decision = seat.answerer(REQ(), () => Promise.resolve('unavailable'));
  const state = await (await fetch(`${obs.url}state`)).json();
  assert.equal(state.pending.length, 1);
  assert.equal(state.charterName, 'newsroom');
  const answer = await fetch(`${obs.url}answer/${state.pending[0].id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal(answer.status, 200);
  assert.equal(await decision, 'allowed-once');
  // a replayed page would see the decided event in history
  const replay = await fetch(`${obs.url}events`);
  const r2 = replay.body.getReader();
  buf = '';
  let sawDecided = false;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !sawDecided) {
    const { value } = await Promise.race([
      r2.read(),
      new Promise((r) => setTimeout(() => r({ value: undefined }), 200)),
    ]);
    if (value) {
      buf += dec.decode(value);
      let nl;
      while ((nl = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const data = frame.split('\n').find((l) => l.startsWith('data: '));
        if (data && JSON.parse(data.slice(6)).type === 'ask-decided') sawDecided = true;
      }
    }
  }
  await r2.cancel();
  assert.ok(sawDecided, 'a reconnecting page replays what it missed');

  // the question endpoint round-trips into the tool result
  const pendingReply = seat.tool.execute({ question: 'hold or ship?' }, { agent: { id: 'community-editor' } });
  const q = (await (await fetch(`${obs.url}state`)).json()).pending.find((p) => p.kind === 'question');
  const reply = await fetch(`${obs.url}reply/${q.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hold for the fix' }),
  });
  assert.equal(reply.status, 200);
  assert.match(await pendingReply, /hold for the fix/);
  const badReply = await fetch(`${obs.url}reply/hum_999`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }),
  });
  assert.equal(badReply.status, 404);
});

test('the observatory refuses to become a network service', async () => {
  await assert.rejects(
    async () => startObservatory(stubCtx(), { humanSeat: mountHumanSeat(stubCtx()), host: '0.0.0.0' }),
    /refusing to bind 0\.0\.0\.0 — the page is loopback-only/,
  );
});

test('charter escalation: patterns compile, patience has a floor, unknown keys refuse', () => {
  const base = { name: 'c', goal: 'a goal long enough to matter here', members: [{ id: 'm', persona: 'works on it' }] };
  const c = validateCharter({ ...base, escalation: { criticalPatterns: ['destructive', 'external.*payment'], askTimeoutMs: 5000 } });
  assert.deepEqual(c.escalation.criticalPatterns, ['destructive', 'external.*payment']);
  assert.equal(c.escalation.askTimeoutMs, 5000);
  assert.throws(() => validateCharter({ ...base, escalation: { criticalPatterns: ['([unclosed'] } }), /does not compile/);
  assert.throws(() => validateCharter({ ...base, escalation: { askTimeoutMs: 10 } }), /at least a second/);
  assert.throws(() => validateCharter({ ...base, escalation: { quorum: 2 } }), /unknown key/);
});
