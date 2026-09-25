// The projection property tests: the R-3 floor — the rule id and EVERY
// lawful next move, verbatim — survives the T2 projection for every glossed
// rule; the T3 card contains what the operator needs and the raw envelope
// verbatim; the tier resolution refuses what it does not know (D-7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnvelope } from '../src/index.js';
import { instructionalText, operatorCard, resolveTier, bandTier, BAND_TIERS } from '../src/project.js';
import { GLOSS } from '../../guide/src/gloss.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseKey(key) {
  // rule ids contain slashes (RA/D-7/opaque-network): the FIRST segment is
  // the gate, everything after it is the ruleId
  const at = key.indexOf('/');
  return { gate: key.slice(0, at), ruleId: key.slice(at + 1) };
}

function syntheticEnv(key, moves = ['alpha lawful move', 'beta lawful move', 'escalate to your Principal']) {
  const { gate, ruleId } = parseKey(key);
  return buildEnvelope({ gate, ruleId, reason: `synthetic reason for ${key}`, lawfulNextMoves: moves });
}

test('T2 preserves the R-3 floor for every glossed rule — rule id and every move, verbatim', () => {
  for (const key of Object.keys(GLOSS)) {
    const { gate, ruleId } = parseKey(key);
    const env = syntheticEnv(key);
    const t2 = instructionalText(env, GLOSS[key]);
    assert.ok(t2.includes(`[${gate}/${ruleId}]`), `${key}: T2 must name the rule`);
    for (const m of env.lawfulNextMoves) {
      assert.ok(t2.includes(m), `${key}: T2 must carry every lawful next move verbatim — lost: "${m}"`);
    }
    assert.ok(t2.includes('Lawful next moves:'), `${key}: T2 must label the moves`);
  }
});

test('T2 leads with the procedure, and with the canonical reason when no gloss exists', () => {
  const env = syntheticEnv('RA/D-7/opaque-network');
  const t2 = instructionalText(env, GLOSS['RA/D-7/opaque-network']);
  assert.ok(t2.startsWith('Refused [RA/D-7/opaque-network]:'), 'glossed T2 leads with the verdict + rule + title');
  assert.ok(t2.includes(GLOSS['RA/D-7/opaque-network'].instruction), 'T2 carries the instructional line');

  // degrade: no gloss → the canonical reason, never invented prose
  const bare = syntheticEnv('RA/D-7/opaque-network');
  const t2bare = instructionalText(bare, undefined);
  assert.ok(t2bare.includes('synthetic reason for RA/D-7/opaque-network'), 'unglossed T2 falls back to the canonical reason');
  for (const m of bare.lawfulNextMoves) assert.ok(t2bare.includes(m), 'unglossed T2 still carries every move');
});

test('T2 says "Needs approval" for asks — an ask is not a refusal', () => {
  const env = syntheticEnv('AG/I-5/secret-use');
  const t2 = instructionalText(env, GLOSS['AG/I-5/secret-use'], { kind: 'ask' });
  assert.ok(t2.startsWith('Needs approval [AG/I-5/secret-use]:'), 'an ask leads as an ask');
  assert.ok(!t2.startsWith('Refused'), 'an ask must not lead as a refusal');
});

test('T3 carries title, why, rule, example, moves with operator actions, and the raw envelope verbatim', () => {
  const env = syntheticEnv('RA/D-7/opaque-network', [
    'rephrase with a literal host or URL so the request can be gated per-host',
    'escalate to your Principal',
  ]);
  const gloss = GLOSS['RA/D-7/opaque-network'];
  const card = operatorCard(env, gloss);
  assert.ok(card.startsWith('Not run: The network target is not named'), 'card leads with the plain title');
  assert.ok(card.includes(gloss.why), 'card carries the why');
  assert.ok(card.includes('Rule: RA/D-7/opaque-network'), 'card names the rule');
  assert.ok(card.includes(`Refused path — e.g. ${gloss.example.blocked[0]}`), 'card shows the blocked example');
  assert.ok(card.includes(`Lawful path — e.g. ${gloss.example.lawful[0]}`), 'card shows the lawful example');
  assert.ok(card.includes('What can happen next:'), 'card lists the moves');
  assert.ok(card.includes('escalate to your Principal → the agent will surface the blocker'),
    'operator moves render with their operator action');
  assert.ok(card.includes('Raw envelope:'), 'card ends with the raw envelope');
  assert.ok(card.includes(env.text), 'the canonical envelope is present verbatim — the identity, one glance away');
});

test('T3 for an ask leads as an ask; T3 without a gloss still shows the rule and the raw envelope', () => {
  const env = syntheticEnv('AG/I-5/secret-use');
  const card = operatorCard(env, GLOSS['AG/I-5/secret-use'], { kind: 'ask' });
  assert.ok(card.startsWith('Approval requested:'), 'an ask card leads as an ask');

  const bare = operatorCard(syntheticEnv('EG/no-grant'), undefined);
  assert.ok(bare.includes('Rule: EG/no-grant'), 'unglossed card still names the rule');
  assert.ok(bare.includes('Raw envelope:'), 'unglossed card still carries the raw envelope');
  assert.ok(bare.includes('synthetic reason for EG/no-grant'), 'unglossed card falls back to the canonical reason');
});

test('tier resolution: default full, declared instructional, unknown refuses (D-7)', () => {
  assert.equal(resolveTier(null), 'full');
  assert.equal(resolveTier(''), 'full');
  assert.equal(resolveTier(undefined), 'full');
  assert.equal(resolveTier('full'), 'full');
  assert.equal(resolveTier('instructional'), 'instructional');
  assert.deepEqual(BAND_TIERS, ['full', 'instructional']);
  assert.throws(() => resolveTier('Instructional'), /unknown envelope band tier/, 'case-sensitive: a near-miss refuses');
  assert.throws(() => resolveTier('t2'), /unknown envelope band tier/);
  assert.equal(bandTier('instructional'), 'instructional');
  assert.equal(bandTier(undefined), 'full');
});
