// The pure model of the community forum — no I/O, no dsh: topics, posts,
// ids, boards, renders. The plugin (./index.js) owns the surfaces; this file
// is the part a test can exhaust.
//
// Posts carry ONE global sequence across all topics (fp_1, fp_2, …), not a
// per-topic counter: `since` reads stay a single monotonic number per member
// regardless of how many topics they follow, and the ledger beside the
// chains is one append-only file in posting order.

export const TOPIC_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_POST_CHARS = 8000;
export const DEFAULT_READ_LIMIT = 50;
export const MAX_READ_LIMIT = 200;

export class Forum {
  constructor() {
    this.posts = [];
    this.topics = new Map(); // topic -> { topic, count, lastSeq, lastAt }
  }

  /** Append one post. Throws on an invalid topic or body — never silently
   *  repairs what a member tried to say (the caller renders the reason). */
  post({ by, topic, text, now = Date.now() }) {
    const name = normalizeTopic(topic);
    const body = postText(text);
    const seq = this.posts.length + 1;
    const post = {
      id: `fp_${seq}`, seq, topic: name,
      by: typeof by === 'string' && by ? by : null,
      at: new Date(now).toISOString(), text: body,
    };
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
    return { topics: this.topics.size, posts: this.posts.length };
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

export function renderPost(post) {
  return `[forum] ${post.id} · ${post.topic} · ${post.by ?? 'unknown'} · ${post.at}\n${post.text}`;
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
