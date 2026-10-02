// Resilient fail-loud tests: the launcher's uncaught-failure classifier, run
// in child processes because the whole subject IS process-level behavior —
// a contained ECONNRESET/EPIPE keeps the process alive with a loud log line,
// every other exception and rejection keeps the stock fail-loud semantics
// (one report, dispose grace, exit 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const modulePath = fileURLToPath(new URL('./resilient-fail-loud.mjs', import.meta.url));

const child = (body) => {
  const dir = mkdtempSync(join(tmpdir(), 'resilient-fail-loud-'));
  const file = join(dir, 'child.mjs');
  writeFileSync(file, body);
  return spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 15_000 });
};

const BOOT = `
import { installResilientFailLoud } from ${JSON.stringify(modulePath)};
const disposeCalls = [];
installResilientFailLoud({
  binName: 'compact-test',
  proc: process,
  dispose: async () => { disposeCalls.push(1); },
});
globalThis.disposeCalls = disposeCalls;
`;

test('resilient fail-loud: an ECONNRESET exception is contained — loud log, process survives', () => {
  const run = child(BOOT + `
const err = new Error('read ECONNRESET');
err.code = 'ECONNRESET';
err.syscall = 'read';
throw err;
`);
  assert.equal(run.status, 0, `exit ${run.status}: ${run.stderr}`);
  assert.match(run.stderr, /compact-test: contained peer reset \(ECONNRESET on read\)/);
  assert.match(run.stderr, /the runtime keeps serving/);
});

test('resilient fail-loud: an EPIPE rejection is contained too', () => {
  const run = child(BOOT + `
const err = new Error('write EPIPE');
err.code = 'EPIPE';
Promise.reject(err);
// the rejection is contained; the process leaves on its own terms
setTimeout(() => process.exit(0), 100);
`);
  assert.equal(run.status, 0, `exit ${run.status}: ${run.stderr}`);
  assert.match(run.stderr, /contained peer reset \(EPIPE on rejected stream\)/);
});

test('resilient fail-loud: an unowned exception stays fatal — report, dispose, exit 1', () => {
  const run = child(BOOT + `
globalThis.disposeCalls.push = () => console.error('compact-test: disposal ran before exit');
throw new Error('the gate is broken');
`);
  assert.equal(run.status, 1, `exit ${run.status}: ${run.stderr}`);
  assert.match(run.stderr, /fatal uncaught exception: Error: the gate is broken/);
  assert.match(run.stderr, /disposal ran before exit/, 'the fatal path honors the dispose grace before exiting');
});

test('resilient fail-loud: an unowned rejection stays fatal too', () => {
  const run = child(BOOT + `
Promise.reject(new Error('a contract breach'));
setTimeout(() => {}, 500);
`);
  assert.equal(run.status, 1, `exit ${run.status}: ${run.stderr}`);
  assert.match(run.stderr, /fatal load failure: Error: a contract breach/);
});

test('resilient fail-loud: an ECONNRESET-missing code error is not contained', () => {
  const run = child(BOOT + `
const err = new Error('reset without a code');
err.errno = -104; // the symptom without the classifier's contract
throw err;
`);
  assert.equal(run.status, 1, 'containment is by code, not by message shape');
  assert.match(run.stderr, /fatal uncaught exception/);
});
