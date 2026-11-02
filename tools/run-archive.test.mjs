// The run archive (#215): readArchive over synthetic state, the replay
// page rendering it, and the export being self-contained.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readArchive, timelineFromLog, fileChangesFrom, frozenVsFinalFrom } from './run-archive.mjs';
import { pageHtml, replayPageHtml } from '../packages/community/src/page.js';

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
    JSON.stringify({ type: 'tool/call', time: 1792700401500, data: { callId: 'pass-ok', name: 'forum_pass', arguments: JSON.stringify({ reason: 'nothing new to add; my position is on the record' }) } }),
    JSON.stringify({ type: 'tool/result', time: 1792700401600, data: { message: { toolCallId: 'pass-ok', content: [{ type: 'text', text: '[forum] pass recorded — not a post.' }] } } }),
    JSON.stringify({ type: 'tool/call', time: 1792700401700, data: { callId: 'pass-bad', name: 'forum_pass', arguments: JSON.stringify({ reason: '   ' }) } }),
    JSON.stringify({ type: 'tool/result', time: 1792700401800, data: { message: { toolCallId: 'pass-bad', content: [{ type: 'text', text: '[forum] not passed: a pass needs a reason' }] } } }),
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
    assert.deepEqual(a.timeline.map((t) => t.type), ['turn-done', 'act', 'pass', 'pass-refused', 'notice', 'turn-done'], 'the timeline is ordered as the member lived it');
    // EPOCH-NUMBER times normalize to ISO strings at the source (the live
    // finding: the renderer sliced a number and the acts lane died)
    assert.match(a.timeline[0].at, /^2026-10-2[0-9]T/, 'numeric times come out ISO');
    assert.equal(a.timeline[1].text, 'law_read');
    assert.match(a.timeline[2].text, /forum_pass: nothing new to add; my position is on the record/);
    assert.match(a.timeline[3].text, /forum_pass refused:\s+$/);
    assert.match(a.timeline[4].text, /LG-2/);
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
      timeline: [
        { at: '2026-10-22T20:00:00.000Z', who: 'community-guardian-aaa', type: 'turn-done', text: 'guardian finished a turn' },
        { at: '2026-10-22T20:00:01.000Z', who: 'community-guardian-aaa', type: 'pass', text: 'forum_pass: nothing new to add; my position is on the record' },
        { at: '2026-10-22T20:00:02.000Z', who: 'community-guardian-aaa', type: 'pass-refused', text: 'forum_pass refused: (empty)' },
      ],
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
  const actChildren = elements['acts-list'].children.map((c) => c.innerHTML).join('\n');
  assert.match(actChildren, /forum_pass: nothing new to add; my position is on the record/);
  assert.equal(elements['acts-list'].children.find((c) => /nothing new to add/.test(c.innerHTML)).className, 'pass');
  assert.equal(elements['acts-list'].children.find((c) => /refused/.test(c.innerHTML)).className, 'pass-refused');
});

test('the live page renders a pass in the acts lane, never as forum speech', () => {
  const html = pageHtml({ charterName: 'live', token: 't' });
  assert.match(html, /case 'forum-pass'/);
  assert.match(html, /passed — not a post/);
  assert.match(html, /forum-pass/);
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

// ── #309: what changed, from the archive's own files ──

test('fileChangesFrom: the per-turn diffs fold into timeline entries; a torn last line skips itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-'));
  try {
  mkdirSync(join(dir, 'state'), { recursive: true });
  const rows = [
    { at: '2026-11-01T10:00:00.000Z', path: 'sources/a.md', status: 'modified', member: 'community-engineer', round: 2, diff: ['- old', '+ new'] },
    { at: '2026-11-01T10:05:00.000Z', path: 'sources/b.md', status: 'added', member: 'community-skeptic', round: 2, diff: ['+ fresh'] },
  ];
  writeFileSync(join(dir, 'state', 'changes.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n' + '{"at": "torn', 'utf8');
  const changes = fileChangesFrom(dir);
  assert.equal(changes.length, 2, 'the torn line is skipped, the two whole rows fold');
  assert.equal(changes[0].type, 'file-change');
  assert.equal(changes[0].who, 'community-engineer');
  assert.deepEqual(changes[0].diff, ['- old', '+ new']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fileChangesFrom: an archive predating the lane ships without changes, stated by absence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-'));
  try {
    assert.deepEqual(fileChangesFrom(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('frozenVsFinalFrom: modified, removed, and unchanged sources — one entry each way they deserve', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-'));
  try {
  const run = {
    endedAt: '2026-11-01T12:00:00.000Z',
    charterSources: [
      { path: 'sources/changed.md', content: 'original\n' },
      { path: 'sources/deleted.md', content: 'going away\n' },
      { path: 'sources/untouched.md', content: 'the same\n' },
    ],
  };
  mkdirSync(join(dir, 'workspace/sources'), { recursive: true });
  writeFileSync(join(dir, 'workspace/sources/changed.md'), 'original\nchanged\n');
  // deleted.md is NOT written — it is gone from the final workspace
  writeFileSync(join(dir, 'workspace/sources/untouched.md'), 'the same\n');
  const out = frozenVsFinalFrom(dir, run);
  assert.equal(out.length, 2, 'the unchanged source says nothing; the other two say it plainly');
  const changed = out.find((e) => e.text.includes('changed.md'));
  assert.equal(changed.status, 'modified');
  assert.ok(changed.diff.some((l) => l === '+ changed'));
  const deleted = out.find((e) => e.text.includes('deleted.md'));
  assert.equal(deleted.status, 'removed');
  assert.match(deleted.diff[0], /removed/);
  assert.equal(out.every((e) => e.type === 'file-change'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('frozenVsFinalFrom: a legacy manifest (no charterSources) and a missing workspace both ship honestly empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-'));
  try {
    assert.deepEqual(frozenVsFinalFrom(dir, {}), [], 'no charterSources — the manifest predates the field');
    const run = { charterSources: [{ path: 'x.md', content: 'x' }] };
    assert.deepEqual(frozenVsFinalFrom(dir, run), [], 'no workspace — nothing to diff against');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
