#!/usr/bin/env node
// community-report — the morning-after read of a live community run
// (#220, umbrella #215). Read-only over the run's durable state: the
// session logs (turns, acts, forum posts, approvals and who answered
// them, watch verdicts, loopguard trips), the forum ledger beside the
// chains, and the approval store (grants minted, used, revoked). No
// runtime cooperation needed — everything it reads is what the chains
// and the store already hold.
//
// Negative space is information: a community that never spoke, never
// filed, never asked — the report SAYS so rather than omitting the
// section, because "nothing happened" is a finding about the run, not
// an absence of data.
//
// Usage: node tools/community-report.mjs <scratch-or-state-dir>
//          (accepts the --out DIR the run printed, or its state/ dir)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { watchVerdictsFromLog } from './watch-report.mjs';

const BIN = 'community-report:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Locate the run's durable state under either shape the driver leaves. */
export function resolveRunPaths(dir) {
  const base = resolve(dir);
  const candidates = [base, join(base, 'state')];
  for (const c of candidates) {
    const paths = {
      recordRoot: join(c, 'sessions'),
      chainDir: join(c, 'chains'),
      approvals: join(c, 'approvals.json'),
      forumLedger: join(c, 'chains', 'forum.jsonl'),
      keyring: join(c, 'keyring'),
    };
    if (existsSync(paths.recordRoot) && existsSync(paths.chainDir)) {
      // the run manifest (#229) lives at the scratch root — beside state/,
      // whichever shape the caller passed
      for (const candidate of [join(c, 'run.json'), join(c, '..', 'run.json')]) {
        if (existsSync(candidate)) { paths.runJson = candidate; break; }
      }
      return paths;
    }
  }
  throw new Error(`${BIN} no run state under ${base} — pass the scratch dir the run kept (it holds state/{sessions,chains,approvals.json})`);
}

/** Walk the record root for session logs (any nesting, the demo's shape). */
export function findSessionLogs(recordRoot) {
  const logs = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (/^session\..+\.jsonl$/.test(entry.name)) logs.push(p);
    }
  };
  walk(recordRoot);
  return logs.sort();
}

/** One member's story from its own log: turns, acts, speech, and every
 *  decision that touched it. Pure: log text in, counts out. The session
 *  id prefers a row that names it and falls back to the DIRECTORY rule
 *  (the session dir's name IS the session id). */
export function agentStatsFromLog(logText, fallbackSessionId = null) {
  const stats = {
    session: fallbackSessionId, turns: 0, steps: 0, toolCalls: {}, forumPosts: [],
    approvals: 0, answeredBy: { operator: 0, watch: 0, replay: 0, denied: 0, unavailable: 0 },
    watchVerdicts: 0, loopguardTrips: 0, askHuman: { asked: 0, answered: 0, timedOut: 0 },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  for (const line of String(logText ?? '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; } // a torn tail never kills the report
    const data = row?.data ?? row;
    if (stats.session == null && typeof row?.session === 'string') stats.session = row.session;
    switch (row?.type) {
      case 'turn/end': stats.turns += 1; break;
      case 'tool/call': {
        stats.steps += 1;
        const name = String(data?.name ?? row.name ?? '?');
        stats.toolCalls[name] = (stats.toolCalls[name] ?? 0) + 1;
        if (name === 'forum_post') {
          try {
            const args = JSON.parse(String(data?.arguments ?? row.arguments ?? '{}'));
            stats.forumPosts.push({ topic: args?.topic ?? '?', text: String(args?.text ?? '').slice(0, 140) });
          } catch { /* a torn argument never kills the report */ }
        }
        if (name === 'ask_human') stats.askHuman.asked += 1;
        break;
      }
      case 'assistant/message': {
        const u = data?.usage ?? {};
        stats.usage.inputTokens += u.inputTokens ?? 0;
        stats.usage.outputTokens += u.outputTokens ?? 0;
        break;
      }
      case 'approval/asked': stats.approvals += 1; break;
      case 'user/message': {
        const source = data?.source ?? {};
        const summary = String(source?.summary ?? '');
        const note = (data?.content ?? []).map((b) => b?.text ?? '').join('');
        if (source.kind === 'compact-approval') {
          if (summary.startsWith('Night watch:')) { stats.answeredBy.watch += 1; stats.watchVerdicts += 1; }
          else if (summary.startsWith('Replay:')) stats.answeredBy.replay += 1;
          else if (summary.startsWith('Approval:')) {
            if (/denied|rejected/i.test(summary)) stats.answeredBy.denied += 1;
            else stats.answeredBy.operator += 1;
          }
          // the human seat's decisions ride the same attribution (the
          // recorded answerer writes the note for whoever decided)
        } else if (source.kind === 'compact-loopguard') {
          stats.loopguardTrips += 1;
        } else if (source.kind === 'compact-community' && /ask_human|No answer within/i.test(note)) {
          if (/No answer within/.test(note)) stats.askHuman.timedOut += 1;
          else stats.askHuman.answered += 1;
        }
        break;
      }
      default: break;
    }
  }
  return stats;
}

/** The forum ledger beside the chains — the readable copy of the speech. */
export function forumFromLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  const posts = [];
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { posts.push(JSON.parse(line)); } catch { continue; }
  }
  return posts;
}

/** Grants from the approval store: minted, used, revoked. */
export function grantsFromStore(storePath) {
  if (!existsSync(storePath)) return { rows: [], revoked: [] };
  let store;
  try { store = JSON.parse(readFileSync(storePath, 'utf8')); } catch { return { rows: [], revoked: [], unreadable: true }; }
  const rows = [];
  const revoked = [];
  const deepFind = (obj, pred, found = []) => {
    if (Array.isArray(obj)) { for (const v of obj) deepFind(v, pred, found); return found; }
    if (obj && typeof obj === 'object') {
      if (pred(obj)) found.push(obj);
      for (const v of Object.values(obj)) deepFind(v, pred, found);
    }
    return found;
  };
  for (const g of deepFind(store, (o) => typeof o.id === 'string' && /^sg_/.test(o.id) && 'uses' in o)) {
    const row = { id: g.id, uses: g.uses ?? 0, maxUses: g.maxUses ?? null, revoked: g.revokedAt != null };
    (row.revoked ? revoked : rows).push(row);
  }
  return { rows, revoked };
}

const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

export function formatReport({ paths, logs, statsByLog, forum, grants, run = null }) {
  const L = [];
  L.push('THE COMMUNITY, AFTER THE RUN — read from the chains and the store, no runtime cooperation');
  L.push(`  state: ${paths.recordRoot.replace(/\/sessions$/, '')}`);
  if (run) {
    L.push(`  THE RUN: ${run.endReason}${run.runTag ? ` (run ${run.runTag}${run.resumed ? ', resumed' : ''})` : ''} — ended ${run.endedAt}`);
    L.push(`    rounds ${run.rounds} · turns ${run.turns} · bench cases ${run.benchCasesSeen} · tokens ${run.tokens}${run.divergence ? ` · divergence lines: ${JSON.stringify(run.divergence)}` : ''}`);
  } else {
    L.push('  THE RUN: no run.json — this run predates #229, its end reason lived only on stdout');
  }
  L.push('THE COMMUNITY, AFTER THE RUN — read from the chains and the store, no runtime cooperation');
  L.push(`  state: ${paths.recordRoot.replace(/\/sessions$/, '')}`);
  L.push('');
  // the members
  L.push(`THE MEMBERS (${statsByLog.length} session log(s))`);
  if (statsByLog.length === 0) L.push('  no session logs — a run that seated nobody, or a path that is not a run');
  for (const s of statsByLog) {
    const name = (s.session ?? 'session').replace(/^community-/, '');
    const decisions = Object.entries(s.answeredBy).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(' ') || 'none';
    L.push(`  ${name}`);
    L.push(`    turns ${s.turns} · acts ${s.steps} · forum posts ${s.forumPosts.length} · tokens ${s.usage.inputTokens + s.usage.outputTokens}`);
    L.push(`    tools: ${Object.entries(s.toolCalls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}`);
    if (s.approvals > 0 || s.watchVerdicts > 0) L.push(`    approvals asked ${s.approvals} — answered by: ${decisions}`);
    if (s.loopguardTrips > 0) L.push(`    LoopGuard trips: ${s.loopguardTrips} (the loop health spoke)`);
    if (s.askHuman.asked > 0) L.push(`    asked the human ${s.askHuman.asked}× — answered ${s.askHuman.answered}, timed out ${s.askHuman.timedOut}`);
    for (const p of s.forumPosts.slice(0, 3)) L.push(`      [${p.topic}] ${p.text}`);
    if (s.forumPosts.length > 3) L.push(`      … +${s.forumPosts.length - 3} more`);
  }
  // the forum
  L.push('');
  L.push(`THE FORUM (${forum.length} post(s))`);
  if (forum.length === 0) L.push('  the community never spoke — negative space is information');
  for (const p of forum.slice(-12)) L.push(`  ${p.id} · ${p.topic} · ${(p.by ?? '?').replace(/^community-/, '')}: ${String(p.text ?? '').slice(0, 120).replace(/\n/g, ' ')}`);
  if (forum.length > 12) L.push(`  … +${forum.length - 12} earlier post(s)`);
  // the fence
  L.push('');
  L.push('THE FENCE (grants the operator pre-minted, as the store holds them)');
  if (grants.rows.length === 0 && grants.revoked.length === 0) L.push('  no grants in the store — every act asked, or nothing happened');
  for (const g of grants.rows) {
    L.push(`  ${g.id} — ${g.uses}${g.maxUses != null ? `/${g.maxUses}` : ''} uses${pct(g.uses, g.maxUses) !== '—' ? ` (${pct(g.uses, g.maxUses)} of budget)` : ''}`);
  }
  for (const g of grants.revoked) L.push(`  ${g.id} — REVOKED (a remedy or an operator act; the row stays, verifiable)`);
  // the docket
  L.push('');
  L.push('THE DOCKET');
  L.push('  the docket is in-memory by design: it lived as long as the run process. The filings');
  L.push('  themselves are durable — every judicature_hear is a tool call on a member\'s chain;');
  L.push(`  this run's logs show ${statsByLog.reduce((n, s) => n + (s.toolCalls.judicature_hear ?? 0), 0)} filing(s) and ${statsByLog.reduce((n, s) => n + (s.toolCalls.judicature_judge ?? 0), 0)} judgment(s).`);
  // the morning-after pointer
  L.push('');
  L.push('VERIFY IT OFFLINE (the record proves itself; this report is a read, not a proof)');
  const roll = existsSync(join(paths.keyring, 'roll.json')) ? join(paths.keyring, 'roll.json') : null;
  const keyringManifest = existsSync(join(paths.keyring, 'keyring.json')) ? join(paths.keyring, 'keyring.json') : null;
  // a session directory's name IS the session id — the chain file follows it
  const sessionIdOfLog = (logPath) => logPath.split('/').slice(-2)[0];
  for (const log of logs.slice(0, 3)) {
    const sid = sessionIdOfLog(log);
    L.push(`  node ${join(ROOT, 'auditor', 'audit.mjs')} ${log} --chain ${join(paths.chainDir, `${sid}.chain`)}${roll && keyringManifest ? ` --roll ${roll} --keyring ${keyringManifest}` : ''}`);
  }
  if (logs.length > 3) L.push(`  … +${logs.length - 3} more session(s)`);
  return L.join('\n');
}

function main() {
  const [dir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!dir) {
    console.error(`usage: node tools/community-report.mjs <scratch-or-state-dir> — the dir the run kept`);
    process.exit(1);
  }
  const paths = resolveRunPaths(dir);
  const logs = findSessionLogs(paths.recordRoot);
  // a session directory's name IS the session id — the display name and
  // the chain-file derivation both ride it
  const sessionIdOfLog = (logPath) => logPath.split('/').slice(-2)[0];
  const statsByLog = logs.map((p) => agentStatsFromLog(readFileSync(p, 'utf8'), sessionIdOfLog(p)));
  const forum = forumFromLedger(paths.forumLedger);
  const grants = grantsFromStore(paths.approvals);
  let run = null;
  if (paths.runJson) {
    try { run = JSON.parse(readFileSync(paths.runJson, 'utf8')); } catch { run = null; }
  }
  process.stdout.write(formatReport({ paths, logs, statsByLog, forum, grants, run }) + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('community-report.mjs')) main();

// exported for the suite
export { main };
