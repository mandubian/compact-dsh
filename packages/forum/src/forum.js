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

export const TOPIC_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_POST_CHARS = 8000;
export const MAX_PASS_REASON_CHARS = 2000;
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
    const post = {
      id: row.id, seq, topic: name,
      by: typeof row.by === 'string' && row.by ? row.by : null,
      at: typeof row.at === 'string' && row.at ? row.at : null,
      text: row.text,
    };
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
