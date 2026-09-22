// The method class the grant must carry (#26's network half, folded into
// #38): derived by the SAME analysis that finds the target, in the safe
// direction — a false 'write' over-asks (bigger act shown than runs), a false
// 'read' would overclaim consent (the defect #26 names), and an underivable
// command yields null, which materializes no egress grant at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { methodClassOf, createAnalyzer } from '../src/analyzer.js';

test('reader verbs are read-class — the fetch act, however phrased', () => {
  for (const command of [
    'curl -sSL https://api.example.com/v1/data',
    'wget http://mirror.example.org/pkg.tar.gz -O /tmp/p.tgz',
    'git clone https://github.com/mandubian/compact-dsh.git',
    'git fetch --all && git pull origin main',
    'npm install --save lodash',
    'pip install requests',
    'apt-get update && apt-get install -y jq',
    'ping -c 3 8.8.8.8',
    'dig +short example.com',
  ]) {
    assert.equal(methodClassOf({ command }), 'read', command);
  }
});

test('state-changing intent is write-class — never the other way around', () => {
  for (const command of [
    "curl -d 'a=b' https://api.example.com/v1/data",
    'curl --data-raw @payload.json https://api.example.com/v1/data',
    'curl -XPOST https://api.example.com/v1/data',
    'curl --request DELETE https://api.example.com/v1/item/9',
    'curl -F file=@photo.png https://upload.example.com/img',
    'wget --post-data="a=1" https://hooks.example.com/collect',
    'git push origin main',
    'npm publish ./dist',
  ]) {
    assert.equal(methodClassOf({ command }), 'write', command);
  }
});

test('a target static analysis only happened to see gets NO class (D-7)', () => {
  assert.equal(methodClassOf({ command: 'echo https://example.com' }), null,
    'a bare URL literal carries no verb — no class is invented');
  assert.equal(methodClassOf({ command: 'ls -la' }), null);
  assert.equal(methodClassOf({}), null, 'no command argument → no class');
  assert.equal(methodClassOf(undefined), null);
  assert.equal(methodClassOf({ command: '   ' }), null);
});

test('the class follows the command keys the analyzer itself gates', () => {
  assert.equal(methodClassOf({ cmd: 'curl https://example.com' }), 'read', 'cmd is a command key');
  assert.equal(methodClassOf({ script: 'curl -d x https://example.com' }), 'write', 'script is a command key');
  assert.equal(methodClassOf({ commandLine: 'curl https://example.com' }), null, 'an unknown key is not read as a command');
});

test('class claims only where a network finding exists — RA consults it only for gated calls', () => {
  const analyzer = createAnalyzer();
  const gated = analyzer.findings({ name: 'bash', arguments: { command: 'curl https://api.example.com/v1' } });
  assert.ok(gated.length > 0, 'the call the class describes is the call the analyzer gated');
  assert.equal(methodClassOf({ command: 'curl https://api.example.com/v1' }), 'read');
  const ungated = analyzer.findings({ name: 'bash', arguments: { command: 'echo hello' } });
  assert.equal(ungated.length, 0, 'and an ungated command never reaches the class path at all');
});
