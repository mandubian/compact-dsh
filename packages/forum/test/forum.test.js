// The pure model: topics, posts, sequences, boards, validation.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Forum, normalizeTopic, postText, renderBoard, renderRead,
  TOPIC_PATTERN, MAX_POST_CHARS, DEFAULT_READ_LIMIT, MAX_READ_LIMIT,
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
