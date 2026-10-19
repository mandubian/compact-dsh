// Composed test — the forum through the REAL dsh ToolRuntime: two members
// speak on one topic, the ledger beside the chains is written, and the post
// names the citation coordinates judicature accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import * as forumPlugin from '../src/index.js';
import { parseCitations } from 'compact-dsh-judicature';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

class AgentsStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'agents'); this.agents = new Map(); }
  get(id) { return this.agents.get(String(id)); }
  add(id) {
    const a = { id, injected: [], inject(m) { this.injected.push(m); } };
    this.agents.set(String(id), a);
    return a;
  }
}

async function boot(config = {}) {
  const ctx = new Context();
  ctx.logger = { warn: (m) => ctx.logger.warns.push(String(m)), error: () => {} };
  ctx.logger.warns = [];
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ToolRuntime);
  const service = forumPlugin.apply(ctx, config);
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-forum') === undefined); i++) {
    await new Promise((r) => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, agents: ctx.get('agents'), service };
}

const call = (tools, name, args, agent) => tools.execute({
  name, arguments: args, agent, callId: `c_${Math.random().toString(16).slice(2)}`,
  signal: new AbortController().signal,
});
const text = (r) => String(r?.value ?? r ?? '');

test('composed: both tools are registered in the real tool registry, ungated', async () => {
  const { tools } = await boot();
  for (const n of ['forum_post', 'forum_read']) assert.ok(tools.get(n), `${n} is reachable`);
  assert.match(tools.get('forum_post').description, /lands on YOUR record/i);
});

test('composed: two members post to one topic and each reads the other', async () => {
  const { tools, agents, service } = await boot();
  const m1 = agents.add('session-alpha');
  const m2 = agents.add('session-beta');
  const p1 = text(await call(tools, 'forum_post', { topic: 'Nightly-Export', text: 'the packed manifest is ready' }, m1));
  const p2 = text(await call(tools, 'forum_post', { topic: 'nightly-export', text: 'seen — shipping after verify' }, m2));
  assert.match(p1, /\[forum\] fp_1 posted to nightly-export \(1 post\(s\) in topic\)/);
  assert.match(p2, /\[forum\] fp_2 posted to nightly-export \(2 post\(s\) in topic\)/);
  // the post names the poster's own record as the citation's home
  assert.match(p1, /cite it as session-alpha:<fromSeq>-<toSeq>/);
  // attribution is the caller the runtime handed the call, not a claim in the text
  assert.equal(service.forum.posts[0].by, 'session-alpha');
  assert.equal(service.forum.posts[1].by, 'session-beta');
  const read = text(await call(tools, 'forum_read', { topic: 'nightly-export' }, m1));
  assert.match(read, /fp_1 · nightly-export · session-alpha/);
  assert.match(read, /fp_2 · nightly-export · session-beta/);
  assert.match(read, /through fp_2 — read newer posts with since:2/);
  const since = text(await call(tools, 'forum_read', { topic: 'nightly-export', since: 1 }, m2));
  assert.doesNotMatch(since, /fp_1 ·/);
  assert.match(since, /fp_2 ·/);
});

test('composed: the citation coordinates the post names are the shape judicature parses', async () => {
  const { tools, agents } = await boot();
  const m = agents.add('session-gamma');
  const out = text(await call(tools, 'forum_post', { topic: 't', text: 'x' }, m));
  assert.match(out, /cite it as session-gamma:<fromSeq>-<toSeq>/);
  // the shape the post teaches is the shape the filing door accepts — the
  // seq range itself comes from record_read on the poster's own chain
  const parsed = parseCitations('session-gamma:12-14');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].session, 'session-gamma');
  assert.deepEqual([parsed[0].fromSeq, parsed[0].toSeq], [12, 14]);
});

test('composed: the ledger beside the chains gets one JSONL line per post', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-ledger-'));
  const ledgerPath = join(dir, 'forum.jsonl');
  const { tools, agents } = await boot({ ledgerPath });
  const m1 = agents.add('s1');
  const m2 = agents.add('s2');
  await call(tools, 'forum_post', { topic: 'a', text: 'one' }, m1);
  await call(tools, 'forum_post', { topic: 'b', text: 'two' }, m2);
  const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].id, 'fp_1');
  assert.equal(lines[0].by, 's1');
  assert.equal(lines[1].topic, 'b');
});

test('composed: invalid posts are refused with the rule, and post nothing anywhere', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-ledger-'));
  const { tools, agents, service } = await boot({ ledgerPath: join(dir, 'forum.jsonl') });
  const m = agents.add('s1');
  const badTopic = text(await call(tools, 'forum_post', { topic: 'not a topic', text: 'x' }, m));
  assert.match(badTopic, /\[forum\] not posted: "not a topic" is not a forum topic/);
  const empty = text(await call(tools, 'forum_post', { topic: 't', text: '   ' }, m));
  assert.match(empty, /\[forum\] not posted: a post needs text/);
  assert.equal(service.forum.posts.length, 0);
  assert.equal(service.snapshot().stats.posts, 0);
});

test('composed: pull-only — the plugin injects nothing into anyone’s attention', async () => {
  const { tools, agents, ctx } = await boot();
  const m1 = agents.add('s1');
  const m2 = agents.add('s2');
  await call(tools, 'forum_post', { topic: 't', text: 'hello' }, m1);
  assert.equal(m2.injected.length, 0, 'the reader is never told');
  assert.equal(m1.injected.length, 0, 'nor is the poster');
  assert.equal(ctx.logger.warns.filter((w) => /push|inject/.test(w)).length, 0);
});

test('composed: no ledger configured says so at boot, loudly', async () => {
  const { ctx } = await boot();
  assert.ok(ctx.logger.warns.some((w) => /no ledger path configured — the forum runs in memory only/.test(w)));
  assert.ok(ctx.logger.warns.some((w) => /LEDGER IS THE READABLE COPY/.test(w)));
});

test('composed: onPost feeds the live readers (the observatory’s seam), a throwing listener never blocks a post', async () => {
  const { tools, agents, service } = await boot();
  const seen = [];
  service.onPost((p) => seen.push(p.id));
  service.onPost(() => { throw new Error('reader crashed'); });
  const m = agents.add('s1');
  const out = text(await call(tools, 'forum_post', { topic: 't', text: 'x' }, m));
  assert.match(out, /fp_1 posted/);
  assert.deepEqual(seen, ['fp_1']);
});

// ── resumption (#227): a restarted run reads the ledger back, continues the
// numbering, and survives a crash's torn tail with the repair named ──

const LEDGER_ROW = (seq, over = {}) => JSON.stringify({ id: `fp_${seq}`, seq, topic: 'nightly', by: 'session-old', at: '2026-10-18T23:00:00.000Z', text: `from the run before the restart (${seq})`, ...over });

test('composed: a restarted run replays the ledger — the board resumes, numbering continues, the file grows cleanly (#227)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledgerPath = join(dir, 'forum.jsonl');
  writeFileSync(ledgerPath, `${LEDGER_ROW(1)}\n${LEDGER_ROW(2, { topic: 'meta' })}\n`);
  const { ctx, tools, agents, service } = await boot({ ledgerPath });
  assert.ok(ctx.logger.warns.some((w) => /replayed 2 post\(s\) from the ledger — the board resumes at fp_2/.test(w)),
    'the resumption is said at boot');
  const reader = agents.add('session-new');
  const board = text(await call(tools, 'forum_read', {}, reader));
  assert.match(board, /meta — 1 post\(s\), last fp_2/);
  const read = text(await call(tools, 'forum_read', { topic: 'nightly' }, reader));
  assert.match(read, /from the run before the restart \(1\)/);
  // posting continues at fp_3 — no second fp_1 in the ledger, ever
  const posted = text(await call(tools, 'forum_post', { topic: 'nightly', text: 'the first post after the restart' }, reader));
  assert.match(posted, /fp_3 posted to nightly/);
  const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[2]).id, 'fp_3');
  assert.equal(service.forum.posts.length, 3);
});

test('composed: a torn tail from a killed run is repaired at boot, the repair named (#227)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledgerPath = join(dir, 'forum.jsonl');
  // fp_1 finished; fp_2's line was half-written when the run was killed
  const torn = `${LEDGER_ROW(1)}\n${LEDGER_ROW(2).slice(0, 40)}`;
  writeFileSync(ledgerPath, torn);
  const { ctx, tools, agents } = await boot({ ledgerPath });
  assert.ok(ctx.logger.warns.some((w) => /repaired the torn tail of the ledger \(40 unfinished byte/.test(w)),
    'the repair is named, never silent');
  // the board carries the clean prefix; posting rewrites the tail cleanly
  const posted = text(await call(tools, 'forum_post', { topic: 'nightly', text: 'back after the crash' }, agents.add('session-new')));
  assert.match(posted, /fp_2 posted to nightly/);
  const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2, 'the file is clean JSONL again');
  assert.equal(JSON.parse(lines[1]).text, 'back after the crash');
  const read = text(await call(tools, 'forum_read', { topic: 'nightly' }, agents.add('s')));
  assert.match(read, /from the run before the restart \(1\)/);
  assert.match(read, /back after the crash/);
});

test('composed: a ledger line that cannot replay stops the replay loudly at that line (#227)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledgerPath = join(dir, 'forum.jsonl');
  // fp_1 fine; then a GAP (fp_9) — a hole this layer cannot repair
  writeFileSync(ledgerPath, `${LEDGER_ROW(1)}\n${LEDGER_ROW(9)}\n${LEDGER_ROW(10)}\n`);
  const { ctx, tools, agents, service } = await boot({ ledgerPath });
  assert.ok(ctx.logger.warns.some((w) => /could not replay ledger line 2 \(seq 9 does not continue the board at 2\)/.test(w)),
    'the stop is said with its reason');
  assert.equal(service.forum.posts.length, 1, 'the board carries what verified');
  // and posting continues from the verified prefix — fp_2, not fp_11
  const posted = text(await call(tools, 'forum_post', { topic: 'nightly', text: 'after the gap' }, agents.add('session-new')));
  assert.match(posted, /fp_2 posted to nightly/);
});
