// #176 slice 1 — the query axis on session grants. A UrlPrefix row may bind
// the QUERY dimension of its coverage — `free` (the legacy semantics,
// stated), `allow:[names]` (queries whose parameter names are a subset),
// `fixed` (the bare target only) — names only, never values (G3/G5). The
// door offers the allow-axis row first for query-bearing URLs; an act that
// falls outside a live row's axis asks with the edge NAMED — the row under
// test, its axis, the refused names, and the credential floor — the decision
// context the night watch's decider will be handed (#176 slice 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalPlugin, createApproval, patternOffersFor, parseAllowlistLikePattern,
  paramsAllows, credentialShapedName, classifyAskCause, GrantStore,
} from '../src/index.js';

const NOW = 1_700_000_000_000;

// -- the axis primitive ----------------------------------------------------------

test('paramsAllows: free/absent admit everything; allow is subset-of-names; fixed is bare-target', () => {
  const withQ = { url: 'https://h.example/x?q=1&lang=en' };
  const bare = { url: 'https://h.example/x' };
  assert.equal(paramsAllows(null, withQ), true, 'absent axis = the legacy free row');
  assert.equal(paramsAllows({ mode: 'free' }, withQ), true);
  assert.equal(paramsAllows({ mode: 'allow', names: ['q', 'lang'] }, withQ), true);
  assert.equal(paramsAllows({ mode: 'allow', names: ['q'] }, withQ), false, 'lang is outside the axis');
  assert.equal(paramsAllows({ mode: 'allow', names: ['q'] }, bare), true, 'a query-less call is trivially within');
  assert.equal(paramsAllows({ mode: 'fixed' }, bare), true);
  assert.equal(paramsAllows({ mode: 'fixed' }, withQ), false, 'fixed admits no query at all');
  assert.equal(paramsAllows({ mode: 'wat' }, bare), false, 'an unknown mode covers nothing (fail closed)');
});

test('credentialShapedName: the redaction catalogue\'s query family, closed', () => {
  for (const n of ['token', 'api_key', 'apiKey', 'sig', 'signature', 'password', 'access_token', 'X-Key']) {
    assert.ok(credentialShapedName(n), n);
  }
  for (const n of ['q', 'page', 'lang', 'id', 'format']) {
    assert.ok(!credentialShapedName(n), n);
  }
});

test('parse: a typed URL pattern WITH a query means its parameter NAMES; values never persist', () => {
  const p = parseAllowlistLikePattern('https://api.example.com/v1/?q=cats&lang=en');
  assert.deepEqual(p.params, { mode: 'allow', names: ['lang', 'q'] }, 'sorted names, values dropped');
  assert.equal(p.value, 'https://api.example.com/v1/', 'the row\'s value carries no query');
  const bare = parseAllowlistLikePattern('https://api.example.com/v1/');
  assert.equal(bare.params, undefined, 'no query, no axis — the legacy free row');
});

// -- coverage: the axis bites at layer 3 ------------------------------------------

test('coverage: an allow-axis row covers the same route with different VALUES, refuses a new NAME', () => {
  const a = createApproval({});
  a.grantSession({ pattern: parseAllowlistLikePattern('https://api.example.com/v1/?q=x&lang=y'), root: 'sess-p', session: 'sess-p', ttlMs: 60_000, methodClass: 'read' });
  const call = (q, now) => a.evaluate({ tool: 'net.fetch', args: { url: `https://api.example.com/v1/search?${q}`, methodClass: 'read' }, root: 'sess-p', session: 'sess-p', now });
  assert.equal(call('q=dogs', NOW).verdict, 'allowed', 'same name, different value — within the axis');
  assert.equal(call('q=dogs&lang=en', NOW + 1).verdict, 'allowed', 'subset of the axis');
  assert.equal(call('q=dogs&page=2', NOW + 2).verdict, 'pending-approval', 'a new name falls off the edge — the act asks');
  assert.equal(call('', NOW + 3).verdict, 'allowed', 'a query-less call is trivially within');
});

test('coverage: a fixed row covers the bare target only; the legacy row (no axis) keeps today\'s semantics', () => {
  const a = createApproval({});
  a.grantSession({ pattern: { kind: 'UrlPrefix', value: 'https://fixed.example/', params: { mode: 'fixed' } }, root: 'sess-p', session: 'sess-p', ttlMs: 60_000 });
  assert.equal(a.evaluate({ tool: 'net.fetch', args: { url: 'https://fixed.example/x' }, root: 'sess-p', session: 'sess-p', now: NOW }).verdict, 'allowed');
  assert.equal(a.evaluate({ tool: 'net.fetch', args: { url: 'https://fixed.example/x?q=1' }, root: 'sess-p', session: 'sess-p', now: NOW }).verdict, 'pending-approval');

  const b = createApproval({});
  b.grantSession({ pattern: parseAllowlistLikePattern('https://legacy.example/'), root: 'sess-q', session: 'sess-q', ttlMs: 60_000 });
  assert.equal(b.evaluate({ tool: 'net.fetch', args: { url: 'https://legacy.example/x?anything=goes&token=x' }, root: 'sess-q', session: 'sess-q', now: NOW }).verdict, 'allowed',
    'a pre-axis row admits every query — no migration, no mass re-ask');
});

// -- the edge, named: classifyAskCause --------------------------------------------

test('classifyAskCause: a live row whose axis refuses the act is a params-edge, not a first touch', () => {
  const store = new GrantStore();
  store.addSessionGrant({
    pattern: parseAllowlistLikePattern('https://api.example.com/v1/?q=x'),
    root: 'sess-p', session: 'sess-p', ttlMs: 60_000, now: NOW,
  });
  const cause = classifyAskCause(store, {
    target: { url: 'https://api.example.com/v1/search?q=1&token=secret', methodClass: 'read' },
    session: 'sess-p', now: NOW, egress: undefined,
  });
  assert.equal(cause.kind, 'params-edge');
  assert.deepEqual(cause.allowed, ['q']);
  assert.deepEqual(cause.current, ['q', 'token']);
  assert.deepEqual(cause.refused, ['token']);
  assert.deepEqual(cause.credential, ['token'], 'the refused credential-shaped name is flagged — the floor');
  assert.ok(cause.grant.id.startsWith('sg_'), 'the row under test rides the cause');
});

test('classifyAskCause: a FIXED row\'s edge refuses every query; revoked history still leads', () => {
  const store = new GrantStore();
  store.addSessionGrant({ pattern: { kind: 'UrlPrefix', value: 'https://f.example/', params: { mode: 'fixed' } }, root: 'sess-p', session: 'sess-p', ttlMs: 60_000, now: NOW });
  const cause = classifyAskCause(store, { target: { url: 'https://f.example/x?q=1' }, session: 'sess-p', now: NOW, egress: undefined });
  assert.equal(cause.kind, 'params-edge');
  assert.equal(cause.allowed, null, 'fixed = the bare target only');
  assert.deepEqual(cause.refused, ['q']);

  const store2 = new GrantStore();
  const g = store2.addSessionGrant({ pattern: parseAllowlistLikePattern('https://r.example/?q=x'), root: 'sess-p', session: 'sess-p', ttlMs: 60_000, now: NOW });
  store2.revokeSessionGrant(g.id, NOW + 1);
  const revoked = classifyAskCause(store2, { target: { url: 'https://r.example/x?page=2' }, session: 'sess-p', now: NOW + 2, egress: undefined });
  assert.equal(revoked.kind, 'revoked', 'history first: a revoked row is the cause, not the axis it once had');
});

// -- the door: offers carry the axis, the credential name never joins ---------------

test('offers: a credential-shaped name never joins the offered axis; an all-credential query offers none', () => {
  const mixed = patternOffersFor(createApproval({}), { args: { url: 'https://m.example/v1/x?q=1&api_key=z' } });
  assert.deepEqual(mixed[0].pattern.params, { mode: 'allow', names: ['q'] }, 'api_key is refused by the floor, q rides');
  assert.equal(mixed[0].pattern.value, 'https://m.example/v1/x/', 'the axis binds the leaf (#180)');
  const all = patternOffersFor(createApproval({}), { args: { url: 'https://m.example/v1/x?token=z&api_key=y' } });
  assert.equal(all.length, 3, 'no allow offer — the free ladder only (leaf, dir, host)');
  assert.ok(all.every(o => o.pattern.params == null), 'the free rows carry no axis');
});

// -- the gate: the edge ask names the row, the axis, the floor ----------------------

const agent = (id = 'sess-p') => ({ id, session: { id, header: {} }, inject() {} });

function boot(opts = {}) {
  const listeners = {};
  const ctx = {
    on: (name, fn) => { (listeners[name] ??= []).push(fn); },
    emit() {}, provide() {},
    waterfall: async (name, req, tail) => listeners[name]?.[0](req, tail),
  };
  const inst = approvalPlugin(opts);
  inst(ctx, {});
  return { ctx, approval: inst.approval };
}

async function decide(ctx, approval, exec, pick, outcome = 'allowed-once') {
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

test('gate: approving the allow-axis offer covers value variants; a new name asks with the edge named', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  await decide(ctx, approval,
    { name: 'net.fetch', arguments: { url: 'https://api.example.com/v1/search?q=cats', methodClass: 'read' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = view.patternOffers[0]; }); // the allow-axis row
  // value variant: covered, budget consumed
  const v1 = approval.evaluate({ tool: 'net.fetch', args: { url: 'https://api.example.com/v1/search?q=dogs', methodClass: 'read' }, root: 'sess-p', session: 'sess-p', now: NOW });
  assert.equal(v1.verdict, 'allowed');
  assert.equal(v1.layer, 'session-grant');
  // new name: the edge — and the ASK says which row, which axis, what refused
  const gated = approval.gate({ name: 'net.fetch', arguments: { url: 'https://api.example.com/v1/search?q=dogs&page=2', methodClass: 'read' }, agent: ag, callId: 'c2' });
  assert.equal(gated?.kind, 'ask');
  const body = gated.reason.slice(gated.reason.indexOf('] ') + 2);
  assert.match(body, /^Your grant \(sg_[a-z0-9]+\) covers this route, but its query axis admits exactly \(q\) — this act's query carries \(page, q\), refused: \(page\)\. The act asks anew\./,
    'the edge lead names the row, the axis, and the refused name');
  assert.ok(!body.includes('page=2'), 'values never render — names only (G5)');
  assert.ok(!body.includes('Credential-shaped'), 'a plain name needs no floor sentence');
});

test('gate: a credential-shaped refused name carries the floor sentence — no widening path admits it', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  await decide(ctx, approval,
    { name: 'net.fetch', arguments: { url: 'https://api.example.com/v1/search?q=cats', methodClass: 'read' }, agent: ag, callId: 'c1' },
    view => { view.patternChoice = view.patternOffers[0]; });
  const gated = approval.gate({ name: 'net.fetch', arguments: { url: 'https://api.example.com/v1/search?q=dogs&api_key=z', methodClass: 'read' }, agent: ag, callId: 'c2' });
  assert.equal(gated?.kind, 'ask');
  const body = gated.reason.slice(gated.reason.indexOf('] ') + 2);
  assert.match(body, /refused: \(api_key\)\. The act asks anew\. Credential-shaped parameters \(api_key\) never widen — no axis admits them, by offer, by command, or by any later judgment\./,
    'the floor binds the operator, the offers, and the future decider alike');
});

test('gate: a fixed row\'s edge lead says the bare target only', async () => {
  const { ctx, approval } = boot({});
  const ag = agent();
  approval.grantSession({ pattern: { kind: 'UrlPrefix', value: 'https://f.example/', params: { mode: 'fixed' } }, root: 'sess-p', session: 'sess-p', ttlMs: 60_000 });
  const gated = approval.gate({ name: 'net.fetch', arguments: { url: 'https://f.example/x?q=1' }, agent: ag, callId: 'c1' });
  assert.equal(gated?.kind, 'ask');
  const body = gated.reason.slice(gated.reason.indexOf('] ') + 2);
  assert.match(body, /^Your grant \(sg_[a-z0-9]+\) covers this route, but its query axis is fixed — the bare target only, any query asks — everything this act's query carries is refused \(q\)\. The act asks anew\./);
});

// -- the operator surface: /grants-grant speaks the axis ----------------------------

function bootCommands() {
  const registered = {};
  const ctx = {
    on() {}, emit() {}, provide() {},
    inject(deps, fn) { fn({ commands: { register: (cmd) => { registered[cmd.name] = cmd; } } }); },
  };
  const inst = approvalPlugin({});
  inst(ctx, {});
  return { registered, approval: inst.approval };
}

const INV = { agent: agent('sess-op') };

test('grants-grant: params=allow(...) narrows the row; the echo renders the axis; free/fixed parse', () => {
  const { registered, approval } = bootCommands();
  const out = registered['grants-grant'].handler({ ...INV, rawInput: 'https://api.example.com/v1/ 60 50 read params=allow(q,page)' });
  assert.equal(out.kind, 'success');
  assert.match(out.text, /params=allow\(page,q\)/, 'the echo shows the axis — names only, sorted');
  const row = approval.store.sessionGrants.at(-1);
  assert.deepEqual(row.pattern.params, { mode: 'allow', names: ['page', 'q'] });
  // value variants inside the axis are covered, new names are not
  assert.equal(approval.evaluate({ tool: 'net.fetch', args: { url: 'https://api.example.com/v1/x?b=1' }, root: 'sess-op', session: 'sess-op', now: NOW }).verdict, 'pending-approval', 'b is outside the axis');
  assert.equal(approval.evaluate({ tool: 'net.fetch', args: { url: 'https://api.example.com/v1/x?q=1' }, root: 'sess-op', session: 'sess-op', now: NOW }).verdict, 'allowed');
  assert.equal(approval.evaluate({ tool: 'net.fetch', args: { url: 'https://api.example.com/v1/x?page=1&q=1' }, root: 'sess-op', session: 'sess-op', now: NOW }).verdict, 'allowed');

  const fixed = registered['grants-grant'].handler({ ...INV, rawInput: 'https://f2.example/ params=fixed' });
  assert.match(fixed.text, /params=fixed/);
  assert.deepEqual(approval.store.sessionGrants.at(-1).pattern.params, { mode: 'fixed' });

  const free = registered['grants-grant'].handler({ ...INV, rawInput: 'https://f3.example/ params=free' });
  assert.deepEqual(approval.store.sessionGrants.at(-1).pattern.params, { mode: 'free' }, 'free is stateable, not just the absence');
  assert.ok(!free.text.includes('params='), 'a free axis renders as the legacy row — it admits everything');
});

test('grants-grant: a query in the typed pattern means its names; malformed axes are errors', () => {
  const { registered, approval } = bootCommands();
  registered['grants-grant'].handler({ ...INV, rawInput: 'https://typed.example/v1/?lang=en' });
  assert.deepEqual(approval.store.sessionGrants.at(-1).pattern.params, { mode: 'allow', names: ['lang'] },
    'the operator typed the query meaning queries like it — names, never the value');
  const empty = registered['grants-grant'].handler({ ...INV, rawInput: 'https://t2.example/ params=allow()' });
  assert.equal(empty.kind, 'error');
  assert.match(empty.text, /admits nothing/);
  const wat = registered['grants-grant'].handler({ ...INV, rawInput: 'https://t3.example/ params=mostly' });
  assert.equal(wat.kind, 'error');
  assert.match(wat.text, /unknown params axis/);
});

// -- the prompter: the axis renders in the numbered choices -------------------------

test('prompter: an allow-axis offer renders its names in the choice row', async () => {
  const { createOperatorPrompter } = await import('../../../tools/operator-answerer.mjs');
  const transcript = [];
  const input = { isTTY: false, unref() {} };
  const view = {
    target: { host: 'api.example.com' },
    patternOffers: patternOffersFor(createApproval({}), { args: { url: 'https://api.example.com/v1/search?q=cats', methodClass: 'read' } }),
  };
  const prompt = createOperatorPrompter({
    input,
    output: { write: s => (transcript.push(s), true) },
    createInterface() {
      const rl = { on() {}, question(_t, cb) { queueMicrotask(() => cb('3')); }, close() {} };
      return rl;
    },
  });
  const outcome = await prompt({ toolName: 'net.fetch', callId: 'c1', reason: '[AG/x] r' }, view);
  assert.equal(outcome, 'allowed-once');
  assert.equal(view.patternChoice, view.patternOffers[0], 'the narrowest row was picked');
  assert.match(transcript.join(''), /3\) allow \+ cover UrlPrefix:https:\/\/api\.example\.com\/v1\/search\/ params=allow\(q\) — everything under .* query admits exactly the names this act carries \(q\), read \(1h, 50 uses\)/,
    'the choice row shows the axis on the LEAF row (#180), the scope, the class, the terms');
});
