// The leak detector is the second layer of the secret posture: prevention
// upstream, detection at the boundary, alteration never. It uses the same
// catalogue as the operator-preview masking, in detect mode — the two can
// never disagree about what a secret is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialShapeIn } from '../src/index.js';

test('credential shapes in arguments and results are detected', () => {
  assert.equal(credentialShapeIn({ command: "curl -H 'Authorization: Bearer abc' https://x" }), true);
  assert.equal(credentialShapeIn({ stdout: 'GITHUB_TOKEN=ghp_1234567890' }), true);
  assert.equal(credentialShapeIn('token=abc123'), true);
  assert.equal(credentialShapeIn('-----BEGIN RSA PRIVATE KEY-----'), true);
});

test('ordinary content is not a finding — no shape-based false positives', () => {
  assert.equal(credentialShapeIn({ command: 'ls -la && which curl' }), false);
  assert.equal(credentialShapeIn('sha256-e3b0c44298fc1c149afbf4c8996fb924'), false);
  assert.equal(credentialShapeIn({ stdout: 'total 0\ndrwxr-xr-x 2 user user 40 Sep 19 12:00 .' }), false);
  assert.equal(credentialShapeIn({}), false);
  assert.equal(credentialShapeIn(undefined), false);
  assert.equal(credentialShapeIn({ circular: null }), false, 'unserializable values detect as nothing rather than throwing');
});
