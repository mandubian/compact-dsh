// R-6 in band — the law is readable BY THE SUBJECT, through the real dsh
// ToolRuntime, addressed by its digest. The service accessor (`body()`) is the
// Enforcer's access; this suite proves the Subject's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import {
  apply, readLaw, clauseText, CLAUSES, COMPACT_BODY, COMPACT_DIGEST, LAW_TOOL,
} from '../src/index.js';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

async function boot() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ToolRuntime);
  // the coupling roster and rule registry scoped out: this suite is about the
  // read path, and the constitution suite owns coupling
  apply(ctx, { requires: [], register: { meta: { compactDigest: COMPACT_DIGEST }, entries: [] } });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && !ctx.tools?.get?.(LAW_TOOL); i++) await new Promise(r => setImmediate(r));
  return ctx.tools;
}

const call = async (tools, args) => {
  const result = await tools.execute({ name: LAW_TOOL, arguments: args, callId: `c_${Math.random().toString(16).slice(2)}`, signal: new AbortController().signal });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return { value: String(result.value), rendered: result.content.map(c => c.text ?? '').join('') };
};

test('R-6: every clause of the body has its own text, sliced from the body', () => {
  for (const c of CLAUSES) {
    const text = clauseText(c.id);
    assert.ok(text, `${c.id} has text`);
    assert.ok(text.startsWith(`**${c.id} · [${c.force}]`), `${c.id} starts at its own header`);
    assert.ok(COMPACT_BODY.includes(text), `${c.id} is the body's own text, not a restatement`);
    assert.ok(!/\n#{1,6} |\n---\s*$/m.test(text), `${c.id} stops before the next heading or rule`);
    const others = CLAUSES.filter(o => o.id !== c.id && text.includes(`**${o.id} · `));
    assert.deepEqual(others.map(o => o.id), [], `${c.id} carries no other clause`);
  }
  assert.equal(clauseText('Z-99'), null);
});

test('R-6: the table of contents lists every clause under its section, and names the digest', () => {
  const toc = readLaw();
  assert.ok(toc.includes(COMPACT_DIGEST));
  for (const c of CLAUSES) assert.ok(toc.includes(`${c.id} · [${c.force}]`), c.id);
  assert.match(toc, /Part II — Rights\n {2}R-1 /);
  assert.match(toc, /NOT yet ratified/);
  assert.ok(toc.length < 6000, 'the default read is bounded — the body is opt-in');
});

test('R-6: a clause read is case-insensitive; an unknown id is answered, never refused or guessed', () => {
  assert.equal(readLaw({ clause: 'r-6' }), readLaw({ clause: 'R-6' }));
  const unknown = readLaw({ clause: 'R-99' });
  assert.match(unknown, /"R-99" is not a clause of the law in force/);
  assert.ok(!unknown.includes('**R-9 '), 'no near match is offered as if it were the text asked for');
});

test('R-6: addressed by its digest — a mismatched citation is an alarm, a matching one is silent', () => {
  assert.match(readLaw({ clause: 'D-1', citingDigest: 'f'.repeat(64) }), /\[R-6 ALARM\] You cited digest f{64}/);
  assert.ok(!readLaw({ clause: 'D-1', citingDigest: COMPACT_DIGEST }).includes('ALARM'));
});

test('composed: law_read is a tool in the real registry — the Subject can read the law in band', async () => {
  const tools = await boot();
  assert.ok(tools.get(LAW_TOOL), 'R-6 is exercisable by the Subject, not only by operator code');

  const toc = await call(tools, {});
  assert.ok(toc.value.includes(COMPACT_DIGEST));
  assert.equal(toc.rendered, toc.value, 'the model sees the answer, not the arguments object');

  const clause = await call(tools, { clause: 'R-6' });
  assert.ok(clause.value.includes(clauseText('R-6')));

  const full = await call(tools, { full: true });
  assert.ok(full.value.includes(COMPACT_BODY.trim()), 'the FULL text of the law, as R-6 says');

  const stale = await call(tools, { clause: 'R-6', citing_digest: 'a'.repeat(64) });
  assert.match(stale.value, /\[R-6 ALARM\]/);
});
