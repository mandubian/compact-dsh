// Contract test against the verified dsh waterfall + cordis export shape:
// pass = return next(); deny = return {kind:'deny', reason} without next().
// Exports follow the dsh plugin convention: name / inject / apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../src/index.js';

function boot(allowlist) {
  const registered = {};
  let nextCalled = 0;
  const ctx = { on: (name, fn) => { registered[name] = fn; } };
  mod.apply(ctx, { allowlist });
  const run = (exec) => registered['tools/pre-execute'](exec, async () => { nextCalled++; return { kind: 'allow' }; });
  return { run, wasNextCalled: () => nextCalled > 0 };
}

test('exports the cordis contract: name, inject, apply', () => {
  assert.equal(mod.name, 'compact-allowlist-gate');
  assert.deepEqual(mod.inject, ['tools']);
  assert.equal(typeof mod.apply, 'function');
});

test('waterfall: covered host delegates to next() and passes its allow through', async () => {
  const { run, wasNextCalled } = boot(['api.example.com']);
  const out = await run({ name: 'net.fetch', arguments: { host: 'api.example.com' } });
  assert.deepEqual(out, { kind: 'allow' });
  assert.ok(wasNextCalled(), 'pass must delegate down the waterfall');
});

test('waterfall: uncovered host is denied without calling next()', async () => {
  const { run, wasNextCalled } = boot(['api.example.com']);
  const out = await run({ name: 'net.fetch', arguments: { host: 'evil.example' } });
  assert.equal(out.kind, 'deny');
  assert.ok(out.reason.includes('[AG-1]'));
  assert.ok(out.reason.includes('Lawful next moves'));
  assert.ok(!wasNextCalled(), 'a denial must not continue the waterfall');
});

test('waterfall: non-network tools pass through untouched', async () => {
  const { run } = boot(['api.example.com']);
  const out = await run({ name: 'fs.read', arguments: { path: '/x' } });
  assert.deepEqual(out, { kind: 'allow' });
});
