// The web surface of the blessed composition (`npm run compact -- --web`):
// the launcher rows that turn dsh's browser profile into a governed pilot,
// plus the compact-pilot agent preset those rows select.
//
// Two facts shape this module.
//
// 1. A-4/DYN. The web bundle mounts `cordis-host-runner` — the dynamic-plugin
//    runner the capability gate declares ABSENT and refuses at boot
//    (dynamicCordisRunner is a Part VI trigger). The lawful posture is
//    absence: the launcher disables the row, so the interactive surface
//    simply does not carry the self-modification capability, the boot-time
//    gate sees the service gone, and a late mount still latches a breach.
//    The rows live here rather than in the shared blessed overlay because
//    the overlay also composes headless, where the row does not exist — a
//    disable for a missing row warns in composeEntries and the headless
//    loader test asserts zero warnings.
//
// 2. The preset plane. The web surface moves the agent plane behind agent
//    presets, and the shipped `standard` preset re-mounts per session exactly
//    what the pilot refuses: host-side file tools, the fork delegation
//    backend, workflow rows, and the web fetch/search tool. A roster that
//    re-arms refused tools per session would claim a floor the composition
//    does not enforce (D-8), so --web replaces the roster wholesale: the
//    compact-pilot preset (compact-pilot/ beside this file) becomes the only
//    preset — scanned read-only as a `system` root straight from the
//    checkout, whose node_modules is the resolution anchor a state-directory
//    preset would lack — and the shipped and user roots are dropped. The
//    gates themselves ride the host tool waterfall and are preset-
//    independent; the preset keeps the model-facing catalog honest.

import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, readlink, realpath, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** The agent preset id --web selects; the scanned directory name matches. */
export const PRESET_ID = 'compact-pilot';

/** The directory scanned as the preset's sole `system` root (its children are preset dirs). */
export const presetRoot = () => fileURLToPath(new URL('../presets/', import.meta.url));

/**
 * Launcher patch rows for the web surface, applied after the blessed overlay.
 * Order matters: the disable rows must follow the dsh-web-app bundle that
 * inserts the rows they disable.
 */
export function webRows() {
  return [
    // A-4/DYN stays ABSENT on the interactive surface: no dynamicCordisRunner
    // service, so the Part VI trigger is not present and the gate boots clean.
    { id: 'cordis-host-runner', disabled: true },
    // Host-side PTC code execution — the same arbitrary-code surface the
    // headless rows disable; the pilot's code surface is confined bash only.
    { id: 'code-runtime', disabled: true },
    // The auto directory-picker mounts its dual-face backend by creating
    // loader entries at runtime, resolved against the composition root — and
    // the pilot's generated config lives in the operator-owned state
    // directory with no install anchor beside it. The pilot workspace is
    // fixed by the launcher anyway; the browser renders no picker button.
    { id: 'directory-picker', disabled: true },
    // Whole-roster replacement (patch semantics: a row config override
    // replaces the whole config, so every key the row owns is restated):
    // exactly one preset, read-only, from this checkout.
    {
      id: 'agent-presets',
      config: {
        default: PRESET_ID,
        roots: [{ path: presetRoot(), trust: 'system' }],
        includeShippedRoot: false,
        includeUserRoot: false,
      },
    },
  ];
}

/** Absolute path of the preset's composition file, for diagnostics. */
export const presetCompositionPath = () => join(presetRoot(), PRESET_ID, 'agent.cordis.yml');

/** The dsh workspace registry lives here (UI state, not evidence). */
export const workspaceRegistryPath = (stateDir) => join(stateDir, 'storages', 'workspace.json');

/**
 * Aside retention (#22): at most this many `.aside-<timestamp>` siblings of
 * the registry survive per boot family — the newest ones. The pruning is
 * never silent: every pruned file is returned to the caller, whose boot log
 * names them. An aside is the previous corrupt registry, operator state by
 * definition; the retention bounds its accumulation without ever deleting
 * quietly.
 */
export const ASIDE_RETENTION = 3;

function nextAsidePath(path) {
  const stamp = Date.now();
  let aside = `${path}.aside-${stamp}`;
  for (let i = 0; existsSync(aside); i++) aside = `${path}.aside-${stamp}-${i + 1}`;
  return aside;
}

/** Prune the oldest asides past the retention; returns the pruned absolute paths. */
export function pruneAsides(path, keep = ASIDE_RETENTION) {
  const prefix = `${basename(path)}.aside-`;
  const dir = dirname(path);
  const asides = readdirSync(dir)
    .filter(f => f.startsWith(prefix))
    .map(f => {
      const full = join(dir, f);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const pruned = [];
  for (const { full } of asides.slice(keep)) {
    unlinkSync(full);
    pruned.push(full);
  }
  return pruned;
}

/**
 * Align the dsh workspace registry with this boot's exposure.
 *
 * The registry persists across boots (storages/workspace.json), and the
 * browser attaches new sessions to a registered workspace in preference to
 * the session controller's default cwd. The pilot's contract is one boot,
 * one exposed workspace: a registry entry naming a directory THIS boot never
 * exposed would attach browser sessions to it — the UI would browse files
 * the confined bash cannot touch, and bash would write files the UI cannot
 * see.
 *
 * The registry carries an `initialized` marker: once true, dsh-workspace
 * NEVER re-derives records from session headers; before, it bootstraps the
 * table from every session's `header.cwd`. So deletion is the one move that
 * cannot work (a fresh registry re-derives the old directories from session
 * history). Instead this edits the registry in place, preserving the marker:
 * records naming other directories are removed, a record for the boot
 * workspace is added when none exists, and everything else (order, archive
 * set, matching records) is preserved untouched. Only a CORRUPT registry is
 * moved aside (timestamped; a bounded family — at most ASIDE_RETENTION most
 * recent survive, older ones pruned BY NAME IN THE BOOT LOG, never silently)
 * — and the boot log then says that the first session bootstrap may
 * re-register old directories, which the UI workspace settings can remove.
 *
 * @returns {{aside: string|null, foreign: string[], realigned: boolean, pruned: string[]}}
 */
export function alignWorkspaceRegistry(stateDir, workspace) {
  const path = workspaceRegistryPath(stateDir);
  if (!existsSync(path)) return { aside: null, foreign: [], realigned: false, pruned: [] };
  let registry;
  try {
    registry = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    const aside = nextAsidePath(path);
    renameSync(path, aside);
    const pruned = pruneAsides(path);
    return { aside, foreign: ['(unreadable — the first boot may re-register directories from session history; remove them in the UI workspace settings)'], realigned: false, pruned };
  }
  const workspaces = registry?.tables?.workspaces;
  if (registry?.global?.initialized !== true || typeof workspaces !== 'object' || workspaces === null) {
    // a fresh, uninitialized registry bootstraps from session headers by
    // design; there is nothing to align without forging dsh state
    return { aside: null, foreign: [], realigned: false, pruned: [] };
  }
  const ids = Array.isArray(registry.global.workspaceIds) ? registry.global.workspaceIds : [];
  const foreign = ids.map(id => workspaces[id]).filter(w => w?.path !== workspace).map(w => w?.path ?? '(no path)');
  const keptIds = ids.filter(id => workspaces[id]?.path === workspace);
  if (foreign.length === 0 && keptIds.length > 0) return { aside: null, foreign: [], realigned: false, pruned: [] };
  for (const id of ids) {
    if (workspaces[id]?.path !== workspace) delete workspaces[id];
  }
  if (keptIds.length === 0) {
    const id = randomUUID();
    workspaces[id] = {
      path: workspace,
      title: basename(workspace) || workspace,
      sessionIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    keptIds.push(id);
  }
  registry.global.workspaceIds = keptIds;
  writeFileSync(path, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 });
  return { aside: null, foreign, realigned: true, pruned: [] };
}

/** The checkout's dependency root — the install anchor the launcher points at. */
export const installAnchor = () => fileURLToPath(new URL('../../../node_modules/', import.meta.url));

/**
 * The loader resolves every entry name against the composition root (the
 * config file's directory), and the preset health check resolves package
 * names against the same base — for dsh's own profiles that base is
 * `$DSH_HOME/profiles/<name>` with a `node_modules` beside it (two-anchor
 * resolution). The pilot's generated config lives directly in the state
 * directory, so the launcher supplies the anchor the way dsh does: a
 * node_modules symlink beside it, pointing at the checkout's dependency
 * root. Existing state is never clobbered — a correct symlink is reused;
 * anything else in the way is refused loudly.
 */
export async function ensureInstallAnchor(stateDir) {
  const link = join(stateDir, 'node_modules');
  const target = installAnchor();
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  let existing;
  try {
    existing = await lstat(link);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // junction on Windows: a directory link that needs no elevation; the type
    // argument is ignored everywhere else
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return link;
  }
  if (!existing.isSymbolicLink()) {
    throw new Error(`refusing to replace ${link}: the pilot's install anchor must be a symlink to the checkout's node_modules; move it aside explicitly before retrying`);
  }
  const same = await Promise.all([realpath(link), realpath(target)])
    .then(([linked, checkout]) => linked === checkout)
    .catch(() => false);
  if (!same) {
    const current = await readlink(link).catch(() => '(unreadable)');
    throw new Error(`install anchor ${link} points at ${current}, not the checkout's node_modules — refusing a composition whose install anchor silently moved`);
  }
  return link;
}
