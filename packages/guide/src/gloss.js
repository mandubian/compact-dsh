// R-3 and R-6 at the same door: the gloss, served to the Subject.
//
// The envelope a refusal or ask carries names its rule — `[GATE/ruleId]` —
// and the canonical text is the floor (R-3). The gloss
// (compact-envelope's gloss.js) is the per-rule human explanation BEHIND
// that rule: why the gate exists, a worked example, what to do. Until now
// that table served only the projections (the T2 band copy, the web ask
// card); the Subject that received `[RA/D-7/opaque-network]` could read the
// law itself (law_read, R-6) but not the runtime's own interpretation of
// the rule that refused it. This is that reading door.
//
// The standing is the gloss's own, from the concept page: an interpretive
// aid with no force. Where a gloss and the canonical envelope disagree, the
// envelope wins and the gloss is a bug with a failing lint
// (packages/envelope/test/gloss.lint.test.js) — so every answer says which
// text prevails, the way the guide's pages and law_read's footer do.
//
// The law_read disciplines carry over: the index is bounded (keys and
// titles only — never the whole table pulled into context); one record per
// read; AN UNKNOWN RULE IS ANSWERED, NOT REFUSED, and never answered with a
// near match. The one resolution the reading door performs is the
// wildcard: fingerprint-form asks are keyed by the operation's fingerprint
// (`AG/fp_…`) and capability refusals by the part's first clause
// (`CG/…`), so a miss on the exact key falls to the gate's wildcard record
// — and says so, because pretending the exact rule has no gloss when the
// family is glossed would be its own dishonesty. Beyond that, no magic: a
// rule the builders do not emit has no gloss, and the answer says exactly
// that.

import { GLOSS, glossFor } from 'compact-envelope';

export const GLOSS_TOOL = 'gloss_read';

const STANDING = 'An interpretive aid with no force: the envelope you received — its canonical text — prevails. ' +
  'Where this gloss and the envelope disagree, the gloss is a bug the lint catches. For the law itself read it ' +
  'with law_read; for how the runtime works, ask guide.';

/** The gate family a key belongs to ('AG/D-7/x' → 'AG'), or null. */
function gateOf(key) {
  const m = /^([A-Z]{2})\//.exec(key);
  return m ? m[1] : null;
}

/** The index: every glossed rule's key and title, grouped by gate family,
 * wildcards last within their family. Bounded on purpose — titles only. */
export function renderGlossIndex(gloss = GLOSS) {
  const families = new Map();
  for (const [key, record] of Object.entries(gloss)) {
    const gate = gateOf(key) ?? '—';
    if (!families.has(gate)) families.set(gate, []);
    families.get(gate).push([key, record.title]);
  }
  const lines = [];
  for (const [gate, rows] of [...families.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push('', gate);
    rows.sort((a, b) => (a[0].includes('/*') ? 1 : 0) - (b[0].includes('/*') ? 1 : 0) || a[0].localeCompare(b[0]))
      .forEach(([key, title]) => lines.push(`  ${key} — ${title}`));
  }
  return `${Object.keys(gloss).length} glossed rules. Read one with gloss_read({ rule: "<GATE/ruleId>" }) — ` +
    `the rule id is in the refusal or ask you received, e.g. [RA/D-7/opaque-network].` +
    lines.join('\n');
}

/** One record, verbatim from the table. The cites point at the law:
 * law_read serves the clause text; the gloss never paraphrases it here. */
export function renderRecord(key, record) {
  const lines = [`[gloss] ${key} — ${record.title}`, '', STANDING, '', record.why];
  if (record.example?.blocked?.length) lines.push('', `Refused path — e.g. ${record.example.blocked.join('; ')}`);
  if (record.example?.lawful?.length) lines.push(`Lawful path — e.g. ${record.example.lawful.join('; ')}`);
  if (record.instruction) lines.push('', `What to do: ${record.instruction}`);
  const moves = Object.entries(record.operatorMoves ?? {});
  if (moves.length) {
    lines.push('', 'What your operator can do:');
    for (const [move, meaning] of moves) lines.push(`  ${move} — ${meaning}`);
  }
  if (record.cites?.length) {
    lines.push('', `Cites: ${record.cites.join(', ')} — read the clause itself with law_read({ clause: "<id>" }).`);
  }
  return lines.join('\n');
}

/**
 * The answer to one gloss_read call, as text. Pure: the tool, the tests and
 * any operator surface render the same thing.
 */
export function readGloss({ rule } = {}, gloss = GLOSS) {
  if (typeof rule !== 'string' || rule.trim() === '') {
    return `[gloss] ${renderGlossIndex(gloss)}\n\n${STANDING}`;
  }
  const key = rule.trim();
  const record = gloss[key];
  if (record) return renderRecord(key, record);
  // a miss on the exact key falls to the gate's wildcard family — the
  // fingerprint-form asks and the per-part capability refusals are keyed at
  // run time, so the exact rule you hold is covered by the family's record
  const gate = gateOf(key);
  const wild = gate ? glossFor(gate, key.slice(gate.length + 1)) : null;
  if (wild && wild.key.endsWith('/*')) {
    const why = wild.key === 'AG/*'
      ? 'approval asks are keyed by the operation\'s fingerprint'
      : 'capability refusals are keyed by the part\'s first clause';
    return `${renderRecord(wild.key, wild.gloss)}\n\n[gloss] You asked for ${key}; there is no per-rule record for it. ` +
      `This rule family is glossed once, at ${wild.key} — ${why} — so the family record above is the gloss for it.`;
  }
  return `"${key}" has no gloss. The gloss covers every rule the envelope builders emit — call gloss_read with no ` +
    'arguments for the list. The canonical envelope on the refusal or ask you received is the floor regardless: ' +
    'its rule, reason and lawful next moves stand with or without a gloss.';
}
