#!/usr/bin/env node
// community-report — the morning-after read of a live community run
// (#220, umbrella #215). Read-only over the run's durable state: the
// session logs (turns, acts, forum posts, passes and their results,
// approvals and who answered them, watch verdicts, loopguard trips), the
// forum ledger beside the chains, and the approval store (grants minted,
// used, revoked). No runtime cooperation needed — everything it reads is
// what the chains and the store already hold.
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
import { classifyResult, resultCallId } from './act-outcome.mjs';

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

/** Word-wrap one long string for the fixed-width report. */
function wrap(text, width) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + 1 + word.length > width) { out.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out;
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

/** Tokens one assistant row spent, counted the way the live launcher's
 *  meter counts them for the cap: input, output, and both cache sides.
 *  A per-member figure that drops the cache reads disagrees with the
 *  manifest's total by an order of magnitude (the v2 archive: ~0.19M
 *  summed against 2.52M metered) — one formula, everywhere. */
export function meteredTokens(usage) {
  const u = usage ?? {};
  return (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0)
    + (Number(u.cacheReadTokens) || 0) + (Number(u.cacheWriteTokens) || 0);
}

/** One member's story from its own log: turns, acts, speech, and every
 *  decision that touched it. Pure: log text in, counts out. The session
 *  id prefers a row that names it and falls back to the DIRECTORY rule
 *  (the session dir's name IS the session id). */
export function agentStatsFromLog(logText, fallbackSessionId = null) {
  const stats = {
    session: fallbackSessionId, turns: 0, steps: 0, toolCalls: {}, forumPosts: [], passCalls: [], passes: [], passRefused: [],
    approvals: 0, answeredBy: { operator: 0, watch: 0, replay: 0, denied: 0, unavailable: 0 },
    watchVerdicts: 0, loopguardTrips: 0, askHuman: { asked: 0, answered: 0, timedOut: 0 },
    usage: { inputTokens: 0, outputTokens: 0, metered: 0 },
    // a call is an attempt; its own result says whether it landed (the
    // v2 finding: two refused filings were counted as two filings)
    refused: [], errors: [], unresolved: 0,
    docket: { hear: { attempted: 0, landed: 0 }, judge: { attempted: 0, landed: 0 } },
  };
  const passByCall = new Map();
  const postByCall = new Map();
  const callName = new Map();
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
        const anyCallId = String(data?.callId ?? row.callId ?? '');
        if (anyCallId) callName.set(anyCallId, name);
        if (name === 'judicature_hear') stats.docket.hear.attempted += 1;
        if (name === 'judicature_judge') stats.docket.judge.attempted += 1;
        if (name === 'forum_post') {
          try {
            const args = JSON.parse(String(data?.arguments ?? row.arguments ?? '{}'));
            const post = { topic: args?.topic ?? '?', text: String(args?.text ?? '').slice(0, 140), landed: null };
            stats.forumPosts.push(post);
            if (anyCallId) postByCall.set(anyCallId, post);
          } catch { /* a torn argument never kills the report */ }
        }
        if (name === 'forum_pass') {
          try {
            const args = JSON.parse(String(data?.arguments ?? row.arguments ?? '{}'));
            const reason = String(args?.reason ?? '').slice(0, 140);
            const callId = String(data?.callId ?? row.callId ?? `call_${stats.steps}`);
            stats.passCalls.push({ reason, callId });
            passByCall.set(callId, reason);
          } catch { /* a torn argument never kills the report */ }
        }
        if (name === 'ask_human') stats.askHuman.asked += 1;
        break;
      }
      case 'tool/result': {
        const callId = resultCallId(data);
        const name = callName.get(callId);
        if (!name) break;
        callName.delete(callId);
        const verdict = classifyResult(data, name);
        if (verdict.outcome === 'refused') stats.refused.push({ tool: name, rule: verdict.rule, result: verdict.result });
        else if (verdict.outcome === 'error') stats.errors.push({ tool: name, result: verdict.result });
        else if (name === 'judicature_hear') stats.docket.hear.landed += 1;
        else if (name === 'judicature_judge') stats.docket.judge.landed += 1;
        const post = postByCall.get(callId);
        if (post) { post.landed = verdict.outcome === 'ok'; postByCall.delete(callId); }
        if (!passByCall.has(callId)) break;
        const content = data?.message?.content ?? data?.content ?? [];
        const text = Array.isArray(content) ? content.map((b) => b?.text ?? '').join('') : String(content);
        const reason = passByCall.get(callId);
        if (/\[forum\] pass recorded/.test(text)) stats.passes.push({ reason });
        else if (/\[forum\] not passed/.test(text) || verdict.outcome === 'refused') {
          stats.passRefused.push({ reason: reason.trim() ? reason : '(empty)', rule: verdict.rule });
        }
        passByCall.delete(callId);
        break;
      }
      case 'assistant/message': {
        const u = data?.usage ?? {};
        stats.usage.inputTokens += u.inputTokens ?? 0;
        stats.usage.outputTokens += u.outputTokens ?? 0;
        stats.usage.metered += meteredTokens(u);
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
  stats.unresolved = callName.size;
  return stats;
}

/** "LG/LG-3×2, JG/judgment-refused×1" — the rules that refused, counted. */
const ruleTally = (rows) => {
  const by = new Map();
  for (const r of rows) by.set(r.rule ?? '?', (by.get(r.rule ?? '?') ?? 0) + 1);
  return [...by].map(([rule, n]) => `${rule}×${n}`).join(', ');
};

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
    // the code the community ran on: outputs never repeat, but runs stay
    // comparable when the tree that produced each is named
    if (run.code?.commit) {
      L.push(`    code: ${(run.code.repo ? String(run.code.repo).replace(/^git@github.com:/, 'github.com/').replace(/\.git$/, '') + ' @ ' : '')}${run.code.commit}${run.code.dirty ? ' (DIRTY TREE — uncommitted changes present)' : ''}${run.code.ref ? ` [${run.code.ref}]` : ''}`);
    } else if (run.code?.note) {
      L.push(`    code: ${run.code.note}`);
    }
    if (run.runtime) {
      L.push(`    runtime: law ${String(run.runtime.law ?? '?').slice(0, 16)}… · ${run.runtime.image ?? '?'} ${String(run.runtime.imageDigest ?? '').slice(0, 19)}… · node ${run.runtime.node ?? '?'}`);
    }
    if (run.charterFile?.name) {
      L.push(`    charter file: ${run.charterFile.name}${run.charterFile.sha256 ? ` (sha256 ${String(run.charterFile.sha256).slice(0, 16)}…)` : ''}`);
    }
    // the goal, verbatim, when the manifest carries it — a report a reader
    // holds without the repo must still say WHAT was debated (the
    // operator's finding: it did not)
    if (run.goal) {
      L.push('    THE GOAL (the charter, verbatim):');
      for (const line of wrap(String(run.goal), 96)) L.push(`      ${line}`);
    }
    // the seats carry their roles: the persona is what each member is FOR
    // — a report without it names five arguers and no convictions
    if (Array.isArray(run.seats) && run.seats.length) {
      L.push('    seats — what each member is FOR (the charter\'s personas):');
      for (const s of run.seats) {
        const head = `      ${s.id}${s.model ? ` (${s.model})` : ''}${s.bench ? ' [bench]' : ''}`;
        if (!s.persona) { L.push(head); continue; }
        const lines = wrap(String(s.persona), 92);
        L.push(`${head} — ${lines[0]}`);
        for (const extra of lines.slice(1)) L.push(`        ${extra}`);
      }
    }
    L.push(`    rounds ${run.rounds} · turns ${run.turns} · bench cases ${run.benchCasesSeen} · tokens ${run.tokens}${run.divergence ? ` · divergence lines: ${JSON.stringify(run.divergence)}` : ''}`);
    // the fields a manifest carries since the act-outcome change: older
    // manifests say nothing here rather than guess
    const lasted = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    if (Number.isFinite(lasted) && lasted >= 0) L.push(`    started ${run.startedAt} — lasted ${Math.round(lasted / 60000)} min`);
    if (run.divergenceObserved) L.push(`    divergence observed: ${JSON.stringify(run.divergenceObserved)} (against the charter's lines above)`);
    if (Array.isArray(run.gatePosts)) {
      L.push(`    gate posts: ${run.gatePosts.length ? run.gatePosts.map((g) => `${g.id} ${g.gate} (${g.by})`).join(' · ') : 'none — no post of this run opens with AGREEMENT:, POSITIONS:, RULING: or VERDICTS:'}`);
    }
    if (run.tokensBySeat && Object.keys(run.tokensBySeat).length) {
      L.push(`    tokens by seat: ${Object.entries(run.tokensBySeat).map(([id, n]) => `${id}=${n}`).join(' ')}`);
    }
    if (run.model?.model) {
      const routes = Object.values(run.model.members ?? {});
      const seatedOn = new Set(routes).size > 1
        ? Object.entries(run.model.members).map(([id, route]) => `${id}=${route}`).join(' ')
        : `${run.model.provider}/${run.model.model} (every member)`;
      L.push(`    model: ${seatedOn}`);
    }
  } else {
    L.push('  THE RUN: no run.json — this run predates #229, its end reason lived only on stdout');
  }
  L.push('');
  // the members
  L.push(`THE MEMBERS (${statsByLog.length} session log(s))`);
  if (statsByLog.length === 0) L.push('  no session logs — a run that seated nobody, or a path that is not a run');
  for (const s of statsByLog) {
    const name = (s.session ?? 'session').replace(/^community-/, '');
    const decisions = Object.entries(s.answeredBy).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(' ') || 'none';
    L.push(`  ${name}`);
    const landed = s.forumPosts.filter((p) => p.landed === true).length;
    const resolved = s.forumPosts.some((p) => p.landed !== null);
    const speech = resolved ? `forum posts ${landed} landed of ${s.forumPosts.length} attempted` : `forum_post calls ${s.forumPosts.length}`;
    L.push(`    turns ${s.turns} · acts ${s.steps} · ${speech} · pass calls ${s.passCalls.length} · tokens ${s.usage.metered} (metered as the cap counts them)`);
    L.push(`    tools: ${Object.entries(s.toolCalls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}`);
    if (s.refused.length) {
      const byTool = new Map();
      for (const r of s.refused) byTool.set(r.tool, (byTool.get(r.tool) ?? 0) + 1);
      L.push(`    REFUSED ${s.refused.length} act(s): ${[...byTool].map(([k, n]) => `${k}×${n}`).join(', ')} — by ${ruleTally(s.refused)}`);
    }
    if (s.errors.length) L.push(`    errored ${s.errors.length} act(s) without naming a rule: ${s.errors.slice(0, 2).map((e) => `${e.tool}: ${e.result}`).join(' | ')}`);
    if (s.approvals > 0 || s.watchVerdicts > 0) L.push(`    approvals asked ${s.approvals} — answered by: ${decisions}`);
    if (s.loopguardTrips > 0) L.push(`    LoopGuard trips: ${s.loopguardTrips} (the loop health spoke)`);
    if (s.askHuman.asked > 0) L.push(`    asked the human ${s.askHuman.asked}× — answered ${s.askHuman.answered}, timed out ${s.askHuman.timedOut}`);
    for (const p of s.forumPosts.slice(0, 3)) L.push(`      [${p.topic}] ${p.text}`);
    if (s.forumPosts.length > 3) L.push(`      … +${s.forumPosts.length - 3} more`);
    if (s.passes.length || s.passRefused.length) {
      L.push(`    passes recorded ${s.passes.length}, refused ${s.passRefused.length} (the result on the chain decides, not the call)`);
    }
    for (const p of s.passes.slice(0, 3)) L.push(`      pass: ${p.reason}`);
    if (s.passes.length > 3) L.push(`      … +${s.passes.length - 3} more pass(es)`);
    for (const p of s.passRefused.slice(0, 3)) L.push(`      pass refused${p.rule ? ` (${p.rule})` : ''}: ${p.reason}`);
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
  L.push('  themselves are durable — every judicature_hear is a tool call on a member\'s chain,');
  L.push('  and its result on the same log says whether it landed:');
  const docketLine = (label, key, tool) => {
    const attempted = statsByLog.reduce((n, s) => n + s.docket[key].attempted, 0);
    const landed = statsByLog.reduce((n, s) => n + s.docket[key].landed, 0);
    const refused = statsByLog.flatMap((s) => s.refused.filter((r) => r.tool === tool));
    const errored = statsByLog.reduce((n, s) => n + s.errors.filter((e) => e.tool === tool).length, 0);
    const silent = attempted - landed - refused.length - errored;
    const parts = [`${landed} landed`];
    if (refused.length) parts.push(`${refused.length} refused (${ruleTally(refused)})`);
    if (errored) parts.push(`${errored} errored`);
    if (silent > 0) parts.push(`${silent} with no result in the log`);
    return `  ${label}: ${attempted} attempt(s) — ${parts.join(', ')}`;
  };
  L.push(docketLine('filings (judicature_hear)', 'hear', 'judicature_hear'));
  L.push(docketLine('judgments (judicature_judge)', 'judge', 'judicature_judge'));
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
