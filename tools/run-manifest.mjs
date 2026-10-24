// Run-manifest lineage helpers: a resumed community run shares its --out
// with the run before it, and the live launcher overwrites run.json at the
// end. The manifest therefore names the previous cut in `continuedFrom`,
// and the launcher keeps a per-run copy under runs/<runTag>.json so the
// naming survives the next overwrite.
//
// `preservePreviousRun` takes the copy BEFORE the new run boots. That is
// the real guard against loss: even a run that fails after starting writes
// a failed run.json, but the previous cut is already on disk.
//
// Pure on purpose: the live launcher reads before it boots and writes after
// the community ends, and both directions are testable without a runtime.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read the manifest already in `dir`, or null when there is none or it
 *  cannot be trusted. A malformed manifest never blocks a continuation:
 *  the forum and chains are the record, run.json is the cut. */
export function readPreviousRun(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** The previous cut, named on the new manifest. Returns null when there is
 *  no previous run, or when the only manifest is this run's own. */
export function continuationOf(previous, runTag) {
  if (!previous || typeof previous !== 'object') return null;
  if (!previous.runTag || previous.runTag === runTag) return null;
  const out = { runTag: previous.runTag };
  for (const key of ['endedAt', 'endReason', 'resumed']) {
    if (previous[key] !== undefined) out[key] = previous[key];
  }
  for (const key of ['tokens', 'rounds', 'turns']) {
    if (Number.isFinite(previous[key])) out[key] = previous[key];
  }
  if (previous.continuedFrom?.runTag) out.continuedFrom = previous.continuedFrom.runTag;
  return out;
}

/** Copy the previous cut into runs/<tag>.json before the new run boots.
 *  Idempotent: an existing copy is left alone, so a failed attempt cannot
 *  overwrite the good copy. Returns the copy path, or null when there is
 *  no previous cut to keep. */
export function preservePreviousRun(dir, previous) {
  if (!previous?.runTag) return null;
  const runs = join(dir, 'runs');
  mkdirSync(runs, { recursive: true });
  const path = join(runs, `${previous.runTag}.json`);
  if (!existsSync(path)) writeFileSync(path, `${JSON.stringify(previous, null, 2)}\n`);
  return path;
}

/** Quote a path for the printed continuation command, but leave ordinary
 *  repo-relative paths readable. */
export function shellPath(value) {
  const s = String(value);
  return /^[A-Za-z0-9_./:@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
