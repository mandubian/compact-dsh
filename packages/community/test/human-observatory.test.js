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

test('the operator endpoints (#229): pause, resume, stop — one controls object shared with the run', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'observatory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = stubCtx();
  const seat = mountHumanSeat(ctx, { askTimeoutMs: 60_000 });
  const controls = { paused: false, stopMode: null, _events: [], pause() { this.paused = true; }, resume() { this.paused = false; }, stop(m) { this.stopMode = m === 'now' ? 'now' : 'graceful'; }, stopNow() { this.stop('now'); }, state() { return { paused: this.paused, stopMode: this.stopMode }; } };
  const obs = await startObservatory(ctx, { humanSeat: seat, controls, port: 0, charterName: 'c' });
  t.after(() => obs.close());
  const post = (p, body) => fetch(`${obs.url}${p.replace(/^\//, '')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  const pause = await (await post('/pause')).json();
  assert.deepEqual(pause.controls, { paused: true, stopMode: null });
  const state = await (await fetch(`${obs.url}state`)).json();
  assert.deepEqual(state.controls, { paused: true, stopMode: null }, 'a freshly opened page sees the pause');
  await post('/resume');
  const stop = await (await post('/stop', { mode: 'now' })).json();
  assert.equal(stop.mode, 'now');
  assert.equal(controls.stopMode, 'now');
  // the feed carried every operator act (bounded read — the stream never ends)
  const es = await fetch(`${obs.url}events`);
  const reader = es.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const seen = new Set();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && seen.size < 3) {
    const { value } = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ value: undefined }), 200)),
    ]);
    if (value) {
      buf += dec.decode(value);
      let nl;
      while ((nl = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const data = frame.split('\n').find((l) => l.startsWith('data: '));
        if (data) seen.add(JSON.parse(data.slice(6)).type);
      }
    }
  }
  await reader.cancel();
  for (const wanted of ['operator-pause', 'operator-resume', 'operator-stop']) {
    assert.ok(seen.has(wanted), `the feed carried ${wanted}`);
  }
  // no controls mounted: the endpoints say so rather than lying
  const bare = await startObservatory(ctx, { humanSeat: mountHumanSeat(stubCtx()), port: 0, charterName: 'c' });
  t.after(() => bare.close());
  const bareResp = await fetch(`${bare.url}pause`, { method: 'POST' });
  assert.equal(bareResp.status, 501);
});

test('the ask card carries the HUMAN facts — who asks, what tool, the command, the target (#233 follow-up)', async () => {
  const ctx = stubCtx();
  // the deciding view as the recorded answerer publishes it: plain facts
  ctx.get('compact-approval').deciding.set('c9', {
    tool: 'bash',
    command: 'curl -sS -X PUT --data-binary @digest/2026-10-21.md http://172.22.0.1:35257/digest/2026-10-21/',
    target: { url: 'http://172.22.0.1:35257/digest/2026-10-21/', host: '172.22.0.1' },
    fingerprint: 'fp_deadbeef',
    cause: { kind: 'first-touch' },
  });
  const seat = mountHumanSeat(ctx, { askTimeoutMs: 60_000 });
  const envelope = '[AG/fp_deadbeef] First touch: nothing has ever covered host=172.22.0.1 in this runtime — no grant row, no cached approval. Approving materializes scoped, expiring coverage.';
  seat.answerer(REQ({ callId: 'c9', toolName: 'bash', agent: { id: 'community-publisher-abc123' }, reason: envelope }), () => Promise.resolve('unavailable'));
  const ask = seat.pending()[0];
  assert.equal(ask.by, 'community-publisher-abc123', 'the card names the member asking');
  assert.equal(ask.tool, 'bash');
  assert.match(ask.command, /curl -sS -X PUT/);
  assert.equal(ask.target.host, '172.22.0.1');
  assert.equal(ask.fingerprint, 'fp_deadbeef');
  // and the verbatim envelope still rides — the record's text, unlost
  assert.match(ask.detail, /First touch: nothing has ever covered/);
  // a view-less ask (the stub paths) still falls back to the request's own facts
  const seat2 = mountHumanSeat(stubCtx(), { askTimeoutMs: 60_000 });
  seat2.answerer(REQ({ toolName: 'web_fetch' }), () => Promise.resolve('unavailable'));
  const fallback = seat2.pending()[0];
  assert.equal(fallback.tool, 'web_fetch');
  assert.equal(fallback.by, 'community-publisher');
  assert.equal(fallback.command, null);
  // settle the pending so the test exits clean
  seat.settleAsk(ask.id, 'deny');
  seat2.settleAsk(fallback.id, 'deny');
});

test('the ask card carries the WHOLE command — the part that caused the ask sat beyond the 240-char preview (live finding)', async () => {
  const ctx = stubCtx();
  // a compound command whose tail holds the act that caused the ask
  const longCommand = "W=/w/digest.md; " + Array.from({ length: 12 }, (_, i) => `echo 'line ${i}' >> $W`).join('; ') +
    "; curl -sS http://404./check";
  assert.ok(longCommand.length > 240, 'the fixture really is preview-truncating');
  ctx.get('compact-approval').deciding.set('c77', {
    tool: 'bash',
    command: longCommand.slice(0, 237) + '…',
    commandFull: longCommand,
    target: { host: '404.' },
    fingerprint: 'fp_tail',
    cause: { kind: 'first-touch' },
  });
  const seat = mountHumanSeat(ctx, { askTimeoutMs: 60_000 });
  seat.answerer(REQ({ callId: 'c77', agent: { id: 'community-editor-41286e' }, reason: '[AG/fp_tail] First touch: nothing has ever covered host=404.' }), () => Promise.resolve('unavailable'));
  const ask = seat.pending()[0];
  assert.match(ask.commandFull, /curl -sS http:\/\/404\.\/check/, 'the nonsense tail is VISIBLE');
  assert.match(ask.command, /…$/, 'the preview stays a preview');
  assert.equal(ask.target.host, '404.');
  seat.settleAsk(ask.id, 'deny');
});

test('the page never fights the human: the 4s poll skips unchanged renders and carries open/typed state across real changes (#239 follow-up)', async () => {
  const { pageHtml } = await import('../src/page.js');
  const html = pageHtml({ charterName: 'x', token: 'tkn' });
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  // the reconciler guard: an unchanged pending set touches nothing
  assert.match(script, /const sig = JSON\.stringify\(p\.map/);
  assert.match(script, /if \(sig === lastPendingSig\) return;/);
  // and a real change carries the human's state across the rebuild
  assert.match(script, /saved\[el\.dataset\.id\] = \{ open: d \? d\.open : false, text: ta \? ta\.value : null \}/);
  assert.match(script, /if \(d && was\.open\) d\.open = true;/);
  assert.match(script, /if \(wasQ\.text != null\) ta\.value = wasQ\.text;/);
  // cards are addressable by their ask/question id
  assert.match(script, /div\.dataset\.id = a\.id;/);
  assert.match(script, /div\.dataset\.id = q\.id;/);
});
