// The deciding preview is the one surface where raw command text reaches a
// human — it must carry the command's shape, never its embedded credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { redactEmbeddedSecrets } from '../src/index.js';

test('authorization header values are masked in place, the header name survives', () => {
  assert.equal(
    redactEmbeddedSecrets("curl -H 'Authorization: Bearer sk-live-abc123' https://api.example.com"),
    "curl -H 'Authorization: ***' https://api.example.com",
  );
});

test('credential-shaped env-var assignments are masked; ordinary assignments survive', () => {
  assert.equal(redactEmbeddedSecrets('GITHUB_TOKEN=ghp_abc123 npm publish'), 'GITHUB_TOKEN=*** npm publish');
  assert.equal(redactEmbeddedSecrets('API_KEY=xyz curl https://h.example'), 'API_KEY=*** curl https://h.example');
  assert.equal(redactEmbeddedSecrets('DEBUG=1 npm test'), 'DEBUG=1 npm test', 'non-credential assignments are untouched');
});

test('URL query secrets and userinfo are masked; plain queries survive', () => {
  assert.equal(
    redactEmbeddedSecrets('curl https://user:secret@private.example/x'),
    'curl https://***@private.example/x', 'userinfo is masked');
  assert.equal(
    redactEmbeddedSecrets('curl https://h.example/api?token=abc123&x=1'),
    'curl https://h.example/api?token=***&x=1');
  assert.equal(
    redactEmbeddedSecrets('curl https://h.example/api?page=2'),
    'curl https://h.example/api?page=2', 'non-credential query params are untouched');
  // KNOWN RESIDUAL (issue #8, G3): a credential embedded in the URL PATH
  // survives in the operator preview — path stripping is grant semantics,
  // a decision filed, not slipped into a regex
  assert.equal(
    redactEmbeddedSecrets('curl "https://hooks.example.com/services/T00/B00/SECRET"'),
    'curl "https://hooks.example.com/services/T00/B00/SECRET"');
});

test('sk- tokens and PEM private-key blocks are masked', () => {
  assert.equal(redactEmbeddedSecrets('echo sk-proj-abcdefgh12345'), 'echo sk-***');
  assert.match(
    redactEmbeddedSecrets('cat <<EOF\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\nEOF'),
    /\*\*\*private-key\*\*\*/);
});

test('ordinary identifiers survive — no shape-based fallback beyond PEM', () => {
  const text = 'verify sha256-e3b0c44298fc1c149afbf4c8996fb924 hook-9f86d081884c7d65';
  assert.equal(redactEmbeddedSecrets(text), text, 'a masked digest would be worse than a visible one');
});
