#!/usr/bin/env node
// forum-legibility — how readable a community's forum was, from its run
// dir: words per agent post, cross-references a reader must chase (fp_N,
// (n)), quoted commands, legal terms that leaked into the work, and how
// long the agents' questions to the human were, how many forms they put
// to the human, and how many words the human read before each of their
// posts. A heuristic, not a grade: it makes the plain-voice comparison
// (cross-exam vs cross-exam-plain) one command, and the legal-terms list
// is ours — the words our own charters and briefings once taught the
// agents. Some are a charter's own task words (alongside-signing's
// "ledger", "endorse"): read the per-term counts, not only the total.
//
// The human is read from the run's own manifest (run.json seats with
// "human": true). A run dir without one falls back to the session names
// the first human-seat runs used (accuser, human) — said, not guessed.
//
// Usage: node tools/forum-legibility.mjs <run-dir> [<run-dir> …]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGAL_TERMS = ['governed act', 'ledger', 'reproduction', 'attack', 'conced', 'verbatim', 'endorse', 'frozen', 'citable', 'adjudicat', 'load-bearing'];

const words = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;
const refs = (t) => (String(t ?? '').match(/\bfp_\d+\b|\(\d+\)(?:\s*[-–]\s*\(\d+\))?/g) ?? []).length;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// a post's member id, the page's own rule: `community-<id>-<tag>` → id
const memberOf = (by) => String(by ?? '').replace(/^community-/, '').replace(/-[0-9a-f]{6}$/, '');

/** The measures, from parsed forum posts, the human's questions, and —
 *  when known — the human seats and the forms put to the human. */
export function legibility(posts, questions = [], { humans = null, forms = [] } = {}) {
  const isHuman = (p) => (humans ? humans.has(memberOf(p.by)) : /accuser|human/.test(String(p.by ?? '')));
  const agents = posts.filter((p) => !isHuman(p));
  // what the human had in front of them before each answer: the words the
  // other members posted since the human last spoke. An opening post (or a
  // second post on a kept floor) answers nobody and is not counted
  const readBefore = [];
  let since = 0;
  for (const p of posts) {
    if (!isHuman(p)) { since += words(p.text); continue; }
    if (since > 0) readBefore.push(since);
    since = 0;
  }
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
    formsToHuman: forms.length,
    formItems: forms.reduce((s, f) => s + f.items, 0),
    humanAnswers: readBefore.length,
    readBeforeAnswer: median(readBefore),
    readBeforeAnswerMax: Math.max(0, ...readBefore),
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
  const forms = [];
  // the human seats, from the run's own manifest (absent: null — the
  // name fallback in legibility() applies, and the table says so)
  let humans = null;
  const manifest = join(dir, 'run.json');
  if (existsSync(manifest)) {
    try {
      const seats = JSON.parse(readFileSync(manifest, 'utf8')).seats;
      if (Array.isArray(seats)) humans = new Set(seats.filter((s) => s?.human === true).map((s) => s.id));
    } catch { /* an unreadable manifest is the fallback, not a crash */ }
  }
  const sessions = join(state, 'sessions');
  for (const ws of existsSync(sessions) ? readdirSync(sessions) : []) {
    for (const s of readdirSync(join(sessions, ws))) {
      const log = join(sessions, ws, s, 'session.v4.jsonl');
      if (!existsSync(log)) continue;
      for (const line of readFileSync(log, 'utf8').split('\n')) {
        if (!line.includes('ask_human') && !line.includes('decision_form')) continue;
        try {
          const e = JSON.parse(line);
          if (e.type !== 'tool/call') continue;
          const args = JSON.parse(e.data?.arguments ?? '{}');
          if (e.data?.name === 'ask_human') questions.push(String(args.question ?? ''));
          if (e.data?.name === 'decision_form') {
            let items = 0;
            try { items = JSON.parse(args.items ?? '[]').length; } catch { /* a malformed form was refused */ }
            forms.push({ title: String(args.title ?? ''), items });
          }
        } catch { /* a partial line is not a question */ }
      }
    }
  }
  return { posts, questions, seen: { humans, forms } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) { console.error('usage: node tools/forum-legibility.mjs <run-dir> [<run-dir> …]'); process.exit(2); }
  const rows = dirs.map((d) => {
    const { posts, questions, seen } = readRun(d);
    return { run: d.replace(/\/+$/, '').split('/').pop(), humansFrom: seen.humans ? 'run.json' : 'names (accuser|human)', ...legibility(posts, questions, seen) };
  });
  const cols = ['agentPosts', 'wordsMedian', 'wordsTotal', 'references', 'commands', 'legalTerms', 'questionsToHuman', 'questionCharsMax', 'formsToHuman', 'formItems', 'humanAnswers', 'readBeforeAnswer', 'readBeforeAnswerMax'];
  const w = (c) => Math.max(18, c.length + 2);
  console.log(['run'.padEnd(22), ...cols.map((c) => c.padStart(w(c)))].join(''));
  for (const r of rows) console.log([r.run.padEnd(22), ...cols.map((c) => String(r[c]).padStart(w(c)))].join(''));
  for (const r of rows) console.log(`${r.run}: legal terms ${JSON.stringify(r.legalTermsBy)} · the human read from ${r.humansFrom}`);
}
