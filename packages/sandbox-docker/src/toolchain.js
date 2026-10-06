// compact-dsh-sandbox-docker — the immutable-toolchain recognition (#152).
//
// The docker confinement holds the container's root filesystem --read-only in
// EVERY sandbox mode (provider.js), and CF-2 pins the image by content digest:
// the system toolchain inside the act is immutable and digest-pinned. A
// command whose effect is a system-package-manager write — apt/apt-get,
// dnf/yum, apk, and a pip/pip3 install aimed at the system site-packages —
// cannot succeed under that confinement NO MATTER WHAT the operator approves.
// The egress record's own sentence is the doctrine: "an approval that cannot
// change anything is a survey." So the act is refused BEFORE any approval ask
// can fire, with the teaching envelope, and the lawful routes are named.
//
// Two recognitions, one envelope:
//   1. PRE-EXECUTE (precise) — the doomed family, refused at the waterfall
//      before the approval gate. Precision is the requirement: a
//      workspace-scoped install (a venv activated or path-qualified in the
//      line, --target/--user/--prefix, an in-line `python3 -m venv`) is
//      LAWFUL and passes untouched — the recognition targets system
//      destinations, not package managers per se. Because every act is a
//      fresh per-call container, static analysis over the one command line
//      is sound here: a venv activated in an EARLIER act is not active.
//   2. POST-EXECUTE (the belt) — a confined result carrying the backend's
//      own denial dialect (DENIAL_SIGNATURES: the read-only fs, the
//      permission denial) from a package-manager-shaped command wraps into
//      the same envelope, keeping the container's own words on the record.
//      The belt's shape is deliberately wider than the pre-execute family —
//      it is where the shapes precision spares (`pip install --user` against
//      a read-only HOME, a global npm/cargo/go install) get taught, because
//      there the SIGNATURE is the fact: the container itself reported that
//      the write hit the immutable filesystem.
//
// The blessed composition mounts this plugin BEFORE compact-remote-access so
// this recognition's tools/pre-execute listener registers ahead of the
// analyzer's ask (waterfall order is registration order) — the dishonest ask
// the trial path recorded can never fire.
//
// Pinned: @deepseek-ai/dsh ~0.2.0-rc.2 (see tools/verify-pin.mjs).

import { buildEnvelope, bandReason } from 'compact-envelope';

/** The gate every immutable-toolchain envelope carries (the SC family). */
export const GATE = 'SC';

export const IMMUTABLE_TOOLCHAIN_RULE = 'CF-1/immutable-toolchain';

// The command-shaped argument keys the analyzer family scans (command, cmd,
// script). Declared here rather than imported: sandbox-docker does not depend
// on compact-dsh-remote-access, and the two vocabularies are each their own
// adjudicated surface.
const COMMAND_ARG_KEYS = ['command', 'cmd', 'script'];

// The system package managers whose write subcommands mutate package stores on
// the container's root filesystem (/usr, /var/lib/dpkg, /var/lib/apt, …) — the
// stores the --read-only rootfs holds immutable. The issue names the family by
// its canonical verbs (apt/apt-get install, dnf/yum install, apk add); every
// other write subcommand of the same binaries is equally doomed by the same
// doctrine, so the family is the write surface of the named binaries.
const SYSTEM_PACKAGE_WRITES = {
  apt: ['install', 'update', 'upgrade', 'dist-upgrade', 'remove', 'purge'],
  'apt-get': ['install', 'update', 'upgrade', 'dist-upgrade', 'remove', 'purge'],
  dnf: ['install', 'update', 'upgrade', 'downgrade', 'remove', 'erase'],
  yum: ['install', 'update', 'upgrade', 'downgrade', 'remove', 'erase'],
  apk: ['add', 'del', 'upgrade', 'fix'],
};

// What spares a pip-family install: the destination is provably not the
// system site-packages. Flags that scope the install's destination, a venv
// activated or path-qualified inside the line, and a VIRTUAL_ENV naming.
const PIP_SCOPING_FLAGS = ['--target', '-t', '--user', '--prefix', '--root'];
const VENV_MARK = /venv\/bin|^VIRTUAL_ENV=|\/bin\/activate$/;
// a path-qualified interpreter/pip under one of these prefixes IS the system
// toolchain, not a workspace venv
const SYSTEM_PATH = /^\/(?:usr|bin|sbin|lib|opt|snap)\//;

// shell-naive tokenization, the analyzer's own: separators are their own
// matches, so a token opens a command when it is the first token or follows
// && || ; | & ( ). Package-manager heads are matched ANYWHERE in the line —
// the analyzer's own package-verb precedent, and the fail-closed direction
// for a refusal (`sudo apt-get install` and `sh -c apt-get install` both
// reach the doomed store).
const TOKEN_RE = /&&|\|\||[;|()]|&(?!&)|[^\s;&|()]+/g;
const SEPARATORS = new Set(['&&', '||', ';', '|', '&', '(', ')']);

function tokenize(command) {
  return [...command.matchAll(TOKEN_RE)].map(m => m[0]).filter(t => !SEPARATORS.has(t));
}

/** The bare name of a command token: path-stripped and quote-stripped — the
 *  shell-naive tokenizer keeps attached quotes (`"apt-get`), and a wrapper's
 *  quoting must not launder the act past the recognition. */
function bareOf(tok) {
  return tok.replace(/^.*\//, '').replace(/^["']+|["']+$/g, '');
}

/** The index of the `install` word when tokens[i] is a pip-family head, else -1. */
function pipInstallAt(tokens, i) {
  const bare = bareOf(tokens[i]);
  if ((bare === 'pip' || bare === 'pip3') && tokens[i + 1] === 'install') return i + 1;
  if ((bare === 'python' || /^python\d(?:\.\d+)?$/.test(bare))
    && tokens[i + 1] === '-m' && (tokens[i + 2] === 'pip' || tokens[i + 2] === 'pip3')
    && tokens[i + 3] === 'install') return i + 3;
  return -1;
}

/** A scoping flag inside the install's own argument span (to the next separator). */
function scopedInstall(tokens, from) {
  for (let j = from + 1; j < tokens.length; j++) {
    if (SEPARATORS.has(tokens[j])) return false;
    if (PIP_SCOPING_FLAGS.includes(tokens[j])) return true;
    if (PIP_SCOPING_FLAGS.some(f => tokens[j].startsWith(f + '='))) return true;
  }
  return false;
}

/**
 * The system-package-manager write inside one tool call's command-shaped
 * arguments — { verb, command } — or null. This is the PRE-EXECUTE family:
 * precise by requirement, because a refusal must never teach a lie. A
 * workspace-scoped pip install (venv in the line, --target/--user/--prefix,
 * a path-qualified venv interpreter) is lawful and returns null; the system
 * package managers' write subcommands always refuse.
 */
export function systemPackageWriteOf(args) {
  for (const key of COMMAND_ARG_KEYS) {
    const command = args?.[key];
    if (typeof command !== 'string' || !command.trim()) continue;
    const tokens = tokenize(command);
    // an active workspace venv spares the pip FAMILY (never the system
    // package managers — apt writes /usr/dpkg regardless of any venv)
    const venvScoped = tokens.some(t => VENV_MARK.test(t));
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const bare = bareOf(tok);
      const writes = SYSTEM_PACKAGE_WRITES[bare];
      if (writes && writes.includes(tokens[i + 1])) {
        return { verb: `${bare} ${tokens[i + 1]}`, command, family: 'system' };
      }
      const install = pipInstallAt(tokens, i);
      if (install >= 0) {
        const scoped = venvScoped
          || scopedInstall(tokens, install)
          // a path-qualified pip/python is a venv interpreter unless it IS
          // the system toolchain (/usr/bin/pip3 …)
          || (tok.includes('/') && !SYSTEM_PATH.test(tok));
        if (!scoped) {
          // the `-m` form names the python; the act is still a pip install
          const pipBare = (bare === 'pip' || bare === 'pip3') ? bare : 'pip';
          return { verb: `${pipBare} install`, command, family: 'pip' };
        }
      }
    }
  }
  return null;
}

/**
 * The belt's shape: any package-manager invocation a confined result could
 * carry the read-only signature from — wider than the pre-execute family,
 * because the signature is the fact and the shape only needs to name the act
 * a lawful route exists for. The pre-execute family is a subset; the belt
 * adds the shapes precision spares there: `pip install --user` against a
 * read-only HOME, and the language managers' global/default installs.
 * Workspace-scoped destinations are NEVER belt shapes — `npm install` into
 * node_modules or a `--target` install is the lawful move itself, and a
 * refusal that teaches the move the act already made would be a lie.
 */
export function packageManagerCommandOf(args) {
  const precise = systemPackageWriteOf(args);
  if (precise) return precise;
  for (const key of COMMAND_ARG_KEYS) {
    const command = args?.[key];
    if (typeof command !== 'string' || !command.trim()) continue;
    const tokens = tokenize(command);
    const venvScoped = tokens.some(t => VENV_MARK.test(t));
    const workspaceCargo = tokens.some(t => /^CARGO_HOME=/.test(t) || /^GOBIN=/.test(t) || /^GOPATH=/.test(t));
    for (let i = 0; i < tokens.length; i++) {
      const bare = bareOf(tokens[i]);
      const install = pipInstallAt(tokens, i);
      if (install >= 0) {
        // --user against a read-only HOME is the belt's named shape; a
        // workspace-scoped destination is the lawful move and never teaches
        const flags = flagsOf(tokens, install);
        if (flags.includes('--user') && !venvScoped
          && !flags.some(f => f === '--target' || f === '-t' || f === '--prefix' || f === '--root')) {
          return { verb: 'pip install --user', command };
        }
      }
      // global installs of the language managers write the system prefix;
      // their workspace installs (node_modules, a CARGO_HOME/GOBIN in the
      // workspace) are the lawful moves
      if (['npm', 'pnpm', 'yarn', 'bun'].includes(bare)
        && ['install', 'add', 'i', 'ci'].includes(tokens[i + 1])
        && tokens.some(t => t === '-g' || t === '--global')) {
        return { verb: `${bare} ${tokens[i + 1]} --global`, command };
      }
      if (!workspaceCargo && ['cargo', 'go', 'gem'].includes(bare) && tokens[i + 1] === 'install') {
        return { verb: `${bare} install`, command };
      }
    }
  }
  return null;
}

/** The flag NAMES inside an install's argument span (to the next separator). */
function flagsOf(tokens, from) {
  const out = [];
  for (let j = from + 1; j < tokens.length; j++) {
    if (SEPARATORS.has(tokens[j])) break;
    if (tokens[j].startsWith('-')) out.push(tokens[j].split('=')[0]);
  }
  return out;
}

/** The envelope (#152): rule, reason, and the four lawful next moves. */
export function immutableToolchainEnvelope({ verb }) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'CF-1/immutable-toolchain',
    reason: `"${verb}" writes the system package store: the system toolchain is immutable and digest-pinned (CF-2) — installing system packages inside a confined act cannot succeed by design`,
    lawfulNextMoves: [
      'language dependencies: install into the workspace (`python3 -m venv .venv && .venv/bin/pip install …`) — it persists across every act',
      'self-contained tools: fetch a static binary into `./bin/` and invoke by path',
      'request a read-only mount grant over an operator-provisioned tools directory',
      'escalate to your Principal to bake a derived image (the operator\'s act, CF-2 re-declared)',
    ],
  });
}

/** The pre-execute refusal decision for one recognized write. */
export function immutableToolchainDenial(write) {
  const env = immutableToolchainEnvelope(write);
  return { kind: 'deny', reason: bandReason(env), envelope: env };
}

/** The post-execute belt block: the envelope, with the container's own words kept below it. */
export function immutableToolchainBlock(write, raw) {
  const env = immutableToolchainEnvelope(write);
  const container = String(raw ?? '').trim();
  const text = bandReason(env)
    + (container ? `\n\nThe container reported (kept for the record):\n${container}` : '');
  return { kind: 'block', feedback: [{ type: 'text', text }], envelope: env };
}

/** The refusal-seam payload (LoopGuard accounting), built here so the plugin file stays emitter-free. */
export function immutableToolchainRefusalEvent(exec) {
  return {
    kind: 'deny', verdict: 'immutable-toolchain', ruleId: IMMUTABLE_TOOLCHAIN_RULE,
    tool: exec?.name ?? 'unknown-tool', fingerprint: null, root: null, session: null, at: Date.now(),
  };
}
