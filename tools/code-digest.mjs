// The code a run loads, named by CONTENT — CF-2's rule ("identity is
// content, not a name") applied to the code itself, not only the image.
//
// #278 named WHERE the workspace packages load from; that is a location,
// and a location is a name. This module names WHAT they contain: each
// package is hashed file by file the way git hashes files (blob ids), so
// the offline auditor can recompute the expected value from the commit's
// own tree (`git ls-tree`) — no checkout, no trust in the run. The
// third-party tree (node_modules) and the lockfile are digested too:
// the lockfile is checkable against the commit; the installed tree is not
// in git, so it is recorded for comparison across runs, declared as such.
//
// One top-level digest covers the whole detail. The run's attestation
// carries that digest onto the hash chain at every turn; the detail
// rides beside the record (the state dir, the manifest) and is trusted
// only because it hashes to the chained digest.
//
// What this is NOT: a lock. The digest is computed by the process it
// describes; a host that lies can lie here too. It turns "the record says
// commit X" into "the record says these exact bytes, checkable against
// commit X" — evidence, not prevention (signatures: the I-1 debt).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { workspacePackages } from './package-provenance.mjs';

export const CODE_DIGEST_VERSION = 'compact-code-digest/v1';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
const posix = (p) => p.split(sep).join('/');

/** git's blob id for some bytes: sha1("blob <len>\0" + bytes). */
export function gitBlobId(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** The canonical digest of a file listing — sha256 over the sorted
 *  "<path> <blob id>\n" lines. Order-independent input, one answer. */
export function listingDigest(entries) {
  const lines = entries.map((e) => `${e.path} ${e.blob}\n`).sort();
  return sha256(lines.join(''));
}

const inNodeModules = (rel) => rel.split('/').includes('node_modules');

/** Every file under `dir`, git-hashed, as posix paths relative to it.
 *  Symlinks are hashed as git stores them (their target text), never
 *  followed; `skip(rel)` prunes subtrees. */
export function hashTree(dir, { skip = inNodeModules } = {}) {
  const out = [];
  const walk = (abs, rel) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      const p = join(abs, e.name);
      if (e.isSymbolicLink()) out.push({ path: r, blob: gitBlobId(Buffer.from(readlinkSync(p))) });
      else if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) out.push({ path: r, blob: gitBlobId(readFileSync(p)) });
    }
  };
  walk(dir, '');
  return out;
}

/** The package root a resolved entry belongs to: the nearest directory up
 *  from it whose package.json names `name`. */
function packageRootOf(entry, name) {
  let d = dirname(entry);
  while (d !== dirname(d)) {
    const manifest = join(d, 'package.json');
    if (existsSync(manifest)) {
      try { if (JSON.parse(readFileSync(manifest, 'utf8')).name === name) return d; } catch { /* keep walking */ }
    }
    d = dirname(d);
  }
  return null;
}

/** The top-level digest over the detail: what the chain carries. Fields
 *  that are not identity (paths, counts, timestamps) stay out of it, so
 *  the same bytes give the same digest wherever they were installed. */
export function topDigest(detail) {
  const identity = {
    version: detail.version,
    commit: detail.commit ?? null,
    packages: [...detail.packages].sort((a, b) => (a.name < b.name ? -1 : 1)).map((p) => [p.name, p.digest]),
    lockfile: detail.lockfile ?? null,
    nodeModules: detail.nodeModules?.digest ?? null,
  };
  return sha256(JSON.stringify(identity));
}

/** Digest the code a launcher in `root` is about to load. `resolve(name)`
 *  defaults to this module's own resolution — the same node_modules the
 *  launcher beside it walks. */
export function computeCodeDigest(root, {
  resolve = (name) => import.meta.resolve(name),
  commit = null,
  nodeModules = true,
} = {}) {
  const packages = [];
  for (const { name, dir } of workspacePackages(root)) {
    let loaded = null;
    try {
      const target = resolve(name);
      if (target) loaded = packageRootOf(real(String(target).startsWith('file:') ? fileURLToPath(target) : String(target)), name);
    } catch { /* not loadable by name: its own directory is what tools import */ }
    const from = real(loaded ?? dir);
    const files = hashTree(from);
    const home = real(dir);
    const foreign = from !== home;
    packages.push({
      name,
      dir: posix(relative(root, dir)),
      // relative inside the checkout — a published manifest must not carry
      // the operator's paths; absolute only when foreign, where the path
      // IS the evidence
      loadedFrom: foreign ? from : posix(relative(real(root), from)),
      foreign,
      files: files.length,
      digest: listingDigest(files),
    });
  }
  const lockPath = join(root, 'package-lock.json');
  const detail = {
    version: CODE_DIGEST_VERSION,
    commit,
    packages,
    lockfile: existsSync(lockPath) ? sha256(readFileSync(lockPath)) : null,
    nodeModules: null,
  };
  if (nodeModules && existsSync(join(root, 'node_modules'))) {
    const nm = real(join(root, 'node_modules'));
    const files = hashTree(nm, { skip: () => false });
    const inside = nm.startsWith(real(root) + sep);
    detail.nodeModules = { root: inside ? posix(relative(real(root), nm)) : nm, linked: !inside, files: files.length, digest: listingDigest(files), verifiable: 'across runs only — third-party code is not in git' };
  }
  detail.digest = topDigest(detail);
  return detail;
}

/** What the commit's own tree says a package directory should hash to. */
export function expectedPackageDigest(repo, commit, dir) {
  const r = spawnSync('git', ['-C', repo, 'ls-tree', '-r', '-z', commit, '--', `${dir}/`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  const entries = [];
  for (const record of r.stdout.toString('utf8').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [, type, blob] = record.slice(0, tab).split(' ');
    if (type !== 'blob') continue;
    const rel = record.slice(tab + 1).slice(dir.length + 1);
    if (inNodeModules(rel)) continue;
    entries.push({ path: rel, blob });
  }
  return { files: entries.length, digest: listingDigest(entries) };
}

/** What the commit says the lockfile hashes to. */
export function expectedLockfileDigest(repo, commit) {
  const r = spawnSync('git', ['-C', repo, 'show', `${commit}:package-lock.json`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? sha256(r.stdout) : null;
}

/** Verify a detail against the digest the record chained and the commit's
 *  tree. Returns findings: { ok, checks: [...], failures: [...] }. */
export function verifyCodeDigest({ detail, recorded, repo }) {
  const failures = [];
  const checks = [];
  const recomputed = topDigest(detail);
  if (recomputed !== detail.digest) failures.push(`the detail's own digest does not match its contents (${String(detail.digest).slice(0, 12)}… vs ${recomputed.slice(0, 12)}…)`);
  if (recorded && recomputed !== recorded) {
    failures.push(`the detail does not hash to the digest the record carries (${recomputed.slice(0, 12)}… vs recorded ${String(recorded).slice(0, 12)}…) — it is not this run's`);
    return { ok: false, checks, failures };
  }
  if (!repo) return { ok: failures.length === 0, checks, failures, unverified: 'no --repo: the detail matches the record, but nothing was compared with a commit' };
  if (!detail.commit) {
    failures.push('the detail names no commit — there is no tree to compare it with');
    return { ok: false, checks, failures };
  }
  for (const p of detail.packages) {
    const expected = expectedPackageDigest(repo, detail.commit, p.dir);
    if (!expected) { failures.push(`${p.name}: the commit ${detail.commit.slice(0, 12)} has no ${p.dir}/ — or the repository lacks the commit`); continue; }
    if (expected.digest === p.digest) checks.push(`${p.name}: matches ${detail.commit.slice(0, 12)} (${p.files} files)`);
    else failures.push(`${p.name}: the code that loaded (${p.files} files${p.foreign ? `, from ${p.loadedFrom}` : ''}) is NOT the commit's (${expected.files} files)`);
  }
  if (detail.lockfile) {
    const expected = expectedLockfileDigest(repo, detail.commit);
    if (expected === detail.lockfile) checks.push(`package-lock.json: matches ${detail.commit.slice(0, 12)}`);
    else failures.push(`package-lock.json: the checkout's lockfile is NOT the commit's`);
  }
  if (detail.nodeModules) checks.push(`node_modules: ${detail.nodeModules.files} files, digest ${detail.nodeModules.digest.slice(0, 12)}… — recorded, not verifiable against the repository (compare across runs)`);
  return { ok: failures.length === 0, checks, failures };
}
