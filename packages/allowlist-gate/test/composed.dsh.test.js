// Composed test: boot the REAL ToolRuntime from @deepseek-ai/dsh-tools on a
// real Cordis context, register a probe tool, install our gate, and execute.
// This is the Phase 0 composed-profile check at the tool-runtime altitude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import * as gate from '../src/index.js';

let executed = false;
const probe = defineTool({
  name: 'net_probe',
  description: 'probe a host (compact-dsh composed test)',
  parameters: {
    host: { type: 'string', description: 'host to probe' },
  },
  output: {
    schema: { type: 'string' },
    render: (value) => [{ type: 'text', text: String(value) }],
  },
  async execute(args) { executed = true; return `probed ${args.host}`; },
});

// Minimal systemPrompt provider: ToolRuntime declares inject ['systemPrompt']
// and calls getSectionOrder/section/tools for its SDK guidance sections.
class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx, config) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return []; }
  section() { return undefined; }
  tools() { return undefined; }
}

async function boot() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ToolRuntime);
  gate.apply(ctx, { allowlist: ['api.example.com'] });
  if (typeof ctx.start === 'function') await ctx.start();
  let tools = ctx.tools ?? null;
  for (let i = 0; i < 200 && !tools; i++) {
    await new Promise(r => setImmediate(r));
    tools = ctx.tools ?? null;
  }
  if (!tools) throw new Error('tools runtime did not mount — systemPrompt dependency unresolved?');
  return { ctx, tools };
}

test('composed: real ToolRuntime boots with the gate installed', async () => {
  const { tools } = await boot();
  assert.ok(tools, 'tools runtime did not mount');
});

test('composed: uncovered host is denied by the gate before execution', async () => {
  const { tools } = await boot();
  tools.register(probe);
  executed = false;
  const result = await tools.execute({ name: 'net_probe', arguments: { host: 'evil.example' }, signal: new AbortController().signal });
  const s = JSON.stringify(result);
  assert.ok(!executed, 'a denied probe must not execute');
  assert.ok(s.includes('[AG-1]'), 'denial must carry the gate rule id — got: ' + s.slice(0, 300));
  assert.ok(s.includes('Lawful next moves'), 'denial must carry lawful next moves');
});

test('composed: allowed host passes the gate and executes', async () => {
  const { tools } = await boot();
  tools.register(probe);
  executed = false;
  const result = await tools.execute({ name: 'net_probe', arguments: { host: 'api.example.com' }, signal: new AbortController().signal });
  assert.ok(executed, 'an allowed probe must execute');
  const s = JSON.stringify(result);
  assert.ok(!s.includes('[AG-1]'), 'allowed probe must not carry a denial envelope');
});
