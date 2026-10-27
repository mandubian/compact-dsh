// community-reading tests: the model prose is never trusted as the record.
// These tests exercise the deterministic shell around it — the prompt names
// the limits, the header names the source hash and model, and the audit
// catches the failure modes the brief exists to prevent.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReadingPrompt, renderReading, auditReading, staleSource } from './community-reading.mjs';

const data = {
  forum: [
    { id: 'fp_1', by: 'm1', text: 'the first post' },
    { id: 'fp_2', by: 'm2', text: 'the second post' },
  ],
  members: [
    { id: 'm1', passes: 1, notLanded: 0 },
    { id: 'm2', passes: 0, notLanded: 1 },
  ],
  checks: { passes: 1, passCalls: 2, turnSum: 4 },
  latestLedger: { id: 'fp_2', text: 'we agree to disagree' },
};

const good = `## What the record shows
m1 posted fp_1 and m2 posted fp_2. Two accepted posts, two members.
## What remains open
The brief leaves the next step open.
## What this reading does not decide
No verdict, no consensus, no standing.`;

test('the prompt names the brief as the only source and forbids the named failures', () => {
  const p = buildReadingPrompt('# BRIEF\nbody');
  assert.equal(p.version, 'community-reading/v1');
  assert.match(p.system, /only source/);
  assert.match(p.system, /pass is not a position/i);
  assert.match(p.system, /Silence is not consent/i);
  assert.match(p.user, /# BRIEF/);
});

test('the reading header names the brief hash and the model, and disclaims record standing', () => {
  const out = renderReading({ body: good, brief: '# BRIEF\nbody', model: 'zai/glm-5.3-flash', generatedAt: '2026-10-24T00:00:00.000Z' });
  assert.match(out, /sha256 `[0-9a-f]{64}`/);
  assert.match(out, /zai\/glm-5\.3-flash/);
  assert.match(out, /not a record act/i);
  assert.match(out, /does not decide/);
});

test('a reading with valid citations and correct counts passes', () => {
  const result = auditReading(good, data);
  assert.equal(result.ok, true, result.failures.join('\n'));
  assert.equal(result.citations, 2);
});

test('an invented citation fails', () => {
  const result = auditReading(`${good}\nfp_99 says otherwise.`, data);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /fp_99/);
});

test('a wrong count fails', () => {
  const result = auditReading(`${good}\n3 accepted posts.`, data);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /3 accepted posts/);
});

test('consensus language not in the ledger fails; a negated mention passes', () => {
  assert.equal(auditReading(`${good}\nThe community reached consensus.`, data).ok, false);
  assert.equal(auditReading(`${good}\nThis is not a consensus.`, data).ok, true);
});

test('calling a member silent when the brief records a pass or unlanded attempt fails', () => {
  const result = auditReading(`${good}\nm1 was silent throughout.`, data);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /m1/);
  assert.match(result.failures.join('\n'), /accepted posts only/);
});

test('verdict language not in the ledger fails', () => {
  const result = auditReading(`${good}\nThe member is guilty.`, data);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /guilty/);
});

test('a reading whose brief has since changed is named stale (the v2 finding)', () => {
  // the v2 reading said "no filing" because its brief could not see two
  // refused filings; once the brief can, the old reading must not pass
  // as a reading of the brief the archive renders now
  const brief = '# BRIEF — v2\nfilings: 0 attempted';
  const reading = renderReading({ body: good, brief, model: 'answer-file (no model called)', generatedAt: 'T' });
  assert.equal(staleSource(reading, brief), null, 'the bare brief it read');
  assert.equal(staleSource(reading, `${brief}`), null);
  const fileHashed = renderReading({ body: good, brief: `${brief}\n`, model: 'm', generatedAt: 'T' });
  assert.equal(staleSource(fileHashed, brief), null, 'the written file, trailing newline included');
  assert.match(staleSource(reading, '# BRIEF — v2\nfilings: 2 attempted, 0 landed, 2 refused'), /^STALE SOURCE: the reading was made from brief sha256 [0-9a-f]{12}…/);
  assert.match(staleSource(good, brief), /names no source brief hash/);
});
