// #204 — the cap the clock lacks, enforced IN THE WATERFALL: a
// schedule_create call beyond the cap is denied with a named envelope at
// the same seam every other enforcement rides. No service mutation, no
// ordering constraints — the cap reads the schedule service at call time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.js';

function harness({ active = 0, maxActive } = {}) {
  const provided = [];
  const listeners = {};
  const state = { active };
  const schedule = {
    get active() { return state.active; },
    async list() { return Array.from({ length: state.active }, (_, i) => ({ id: `s${i}`, status: 'active' })); },
  };
  const ctx = {
    get: (key) => key === 'schedule' ? schedule : undefined,
    provide: (key, value) => provided.push([key, value]),
    on: (name, fn) => { listeners[name] = fn; },
  };
  apply(ctx, maxActive !== undefined ? { maxActive } : {});
  return {
    state,
    provided,
    gate: (name, sessionId) => listeners['tools/pre-execute'](
      { name, agent: { session: { id: sessionId ?? 'sess-1' } } },
      async () => ({ kind: 'pass' })),
  };
}

const CREATE = 'schedule_create';

test('under the cap: schedule_create passes', async () => {
  const { gate } = harness({ active: 3, maxActive: 20 });
  const r = await gate(CREATE);
  assert.equal(r.kind, 'pass', '3 of 20 — the clock accepts another arm');
});

test('at the cap: schedule_create is denied with a named envelope', async () => {
  const { gate } = harness({ active: 20, maxActive: 20 });
  const r = await gate(CREATE);
  assert.equal(r.kind, 'deny');
  assert.match(r.reason, /\[SCH\/SCH-1\/cap\]/);
  assert.match(r.reason, /already holds 20 active schedules \(cap 20\)/);
  assert.match(r.reason, /schedule_cancel/, 'the lawful move is on the envelope');
});

test('other tools are never capped; the cap reads live state per call', async () => {
  const h = harness({ active: 20, maxActive: 20 });
  const r = await h.gate('bash');
  assert.equal(r.kind, 'pass', 'only schedule_create is the clock\'s business');
  h.state.active = 5;   // the count is read live per call — a lapsed schedule frees capacity
  assert.equal((await h.gate(CREATE)).kind, 'pass');
});

test('the binding the capability gate reads is provided, with the cap stated', () => {
  const { provided } = harness({ maxActive: 7 });
  assert.deepEqual(provided[0][0], 'compact-dsh-scheduler');
  assert.equal(provided[0][1].maxActive, 7);
});

test('the default cap is 20 when nothing is configured', () => {
  const { provided } = harness({});
  assert.equal(provided[0][1].maxActive, 20);
});
