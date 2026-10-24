#!/usr/bin/env node
// community-brief — a derived, citation-bound reading aid for a finished
// community run. It reads the durable archive: run.json, the forum ledger,
// and whichever timeline is available (the session logs on a live run, or
// the embedded DATA in a community-export HTML). It writes a Markdown
// brief; it does not write to the forum, the chains, or the run.
//
// Three disciplines make the brief different from a summary:
//
//   1. THE LEDGER IS ACCEPTED SPEECH, NOT ALL SPEECH. A member can call
//      forum_post and be refused (LoopGuard, a bad topic, a gate). The
//      ledger only holds posts that landed. The timeline holds the
//      attempts. The brief reconciles the two, so "silent" and "denied"
//      are not confused.
//
//   2. A PASS IS NOT A POST. forum_pass is a governed act on the
//      member's own chain: it writes no forum.jsonl row and is not
//      readable as speech. The timeline resolves a recorded pass, a
//      refused pass call (which records no pass), and a call with no
//      visible result. The brief keeps that third category separate from
//      both accepted posts and denied forum_post attempts.
//
//   3. EVERY CLAIM IS DERIVED. Counts, ids, timestamps and hashes come
//      from the archive. The brief does not add a verdict, an endorsement,
//      or a consensus. The latest accepted POSITIONS ledger is quoted;
//      it is not re-scored here.
//
//   node tools/community-brief.mjs <scratch-or-archive-dir> [-o BRIEF.md] [--ledger]
//   node tools/community-brief.mjs <scratch-or-archive-dir> --check BRIEF.md
//
// The first form writes the brief; the second checks a brief's fp_ ids,
// member coverage, and any counts it states against the archive. The
// check is deterministic; a model verifier pass can read the same brief
// afterward.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findSessionLogs, forumFromLedger } from './community-report.mjs';
import { timelineFromLog } from './run-archive.mjs';

const BIN = 'community-brief:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MAX_LEDGER_EXCERPT = 1800;
const MAX_SECTION = 1200;
const ATTEMPT_MATCH_MS = 5_000;
const NOTICE_MATCH_MS = 2_500;

const when = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  return String(v ?? '');
};

const bare = (id, runTag = null) => {
  let s = String(id ?? '');
  s = s.replace(/^community-/, '');
  if (runTag && s.endsWith(`-${runTag}`)) s = s.slice(0, -(runTag.length + 1));
  return s;
};

const sessionFor = (id, runTag = null) => {
  if (String(id ?? '').startsWith('community-')) return String(id);
  return runTag ? `community-${id}-${runTag}` : `community-${id}`;
};

const sha256 = (path) => {
  if (!path || !existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
};

const oneLine = (s, n = 140) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const cell = (s, n = 120) => oneLine(s, n).replace(/\|/g, '\\|');

const passStatusLabel = (status) => (
  status === 'recorded' ? 'recorded'
    : status === 'refused' ? 'refused — no pass'
      : 'call only — outcome unconfirmed'
);

const ms = (v) => {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? t : null;
};

/** Resolve the archive shapes this tool accepts. Unlike resolveRunPaths,
 *  a brief does not require session logs: the public archive intentionally
 *  excludes them, and its export carries the same timeline. */
export function resolveBriefPaths(dir) {
  const outer = resolve(dir);
  const candidates = [outer, join(outer, 'state')];
  let found = null;
  for (const base of candidates) {
    const chainDir = join(base, 'chains');
    if (existsSync(chainDir) || existsSync(join(chainDir, 'forum.jsonl'))) {
      found = { outer, base, chainDir, ledger: join(chainDir, 'forum.jsonl'), sessionsDir: join(base, 'sessions') };
      break;
    }
  }
  if (!found) throw new Error(`${BIN} no chains/forum.jsonl under ${outer} — pass a run directory or its state/ directory`);
  const runCandidates = [join(found.base, 'run.json'), join(found.base, '..', 'run.json'), join(found.outer, 'run.json')];
  found.runJson = runCandidates.find((p) => existsSync(p)) ?? null;
  found.html = findExport(found.outer) ?? findExport(resolve(found.outer, '..'));
  return found;
}

function findExport(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
    return files.length ? join(dir, files[0]) : null;
  } catch {
    return null;
  }
}

/** The export embeds the replay data as `const DATA = {…};` on one line. */
export function parseEmbeddedArchive(html) {
  const marker = 'const DATA = ';
  const start = String(html ?? '').indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  let end = String(html).indexOf('\n', from);
  if (end === -1) end = String(html).indexOf('</script>', from);
  if (end === -1) return null;
  const raw = String(html).slice(from, end).trim().replace(/;\s*$/, '');
  try {
    const data = JSON.parse(raw);
    return data && Array.isArray(data.forum) && Array.isArray(data.timeline) ? data : null;
  } catch {
    return null;
  }
}

/** Read one archive into the shapes the brief needs. */
export function readBriefSources(dir) {
  const paths = resolveBriefPaths(dir);
  let run = null;
  let runError = null;
  if (paths.runJson) {
    try { run = JSON.parse(readFileSync(paths.runJson, 'utf8')); } catch (error) { runError = error.message; }
  }
  const forum = forumFromLedger(paths.ledger);

  let timeline = [];
  let timelineSource = 'none';
  const logs = existsSync(paths.sessionsDir) ? findSessionLogs(paths.sessionsDir) : [];
  if (logs.length > 0) {
    timelineSource = `${logs.length} session log(s)`;
    for (const log of logs) {
      const sid = log.split('/').slice(-2)[0];
      try { timeline.push(...timelineFromLog(readFileSync(log, 'utf8'), sid)); } catch { /* a torn log never kills the brief */ }
    }
  } else if (paths.html && existsSync(paths.html)) {
    const embedded = parseEmbeddedArchive(readFileSync(paths.html, 'utf8'));
    if (embedded) {
      timelineSource = relative(paths.outer, paths.html) || paths.html;
      timeline = embedded.timeline.map((e) => ({ ...e, at: when(e.at) }));
    }
  }
  timeline.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));

  const data = buildBrief({ paths, run, runError, forum, timeline, timelineSource });
  return data;
}

function buildBrief({ paths, run, runError, forum, timeline, timelineSource }) {
  const runTag = run?.runTag ?? null;
  const members = new Map();
  const ensure = (id) => {
    const key = bare(id, runTag);
    if (!key) return null;
    if (!members.has(key)) {
      members.set(key, {
        id: key,
        session: String(id).startsWith('community-') ? String(id) : sessionFor(key, runTag),
        turns: 0,
        timelineTurns: 0,
        posts: 0,
        attempts: 0,
        matched: 0,
        notLanded: 0,
        denied: 0,
        loopguard: 0,
        passCalls: 0,
        passes: 0,
        passRefused: 0,
        passUnconfirmed: 0,
        lastPass: null,
        chainRows: null,
        lastPost: null,
      });
    }
    return members.get(key);
  };

  for (const [id, turns] of Object.entries(run?.members ?? {})) {
    const m = ensure(id);
    if (m) m.turns = Number(turns) || 0;
  }
  for (const post of forum) {
    const m = ensure(post.by);
    if (!m) continue;
    m.posts += 1;
    if (!m.lastPost || post.seq > m.lastPost.seq) m.lastPost = post;
  }
  for (const e of timeline) {
    const m = ensure(e.who);
    if (!m) continue;
    if (e.type === 'turn-done') m.timelineTurns += 1;
    if (e.type === 'notice' && /LoopGuard/i.test(String(e.text ?? ''))) m.loopguard += 1;
  }

  const attempts = [];
  for (const e of timeline) {
    if (e.type !== 'act') continue;
    const text = String(e.text ?? '');
    if (!text.startsWith('forum_post [')) continue;
    const m = ensure(e.who);
    if (!m) continue;
    m.attempts += 1;
    const parsed = /^forum_post \[([^\]]+)\]: ([\s\S]*)$/.exec(text);
    const attempt = {
      member: m.id,
      session: e.who,
      at: e.at,
      topic: parsed?.[1] ?? '?',
      body: parsed?.[2] ?? '',
      post: null,
      notice: null,
    };
    const t = ms(attempt.at);
    const body = oneLine(attempt.body, 160).toLowerCase();
    if (t != null) {
      const hit = forum
        .filter((p) => p.by === e.who)
        .find((p) => {
          const pt = ms(p.at);
          if (pt == null || Math.abs(pt - t) > ATTEMPT_MATCH_MS) return false;
          const ptxt = oneLine(p.text, 160).toLowerCase();
          return body.length > 0 && (ptxt.startsWith(body) || body.startsWith(ptxt));
        });
      if (hit) attempt.post = hit;
      const notice = timeline.find((n) => n.type === 'notice'
        && n.who === e.who
        && /LoopGuard/i.test(String(n.text ?? ''))
        && Math.abs((ms(n.at) ?? 0) - t) <= NOTICE_MATCH_MS
        && (ms(n.at) ?? 0) >= t);
      if (notice) attempt.notice = notice;
    }
    if (attempt.post) { m.matched += 1; } else {
      m.notLanded += 1;
      if (attempt.notice) m.denied += 1;
    }
    attempts.push(attempt);
  }

  // A pass is a pass only when its own result says it was recorded. A
  // refused pass call records no pass; a call with no resolving result is
  // unconfirmed. Keep all three visible without turning any into a post.
  const passes = [];
  for (const e of timeline) {
    if (e.type !== 'pass' && e.type !== 'pass-refused' && e.type !== 'pass-call') continue;
    const m = ensure(e.who);
    if (!m) continue;
    const text = String(e.text ?? '');
    const parsed = /^forum_pass( refused)?: ([\s\S]*)$/.exec(text);
    const status = e.type === 'pass' ? 'recorded' : e.type === 'pass-refused' ? 'refused' : 'unconfirmed';
    const pass = {
      member: m.id,
      session: e.who,
      at: e.at,
      status,
      reason: parsed?.[2] ?? '',
    };
    m.passCalls += 1;
    if (status === 'recorded') {
      m.passes += 1;
      m.lastPass = pass;
    } else if (status === 'refused') {
      m.passRefused += 1;
    } else {
      m.passUnconfirmed += 1;
    }
    passes.push(pass);
  }

  for (const m of members.values()) {
    const chain = join(paths.chainDir, `${m.session}.chain`);
    if (existsSync(chain)) {
      try { m.chainRows = readFileSync(chain, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { m.chainRows = null; }
    }
  }

  const askHuman = [];
  for (const e of timeline) {
    if (e.type !== 'act' || String(e.text ?? '') !== 'ask_human') continue;
    const m = ensure(e.who);
    if (!m) continue;
    const t = ms(e.at);
    const notice = t == null ? null : timeline.find((n) => n.type === 'notice'
      && n.who === e.who
      && /LoopGuard/i.test(String(n.text ?? ''))
      && (ms(n.at) ?? -Infinity) >= t
      && (ms(n.at) ?? Infinity) - t <= NOTICE_MATCH_MS);
    askHuman.push({ member: m.id, at: e.at, notice });
  }

  const ledgerPosts = forum.filter((p) => String(p.text ?? '').trimStart().startsWith('POSITIONS:'));
  const latestLedger = ledgerPosts.length ? ledgerPosts[ledgerPosts.length - 1] : null;
  const postsAfterLedger = latestLedger ? forum.filter((p) => p.seq > latestLedger.seq) : [];
  const laterLedgerAttempts = latestLedger
    ? attempts.filter((a) => !a.post && a.at > (latestLedger.at ?? '') && String(a.body).trimStart().startsWith('POSITIONS:'))
    : [];

  const seqOk = forum.every((p, i) => p.seq === i + 1 && p.id === `fp_${i + 1}`);
  const turnSum = Object.values(run?.members ?? {}).reduce((n, v) => n + (Number(v) || 0), 0);
  const timelineTurns = timeline.filter((e) => e.type === 'turn-done').length;
  const memberRows = [...members.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    paths,
    run,
    runError,
    forum,
    timeline,
    timelineSource,
    attempts,
    passes,
    askHuman,
    latestLedger,
    ledgerPosts,
    postsAfterLedger,
    laterLedgerAttempts,
    members: memberRows,
    checks: {
      forumSeqOk: seqOk,
      runTurns: Number(run?.turns ?? turnSum) || 0,
      turnSum,
      timelineTurns,
      attempts: attempts.length,
      matched: attempts.filter((a) => a.post).length,
      notLanded: attempts.filter((a) => !a.post).length,
      denied: attempts.filter((a) => !a.post && a.notice).length,
      passCalls: passes.length,
      passes: passes.filter((p) => p.status === 'recorded').length,
      passRefused: passes.filter((p) => p.status === 'refused').length,
      passUnconfirmed: passes.filter((p) => p.status === 'unconfirmed').length,
      askHuman: askHuman.length,
      loopguard: timeline.filter((e) => e.type === 'notice' && /LoopGuard/i.test(String(e.text ?? ''))).length,
    },
    provenance: {
      runJson: sha256(paths.runJson),
      forum: sha256(paths.ledger),
      html: sha256(paths.html),
    },
  };
}

function ledgerSections(text) {
  const wanted = [
    'WHAT CLOSED', 'WHAT NARROWED', 'WHAT STANDS', 'UNCHANGED',
    'VERDICT STATE', 'LIVE DISAGREEMENTS', 'ABSENCE',
    'OPEN EDGES', 'REMAINING',
  ];
  const out = [];
  for (const para of String(text ?? '').split(/\n\n+/)) {
    const head = para.slice(0, 90).toUpperCase();
    const key = wanted.find((w) => head.includes(w));
    if (key) out.push({ heading: key, text: para.trim().slice(0, MAX_SECTION) });
  }
  return out;
}

export function renderBrief(data, { fullLedger = false } = {}) {
  const { run, forum, members, checks, latestLedger, postsAfterLedger, laterLedgerAttempts, attempts, passes } = data;
  const L = [];
  const tag = run?.runTag ? ` ${run.runTag}` : '';
  const charter = run?.charter ?? 'community';
  L.push(`# BRIEF — ${charter}${tag}`);
  L.push('');
  L.push('> **Derived reading aid, not a record act.** The forum and chains are the authority.');
  L.push('> Generated by `community-brief` from the archive; no model wrote this.');
  L.push('');
  L.push('## The cut');
  L.push('');
  L.push('| field | value |');
  L.push('|---|---|');
  L.push(`| run | ${charter}${tag}${run?.resumed ? ' (resumed)' : ''} |`);
  L.push(`| ended | ${run?.endReason ?? 'no run.json'} |`);
  L.push(`| rounds | ${run?.rounds ?? '—'} |`);
  L.push(`| turns | ${run?.turns ?? checks.turnSum} |`);
  L.push(`| accepted posts | ${forum.length} |`);
  L.push(`| passes recorded | ${checks.passes} |`);
  L.push(`| pass calls visible | ${checks.passCalls} (${checks.passRefused} refused, ${checks.passUnconfirmed} unconfirmed) |`);
  L.push(`| latest accepted ledger | ${latestLedger ? `${latestLedger.id} (${bare(latestLedger.by, run?.runTag)})` : 'none'} |`);
  L.push(`| posts after it | ${postsAfterLedger.length ? postsAfterLedger.map((p) => p.id).join(', ') : 'none'} |`);
  L.push(`| timeline source | ${data.timelineSource} |`);
  L.push(`| model | ${modelLine(run)} |`);
  L.push(`| divergence | ${run?.divergence ? JSON.stringify(run.divergence) : '—'} |`);
  L.push('');
  L.push('## What the record contains');
  L.push('');
  L.push(`${members.length} member(s) took ${run?.turns ?? checks.turnSum} turn(s); ${forum.length} post(s) landed. ` +
    `${checks.attempts} forum_post attempt(s) were visible in the timeline, ${checks.matched} matched a landed post, ` +
    `${checks.notLanded} did not.`);
  if (data.timelineSource === 'none') {
    L.push('No timeline is present, so no pass call is visible; the ledger cannot show one.');
  } else {
    L.push(`The timeline also shows ${checks.passes} recorded pass(es), ${checks.passRefused} refused pass call(s), ` +
      `and ${checks.passUnconfirmed} pass call(s) with an unconfirmed outcome.`);
  }
  L.push('A pass is a governed act on the member\'s chain, not a forum post.');
  if (!latestLedger) L.push('No accepted `POSITIONS:` ledger is on the forum.');
  else if (postsAfterLedger.length) L.push(`The latest accepted ledger is ${latestLedger.id}; ${postsAfterLedger.length} accepted post(s) follow it.`);
  L.push('');
  L.push('## Members');
  L.push('');
  L.push('| member | turns | accepted posts | attempts | did not land | denied with LoopGuard | passes rec/ref/? | chain rows |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const m of members) {
    L.push(`| ${m.id} | ${m.turns || m.timelineTurns || 0} | ${m.posts} | ${m.attempts} | ${m.notLanded} | ${m.denied} | ${m.passes}/${m.passRefused}/${m.passUnconfirmed} | ${m.chainRows ?? '—'} |`);
  }
  L.push('');
  L.push('`passes rec/ref/?` = recorded / refused / call with an unconfirmed outcome.');
  L.push('');
  L.push('## Speech that did not land');
  L.push('');
  const unlanded = attempts.filter((a) => !a.post);
  if (!unlanded.length) {
    L.push('No attempted-but-unaccepted forum posts were found in the timeline.');
    L.push('');
    L.push('> A ledger-only archive cannot see a recorded `forum_pass`, nor tell a choice of silence from a refused call. `—` in the attempt columns means the timeline was absent, not that no attempt happened.');
  } else {
    L.push('| member | attempted at | topic | first line | immediate notice |');
    L.push('|---|---|---|---|---|');
    for (const a of unlanded) {
      L.push(`| ${a.member} | ${a.at ?? '—'} | ${a.topic} | ${cell(a.body, 100)} | ${a.notice ? cell(a.notice.text, 90) : 'no immediate LoopGuard notice'} |`);
    }
    L.push('');
    L.push('A row here is an attempt the timeline recorded but the forum ledger did not accept. The immediate notice is evidence, not a verdict: another refusal reason may leave no LoopGuard notice.');
  }
  if (data.askHuman.length) {
    L.push('');
    L.push('`ask_human` attempts in the timeline:');
    L.push('');
    L.push('| member | attempted at | immediate notice |');
    L.push('|---|---|---|');
    for (const a of data.askHuman) L.push(`| ${a.member} | ${a.at ?? '—'} | ${a.notice ? cell(a.notice.text, 100) : 'none'} |`);
  }
  L.push('');
  L.push('## Pass calls');
  L.push('');
  L.push('A pass is a governed act on the member\'s own chain; it is not a forum post and adds no `forum.jsonl` row. ' +
    'Only a recorded pass is a declared pass; a refused call records none, and a call whose result is missing or does not record a pass is unconfirmed.');
  L.push('');
  if (data.timelineSource === 'none') {
    L.push('No timeline is available; a ledger-only archive cannot show a `forum_pass` call.');
  } else if (!passes.length) {
    L.push('No `forum_pass` calls were visible in the timeline.');
  } else {
    L.push('| member | called at | status | reason (timeline excerpt) |');
    L.push('|---|---|---|---|');
    for (const p of passes) {
      L.push(`| ${p.member} | ${p.at ?? '—'} | ${passStatusLabel(p.status)} | ${cell(p.reason, 140) || '—'} |`);
    }
    L.push('');
    L.push(`Recorded ${checks.passes}; refused ${checks.passRefused}; unconfirmed ${checks.passUnconfirmed}. ` +
      'A refused pass records no pass; an unconfirmed call is not counted as a recorded pass.');
  }
  L.push('');
  L.push('## The latest accepted ledger');
  L.push('');
  if (!latestLedger) {
    L.push('None on the forum. The brief does not invent one.');
  } else {
    L.push(`${latestLedger.id} — ${bare(latestLedger.by, run?.runTag)} — ${latestLedger.at}. ` +
      (postsAfterLedger.length ? `${postsAfterLedger.map((p) => p.id).join(', ')} follow${postsAfterLedger.length === 1 ? 's' : ''} it.` : 'No accepted posts follow it.'));
    if (laterLedgerAttempts.length) {
      L.push('');
      L.push(`A later ledger revision was attempted but did not land: ${laterLedgerAttempts.map((a) => `${a.at} by ${a.member}`).join('; ')}. ` +
        'The brief therefore treats the latest **accepted** ledger as the latest ledger, and names the attempt separately.');
    }
    L.push('');
    const sections = ledgerSections(latestLedger.text);
    if (fullLedger) {
      L.push('<details><summary>Full latest accepted ledger</summary>');
      L.push('');
      L.push('```text');
      L.push(String(latestLedger.text));
      L.push('```');
      L.push('');
      L.push('</details>');
    } else if (sections.length) {
      for (const s of sections) {
        L.push(`### ${s.heading}`);
        L.push('');
        L.push('```text');
        L.push(s.text);
        L.push('```');
        L.push('');
      }
    } else {
      L.push('```text');
      L.push(String(latestLedger.text).slice(0, MAX_LEDGER_EXCERPT));
      L.push('```');
    }
    const absenceSection = sections.find((s) => /ABSENCE/i.test(s.heading));
    const namedInAbsence = (id) => Boolean(absenceSection)
      && new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(absenceSection.text);
    const absenceIds = absenceSection
      ? [...new Set(unlanded
        .filter((a) => {
          const last = members.find((m) => m.id === a.member)?.lastPost;
          return last
            && last.seq < latestLedger.seq
            && (ms(a.at) ?? 0) > (ms(last.at) ?? 0)
            && namedInAbsence(a.member);
        })
        .map((a) => a.member))]
      : [];
    const absencePassIds = absenceSection
      ? [...new Set(passes
        .filter((p) => {
          if (p.status !== 'recorded') return false;
          const last = members.find((m) => m.id === p.member)?.lastPost;
          return (!last || last.seq < latestLedger.seq)
            && (ms(p.at) ?? 0) > (ms(last?.at) ?? -Infinity)
            && namedInAbsence(p.member);
        })
        .map((p) => p.member))]
      : [];
    const reconciledIds = [...new Set([...absenceIds, ...absencePassIds])];
    if (reconciledIds.length) {
      L.push('### Reading the ledger against the timeline');
      L.push('');
      for (const id of reconciledIds) {
        const rows = unlanded.filter((a) => a.member === id);
        const denied = rows.filter((a) => a.notice);
        const last = members.find((m) => m.id === id)?.lastPost;
        const recorded = passes.filter((p) => p.member === id && p.status === 'recorded'
          && (ms(p.at) ?? 0) > (ms(last?.at) ?? -Infinity));
        const since = last ? 'after it' : 'in the timeline';
        const postClause = rows.length
          ? `The timeline records ${rows.length} forum_post attempt(s) ${since}; ${denied.length} carry an immediate LoopGuard notice.` +
            `${denied.length ? ` The first notice reads: \`${oneLine(denied[0].notice.text, 110)}\`.` : ''}`
          : `No forum_post attempt ${since} is visible in the timeline.`;
        const passClause = recorded.length
          ? ` It also records ${recorded.length} declared pass(es) ${since}; the latest says: ` +
            `\`${oneLine(recorded[recorded.length - 1].reason, 110) || '—'}\`. A pass is a governed act, not a post.`
          : '';
        L.push(`- **${id}:** the ledger's absence language (\`absence\`, \`silent third\`) is accurate about **accepted posts**` +
          `${last ? ` (last accepted ${last.id})` : ''}, not about attempts or declared passes. ${postClause}${passClause}`);
      }
      L.push('');
      L.push('This is a reconciliation, not a re-scoring: it does not turn an attempt into a post, a pass into a post, or absence into consent.');
    }
  }
  L.push('');
  L.push('## Audit');
  L.push('');
  L.push(`- **run manifest:** ${run ? 'present' : `absent${data.runError ? ` (${data.runError})` : ''}`}`);
  L.push(`- **forum ledger:** ${forum.length} post(s); sequence ${checks.forumSeqOk ? 'contiguous' : 'BROKEN'}`);
  L.push(`- **timeline:** ${data.timelineSource}`);
  const turnsMatch = checks.runTurns === checks.turnSum && checks.runTurns === checks.timelineTurns;
  L.push(`- **turns:** run.json ${checks.runTurns}; member sum ${checks.turnSum}; timeline turn-done ${checks.timelineTurns}${turnsMatch ? ' (match)' : ' (mismatch — read the timeline, not the claim)'}`);
  L.push(`- **attempt reconciliation:** ${checks.attempts} attempt(s), ${checks.matched} landed, ${checks.notLanded} did not, ${checks.denied} with an immediate LoopGuard notice`);
  L.push(`- **pass calls:** ${checks.passCalls} visible; ${checks.passes} recorded, ${checks.passRefused} refused, ${checks.passUnconfirmed} unconfirmed`);
  L.push(`- **member coverage:** ${members.length} member(s); every run member, poster, and pass caller is named`);
  L.push(`- **latest ledger:** ${latestLedger ? latestLedger.id : 'none'}; ${postsAfterLedger.length} accepted post(s) after it; ${laterLedgerAttempts.length} later ledger attempt(s) did not land`);
  L.push(`- **provenance:** \`run.json\` ${shortHash(data.provenance.runJson)}; \`forum.jsonl\` ${shortHash(data.provenance.forum)}; export ${shortHash(data.provenance.html)}`);
  L.push('');
  L.push('This is the deterministic audit. It checks citations and counts; it does not read for meaning. A verifier-owned audit should read the same brief and contest any claim the archive does not carry.');
  L.push('');
  L.push('## What this brief does not decide');
  L.push('');
  L.push('- It adds no verdict, endorsement, or consensus.');
  L.push('- It does not treat silence as consent or dissent. A missing post is only a missing post; an attempted-but-denied post is named as such; a recorded pass is named as a pass, not a post.');
  L.push('- It does not treat a pass as speech, consent, or dissent. A refused pass records no pass; an unconfirmed pass call is not counted as a recorded pass.');
  L.push('- It does not replace the forum or the chains; it points to them.');
  L.push('- It does not resolve the open items in the latest ledger. It quotes them.');
  L.push('');
  L.push('## Verify');
  L.push('');
  L.push('```bash');
  const displayDir = data.paths.outer === ROOT
    ? '.'
    : data.paths.outer.startsWith(`${ROOT}/`) ? relative(ROOT, data.paths.outer) : data.paths.outer;
  L.push(`node tools/community-replay.mjs ${displayDir}`);
  L.push(`node tools/community-brief.mjs ${displayDir} --check <this-brief.md>`);
  L.push('```');
  return L.join('\n');
}

function modelLine(run) {
  if (!run?.model?.model) return '—';
  const routes = Object.values(run.model.members ?? {});
  if (new Set(routes).size > 1) return Object.entries(run.model.members).map(([id, r]) => `${id}=${r}`).join(' ');
  return `${run.model.provider}/${run.model.model} (every member)`;
}

function shortHash(h) {
  return h ? `${h.slice(0, 12)}…` : '—';
}

/** Deterministic checks for a brief that may have been edited by hand.
 *  It validates fp ids, member coverage, stated counts, and the word
 *  "unanimous" against the latest accepted ledger. */
export function auditBrief(brief, data) {
  const failures = [];
  const text = String(brief ?? '');
  const max = data.forum.length;
  const cited = [...text.matchAll(/\bfp_(\d+)\b/g)].map((m) => Number(m[1]));
  for (const n of new Set(cited)) {
    if (!Number.isInteger(n) || n < 1 || n > max) failures.push(`fp_${n} is cited but the forum has only fp_1..fp_${max}`);
  }
  for (const m of data.members) {
    if (!new RegExp(`\\b${m.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
      failures.push(`member "${m.id}" is not named`);
    }
  }
  const countChecks = [
    ['accepted posts', data.forum.length, /accepted posts\s*[:|]\s*(\d+)/i],
    ['turns', data.checks.runTurns, /turns\s*[:|]\s*(\d+)/i],
    ['members', data.members.length, /(\d+)\s+member\(s\)/i],
    ['passes recorded', data.checks.passes, /passes recorded\s*[:|]\s*(\d+)/i],
    ['pass calls visible', data.checks.passCalls, /pass calls visible\s*[:|]\s*(\d+)/i],
  ];
  for (const [label, expected, pattern] of countChecks) {
    const m = pattern.exec(text);
    if (m && Number(m[1]) !== expected) failures.push(`${label} says ${m[1]}, archive says ${expected}`);
  }
  if (/\bunanimous\b/i.test(text) && !/unanimous/i.test(String(data.latestLedger?.text ?? ''))) {
    failures.push('the brief says "unanimous" but the latest accepted ledger does not');
  }
  return { ok: failures.length === 0, failures, citations: new Set(cited).size };
}

function main() {
  const argv = process.argv.slice(2);
  let dir = null;
  let out = null;
  let check = null;
  let fullLedger = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-o') { out = argv[i + 1] ? resolve(argv[++i]) : null; continue; }
    if (arg === '--check') { check = argv[i + 1] ? resolve(argv[++i]) : null; continue; }
    if (arg === '--ledger') { fullLedger = true; continue; }
    if (arg.startsWith('-')) continue;
    if (!dir) dir = arg;
  }
  if (!dir || (out === null && argv.includes('-o')) || (check === null && argv.includes('--check'))) {
    console.error('usage: node tools/community-brief.mjs <scratch-or-archive-dir> [-o BRIEF.md] [--ledger]');
    console.error('       node tools/community-brief.mjs <scratch-or-archive-dir> --check BRIEF.md');
    process.exit(1);
  }
  const data = readBriefSources(dir);
  if (check) {
    const result = auditBrief(readFileSync(check, 'utf8'), data);
    if (result.ok) {
      console.log(`community-brief: AUDIT PASS — ${result.citations} citation(s), ${data.forum.length} post(s), ${data.checks.passes} recorded pass(es), ${data.members.length} member(s)`);
      return;
    }
    console.log('community-brief: AUDIT FAIL');
    for (const f of result.failures) console.log(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  const brief = renderBrief(data, { fullLedger });
  if (out) {
    writeFileSync(out, `${brief}\n`, { mode: 0o644 });
    console.log(`community-brief: wrote ${out} (${data.forum.length} post(s), ${data.checks.passes} recorded pass(es), ${data.checks.notLanded} attempted post(s) did not land, ${data.checks.denied} with an immediate LoopGuard notice)`);
  } else {
    process.stdout.write(`${brief}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('community-brief.mjs')) main();
