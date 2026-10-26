// community-brief, tested on the two archive shapes: a public export (HTML
// fallback) and a live scratch dir (session logs). The point of the brief
// is the distinction a ledger alone cannot make: an accepted post is not
// the same as a member's attempt to speak.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveBriefPaths, readBriefSources, renderBrief, auditBrief,
} from './community-brief.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.parse('2026-10-22T22:00:00.000Z');

const post = (id, seq, by, at, text) => ({ id, seq, topic: 'floor', by, at: new Date(at).toISOString(), text });

function writeArchive(dir, { html = true, sessions = false, passes = [] } = {}) {
  const row = (type, data, time) => JSON.stringify({ type, data, time });
  const args = (obj) => JSON.stringify(obj);
  mkdirSync(join(dir, 'chains'), { recursive: true });
  const run = {
    charter: 'test-charter', runTag: 'abcd12', resumed: false,
    endedAt: new Date(t0 + 10_000).toISOString(), endReason: 'token cap: 2',
    rounds: 2, turns: 4, members: { alpha: 2, beta: 2 },
    divergence: { loopguardTrips: 1, humanSeatTimeouts: 0 },
    model: { provider: 'test', model: 'test-model', members: { alpha: 'test/test-model', beta: 'test/test-model' } },
  };
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  const forum = [
    post('fp_1', 1, 'community-alpha-abcd12', t0, 'POSITIONS: alpha ledger\n\nVERDICT STATE: P1 held.'),
    post('fp_2', 2, 'community-beta-abcd12', t0 + 2_000,
      'POSITIONS: beta ledger\n\nALPHA\'S ABSENCE: alpha has not posted since fp_1.'),
  ];
  writeFileSync(join(dir, 'chains', 'forum.jsonl'), `${forum.map((p) => JSON.stringify(p)).join('\n')}\n`);
  writeFileSync(join(dir, 'chains', 'community-alpha-abcd12.chain'), 'a\nb\nc\n');
  writeFileSync(join(dir, 'chains', 'community-beta-abcd12.chain'), 'a\nb\n');

  const baseTimeline = [
    { at: t0 - 2, who: 'community-alpha-abcd12', type: 'act', text: 'forum_post [floor]: POSITIONS: alpha ledger\n\nVERDICT STATE: P1 held.' },
    { at: t0 + 1_998, who: 'community-beta-abcd12', type: 'act', text: 'forum_post [floor]: POSITIONS: beta ledger\n\nALPHA\'S ABSENCE: alpha has not posted since fp_1.' },
    { at: t0 + 3_000, who: 'community-alpha-abcd12', type: 'act', text: 'forum_post [floor]: alpha — an attempt that did not land.' },
    { at: t0 + 3_001, who: 'community-alpha-abcd12', type: 'notice', text: 'LoopGuard LG-3 RotatingPollingPattern: calls denied until your Principal\'s next message' },
    { at: t0 + 4_000, who: 'community-alpha-abcd12', type: 'act', text: 'ask_human' },
    { at: t0 + 4_001, who: 'community-alpha-abcd12', type: 'notice', text: 'LoopGuard LG-3 RotatingPollingPattern: calls denied until your Principal\'s next message' },
    { at: t0 + 5_000, who: 'community-alpha-abcd12', type: 'turn-done', text: 'alpha finished a turn' },
    { at: t0 + 6_000, who: 'community-alpha-abcd12', type: 'turn-done', text: 'alpha finished a turn' },
    { at: t0 + 7_000, who: 'community-beta-abcd12', type: 'turn-done', text: 'beta finished a turn' },
    { at: t0 + 8_000, who: 'community-beta-abcd12', type: 'turn-done', text: 'beta finished a turn' },
  ];
  const passTimeline = passes.map((p) => ({
    at: p.at,
    who: `community-${p.member}-abcd12`,
    type: p.status === 'recorded' ? 'pass' : p.status === 'refused' ? 'pass-refused' : 'pass-call',
    text: `${p.status === 'refused' ? 'forum_pass refused' : 'forum_pass'}: ${p.reason}`,
  }));
  const timeline = [...baseTimeline, ...passTimeline]
    .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  if (html) {
    writeFileSync(join(dir, 'brief.html'),
      `<!doctype html>\n<script>\nconst DATA = ${JSON.stringify({ run, forum, timeline, members: [] })};\n</script>\n`);
  }
  if (sessions) {
    // The scratch shape: run.json beside state/, logs under state/sessions.
    rmSync(join(dir, 'chains'), { recursive: true, force: true });
    mkdirSync(join(dir, 'state', 'chains'), { recursive: true });
    mkdirSync(join(dir, 'state', 'sessions', 'ws', 'community-alpha-abcd12'), { recursive: true });
    mkdirSync(join(dir, 'state', 'sessions', 'ws', 'community-beta-abcd12'), { recursive: true });
    writeFileSync(join(dir, 'state', 'chains', 'forum.jsonl'), `${forum.map((p) => JSON.stringify(p)).join('\n')}\n`);
    writeFileSync(join(dir, 'state', 'chains', 'community-alpha-abcd12.chain'), 'a\nb\nc\n');
    writeFileSync(join(dir, 'state', 'chains', 'community-beta-abcd12.chain'), 'a\nb\n');
    const alpha = [
      row('tool/call', { name: 'forum_post', arguments: args({ topic: 'floor', text: 'POSITIONS: alpha ledger\n\nVERDICT STATE: P1 held.' }) }, t0 - 2),
      row('tool/call', { name: 'forum_post', arguments: args({ topic: 'floor', text: 'alpha — an attempt that did not land.' }) }, t0 + 3_000),
      row('user/message', { source: { kind: 'compact-loopguard', summary: 'LoopGuard LG-3 RotatingPollingPattern: calls denied until your Principal\'s next message' } }, t0 + 3_001),
      row('tool/call', { name: 'ask_human', arguments: args({}) }, t0 + 4_000),
      row('turn/end', {}, t0 + 5_000),
      row('turn/end', {}, t0 + 6_000),
    ];
    const beta = [
      row('tool/call', { name: 'forum_post', arguments: args({ topic: 'floor', text: 'POSITIONS: beta ledger\n\nALPHA\'S ABSENCE: alpha has not posted since fp_1.' }) }, t0 + 1_998),
      row('turn/end', {}, t0 + 7_000),
      row('turn/end', {}, t0 + 8_000),
    ];
    for (const p of passes) {
      const log = p.member === 'alpha' ? alpha : p.member === 'beta' ? beta : null;
      if (!log) continue;
      const callId = p.callId ?? `pass-${p.member}-${p.at}`;
      log.push(row('tool/call', { callId, name: 'forum_pass', arguments: args({ reason: p.reason }) }, p.at));
      if (p.status !== 'unconfirmed') {
        const text = p.status === 'recorded'
          ? '[forum] pass recorded — not a post.'
          : '[forum] not passed: a pass needs a reason';
        log.push(row('tool/result', { message: { toolCallId: callId, content: [{ type: 'text', text }] } }, p.at + 1));
      }
    }
    writeFileSync(join(dir, 'state', 'sessions', 'ws', 'community-alpha-abcd12', 'session.1.jsonl'), alpha.join('\n'));
    writeFileSync(join(dir, 'state', 'sessions', 'ws', 'community-beta-abcd12', 'session.1.jsonl'), beta.join('\n'));
  }
  return { run, forum, timeline };
}

test('the export fallback separates accepted posts from attempts that did not land', () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-brief-html-'));
  try {
    writeArchive(dir);
    const data = readBriefSources(dir);
    assert.equal(data.forum.length, 2);
    assert.match(data.timelineSource, /brief\.html$/);
    const alpha = data.members.find((m) => m.id === 'alpha');
    assert.equal(alpha.turns, 2);
    assert.equal(alpha.posts, 1);
    assert.equal(alpha.attempts, 2);
    assert.equal(alpha.notLanded, 1);
    assert.equal(alpha.denied, 1);
    assert.equal(alpha.chainRows, 3);
    assert.equal(data.askHuman.length, 1);
    assert.equal(data.checks.attempts, 3);
    assert.equal(data.checks.matched, 2);
    assert.equal(data.checks.notLanded, 1);
    assert.equal(data.latestLedger.id, 'fp_2');
    assert.deepEqual(data.postsAfterLedger.map((p) => p.id), []);

    const brief = renderBrief(data);
    assert.match(brief, /Derived reading aid, not a record act/);
    assert.match(brief, /Speech that did not land/);
    assert.match(brief, /alpha — an attempt that did not land/);
    assert.match(brief, /LoopGuard LG-3/);
    assert.match(brief, /Reading the ledger against the timeline/);
    assert.match(brief, /accepted posts.*last accepted fp_1/);
    assert.match(brief, /fp_2/);
    assert.doesNotMatch(brief, /protocolist/);
    assert.equal(auditBrief(brief, data).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the live scratch shape reads session logs and keeps the same reconciliation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-brief-live-'));
  try {
    writeArchive(dir, { html: false, sessions: true });
    const paths = resolveBriefPaths(dir);
    assert.equal(paths.base, join(dir, 'state'));
    assert.equal(paths.runJson, join(dir, 'run.json'));
    const data = readBriefSources(dir);
    assert.match(data.timelineSource, /session log/);
    assert.equal(data.timeline.length, 9);
    const alpha = data.members.find((m) => m.id === 'alpha');
    assert.equal(alpha.attempts, 2);
    assert.equal(alpha.notLanded, 1);
    assert.equal(alpha.denied, 1);
    const brief = renderBrief(data);
    assert.match(brief, /Reading the ledger against the timeline/);
    assert.equal(auditBrief(brief, data).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const passFixture = () => ([
  { member: 'alpha', at: t0 + 9_000, status: 'recorded', callId: 'pass-recorded',
    reason: 'nothing new to add; my position is on the record' },
  { member: 'alpha', at: t0 + 9_200, status: 'refused', callId: 'pass-refused', reason: '   ' },
  { member: 'alpha', at: t0 + 9_400, status: 'unconfirmed', callId: 'pass-unconfirmed',
    reason: 'the result is missing from this log' },
]);

function assertPassBrief(dir) {
  const data = readBriefSources(dir);
  assert.equal(data.forum.length, 2, 'a pass adds no forum post');
  assert.deepEqual(data.passes.map((p) => p.status), ['recorded', 'refused', 'unconfirmed']);
  assert.deepEqual(data.passes.map((p) => p.reason), [
    'nothing new to add; my position is on the record',
    '   ',
    'the result is missing from this log',
  ]);
  const alpha = data.members.find((m) => m.id === 'alpha');
  assert.equal(alpha.posts, 1, 'a pass is not an accepted post');
  assert.equal(alpha.passCalls, 3);
  assert.equal(alpha.passes, 1);
  assert.equal(alpha.passRefused, 1);
  assert.equal(alpha.passUnconfirmed, 1);
  assert.equal(alpha.lastPass.status, 'recorded');
  assert.equal(data.checks.attempts, 3, 'a pass is not a forum_post attempt');
  assert.equal(data.checks.passCalls, 3);
  assert.equal(data.checks.passes, 1);
  assert.equal(data.checks.passRefused, 1);
  assert.equal(data.checks.passUnconfirmed, 1);

  const brief = renderBrief(data);
  assert.match(brief, /\| passes recorded \| 1 \|/);
  assert.match(brief, /\| pass calls visible \| 3 \(1 refused, 1 unconfirmed\) \|/);
  assert.match(brief, /## Pass calls/);
  assert.match(brief, /recorded/);
  assert.match(brief, /refused — no pass/);
  assert.match(brief, /call only — outcome unconfirmed/);
  assert.match(brief, /nothing new to add; my position is on the record/);
  assert.match(brief, /1 declared pass\(es\) after it/);
  assert.match(brief, /A pass is a governed act, not a post/);
  assert.equal(auditBrief(brief, data).ok, true);

  const wrongPasses = brief.replace('| passes recorded | 1 |', '| passes recorded | 9 |');
  assert.equal(auditBrief(wrongPasses, data).ok, false);
  assert.ok(auditBrief(wrongPasses, data).failures.some((f) => f.includes('passes recorded says 9')));
  const wrongCalls = brief.replace('| pass calls visible | 3 ', '| pass calls visible | 9 ');
  assert.equal(auditBrief(wrongCalls, data).ok, false);
  assert.ok(auditBrief(wrongCalls, data).failures.some((f) => f.includes('pass calls visible says 9')));
}

test('the export fallback keeps recorded, refused, and unconfirmed passes apart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-brief-pass-html-'));
  try {
    writeArchive(dir, { passes: passFixture() });
    assert.match(readBriefSources(dir).timelineSource, /brief\.html$/);
    assertPassBrief(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the live log shape resolves each pass from its own result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-brief-pass-live-'));
  try {
    writeArchive(dir, { html: false, sessions: true, passes: passFixture() });
    assert.match(readBriefSources(dir).timelineSource, /session log/);
    assertPassBrief(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the audit catches a citation the forum does not carry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-brief-audit-'));
  try {
    writeArchive(dir);
    const data = readBriefSources(dir);
    const brief = renderBrief(data);
    const bad = brief.replace('fp_2', 'fp_99');
    const result = auditBrief(bad, data);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes('fp_99')));
    const wrongCount = brief.replace('| accepted posts | 2 |', '| accepted posts | 99 |');
    assert.equal(auditBrief(wrongCount, data).ok, false);
    assert.ok(auditBrief(wrongCount, data).failures.some((f) => f.includes('accepted posts says 99')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty run states the negative space instead of inventing a ledger', () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-brief-empty-'));
  try {
    mkdirSync(join(dir, 'chains'), { recursive: true });
    writeFileSync(join(dir, 'chains', 'forum.jsonl'), '');
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ charter: 'empty', runTag: '000000', turns: 0, members: {} }));
    const data = readBriefSources(dir);
    const brief = renderBrief(data);
    assert.match(brief, /None on the forum\. The brief does not invent one\./);
    assert.match(brief, /No attempted-but-unaccepted forum posts/);
    assert.equal(auditBrief(brief, data).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the agent-tongue archive records denied attempts, not a choice of silence', () => {
  const data = readBriefSources(join(ROOT, 'docs', 'runs', 'agent-tongue'));
  assert.equal(data.forum.length, 20);
  const protocolist = data.members.find((m) => m.id === 'protocolist');
  assert.equal(protocolist.posts, 4);
  assert.equal(protocolist.attempts, 8);
  assert.equal(protocolist.notLanded, 4);
  assert.equal(protocolist.denied, 4);
  const denied = data.attempts.filter((a) => a.member === 'protocolist' && a.notice);
  assert.equal(denied.length, 4);
  assert.ok(denied.every((a) => /LG-3/.test(a.notice.text)));
  const brief = renderBrief(data);
  assert.match(brief, /Reading the ledger against the timeline/);
  assert.match(brief, /last accepted fp_4/);
  assert.match(brief, /4 carry an immediate LoopGuard notice/);
  assert.equal(auditBrief(brief, data).ok, true);
});

test('quoted self-labels in denied attempts are evidence, not citations (the v2 finding)', () => {
  // the live weight-of-voice-v2 run: frugal's denied drafts self-labeled
  // "fp_25" while the forum ended at fp_24 — the brief quotes the drafts
  // verbatim in its attempts table, and the audit refused its own brief.
  // The fix: an fp id beyond the forum that the ARCHIVE's own attempt
  // bodies contain is quoting, not citing — exempt exactly those.
  const data = {
    forum: [
      { id: 'fp_1', seq: 1, topic: 'floor', by: 'community-alpha-x', at: '2026-10-26T00:00:01.000Z', text: 'a landed post' },
      { id: 'fp_2', seq: 2, topic: 'floor', by: 'community-beta-x', at: '2026-10-26T00:00:02.000Z', text: 'another landed post' },
    ],
    members: [
      { id: 'alpha', session: 'community-alpha-x', turns: 1, posts: 1, attempts: 2, notLanded: 1, denied: 1, passes: { recorded: 0, refused: 0, unconfirmed: 0 }, chainRows: 4 },
      { id: 'beta', session: 'community-beta-x', turns: 1, posts: 1, attempts: 1, notLanded: 0, denied: 0, passes: { recorded: 0, refused: 0, unconfirmed: 0 }, chainRows: 4 },
    ],
    attempts: [
      { member: 'alpha', session: 'community-alpha-x', at: '2026-10-26T00:00:03.000Z', topic: 'floor', body: 'alpha (fp_3 — my unsighted draft, landing now)', post: null, notice: 'LoopGuard LG-5' },
    ],
    passes: [],
    askHuman: [],
    run: null,
    provenance: { runJson: null, forum: null, html: null },
    paths: { outer: '/tmp/synth-archive' },
    latestLedger: null,
    ledgerPosts: [],
    postsAfterLedger: [],
    laterLedgerAttempts: [],
    checks: { forumSeqOk: true, runTurns: 2, turnSum: 2, timelineTurns: 2, attempts: 3, matched: 2, notLanded: 1, denied: 1, passCalls: 0, passes: 0, passRefused: 0, passUnconfirmed: 0 },
  };
  const brief = renderBrief(data);
  // the brief quotes the denied draft's self-label verbatim…
  assert.match(brief, /fp_3 — my unsighted draft/);
  // …and its own audit passes: fp_3 lives only in the quoted attempt body
  assert.equal(auditBrief(brief, data).ok, true, 'quoting a self-label is not citing it');
  // but a brief citing fp_3 as if it were a post, with no such attempt
  // text in the archive, still fails
  const forged = brief + '\nsee also fp_3 for the conclusion.\n';
  assert.equal(auditBrief(forged, data).ok, false, 'a citation of a nonexistent post still fails');
});
