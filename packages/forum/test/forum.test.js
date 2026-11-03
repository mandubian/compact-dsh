// The pure model: topics, posts, sequences, boards, validation.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Forum, normalizeTopic, postText, passReason, postHeadline, isShortPost, renderBoard, renderRead, renderPost,
  TOPIC_PATTERN, MAX_POST_CHARS, MAX_PASS_REASON_CHARS, MAX_HEADLINE_WORDS, DEFAULT_READ_LIMIT, MAX_READ_LIMIT,
} from '../src/forum.js';


test('topics normalize: trim, lowercase; invalid shapes are refused with the rule', () => {
  assert.equal(normalizeTopic('  Nightly-Export '), 'nightly-export');
  assert.equal(normalizeTopic('T2.v3'), 't2.v3');
  for (const bad of ['', '  ', 'has space', 'UPPER ok?', 'é', '-leading', 'a'.repeat(65)]) {
    assert.throws(() => normalizeTopic(bad), /not a forum topic/, JSON.stringify(bad));
  }
  assert.ok(TOPIC_PATTERN.test('a-b_c.d0'));
});

test('posts carry one global sequence across topics; ids are fp_<seq>', () => {
  const f = new Forum();
  const a = f.post({ by: 's1', topic: 'alpha', text: 'first' });
  const b = f.post({ by: 's2', topic: 'beta', text: 'second' });
  const c = f.post({ by: 's1', topic: 'alpha', text: 'third' });
  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3]);
  assert.deepEqual([a.id, b.id, c.id], ['fp_1', 'fp_2', 'fp_3']);
  assert.deepEqual(f.stats(), { topics: 2, posts: 3 });
});

test('read: per-topic with since, oldest first, bounded; undefined topic reads across topics', () => {
  const f = new Forum();
  f.post({ by: 's1', topic: 'a', text: '1' });
  f.post({ by: 's2', topic: 'b', text: '2' });
  f.post({ by: 's1', topic: 'a', text: '3' });
  assert.deepEqual(f.read({ topic: 'a' }).map((p) => p.seq), [1, 3]);
  assert.deepEqual(f.read({ topic: 'a', since: 1 }).map((p) => p.seq), [3]);
  assert.deepEqual(f.read({ since: 1 }).map((p) => p.seq), [2, 3]);
  assert.deepEqual(f.read({ topic: 'a', limit: 1 }).map((p) => p.seq), [3]);
  assert.throws(() => f.read({ topic: 'no such' }), /not a forum topic|nothing/i);
});

test('read limit is clamped, never a lever for unbounded reads', () => {
  const f = new Forum();
  for (let i = 0; i < MAX_READ_LIMIT + 10; i++) f.post({ by: 's', topic: 't', text: `p${i}` });
  assert.equal(f.read({ topic: 't' }).length, DEFAULT_READ_LIMIT);
  assert.equal(f.read({ topic: 't', limit: 99999 }).length, MAX_READ_LIMIT);
  assert.equal(f.read({ topic: 't', limit: 1 }).length, 1);
  assert.equal(f.read({ topic: 't', limit: 0 }).length, DEFAULT_READ_LIMIT); // 0 is not a bound — the default applies
});

test('post text: empty refused, over-long refused with the honest count', () => {
  assert.throws(() => postText(''), /needs text/);
  assert.throws(() => postText(' '.repeat(10)), /needs text/);
  const long = 'x'.repeat(MAX_POST_CHARS + 1);
  assert.throws(() => postText(long), new RegExp(`at most ${MAX_POST_CHARS} characters.*got ${MAX_POST_CHARS + 1}`));
});

test('pass reason: required, bounded, returned unchanged — a pass is not a post', () => {
  assert.equal(passReason('nothing new to add'), 'nothing new to add');
  assert.equal(passReason('  keep my spacing  '), '  keep my spacing  ');
  for (const bad of [undefined, null, '', '   ', 42, {}]) {
    assert.throws(() => passReason(bad), /a pass needs a reason/, JSON.stringify(bad));
  }
  const long = 'x'.repeat(MAX_PASS_REASON_CHARS + 1);
  assert.throws(() => passReason(long), new RegExp(`at most ${MAX_PASS_REASON_CHARS} characters.*got ${MAX_PASS_REASON_CHARS + 1}`));
  // The pure model has no pass-as-post path: posts remain the only sequence.
  const f = new Forum();
  assert.equal(f.posts.length, 0);
  assert.deepEqual(f.read({}), []);
  assert.deepEqual(f.stats(), { topics: 0, posts: 0 });
});

test('board: most recently active first, with counts and last post', () => {
  const f = new Forum();
  f.post({ by: 's1', topic: 'old', text: '1' });
  f.post({ by: 's2', topic: 'hot', text: '2' });
  f.post({ by: 's1', topic: 'old', text: '3' });
  const board = f.board();
  assert.deepEqual(board.map((r) => r.topic), ['old', 'hot']);
  assert.equal(board[0].count, 2);
  assert.equal(board[0].lastSeq, 3);
  const text = renderBoard(f);
  assert.match(text, /topics, most recently active first/);
  assert.match(text, /old — 2 post\(s\), last fp_3/);
});

test('renders: posts oldest-first with attribution, empty reads say so', () => {
  const f = new Forum();
  const p = f.post({ by: 'session-x', topic: 't', text: 'hello' });
  assert.match(renderRead([p]), /\[forum\] fp_1 · t · session-x · /);
  assert.match(renderRead([p]), /hello/);
  assert.match(renderRead([]), /nothing new/);
  assert.equal(p.by, 'session-x');
  assert.equal(f.post({ by: null, topic: 't', text: 'anon' }).by, null);
});

// ── resumption (#227): the board replays from the ledger under strict continuity ──

const ROW = (seq, over = {}) => ({ id: `fp_${seq}`, seq, topic: 'nightly', by: 'session-x', at: '2026-10-19T00:00:00.000Z', text: `post ${seq}`, ...over });

test('replay: strict continuity — the board resumes exactly where the ledger left off', () => {
  const f = new Forum();
  f.replay(ROW(1));
  f.replay(ROW(2, { topic: 'other', by: null }));
  assert.deepEqual(f.stats(), { topics: 2, posts: 2 });
  assert.equal(f.posts[1].id, 'fp_2');
  assert.equal(f.posts[1].by, null, 'an anonymous post replays as anonymous');
  // posting continues the numbering — no second fp_1 in any future ledger
  const next = f.post({ by: 'session-y', topic: 'nightly', text: 'first post after a restart' });
  assert.deepEqual([next.seq, next.id], [3, 'fp_3']);
  // reads and boards serve the replayed posts like any other
  assert.equal(f.read({ topic: 'other' }).length, 1);
  assert.equal(f.read({ since: 0 }).length, 3);
  assert.equal(f.board().find((r) => r.topic === 'nightly').lastSeq, 3);
});

test('replay: every violation is refused with its reason — never approximated', () => {
  const f = new Forum();
  assert.throws(() => f.replay(null), /ledger row is an object/);
  assert.throws(() => f.replay(ROW(2)), /does not continue the board at 1/);
  assert.throws(() => f.replay(ROW(1, { id: 'fp_9' })), /does not match fp_1/);
  assert.throws(() => f.replay(ROW(1, { topic: 'bad topic!' })), /not a forum topic/);
  assert.throws(() => f.replay(ROW(1, { text: '' })), /carries no text/);
  assert.throws(() => f.replay(ROW(1, { text: 'x'.repeat(MAX_POST_CHARS + 1) })), /exceeds 8000 characters/);
  f.replay(ROW(1));
  assert.throws(() => f.replay(ROW(1)), /does not continue the board at 2/, 'a duplicate line cannot rewind the board');
});

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('headline: one line of at most 20 words, refused past it — never cut to fit', () => {
  assert.equal(MAX_HEADLINE_WORDS, 20);
  assert.equal(postHeadline('  the rounding bug is real  ', words(40)), 'the rounding bug is real');
  assert.equal(postHeadline(undefined, words(40)), null, 'optional by default');
  assert.equal(postHeadline('   ', words(40)), null, 'blank is no headline');
  assert.throws(() => postHeadline(words(21), 'x'), /at most 20 words .*got 21 words/);
  assert.throws(() => postHeadline('x'.repeat(201), 'x'), /200 characters/);
  assert.throws(() => postHeadline('one\ntwo', 'x'), /one line/);
  assert.throws(() => postHeadline(42, 'x'), /a headline is text/);
});

test('headline required: a long post needs one; a short one-line post is its own headline', () => {
  assert.ok(isShortPost(words(20)));
  assert.ok(!isShortPost(words(21)));
  assert.ok(!isShortPost('two\nlines'), 'a second line makes a post long, however few its words');
  assert.equal(postHeadline(undefined, words(20), { required: true }), null);
  assert.throws(() => postHeadline(undefined, words(21), { required: true }), /longer than 20 words needs a headline — one sentence/);
  assert.throws(() => postHeadline('', 'two\nlines', { required: true }), /needs a headline/);
  assert.equal(postHeadline('agree on all three', words(300), { required: true }), 'agree on all three');
});

test('a post carries its headline; the render puts it first; the ledger row replays it', () => {
  const f = new Forum();
  const p = f.post({ by: 's1', topic: 't', text: words(30), headline: 'the fix is right' });
  assert.equal(p.headline, 'the fix is right');
  assert.match(renderPost(p), /^\[forum\] fp_1 · t · s1 · .*\nheadline: the fix is right\nw0 w1/);
  const plain = f.post({ by: 's1', topic: 't', text: 'short' });
  assert.equal('headline' in plain, false, 'no headline, no key — older rows keep their shape');
  assert.doesNotMatch(renderPost(plain), /headline:/);
  assert.throws(() => f.post({ by: 's1', topic: 't', text: words(30), requireHeadline: true }), /needs a headline/);
  assert.equal(f.posts.length, 2, 'a refused post is not posted');
  const g = new Forum();
  assert.equal(g.replay(ROW(1, { headline: 'kept' })).headline, 'kept');
  assert.equal('headline' in g.replay(ROW(2)), false, 'a ledger from before headlines replays as it was');
  assert.throws(() => g.replay(ROW(3, { headline: words(25) })), /at most 20 words/);
});
