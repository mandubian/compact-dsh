// The code by content: computed at boot, checked offline against the
// commit's own tree — and every way the two can disagree, named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { gitBlobId, listingDigest, computeCodeDigest, verifyCodeDigest, topDigest } from './code-digest.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

/** A tiny checkout: two workspace packages and a lockfile, committed. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'codedigest-'));
  for (const [dir, name] of [['loopguard', 'compact-dsh-loopguard'], ['approval', 'compact-dsh-approval']]) {
    mkdirSync(join(root, 'packages', dir, 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify({ name, main: 'src/index.js' }));
    writeFileSync(join(root, 'packages', dir, 'src', 'index.js'), `export const name = ${JSON.stringify(name)};\n`);
  }
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  git(root, 'init', '-q');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  return { root, commit: git(root, 'rev-parse', 'HEAD') };
}
// resolve each package inside the given checkout, the way node_modules would
const resolverFor = (root) => (name) => pathToFileURL(join(root, 'packages', name.replace('compact-dsh-', ''), 'src', 'index.js')).href;

test('a blob id is git\'s own — the auditor recomputes from the commit, not from the run', () => {
  const { root } = repo();
  try {
    const file = join(root, 'packages', 'loopguard', 'src', 'index.js');
    assert.equal(gitBlobId(Buffer.from('export const name = "compact-dsh-loopguard";\n')), git(root, 'hash-object', file));
    assert.equal(listingDigest([{ path: 'b', blob: '2' }, { path: 'a', blob: '1' }]), listingDigest([{ path: 'a', blob: '1' }, { path: 'b', blob: '2' }]), 'order is not identity');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the code that loads matches its commit — verified offline, package by package', () => {
  const { root, commit } = repo();
  try {
    const detail = computeCodeDigest(root, { resolve: resolverFor(root), commit, nodeModules: false });
    assert.equal(detail.packages.length, 2);
    assert.ok(detail.packages.every((p) => !p.foreign && p.loadedFrom.startsWith('packages/')), 'relative paths: a published manifest carries no operator path');
    const v = verifyCodeDigest({ detail, recorded: detail.digest, repo: root });
    assert.equal(v.ok, true, JSON.stringify(v.failures));
    assert.equal(v.checks.filter((c) => /matches/.test(c)).length, 3, 'two packages and the lockfile');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('one changed byte in a loaded package is named — the code is not the commit\'s', () => {
  const { root, commit } = repo();
  try {
    writeFileSync(join(root, 'packages', 'loopguard', 'src', 'index.js'), 'export const name = "tampered";\n');
    const detail = computeCodeDigest(root, { resolve: resolverFor(root), commit, nodeModules: false });
    const v = verifyCodeDigest({ detail, recorded: detail.digest, repo: root });
    assert.equal(v.ok, false);
    assert.deepEqual(v.failures.map((f) => f.split(':')[0]), ['compact-dsh-loopguard'], 'only the changed package');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the 0e3fa8 shape: packages loaded from another checkout at another commit fail by content', () => {
  const a = repo();
  const b = repo();
  try {
    writeFileSync(join(b.root, 'packages', 'loopguard', 'src', 'index.js'), 'export const name = "older guard";\n');
    // the run's checkout is `a`, but loopguard resolves into `b` (a linked node_modules)
    const resolve = (name) => (name === 'compact-dsh-loopguard' ? resolverFor(b.root)(name) : resolverFor(a.root)(name));
    const detail = computeCodeDigest(a.root, { resolve, commit: a.commit, nodeModules: false });
    const lg = detail.packages.find((p) => p.name === 'compact-dsh-loopguard');
    assert.equal(lg.foreign, true);
    assert.ok(lg.loadedFrom.startsWith(b.root), 'a foreign path is kept absolute — it is the evidence');
    const v = verifyCodeDigest({ detail, recorded: detail.digest, repo: a.root });
    assert.match(v.failures.join('\n'), /compact-dsh-loopguard: the code that loaded .* from .* is NOT the commit's/);
  } finally {
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  }
});

test('a detail that does not hash to the chained digest is not this run\'s', () => {
  const { root, commit } = repo();
  try {
    const detail = computeCodeDigest(root, { resolve: resolverFor(root), commit, nodeModules: false });
    const forged = { ...detail, packages: detail.packages.map((p) => ({ ...p, digest: p.name === 'compact-dsh-loopguard' ? 'f'.repeat(64) : p.digest })) };
    forged.digest = topDigest(forged); // internally consistent — but not what the chain recorded
    const v = verifyCodeDigest({ detail: forged, recorded: detail.digest, repo: root });
    assert.equal(v.ok, false);
    assert.match(v.failures[0], /does not hash to the digest the record carries/);
    // without a repository the detail↔record check still runs, and says what it did not do
    const noRepo = verifyCodeDigest({ detail, recorded: detail.digest, repo: null });
    assert.equal(noRepo.ok, true);
    assert.match(noRepo.unverified, /nothing was compared with a commit/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
