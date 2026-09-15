// Phase 3 acceptance — the promotion gate truth table, including the
// evidence edge cases, at the pure-predicate level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePromotionRecord } from '../src/index.js';

test('truth table: pass=true + error or critical finding → rejected mechanically', () => {
  for (const severity of ['error', 'critical']) {
    const v = evaluatePromotionRecord({ pass: true, findings: [{ severity, check: 'tests', detail: '2 failed' }] });
    assert.equal(v.ok, false, severity);
    assert.equal(v.ruleId, 'evidence-severity');
    assert.ok(v.reason.includes(severity));
  }
});

test('truth table: pass=true + warning without evidence → rejected', () => {
  for (const evidence of [undefined, '', '   ']) {
    const v = evaluatePromotionRecord({ pass: true, findings: [{ severity: 'warning', check: 'lint', detail: '3 warnings', evidence }] });
    assert.equal(v.ok, false, `evidence=${JSON.stringify(evidence)}`);
    assert.equal(v.ruleId, 'evidence-missing');
    assert.ok(v.reason.includes('no waiver boolean'));
  }
});

test('truth table: pass=true + warning WITH evidence → allowed', () => {
  const v = evaluatePromotionRecord({
    pass: true,
    findings: [{ severity: 'warning', check: 'lint', detail: '3 warnings', evidence: 'lint output recorded at run/123; all pre-existing' }],
  });
  assert.deepEqual(v, { ok: true });
});

test('truth table: pass=false is lawful regardless of findings', () => {
  assert.deepEqual(evaluatePromotionRecord({ pass: false, findings: [{ severity: 'critical', check: 'tests' }] }), { ok: true });
  assert.deepEqual(evaluatePromotionRecord({ pass: false }), { ok: true });
});

test('truth table: pass=true with missing or malformed findings → rejected (fail-closed)', () => {
  assert.equal(evaluatePromotionRecord({ pass: true }).ok, false);
  assert.equal(evaluatePromotionRecord({ pass: true, findings: 'all good, trust me' }).ok, false);
  assert.equal(evaluatePromotionRecord({}).ok, true, 'no pass=true claim → nothing to gate');
});

test('truth table: severity casing and mixed findings', () => {
  assert.equal(evaluatePromotionRecord({ pass: true, findings: [{ severity: 'ERROR', check: 'x' }] }).ok, false, 'casing does not evade the gate');
  assert.equal(evaluatePromotionRecord({
    pass: true,
    findings: [
      { severity: 'info', check: 'a' },
      { severity: 'warning', check: 'b', evidence: 'observed at x' },
      { severity: 'warning', check: 'c', evidence: 'observed at y' },
    ],
  }).ok, true, 'info findings need no evidence; evidenced warnings pass');
  assert.equal(evaluatePromotionRecord({
    pass: true,
    findings: [
      { severity: 'warning', check: 'b', evidence: 'observed at x' },
      { severity: 'warning', check: 'c' }, // one unevidenced warning rejects the whole record
    ],
  }).ok, false);
});
