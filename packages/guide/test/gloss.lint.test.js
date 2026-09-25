// The gloss lint (docs/concept-envelope-rendering.md, "Machine-checks"):
// the gloss table cannot drift from the builders it serves, and it cannot
// cite a clause the register does not know.
//
// What is enforced:
//   1. Coverage, forward — every ruleId literal the envelope builders can
//      emit (scanned from the gate packages' sources, attributed per file by
//      the file's GATE constant or the package's gate) has a gloss.
//   2. Coverage, reverse — every gloss key is either produced by the scan or
//      a declared wildcard; a renamed or deleted rule makes a stale gloss a
//      build failure.
//   3. The dynamic families (AG fingerprint-form asks, CG per-part refusals)
//      are walked at RUN time against their value tables, because literals
//      cannot prove coverage for values composed at run time. A future
//      dynamic emitter must add its walk here — that is the convention.
//   4. Shape — every gloss carries title, why, example (blocked + lawful),
//      instruction, and at least one citation.
//   5. Citations resolve against the enforcement register, so a gloss cannot
//      cite a clause the register does not know (D-8: no rogue prose).
//   6. No unregistered emitters — EVERY package's src is swept: a package
//      that emits `ruleId:` without being registered above fails the lint,
//      so a new gate cannot ship without joining the gloss contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GLOSS, WILDCARD_GLOSS, glossFor } from '../src/gloss.js';
import { fingerprint } from '../../approval/src/fingerprint.js';
import { CAPABILITY_PARTS } from '../../capability-gate/src/parts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// gate → the packages whose sources build its envelopes
const GATE_PACKAGES = {
  AG: ['packages/approval/src', 'packages/allowlist-gate/src'],
  RA: ['packages/remote-access/src'],
  LG: ['packages/loopguard/src'],
  EG: ['packages/egress-proxy/src'],
  MG: ['packages/sandbox-docker/src'],
  SC: ['packages/sandbox-docker/src'],
  CF: ['packages/blessed/src'],
  PG: ['packages/promotion/src'],
  CG: ['packages/capability-gate/src'],
  CS: ['packages/specialists/src'],
  PT: ['packages/petition/src'],
};

// package → default gate for files without their own GATE constant
const PACKAGE_GATE = {
  approval: 'AG', 'allowlist-gate': 'AG', 'remote-access': 'RA', loopguard: 'LG',
  'egress-proxy': 'EG', promotion: 'PG', 'capability-gate': 'CG', petition: 'PT',
  specialists: 'CS', blessed: 'CF', 'sandbox-docker': null, // per-file GATE consts
};

// a rule id is word characters, hyphens and slashes — this filters the other
// string literals that share a `ruleId:` line (phrases, tails, dates)
const RULE_ID_SHAPE = /^[\w/-]+$/;

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p.endsWith('.js')) yield p;
  }
}

function gateOfFile(file, pkg) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/const GATE = '([A-Z]{2})'/);
  if (m) return { gate: m[1], text };
  return { gate: PACKAGE_GATE[pkg] ?? null, text };
}

/** The candidate ruleId values on one line: the quoted literals between the
 *  `ruleId:` marker and the first top-level comma (the value's own span) —
 *  fallback strings in later properties of the same object are not ids. */
function ruleIdValues(line) {
  const at = line.indexOf('ruleId:');
  if (at === -1) return [];
  let depth = 0, inStr = false, esc = false;
  let spanEnd = line.length;
  for (let i = at + 7; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { spanEnd = i; break; }
  }
  const out = [];
  for (const m of line.slice(at + 7, spanEnd).matchAll(/'([^']+)'/g)) {
    if (RULE_ID_SHAPE.test(m[1])) out.push(m[1]);
  }
  return out;
}

/** Collect `gate/ruleId` keys the builders can emit, from the sources —
 *  with, per key, the register plugin name(s) of the package that emits it. */
function scannedRules() {
  const found = new Set();
  const rulePlugins = new Map();
  const orphans = [];
  for (const [gate, dirs] of Object.entries(GATE_PACKAGES)) {
    for (const dir of dirs) {
      const pkg = dir.split('/')[1];
      for (const file of jsFiles(join(ROOT, dir))) {
        const { gate: fileGate, text } = gateOfFile(file, pkg);
        const effective = fileGate ?? gate;
        if (effective !== gate) continue; // file belongs to a sibling gate (MG vs SC)
        const lines = text.split('\n');
        lines.forEach((line) => {
          for (const v of ruleIdValues(line)) {
            const key = `${effective}/${v}`;
            found.add(key);
            for (const p of PACKAGE_REGISTER_PLUGINS[pkg] ?? []) {
              if (!rulePlugins.has(key)) rulePlugins.set(key, new Set());
              rulePlugins.get(key).add(p);
            }
          }
        });
        // the LoopGuard's trip table: trip ids are the builder's ruleIds
        if (dir.includes('loopguard')) {
          for (const m of text.matchAll(/\bid: '(LG-\d+)'/g)) {
            found.add(`LG/${m[1]}`);
            for (const p of PACKAGE_REGISTER_PLUGINS[pkg] ?? []) {
              if (!rulePlugins.has(`LG/${m[1]}`)) rulePlugins.set(`LG/${m[1]}`, new Set());
              rulePlugins.get(`LG/${m[1]}`).add(p);
            }
          }
        }
        // dynamic ruleId sites: the wildcard key is attributed to this file's
        // package (AG/* from approval, CG/* from capability-gate)
        if (/ruleId:\s*(?!')([A-Za-z_$`])/.test(text) && rulePlugins) {
          const wildcard = `${effective}/*`;
          for (const p of PACKAGE_REGISTER_PLUGINS[pkg] ?? []) {
            if (!rulePlugins.has(wildcard)) rulePlugins.set(wildcard, new Set());
            rulePlugins.get(wildcard).add(p);
          }
        }
      }
    }
  }
  // any ruleId literal in a scanned package whose gate could not be
  // attributed is a lint bug, not a coverage gap — surface it loudly
  for (const [gate, dirs] of Object.entries(GATE_PACKAGES)) {
    for (const dir of dirs) {
      const pkg = dir.split('/')[1];
      for (const file of jsFiles(join(ROOT, dir))) {
        const { gate: fileGate, text } = gateOfFile(file, pkg);
        if (fileGate || PACKAGE_GATE[pkg]) continue;
        if (/ruleId:/.test(text)) orphans.push(file);
      }
    }
  }
  return { found, rulePlugins, orphans };
}

test('no package emits envelopes without registering in the gloss contract', () => {
  const registered = new Set(Object.values(GATE_PACKAGES)
    .flat()
    .map(dir => dir.split('/')[1]));
  const offenders = [];
  const packagesDir = join(ROOT, 'packages');
  for (const pkg of readdirSync(packagesDir)) {
    if (registered.has(pkg)) continue;         // scanned and gloss-covered above
    const src = join(packagesDir, pkg, 'src');
    if (!existsSync(src)) continue;            // no source, nothing emits
    for (const file of jsFiles(src)) {
      const text = readFileSync(file, 'utf8');
      // only code emits: comment lines that merely mention `ruleId:` are not
      // emission sites
      const code = text.split('\n')
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      if (/ruleId:/.test(code)) offenders.push(`${file} — register the gate in GATE_PACKAGES`);
    }
  }
  assert.deepEqual(offenders, [], 'unregistered envelope emitters — every ruleId emitter must join the gloss contract');
});

test('gloss covers every rule the envelope builders can emit (forward)', () => {
  const { found, orphans } = scannedRules();
  assert.deepEqual(orphans, [], 'ruleId literals whose gate could not be attributed — fix the scan, not the gloss');
  const missing = [...found].filter(k => !GLOSS[k]);
  assert.deepEqual(missing, [], 'ruleIds emitted by the builders with no gloss — add them to packages/guide/src/gloss.js');
});

test('gloss has no stale entries (reverse)', () => {
  const { found } = scannedRules();
  const stale = Object.keys(GLOSS).filter(k =>
    !found.has(k) && !(k in WILDCARD_GLOSS));
  assert.deepEqual(stale, [], 'gloss keys no builder emits — update or remove them');
});

test('the dynamic families resolve at run time (AG fingerprint-form, CG per-part)', () => {
  // AG: the coverage-miss / dedup / pending asks are keyed by the operation's
  // fingerprint — composed at run time, so no literal can prove them
  const fp = fingerprint('net_probe', { host: 'example.com' });
  assert.match(fp, /^fp_/);
  const ag = glossFor('AG', fp);
  assert.ok(ag, 'AG fingerprint-form asks must resolve through the AG/* wildcard');
  assert.equal(ag.key, 'AG/*');

  // CG: capability-not-adopted refusals are keyed by the part's first clause
  let walked = 0;
  for (const p of CAPABILITY_PARTS) {
    if (p.boundBy != null) continue; // bound parts gate; only unbound ones refuse
    const cg = glossFor('CG', `${p.clauses[0]}/capability-not-adopted`);
    assert.ok(cg, `CG refusal for ${p.part} (${p.clauses[0]}) must resolve through the CG/* wildcard`);
    assert.equal(cg.key, 'CG/*');
    walked++;
  }
  assert.ok(walked >= 1, 'the capability-parts table declares no unbound part — the CG walk is vacuous');
});

test('every gloss carries the shape the projections need', () => {
  for (const [key, g] of Object.entries(GLOSS)) {
    assert.equal(typeof g.title, 'string', `${key}: title`);
    assert.ok(g.title.length > 0 && g.title.length <= 80, `${key}: title length`);
    assert.equal(typeof g.why, 'string', `${key}: why`);
    assert.ok(g.why.length >= 40, `${key}: why should actually explain (${key} why too short)`);
    assert.ok(Array.isArray(g.example?.blocked) && g.example.blocked.length >= 1, `${key}: example.blocked`);
    assert.ok(Array.isArray(g.example?.lawful) && g.example.lawful.length >= 1, `${key}: example.lawful`);
    assert.equal(typeof g.instruction, 'string', `${key}: instruction`);
    assert.ok(g.instruction.length >= 20, `${key}: instruction should be actionable`);
  }
});

test('gloss citations resolve against the enforcement register (D-8)', () => {
  const register = JSON.parse(readFileSync(join(ROOT, 'docs', 'register', 'register.json'), 'utf8'));
  const clauses = new Set(register.entries.map(e => e.clause));
  for (const [key, g] of Object.entries(GLOSS)) {
    assert.ok(Array.isArray(g.cites) && g.cites.length >= 1, `${key}: at least one citation`);
    for (const c of g.cites) {
      assert.ok(clauses.has(c), `${key}: cites "${c}", which the register does not know`);
    }
  }
});

// workspace package → the register plugin name(s) that credit its clauses
// (the register's own attribution — note the two spellings it carries for
// specialists). Anchoring is PER EMITTING FILE: a rule is anchored by the
// plugins of the package that actually emits it, so a gate cannot pass on a
// sibling gate's clauses (AG/AG-1 anchors to the allowlist gate's I-4, not
// to compact-approval's)
const PACKAGE_REGISTER_PLUGINS = {
  approval: ['compact-approval'],
  'allowlist-gate': ['compact-allowlist-gate'],
  'remote-access': ['compact-remote-access'],
  loopguard: ['compact-loopguard'],
  'egress-proxy': ['compact-egress-proxy'],
  promotion: ['compact-promotion'],
  'capability-gate': ['compact-capability-gate'],
  petition: ['compact-petition'],
  specialists: ['compact-specialists', 'compact-dsh-specialists'],
  blessed: ['compact-dsh-blessed'],
  'sandbox-docker': ['compact-sandbox-docker'],
};

test('every gloss anchors to the register: it cites a clause its own emitting package enforces', () => {
  const register = JSON.parse(readFileSync(join(ROOT, 'docs', 'register', 'register.json'), 'utf8'));
  const enforced = new Map();
  for (const e of register.entries) {
    if (e.kind !== 'enforced') continue;
    if (!enforced.has(e.plugin)) enforced.set(e.plugin, new Set());
    enforced.get(e.plugin).add(e.clause);
  }
  // rule → the union of register plugins over the files that emit it
  const { rulePlugins } = scannedRules();
  for (const [key, g] of Object.entries(GLOSS)) {
    const plugins = rulePlugins.get(key);
    assert.ok(plugins && plugins.size >= 1,
      `${key}: no emitting package attributed by the scan — register the emitter or fix the attribution`);
    const clauses = new Set();
    for (const p of plugins) for (const c of enforced.get(p) ?? []) clauses.add(c);
    assert.ok(clauses.size >= 1, `${key}: the register credits no enforced clause to [${[...plugins].join(', ')}]`);
    const anchored = g.cites.filter(c => clauses.has(c));
    assert.ok(
      anchored.length >= 1,
      `${key}: cites [${g.cites.join(', ')}] name none of the clauses its emitting packages enforce ` +
      `(${[...plugins].join(', ')} → ${[...clauses].join(', ')}) — the gloss must anchor to what the register ` +
      `says the emitter enforces, not merely to clauses that exist`);
  }
});
