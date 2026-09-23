#!/usr/bin/env node
// baseline-guard — the sentinel CI gate (port plan Phase 4 item 5, A-4): a PR
// that touches BOTH enforcement code and the register is a change to what the
// clauses mean in practice, and must declare itself with the [baseline-update]
// title prefix.
//
// The enforcement package list is DERIVED from the register itself (every
// `enforcedBy` / `verifiers` path under `packages/` names its whole package
// tree), so the guard can no longer drift from the register it guards: a new
// enforced package must add register rows (verify-register already refuses an
// enforced entry whose citations do not resolve), and the rows ARE the scope.
// The first hardcoded list fell behind exactly this way (#58): `envelope`,
// `blessed`, `seals` and `egress-proxy` were all register-cited and all
// unwatched. Any cited package is watched whole — conduct lives in configs
// and loader patches too (e.g. packages/blessed/cordis.patch.yml), not only
// under src/ or test/.
//
// Fail-closed: an unparsable register, an empty derived scope, or a missing
// diff source refuses the guard rather than passing it.
//
// Usage (CI):    node tools/baseline-guard.mjs <base-sha> <head-sha> --title "<PR title>"
// Usage (tests): node tools/baseline-guard.mjs --files <file-with-one-path-per-line>
//                [--register <path>] [--title "<title>"]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PREFIX = '[baseline-update]';

/** Distinct package names the register maps conduct into. */
export function enforcementPackages(register) {
  const pkgs = new Set();
  for (const e of register.entries ?? []) {
    for (const kind of ['enforcedBy', 'verifiers']) {
      for (const p of e[kind] ?? []) {
        const m = /^packages\/([^/]+)\//.exec(p);
        if (m) pkgs.add(m[1]);
      }
    }
  }
  return [...pkgs].sort();
}

/** The anchored pattern the guard watches enforcement conduct with. */
export function enforcementPattern(register) {
  const pkgs = enforcementPackages(register);
  if (pkgs.length === 0) return null;
  return new RegExp(`^packages/(${pkgs.map(escapeRe).join('|')})/`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function classify(register, files) {
  const pattern = enforcementPattern(register);
  return {
    pattern,
    touchesEnforcement: pattern ? files.some(f => pattern.test(f)) : false,
    touchesRegister: files.includes('docs/register/register.json'),
  };
}

/** The pure decision: ok, or the reason naming the lawful remedy. */
export function guard({ title, register, files }) {
  if (!register || typeof register !== 'object') {
    return { ok: false, reason: 'the register does not parse — the guard refuses rather than passes on an unreadable law' };
  }
  const { pattern, touchesEnforcement, touchesRegister } = classify(register, files);
  if (!pattern) {
    return { ok: false, reason: 'no packages/ scope could be derived from the register — the guard refuses rather than watch nothing' };
  }
  if (touchesEnforcement && touchesRegister) {
    if (typeof title === 'string' && title.startsWith(PREFIX)) {
      return { ok: true, declared: true, pattern };
    }
    return {
      ok: false,
      pattern,
      reason:
        'this PR changes enforcement code AND the register — a change to what the clauses mean in practice is an amendment of conduct (A-4). ' +
        `Retitle with the ${PREFIX} prefix.`,
    };
  }
  return { ok: true, declared: false, pattern };
}

function loadRegister(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { __error: e.message };
  }
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const title = flag('--title');
  const registerPath = flag('--register') ?? fileURLToPath(new URL('../docs/register/register.json', import.meta.url));
  const register = loadRegister(registerPath);
  if (register.__error) {
    console.error(`::error::baseline-guard could not read ${registerPath}: ${register.__error}`);
    process.exit(1);
  }

  // fail closed: a sentinel that dies on a raw stack trace teaches people to
  // re-run it instead of reading it — every refusal carries the ::error:: mark
  let files;
  try {
    const filesFrom = flag('--files');
    if (filesFrom) {
      files = readFileSync(filesFrom, 'utf8').split(/\r?\n/).map(s => s.trimEnd()).filter(Boolean);
    } else {
      const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--title' && argv[i - 1] !== '--register' && argv[i - 1] !== '--files');
      if (positional.length !== 2) {
        throw new Error('expects <base-sha> <head-sha> (or --files <listfile> for tests)');
      }
      files = execFileSync('git', ['diff', '--name-only', positional[0], positional[1]], { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    }
  } catch (e) {
    console.error(`::error::baseline-guard could not determine the changed files: ${e.message}`);
    process.exit(1);
  }

  const outcome = guard({ title, register, files });
  if (outcome.ok) {
    console.log(`baseline-guard ok (enforcement scope: ${enforcementPackages(register).join(' ')}${outcome.declared ? ' — baseline-update declared' : ''})`);
    process.exit(0);
  }
  console.error(`::error::${outcome.reason}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
