#!/usr/bin/env node
// forum-legibility — how readable a community's forum was, from its run
// dir: words per agent post, cross-references a reader must chase (fp_N,
// (n)), quoted commands, legal terms that leaked into the work, and how
// long the agents' questions to the human were. A heuristic, not a grade:
// it makes the plain-voice comparison (cross-exam vs cross-exam-plain) one
// command, and the legal-terms list is ours — the words our own charters
// and briefings once taught the agents.
//
// Usage: node tools/forum-legibility.mjs <run-dir> [<run-dir> …]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGAL_TERMS = ['governed act', 'ledger', 'reproduction', 'attack', 'conced', 'verbatim', 'endorse', 'frozen', 'citable', 'adjudicat', 'load-bearing'];

const words = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;
const refs = (t) => (String(t ?? '').match(/\bfp_\d+\b|\(\d+\)(?:\s*[-–]\s*\(\d+\))?/g) ?? []).length;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** The measures, from parsed forum posts and the human's questions. */
export function legibility(posts, questions = []) {
  const agents = posts.filter((p) => !/accuser|human/.test(String(p.by ?? '')));
  const all = agents.map((p) => String(p.text ?? '')).join('\n').toLowerCase();
  const terms = Object.fromEntries(LEGAL_TERMS.map((t) => [t, all.split(t).length - 1]).filter(([, n]) => n > 0));
  return {
    agentPosts: agents.length,
    wordsMedian: median(agents.map((p) => words(p.text))),
    wordsTotal: agents.reduce((s, p) => s + words(p.text), 0),
    references: agents.reduce((s, p) => s + refs(p.text), 0),
    commands: agents.reduce((s, p) => s + (String(p.text ?? '').match(/node --input-type|\$ node /g) ?? []).length, 0),
    legalTerms: Object.values(terms).reduce((a, b) => a + b, 0),
    legalTermsBy: terms,
    questionsToHuman: questions.length,
    questionCharsMax: Math.max(0, ...questions.map((q) => q.length)),
  };
}

/** Read a run dir (the --out the launcher kept). */
export function readRun(dir) {
  const state = existsSync(join(dir, 'state')) ? join(dir, 'state') : dir;
  const forumFile = join(state, 'chains', 'forum.jsonl');
  const posts = existsSync(forumFile)
    ? readFileSync(forumFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((p) => p.id)
    : [];
  const questions = [];
  const sessions = join(state, 'sessions');
  for (const ws of existsSync(sessions) ? readdirSync(sessions) : []) {
    for (const s of readdirSync(join(sessions, ws))) {
      const log = join(sessions, ws, s, 'session.v4.jsonl');
      if (!existsSync(log)) continue;
      for (const line of readFileSync(log, 'utf8').split('\n')) {
        if (!line.includes('ask_human')) continue;
        try {
          const e = JSON.parse(line);
          if (e.type === 'tool/call' && e.data?.name === 'ask_human') questions.push(String(JSON.parse(e.data.arguments ?? '{}').question ?? ''));
        } catch { /* a partial line is not a question */ }
      }
    }
  }
  return { posts, questions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) { console.error('usage: node tools/forum-legibility.mjs <run-dir> [<run-dir> …]'); process.exit(2); }
  const rows = dirs.map((d) => ({ run: d.replace(/\/+$/, '').split('/').pop(), ...legibility(...Object.values(readRun(d))) }));
  const cols = ['agentPosts', 'wordsMedian', 'wordsTotal', 'references', 'commands', 'legalTerms', 'questionsToHuman', 'questionCharsMax'];
  console.log(['run'.padEnd(22), ...cols.map((c) => c.padStart(18))].join(''));
  for (const r of rows) console.log([r.run.padEnd(22), ...cols.map((c) => String(r[c]).padStart(18))].join(''));
  for (const r of rows) console.log(`${r.run}: legal terms ${JSON.stringify(r.legalTermsBy)}`);
}
