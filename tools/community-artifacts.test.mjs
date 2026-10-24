// The publication pack: deterministic report + brief, and a separately
// labeled reading. The pack must exist even when the reading does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPublishPack } from './community-artifacts.mjs';

const row = (type, data) => JSON.stringify({ type, data });

function buildArchive() {
  const dir = mkdtempSync(join(tmpdir(), 'community-artifacts-'));
  mkdirSync(join(dir, 'state', 'sessions', 'ws', 'community-editor'), { recursive: true });
  mkdirSync(join(dir, 'state', 'chains'), { recursive: true });
  mkdirSync(join(dir, 'state', 'keyring'), { recursive: true });
  writeFileSync(join(dir, 'state', 'keyring', 'roll.json'), '{}\n');
  writeFileSync(join(dir, 'state', 'keyring', 'keyring.json'), '{}\n');
  writeFileSync(join(dir, 'state', 'sessions', 'ws', 'community-editor', 'session.v4.jsonl'), [
    JSON.stringify({ type: 'user/message', data: { source: { kind: 'compact-community' } }, session: 'community-editor' }),
    row('turn/end', { turn: 1 }),
    row('tool/call', { callId: 'p1', name: 'forum_post', arguments: JSON.stringify({ topic: 'floor', text: 'the record speaks once' }) }),
    row('tool/result', { message: { toolCallId: 'p1', content: [{ type: 'text', text: '[forum] posted fp_1' }] } }),
    row('assistant/message', { usage: { inputTokens: 10, outputTokens: 5 } }),
    row('turn/end', { turn: 2 }),
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'state', 'chains', 'forum.jsonl'), JSON.stringify({
    id: 'fp_1', seq: 1, topic: 'floor', by: 'community-editor', at: 't1', text: 'the record speaks once',
  }) + '\n');
  writeFileSync(join(dir, 'state', 'approvals.json'), JSON.stringify({ sessionGrants: [] }));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({
    charter: 'newsroom', runTag: 'abc123', resumed: false,
    endedAt: '2026-10-24T00:00:00.000Z', endReason: 'round cap: 1',
    rounds: 1, turns: 2, tokens: 15,
  }));
  return dir;
}

test('the pack writes REPORT, BRIEF, PACK and a manifest copy; no-reading is stated', async () => {
  const dir = buildArchive();
  try {
    const pack = await buildPublishPack({ dir, noReading: true, generatedAt: '2026-10-24T01:00:00.000Z' });
    for (const name of ['REPORT.md', 'BRIEF.md', 'PACK.md', 'run.json']) {
      assert.ok(existsSync(join(pack.dir, name)), `${name} exists`);
    }
    assert.equal(existsSync(join(pack.dir, 'READING.md')), false, 'no placeholder reading');
    assert.equal(pack.briefAudit.ok, true, pack.briefAudit.failures.join('\n'));
    assert.match(pack.readingStatus, /skipped/);
    assert.match(readFileSync(join(pack.dir, 'PACK.md'), 'utf8'), /READING\.md.*skipped/s);
    assert.match(readFileSync(join(pack.dir, 'PACK.md'), 'utf8'), /REPORT\.md/);
    assert.match(readFileSync(join(pack.dir, 'PACK.md'), 'utf8'), /sha256/);
    assert.match(readFileSync(join(pack.dir, 'REPORT.md'), 'utf8'), /THE COMMUNITY, AFTER THE RUN/);
    assert.match(readFileSync(join(pack.dir, 'BRIEF.md'), 'utf8'), /# BRIEF/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an offline answer becomes a labeled READING.md when its audit passes', async () => {
  const dir = buildArchive();
  try {
    const answer = join(dir, 'answer.md');
    writeFileSync(answer, 'A reading with no factual claims and no verdict.\n');
    const pack = await buildPublishPack({ dir, answerPath: answer, generatedAt: '2026-10-24T01:00:00.000Z' });
    assert.ok(existsSync(join(pack.dir, 'READING.md')));
    assert.equal(pack.readingAudit.ok, true);
    assert.match(pack.readingStatus, /answer-file/);
    assert.match(readFileSync(join(pack.dir, 'READING.md'), 'utf8'), /not a record act/);
    assert.match(readFileSync(join(pack.dir, 'PACK.md'), 'utf8'), /READING\.md.*audit PASS/s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a reading that cites an invented post is rejected, not published as READING.md', async () => {
  const dir = buildArchive();
  try {
    const answer = join(dir, 'answer.md');
    writeFileSync(answer, 'The record shows fp_99.\n');
    const pack = await buildPublishPack({ dir, answerPath: answer, generatedAt: '2026-10-24T01:00:00.000Z' });
    assert.equal(existsSync(join(pack.dir, 'READING.md')), false);
    assert.ok(existsSync(join(pack.dir, 'READING.rejected.md')));
    assert.equal(pack.readingAudit.ok, false);
    assert.match(pack.readingStatus, /rejected/);
    assert.match(readFileSync(join(pack.dir, 'PACK.md'), 'utf8'), /audit FAIL/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
