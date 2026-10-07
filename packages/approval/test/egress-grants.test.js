// #38 phase 3, the approval half: the method class joins the ask identity,
// the mediated posture's allowed decision materializes the egress grant the
// mediator enforces, and the ask says so BEFORE the operator decides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createApproval, approvalPlugin, fingerprint, egressPatternFor,
  egressGrantsFor, GrantStore, PersistentGrantStore,
} from '../src/index.js';

const agent = (id = 'sess-a') => ({ id, session: { id, header: {} } });

// -- consent identity is risk identity: the class joins the fingerprint -----

test('the address pin is validated at the grant boundary — IP literals, non-empty, de-duplicated (#55 follow-up)', () => {
  const store = new GrantStore();
  const pinned = store.addSessionGrant({
    pattern: { kind: 'HostAndPort', value: { host: 'releases.internal', port: '443' } },
    methodClass: 'write', ttlMs: 60_000, now: Date.now(),
    addresses: ['127.0.0.1', '127.0.0.1', '10.0.0.5'],
  });
  assert.deepEqual(pinned.addresses, ['127.0.0.1', '10.0.0.5'], 'de-duplicated, first-seen order kept');

  // absent = no pin: the row carries null and the dial policy alone answers,
  // exactly as before the pin existed
  const unpinned = store.addSessionGrant({
    pattern: { kind: 'ExactHost', value: 'api.example.com' },
    methodClass: 'read', ttlMs: 60_000, now: Date.now(),
  });
  assert.equal(unpinned.addresses, null);

  // a pin of nothing pins nothing; a pin of non-addresses pins nothing dialable
  for (const bad of [[], ['not-an-ip'], ['10.0.0.5', 'releases.internal'], '10.0.0.5']) {
    assert.throws(() => store.addSessionGrant({
      pattern: { kind: 'ExactHost', value: 'api.example.com' },
      methodClass: 'read', ttlMs: 60_000, now: Date.now(), addresses: bad,
    }), /must be a non-empty array of IP literals/, JSON.stringify(bad));
  }
});

test('same target, different method class → different identity (#26/#38)', () => {
  const get = fingerprint('bash', { url: 'https://api.example.com/v1', methodClass: 'read' });
  const post = fingerprint('bash', { url: 'https://api.example.com/v1', methodClass: 'write' });
  assert.notEqual(get, post, 'approving the read must not cover the state-changing act');
  // two phrasings of the SAME read share one identity — the abstraction that
  // makes replay honest survives the new axis
  const curl = fingerprint('bash', { url: 'https://api.example.com/v1', methodClass: 'read' });
  assert.equal(get, curl);
  // absent the class, the payload is byte-identical to every pre-existing
  // fingerprint — no mass re-ask on upgrade
  assert.equal(
    fingerprint('bash', { url: 'https://api.example.com/v1' }),
    fingerprint('bash', { url: 'https://api.example.com/v1', methodClass: undefined }),
  );
});

// -- the grant pattern a connection can actually match -----------------------

test('egress patterns are connection-shaped: host+port, scheme defaults kept', () => {
  assert.deepEqual(
    egressPatternFor({ url: 'https://api.example.com/v1/data', host: 'api.example.com' }),
    { kind: 'HostAndPort', value: { host: 'api.example.com', port: '443' } });
  assert.deepEqual(
    egressPatternFor({ url: 'http://example.com/x', host: 'example.com' }),
    { kind: 'HostAndPort', value: { host: 'example.com', port: '80' } });
  assert.deepEqual(
    egressPatternFor({ url: 'https://example.com:8443/x', host: 'example.com' }),
    { kind: 'HostAndPort', value: { host: 'example.com', port: '8443' } }, 'an explicit port is kept');
  assert.deepEqual(egressPatternFor({ host: 'db.internal', port: '5432' }),
    { kind: 'HostAndPort', value: { host: 'db.internal', port: '5432' } });
  assert.deepEqual(egressPatternFor({ host: 'Bare.Example' }),
    { kind: 'ExactHost', value: 'bare.example' }, 'a bare host stays host-scoped — the analyzer named no port');
  assert.equal(egressPatternFor({}), null, 'no target, no grant');
  assert.equal(egressPatternFor(undefined), null);
});

// -- the mediated posture: an allowed decision DELIVERS ----------------------

async function boot(posture, downstream = () => 'allowed-once', pluginOpts = {}) {
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
  const inst = approvalPlugin({ egress: posture, ...pluginOpts });
  inst(ctx, { egress: posture });
  return { ctx, inst };
}

async function decide(ctx, req) {
  return ctx.waterfall('approval/request', req, () => 'unavailable');
}

test('proxy posture: allowed-once materializes the egress grant — host, port, class, session, TTL', async () => {
  const { ctx, inst } = await boot('proxy');
  const ag = agent('sess-a');
  const gated = inst.approval.gate({
    name: 'bash',
    arguments: { url: 'https://api.example.com/v1/data', host: 'api.example.com', methodClass: 'read', delivery: 'mediator' },
    agent: ag, callId: 'call-1',
  });
  assert.equal(gated?.kind, 'ask');
  assert.match(gated.reason, /mediator can deliver/, 'the ask discloses that approval delivers (#38 phase 2 record)');
  assert.match(gated.reason, /host, port and method class/);

  assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: 'call-1', reason: gated.reason }), 'allowed-once');

  const grants = inst.approval.store.sessionGrants;
  assert.equal(grants.length, 1, 'one allowed network act → one egress grant');
  const g = grants[0];
  assert.deepEqual(g.pattern, { kind: 'HostAndPort', value: { host: 'api.example.com', port: '443' } });
  assert.equal(g.methodClass, 'read');
  assert.equal(g.session, 'sess-a');
  assert.ok(g.expiresAt > Date.now() && g.expiresAt <= Date.now() + 60 * 60 * 1000, 'TTL-bounded, never blanket');
  assert.equal(g.revokedAt, null);

  // the mediator's own read of the store sees exactly this grant for this session
  assert.deepEqual(egressGrantsFor(inst.approval.store, 'sess-a').map(x => x.id), [g.id]);
  assert.deepEqual(egressGrantsFor(inst.approval.store, 'sess-other'), [], 'another session holds nothing');
});

// -- the pin offer (#55 follow-up, slice 2): the ask resolves host-side, the --
// deciding view shows the addresses, the allowed-once grant materializes pinned

const PINNED_TARGET = { url: 'https://api.example.com/v1/data', host: 'api.example.com', methodClass: 'read', delivery: 'mediator' };

async function decidePin(pluginOpts, target = PINNED_TARGET) {
  let inst, seenView = null;
  const harness = await boot('proxy', () => {
    seenView = [...inst.approval.deciding.values()][0];
    return 'allowed-once';
  }, pluginOpts);
  inst = harness.inst;
  const ag = agent('sess-a');
  const gated = inst.approval.gate({ name: 'bash', arguments: { ...target }, agent: ag, callId: 'call-pin' });
  assert.equal(gated?.kind, 'ask', 'the mediated act still asks');
  assert.equal(await decide(harness.ctx, { toolName: 'bash', agent: ag, callId: 'call-pin', reason: gated.reason }), 'allowed-once');
  return { inst, seenView, grants: inst.approval.store.sessionGrants };
}

test('the pin offer: the ask resolves host-side, the view shows the addresses, the grant materializes PINNED', async () => {
  let resolveCalls = 0;
  const { seenView, grants } = await decidePin({
    egressPinOffers: true,
    resolveHost: async () => { resolveCalls += 1; return ['203.0.113.7', '203.0.113.7', '2606:2800:220:1:248:1893:25c8:1946']; },
  });

  // the deciding view showed the RESOLVED addresses — de-duplicated, exactly
  // what the operator was shown when they answered
  assert.deepEqual(seenView.addresses, ['203.0.113.7', '2606:2800:220:1:248:1893:25c8:1946']);
  assert.equal(resolveCalls, 1, 'one resolution, at ask time');

  // the materialized grant is pinned to exactly what was shown — consent over
  // the address, not just the name
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0].addresses, ['203.0.113.7', '2606:2800:220:1:248:1893:25c8:1946']);
});

test('pin offer off by default: no resolution at ask time, unpinned grant — byte-identical', async () => {
  let resolveCalls = 0;
  const { seenView, grants } = await decidePin({
    resolveHost: async () => { resolveCalls += 1; return ['203.0.113.7']; },
  });
  assert.equal(resolveCalls, 0, 'the offer is absent by composition — no DNS on the ask path');
  assert.equal(seenView.addresses, undefined, 'the deciding view names no addresses');
  assert.equal(grants[0].addresses, null, 'the grant materializes unpinned, exactly as before');
});

test('pin offer: an IP-literal target offers nothing — the dial goes to the literal, nothing to rebind', async () => {
  let resolveCalls = 0;
  const { grants } = await decidePin(
    { egressPinOffers: true, resolveHost: async () => { resolveCalls += 1; return ['203.0.113.7']; } },
    { url: 'http://127.0.0.1:8080/x', host: '127.0.0.1', methodClass: 'read', delivery: 'mediator' },
  );
  assert.equal(resolveCalls, 0, 'no name, no offer');
  assert.equal(grants[0].addresses, null);
});

test('pin offer: a failed resolution is an absence, never a refusal — the ask still lands, the grant is unpinned', async () => {
  const { seenView, grants } = await decidePin({
    egressPinOffers: true,
    resolveHost: async () => null,   // resolver answered nothing usable
  });
  assert.equal(seenView.addresses, undefined, 'no resolution, no offer on the view');
  assert.equal(grants.length, 1, 'the allowed-once still materializes its grant');
  assert.equal(grants[0].addresses, null, 'unpinned — the mediator resolves anew at the wire');
});

test('no derivable class → no grant, and the ask said so before the decision (D-7)', async () => {
  const { ctx, inst } = await boot('proxy');
  const ag = agent('sess-a');
  const gated = inst.approval.gate({
    name: 'bash',
    arguments: { url: 'https://example.com/x', host: 'example.com', methodClass: null },
    agent: ag, callId: 'call-2',
  });
  assert.equal(gated?.kind, 'ask');
  // #107: the underivable class IS the lead — the issue's wording, with the
  // mediator's by-name refusal folded in (the old tail note it replaces)
  assert.match(gated.reason, /needs the network but its method class is not statically derivable/);
  assert.match(gated.reason, /materializes NO egress grant \(D-7\)/);
  assert.match(gated.reason, /refuses its connections by name/);

  assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: 'call-2', reason: gated.reason }), 'allowed-once');
  assert.equal(inst.approval.store.sessionGrants.length, 0,
    'an unclassifiable act gets no coverage — approval stayed consent, the wire stays closed');
});

test('no delivery path → no grant, and the ask said so before the decision (#57)', async () => {
  const { ctx, inst } = await boot('proxy');
  const ag = agent('sess-a');
  // the shape remote-access gates for `ssh host` / `git clone git@host:repo`:
  // classed (git clone reads), patternable (ExactHost), but NOT speakable by
  // the mediator — approval must stay consent, never pretend connectivity
  const gated = inst.approval.gate({
    name: 'bash',
    arguments: { host: 'github.com', methodClass: 'read', delivery: null },
    agent: ag, callId: 'call-3',
  });
  assert.equal(gated?.kind, 'ask');
  assert.match(gated.reason, /no delivery path under the mediated posture/);
  assert.match(gated.reason, /plain HTTP and CONNECT only/);
  assert.match(gated.reason, /materializes NO usable connectivity/);

  assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: 'call-3', reason: gated.reason }), 'allowed-once');
  assert.equal(inst.approval.store.sessionGrants.length, 0,
    'a grant the wire can never carry is a pretend coverage — none materializes');
});

test('a deliverable act carries no undeliverable note and materializes (#57 regression)', async () => {
  const { ctx, inst } = await boot('proxy');
  const ag = agent('sess-a');
  const gated = inst.approval.gate({
    name: 'bash',
    arguments: { url: 'https://api.example.com/v1', host: 'api.example.com', methodClass: 'read', delivery: 'mediator' },
    agent: ag, callId: 'call-4',
  });
  assert.equal(gated?.kind, 'ask');
  assert.doesNotMatch(gated.reason, /no delivery path under the mediated posture/,
    'the honesty note names only the acts it is true of');
  assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: 'call-4', reason: gated.reason }), 'allowed-once');
  assert.equal(inst.approval.store.sessionGrants.length, 1);
});

test('without the mediated posture nothing materializes — the posture is the sandbox declaration', async () => {
  for (const egress of ['none', 'open', undefined]) {
    const { ctx, inst } = await boot(egress);
    const ag = agent('sess-a');
    const gated = inst.approval.gate({
      name: 'bash',
      arguments: { host: 'api.example.com', methodClass: 'read' },
      agent: ag, callId: `call-${egress}`,
    });
    assert.equal(gated?.kind, 'ask');
    assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: `call-${egress}`, reason: gated.reason }), 'allowed-once');
    assert.equal(inst.approval.store.sessionGrants.length, 0,
      `posture ${egress}: the exec-cache is the only native materialization, as before`);
    assert.ok(inst.approval.store.cache.size > 0, 'the exec-cache entry still lands');
  }
});

test('a rejected network ask materializes nothing at all', async () => {
  const { ctx, inst } = await boot('proxy', () => 'rejected');
  const ag = agent('sess-a');
  const gated = inst.approval.gate({
    name: 'bash', arguments: { host: 'evil.example', methodClass: 'write' }, agent: ag, callId: 'call-r',
  });
  assert.equal(await decide(ctx, { toolName: 'bash', agent: ag, callId: 'call-r', reason: gated.reason }), 'rejected');
  assert.equal(inst.approval.store.sessionGrants.length, 0);
});

// -- what the mediator reads: the class is the clause ------------------------

test('egressGrantsFor reads only the live, classed, session-scoped network family', () => {
  const store = new GrantStore();
  const now = 1_700_000_000_000;
  const live = store.addSessionGrant({ pattern: { kind: 'HostAndPort', value: { host: 'a.example', port: '443' } }, session: 's', methodClass: 'read', ttlMs: 60_000, now });
  store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'b.example' }, session: 's', ttlMs: 60_000, now });            // no class → no coverage
  store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/mnt', ceiling: 'rw' } }, session: 's', methodClass: 'rw', ttlMs: 60_000, now }); // not a network kind
  store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'c.example' }, session: 'other', methodClass: 'read', ttlMs: 60_000, now }); // another session
  store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'd.example' }, session: 's', methodClass: 'read', ttlMs: 60_000, now });
  store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'e.example' }, session: 's', methodClass: 'read', ttlMs: 60_000, now });

  const rows = store.sessionGrants;
  rows.find(r => r.pattern.value === 'd.example').expiresAt = now - 1;   // expired
  rows.find(r => r.pattern.value === 'e.example').revokedAt = now + 1;   // revoked

  assert.deepEqual(egressGrantsFor(store, 's', now).map(r => r.id), [live.id]);
  assert.deepEqual(egressGrantsFor(store, 'other', now).map(r => r.pattern.value), ['c.example'],
    'each session reads only its own grants — a listener never sees a sibling session\'s coverage');
});

test('the class survives persistence — the row the auditor-era store reloads is the row that was written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'egress-grant-'));
  try {
    const path = join(dir, 'approvals.json');
    const store = new PersistentGrantStore(path);
    store.addSessionGrant({ pattern: { kind: 'HostAndPort', value: { host: 'a.example', port: '443' } }, session: 's', methodClass: 'write', ttlMs: 60_000, now: 1 });
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(raw.sessionGrants[0].methodClass, 'write', 'format v2 carries the extra field without a version bump');
    const reloaded = new PersistentGrantStore(path);
    assert.equal(reloaded.sessionGrants[0].methodClass, 'write');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
