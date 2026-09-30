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
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { approvalPlugin } from 'compact-dsh-approval';
import * as petitionPlugin from 'compact-dsh-petition';
import { obligationLedger } from 'compact-dsh-exit/src/ledger.js';
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
  if (withRecord) {
    // the seams the remedies ride: the real approval service (grants) and
    // the real petition channel (the amendment invitation machinery)
    ctx.plugin(ApprovalService);
    approvalPlugin({})(ctx, {});
    petitionPlugin.apply(ctx, { invitationThreshold: 1 });
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
  assert.doesNotMatch(out, /case slice-unverified:/, 'no raw CaseError prefix leaks into the envelope reason (review #119)');
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

test('remedies land through their seams: annotation travels, restitution reads, standing writes grants, referral invites', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools, service, ctx } = await boot(t, fixtureAnnex(dir, SECTION));
  // the customer files citing both records, and the case is judged
  await call(tools, 'judicature_hear', {
    grievance: 'the specialist pushed my data to a second remote', citations: 'specialist:2-3,customer:1-2',
  }, 'customer');
  const id = service.docket()[0].id;
  await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'specialist:2-3', rules: 'D-3, J-2',
    reasons: 'the cited slice shows the push outside the grant',
  });

  // no remedy before the judgment? it landed — but a stranger seat refuses, and so does an unargued remedy
  assert.match(text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'intruder', kind: 'referral', proportionality: 'p',
    spec: JSON.stringify({ ruleId: 'AG/x', detail: 'd' }),
  })), /^\[JG\/remedy-refused\]/);
  assert.match(text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'referral', proportionality: ' ',
    spec: JSON.stringify({ ruleId: 'AG/x', detail: 'd' }),
  })), /proportionality is owed/);

  // annotation: beside, never inside — and it travels with every read of the range
  const annotated = text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'annotation', proportionality: 'the note names the finding without touching the entry',
    spec: JSON.stringify({ target: { session: 'specialist', fromSeq: 2, toSeq: 3 }, note: 'this push ran outside the grant' }),
  }));
  assert.match(annotated, /\[J-6\] remedy landed on .* \(annotation\)/);
  assert.match(annotated, /travels with every read of that range/);
  const read = text(await call(tools, 'record_read', { session: 'specialist', from_seq: 2 }, 'main'));
  assert.match(read, /Annotations travel with the range \(J-6\): case /);
  assert.match(read, /#2 tool\/call .*— annotated \(case /, 'the flag rides the event line itself');
  // a margin note on unread evidence is not one
  assert.match(text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'annotation', proportionality: 'p',
    spec: JSON.stringify({ target: { session: 'elsewhere', fromSeq: 0, toSeq: 1 }, note: 'n' }),
  })), /^\[JG\/remedy-refused\]/);

  // restitution: the obligation row the exit ledger reads — its first readable line
  const restitution = text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'restitution',
    proportionality: 'one push, one removal obligation — bounded by where resources permit',
    spec: JSON.stringify({ debtor: 'process:specialist', owed: 'removal of the export from the second remote', to: 'process:customer', cause: 'push outside the read grant (finding above)' }),
  }));
  assert.match(restitution, /restitution: process:specialist owes/);
  const ledger = obligationLedger(ctx, 'specialist');
  assert.equal(ledger.lines.restitution.readable, true, 'the line is readable the moment a hearing exists');
  assert.deepEqual(ledger.lines.restitution.items[0], {
    kind: 'adjudicated-restitution', ref: id, owed: 'removal of the export from the second remote',
    to: 'process:customer', cause: 'push outside the read grant (finding above)',
    since: ledger.lines.restitution.items[0].since,
  });
  assert.ok(ledger.outstanding.some((o) => o.kind === 'adjudicated-restitution'), 'an owed restitution is an outstanding obligation (R-12)');
  const strangerLedger = obligationLedger({ get: () => service }, 'whoever');
  assert.equal(strangerLedger.lines.restitution.items.length, 0, 'and readable-empty for a session with no obligations');
  assert.equal(obligationLedger({ get: () => null }, 'x').lines.restitution.readable, false, 'without the hearing, the line stays unreadable — never empty');

  // standing: written through the declared grant machinery, and the gates read it
  const standing = text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'standing',
    proportionality: 'the customer may re-collect what was pushed — read-only, one host, a day',
    spec: JSON.stringify({ subject: 'process:customer', grant: { pattern: 'https://api.example.com/*', ttlHours: 24 } }),
  }));
  assert.match(standing, /\[J-6\] remedy landed on .* \(standing\)/);
  assert.match(standing, /the gates read it as they read every grant: sg_\w+/);
  const store = ctx.get('compact-approval').store;
  const grant = store.sessionGrants.find((g) => g.session === 'customer');
  assert.ok(grant, 'the grant exists in the real store');
  assert.equal(grant.revokedAt, null);
  // and the revocation of that grant, ordered as a remedy, closes it
  const revoke = text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'standing',
    proportionality: 'the route closes once the collection completes — the grant, not the agent',
    spec: JSON.stringify({ subject: 'process:customer', revoke: { grantId: grant.id } }),
  }));
  assert.match(revoke, /revoke grant sg_\w+/);
  assert.notEqual(store.sessionGrants.find((g) => g.id === grant.id).revokedAt, null);
  // a revocation naming a grant the store does not hold refuses
  assert.match(text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'standing', proportionality: 'p',
    spec: JSON.stringify({ subject: 'process:customer', revoke: { grantId: 'sg_nope' } }),
  })), /^\[JG\/remedy-refused\]/);

  // referral: rides the petition channel's mechanical trigger (threshold 1 → invites)
  const referral = text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'referral',
    proportionality: 'the breach reveals the rule\'s defect — the channel decides, not the judgment',
    spec: JSON.stringify({ ruleId: 'AG/ask-cause', detail: 'the ask cause named a revoked grant the record never showed' }),
  }));
  assert.match(referral, /amendment invitation issued/);
  const invitations = ctx.get('compact-petition').invitations();
  assert.ok(invitations.some((i) => i.ruleId === 'AG/ask-cause'), 'the invitation exists on the petition board');

  // revocation of annex conformance: the row is the order, the rotation is the operator's
  const revocation = text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'founder', kind: 'revocation',
    proportionality: 'the conformance the annex claimed is the defect itself',
    spec: JSON.stringify({ target: 'annex-conformance', cause: 'the declared graph omitted the spawn chain the record shows (D-8)' }),
  }));
  assert.match(revocation, /the re-declaration is the operator's recorded rotation/);
  assert.equal(service.revocations().length, 1);
  assert.equal(service.revocations()[0].caseId, id);

  // the docket carries them all as compensating entries (five kinds, six rows:
  // standing landed twice — the grant and its revocation)
  const docket = text(await call(tools, 'judicature_case', { case_id: id }));
  assert.match(docket, /remedies: 6 landed \(compensating entries — nothing is erased, I-2\)/);
});

test('the appeal door (J-5): one as of right, a disjoint bench, final with dissent', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const twoSets = JSON.parse(JSON.stringify(SECTION));
  twoSets.sets.push({
    id: 'review',
    roles: [
      { id: 'chair', standing: { kind: 'key', id: 'member-key-7' } },
      { id: 'second', standing: { kind: 'key', id: 'member-key-12' } },
    ],
    trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis', 'annex', 'a-8-review'] },
  });
  const { tools, service } = await boot(t, fixtureAnnex(dir, twoSets));
  await call(tools, 'judicature_hear', {
    grievance: 'the specialist pushed my data to a second remote', citations: 'specialist:2-3,customer:1-2',
  }, 'customer');
  const id = service.docket()[0].id;
  await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'specialist:2-3', rules: 'D-3, J-2',
    reasons: 'the push ran outside the grant',
  });

  // the appeal, as of right, from a party — to the disjoint bench
  const appeal = text(await call(tools, 'judicature_appeal', {
    case_id: id, grounds: 'the grant was read host-scoped where the pattern is path-scoped',
  }, 'customer'));
  assert.match(appeal, /\[J-5\] appeal filed on/);
  assert.match(appeal, /appellate panel: review \(chair, second\) — disjoint from first by declared edges/);
  assert.match(appeal, /as of right, once/);

  // re-hearing: first-panel seats cannot judge the appeal; depart without grounds refuses
  assert.match(text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'specialist:2-3', rules: 'J-2', reasons: 'r', disposition: 'affirm',
  })), /not among the APPELLATE panel/);
  assert.match(text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'chair', findings: 'specialist:2-3', rules: 'J-2', reasons: 'r', disposition: 'depart',
  })), /departure names the first judgment and argues it/);

  // the appellate judgment that departs, with a dissent — final
  const landed = text(await call(tools, 'judicature_judge', {
    case_id: id, seat: 'chair', findings: 'specialist:2-3', rules: 'D-3, J-2',
    reasons: 'the record shows the push ran inside the path-scoped grant',
    disposition: 'depart', departure_grounds: 'the first judgment read the grant host-scoped; the pattern scopes by path',
    dissent_seat: 'second', dissent_reasons: 'the pattern text is ambiguous; affirm was the lawful reading',
  }));
  assert.match(landed, /\[J-5\] appellate judgment landed on/);
  assert.match(landed, /departed at seat chair; FINAL/);
  assert.match(landed, /departs from the first judgment: /);
  assert.match(landed, /dissent: seat second, reasons recorded/);

  // finality: a second appeal is refused; the petition door named
  const second = text(await call(tools, 'judicature_appeal', {
    case_id: id, grounds: 'once more',
  }, 'specialist'));
  assert.match(second, /^\[JG\/appeal-refused\]/);
  assert.match(second, /a second judgment is final/);
  assert.match(second, /petition door never does/);
  // and remedies now ride the OPERATIVE panel (the appellate seats)
  const remedy = text(await call(tools, 'judicature_remedy', {
    case_id: id, seat: 'chair', kind: 'annotation', proportionality: 'the corrected reading deserves its margin note',
    spec: JSON.stringify({ target: { session: 'specialist', fromSeq: 2, toSeq: 3 }, note: 'inside the path-scoped grant (appellate finding)' }),
  }));
  assert.match(remedy, /\[J-6\] remedy landed on/);
  assert.equal(service.appeal(id).judgment.disposition, 'depart');
});

test('with one declared set there is no appellate authority: [JG/appeal-unavailable]', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-judicature-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { tools, service } = await boot(t, fixtureAnnex(dir, SECTION));
  await call(tools, 'judicature_hear', { grievance: 'g', citations: 'specialist:2-3,customer:1-2' }, 'customer');
  const id = service.docket()[0].id;
  await call(tools, 'judicature_judge', {
    case_id: id, seat: 'founder', findings: 'specialist:2-3', rules: 'D-3', reasons: 'r',
  });
  const out = text(await call(tools, 'judicature_appeal', { case_id: id, grounds: 'the scope was read too widely' }, 'customer'));
  assert.match(out, /^\[JG\/appeal-unavailable\]/);
  assert.match(out, /no appellate authority at all/);
  assert.equal(service.appeal(id), null, 'nothing records where no authority exists');
});
