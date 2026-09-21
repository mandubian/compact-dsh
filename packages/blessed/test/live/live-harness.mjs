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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// repo root: verified by resolution — four ups from this file lands on the checkout
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export const liveEnabled = () => process.env.COMPACT_LIVE_TEST === '1';
export const liveSkipReason = () =>
  liveEnabled()
    ? (hasModelRoute() ? false : 'no model route — set DEEPSEEK_API_KEY, or point COMPACT_LIVE_SETTINGS at a settings.yaml with a configured route (e.g. your opencode-go profile)')
    : 'live tests cost tokens — run explicitly with `npm run test:live` (COMPACT_LIVE_TEST=1)';

/** A model route is available when the default key is set, or when the operator points at a settings file that configures one. */
export function hasModelRoute() {
  return Boolean(process.env.DEEPSEEK_API_KEY) ||
    (process.env.COMPACT_LIVE_SETTINGS != null && existsSync(process.env.COMPACT_LIVE_SETTINGS));
}

export function dockerAvailable() {
  try {
    execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', 'ubuntu:24.04'], { encoding: 'utf8', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** A random token value for secret-injection tests (never a fixed string). */
export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

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
  // a custom model route (e.g. the opencode-go profile): the operator's
  // settings file is seeded into the fixture's DSH_HOME, because a throwaway
  // state dir would otherwise fall back to the default route
  if (process.env.COMPACT_LIVE_SETTINGS) {
    if (!existsSync(process.env.COMPACT_LIVE_SETTINGS)) {
      throw new Error(`COMPACT_LIVE_SETTINGS points at a missing file: ${process.env.COMPACT_LIVE_SETTINGS}`);
    }
    copyFileSync(process.env.COMPACT_LIVE_SETTINGS, join(stateDir, 'settings.yaml'));
  }
  const baseEnv = {
    COMPACT_ENFORCER_ANNEX: join(keyring, 'enforcer.annex.json'),
    COMPACT_ENFORCER_KEY: join(keyring, 'enforcer.pem'),
    COMPACT_SANDBOX_IMAGE: 'ubuntu:24.04',
    COMPACT_STATE_DIR: stateDir,
  };
  // COMPACT_LIVE_KEEP=1 preserves the fixture on failure — the session record,
  // chains, and grants are the forensics; default cleanup is intentional (the
  // fixture holds recorded model turns), but a failed run with no evidence is
  // a run that cannot be diagnosed.
  const keep = process.env.COMPACT_LIVE_KEEP === '1';
  if (keep) console.error(`[live] fixture preserved for triage: ${dir}`);
  t.after(() => {
    if (!keep) rmSync(dir, { recursive: true, force: true });
  });
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
 * @returns {Promise<{code: number, turnEnded: boolean, stdout: string, stderr: string, prompts: number, sessionDir: string|null}>}
 *   `prompts` counts the approval prompts the harness answered; `turnEnded` is
 *   true when the run completed (exit or turn/end observed in the record).
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
    let turnEnded = false;
    // Completion is judged by the RECORD, not the exit: the launcher can hang
    // after a completed turn once an approval has been answered (#36). When
    // the newest session shows turn/end, the model is done — kill the child
    // and let the tests assert on the record.
    const poll = setInterval(() => {
      if (turnEnded || settled) return;
      const dir = newestSessionDir(fixture.stateDir);
      if (!dir) return;
      try {
        const events = readEvents(dir);
        if (events.at(-1)?.type === 'turn/end') {
          turnEnded = true;
          child.kill('SIGTERM');
        }
      } catch { /* a torn tail line is not a diagnosis yet */ }
    }, 500);
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve({ code, turnEnded, stdout, stderr, prompts, sessionDir: newestSessionDir(fixture.stateDir) });
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
      // prompt exactly once, from the test's policy. The marker stays in the
      // buffer when the policy defers — clearing it early could lose the only
      // copy of the prompt and deadlock the run past its timeout.
      if (promptText.includes('choice [1]:')) {
        const choice = answer(promptText);
        if (choice != null) {
          answered += 1;
          prompts = answered;
          promptText = '';
          child.stdin.write(`${choice}\n`);
        }
      }
    });
    child.on('exit', (code) => finish(code ?? -1));
  });
}

/** The newest session recorded under the fixture's state dir (null before any run). */
export function newestSessionDir(stateDir) {
  const sessionsRoot = join(stateDir, 'sessions');
  if (!existsSync(sessionsRoot)) return null;   // the launcher may exit before its first write
  let best = null;
  let bestM = -1;
  for (const group of readdirSync(sessionsRoot)) {
    const groupDir = join(sessionsRoot, group);
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
