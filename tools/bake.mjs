// compact:bake — promoting a workspace toolchain into the image as ONE
// operator act (#155).
//
// Doctrine first: the governed never bake their own confinement. bake is an
// OPERATOR act — run on the operator's host, against the operator's daemon,
// never invoked from inside the runtime, no docker socket ever crossing the
// boundary. It records nothing on the governed record: bake is like the
// original image pull, and CF-2 at confine time is the notary — the printed
// digest is what the launcher declares, and a rebuilt image that drifts off
// that declaration is refused by name (CF-2/digest-drift) until re-declared.
// That refusal working is a feature.
//
// The four steps the issue names:
//   1. the base image must already exist in the LOCAL daemon — bake never
//      pulls (the pull is the operator's act, the launcher's own discipline);
//   2. the workspace's toolchain artifacts are collected: the venv's freeze
//      (pip freeze through the venv's OWN pip), the ./bin/ directory
//      (static binaries are relocatable — copied to /usr/local/bin), and an
//      explicit package list;
//   3. the Dockerfile is derived (a pure, unit-tested function), LABELed with
//      the base digest, the workspace path and the timestamp — the provenance
//      chain `docker inspect` shows;
//   4. the build runs with a MINIMAL context (a temp directory holding the
//      Dockerfile and bin/ only — the workspace itself never rides to the
//      daemon), and the ready-to-export pair is printed, derived the way the
//      runtime itself derives digests (docker image inspect .Id), so the
//      re-declare is copy-paste.
//
// The baked toolchain lands in /opt/compact-venv (on PATH) and /usr/local/bin
// — never at the workspace path, which the runtime bind-mounts over every act.
//
// Usage:
//   npm run compact:bake -- --base <image> [--workspace DIR] [--tag NAME]
//                           [--packages "a, b"] [--dry-run]

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/;          // the launcher's image-reference charset
const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9+.=_-]*$/;           // a debian package name (plus =version pins)
const BUILT_VENV = '/opt/compact-venv';

/** Usage text — printed on a missing --base, the one required fact. */
export const USAGE =
  'usage: npm run compact:bake -- --base <image> [--workspace DIR] [--tag NAME] [--packages "a, b"] [--dry-run]\n' +
  '  --base <image>     the local image to derive FROM (required; bake never pulls — docker pull is your act)\n' +
  '  --workspace DIR    the workspace whose toolchain is promoted (default: the working directory)\n' +
  '  --tag NAME         the derived image tag (default: compact-baked:<base>-<timestamp>)\n' +
  '  --packages "a, b"  system packages to install in the derived image (comma/space separated)\n' +
  '  --dry-run          print what would be built and the exact Dockerfile, build nothing';

/**
 * The workspace's toolchain artifacts, by convention: `.venv` (the name the
 * refusal envelope and the guide teach), then `venv`; and a non-empty `bin/`.
 * Presence of the directory is the declaration — bake reads nothing else from
 * the workspace, and the workspace itself never rides to the daemon.
 */
export function detectArtifacts({ workspace, exists = existsSync, list = readdirSync }) {
  const venv = ['.venv', 'venv'].find(v => exists(join(workspace, v, 'bin'))) ?? null;
  const binDir = join(workspace, 'bin');
  const bin = exists(binDir) && list(binDir).length > 0 ? binDir : null;
  return { venv: venv ? join(workspace, venv) : null, venvName: venv, bin };
}

/**
 * The freeze of one venv, through the venv's OWN pip — never the host's.
 * Injected as `freeze` so tests need no python; the default spawns it.
 */
export function freezeRequirements({ venvDir, exists = existsSync, run = (args) => spawnSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 60_000 }) }) {
  const pip = ['pip', 'pip3'].map(p => join(venvDir, 'bin', p)).find(exists);
  if (!pip) throw new Error(`the venv at ${venvDir} carries no pip — recreate it with ensurepip (python3 -m venv .venv) and bake again`);
  const out = run([pip, 'freeze', '--disable-pip-version-check']);
  if (out.status !== 0) {
    throw new Error(`pip freeze failed for ${venvDir}: ${String(out.stderr).trim().split('\n')[0] ?? 'no stderr'}`);
  }
  return String(out.stdout).split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

/**
 * The Dockerfile, derived — PURE, so the unit tests pin it byte for byte.
 * System packages first (apt, debian-family bases), then the workspace's
 * static binaries, then the baked venv at BUILT_VENV on PATH. Nothing is
 * ever written to the workspace path: the runtime bind-mounts the workspace
 * over every act, and a baked file there would be shadowed — a promise the
 * container could not keep.
 */
export function deriveBakefile({ base, baseDigest, workspace, created, packages = [], includeBin = false, withVenv = false }) {
  if (!REF_RE.test(base)) throw new Error(`base ${JSON.stringify(base)} is not a Docker image reference`);
  if (!/^sha256:[0-9a-f]{64}$/.test(baseDigest)) throw new Error('the base digest must be a sha256 image digest (docker image inspect .Id form)');
  for (const p of packages) {
    if (!PKG_RE.test(p)) throw new Error(`package ${JSON.stringify(p)} is not a plain package name — bake refuses free-form text in the Dockerfile`);
  }
  const lines = [
    '# compact-dsh baked toolchain image — an OPERATOR act (npm run compact:bake), built on the operator\'s host,',
    '# outside the runtime. bake records nothing on the governed record; CF-2 at confine time is the notary.',
    `# Base: ${base} at ${baseDigest}`,
    `# Workspace: ${workspace}`,
    `FROM ${base}`,
    '',
    'LABEL org.opencontainers.image.base.digest="' + baseDigest + '" \\',
    '      org.opencontainers.image.created="' + created + '" \\',
    '      org.opencontainers.image.source="https://github.com/mandubian/compact-dsh" \\',
    '      org.opencontainers.image.description="compact-dsh baked toolchain image (operator act; CF-2 at confine is the notary)" \\',
    `      org.compact.base.image="${base}" \\`,
    `      org.compact.workspace="${workspace}"`,
  ];
  if (packages.length > 0) {
    lines.push('',
      'RUN apt-get update && apt-get install -y --no-install-recommends ' + packages.join(' ') +
      ' && rm -rf /var/lib/apt/lists/*');
  }
  if (includeBin) {
    lines.push('',
      '# the workspace\'s static binaries, relocated to the system PATH (never to the',
      '# workspace path — the runtime bind-mounts the workspace over every act)',
      'COPY bin/ /usr/local/bin/');
  }
  if (withVenv) {
    // a detected venv is translated, not copied: venvs are not relocatable
    // across base images, so the freeze is re-installed into a fresh venv the
    // image owns — on PATH, so every act resolves pip/python to it first.
    lines.push('',
      'COPY compact-requirements.txt /tmp/compact-requirements.txt',
      `RUN python3 -m venv ${BUILT_VENV} \\`,
      `      && ${BUILT_VENV}/bin/pip install --no-cache-dir -r /tmp/compact-requirements.txt \\`,
      '      && rm /tmp/compact-requirements.txt',
      '',
      `ENV PATH="${BUILT_VENV}/bin:\${PATH}"`);
  }
  return lines.join('\n') + '\n';
}

function defaultInspect({ ref }) {
  const out = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', ref], { encoding: 'utf8', timeout: 30_000 });
  if (out.error || out.status !== 0) return { ok: false, detail: String(out.stderr ?? out.error?.message ?? '').trim().split('\n')[0] ?? 'not found' };
  const digest = String(out.stdout).trim();
  return /^sha256:[0-9a-f]{64}$/.test(digest) ? { ok: true, digest } : { ok: false, detail: `docker returned ${JSON.stringify(digest)}, not a sha256 digest` };
}

function defaultBuild({ dir, tag }) {
  const out = spawnSync('docker', ['build', '-t', tag, '-f', join(dir, 'Dockerfile'), dir], { encoding: 'utf8', timeout: 600_000 });
  return { status: out.status ?? 1, stderr: String(out.stderr ?? out.stdout ?? '') };
}

/**
 * The whole operator act. Injected `io` keeps the unit tests daemon-free;
 * the defaults shell out to the operator's docker.
 */
export async function bake({
  base, workspace, tag, packages = [], dryRun = false,
  io = {},
} = {}) {
  const inspect = io.inspect ?? defaultInspect;
  const build = io.build ?? defaultBuild;
  const freeze = io.freeze ?? freezeRequirements;
  const now = io.now ?? (() => new Date());
  const mkctx = io.mkctx ?? ((prefix) => mkdtempSync(join(tmpdir(), prefix)));
  const exists = io.exists ?? existsSync;
  const list = io.list ?? readdirSync;
  const write = io.write ?? writeFileSync;
  const copy = io.copy ?? cpSync;
  const stat = io.stat ?? statSync;

  if (!base) throw new Error(USAGE);
  if (!REF_RE.test(base)) throw new Error(`base ${JSON.stringify(base)} is not a Docker image reference`);
  workspace = resolve(workspace ?? process.cwd());
  const derivedTag = tag ?? `compact-baked:${base.replace(/[^a-zA-Z0-9._-]/g, '-')}-${now().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  if (!REF_RE.test(derivedTag)) throw new Error(`tag ${JSON.stringify(derivedTag)} is not a Docker image reference`);

  // 1. the base must be local — bake never pulls
  const resolved = inspect({ ref: base });
  if (!resolved.ok) {
    throw new Error(`the base image ${base} is not in the local daemon (${resolved.detail}) — bake never pulls; run docker pull ${base} yourself, or pick a local base`);
  }

  // 2. the workspace's toolchain artifacts
  const artifacts = detectArtifacts({ workspace, exists, list });
  const requirements = artifacts.venv ? freeze({ venvDir: artifacts.venv }) : [];
  const packageList = [...packages];
  if (!artifacts.venv && !artifacts.bin && packageList.length === 0) {
    throw new Error(`nothing to promote: no .venv (or venv), no non-empty ./bin/, no --packages under ${workspace} — ` +
      'bake refuses to produce an image identical to its base');
  }

  // 3. the Dockerfile, stamped with the provenance chain. The requirements
  //    themselves ride the build context as compact-requirements.txt (written
  //    below) — the Dockerfile only ever COPYs that file.
  const created = now().toISOString();
  const dockerfile = deriveBakefile({
    base, baseDigest: resolved.digest, workspace, created,
    packages: packageList, includeBin: artifacts.bin != null,
    withVenv: artifacts.venv != null,
  });

  // 4. build with a MINIMAL context — the Dockerfile and bin/ only; the
  //    workspace itself never rides to the daemon
  if (dryRun) return { tag: derivedTag, digest: null, baseDigest: resolved.digest, dockerfile, artifacts, requirements, context: null };
  const ctxDir = mkctx('compact-bake-');
  write(join(ctxDir, 'Dockerfile'), dockerfile);
  if (artifacts.venv) {
    write(join(ctxDir, 'compact-requirements.txt'), requirements.join('\n') + (requirements.length ? '\n' : ''));
  }
  if (artifacts.bin) {
    mkdirSync(join(ctxDir, 'bin'), { recursive: true });
    for (const f of list(artifacts.bin)) {
      if (stat(join(artifacts.bin, f)).isFile()) copy(join(artifacts.bin, f), join(ctxDir, 'bin', f));
    }
  }
  const result = build({ dir: ctxDir, tag: derivedTag });
  if (result.status !== 0) {
    throw new Error(`docker build failed for ${derivedTag} (context kept at ${ctxDir} for inspection):\n` +
      String(result.stderr).trim().split('\n').slice(-6).join('\n'));
  }
  const digest = inspect({ ref: derivedTag });
  if (!digest.ok) throw new Error(`the built image ${derivedTag} could not be re-inspected: ${digest.detail}`);
  return { tag: derivedTag, digest: digest.digest, baseDigest: resolved.digest, dockerfile, artifacts, requirements, context: ctxDir };
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      workspace: { type: 'string' },
      tag: { type: 'string' },
      packages: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) { console.log(USAGE); return; }
  const packageList = String(values.packages ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const out = await bake({
    base: values.base,
    workspace: values.workspace,
    tag: values.tag,
    packages: packageList,
    dryRun: values['dry-run'] === true,
  });
  console.log(`compact:bake — the operator's act: promoting the workspace toolchain into an image.`);
  console.log(`  base:      ${values.base} @ ${out.baseDigest}`);
  const bits = [];
  if (out.artifacts.venv) bits.push(`${out.artifacts.venvName} (${out.requirements.length} requirement${out.requirements.length === 1 ? '' : 's'})`);
  if (out.artifacts.bin) bits.push('./bin/');
  if (packageList.length > 0) bits.push(`packages: ${packageList.join(', ')}`);
  console.log(`  artifacts: ${bits.join(' · ') || '(none)'}`);
  if (out.context) console.log(`  context:   ${out.context} (kept for inspection — the workspace itself never rode to the daemon)`);
  if (out.digest == null) {
    console.log('\n--dry-run: nothing built. The Dockerfile:\n');
    console.log(out.dockerfile);
    return;
  }
  console.log(`  built:     ${out.tag} @ ${out.digest}`);
  console.log(`
# ready to re-declare — copy-paste (derived the way the runtime itself derives digests):
export COMPACT_SANDBOX_IMAGE=${out.tag}
export COMPACT_SANDBOX_IMAGE_DIGEST=${out.digest}

# bake recorded nothing on the governed record — it is an operator act, like the
# original image pull. CF-2 at confine time is the notary: an image that drifts
# off this digest is refused by name (CF-2/digest-drift) until re-declared.
# Restart the composition to pick the new pair up.`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(`compact:bake refused: ${e.message}`);
    process.exit(1);
  });
}
