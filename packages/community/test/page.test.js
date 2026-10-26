// The replay/export page, tested the only way a page can be: its embedded
// script is executed against a stub DOM and the three panes are counted.
// The regression this gates is real — an early export embedded epoch-
// millisecond timestamps and a renderer that sliced them as strings; the
// first act threw, and the acts and members panes shipped empty.
import test from 'node:test';
import assert from 'node:assert/strict';

import { replayPageHtml, pageHtml } from '../src/page.js';

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
  for (const id of ['meta', 'prov', 'charter', 'forum-list', 'acts-list', 'members']) make(id);
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

test('a gate post may open with its author\'s name — the bug-court finding', () => {
  // the live run's chair posted "chair — VERDICTS: final ledger…"; the
  // first detector required the gate word to open the post and missed
  // the marking. Member speech is never edited; the detector yields.
  const html = replayPageHtml({
    charterName: 'page-test',
    data: {
      run: { charter: 'page-test', runTag: 'g2', endReason: 'token cap' },
      forum: [
        { id: 'fp_1', seq: 1, topic: 'floor', by: 'community-chair-abc123', at: '2026-10-26T00:00:01.000Z', text: 'chair — VERDICTS: final ledger\nB1 CONFIRMED' },
        { id: 'fp_2', seq: 2, topic: 'floor', by: 'community-chair-abc123', at: '2026-10-26T00:00:02.000Z', text: 'a plain post that merely mentions VERDICTS: mid-sentence stays plain' },
      ],
      timeline: [], members: [],
    },
  });
  const doc = render(html);
  const classes = doc.els.get('forum-list').children.map((li) => li.className);
  assert.equal(classes[0], 'post ledger', 'the prefixed gate post is marked');
  assert.equal(classes[1], 'post', 'a mid-sentence mention is not a gate');
});

test('the charter rides with the archive: the goal renders, legacy archives render no block', () => {
  // the operator's finding: the exports showed the debate but never the
  // question — a reader needed the repo's charter JSON. Newer manifests
  // carry goal/topic/seats and the replay renders them; the old ones stay
  // silent (an absence, honestly stated, never a fake).
  const withGoal = replayPageHtml({
    charterName: 'page-test',
    data: {
      run: {
        charter: 'page-test', runTag: 'g1', endReason: 'rounds complete',
        goal: "Deliberate this question: 'what is debated?'",
        seats: [
          { id: 'frugal', model: 'zai/glm-5.3-flash', bench: false, persona: 'the cheap many' },
          { id: 'bench-1', model: 'zai/glm-5.3', bench: true, persona: 'the heavy seat' },
        ],
      },
      forum: [], timeline: [], members: [],
    },
  });
  const doc = render(withGoal);
  const charter = doc.els.get('charter');
  assert.match(charter.innerHTML, /THE CHARTER — the goal, verbatim/);
  assert.match(charter.innerHTML, /what is debated\?/);
  assert.match(charter.innerHTML, /<b>frugal<\/b> \(zai\/glm-5\.3-flash\) — the cheap many/);
  assert.match(charter.innerHTML, /<b>bench-1<\/b> \(zai\/glm-5\.3\) · bench — the heavy seat/);
  assert.match(charter.innerHTML, /what each member is FOR/, 'the seats line says the roles are shown');
  assert.doesNotMatch(charter.innerHTML, /operator's charter file/, 'a manifest goal is labeled as the manifest record');

  const legacy = replayPageHtml({ charterName: 'page-test', data: archive });
  const docLegacy = render(legacy);
  assert.equal(docLegacy.els.get('charter').innerHTML, '', 'a legacy archive renders no charter block');
});

test('the code the community ran on is named: commit, repo, dirty — or the honest absence', () => {
  // outputs never repeat (the nature of LLMs), but runs stay comparable
  // when the tree that produced each is named. A checkout git cannot
  // name says so; legacy archives say nothing at all.
  const mk = (code) => replayPageHtml({
    charterName: 'page-test',
    data: {
      run: {
        charter: 'page-test', runTag: 'p1', endReason: 'rounds complete',
        code,
        runtime: { node: 'v22.19.0', image: 'dsh-tools:basic', imageDigest: 'sha256:abcd0123', law: '27bb7078fe9aea5067a8e95b174f54bd8ae77c78fce7b1b06dd760690caf2c95' },
      },
      forum: [], timeline: [], members: [],
    },
  });
  const clean = render(mk({ repo: 'git@github.com:mandubian/compact-dsh.git', ref: 'main', commit: '6954957aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
  assert.match(clean.els.get('prov').textContent, /code: github\.com\/mandubian\/compact-dsh @ 6954957aaaa/);
  assert.match(clean.els.get('prov').textContent, /law 27bb7078fe9a…/);
  assert.match(clean.els.get('prov').textContent, /dsh-tools:basic · node v22\.19\.0/);
  assert.doesNotMatch(clean.els.get('prov').textContent, /DIRTY/);

  const dirty = render(mk({ commit: 'deadbeefdead', dirty: true }));
  assert.match(dirty.els.get('prov').textContent, /deadbeefdead \(DIRTY TREE\)/);

  const notGit = render(mk({ note: 'not a git checkout (or git absent) — the code state is not named' }));
  assert.match(notGit.els.get('prov').textContent, /not a git checkout/);

  const legacy = render(replayPageHtml({ charterName: 'page-test', data: archive }));
  assert.equal(legacy.els.get('prov').textContent, '', 'a legacy archive renders no provenance line');
});

test('member hues out-specify the generic who rule — the colors actually render', () => {
  // the Copilot finding on the first cut: a bare `.cN` (0,1,0) loses to
  // `li .who` (0,1,1), so every member rendered one color. The hues are
  // scoped `.who.cN` (0,2,0); this pins both templates so a future
  // refactor cannot silently re-kill the palette.
  for (const html of [
    replayPageHtml({ charterName: 'page-test', data: archive }),
    pageHtml({ charterName: 'page-test', token: 't' }),
  ]) {
    assert.match(html, /\.who\.c0 \{/, 'the palette is scoped to the who span');
    assert.doesNotMatch(html, /(?:^|[^.a-z-])\.c[0-7] \{/, 'no unscoped hue rule remains');
  }
});
