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
