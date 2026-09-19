// The secret-injection agreement: an approved call that references a declared
// secret materializes a session-scoped grant; the provider resolves the env
// NAME at confine time. The value never appears anywhere in this package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GrantStore } from '../src/grants.js';
import { PersistentGrantStore } from '../src/persist.js';
import { redactEmbeddedSecrets, approvalPlugin } from '../src/index.js';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a secret grant is session-scoped, TTL-bounded and revocable', () => {
  const s = new GrantStore();
  s.addSecretGrant({ ref: 'GH_TOKEN', root: 'r1', session: 's1', ttlMs: 1000, now: 0 });
  assert.deepEqual(s.secretGrantsFor('s1', 500).map(g => g.ref), ['GH_TOKEN']);
  assert.equal(s.secretGrantsFor('s2', 500).length, 0, 'a sibling session is not covered');
  assert.equal(s.secretGrantsFor('s1', 1500).length, 0, 'an expired grant covers nothing');
  const g = s.secretGrants[0];
  s.revokeSecretGrant(g.id, 600);
  assert.equal(s.secretGrantsFor('s1', 700).length, 0, 'revocation ends the injection agreement');
});

test('the grant records the env NAME and nothing else — no value ever lands in the store', () => {
  const s = new GrantStore();
  const g = s.addSecretGrant({ ref: 'GH_TOKEN', root: 'r', session: 's', ttlMs: 1000, now: 0 });
  assert.deepEqual(Object.keys(g).filter(k => /value|secret/i.test(k)), []);
  assert.equal(JSON.stringify(g).includes('ghp_'), false);
});

test('secret grants persist across a restart, refs only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-secret-persist-'));
  const path = join(dir, 'grants.json');
  const a = new PersistentGrantStore(path);
  a.addSecretGrant({ ref: 'GH_TOKEN', root: 'r', session: 's', ttlMs: 60_000, now: Date.now() });
  const b = new PersistentGrantStore(path);
  assert.equal(b.secretGrantsFor('s').length, 1, 'the agreement survives a restart');
  assert.ok(!readFileSync(path, 'utf8').includes('ghp_'), 'no value is on disk');
});

test('a store file carrying a secret VALUE where only a ref belongs refuses to load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-secret-corrupt-'));
  const path = join(dir, 'grants.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    sessionGrants: [], planGrants: [],
    secretGrants: [{ id: 'sec_bad', ref: 'GH_TOKEN', value: 'ghp_supersecret', root: null, session: 's', createdAt: 0, expiresAt: 1, revokedAt: null }],
    cache: [],
  }));
  assert.throws(() => new PersistentGrantStore(path), /malformed secret grant.*refusing to start/);
});

test('the detection catalogue and the injection agreement agree on what a secret is', () => {
  // a leaked value is detectable by the same catalogue that the operator
  // preview masks with — the layers cannot drift apart
  assert.notEqual(redactEmbeddedSecrets('token=ghp_1234567890'), 'token=ghp_1234567890');
});

// -- the agreement flow: gate → operator decision → materialized grant -------

function fakeCtx() {
  const listeners = {};
  return {
    listeners,
    on: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
    inject: () => {},
    provide: () => {},
    emit: () => {},
    logger: { warn() {}, error() {} },
  };
}

const CALL = { command: 'curl -H "Authorization: Bearer $GH_TOKEN" https://api.example.com', url: 'https://api.example.com' };
const AGENT = { id: 's1' };

test('an approved call referencing a declared secret materializes the injection grant', async () => {
  const ctx = fakeCtx();
  const apply = approvalPlugin({ secretRefs: ['GH_TOKEN'] });
  apply(ctx, {});
  const approval = apply.approval;

  const ask = approval.gate({ name: 'bash', arguments: CALL, agent: AGENT, callId: 'c1' });
  assert.equal(ask.kind, 'ask');
  assert.match(ask.reason, /\$GH_TOKEN/, 'the envelope tells the decider what approval will inject');

  const answerer = ctx.listeners['approval/request'][0];
  const outcome = await answerer({ toolName: 'bash', agent: AGENT, callId: 'c1' }, async () => 'allowed-once');
  assert.equal(outcome, 'allowed-once');
  assert.deepEqual(approval.store.secretGrantsFor('s1').map(g => g.ref), ['GH_TOKEN']);
  approval.store.revokeSecretGrant(approval.store.secretGrants[0].id, Date.now());
  assert.deepEqual(approval.store.secretGrantsFor('s1'), [], 'revocation ends the agreement');
});

test('a denial materializes nothing, and undeclared variables stay the Subject\'s own', async () => {
  const ctx = fakeCtx();
  const apply = approvalPlugin({ secretRefs: ['OTHER_TOKEN'] });
  apply(ctx, {});
  const approval = apply.approval;

  const ask = approval.gate({ name: 'bash', arguments: CALL, agent: AGENT, callId: 'c2' });
  assert.doesNotMatch(ask.reason, /\$GH_TOKEN/, 'an undeclared variable is not an injection agreement');
  await answerer(ctx, { toolName: 'bash', agent: AGENT, callId: 'c2' }, 'rejected');
  assert.equal(approval.store.secretGrantsFor('s1').length, 0);

  async function answerer(ctx, req, decision) {
    return ctx.listeners['approval/request'][0](req, async () => decision);
  }
});
