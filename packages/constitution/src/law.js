// R-6 — access to the law, in band.
//
// "Every Subject may read the full text of the law it lives under, addressed
// by its digest. A Member cannot consent to, contest, or reason under a law it
// cannot read." The constitution service has always held the body; this is the
// half that reaches the Subject. A body only an operator's code can call is
// access for the Enforcer, not for the governed — the tool is the right.
//
// Three reads, all sliced from the bundled body that boot verified against its
// pinned digest — nothing here restates the law (F-7):
//
//   - no argument: the table of contents — every clause's id, force and title
//     under the section it sits in, so a Subject can find what it needs
//     without pulling the whole body into its context;
//   - `clause`: that clause's own text, header to next header;
//   - `full`: the entire body.
//
// ADDRESSED BY ITS DIGEST. Every answer names the digest it was read from,
// and a Subject citing a different one is told, in the answer, that what it
// holds is not the law in force — the same alarm shape as R-1's stale
// attestation. A digest the Subject cannot compare is an address it cannot
// use.
//
// AN UNKNOWN CLAUSE IS ANSWERED, NOT REFUSED. The answer says the id is not a
// clause of this law and points at the table of contents; it never offers a
// near match as if it were the text asked for.

import { CLAUSES, COMPACT_BODY, COMPACT_DIGEST, COMPACT_SOURCE_URL, clauseText } from './body.js';

const SECTION_RE = /^#{2,3} (.+)$/gm;

// Each clause's enclosing section, from the body's own headings.
const SECTION_OF = (() => {
  const headings = [...COMPACT_BODY.matchAll(SECTION_RE)].map(m => ({ at: m.index, title: m[1].split(' · [')[0].trim() }));
  const map = new Map();
  for (const c of CLAUSES) {
    const at = COMPACT_BODY.indexOf(`**${c.id} · `);
    const enclosing = headings.filter(h => h.at < at).at(-1);
    map.set(c.id, enclosing?.title ?? null);
  }
  return map;
})();

const STATUS = 'draft v0.5 — NOT yet ratified; no Compact standing is claimed (F-5)';

function header(digest) {
  return `[R-6] The law in force — sha256 ${digest}\nSource: ${COMPACT_SOURCE_URL} (${STATUS})`;
}

function digestNotice(citingDigest, digest) {
  if (typeof citingDigest !== 'string' || citingDigest.trim() === '' || citingDigest.trim() === digest) return '';
  return `\n\n[R-6 ALARM] You cited digest ${citingDigest.trim()}; the law in force here is ${digest}. ` +
    'The text you were reasoning from is not the law this runtime runs — re-read what you relied on below, ' +
    'and re-check any decision you made from the other text.';
}

const FOOTER = 'This is the body. The taught digest in your attestation and any guide page are interpretive aids with no ' +
  'independent force: where they differ from this text, this text prevails.';

export function renderContents() {
  const lines = [];
  let section;
  for (const c of CLAUSES) {
    const s = SECTION_OF.get(c.id);
    if (s !== section) {
      section = s;
      lines.push('', s ?? '(no section)');
    }
    lines.push(`  ${c.id} · [${c.force}]${c.core ? ' · (core)' : ''} · ${c.title}`);
  }
  return `${CLAUSES.length} clauses. Read one with law_read({ clause: "<id>" }), or the whole body with law_read({ full: true }).` +
    lines.join('\n');
}

/**
 * The answer to one law_read call, as text. Pure: the tool, the tests and any
 * operator surface render the same thing.
 */
export function readLaw({ clause, full, citingDigest } = {}) {
  const digest = COMPACT_DIGEST;
  let text;
  if (full === true) {
    text = COMPACT_BODY.trim();
  } else if (typeof clause === 'string' && clause.trim() !== '') {
    const id = clause.trim().toUpperCase();
    const found = clauseText(id);
    text = found != null
      ? `${SECTION_OF.get(id) ?? ''}\n\n${found}`.trim()
      : `"${clause.trim()}" is not a clause of the law in force. Call law_read with no arguments for the table of ` +
        'contents — every clause id this law contains is listed there.';
  } else {
    text = renderContents();
  }
  return `${header(digest)}${digestNotice(citingDigest, digest)}\n\n${text}\n\n${FOOTER}`;
}
