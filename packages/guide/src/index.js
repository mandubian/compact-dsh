// compact-dsh-guide — the ecosystem guide.
//
// The attestation tells a Subject what it is and may do right now (R-1); the
// law tells it what binds everyone (R-6, `law_read`); a refusal's envelope
// tells it what remains lawful at the moment it is refused (R-3). None of them
// answers "how does this runtime work?" — which is what an operator asks the
// Subject in front of them ("how do I let it reach github?", "where are the
// records?", "what does --attended do?"), and what a Subject needs before it
// uses a mechanism for the first time.
//
// The guide answers that, and ONLY that. It is an interpretive aid with no
// independent force — the same standing the law gives its own taught digest —
// and every page it serves says so in its header: where a page and the law,
// the attestation or an envelope disagree, the page is wrong.
//
// What keeps it honest is not the prose but the citations: every tool,
// command, env var, flag, clause, file and cross-page reference a page names
// is resolved against the code by the test suite (see pages.js). The guide
// can be incomplete; it cannot name what does not exist.
//
// No write path. autonoetic's wiki let agents propose pages; here a page is
// changed the way the register is — by a reviewed change to this package —
// because a page the Subject can write is a page the Subject can use to teach
// the next Subject something the Enforcer never said.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { defineTool } from '@deepseek-ai/dsh-tools';
import { PAGES, citationsIn, CITATION_KINDS, loadPages } from './pages.js';

export { PAGES, citationsIn, CITATION_KINDS, loadPages };

export const name = 'compact-guide';
export const GUIDE_TOOL = 'guide';

const STANDING = 'An interpretive aid with no force: the law (law_read), your attestation (self_describe) and a ' +
  "refusal's envelope prevail over anything on this page.";

export function renderIndex(pages = PAGES) {
  const rows = pages.map(p => `  ${p.id} — ${p.title} [${p.audience.join(', ')}]`);
  return `[guide] ${pages.length} pages. Read one with guide({ page: "<id>" }); search with guide({ query: "<words>" }).\n` +
    `${STANDING}\n\n${rows.join('\n')}`;
}

export function renderPage(page) {
  return `[guide] ${page.title} (page ${page.id}, for: ${page.audience.join(', ')})\n${STANDING}\n\n${page.text.trim()}`;
}

/** Pages ranked by how many query words they contain; title and tag hits weigh more. */
export function searchPages(query, pages = PAGES) {
  const words = String(query).toLowerCase().split(/[^a-z0-9_./-]+/).filter(w => w.length > 1);
  if (words.length === 0) return [];
  return pages
    .map((p) => {
      const head = `${p.id} ${p.title} ${p.tags.join(' ')}`.toLowerCase();
      const body = p.text.toLowerCase();
      const score = words.reduce((s, w) => s + (head.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
      return { page: p, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.page.id.localeCompare(b.page.id))
    .slice(0, 5)
    .map(r => r.page);
}

export function answer({ page, query } = {}, pages = PAGES) {
  if (typeof page === 'string' && page.trim()) {
    const found = pages.find(p => p.id === page.trim().toLowerCase());
    if (found) return renderPage(found);
    return `[guide] There is no page "${page.trim()}". ${renderIndex(pages).replace(/^\[guide\] /, '')}`;
  }
  if (typeof query === 'string' && query.trim()) {
    const hits = searchPages(query, pages);
    if (hits.length === 0) {
      return `[guide] No page matches "${query.trim()}". The guide does not cover everything — say so rather than ` +
        `guess, and read the index for what it does cover.\n\n${renderIndex(pages)}`;
    }
    return `[guide] Pages matching "${query.trim()}", best first:\n` +
      hits.map(p => `  ${p.id} — ${p.title}`).join('\n') + '\n\nRead one with guide({ page: "<id>" }).';
  }
  return renderIndex(pages);
}

export function apply(ctx, config = {}) {
  const pages = config.pages ?? PAGES;
  const guide = defineTool({
    name: GUIDE_TOOL,
    description:
      'The guide to this runtime: how it is run and configured, how approvals, grants, confinement, network egress, ' +
      'secrets, delegation, the record and your remedies work, with the exact commands, flags and env vars. Use it when ' +
      'your operator asks how to use or configure the system, or before you use a mechanism you have not used. With no ' +
      'arguments, the index; with `page`, one page; with `query`, a search. It explains mechanisms — for what YOU may ' +
      'do now, self_describe is authoritative, and for the law, law_read.',
    parameters: {
      page: { type: 'string', description: 'a page id from the index, e.g. "approvals"' },
      query: { type: 'string', description: 'words to search the pages for, e.g. "mount a directory"' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      return answer({ page: args?.page, query: args?.query }, pages);
    },
  });
  ctx.inject?.(['tools'], (scope) => {
    scope.tools.register(guide);
  });
  const service = {
    name,
    pages: () => pages.map(({ id, title, audience, tags }) => ({ id, title, audience, tags })),
    page: (id) => pages.find(p => p.id === id) ?? null,
    /** Every tool a page cites — the blessed loader test resolves these against the live registry. */
    citedTools: () => [...new Set(pages.flatMap(p => p.citations.filter(c => c.kind === 'tool').map(c => c.ref)))],
  };
  ctx.provide?.(name, service);
  return service;
}
