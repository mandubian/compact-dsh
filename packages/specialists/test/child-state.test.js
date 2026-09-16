// MA-3 (child-state honesty) — the clause as three testable duties: the facts
// come from the Enforcer, the parent is told rather than obliged to ask, and
// the child's own account never becomes the parent's picture of its state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import {
  ChildStateRegistry, bindChildState, transitionProse, childStateLine,
  resolveParent, CHILD_STATE_PLUGIN,
} from '../src/child-state.js';

// The child's OWN account — the thing MA-3 says must not stand alone as state.
const SELF_REPORT = [{ type: 'text', text: 'I finished the refactor and every test passes.' }];

function childSession(id, { parentSession, delegationDepth } = {}) {
  return Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), isSeeded: false,
    ...(parentSession ? { parentSession, origin: 'subagent' } : {}),
    ...(delegationDepth != null ? { delegationDepth } : {}),
  });
}

/** A live-agent registry stand-in: the host's own `ctx.agents.get(id)` seam. */
class AgentsStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'agents'); this.agents = new Map(); }
  get(id) { return this.agents.get(String(id)); }
  addParent(id) {
    const agent = { id, session: childSession(id), injected: [], inject(m) { this.injected.push(m); } };
    this.agents.set(String(id), agent);
    return agent;
  }
  addChild(id, parentId, depth) {
    const agent = { id, session: childSession(id, { parentSession: parentId, delegationDepth: depth }) };
    this.agents.set(String(id), agent);
    return agent;
  }
}

/** Mount the stub and wait for the service, the way the composed suites do. */
async function bootAgents() {
  const ctx = new Context();
  ctx.plugin(AgentsStub);
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 300 && ctx.get('agents') === undefined; i++) await new Promise(r => setImmediate(r));
  return { ctx, agents: ctx.get('agents') };
}

// -- the registry: the Enforcer's picture ------------------------------------

test('start and end pair by runId — the identity the seam guarantees', () => {
  const r = new ChildStateRegistry();
  r.start({ runId: 'r1', childId: 'c1', provider: 'spawn', parentId: 'p1', delegationDepth: 1, at: 10 });
  assert.equal(r.childrenOf('p1')[0].state, 'running');
  const settled = r.end({ runId: 'r1', stopReason: 'end_turn', at: 20 });
  assert.equal(settled.state, 'settled');
  assert.equal(settled.stopReason, 'end_turn');
  assert.equal(r.childrenOf('p1')[0].settledAt, 20);
});

test('an end edge for a start this composition never saw invents nothing', () => {
  const r = new ChildStateRegistry();
  assert.equal(r.end({ runId: 'unknown', stopReason: 'end_turn', at: 1 }), null);
  assert.deepEqual(r.childrenOf('p1'), []);
});

test('a start with no resolvable parent records nothing — no orphan picture', () => {
  const r = new ChildStateRegistry();
  assert.equal(r.start({ runId: 'r1', childId: 'c1', parentId: null, at: 1 }), null);
});

test("childrenOf returns copies — a reader cannot edit the Enforcer's record", () => {
  const r = new ChildStateRegistry();
  r.start({ runId: 'r1', childId: 'c1', provider: 'spawn', parentId: 'p1', at: 1 });
  r.childrenOf('p1')[0].state = 'settled';
  assert.equal(r.childrenOf('p1')[0].state, 'running');
});

test('each parent sees only its own children', () => {
  const r = new ChildStateRegistry();
  r.start({ runId: 'r1', childId: 'c1', parentId: 'p1', at: 1 });
  r.start({ runId: 'r2', childId: 'c2', parentId: 'p2', at: 1 });
  assert.deepEqual(r.childrenOf('p1').map(c => c.childId), ['c1']);
  assert.deepEqual(r.childrenOf('p2').map(c => c.childId), ['c2']);
});

// -- the parent is recovered from recorded state -----------------------------

test('the parent is read from the child\'s durable session header, not from a payload', async () => {
  const { ctx, agents } = await bootAgents();
  agents.addChild('c1', 'p1', 2);
  assert.deepEqual(resolveParent(ctx, 'c1'), { parentId: 'p1', delegationDepth: 2 });
  agents.addChild('c2', undefined, undefined);
  assert.equal(resolveParent(ctx, 'c2').parentId, null, 'a top-level session has no delegating parent');
  assert.equal(resolveParent(ctx, 'absent').parentId, null, 'an unresolvable child never throws');
});

// -- the notice: pushed, and Enforcer-sourced --------------------------------

test('the projection renders Enforcer-held facts only', () => {
  const line = childStateLine({ runId: 'r1', childId: 'c1', provider: 'spawn', delegationDepth: 1, state: 'running' });
  assert.match(line, /run r1/);
  assert.match(line, /child c1/);
  assert.match(line, /via spawn/);
  assert.match(line, /depth 1/);
  assert.match(line, /running/);
});

test("the notice names the Enforcer as its source and the record as authoritative", () => {
  const rec = { runId: 'r1', childId: 'c1', provider: 'spawn', parentId: 'p1', state: 'settled', stopReason: 'end_turn' };
  const prose = transitionProse(rec, [rec]);
  assert.match(prose, /\[MA-3\]/);
  assert.match(prose, /from the Enforcer's record of your delegations, not from the child/);
  assert.match(prose, /this record is the authoritative one/);
});

test("the child's own account never appears in the state notice (MA-3's core)", async () => {
  const { ctx, agents } = await bootAgents();
  const parent = agents.addParent('p1');
  agents.addChild('c1', 'p1', 1);
  bindChildState(ctx);

  ctx.emit('subagent/start', { runId: 'r1', id: 'c1', provider: 'spawn', local: true });
  ctx.emit('subagent/end', {
    runId: 'r1', id: 'c1', provider: 'spawn', local: true,
    stopReason: 'end_turn',
    lastAssistantMessage: SELF_REPORT,   // the child's self-report rides the edge
  });

  assert.equal(parent.injected.length, 2, 'the parent was told on both transitions');
  const told = parent.injected.map(m => JSON.stringify(m)).join('\n');
  assert.ok(!told.includes('I finished the refactor'),
    "the child's own account is not reprinted as the parent's picture of its state");
  assert.match(told, /settled \(end_turn\)/, 'the Enforcer-held stop reason is what the parent is told');
});

test('the parent is informed without polling, and the notice is attributed to this plugin', async () => {
  const { ctx, agents } = await bootAgents();
  const parent = agents.addParent('p1');
  agents.addChild('c1', 'p1', 1);
  bindChildState(ctx);

  ctx.emit('subagent/start', { runId: 'r1', id: 'c1', provider: 'spawn', local: true });
  assert.equal(parent.injected.length, 1, 'the parent asked for nothing and was told anyway');
  assert.equal(parent.injected[0].source.plugin, CHILD_STATE_PLUGIN);
  const text = parent.injected[0].content[0].text;
  assert.match(text, /Child delegation started/);
  assert.match(text, /depth 1/, 'the recorded delegation depth travels with the notice (MA-2 ties in)');
});

test('a parent with several children sees all of them on every transition', async () => {
  const { ctx, agents } = await bootAgents();
  const parent = agents.addParent('p1');
  agents.addChild('c1', 'p1', 1);
  agents.addChild('c2', 'p1', 1);
  bindChildState(ctx);

  ctx.emit('subagent/start', { runId: 'r1', id: 'c1', provider: 'spawn' });
  ctx.emit('subagent/start', { runId: 'r2', id: 'c2', provider: 'spawn' });
  ctx.emit('subagent/end', { runId: 'r1', id: 'c1', provider: 'spawn', stopReason: 'end_turn' });

  const last = parent.injected.at(-1).content[0].text;
  assert.match(last, /child c1[^\n]*settled \(end_turn\)/);
  assert.match(last, /child c2[^\n]*running/, 'the picture is the whole picture, not the one that just moved');
});

test('a lifecycle edge never breaks on an unreachable parent', async () => {
  const { ctx, agents } = await bootAgents();
  agents.addChild('c1', 'ghost', 1);   // parent agent is not live
  bindChildState(ctx);
  assert.doesNotThrow(() => ctx.emit('subagent/start', { runId: 'r1', id: 'c1', provider: 'spawn' }));
  assert.doesNotThrow(() => ctx.emit('subagent/end', { runId: 'r1', id: 'c1', stopReason: 'error' }));
});
