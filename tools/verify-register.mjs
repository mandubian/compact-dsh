#!/usr/bin/env node
// verify-register — the Phase 4 CI gate (port plan Phase 4 item 3, F-5/A-4).
//
// Fails when:
//   1. the bundled register (packages/constitution/register.json) diverges
//      from the canonical one (docs/register/register.json);
//   2. a register entry cites a clause that is not a clause of the adopted
//      Compact body (the clause list derives from the body's own headers);
//   3. an enforced entry's cited source or verifier file does not exist
//      (a renamed test file breaks the gate — that is the point);
//   4. an enforced entry has no verifier at all (a verifier that cannot
//      fail proves nothing — F-5);
//   5. a clause of the body is neither registered nor declared unadopted
//      (a [M] clause with no entry is an uncovered law — decorative law);
//   6. an unadopted-optional declaration names a clause that is not [O].
//
// Usage: node tools/verify-register.mjs [--register <path>]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUSES, clauseOf, clauseIds, verifyBody, COMPACT_DIGEST } from '../packages/constitution/src/body.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const argRegister = process.argv.find((a, i) => process.argv[i - 1] === '--register');
const registerPath = argRegister ?? new URL('../docs/register/register.json', import.meta.url);

const failures = [];
const fail = (msg) => failures.push(msg);

// 0. the bundled body is intact — verified against the LITERAL pin in body.js,
// not against itself (a digest derived from the file it pins verifies nothing)
try {
  verifyBody(readFileSync(new URL('../packages/constitution/compact/compact.md', import.meta.url), 'utf8'));
} catch (e) {
  fail(e.message);
}

// 1. the two copies are identical
const canonical = readFileSync(registerPath, 'utf8');
const canonicalOrigin = argRegister ? argRegister : 'docs/register/register.json';
let bundled;
try {
  bundled = readFileSync(new URL('../packages/constitution/register.json', import.meta.url), 'utf8');
} catch {
  fail('packages/constitution/register.json is missing — the constitution boot cannot materialize the registry');
}
if (bundled !== undefined && !argRegister && bundled !== canonical) {
  fail('the bundled register (packages/constitution/register.json) diverges from the canonical register (docs/register/register.json) — edit the canonical copy and re-copy');
}

let register;
try {
  register = JSON.parse(canonical);
} catch (e) {
  fail(`docs/register/register.json does not parse: ${e.message}`);
}

// 1b. the register's declared pin is the body's digest — two pins that can
// drift apart are one pin fewer than they look (A-4)
if (register && register.meta?.compactDigest !== COMPACT_DIGEST) {
  fail(
    `the register declares Compact digest ${register.meta?.compactDigest ?? '(none)'} but the adopted body is ` +
    `${COMPACT_DIGEST} — the register maps clauses of a different law; re-pin both together or revert the body`);
}

const byClause = new Map();
if (register) {
  const ids = clauseIds();
  for (const e of register.entries ?? []) {
    byClause.set(e.clause, (byClause.get(e.clause) ?? 0) + 1);
    if (!ids.has(e.clause)) {
      fail(`entry cites clause ${e.clause}, which is not a clause of the adopted Compact (rogue enforcement, D-8)`);
      continue;
    }
    for (const kind of ['enforcedBy', 'verifiers']) {
      for (const p of e[kind] ?? []) {
        if (!existsSync(resolve(root, p))) fail(`${e.clause} (${e.plugin}): ${kind} path does not exist: ${p} — update the register with the code (A-4)`);
      }
    }
    if (e.kind === 'enforced') {
      if (!e.plugin) fail(`${e.clause}: an enforced entry must name its enforcing plugin`);
      if ((e.verifiers ?? []).length === 0) fail(`${e.clause} (${e.plugin}): an enforced entry without a verifier proves nothing (F-5)`);
      if (!e.service && e.plugin !== 'compact-constitution' && e.plugin !== 'auditor') {
        fail(`${e.clause} (${e.plugin}): an enforced entry must name the service whose presence the boot couples on`);
      }
    } else if (e.kind === 'rehearsal') {
      // binding machinery exercised under the declared development keyring:
      // refuses the act on verification failure, conveys no standing,
      // discharges no clause — and like an enforced entry, a rehearsal that
      // cannot fail proves nothing (F-5)
      if (!e.plugin) fail(`${e.clause}: a rehearsal entry must name the plugin that rehearses the machinery`);
      if ((e.verifiers ?? []).length === 0) fail(`${e.clause} (${e.plugin}): a rehearsal entry without a verifier proves nothing (F-5)`);
    } else if (!['planned', 'convention'].includes(e.kind)) {
      fail(`${e.clause}: unknown kind ${e.kind}`);
    }
  }
  // 5. coverage: every clause of the body is registered or declared unadopted
  const unadopted = new Set((register.meta?.unadoptedOptional ?? []).map(u => u.clause));
  for (const u of register.meta?.unadoptedOptional ?? []) {
    const c = clauseOf(u.clause);
    if (!c) fail(`unadopted declaration names unknown clause ${u.clause}`);
    else if (!c.force.startsWith('O')) fail(`${u.clause} is force [${c.force}] — only [O] clauses may be declared unadopted`);
  }
  for (const c of CLAUSES) {
    if (!byClause.has(c.id) && !unadopted.has(c.id)) {
      fail(`clause ${c.id} (${c.force}) has no register entry — an uncovered law is decorative law (F-5)`);
    }
  }
}

if (failures.length > 0) {
  console.error(`verify-register: ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
const enforced = (register?.entries ?? []).filter(e => e.kind === 'enforced').length;
console.log(`verify-register OK: ${register.entries.length} entries over ${CLAUSES.length} clauses (${enforced} enforced, unadopted [O]: ${register.meta.unadoptedOptional.map(u => u.clause).join(', ') || 'none'})`);
