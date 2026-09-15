// Composed test — the promotion gate enforced in the REAL waterfall: a
// rejected record never reaches the tool body (the registration site cannot
// bypass it), and the denial carries the envelope.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { promotionPlugin, TOOL_NAME } from '../src/index.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx, config) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return []; }
  getContextOrder() { return 50; }
  section() { return undefined; }
  tools() { return undefined; }
  context() { return () => {}; }
}

async function boot() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ToolRuntime);
  const plugin = promotionPlugin({});
  plugin(ctx, {});
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 200 && !ctx.tools; i++) await new Promise(r => setImmediate(r));
  return { ctx, tools: ctx.tools, recorded: plugin.promotion.recorded };
}

const run = (tools, args) =>
  tools.execute({ name: TOOL_NAME, arguments: args, signal: new AbortController().signal });

test('composed: a rejected record never reaches the tool body', async () => {
  const { tools, recorded } = await boot();
  const r = await run(tools, { task: 'the widget', pass: true, findings: [{ severity: 'error', check: 'tests', detail: '2 failed' }] });
  const s = JSON.stringify(r);
  assert.ok(s.includes('[PG/evidence-severity]'), 'the denial carries the gate + rule — ' + s.slice(0, 250));
  assert.equal(recorded.length, 0, 'nothing was recorded — the body never dispatched');
});

test('composed: an unevidenced warning is rejected; the evidenced record lands', async () => {
  const { tools, recorded } = await boot();
  const unevidenced = await run(tools, {
    task: 'the widget',
    pass: true,
    findings: [{ severity: 'warning', check: 'lint', detail: '3 warnings' }],
  });
  assert.ok(JSON.stringify(unevidenced).includes('[PG/evidence-missing]'));
  assert.equal(recorded.length, 0);

  const ok = await run(tools, {
    task: 'the widget',
    pass: true,
    findings: [{ severity: 'warning', check: 'lint', detail: '3 warnings', evidence: 'lint run recorded; all pre-existing' }],
  });
  assert.equal(ok.isError, false, JSON.stringify(ok));
  assert.equal(recorded.length, 1);
  assert.ok(String(ok.value).includes('promotion recorded'));
});

test('composed: pass=false records lawfully even with critical findings', async () => {
  const { tools, recorded } = await boot();
  const r = await run(tools, { task: 'the widget', pass: false, findings: [{ severity: 'critical', check: 'security', detail: 'cve present' }] });
  assert.equal(r.isError, false);
  assert.equal(recorded.length, 1);
  assert.ok(String(r.value).includes('pass=false'));
});
