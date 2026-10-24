import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readPreviousRun, continuationOf, preservePreviousRun, shellPath } from './run-manifest.mjs';

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
