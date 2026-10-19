// The operator's hand on the engine (#229), tested against a FAKE agent
// loop — no model, no docker: pause idles between turns, graceful stop
// drains and ends with its reason, immediate stop cancels the in-flight
// agent, and the divergence counters pause the run themselves.
import test from 'node:test';
import assert from 'node:assert/strict';

import { runCommunity, createRunControls } from '../src/engine.js';
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
