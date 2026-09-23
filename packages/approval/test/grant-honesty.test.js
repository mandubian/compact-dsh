// The gate and the wire say the same thing (#64, #65, #66): every grant the
// ask calls revocable is revocable by the operator, a replay never outlives
// the egress grant it rides with, and a pre-grant never suppresses the ask
// whose approval the mediator depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalPlugin, egressGrantsFor, coveringGrants, GrantStore } from '../src/index.js';
import { classCovers } from '../src/grants.js';

function fakeCtx() {
  const listeners = {};
  const cmds = {};
  const commands = { register: (d) => { cmds[d.name] = d; } };
  return {
    listeners, cmds,
    on: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
    // the grant commands mount through inject(['commands']) — the fake runs it
    inject: (deps, fn) => { if (deps.includes('commands')) fn({ commands }); },
    provide: () => {},
    emit: () => {},
    logger: { warn() {}, error() {} },
  };
}

function boot(opts = {}) {
  const ctx = fakeCtx();
  const apply = approvalPlugin(opts);
  apply(ctx, opts);
  const run = (name, rawInput, agent = AGENT) => ctx.cmds[name].handler({ rawInput, agent });
  const answer = (req, decision = 'allowed-once') => ctx.listeners['approval/request'][0](req, async () => decision);
  return { ctx, approval: apply.approval, run, answer };
}

const AGENT = { id: 's1' };
const SECRET_CALL = { command: 'curl -H "Authorization: Bearer $GH_TOKEN" https://api.example.com', url: 'https://api.example.com' };
const READ = { url: 'https://api.example.com/v1', host: 'api.example.com', methodClass: 'read' };
const WRITE = { url: 'https://api.example.com/v1', host: 'api.example.com', methodClass: 'write' };

// -- #64: secret grants are revocable by the operator ------------------------

test('#64: /grants-list shows live secret grants by name, never a value', async () => {
  const { approval, run, answer } = boot({ secretRefs: ['GH_TOKEN'] });
  approval.gate({ name: 'bash', arguments: SECRET_CALL, agent: AGENT, callId: 'c1' });
  await answer({ toolName: 'bash', agent: AGENT, callId: 'c1' });
  const [g] = approval.store.secretGrantsFor('s1');
  const list = run('grants-list', '').text;
  assert.match(list, /1 live secret grant\(s\):/);
  assert.ok(list.includes(`${g.id}  secret $GH_TOKEN  session=s1`), list);
});

test('#64: /grants-revoke reaches a secret grant, ends injection, and the command asks again', async () => {
  const { approval, run, answer } = boot({ secretRefs: ['GH_TOKEN'] });
  const ask = approval.gate({ name: 'bash', arguments: SECRET_CALL, agent: AGENT, callId: 'c1' });
  assert.match(ask.reason, /revocable/, 'the ask promises revocation — this suite holds it to that');
  await answer({ toolName: 'bash', agent: AGENT, callId: 'c1' });
  assert.equal(approval.gate({ name: 'bash', arguments: SECRET_CALL, agent: AGENT, callId: 'c2' }), null, 'the approved command replays');
  const [g] = approval.store.secretGrantsFor('s1');

  const out = run('grants-revoke', g.id);
  assert.equal(out.kind, 'success');
  assert.match(out.text, /secret grant .* \(\$GH_TOKEN\) revoked/);
  assert.deepEqual(approval.store.secretGrantsFor('s1'), [], 'the next confine carries no injection (the provider reads secretGrantsFor)');
  assert.equal(approval.gate({ name: 'bash', arguments: SECRET_CALL, agent: AGENT, callId: 'c3' })?.kind, 'ask',
    'the identical command asks again rather than replaying without its credential');
  assert.doesNotMatch(run('grants-list', '').text, /secret \$GH_TOKEN/);
  assert.equal(run('grants-revoke', g.id).kind, 'error', 'a revoked grant is not revoked twice');
});

test('#64: session grants still revoke exactly as before', () => {
  const { run } = boot({});
  const made = run('grants-grant', 'api.example.com 10');
  const id = made.text.match(/grant (sg_\w+)/)[1];
  assert.match(run('grants-revoke', id).text, /covered cached approvals killed/);
  assert.equal(run('grants-revoke', 'sec_nope').kind, 'error');
});

// -- #65: under proxy a replay lapses with its egress grant ------------------

test('#65: under proxy the exec-cache entry lives no longer than the egress grant, on one clock', async () => {
  const { approval, answer } = boot({ egress: 'proxy' });
  const ask = approval.gate({ name: 'bash', arguments: READ, agent: AGENT, callId: 'c1' });
  assert.match(ask.reason, /for 1h \(no longer than the egress grant it materializes, so both lapse together\)/,
    'the ask states the replay lifetime the wire can honour, not the 24h cache default');
  await answer({ toolName: 'bash', agent: AGENT, callId: 'c1' });
  const [grant] = egressGrantsFor(approval.store, 's1');
  const [[, entry]] = [...approval.store.cache.entries()];
  assert.equal(entry.expiresAt, grant.expiresAt, 'the replay and the wire lapse at the same instant');

  // past the grant: the identical call asks again (and that approval re-materializes the grant)
  const later = grant.expiresAt + 1;
  assert.equal(approval.store.cacheHit([...approval.store.cache.keys()][0], later), false);
  const v = approval.evaluate({ tool: 'bash', args: READ, root: 's1', session: 's1', now: later });
  assert.equal(v.verdict, 'pending-approval', 'never allowed-then-refused-expired');
});

test('#65: without an egress grant the cache keeps its own TTL (none posture, classless act)', async () => {
  for (const [opts, args] of [[{ egress: 'none' }, READ], [{ egress: 'proxy' }, { ...READ, methodClass: null }]]) {
    const { approval, answer } = boot({ ...opts, execCacheTtlMs: 24 * 3600_000 });
    const ask = approval.gate({ name: 'bash', arguments: args, agent: AGENT, callId: 'c1' });
    assert.match(ask.reason, /for 24h, across sessions/);
    assert.doesNotMatch(ask.reason, /lapse together/);
    const before = Date.now();
    await answer({ toolName: 'bash', agent: AGENT, callId: 'c1' });
    const [[, entry]] = [...approval.store.cache.entries()];
    assert.ok(entry.expiresAt >= before + 24 * 3600_000 - 5);
  }
});

// -- #66: the gate honours the method class ---------------------------------

test('#66: under proxy /grants-grant refuses a classless network grant and names the repair', () => {
  const { approval, run } = boot({ egress: 'proxy' });
  const out = run('grants-grant', 'api.example.com 30');
  assert.equal(out.kind, 'error');
  assert.match(out.text, /needs a method class/);
  assert.match(out.text, /read\|write/);
  assert.equal(approval.store.sessionGrants.length, 0, 'nothing minted');
});

test('#66: a classed pre-grant covers what the mediator would deliver, and nothing more', () => {
  const { approval, run } = boot({ egress: 'proxy' });
  const out = run('grants-grant', 'api.example.com read 30');
  assert.equal(out.kind, 'success');
  assert.match(out.text, /\(read\) for session s1 for 30min/);
  const [g] = approval.store.sessionGrants;
  assert.equal(g.methodClass, 'read');

  assert.equal(approval.gate({ name: 'bash', arguments: READ, agent: AGENT, callId: 'r' }), null, 'a read is covered');
  assert.equal(approval.gate({ name: 'bash', arguments: WRITE, agent: AGENT, callId: 'w' })?.kind, 'ask',
    'a write is not — the mediator would refuse it (method-class), so the gate asks');

  run('grants-grant', 'api.example.com write');
  assert.equal(approval.gate({ name: 'bash', arguments: WRITE, agent: AGENT, callId: 'w2' }), null, 'write covers writes');
});

test('#66: a classless network grant under proxy never suppresses the ask (store-level, e.g. a legacy row)', () => {
  const { approval } = boot({ egress: 'proxy' });
  approval.store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'api.example.com' }, session: 's1', ttlMs: 60_000, now: Date.now() });
  assert.equal(approval.gate({ name: 'bash', arguments: READ, agent: AGENT, callId: 'c' })?.kind, 'ask');
});

test('#66: outside proxy, classless grants cover as before; non-network targets are untouched', () => {
  const { approval, run } = boot({ egress: 'none' });
  const out = run('grants-grant', 'api.example.com');
  assert.equal(out.kind, 'success');
  assert.match(out.text, /changes the gate's answer, not the container's network/);
  assert.equal(approval.gate({ name: 'bash', arguments: READ, agent: AGENT, callId: 'c' }), null);

  const store = new GrantStore();
  const now = Date.now();
  store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/data', ceiling: 'ro' } }, session: 's1', ttlMs: 60_000, now });
  assert.equal(coveringGrants(store, { path: '/data/x', mode: 'ro' }, now, { egress: 'proxy' }).session.length, 1,
    'a mount target carries no method class — the axis does not apply');
});

test('#66: classCovers is the mediator\'s rule', () => {
  const net = { kind: 'ExactHost', value: 'h' };
  const g = (methodClass) => ({ pattern: net, methodClass });
  assert.equal(classCovers(g('write'), { methodClass: 'read' }), true);
  assert.equal(classCovers(g('write'), { methodClass: 'write' }), true);
  assert.equal(classCovers(g('write'), { methodClass: null }), true, 'write is the widest class');
  assert.equal(classCovers(g('read'), { methodClass: 'write' }), false);
  assert.equal(classCovers(g('read'), { methodClass: null }), false, 'an underivable act is not a read');
  assert.equal(classCovers(g(null), { methodClass: 'read' }, 'proxy'), false);
  assert.equal(classCovers(g(null), { methodClass: 'read' }, 'none'), true);
  assert.equal(classCovers(g(null), { host: 'h' }, 'proxy'), true, 'an unclassed act (no methodClass key) is unaffected');
});
