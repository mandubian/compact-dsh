// The changes tracker (#309, the alongside-signing-1 finding): a community
// that writes files must show WHAT CHANGED, never ask a human to re-read a
// whole file and find the difference. Snapshot the workspace at the run's
// start, re-snapshot at each turn's end, and hand the diffs to the feed —
// a versioned write is shown as what-changed, with the member and round
// that carried it.
//
// The differ is a small in-house LCS (no dependencies, house rule for this
// package): line-based, good enough for the workspaces charters actually
// use (a module, a spec, a manifesto — not megabyte trees). Diffs are
// capped: a change bigger than the cap is named, with its size, not
// dumped — the human reads conclusions, and opens the file when they need
// the whole thing.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const DIFF_LINE_CAP = 120;
const TEXT_BYTE_CAP = 512 * 1024; // a "file" past half a megabyte is not prose; name it, don't read it
const BINARY_RE = /[\u0000-\u0008\u000e-\u001f]/; // control chars (minus \t\n\r) → not text

/** The workspace's readable files: relative path → text. Skips anything
 * binary-looking or oversized (named in the summary, not read). */
function walkFiles(root) {
  const out = new Map();
  const skipped = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(root, full).split('\\').join('/');
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.size > TEXT_BYTE_CAP) {
        skipped.push({ path: rel, why: `oversized (${stat.size} bytes)` });
        continue;
      }
      try {
        const text = readFileSync(full, 'utf8');
        if (BINARY_RE.test(text.slice(0, 2048))) {
          skipped.push({ path: rel, why: 'not text' });
          continue;
        }
        out.set(rel, text);
      } catch {
        skipped.push({ path: rel, why: 'unreadable' });
      }
    }
  };
  walk(root);
  return { files: out, skipped };
}

/** A unified-ish diff of two texts: ±1 context line around each change,
 * one character of direction per line, capped. */
export function diffLines(before, after, { cap = DIFF_LINE_CAP } = {}) {
  const a = before.split('\n');
  const b = after.split('\n');
  // the LCS table, O(len(a)*len(b)) — charters' files are small; a file
  // pair past the table cap is reported as rewritten, not diffed
  if (a.length * b.length > 4_000_000) {
    return [`@@ both sides differ wholesale (${a.length} → ${b.length} lines) — too big to line-diff`];
  }
  const w = b.length;
  const lcs = new Uint32Array((a.length + 1) * (w + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = w - 1; j >= 0; j -= 1) {
      lcs[i * (w + 1) + j] = a[i] === b[j]
        ? lcs[(i + 1) * (w + 1) + j + 1] + 1
        : Math.max(lcs[(i + 1) * (w + 1) + j], lcs[i * (w + 1) + j + 1]);
    }
  }
  // pass 1: the full walk, every line with its direction
  const raw = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      raw.push({ sign: ' ', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * (w + 1) + j] >= lcs[i * (w + 1) + j + 1]) {
      raw.push({ sign: '-', text: a[i] });
      i += 1;
    } else {
      raw.push({ sign: '+', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) raw.push({ sign: '-', text: a[i++] });
  while (j < b.length) raw.push({ sign: '+', text: b[j++] });
  // pass 2: keep every change and ±1 unchanged line around it — a change
  // without its anchor is a diff a human cannot place
  const isChange = raw.map((r) => r.sign !== ' ');
  const keep = raw.map(() => false);
  for (let k = 0; k < raw.length; k += 1) {
    if (!isChange[k]) continue;
    keep[k] = true;
    if (k > 0) keep[k - 1] = true;
    if (k + 1 < raw.length) keep[k + 1] = true;
  }
  let lines = raw.filter((_, k) => keep[k]).map((r) => (r.sign === ' ' ? ' ' : r.sign + ' ') + r.text);
  if (lines.length > cap) lines = [...lines.slice(0, cap - 1), `… diff continues past ${cap} lines — read the file for the rest`];
  return lines;
}

/**
 * The tracker. `baseline()` snapshots the workspace as it stood at the
 * run's start; `snapshotNow({ member, round })` re-snapshots and returns
 * the changes since the last snapshot (added / modified / removed, each
 * with its diff, capped), then becomes the new baseline. No changes → an
 * empty array, honestly.
 */
export function createChangeTracker(workspaceDir, { cap = DIFF_LINE_CAP } = {}) {
  if (!workspaceDir) throw new Error('changes: a workspace directory is required — the tracker snapshots a real workspace');
  let last = null;
  const scan = () => {
    const { files, skipped } = walkFiles(workspaceDir);
    return { files, skipped };
  };
  return {
    /** The run's starting point: everything from here on is a change. */
    baseline() {
      const { files, skipped } = scan();
      last = files;
      return { files: files.size, skipped: skipped.length };
    },
    /** After a turn: what changed since the last snapshot. The baseline
     * moves only AFTER the diff — scanning into `last` before comparing
     * would compare the workspace with itself and find nothing, ever. */
    snapshotNow({ member = null, round = null } = {}) {
      if (last === null) throw new Error('changes: baseline() before snapshotNow() — a diff needs a before');
      const { files: now, skipped: nowSkipped } = scan();
      const before = last;
      last = now;
      const changes = [];
      const paths = new Set([...before.keys(), ...now.keys()]);
      for (const path of [...paths].sort()) {
        const old = before.get(path);
        const after = now.get(path);
        if (old === after) continue;
        const status = old === undefined ? 'added' : after === undefined ? 'removed' : 'modified';
        const diff = status === 'removed'
          ? ['@@ removed — the whole file went away']
          : diffLines(old ?? '', after ?? '', { cap });
        changes.push({ path, status, member, round, diff });
      }
      return changes;
    },
  };
}
