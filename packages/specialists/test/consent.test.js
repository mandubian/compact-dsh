// MA-4 (consent-scoped address) — another Subject's context is not a commons.
// Address is gated against the recipient's declared scopes, refusals are
// attributed and lawful (R-9), and only the recipient may narrow a scope over
// its own attention.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import {
  ConsentScopeRegistry, bindConsentScopes, consentTools, gateAddress,
  addressRefusal, ADDRESS_TOOLS, ADDRESS_KINDS, GATE,
} from '../src/consent.js';
import { resolveParent } from '../src/child-state.js';

const reg = () => new ConsentScopeRegistry();

function childSession(id, parentSession) {
  return Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), isSeeded: false,
    ...(parentSession ? { parentSession, origin: 'subagent', delegationDepth: 1 } : {}),
  });
}

class AgentsStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'agents'); this.agents = new Map(); }
  get(id) { return this.agents.get(String(id)); }
  add(id, parentId) {
    const a = { id, session: childSession(id, parentId) };
    this.agents.set(String(id), a);
    return a;
  }
}

async function bootAgents() {
  const ctx = new Context();
  ctx.plugin(AgentsStub);
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 300 && ctx.get('agents') === undefined; i++) await new Promise(r => setImmediate(r));
  return { ctx, agents: ctx.get('agents') };
}

// -- the surface being gated -------------------------------------------------

test('the gated surface is exactly the host tools that reach another Subject', () => {
  assert.deepEqual([...ADDRESS_TOOLS.keys()], ['send_message', 'interrupt_agent']);
  assert.deepEqual(ADDRESS_KINDS, ['message', 'interrupt']);
});

// -- the default scope is a recorded act, not an assumption ------------------

test('a delegation declares the reciprocal scope, with the act that is its basis', () => {
  const r = reg();
  r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  const overChild = r.scopesOver('c');
  assert.equal(overChild.length, 1);
  assert.equal(overChild[0].sender, 'p');
  assert.match(overChild[0].basis, /delegation that created this child \(MA-1\)/);
  assert.equal(r.scopesOver('p')[0].sender, 'c', 'the parent solicited the child, so the child may answer');
});

test('an unrelated Subject is covered by nothing', () => {
  const r = reg();
  r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  assert.equal(r.covering({ recipient: 'c', sender: 'stranger', kind: 'message' }).length, 0);
});

// -- the gate ----------------------------------------------------------------

test('address inside a live scope passes', () => {
  const r = reg();
  r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  assert.equal(gateAddress(r, { toolName: 'send_message', senderId: 'p', recipientId: 'c' }), null);
  assert.equal(gateAddress(r, { toolName: 'interrupt_agent', senderId: 'p', recipientId: 'c' }), null);
});

test('unconsented address is denied, attributed, and told the refusal is lawful (R-9)', () => {
  const r = reg();
  const d = gateAddress(r, { toolName: 'send_message', senderId: 'stranger', recipientId: 'c' });
  assert.equal(d.kind, 'deny');
  assert.match(d.reason, new RegExp(`\\[${GATE}/MA-4/unconsented-address\\]`));
  assert.match(d.reason, /^\[CS\/MA-4\/unconsented-address\] stranger would send a message to c/);
  assert.match(d.reason, /not a commons/);
  assert.match(d.reason, /lawful and carries no fault for either party \(R-9\)/);
  assert.match(d.reason, /Lawful next moves:/);
});

test('an address act that cannot be attributed fails closed (D-7)', () => {
  const r = reg();
  const noAuthor = gateAddress(r, { toolName: 'send_message', senderId: null, recipientId: 'c' });
  assert.match(noAuthor.reason, /MA-4\/unattributable-address/);
  assert.match(noAuthor.reason, /no author/);
  const noTarget = gateAddress(r, { toolName: 'send_message', senderId: 'p', recipientId: null });
  assert.match(noTarget.reason, /no target/);
});

test("a Subject's own attention is its own", () => {
  assert.equal(gateAddress(reg(), { toolName: 'send_message', senderId: 'a', recipientId: 'a' }), null);
});

test('tools that are not address acts are not this gate\'s business', () => {
  assert.equal(gateAddress(reg(), { toolName: 'bash', senderId: 'p', recipientId: 'c' }), null);
});

// -- narrowing and withdrawal belong to the recipient ------------------------

test('only the recipient may narrow a scope over its own attention', () => {
  const r = reg();
  const [overChild] = r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  assert.match(r.withdraw({ id: overChild.id, by: 'p', at: 2 }).error, /only the recipient narrows a scope over itself/);
  assert.equal(r.covering({ recipient: 'c', sender: 'p', kind: 'message' }).length, 1, 'the sender\'s attempt changed nothing');
  assert.ok(r.withdraw({ id: overChild.id, by: 'c', at: 2 }).scope.withdrawnAt);
  assert.equal(r.covering({ recipient: 'c', sender: 'p', kind: 'message' }).length, 0);
});

test('withdrawal is honored by the gate: the parent can no longer reach the child', () => {
  const r = reg();
  const [overChild] = r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  r.withdraw({ id: overChild.id, by: 'c', at: 2 });
  assert.match(gateAddress(r, { toolName: 'send_message', senderId: 'p', recipientId: 'c' }).reason, /unconsented-address/);
  assert.equal(gateAddress(r, { toolName: 'send_message', senderId: 'c', recipientId: 'p' }), null,
    'the reciprocal scope is separate — withdrawing one does not withdraw the other');
});

test('narrowing keeps what the recipient chose and drops the rest', () => {
  const r = reg();
  const [overChild] = r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  const narrowed = r.narrow({ id: overChild.id, by: 'c', kinds: ['message'], at: 2 }).scope;
  assert.deepEqual(narrowed.kinds, ['message']);
  assert.equal(gateAddress(r, { toolName: 'send_message', senderId: 'p', recipientId: 'c' }), null);
  assert.match(gateAddress(r, { toolName: 'interrupt_agent', senderId: 'p', recipientId: 'c' }).reason, /unconsented-address/);
});

test('narrowing to nothing IS withdrawal, and a no-op narrowing is refused as one', () => {
  const r = reg();
  const [overChild] = r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  assert.match(r.narrow({ id: overChild.id, by: 'c', kinds: ADDRESS_KINDS, at: 2 }).error, /narrowing must remove something/);
  assert.ok(r.narrow({ id: overChild.id, by: 'c', kinds: [], at: 3 }).scope.withdrawnAt);
});

test('a withdrawn scope is recorded, never deleted', () => {
  const r = reg();
  const [overChild] = r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  r.withdraw({ id: overChild.id, by: 'c', at: 2 });
  const recorded = r.scopesOver('c');
  assert.equal(recorded.length, 1, 'the scope is still on the record');
  assert.equal(recorded[0].withdrawnAt, 2);
});

// -- composed: the delegation edge declares, the waterfall gates -------------

test('composed: the spawn edge declares the scope and the waterfall enforces it', async () => {
  const { ctx, agents } = await bootAgents();
  agents.add('p');
  agents.add('c', 'p');
  agents.add('outsider');
  const registry = bindConsentScopes(ctx, { resolveParent });

  ctx.emit('subagent/start', { runId: 'r1', id: 'c', provider: 'spawn' });
  assert.equal(registry.scopesOver('c').length, 1, 'the delegation declared the scope');

  const parentToChild = await ctx.waterfall('tools/pre-execute',
    { name: 'send_message', arguments: { agent_id: 'c', message: 'refine it' }, agent: { id: 'p' } },
    () => ({ kind: 'pass' }));
  assert.equal(parentToChild.kind, 'pass', 'the delegating parent may address its own child');

  const outsiderToChild = await ctx.waterfall('tools/pre-execute',
    { name: 'send_message', arguments: { agent_id: 'c', message: 'do this instead' }, agent: { id: 'outsider' } },
    () => ({ kind: 'pass' }));
  assert.equal(outsiderToChild.kind, 'deny');
  assert.match(outsiderToChild.reason, /unconsented-address/);

  const ordinary = await ctx.waterfall('tools/pre-execute',
    { name: 'bash', arguments: { command: 'ls' }, agent: { id: 'outsider' } },
    () => ({ kind: 'pass' }));
  assert.equal(ordinary.kind, 'pass', 'the gate touches only address acts');
});

// -- the recipient's own surface --------------------------------------------

test('a Subject can list and withdraw the scopes over its own attention', async () => {
  const { defineTool } = await import('@deepseek-ai/dsh-tools');
  const r = reg();
  const [overChild] = r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  const [list, withdraw] = consentTools(r, { defineTool, now: () => 5 });

  assert.equal(list.name, 'consent_scopes');
  assert.match(await list.execute({}, { agent: { id: 'c' } }), /cs_\d+ — p may message\/interrupt/);
  assert.match(await list.execute({}, { agent: { id: 'outsider' } }), /No consent scope is declared over your attention/);

  assert.match(await withdraw.execute({ scope_id: overChild.id, keep_kinds: 'message' }, { agent: { id: 'c' } }),
    /narrowed: p may now only message/);
  assert.match(await withdraw.execute({ scope_id: overChild.id }, { agent: { id: 'c' } }),
    /withdrawn: p may no longer address you/);
});

test("a Subject cannot withdraw someone else's protection", async () => {
  const { defineTool } = await import('@deepseek-ai/dsh-tools');
  const r = reg();
  const [overChild] = r.declareDelegation({ parentId: 'p', childId: 'c', at: 1 });
  const [, withdraw] = consentTools(r, { defineTool, now: () => 5 });
  await assert.rejects(() => withdraw.execute({ scope_id: overChild.id }, { agent: { id: 'p' } }),
    /only the recipient narrows a scope over itself/);
});

test('the refusal envelope always names a lawful next move', () => {
  const env = addressRefusal({ sender: 'x', recipient: 'y', act: { kind: 'message', verb: 'send a message to' } });
  assert.equal(env.gate, GATE);
  assert.equal(env.ruleId, 'MA-4/unconsented-address');
  assert.ok(env.lawfulNextMoves.length >= 3);
});
