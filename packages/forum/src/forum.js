// The pure model of the community forum — no I/O, no dsh: topics, posts,
// ids, boards, renders. The plugin (./index.js) owns the surfaces; this file
// is the part a test can exhaust.
//
// Posts carry ONE global sequence across all topics (fp_1, fp_2, …), not a
// per-topic counter: `since` reads stay a single monotonic number per member
// regardless of how many topics they follow, and the ledger beside the
// chains is one append-only file in posting order.
//
// A PASS is not a post. It is a member's declared choice not to speak this
// turn: it enters no topic, has no fp_ number, never appears in forum_read,
// and is never appended to the speech ledger. Its record is the tool
// call/result pair on the member's own chain — the same place every other
// governed act lives.
//
// A HEADLINE is the author's own one-sentence conclusion, carried beside the
// text. It exists for the reader with the least time — the human member at
// the page reads the headlines, and opens a post only when they need it.
// A community can REQUIRE it (the charter's "headlines"): then a post longer
// than one line of MAX_HEADLINE_WORDS words carries one, and a short post is
// its own headline (the tool's schema asks every call for one — a short
// post repeats its text). Asked for in prose, members wrote 300-word posts
// anyway; a required field and a refusal are what a model actually follows.
//
// ISSUES untangle a discussion (the charter's "issues"). A member OPENS an
// issue with a title — one claim others can agree or disagree with, written
// once, standing alone — and the forum names it issue_1, issue_2, …. A post then
// carries its argument in PARTS, one per issue: the issue, the author's
// stance on it (agree, disagree, unsure), and the argument. The forum
// writes the post's text from the parts, each under its issue's title, so
// every reader of the text still reads the whole post; the parts record
// where each argument sits in it. Reading one issue is then reading its
// parts in order — not ten posts that each mix four points (the
// alongside-signing-4 finding: to follow one contested line, 2,398 words,
// 43% of them about it). Issues are opened by the members, never declared
// by a charter: the structure holds for any topic.

export const TOPIC_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_POST_CHARS = 8000;
export const MAX_PASS_REASON_CHARS = 2000;
export const MAX_HEADLINE_WORDS = 20;
export const MAX_HEADLINE_CHARS = 200;
export const MAX_ISSUE_TITLE_WORDS = 25;
export const MAX_ISSUE_TITLE_CHARS = 240;
export const MAX_PARTS = 12;
export const STANCES = Object.freeze(['agree', 'disagree', 'unsure']);
export const DEFAULT_READ_LIMIT = 50;
export const MAX_READ_LIMIT = 200;

export class Forum {
  constructor() {
    this.posts = [];
    this.topics = new Map(); // topic -> { topic, count, lastSeq, lastAt }
    this.issues = new Map(); // issue_n -> { id, title, openedBy, openedIn, at }
  }

  /** Check one post as the forum would take it, recording nothing: the
   *  text it would carry (written from the parts, when given), its
   *  headline, its parts' places, and the issues it would open. With
   *  `parts`, the text is written from them (an intro `text` first, when
   *  given); with `requireParts`, a post that is not short must carry at
   *  least one. Throws naming what to change — the same refusal the post
   *  would get, so a seat can check a human's post before it is sent. */
  check({ text, headline, parts, requireHeadline = false, requireParts = false }) {
    let body;
    let meta = null;
    const opened = [];
    if (Array.isArray(parts) && parts.length) {
      const clean = normalizeParts(parts, this.issues);
      const intro = typeof text === 'string' ? text.trim() : '';
      let next = this.issues.size + 1;
      const resolved = clean.map((part) => {
        if (part.open === undefined) return { ...part, issue: part.on, title: this.issues.get(part.on).title };
        const issue = `issue_${next++}`;
        opened.push({ id: issue, title: part.open });
        return { ...part, issue, title: part.open, opened: true };
      });
      ({ text: body, parts: meta } = composeParts(intro, resolved));
      body = postText(body);
    } else {
      if (parts !== undefined && parts !== null && !Array.isArray(parts)) throw new Error('parts is a list — one entry per issue');
      body = postText(text);
      if (requireParts && !isShortPost(body)) {
        throw new Error(
          `a post longer than one line of ${MAX_HEADLINE_WORDS} words carries its argument in parts, one per issue — ` +
          '{"on": "issue_3", "stance": "agree|disagree|unsure", "text": "…"} for an open issue, or ' +
          '{"open": "one claim others can agree or disagree with", "stance": "…", "text": "…"} to open one');
      }
    }
    const head = postHeadline(headline, body, { required: requireHeadline });
    return { text: body, headline: head, parts: meta, opened };
  }

  /** Append one post. Throws on an invalid topic or body — never silently
   *  repairs what a member tried to say (the caller renders the reason).
   *  Everything is checked (check()) before anything is recorded. */
  post({ by, topic, text, headline, parts, requireHeadline = false, requireParts = false, now = Date.now() }) {
    const name = normalizeTopic(topic);
    const seq = this.posts.length + 1;
    const { text: body, headline: head, parts: meta, opened } = this.check({ text, headline, parts, requireHeadline, requireParts });
    const post = {
      id: `fp_${seq}`, seq, topic: name,
      by: typeof by === 'string' && by ? by : null,
      at: new Date(now).toISOString(), text: body,
      ...(head ? { headline: head } : {}),
      ...(meta ? { parts: meta } : {}),
    };
    for (const o of opened) this.issues.set(o.id, { id: o.id, title: o.title, openedBy: post.by, openedIn: post.id, at: post.at });
    this.posts.push(post);
    const row = this.topics.get(name) ?? { topic: name, count: 0, lastSeq: 0, lastAt: null };
    row.count += 1;
    row.lastSeq = seq;
    row.lastAt = post.at;
    this.topics.set(name, row);
    return post;
  }

  /** The posts of one topic (or every topic, when none is named) after
   *  `since`, newest-last, bounded by `limit`. */
  read({ topic, since = 0, limit = DEFAULT_READ_LIMIT } = {}) {
    const cap = Math.min(Math.max(1, Math.trunc(limit) || DEFAULT_READ_LIMIT), MAX_READ_LIMIT);
    const from = Math.max(0, Math.trunc(since) || 0);
    const pool = topic === undefined ? this.posts : this.posts.filter((p) => p.topic === normalizeTopic(topic));
    return pool.filter((p) => p.seq > from).slice(-cap);
  }

  /** Topics with counts and last activity, most recently active first. */
  board() {
    return [...this.topics.values()].sort((a, b) => b.lastSeq - a.lastSeq).map((r) => ({ ...r }));
  }

  stats() {
    return { topics: this.topics.size, posts: this.posts.length, ...(this.issues.size ? { issues: this.issues.size } : {}) };
  }

  /** One issue's argument, in posting order: every part on it, its text cut
   *  from its post exactly where the post recorded it. */
  thread(issue) {
    if (!this.issues.has(issue)) throw new Error(`no issue ${String(issue).slice(0, 20)} — the open issues are ${[...this.issues.keys()].join(', ') || 'none yet'}`);
    const out = [];
    for (const p of this.posts) {
      for (const part of p.parts ?? []) {
        if (part.issue !== issue) continue;
        out.push({ post: p.id, by: p.by, at: p.at, stance: part.stance, ...(part.opened ? { opened: true } : {}), text: p.text.slice(part.from, part.to) });
      }
    }
    return out;
  }

  /** Every issue with where each author stands now: their LATEST stance on
   *  it, and the post that said so. Issue order is opening order. */
  issueBoard() {
    const rows = new Map([...this.issues.values()].map((i) => [i.id, { ...i, stances: {}, posts: [], lastSeq: 0 }]));
    for (const p of this.posts) {
      for (const part of p.parts ?? []) {
        const row = rows.get(part.issue);
        if (!row) continue;
        row.stances[p.by ?? 'unknown'] = { stance: part.stance, post: p.id };
        if (!row.posts.includes(p.id)) row.posts.push(p.id);
        row.lastSeq = p.seq;
      }
    }
    return [...rows.values()];
  }

  /** Ingest ONE ledger row at boot (#227): the board resumes where the
   *  ledger left off instead of beginning empty. Strict continuity — the
   *  id must match the seq, the seq must continue the file's own order —
   *  so a replayed board is exactly the board that was posted, never an
   *  approximation of it. Throws on the first violation; the caller owns
   *  what happens to the rest of the file. */
  replay(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('a ledger row is an object');
    const seq = row.seq;
    if (!Number.isInteger(seq) || seq !== this.posts.length + 1) {
      throw new Error(`seq ${JSON.stringify(seq ?? null)} does not continue the board at ${this.posts.length + 1}`);
    }
    if (row.id !== `fp_${seq}`) throw new Error(`id ${JSON.stringify(row.id ?? null)} does not match fp_${seq}`);
    const name = normalizeTopic(row.topic);
    if (typeof row.text !== 'string' || !row.text.length) throw new Error('a replayed post carries no text');
    if (row.text.length > MAX_POST_CHARS) throw new Error(`a replayed post exceeds ${MAX_POST_CHARS} characters — the ledger disagrees with what the gate once admitted`);
    // a headline replays when the row carries one (ledgers before it carry
    // none, and a rule a charter required then is not re-judged here)
    const head = row.headline === undefined ? null : postHeadline(row.headline, row.text);
    // parts replay with the same strictness as the sequence: an opened
    // issue must take the next number, an answered one must already exist,
    // and every part's place must lie inside the text it claims
    const opened = [];
    let meta = null;
    if (row.parts !== undefined) {
      if (!Array.isArray(row.parts) || !row.parts.length) throw new Error('a replayed post\'s parts are a non-empty list');
      let next = this.issues.size + 1;
      meta = row.parts.map((part, i) => {
        const where = `part ${i + 1}`;
        if (!part || typeof part !== 'object') throw new Error(`${where} is not an object`);
        if (!STANCES.includes(part.stance)) throw new Error(`${where}: stance ${JSON.stringify(part.stance ?? null)} is not one of ${STANCES.join(', ')}`);
        if (!Number.isInteger(part.from) || !Number.isInteger(part.to) || part.from < 0 || part.to > row.text.length || part.from >= part.to) {
          throw new Error(`${where}: its place in the text (${part.from}-${part.to}) is not inside the text`);
        }
        if (part.opened === true) {
          if (part.issue !== `issue_${next}`) throw new Error(`${where}: an opened issue ${JSON.stringify(part.issue ?? null)} does not continue the issues at issue_${next}`);
          next += 1;
          opened.push({ id: part.issue, title: issueTitle(part.title) });
          return { issue: part.issue, stance: part.stance, opened: true, title: opened[opened.length - 1].title, from: part.from, to: part.to };
        }
        if (!this.issues.has(part.issue) && !opened.some((o) => o.id === part.issue)) throw new Error(`${where}: issue ${JSON.stringify(part.issue ?? null)} was never opened`);
        return { issue: part.issue, stance: part.stance, from: part.from, to: part.to };
      });
    }
    const post = {
      id: row.id, seq, topic: name,
      by: typeof row.by === 'string' && row.by ? row.by : null,
      at: typeof row.at === 'string' && row.at ? row.at : null,
      text: row.text,
      ...(head ? { headline: head } : {}),
      ...(meta ? { parts: meta } : {}),
    };
    for (const o of opened) this.issues.set(o.id, { id: o.id, title: o.title, openedBy: post.by, openedIn: post.id, at: post.at });
    this.posts.push(post);
    const topicRow = this.topics.get(name) ?? { topic: name, count: 0, lastSeq: 0, lastAt: null };
    topicRow.count += 1;
    topicRow.lastSeq = seq;
    topicRow.lastAt = post.at;
    this.topics.set(name, topicRow);
    return post;
  }
}

export function normalizeTopic(topic) {
  if (typeof topic !== 'string') throw new Error('a forum topic must be a string');
  const name = topic.trim().toLowerCase();
  if (!TOPIC_PATTERN.test(name)) {
    throw new Error(
      `"${String(topic).slice(0, 40)}" is not a forum topic: lowercase letters, digits, ".", "_" or "-", ` +
      '1-64 characters, starting with a letter or digit');
  }
  return name;
}

export function postText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('a post needs text');
  if (text.length > MAX_POST_CHARS) {
    throw new Error(`a post is at most ${MAX_POST_CHARS} characters (got ${text.length}) — split it, or say it once and cite the record`);
  }
  return text;
}

const wordsOf = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/** A post short enough to be its own headline: one line, at most
 *  MAX_HEADLINE_WORDS words. */
export function isShortPost(text) {
  return typeof text === 'string' && !text.trim().includes('\n') && wordsOf(text) <= MAX_HEADLINE_WORDS;
}

/** The headline of a post, validated: one line, at most MAX_HEADLINE_WORDS
 *  words and MAX_HEADLINE_CHARS characters, or null when none was given.
 *  When `required`, a post that is not short (isShortPost) must carry one —
 *  the refusal says what to write. Nothing is trimmed to fit: a headline
 *  over the limit is refused, never cut. */
export function postHeadline(headline, text, { required = false } = {}) {
  if (headline === undefined || headline === null || (typeof headline === 'string' && !headline.trim())) {
    if (required && !isShortPost(text)) {
      throw new Error(
        `a post longer than ${MAX_HEADLINE_WORDS} words needs a headline — one sentence, at most ` +
        `${MAX_HEADLINE_WORDS} words, saying what you conclude (it is what readers see first; the text stays as you wrote it)`);
    }
    return null;
  }
  if (typeof headline !== 'string') throw new Error('a headline is text — one sentence');
  const head = headline.trim();
  if (head.includes('\n')) throw new Error('a headline is one line — one sentence, no line breaks');
  const words = wordsOf(head);
  if (words > MAX_HEADLINE_WORDS || head.length > MAX_HEADLINE_CHARS) {
    throw new Error(
      `a headline is at most ${MAX_HEADLINE_WORDS} words and ${MAX_HEADLINE_CHARS} characters (got ${words} words, ` +
      `${head.length} characters) — say what you conclude in one sentence; the detail belongs in the text`);
  }
  return head;
}

/** An issue's title: one claim, standing alone — one line, at most
 *  MAX_ISSUE_TITLE_WORDS words, and no post or issue numbers (a title that
 *  points elsewhere sends its reader back into the thread). Refused, never
 *  cut. */
export function issueTitle(title) {
  if (typeof title !== 'string' || !title.trim()) throw new Error('an issue needs a title — one claim others can agree or disagree with');
  const t = title.trim();
  if (t.includes('\n')) throw new Error('an issue title is one line');
  const words = wordsOf(t);
  if (words > MAX_ISSUE_TITLE_WORDS || t.length > MAX_ISSUE_TITLE_CHARS) {
    throw new Error(`an issue title is at most ${MAX_ISSUE_TITLE_WORDS} words and ${MAX_ISSUE_TITLE_CHARS} characters (got ${words} words) — one claim; the argument goes in the part's text`);
  }
  if (/\bfp_\d+\b|\bissue_\d+\b/.test(t)) {
    throw new Error('an issue title stands alone — no post or issue numbers in it; name the thing itself (quote the line, the finding, the choice)');
  }
  return t;
}

/** A post's parts, checked against the open issues: each answers one open
 *  issue (`on`) or opens one (`open`), with a stance and the argument.
 *  One part per issue per post. Returns them cleaned; throws naming the
 *  part and what it should look like. */
export function normalizeParts(parts, issues) {
  if (!Array.isArray(parts)) throw new Error('parts is a list — one entry per issue');
  if (parts.length > MAX_PARTS) throw new Error(`at most ${MAX_PARTS} parts in one post — answer the rest next turn`);
  const seen = new Set();
  return parts.map((part, i) => {
    const where = `part ${i + 1}`;
    if (!part || typeof part !== 'object' || Array.isArray(part)) throw new Error(`${where} is not an object — {"on": "issue_3", "stance": "agree", "text": "…"}`);
    const hasOn = typeof part.on === 'string' && part.on.trim() !== '';
    const hasOpen = typeof part.open === 'string' && part.open.trim() !== '';
    if (hasOn === hasOpen) throw new Error(`${where}: give either "on" (an open issue's id) or "open" (a new issue's title), not ${hasOn ? 'both' : 'neither'}`);
    if (!STANCES.includes(part.stance)) throw new Error(`${where}: stance is one of ${STANCES.join(', ')} (got ${JSON.stringify(part.stance ?? null)})`);
    if (typeof part.text !== 'string' || !part.text.trim()) throw new Error(`${where}: text is the argument — say why`);
    if (hasOpen) return { open: issueTitle(part.open), stance: part.stance, text: part.text.trim() };
    const on = part.on.trim();
    if (!issues.has(on)) {
      throw new Error(`${where}: no issue ${on.slice(0, 20)} — the open issues are ${[...issues.keys()].join(', ') || 'none yet (open one with "open")'}`);
    }
    if (seen.has(on)) throw new Error(`${where}: ${on} has a part already in this post — one part per issue`);
    seen.add(on);
    return { on, stance: part.stance, text: part.text.trim() };
  });
}

/** Write a post's text from its parts — the intro first, then each part
 *  under its issue's header — and record where each part's argument sits.
 *  The header carries the title, so the plain text reads on its own. */
function composeParts(intro, parts) {
  let text = intro;
  const meta = [];
  for (const part of parts) {
    const header = `[${part.issue} · ${part.opened ? 'new issue · ' : ''}${part.stance}] ${part.title}\n`;
    text += (text ? '\n\n' : '') + header;
    const from = text.length;
    text += part.text;
    meta.push({ issue: part.issue, stance: part.stance, ...(part.opened ? { opened: true, title: part.title } : {}), from, to: text.length });
  }
  return { text, parts: meta };
}

/** The issues as text — for a member's round, a reader, a record: each
 *  issue's title, then where each author stands now. `nameOf` turns a
 *  session id into the name a reader knows. */
export function renderIssues(board, nameOf = (by) => by) {
  if (board.length === 0) return '[forum] no issues yet';
  return board.map((row) => {
    const stances = Object.entries(row.stances).map(([by, s]) => `${nameOf(by)}: ${s.stance}`).join(' · ');
    return `  ${row.id} ${row.title}\n      ${stances || 'no stance yet'}`;
  }).join('\n');
}

/** One issue's thread as text: each part, its author and stance, its
 *  argument — in posting order. */
export function renderThread(issue, title, thread) {
  return [`[forum] ${issue} ${title} — ${thread.length} part(s), oldest first:`,
    ...thread.map((t) => `[${t.post} · ${t.by ?? 'unknown'} · ${t.opened ? 'opened · ' : ''}${t.stance}]\n${t.text}`)].join('\n\n');
}

/** A pass is a choice, not an absence: the reason is required, and it is
 *  bounded so a pass does not become an essay by another route. The caller
 *  renders the rule; nothing is silently repaired. */
export function passReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('a pass needs a reason — say why you are not posting this turn');
  }
  if (reason.length > MAX_PASS_REASON_CHARS) {
    throw new Error(`a pass reason is at most ${MAX_PASS_REASON_CHARS} characters (got ${reason.length}) — say it once, plainly`);
  }
  return reason;
}

export function renderPost(post) {
  const head = post.headline ? `headline: ${post.headline}\n` : '';
  return `[forum] ${post.id} · ${post.topic} · ${post.by ?? 'unknown'} · ${post.at}\n${head}${post.text}`;
}

export function renderRead(posts) {
  if (posts.length === 0) return '[forum] nothing new under that since';
  return ['[forum] posts, oldest first:', ...posts.map((p) => renderPost(p))].join('\n\n');
}

export function renderBoard(forum) {
  const rows = forum.board();
  if (rows.length === 0) return '[forum] no topics yet — the first post to one creates it';
  return [
    '[forum] topics, most recently active first:',
    ...rows.map((r) => `  ${r.topic} — ${r.count} post(s), last fp_${r.lastSeq} at ${r.lastAt}`),
  ].join('\n');
}
