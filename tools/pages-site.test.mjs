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
  for (const id of ['meta', 'prov', 'charter', 'forum-list', 'acts-list', 'members']) pane(id);
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

test('the three community samples are published with their accounts', () => {
  for (const sample of samples) {
    assert.ok(existsSync(join(docs, sample.html)), `sample ${sample.html} is missing`);
    assert.ok(existsSync(join(docs, sample.account)), `account ${sample.account} is missing`);
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
