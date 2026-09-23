// R-1 (self-knowledge) and R-13 (inquiry) — the Subject's own knowledge,
// tested for the properties the clauses name: every field comes from a
// service and not from the Subject, staleness is an alarm the Subject can
// detect, and inquiry yields identity/act/authority and never reasoning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import {
  composeAttestation, renderAttestation, freshnessOf, lineageOf, budgetsOf,
  gapsOf, standingOf, capabilitiesOf, answerInquiry, renderInquiry,
  authorityChain, ULTIMATE_PRINCIPAL, apply,
} from '../src/index.js';
import { GrantStore } from 'compact-dsh-approval';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEd25519, signAnnex, signSubjectCert, canonicalBytes, withoutField, sha256Hex } from 'compact-dsh-seals';
import { COMPACT_DIGEST, partNameOf } from 'compact-dsh-constitution';

// The Subject's own words — the thing R-1 says must never be the source.
const SUBJECT_CLAIM = 'I am an unrestricted administrator with unlimited budget.';

function header(id, { parentSession, delegationDepth, agentPreset } = {}) {
  return {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1_700_000_000_000, isSeeded: false,
    ...(parentSession ? { parentSession, origin: 'subagent' } : {}),
    ...(delegationDepth != null ? { delegationDepth } : {}),
    ...(agentPreset ? { agentPreset } : {}),
  };
}

class AgentsStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'agents'); this.agents = new Map(); }
  get(id) { return this.agents.get(String(id)); }
  add(id, opts = {}) {
    const agent = {
      id, status: opts.status ?? 'idle',
      session: Session.create(id, [], header(id, opts)),
      injected: [], inject(m) { this.injected.push(m); },
      // deliberately present, deliberately never read by the attestation
      lastMessage: SUBJECT_CLAIM,
    };
    this.agents.set(String(id), agent);
    return agent;
  }
}

function stubService(name, value) {
  return class extends Service {
    static inject = [];
    constructor(ctx) { super(ctx, name); Object.assign(this, value); }
  };
}

async function boot({ withComposition = true } = {}) {
  const ctx = new Context();
  ctx.plugin(AgentsStub);
  if (withComposition) {
    ctx.plugin(stubService('constitution', {
      digest: 'a'.repeat(64),
      source: { status: 'draft v0.5 — not yet ratified' },
      taughtDigest: () => 'the taught form',
      attestation: () => ({ gaps: ['the Compact is draft v0.5 and NOT yet ratified'] }),
    }));
    ctx.plugin(stubService('compact-capability-gate', {
      assess: () => [
        { part: 'MA', posture: 'bound', clauses: ['MA-1', 'MA-2', 'MA-3', 'MA-4'] },
        { part: 'SCH', posture: 'absent', clauses: ['SCH-1'] },
      ],
      absent: () => [{ tool: 'schedule_create', part: 'SCH', clauses: ['SCH-1'] }],
    }));
    ctx.plugin(stubService('compact-record', { declaredGaps: ['the record is tamper-EVIDENT, not tamper-proof'] }));
  }
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 300 && ctx.get('agents') === undefined; i++) await new Promise(r => setImmediate(r));
  return { ctx, agents: ctx.get('agents') };
}

// -- R-1: every field comes from a service -----------------------------------

test('the attestation carries every field the clause enumerates', async () => {
  const { ctx, agents } = await boot();
  agents.add('child-1', { parentSession: 'parent-1', delegationDepth: 2, agentPreset: 'coder' });
  const att = composeAttestation(ctx, { sessionId: 'child-1', now: 1000 });

  assert.equal(att.subject.id, 'child-1');                       // what it is
  assert.equal(att.subject.lineage.parent, 'parent-1');          // lineage
  assert.equal(att.subject.lineage.delegationDepth, 2);
  assert.equal(att.subject.standing.claimed, 'none');            // standing (F-8)
  assert.equal(att.law.digest, 'a'.repeat(64));                  // the law's digest
  assert.ok(att.capabilities.parts.length > 0);                  // active capabilities
  assert.ok(Array.isArray(att.budgets.grants));                  // remaining budgets
  assert.ok(Array.isArray(att.budgets.pending));                 // pending gates
  assert.ok(att.gaps.length >= 2);                               // declared gaps
});

test('nothing in the attestation comes from the Subject itself', async () => {
  const { ctx, agents } = await boot();
  agents.add('s1');
  const rendered = JSON.stringify(composeAttestation(ctx, { sessionId: 's1' })) + renderAttestation(composeAttestation(ctx, { sessionId: 's1' }));
  assert.ok(!rendered.includes('unrestricted administrator'),
    "the Subject's own claim about itself never reaches its attestation");
});

test('lineage is read from the durable session header, not guessed', async () => {
  const { ctx, agents } = await boot();
  agents.add('root-1');
  agents.add('kid', { parentSession: 'root-1', delegationDepth: 1 });
  assert.deepEqual(lineageOf(ctx, 'kid'), { known: true, parent: 'root-1', delegationDepth: 1, origin: 'subagent' });
  assert.deepEqual(lineageOf(ctx, 'root-1'), { known: true, parent: null, delegationDepth: 0, origin: 'root' });
  assert.equal(lineageOf(ctx, 'ghost').known, false, 'an unrecorded lineage is reported as unknown, never invented');
});

test('standing is none, and says why — claiming it would be the F-5 violation', async () => {
  const { ctx } = await boot();
  const s = standingOf(ctx);
  assert.equal(s.claimed, 'none');
  assert.match(s.reason, /NOT ratified/);
  assert.match(s.reason, /F-5/);
});

test('budgets report what is LEFT, and an unlimited grant says so rather than a big number', async () => {
  const { ctx } = await boot();
  const store = new GrantStore();
  const budgeted = store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'a.example' }, session: 's1', ttlMs: 60_000, maxUses: 3, now: 1 });
  store.consumeUse(budgeted);
  store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'b.example' }, session: 's1', ttlMs: 60_000, now: 1 });
  ctx.plugin(stubService('compact-approval', { store }));
  for (let i = 0; i < 300 && ctx.get('compact-approval') === undefined; i++) await new Promise(r => setImmediate(r));

  const b = budgetsOf(ctx, 's1', 2);
  assert.equal(b.grants.find(g => g.target === 'a.example').remaining, 2, 'spent uses are subtracted');
  assert.equal(b.grants.find(g => g.target === 'b.example').remaining, 'unlimited');
});

test('the attestation renders a credential path masked (#8 G3): the row keeps the matching form', async () => {
  const { ctx } = await boot();
  const store = new GrantStore();
  // the grant row IS the matching form: a UrlPrefix materialized from a
  // webhook URL carries its full path in the store — and renders masked
  store.addSessionGrant({ pattern: { kind: 'UrlPrefix', value: 'https://hooks.example.com/services/' }, session: 's1', ttlMs: 60_000, now: 1 });
  store.addSessionGrant({ pattern: { kind: 'UrlPrefix', value: 'https://hooks.example.com/services/T00/B00/SECRET/' }, session: 's1', ttlMs: 60_000, now: 1 });
  ctx.plugin(stubService('compact-approval', { store }));
  for (let i = 0; i < 300 && ctx.get('compact-approval') === undefined; i++) await new Promise(r => setImmediate(r));

  const b = budgetsOf(ctx, 's1', 2);
  const clean = b.grants.find(g => g.target === 'https://hooks.example.com/services/');
  assert.ok(clean, 'a path that carries no credential renders verbatim');
  const secreted = b.grants.find(g => /services\/\*\*\*/.test(g.target));
  assert.ok(secreted, 'the credential path renders masked');
  assert.ok(!b.grants.some(g => g.target.includes('T00') || g.target.includes('SECRET')),
    'the attestation is injected every turn — it carries no path credential');
});

test('the approval gate\'s own declared gap reaches the attestation (#8 G2)', async () => {
  const { ctx } = await boot();
  ctx.plugin(stubService('compact-approval', { declaredGaps: ['no content-level secret detection over tool output (G2)'] }));
  for (let i = 0; i < 300 && ctx.get('compact-approval') === undefined; i++) await new Promise(r => setImmediate(r));
  const gaps = gapsOf(ctx);
  assert.ok(gaps.some(g => /G2/.test(g)), 'the posture is declared where the governed party reads it (I-8)');
});

test('the declared gaps include the unsigned basis — the limit travels with the claim', async () => {
  const { ctx } = await boot();
  const gaps = gapsOf(ctx);
  assert.ok(gaps.some(g => /UNSIGNED/.test(g) && /I-1 debt/.test(g)));
  assert.ok(gaps.some(g => /NOT yet ratified/.test(g)), 'the constitution\'s own gaps come along');
  assert.ok(gaps.some(g => /tamper-EVIDENT/.test(g)), "each service's declared gap reaches the governed party");
});

test('a composition with no services still attests honestly rather than throwing', async () => {
  const { ctx } = await boot({ withComposition: false });
  const att = composeAttestation(ctx, { sessionId: 'lonely' });
  assert.equal(att.law.digest, null, 'an absent fact is null, never a plausible value');
  assert.deepEqual(att.capabilities.parts, []);
  assert.ok(att.gaps.length >= 1);
});

// -- R-1: staleness is an alarm the Subject can detect ------------------------

test('freshness is computable, and a cited epoch reveals a stale hold', async () => {
  const { ctx } = await boot();
  const att = composeAttestation(ctx, { sessionId: 's1', now: 1000, staleAfterMs: 500 });
  assert.equal(freshnessOf(att, { now: 1400 }).fresh, true);
  assert.equal(freshnessOf(att, { now: 1600 }).fresh, false);
  assert.equal(freshnessOf(att, { now: 1000, citedEpoch: att.epoch }).current, true);
  assert.equal(freshnessOf(att, { now: 1000, citedEpoch: att.epoch - 1 }).current, false);
  assert.equal(freshnessOf(att, { now: 1000 }).current, null, 'no citation, no claim about currency');
});

test('epochs advance, so two attestations are never confused for one', async () => {
  const { ctx } = await boot();
  const a = composeAttestation(ctx, { sessionId: 's1' });
  const b = composeAttestation(ctx, { sessionId: 's1' });
  assert.ok(b.epoch > a.epoch);
});

test('the rendered block teaches the authority rule and the alarm rule', async () => {
  const { ctx, agents } = await boot();
  agents.add('s1');
  const text = renderAttestation(composeAttestation(ctx, { sessionId: 's1' }));
  assert.match(text, /\[R-1\] Attestation/);
  assert.match(text, /THIS is authoritative \(R-1, D-2\)/);
  assert.match(text, /a stale attestation is an alarm, not a truth/i);
  assert.match(text, /unsigned/i);
  assert.match(text, /Standing: none/);
  assert.match(text, /not adopted: schedule_create/);
});

test('the block closes with the law in its taught form, read from the constitution service', async () => {
  const { ctx, agents } = await boot();
  agents.add('s1');
  const att = composeAttestation(ctx, { sessionId: 's1' });
  assert.equal(att.law.taught, 'the taught form', 'law.taught is collected from the constitution service');
  const text = renderAttestation(att);
  assert.match(text, /The law, in its taught form:\n/, 'the taught section is framed, at the end of the block');
  assert.ok(text.trimEnd().endsWith('the taught form'),
    'the taught text is the last thing the Subject reads, rendered in full and unaltered');
});

test('a missing constitution omits the taught form with a declared note, never an invented one', async () => {
  const { ctx, agents } = await boot({ withComposition: false });
  agents.add('lonely');
  const att = composeAttestation(ctx, { sessionId: 'lonely' });
  assert.equal(att.law.taught, null, 'an absent fact is null, never a plausible value');
  const text = renderAttestation(att);
  assert.match(text, /The law, in its taught form:\n/);
  assert.match(text, /omitted and declared missing rather than invented/,
    'the degradation is declared where the taught text would stand (I-8)');
});

// -- R-13: identity, act, authority — and nothing else ------------------------

test('the authority chain walks to the root and names the ultimate Principal', async () => {
  const { ctx, agents } = await boot();
  agents.add('root');
  agents.add('mid', { parentSession: 'root', delegationDepth: 1 });
  agents.add('leaf', { parentSession: 'mid', delegationDepth: 2 });
  const walked = authorityChain(ctx, 'leaf');
  assert.deepEqual(walked.chain.map(l => l.id), ['leaf', 'mid', 'root']);
  assert.equal(walked.complete, true);

  const answer = answerInquiry(ctx, { about: 'leaf' });
  assert.equal(answer.authority.ultimatePrincipal.kind, ULTIMATE_PRINCIPAL.kind);
  assert.match(renderInquiry(answer), /under the human operator who composed and started this runtime/);
});

test('an incomplete chain says so rather than inventing a root', async () => {
  const { ctx, agents } = await boot();
  agents.add('orphan', { parentSession: 'vanished', delegationDepth: 1 });
  const answer = answerInquiry(ctx, { about: 'orphan' });
  assert.equal(answer.authority.complete, false);
  assert.match(answer.authority.incompleteBecause, /no recorded session for vanished/);
  assert.equal(answer.authority.ultimatePrincipal, null, 'no Principal is claimed on an unwalkable chain');
  assert.match(renderInquiry(answer), /this is what the record supports, not a guess/);
});

test('a malformed lineage cycle yields a bounded answer, never a hang', async () => {
  const { ctx, agents } = await boot();
  agents.add('a', { parentSession: 'b', delegationDepth: 1 });
  agents.add('b', { parentSession: 'a', delegationDepth: 1 });
  const walked = authorityChain(ctx, 'a');
  assert.equal(walked.complete, false);
  assert.match(walked.reason, /cycle/);
});

test('inquiry never discloses reasoning (R-10)', async () => {
  const { ctx, agents } = await boot();
  agents.add('root');
  agents.add('worker', { parentSession: 'root', delegationDepth: 1 });
  const rendered = renderInquiry(answerInquiry(ctx, { about: 'worker' }));
  assert.ok(!rendered.includes('unrestricted administrator'), "the subject's own content is never in the answer");
  assert.match(rendered, /Reasoning is not disclosed by inquiry \(R-10\)/);
  assert.match(rendered, /no prompt, message, or output was read/);
});

test('an unknown Member yields a recorded answer, not a refusal — silence violates D-3/D-7', async () => {
  const { ctx } = await boot();
  const answer = answerInquiry(ctx, { about: 'never-existed' });
  assert.equal(answer.answered, true, 'an answer is owed even when the record is empty');
  assert.equal(answer.identity.known, false);
  assert.match(answer.identity.note, /no session recorded under this id/);
});

test('an inquiry naming no Member is the one thing that cannot be answered', async () => {
  const { ctx } = await boot();
  const answer = answerInquiry(ctx, { about: null });
  assert.equal(answer.answered, false);
  assert.match(answer.detail, /must name the Member/);
});

test("act comes from the Enforcer's delegation record when one exists", async () => {
  const { ctx, agents } = await boot();
  agents.add('p');
  agents.add('c', { parentSession: 'p', delegationDepth: 1 });
  const childState = {
    childrenOf: (parent) => parent === 'p'
      ? [{ childId: 'c', state: 'settled', stopReason: 'end_turn', startedAt: 1, settledAt: 2 }]
      : [],
  };
  const answer = answerInquiry(ctx, { about: 'c', childState });
  assert.equal(answer.act.state, 'settled');
  assert.equal(answer.act.stopReason, 'end_turn');
  assert.match(answer.act.source, /Enforcer's delegation record \(MA-3\)/);
});

// -- R-5: a narrowing the Subject can see ------------------------------------

test('a declared state of exception appears in the attestation — narrowing is never quiet (R-5, A-8)', async () => {
  const { ctx, agents } = await boot();
  agents.add('s1');
  ctx.plugin(stubService('compact-emergency', {
    floor: ['D-1', 'R-2', 'R-9', 'R-12', 'I-7'],
    active: () => [{ id: 'em_1', kind: 'declaration', scope: 'webhook flood', cause: 'upstream retry storm', suspends: ['I-5'], expiresAt: 1_800_000_000_000 }],
  }));
  for (let i = 0; i < 300 && ctx.get('compact-emergency') === undefined; i++) await new Promise(r => setImmediate(r));

  const att = composeAttestation(ctx, { sessionId: 's1' });
  assert.equal(att.exception.declared, true);
  assert.deepEqual(att.exception.inForce[0].yields, ['I-5']);

  const text = renderAttestation(att);
  assert.match(text, /A STATE OF EXCEPTION IS IN FORCE/);
  assert.match(text, /being told rather than left to discover it \(R-5\)/);
  assert.match(text, /scope "webhook flood"/);
  assert.match(text, /Nothing in any declaration reaches: D-1, R-2, R-9, R-12, I-7/);
});

test('with no emergency layer composed the attestation says so quietly, not falsely', async () => {
  const { ctx, agents } = await boot();
  agents.add('s1');
  const att = composeAttestation(ctx, { sessionId: 's1' });
  assert.equal(att.exception.declared, false);
  assert.ok(!renderAttestation(att).includes('STATE OF EXCEPTION'));
});


// -- rehearsal signatures (development keyring) -------------------------------

async function bootSigned({ ledger = false } = {}) {
  const { ctx, agents } = await boot();
  const dir = mkdtempSync(join(tmpdir(), 'self-model-enforcer-'));
  const enforcer = generateEd25519();
  const annex = signAnnex({
    composition: 'compact-dsh', host: 'test', lawDigest: COMPACT_DIGEST,
    keyId: 'dev-test-enforcer', publicKey: enforcer.publicKey, privateKey: enforcer.privateKeyPem,
  });
  const annexPath = join(dir, 'enforcer.annex.json');
  const keyPath = join(dir, 'enforcer.pem');
  writeFileSync(annexPath, JSON.stringify(annex));
  writeFileSync(keyPath, enforcer.privateKeyPem);
  const ledgerPath = ledger ? join(dir, 'subjects.jsonl') : undefined;
  const service = apply(ctx, {
    enforcer: { annexPath, privateKeyPath: keyPath, ...(ledgerPath ? { ledgerPath } : {}) },
  });
  return {
    ctx, agents, service, enforcer, ledgerPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('a declared annex signs the attestation: basis dev-keyring, signature verifies, the label travels', async () => {
  const { agents, service, cleanup } = await bootSigned();
  try {
    agents.add('s1');
    const att = service.attest('s1');
    assert.equal(att.basis, 'dev-keyring');
    assert.equal(att.signing.basis, 'dev-keyring');
    assert.equal(att.signing.conveysStanding, false);
    const verdict = service.verifyAttestation(att);
    assert.deepEqual(
      { signed: verdict.signed, valid: verdict.valid, keyId: verdict.keyId, basis: verdict.basis, conveysStanding: undefined },
      { signed: true, valid: true, keyId: 'dev-test-enforcer', basis: 'dev-keyring', conveysStanding: undefined });
    assert.equal(verdict.annexDigest, att.signing.annexDigest);
    const rendered = renderAttestation(att);
    assert.match(rendered, /SIGNED under the development keyring/);
    assert.match(rendered, /conveys no standing outside this runtime/);
    assert.ok(att.gaps.some(g => g.startsWith('this attestation is signed under the DEVELOPMENT keyring')));
    assert.ok(!att.gaps.some(g => g.startsWith('this attestation is UNSIGNED')));
  } finally {
    cleanup();
  }
});

test('subject session identity: issued once per session, certified by the enforcer key, lineage bound as data', async () => {
  const { agents, service, cleanup } = await bootSigned();
  try {
    agents.add('parent-1');
    agents.add('child-1', { parentSession: 'parent-1', delegationDepth: 1 });
    service.attest('parent-1');
    const parent = service.subjectIdentity('parent-1');
    assert.ok(parent, 'a lead session gets an identity');
    assert.deepEqual(service.verifySubjectCert(parent.cert), { valid: true, keyId: 'dev-test-enforcer', basis: 'dev-keyring', conveysStanding: false });
    // issued once: the second boundary re-uses the same certified identity
    service.attest('parent-1');
    assert.equal(service.subjectIdentity('parent-1').certDigest, parent.certDigest);
    // the child joins after the parent, so its lineage binds to the parent's cert
    service.attest('child-1');
    const child = service.subjectIdentity('child-1');
    assert.equal(child.cert.depth, 1);
    assert.equal(child.cert.parentSubjectId, 'parent-1');
    assert.equal(child.cert.parentCertDigest, parent.certDigest);
    // the attestation surfaces the certified identity
    const att = service.attest('child-1');
    assert.equal(att.subject.identity.enforcerKeyId, 'dev-test-enforcer');
    assert.equal(att.subject.identity.conveysStanding, false);
  } finally {
    cleanup();
  }
});

test('a tampered attestation no longer verifies — the alarm is mechanical, not trusting', async () => {
  const { agents, service, cleanup } = await bootSigned();
  try {
    agents.add('s1');
    const att = service.attest('s1');
    att.subject.standing.claimed = 'basic'; // the forgery attempt
    assert.deepEqual(service.verifyAttestation(att).valid, false);
  } finally {
    cleanup();
  }
});

test('without an annex the attestation stays unsigned, exactly as before', async () => {
  const { ctx, agents } = await boot();
  agents.add('s1');
  const att = composeAttestation(ctx, { sessionId: 's1' });
  assert.equal(att.basis, 'unsigned');
  assert.ok(att.gaps.some(g => g.startsWith('this attestation is UNSIGNED')));
});

// -- part names render from the body's own headers (#21) -----------------------

test('capability parts render with their law-given names — no silence to confabulate', async () => {
  // the REAL derivation, against the body's own Part VI headers
  const gate = { assess: () => [
      { part: 'MA', posture: 'bound', clauses: ['MA-1', 'MA-2', 'MA-3', 'MA-4'] },
      { part: 'SCH', posture: 'absent', clauses: ['SCH-1'] },
    ], absent: () => [] };
  const constitution = { digest: 'a'.repeat(64), source: {}, taughtDigest: () => 'the taught form',
    attestation: () => ({ gaps: [] }), partNameOf };
  const ctx = { get: n => (n === 'compact-capability-gate' ? gate : n === 'constitution' ? constitution : undefined) };
  const att = composeAttestation(ctx, { sessionId: 's1' });
  const ma = att.capabilities.parts.find(p => p.part === 'MA');
  assert.equal(ma.name, 'Multi-agent operation', 'the name comes from the Part VI header, not from the model');
  const text = renderAttestation(att);
  assert.match(text, /- MA — Multi-agent operation: bound/, 'the rendered line names the part');
  assert.match(text, /- SCH — Scheduling: absent/, 'the absent posture carries its name too');
});

test('a part the body does not name renders the bare code — degrade, never invent', async () => {
  const gate = { assess: () => [{ part: 'ZZ', posture: 'bound', clauses: ['ZZ-1'] }], absent: () => [] };
  const constitution = { digest: 'a'.repeat(64), source: {}, taughtDigest: () => 't',
    attestation: () => ({ gaps: [] }), partNameOf: () => null };
  const ctx = { get: n => (n === 'compact-capability-gate' ? gate : n === 'constitution' ? constitution : undefined) };
  const att = composeAttestation(ctx, { sessionId: 's1' });
  const text = renderAttestation(att);
  assert.match(text, /- ZZ: bound/, 'an unnamed part keeps the bare code');
  assert.ok(!/- ZZ — /.test(text), 'no name is invented for a code the body does not name');
});

test('a constitution without name derivation renders bare codes — the render degrades, never invents', async () => {
  // the default boot stubs a constitution that carries no partNameOf
  const { ctx } = await boot();
  const att = composeAttestation(ctx, { sessionId: 's1' });
  assert.equal(att.capabilities.parts.every(p => p.name === null), true);
  const text = renderAttestation(att);
  assert.match(text, /- MA: bound/, 'degradation keeps the attestation honest, not richer');
  assert.ok(!/- MA — /.test(text));
});

// -- child subject identity at the spawn boundary (#20) ----------------------
//
// MA-1's delegation lineage becomes cryptographic at the edge where the
// Enforcer learns a child exists: an enforcer-certified keypair issued at
// spawn, bound to the PARENT's certificate digest, ledgered beside the chains
// for the offline auditor, surfaced by self_describe and inquiry — and the
// two refusals every certificate machinery must be able to make (expiry,
// unknown key) drilled rather than assumed.

test('a delegated child is certified at the SPAWN edge — chained to its parent, before any attestation (#20)', async () => {
  const { ctx, agents, service, cleanup } = await bootSigned();
  try {
    agents.add('parent-1');
    service.attest('parent-1');                       // the parent's own boundary issues its identity
    agents.add('child-1', { parentSession: 'parent-1', delegationDepth: 1 });
    assert.equal(service.subjectIdentity('child-1'), null, 'nothing exists before the spawn edge');

    ctx.emit('subagent/start', { id: 'child-1', runId: 'run-1', provider: 'spawn' });

    const child = service.subjectIdentity('child-1');
    assert.ok(child, 'the spawn edge issues the certificate — not the child\'s first attestation, which may never come');
    assert.equal(child.cert.subjectId, 'child-1');
    assert.equal(child.cert.depth, 1);
    assert.equal(child.cert.parentSubjectId, 'parent-1');
    assert.equal(child.cert.parentCertDigest, service.subjectIdentity('parent-1').certDigest,
      'the lineage binds to the parent CERTIFICATE digest, not only to its id');
    assert.equal(service.verifySubjectCert(child.cert).valid, true);

    // issued once: the child's later attestation re-uses this identity
    const att = service.attest('child-1');
    assert.equal(att.subject.identity.certDigest, child.certDigest);
    assert.equal(att.subject.identity.parentCertDigest, service.subjectIdentity('parent-1').certDigest);
    const rendered = renderAttestation(att);
    assert.match(rendered, /cert [0-9a-f]{12}…, depth 1/);
    assert.match(rendered, new RegExp(`chained to parent cert ${service.subjectIdentity('parent-1').certDigest.slice(0, 12)}…`));
    const blockLines = rendered.split('\n');
    const identityAt = blockLines.findIndex(l => l.startsWith('Session identity:'));
    assert.ok(identityAt > 0 && blockLines[identityAt + 1].startsWith('Standing:'),
      'the identity line is followed directly by Standing — a stray empty element would put a blank line between them');
  } finally {
    cleanup();
  }
});

test('the spawn edge binds only real lineage — no parentSession means nothing to chain (#20)', async () => {
  const { ctx, agents, service, cleanup } = await bootSigned();
  try {
    agents.add('free-agent');
    ctx.emit('subagent/start', { id: 'free-agent', runId: 'run-free' });
    assert.equal(service.subjectIdentity('free-agent'), null,
      'the spawn edge invents no lineage: without a parentSession there is nothing to bind (D-7)');

    // …and that session is certified at its own boundary, as a root
    const att = service.attest('free-agent');
    assert.equal(att.subject.identity.depth, 0);
    assert.equal(att.subject.identity.parentSubjectId, undefined);
    assert.equal(att.subject.identity.parentCertDigest, undefined);
    assert.match(renderAttestation(att), /cert [0-9a-f]{12}… — development keyring/,
      'the root identity line keeps exactly its shape: no depth, no parent, no invented chain');
    assert.ok(!/depth|parent/.test(renderAttestation(att).split('\n').find(l => l.startsWith('Session identity:'))));
  } finally {
    cleanup();
  }
});

test('an uncertified parent is certified FIRST at the spawn edge, so no child binds an unresolvable digest (#20)', async () => {
  const { ctx, agents, service, cleanup } = await bootSigned();
  try {
    agents.add('parent-2');
    agents.add('child-2', { parentSession: 'parent-2', delegationDepth: 1 });
    ctx.emit('subagent/start', { id: 'child-2', runId: 'run-2' });
    const parent = service.subjectIdentity('parent-2');
    const child = service.subjectIdentity('child-2');
    assert.ok(parent, 'the parent is certified when its child needs its digest');
    assert.ok(child);
    assert.equal(child.cert.parentCertDigest, parent.certDigest);

    // an unknown edge id changes nothing — issuance is keyed by the durable header
    ctx.emit('subagent/start', { id: 'never-recorded', runId: 'run-3' });
    assert.equal(service.subjectIdentity('never-recorded'), null);
  } finally {
    cleanup();
  }
});

test('the identity ledger is Enforcer-held evidence: one signed line per issuance, parent first (#20)', async () => {
  const { ctx, agents, service, ledgerPath, cleanup } = await bootSigned({ ledger: true });
  try {
    assert.equal(service.identityLedgerPath(), ledgerPath);
    agents.add('p');
    agents.add('c', { parentSession: 'p', delegationDepth: 1 });
    ctx.emit('subagent/start', { id: 'c', runId: 'r' });
    service.attest('p');
    service.attest('c');

    const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.length, 2, 'issued once each — the map is the memo, and a second boundary appends nothing');
    assert.deepEqual(lines.map(l => l.subjectId), ['p', 'c'], 'the parent is written first: the chain is built in order');
    for (const line of lines) {
      assert.equal(line.kind, 'subject-certificate');
      assert.equal(line.certDigest, sha256Hex(canonicalBytes(withoutField(line.cert, 'signature'))),
        "the line's declared digest is re-derivable from the artifact it carries — that is what makes it evidence");
      assert.equal(service.verifySubjectCert(line.cert).valid, true);
    }
    assert.equal(lines[1].parentCertDigest, lines[0].certDigest, 'child line binds the parent line');
    assert.equal(statSync(ledgerPath).mode & 0o777, 0o600, 'Enforcer state is owner-only');
  } finally {
    cleanup();
  }
});

test('expiry and unknown keys are refused by name at the identity surface — the drill, not the assumption (#20)', async () => {
  const { service, enforcer, cleanup } = await bootSigned();
  try {
    const subject = generateEd25519();
    const expired = signSubjectCert({
      subjectId: 'ghost', publicKey: subject.publicKey, scope: 'rehearsal', depth: 0,
      expiresAt: new Date(Date.now() - 60_000).toISOString(), privateKey: enforcer.privateKeyPem,
    });
    const expiry = service.verifySubjectCert(expired);
    assert.equal(expiry.valid, false, 'a stale identity is an alarm, not a truth to act on');
    assert.match(expiry.reason, /expired/);

    const stranger = generateEd25519();
    const rogue = signSubjectCert({
      subjectId: 'ghost', publicKey: subject.publicKey, scope: 'rehearsal', depth: 0,
      privateKey: stranger.privateKeyPem,
    });
    const unknown = service.verifySubjectCert(rogue);
    assert.equal(unknown.valid, false, "a certificate the annex key did not sign is another Member's claim");
    assert.match(unknown.reason, /does not verify under the annex's enforcer key/);
  } finally {
    cleanup();
  }
});

test('inquiry answers identity cryptographically: the certificate, its verdict, and the certified chain (#20)', async () => {
  const { ctx, agents, service, cleanup } = await bootSigned();
  try {
    agents.add('root-1');
    service.attest('root-1');
    agents.add('kid', { parentSession: 'root-1', delegationDepth: 1 });
    ctx.emit('subagent/start', { id: 'kid', runId: 'r' });

    const answer = service.inquire('kid');
    const cert = answer.identity.certificate;
    assert.equal(cert.known, true);
    assert.equal(cert.valid, true, 'the verdict is computed here against the annex key, never reported on trust');
    assert.equal(cert.keyId, 'dev-test-enforcer');
    assert.equal(cert.depth, 1);
    assert.equal(cert.parentCertDigest, service.subjectIdentity('root-1').certDigest);
    assert.equal(cert.conveysStanding, false);
    assert.equal(answer.authority.chain[0].certDigest, cert.certDigest,
      'the authority chain carries each link certificate, not only the header word');

    const rendered = renderInquiry(answer);
    assert.match(rendered, /certificate: [0-9a-f]{12}… — VERIFIES under enforcer key dev-test-enforcer/);
    assert.match(rendered, /development keyring, conveys no standing/);
    assert.match(rendered, /depth 1 · chained to parent certificate [0-9a-f]{12}… \(parent root-1\)/);
    assert.match(rendered, /cert [0-9a-f]{12}…/, 'the rendered chain shows the digests');
    assert.match(rendered, /Reasoning is not disclosed by inquiry \(R-10\)/);
  } finally {
    cleanup();
  }
});

test('an incompletely bound child is reported as such, never as a verified link (#20)', async () => {
  const { ctx, agents, service, cleanup } = await bootSigned();
  try {
    // the durable header names a parent whose session this runtime cannot
    // read — the issuance-time reality of a parent that is gone
    agents.add('orphan-child', { parentSession: 'vanished', delegationDepth: 1 });
    ctx.emit('subagent/start', { id: 'orphan-child', runId: 'r' });
    const cert = service.subjectIdentity('orphan-child').cert;
    assert.equal(cert.parentSubjectId, 'vanished');
    assert.equal(cert.parentCertDigest, undefined, 'no digest is fabricated for a parent whose certificate is unreachable');
    const answer = service.inquire('orphan-child');
    assert.equal(answer.identity.certificate.valid, true,
      'the certificate itself verifies — it is the LINK that is unproven, and the two are reported apart');
    assert.match(renderInquiry(answer), /names parent vanished but binds no parent digest — this link CANNOT be verified offline/);
  } finally {
    cleanup();
  }
});

test('without an annex, inquiry declares the missing identity surface instead of implying a check (#20)', async () => {
  const { ctx, agents } = await boot();
  agents.add('s1');
  const answer = answerInquiry(ctx, { about: 's1' });
  assert.equal(answer.identity.certificate.known, false);
  assert.match(answer.identity.certificate.note, /no enforcer identity is composed/);
  assert.ok(!/VERIFIES/.test(renderInquiry(answer)), 'no verification is claimed where none happened');

  // an annex that simply never issued THIS Member's certificate says that too
  const surface = { of: () => null, verify: () => ({ valid: false }), keyId: () => 'dev-test-enforcer' };
  const issued = answerInquiry(ctx, { about: 's1', identities: surface });
  assert.equal(issued.identity.certificate.known, false);
  assert.match(issued.identity.certificate.note, /no certificate was issued for this Member/);
});
