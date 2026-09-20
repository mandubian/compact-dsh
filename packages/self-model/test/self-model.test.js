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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEd25519, signAnnex } from 'compact-dsh-seals';
import { COMPACT_DIGEST } from 'compact-dsh-constitution';

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

async function bootSigned() {
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
  const service = apply(ctx, { enforcer: { annexPath, privateKeyPath: keyPath } });
  return { ctx, agents, service, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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
