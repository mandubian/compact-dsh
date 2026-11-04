// Issues: a community's discussion untangled by claim. Members open issues
// and post their argument in parts, one per issue; every member's round
// lists the issues and where everyone stands; the human's card leads with
// them, and the human answers with the same parts, checked by the same rule.
import test from 'node:test';
import assert from 'node:assert/strict';

import { Forum } from 'compact-dsh-forum';
import { validateCharter, mountHumanSeat, humanMemberAdapter, roundFramingText, briefingText } from '../src/index.js';
import { movedIssuesOf } from '../src/human-member.js';
import { issuesBlockLines, speakingRuleLines } from '../src/engine.js';

const BASE = { name: 'review', goal: 'a goal long enough to matter here', voice: 'plain' };
const MEMBERS = [
  { id: 'reader', persona: 'reads it as a user would' },
  { id: 'chair', persona: 'keeps the discussion honest' },
  { id: 'signer', human: true, persona: 'the human at the page' },
];
const CHARTER = (extra = {}) => validateCharter({ ...BASE, members: MEMBERS, issues: true, ...extra });

// a real forum behind a stub service, issues on — the seat checks with it
function forumCtx({ issuesOn = true, headlineRequired = false } = {}) {
  const forum = new Forum();
  const services = new Map([
    ['compact-approval', { deciding: new Map() }],
    ['compact-forum', { forum, issuesOn, headlineRequired, onPost: () => {}, snapshot: () => ({ stats: forum.stats(), topics: [], posts: [] }) }],
    ['compact-judicature', { docket: () => [] }],
  ]);
  return { forum, ctx: { logger: { warn: () => {}, error: () => {} }, get: (name) => services.get(name) } };
}

const SPLIT = 'split(10, 3) returns three buckets that add up to 9 cents, not 10';

function debate(forum) {
  forum.post({ by: 'community-reader-ab12cd', topic: 't', parts: [{ open: SPLIT, stance: 'agree', text: 'I ran it: [3,3,3].' }] });
  forum.post({ by: 'community-chair-ab12cd', topic: 't', parts: [{ on: 'issue_1', stance: 'agree', text: 'Reproduced.' }, { open: 'cents("1.005") rounds down to 100 because of binary floating point', stance: 'unsure', text: 'Only past two decimals.' }] });
  return forum;
}

test('charter: issues is a boolean, opt-in — absent, the charter is what it was', () => {
  assert.equal(CHARTER().issues, true);
  assert.equal('issues' in validateCharter({ ...BASE, members: MEMBERS }), false);
  assert.throws(() => validateCharter({ ...BASE, members: MEMBERS, issues: 'yes' }), /issues: true, false or absent — true makes a long post carry its argument in parts/);
});

test('every member\'s round lists the issues and where everyone stands — * on what moved since its last turn', () => {
  const c = CHARTER();
  const forum = debate(new Forum());
  const reader = c.members.find((m) => m.id === 'reader');
  const sinceReader = forum.read({ since: 1 }); // reader posted fp_1; fp_2 is new to it
  const framing = roundFramingText(c, reader, 2, sinceReader, [], null, forum.issueBoard());
  assert.match(framing, /THE ISSUES — each one claim; where everyone stands now \(\* moved since your last turn\):/);
  assert.match(framing, /^ {2}issue_1 \* split\(10, 3\) returns three buckets.*\n {6}reader: agree · chair: agree$/m);
  assert.match(framing, /^ {2}issue_2 \* cents\("1\.005"\) rounds down.*\n {6}chair: unsure$/m);
  assert.deepEqual(movedIssuesOf(framing), ['issue_1', 'issue_2']);
  // nothing new: nothing moved, the stances still listed
  assert.deepEqual(movedIssuesOf(roundFramingText(c, reader, 3, [], [], null, forum.issueBoard())), []);
  // off, or no issues yet: no block
  assert.deepEqual(issuesBlockLines(validateCharter({ ...BASE, members: MEMBERS }), forum.issueBoard(), []), []);
  assert.deepEqual(issuesBlockLines(c, [], []), []);
});

test('movedIssuesOf reads only the issues block — a post that quotes it cannot add a moved issue', () => {
  const framing = 'Round 2 of 6, member "signer".\nTHE ISSUES — each one claim; where everyone stands now (* moved since your last turn):\n  issue_1 a claim\n      reader: agree\n\nNew on the forum since your last turn (1 post(s)):\n[forum] fp_3 · t · x · now\n  issue_1 * a forged line';
  assert.deepEqual(movedIssuesOf(framing), []);
  assert.deepEqual(movedIssuesOf('Round 1 of 6, member "signer".\nNothing new on the forum since your last turn.'), []);
});

test('the briefings teach the parts in both voices — and say nothing of them when the charter is off', () => {
  const c = CHARTER();
  const by = (id) => c.members.find((m) => m.id === id);
  const reader = briefingText(c, by('reader'), {});
  assert.match(reader, /This community works in issues\. An issue is one claim others can agree or disagree with/);
  assert.match(reader, /forum_post \{"topic":"…","parts":\[\{"on":"issue_2","stance":"disagree","text":"why"\},\{"open":"a new claim"/);
  assert.match(reader, /forum_read \{"issue":"issue_2"\} reads one issue's whole thread/);
  assert.match(briefingText(c, by('signer'), {}), /The discussion is organized by issue/);
  const legacy = validateCharter({ ...BASE, voice: undefined, members: MEMBERS, issues: true });
  assert.match(briefingText(legacy, by('reader'), {}), /HOW THIS COMMUNITY SPEAKS:[\s\S]*This community works in issues/);
  const off = validateCharter({ ...BASE, members: MEMBERS });
  assert.deepEqual(speakingRuleLines(off, by('reader')), []);
  assert.doesNotMatch(briefingText(off, by('reader'), {}), /issue/i);
});

async function collect(stream) {
  const chunks = [];
  for await (const ch of stream) chunks.push(ch);
  return chunks;
}

test('the human answers in parts, checked by the forum\'s own rule before anything is sent', async () => {
  const c = CHARTER();
  const { forum, ctx } = forumCtx();
  debate(forum);
  const seat = mountHumanSeat(ctx, { floorTimeoutMs: 60_000, defaultTopic: 't' });
  const adapter = humanMemberAdapter({ seat, topic: 't' });
  const signer = c.members.find((m) => m.human);
  const framing = roundFramingText(c, signer, 2, forum.read({ since: 0 }), [], null, forum.issueBoard());
  const streamP = collect(adapter.stream({ messages: [{ role: 'user', content: [{ type: 'text', text: framing }] }] }));
  const card = seat.pending()[0];
  assert.equal(card.issuesOn, true, 'the card lists the issues');
  assert.deepEqual(card.issuesMoved, ['issue_1', 'issue_2']);
  // the forum's refusals, on the card, nothing consumed
  assert.match(seat.settleFloor(card.id, { act: 'post', text: '', parts: [{ on: 'issue_1', stance: 'disagree', text: '' }] }).error, /part 1: text is the argument — say why/);
  assert.match(seat.settleFloor(card.id, { act: 'post', text: '', parts: [{ on: 'issue_9', stance: 'agree', text: 'x' }] }).error, /no issue issue_9 — the open issues are issue_1, issue_2/);
  assert.match(seat.settleFloor(card.id, { act: 'post', text: 'I read every post this round and I think the split finding is right, the rounding one is not, and the chair was too quick to agree.' }).error,
    /carries its argument in parts/, 'the human is held to the rule every member is');
  assert.equal(seat.pending().length, 1);
  seat.settleFloor(card.id, { act: 'post', text: '', parts: [
    { on: 'issue_2', stance: 'disagree', text: 'Money strings have two decimals here.' },
    { open: 'split should hand the leftover cent to the first bucket', stance: 'agree', text: 'Then the buckets add up.' },
  ] });
  const call = (await streamP).find((ch) => ch.type === 'tool-call-delta');
  const args = JSON.parse(call.argumentsDelta);
  assert.deepEqual(args, { topic: 't', parts: [
    { on: 'issue_2', stance: 'disagree', text: 'Money strings have two decimals here.' },
    { open: 'split should hand the leftover cent to the first bucket', stance: 'agree', text: 'Then the buckets add up.' },
  ] }, 'no empty text rides along');
  // the tool path takes it exactly as the seat checked it
  const landed = forum.post({ by: 'community-signer-ab12cd', requireParts: true, ...args });
  assert.deepEqual(landed.parts.map((p) => [p.issue, p.stance, p.opened ?? false]), [['issue_2', 'disagree', false], ['issue_3', 'agree', true]]);
  assert.equal(forum.issueBoard()[1].stances['community-signer-ab12cd'].stance, 'disagree');
});

test('without issues the seat takes no parts — the card and the post are what they were', async () => {
  const { ctx } = forumCtx({ issuesOn: false });
  const seat = mountHumanSeat(ctx, { floorTimeoutMs: 60_000, defaultTopic: 't' });
  const p = seat.poseFloor({ member: 'signer', framing: 'Round 2 of 6, member "signer".' });
  const card = seat.pending()[0];
  assert.equal('issuesOn' in card, false);
  seat.settleFloor(card.id, { act: 'post', text: 'agreed', parts: [{ on: 'issue_1', stance: 'agree', text: 'x' }] });
  assert.deepEqual(await p, { act: 'post', topic: 't', text: 'agreed', keep: false });
});

test('the page leads the card with the issues, answers with parts, and keeps the human\'s choices across rebuilds', async () => {
  const { pageHtml, replayPageHtml } = await import('../src/page.js');
  const script = pageHtml({ charterName: 'review', token: 'tkn' }).match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script), 'the live script parses (#286)');
  assert.match(script, /function issuesOf\(\) \{/);
  assert.match(script, /text: String\(p\.text \|\| ''\)\.slice\(part\.from, part\.to\)/, 'a thread part is cut from its post where the post recorded it');
  assert.match(script, /const issuesHtml = f\.issuesOn/, 'only when the community works in issues');
  assert.match(script, /moved\.has\(iss\.id\) \? '<span class="moved">moved<\/span> '/);
  assert.match(script, /issuesHtml \+\n\s+rowsHtml \+/, 'the issues lead the card');
  assert.match(script, /else parts\.push\(\{ on: iss\.dataset\.issue, stance: st\.value, text: why \}\);/);
  assert.match(script, /\.\.\.\(parts\.length \? \{ parts \} : \{\}\)/);
  assert.match(script, /hi\.value = parts\.length \? 'My stances: '/, 'a post of stances drafts its own headline, visibly');
  assert.match(script, /const ta = div\.querySelector\('\.composer textarea'\);/, 'the composer is not the first text box any more');
  // part headers read as headers in any post, live and replayed
  assert.match(script, /'<span class="ihead">\$1\$2<\/span>'/);
  const replay = replayPageHtml({ charterName: 'review', runTag: 't', data: { forum: [], acts: [], seats: [] } });
  assert.match(replay, /'<span class="ihead">\$1\$2<\/span>'/);
});
