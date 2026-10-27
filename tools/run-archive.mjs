// The run archive (#215): a finished community run, read back as DATA.
// Reads only durable artifacts — run.json, the forum ledger beside the
// chains, the session logs — no runtime cooperation. This module is the
// shared core of the replay viewer and the static export: both render
// exactly what this returns, so the page and the file can never disagree.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveRunPaths, findSessionLogs, forumFromLedger, meteredTokens } from './community-report.mjs';
import { classifyResult, resultCallId, resultText } from './act-outcome.mjs';

const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) : s; };

/** Timestamps as ISO strings, whatever the logs carried — the live v4
 *  logs write `time` as EPOCH MILLISECONDS (a number), and a renderer
 *  that sliced it as a string died on the first entry (the live
 *  finding). Normalized here, at the source, so every reader sees one
 *  shape. */
const when = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  return String(v ?? '');
};

/** One member's ordered timeline from its own log: turns, governed acts
 *  (each resolved from its own result — see act-outcome.mjs), and the
 *  notices it received — the acts lane of a replay. */
export function timelineFromLog(logText, member) {
  const timeline = [];
  // A pass is only a pass once its own tool/result says it was recorded.
  // Until then the call is an act with an unknown outcome; the acts lane
  // must not color an attempted pass as if the member had passed. The
  // same holds for every act: a call is an attempt until its result
  // says it landed (the v2 finding — two refused filings read as filed).
  const calls = new Map();
  for (const line of String(logText ?? '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; } // a torn tail never kills the archive
    const data = row?.data ?? row;
    const at = when(row?.time);
    switch (row?.type) {
      case 'turn/end':
        timeline.push({ at, who: member, type: 'turn-done', text: `${member} finished a turn` });
        break;
      case 'tool/call': {
        const name = String(data?.name ?? '?');
        let what = name;
        if (name === 'bash' || name === 'forum_post') {
          try {
            const args = JSON.parse(String(data?.arguments ?? '{}'));
            what = name === 'bash' ? `bash: ${cut(args?.command ?? '', 220)}` : `forum_post [${args?.topic}]: ${cut(args?.text ?? '', 220)}`;
          } catch { what = name; }
        } else if (name === 'forum_pass') {
          try {
            const args = JSON.parse(String(data?.arguments ?? '{}'));
            what = `forum_pass: ${cut(args?.reason ?? '', 220)}`;
          } catch { what = 'forum_pass'; }
        } else if (name === 'forum_read') {
          what = 'forum_read';
        } else {
          what = name;
        }
        const entry = { at, who: member, type: name === 'forum_pass' ? 'pass-call' : 'act', text: what };
        timeline.push(entry);
        const callId = String(data?.callId ?? '');
        if (callId) calls.set(callId, { entry, name });
        break;
      }
      case 'tool/result': {
        const callId = resultCallId(data);
        const call = calls.get(callId);
        if (!call) break;
        calls.delete(callId);
        const { entry, name } = call;
        const verdict = classifyResult(data, name);
        if (name === 'forum_pass') {
          // a refused pass arrives two ways: the forum's own "not passed",
          // or a guard's error that never reached the forum (LoopGuard)
          const text = resultText(data);
          if (/\[forum\] pass recorded/.test(text)) {
            entry.type = 'pass';
          } else if (/\[forum\] not passed/.test(text) || verdict.outcome === 'refused') {
            entry.type = 'pass-refused';
            entry.text = entry.text.replace(/^forum_pass: /, 'forum_pass refused: ');
            if (verdict.rule) entry.rule = verdict.rule;
          }
          break;
        }
        Object.assign(entry, verdict);
        break;
      }
      case 'user/message': {
        const source = data?.source ?? {};
        const kind = String(source?.kind ?? '');
        if (kind === 'compact-approval' || kind === 'compact-loopguard') {
          timeline.push({ at, who: member, type: 'notice', text: cut(source?.summary ?? '', 220) });
        }
        break;
      }
      default: break;
    }
  }
  return timeline;
}

/** Tokens a member's own log reports spending, from its assistant rows,
 *  metered the way the cap meters them. Derived: the manifest's `tokens`
 *  is the authority for the cap; this is the per-seat split it lacks. */
export function usageFromLog(logText) {
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, metered: 0 };
  for (const line of String(logText ?? '').split('\n')) {
    if (!line.includes('assistant/message')) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row?.type !== 'assistant/message') continue;
    const u = (row?.data ?? row)?.usage ?? {};
    out.input += Number(u.inputTokens) || 0;
    out.output += Number(u.outputTokens) || 0;
    out.cacheRead += Number(u.cacheReadTokens) || 0;
    out.cacheWrite += Number(u.cacheWriteTokens) || 0;
    out.metered += meteredTokens(u);
  }
  return out;
}

/** Read a finished run as an archive: the run manifest, the full forum,
 *  and each member's ordered timeline. Pure over the directory.
 *  `actOutcomes: true` says every act was resolved from its own result
 *  (an act with no outcome had no result in the log); archives exported
 *  before the field carry no outcomes, and readers must say so. */
export function readArchive(dir) {
  const paths = resolveRunPaths(dir);
  const run = paths.runJson && existsSync(paths.runJson)
    ? JSON.parse(readFileSync(paths.runJson, 'utf8'))
    : null;
  const logs = findSessionLogs(paths.recordRoot);
  const sessionId = (p) => p.split('/').slice(-2)[0];
  const timeline = [];
  const members = [];
  for (const log of logs) {
    const name = sessionId(log);
    const text = readFileSync(log, 'utf8');
    members.push({ session: name, turns: (text.match(/"turn\/end"/g) ?? []).length, tokens: usageFromLog(text) });
    timeline.push(...timelineFromLog(text, name));
  }
  timeline.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  return {
    run,
    actOutcomes: true,
    forum: forumFromLedger(paths.forumLedger),
    timeline,
    members,
  };
}
