import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { workspacePackages, foreignPackages } from './package-provenance.mjs';

function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'pkgprov-'));
  for (const [dir, name] of [['loopguard', 'compact-dsh-loopguard'], ['approval', 'compact-dsh-approval'], ['card', 'compact-dsh-card']]) {
    mkdirSync(join(root, 'packages', dir, 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify({ name }));
    writeFileSync(join(root, 'packages', dir, 'src', 'index.js'), 'export {};\n');
  }
  return root;
}

test('the workspace packages are read from packages/*/package.json', () => {
  const root = checkout();
  try {
    assert.deepEqual(workspacePackages(root).map((p) => p.name), ['compact-dsh-approval', 'compact-dsh-card', 'compact-dsh-loopguard']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a package that resolves into ANOTHER checkout is foreign — the 0e3fa8 shape', () => {
  const root = checkout();
  const other = checkout();
  try {
    const resolve = (name) => {
      if (name === 'compact-dsh-loopguard') return pathToFileURL(join(other, 'packages', 'loopguard', 'src', 'index.js')).href;
      if (name === 'compact-dsh-card') throw new Error('ERR_PACKAGE_PATH_NOT_EXPORTED'); // never loadable by name
      return pathToFileURL(join(root, 'packages', 'approval', 'src', 'index.js')).href;
    };
    const foreign = foreignPackages(root, resolve);
    assert.deepEqual(foreign.map((f) => f.name), ['compact-dsh-loopguard'], 'only the package that left the checkout');
    assert.ok(foreign[0].path.startsWith(other), 'its real location is named');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('a symlink is judged by where it really points', () => {
  const root = checkout();
  const other = checkout();
  try {
    // a node_modules-style link that lands back inside the checkout is home…
    symlinkSync(join(root, 'packages', 'approval'), join(root, 'approval-link'));
    // …and one that lands in the other checkout is foreign
    symlinkSync(join(other, 'packages', 'loopguard'), join(root, 'loopguard-link'));
    const resolve = (name) => (name === 'compact-dsh-approval'
      ? join(root, 'approval-link', 'src', 'index.js')
      : name === 'compact-dsh-loopguard' ? join(root, 'loopguard-link', 'src', 'index.js') : null);
    assert.deepEqual(foreignPackages(root, resolve).map((f) => f.name), ['compact-dsh-loopguard']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});
