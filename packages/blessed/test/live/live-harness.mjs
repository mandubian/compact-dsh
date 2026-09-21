// Live-test harness: drive the REAL launcher (`tools/compact-dsh.mjs --attended`)
// end-to-end with a real model route, answering the terminal approval prompts
// programmatically, then assert against the chained record — never against the
// model's prose. This module is harness plumbing; the tests live beside it.
//
// COST DISCIPLINE. Every test here makes real model requests. The suite runs
// only via `npm run test:live` (COMPACT_LIVE_TEST=1) and skips itself otherwise;
// it further requires DEEPSEEK_API_KEY and a local Docker sandbox, skipping
// with a named reason when either is missing.

import { execFileSync, spawn } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));

export const liveEnabled = () => process.env.COMPACT_LIVE_TEST === '1';
export const liveSkipReason = () =>
  liveEnabled()
    ? (process.env.DEEPSEEK_API_KEY ? false : 'DEEPSEEK_API_KEY is not set — a live model route is required')
    : 'live tests cost tokens — run explicitly with `npm run test:live` (COMPACT_LIVE_TEST=1)';

export function dockerAvailable() {
  try {
    execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', 'ubuntu:24.04'], { encoding: 'utf8', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const randomToken = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

/**
 * A self-contained fixture: temp workspace, temp state dir, and its OWN
 * rehearsal identity set (never the operator's ~/.compact-dsh keyring).
 */
export function makeFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'compact-live-'));
  const workspace = join(dir, 'workspace');
  const stateDir = join(dir, 'state');
  mkdirSync(workspace, { recursive: true });
  const keyring = join(stateDir, 'keyring');
  // generate the rehearsal identity set: authority keys + enforcer key + annex,
  // via the real tool, so the live boot exercises the installed artifacts
  execFileSync(process.execPath, [join(ROOT, 'tools', 'rehearsal-keyring.mjs'), 'ensure', keyring], { encoding: 'utf8' });
  const baseEnv = {
    COMPACT_ENFORCER_ANNEX: join(keyring, 'enforcer.annex.json'),
    COMPACT_ENFORCER_KEY: join(keyring, 'enforcer.pem'),
    COMPACT_SANDBOX_IMAGE: 'ubuntu:24.04',
    COMPACT_STATE_DIR: stateDir,
  };
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, workspace, stateDir, baseEnv, keyring };
}

/**
 * Spawn the real launcher for one attended task.
 *
 * @param {object} p
 * @param {string} p.task - the task given to the Subject
 * @param {object} p.fixture - makeFixture() result
 * @param {(promptText: string) => string|null} p.answer - given the accumulated
 *   terminal prompt text, return the choice to write ('1' | '2') or null to wait
 * @param {object} [p.env] - extra env (COMPACT_SECRETS, exported token values, …)
 * @param {number} [p.timeoutMs] - overall budget; the child is killed past it
 * @returns {Promise<{code: number, stdout: string, stderr: string, prompts: string[], sessionDir: string|null}>}
 */
export function runLauncher({ task, fixture, answer, env = {}, timeoutMs = 300_000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'tools', 'compact-dsh.mjs'), '--attended', '--workspace', fixture.workspace, task], {
      cwd: ROOT,
      env: { ...process.env, ...fixture.baseEnv, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let prompts = 0;
    let promptText = '';
    let answered = 0;
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, prompts, sessionDir: newestSessionDir(fixture.stateDir) });
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2_000);
      // let the kill land before resolving with a timeout marker
      setTimeout(() => finish(-1), 3_000);
    }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => {
      stderr += d;
      promptText += d;
      // the attended answerer asks with `choice [1]: ` on stderr; answer each
      // prompt exactly once, from the test's policy
      if (promptText.includes('choice [1]:')) {
        const choice = answer(promptText);
        promptText = '';
        if (choice != null) {
          answered += 1;
          prompts = answered;
          child.stdin.write(`${choice}\n`);
        }
      }
      if (stderr.includes('compact-dsh: ')) { /* readiness/diagnostic lines accumulate for the report */ }
    });
    child.on('exit', (code) => finish(code ?? -1));
  });
}

/** The newest session recorded under the fixture's state dir (null before any run). */
export function newestSessionDir(stateDir) {
  let best = null;
  let bestM = -1;
  for (const group of readdirSync(join(stateDir, 'sessions'))) {
    const groupDir = join(stateDir, 'sessions', group);
    if (!statSync(groupDir).isDirectory()) continue;
    for (const session of readdirSync(groupDir)) {
      const jsonl = join(groupDir, session, 'session.v3.jsonl');
      if (!existsSync(jsonl)) continue;
      const m = statSync(jsonl).mtimeMs;
      if (m > bestM) { bestM = m; best = join(groupDir, session); }
    }
  }
  return best;
}

/** The session's events as objects. */
export function readEvents(sessionDir) {
  return readFileSync(join(sessionDir, 'session.v3.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** Run the offline auditor with every signature input the fixture provides. */
export function auditSession({ fixture, sessionDir }) {
  const sessionId = sessionDir.split(/[/\\]/).at(-1);
  const chain = join(fixture.stateDir, 'chains', `${sessionId}.chain`);
  const anchors = join(fixture.stateDir, 'chains', `${sessionId}.chain.sigs.jsonl`);
  const args = [
    join(ROOT, 'auditor', 'audit.mjs'),
    join(sessionDir, 'session.v3.jsonl'),
    ...(existsSync(chain) ? ['--chain', chain] : []),
    ...(existsSync(anchors) ? ['--annex', join(fixture.keyring, 'enforcer.annex.json'), '--anchors', anchors] : []),
    '--keyring', join(ROOT, 'packages', 'constitution', 'keyring', 'dev', 'keyring.json'),
    '--seal', join(ROOT, 'packages', 'constitution', 'keyring', 'dev', 'compact-body.sig.json'),
    '--body', join(ROOT, 'packages', 'constitution', 'compact', 'compact.md'),
  ];
  const out = execFileSync(process.execPath, args, { encoding: 'utf8' });
  return JSON.parse(out);
}
