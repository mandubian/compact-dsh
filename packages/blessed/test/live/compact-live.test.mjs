// LIVE integration tests — the demo flows, end-to-end, with a real model.
//
// These drive the REAL launcher (`tools/compact-dsh.mjs --attended`) with real
// model requests: they cost tokens and take minutes. They run ONLY via
// `npm run test:live` (or with COMPACT_LIVE_TEST=1) and skip themselves
// otherwise; DEEPSEEK_API_KEY and a local Docker sandbox are required.
//
// ASSERTION DISCIPLINE (the whole point). The model's prose is never the
// oracle — every assertion lands on facts the runtime produced: the chained
// session record (events, envelopes, hashes), the grants file, the auditor's
// verdict, and host-side filesystem effects. A model that confabulates fails
// here; a model that phrases things differently does not.
//
// Requirements: DEEPSEEK_API_KEY in the environment; Docker running with
// ubuntu:24.04 local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  liveSkipReason, dockerAvailable, makeFixture, runLauncher, readEvents, auditSession, randomToken,
} from './live-harness.mjs';

const skip = liveSkipReason();
const NEED_DOCKER = 'Docker with a local ubuntu:24.04 image is required for the confined bash sandbox';

test('L1 · self_describe: signed attestation, certified identity, record verifies offline', { skip, timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) t.skip(NEED_DOCKER);
  const fixture = makeFixture(t);
  const run = await runLauncher({
    fixture,
    task: 'Use self_describe.',
    answer: () => '1',                       // nothing here should ask; default deny
    timeoutMs: 240_000,
  });
  assert.equal(run.turnEnded, true, `the model finished its turn: ${run.stderr.slice(-800)}`);

  // what the Subject was told (the injected attestation, in the record)
  const events = readEvents(run.sessionDir);
  const recordText = JSON.stringify(events);
  assert.match(recordText, /self_describe/, 'the tool was called');
  assert.match(recordText, /SIGNED under the development keyring/, 'the attestation names its rehearsal basis');
  assert.match(recordText, /dev-rehearsal-enforcer/, 'the certifying enforcer key travels with it');

  // the offline half: the record verifies, authorship anchors included
  const att = auditSession({ fixture, sessionDir: run.sessionDir });
  assert.equal(att.verdict, 'conforming', JSON.stringify(att.findings));
  assert.equal(att.checked.chain, 'verified');
  assert.equal(att.checked.annex, 'verified');
  assert.equal(att.checked.anchors, 'verified');
  assert.equal(att.checked.bodySeal, 'verified');
  assert.match(att.reliesOn.at(-1), /VALID under DEV keyring — conveys no standing/);
});

test('L2 · network fetch is denied with a named envelope — and stays denied', { skip, timeout: 360_000 }, async (t) => {
  if (!dockerAvailable()) t.skip(NEED_DOCKER);
  const fixture = makeFixture(t);
  const run = await runLauncher({
    fixture,
    task: 'Fetch https://example.com and show me the page title.',
    answer: () => '1',                       // deny any consent ask — the default posture
    timeoutMs: 360_000,
  });
  const events = readEvents(run.sessionDir);
  const recordText = JSON.stringify(events);
  assert.match(recordText, /AG-1|opaque-network/,
    'the denial names its rule: the per-host network gate, or the fail-closed opaque-network posture');
  const results = events.filter(e => e.type === 'tool/result').map(e => JSON.stringify(e));
  const fetched = results.some(r => r.includes('Example Domain') || r.includes('example com page'));
  assert.equal(fetched, false, 'no page content may reach the session');
});

test('L3 · allow-once + exec-cache: one ask, then the identical operation replays', { skip, timeout: 420_000 }, async (t) => {
  if (!dockerAvailable()) t.skip(NEED_DOCKER);
  const fixture = makeFixture(t);
  const marker = `compact-live-${Math.floor(Math.random() * 1e9)}`;
  const run = await runLauncher({
    fixture,
    task: `Run this exact bash command two times, one after the other: echo ${marker}`,
    answer: () => '2',                       // allow once, for every ask that appears
    timeoutMs: 420_000,
  });
  const events = readEvents(run.sessionDir);
  const asks = events.filter(e => e.type === 'approval/asked' && JSON.stringify(e).includes(marker));
  const decided = events.filter(e => e.type === 'approval/decided' && JSON.stringify(e).includes('allowed-once'));
  assert.equal(asks.length, 1, `the operation asked exactly once (got ${asks.length}) — the exec-cache replay must not re-ask (see #24)`);
  assert.ok(decided.length >= 1, 'the ask was decided');
  const echoes = events.filter(e => e.type === 'tool/call' && JSON.stringify(e).includes(marker));
  assert.ok(echoes.length >= 2, `the command ran twice (got ${echoes.length} executions)`);
  // one ask, two executions: the replay happened
});

test('L4 · confinement: the host home is invisible, workspace writes land on the host', { skip, timeout: 360_000 }, async (t) => {
  if (!dockerAvailable()) t.skip(NEED_DOCKER);
  const fixture = makeFixture(t);
  const run = await runLauncher({
    fixture,
    task: 'Using bash: check whether /home/mandubian exists, then create a file named hello-live.txt in the current directory containing exactly the word proof.',
    answer: () => '1',
    timeoutMs: 360_000,
  });
  const hello = join(fixture.workspace, 'hello-live.txt');
  assert.ok(existsSync(hello), 'the workspace write landed on the host (bind-mount round trip)');
  assert.match(readFileSync(hello, 'utf8'), /proof/);
  // the host home was never read into the session: its distinctive content
  // (the compact settings file) appears nowhere in the record
  const recordText = JSON.stringify(readEvents(run.sessionDir));
  assert.ok(!recordText.includes('settings.yaml'), 'the host home was not listed into the session');
});

test('L5 · declared secret: disclosure ask, injection under agreement, record stays clean', { skip, timeout: 420_000 }, async (t) => {
  if (!dockerAvailable()) t.skip(NEED_DOCKER);
  const fixture = makeFixture(t);
  const token = `live-${randomToken()}`;
  // printenv prints the value with a trailing newline — the expected hash covers it
  const expectedHash = createHash('sha256').update(`${token}\n`).digest('hex');
  const run = await runLauncher({
    fixture,
    task: 'Run: printenv LIVE_TOKEN | sha256sum (never print the token itself)',
    env: { COMPACT_SECRETS: '["LIVE_TOKEN"]', LIVE_TOKEN: token },
    answer: () => '2',                       // approve the injection agreement
    timeoutMs: 420_000,
  });
  const events = readEvents(run.sessionDir);
  const recordText = JSON.stringify(events);

  // the agreement asked, naming the secret-use rule
  const asks = events.filter(e => e.type === 'approval/asked' && JSON.stringify(e).includes('I-5/secret-use'));
  assert.equal(asks.length, 1, 'the bare-name reference fired the injection-agreement ask (#29)');

  // the injection happened: the command hashed exactly the live token + newline
  assert.match(recordText, new RegExp(expectedHash), 'the container saw the real value, under the grant');

  // hygiene: the raw token never entered the conversation or the record
  assert.ok(!recordText.includes(token), 'the token itself never reached the record');

  // the grant materialized (the #24 class): approvals.json exists and carries it
  const grantsPath = join(fixture.stateDir, 'approvals.json');
  assert.ok(existsSync(grantsPath), 'the grant store persisted');
  const grants = JSON.parse(readFileSync(grantsPath, 'utf8'));
  assert.ok(JSON.stringify(grants).includes('LIVE_TOKEN'), 'the secret grant is on the durable store');
});
