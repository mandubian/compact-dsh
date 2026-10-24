// The replay/export page, tested the only way a page can be: its embedded
// script is executed against a stub DOM and the three panes are counted.
// The regression this gates is real — an early export embedded epoch-
// millisecond timestamps and a renderer that sliced them as strings; the
// first act threw, and the acts and members panes shipped empty.
import test from 'node:test';
import assert from 'node:assert/strict';

import { replayPageHtml } from '../src/page.js';

const stubDocument = () => {
  const els = new Map();
  const make = (id) => {
    const el = {
      id, children: [], innerHTML: '', textContent: '', className: '',
      appendChild(child) { this.children.push(child); },
    };
    els.set(id, el);
    return el;
  };
  for (const id of ['meta', 'forum-list', 'acts-list', 'members']) make(id);
  return {
    els,
    getElementById: (id) => els.get(id) ?? make(id),
    createElement: () => ({ innerHTML: '', className: '', appendChild() {} }),
  };
};

const render = (html) => {
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'the page embeds its renderer');
  const doc = stubDocument();
  new Function('document', script)(doc);
  return doc;
};

const archive = {
  run: {
    charter: 'page-test', runTag: 'abc123', endedAt: '2026-10-24T00:00:00.000Z',
    endReason: 'rounds complete', rounds: 1, turns: 2, tokens: 100,
    model: { provider: 'zai', model: 'glm-5.3-flash' },
  },
  forum: [
    { id: 'fp_1', seq: 1, topic: 'floor', by: 'community-recorder-abc123', at: '2026-10-24T00:00:01.000Z', text: 'a post' },
    { id: 'fp_2', seq: 2, topic: 'floor', by: 'community-verifier-abc123', at: '2026-10-24T00:00:02.000Z', text: 'a <script> reply' },
  ],
  timeline: [
    { at: 1792705927392, who: 'community-recorder-abc123', type: 'act', text: 'forum_read' },
    { at: '2026-10-24T00:00:03.000Z', who: 'community-verifier-abc123', type: 'notice', text: 'a notice' },
    { at: 1792705928000, who: 'community-recorder-abc123', type: 'turn-done', text: 'finished a turn' },
  ],
  members: [
    { session: 'community-recorder-abc123', turns: 4 },
    { session: 'community-verifier-abc123', turns: 5 },
  ],
};

test('the replay page renders all three panes from mixed timestamp shapes', () => {
  const html = replayPageHtml({ charterName: 'page-test', data: archive });
  const doc = render(html);
  assert.equal(doc.els.get('forum-list').children.length, 2);
  assert.equal(doc.els.get('acts-list').children.length, 3);
  assert.match(doc.els.get('members').innerHTML, /<td>recorder-abc123<\/td><td>4<\/td>/);
  assert.match(doc.els.get('members').innerHTML, /<td>verifier-abc123<\/td><td>5<\/td>/);
});

test('epoch-millisecond timestamps render as clock time, not a crash or digits', () => {
  const html = replayPageHtml({ charterName: 'page-test', data: archive });
  const doc = render(html);
  const acts = doc.els.get('acts-list').children.map((li) => li.innerHTML);
  assert.match(acts[0], /<span class="at">\d\d:\d\d:\d\d<\/span>/, 'epoch ms renders as HH:MM:SS');
  assert.match(acts[1], /<span class="at">00:00:03<\/span>/, 'ISO renders as HH:MM:SS');
});

test('the header names the run, its end reason and the model route', () => {
  const html = replayPageHtml({ charterName: 'page-test', data: archive });
  const doc = render(html);
  const meta = doc.els.get('meta').textContent;
  assert.match(meta, /page-test · run abc123/);
  assert.match(meta, /reason: rounds complete/);
  assert.match(meta, /model zai\/glm-5.3-flash/);
});

test('member speech is escaped, including in the forum pane', () => {
  const html = replayPageHtml({ charterName: 'page-test', data: archive });
  const doc = render(html);
  const forum = doc.els.get('forum-list').children.map((li) => li.innerHTML).join('');
  assert.match(forum, /&lt;script&gt;/);
  assert.doesNotMatch(forum, /<script> reply/);
});

test('empty lanes say so instead of rendering nothing', () => {
  const html = replayPageHtml({
    charterName: 'page-test',
    data: { run: null, forum: [], timeline: [], members: [] },
  });
  const doc = render(html);
  assert.match(doc.els.get('forum-list').innerHTML, /the forum never spoke/);
  assert.match(doc.els.get('acts-list').innerHTML, /no acts recorded/);
});
