// Phase 1 slice 3 — grant-store persistence (JSON + fsync, atomic rename).
// Grants, budgets, revocations, and cache entries survive a restart;
// pending-approval bookkeeping deliberately does not. A corrupt store file
// fails the boot loudly — never a silent reset (a silently emptied store
// could resurrect revoked grants).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentGrantStore } from '../src/persist.js';
import { createApproval } from '../src/index.js';
import { coveringGrants } from '../src/grants.js';

const NOW = 1_700_000_000_000;
const T = (tool, args, now = NOW) => ({ tool, args, root: 'root-1', session: 'root-1/w', now });

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'compact-approval-'));
}

test('grants, budgets, revocations, and cache entries survive a restart', () => {
  const dir = freshDir();
  const path = join(dir, 'grants.json');
  const s1 = new PersistentGrantStore(path);
  const kept = s1.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'api.example.com' }, root: 'root-1', ttlMs: 0, maxUses: 3, now: NOW });
  const dead = s1.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'dead.example' }, root: 'root-1', ttlMs: 0, now: NOW });
  s1.revokeSessionGrant(dead.id, NOW + 1);
  s1.cacheSet('fp_cache1', NOW, 60_000, { host: 'api.example.com' });

  const s2 = new PersistentGrantStore(path);
  assert.deepEqual(s2.sessionGrants.map(g => g.id), [kept.id, dead.id]);
  assert.equal(s2.sessionGrants[0].maxUses, 3);
  assert.equal(s2.sessionGrants[0].pattern.value, 'api.example.com');
  assert.equal(s2.sessionGrants[1].revokedAt, NOW + 1, 'revocation survives — no privilege resurrection');
  assert.equal(s2.cache.get('fp_cache1').expiresAt, NOW + 60_000);
});

test('TTL still bites after a reload (fake clock past expiry)', () => {
  const dir = freshDir();
  const path = join(dir, 'grants.json');
  const s1 = new PersistentGrantStore(path);
  s1.cacheSet('fp_t', NOW, 60_000, { host: 'api.example.com' });
  s1.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'api.example.com' }, root: 'root-1', ttlMs: 1_000, now: NOW });
  const s2 = new PersistentGrantStore(path);
  assert.equal(s2.cacheHit('fp_t', NOW + 61_000), false, 'expired cache entry does not answer');
  assert.deepEqual(coveringGrants(s2, { host: 'api.example.com' }, NOW + 1_001).session, [], 'expired grant does not cover');
  // read-path expiry cleanup is in memory; the next durable mutation flushes it
  s2.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'y.example' }, root: 'r2', ttlMs: 0, now: NOW + 61_000 });
  assert.equal(new PersistentGrantStore(path).cache.has('fp_t'), false, 'the flushed store dropped the expired entry');
});

test('pending-approval bookkeeping never survives a restart', () => {
  const dir = freshDir();
  const path = join(dir, 'grants.json');
  const s1 = new PersistentGrantStore(path);
  s1.recordPending('root-1');
  s1.pending.set('fp_p', { count: 1, firstAt: NOW, root: 'root-1' });
  s1.cacheSet('fp_c', NOW, 60_000);                      // forces a flush
  const s2 = new PersistentGrantStore(path);
  assert.equal(s2.pending.size, 0, 'a restart forgets pending asks (park, not checkpoint)');
  assert.equal(s2.countPending('root-1'), 0, 'flood capacity is fresh');
});

test('a corrupt store file fails the boot loudly, with the reason', () => {
  const dir = freshDir();
  const path = join(dir, 'grants.json');
  writeFileSync(path, '{not json at all');
  assert.throws(() => new PersistentGrantStore(path), /unreadable.*refusing to start/);

  writeFileSync(path, JSON.stringify({ version: 99, sessionGrants: [], planGrants: [], cache: [] }));
  assert.throws(() => new PersistentGrantStore(path), /format version/);

  writeFileSync(path, JSON.stringify({ version: 1, sessionGrants: [{ id: 5 }], planGrants: [], cache: [] }));
  assert.throws(() => new PersistentGrantStore(path), /malformed grant/);
});

test('the plugin restarts into its own memory of approvals', () => {
  const dir = freshDir();
  const path = join(dir, 'grants.json');
  const before = NOW;
  const a1 = createApproval({ persistPath: path, execCacheTtlMs: 60_000 });
  const v1 = a1.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.equal(v1.verdict, 'pending-approval');
  // the operator approves → allowed-once materialized → decided
  a1.store.cacheSet(v1.fingerprint, before + 1, 60_000, { host: 'api.example.com' });
  a1.store.resolvePending('root-1', v1.fingerprint);

  const a2 = createApproval({ persistPath: path, execCacheTtlMs: 60_000 });
  const v2 = a2.evaluate(T('net.fetch', { host: 'api.example.com' }));
  assert.equal(v2.verdict, 'allowed');
  assert.equal(v2.layer, 'exec-cache', 'the approval replay hits across a restart');
  // and it is still the human gate for anything else
  assert.equal(a2.evaluate(T('net.fetch', { host: 'other.example' })).verdict, 'pending-approval');
});

test('flush is atomic: the store directory holds exactly the target file', () => {
  const dir = freshDir();
  const path = join(dir, 'nested', 'grants.json');       // parent dirs are created
  const s = new PersistentGrantStore(path);
  s.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'x.example' }, root: 'r', ttlMs: 0, now: NOW });
  const files = readdirSync(join(dir, 'nested'));
  assert.deepEqual(files, ['grants.json'], 'no tmp residue beside the store');
  assert.ok(readFileSync(path, 'utf8').includes('x.example'));
});
