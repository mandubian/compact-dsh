// #102 — the wire teaches the gate: a mediator refusal that proves a route
// dead kills the exec-cache entries routed there, closing the classless-act
// gap (an act whose method class was not derivable materializes NO egress
// grant, so #65's ask-time cap never bounded its cached approval — the entry
// promised 24h over a delivery that rode another approval's one-hour grant).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createApproval, approvalPlugin, fingerprint, GrantStore, PersistentGrantStore,
} from '../src/index.js';

const agent = (id = 'sess-a') => ({ id, session: { id, header: {} } });

const HOUR = 60 * 60 * 1000;

async function boot(posture, downstream = () => 'allowed-once') {
  const { Context } = await import('@deepseek-ai/cordis');
  const decider = {
    name: 'test-decider',
    apply: (c) => c.effect(() => {
      c.on('approval/request', async () => downstream());
    }, 'test-decider: approval waterfall'),
  };
  const ctx = new Context();
  ctx.plugin(decider);
  await new Promise(r => setImmediate(r));
  const inst = approvalPlugin({ egress: posture });
  inst(ctx, { egress: posture });
  return { ctx, inst };
}

async function decide(ctx, req) {
  return ctx.waterfall('approval/request', req, () => 'unavailable');
}

// -- the issue's ground truth, end to end at the gate ------------------------

test('102-a: a classless act caches the full TTL with no grant — and its first no-grant refusal kills the entry', async () => {
  const { ctx, inst } = await boot('proxy');
  const ag = agent('sess-a');
  const args = { url: 'https://api.open-meteo.com/v1/forecast/', host: 'api.open-meteo.com', methodClass: null, delivery: 'mediator' };
  const fp = fingerprint('bash', args);

  const gated = inst.approval.gate({ name: 'bash', arguments: args, agent: ag, callId: 'call-1' });
  assert.equal(gated?.kind, 'ask');
  assert.match(gated.reason, /NO egress grant will materialize/);
  assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: 'call-1', reason: gated.reason }), 'allowed-once');

  // the gap, exactly as the grants-list showed it: a 24h uncapped entry and
  // zero grants of its own — the delivery rode another approval's grant
  const entry = inst.approval.store.cache.get(fp);
  assert.ok(entry, 'the classless approval materialized its exec-cache entry');
  assert.ok(entry.expiresAt - entry.grantedAt > 23 * HOUR, 'UNCAPPED: the full runtime TTL, no #65 cap (the ask said so)');

  // the grant era it rode lapses; the wire refuses; the refusal teaches the gate
  const killed = inst.approval.wireRefusal({ host: 'api.open-meteo.com', port: '443', ruleId: 'no-grant' });
  assert.deepEqual(killed, [fp]);
  assert.equal(inst.approval.store.cache.get(fp), undefined, 'the entry died with the grant era it rode');

  // and the next identical call asks again — the gate no longer says yes
  // over a mediator that says no
  const again = inst.approval.gate({ name: 'bash', arguments: args, agent: ag, callId: 'call-2' });
  assert.equal(again?.kind, 'ask', 'the re-ask is the only lawful way back to a live grant');
});

test('102-b: expiry and revocation refusals heal the cache too — any delivery death', async () => {
  const approval = createApproval({ egress: 'proxy' });
  const t0 = 1_700_000_000_000;
  const fpA = 'fp_aaaaaaaaaaaaaaaa';
  const fpB = 'fp_bbbbbbbbbbbbbbbb';
  approval.store.cacheSet(fpA, t0, 24 * HOUR, { url: 'https://api.example.com/v1/x' });
  approval.store.cacheSet(fpB, t0, 24 * HOUR, { url: 'https://api.example.com/v1/y' });

  assert.deepEqual(approval.wireRefusal({ host: 'api.example.com', port: '443', ruleId: 'expired' }), [fpA, fpB],
    'an expired grant era takes its entries with it');
  approval.store.cacheSet(fpA, t0, 24 * HOUR, { url: 'https://api.example.com/v1/x' });
  assert.deepEqual(approval.wireRefusal({ host: 'api.example.com', port: '443', ruleId: 'revoked' }), [fpA],
    'revocation is a delivery death like any other');
  approval.store.cacheSet(fpA, t0, 24 * HOUR, { url: 'https://api.example.com/v1/x' });
  assert.deepEqual(approval.wireRefusal({ host: 'api.example.com', port: '443', ruleId: 'classless-grant' }),
    [fpA], 'a classless-only rowscape never delivered this route');
});

test('102-c: only proof of death kills — a live route of another class is not a death', () => {
  const approval = createApproval({ egress: 'proxy' });
  const t0 = 1_700_000_000_000;
  const fp = 'fp_aaaaaaaaaaaaaaaa';
  approval.store.cacheSet(fp, t0, 24 * HOUR, { url: 'https://api.example.com/v1/x' });

  for (const ruleId of ['method-class', 'unknown-method', 'malformed', 'use-connect', 'forbidden-address', 'upstream', 'internal', undefined]) {
    assert.deepEqual(approval.wireRefusal({ host: 'api.example.com', port: '443', ruleId }), [],
      `EG/${ruleId} leaves a live route on the table — the entry survives`);
    assert.ok(approval.store.cache.get(fp), `EG/${ruleId}: entry alive`);
  }
});

test('102-c2: a portless-grant refusal (#56) kills only the entries that can ONLY ride a tunnel', () => {
  const approval = createApproval({ egress: 'proxy' });
  const t0 = 1_700_000_000_000;
  const fpTls = 'fp_aaaaaaaaaaaaaaaa';
  const fpHttp = 'fp_bbbbbbbbbbbbbbbb';
  const fpBare = 'fp_cccccccccccccccc';
  approval.store.cacheSet(fpTls, t0, 24 * HOUR, { url: 'https://api.example.com/v1/x' });  // https → CONNECT only
  approval.store.cacheSet(fpHttp, t0, 24 * HOUR, { url: 'http://api.example.com/x' });     // plain HTTP carries under the rows
  approval.store.cacheSet(fpBare, t0, 24 * HOUR, { host: 'api.example.com' });             // delivery unknown → conservative

  assert.deepEqual(approval.wireRefusal({ host: 'api.example.com', port: '443', ruleId: 'portless-grant', tunnel: true }), [fpTls],
    'the CONNECT route is proven dead for the https entry; the others keep their plain-HTTP delivery');
  assert.ok(approval.store.cache.get(fpHttp) && approval.store.cache.get(fpBare));

  assert.deepEqual(approval.wireRefusal({ host: 'api.example.com', port: '443', ruleId: 'no-grant' }), [fpBare],
    'a no-grant proof is unconditional — but only for routes that reach the refused port: the http entry rides :80');
});

// -- route precision: the entry dies with the route it names, no wider -------

test('102-d: a HostAndPort entry dies with its exact host+port — a refusal on another port proves nothing', () => {
  const approval = createApproval({ egress: 'proxy' });
  const t0 = 1_700_000_000_000;
  const fp443 = 'fp_aaaaaaaaaaaaaaaa';
  const fpOther = 'fp_bbbbbbbbbbbbbbbb';
  const fpBare = 'fp_cccccccccccccccc';
  approval.store.cacheSet(fp443, t0, 24 * HOUR, { url: 'https://api.example.com/v1/x' });   // HostAndPort :443
  approval.store.cacheSet(fpOther, t0, 24 * HOUR, { host: 'api.example.com', port: '8443' }); // HostAndPort :8443
  approval.store.cacheSet(fpBare, t0, 24 * HOUR, { host: 'api.example.com' });               // ExactHost

  assert.deepEqual(approval.wireRefusal({ host: 'api.example.com', port: '80', ruleId: 'no-grant' }), [fpBare],
    'the bare-host entry is host-scoped — the mediator reads host scope over ANY port, so it dies with the host');
  assert.ok(approval.store.cache.get(fp443), 'the :443 entry keeps living — a :80 refusal does not prove ITS route dead');
  assert.ok(approval.store.cache.get(fpOther), 'the :8443 entry keeps living');

  assert.deepEqual(approval.wireRefusal({ host: 'other.example', port: '443', ruleId: 'no-grant' }), [],
    'a refusal elsewhere kills nothing here');
  assert.deepEqual(approval.wireRefusal({ host: 'api.example.com', port: '443', ruleId: 'no-grant' }), [fp443]);
});

test('102-e: entries without a derivable route are untouched; a throwing seam never takes the gate down', () => {
  const approval = createApproval({ egress: 'proxy' });
  const t0 = 1_700_000_000_000;
  approval.store.cacheSet('fp_aaaaaaaaaaaaaaaa', t0, 24 * HOUR, null);           // command-aware entry, no target
  approval.store.cacheSet('fp_bbbbbbbbbbbbbbbb', t0, 24 * HOUR, { url: '::::' }); // unparsable
  assert.deepEqual(approval.wireRefusal({ host: 'x.example', port: '443', ruleId: 'no-grant' }), []);
  assert.equal(approval.store.cache.size, 2, 'nothing routable → nothing killed');
  assert.deepEqual(approval.wireRefusal(null), [], 'and the seam never throws on a malformed fact');
});

// -- persistence: a killed entry stays killed ---------------------------------

test('102-f: killCacheForRoute is durable state — the entry cannot resurrect on reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wire-refusal-'));
  try {
    const path = join(dir, 'approvals.json');
    const store = new PersistentGrantStore(path);
    const t0 = 1_700_000_000_000;
    store.cacheSet('fp_aaaaaaaaaaaaaaaa', t0, 24 * HOUR, { url: 'https://api.example.com/v1/x' });
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(raw.cache.length, 1);

    const reloaded = new PersistentGrantStore(path);
    assert.deepEqual(reloaded.killCacheForRoute({ host: 'api.example.com', port: '443' }), ['fp_aaaaaaaaaaaaaaaa']);
    assert.equal(new PersistentGrantStore(path).cache.size, 0, 'the flush landed before the kill returned');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('102-f2: an empty kill pays no flush — the refusal path is hot, the fsync is not (review #103)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wire-refusal-empty-'));
  try {
    const path = join(dir, 'approvals.json');
    const store = new PersistentGrantStore(path);
    store.cacheSet('fp_aaaaaaaaaaaaaaaa', 1_700_000_000_000, 24 * HOUR, { url: 'https://api.example.com/v1/x' });
    let flushes = 0;
    store._flush = () => { flushes += 1; };

    store.killCacheForRoute({ host: 'other.example', port: '443' });
    assert.equal(flushes, 0, 'nothing killed → nothing changed → the store is already correct on disk');
    store.killCacheForRoute({ host: 'api.example.com', port: '443' });
    assert.equal(flushes, 1, 'a real kill flushes — a restart must never resurrect it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -- the #65 cap pins the issue names (unchanged by Option B) ------------------

test('102-g: egress-bound acts keep the #65 cap; classless acts stay uncapped at ask-time (the wire heals); headless keeps the full TTL', () => {
  const mediated = createApproval({ egress: 'proxy' });
  assert.equal(mediated.replayTtlFor({ url: 'https://a.example/x', methodClass: 'read', delivery: 'mediator' }), HOUR,
    'an act that materializes a grant caches no longer than that grant lives (#65)');
  assert.equal(mediated.replayTtlFor({ url: 'https://a.example/x', methodClass: null, delivery: 'mediator' }),
    24 * HOUR, 'no materialized grant → no ask-time cap — Option B bounds it at the wire instead');
  for (const posture of ['none', 'open', undefined]) {
    const headless = createApproval({ egress: posture });
    assert.equal(headless.replayTtlFor({ url: 'https://a.example/x', methodClass: 'read', delivery: 'mediator' }),
      24 * HOUR, `posture ${posture}: the full TTL, no mediator to couple to`);
  }
});

// -- the composed loop: refusal → kill → re-ask → (on approval) a live grant --

test('102-h: after the wire kills the entry, approval re-materializes BOTH the entry and a deliverable grant', async () => {
  const { ctx, inst } = await boot('proxy');
  const ag = agent('sess-a');
  const args = { url: 'https://api.example.com/v1/data', host: 'api.example.com', methodClass: 'read', delivery: 'mediator' };
  const fp = fingerprint('bash', args);

  let gated = inst.approval.gate({ name: 'bash', arguments: args, agent: ag, callId: 'call-1' });
  assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: 'call-1', reason: gated.reason }), 'allowed-once');
  assert.equal(inst.approval.store.sessionGrants.length, 1, 'the act materialized its own grant');

  inst.approval.wireRefusal({ host: 'api.example.com', port: '443', ruleId: 'expired' });
  assert.equal(inst.approval.store.cache.get(fp), undefined, 'the entry died with its grant era');

  gated = inst.approval.gate({ name: 'bash', arguments: args, agent: ag, callId: 'call-2' });
  assert.equal(gated?.kind, 'ask');
  assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: 'call-2', reason: gated.reason }), 'allowed-once');
  assert.equal(inst.approval.store.sessionGrants.length, 2, 'a fresh grant, live on the wire');
  assert.ok(inst.approval.store.cache.get(fp), 'and an entry capped to ITS grant (#65)');
  const e2 = inst.approval.store.cache.get(fp);
  assert.ok(e2.expiresAt - e2.grantedAt <= HOUR, 'the second era is capped — classed acts never escaped');
});

test('102-i: a bare GrantStore (no approval service) still answers the store method directly', () => {
  const store = new GrantStore();
  const t0 = 1_700_000_000_000;
  store.cacheSet('fp_aaaaaaaaaaaaaaaa', t0, 24 * HOUR, { url: 'https://api.example.com/v1/x' });
  store.cacheSet('fp_bbbbbbbbbbbbbbbb', t0, 24 * HOUR, { host: 'other.example' });
  assert.deepEqual(store.killCacheForRoute({ host: 'API.EXAMPLE.COM', port: 443 }), ['fp_aaaaaaaaaaaaaaaa'],
    'host case and numeric port are normalized to the route');
  assert.ok(store.cache.get('fp_bbbbbbbbbbbbbbbb'));
});
