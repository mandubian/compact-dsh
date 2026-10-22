// The operator's hand on the engine (#229), tested against a FAKE agent
// loop — no model, no docker: pause idles between turns, graceful stop
// drains and ends with its reason, immediate stop cancels the in-flight
// agent, and the divergence counters pause the run themselves.
import test from 'node:test';
import assert from 'node:assert/strict';

import { runCommunity, createRunControls, createDivergenceCounters } from '../src/engine.js';
import { validateCharter } from '../src/charter.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHARTER = () => validateCharter({
  name: 'controls-test',
  goal: 'a goal long enough to matter for this run of the fake loop',
  budgets: { rounds: 4, maxTurnsPerAgent: 8, wallClockMinutes: 5, tokenCap: 100000 },
  members: [
    { id: 'alpha', persona: 'works in turns, speaks when it has something' },
    { id: 'beta', persona: 'works in turns, speaks when it has something' },
  ],
});

/** A fake runtime: agents whose `whenIdle` takes a bounded tick, counts
 *  its turns, and can be cancelled mid-flight. */
function fakeCtx({ turnMs = 15 } = {}) {
  const forum = { posts: [], read: () => [] };
  const agents = [];
  const services = new Map([
    ['compact-forum', { forum }],
    ['compact-judicature', { docket: () => [] }],
    ['sessions', { flush: async () => true }],
    ['agents', {
      create: async ({ sessionId }) => {
        const agent = {
          id: sessionId, session: { id: sessionId }, cancelled: 0, turns: 0,
          followup() { this.turns += 1; },
          async whenIdle() { await sleep(turnMs); },
          cancel() { this.cancelled += 1; this._cancelledNow = true; },
        };
        agents.push(agent);
        return { agent };
      },
    }],
  ]);
  const ctx = { get: (n) => services.get(n) };
  ctx.agentDefaultModel = { currentSelection: () => ({ provider: 'fake', model: 'fake-1' }) };
  ctx.agents = agents;
  ctx.forum = forum;
  return ctx;
}

test('controls: the pure state machine — pause/resume/stop transitions', () => {
  const c = createRunControls();
  assert.deepEqual(c.state(), { paused: false, stopMode: null });
  c.pause();
  assert.equal(c.state().paused, true);
  c.resume();
  assert.equal(c.state().paused, false);
  c.stop('graceful');
  assert.equal(c.state().stopMode, 'graceful');
  c.stop('now');
  assert.equal(c.state().stopMode, 'now', 'stop is idempotent upward');
  c.stop('nonsense');
  assert.equal(c.state().stopMode, 'graceful', 'an unknown mode reads as graceful (fail-safe)');
});

test('engine pause: the current turn drains, nothing new starts, resume continues (#229)', async () => {
  const ctx = fakeCtx();
  const controls = createRunControls();
  const run = runCommunity(ctx, { charter: CHARTER(), workspace: '/w', controls });
  // let the first turns happen, then pause mid-run
  await sleep(60);
  const turnsAtPause = ctx.agents.reduce((n, a) => n + a.turns, 0);
  controls.pause();
  await sleep(120);
  const turnsWhilePaused = ctx.agents.reduce((n, a) => n + a.turns, 0);
  assert.equal(turnsWhilePaused, turnsAtPause, 'a paused community starts nothing new');
  controls.resume();
  const stats = await run;
  assert.equal(stats.endReason, 'rounds complete');
  assert.ok(stats.turns > turnsAtPause, 'the community continued after the resume');
});

test('engine graceful stop: the current turn drains, the run ends with its reason (#229)', async () => {
  const ctx = fakeCtx();
  const controls = createRunControls();
  const run = runCommunity(ctx, { charter: CHARTER(), workspace: '/w', controls });
  await sleep(60);
  controls.stop('graceful');
  const stats = await run;
  assert.equal(stats.endReason, 'stopped by the operator (graceful)');
  assert.ok(stats.turns >= 1, 'it ran before it was stopped');
});

test('engine immediate stop: the in-flight agent is CANCELLED, the run ends with its reason (#229)', async () => {
  const ctx = fakeCtx({ turnMs: 500 });
  const controls = createRunControls();
  const run = runCommunity(ctx, { charter: CHARTER(), workspace: '/w', controls });
  await sleep(120); // a turn is in flight (500ms ticks)
  controls.stopNow();
  const started = Date.now();
  const stats = await run;
  assert.ok(Date.now() - started < 400, 'the cancel cut the wait short (a 500ms tick did not have to finish)');
  assert.equal(stats.endReason, 'stopped by the operator (immediate)');
  assert.ok(ctx.agents.some((a) => a.cancelled > 0), 'the loop cancel was the knife, not a flag poll');
});

test('the run records the model route it seated each member on — provenance, not vibes', async () => {
  const ctx = fakeCtx();
  const stats = await runCommunity(ctx, { charter: CHARTER(), workspace: '/w' });
  assert.equal(stats.endReason, 'rounds complete');
  assert.deepEqual(stats.model, {
    provider: 'fake',
    model: 'fake-1',
    members: { alpha: 'fake/fake-1', beta: 'fake/fake-1' },
  }, 'the manifest names the model each member actually spoke with, member by member');
});

test('headless divergence: the notice lane counts without a page, and the engine pauses', async () => {
  let sink = null;
  const fence = createDivergenceCounters({ setNoticeSink: (fn) => { sink = fn; } });
  for (let i = 0; i < 3; i += 1) sink({ kind: 'compact-loopguard', summary: 'LoopGuard LG-2 identical retry' });
  assert.equal(fence.counters.loopguardTrips(), 3, 'the notice lane counts with no observatory and no publisher');
  assert.equal(fence.counters.humanSeatTimeouts(), 0);
  fence.humanSeatTimedOut();
  assert.equal(fence.counters.humanSeatTimeouts(), 1);

  const ctx = fakeCtx();
  const controls = createRunControls();
  const autoPause = [];
  let pausedResolve;
  const paused = new Promise((resolve) => { pausedResolve = resolve; });
  const run = runCommunity(ctx, {
    charter: validateCharter({ ...CHARTER(), divergence: { loopguardTrips: 3 } }),
    workspace: '/w', controls,
    divergenceCounters: fence.counters,
    hooks: { onAutoPause: (info) => { autoPause.push(info); pausedResolve(info); } },
  });
  const info = await Promise.race([paused, sleep(1000).then(() => null)]);
  assert.ok(info, 'the run paused itself with no page open');
  assert.match(info.why, /loopguard trips 3 ≥ 3/);
  assert.equal(controls.state().paused, true);
  controls.resume();
  const stats = await run;
  assert.equal(stats.endReason, 'rounds complete');
  assert.equal(autoPause.length, 1);
});

test('engine auto-pause: the divergence counters pause the run themselves (#229)', async () => {
  const ctx = fakeCtx();
  const controls = createRunControls();
  const autoPause = [];
  let trips = 0;
  const run = runCommunity(ctx, {
    charter: validateCharter({ ...JSON.parse(JSON.stringify({ name: 'd', goal: 'a goal long enough to matter here', members: [{ id: 'alpha', persona: 'works in turns, speaks when it has something' }] })), budgets: { rounds: 4, maxTurnsPerAgent: 8, wallClockMinutes: 5, tokenCap: 100000 }, divergence: { loopguardTrips: 3 } }),
    workspace: '/w', controls,
    divergenceCounters: { loopguardTrips: () => trips, humanSeatTimeouts: () => 0 },
    hooks: { onAutoPause: (info) => autoPause.push(info) },
  });
  await sleep(60);
  trips = 3; // the fence is crossed mid-run
  const stats = await run;
  assert.equal(stats.endReason, 'rounds complete', 'auto-pause pauses; it does not end the run');
  assert.equal(autoPause.length, 1);
  assert.match(autoPause[0].why, /loopguard trips 3 ≥ 3/);
  // and the operator's resume is what lets it finish
  await sleep(50);
  controls.resume();
  await run;
});

test('engine auto-STOP: divergence.headless stop ends the run with the fence\'s own reason, not the operator\'s (#235 follow-up)', async () => {
  const ctx = fakeCtx();
  const controls = createRunControls();
  const autoPause = [];
  const charter = validateCharter({
    name: 'd', goal: 'a goal long enough to matter here',
    budgets: { rounds: 4, maxTurnsPerAgent: 8, wallClockMinutes: 5, tokenCap: 100000 },
    members: [{ id: 'alpha', persona: 'works in turns, speaks when it has something' }],
    divergence: { loopguardTrips: 2, headless: 'stop' },
  });
  const stats = await runCommunity(ctx, {
    charter, workspace: '/w', controls,
    divergenceCounters: { loopguardTrips: () => 2, humanSeatTimeouts: () => 0 },
    hooks: { onAutoPause: (info) => autoPause.push(info) },
  });
  assert.match(stats.endReason, /auto-stopped \(divergence: loopguard trips 2 ≥ 2\)/);
  assert.notEqual(stats.endReason, 'stopped by the operator (graceful)', 'the fence acted — the reason says so');
  assert.equal(autoPause[0].action, 'stopped');
});

test('engine bench blind spot: the hand reaches the bench loop — stop mid-wakes ends the run (#235 follow-up)', async () => {
  const ctx = fakeCtx();
  // a docket of 40 live cases and a bench member: without the in-bench
  // check, all 40 wakes would run to completion before any stop check
  ctx.get('compact-judicature').docket = () =>
    Array.from({ length: 40 }, (_, i) => ({ id: `case_${i}`, judgment: null, grievance: 'g' }));
  const charter = validateCharter({
    name: 'b', goal: 'a goal long enough to matter here',
    budgets: { rounds: 2, maxTurnsPerAgent: 8, wallClockMinutes: 5, tokenCap: 100000 },
    members: [
      { id: 'alpha', persona: 'works in turns, speaks when it has something' },
      { id: 'bench-1', persona: 'a member seated on the bench', bench: true },
    ],
  });
  const controls = createRunControls();
  let wakes = 0;
  const stats = await runCommunity(ctx, {
    charter, workspace: '/w', controls,
    hooks: { onBenchWake: () => { wakes += 1; if (wakes === 10) controls.stop('graceful'); } },
  });
  assert.equal(stats.endReason, 'stopped by the operator (graceful)');
  assert.equal(wakes, 10, 'the stop landed inside the bench loop, not after it');
  assert.equal(stats.casesSeen, 10);
});
