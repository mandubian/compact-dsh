// The ex-post report (#176 slice 2b): the morning-after read. Extraction and
// formatting over a session log's watch verdicts — pure functions, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { watchVerdictsFromLog, formatWatchReport } from './watch-report.mjs';

const NOTE = (summary, text, seq = 7) => JSON.stringify({
  type: 'user/message', seq, time: 1_700_000_000_000 + seq,
  data: { content: [{ type: 'text', text }], source: { kind: 'compact-approval', plugin: 'compact-approval', form: 'notice', summary } },
});

const VERDICT = (policy, motivation) => `[compact-approval] Gate decision: "bash" (url=https://h.example/x/) [fp_abc] was allowed by the appointed night watch (policy: ${policy}) — it answered under grant sg_abc12345 — nothing was materialized: no cached approval, no new grant; the row's budget paid for this act. Motivation: ${motivation}.`;

test('extraction: the watch verdicts come out in order, with basis and motivation', () => {
  const log = [
    '{"type":"turn/start","seq":0}',
    NOTE('Approval: "bash" allowed once by the operator', '[compact-approval] Gate decision: operator note — not the watch', 3),
    NOTE('Night watch: "bash" allowed (allow-edges) — under the grant\'s terms', VERDICT('allow-edges', 'the row covers this route; its axis refused (page); the appointed policy admits the act'), 7),
    NOTE('Night watch: "bash" denied (deny) — did not run', VERDICT('deny', 'the appointed policy refuses every edge ask').replace('was allowed', 'was denied'), 9),
    'this line is not json',
    '',
  ].join('\n');
  const v = watchVerdictsFromLog(log);
  assert.equal(v.length, 2, 'the operator note is not a watch verdict; a torn line is skipped');
  assert.equal(v[0].summary, 'Night watch: "bash" allowed (allow-edges) — under the grant\'s terms');
  assert.equal(v[0].basis, 'sg_abc12345');
  assert.match(v[0].motivation, /^the row covers this route/);
  assert.equal(v[1].summary, 'Night watch: "bash" denied (deny) — did not run');
});

test('formatting: one block per verdict; an empty log says so plainly', () => {
  assert.equal(formatWatchReport([]), 'no night-watch verdicts in this session');
  const report = formatWatchReport(watchVerdictsFromLog([
    NOTE('Night watch: "bash" allowed (judge) — under the grant\'s terms', VERDICT('judge', 'page is an ordinary pagination parameter'), 5),
  ]));
  assert.match(report, /^1 night-watch verdict\(s\):/);
  assert.match(report, /Night watch: "bash" allowed \(judge\)/);
  assert.match(report, /basis: sg_abc12345/);
  assert.match(report, /motivation: page is an ordinary pagination parameter/);
});
