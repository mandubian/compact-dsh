// The run archive (#215): readArchive over synthetic state, the replay
// page rendering it, and the export being self-contained.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readArchive, timelineFromLog } from './run-archive.mjs';
import { replayPageHtml } from '../packages/community/src/page.js';

function buildState(dir) {
  mkdirSync(join(dir, 'state', 'sessions', 'ws', 'community-guardian-aaa'), { recursive: true });
  mkdirSync(join(dir, 'state', 'chains'), { recursive: true });
  mkdirSync(join(dir, 'state', 'keyring'), { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({
    charter: 'agreement', runTag: 'aaa', resumed: false,
    endedAt: '2026-10-22T20:31:41.481Z', endReason: 'rounds complete',
    rounds: 2, turns: 2, benchCasesSeen: 0, tokens: 30000,
    members: { guardian: 2 },
    model: { provider: 'zai', model: 'glm-5.3-flash', members: { guardian: 'zai/glm-5.3-flash' } },
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'state', 'sessions', 'ws', 'community-guardian-aaa', 'session.v4.jsonl'), [
    JSON.stringify({ type: 'turn/end', time: 1792700400000, data: {} }),
    JSON.stringify({ type: 'tool/call', time: 1792700401000, data: { name: 'law_read', arguments: '{}' } }),
    JSON.stringify({ type: 'user/message', time: 1792700402000, data: { source: { kind: 'compact-loopguard', summary: 'LoopGuard LG-2 identical retry' } } }),
    JSON.stringify({ type: 'turn/end', time: 1792700460000, data: {} }),
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'state', 'chains', 'forum.jsonl'), [
    JSON.stringify({ id: 'fp_1', seq: 1, topic: 'agreement-floor', by: 'community-guardian-aaa', at: '2026-10-22T20:02:00.000Z', text: 'POSITION: yes, and I cite R-9' }),
  ].join('\n') + '\n');
  return dir;
}

test('readArchive: the run manifest, the full forum, and an ordered timeline', () => {
  const dir = buildState(mkdtempSync(join(tmpdir(), 'run-archive-')));
  try {
    const a = readArchive(dir);
    assert.equal(a.run.endReason, 'rounds complete');
    assert.equal(a.run.model.members.guardian, 'zai/glm-5.3-flash', 'the manifest carries which model each member spoke with');
    assert.equal(a.forum.length, 1);
    assert.match(a.forum[0].text, /R-9/);
    assert.equal(a.members.length, 1);
    assert.deepEqual(a.timeline.map((t) => t.type), ['turn-done', 'act', 'notice', 'turn-done'], 'the timeline is ordered as the member lived it');
    // EPOCH-NUMBER times normalize to ISO strings at the source (the live
    // finding: the renderer sliced a number and the acts lane died)
    assert.match(a.timeline[0].at, /^2026-10-2[0-9]T/, 'numeric times come out ISO');
    assert.equal(a.timeline[1].text, 'law_read');
    assert.match(a.timeline[2].text, /LG-2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('timelineFromLog: a torn tail line never kills the archive', () => {
  const good = JSON.stringify({ type: 'turn/end', time: 't1', data: {} }) + '\n' + '{"type": "tool/call", "tim';
  const t = timelineFromLog(good, 'm');
  assert.equal(t.length, 1);
  assert.equal(t[0].type, 'turn-done');
});

/** Run a replay page's inline script against a minimal DOM stub and
 *  return the rendered elements — enough for the page's render loops. */
function renderReplay(html) {
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements = {};
  const el = (id) => elements[id] ??= {
    innerHTML: '', textContent: '', children: [],
    appendChild(c) { this.children.push(c); },
    querySelector: () => null, dataset: {}, removeChild: () => {},
  };
  new Function('document', 'window', script)(
    { getElementById: el, createElement: () => ({ innerHTML: '', className: '', dataset: {}, appendChild: () => {}, querySelector: () => null, children: [] }) },
    {},
  );
  return elements;
}

test('the replay page renders the archive: full posts, the timeline, the run header', () => {
  const html = replayPageHtml({
    charterName: 'agreement',
    data: {
      run: {
        charter: 'agreement', runTag: 'b421a5', endReason: 'rounds complete', rounds: 5, turns: 15, tokens: 450551,
        model: { provider: 'zai', model: 'glm-5.3-flash', members: { guardian: 'zai/glm-5.3-flash', steward: 'zai/glm-5.3-flash' } },
      },
      forum: [
        { id: 'fp_1', topic: 'agreement-floor', by: 'community-guardian-aaa', at: 't', text: 'POSITION: yes — and the law itself supplies the discipline' },
        { id: 'fp_2', topic: 'agreement-floor', by: 'community-publisher-xyz', at: 't', text: "W=/tmp/x; echo 'Support' >> $W && $(cat notes) — $$ and $& and $' all literal" },
      ],
      timeline: [{ at: '2026-10-22T20:00:00.000Z', who: 'community-guardian-aaa', type: 'turn-done', text: 'guardian finished a turn' }],
      members: [{ session: 'community-guardian-aaa', turns: 5 }],
    },
  });
  assert.match(html, /community replay — agreement/);
  // the renderer embeds the archive itself, verbatim — no placeholder, no
  // String.replace, so $-sequences in archived commands cannot corrupt it
  assert.doesNotMatch(html, /__DATA__/);
  assert.match(html, /the forum never spoke/); // the negative-space branch compiles
  const elements = renderReplay(html);
  assert.match(elements['meta'].textContent, /rounds complete/);
  assert.match(elements['meta'].textContent, /model zai\/glm-5\.3-flash/, 'the header names the model the members spoke with');
  const forumChildren = elements['forum-list'].children.map((c) => c.innerHTML).join('\n');
  assert.match(forumChildren, /the law itself supplies the discipline/);
  assert.match(forumChildren, /guardian/);
  // the $-poison case (the Copilot finding): every dollar sequence in the
  // archived text reaches the page LITERALLY
  assert.match(forumChildren, /\$W &amp;&amp; \$\(cat notes\) — \$\$ and \$&amp; and \$&#39; all literal/);
});

test('the replay header: heterogeneous seating names each member on its own route', () => {
  const html = replayPageHtml({
    charterName: 'mixed',
    data: {
      run: {
        charter: 'mixed', runTag: 'zzz', endReason: 'rounds complete', rounds: 1, turns: 2, tokens: 1,
        model: { provider: 'zai', model: 'glm-5.3-flash', members: { guardian: 'zai/glm-5.3-flash', steward: 'deepseek/chat' } },
      },
      forum: [], timeline: [], members: [],
    },
  });
  const elements = renderReplay(html);
  assert.match(elements['meta'].textContent, /model guardian=zai\/glm-5\.3-flash steward=deepseek\/chat/);
});
