import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowlist, extractTarget, decide } from '../src/allowlist.js';
import { denyEnvelope } from '../src/index.js';

test('ExactHost matches bare host, refuses other ports', () => {
  const rules = parseAllowlist(['api.example.com']);
  assert.equal(decide({host:'api.example.com'}, rules).decision, 'allow');
  assert.equal(decide({host:'api.example.com', port:'443'}, rules).decision, 'deny');
  assert.equal(decide({host:'evil.example.com'}, rules).decision, 'deny');
});

test('HostSuffix matches subdomains and the domain itself', () => {
  const rules = parseAllowlist(['*.example.com']);
  assert.equal(decide({host:'api.example.com'}, rules).decision, 'allow');
  assert.equal(decide({host:'example.com'}, rules).decision, 'allow');
  assert.equal(decide({host:'notexample.com'}, rules).decision, 'deny');
});

test('HostAndPort requires both', () => {
  const rules = parseAllowlist(['api.example.com:443']);
  assert.equal(decide({host:'api.example.com', port:'443'}, rules).decision, 'allow');
  assert.equal(decide({host:'api.example.com', port:'80'}, rules).decision, 'deny');
});

test('UrlPrefix is prefix-anchored', () => {
  const rules = parseAllowlist(['https://api.example.com/v1/']);
  assert.equal(decide({url:'https://api.example.com/v1/users'}, rules).decision, 'allow');
  assert.equal(decide({url:'https://api.example.com/v10/x'}, rules).decision, 'deny');
});

test('calls without a network target abstain, not deny', () => {
  assert.equal(decide({}, parseAllowlist(['api.example.com'])).decision, 'pass');
  assert.equal(decide({host:'anything.example'}, []).decision, 'deny');
});

test('denial envelope carries rule ID, reason, lawful next moves (R-3)', () => {
  const env = denyEnvelope('terminal.exec', {host:'evil.example'});
  assert.ok(env.text.startsWith('[AG/AG-1]'));
  assert.ok(env.text.includes('evil.example'));
  assert.ok(Array.isArray(env.lawfulNextMoves) && env.lawfulNextMoves.length >= 1);
  assert.ok(env.lawfulNextMoves.some(m => /escalate/.test(m)));
});
