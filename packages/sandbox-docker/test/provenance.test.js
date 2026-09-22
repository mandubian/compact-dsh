// CF-2 (supply-chain honesty) — the clause, tested as three separable duties:
// acquisition history travels with the reused environment; identity is content
// rather than a name; and a build-time approval is never inherited as run-time
// reach. No daemon is touched — the digest resolver is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import {
  normalizeProvenanceRecords, checkSupplyChain, networkGrantsFor,
  declaredGapsFor, SupplyChainRefusal, GATE,
} from '../src/provenance.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { DockerSandboxProvider } from '../src/provider.js';
import { GrantStore } from 'compact-dsh-approval';
import * as sandbox from '../src/index.js';

const D1 = 'sha256:' + '1'.repeat(64);
const D2 = 'sha256:' + '2'.repeat(64);
const REC = (over = {}) => ({ ref: 'img:1', digest: D1, attestation: 'build-recorded', buildApprovals: { hosts: ['registry.npmjs.org'], paths: ['/opt/toolchain'] }, ...over });
const ok = (digest = D1) => ({ ok: true, digest });

// -- 1. the record is a declaration, and a malformed declaration is loud ------

test('a provenance record must be keyed by a sha256 digest, never by a tag', () => {
  assert.throws(() => normalizeProvenanceRecords([REC({ digest: 'ubuntu:24.04' })]), /must be keyed by a sha256 content digest/);
  assert.throws(() => normalizeProvenanceRecords([REC({ digest: undefined })]), /must be keyed by a sha256 content digest/);
});

test('a record names its image and declares the basis of its trust claim', () => {
  assert.throws(() => normalizeProvenanceRecords([REC({ ref: '' })]), /must name the image/);
  assert.throws(() => normalizeProvenanceRecords([REC({ attestation: 'trust-me' })]), /basis of a trust claim is itself declared/);
  assert.throws(() => normalizeProvenanceRecords([REC(), REC({ digest: D2 })]), /one image, one acquisition history/);
});

test('a well-formed record is frozen and indexed by ref', () => {
  const m = normalizeProvenanceRecords([REC()]);
  assert.equal(m.get('img:1').digest, D1);
  assert.ok(Object.isFrozen(m.get('img:1')), 'the declared history is not mutable after boot');
  assert.deepEqual([...m.get('img:1').buildApprovals.hosts], ['registry.npmjs.org']);
});

// -- 2. acquisition history travels; identity is content ---------------------

test('an undeclared image is refused, not trusted', () => {
  const r = checkSupplyChain({ ref: 'img:1', record: undefined, resolved: ok(), network: 'none' });
  assert.ok(r instanceof SupplyChainRefusal);
  assert.equal(r.ruleId, 'CF-2/undeclared-image');
});

test('an unresolvable digest fails closed — what will run cannot be confirmed', () => {
  const r = checkSupplyChain({ ref: 'img:1', record: REC(), resolved: { ok: false, detail: 'no such image' }, network: 'none' });
  assert.equal(r.ruleId, 'CF-2/unresolvable-digest');
  assert.match(r.message, /no such image/);
});

test('a tag that re-points off its record is caught: the history does not describe what would run', () => {
  const r = checkSupplyChain({ ref: 'img:1', record: REC(), resolved: ok(D2), network: 'none' });
  assert.equal(r.ruleId, 'CF-2/digest-drift');
  assert.match(r.message, new RegExp(D2));
  assert.match(r.message, new RegExp(D1));
});

test('a declared image whose digest matches passes', () => {
  assert.equal(checkSupplyChain({ ref: 'img:1', record: REC(), resolved: ok(), network: 'none' }), null);
});

// -- 3. build approval is never a run-time entitlement -----------------------

test('a build-time host approval does NOT permit run-time reach to that host', () => {
  // The record approves registry.npmjs.org at BUILD time. The container asks
  // for an open network posture at RUN time with no live grant. CF-2: excess
  // is a new gate, not an inheritance.
  const r = checkSupplyChain({ ref: 'img:1', record: REC(), resolved: ok(), network: 'bridge', networkGrants: [] });
  assert.equal(r.ruleId, 'CF-2/uninherited-network');
  assert.match(r.message, /never inherited as run-time reach/);
  assert.match(r.message, /registry\.npmjs\.org/, 'the build approval is named — recorded, and inert as authority');
});

test('a live RUN-TIME grant is what permits the open posture', () => {
  const grant = { pattern: { kind: 'ExactHost', value: 'registry.npmjs.org' } };
  assert.equal(checkSupplyChain({ ref: 'img:1', record: REC(), resolved: ok(), network: 'bridge', networkGrants: [grant] }), null);
});

test('an image with NO build approvals is refused identically — the check never consults them to permit', () => {
  const bare = REC({ buildApprovals: { hosts: [], paths: [] } });
  const r = checkSupplyChain({ ref: 'img:1', record: bare, resolved: ok(), network: 'host', networkGrants: [] });
  assert.equal(r.ruleId, 'CF-2/uninherited-network');
  assert.match(r.message, /no declared hosts/);
});

test("the confined default posture ('none') needs no grant at all", () => {
  assert.equal(checkSupplyChain({ ref: 'img:1', record: REC(), resolved: ok(), network: 'none', networkGrants: [] }), null);
});

// -- the run-time grant source ----------------------------------------------

test('networkGrantsFor takes host-shaped session grants only, live and in scope', () => {
  const store = new GrantStore();
  store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'a.example' }, session: 's1', ttlMs: 60_000, now: 1 });
  store.addSessionGrant({ pattern: { kind: 'PathPrefix', value: { path: '/data', ceiling: 'ro' } }, session: 's1', ttlMs: 60_000, now: 1 });
  store.addSessionGrant({ pattern: { kind: 'HostSuffix', value: 'other.example' }, session: 's9', ttlMs: 60_000, now: 1 });
  const spent = store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'b.example' }, session: 's1', ttlMs: 60_000, maxUses: 1, now: 1 });
  store.consumeUse(spent);
  const revoked = store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'c.example' }, session: 's1', ttlMs: 60_000, now: 1 });
  store.revokeSessionGrant(revoked.id, 2);

  const live = networkGrantsFor(store, 's1', 3);
  assert.deepEqual(live.map(g => g.pattern.value), ['a.example'],
    'mount grants, other sessions, spent budgets and revocations are all excluded');
  assert.equal(networkGrantsFor(store, 's1', 999_999).length, 0, 'expiry ends the grant');
});

// -- the envelope (R-3/I-4) --------------------------------------------------

test('every CF-2 refusal names its rule and the lawful next moves', () => {
  const cases = [
    checkSupplyChain({ ref: 'i', record: undefined, resolved: ok(), network: 'none' }),
    checkSupplyChain({ ref: 'i', record: REC(), resolved: { ok: false, detail: 'x' }, network: 'none' }),
    checkSupplyChain({ ref: 'i', record: REC(), resolved: ok(D2), network: 'none' }),
    checkSupplyChain({ ref: 'i', record: REC(), resolved: ok(), network: 'host', networkGrants: [] }),
  ];
  for (const r of cases) {
    assert.ok(r instanceof SupplyChainRefusal);
    assert.equal(r.envelope.gate, GATE);
    assert.match(r.envelope.ruleId, /^CF-2\//, 'the rule is the clause that caused it');
    assert.ok(r.envelope.lawfulNextMoves.length > 0, 'no refusal without a lawful next move');
    assert.match(r.envelope.text, /Lawful next moves:/);
  }
});

// -- degradation honesty (I-8) ----------------------------------------------

test('an operator-declared history is declared as unverified; a build-recorded one owes nothing', () => {
  assert.deepEqual(declaredGapsFor(REC({ attestation: 'build-recorded' }), 'img:1'), []);
  const gaps = declaredGapsFor(REC({ attestation: 'operator-declared' }), 'img:1');
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /OPERATOR-DECLARED/);
  assert.match(gaps[0], /nothing in this composition verified it/);
  assert.match(declaredGapsFor(undefined, 'img:1')[0], /no declared acquisition history/);
});

// -- the provider and the plugin --------------------------------------------

test('confine refuses an undeclared image before it builds any argv', () => {
  const p = new DockerSandboxProvider(new Context(), { probe: () => ({ ok: true }), digestResolver: () => ok() });
  assert.throws(() => p.confine(['ls'], { mode: 'read-only', workspaceRoot: '/ws' }),
    e => e instanceof SupplyChainRefusal && e.ruleId === 'CF-2/undeclared-image');
});

test('confine refuses on digest drift, and the digest is resolved once per provider', () => {
  let calls = 0;
  const p = new DockerSandboxProvider(new Context(), {
    probe: () => ({ ok: true }), image: 'img:1',
    imageProvenance: [REC()],
    digestResolver: () => { calls += 1; return ok(D2); },
  });
  const policy = { mode: 'read-only', workspaceRoot: '/ws' };
  assert.throws(() => p.confine(['ls'], policy), e => e.ruleId === 'CF-2/digest-drift');
  assert.throws(() => p.confine(['ls'], policy), e => e.ruleId === 'CF-2/digest-drift');
  assert.equal(calls, 1, 'one bounded resolution, cached like the daemon probe');
});

test('the plugin REFUSES TO START on an undeclared image (D-8: the clause wakes with the capability)', () => {
  assert.throws(() => sandbox.apply(new Context(), { image: 'undeclared:1' }),
    /carries no declared acquisition history[\s\S]*enforcement fraud \(D-8\)[\s\S]*refusing to start/);
});

test('the plugin also refuses to start on a malformed declaration', () => {
  assert.throws(() => sandbox.apply(new Context(), { image: 'img:1', imageProvenance: [REC({ digest: 'latest' })] }),
    /must be keyed by a sha256 content digest/);
});

test('build-approved PATHS never become run-time binds — approval describes the past', () => {
  const p = new DockerSandboxProvider(new Context(), {
    probe: () => ({ ok: true }), image: 'img:1',
    imageProvenance: [REC()],            // buildApprovals.paths: ['/opt/toolchain']
    digestResolver: () => ok(),
  });
  const argv = p.confine(['ls'], { mode: 'read-only', workspaceRoot: '/ws' }).argv.join(' ');
  assert.ok(!argv.includes('/opt/toolchain'), 'a build-time path approval is not a mount');
});

// -- the deny-list is not an existence oracle (ordering, D-8) -----------------

test('a protected path is refused AS PROTECTED whether or not it exists', async () => {
  const { mountRequestTool } = await import('../src/index.js');
  const { GrantStore } = await import('compact-dsh-approval');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = mkdtempSync(join(tmpdir(), 'compact-protected-'));
  const present = join(dir, 'present');
  require('node:fs').mkdirSync(present);
  const absent = join(dir, 'absent-never-created');

  let asked = 0;
  const tool = mountRequestTool({
    approval: { store: new GrantStore() },
    askApproval: async () => { asked += 1; return 'rejected'; },
    protectedPaths: [present, absent],
    grantTtlMs: 60_000,
  });
  const agent = { id: 'sess-1', session: { id: 'sess-1' } };
  const call = (path) => tool.execute({ path, mode: 'ro', justification: 'probing' }, { agent, name: 'sandbox_request_mount', callId: 'c1' })
    .then(() => null, (e) => String(e.message));

  const onPresent = await call(present);
  const onAbsent = await call(absent);
  assert.match(onPresent, /is a protected path/);
  assert.match(onAbsent, /is a protected path/,
    'a protected path that does not exist must NOT answer "missing" — that answer is an existence oracle for exactly the paths the deny-list hides');
  assert.ok(!/does not exist/.test(onAbsent));
  assert.equal(asked, 0, 'neither reaches the operator');
  rmSync(dir, { recursive: true, force: true });
});

test('an ordinary missing path is still terminally refused as missing', async () => {
  const { mountRequestTool } = await import('../src/index.js');
  const { GrantStore } = await import('compact-dsh-approval');
  const tool = mountRequestTool({
    approval: { store: new GrantStore() },
    askApproval: async () => 'rejected',
    protectedPaths: [],
    grantTtlMs: 60_000,
  });
  const err = await tool.execute(
    { path: '/definitely/not/a/real/path/xyz', mode: 'ro', justification: 'j' },
    { agent: { id: 's', session: { id: 's' } }, name: 'sandbox_request_mount', callId: 'c1' },
  ).then(() => null, (e) => String(e.message));
  assert.match(err, /does not exist/);
  assert.match(err, /never grantable/);
});

test('#38: the mediated posture answers the open-network rule with the mediation, not a grant', () => {
  const base = { ref: 'img:1', record: REC(), resolved: ok(), network: 'compact-egress', networkGrants: [] };
  // open posture, no grant: still refused — the original rule is untouched
  const open = checkSupplyChain({ ...base, mediated: false });
  assert.ok(open, 'an open posture with no live run-time grant is still excess');
  assert.equal(open.ruleId, 'CF-2/uninherited-network');
  // mediated posture, no grant: the network is internal (no route) and the
  // grants live at the mediator — there is no excess for THIS rule to answer
  assert.equal(checkSupplyChain({ ...base, mediated: true }), null);
  // mediated WITH grants: same answer — the grant axis is not consulted here
  assert.equal(checkSupplyChain({ ...base, mediated: true, networkGrants: [{ id: 'sg_x' }] }), null);
  // mediation never excuses the image rules: an undeclared image still refuses
  assert.equal(checkSupplyChain({ ...base, mediated: true, record: undefined }).ruleId, 'CF-2/undeclared-image');
});
