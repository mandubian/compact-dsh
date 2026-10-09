// #176 slice 2 — the seat's contract on the recorded answerer's side. The
// watch claims its verdict on the deciding view; THIS file proves what the
// recorded answerer does with a claimed verdict: answers under the row's
// terms (mint-nothing, budget consumed), narrows a lapsed basis to a
// rejection, refuses to materialize a malformed claim, and attributes every
// watch decision on the note the record keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalPlugin, parseAllowlistLikePattern } from '../src/index.js';

const NOW = 1_700_000_000_000;
const agent = (id = 'sess-nw') => ({ id, session: { id, header: {} }, inject() {} });

function boot(opts = {}) {
  const listeners = {};
  const ctx = {
    on: (name, fn) => { (listeners[name] ??= []).push(fn); },
    emit() {}, provide() {},
    waterfall: async (name, req, tail) => listeners[name]?.[0](req, tail),
  };
  const inst = approvalPlugin(opts);
  inst(ctx, {});
  return { ctx, approval: inst.approval };
}

/** Gate an edge ask, then run the waterfall with a downstream "watch" that
 *  may mutate the view (as tools/night-watch.mjs does) before answering. */
async function decide(ctx, approval, { args, callId, watch, outcome = 'allowed-once' }) {
  const ag = agent();
  const gated = approval.gate({ name: 'net.fetch', arguments: args, agent: ag, callId });
  if (gated?.kind !== 'ask') return { gated };
  const outcomeResult = await ctx.waterfall(
    'approval/request',
    { toolName: 'net.fetch', agent: ag, callId, reason: gated.reason },
    async () => {
      const view = approval.deciding.get(String(callId));
      if (view && watch) watch(view);
      return outcome;
    },
  );
  return { gated, outcome: outcomeResult };
}

const GRANT = (approval, over = {}) => approval.grantSession({
  pattern: parseAllowlistLikePattern('https://api.example.com/v1/?q=x'),
  root: 'sess-nw', session: 'sess-nw', ttlMs: 3_600_000, methodClass: 'read', ...over,
});

const EDGE = { url: 'https://api.example.com/v1/search?q=dogs&page=2', methodClass: 'read' };

test('card: the deciding view carries the params-edge cause — the watch\'s whole context', async () => {
  const { ctx, approval } = boot({});
  GRANT(approval);
  let seen = null;
  await decide(ctx, approval, { args: EDGE, callId: 'c-card', watch: v => { seen = v; } });
  assert.equal(seen.cause.kind, 'params-edge');
  assert.match(seen.cause.grantId, /^sg_/);
  assert.deepEqual(seen.cause.allowed, ['q']);
  assert.deepEqual(seen.cause.refused, ['page']);
  assert.deepEqual(seen.cause.credential, []);
});

test('mint-nothing: a watch allow consumes the row\'s budget and materializes NOTHING else', async () => {
  const { ctx, approval } = boot({});
  const g = GRANT(approval, { maxUses: 2 });
  const injected = [];
  const ag = { id: 'sess-nw', session: { id: 'sess-nw', header: {} }, inject: m => injected.push(m) };
  const gated = approval.gate({ name: 'net.fetch', arguments: EDGE, agent: ag, callId: 'c-mint' });
  const outcome = await ctx.waterfall('approval/request',
    { toolName: 'net.fetch', agent: ag, callId: 'c-mint', reason: gated.reason },
    async () => {
      approval.deciding.get('c-mint').decider = { policy: 'allow-edges', motivation: 'the appointed policy admits the act under the row\'s terms', grantId: g.id };
      return 'allowed-once';
    });
  assert.equal(outcome, 'allowed-once');
  assert.equal(approval.store.cache.size, 0, 'no exec-cache entry — the identical op asks again');
  assert.equal(approval.store.sessionGrants.length, 1, 'no new row — only the row that answered');
  assert.equal(g.uses, 1, 'the row\'s budget paid for the act');
  // a second edge consumes again; the spent row stops answering
  assert.equal(approval.evaluate({ tool: 'net.fetch', args: { url: 'https://api.example.com/v1/other?q=1', methodClass: 'read' }, root: 'sess-nw', session: 'sess-nw', now: NOW }).verdict, 'allowed');
  assert.equal(g.uses, 2);
  assert.equal(approval.evaluate({ tool: 'net.fetch', args: { url: 'https://api.example.com/v1/third?q=1&x=2', methodClass: 'read' }, root: 'sess-nw', session: 'sess-nw', now: NOW }).verdict, 'pending-approval', 'the budget spent — the widening stops');
  // and the note says who, under what, and why
  const text = injected[0]?.content?.[0]?.text ?? '';
  assert.match(text, /was allowed by the appointed night watch \(policy: allow-edges\)/);
  assert.match(text, /under grant sg_/);
  assert.match(text, /nothing was materialized/);
  assert.match(text, /Motivation: /);
  assert.equal(injected[0].source?.summary, 'Night watch: "net.fetch" allowed (allow-edges) — under the grant\'s terms');
});

test('lapsed basis: a watch yes on a row that dies mid-decision narrows to a rejection', async () => {
  const { ctx, approval } = boot({});
  const g = GRANT(approval);
  const injected = [];
  const ag = { id: 'sess-nw', session: { id: 'sess-nw', header: {} }, inject: m => injected.push(m) };
  const gated = approval.gate({ name: 'net.fetch', arguments: EDGE, agent: ag, callId: 'c-lapse' });
  const outcome = await ctx.waterfall('approval/request',
    { toolName: 'net.fetch', agent: ag, callId: 'c-lapse', reason: gated.reason },
    async () => {
      approval.deciding.get('c-lapse').decider = { policy: 'allow-edges', motivation: 'x', grantId: g.id };
      approval.revoke(g.id, NOW); // the basis dies between claim and verdict
      return 'allowed-once';
    });
  assert.equal(outcome, 'rejected', 'the recorded answerer may always answer NO to a yes it cannot honor');
  assert.equal(approval.store.cache.size, 0);
  const text = injected[0]?.content?.[0]?.text ?? '';
  assert.match(text, /did not run — the night watch's yes answered under a grant that lapsed/);
  assert.match(text, /narrowed it to a rejection/);
  assert.ok(!text.includes('Motivation:'), 'a lapsed verdict advertises no motivation — there is none to defend');
});

test('malformed claim: an allow with no row is narrowed, never materialized (D-8)', async () => {
  const { ctx, approval } = boot({});
  GRANT(approval);
  const injected = [];
  const ag = { id: 'sess-nw', session: { id: 'sess-nw', header: {} }, inject: m => injected.push(m) };
  const gated = approval.gate({ name: 'net.fetch', arguments: EDGE, agent: ag, callId: 'c-bad' });
  const outcome = await ctx.waterfall('approval/request',
    { toolName: 'net.fetch', agent: ag, callId: 'c-bad', reason: gated.reason },
    async () => {
      approval.deciding.get('c-bad').decider = { policy: 'allow-edges', motivation: 'x' }; // no grantId
      return 'allowed-once';
    });
  assert.equal(outcome, 'rejected', 'a claimed verdict with no basis cannot run as an operator yes');
  assert.equal(approval.store.cache.size, 0, 'nothing materialized');
  assert.match(injected[0]?.content?.[0]?.text ?? '', /did not run — the night watch's yes answered under a grant that lapsed/);
});

test('a watch rejection is attributed with its motivation; escalate claims nothing', async () => {
  const { ctx, approval } = boot({});
  GRANT(approval);
  const injected = [];
  const ag = { id: 'sess-nw', session: { id: 'sess-nw', header: {} }, inject: m => injected.push(m) };

  const gated = approval.gate({ name: 'net.fetch', arguments: EDGE, agent: ag, callId: 'c-deny' });
  await ctx.waterfall('approval/request',
    { toolName: 'net.fetch', agent: ag, callId: 'c-deny', reason: gated.reason },
    async () => {
      approval.deciding.get('c-deny').decider = { policy: 'deny', motivation: 'the appointed policy refuses every edge ask', grantId: approval.store.sessionGrants[0].id };
      return 'rejected';
    });
  const denyNote = injected.at(-1)?.content?.[0]?.text ?? '';
  assert.match(denyNote, /was denied by the appointed night watch \(policy: deny\)/);
  assert.match(denyNote, /Motivation: the appointed policy refuses every edge ask\./);
  assert.equal(injected.at(-1).source?.summary, 'Night watch: "net.fetch" denied (deny) — did not run');

  // escalate: no claim on the view, the operator-shaped fail-closed note
  const gated2 = approval.gate({ name: 'net.fetch', arguments: { url: 'https://api.example.com/v1/second?q=1&x=2', methodClass: 'read' }, agent: ag, callId: 'c-esc' });
  await ctx.waterfall('approval/request',
    { toolName: 'net.fetch', agent: ag, callId: 'c-esc', reason: gated2.reason },
    () => 'unavailable');
  const escNote = injected.at(-1)?.content?.[0]?.text ?? '';
  assert.match(escNote, /closed unavailable/);
  assert.ok(!escNote.includes('night watch'), 'an escalation is not a watch decision — no attribution');
});

test('operator decisions are untouched: a yes without a claim materializes exactly as before', async () => {
  const { ctx, approval } = boot({});
  GRANT(approval);
  await decide(ctx, approval, { args: EDGE, callId: 'c-op', watch: null, outcome: 'allowed-once' });
  assert.equal(approval.store.cache.size, 1, 'the operator path still caches');
  assert.equal(approval.store.sessionGrants[0].uses, 0, 'and does not spend the row');
});
