// The ask card's tests (packages/card): the card is a browser renderer, so
// these tests load the served bundle (lib/client.js) in Node with the module
// loader facade and a stub require — the same factory the browser runs. What
// is pinned here is what the envelope owes its audiences: the parse never
// narrows the R-3 floor (the rule and EVERY move), the select claims only
// approval pending-interactions and declines the rest, the registration
// out-prioritizes upstream's panel without removing it, and the non-
// canonical fallback face renders the reason as-is. The visual face itself
// is judged on the live web surface, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope } from 'compact-envelope';

// ── load the served bundle with the loader facade stubbed ──

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def; } } };
await import('../lib/client.js');

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState: (init) => [init, () => {}],
};
const fakeButton = (props, ...children) => ({ type: 'Button', props: props ?? {}, children: children.flat() });
const stubRequire = (name) => {
  if (name === 'react') return fakeReact;
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: fakeButton };
  throw new Error(`unexpected require: ${name}`);
};

assert.equal(captured.id, 'compact-dsh-card');
const card = captured.factory(stubRequire);

// ── tree helpers ──

function* walk(node) {
  if (node == null || typeof node === 'boolean') return;
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
  if (typeof node === 'object') {
    yield node;
    for (const child of [].concat(node.children ?? [])) yield* walk(child);
    return;
  }
  yield node;
}
const textOf = (node) => [...walk(node)].filter(n => typeof n === 'string').join('');
const findAll = (node, pred) => [...walk(node)].filter(pred);
const findByClass = (node, cls) => findAll(node, n => typeof n === 'object' && n.props?.className === cls);

// ── fixtures: the canonical shapes the ask builders emit ──

const FINGERPRINT_ASK = buildEnvelope({
  gate: 'AG', ruleId: 'fp_ab12cd34',
  reason: `"bash" is not covered by this runtime's grant layers. Approving once also covers the identical operation until the exec-cache TTL elapses.`,
  lawfulNextMoves: ['request a scoped session grant for this target', 'use an approved alternative', 'escalate to your Principal'],
});
const SECRET_ASK = buildEnvelope({
  gate: 'AG', ruleId: 'I-5/secret-use',
  reason: 'the command references a declared secret',
  lawfulNextMoves: ['rephrase without the secret reference', 'escalate to your Principal'],
});

test('the bundle registers under its package id', () => {
  assert.equal(captured.id, 'compact-dsh-card');
});

test('parseAsk splits the canonical envelope: chip, reason, every move', () => {
  const parsed = card.parseAsk(FINGERPRINT_ASK.text);
  assert.equal(parsed.gate, 'AG');
  assert.equal(parsed.ruleId, 'fp_ab12cd34');
  assert.equal(parsed.reason, FINGERPRINT_ASK.reason);
  assert.deepEqual(parsed.moves, FINGERPRINT_ASK.lawfulNextMoves.map(m => `— ${m}`));
});

test('parseAsk keeps a ruleId that itself carries slashes', () => {
  const parsed = card.parseAsk(SECRET_ASK.text);
  assert.equal(parsed.gate, 'AG');
  assert.equal(parsed.ruleId, 'I-5/secret-use');
  assert.equal(parsed.moves.length, 2);
});

test('parseAsk tolerates a head with no ruleId and no moves block', () => {
  const parsed = card.parseAsk('[RA] the network target is not named');
  assert.equal(parsed.gate, 'RA');
  assert.equal(parsed.ruleId, null);
  assert.equal(parsed.reason, 'the network target is not named');
  assert.deepEqual(parsed.moves, []);
});

test('the R-3 floor: no move line is ever dropped or rewritten, whatever its shape', () => {
  const text = '[AG/fp_x] reason here\nLawful next moves:\n— a normal move\na line without a dash\n— another move\n';
  const parsed = card.parseAsk(text);
  assert.deepEqual(parsed.moves, ['— a normal move', 'a line without a dash', '— another move', '']);
});

test('the parse is verbatim: whitespace survives, a head without the canonical single space does not parse', () => {
  // the reason is the exact substring after '] ' — trailing spaces, extra
  // separators, and blank lines are all preserved (the renderer, not the
  // parser, skips whitespace-only rows)
  const parsed = card.parseAsk('[AG/fp_x]  two spaces and a trailing one \nLawful next moves:\n—  spaced move  \n\n— next\n');
  assert.equal(parsed.reason, ' two spaces and a trailing one ');
  assert.deepEqual(parsed.moves, ['—  spaced move  ', '', '— next', '']);
  // the canonical builder emits exactly one space; anything else is not the
  // canonical shape and takes the fallback face
  assert.equal(card.parseAsk('[AG/fp_x]no-space'), null);
  assert.equal(card.parseAsk('[AG/fp_x]\nno space'), null);
});

test('parseAsk returns null for anything that is not a canonical envelope', () => {
  assert.equal(card.parseAsk(undefined), null);
  assert.equal(card.parseAsk(''), null);
  assert.equal(card.parseAsk('Tool X requests privileged execution'), null);
  assert.equal(card.parseAsk('the record keeps what it prints'), null);
});

test('the select claims only approval pending-interactions', () => {
  const approval = { kind: 'approval', reason: FINGERPRINT_ASK.text };
  assert.equal(card.selectAsk({ pendingInteraction: approval }), approval);
  assert.equal(card.selectAsk({ pendingInteraction: { kind: 'user-question' } }), null);
  assert.equal(card.selectAsk({}), null);
});

test('apply registers one composer takeover at priority 0 with the same select', () => {
  const injected = [];
  const registered = [];
  const ctx = {
    slots: {
      inject: (key, factory) => injected.push([key, factory]),
      register: (options, component) => registered.push([options, component]),
    },
  };
  card.apply(ctx);
  assert.deepEqual(injected.map(([key]) => key), ['conversation.composer']);
  assert.deepEqual(card.inject, ['slots']);
  injected[0][1]();
  const [[options, component]] = registered;
  assert.equal(options.name, 'conversation.composer');
  assert.equal(options.priority, 0);
  assert.equal(options.select, card.selectAsk);
  assert.equal(component, card.CompactCard);
});

test('the canonical face: chip, intact line breaks, one verbatim row per move, both buttons', () => {
  const tree = card.CompactCard({ matched: { kind: 'approval', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' } });
  const chip = findByClass(tree, 'compact-card-chip');
  assert.equal(chip.length, 1);
  assert.equal(textOf(chip[0]), 'AG/fp_ab12cd34');
  const reason = findByClass(tree, 'compact-card-reason');
  assert.equal(textOf(reason[0]), FINGERPRINT_ASK.reason);
  const moves = findByClass(tree, 'compact-card-moves-list');
  const rows = findAll(moves[0], n => typeof n === 'object' && n.type === 'li');
  assert.equal(rows.length, FINGERPRINT_ASK.lawfulNextMoves.length);
  // each row IS its source line — the builder's dash rides in the text
  assert.deepEqual(rows.map(textOf), FINGERPRINT_ASK.lawfulNextMoves.map(m => `— ${m}`));
  const labels = findAll(tree, n => typeof n === 'object' && n.type === fakeButton).map(b => textOf(b));
  assert.deepEqual(labels, ['Deny', 'Allow once']);
  const raw = findByClass(tree, 'compact-card-raw');
  assert.equal(textOf(findAll(raw[0], n => typeof n === 'object' && n.type === 'pre')[0]), FINGERPRINT_ASK.text);
});

test('a move line without a dash renders without one; whitespace-only rows render none', () => {
  const text = '[AG/fp_x] reason here\nLawful next moves:\n— a normal move\na line without a dash\n\n— another move\n';
  const tree = card.CompactCard({ matched: { kind: 'approval', reason: text, answer: async () => 'rejected' } });
  const rows = findAll(findByClass(tree, 'compact-card-moves-list')[0], n => typeof n === 'object' && n.type === 'li');
  assert.deepEqual(rows.map(textOf), ['— a normal move', 'a line without a dash', '— another move']);
});

test('the fallback face: a non-canonical ask renders as-is, no chip, no moves', () => {
  const foreign = 'Tool X requests privileged execution';
  const tree = card.CompactCard({ matched: { kind: 'approval', reason: foreign, answer: async () => 'rejected' } });
  assert.equal(findByClass(tree, 'compact-card-chip').length, 0);
  assert.equal(findByClass(tree, 'compact-card-moves').length, 0);
  assert.equal(textOf(findByClass(tree, 'compact-card-reason')[0]), foreign);
  const labels = findAll(tree, n => typeof n === 'object' && n.type === fakeButton).map(b => textOf(b));
  assert.deepEqual(labels, ['Deny', 'Allow once']);
});

test('a missing reason degrades to the no-reason face instead of crashing', () => {
  const tree = card.CompactCard({ matched: { kind: 'approval', answer: async () => 'rejected' } });
  assert.equal(findByClass(tree, 'compact-card-chip').length, 0);
  assert.equal(textOf(findByClass(tree, 'compact-card-reason')[0]), '(no reason given)');
});
