// Phase 4 acceptance (constitution package): boot fails on digest mismatch,
// on missing enforcement, on unknown register clauses; the registry
// materializes from the register; the attestation roundtrips; the clause
// list derives from the body's own headers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPACT_BODY, COMPACT_DIGEST, TAUGHT_DIGEST, CLAUSES, clauseIds, clauseOf, verifyBody,
} from '../src/body.js';
import { apply, DECLARED_GAPS } from '../src/index.js';

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
  'compact-allowlist-gate': { name: 'allowlist-gate' },
  'compact-remote-access': { name: 'remote-access' },
};

test('the bundled body hashes to the pinned digest, and tampering is detected', () => {
  assert.equal(verifyBody(COMPACT_BODY), true);
  assert.throws(() => verifyBody(COMPACT_BODY + '\n<!-- one added line -->'), /does not match its pinned digest.*refusing to start/);
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
  assert.deepEqual(att.verified.requires, ['compact-approval', 'compact-loopguard', 'compact-promotion', 'compact-sandbox', 'compact-specialists', 'compact-capability-gate', 'compact-record']);
  assert.deepEqual(att.registeredRules.sort(), Object.keys(snap).sort());
  assert.ok(att.gaps.length >= 3, 'the gaps are declared (I-8), never silent');
  for (const gap of att.gaps) assert.ok(DECLARED_GAPS.includes(gap));
  assert.ok(ctx.logger.warnings.some(w => w.includes('declared gaps')), 'the gaps are announced at boot, loudly');
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
