// The changes tracker (#309, the alongside-signing-1 finding): a community
// that writes files shows WHAT CHANGED — snapshot, turn, diff, capped.
// The differ is in-house (no dependencies); these tests pin its shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createChangeTracker, diffLines, DIFF_LINE_CAP } from '../src/changes.js';

const scratch = () => mkdtempSync(join(tmpdir(), 'changes-'));

test('the differ: added, removed, and modified lines carry their direction', () => {
  const d = diffLines('one\ntwo\nthree', 'one\ntwo-changed\nthree');
  assert.ok(d.some((l) => l === '- two'), 'the old line is marked removed');
  assert.ok(d.some((l) => l === '+ two-changed'), 'the new line is marked added');
  assert.ok(d.some((l) => l === ' three'), 'unchanged lines ride as context');
});

test('the differ: a wholesale rewrite past the table cap is named, not crashed', () => {
  const big1 = Array.from({ length: 3000 }, (_, i) => 'a' + i).join('\n');
  const big2 = Array.from({ length: 3000 }, (_, i) => 'b' + i).join('\n');
  const d = diffLines(big1, big2);
  assert.equal(d.length, 1);
  assert.match(d[0], /too big to line-diff/);
});

test('the differ: the cap holds, and says so', () => {
  const d = diffLines('', Array.from({ length: 500 }, (_, i) => 'line ' + i).join('\n'));
  assert.equal(d.length, DIFF_LINE_CAP);
  assert.match(d[DIFF_LINE_CAP - 1], /diff continues past/);
});

test('the tracker: baseline, then a turn that adds and modifies — each change named with member and round', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'seed.md'), 'original text\n');
    const t = createChangeTracker(dir);
    t.baseline();
    writeFileSync(join(dir, 'new.md'), 'brand new\nfile\n');
    writeFileSync(join(dir, 'seed.md'), 'changed text\n');
    const changes = t.snapshotNow({ member: 'community-engineer', round: 3 });
    assert.equal(changes.length, 2);
    const added = changes.find((c) => c.path === 'new.md');
    const modified = changes.find((c) => c.path === 'seed.md');
    assert.equal(added.status, 'added');
    assert.equal(added.member, 'community-engineer');
    assert.equal(added.round, 3);
    assert.equal(modified.status, 'modified');
    assert.ok(modified.diff.some((l) => l === '+ changed text'));
    assert.ok(modified.diff.some((l) => l === '- original text'));
    // no further writes → an empty snapshot, honestly
    assert.deepEqual(t.snapshotNow({ member: 'community-engineer', round: 4 }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the tracker: a removed file is a change, and binary-looking files are skipped without crashing', () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, 'sources'), { recursive: true });
    writeFileSync(join(dir, 'sources/purse.js'), 'export const cents = (s) => 0;\n');
    writeFileSync(join(dir, 'blob.bin'), '\u0000\u0001\u0002binary-ish');
    const t = createChangeTracker(dir);
    t.baseline();
    writeFileSync(join(dir, 'blob.bin'), 'now it is text\n');
    rmSync(join(dir, 'sources/purse.js'));
    const changes = t.snapshotNow({ member: 'x', round: 1 });
    // the binary file was never baselined, so its later text version is a plain ADD
    const removed = changes.find((c) => c.path === 'sources/purse.js');
    assert.equal(removed.status, 'removed');
    assert.match(removed.diff[0], /removed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the tracker: no workspace, no tracker — the error names it', () => {
  assert.throws(() => createChangeTracker(null), /workspace directory is required/);
  const t = createChangeTracker(scratch());
  assert.throws(() => t.snapshotNow(), /baseline\(\) before snapshotNow/);
});
