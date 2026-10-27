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

// A gate post — the record a run exists to produce — opens with its
// marker, optionally after its author's name (the bug-court finding).
// The replay page carries its own copy of this pattern (it runs in the
// browser); the brief and the manifest share this one.
export const GATE_RE = /^(?:[\w.-]+ — )?(AGREEMENT|POSITIONS|RULING|VERDICTS):/;

/** This run's gate posts on the forum ledger, by id: PRESENCE, not
 *  success — whether the charter's condition was met is read on the
 *  forum itself. A continued community's ledger spans every run before
 *  it; only posts by this run's sessions (`-<runTag>`) are this run's. */
export function gatePostsOf(forum, runTag = null) {
  const mine = (by) => !runTag || String(by ?? '').endsWith(`-${runTag}`);
  return (forum ?? [])
    .filter((p) => mine(p.by))
    .map((p) => ({ post: p, m: GATE_RE.exec(String(p.text ?? '').trimStart()) }))
    .filter(({ m }) => m)
    .map(({ post, m }) => ({
      id: post.id,
      gate: m[1],
      by: String(post.by ?? '').replace(/^community-/, '').replace(runTag ? new RegExp(`-${runTag}$`) : /$^/, ''),
    }));
}

/** Tokens per seat, from the launcher's per-session meter: the same
 *  formula the cap meters (input, output, both cache sides), keyed by
 *  seat id. Their sum is the manifest's `tokens`. */
export function tokensBySeatOf(bySession, runTag = null) {
  const out = {};
  for (const [session, n] of Object.entries(bySession ?? {})) {
    let seat = String(session).replace(/^community-/, '');
    if (runTag && seat.endsWith(`-${runTag}`)) seat = seat.slice(0, -(runTag.length + 1));
    out[seat] = (out[seat] ?? 0) + (Number(n) || 0);
  }
  return out;
}
