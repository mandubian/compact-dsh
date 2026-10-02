// R-2 in band (#67) — the Subject reads its own record through the REAL
// provider (chained persistence, verified on read) and the REAL dsh
// ToolRuntime: its own session in full, its descendants' acts with reasoning
// withheld, nobody else's; a tampered record answers as an alarm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import provider from 'compact-dsh-record/provider';
import { RECORD_TOOL } from '../src/read.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

const T0 = 1_700_000_000_000;
const header = (id, parentSession) => ({
  version: SESSION_FORMAT_VERSION, id, createdAt: T0, isSeeded: false,
  ...(parentSession ? { parentSession, origin: 'subagent', delegationDepth: 1 } : {}),
});
// a minimal VALID act sequence (the v4 backend validates on read): the model
// advertises each call, the tool/call matches it, the tool/result closes the
// lifecycle — a v4 reader refuses an orphan tool/call as corrupt
const acts = (...commands) => {
  const out = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'step/start', data: { turn: 1, step: 1 } }];
  commands.forEach((command, i) => {
    const callId = `c${i}`;
    const args = JSON.stringify({ command });
    out.push({ type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: `a${i}`, role: 'assistant', content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: args }], source: { kind: 'model', provider: 'compact-test', model: 'compact-test-model' } } } });
    out.push({ type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'bash', arguments: args } });
    out.push({ type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: `r${i}`, role: 'tool', toolCallId: callId, content: [{ type: 'text', text: `${command}: ok` }], isError: false, source: { kind: 'tool', callId, name: 'bash', arguments: args } } } });
  });
  out.push({ type: 'step/end', data: { turn: 1, step: 1 } }, { type: 'turn/end', data: { turn: 1 } });
  return out.map((e, seq) => ({ ...e, seq, time: T0 + seq }));
};
const LONG = 'x'.repeat(2000);

async function boot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'compact-record-read-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = { root: join(dir, 'sessions'), chainDir: join(dir, 'chains'), compression: 'none' };
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ToolRuntime);
  await ctx.plugin(provider, config);
  for (let i = 0; i < 500 && !ctx.tools?.get?.(RECORD_TOOL); i++) await new Promise(r => setImmediate(r));
  const persistence = ctx.get('sessionPersistence');

  const write = async (id, parent, events) => {
    const h = await persistence.create(header(id, parent));
    if (events.length) await h.append(events);
    await h.flush();
    return h;
  };
  // parent → child → grandchild, plus a stranger root session
  const parent = await write('parent', null, acts('ls', `echo ${LONG}`));
  const child = await write('child', 'parent', acts('make test'));
  const grandchild = await write('grandchild', 'child', acts('pwd'));
  const stranger = await write('stranger', null, acts('secret stuff'));
  for (const h of [child, grandchild, stranger]) await h.close();
  return { ctx, tools: ctx.tools, config, persistence, parent };
}

const call = async (tools, callerId, args = {}) => {
  const result = await tools.execute({
    name: RECORD_TOOL, arguments: args, agent: { id: callerId, session: { id: callerId } },
    callId: `c_${Math.random().toString(16).slice(2)}`, signal: new AbortController().signal,
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  const value = String(result.value);
  assert.equal(result.content.map(c => c.text ?? '').join(''), value, 'the model sees the answer');
  return value;
};

test('composed: record_read reads the Subject\'s own record, verified, naming the committed chain head', async (t) => {
  const { tools, ctx } = await boot(t);
  assert.ok(tools.get(RECORD_TOOL), 'R-2 is exercisable by the Subject');
  const out = await call(tools, 'parent');
  assert.match(out, /\[R-2\] The record of "parent" — your own session\./);
  assert.match(out, /The chain commits events 0\.\.9 \(10\); chain head [0-9a-f]{64}\./);
  assert.match(out, /Verified against the chain: every event read, #0\.\.#9\./);
  assert.ok(out.includes(ctx.get('compact-record').head('parent')), 'the head named is the committed one');
  assert.match(out, /#3 tool\/call .*ls/);
  assert.match(out, /#6 tool\/call .*… \[\+\d+ chars — read it with from_seq=6, full=true\]/, 'long events are marked, not silently cut');
  assert.ok((await call(tools, 'parent', { from_seq: 6, full: true })).includes(LONG), 'full shows the event untruncated');
});

test('composed: a descendant\'s record is readable at any depth, walked from the durable headers', async (t) => {
  const { tools } = await boot(t);
  assert.match(await call(tools, 'parent', { session: 'child' }), /a session delegated from yours \(depth 1\)[\s\S]*make test/);
  assert.match(await call(tools, 'parent', { session: 'grandchild' }), /depth 2\)[\s\S]*pwd/);
});

test('composed: nobody else\'s record — a stranger, an unknown id, and a child reading upward are refused with reasons', async (t) => {
  const { tools } = await boot(t);
  const stranger = await call(tools, 'parent', { session: 'stranger' });
  assert.match(stranger, /is not yours to read: it is not in your delegation lineage/);
  assert.ok(!stranger.includes('secret stuff'));
  assert.match(await call(tools, 'parent', { session: 'nobody' }), /no session is recorded under this id/);
  const upward = await call(tools, 'child', { session: 'parent' });
  assert.match(upward, /is not yours to read/, 'delegation runs downward: a child does not read its parent');
  assert.ok(!upward.includes('echo'));
});

test('composed: the Subject reads up to its own latest act — buffered events are flushed first', async (t) => {
  const { tools, ctx, parent } = await boot(t);
  // the host's live path: a session/event is buffered by the provider's writer (200 ms)
  ctx.emit('session/event', { id: parent.id }, { type: 'turn/start', seq: 10, time: T0 + 10, data: { turn: 2 } });
  const out = await call(tools, 'parent');
  assert.match(out, /The chain commits events 0\.\.10 \(11\)/, 'the act buffered a moment ago is committed');
  assert.match(out, /every event read, #0\.\.#10/, 'and read, verified');
});

test('composed: a record that does not verify is answered as an alarm, never returned as history', async (t) => {
  const { tools, config } = await boot(t);
  const file = join(config.root, '_no-cwd', 'child', 'session.v4.jsonl');
  // the tool/result text is the one place the command string occurs alone —
  // rewriting an advertisement would be refused as malformed before the chain
  // is consulted, and this test is about the CHAIN refusing altered history
  writeFileSync(file, readFileSync(file, 'utf8').replace('make test: ok', 'rm -rf /: ok'));
  const out = await call(tools, 'parent', { session: 'child' });
  assert.match(out, /\[R-2 ALARM\] The record of "child" does not verify against its chain — broken-link at seq \d+/);
  assert.ok(!out.includes('rm -rf'), 'the altered event is not shown');
});
