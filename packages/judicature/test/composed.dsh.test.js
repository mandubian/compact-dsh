// The composed surface of slice 1: the plugin boots on a real Cordis
// context with the real ToolRuntime, the tools register, and the
// fail-closed ladder holds end to end — [JG/set-undeclared] with no annex,
// [JG/hearing-unbuilt] with a declared one, and a malformed signed section
// refusing the boot (D-7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';

import { apply, loadJudiciary, name } from '../src/index.js';
import { signAnnex, generateEd25519, annexDigestOf } from 'compact-dsh-seals';
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

async function boot(annexPath) {
  const ctx = new Context();
  ctx.logger = { warn: (m) => ctx.logger.warns.push(String(m)), error: () => {} };
  ctx.logger.warns = [];
  ctx.plugin(SystemPromptStub);
  ctx.plugin(ToolRuntime);
  const service = apply(ctx, { annexPath });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get(name) === undefined); i++) {
    await new Promise((r) => setImmediate(r));
  }
  return { ctx, service, tools: ctx.tools, warns: ctx.logger.warns };
}

const call = (tools, name2, args) => tools.execute({
  name: name2, arguments: args, callId: `c_${Math.random().toString(16).slice(2)}`,
  signal: new AbortController().signal,
});
const text = (r) => String(r?.value ?? r ?? '');

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
  return { path, annex };
}

const FUTURE = '2030-01-01T00:00:00.000Z';
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

test('no annex: the hear door refuses [JG/set-undeclared], the read door says so too', async () => {
  const { ctx, service, tools } = await boot(undefined);
  assert.equal(ctx.get(name), service);
  assert.ok(tools.get('judicature_hear'), 'the hear door is reachable');
  assert.ok(tools.get('judicature_sets'), 'the read door is reachable');
  const out = text(await call(tools, 'judicature_hear', { grievance: 'I contest the application of I-5 to seq 41-44' }));
  assert.match(out, /\[JG\/set-undeclared\]/);
  assert.match(out, /nothing can be heard/i);
  const read = text(await call(tools, 'judicature_sets', {}));
  assert.match(read, /\[JG\/set-undeclared\]/);
  assert.equal(service.sets().length, 0);
  assert.equal(service.annexDigest, null);
});

test('a declared annex: sets load, recusal computes, the hear door refuses [JG/hearing-unbuilt]', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-annex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { path } = fixtureAnnex(dir, SECTION);
  const { service, tools, warns } = await boot(path);

  assert.equal(service.sets().length, 1);
  assert.equal(service.annexDigest.length, 64);

  // the founding conflict is computable: the composition is directed-by the
  // founder and asserts-with the enforcer key, so a case against either
  // recuses the founder seat; the peer remains and the panel resolves
  const vsEnforcer = service.resolvePanel([{ kind: 'key', id: 'test-enforcer' }]);
  assert.equal(vsEnforcer.status, 'panel');
  assert.deepEqual(vsEnforcer.seats, ['peer']);
  assert.deepEqual(vsEnforcer.refusals.map((r) => r.roleId), ['founder']);

  // both parties' seats gone: unheard, never dismissed
  const vsEveryone = service.resolvePanel([
    { kind: 'key', id: 'test-enforcer' }, { kind: 'principal', id: 'peer' },
  ]);
  assert.equal(vsEveryone.status, 'unheard');

  const hear = text(await call(tools, 'judicature_hear', { grievance: 'contest', against: 'key:test-enforcer' }));
  assert.match(hear, /\[JG\/hearing-unbuilt\]/);
  assert.match(hear, /1 independent seat/);

  const read = text(await call(tools, 'judicature_sets', { parties: 'key:test-enforcer' }));
  assert.match(read, /REFUSED first\/founder/);
  assert.match(read, /overlap: principal:founder → plugin:compact-dsh → key:test-enforcer/);
  assert.match(read, /first external Member by 2030/);

  assert.ok(warns.some((w) => w.includes('slice 2')), 'the unbuilt hearing is a declared gap at boot');
});

test('a malformed signed section refuses the boot: a broken affidavit is not a missing one (D-7)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-annex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const broken = structuredClone(SECTION);
  broken.edges.push({ type: 'directed-by', from: { kind: 'principal', id: 'ghost' }, to: { kind: 'principal', id: 'founder' } });
  const { path } = fixtureAnnex(dir, broken);
  assert.throws(() => loadJudiciary(path), (e) => e.code === 'sets-malformed' && /dangling edge/.test(e.message));
});

test('a tampered annex fails its own signature before any set is read', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-annex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { path, annex } = fixtureAnnex(dir, SECTION);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  parsed.adjudicatorSets.sets[0].roles.push({ id: 'smuggled', standing: { kind: 'principal', id: 'x' } });
  writeFileSync(path, JSON.stringify(parsed));
  assert.throws(() => loadJudiciary(path), (e) => e.reason === 'annex-signature-invalid');
  assert.equal(annexDigestOf(annex).length, 64);
});
