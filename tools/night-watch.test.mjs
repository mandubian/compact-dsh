// Night watch (slice 2a) — the policy table and the appointed answerer.
// The watch's whole judgment surface is decideEdge: policy + card → verdict
// + motivation. Everything downstream (claim on the view, mint-nothing,
// note attribution) is the recorded answerer's law, tested in
// packages/approval/test/night-watch.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideEdge, nightWatchAnswerer } from './night-watch.mjs';

const CARD = (over = {}) => ({
  kind: 'params-edge', grantId: 'sg_test1234',
  allowed: ['q'], current: ['page', 'q'], refused: ['page'], credential: [],
  ...over,
});

test('decideEdge: escalate answers nothing — the empty chair stays empty', () => {
  const d = decideEdge('escalate', CARD());
  assert.equal(d.verdict, 'escalate');
  assert.match(d.motivation, /no one is deciding in the operator's absence/);
});

test('decideEdge: deny refuses every edge, naming the row and the axis', () => {
  const d = decideEdge('deny', CARD());
  assert.equal(d.verdict, 'deny');
  assert.match(d.motivation, /the row covers this route; its axis refused \(page\)/);
  assert.match(d.motivation, /refuses every edge ask/);
});

test('decideEdge: allow-edges admits a non-credential edge under the row\'s terms', () => {
  const d = decideEdge('allow-edges', CARD());
  assert.equal(d.verdict, 'allow');
  assert.match(d.motivation, /admits the act under the row's terms/);
});

test('decideEdge: the credential floor beats allow-edges — the watch never admits a key-shaped name', () => {
  const d = decideEdge('allow-edges', CARD({ credential: ['api_key'], refused: ['page', 'api_key'] }));
  assert.equal(d.verdict, 'deny', '#176: no axis admits credential-shaped parameters, by any later judgment');
  assert.match(d.motivation, /credential-shaped parameters \(api_key\) never widen/);
  assert.match(d.motivation, /binds the offers, the commands, and the watch alike/);
});

test('decideEdge: an unknown policy escalates (fail-closed), never answers', () => {
  assert.equal(decideEdge('banana', CARD()).verdict, 'escalate');
});

function fakeCtx() {
  const listeners = [];
  return {
    listeners,
    on(name, fn) { listeners.push(fn); },
    get() { return { deciding: this.deciding ?? new Map() }; },
  };
}

const REQ = (callId) => ({ toolName: 'net.fetch', callId, agent: { id: 'sess-nw' } });

test('answerer: jurisdiction is params-edge only — anything else delegates untouched', async () => {
  const ctx = fakeCtx();
  nightWatchAnswerer(ctx, { policy: 'allow-edges', output: { write() {} } });
  const watch = ctx.listeners[0];
  let reachedTail = false;
  const tail = async () => { reachedTail = true; return 'unavailable'; };

  // no view at all (not our gate's ask)
  ctx.get = () => ({ deciding: new Map() });
  assert.equal(await watch(REQ('c-none'), tail), 'unavailable');
  assert.ok(reachedTail, 'the watch stayed out of the chain');

  // a view whose card is a different cause (first touch, rephrase, secrets…)
  const deciding = new Map([['c-ft', { cause: { kind: 'first-touch' } }]]);
  ctx.get = () => ({ deciding });
  reachedTail = false;
  assert.equal(await watch(REQ('c-ft'), tail), 'unavailable');
  assert.ok(reachedTail, 'first-touch asks are not the watch\'s to answer');
});

test('answerer: allow-edges claims the verdict on the view and answers allowed-once', async () => {
  const ctx = fakeCtx();
  const written = [];
  nightWatchAnswerer(ctx, { policy: 'allow-edges', output: { write: s => written.push(s) } });
  const watch = ctx.listeners[0];
  const view = { cause: CARD() };
  ctx.get = () => ({ deciding: new Map([['c-allow', view]]) });
  let tailRan = false;
  const outcome = await watch(REQ('c-allow'), async () => { tailRan = true; return 'unavailable'; });
  assert.equal(outcome, 'allowed-once');
  assert.equal(tailRan, false, 'the watch answered; the chain did not fall through');
  assert.deepEqual(view.decider, {
    policy: 'allow-edges',
    motivation: decideEdge('allow-edges', CARD()).motivation,
    grantId: 'sg_test1234',
  }, 'the verdict is claimed on the view — the recorded answerer materializes from THIS');
  assert.match(written.join(''), /\[night-watch\] allowed "net\.fetch" at the params edge \(refused: page\) under grant sg_test1234/);
});

test('answerer: deny claims and answers rejected; escalate delegates without claiming', async () => {
  const ctx = fakeCtx();
  nightWatchAnswerer(ctx, { policy: 'deny', output: { write() {} } });
  const watch = ctx.listeners[0];
  const view = { cause: CARD() };
  ctx.get = () => ({ deciding: new Map([['c-deny', view]]) });
  assert.equal(await watch(REQ('c-deny'), async () => 'unavailable'), 'rejected');
  assert.equal(view.decider.policy, 'deny');

  const ctx2 = fakeCtx();
  nightWatchAnswerer(ctx2, { policy: 'escalate', output: { write() {} } });
  const watch2 = ctx2.listeners[0];
  const view2 = { cause: CARD() };
  ctx2.get = () => ({ deciding: new Map([['c-esc', view2]]) });
  assert.equal(await watch2(REQ('c-esc'), async () => 'unavailable'), 'unavailable');
  assert.equal(view2.decider, undefined, 'escalation claims nothing — the fail-closed speaks for itself');
});

test('answerer: an unknown policy refuses to mount', () => {
  assert.throws(() => nightWatchAnswerer(fakeCtx(), { policy: 'banana' }), /unknown policy/);
});

// ---- the judge member (slice 2b): a model call behind the same contract -----

import { decideEdge as de, judgeEdge, extractVerdictJson, liveNetworkGrants, floorRefusal } from './night-watch.mjs';

const ALLOW_JSON = '{"decision":"allow","motivation":"page is an ordinary pagination parameter of the same kind the pass admits"}';

test('judgeEdge: an allow answer maps to the verdict, motivation carried', async () => {
  const calls = [];
  const d = await judgeEdge(CARD(), async (system, user) => { calls.push({ system, user }); return ALLOW_JSON; });
  assert.equal(d.verdict, 'allow');
  assert.match(d.motivation, /ordinary pagination parameter/);
  assert.equal(calls.length, 1);
  const card = JSON.parse(calls[0].user);
  assert.equal(card.row.id, 'sg_test1234');
  assert.deepEqual(card.row.act.refusedNames, ['page'], 'the card names the refused names — never a value, there are none to give');
});

test('judgeEdge: deny, unsure, malformed, and a thrown call all stay fail-closed', async () => {
  assert.equal((await judgeEdge(CARD(), async () => '{"decision":"deny","motivation":"escalating inside parameters"}')).verdict, 'deny');
  const unsure = await judgeEdge(CARD(), async () => '{"decision":"unsure","motivation":"cannot tell"}');
  assert.equal(unsure.verdict, 'escalate', 'P-2.21: a decider that cannot decide escalates rather than rejects');
  assert.match(unsure.motivation, /^the judge was unsure: cannot tell$/);
  assert.equal((await judgeEdge(CARD(), async () => 'I think allow is fine here')).verdict, 'escalate', 'no JSON, no verdict');
  assert.equal((await judgeEdge(CARD(), async () => '{"decision":"maybe","motivation":"x"}')).verdict, 'escalate', 'out-of-vocabulary escalates');
  assert.equal((await judgeEdge(CARD(), async () => '{"decision":"allow"}')).verdict, 'escalate', 'a motivation-less allow is not a verdict');
  const thrown = await judgeEdge(CARD(), async () => { throw new Error('MISSING_CREDENTIAL: no key'); });
  assert.equal(thrown.verdict, 'escalate');
  assert.match(thrown.motivation, /model call failed/);
});

test('extractVerdictJson: tolerates a reasoning preamble; garbage returns null', () => {
  assert.deepEqual(extractVerdictJson('Let me think…\n{"decision":"deny","motivation":"x"}'), { decision: 'deny', motivation: 'x' });
  assert.equal(extractVerdictJson('no object here'), null);
  assert.equal(extractVerdictJson('{"decision":'), null);
});

test('the floor pre-empts the judge: a credential card is refused without consulting the model', async () => {
  const ctx = fakeCtx();
  const calls = [];
  nightWatchAnswerer(ctx, { policy: 'judge', output: { write() {} }, judge: async (card) => { calls.push(card); return { verdict: 'allow', motivation: 'x' }; } });
  const watch = ctx.listeners[0];
  const view = { cause: CARD({ credential: ['api_key'], refused: ['page', 'api_key'] }) };
  ctx.get = () => ({ deciding: new Map([['c-floor', view]]) });
  const outcome = await watch(REQ('c-floor'), async () => 'unavailable');
  assert.equal(outcome, 'rejected', '#176: the floor refuses before judgment — no axis admits them, by any later judgment');
  assert.equal(calls.length, 0, 'the model was never consulted');
  assert.equal(view.decider.policy, 'judge');
  assert.match(view.decider.motivation, /never widen/);
});

test('answerer judge: an allow claims the verdict under policy judge; unsure delegates', async () => {
  const ctx = fakeCtx();
  nightWatchAnswerer(ctx, { policy: 'judge', output: { write() {} }, judge: async () => ({ verdict: 'allow', motivation: 'within the pass' }) });
  const watch = ctx.listeners[0];
  const view = { cause: CARD() };
  ctx.get = () => ({ deciding: new Map([['c-j', view]]) });
  assert.equal(await watch(REQ('c-j'), async () => 'unavailable'), 'allowed-once');
  assert.deepEqual(view.decider, { policy: 'judge', motivation: 'within the pass', grantId: 'sg_test1234' });

  const ctx2 = fakeCtx();
  nightWatchAnswerer(ctx2, { policy: 'judge', output: { write() {} }, judge: async () => ({ verdict: 'unsure', motivation: 'cannot tell' }) });
  const view2 = { cause: CARD() };
  ctx2.get = () => ({ deciding: new Map([['c-u', view2]]) });
  assert.equal(await ctx2.listeners[0](REQ('c-u'), async () => 'unavailable'), 'unavailable');
  assert.equal(view2.decider, undefined, 'an escalation claims nothing');
});

test('policy judge without a composed judge refuses to mount; decideEdge declines it', () => {
  assert.throws(() => nightWatchAnswerer(fakeCtx(), { policy: 'judge' }), /needs a composed judge/);
  assert.equal(de('judge', CARD()).verdict, 'escalate');
});

test('liveNetworkGrants: the #182 fact — live network rows only', () => {
  const approval = { store: { sessionGrants: [
    { id: 'sg_live', pattern: { kind: 'UrlPrefix', value: 'https://h/' }, expiresAt: Date.now() + 60_000 },
    { id: 'sg_expired', pattern: { kind: 'ExactHost', value: 'e' }, expiresAt: Date.now() - 1 },
    { id: 'sg_revoked', pattern: { kind: 'HostAndPort', value: { host: 'r', port: '443' } }, revokedAt: Date.now() },
    { id: 'sg_mount', pattern: { kind: 'PathPrefix', value: { path: '/w', ceiling: 'ro' } }, expiresAt: Date.now() + 60_000 },
  ] } };
  const live = liveNetworkGrants(approval);
  assert.deepEqual(live.map(g => g.id), ['sg_live'], 'expired, revoked, and non-network (mount) rows are not live network coverage');
  assert.equal(floorRefusal(CARD()), null, 'no credential, no floor');
  assert.equal(floorRefusal(CARD({ credential: ['token'] })).verdict, 'deny');
});
