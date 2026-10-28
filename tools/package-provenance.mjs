// Where the workspace packages actually load from — the half of code
// provenance that `git status` cannot see.
//
// The live finding (the weight-of-voice-v2 re-run, 0e3fa8): the run
// checkout was clean at 90bccdc and its manifest said so — but its
// node_modules was a link to another checkout's, so every compact-dsh-*
// package the runtime loads BY NAME resolved there, at a commit that
// predated the LoopGuard fix the run existed to test. The manifest named
// code that did not enforce the run. A commit names a tree; it names the
// code that ran only when the packages resolve inside that tree.
//
// This module answers one question with the runtime's own resolution: for
// each package under packages/*, does its bare name resolve inside this
// checkout? Those that do not are FOREIGN, and the launcher records them in
// the manifest beside the commit rather than letting the commit stand for
// them. A record, not a refusal — the same posture as a dirty tree.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The workspace packages this checkout ships: { name, dir } per packages/*. */
export function workspacePackages(root) {
  const base = join(root, 'packages');
  if (!existsSync(base)) return [];
  const out = [];
  for (const entry of readdirSync(base).sort()) {
    const manifest = join(base, entry, 'package.json');
    if (!existsSync(manifest)) continue;
    let name = null;
    try { name = JSON.parse(readFileSync(manifest, 'utf8')).name ?? null; } catch { continue; }
    if (name) out.push({ name, dir: join(base, entry) });
  }
  return out;
}

const real = (p) => { try { return realpathSync(p); } catch { return p; } };

/** Workspace packages whose bare name resolves OUTSIDE their own directory
 *  in this checkout: [{ name, path }]. `resolve(name)` defaults to this
 *  module's own resolution, which walks the same node_modules the launcher
 *  beside it does. A package that does not resolve by name is skipped —
 *  nothing can load it by name either. */
export function foreignPackages(root, resolve = (name) => import.meta.resolve(name)) {
  const foreign = [];
  for (const { name, dir } of workspacePackages(root)) {
    let target;
    try { target = resolve(name); } catch { continue; }
    if (!target) continue;
    const path = real(String(target).startsWith('file:') ? fileURLToPath(target) : String(target));
    const home = real(dir);
    if (path !== home && !path.startsWith(home + sep)) foreign.push({ name, path });
  }
  return foreign;
}
