#!/usr/bin/env node
// The distributable composition (#140): the whole plugin tree packed as ONE
// installable dsh bundle, so a plain `dsh` profile — or the web UI's plugin
// manager, which runs the same pnpm add under the hood — can load The Compact
// dynamically. Plain dsh has no workspace: its loader resolves profile bundles
// and row `name:` fields under pnpm's strict layout, where the workspace's
// hoisted root node_modules no longer hides anything. So the packer:
//
//   1. computes the dependency closure over the workspace manifests. Every
//      package on disk must be reachable from the composition roots — an
//      unreachable package is an unwired composition, not an optimization,
//      and the artifact carries the whole law or refuses to pack.
//   2. vendors each package VERBATIM as bundleDependencies — the tarball
//      carries them in its own node_modules/, the layout npm and pnpm both
//      treat as "already installed, resolve here, touch no registry". A
//      `file:` dependency is NOT an alternative: pnpm resolves file: specs
//      of an installed tarball against the installing project's directory,
//      not the package's own (ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND — caught by
//      the live test, not by inspection). Their `dependencies` are stripped
//      and the external union hoisted onto the bundle root, so every bare
//      `compact-*` import resolves by ordinary upward lookup through the
//      bundle package's own node_modules.
//   3. copies the two bundle patch layers byte-for-byte and rewrites
//      exactly the three row `name:` fields that resolve modules: rows
//      resolve against the profile's own baseUrl (the profile directory),
//      where only the bundle package itself is a dependency — so the rows
//      must name the bundle and its exports, not vendored siblings.
//   4. `npm pack`s the staged tree. No code is transformed or bundled —
//      the artifact is the workspace, relocated; diff staged/vendor against
//      packages/* and expect only the manifest edits described above.
//
// The launcher and workspace are untouched: the pilot keeps booting the
// workspace packages. The launcher's state scaffolding (COMPACT_* env) stays
// fail-closed in the artifact — a plain-profile boot without it refuses at
// the record provider; operator-facing defaults are #141's concern, not a
// silent fallback smuggled in here.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = 'dist:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');
const COMPOSITION_ROOTS = ['compact-dsh-blessed', 'compact-dsh-card'];
const DIST_NAME = 'compact-dsh';

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

/** name -> { dir, manifest } for every workspace package. */
export function workspacePackages(packagesDir = PACKAGES) {
  const map = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    if (!existsSync(join(dir, 'package.json'))) continue;
    const manifest = readManifest(dir);
    if (map.has(manifest.name)) throw new Error(`${BIN} duplicate workspace package name ${manifest.name}`);
    map.set(manifest.name, { dir, manifest });
  }
  return map;
}

/**
 * The transitive closure over `compact-*` dependencies, from the composition
 * roots. Compact deps are exact-version workspace names (`compact-dsh-*` and
 * `compact-envelope`); everything else is external and rides the registry.
 */
export function dependencyClosure(workspaces, roots = COMPOSITION_ROOTS) {
  const closure = new Map();
  const walk = (name) => {
    if (closure.has(name)) return;
    const pkg = workspaces.get(name);
    if (pkg === undefined) throw new Error(`${BIN} closure names ${name}, which is not a workspace package`);
    closure.set(name, pkg);
    for (const dep of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (dep.startsWith('compact-')) walk(dep);
    }
  };
  for (const root of roots) walk(root);
  const unreachable = [...workspaces.keys()].filter((name) => !closure.has(name));
  if (unreachable.length > 0) {
    throw new Error(`${BIN} workspace package(s) unreachable from the composition roots (${roots.join(', ')}): ` +
      `${unreachable.join(', ')} — wire them in or the artifact would ship a partial law`);
  }
  return closure;
}

/** The external (registry) dependencies the closure declares, unioned. */
export function externalDependencies(closure) {
  const union = new Map();
  for (const { manifest } of closure.values()) {
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith('compact-')) continue;
      if (union.has(name) && union.get(name) !== spec) {
        throw new Error(`${BIN} conflicting external dependency specs for ${name}: ${union.get(name)} vs ${spec}`);
      }
      union.set(name, spec);
    }
  }
  return union;
}

/** The dsh peer range every closure package declares — one version line, or no artifact. */
export function peerRange(closure) {
  let range;
  for (const { manifest, dir } of closure.values()) {
    const declared = manifest.peerDependencies?.['@deepseek-ai/dsh'];
    if (declared === undefined) continue;
    if (range !== undefined && range !== declared) {
      throw new Error(`${BIN} conflicting dsh peer ranges: ${range} (${basename(ROOT)}) vs ${declared} (${basename(dir)})`);
    }
    range = declared;
  }
  if (range === undefined) throw new Error(`${BIN} no package declares an @deepseek-ai/dsh peer range`);
  return range;
}

/** Vendored manifests keep identity and shape; the bundle root owns deps. */
export function vendoredManifest(manifest) {
  const out = {};
  for (const key of ['name', 'version', 'type', 'description', 'main', 'exports', 'peerDependencies', 'engines', 'dsh']) {
    if (manifest[key] !== undefined) out[key] = manifest[key];
  }
  return out;
}

/** The bundle root's manifest: the workspace, relocated under one name. */
export function rootManifest({ closure, externals, peer, version, description }) {
  const dependencies = {};
  for (const name of [...closure.keys()].sort()) dependencies[name] = closure.get(name).manifest.version;
  for (const [name, spec] of [...externals.entries()].sort()) dependencies[name] = spec;
  return {
    name: DIST_NAME,
    version,
    description,
    type: 'module',
    license: 'MIT',
    main: './index.js',
    exports: {
      '.': './index.js',
      './provider': './provider.js',
      './card': './card.js',
      './web': './web.js',
      './client': './client.js',
      './package.json': './package.json',
    },
    // the sibling specs are documentation and `npm ls` sanity — the installs
    // themselves ride bundleDependencies below, never the registry
    dependencies,
    bundleDependencies: [...closure.keys()].sort(),
    peerDependencies: { '@deepseek-ai/dsh': peer },
    engines: { node: '>=22.19' },
    dsh: {
      bundle: {
        patch: [
          './patches/blessed.patch.yml',
          './patches/card.patch.yml',
          // the plain-profile posture layer (#141) and the pilot preset it
          // selects: the refusals and state defaults a profile boot needs
          // because it has no launcher (see tools/dist.posture.patch.yml)
          './patches/posture.patch.yml',
          './patches/compact-pilot.patch.yml',
        ],
      },
      client: closure.get('compact-dsh-card').manifest.dsh.client,
    },
  };
}

/**
 * Node forbids exports targets that traverse a node_modules segment, so the
 * bundle root re-exports the row-resolved vendored modules from the package
 * top. Modules with a default export need both forms; web.js is named-only.
 */
export function rootShims() {
  return [
    { file: 'index.js', module: './node_modules/compact-dsh-blessed/src/index.js', hasDefault: true },
    { file: 'provider.js', module: './node_modules/compact-dsh-record/src/provider.js', hasDefault: true },
    { file: 'card.js', module: './node_modules/compact-dsh-card/src/index.js', hasDefault: true },
    { file: 'web.js', module: './node_modules/compact-dsh-blessed/src/web.js', hasDefault: false },
  ].map(({ file, module, hasDefault }) => ({
    file,
    text: [
      `// generated by tools/dist.mjs — re-export the vendored module; exports targets`,
      `// may not traverse a node_modules segment, so the bundle root re-exports.`,
      ...(hasDefault ? [`export { default } from ${JSON.stringify(module)};`] : []),
      `export * from ${JSON.stringify(module)};`,
      '',
    ].join('\n'),
  }));
}

/**
 * Rewrite the module-resolving rows of a copied patch layer. Counts are
 * asserted, not assumed: a patch that grows a new `name:` row must be
 * handled here or the pack refuses — a silently unrewritten row would boot
 * in the pilot and fail to resolve on a plain profile.
 */
export function rewritePatch(source, replacements) {
  let text = readFileSync(source, 'utf8');
  for (const [from, to] of replacements) {
    const parts = text.split(from);
    if (parts.length !== 2) throw new Error(`${BIN} expected exactly one occurrence of ${JSON.stringify(from)} in ${source}, found ${parts.length - 1}`);
    text = parts.join(to);
  }
  return text;
}

export function packComposition({ outDir = join(ROOT, 'dist'), packagesDir = PACKAGES } = {}) {
  const workspaces = workspacePackages(packagesDir);
  const closure = dependencyClosure(workspaces);
  const externals = externalDependencies(closure);
  const peer = peerRange(closure);
  const blessed = closure.get('compact-dsh-blessed');
  const card = closure.get('compact-dsh-card');
  if (card.manifest.dsh?.client === undefined) throw new Error(`${BIN} compact-dsh-card declares no dsh.client manifest`);

  // npm pack would try to resolve the dependency specs (unpublished names);
  // the tarball is built by hand instead: everything staged under package/
  // goes in verbatim, siblings at package/node_modules/ where bundling puts
  // them. Deterministic bytes, no registry contact.
  const staged = join(outDir, 'package');
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(join(staged, 'patches'), { recursive: true });

  for (const [name, pkg] of closure) {
    const target = join(staged, 'node_modules', name);
    cpSync(pkg.dir, target, {
      recursive: true,
      filter: (src) => !src.includes(`${name}/node_modules`) && basename(src) !== 'node_modules',
    });
    writeFileSync(join(target, 'package.json'), JSON.stringify(vendoredManifest(pkg.manifest), null, 2) + '\n');
  }

  writeFileSync(join(staged, 'patches', 'blessed.patch.yml'), rewritePatch(join(blessed.dir, 'cordis.patch.yml'), [
    ['name: compact-dsh-blessed', `name: ${DIST_NAME}`],
    ['name: compact-dsh-record/provider', `name: ${DIST_NAME}/provider`],
  ]));
  writeFileSync(join(staged, 'patches', 'card.patch.yml'), rewritePatch(join(card.dir, 'cordis.patch.yml'), [
    ['name: compact-dsh-card', `name: ${DIST_NAME}/card`],
  ]));
  copyFileSync(join(ROOT, 'tools', 'dist.posture.patch.yml'), join(staged, 'patches', 'posture.patch.yml'));
  copyFileSync(join(blessed.dir, 'presets', 'compact-pilot.patch.yml'), join(staged, 'patches', 'compact-pilot.patch.yml'));

  writeFileSync(join(staged, 'package.json'), JSON.stringify(rootManifest({
    closure, externals, peer,
    version: blessed.manifest.version,
    description: blessed.manifest.description,
  }), null, 2) + '\n');
  for (const { file, text } of rootShims()) writeFileSync(join(staged, file), text);
  // the client half is served by file path from the bundle root (the same
  // mechanism card's lib/client.js rides) — a pack-time copy, never a shim,
  // so the browser receives the real bundle bytes
  copyFileSync(join(card.dir, 'lib', 'client.js'), join(staged, 'client.js'));
  copyFileSync(join(ROOT, 'LICENSE'), join(staged, 'LICENSE'));

  const tarball = join(outDir, `${DIST_NAME}-${blessed.manifest.version}.tgz`);
  rmSync(tarball, { force: true });
  const tar = spawnSync('tar', ['-czf', tarball, '-C', outDir, 'package'], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`${BIN} tar failed: ${tar.stderr}`);
  return { staged, tarball, closure: [...closure.keys()].sort(), externals: [...externals.keys()].sort(), peer };
}

export function main(argv = process.argv.slice(2)) {
  const outDir = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]) : join(ROOT, 'dist');
  mkdirSync(outDir, { recursive: true });
  const result = packComposition({ outDir });
  console.error(`${BIN} vendored ${result.closure.length} packages (externals: ${result.externals.join(', ') || 'none'}; peer @deepseek-ai/dsh ${result.peer})`);
  console.error(`${BIN} staged ${result.staged}`);
  console.log(result.tarball);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
