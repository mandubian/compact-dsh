// The pure model: topics, posts, sequences, boards, validation.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Forum, normalizeTopic, postText, passReason, postHeadline, isShortPost, renderBoard, renderRead, renderPost,
  issueTitle, normalizeParts, renderIssues, renderThread,
  TOPIC_PATTERN, MAX_POST_CHARS, MAX_PASS_REASON_CHARS, MAX_HEADLINE_WORDS, MAX_ISSUE_TITLE_WORDS, MAX_PARTS, STANCES, DEFAULT_READ_LIMIT, MAX_READ_LIMIT,
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

// ── issues: one claim each, the argument in parts ──

const OPEN5 = { open: 'Point 5 promises refusal "without penalty", but nobody is named to make that true', stance: 'agree', text: 'A human who refuses and is fired has been penalized.' };

test('an issue title is one claim that stands alone: one line, at most 25 words, no post or issue numbers', () => {
  assert.equal(MAX_ISSUE_TITLE_WORDS, 25);
  assert.equal(issueTitle('  split loses a cent on 10 / 3  '), 'split loses a cent on 10 / 3');
  assert.throws(() => issueTitle(''), /needs a title — one claim/);
  assert.throws(() => issueTitle('one\ntwo'), /one line/);
  assert.throws(() => issueTitle(words(26)), /at most 25 words .*got 26 words/);
  assert.throws(() => issueTitle('as I said in fp_3, the rounding is wrong'), /stands alone — no post or issue numbers/);
  assert.throws(() => issueTitle('issue_2 again, but worse'), /stands alone/);
});

test('parts: each answers one open issue or opens one, with a stance and a why — refused part by part, naming what to write', () => {
  const open = new Map([['issue_1', {}], ['issue_2', {}]]);
  assert.deepEqual(STANCES, ['agree', 'disagree', 'unsure']);
  assert.deepEqual(normalizeParts([{ on: 'issue_2', stance: 'disagree', text: ' no ' }], open), [{ on: 'issue_2', stance: 'disagree', text: 'no' }]);
  assert.throws(() => normalizeParts('x', open), /parts is a list/);
  assert.throws(() => normalizeParts([{ stance: 'agree', text: 'x' }], open), /part 1: give either "on" .* or "open" .*not neither/);
  assert.throws(() => normalizeParts([{ on: 'issue_1', open: 'a claim', stance: 'agree', text: 'x' }], open), /not both/);
  assert.throws(() => normalizeParts([{ on: 'issue_1', stance: 'yes', text: 'x' }], open), /stance is one of agree, disagree, unsure/);
  assert.throws(() => normalizeParts([{ on: 'issue_1', stance: 'agree', text: ' ' }], open), /text is the argument — say why/);
  assert.throws(() => normalizeParts([{ on: 'issue_9', stance: 'agree', text: 'x' }], open), /no issue issue_9 — the open issues are issue_1, issue_2/);
  assert.throws(() => normalizeParts([{ on: 'issue_1', stance: 'agree', text: 'x' }], new Map()), /none yet \(open one with "open"\)/);
  assert.throws(() => normalizeParts([{ on: 'issue_1', stance: 'agree', text: 'a' }, { on: 'issue_1', stance: 'agree', text: 'b' }], open), /part 2: issue_1 has a part already in this post — one part per issue/);
  assert.throws(() => normalizeParts(Array.from({ length: MAX_PARTS + 1 }, () => OPEN5), open), /at most 12 parts/);
});

test('a post of parts: the forum writes its text, each part under its issue\'s title, and records where each argument sits', () => {
  const f = new Forum();
  const a = f.post({ by: 'community-skeptic-aa', topic: 't', text: 'My two.', parts: [OPEN5, { open: 'Point 1 claims to bind everyone, and nothing in the text binds anyone', stance: 'agree', text: 'It says itself it is not a law.' }] });
  assert.equal(a.text, 'My two.\n\n[issue_1 · new issue · agree] Point 5 promises refusal "without penalty", but nobody is named to make that true\nA human who refuses and is fired has been penalized.\n\n[issue_2 · new issue · agree] Point 1 claims to bind everyone, and nothing in the text binds anyone\nIt says itself it is not a law.');
  assert.deepEqual(a.parts.map((p) => a.text.slice(p.from, p.to)), ['A human who refuses and is fired has been penalized.', 'It says itself it is not a law.']);
  assert.deepEqual([...f.issues.keys()], ['issue_1', 'issue_2']);
  assert.equal(f.issues.get('issue_1').openedIn, 'fp_1');
  // an answer with no intro: the text is the parts alone
  const b = f.post({ by: 'community-chair-aa', topic: 't', parts: [{ on: 'issue_1', stance: 'disagree', text: 'The agreed rules decide; that is a frame, not a promise.' }] });
  assert.match(b.text, /^\[issue_1 · disagree\] Point 5 promises/);
  // the thread is that issue's parts and nothing else, in order
  assert.deepEqual(f.thread('issue_1').map((t) => [t.post, t.stance, t.opened ?? false, t.text]), [
    ['fp_1', 'agree', true, 'A human who refuses and is fired has been penalized.'],
    ['fp_2', 'disagree', false, 'The agreed rules decide; that is a frame, not a promise.'],
  ]);
  assert.throws(() => f.thread('issue_7'), /no issue issue_7 — the open issues are issue_1, issue_2/);
  // the board: each author's LATEST stance
  f.post({ by: 'community-skeptic-aa', topic: 't', parts: [{ on: 'issue_1', stance: 'unsure', text: 'The chair has a point about frames.' }] });
  const board = f.issueBoard();
  assert.deepEqual(board[0].stances, { 'community-skeptic-aa': { stance: 'unsure', post: 'fp_3' }, 'community-chair-aa': { stance: 'disagree', post: 'fp_2' } });
  assert.deepEqual(board[0].posts, ['fp_1', 'fp_2', 'fp_3']);
  assert.match(renderIssues(board, (by) => by.split('-')[1]), /issue_1 Point 5 promises.*\n {6}skeptic: unsure · chair: disagree/);
  assert.match(renderThread('issue_1', board[0].title, f.thread('issue_1')), /— 3 part\(s\), oldest first:\n\n\[fp_1 · community-skeptic-aa · opened · agree\]/);
  assert.deepEqual(f.stats(), { topics: 1, posts: 3, issues: 2 });
});

test('with parts required, a long post without one is refused — a short one is not; check() records nothing', () => {
  const f = new Forum();
  assert.throws(() => f.post({ by: 's', topic: 't', text: words(30), requireParts: true }), /carries its argument in parts, one per issue — \{"on": "issue_3"/);
  assert.equal(f.post({ by: 's', topic: 't', text: 'agreed, all of it.', requireParts: true }).id, 'fp_1');
  const seen = f.check({ parts: [OPEN5], requireParts: true });
  assert.deepEqual(seen.opened, [{ id: 'issue_1', title: OPEN5.open }]);
  assert.equal(f.issues.size, 0, 'a check opens nothing');
  assert.equal(f.posts.length, 1, 'and posts nothing');
  assert.throws(() => f.post({ by: 's', topic: 't', parts: [{ on: 'issue_1', stance: 'agree', text: 'x' }] }), /no issue issue_1/);
  assert.equal(f.posts.length, 1, 'a refused post records nothing');
});

test('replay: issues rebuild from the ledger, in order, or the replay stops naming why', () => {
  const f = new Forum();
  f.post({ by: 'community-skeptic-aa', topic: 't', parts: [OPEN5] });
  f.post({ by: 'community-chair-aa', topic: 't', parts: [{ on: 'issue_1', stance: 'disagree', text: 'a frame, not a promise' }] });
  const rows = JSON.parse(JSON.stringify(f.posts));
  const g = new Forum();
  for (const r of rows) g.replay(r);
  assert.deepEqual(g.issueBoard(), f.issueBoard());
  assert.deepEqual(g.thread('issue_1'), f.thread('issue_1'));
  const bad = (mut) => { const h = new Forum(); const r = JSON.parse(JSON.stringify(rows[0])); mut(r); return () => h.replay(r); };
  assert.throws(bad((r) => { r.parts[0].issue = 'issue_2'; }), /does not continue the issues at issue_1/);
  assert.throws(bad((r) => { r.parts[0].to = 99_999; }), /not inside the text/);
  assert.throws(bad((r) => { r.parts[0].stance = 'maybe'; }), /stance "maybe" is not one of/);
  assert.throws(bad((r) => { r.parts[0].title = 'see fp_1'; }), /stands alone/);
  assert.throws(() => new Forum().replay(rows[1] && { ...JSON.parse(JSON.stringify(rows[1])), seq: 1, id: 'fp_1' }), /issue "issue_1" was never opened/);
});
