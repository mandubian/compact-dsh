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
  useEffect: () => {},
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
  // #107 + #173 shape: the cause leads, the mechanical restatement is demoted
  // behind it, and each disclosure rides its own labeled line
  reason: `First touch: nothing has ever covered host=api.example.com in this runtime — no grant row, no cached approval. ` +
    `"bash" is not covered by this runtime's grant layers.\n` +
    `Replay: Approving once also covers the identical operation until the exec-cache TTL elapses.\n` +
    `Connectivity: This gate's approval is consent, not connectivity: the command will fail at connect.`,
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
  // #172: the directoryFlow holes ride the same inject — the picker flow
  assert.deepEqual(injected.map(([key]) => key),
    ['conversation.composer', 'sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow']);
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
  // the reason renders one row per source line (#173) — the rows concatenate
  // back to the source; the container's flattened text has no separators
  assert.deepEqual(findByClass(tree, 'compact-card-reason-row').map(textOf), FINGERPRINT_ASK.reason.split('\n'));
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

test('#173: one row per reason line, the disclosure labels bolded, the text verbatim', () => {
  const tree = card.CompactCard({ matched: { kind: 'approval', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' } });
  const rows = findByClass(tree, 'compact-card-reason-row');
  assert.deepEqual(rows.map(textOf), FINGERPRINT_ASK.reason.split('\n'),
    'the rows concatenate back to the source, byte for byte');
  const bolded = findByClass(tree, 'compact-card-reason-label');
  assert.deepEqual(bolded.map(textOf), ['Replay:', 'Connectivity:'],
    'exactly the composer\'s labeled lines carry a bold span — the lead row never does');
});

test('#173: the fallback face never label-styles foreign text, whatever it looks like', () => {
  // a non-canonical ask that happens to carry a `Word: ` line renders as-is —
  // the bold is the canonical face's layout, not a claim about foreign prose
  const foreign = 'Approval requested by plugin X\nNote: this is not a canonical envelope';
  const tree = card.CompactCard({ matched: { kind: 'approval', reason: foreign, answer: async () => 'rejected' } });
  assert.equal(findByClass(tree, 'compact-card-reason-row').length, 0, 'no rows on the fallback face');
  assert.equal(findByClass(tree, 'compact-card-reason-label').length, 0, 'no bold spans on the fallback face');
  assert.equal(textOf(findByClass(tree, 'compact-card-reason')[0]), foreign);
});

// ── the command: what "yes" runs, read from the session's chat state ──

const chatWith = (root) => (selector) => selector({
  nodes: new Map([[`k:${root.callId}`, { kind: 'tool-call', data: { root } }]]),
});
const CURL_CALL = { callId: 'call-1', argsRaw: JSON.stringify({ command: 'curl https://example.com' }) };

test('the command box shows the exact command, above the reason', () => {
  const tree = card.CompactCard({
    matched: { kind: 'approval', callId: 'call-1', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' },
    useChat: chatWith(CURL_CALL),
  });
  assert.equal(findByClass(tree, 'compact-card-deciding').length, 1, 'the deciding block must render');
  assert.equal(textOf(findByClass(tree, 'compact-card-deciding-label')[0]), 'You are approving');
  assert.equal(textOf(findByClass(tree, 'compact-card-command')[0]), 'curl https://example.com');
  // order: the command rides BEFORE the reason — what "yes" runs first,
  // consequences after
  const names = findByClass(tree, 'compact-card-body')[0].children.filter(Boolean).map(n => n.props?.className);
  assert.ok(names.indexOf('compact-card-deciding') < names.indexOf('compact-card-reason'), `command must precede reason, got: ${names}`);
});

test('a tool call with no command arg renders no box, never a guess', () => {
  const tree = card.CompactCard({
    matched: { kind: 'approval', callId: 'call-2', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' },
    useChat: chatWith({ callId: 'call-2', argsRaw: JSON.stringify({ path: '/tmp/x' }) }),
  });
  assert.equal(findByClass(tree, 'compact-card-deciding').length, 0);
});

test('malformed argsRaw and a pruned node degrade to no box, no crash', () => {
  const malformed = card.CompactCard({
    matched: { kind: 'approval', callId: 'call-3', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' },
    useChat: chatWith({ callId: 'call-3', argsRaw: '{not json' }),
  });
  assert.equal(findByClass(malformed, 'compact-card-deciding').length, 0);
  const pruned = card.CompactCard({
    matched: { kind: 'approval', callId: 'call-9', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' },
    useChat: chatWith(CURL_CALL),
  });
  assert.equal(findByClass(pruned, 'compact-card-deciding').length, 0);
});

test('one malformed node never hides the correlated call sitting after it', () => {
  const snapshot = {
    nodes: new Map([
      ['bad-shape', { kind: 'tool-call', data: null }],
      ['bad-root', { kind: 'tool-call', data: { root: 42 } }],
      ['good', { kind: 'tool-call', data: { root: CURL_CALL } }],
    ]),
  };
  const tree = card.CompactCard({
    matched: { kind: 'approval', callId: 'call-1', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' },
    useChat: (selector) => selector(snapshot),
  });
  assert.equal(textOf(findByClass(tree, 'compact-card-command')[0]), 'curl https://example.com');
});

test('the args JSON under `arguments` (not only argsRaw) is accepted', () => {
  const tree = card.CompactCard({
    matched: { kind: 'approval', callId: 'call-1', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' },
    useChat: chatWith({ callId: 'call-1', arguments: JSON.stringify({ command: 'curl https://example.com' }) }),
  });
  assert.equal(textOf(findByClass(tree, 'compact-card-command')[0]), 'curl https://example.com');
});

test('no useChat (tests, foreign surfaces): the card renders without the command box', () => {
  const tree = card.CompactCard({ matched: { kind: 'approval', callId: 'call-1', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' } });
  assert.equal(findByClass(tree, 'compact-card-deciding').length, 0);
  assert.equal(findByClass(tree, 'compact-card-reason').length, 1);
  const labels = findAll(tree, n => typeof n === 'object' && n.type === fakeButton).map(b => textOf(b));
  assert.deepEqual(labels, ['Deny', 'Allow once']);
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

// ── #201: the pattern offers cross the wire — the server guards the pick ──

test('the card-api service serves the deciding view and guards the pick (D-8: pick, never author)', async () => {
  const { CompactCardApi } = await import('../src/index.js');
  const { Context } = await import('@deepseek-ai/cordis');
  const offers = [
    { pattern: { kind: 'ExactHost', value: 'night.example' }, text: 'ExactHost:night.example', scope: 'every call to night.example', ttlMs: 3_600_000, maxUses: 50, methodClass: 'read' },
    { pattern: { kind: 'UrlPrefix', value: 'https://night.example/' }, text: 'UrlPrefix:https://night.example/', scope: 'everything on night.example', ttlMs: 3_600_000, maxUses: 50, methodClass: 'read' },
  ];
  const view = { patternOffers: offers, query: ['q'] };
  const ctx = new Context();
  ctx.provide('compact-approval', { deciding: new Map([['call-1', view]]) });
  const api = new CompactCardApi(ctx);

  const empty = await api.decidingView({ callId: 'unknown' });
  assert.deepEqual(empty, { offers: [], query: null }, 'an unknown ask degrades silently');
  const seen = await api.decidingView({ callId: 'call-1' });
  assert.equal(seen.offers, offers, 'the computed rows, byte-faithful');

  // the guarded pick: a valid index writes the choice on the view
  const ok = await api.patternAnswer({ callId: 'call-1', index: 1, runtime: true });
  assert.deepEqual(ok, { ok: true, text: offers[1].text, scope: 'runtime' });
  assert.equal(view.patternChoice, offers[1], 'the pick is the offer object the guard owns');
  assert.equal(view.patternScope, 'runtime', '#187: the night-pass scope rides the pick');

  // everything else is refused: forged index, malformed, unknown ask, cleared view
  assert.equal((await api.patternAnswer({ callId: 'call-1', index: 9 })).ok, false, 'out of range');
  assert.equal((await api.patternAnswer({ callId: 'call-1', index: '0; drop table' })).ok, false, 'malformed');
  assert.equal((await api.patternAnswer({ callId: 'nope', index: 0 })).ok, false, 'unknown ask');
  assert.equal((await api.patternAnswer({ index: 0 })).ok, false, 'no callId');
  delete view.patternOffers;
  assert.equal((await api.patternAnswer({ callId: 'call-1', index: 0 })).ok, false, 'a cleared view authorizes nothing');
  assert.equal(view.patternChoice, offers[1], 'refused picks never touched the view');
});

test('the client picks through the wire builders and renders the offer buttons', async () => {
  const { CompactCard } = card;
  const offers = [
    { pattern: { kind: 'ExactHost', value: 'night.example' }, text: 'ExactHost:night.example', scope: 'every call to night.example', ttlMs: 3_600_000, maxUses: 50, methodClass: 'read' },
  ];
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ type: 'server-response', rpcId: 'r', result: { ok: true } }) };
  };
  const answered = [];
  const approval = {
    kind: 'approval', callId: 'call-wire',
    reason: '[AG/fp_1] First touch: nothing has ever covered host=night.example …\nWiden: a pattern answer materializes one of ExactHost:night.example (every call to night.example) — for 1h and 50 uses, revocable (grants-revoke); …\nLawful next moves:\n— escalate to your Principal',
    answer: async (outcome) => { answered.push(outcome); },
  };
  // the wire builders: envelope shape matches the gateway's schema exactly
  const envelope = card.rpcEnvelope('compact-card-api/patternAnswer', { args: { callId: 'call-wire', index: 0, runtime: true } });
  assert.equal(envelope.type, 'client-request');
  assert.equal(envelope.method, 'compact-card-api/patternAnswer');
  assert.deepEqual(envelope.payload, { args: { callId: 'call-wire', index: 0, runtime: true } }, 'exactly one plain-object args field — the gateway refuses anything else');
  // and the body pickPattern ACTUALLY sends carries that same payload
  const before = calls.length;
  await card.pickPattern('call-wire', 0, true);
  const sent = calls[before];
  assert.equal(sent.url, '/api/compact-card-api/patternAnswer');
  assert.deepEqual(sent.body.payload, { args: { callId: 'call-wire', index: 0, runtime: true } },
    'the wire payload is the args object the server method reads — no extra wrapper, no extra keys');
  // the guarded flow: pick first (awaited), then the ordinary allow
  await card.pickPattern('call-wire', 0, true).then(() => approval.answer('allowed-once'));
  assert.equal(answered[0], 'allowed-once', 'the pick rides the ordinary allow — one outcome on the wire');
  // the render: one button per offer + the runtime toggle + the hint-free deny/allow pair
  const tree = CompactCard({ matched: approval, offers });
  const json = JSON.stringify(tree);
  assert.ok(json.includes('Allow + cover ExactHost:night.example'), 'the offer renders as a button');
  assert.ok(json.includes('every session of this runtime'), 'the scope toggle renders');
  assert.ok(json.includes('Deny') && json.includes('Allow once'), 'the two standing buttons remain');
  delete globalThis.fetch;
});

test('#201 diagnostic: a failed offer fetch renders the named reason, and the two buttons stand', () => {
  const tree = card.CompactCard({ matched: { kind: 'approval', callId: 'c-diag', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' }, offers: [], widenError: 'compact-card-api 401' });
  const json = JSON.stringify(tree);
  assert.ok(json.includes('Widen unavailable'), 'the degrade is named, never silent');
  assert.ok(json.includes('compact-card-api 401 — the two buttons stand.'), 'the reason rides the card');
  assert.ok(json.includes('Deny') && json.includes('Allow once'), 'the two buttons stand');
  assert.ok(!json.includes('Allow + cover'), 'no offer buttons without offers');
  // empty offers WITHOUT a fetch failure render nothing — Widen not
  // applying to an ask is silence, never an "unavailable" row
  const quiet = card.CompactCard({ matched: { kind: 'approval', callId: 'c-quiet', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' }, offers: [] });
  assert.ok(!JSON.stringify(quiet).includes('Widen unavailable'),
    'Widen not applying to an ask is silence, not a failure');
  const failed = card.CompactCard({ matched: { kind: 'approval', callId: 'c-fail', reason: FINGERPRINT_ASK.text, answer: async () => 'rejected' }, widenError: 'compact-card-api 401' });
  assert.ok(JSON.stringify(failed).includes('Widen unavailable'), 'a FAILED fetch is the named degrade');
});

// ── #172: the directory flow — the browser affordance the stock surface lacks ──

test('#172: the picker registers both directoryFlow holes', () => {
  const holes = [];
  const ctx = {
    slots: {
      inject: (hole, setup) => { holes.push(hole); setup(); },
      register: (def) => { holes.push('registered:' + hole_name(def)); },
      entries: () => [],
    },
  };
  const hole_name = (def) => def.name;
  void hole_name;
  card.apply(ctx);
  const registered = holes.filter(h => String(h).startsWith('registered:'));
  assert.ok(registered.includes('registered:compact-workspace-path-flow'), 'the flow component is registered');
  assert.equal(holes.filter(h => h === 'sidebar.workspaces.directoryFlow').length, 1);
  assert.equal(holes.filter(h => h === 'conversation.hero.workspace.directoryFlow').length, 1);
});

test('#172: the flow renders the path form only when open, and hands the trimmed path to onPicked', () => {
  // a STATEFUL useState stub: the typed value flows through onChange into
  // the component's state, so submit drives the real logic — trim, the
  // absolute-path ready gate, the onPicked handoff (the no-op setter left
  // all of it untested — Copilot)
  const cells = [];
  const cursor = { i: 0 };
  const statefulReact = {
    createElement: fakeReact.createElement,
    useState: (init) => {
      const i = cursor.i++;
      cells[i] ??= init;
      return [cells[i], (v) => { cells[i] = v; }];
    },
    useEffect: () => {},
  };
  const statefulCard = captured.factory((name) => name === 'react' ? statefulReact : stubRequire(name));
  const picked = [];
  const cancelled = [];
  const render = () => {
    cursor.i = 0;                        // hook order is stable per render
    return statefulCard.WorkspacePathFlow({
      open: true,
      onPicked: (p) => picked.push(p),
      onCancel: () => cancelled.push(1),
    });
  };
  let flow = render();
  const nodes = () => [...walk(flow)];
  const inputOf = () => nodes().find(n => n.type === 'input');
  const buttonOf = (cls) => nodes().find(n => (n.props?.className ?? '').includes(cls));

  // a relative path: Open renders disabled and never submits
  inputOf().props.onChange({ target: { value: 'dsh_test' } });
  flow = render();
  assert.equal(inputOf().props.value, 'dsh_test', 'the typed value is the state');
  assert.equal(buttonOf('cwp-open').props.disabled, true, 'a relative path is not ready');
  buttonOf('cwp-open').props.onClick();
  assert.deepEqual(picked, [], 'a non-absolute path never submits');

  // an absolute path with whitespace: ready — and the TRIMMED path hands off
  inputOf().props.onChange({ target: { value: '  /tmp/dsh_test  ' } });
  flow = render();
  assert.equal(inputOf().props.value, '  /tmp/dsh_test  ', 'the input tracks the state');
  assert.equal(buttonOf('cwp-open').props.disabled, false);
  buttonOf('cwp-open').props.onClick();
  assert.deepEqual(picked, ['/tmp/dsh_test'], 'the trimmed absolute path reaches onPicked');

  // cancel reports, and a closed flow renders nothing
  assert.deepEqual(cancelled, []);
  assert.equal(statefulCard.WorkspacePathFlow({ open: false, onPicked: () => {}, onCancel: () => {} }), null);
});

test('#172: closed flow renders nothing — silence when the menu is shut', () => {
  const tree = card.WorkspacePathFlow({ open: false, onPicked: () => {}, onCancel: () => {} });
  assert.equal(tree, null);
});
