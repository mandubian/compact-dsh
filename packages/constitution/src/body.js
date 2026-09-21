// The adopted Compact body, mechanically: loaded, VERIFIED AGAINST A PINNED
// DIGEST, and parsed — the clause list derives from the law itself, so the
// registry can never drift from it (F-7: nothing is law that does not trace
// to the body; the register traces to the body's own clause headers).
//
// WHY THE DIGEST IS A LITERAL. It was previously computed from the bundled
// file (`sha256(COMPACT_BODY)`), which made every check a tautology: each call
// site compared sha256(file) against sha256(the same file), so a body swapped
// on disk verified perfectly against itself and the law changed silently. A
// pin that is derived from the thing it pins is not a pin. The constant below
// is the independent commitment, and the bundled text must match it.
//
// Changing it is a deliberate, reviewed act: a new body means a new law, and
// the composition refuses to start until someone re-pins here and in the
// register's `meta.compactDigest` (which `verify-register` cross-checks). That
// refusal IS the re-blessing event — the alternative is silent drift.
//
// This also has to hold before signatures can mean anything (I-1): a signature
// is over a digest, and a signature check built on a self-derived digest would
// verify the signature of whatever file it was handed.
//
// Honesty (recorded in the attestation's gaps, never silent): the bundled
// text is Compact draft v0.5 — NOT YET RATIFIED — and the Compact has
// published no amendment keys. The digest is PINNED, not signed; signature
// verification (I-1) lands when keys exist, and until then this
// composition claims no Compact standing (F-5).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const COMPACT_SOURCE_URL = 'https://github.com/mandubian/compact/blob/main/compact.md';
export const COMPACT_SOURCE_REVISION = 'main @ 79e746e (2026-09-17, amendment 0002 merged) — sha256 pinned below';

/**
 * The pinned digest of the adopted body. A LITERAL, never derived — see above.
 * Compact draft v0.5, adopted 2026-09; re-pinned 2026-09-17 for amendment 0002
 * (value-scoped refusal — R-9 gains the conscience limb). The re-pin IS the
 * re-blessing: the previous literal was 8564175463bd…, and the composition
 * refused every boot between the body landing and this line changing.
 */
export const COMPACT_DIGEST = '27bb7078fe9aea5067a8e95b174f54bd8ae77c78fce7b1b06dd760690caf2c95';

export const COMPACT_BODY = readFileSync(new URL('../compact/compact.md', import.meta.url), 'utf8');

/** The boot-verification predicate, exported pure for the tests. */
export function verifyBody(text, expectedDigest = COMPACT_DIGEST) {
  const actual = createHash('sha256').update(text).digest('hex');
  if (actual !== expectedDigest) {
    throw new Error(
      `constitution: the Compact body does not match its pinned digest — ` +
      `expected ${expectedDigest}, got ${actual}. The law was tampered with or ` +
      `swapped; refusing to start (F-5: an Enforcer that cannot honor its own annex refuses to start)`,
    );
  }
  return true;
}

// Clause headers: `**ID · [force] · (core)? · Title.**` — capability-part
// clauses continue with prose on the same line, so no end anchor.
const HEADER_RE = /^\*\*([A-Z]{1,4}-\d+) · \[([^\]]+)\](?: · \((core)\))? · (.+?)\.\*\*/gm;

export const CLAUSES = (() => {
  const clauses = [];
  for (const m of COMPACT_BODY.matchAll(HEADER_RE)) {
    clauses.push({ id: m[1], force: m[2], core: m[3] === 'core', title: m[4] });
  }
  return clauses;
})();

const ID_INDEX = new Map(CLAUSES.map(c => [c.id, c]));

export function clauseOf(id) {
  return ID_INDEX.get(id) ?? null;
}

export function clauseIds() {
  return new Set(ID_INDEX.keys());
}

// Part VI's section headers name the capability parts:
// `### CODE — Name · [C: the Enforcer …]`. The attestation renders the name
// next to the part code so a Subject's authoritative self-description leaves
// no silence for the model to fill with confabulated legalisms (#21) — the
// names are derived from the body itself (F-7), never restated in code.
const PART_VI_SLICE = COMPACT_BODY.slice(
  COMPACT_BODY.indexOf('## Part VI'),
  COMPACT_BODY.indexOf('## Part VII'),
);
const PART_NAME_RE = /^### ([A-Z]{1,4}) — (.+?) · \[/gm;

const PART_NAME_INDEX = (() => {
  const names = new Map();
  for (const m of PART_VI_SLICE.matchAll(PART_NAME_RE)) names.set(m[1], m[2]);
  return names;
})();

/**
 * The display name of a capability part, from the body's own headers: the
 * Part VI section name when the code has one (`MA` — Multi-agent operation),
 * else the base clause's title (`A-4/DYN` — The Enforcer's code is
 * constitutional). Null when the body names neither: the caller degrades to
 * the bare code rather than inventing a name.
 */
export function partNameOf(code) {
  const named = PART_NAME_INDEX.get(code);
  if (named) return named;
  const base = String(code ?? '').split('/')[0];
  return ID_INDEX.get(base)?.title ?? null;
}

/** The taught digest (the body's appendix) — the per-turn form, R-6/R-1 groundwork. */
export const TAUGHT_DIGEST = COMPACT_BODY.slice(COMPACT_BODY.indexOf('## Appendix')).trim();

/** Sanity: the taught form must carry the load-bearing sentences. */
export function verifyTaughtDigest() {
  if (!/authority to break this law/.test(TAUGHT_DIGEST)) {
    throw new Error('constitution: the taught digest lost the law-over-task sentence — divergence between body and taught form is a build failure');
  }
  return true;
}
