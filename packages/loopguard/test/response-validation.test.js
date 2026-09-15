// Response validation (Phase 3 item 3, stretch): a success without a value
// is structurally invalid — blocked with feedback and counted as a failure
// in the guard's budget. Plugin-contract level: the listener driven directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loopguardPlugin } from '../src/index.js';

function boot(opts = {}) {
  const registered = {};
  const ctx = { on: (name, fn) => { registered[name] = fn; } };
  const instance = loopguardPlugin(opts);
  instance(ctx, opts);
  return {
    postExecute: (exec, result) => registered['tools/post-execute']?.(exec, result, async () => ({ kind: 'accept' })),
    result: (exec, result) => registered['tools/result'](exec, result),
    instance,
  };
}

const AGENT = { id: 's1', session: { id: 's1', header: {} } };
const EXEC = { name: 'flaky.tool', arguments: { x: 1 }, agent: AGENT };

test('a success without a value is blocked and feeds the failure budget', async () => {
  const { postExecute, instance } = boot({});
  for (let i = 0; i < 8; i++) {
    const d = await postExecute(EXEC, { isError: false, value: undefined });
    assert.equal(d.kind, 'block', 'the invalid result is blocked, not accepted');
    assert.ok(d.feedback[0].text.includes('[LG/D-7/invalid-shape]'), 'the feedback carries the envelope');
  }
  const g = instance.loopguard.guardFor('s1');
  assert.equal(g.failuresByTool.get('flaky.tool'), 8, 'invalid successes count as failures — silent no-ops are not progress');
  assert.equal(g.latch?.id, 'LG-8', 'identical invalid shapes are a recurring unrecoverable error (fires before the count budget)');
});

test('a real value passes through untouched (next() accepts)', async () => {
  const { postExecute } = boot({});
  const d = await postExecute(EXEC, { isError: false, value: 'the actual result' });
  assert.deepEqual(d, { kind: 'accept' });
  const d2 = await postExecute(EXEC, { isError: true, error: { message: 'boom' } });
  assert.deepEqual(d2, { kind: 'accept' }, 'errors flow to tools/result accounting, not the shape gate');
});

test('responseValidation: false disables the gate entirely', async () => {
  const { postExecute } = boot({ responseValidation: false });
  assert.equal(postExecute(EXEC, { isError: false, value: undefined }), undefined, 'no post-execute listener is even registered');
});
