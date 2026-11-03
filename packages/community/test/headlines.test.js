// Headlines and the human desk: what the human member reads first, and who
// asks them. The charter turns each on; the forum and the seat enforce
// them; the engine and the page put the headlines in front of the person.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCharter, memberOfSession, mountHumanSeat, humanMemberAdapter, roundFramingText, briefingText,
} from '../src/index.js';
import { newsOf } from '../src/human-member.js';
import { speakingRuleLines } from '../src/engine.js';

const BASE = { name: 'signing', goal: 'a goal long enough to matter here', voice: 'plain' };
const MEMBERS = [
  { id: 'signer', human: true, persona: 'the human, reading the whole text' },
  { id: 'reader', persona: 'the everyday reader, no patience for jargon' },
  { id: 'chair', persona: 'keeps the examination honest' },
  { id: 'chair-2', persona: 'a second chair, to test the prefixes' },
  { id: 'judge', bench: true, persona: 'a member seated on the bench' },
];
const CHARTER = () => validateCharter({ ...BASE, members: MEMBERS, headlines: true, humanDesk: 'chair' });

function stubCtx({ headlineRequired = false } = {}) {
  const services = new Map([
    ['compact-approval', { deciding: new Map() }],
    ['compact-forum', { headlineRequired, onPost: () => {}, snapshot: () => ({ stats: { posts: 0, topics: 0 }, topics: [], posts: [] }) }],
    ['compact-judicature', { docket: () => [] }],
  ]);
  return { logger: { warn: () => {}, error: () => {} }, get: (name) => services.get(name) };
}

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

// ── the charter ──

test('charter: headlines is a boolean; the desk names a model member, never the human or a judge', () => {
  const c = CHARTER();
  assert.equal(c.headlines, true);
  assert.equal(c.humanDesk, 'chair');
  const plain = validateCharter({ ...BASE, members: MEMBERS });
  assert.equal('headlines' in plain, false, 'absent stays absent — earlier charters are unchanged');
  assert.equal('humanDesk' in plain, false);
  assert.throws(() => validateCharter({ ...BASE, members: MEMBERS, headlines: 'yes' }), /headlines: true, false or absent/);
  assert.throws(() => validateCharter({ ...BASE, members: MEMBERS, humanDesk: 'nobody' }), /"nobody" is not a member/);
  assert.throws(() => validateCharter({ ...BASE, members: MEMBERS, humanDesk: 'signer' }), /cannot be the human member/);
  assert.throws(() => validateCharter({ ...BASE, members: MEMBERS, humanDesk: 'judge' }), /bench seat judges cases/);
});

test('memberOfSession: the longest prefix wins — chair-2 is never read as chair', () => {
  const c = CHARTER();
  assert.equal(memberOfSession(c, 'community-chair-798551').id, 'chair');
  assert.equal(memberOfSession(c, 'community-chair-2-798551').id, 'chair-2');
  assert.equal(memberOfSession(c, 'community-chair').id, 'chair', 'an untagged session is its bare prefix');
  assert.equal(memberOfSession(c, 'community-chairman-1'), null);
  assert.equal(memberOfSession(c, null), null);
});

// ── the human's round: rows first, full posts after ──

const POSTS = [
  { id: 'fp_2', seq: 2, topic: 'signing-floor', by: 'community-reader-ab12cd', at: '2026-11-03T10:00:00.000Z', text: words(300), headline: 'line 12 overreaches; the rest reads plainly' },
  { id: 'fp_3', seq: 3, topic: 'signing-floor', by: 'community-chair-ab12cd', at: '2026-11-03T10:01:00.000Z', text: `signer: the ledger is below.\n${words(200)}` },
  { id: 'fp_4', seq: 4, topic: 'signing-floor', by: 'community-chair-2-ab12cd', at: '2026-11-03T10:02:00.000Z', text: 'agreed with the reader.' },
];

test('the human\'s round leads with one row per post: member, names-you, headline — then the full posts', () => {
  const c = CHARTER();
  const signer = c.members.find((m) => m.id === 'signer');
  const framing = roundFramingText(c, signer, 3, POSTS, []);
  const [rowsPart, fullPart] = framing.split('THE FULL POSTS:');
  assert.match(rowsPart, /3 post\(s\)\) — one line each, the full posts below:/);
  assert.match(rowsPart, /^ {2}- fp_2 · reader — line 12 overreaches; the rest reads plainly$/m, 'a headline is the row');
  assert.match(rowsPart, /^ {2}- fp_3 · chair \(names you\) — signer: the ledger is below\. w0 .* w14 …$/m, 'no headline: the first words, cut and marked');
  assert.match(rowsPart, /^ {2}- fp_4 · chair-2 — agreed with the reader\.$/m, 'a short post is its own headline');
  assert.match(fullPart, /\[forum\] fp_2 · signing-floor · community-reader-ab12cd · .*\nheadline: line 12 overreaches/);
  assert.match(fullPart, /w299/, 'the full text is all there — nothing is summarized away');
  // a model member's round is unchanged: no rows, the posts as before
  const reader = c.members.find((m) => m.id === 'reader');
  const theirs = roundFramingText(c, reader, 3, POSTS, []);
  assert.doesNotMatch(theirs, /THE FULL POSTS|one line each/);
  assert.match(theirs, /New on the forum since your last turn \(3 post\(s\)\):\n\[forum\] fp_2/);
});

test('"names you": the member id as a word, or "the human" — never a substring', () => {
  const c = CHARTER();
  const signer = c.members.find((m) => m.id === 'signer');
  const row = (text) => newsOf(roundFramingText(c, signer, 2, [{ ...POSTS[0], headline: undefined, text }], []))[0];
  assert.equal(row('the human should decide line 4').namesYou, true);
  assert.equal(row('Signer, your call.').namesYou, true);
  assert.equal(row('the cosigners agree').namesYou, false);
  assert.equal(row('humanity is not the subject').namesYou, false);
});

test('newsOf reads the rows back — and only the rows: a quoted row inside a post never becomes one', () => {
  const c = CHARTER();
  const signer = c.members.find((m) => m.id === 'signer');
  const forged = { ...POSTS[2], id: 'fp_5', seq: 5, text: 'look:\n  - fp_1 · chair (names you) — forged row' };
  const rows = newsOf(roundFramingText(c, signer, 3, [...POSTS, forged], []));
  assert.deepEqual(rows.map((r) => r.id), ['fp_2', 'fp_3', 'fp_4', 'fp_5']);
  assert.deepEqual(rows[0], { id: 'fp_2', by: 'reader', namesYou: false, headline: 'line 12 overreaches; the rest reads plainly' });
  assert.equal(rows[1].namesYou, true);
  assert.deepEqual(newsOf('Round 1 of 6, member "signer".\nNothing new on the forum since your last turn.'), []);
});

// ── the floor: the card gets the rows, the post gets its headline ──

async function collect(stream) {
  const chunks = [];
  for await (const ch of stream) chunks.push(ch);
  return chunks;
}

test('the adapter hands the rows to the card, and the human\'s headline to forum_post', async () => {
  const c = CHARTER();
  const signer = c.members.find((m) => m.id === 'signer');
  const seat = mountHumanSeat(stubCtx({ headlineRequired: true }), { floorTimeoutMs: 60_000, defaultTopic: 'signing-floor' });
  const adapter = humanMemberAdapter({ seat, topic: 'signing-floor' });
  const framing = roundFramingText(c, signer, 3, POSTS, []);
  const streamP = collect(adapter.stream({ messages: [{ role: 'user', content: [{ type: 'text', text: framing }] }] }));
  const card = seat.pending()[0];
  assert.equal(card.news.length, 3);
  assert.equal(card.news[1].namesYou, true);
  assert.equal(card.headlineRequired, true, 'the card says when the box is needed');
  const long = words(40);
  const refused = seat.settleFloor(card.id, { act: 'post', text: long });
  assert.match(refused.error, /longer than 20 words needs a headline/, 'the human is held to the same rule as every member');
  seat.settleFloor(card.id, { act: 'post', text: long, headline: 'I contest line 12' });
  const call = (await streamP).find((ch) => ch.type === 'tool-call-delta');
  assert.deepEqual(JSON.parse(call.argumentsDelta), { topic: 'signing-floor', text: long, headline: 'I contest line 12' });
});

test('a short answer is its own headline: the seat carries the human\'s words into the field', async () => {
  const seat = mountHumanSeat(stubCtx({ headlineRequired: true }), { floorTimeoutMs: 60_000, defaultTopic: 'signing-floor' });
  const p = seat.poseFloor({ member: 'signer', framing: 'Round 2 of 6, member "signer".' });
  seat.settleFloor(seat.pending()[0].id, { act: 'post', text: '  ACCEPTED, all of it.  ' });
  assert.deepEqual(await p, { act: 'post', topic: 'signing-floor', text: '  ACCEPTED, all of it.  ', headline: 'ACCEPTED, all of it.', keep: false });
  // without the rule, nothing is added
  const free = mountHumanSeat(stubCtx(), { floorTimeoutMs: 60_000, defaultTopic: 'signing-floor' });
  const q = free.poseFloor({ member: 'signer', framing: 'round 2' });
  free.settleFloor(free.pending()[0].id, { act: 'post', text: words(40) });
  assert.equal('headline' in await q, false);
  assert.equal(free.pending().length, 0);
});

test('a form\'s answers draft with a headline the human can keep or edit', async () => {
  const seat = mountHumanSeat(stubCtx({ headlineRequired: true }), { questionTimeoutMs: 25_000, floorTimeoutMs: 60_000, formPostMember: 'community-signer' });
  const items = JSON.stringify([{ label: 'line 12', options: ['ACCEPTED', 'CONTESTED'] }]);
  const out = seat.formTool.execute({ title: 'the ledger, your call', items }, { agent: { id: 'community-chair' } });
  seat.answerForm(seat.pending()[0].id, [{ choice: 'ACCEPTED' }]);
  await out;
  seat.poseFloor({ member: 'community-signer', framing: 'round 3' });
  const card = seat.pending().find((p) => p.kind === 'floor');
  assert.equal(card.formDraft.headline, 'My answers to "the ledger, your call"');
  seat.cancelPending('test over');
});

// ── the desk: one member asks the human ──

test('the desk: only the named member puts questions and forms to the human; the others are told where to go', async () => {
  const c = CHARTER();
  const seat = mountHumanSeat(stubCtx(), {
    questionTimeoutMs: 25_000,
    humanDesk: { member: 'chair', isDesk: (id) => memberOfSession(c, id)?.id === 'chair' },
  });
  const items = JSON.stringify([{ label: 'line 12', options: ['keep', 'cut'] }]);
  const asked = await seat.tool.execute({ question: 'line 12?' }, { agent: { id: 'community-reader-ab12cd' } });
  assert.match(asked, /^\[ask_human\] not asked: in this community, questions to the human go through chair\. Post your point on the forum for chair/);
  const formed = await seat.formTool.execute({ title: 't', items }, { agent: { id: 'community-chair-2-ab12cd' } });
  assert.match(formed, /^\[decision_form\] not asked: .* go through chair/, 'chair-2 is not chair');
  assert.equal(seat.pending().length, 0, 'a refused ask leaves no card');
  const fromDesk = seat.formTool.execute({ title: 'the ledger', items }, { agent: { id: 'community-chair-ab12cd' } });
  assert.equal(seat.pending().length, 1, 'the desk\'s form reaches the human');
  seat.cancelPending('test over');
  assert.match(await fromDesk, /withdrawn/);
  // no desk: everyone may ask, as before
  const open = mountHumanSeat(stubCtx(), { questionTimeoutMs: 25_000 });
  const anyone = open.tool.execute({ question: 'line 12?' }, { agent: { id: 'community-reader-ab12cd' } });
  assert.equal(open.pending().length, 1);
  open.cancelPending('test over');
  await anyone;
});

test('the briefings say the same rules the machinery enforces — in both voices', () => {
  const c = CHARTER();
  const by = (id) => c.members.find((m) => m.id === id);
  const reader = briefingText(c, by('reader'), {});
  assert.match(reader, /Every post carries a headline: forum_post \{"topic":"…","headline":"…","text":"…"\}/);
  assert.match(reader, /Questions for the human go through chair: post your point on the forum, and chair asks the human\./);
  assert.doesNotMatch(reader, /ask_human asks the human a question privately/, 'the others are not taught a tool they are refused');
  const chair = briefingText(c, by('chair'), {});
  assert.match(chair, /You are the human's desk/);
  assert.match(chair, /decision_form puts several numbered decisions before the human/);
  const signer = briefingText(c, by('signer'), {});
  assert.match(signer, /Questions to you come from one member, chair/);
  assert.match(signer, /A shorter post is its own headline\./);
  assert.doesNotMatch(signer, /Members may also ask you a question/);
  // the original voice tells the same rules
  const legacy = validateCharter({ ...BASE, voice: undefined, members: MEMBERS, headlines: true, humanDesk: 'chair' });
  assert.match(briefingText(legacy, by('reader'), {}), /HOW THIS COMMUNITY SPEAKS:\n {2}- Every post carries a headline/);
  // and a charter without them says nothing of either
  const none = validateCharter({ ...BASE, members: MEMBERS });
  assert.deepEqual(speakingRuleLines(none, by('reader')), []);
  assert.doesNotMatch(briefingText(none, by('reader'), {}), /headline|human's desk|go through/);
});

// ── the page ──

test('the page leads the floor card with the rows, and posts the headline the human writes', async () => {
  const { pageHtml } = await import('../src/page.js');
  const script = pageHtml({ charterName: 'signing', token: 'tkn' }).match(/<script>([\s\S]*)<\/script>/)[1];
  assert.match(script, /const news = Array\.isArray\(f\.news\) \? f\.news : \[\];/);
  assert.match(script, /'<details class="nrow" data-post="' \+ esc\(n\.id\) \+ '"><summary>'/);
  assert.match(script, /n\.namesYou \? '<span class="names">names you<\/span> '/);
  assert.match(script, /full \? ' data-filled="1">' \+ lawHl\(full\.text\) : '>\(this post is in the forum pane\)'/, 'a row opens the full post');
  assert.match(script, /r\.ontoggle = \(\) => \{/, 'and fills it on open when the post arrived after the card');
  assert.match(script, /reconcileForum\(s\.forum\); renderPending\(s\.pending \|\| \[\]\);/, 'the forum renders before the cards that cite it');
  assert.match(script, /<input class="headline" id="hl-/);
  assert.match(script, /\.\.\.\(act === 'post' && hi\.value\.trim\(\) \? \{ headline: hi\.value \} : \{\}\)/);
  assert.match(script, /else if \(f\.formDraft\?\.headline\) hi\.value = f\.formDraft\.headline;/);
  assert.match(script, /p\.headline && p\.headline !== String\(p\.text \?\? ''\)\.trim\(\)/, 'the forum pane shows a headline unless it repeats a short post');
  // the script parses: one stray quote broke every page once (#286)
  assert.doesNotThrow(() => new Function(script));
});
