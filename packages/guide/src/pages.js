// The guide corpus: pages/index.json names every page, pages/<id>.md holds it.
//
// Loaded once, at import, and validated then: a page the index names but the
// directory lacks, or a page on disk the index does not name, fails the load —
// a guide that silently serves less than it lists (or more than it indexes) is
// the drift the autonoetic wiki suffered, where pages and their source docs
// wandered apart because nothing tied them together.
//
// CITATIONS. A page names the runtime's surface in a backticked, prefixed
// form — `clause:R-6`, `tool:law_read`, `command:/grants-grant`,
// `env:COMPACT_EGRESS`, `flag:--attended`, `file:docs/demo.md`,
// `page:running`. Every one is resolved against the code by the test suite
// (and the tool citations against the live composition by the blessed loader
// test), so a page cannot name a knob, a tool or a clause that does not exist.
// The operator acts on what the Subject tells them from these pages; an
// invented name here is a lie every Subject would repeat.

import { readFileSync, readdirSync } from 'node:fs';

const PAGES_DIR = new URL('../pages/', import.meta.url);

export const CITATION_KINDS = ['clause', 'tool', 'command', 'env', 'flag', 'file', 'page'];
const CITATION_RE = new RegExp('`(' + CITATION_KINDS.join('|') + '):([^`\\s]+)`', 'g');

/** Every prefixed citation in a page's text, in order. */
export function citationsIn(text) {
  return [...String(text).matchAll(CITATION_RE)].map(m => ({ kind: m[1], ref: m[2] }));
}

export function loadPages(dir = PAGES_DIR) {
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  if (!Array.isArray(index.pages) || index.pages.length === 0) throw new Error('guide: pages/index.json must list pages');
  const seen = new Set();
  const pages = index.pages.map((entry) => {
    const { id, title, audience, tags = [], sources = [] } = entry;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`guide: bad page id ${JSON.stringify(id)}`);
    if (seen.has(id)) throw new Error(`guide: duplicate page id ${id}`);
    seen.add(id);
    if (typeof title !== 'string' || !title.trim()) throw new Error(`guide: page ${id} has no title`);
    if (!Array.isArray(audience) || audience.length === 0 || audience.some(a => !['operator', 'subject'].includes(a))) {
      throw new Error(`guide: page ${id} must name its audience (operator and/or subject)`);
    }
    const text = readFileSync(new URL(`${id}.md`, dir), 'utf8');
    return { id, title, audience, tags, sources, text, citations: citationsIn(text) };
  });
  const onDisk = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
  const unindexed = onDisk.filter(f => !seen.has(f));
  if (unindexed.length) throw new Error(`guide: page file(s) not in pages/index.json: ${unindexed.join(', ')}`);
  return pages;
}

export const PAGES = loadPages();
