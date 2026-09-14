#!/usr/bin/env node
// dsh version-range gate (port plan Phase 0): every package that touches dsh
// must pin @deepseek-ai/dsh to the audited rc line. Any other range = fail.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = /^~0\.1\.5-rc\.\d+$/; // audited line; upgrades are re-blessed events
const root = new URL('..', import.meta.url).pathname;
const pkgs = readdirSync(join(root, 'packages')).map(p => join(root, 'packages', p, 'package.json'));
let failures = 0, checked = 0;
for (const pkg of pkgs) {
  const manifest = JSON.parse(readFileSync(pkg, 'utf8'));
  const all = { ...(manifest.dependencies||{}), ...(manifest.peerDependencies||{}) };
  const range = all['@deepseek-ai/dsh'];
  if (!range) continue;
  checked++;
  if (!ALLOWED.test(range)) {
    console.error(`✗ ${manifest.name}: dsh range "${range}" is outside the audited line (~0.1.5-rc.*)`);
    failures++;
  }
}
if (failures) { console.error(`verify-pin: ${failures} package(s) outside the audited dsh line`); process.exit(1); }
console.log(`verify-pin OK: ${checked} package(s) pinned to the audited dsh line`);
