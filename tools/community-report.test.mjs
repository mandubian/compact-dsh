// The morning-after read, tested on synthetic state: the shapes the run
// actually writes (v4 session logs, the forum ledger, the approvals
// store), the negative space stated, and the auditor pointer derived
// from the session-directory rule (the dir's name IS the session id).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveRunPaths, findSessionLogs, agentStatsFromLog, forumFromLedger, grantsFromStore, formatReport,
} from './community-report.mjs';

const row = (type, data, extra = {}) => JSON.stringify({ type, data, ...extra });

function buildState(dir) {
  mkdirSync(join(dir, 'state', 'sessions', 'ws', 'community-editor'), { recursive: true });
  mkdirSync(join(dir, 'state', 'sessions', 'ws', 'community-publisher'), { recursive: true });
  mkdirSync(join(dir, 'state', 'chains'), { recursive: true });
  mkdirSync(join(dir, 'state', 'keyring'), { recursive: true });
  writeFileSync(join(dir, 'state', 'keyring', 'roll.json'), '{}\n');
  writeFileSync(join(dir, 'state', 'keyring', 'keyring.json'), '{}\n');
  // the editor: two turns, a forum post, a watch verdict, an ask_human answer
  writeFileSync(join(dir, 'state', 'sessions', 'ws', 'community-editor', 'session.v4.jsonl'), [
    JSON.stringify({ type: 'user/message', data: { source: { kind: 'compact-community' } }, session: 'community-editor' }),
    row('turn/end', { turn: 1 }),
    row('tool/call', { name: 'forum_post', arguments: JSON.stringify({ topic: 'nightly-digest', text: 'the line is set: lead with the escalation' }) }),
    row('tool/call', { name: 'ask_human', arguments: JSON.stringify({ question: 'ship or hold?' }) }),
    row('user/message', { source: { kind: 'compact-community', summary: 'ask_human answered' }, content: [{ type: 'text', text: '[ask_human] The Principal answered:\nship it' }] }),
    row('user/message', { source: { kind: 'compact-approval', summary: 'Night watch: "curl" allowed (judge) — under grant sg_a1' }, content: [{ type: 'text', text: 'Motivation: the edge is a date param, non-credential' }] }),
    row('assistant/message', { usage: { inputTokens: 1200, outputTokens: 300 } }),
    row('turn/end', { turn: 2 }),
  ].join('\n') + '\n');
  // the publisher: an approval answered by the operator path, a loopguard trip
  writeFileSync(join(dir, 'state', 'sessions', 'ws', 'community-publisher', 'session.v4.jsonl'), [
    JSON.stringify({ type: 'user/message', data: {}, session: 'community-publisher' }),
    row('approval/asked', { tool: 'bash' }),
    row('user/message', { source: { kind: 'compact-approval', summary: 'Approval: "curl -X PUT …" allowed once by the operator' }, content: [] }),
    row('user/message', { source: { kind: 'compact-loopguard', summary: 'LoopGuard LG-2 identical retry' }, content: [] }),
    row('turn/end', { turn: 1 }),
  ].join('\n') + '\n');
  // the forum ledger + the store
  writeFileSync(join(dir, 'state', 'chains', 'forum.jsonl'), [
    JSON.stringify({ id: 'fp_1', seq: 1, topic: 'nightly-digest', by: 'community-editor', at: 't1', text: 'the line is set: lead with the escalation' }),
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'state', 'approvals.json'), JSON.stringify({
    sessionGrants: [
      { id: 'sg_live1', uses: 7, maxUses: 30, pattern: {} },
      { id: 'sg_dead1', uses: 2, maxUses: 30, revokedAt: 't2' },
    ],
  }));
  return dir;
}

test('resolveRunPaths accepts both shapes; the walk finds the logs', () => {
  const dir = buildState(mkdtempSync(join(tmpdir(), 'community-report-')));
  try {
    for (const input of [dir, join(dir, 'state')]) {
      const paths = resolveRunPaths(input);
      assert.ok(paths.recordRoot.endsWith('sessions'));
      assert.ok(paths.chainDir.endsWith('chains'));
    }
    const logs = findSessionLogs(join(resolveRunPaths(dir).recordRoot));
    assert.equal(logs.length, 2);
    assert.ok(logs.every((l) => /session\..+\.jsonl$/.test(l)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agentStatsFromLog: turns, speech, decisions, and the ask_human outcome', () => {
  const dir = buildState(mkdtempSync(join(tmpdir(), 'community-report-')));
  try {
    const logs = findSessionLogs(resolveRunPaths(dir).recordRoot);
    const byDir = new Map(logs.map((l) => [l.split('/').slice(-2)[0], l]));
    const editor = agentStatsFromLog(readFileSync(byDir.get('community-editor')));
    assert.equal(editor.turns, 2);
    assert.equal(editor.toolCalls.forum_post, 1);
    assert.equal(editor.forumPosts[0].topic, 'nightly-digest');
    assert.match(editor.forumPosts[0].text, /lead with the escalation/);
    assert.equal(editor.answeredBy.watch, 1);
    assert.equal(editor.watchVerdicts, 1);
    assert.equal(editor.askHuman.asked, 1);
    assert.equal(editor.askHuman.answered, 1);
    assert.equal(editor.usage.inputTokens, 1200);
    const publisher = agentStatsFromLog(readFileSync(byDir.get('community-publisher')));
    assert.equal(publisher.approvals, 1);
    assert.equal(publisher.answeredBy.operator, 1);
    assert.equal(publisher.loopguardTrips, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the ledger and the store read back; the report states the negative space', () => {
  const dir = buildState(mkdtempSync(join(tmpdir(), 'community-report-')));
  try {
    const paths = resolveRunPaths(dir);
    const forum = forumFromLedger(paths.forumLedger);
    assert.equal(forum.length, 1);
    assert.equal(forum[0].by, 'community-editor');
    const grants = grantsFromStore(paths.approvals);
    assert.equal(grants.rows.length, 1);
    assert.equal(grants.rows[0].uses, 7);
    assert.equal(grants.revoked.length, 1);
    const logs = findSessionLogs(paths.recordRoot);
    const stats = logs.map((p) => agentStatsFromLog(readFileSync(p)));
    const text = formatReport({ paths, logs, statsByLog: stats, forum, grants });
    assert.equal((text.match(/THE COMMUNITY, AFTER THE RUN/g) ?? []).length, 1, 'the report header prints once');
    assert.equal((text.match(/^  state: /gm) ?? []).length, 1, 'the state line prints once');
    assert.match(text, /THE MEMBERS \(2 session log\(s\)\)/);
    assert.match(text, /editor/);
    assert.match(text, /turns 2 · acts 2 · forum posts 1/);
    assert.match(text, /approvals asked 1 — answered by: operator:1/);
    assert.match(text, /asked the human 1× — answered 1, timed out 0/);
    assert.match(text, /THE FORUM \(1 post\(s\)\)/);
    assert.match(text, /sg_live1 — 7\/30 uses \(23% of budget\)/);
    assert.match(text, /sg_dead1 — REVOKED/);
    assert.match(text, /docket is in-memory by design/);
    assert.match(text, /audit\.mjs.*community-editor\/session\.v4\.jsonl --chain .*community-editor\.chain --roll .*roll\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty run reports its silences instead of omitting them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-report-'));
  try {
    mkdirSync(join(dir, 'state', 'sessions'), { recursive: true });
    mkdirSync(join(dir, 'state', 'chains'), { recursive: true });
    const paths = resolveRunPaths(dir);
    const text = formatReport({ paths, logs: [], statsByLog: [], forum: [], grants: { rows: [], revoked: [] } });
    assert.match(text, /no session logs — a run that seated nobody/);
    assert.match(text, /the community never spoke — negative space is information/);
    assert.match(text, /no grants in the store/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('the run manifest (#229): the report says WHY the run ended, not only what it did', () => {
  const dir = buildState(mkdtempSync(join(tmpdir(), 'community-report-')));
  try {
    writeFileSync(join(dir, 'run.json'), JSON.stringify({
      charter: 'newsroom', runTag: 'bf085b', resumed: true,
      endedAt: '2026-10-19T12:00:00.000Z',
      endReason: 'stopped by the operator (graceful)',
      rounds: 2, turns: 5, benchCasesSeen: 1, tokens: 42000,
      members: { editor: 2, publisher: 3 },
      model: { provider: 'zai', model: 'glm-5.3-flash', members: { editor: 'zai/glm-5.3-flash', publisher: 'zai/glm-5.3-flash' } },
      divergence: { loopguardTrips: 6, humanSeatTimeouts: 3 },
    }, null, 2) + '\n');
    const paths = resolveRunPaths(dir);
    assert.match(paths.runJson, /run\.json$/);
    const run = JSON.parse(readFileSync(paths.runJson, 'utf8'));
    const text = formatReport({ paths, logs: [], statsByLog: [], forum: [], grants: { rows: [], revoked: [] }, run });
    assert.equal((text.match(/THE COMMUNITY, AFTER THE RUN/g) ?? []).length, 1, 'the manifest does not duplicate the header');
    assert.equal((text.match(/^  state: /gm) ?? []).length, 1, 'the manifest does not duplicate the state line');
    assert.match(text, /THE RUN: stopped by the operator \(graceful\) \(run bf085b, resumed\)/);
    assert.match(text, /rounds 2 · turns 5 · bench cases 1 · tokens 42000 · divergence lines: \{"loopguardTrips":6/);
    assert.match(text, /model: zai\/glm-5\.3-flash \(every member\)/, 'the report names the model the run spoke with');
    // a heterogeneous seating names each member on its own route
    const het = formatReport({
      paths: { ...paths, runJson: null }, logs: [], statsByLog: [], forum: [], grants: { rows: [], revoked: [] },
      run: { endReason: 'rounds complete', model: { provider: 'zai', model: 'glm-5.3-flash', members: { editor: 'zai/glm-5.3-flash', publisher: 'deepseek/chat' } } },
    });
    assert.match(het, /model: editor=zai\/glm-5\.3-flash publisher=deepseek\/chat/);
    // a pre-#229 run (no manifest) says so instead of guessing
    const noManifest = formatReport({ paths: { ...paths, runJson: null }, logs: [], statsByLog: [], forum: [], grants: { rows: [], revoked: [] } });
    assert.match(noManifest, /no run\.json — this run predates #229/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
