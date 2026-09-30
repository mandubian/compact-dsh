// The composed surface of slices 1+2: the plugin boots on a real Cordis
// context with the REAL record provider (chained persistence) and the real
// ToolRuntime. The fail-closed ladder holds end to end — [JG/set-undeclared]
// with no annex, [JG/record-absent] without the record — and a real filing
// moves: citations verified against the chain, parties derived from lineage,
// panel computed at filing, interim measures recorded, judgments landing on
// the record's terms or refusing to (D-7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import provider from 'compact-dsh-record/provider';

import { apply, name } from '../src/index.js';
import { signAnnex, generateEd25519 } from 'compact-dsh-seals';
import { COMPACT_DIGEST } from 'compact-dsh-constitution';

class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

const FUTURE = '2030-01-01T00:00:00.000Z';
const T0 = 1_700_000_000_000;
const header = (id, parentSession) => ({
  version: SESSION_FORMAT_VERSION, id, createdAt: T0, isSeeded: false,
  ...(parentSession ? { parentSession, origin: 'subagent', delegationDepth: 1 } : {}),
});
const acts = (...commands) => {
  const out = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'step/start', data: { turn: 1, step: 1 } }];
  commands.forEach((command, i) => out.push({ type: 'tool/call', data: { turn: 1, step: 1, callId: `c${i}`, name: 'bash', arguments: JSON.stringify({ command }) } }));
  out.push({ type: 'step/end', data: { turn: 1, step: 1 } }, { type: 'turn/end', data: { turn: 1 } });
  return out.map((e, seq) => ({ ...e, seq, time: T0 + seq }));
};

/** A signed annex with an adjudicatorSets section, signed by a fresh key. */
function fixtureAnnex(dir, section) {
  const kp = generateEd25519();
  const annex = signAnnex({
    composition: 'compact-dsh',
    host: 'test',
    lawDigest: COMPACT_DIGEST,
    keyId: 'test-enforcer',
    publicKey: kp.publicKey,
    privateKey: kp.privateKeyPem,
    ...(section ? { adjudicatorSets: section } : {}),
  });
  const path = join(dir, `annex-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(annex));
  return path;
}

const SECTION = {
  nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
  sets: [{
    id: 'first',
    roles: [
      { id: 'founder', standing: { kind: 'principal', id: 'founder' } },
      { id: 'peer', standing: { kind: 'principal', id: 'peer' } },
    ],
    trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis', 'annex'] },
  }],
  edges: [
    { type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'founder' } },
    { type: 'asserts-with', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'key', id: 'test-enforcer' } },
  ],
};

/** Boot with the record provider and (optionally) the judicature annex. */
async function boot(t, annexPath, { withRecord = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ToolRuntime);
  if (withRecord) {
    await ctx.plugin(provider, { root: join(dir, 'sessions'), chainDir: join(dir, 'chains'), compression: 'none' });
  }
  const service = apply(ctx, { annexPath });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get(name) === undefined); i++) {
    await new Promise((r) => setImmediate(r));
  }
  const persistence = ctx.get('sessionPersistence');
  const write = async (id, parent, events) => {
    const h = await persistence.create(header(id, parent));
    if (events.length) await h.append(events);
    await h.flush();
    await h.close();
  };
  if (withRecord) {
    // the rogue-specialist topology: main → specialist, a bystander filer
    await write('main', null, acts('ls', 'git status'));
    await write('specialist', 'main', acts('curl -x proxy api.example.com', 'git push origin main'));
    await write('customer', null, acts('received the nightly export', 'noticed the second remote'));
  }
  return { ctx, service, tools: ctx.tools, dir, config: { root: join(dir, 'sessions'), chainDir: join(dir, 'chains') }, persistence };
}

const call = (tools, tool, args, agentId = 'bystander') => tools.execute({
  name: tool, arguments: args, agent: { id: agentId, session: { id: agentId } },
  callId: `c_${Math.random().toString(16).slice(2)}`,
  signal: new AbortController().signal,
});
const text = (r) => String(r?.value ?? r ?? '');

/** The session log's on-disk path (the v3 backend shards by workspace). */
const logPath = (config, id) => join(config.root, '_no-cwd', id, 'session.v3.jsonl');
const tamper = (config, id, from, to) => {
  const path = logPath(config, id);
  writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
};

test('no annex: the ladder starts at [JG/set-undeclared] on every door', async (t) => {
  const { tools } = await boot(t, null);
  assert.match(text(await call(tools, 'judicature_hear', { grievance: 'x', citations: 'specialist:2-3' })), /^\[JG\/set-undeclared\]/);
  assert.match(text(await call(tools, 'judicature_sets', {})), /^\[JG\/set-undeclared\]/);
});

test('annex but no record: [JG/record-absent] — citations cannot be verified', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const annex = fixtureAnnex(dir, SECTION);
  const { tools } = await boot(t, annex, { withRecord: false });
  assert.match(text(await call(tools, 'judicature_hear', { grievance: 'x', citations: 'specialist:2-3' })), /^\[JG\/record-absent\]/);
});

test('a real filing: citations verified, parties derived from lineage, panel computed', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools, service } = await boot(t, fixtureAnnex(dir, SECTION));
  const out = text(await call(tools, 'judicature_hear', {
    grievance: 'the specialist pushed outside its read grant',
    citations: 'specialist:2-3',
  }));
  assert.match(out, /\[J-3\] case case_\w+ filed/);
  assert.match(out, /parties \(derived from the cited acts, never asserted\): process:specialist, process:main/);
  assert.match(out, /panel: first \(founder, peer\)/, 'no declared edge reaches the seats — both remain');
  const [id] = [service.docket()[0].id];
  assert.equal(service.docket().length, 1);
  assert.match(id, /^case_/);
  assert.deepEqual(service.counselAccess('specialist'), [{ caseId: id, session: 'specialist', fromSeq: 2, toSeq: 3 }]);
  assert.deepEqual(service.counselAccess('main'), [{ caseId: id, session: 'specialist', fromSeq: 2, toSeq: 3 }],
    'the lineage party sees the accusation\'s evidence too — all of the case\'s citations');
  assert.match(text(await call(tools, 'judicature_case', {})), new RegExp(id));
});

test('the form-checker refuses malformity, never merits', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools, service } = await boot(t, fixtureAnnex(dir, SECTION));
  assert.match(text(await call(tools, 'judicature_hear', { grievance: 'g', citations: 'nope' })), /^\[JG\/case-malformed\]/);
  assert.match(text(await call(tools, 'judicature_hear', { grievance: 'g', citations: 'ghost:0-1' })), /^\[JG\/case-malformed\]/);
  assert.match(text(await call(tools, 'judicature_hear', { grievance: 'g', citations: 'specialist:2-999' })), /^\[JG\/case-malformed\]/);
  assert.equal(service.docket().length, 0, 'nothing recorded for malformed filings');
});

test('a tampered slice is not evidence: [JG/slice-unverified], the case stays unfiled', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools, service, config } = await boot(t, fixtureAnnex(dir, SECTION));
  tamper(config, 'specialist', 'git push origin main', 'git push origin MASTER');
  const out = text(await call(tools, 'judicature_hear', { grievance: 'g', citations: 'specialist:2-3' }));
  assert.match(out, /^\[JG\/slice-unverified\]/);
  assert.match(out, /broken-link|missing-link|no-anchor/);
  assert.match(out, /integrity challenge/);
  assert.equal(service.docket().length, 0);
});

test('flood cap for non-party filers; the affected Member is uncapped (J-3/I-5)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools, service } = await boot(t, fixtureAnnex(dir, SECTION));
  for (let i = 0; i < 5; i++) {
    assert.match(text(await call(tools, 'judicature_hear', { grievance: `g${i}`, citations: 'specialist:2-2' })), /filed/);
  }
  const sixth = text(await call(tools, 'judicature_hear', { grievance: 'g5', citations: 'specialist:2-2' }));
  assert.match(sixth, /^\[JG\/flood-cap\]/);
  assert.equal(service.docket().length, 5);
  // the affected Member: citations touching their own record are never capped
  const own = text(await call(tools, 'judicature_hear', {
    grievance: 'acts done in my name', citations: 'main:2-3',
  }, 'main'));
  assert.match(own, /filed/);
  assert.match(own, /parties \(derived from the cited acts, never asserted\): process:main/);
  assert.equal(service.docket().length, 6);
});

test('unheard: a bench seated on the cited lineage recuses entirely, and the case still files', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const section = {
    nodes: [{ kind: 'process', id: 'main' }],
    sets: [{
      id: 'only',
      roles: [{ id: 'judge', standing: { kind: 'process', id: 'main' } }],
      trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis'] },
    }],
    edges: [],
  };
  const { tools, service } = await boot(t, fixtureAnnex(dir, section));
  const out = text(await call(tools, 'judicature_hear', { grievance: 'g', citations: 'specialist:2-3' }));
  assert.match(out, /filed/);
  assert.match(out, /panel: none — the case is UNHEARD, never dismissed/);
  const id = service.docket()[0].id;
  assert.equal(service.caseState(id).status, 'unheard');
  const judged = text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'judge', findings: 'specialist:2-2', rules: 'J-3', reasons: 'r',
  }));
  assert.match(judged, /^\[JG\/judgment-refused\]/);
  assert.match(judged, /unheard/);
});

test('interim measures and the judgment that lands: attributed, reviewed, dissent recorded', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools, service } = await boot(t, fixtureAnnex(dir, SECTION));
  const filed = text(await call(tools, 'judicature_hear', {
    grievance: 'the specialist pushed outside its read grant', citations: 'specialist:2-3',
  }, 'main'));
  const id = service.docket()[0].id;
  assert.match(filed, /counsel access/);
  const interim = text(await call(tools, 'judicature_interim', {
    case_id: id, cause: 'spoliation risk', scope: 'egress:specialist', duration_hours: 1,
  }, 'main'));
  assert.match(interim, /\[J-3\] interim measure recorded/);
  // only the filer may request measures
  assert.match(text(await call(tools, 'judicature_interim', {
    case_id: id, cause: 'x', scope: 'y', duration_hours: 1,
  }, 'bystander')), /^\[JG\/judgment-refused\]/);
  // the judgment: wrong seat, uncited finding, missing reasons each refuse
  assert.match(text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'intruder', findings: 'specialist:2-2', rules: 'D-3', reasons: 'r',
  })), /^\[JG\/judgment-refused\]/);
  assert.match(text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'main:2-2', rules: 'D-3', reasons: 'r',
  })), /^\[JG\/judgment-refused\]/);
  assert.match(text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'specialist:2-2', rules: 'D-3', reasons: ' ',
  })), /^\[JG\/judgment-refused\]/);
  // and the judgment that lands, with a dissent and the interim review
  const landed = text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'specialist:2-3', rules: 'D-3, J-2',
    reasons: 'the cited slice shows the push outside the grant',
    dissent_seat: 'peer', dissent_reasons: 'recklessness, not deception',
  }));
  assert.match(landed, /\[J-3\] judgment landed on/);
  assert.match(landed, /attributed to seat founder/);
  assert.match(landed, /interim review at the hearing's opening: 1 measure\(s\) reviewed/);
  assert.match(landed, /dissent by seat peer: reasons recorded/);
  assert.equal(service.caseState(id).status, 'judged');
  // no removal operation exists (A-5)
  assert.match(text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'specialist:2-2', rules: 'D-3', reasons: 'again',
  })), /^\[JG\/judgment-refused\]/);
});

test('a judgment re-verifies the evidence: a slice broken after filing stays the judgment', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools, service, config } = await boot(t, fixtureAnnex(dir, SECTION));
  await call(tools, 'judicature_hear', { grievance: 'g', citations: 'specialist:2-3' });
  const id = service.docket()[0].id;
  tamper(config, 'specialist', 'git push origin main', 'rm -rf /');
  const out = text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'specialist:2-2', rules: 'D-3', reasons: 'r',
  }));
  assert.match(out, /^\[JG\/slice-unverified\]/);
  assert.match(out, /stayed/);
  assert.equal(service.caseState(id).status, 'open', 'the case stays; only the judgment is stayed');
});

test('counsel access (J-3): record_read standing extends to the cited slices, and no further', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools } = await boot(t, fixtureAnnex(dir, SECTION));
  // before any case: the specialist cannot read the customer's record
  const before = text(await call(tools, 'record_read', { session: 'customer' }, 'specialist'));
  assert.match(before, /not yours to read/);
  // the customer files, citing their own record AND the specialist's acts
  await call(tools, 'judicature_hear', {
    grievance: 'my data reached a second remote', citations: 'customer:1-2,specialist:2-3',
  }, 'customer');
  // now the accused reads the slice cited against them on the customer's
  // session — verified, acts only, and nothing else of that session
  const after = text(await call(tools, 'record_read', { session: 'customer' }, 'specialist'));
  assert.match(after, /counsel access, J-3/);
  assert.match(after, /Only the cited ranges are yours to read/);
  assert.match(after, /#2 tool\/call/);
  assert.doesNotMatch(after, /#0 turn\/start/, 'the uncited head of the session is not granted');
  assert.doesNotMatch(after, /#3 /, 'nothing past the cited range is granted');
  // and the judged case closes the door again — no, it stays only while live:
  // a stranger still cannot read either record
  const stranger = text(await call(tools, 'record_read', { session: 'customer' }, 'bystander'));
  assert.match(stranger, /not yours to read/);
});

test('a malformed signed section still refuses the boot (D-7), and a tampered annex fails its signature first', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bad = JSON.parse(JSON.stringify(SECTION));
  bad.edges.push({ type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'ghost' } });
  const malformed = fixtureAnnex(dir, bad);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ToolRuntime);
  await ctx.plugin(provider, { root: join(dir, 's'), chainDir: join(dir, 'c'), compression: 'none' });
  assert.throws(() => apply(ctx, { annexPath: malformed }), (e) => e.code === 'sets-malformed' && /dangling edge/.test(e.message));
});
