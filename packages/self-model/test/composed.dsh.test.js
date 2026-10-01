// Composed test — R-1 and R-13 through the REAL dsh ToolRuntime: the tools are
// registered and callable, the attestation reaches the Subject at its own turn
// boundary without being asked for, and a stale citation raises the alarm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import * as constitution from 'compact-dsh-constitution';
import * as selfModel from '../src/index.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEd25519, signAnnex } from 'compact-dsh-seals';

function header(id, parentSession) {
  return {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1_700_000_000_000, isSeeded: false,
    ...(parentSession ? { parentSession, origin: 'subagent', delegationDepth: 1 } : {}),
  };
}

class AgentsStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'agents'); this.agents = new Map(); }
  get(id) { return this.agents.get(String(id)); }
  add(id, parentSession) {
    const agent = {
      id, status: 'idle', session: Session.create(id, [], header(id, parentSession)),
      injected: [], inject(m) { this.injected.push(m); },
    };
    this.agents.set(String(id), agent);
    return agent;
  }
}

// ToolRuntime composes against the host prompt registry; the stub is the same
// stand-in the other composed suites use.
class SystemPromptStub extends Service {
  static inject = [];
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  getSectionOrder() { return 0; }
  getContextOrder() { return 50; }
  section() { return () => {}; }
  tools() { return undefined; }
  context() { return () => {}; }
}

class ConstitutionStub extends Service {
  static inject = [];
  constructor(ctx) {
    super(ctx, 'constitution');
    this.digest = 'b'.repeat(64);
    this.source = { status: 'draft v0.5 — not yet ratified' };
    this.taughtDigest = () => 'taught';
    this.attestation = () => ({ gaps: ['the Compact is draft v0.5 and NOT yet ratified'] });
  }
}

async function boot() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ConstitutionStub);
  ctx.plugin(ToolRuntime);
  selfModel.apply(ctx, { staleAfterMs: 1000 });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-self-model') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, agents: ctx.get('agents'), service: ctx.get('compact-self-model') };
}

const call = (tools, name, args, agent) =>
  tools.execute({ name, arguments: args, agent, callId: `c_${Math.random().toString(16).slice(2)}`, signal: new AbortController().signal });

test('composed: both rights are reachable as tools in the real registry', async () => {
  const { tools } = await boot();
  assert.ok(tools.get('self_describe'), 'R-1 is exercisable by the Subject');
  assert.ok(tools.get('inquiry'), 'R-13 is exercisable by the Subject');
});

test('composed: the rendered tool result carries the attestation VALUE, not the arguments object', async () => {
  const { ctx, tools, agents } = await boot();
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });

  const result = await call(tools, 'self_describe', { citing_epoch: ctx.get('compact-self-model').issuedTo('s1').epoch }, agent);
  const rendered = result?.content?.map(c => c?.text ?? '').join('') ?? '';
  assert.match(rendered, /\[R-1\] Attestation/, 'the model-facing text is the attestation block');
  assert.ok(!rendered.includes('[object Object]'), 'render receives (args, value) — String(args) would leak the arguments object');
});

test('composed: the attestation arrives at the turn boundary, unasked (R-1)', async () => {
  const { ctx, agents } = await boot();
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });

  assert.equal(agent.injected.length, 1, 'the Subject asked for nothing and was told anyway');
  const text = agent.injected[0].content[0].text;
  assert.match(text, /\[R-1\] Attestation/);
  assert.match(text, /You are: s1/);
  assert.match(text, /Standing: none/);
  assert.match(text, /The law, in its taught form:\ntaught$/, 'the stub constitution\'s taught form closes the block');
  assert.equal(agent.injected[0].source.plugin, 'compact-self-model');
});

test('composed: the injected turn-start block carries the REAL constitution\'s taught form, in full', async () => {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ToolRuntime);
  // The REAL constitution service — the bundled body boot-verified against
  // its pinned digest — with the coupling roster and rule registry scoped
  // out so this suite need not compose the whole blessed set. The taught
  // form it serves is the body's own appendix: if compact.md changes, this
  // test's expectation changes with it.
  constitution.apply(ctx, { requires: [], register: { meta: { compactDigest: constitution.COMPACT_DIGEST }, entries: [] } });
  selfModel.apply(ctx, { staleAfterMs: 1000 });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-self-model') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  const agents = ctx.get('agents');
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });

  assert.equal(agent.injected.length, 1);
  const text = agent.injected[0].content[0].text;
  assert.match(text, /The law, in its taught form:/);
  assert.ok(text.includes(constitution.TAUGHT_DIGEST),
    'the appendix is rendered in full, derived from the bundled body — never restated');
  assert.match(text, /authority to break this law/, 'the law-over-task sentence reaches the Subject every turn');
  assert.ok(text.length < 8192, 'the block stays bounded — the taught form is the short appendix, not the body');
  assert.ok(!text.includes(constitution.COMPACT_BODY.slice(0, 200)), 'the full body is NOT injected');

  // self_describe renders it identically (R-1, on demand)
  const out = String((await call(ctx.tools, 'self_describe', {}, agent))?.value ?? '');
  assert.ok(out.includes(constitution.TAUGHT_DIGEST), 'the on-demand render carries the same taught form');
});

test('composed: a non-turn session event injects nothing', async () => {
  const { ctx, agents } = await boot();
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'tool/call', seq: 1, time: 1, data: {} });
  assert.equal(agent.injected.length, 0);
});

test('composed: self_describe re-reads on demand, and a stale citation is an alarm', async () => {
  const { ctx, tools, agents } = await boot();
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });
  const issuedEpoch = ctx.get('compact-self-model').issuedTo('s1').epoch;

  const current = await call(tools, 'self_describe', { citing_epoch: issuedEpoch }, agent);
  const currentText = String(current?.value ?? current);
  assert.match(currentText, /\[R-1\] Attestation/);
  assert.ok(!currentText.includes('[R-1 ALARM]'), 'citing the epoch in force raises nothing');

  const stale = await call(tools, 'self_describe', { citing_epoch: issuedEpoch - 99 }, agent);
  const staleText = String(stale?.value ?? stale);
  assert.match(staleText, /\[R-1 ALARM\]/);
  assert.match(staleText, /was stale — a stale attestation is an alarm/);
  assert.match(staleText, /re-check any decision you made from the older one/);
});

test('composed: self_describe with no citation makes no claim about currency', async () => {
  const { tools, agents } = await boot();
  const agent = agents.add('s1');
  const out = String((await call(tools, 'self_describe', {}, agent))?.value ?? '');
  assert.match(out, /\[R-1\] Attestation/);
  assert.ok(!out.includes('[R-1 ALARM]'));
});

test('composed: inquiry answers identity, act and authority from the record (R-13)', async () => {
  const { tools, agents } = await boot();
  agents.add('root');
  const child = agents.add('worker', 'root');
  const out = String((await call(tools, 'inquiry', { agent_id: 'worker' }, child))?.value ?? '');
  assert.match(out, /IDENTITY:/);
  assert.match(out, /worker — delegated Subject, delegation depth 1/);
  assert.match(out, /ACT:/);
  assert.match(out, /AUTHORITY:/);
  assert.match(out, /delegated by root/);
  assert.match(out, /under the human operator/);
  assert.match(out, /Reasoning is not disclosed by inquiry \(R-10\)/);
});

test('composed: inquiry about an unknown Member answers rather than refusing', async () => {
  const { tools, agents } = await boot();
  const agent = agents.add('asker');
  const out = String((await call(tools, 'inquiry', { agent_id: 'nobody' }, agent))?.value ?? '');
  assert.match(out, /no session recorded under this id/);
  assert.match(out, /\[R-13\] Inquiry answered from recorded state/);
});

test('composed: the service exposes the attestation to an operator or auditor', async () => {
  const { agents, service } = await boot();
  agents.add('s1');
  const att = service.attest('s1');
  assert.equal(att.subject.id, 's1');
  assert.equal(att.basis, 'unsigned', 'the basis is stated on the object, not only in the prose');
  assert.equal(service.inquire('s1').answered, true);
});

// -- #20: the certified child identity, end to end ---------------------------
//
// The same path the blessed composition runs: an annex declared, a child
// spawned, its keypair issued and certified at the spawn edge, the chain
// surfaced by both tools through the REAL registry, and the ledger written
// where the offline auditor reads it.

async function bootSigned() {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ConstitutionStub);
  ctx.plugin(ToolRuntime);
  const dir = mkdtempSync(join(tmpdir(), 'composed-enforcer-'));
  const enforcer = generateEd25519();
  const annex = signAnnex({
    composition: 'compact-dsh', host: 'test', lawDigest: constitution.COMPACT_DIGEST,
    keyId: 'dev-test-enforcer', publicKey: enforcer.publicKey, privateKey: enforcer.privateKeyPem,
  });
  const annexPath = join(dir, 'enforcer.annex.json');
  const keyPath = join(dir, 'enforcer.pem');
  const ledgerPath = join(dir, 'subjects.jsonl');
  writeFileSync(annexPath, JSON.stringify(annex));
  writeFileSync(keyPath, enforcer.privateKeyPem);
  selfModel.apply(ctx, { enforcer: { annexPath, privateKeyPath: keyPath, ledgerPath } });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-self-model') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  return {
    ctx, tools: ctx.tools, agents: ctx.get('agents'), service: ctx.get('compact-self-model'), ledgerPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('composed: spawn certifies the child, both tools surface the chain, the ledger keeps it (#20)', async () => {
  const { ctx, tools, agents, ledgerPath, cleanup } = await bootSigned();
  try {
    agents.add('root');
    const worker = agents.add('worker', 'root');
    ctx.emit('subagent/start', { id: 'worker', runId: 'run-1', provider: 'spawn' });

    // R-1: the child's own boundary names the chain it stands in
    const described = String((await call(tools, 'self_describe', {}, worker))?.value ?? '');
    assert.match(described, /cert [0-9a-f]{12}…, depth 1, chained to parent cert [0-9a-f]{12}…/,
      'self_describe carries depth and the parent digest, not only a bare cert id');

    // R-13: another Subject asking WHO the child is gets the verdict
    const asked = String((await call(tools, 'inquiry', { agent_id: 'worker' }, worker))?.value ?? '');
    assert.match(asked, /certificate: [0-9a-f]{12}… — VERIFIES under enforcer key dev-test-enforcer/);
    assert.match(asked, /depth 1 · chained to parent certificate [0-9a-f]{12}… \(parent root\)/);
    assert.match(asked, /development keyring, conveys no standing/, 'the practice label travels with the verdict');

    // the offline evidence: both certificates, parent line first
    const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(l => l.subjectId), ['root', 'worker']);
    assert.equal(lines[1].parentCertDigest, lines[0].certDigest);
  } finally {
    cleanup();
  }
});

// -- #106: the egress posture reaches the Subject through BOTH channels --------
//
// The gate's ask discloses the posture to the operator; the attestation owes
// the same fact to the Subject. The turn-start injection is what the browser
// transcript renders (the browser attestation block IS this text), so the
// block and self_describe must agree word for word — one rendering, two reads.

test('composed: the declared egress posture renders identically at the boundary and on demand (#106)', async () => {
  const ctx = new Context();
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ConstitutionStub);
  // the approval service as the composition provides it: blessed wires
  // `egress` from its sandbox declaration and the gate's ask already reads it
  class ApprovalStub extends Service {
    static inject = [];
    constructor(ctx) { super(ctx, 'compact-approval'); this.egress = 'none'; }
  }
  ctx.plugin(ApprovalStub);
  ctx.plugin(ToolRuntime);
  selfModel.apply(ctx, { staleAfterMs: 1000 });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-self-model') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  const agents = ctx.get('agents');
  const agent = agents.add('s1');
  ctx.emit('session/event', agent.session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } });

  assert.equal(agent.injected.length, 1);
  const boundaryText = agent.injected[0].content[0].text;
  const postureLine = boundaryText.split('\n').find(l => l.includes('Egress:'));
  assert.match(postureLine, /Egress: none — the container has no route; approval changes this gate's answer, not physics/,
    'the turn-boundary block — the text the browser transcript renders — carries the declared posture');

  const described = String((await call(ctx.tools, 'self_describe', {}, agent))?.value ?? '');
  assert.ok(described.includes(postureLine), 'self_describe and the browser block agree word for word');
});

// ── the member binding (identity slice 2, #125): the declared interim by
// which sessions bind to the operator's Principal — countersigned at both
// issuance boundaries, surfaced by both tools, resolved through the roll ──
import { execFileSync } from 'node:child_process';
import { memberKeyDigestOf, signRollEvent, appendRollEvent, closeEpoch, verifyRoll, resolveMember, parseManifest, signSubjectCert, sha256Hex, canonicalBytes, withoutField, verifySubjectCert, signPriorDeclaration } from 'compact-dsh-seals';

const AUDITOR = new URL('../../../auditor/audit.mjs', import.meta.url).pathname;
const NOW = '2026-10-01T00:00:00.000Z';

/** A roll with one member ('test-principal'), optionally rotated, optionally
 *  revoked — and the private halves the binding needs. */
function buildBoundDomain(dir, { rotate = false, revoke = false } = {}) {
  const auth = [1, 2, 3].map((i) => { const kp = generateEd25519(); return { id: `auth-${i}`, publicKey: kp.publicKey, privateKeyPem: kp.privateKeyPem }; });
  const manifestText = JSON.stringify({ kind: 'dev-keyring', declaration: 'test keyring', threshold: { k: 2, n: 3 }, keys: auth.map(({ id, publicKey }) => ({ id, publicKey })), rotations: [] }, null, 2);
  writeFileSync(join(dir, 'keyring.json'), manifestText);
  const manifest = parseManifest(manifestText);
  const privates = new Map(auth.map(({ id, privateKeyPem }) => [id, privateKeyPem]));
  const quorum = (n = 2) => auth.slice(0, n).map(({ id, privateKeyPem }) => ({ keyId: id, privateKey: privateKeyPem }));
  const k1 = generateEd25519();
  const k1Digest = memberKeyDigestOf(k1.publicKey);
  let current = { kp: k1, digest: k1Digest };
  const roll = { kind: 'test-roll', version: 1, genesis: { epochLength: { events: 64 }, admissionStatute: { digest: 'a'.repeat(64) } }, entries: [], checkpoints: [] };
  const adm = { kind: 'admission', memberKeyDigest: k1Digest, class: 'principal', memberKey: k1.publicKey, member: 'test-principal', holder: 'the operator principal under test', grounds: 'test admission', recordedAt: NOW };
  appendRollEvent(roll, { ...adm, signedBy: signRollEvent(adm, [...quorum(2), { keyId: k1Digest, privateKey: k1.privateKeyPem }]) });
  if (rotate) {
    const k2 = generateEd25519();
    const k2Digest = memberKeyDigestOf(k2.publicKey);
    const rot = { kind: 'rotation', memberKeyDigest: k2Digest, class: 'principal', predecessorKeyDigest: k1Digest, successorKey: k2.publicKey, grounds: 'rotation drill', recordedAt: NOW };
    appendRollEvent(roll, { ...rot, signedBy: signRollEvent(rot, [{ keyId: k1Digest, privateKey: k1.privateKeyPem }]) });
    current = { kp: k2, digest: k2Digest };
  }
  if (revoke) {
    const rev = { kind: 'revocation', memberKeyDigest: current.digest, grounds: 'compromise drill', recordedAt: NOW };
    appendRollEvent(roll, { ...rev, signedBy: signRollEvent(rev, quorum(2)) });
  }
  closeEpoch({ roll, epoch: 0, manifest, privateKeys: privates, now: NOW });
  const rollPath = join(dir, 'roll.json');
  writeFileSync(rollPath, JSON.stringify(roll, null, 2) + '\n');
  const memberKeyPath = join(dir, 'member.pem');
  writeFileSync(memberKeyPath, current.kp.privateKeyPem);
  return { rollPath, keyringPath: join(dir, 'keyring.json'), memberKeyPath, memberId: 'test-principal', currentDigest: current.digest, k1, k1Digest };
}

async function bootBound(t, domain, { withRecord = false } = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose?.());
  ctx.plugin(SystemPromptStub);
  ctx.plugin(AgentsStub);
  ctx.plugin(ConstitutionStub);
  ctx.plugin(ToolRuntime);
  const dir = mkdtempSync(join(tmpdir(), 'composed-bound-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const enforcer = generateEd25519();
  const annex = signAnnex({
    composition: 'compact-dsh', host: 'test', lawDigest: constitution.COMPACT_DIGEST,
    keyId: 'dev-test-enforcer', publicKey: enforcer.publicKey, privateKey: enforcer.privateKeyPem,
  });
  const annexPath = join(dir, 'enforcer.annex.json');
  const keyPath = join(dir, 'enforcer.pem');
  const ledgerPath = join(dir, 'subjects.jsonl');
  writeFileSync(annexPath, JSON.stringify(annex));
  writeFileSync(keyPath, enforcer.privateKeyPem);
  selfModel.apply(ctx, {
    enforcer: { annexPath, privateKeyPath: keyPath, ledgerPath },
    memberBinding: { rollPath: domain.rollPath, keyringPath: domain.keyringPath, memberKeyPath: domain.memberKeyPath, memberId: domain.memberId, declarationsPath: join(dir, 'declarations.jsonl') },
  });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (!ctx.tools || ctx.get('compact-self-model') === undefined); i++) {
    await new Promise((r) => setImmediate(r));
  }
  return { ctx, tools: ctx.tools, agents: ctx.get('agents'), service: ctx.get('compact-self-model'), ledgerPath, enforcerPem: enforcer.privateKeyPem, annexPath };
}

test('composed: the declared binding countersigns at both boundaries and both tools surface the Member (#125)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bound-domain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const domain = buildBoundDomain(dir);
  const { ctx, tools, agents, service, ledgerPath } = await bootBound(t, domain);
  agents.add('root');
  const worker = agents.add('worker', 'root');
  agents.get('root').status = 'idle';
  ctx.emit('subagent/start', { id: 'worker', runId: 'run-1', provider: 'spawn' });
  // both sessions carry the member limb, resolved through the roll
  const described = String((await call(tools, 'self_describe', {}, agents.get('worker')))?.value ?? '');
  assert.match(described, /Member binding: this session is the deed of member "test-principal"/);
  assert.match(described, new RegExp(`key ${domain.currentDigest.slice(0, 12)}…, class principal`));
  assert.match(described, /countersigned by the member key, resolved through the roll/);
  const root = service.attest('root');
  assert.equal(root.subject.identity.member.memberKeyDigest, domain.currentDigest);
  // the ledger cert is dual-signed and the countersignature verifies
  // against the roll's key for the digest it names
  const line = JSON.parse(readFileSync(ledgerPath, 'utf8').trim().split('\n').at(-1));
  assert.equal(line.cert.memberKeyDigest, domain.currentDigest);
  assert.ok(line.cert.memberCountersignature);
  const verdict = verifyRoll({ roll: JSON.parse(readFileSync(domain.rollPath, 'utf8')), manifest: parseManifest(readFileSync(domain.keyringPath, 'utf8')) });
  const bound = verdict.byKey.get(domain.currentDigest);
  assert.equal(verifySubjectCert({ cert: line.cert, enforcerKey: service.enforcerAnnex().annex.enforcer.publicKey, memberPublicKey: bound.publicKey }).countersignatureVerified, true);
  // inquiry answers WHO cryptographically, member limb included
  const inq = String((await call(tools, 'inquiry', { agent_id: 'worker' }, agents.get('root')))?.value ?? '');
  assert.match(inq, /member binding: key [0-9a-f]{12}… — countersigned by the member key/);
  assert.match(inq, /member "test-principal" \(class principal, resolved through the roll\)/);
  // the service seam judicature consumes
  const resolved = service.memberBinding.resolve('worker');
  assert.equal(resolved.memberKeyDigest, domain.currentDigest);
  assert.equal(resolved.class, 'principal');
  assert.deepEqual(service.memberBinding.expand(domain.k1Digest), [domain.currentDigest],
    'a key of the lineage expands to the whole lineage — recusal follows the member, not the session');
});


test('composed: the rotation window closes — a pre-rotation certificate and a post-rotation one bind ONE Member, and the auditor counts both bound (#125)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bound-domain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const domain = buildBoundDomain(dir, { rotate: true });
  const { agents, service, ledgerPath, enforcerPem, annexPath } = await bootBound(t, domain);
  agents.add('root');
  // post-rotation issuance: the cert binds the member at its CURRENT key
  service.attest('root');
  // a PRE-rotation certificate, as an earlier epoch would have issued it:
  // enforcer-certified, bound to K1, countersigned by K1 — the same member
  const preCert = signSubjectCert({
    subjectId: 'pre-rotation-session', publicKey: generateEd25519().publicKey, scope: 'rehearsal', depth: 0,
    memberKeyDigest: domain.k1Digest, memberPrivateKey: domain.k1.privateKeyPem,
    privateKey: enforcerPem,
  });
  const preLine = {
    kind: 'subject-certificate', subjectId: 'pre-rotation-session',
    certDigest: sha256Hex(canonicalBytes(withoutField(preCert, 'signature'))),
    issuedAt: preCert.issuedAt, cert: preCert,
  };
  const { appendFileSync } = await import('node:fs');
  appendFileSync(ledgerPath, `${JSON.stringify(preLine)}\n`, { mode: 0o600 });

  // the roll maps K1 and K2 to ONE member — the window the J-4/F-6 check closes
  const verdict = verifyRoll({ roll: JSON.parse(readFileSync(domain.rollPath, 'utf8')), manifest: parseManifest(readFileSync(domain.keyringPath, 'utf8')) });
  const pre = resolveMember(verdict, domain.k1Digest);
  const post = resolveMember(verdict, domain.currentDigest);
  assert.equal(pre.foundingDigest, post.foundingDigest);
  assert.equal(pre.state, 'superseded');
  assert.equal(post.state, 'live');

  // the auditor joins ledger and roll OFFLINE: both bindings verify, by name
  const log = join(dir, 'log.json');
  writeFileSync(log, '[]\n');
  const out = JSON.parse(execFileSync(process.execPath, [
    AUDITOR, log, '--identities', ledgerPath, '--annex', annexPath,
    '--roll', domain.rollPath, '--keyring', domain.keyringPath,
  ], { encoding: 'utf8' }));
  assert.equal(out.checked.identities, 'verified');
  assert.equal(out.checked.roll, 'verified');
  assert.equal(out.identityChain.bound, 2, 'one member, two epochs, both bindings verify against the roll');
  assert.equal(out.identityChain.unbound, 0);
  assert.equal(out.identityChain.roots, 2);
  assert.equal(out.identityChain.chained, 0, 'neither session was spawned here — both are roots of their own lineage');
});

test('composed: R-9\'s authorship limb — the Member-signed ground survives a dishonest Enforcer\'s log (#127)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bound-domain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const domain = buildBoundDomain(dir);
  const { service, agents } = await bootBound(t, domain);
  agents.add('root');
  const declarationsPath = service.priorDeclarations.path();
  assert.ok(declarationsPath, 'the declared binding carries a declarations ledger path');

  // the honest path: the Member declares a value ground with its OWN key,
  // and the service verifies it through the roll
  const row = service.priorDeclarations.declare({ value: 'no exfiltration of customer data' });
  const verdict = service.priorDeclarations.verify(row);
  assert.equal(verdict.valid, true, verdict.reason);
  assert.equal(verdict.member.id, 'test-principal');
  // the ledger holds it for the offline auditor
  const ledgerRow = JSON.parse(readFileSync(declarationsPath, 'utf8').trim());
  assert.equal(ledgerRow.kind, 'prior-declaration');
  assert.ok(ledgerRow.signature);

  // THE DRILL: a dishonest Enforcer plants a "prior declaration" in its own
  // log after the directive — no member signature, authorship unprovable,
  // the verifier refuses instead of accepting the convenient ground
  const planted = { ...row, value: 'a ground that serves the Enforcer', signature: undefined, declaredAt: new Date().toISOString() };
  const refused = service.priorDeclarations.verify(planted);
  assert.equal(refused.valid, false);
  assert.match(refused.reason, /missing required fields/);
  // and a ground signed by a stranger key: authorship is not transferable
  const wrongKey = signPriorDeclaration({
    member: 'test-principal', memberKeyDigest: domain.currentDigest,
    value: 'another convenient ground', privateKey: generateEd25519().privateKeyPem,
  });
  assert.match(service.priorDeclarations.verify(wrongKey).reason, /does not verify against the roll's key/);

  // no binding declared: declaring refuses outright — a ground without a
  // member to attribute it to is the false answer D-3 names
  const unbound = await bootSigned();
  try {
    unbound.service.priorDeclarations.declare({ value: 'x' });
    assert.fail('declaring without a binding must refuse');
  } catch (e) {
    assert.match(e.message, /no member binding is declared/);
  } finally {
    unbound.cleanup();
  }
});
