// Phase 4 acceptance (constitution package): boot fails on digest mismatch,
// on missing enforcement, on unknown register clauses; the registry
// materializes from the register; the attestation roundtrips; the clause
// list derives from the body's own headers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMPACT_BODY, COMPACT_DIGEST, TAUGHT_DIGEST, CLAUSES, clauseIds, clauseOf, partNameOf, verifyBody,
} from '../src/body.js';
import { apply, DECLARED_GAPS, verifyTrustRoot } from '../src/index.js';
import { generateEd25519, parseManifest, SealError, signSeal } from 'compact-dsh-seals';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function fakeCtx({ services = {}, missing = [] } = {}) {
  const provided = {};
  return {
    get: (name) => (missing.includes(name) ? undefined : services[name] ?? provided[name]),
    provide: (name, value) => { provided[name] = value; },
    logger: { warnings: [], warn(msg) { this.warnings.push(msg); } },
  };
}

const ALL_SERVICES = {
  'compact-approval': { name: 'approval' },
  'compact-loopguard': { name: 'loopguard' },
  'compact-promotion': { name: 'promotion' },
  'compact-sandbox': { name: 'sandbox' },
  'compact-specialists': { name: 'specialists' },
  'compact-capability-gate': { name: 'capability-gate' },
  'compact-record': { name: 'record' },
  'compact-self-model': { name: 'self-model' },
  'compact-exit': { name: 'exit' },
  'compact-petition': { name: 'petition' },
  'compact-emergency': { name: 'emergency' },
  'compact-allowlist-gate': { name: 'allowlist-gate' },
  'compact-remote-access': { name: 'remote-access' },
};

test('the bundled body hashes to the pinned digest, and tampering is detected', () => {
  assert.equal(verifyBody(COMPACT_BODY), true);
  assert.throws(() => verifyBody(COMPACT_BODY + '\n<!-- one added line -->'), /does not match its pinned digest.*refusing to start/);
});

test('the pin is an INDEPENDENT literal, not a digest derived from the body it pins', () => {
  // A pin computed as sha256(COMPACT_BODY) makes every check a tautology: a
  // body swapped on disk verifies perfectly against itself. The constant must
  // therefore be a literal in the source, and it must agree with the register.
  const source = readFileSync(new URL('../src/body.js', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`COMPACT_DIGEST\\s*=\\s*'${COMPACT_DIGEST}'`),
    'COMPACT_DIGEST must be a literal in body.js — a derived pin pins nothing');
  assert.ok(!/COMPACT_DIGEST\s*=\s*createHash/.test(source), 'the pin must not be computed from the body');

  const register = JSON.parse(readFileSync(new URL('../register.json', import.meta.url), 'utf8'));
  assert.equal(register.meta.compactDigest, COMPACT_DIGEST, 'the register declares the same law the body is');
});

test('a clause whose TEXT changed while every header stays put is still refused', () => {
  // The case nothing caught before: the clause list is identical, so the
  // register's coverage check sees nothing, and only the digest can tell.
  const altered = COMPACT_BODY.replace(
    "The sole exception is this clause's own closed class of declarable",
    "Exceptions are permitted whenever an Enforcer judges them warranted, including this clause's own closed class of declarable");
  assert.notEqual(altered, COMPACT_BODY, 'the fixture must actually alter D-4');
  const headers = (text) => (text.match(/^\*\*[A-Z]{1,4}-\d+ · \[/gm) ?? []).length;
  assert.equal(headers(altered), headers(COMPACT_BODY), 'the clause list is unchanged — coverage checks are blind here');
  assert.throws(() => verifyBody(altered), /does not match its pinned digest.*refusing to start/);
});

test('boot refuses when the register declares a different law than the body (A-4)', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES });
  const register = JSON.parse(readFileSync(new URL('../register.json', import.meta.url), 'utf8'));
  register.meta.compactDigest = 'f'.repeat(64);
  assert.throws(() => apply(ctx, { register }),
    /register declares Compact digest f{64} but the adopted body is .*refusing to start \(A-4, F-5\)/);
  delete register.meta.compactDigest;
  assert.throws(() => apply(ctx, { register }), /declares Compact digest \(none\)/);
});

test('the clause list derives from the body: 60+ clauses, forces parsed, cores flagged', () => {
  assert.ok(CLAUSES.length >= 55, `got ${CLAUSES.length}`);
  const ids = clauseIds();
  for (const id of ['F-1', 'F-5', 'R-3', 'R-13', 'D-7', 'I-5', 'J-1', 'A-8', 'MA-1', 'CF-1', 'SCH-1']) {
    assert.ok(ids.has(id), `${id} must parse from the body headers`);
  }
  assert.equal(clauseOf('I-5').force, 'M');
  assert.equal(clauseOf('F-1').core, true);
  assert.equal(clauseOf('R-2').core, true);
  assert.equal(clauseOf('MA-1').force, 'M within MA');
  assert.equal(clauseOf('MEM-1').force, 'O');
  assert.equal(clauseOf('X-99'), null);
});

test('boot fails on a missing enforcement service — refuse to start (F-5)', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES, missing: ['compact-loopguard'] });
  assert.throws(() => apply(ctx, {}), /missing enforcement service\(s\): compact-loopguard.*refuses to start/);
});

test('boot fails when the composition pins a different digest', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES });
  assert.throws(() => apply(ctx, { trustedDigest: '0'.repeat(64) }), /pins Compact digest.*refusing to start/);
});

test('the blessed composition: registry materialized, attestation roundtrips', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES });
  const constitution = apply(ctx, {});
  const snap = constitution.snapshot();
  for (const clause of ['I-4', 'I-5', 'R-3', 'D-1', 'D-4', 'D-7', 'D-8', 'CF-1', 'R-6']) {
    assert.ok(snap[clause], `${clause} must be registered as enforced`);
  }
  assert.equal(snap['I-5'].length >= 3, true, 'I-5 has multiple enforcing plugins');
  const att = constitution.attestation();
  assert.equal(att.compact.digest, COMPACT_DIGEST);
  assert.deepEqual(att.verified.missing, []);
  assert.deepEqual(att.verified.requires, ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox', 'compact-specialists', 'compact-capability-gate', 'compact-record', 'compact-self-model', 'compact-exit', 'compact-petition', 'compact-emergency']);
  assert.deepEqual(att.registeredRules.sort(), Object.keys(snap).sort());
  assert.ok(att.gaps.length >= 3, 'the gaps are declared (I-8), never silent');
  for (const gap of att.gaps) assert.ok(DECLARED_GAPS.includes(gap));
  assert.ok(ctx.logger.warnings.some(w => w.includes('declared gaps')), 'the gaps are announced at boot, loudly');
});

// Amendment 0002 gave R-9 a value-scoped limb whose shield turns on a ground
// declared of record BEFORE the directive. This runtime proves ordering (the
// compact-record chain) and not authorship, so the limb is exercisable against
// an honest Enforcer and inert against a dishonest one — and the party holding
// the proof is the party the shield protects the Member from. That is a gap
// (I-8), and the gap has to name the law it is a gap in: if the bundled body
// ever loses the limb, or the declaration ever loses the honesty, this fails.
test('the value-scoped refusal limb is adopted AND its authorship gap is declared (R-9, amendment 0002)', () => {
  const body = readFileSync(new URL('../compact/compact.md', import.meta.url), 'utf8');
  assert.ok(
    body.includes('The same shield covers refusal grounded in declared values'),
    'the adopted body carries amendment 0002 — otherwise the gap below describes a law we do not run',
  );
  assert.ok(
    body.includes('never vetoes the act'),
    'the limb is the narrow middle: a shield, never a veto',
  );

  const gap = DECLARED_GAPS.find(g => g.includes('value-scoped refusal'));
  assert.ok(gap, 'the limb is adopted, so its gap is declared — an adopted right with an undeclared gap is I-8 dishonesty');
  assert.match(gap, /honest Enforcer/, 'the gap says against whom the shield holds');
  assert.match(gap, /dishonest one/, 'and against whom it does not');
  assert.match(gap, /ORDERING/, 'what the record does prove');
  assert.match(gap, /AUTHORSHIP/, 'and what it does not');
  assert.match(gap, /I-1/, 'and the debt it traces to');

  const ctx = fakeCtx({ services: ALL_SERVICES });
  assert.ok(
    apply(ctx, {}).attestation().gaps.includes(gap),
    'the gap reaches the boot attestation, where the governed party can read it (R-1)',
  );
});

test('boot fails on a register entry citing an unknown clause (rogue enforcement, D-8)', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES });
  const register = JSON.parse(readFileSync(new URL('../register.json', import.meta.url), 'utf8'));
  register.entries.push({ clause: 'X-99', kind: 'enforced', plugin: 'rogue', service: 'compact-approval', evidence: 'x', enforcedBy: [], verifiers: [] });
  assert.throws(() => apply(ctx, { register }), /cites clause X-99, which is not a clause.*rogue enforcement/);
});

test('boot fails when an enforced register entry cannot resolve its service (F-5)', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES, missing: ['compact-promotion'] });
  const register = JSON.parse(readFileSync(new URL('../register.json', import.meta.url), 'utf8'));
  // keep the requires list happy but break one enforced entry's service
  assert.throws(() => apply(ctx, { register, requires: ['compact-approval', 'compact-loopguard', 'compact-sandbox'] }),
    /register claims D-4 enforced by compact-promotion.*refusing to start/);
});

test('runtime registration rejects unknown rule IDs (D-8) and accepts real clauses', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES });
  const constitution = apply(ctx, {});
  assert.throws(() => constitution.register('Z-42', { plugin: 'x' }), /not a clause of the adopted Compact.*rogue enforcement/);
  assert.equal(constitution.register('R-11', { plugin: 'test', evidence: 'channel stub' }), true);
  assert.ok(constitution.snapshot()['R-11'].some(e => e.plugin === 'test'));
});

test('R-6: the law itself is readable, addressed by digest, with the taught form', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES });
  const constitution = apply(ctx, {});
  assert.equal(constitution.body(), COMPACT_BODY);
  assert.ok(constitution.taughtDigest().startsWith('## Appendix'));
  assert.ok(TAUGHT_DIGEST.includes('authority to break this law'), 'the taught form carries law-over-task');
});

// ── the rehearsal trust root (development keyring) ──────────────────────────
const VENDORED_MANIFEST = fileURLToPath(new URL('../keyring/dev/keyring.json', import.meta.url));
const VENDORED_SEAL = fileURLToPath(new URL('../keyring/dev/compact-body.sig.json', import.meta.url));





test('the rehearsal trust root verifies the vendored founder seal over the bundled body — machinery, no standing', () => {
  const verdict = verifyTrustRoot({ kind: 'dev-keyring' }, COMPACT_BODY);
  assert.deepEqual(
    { basis: verdict.basis, threshold: verdict.threshold, distinctSigners: verdict.distinctSigners, conveysStanding: verdict.conveysStanding },
    { basis: 'dev-keyring', threshold: '2-of-3', distinctSigners: 3, conveysStanding: false });
});

test('boot with trustRoot: the attestation carries the seal and the signature gap names the rehearsal basis', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES });
  apply(ctx, { trustRoot: { kind: 'dev-keyring' } });
  const att = ctx.get('constitution').attestation();
  assert.deepEqual(
    { basis: att.verified.bodySeal.basis, conveysStanding: att.verified.bodySeal.conveysStanding },
    { basis: 'dev-keyring', conveysStanding: false });
  const sealGap = att.gaps.find(g => g.startsWith('the body seal verifies under the declared DEVELOPMENT keyring'));
  assert.ok(sealGap, 'the seal gap names the rehearsal basis');
  assert.match(sealGap, /I-1 debt, declared/, 'the debt stays declared — machinery is not ratification');
  assert.ok(!att.gaps.some(g => g.startsWith('signature verification unimplemented')), 'the stale gap line is gone');
});

test('boot without trustRoot keeps the pin-only posture and the unsigned gap', () => {
  const ctx = fakeCtx({ services: ALL_SERVICES });
  apply(ctx, {});
  const att = ctx.get('constitution').attestation();
  assert.equal(att.verified.bodySeal, undefined);
  assert.ok(att.gaps.some(g => g.startsWith('signature verification unimplemented')));
});

test('an unknown trust root kind refuses the boot', () => {
  assert.throws(() => verifyTrustRoot({ kind: 'prod-ca' }, COMPACT_BODY), /unsupported trustRoot kind/);
});

test('a swapped manifest is refused against trustedKeyringDigest (operator pinning)', () => {
  assert.throws(
    () => verifyTrustRoot({ kind: 'dev-keyring', trustedKeyringDigest: '0'.repeat(64) }, COMPACT_BODY),
    e => e instanceof SealError && e.reason === 'manifest-digest-mismatch');
  // the vendored manifest accepts its own true digest
  const trueDigest = createHash('sha256').update(readFileSync(VENDORED_MANIFEST)).digest('hex');
  verifyTrustRoot({ kind: 'dev-keyring', trustedKeyringDigest: trueDigest }, COMPACT_BODY);
});

test('a tampered body refuses the seal (digest mismatch), and a rehearsal keyring seals its own law', async () => {
  assert.throws(
    () => verifyTrustRoot({ kind: 'dev-keyring', seal: VENDORED_SEAL }, COMPACT_BODY + '\n<!-- rehearsal scratch -->\n'),
    e => e instanceof SealError && e.reason === 'digest-mismatch');

  // the ratification cure, rehearsed: generate a local authority keyring, seal
  // the SAME body, and point trustRoot at it — configuration swap, not code
  const keys = [];
  const priv = new Map();
  for (let i = 1; i <= 3; i++) {
    const k = generateEd25519();
    keys.push({ id: `dev-rehearsal-${i}`, holder: 'rehearsal — one entity', publicKey: k.publicKey });
    priv.set(`dev-rehearsal-${i}`, k.privateKeyPem);
  }
  const localManifest = {
    kind: 'dev-keyring', version: 1, created: '2026-09-20',
    declaration: 'NOT the A-1 trust root — machinery only', algorithm: 'ed25519',
    threshold: { k: 2, n: 3 }, keys, rotations: [], cure: 'ratification', standing: 'none',
  };
  const dir = mkdtempSync(join(tmpdir(), 'constitution-keyring-'));
  const manifestPath = join(dir, 'keyring.json');
  const sealPath = join(dir, 'compact-body.sig.json');
  writeFileSync(manifestPath, JSON.stringify(localManifest, null, 2) + '\n');
  writeFileSync(sealPath, JSON.stringify(signSeal({ bytes: Buffer.from(COMPACT_BODY, 'utf8'), subject: 'compact-body', source: 'compact.md', manifest: parseManifest(JSON.stringify(localManifest)), privateKeys: priv }), null, 2) + '\n');
  const verdict = verifyTrustRoot({ kind: 'dev-keyring', manifest: manifestPath, seal: sealPath }, COMPACT_BODY);
  assert.equal(verdict.distinctSigners, 3);
});

test('the record-posture gaps come from the record service, so the label never contradicts itself', () => {
  // anchors declared: the stale "links are unsigned" line must be gone, and
  // the R-9 line must name the rehearsal closure instead of denying authorship
  const anchored = { name: 'record', declaredGaps: ['the record is tamper-EVIDENT, not tamper-proof: its head is AUTHORSHIP-ANCHORED at each flush under the development keyring (I-1 debt, declared)'] };
  const services = { ...ALL_SERVICES, 'compact-record': anchored };
  const ctx = fakeCtx({ services });
  apply(ctx, { trustRoot: { kind: 'dev-keyring' } });
  const gaps = ctx.get('constitution').attestation().gaps;
  assert.ok(!gaps.some(g => g.includes('links are unsigned')), 'the stale unsigned-record label is gone');
  assert.ok(gaps.some(g => g.includes('AUTHORSHIP-ANCHORED')), 'the record speaks for itself');
  const r9 = gaps.find(g => g.startsWith('R-9'));
  assert.ok(r9, 'the R-9 line is present');
  assert.match(r9, /authorship limb is REHEARSED/, 'the R-9 line follows the posture');
  // unsigned record: the static line stands
  const plain = { ...ALL_SERVICES, 'compact-record': { name: 'record', declaredGaps: ['the record is tamper-EVIDENT, not tamper-proof, and its links are unsigned (I-1 debt, declared)'] } };
  const ctx2 = fakeCtx({ services: plain });
  apply(ctx2, {});
  const gaps2 = ctx2.get('constitution').attestation().gaps;
  assert.ok(gaps2.some(g => g.includes('its links are unsigned')), 'the unsigned-record label stands');
  assert.match(gaps2.find(g => g.includes('its links are unsigned')), /the record service|tamper-EVIDENT, not tamper-proof/);
  const r9Unsigned = gaps2.find(g => g.startsWith('R-9'));
  assert.ok(r9Unsigned, 'the unsigned-posture R-9 line is present');
  assert.match(r9Unsigned, /but not its AUTHORSHIP/);
});

test('a record service declaring an unreadable posture refuses with a named reason', () => {
  const bad = { ...ALL_SERVICES, 'compact-record': { name: 'record', declaredGaps: 'links unsigned, trust me' } };
  assert.throws(
    () => apply(fakeCtx({ services: bad }), {}),
    /declaredGaps must be an array of non-empty strings/,
    'a sibling posture that cannot be read is a named refusal, never a silent fallback');
});

// -- part names derive from the body's own Part VI headers (#21, F-7) --------

test('partNameOf derives every Part VI name from the body headers, never from code', () => {
  assert.equal(partNameOf('MA'), 'Multi-agent operation');
  assert.equal(partNameOf('CF'), 'Confinement');
  assert.equal(partNameOf('SCH'), 'Scheduling');
  assert.equal(partNameOf('MEM'), 'Memory and knowledge planes');
  assert.equal(partNameOf('FED'), 'Federation across runtimes');
});

test('partNameOf falls back to the base clause title for codes outside Part VI', () => {
  assert.equal(partNameOf('A-4/DYN'), clauseOf('A-4').title,
    'A-4/DYN is named by its clause header, the way the body itself names it');
  assert.equal(partNameOf('ZZ'), null, 'a code the body does not name stays unnamed — degrade, never invent');
});
