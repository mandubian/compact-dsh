// GitHub Pages publishes docs/ verbatim (Jekyll is disabled by .nojekyll).
// A broken local link on the landing page is a broken link in the shipped
// site, and a missing honesty label is a shipped claim with the caveat
// dropped. Both are gated here rather than discovered by a reader.
//
// The exports under docs/runs are the record, not a build product: the test
// only checks that the pages the site links to exist and that each export
// stays self-contained.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { parseEmbeddedArchive } from './community-brief.mjs';
import { samplesRows, renderSamplesTable, syncSamplesTable } from './samples-table.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docs = join(root, 'docs');
const pages = ['index.html', 'samples.html'];

const samples = [
  { html: 'runs/agent-tongue/agent-tongue-1e393c.html', account: 'runs/agent-tongue/README.md' },
  { html: 'runs/agreement/agreement-b421a5.html', account: 'runs/agreement/README.md' },
  { html: 'runs/newsroom/newsroom-412836.html', account: 'runs/newsroom/README.md' },
  { html: 'runs/weight-of-voice/weight-of-voice-34ea9c.html', account: 'runs/weight-of-voice/README.md' },
  { html: 'runs/bug-court/bug-court-8e68c3.html', account: 'runs/bug-court/README.md' },
  { html: 'runs/workshop/workshop-2914fd.html', account: 'runs/workshop/README.md' },
  { html: 'runs/weight-of-voice-v2/weight-of-voice-v2-a980e1.html', account: 'runs/weight-of-voice-v2/README.md' },
  { html: 'runs/weight-of-voice-v2-rerun/weight-of-voice-v2-0e3fa8.html', account: 'runs/weight-of-voice-v2-rerun/README.md' },
];

const links = (html) => [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);

/** Execute a shipped export's embedded renderer against a stub DOM and
 *  return the three panes. The regression this gates is real: an early
 *  export embedded epoch-millisecond timestamps and a renderer that
 *  sliced them as strings — the first act threw, and the acts and
 *  members panes shipped empty behind a forum that rendered fine. */
const renderExport = (html) => {
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'the export embeds its renderer');
  const els = new Map();
  const pane = (id) => {
    const el = {
      id, children: [], innerHTML: '', textContent: '', className: '',
      appendChild(child) { this.children.push(child); },
    };
    els.set(id, el);
    return el;
  };
  for (const id of ['meta', 'prov', 'charter', 'gates', 'lawpane', 'forum-list', 'acts-list', 'members']) pane(id);
  new Function('document', script)({
    getElementById: (id) => els.get(id) ?? pane(id),
    createElement: () => ({ innerHTML: '', className: '', appendChild() {} }),
  });
  return { meta: els.get('meta'), forum: els.get('forum-list'), acts: els.get('acts-list'), members: els.get('members') };
};

test('the Pages source is static: no build step, no Jekyll', () => {
  for (const file of ['index.html', 'samples.html', 'site.css', '.nojekyll',
    'assets/why-compact-dsh.svg', 'assets/one-tool-call.svg']) {
    assert.ok(existsSync(join(docs, file)), `docs/${file} is missing`);
  }
});

test('every local link and image on the site resolves', () => {
  for (const page of pages) {
    const file = join(docs, page);
    const html = readFileSync(file, 'utf8');
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const url of links(html)) {
      if (/^(?:[a-z]+:|\/\/)/i.test(url)) continue; // external
      const [path, hash] = url.split('#');
      if (!path) {
        assert.ok(hash && ids.has(hash), `${page}: #${hash} names no element`);
        continue;
      }
      assert.ok(existsSync(resolve(dirname(file), path)), `${page}: ${url} does not exist`);
    }
  }
});

test('every community sample is published with its account and its brief', () => {
  for (const sample of samples) {
    assert.ok(existsSync(join(docs, sample.html)), `sample ${sample.html} is missing`);
    assert.ok(existsSync(join(docs, sample.account)), `account ${sample.account} is missing`);
    const brief = join(dirname(join(docs, sample.html)), 'BRIEF.md');
    assert.ok(existsSync(brief), `${brief} is missing — every archive gets its deterministic brief`);
  }
});

test('each sample export is self-contained', () => {
  for (const sample of samples) {
    const html = readFileSync(join(docs, sample.html), 'utf8');
    assert.doesNotMatch(html, /<script[^>]+\bsrc=/i, `${sample.html} loads a remote script`);
    assert.doesNotMatch(html, /<link[^>]+\bhref=/i, `${sample.html} loads a remote stylesheet`);
    assert.doesNotMatch(html, /@import\s+url\(/i, `${sample.html} imports remote CSS`);
  }
});

test('each sample export renders its forum, its acts and its members', () => {
  for (const sample of samples) {
    const html = readFileSync(join(docs, sample.html), 'utf8');
    const panes = renderExport(html);
    assert.ok(panes.forum.children.length > 0, `${sample.html}: the forum pane is empty`);
    assert.ok(panes.acts.children.length > 0, `${sample.html}: the acts pane is empty`);
    assert.match(panes.members.innerHTML, /<td>/, `${sample.html}: the members pane is empty`);
    assert.match(panes.meta.textContent, /run /, `${sample.html}: the run header is empty`);
  }
});

test('the site carries the status it must not hide', () => {
  for (const page of pages) {
    const html = readFileSync(join(docs, page), 'utf8');
    assert.match(html, /draft v0\.5/i, `${page} names the draft law`);
    assert.match(html, /standing none|no compact standing/i, `${page} declares standing`);
    assert.match(html, /rehearsal/i, `${page} labels the rehearsal basis`);
  }
});

test('the deploy workflow publishes docs/ on main with Actions', () => {
  const workflow = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /path: docs/);
  assert.match(workflow, /actions\/deploy-pages@/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
});

// The page's words against the archives' data. Each test below is a
// drift the site actually shipped: "four complete runs" beside seven
// cards, a provenance list that missed a run, and a card that said "no
// filing" about a run whose two filings were refused.

const samplesPage = () => readFileSync(join(docs, 'samples.html'), 'utf8');
const archiveOf = (runTag) => {
  for (const sample of samples) {
    const dir = dirname(join(docs, sample.html));
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    if (run.runTag === runTag) return { run, data: parseEmbeddedArchive(readFileSync(join(docs, sample.html), 'utf8')) };
  }
  return null;
};

test('the side-by-side table is generated from the archives, not typed', () => {
  const page = samplesPage();
  const rows = samplesRows(docs);
  assert.equal(rows.length, samples.length, 'one row per published sample');
  assert.equal(syncSamplesTable(page, renderSamplesTable(rows)), page,
    'docs/samples.html is stale against docs/runs — run node tools/samples-table.mjs');
});

// curation beside each archive (sample.json): archived samples keep a card,
// marked as such, in the samples page's archive — never in the featured grid
const curationOf = (sample) => {
  const p = join(dirname(join(docs, sample.html)), 'sample.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
};
const cardsOf = (html) => [...html.matchAll(/<article class="card sample-card( archived)?">([\s\S]*?)<\/article>/g)]
  .map((m) => ({ archived: Boolean(m[1]), body: m[2], tag: /<span class="run-id">(\w+)<\/span>/.exec(m[2])?.[1] }));
const tagOf = (sample) => JSON.parse(readFileSync(join(dirname(join(docs, sample.html)), 'run.json'), 'utf8')).runTag;

test('archived samples are shown as archived, featured ones as featured — on both pages', () => {
  const archivedTags = new Set(samples.filter((s) => curationOf(s).archived).map(tagOf));
  const samplesCards = cardsOf(samplesPage());
  assert.equal(samplesCards.length, samples.length, 'the samples page carries one card per published sample');
  for (const c of samplesCards) {
    assert.equal(c.archived, archivedTags.has(c.tag), `${c.tag}: ${archivedTags.has(c.tag) ? 'archived (sample.json) but featured' : 'featured but carded as archived'}`);
  }
  for (const s of samples.filter((x) => curationOf(x).archived)) {
    const by = curationOf(s).archived.supersededBy;
    assert.ok(existsSync(join(docs, 'runs', by)), `${s.html}: supersededBy names no archive (${by})`);
  }
  const landing = cardsOf(readFileSync(join(docs, 'index.html'), 'utf8'));
  assert.equal(landing.filter((c) => c.archived).length, 0, 'the landing page features, it does not archive');
  assert.deepEqual(new Set(landing.map((c) => c.tag)), new Set(samples.filter((s) => !curationOf(s).archived).map(tagOf)),
    'the landing page features exactly the featured samples');
});

test('every card\'s numbers are its archive\'s numbers', () => {
  const cards = [...cardsOf(samplesPage()), ...cardsOf(readFileSync(join(docs, 'index.html'), 'utf8'))].map((c) => c.body);
  assert.ok(cards.length >= samples.length, 'cards on both pages are checked');
  for (const card of cards) {
    const tag = /<span class="run-id">(\w+)<\/span>/.exec(card)?.[1];
    const archive = archiveOf(tag);
    assert.ok(archive, `card ${tag} names no published archive`);
    const { run, data } = archive;
    const stats = Object.fromEntries([...card.matchAll(/<div><span>([^<]+)<\/span><strong>([^<]+)<\/strong><\/div>/g)].map((m) => [m[1], m[2]]));
    const lead = (v) => Number(/^(\d[\d,]*)/.exec(v)?.[1].replace(/,/g, ''));
    if (stats.TOKENS) assert.equal(stats.TOKENS, run.tokens.toLocaleString('en-US'), `${tag}: TOKENS`);
    if (stats.ROUNDS) {
      assert.equal(lead(stats.ROUNDS), run.rounds, `${tag}: ROUNDS`);
      // the budget is the manifest's; a manifest that predates `budgets`
      // (agent-tongue) is checked against the shipped charter file instead
      // — the operator's file, not the record, and named as such here
      const budget = /\/ (\d+)/.exec(stats.ROUNDS)?.[1];
      const charterFile = join(root, 'tools', 'charters', `${run.charter}.json`);
      const charterBudget = existsSync(charterFile) ? JSON.parse(readFileSync(charterFile, 'utf8')).budgets?.rounds : undefined;
      if (budget) assert.equal(Number(budget), run.budgets?.rounds ?? charterBudget, `${tag}: the round budget (manifest, else the charter file)`);
    }
    if (stats.TURNS) assert.equal(lead(stats.TURNS), run.turns, `${tag}: TURNS`);
    if (stats['ACCEPTED POSTS']) assert.equal(lead(stats['ACCEPTED POSTS']), data.forum.length, `${tag}: ACCEPTED POSTS`);
    if (stats['CASES · JUDGMENTS'] && data.actOutcomes) {
      const landed = (tool) => data.timeline.filter((e) => e.text === tool && e.outcome === 'ok').length;
      assert.equal(stats['CASES · JUDGMENTS'], `${landed('judicature_hear')} · ${landed('judicature_judge')}`, `${tag}: cases and judgments that LANDED`);
    }
  }
});

test('the prose counts the runs the page actually carries', () => {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const page = samplesPage();
  const runs = [...page.matchAll(/\b(\w+) complete (?:runs|archives)\b/gi)].map((m) => m[1].toLowerCase());
  assert.ok(runs.length > 0, 'the page states its count somewhere');
  for (const word of runs) assert.equal(word, words[samples.length], `the page says "${word}" — it carries ${samples.length} runs`);
  // a re-run shares its charter: the charters count is the distinct charters
  const charters = new Set(samples.map((s) => JSON.parse(readFileSync(join(dirname(join(docs, s.html)), 'run.json'), 'utf8')).charter)).size;
  for (const m of page.matchAll(/\b(\w+) charters behind this page\b/gi)) {
    assert.equal(m[1].toLowerCase(), words[charters], `the page says "${m[1]}" charters — the samples ride ${charters}`);
  }
  const featured = samples.filter((s) => !curationOf(s).archived).length;
  for (const m of page.matchAll(/\b(\w+) featured\b/gi)) assert.equal(m[1].toLowerCase(), words[featured], 'the featured count');
  for (const m of page.matchAll(/\b(\w+) archived\b/gi)) {
    if (words.includes(m[1].toLowerCase())) assert.equal(m[1].toLowerCase(), words[samples.length - featured], 'the archived count');
  }
});

test('the v2 replay shows the refused filings (the 2026-10-27 correction)', () => {
  const html = readFileSync(join(docs, 'runs/weight-of-voice-v2/weight-of-voice-v2-a980e1.html'), 'utf8');
  const panes = renderExport(html);
  const refused = panes.acts.children.filter((c) => /judicature_hear <span class="verdict">— REFUSED \[LG\/LG-3\]/.test(c.innerHTML));
  assert.equal(refused.length, 2, 'both filings are marked refused, with their rule');
  assert.doesNotMatch(samplesPage(), /no filing, the bench never woke/, 'the uncorrected card text is gone');
});
