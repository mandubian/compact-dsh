import test from 'node:test';
import assert from 'node:assert/strict';
import { legibility, LEGAL_TERMS } from './forum-legibility.mjs';

test('legibility counts what a human reader has to chase — words, references, legal terms, long questions', () => {
  const posts = [
    { id: 'fp_1', by: 'community-accuser-aaaaaa', text: 'split loses a cent' },
    { id: 'fp_2', by: 'community-defender-aaaaaa', text: 'Reproduction of (1), attacked in fp_1: the ledger stands. $ node -e x' },
    { id: 'fp_3', by: 'community-skeptic-aaaaaa', text: 'I ran it again: [33,33,33] sums to 99, so one cent is lost.' },
  ];
  const m = legibility(posts, ['Do you adopt (4)-(7)?']);
  assert.equal(m.agentPosts, 2, 'the human\'s own posts are not measured');
  assert.equal(m.references, 2, 'fp_1 and (1)');
  assert.equal(m.commands, 1);
  assert.deepEqual(m.legalTermsBy, { ledger: 1, reproduction: 1, attack: 1 });
  assert.equal(m.questionsToHuman, 1);
  assert.equal(m.questionCharsMax, 'Do you adopt (4)-(7)?'.length);
  assert.ok(LEGAL_TERMS.includes('governed act'));
});

test('the human is read from the run\'s seats, forms are counted, and the reading before each answer is measured', () => {
  const posts = [
    { id: 'fp_1', by: 'community-signer-3153e5', text: 'I helped write it; tell me your contests.' },
    { id: 'fp_2', by: 'community-reader-3153e5', text: 'one two three four five' },
    { id: 'fp_3', by: 'community-chair-3153e5', text: 'six seven eight' },
    { id: 'fp_4', by: 'community-signer-3153e5', text: 'ACCEPTED' },
    { id: 'fp_5', by: 'community-chair-3153e5', text: 'a b c d e f g h i j' },
    { id: 'fp_6', by: 'community-signer-3153e5', text: 'My answers to the form: 1. ACCEPTED' },
  ];
  // by the old names, a human called "signer" was measured as an agent
  assert.equal(legibility(posts).agentPosts, 6);
  const m = legibility(posts, [], { humans: new Set(['signer']), forms: [{ title: 'the ledger', items: 9 }, { title: 'the close', items: 3 }] });
  assert.equal(m.agentPosts, 3, 'the seats say who the human is');
  assert.equal(m.wordsTotal, 18);
  assert.equal(m.formsToHuman, 2);
  assert.equal(m.formItems, 12);
  assert.equal(m.humanAnswers, 2, 'the opening post answers nobody');
  assert.equal(m.readBeforeAnswerMax, 10);
  assert.equal(m.readBeforeAnswer, 10, 'the median of [8, 10]');
});
