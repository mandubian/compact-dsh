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
});

test('URL path credentials are masked from the family segment onward (#8 G3)', () => {
  // was pinned as the G3 residual ("a decision filed"); the decision
  // (docs/decision-secret-hygiene.md) splits rendering from identity: the
  // webhook/token path families render masked, the path in fingerprints,
  // grant rows and matching stays exact
  assert.equal(
    redactEmbeddedSecrets('curl "https://hooks.example.com/services/T00/B00/SECRET"'),
    'curl "https://hooks.example.com/services/***"', 'the Slack-shaped webhook path is masked');
  assert.equal(
    redactEmbeddedSecrets('curl https://discord.com/api/webhooks/123456/abc-token'),
    'curl https://discord.com/api/webhooks/***', 'an api-prefixed webhook family is masked');
  assert.equal(
    redactEmbeddedSecrets('curl https://h.example/api/v1/tokens/abcdef123456'),
    'curl https://h.example/api/v1/tokens/***', 'token families mask from the segment onward');
  assert.equal(
    redactEmbeddedSecrets('curl https://h.example/api/v1/items?page=2'),
    'curl https://h.example/api/v1/items?page=2', 'ordinary API paths are untouched');
  assert.equal(
    redactEmbeddedSecrets('git clone https://h.example/repo.git'),
    'git clone https://h.example/repo.git', 'paths without a credential family are untouched');
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
