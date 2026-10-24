// The run archive (#215): a finished community run, read back as DATA.
// Reads only durable artifacts — run.json, the forum ledger beside the
// chains, the session logs — no runtime cooperation. This module is the
// shared core of the replay viewer and the static export: both render
// exactly what this returns, so the page and the file can never disagree.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveRunPaths, findSessionLogs, forumFromLedger } from './community-report.mjs';

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
 *  (pass calls, with recorded/refused resolved from their own results),
 *  and the notices it received — the acts lane of a replay. */
export function timelineFromLog(logText, member) {
  const timeline = [];
  // A pass is only a pass once its own tool/result says it was recorded.
  // Until then the call is an act with an unknown outcome; the acts lane
  // must not color an attempted pass as if the member had passed.
  const passCalls = new Map();
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
        if (name === 'forum_pass') {
          const callId = String(data?.callId ?? '');
          if (callId) passCalls.set(callId, entry);
        }
        break;
      }
      case 'tool/result': {
        const callId = String(data?.message?.toolCallId ?? data?.toolCallId ?? data?.callId ?? '');
        const entry = passCalls.get(callId);
        if (!entry) break;
        const content = data?.message?.content ?? data?.content ?? [];
        const text = Array.isArray(content) ? content.map((b) => b?.text ?? '').join('') : String(content);
        if (/\[forum\] pass recorded/.test(text)) {
          entry.type = 'pass';
        } else if (/\[forum\] not passed/.test(text)) {
          entry.type = 'pass-refused';
          entry.text = entry.text.replace(/^forum_pass: /, 'forum_pass refused: ');
        }
        passCalls.delete(callId);
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

/** Read a finished run as an archive: the run manifest, the full forum,
 *  and each member's ordered timeline. Pure over the directory. */
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
    members.push({ session: name, turns: (text.match(/"turn\/end"/g) ?? []).length });
    timeline.push(...timelineFromLog(text, name));
  }
  timeline.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  return {
    run,
    forum: forumFromLedger(paths.forumLedger),
    timeline,
    members,
  };
}
