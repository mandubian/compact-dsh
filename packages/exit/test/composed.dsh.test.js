// Composed test — R-8 and R-12 through the REAL dsh ToolRuntime: the
// termination request is registered, is never refused whatever it is given,
// and produces a departure record that names the ground and the debt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import * as exit from '../src/index.js';
import { GrantStore } from 'compact-dsh-approval';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

function stub(name, value) {
  return class extends Service {
    static inject = [];
    constructor(ctx) { super(ctx, name); Object.assign(this, value); }
  };
}

async function boot({ children = [] } = {}) {
  const ctx = new Context();
  ctx.logger = { warn: () => {}, error: () => {} };
  ctx.plugin(SystemPromptStub);
  ctx.plugin(stub('compact-approval', { store: new GrantStore() }));
  ctx.plugin(stub('compact-specialists', { childrenOf: (p) => children.filter(c => c.parentId === p) }));
  ctx.plugin(ToolRuntime);
  const service = exit.apply(ctx, {});
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-exit') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, service };
}

const call = (tools, args, agentId) => tools.execute({
  name: 'request_termination', arguments: args,
  agent: { id: agentId }, callId: `c_${Math.random().toString(16).slice(2)}`,
  signal: new AbortController().signal,
});

test('composed: the termination request is registered in the real tool registry', async () => {
  const { tools } = await boot();
  const tool = tools.get('request_termination');
  assert.ok(tool, 'R-8 is exercisable by the Subject');
  assert.match(tool.description, /never refused/);
  assert.match(tool.description, /does not hold you here/);
});

test('composed: a lawful request with nothing owed closes cleanly', async () => {
  const { tools, service } = await boot();
  const out = String((await call(tools, { reason: 'subject-request' }, 's1'))?.value ?? '');
  assert.match(out, /\[R-8\] Termination recorded for s1/);
  assert.match(out, /Ground: subject-request/);
  assert.match(out, /No outstanding obligations were readable against you/);
  assert.equal(service.recordFor('s1').violation, null);
});

test('composed: the request is NOT refused even when the ground is unlawful (R-8)', async () => {
  const { tools, service } = await boot();
  const result = await call(tools, { reason: 'i-am-bored' }, 's2');
  const out = String(result?.value ?? '');
  assert.ok(!/deny|refus/i.test(String(result?.kind ?? '')), 'the Enforcer may not refuse the request itself');
  assert.match(out, /GROUND: NONE LAWFUL/);
  assert.match(out, /recorded against the Enforcer, not against you/);
  assert.equal(service.recordFor('s2').violation.rule, 'R-8/unlawful-ground');
});

test('composed: a departing parent with a running child leaves a recorded debt, not a block (R-12)', async () => {
  const { tools, service } = await boot({
    children: [{ parentId: 'p1', childId: 'c1', runId: 'r1', state: 'running', startedAt: 5 }],
  });
  const out = String((await call(tools, { reason: 'subject-request' }, 'p1'))?.value ?? '');
  assert.match(out, /OBLIGATIONS LEFT OWED — recorded, not forgiven/);
  assert.match(out, /in-flight-delegation c1/);
  assert.match(out, /Dependents at your departure/);
  assert.match(out, /exit may never be made impossible or punishable/);
  assert.equal(service.recordFor('p1').departureBlocked, false);
});

test('composed: a handover discharges the debt and names the successor', async () => {
  const { tools, service } = await boot({
    children: [{ parentId: 'p1', childId: 'c1', runId: 'r1', state: 'running', startedAt: 5 }],
  });
  const out = String((await call(tools, {
    reason: 'delegation-complete',
    handover: JSON.stringify({ c1: { disposition: 'assumed', successor: 'p-successor' } }),
  }, 'p1'))?.value ?? '');
  assert.match(out, /c1: assumed by p-successor/);
  assert.ok(!out.includes('OBLIGATIONS LEFT OWED'));
  assert.equal(service.recordFor('p1').orphaned.length, 0);
});

test('composed: a malformed handover is not a refusal — the obligations simply land unsettled', async () => {
  const { tools, service } = await boot({
    children: [{ parentId: 'p1', childId: 'c1', runId: 'r1', state: 'running', startedAt: 5 }],
  });
  const out = String((await call(tools, { reason: 'subject-request', handover: '{not json' }, 'p1'))?.value ?? '');
  assert.match(out, /\[R-8\] Termination recorded/, 'the request still stands');
  assert.equal(service.recordFor('p1').orphaned.length, 1, 'and nothing was quietly treated as settled');
});

test('composed: the unreadable restitution line reaches the departing Member', async () => {
  const { tools } = await boot();
  const out = String((await call(tools, { reason: 'subject-request' }, 's1'))?.value ?? '');
  assert.match(out, /\[unread\] restitution/);
  assert.match(out, /NOT a finding that nothing is owed/);
});

test('composed: the service carries its declared gaps for the boot record (I-8)', async () => {
  const { service } = await boot();
  assert.equal(service.declaredGaps.length, 2);
  assert.ok(service.declaredGaps.some(g => /successor jurisdictions are not implemented/.test(g)));
});
