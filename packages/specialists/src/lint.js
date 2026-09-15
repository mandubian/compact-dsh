// The trim-dedup lint (port plan Phase 5 acceptance) — the #1329–#1331
// doctrine as a machine: canonical sections live in one place; specialists
// dedup rather than restate. Drift is a build failure, not a style note.
//
//   1. descriptor shape — every persona carries name/kind/description/deny/
//      source trace; toolName is unique and legal in the host grammar.
//   2. deny-list hygiene — entries are unique and every entry is a real dsh
//      tool name (pinned vocabulary, so mounting against the standard
//      composition cannot fail on an unknown name).
//   3. the source trace — every autonoetic excluded_tools entry is either
//      mapped into `deny` or documented in `unmappedExclusions` (a category
//      with no dsh analog is a documented fact, never a silent drop).
//   4. dedup — no canonical section's normalized text appears verbatim in
//      any persona's unique prose (restatement drift fails the lint).
//   5. includes/gates resolve; gated sections carry their `when`; io.returns
//      parses as an object schema.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DSH_TOOL_VOCABULARY, PERSONAS_DIR, loadRoster } from './roster.js';

export const TOOL_NAME_GRAMMAR = /^[a-z][a-z0-9_-]*$/;

const norm = (s) =>
  s.toLowerCase().replace(/[`*#>\-—–·]/g, ' ').replace(/\s+/g, ' ').trim();

// Sentence-level normalization: restatement drift copies sentences, not
// whole files. Compare normalized sentences of 8+ words. Markdown headings
// are structure, not prose — dropped before comparison.
export function sentences(text) {
  return text
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
    .toLowerCase()
    .replace(/[`*>\-—–·]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.split(' ').length >= 8);
}

export function lintRoster(dir = PERSONAS_DIR) {
  const failures = [];
  const fail = (msg) => failures.push(msg);

  const sharedDir = join(dir, 'shared');
  const shared = existsSync(sharedDir) ? readdirSync(sharedDir).filter(f => f.endsWith('.md')) : [];
  const canonical = new Map(shared.map(f => [f.replace(/\.md$/, ''), readFileSync(join(sharedDir, f), 'utf8')]));

  let roster;
  try {
    roster = loadRoster(dir);
  } catch (e) {
    return [`roster does not load: ${e.message}`];
  }

  const seenToolNames = new Map();
  for (const { descriptor, body, includes, gated } of roster.personas) {
    const id = descriptor.name ?? '?';
    const label = `persona ${id}`;

    if (!descriptor.name || !TOOL_NAME_GRAMMAR.test(descriptor.name)) {
      fail(`${label}: name missing or illegal (host grammar ${TOOL_NAME_GRAMMAR})`);
    }
    if (!descriptor.description) fail(`${label}: description missing`);
    if (!['specialist', 'lead'].includes(descriptor.kind)) fail(`${label}: kind must be specialist|lead`);
    if (descriptor.spawns === true && descriptor.maxDepth === 0) {
      fail(`${label}: spawns=true contradicts maxDepth 0`);
    }
    if (descriptor.spawns === false) {
      const spawnTools = ['subagent', 'subagent_fork'];
      const leaks = spawnTools.filter(t => !(descriptor.deny ?? []).includes(t));
      if (leaks.length > 0) fail(`${label}: a non-spawning persona must deny the spawn tools (${leaks.join(', ')})`);
    }
    if (!descriptor.toolName || !TOOL_NAME_GRAMMAR.test(descriptor.toolName)) {
      fail(`${label}: toolName missing or illegal`);
    } else if (seenToolNames.has(descriptor.toolName)) {
      fail(`${label}: toolName ${descriptor.toolName} also used by ${seenToolNames.get(descriptor.toolName)}`);
    } else {
      seenToolNames.set(descriptor.toolName, id);
    }

    // 2. deny-list hygiene
    const deny = descriptor.deny ?? [];
    if (new Set(deny).size !== deny.length) fail(`${label}: duplicate deny entries`);
    for (const t of deny) {
      if (!DSH_TOOL_VOCABULARY.includes(t)) {
        fail(`${label}: deny names '${t}', which is not in the pinned dsh tool vocabulary — a typo or a tool this composition does not ship (unknown names fail the mount loudly)`);
      }
    }

    // 3. the source trace — nothing excluded at home vanishes undocumented
    const mapped = new Set(deny);
    for (const src of descriptor.sourceExcludedTools ?? []) {
      const stem = src.replace(/\*+$/, '').replace(/_+$/, '');
      const covered = [...mapped].some(d => d === src || d.startsWith(stem));
      const documented = Object.keys(descriptor.unmappedExclusions ?? {}).some(k => k === src || (k.endsWith('*') && src.startsWith(k.replace(/\*+$/, ''))));
      if (!covered && !documented) {
        fail(`${label}: source exclusion '${src}' is neither mapped into deny nor documented in unmappedExclusions — exclusions never silently drop`);
      }
    }

    // 4. dedup — the persona's unique prose must not restate canonical text,
    // whether or not it also includes the section (restating + including
    // would deliver the doctrine twice)
    const bodySents = new Set(sentences(body));
    for (const [section, text] of canonical) {
      for (const s of sentences(text)) {
        if (bodySents.has(s)) {
          fail(`${label}: prose restates canonical section '${section}' verbatim ("${s.slice(0, 80)}…") — reference it in includes instead (the trimming doctrine)`);
        }
      }
    }

    // 5. includes/gates/io resolve
    for (const inc of includes) {
      if (!canonical.has(inc.section)) fail(`${label}: includes unknown canonical section '${inc.section}'`);
    }
    for (const g of gated) {
      if (!g.when) fail(`${label}: gated section '${g.heading ?? g.file}' carries no when-condition`);
      if (!existsSync(join(dir, g.file))) fail(`${label}: gated file ${g.file} missing`);
    }
    if (descriptor.io?.returns !== undefined) {
      const r = descriptor.io.returns;
      if (r?.type !== 'object' || !Array.isArray(r.required)) {
        fail(`${label}: io.returns must be an object schema with a required array`);
      }
    }
  }

  return failures;
}

export function assertLintClean(dir = PERSONAS_DIR) {
  const failures = lintRoster(dir);
  if (failures.length > 0) {
    throw new Error(`specialists trim-dedup lint failed:\n  - ${failures.join('\n  - ')}`);
  }
  return true;
}
