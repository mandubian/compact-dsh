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
    row('tool/call', { callId: 'p1', name: 'forum_pass', arguments: JSON.stringify({ reason: 'nothing new to add; the digest carries my position' }) }),
    row('tool/result', { message: { toolCallId: 'p1', content: [{ type: 'text', text: '[forum] pass recorded — not a post.' }] } }),
    row('tool/call', { callId: 'p2', name: 'forum_pass', arguments: JSON.stringify({ reason: '   ' }) }),
    row('tool/result', { message: { toolCallId: 'p2', content: [{ type: 'text', text: '[forum] not passed: a pass needs a reason' }] } }),
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
    assert.equal(editor.toolCalls.forum_pass, 2);
    assert.equal(editor.forumPosts[0].topic, 'nightly-digest');
    assert.match(editor.forumPosts[0].text, /lead with the escalation/);
    assert.equal(editor.passCalls.length, 2, 'both calls are visible as attempts');
    assert.equal(editor.passes.length, 1, 'only the result on the chain makes a pass accepted');
    assert.equal(editor.passRefused.length, 1, 'a refused pass is named as refused, not counted as a pass');
    assert.match(editor.passes[0].reason, /nothing new to add/);
    assert.equal(editor.passRefused[0].reason, '(empty)');
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
    // the fixture's forum_post carries no result row: the report counts
    // the CALL and says so, never "1 post" — the forum ledger is the speech
    assert.match(text, /turns 2 · acts 4 · forum_post calls 1 · pass calls 2/);
    assert.match(text, /passes recorded 1, refused 1 \(the result on the chain decides, not the call\)/);
    assert.match(text, /pass: nothing new to add; the digest carries my position/);
    assert.match(text, /pass refused: \(empty\)/);
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

test('a call is an attempt: refused filings, judgments and passes are counted by their own results (the v2 finding)', () => {
  // the shapes are the live logs' own: a LoopGuard refusal arrives as an
  // error naming its rule; a refused judgment arrives as PLAIN text
  // ([JG/judgment-refused], isError false) — both must read as refused
  const lg3 = 'Error: [LG/LG-3] loop guard trip (RotatingPollingPattern): 16 calls cycled through only 5 distinct operations';
  const log = [
    row('tool/call', { callId: 'h1', name: 'judicature_hear', arguments: '{}' }),
    row('tool/result', { message: { toolCallId: 'h1', isError: true, content: [{ type: 'text', text: lg3 }] } }),
    row('tool/call', { callId: 'a1', name: 'ask_human', arguments: '{}' }),
    row('tool/result', { message: { toolCallId: 'a1', isError: true, content: [{ type: 'text', text: lg3 }] } }),
    row('tool/call', { callId: 'h2', name: 'judicature_hear', arguments: '{}' }),
    row('tool/result', { message: { toolCallId: 'h2', isError: false, content: [{ type: 'text', text: '[J-3] case case_100982a4 filed — the record states the claim' }] } }),
    row('tool/call', { callId: 'j1', name: 'judicature_judge', arguments: '{}' }),
    row('tool/result', { message: { toolCallId: 'j1', isError: false, content: [{ type: 'text', text: '[JG/judgment-refused] the judgment refuses to land: seat "member-review" is not among the panel\'s resolved seats' }] } }),
    row('tool/call', { callId: 'j2', name: 'judicature_judge', arguments: '{}' }),
    row('tool/result', { message: { toolCallId: 'j2', isError: false, content: [{ type: 'text', text: '[J-3] judgment landed on case_100982a4 — attributed to seat chair' }] } }),
    row('tool/call', { callId: 'f1', name: 'forum_post', arguments: JSON.stringify({ topic: 'floor', text: 'MAPPING: the positions' }) }),
    row('tool/result', { message: { toolCallId: 'f1', isError: false, content: [{ type: 'text', text: '[forum] fp_20 posted to floor (20 post(s) in topic).' }] } }),
    row('tool/call', { callId: 'f2', name: 'forum_post', arguments: JSON.stringify({ topic: 'floor', text: 'a draft that never lands' }) }),
    row('tool/result', { message: { toolCallId: 'f2', isError: true, content: [{ type: 'text', text: 'Error: [LG/LG-5] loop guard trip (RedundantRosterPolling)' }] } }),
    row('tool/call', { callId: 'p1', name: 'forum_pass', arguments: JSON.stringify({ reason: 'nothing to add' }) }),
    row('tool/result', { message: { toolCallId: 'p1', isError: true, content: [{ type: 'text', text: 'Error: [LG/LG-5] loop guard trip (RedundantRosterPolling)' }] } }),
    row('tool/call', { callId: 'h3', name: 'judicature_hear', arguments: '{}' }),
    row('assistant/message', { usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 5 } }),
  ].join('\n');
  const stats = agentStatsFromLog(log, 'community-filer-a980e1');
  assert.deepEqual(stats.docket, { hear: { attempted: 3, landed: 1 }, judge: { attempted: 2, landed: 1 } });
  assert.deepEqual(stats.refused.map((r) => `${r.tool}:${r.rule}`), [
    'judicature_hear:LG/LG-3', 'ask_human:LG/LG-3', 'judicature_judge:JG/judgment-refused', 'forum_post:LG/LG-5', 'forum_pass:LG/LG-5',
  ]);
  assert.equal(stats.passRefused.length, 1, 'a guard-refused pass is a refused pass, not an unconfirmed one');
  assert.equal(stats.unresolved, 1, 'the call with no result stays unresolved');
  assert.equal(stats.usage.metered, 1015, 'tokens are metered the way the cap meters them');
  const dir = mkdtempSync(join(tmpdir(), 'community-report-'));
  try {
    mkdirSync(join(dir, 'state', 'sessions'), { recursive: true });
    mkdirSync(join(dir, 'state', 'chains'), { recursive: true });
    const text = formatReport({ paths: resolveRunPaths(dir), logs: [], statsByLog: [stats], forum: [], grants: { rows: [], revoked: [] } });
    assert.match(text, /forum posts 1 landed of 2 attempted/);
    assert.match(text, /REFUSED 5 act\(s\): judicature_hear×1, ask_human×1, judicature_judge×1, forum_post×1, forum_pass×1 — by LG\/LG-3×2, JG\/judgment-refused×1, LG\/LG-5×2/);
    assert.match(text, /filings \(judicature_hear\): 3 attempt\(s\) — 1 landed, 1 refused \(LG\/LG-3×1\), 1 with no result in the log/);
    assert.match(text, /judgments \(judicature_judge\): 2 attempt\(s\) — 1 landed, 1 refused \(JG\/judgment-refused×1\)/);
    assert.doesNotMatch(text, /show \d+ filing\(s\)/, 'the old call count is gone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the pass overflow stays attached to the passes it summarizes', () => {
  const lines = [];
  for (let i = 1; i <= 4; i += 1) {
    lines.push(row('tool/call', { callId: `p${i}`, name: 'forum_pass', arguments: JSON.stringify({ reason: `quiet ${i}` }) }));
    lines.push(row('tool/result', { message: { toolCallId: `p${i}`, content: [{ type: 'text', text: '[forum] pass recorded — not a post.' }] } }));
  }
  lines.push(row('tool/call', { callId: 'p5', name: 'forum_pass', arguments: JSON.stringify({ reason: 'nope' }) }));
  lines.push(row('tool/result', { message: { toolCallId: 'p5', content: [{ type: 'text', text: '[forum] not passed: a pass needs a reason' }] } }));
  const stats = agentStatsFromLog(lines.join('\n'), 'community-quiet');
  const text = formatReport({
    paths: { recordRoot: '/tmp/run/state/sessions', keyring: '/tmp/run/state/keyring', chainDir: '/tmp/run/state/chains' },
    logs: [], statsByLog: [stats], forum: [], grants: { rows: [], revoked: [] },
  });
  const overflow = text.indexOf('… +1 more pass(es)');
  const refused = text.indexOf('pass refused: nope');
  assert.ok(overflow >= 0, 'the overflow line is printed');
  assert.ok(refused > overflow, 'the overflow line stays with the passes, before the refused list');
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
    // the provenance axis (#262): the code the run rode is named — clean,
    // dirty, not-git, and legacy each say exactly what they were, the way
    // the page's dedicated test pins its own rendering
    const prov = (code, runtime, charterFile) => formatReport({
      paths: { ...paths, runJson: null }, logs: [], statsByLog: [], forum: [], grants: { rows: [], revoked: [] },
      run: {
        endReason: 'rounds complete',
        ...(code ? { code } : {}),
        ...(runtime ? { runtime } : {}),
        ...(charterFile ? { charterFile } : {}),
      },
    });
    const clean = prov(
      { repo: 'git@github.com:mandubian/compact-dsh.git', ref: 'main', commit: '6954957aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { node: 'v22.23.2', image: 'dsh-tools:basic', imageDigest: 'sha256:f3ab0123', law: '27bb7078fe9aea5067a8e95b174f54bd8ae77c78fce7b1b06dd760690caf2c95' },
      { name: 'newsroom.json', sha256: '9c1e0123aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    );
    assert.match(clean, /code: github\.com\/mandubian\/compact-dsh @ 6954957aaaa.*\[main\]/, 'the commit is named with its origin');
    assert.match(clean, /runtime: law 27bb7078fe9aea50… · dsh-tools:basic sha256:f3ab0123… · node v22\.23\.2/);
    assert.match(clean, /charter file: newsroom\.json \(sha256 9c1e0123aaaaaaaa…\)/);
    assert.doesNotMatch(clean, /DIRTY/);
    const dirty = prov({ commit: 'deadbeefdead', dirty: true }, null, null);
    assert.match(dirty, /deadbeefdead \(DIRTY TREE — uncommitted changes present\)/);
    const notGit = prov({ note: 'not a git checkout (or git absent) — the code state is not named' }, null, null);
    assert.match(notGit, /code: not a git checkout \(or git absent\)/);
    // the legacy manifest (pre-#262) renders no provenance lines at all
    const legacy = prov(null, null, null);
    assert.doesNotMatch(legacy, /code: /);
    assert.doesNotMatch(legacy, /runtime: /);
    assert.doesNotMatch(legacy, /charter file: /);
    // the act-outcome manifest fields: length, observed divergence, gate
    // posts and the per-seat split — each printed only when present
    const fresh = formatReport({
      paths: { ...paths, runJson: null }, logs: [], statsByLog: [], forum: [], grants: { rows: [], revoked: [] },
      run: {
        endReason: 'token cap: 2500000', startedAt: '2026-10-26T14:45:00.000Z', endedAt: '2026-10-26T15:20:45.390Z',
        divergence: { loopguardTrips: 10 }, divergenceObserved: { loopguardTrips: 24, humanSeatTimeouts: 0 },
        gatePosts: [], tokensBySeat: { frugal: 700000, 'bench-1': 0 },
      },
    });
    assert.match(fresh, /started 2026-10-26T14:45:00\.000Z — lasted 36 min/);
    assert.match(fresh, /divergence observed: \{"loopguardTrips":24,"humanSeatTimeouts":0\}/);
    assert.match(fresh, /gate posts: none — no post of this run opens with/);
    assert.match(fresh, /tokens by seat: frugal=700000 bench-1=0/);
    assert.doesNotMatch(legacy, /started |divergence observed|gate posts|tokens by seat/, 'an older manifest stays silent');
    // a pre-#229 run (no manifest) says so instead of guessing
    const noManifest = formatReport({ paths: { ...paths, runJson: null }, logs: [], statsByLog: [], forum: [], grants: { rows: [], revoked: [] } });
    assert.match(noManifest, /no run\.json — this run predates #229/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
