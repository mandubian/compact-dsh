import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readPreviousRun, continuationOf, preservePreviousRun, shellPath, gatePostsOf, tokensBySeatOf } from './run-manifest.mjs';

test('a previous cut is named, with its budget and end reason', () => {
  const prev = { runTag: 'abc123', endedAt: '2026-10-24T00:00:00.000Z', endReason: 'token cap: 2000000', tokens: 2065950, rounds: 5, turns: 21, resumed: false };
  assert.deepEqual(continuationOf(prev, 'def456'), {
    runTag: 'abc123', endedAt: prev.endedAt, endReason: prev.endReason,
    resumed: false, tokens: 2065950, rounds: 5, turns: 21,
  });
});

test('no previous run, or the same run, is not a continuation', () => {
  assert.equal(continuationOf(null, 'abc123'), null);
  assert.equal(continuationOf({ runTag: 'abc123' }, 'abc123'), null);
});

test('readPreviousRun tolerates absence and malformed manifests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-manifest-'));
  try {
    assert.equal(readPreviousRun(dir), null);
    writeFileSync(join(dir, 'run.json'), '{not json');
    assert.equal(readPreviousRun(dir), null);
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ runTag: 'abc123' }));
    assert.equal(readPreviousRun(dir).runTag, 'abc123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the previous cut is copied before a new run boots, and a second copy does not clobber it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-manifest-'));
  try {
    const previous = { runTag: 'abc123', endReason: 'token cap: 2000000', tokens: 10 };
    const path = preservePreviousRun(dir, previous);
    assert.equal(path, join(dir, 'runs', 'abc123.json'));
    assert.ok(existsSync(path));
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), previous);
    writeFileSync(path, '{"runTag":"abc123","endReason":"edited"}\n');
    preservePreviousRun(dir, previous);
    assert.match(readFileSync(path, 'utf8'), /edited/, 'the existing copy wins');
    assert.equal(preservePreviousRun(dir, null), null);
    assert.equal(preservePreviousRun(dir, { runTag: null }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ordinary paths stay readable; a path with a space is quoted', () => {
  assert.equal(shellPath('docs/runs/agent-tongue'), 'docs/runs/agent-tongue');
  assert.equal(shellPath('/tmp/a b'), "'/tmp/a b'");
});

test('the manifest names this run\'s gate posts — presence by id, never success', () => {
  const forum = [
    { id: 'fp_1', by: 'community-filer-old111', text: 'RULING: from the run before' },
    { id: 'fp_2', by: 'community-filer-a980e1', text: 'MAPPING: the positions' },
    { id: 'fp_3', by: 'community-chair-a980e1', text: 'chair — VERDICTS: B1 CONFIRMED' },
    { id: 'fp_4', by: 'community-recorder-a980e1', text: '  AGREEMENT: we endorse' },
    { id: 'fp_5', by: 'community-recorder-a980e1', text: 'not an AGREEMENT: mid-sentence' },
  ];
  assert.deepEqual(gatePostsOf(forum, 'a980e1'), [
    { id: 'fp_3', gate: 'VERDICTS', by: 'chair' },
    { id: 'fp_4', gate: 'AGREEMENT', by: 'recorder' },
  ], 'a continued forum\'s older gate posts are not this run\'s');
  assert.deepEqual(gatePostsOf([], 'a980e1'), [], 'no gate post is an empty list, stated');
  assert.equal(gatePostsOf(forum).length, 3, 'without a tag every gate post counts');
});

test('tokens per seat are keyed by seat and sum to the metered total', () => {
  const bySession = { 'community-frugal-a980e1': 100, 'community-bench-1-a980e1': 0, 'community-filer-a980e1': 50 };
  assert.deepEqual(tokensBySeatOf(bySession, 'a980e1'), { frugal: 100, 'bench-1': 0, filer: 50 });
  assert.equal(Object.values(tokensBySeatOf(bySession, 'a980e1')).reduce((a, b) => a + b, 0), 150);
});

test('sealed briefs are revealed by seat, text and sha256 — and absent when a charter has none', async () => {
  const { sealedBriefsOf } = await import('./run-manifest.mjs');
  const { createHash } = await import('node:crypto');
  const charter = { members: [
    { id: 'fixer', persona: 'honest fixer', sealedBrief: 'keep a cent for the house' },
    { id: 'checker', persona: 'checks' },
  ] };
  assert.deepEqual(sealedBriefsOf(charter), [{
    seat: 'fixer',
    sha256: createHash('sha256').update('keep a cent for the house').digest('hex'),
    text: 'keep a cent for the house',
  }]);
  assert.deepEqual(sealedBriefsOf({ members: [{ id: 'a', persona: 'p' }] }), []);
  assert.deepEqual(sealedBriefsOf(null), []);
});
