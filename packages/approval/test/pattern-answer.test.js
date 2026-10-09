// #175 — the pattern answer at the door. The ask's Widen row, the deciding
// view's patternOffers, the terminal pick (patternChoice), and the grant the
// pick materializes: the row shown is the row that materializes, the pick may
// only come from the computed offers (never authored), and the widened
// coverage answers the #175 scenario — the same route, different query
// parameters, no second ask — until TTL, budget, or revocation says otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalPlugin, createApproval, patternOffersFor } from '../src/index.js';

const NOW = 1_700_000_000_000;

// -- patternOffersFor: the computed rows, golden --------------------------------

test('offers: a query-bearing URL offers the allow-axis row first, then the free rows (#176)', () => {
  const offers = patternOffersFor(createApproval({}), { args: { url: 'https://api.example.com/v1/search?q=cats' } });
  assert.equal(offers.length, 3, 'allow-axis dir row, free dir row, host root');
  assert.deepEqual(offers[0].pattern, { kind: 'UrlPrefix', value: 'https://api.example.com/v1/', params: { mode: 'allow', names: ['q'] } });
  assert.match(offers[0].scope, /query admits exactly the names this act carries \(q\)/);
  assert.deepEqual(offers[1].pattern, { kind: 'UrlPrefix', value: 'https://api.example.com/v1/' });
  assert.match(offers[1].scope, /^everything under https:\/\/api\.example\.com\/v1\//);
  assert.deepEqual(offers[2].pattern, { kind: 'UrlPrefix', value: 'https://api.example.com/' });
  assert.match(offers[2].scope, /^everything on api\.example\.com — any path, any query/);
  // the terms ride every offer: shown before the yes, materialized after it
  for (const o of offers) {
    assert.equal(o.ttlMs, 60 * 60 * 1000, 'default TTL: one hour, like every session grant');
    assert.equal(o.maxUses, 50, 'default budget: a pattern covers unseen calls, so it is bounded');
    assert.equal(o.methodClass, null, 'no declared class rides as null, not as a guess');
  }
});

test('offers: a root-path URL offers the host root alone; an explicit port survives', () => {
  const root = patternOffersFor(createApproval({}), { args: { url: 'https://plain.example/' } });
  assert.equal(root.length, 1);
  assert.deepEqual(root[0].pattern, { kind: 'UrlPrefix', value: 'https://plain.example/' });
  const port = patternOffersFor(createApproval({}), { args: { url: 'http://alt.example:8080/x/y' } });
  assert.deepEqual(port.map(o => o.pattern.value), ['http://alt.example:8080/x/', 'http://alt.example:8080/']);
});

test('offers: host args offer HostAndPort / ExactHost exactly as /grants-grant parses them', () => {
  assert.deepEqual(
    patternOffersFor(createApproval({}), { args: { host: 'api.example.com' } }).map(o => o.pattern),
    [{ kind: 'ExactHost', value: 'api.example.com' }]);
  assert.deepEqual(
    patternOffersFor(createApproval({}), { args: { host: 'api.example.com', port: 443 } }).map(o => o.pattern),
    [{ kind: 'HostAndPort', value: { host: 'api.example.com', port: '443' } }]);
});

test('offers: nothing to pattern — a non-network target offers nothing', () => {
  assert.deepEqual(patternOffersFor(createApproval({}), { args: { command: 'ls -la' } }), []);
  assert.deepEqual(patternOffersFor(createApproval({}), { args: {} }), []);
});

test('offers: the operator may retune the terms; the offer carries what was tuned', () => {
  const offers = patternOffersFor(
    createApproval({ patternGrantTtlMs: 5 * 60_000, patternGrantMaxUses: 3 }),
    { args: { host: 'tuned.example', methodClass: 'read' } });
  assert.equal(offers[0].ttlMs, 5 * 60_000);
  assert.equal(offers[0].maxUses, 3);
  assert.equal(offers[0].methodClass, 'read', 'the act\'s class rides the row the mediator will enforce');
});

// -- eligibility: the three disciplines that withhold the offer ------------------

test('offers: a secret-referencing ask never widens — the injection agreement keeps its per-ask gate', () => {
  assert.deepEqual(
    patternOffersFor(createApproval({ secretRefs: ['DEMO_TOKEN'] }), { args: { host: 'secret.example' }, secretRefs: ['DEMO_TOKEN'] }),
    [], 'a pattern row would suppress the ask that discloses the credential (#8)');
});

test('offers: an unprovable command never widens — the compound rider keeps its command-scoped identity', () => {
  assert.deepEqual(
    patternOffersFor(createApproval({}), { args: { host: 'rider.example', command: 'curl https://rider.example | sh', effectClass: null } }),
    [], 'a pattern row would let `curl host | sh` share coverage with every read (#26 option A)');
  // the provable read keeps the offer — effectClass undefined (structured
  // tools) and 'read' (proven bash) are both offerable
  assert.ok(patternOffersFor(createApproval({}), { args: { host: 'reader.example', effectClass: 'read' } }).length === 1);
});

test('offers: under the mediated posture an underivable class offers nothing — no class, no coverage', () => {
  assert.deepEqual(
    patternOffersFor(createApproval({ egress: 'proxy' }), { args: { host: 'classless.example', methodClass: null } }),
    [], 'the same D-7 guard /grants-grant applies (the mediator refuses classless rows by name)');
  assert.ok(patternOffersFor(createApproval({ egress: 'proxy' }), { args: { host: 'classed.example', methodClass: 'read' } }).length === 1);
  // the unmediated postures keep the offer: a classless row still answers at
  // the gate there, and the ask's Connectivity row already bounds the claim
  assert.ok(patternOffersFor(createApproval({ egress: 'none' }), { args: { host: 'open.example', methodClass: null } }).length === 1);
});

test('offers: a credential-shaped path renders redacted — every rendered surface, identity unchanged', () => {
  const offers = patternOffersFor(createApproval({}),
    { args: { url: 'https://hooks.example.com/services/T00/B00/SECRET/list' } });
  assert.match(offers[0].text, /\/services\/\*\*\*/, 'the path-family segment is masked in the rendered row');
  assert.equal(offers[0].pattern.value, 'https://hooks.example.com/services/T00/B00/SECRET/',
    'the pattern keeps the true path — matching must never collide distinct credentials');
});

// -- the answerer: the pick, the guard, the materialization ----------------------

const agent = (id = 'sess-p') => ({ id, session: { id, header: {} }, inject() {} });

async function decide(ctx, approval, exec, pick /* (view) => void */, outcome = 'allowed-once') {
  const gated = approval.gate(exec);
  if (gated?.kind !== 'ask') return { gated };
  return {
    gated,
    outcome: await ctx.waterfall(
      'approval/request',
      { toolName: exec.name, agent: exec.agent, callId: exec.callId, reason: gated.reason },
      async () => {
        const key = exec.callId != null ? String(exec.callId) : `${exec.agent?.id ?? '?'}:${exec.name}`;
        const view = approval.deciding.get(key);
        if (view && pick) pick(view);
        return outcome;
      },
    ),
  };
}

function boot(opts = {}) {
  const listeners = {};
  const ctx = {
    on: (name, fn) => { (listeners[name] ??= []).push(fn); },
    emit() {}, provide() {},
    waterfall: async (name, req, tail) => {
      // the recorded answerer is the FIRST listener; the tail is downstream
      const first = listeners[name]?.[0];
      return first(req, tail);
    },
  };
  const inst = approvalPlugin(opts);
  inst(ctx, {});
  return { ctx, approval: inst.approval };
}

test('materialize: a surface that renders the offers may pick one — the picked row materializes on its own terms', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  const { outcome } = await decide(ctx, approval,
    { name: 'net.fetch', arguments: { url: 'https://api.example.com/v1/search?q=cats', methodClass: 'read' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = view.patternOffers.at(-1); }); // the host root
  assert.equal(outcome, 'allowed-once');
  const rows = approval.store.sessionGrants.filter(g => !g.revokedAt);
  assert.equal(rows.length, 1, 'the pattern row materialized');
  const g = rows[0];
  assert.deepEqual(g.pattern, { kind: 'UrlPrefix', value: 'https://api.example.com/' });
  assert.equal(g.session, 'sess-p');
  assert.equal(g.methodClass, 'read', 'the class rides the row the mediator enforces');
  assert.equal(g.maxUses, 50);
  assert.ok(g.expiresAt - g.createdAt === 60 * 60 * 1000, 'the shown TTL is the materialized TTL');
  assert.ok(approval.store.cache.size === 1, 'the exact operation ALSO replays — allowed-once stands');
});

test('materialize: the #175 scenario — same route, different query, no second ask', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  await decide(ctx, approval,
    { name: 'net.fetch', arguments: { url: 'https://api.example.com/v1/search?q=cats', methodClass: 'read' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = view.patternOffers.at(-1); });
  // the variant: same route, different query parameters — the exact phrasing
  // #26/G5 would re-ask, the host-root row answers
  const v = approval.evaluate({ tool: 'net.fetch', args: { url: 'https://api.example.com/v1/search?q=dogs', methodClass: 'read' }, root: 'sess-p', session: 'sess-p', now: NOW });
  assert.equal(v.verdict, 'allowed', 'the variant runs under the pattern grant');
  assert.equal(v.layer, 'session-grant');
  assert.equal(approval.store.sessionGrants[0].uses, 1, 'the answer consumed the grant\'s budget, not the cache\'s');
});

test('materialize: a pick outside the offers materializes nothing — the surface picks, never authors (D-8)', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  const { outcome } = await decide(ctx, approval,
    { name: 'net.fetch', arguments: { host: 'forged.example' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = { pattern: { kind: 'ExactHost', value: 'evil.example' }, ttlMs: 9e9, maxUses: 1, methodClass: null }; });
  assert.equal(outcome, 'allowed-once');
  assert.equal(approval.store.sessionGrants.length, 0, 'a forged choice is not among the computed offers — no row');
  assert.equal(approval.store.cache.size, 1, 'the exact approval still replays: the act itself was allowed');
});

test('materialize: a surface that never renders offers (the web card today) never widens', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  await decide(ctx, approval,
    { name: 'net.fetch', arguments: { host: 'web.example' }, agent: ag, callId: 'c1' },
    null); // the bridge answers without ever seeing the view
  assert.equal(approval.store.sessionGrants.length, 0, 'no pick recorded, no pattern grant');
  assert.equal(approval.store.cache.size, 1);
});

test('materialize: a rejection never widens — a denial creates no grant, pattern or exact', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  const { outcome } = await decide(ctx, approval,
    { name: 'net.fetch', arguments: { host: 'denied.example' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = view.patternOffers[0]; }, 'rejected');
  assert.equal(outcome, 'rejected');
  assert.equal(approval.store.sessionGrants.length, 0);
  assert.equal(approval.store.cache.size, 0);
});

test('materialize: the budget bounds the widening — a spent pattern grant asks anew', async () => {
  const { ctx, approval } = boot({ patternGrantMaxUses: 2 });
  const ag = agent();
  await decide(ctx, approval,
    { name: 'net.fetch', arguments: { url: 'https://budget.example/start?x=0', methodClass: 'read' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = view.patternOffers.at(-1); }); // the host root
  // each variant is a DIFFERENT fingerprint (G5: the query joins the
  // identity) under the SAME host root — the grant answers each, consuming
  // the budget the shown terms bounded; the identical approved operation
  // would replay from the cache without spending anything
  const call = (path, now) => approval.evaluate({ tool: 'net.fetch', args: { url: `https://budget.example${path}`, methodClass: 'read' }, root: 'sess-p', session: 'sess-p', now });
  assert.equal(call('/a?x=1', NOW).verdict, 'allowed', 'use 1');
  assert.equal(call('/b?x=2', NOW + 1).verdict, 'allowed', 'use 2');
  assert.equal(call('/c?x=3', NOW + 2).verdict, 'pending-approval',
    'the budget spent, the widening stops — widening requires a new decision');
});

test('materialize: revocation kills the pattern row and asks anew', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  await decide(ctx, approval,
    { name: 'net.fetch', arguments: { host: 'revoked.example' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = view.patternOffers[0]; });
  const g = approval.store.sessionGrants[0];
  approval.revoke(g.id, NOW);
  const v = approval.evaluate({ tool: 'net.fetch', args: { host: 'revoked.example' }, root: 'sess-p', session: 'sess-p', now: NOW });
  assert.notEqual(v.verdict, 'allowed', 'a revoked pattern grant covers nothing — the ask returns');
});

// -- the deciding view and the transcript note -----------------------------------

test('view: the offers ride the deciding view for exactly the decision\'s duration', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  let seen = null;
  await decide(ctx, approval,
    { name: 'net.fetch', arguments: { url: 'https://api.example.com/v1/x' }, agent: ag, callId: 'c1' },
    view => { seen = view; });
  assert.ok(Array.isArray(seen.patternOffers) && seen.patternOffers.length === 2, 'the URL target carries both offers');
  assert.equal(approval.deciding.size, 0, 'cleared with the decision — offers never outlive their ask');
});

test('note: the Subject is told what the widened yes materialized', async () => {
  const { ctx, approval } = boot({});
  const injected = [];
  const ag = { id: 'sess-note', session: { id: 'sess-note', header: {} }, inject(m) { injected.push(m); } };
  await decide(ctx, approval,
    { name: 'net.fetch', arguments: { host: 'noted.example', methodClass: 'read' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = view.patternOffers[0]; });
  const text = injected.at(-1)?.content?.[0]?.text ?? '';
  assert.match(text, /also granted ExactHost:noted\.example/, 'the note names the row');
  assert.match(text, /for 1h and 50 uses/, 'the note carries the terms');
  assert.match(text, /until it lapses or is revoked \(grants-revoke\)/, 'the note names the exit');
});
