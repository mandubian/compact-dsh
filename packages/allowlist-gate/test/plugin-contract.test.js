// Contract test for the dsh-facing surface: the plugin registers exactly one
// listener and returns Compact-shaped envelopes on denial. Runs without dsh —
// the ctx is a minimal stub honoring the register/on contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowlistGate } from '../src/index.js';

test('plugin registers on tools/pre-execute and denies uncovered hosts', () => {
  const registered = {};
  const ctx = { on: (name, fn) => { registered[name] = fn; } };
  allowlistGate({ allowlist: ['api.example.com'] })(ctx);
  assert.ok(registered['tools/pre-execute'], 'gate did not register on tools/pre-execute');
  const out = registered['tools/pre-execute']({ tool: 'net.fetch', args: { host: 'evil.example' } });
  assert.equal(out.kind, 'deny');
  assert.ok(out.reason.includes('[AG-1]'));
  assert.ok(out.lawfulNextMoves.length >= 1);
});

test('plugin passes through covered hosts and non-network tools', () => {
  const registered = {};
  const ctx = { on: (name, fn) => { registered[name] = fn; } };
  allowlistGate({ allowlist: ['api.example.com'] })(ctx);
  assert.equal(registered['tools/pre-execute']({ tool: 'net.fetch', args: { host: 'api.example.com' } }), undefined);
  assert.equal(registered['tools/pre-execute']({ tool: 'fs.read', args: { path: '/x' } }), undefined);
});
