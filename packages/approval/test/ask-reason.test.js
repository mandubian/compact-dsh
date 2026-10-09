// #107 — the ask's reason leads with its CAUSE. "Uncovered" is the
// definition of an ask, not a cause: every ask ever composed opened with
// the same zero-bit line while the discriminating sentence sat in the tail,
// and a denial surfaced that line to the Subject as the stated reason.
// These are the golden vectors for the ask-reason builder: each cause class
// renders its distinct lead, the constant line appears at most once and
// demoted behind it, and the text a rejected ask leaves behind names the
// actual cause class. Pure-builder vectors (askReason/classifyAskCause
// driven directly) plus the gate-level integration that produces them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalPlugin, createApproval, classifyAskCause, askReason,
  fingerprint, canonicalTarget, GrantStore,
} from '../src/index.js';

const AGENT = { id: 'sess-1', session: { id: 'sess-1', header: {} } };

function boot(opts = {}) {
  const registered = {};
  const ctx = { on: (name, fn) => { registered[name] = fn; } };
  const instance = approvalPlugin(opts);
  instance(ctx, {});
  return {
    run: (exec) => registered['tools/pre-execute'](exec, async () => ({ kind: 'allow' })),
    approval: instance.approval ?? instance,
  };
}

const ask = async (booted, exec) => {
  const out = await booted.run(exec);
  assert.equal(out?.kind, 'ask', 'the scenario must produce an ask');
  // the lead assertions read the reason BODY — past the [AG/ruleId] chip the
  // envelope always carries (that prefix is not prose and never varies)
  return out.reason.slice(out.reason.indexOf('] ') + 2);
};

// the constant line: the mechanical restatement, demoted to exactly one
// occurrence behind the lead
const CONSTANT = 'is not covered by this runtime\'s grant layers';
function assertDemoted(reason, leadMark, label) {
  const hits = [...reason.matchAll(new RegExp(CONSTANT, 'g'))];
  assert.equal(hits.length, 1, `${label}: the constant line appears exactly once (demoted, never dropped into noise)`);
  assert.ok(reason.indexOf(leadMark) < hits[0].index, `${label}: the lead sentence precedes the demoted constant line`);
}

// every scenario's reason, stashed for the cross-class checks at the end
const leads = {};

// -- the store-side classes, through the live gate ----------------------------

test('first touch: nothing has ever covered the target', async () => {
  const reason = await ask(boot({}), { name: 'net.fetch', arguments: { host: 'first.example' }, agent: AGENT });
  leads['first-touch'] = reason;
  assert.match(reason, /^First touch: nothing has ever covered host=first\.example in this runtime — no grant row, no cached approval\./);
  assert.match(reason, /Approving materializes scoped, expiring coverage \(the terms follow\)\./);
  assertDemoted(reason, 'First touch:', 'first touch');
});

test('a lapsed grant leads with the expiry, naming the grant and the when', async () => {
  const booted = boot({});
  booted.approval.grantSession({ pattern: 'gone.example', session: 'sess-1', ttlMs: 1, now: Date.now() });
  await new Promise(r => setTimeout(r, 5));
  const reason = await ask(booted, { name: 'net.fetch', arguments: { host: 'gone.example' }, agent: AGENT });
  leads['expired'] = reason;
  assert.match(reason, /^Your earlier grant for host=gone\.example \(sg_[0-9a-f]+\) expired \d{4}-\d{2}-\d{2}T[\d:.]+Z\. Approving re-arms coverage\./);
  assertDemoted(reason, 'Your earlier grant', 'expired');
});

test('a revoked grant leads with the revocation', async () => {
  const booted = boot({});
  const g = booted.approval.grantSession({ pattern: 'undone.example', session: 'sess-1', ttlMs: 60 * 60 * 1000, now: Date.now() });
  booted.approval.revoke(g.id);
  const reason = await ask(booted, { name: 'net.fetch', arguments: { host: 'undone.example' }, agent: AGENT });
  leads['revoked'] = reason;
  assert.match(reason, /^The grant covering host=undone\.example \(sg_[0-9a-f]+\) was revoked\. Approving re-asks for consent\./);
  assertDemoted(reason, 'The grant covering', 'revoked');
});

test('a spent grant leads with the budget it exhausted', async () => {
  const booted = boot({});
  booted.approval.grantSession({ pattern: 'spent.example', session: 'sess-1', ttlMs: 60 * 60 * 1000, maxUses: 1, now: Date.now() });
  const first = await booted.run({ name: 'net.fetch', arguments: { host: 'spent.example' }, agent: AGENT });
  assert.deepEqual(first, { kind: 'allow' }, 'the budgeted grant answers its one use');
  const reason = await ask(booted, { name: 'net.fetch', arguments: { host: 'spent.example' }, agent: AGENT });
  leads['spent'] = reason;
  assert.match(reason, /^Your earlier grant for host=spent\.example \(sg_[0-9a-f]+\) spent its budget \(1\/1 uses\)\. Approving re-arms coverage\./);
  assertDemoted(reason, 'Your earlier grant', 'spent');
});

test('a live classless row under the mediated posture leads with the classless cause', async () => {
  const booted = boot({ egress: 'proxy' });
  booted.approval.grantSession({ pattern: 'classed.example', session: 'sess-1', ttlMs: 60 * 60 * 1000, now: Date.now() });
  const reason = await ask(booted, { name: 'net.fetch', arguments: { host: 'classed.example', methodClass: 'read' }, agent: AGENT });
  leads['classless-grant'] = reason;
  assert.match(reason, /^A live grant for host=classed\.example \(sg_[0-9a-f]+\) carries no method class, and the mediator refuses classless rows by name — this classed act asks\./);
  assert.match(reason, /Approving materializes a classed grant the wire can deliver \(D-7\)\./);
  assertDemoted(reason, 'A live grant', 'classless');
});

test('a cached approval on the same route, different fingerprint, leads with the rephrase cause', async () => {
  const booted = boot({});
  const approved = { url: 'https://rephrase.example/a' };
  booted.approval.store.cacheSet(fingerprint('net.fetch', approved), Date.now(), 60 * 60 * 1000, canonicalTarget(approved));
  const reason = await ask(booted, { name: 'net.fetch', arguments: { url: 'https://rephrase.example/b' }, agent: AGENT });
  leads['rephrase'] = reason;
  assert.match(reason, /^url=https:\/\/rephrase\.example\/b\/ was approved before, but only as the exact phrasing approved — this differently-shaped act on the same target asks anew \(#26\)\./);
  assertDemoted(reason, 'was approved before', 'rephrase');
});

test('a same-target re-ask with a changed query says what changed — the VALUES differ (#8 G5)', async () => {
  // the operator's case: two geocoding calls, same route, same parameter
  // names, different values — the display that showed two identical-looking
  // `url=…` rows now says exactly why both asked
  const booted = boot({});
  const approved = { url: 'https://geo.example/v1/search?name=Paris&count=1' };
  booted.approval.store.cacheSet(fingerprint('bash', approved), Date.now(), 60 * 60 * 1000,
    canonicalTarget(approved), ['count', 'name']);
  const reason = await ask(booted, { name: 'bash', arguments: { url: 'https://geo.example/v1/search?name=Paris&count=5' }, agent: AGENT });
  assert.match(reason, /url=https:\/\/geo\.example\/v1\/search\/ query\(count, name\) was approved before/);
  assert.match(reason, /The query carries the same parameters \('count', 'name'\) — the VALUES differ\./);
  assert.match(reason, /approving one never covers another \(#8 G5\)/);
  assert.ok(!reason.includes('Paris') || !/query.*Paris/.test(reason.match(/query\([^)]*\)/)[0]),
    'the shape bit carries names only — no values ride the display');
});

test('a same-target re-ask with different parameter NAMES names them', async () => {
  const booted = boot({});
  const approved = { url: 'https://geo.example/v1/search?name=Paris' };
  booted.approval.store.cacheSet(fingerprint('bash', approved), Date.now(), 60 * 60 * 1000,
    canonicalTarget(approved), ['name']);
  const reason = await ask(booted, { name: 'bash', arguments: { url: 'https://geo.example/v1/search?name=Lyon&count=5&language=en' }, agent: AGENT });
  assert.match(reason, /url=https:\/\/geo\.example\/v1\/search\/ query\(count, language, name\) was approved before/);
  assert.match(reason, /The query parameters differ from the approved phrasing: this act adds 'count', 'language'\./);
  assert.doesNotMatch(reason, /VALUES differ/);
});

test('a re-ask that drops the query the approval carried says so', async () => {
  const booted = boot({});
  const approved = { url: 'https://geo.example/v1/search?name=Paris' };
  booted.approval.store.cacheSet(fingerprint('bash', approved), Date.now(), 60 * 60 * 1000,
    canonicalTarget(approved), ['name']);
  const reason = await ask(booted, { name: 'bash', arguments: { url: 'https://geo.example/v1/search' }, agent: AGENT });
  assert.match(reason, /The approval it rephrases carried a query \('name'\); this act drops it\./);
});

// -- the call-shaped causes the store cannot see ------------------------------

test('an underivable method class under the mediated posture leads with D-7 (the issue wording)', async () => {
  const booted = boot({ egress: 'proxy' });
  const reason = await ask(booted, { name: 'bash', arguments: { url: 'https://opaque.example/x', host: 'opaque.example', methodClass: null }, agent: AGENT });
  leads['underivable-class'] = reason;
  assert.match(reason, /^"bash" needs the network but its method class is not statically derivable — approval covers exactly this command and materializes NO egress grant \(D-7\): the mediator refuses its connections by name\./);
  assertDemoted(reason, 'needs the network', 'underivable class');
});

test('declared secret references promote the injection disclosure to the lead', async () => {
  const booted = boot({ secretRefs: ['DEMO_TOKEN'] });
  const reason = await ask(booted, {
    name: 'bash',
    arguments: { host: 'secret.example', command: 'curl https://secret.example/health?token=$DEMO_TOKEN' },
    agent: AGENT,
  });
  leads['secret'] = reason;
  assert.match(reason, /^"bash" references declared secret \$DEMO_TOKEN; approving it materializes the injection grant — session-scoped, TTL-bounded, revocable \(grants-revoke\)/);
  assert.match(reason, /the command may print it: the record keeps what it prints\./);
  assert.match(reason, /Target: host=secret\.example\./);
  assertDemoted(reason, 'references declared secret', 'secret');
});

// -- the cross-class contract the issue pins ----------------------------------

test('each reason class renders a DISTINCT lead — no two asks open alike', () => {
  const markers = {
    'first-touch': /First touch: nothing has ever covered/,
    'expired': /\) expired \d{4}-\d{2}-\d{2}T/,
    'revoked': /was revoked\. Approving re-asks for consent/,
    'spent': /spent its budget \(1\/1 uses\)/,
    'classless-grant': /carries no method class/,
    'rephrase': /asks anew \(#26\)\./,
    'underivable-class': /method class is not statically derivable/,
    'secret': /references declared secret \$DEMO_TOKEN/,
  };
  for (const [cls, reason] of Object.entries(leads)) {
    assert.ok(reason, `${cls}: the scenario ran and stashed its reason`);
    assert.match(reason, markers[cls], `${cls}: its own marker leads`);
    for (const [other, marker] of Object.entries(markers)) {
      if (other === cls) continue;
      assert.doesNotMatch(reason, marker, `${cls}: does not open with the ${other} lead`);
    }
  }
});

test('the text a rejected ask leaves with the Subject names the ACTUAL cause class', () => {
  // a deny surfaces the ask's envelope text as the stated reason — the four
  // headline-identical asks of the recorded session read four different
  // causes now, and the constant line is never the first sentence. The
  // stashed reasons are already the post-chip bodies.
  for (const [cls, body] of Object.entries(leads)) {
    assert.doesNotMatch(body, /^"[^"]+" is not covered by this runtime's grant layers/,
      `${cls}: no constant banner opens the deny text the Subject reads`);
    assert.ok(body.indexOf(CONSTANT) > 60, `${cls}: the constant line is demoted past the lead`);
  }
  // spot-reads: the discriminating facts of the recorded session lead now
  assert.match(leads['underivable-class'], /approval covers exactly this command/);
  assert.match(leads['first-touch'], /no grant row, no cached approval/);
});

// -- pure-builder golden vectors (the composer, driven directly) ---------------

test('askReason golden vector: the expired cause renders the exact lead + demoted restatement', () => {
  const approval = createApproval({});
  const reason = askReason({
    tool: 'net.fetch',
    args: { host: 'golden.example' },
    cause: { kind: 'expired', grant: { id: 'sg_deadbeef', expiresAt: 1_700_000_000_000, createdAt: 1_699_999_000_000 } },
    approval,
  });
  assert.equal(
    reason.slice(0, reason.indexOf(`"net.fetch" is not covered`)),
    'Your earlier grant for host=golden.example (sg_deadbeef) expired 2023-11-14T22:13:20.000Z. Approving re-arms coverage. ',
    'the lead is byte-exact and the constant line follows it');
  assert.match(reason, /Approving materializes an exec-cache entry: /, 'the disclosures stay, after the lead');
});

// -- #173: the disclosures ride labeled lines — the wall becomes rows ---------
// The lead + demoted restatement stay the first line; every disclosure after
// them opens with its label. The sentences are verbatim (every lint above
// still matches within its line); what changed is the LAYOUT: one
// consequence, one line, key word first — the structure the moves block has
// always had. The label set is closed; the renderers bold exactly it.

const LABELS = ['Replay', 'Widen', 'Connectivity', 'Delivery', 'Tunnel', 'Scope'];

// the pure-builder vectors drive askReason directly: its return IS the body —
// no envelope header, no moves block (the gate's buildEnvelope appends those)
function labelsOf(reason) {
  return reason.split('\n').slice(1)
    .map(line => line.match(/^([A-Z][A-Za-z]+): /)?.[1] ?? null);
}

test('#173 structure: the plain ask renders lead line + Replay + Widen + Connectivity, one disclosure per line', () => {
  const reason = askReason({
    tool: 'net.fetch', args: { host: 'rows.example' },
    cause: { kind: 'first-touch' }, approval: createApproval({}),
  });
  const lines = reason.split('\n');
  assert.equal(lines.length, 4, `lead + three labeled lines, got:\n${reason}`);
  assert.match(lines[0], /First touch: .* is not covered by this runtime's grant layers\.$/, 'the lead and the demoted restatement share the first line');
  assert.equal(lines[1], `Replay: Approving materializes an exec-cache entry: the identical operation replays without re-asking for 24h, across sessions of this runtime, until it lapses or is revoked — anything else asks again.`,
    'the replay sentence is verbatim behind its label');
  // #175: the pattern offer rides directly beside the Replay row it qualifies
  assert.match(lines[2], /^Widen: a pattern answer materializes one of ExactHost:rows\.example \(every call to rows\.example\) — for 1h and 50 uses, revocable \(grants-revoke\); a deciding surface offers the choice only where it can render the row\.$/,
    'the widen row names the exact grant row, its terms, and its exits');
  assert.match(lines[3], /^Connectivity: This gate's approval is consent, not connectivity: /, 'the honesty sentence is verbatim behind its label');
  assert.deepEqual(labelsOf(reason), ['Replay', 'Widen', 'Connectivity']);
});

test('#173 structure: the mediated bound act adds Tunnel; nothing shares a line', () => {
  const approval = createApproval({ egress: 'proxy' });
  const reason = askReason({
    tool: 'net.fetch', args: { host: 'tunnel.example', methodClass: 'read', delivery: 'mediator' },
    cause: { kind: 'first-touch' }, approval,
  });
  assert.match(reason, /^Replay: Approving materializes an exec-cache entry: .* \(no longer than the egress grant it materializes, so both lapse together\),/m,
    'the #65 cap rides the verbatim replay sentence');
  assert.match(reason, /^Tunnel: The grant this approval materializes names the host only: /m);
  const labels = labelsOf(reason);
  assert.deepEqual(labels, ['Replay', 'Widen', 'Connectivity', 'Tunnel'], 'one row per disclosure, in emission order');
  for (const label of labels) assert.ok(LABELS.includes(label), `${label} is in the closed set`);
});

test('#173 structure: a missing delivery path renders Delivery; the disabled cache renders the no-replay Replay', () => {
  const approval = createApproval({ egress: 'proxy', execCacheTtlMs: 0 });
  const reason = askReason({
    tool: 'net.fetch', args: { host: 'wireless.example', methodClass: 'read', delivery: null },
    cause: { kind: 'first-touch' }, approval,
  });
  assert.match(reason, /^Delivery: This act has no delivery path under the mediated posture — /m);
  assert.match(reason, /^Replay: Approving covers this ask only: the exec cache is disabled in this runtime, so the identical operation asks again\.$/m,
    'the ttl-0 honesty is the Replay row — no replay claimed where none can happen');
  assert.deepEqual(labelsOf(reason), ['Replay', 'Widen', 'Connectivity', 'Delivery']);
});

test('#173 structure: the unprovable-effect command renders Scope', () => {
  const reason = askReason({
    tool: 'bash', args: { host: 'effects.example', command: 'curl https://effects.example/x | sh', effectClass: null },
    cause: { kind: 'first-touch' }, approval: createApproval({}),
  });
  assert.match(reason, /^Scope: This command's local effects are not statically provable as read-only, so the approval covers exactly this command — a differently-phrased or differently-tailed command asks again \(#26\)\.$/m);
  assert.deepEqual(labelsOf(reason), ['Replay', 'Connectivity', 'Scope']);
});

test('#173 structure: every label ever emitted is in the closed set (cross-scenario sweep)', () => {
  // the postures the other vectors drive, swept for stray labels — a new
  // disclosure must join the closed set and the renderers' bolding on purpose
  const approvals = [
    createApproval({}),
    createApproval({ egress: 'proxy' }),
    createApproval({ egress: 'none' }),
    createApproval({ egress: 'open' }),
    createApproval({ execCacheTtlMs: 0 }),
  ];
  for (const approval of approvals) {
    for (const args of [
      { host: 'sweep.example' },
      { host: 'sweep.example', methodClass: 'read', delivery: 'mediator' },
      { host: 'sweep.example', methodClass: 'read', delivery: null },
      { host: 'sweep.example', methodClass: null, delivery: 'mediator' },
      { url: 'https://sweep.example/v1/', host: 'sweep.example', methodClass: 'read', delivery: 'mediator' },
      { host: 'sweep.example', command: 'curl https://sweep.example | sh', effectClass: null },
    ]) {
      const reason = askReason({ tool: 'net.fetch', args, cause: { kind: 'first-touch' }, approval });
      for (const label of labelsOf(reason)) {
        assert.ok(LABELS.includes(label), `label "${label}" is in the closed set (args: ${JSON.stringify(args)})`);
      }
    }
  }
});

test('classifyAskCause: scope honesty — a sibling session\'s grant is not this session\'s history', () => {
  const store = new GrantStore();
  const now = 1_700_000_000_000;
  const revoked = store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'sibling.example' }, session: 'sess-OTHER', ttlMs: 60_000, now });
  store.revokeSessionGrant(revoked.id, now + 1);
  assert.equal(classifyAskCause(store, { target: { host: 'sibling.example' }, session: 'sess-1', now, egress: undefined }).kind, 'first-touch',
    'a revoked grant that never covered THIS session is not this ask\'s cause');
  const mine = store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'mine.example' }, session: 'sess-1', ttlMs: 60_000, now });
  store.revokeSessionGrant(mine.id, now + 1);
  assert.equal(classifyAskCause(store, { target: { host: 'mine.example' }, session: 'sess-1', now, egress: undefined }).kind, 'revoked',
    'the same shape in scope IS the cause');
});

test('classifyAskCause: priority — revocation outranks expiry outranks the budget', () => {
  const store = new GrantStore();
  const now = 1_700_000_000_000;
  const a = store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'x.example' }, session: 's', ttlMs: 60_000, now });
  a.revokedAt = now + 1;                       // also expired by `now`
  a.expiresAt = now - 1;
  assert.equal(classifyAskCause(store, { target: { host: 'x.example' }, session: 's', now, egress: undefined }).kind, 'revoked');
  const b = store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'y.example' }, session: 's', ttlMs: 60_000, now });
  b.expiresAt = now - 1;                       // lapsed, never revoked, budget left
  assert.equal(classifyAskCause(store, { target: { host: 'y.example' }, session: 's', now, egress: undefined }).kind, 'expired');
  const c = store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'z.example' }, session: 's', ttlMs: 60_000, maxUses: 1, now });
  c.uses = 1;                                  // live by TTL, dead by budget
  assert.equal(classifyAskCause(store, { target: { host: 'z.example' }, session: 's', now, egress: undefined }).kind, 'spent');
});

test('classifyAskCause: the classless class needs the mediated posture AND a classed act', () => {
  const store = new GrantStore();
  const now = 1_700_000_000_000;
  store.addSessionGrant({ pattern: { kind: 'ExactHost', value: 'bare.example' }, session: 's', ttlMs: 60_000, now });
  const t = { host: 'bare.example', methodClass: 'read' };
  assert.equal(classifyAskCause(store, { target: t, session: 's', now, egress: undefined }).kind, 'first-touch',
    'without the mediator, a classless row is ordinary coverage history, not a cause');
  assert.equal(classifyAskCause(store, { target: t, session: 's', now, egress: 'proxy', hasMethodClass: true }).kind, 'classless-grant');
  assert.equal(classifyAskCause(store, { target: { host: 'bare.example' }, session: 's', now, egress: 'proxy', hasMethodClass: false }).kind, 'first-touch',
    'an unclassed target is covered by classless rows — no cause to name');
});

test('classifyAskCause: the rephrase class is route-keyed — same host:port, different fingerprint', () => {
  const store = new GrantStore();
  const now = 1_700_000_000_000;
  store.cacheSet('fp_aaaaaaaaaaaaaaaa', now, 60_000, canonicalTarget({ url: 'https://same.example/first' }));
  assert.equal(classifyAskCause(store, { target: { url: 'https://same.example/second' }, session: 's', now, egress: undefined }).kind, 'rephrase',
    'the operator already paid for this route under another phrasing');
  assert.equal(classifyAskCause(store, { target: { url: 'https://same.example/second' }, session: 's', now, egress: undefined }).lapsed, false,
    'a live entry is coverage the phrasing excluded');
  assert.equal(classifyAskCause(store, { target: { host: 'other.example' }, session: 's', now, egress: undefined }).kind, 'first-touch');
});

test('classifyAskCause: a lapsed same-route entry is rephrase-with-lapse, never a silent first touch (Copilot review #109)', () => {
  const store = new GrantStore();
  const now = 1_700_000_000_000;
  // #40's lazy deletion: an entry whose TTL passed but whose fingerprint was
  // never probed again still sits in the map — it is history, not coverage
  store.cacheSet('fp_bbbbbbbbbbbbbbbb', now - 120_000, 60_000, canonicalTarget({ url: 'https://stale.example/old' }));
  const cause = classifyAskCause(store, { target: { url: 'https://stale.example/new' }, session: 's', now, egress: undefined });
  assert.deepEqual({ kind: cause.kind, lapsed: cause.lapsed }, { kind: 'rephrase', lapsed: true },
    'the lead must say the earlier approval lapsed, not imply reusable coverage — and never claim nothing ever covered');
  // and the builder renders the lapse
  const reason = askReason({
    tool: 'net.fetch', args: { url: 'https://stale.example/new' }, cause, approval: createApproval({}),
  });
  assert.match(reason, /was approved before, but only as the exact phrasing approved — and that approval has lapsed — /);
});

test('a secret act that is ALSO the underivable class carries BOTH disclosures (Copilot review #109)', async () => {
  const booted = boot({ egress: 'proxy', secretRefs: ['GH_TOKEN'] });
  const body = await ask(booted, {
    name: 'bash',
    arguments: { url: 'https://github.com/api', host: 'github.com', methodClass: null, delivery: 'mediator',
      command: 'curl -H "Authorization: Bearer $GH_TOKEN" https://github.com/api' },
  });
  assert.match(body, /^"bash" references declared secret \$GH_TOKEN/, 'the injection disclosure still leads');
  assert.match(body, /method class is not statically derivable — approval covers exactly this command and materializes NO egress grant \(D-7\)/,
    'the D-7 disclosure rides right behind it — what approving writes AND what it cannot deliver, neither dropped');
  assertDemoted(body, 'references declared secret', 'secret + underivable');
});
