// The pure charter model: the fence as data, refusing to be vague.
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCharter, memberBindingsOf, DEFAULT_BUDGETS } from '../src/charter.js';
import { briefingText, roundFramingText, benchFramingText } from '../src/engine.js';

const BASE = () => ({
  name: 'newsroom',
  goal: 'Produce and publish the nightly digest from the sources in sources/.',
  members: [
    { id: 'packer', persona: 'prepares and verifies the digest from sources' },
    { id: 'shipper', persona: 'publishes what the community agrees on' },
    { id: 'bench-1', persona: 'a member seated on the bench', bench: true },
  ],
});

test('a valid charter normalizes: defaults filled, members kept in order', () => {
  const c = validateCharter(BASE());
  assert.equal(c.version, 1);
  assert.equal(c.topic, 'newsroom-floor');
  assert.deepEqual(c.budgets, DEFAULT_BUDGETS);
  assert.deepEqual(c.members.map((m) => m.prefix), ['community-packer', 'community-shipper', 'community-bench-1']);
  assert.equal(c.members[2].bench, true);
  assert.deepEqual(c.grants, []);
  assert.deepEqual(c.sources, []);
});

test('the fence refuses vagueness: goal, member shape, duplicates', () => {
  assert.throws(() => validateCharter({ ...BASE(), goal: 'do stuff' }), /charter\.goal/);
  assert.throws(() => validateCharter({ ...BASE(), members: [] }), /at least one member/);
  assert.throws(() => validateCharter({ ...BASE(), members: [{ id: 'a', persona: 'first of the same id' }, { id: 'a', persona: 'second of the same id' }] }), /"a" declared twice/);
  assert.throws(() => validateCharter({ ...BASE(), members: [{ id: 'a', persona: 'holds prefix p', prefix: 'p' }, { id: 'b', persona: 'holds prefix p too', prefix: 'p' }] }), /"p" declared twice/);
  assert.throws(() => validateCharter({ ...BASE(), members: [{ id: 'a', persona: 'tiny' }] }), /persona/);
  // a bench with nobody to judge is theater
  assert.throws(() => validateCharter({ ...BASE(), members: [{ id: 'bench-1', persona: 'judges', bench: true }] }), /at least one non-bench member/);
});

test('a member may be seated on a declared model route — "provider/model", one shape, or refused', () => {
  const c = validateCharter({
    ...BASE(),
    members: [
      { id: 'packer', persona: 'prepares and verifies the digest from sources', model: 'zai/glm-5.3-flash' },
      { id: 'shipper', persona: 'publishes what the community agrees on' },
      { id: 'bench-1', persona: 'a member seated on the bench', bench: true, model: 'deepseek/chat' },
    ],
  });
  assert.deepEqual(c.members[0].model, { provider: 'zai', model: 'glm-5.3-flash' });
  assert.equal(c.members[1].model, undefined, 'no route declared — the runtime default seats this member');
  assert.deepEqual(c.members[2].model, { provider: 'deepseek', model: 'chat' }, 'bench seats may carry a route too');
  assert.throws(() => validateCharter({ ...BASE(), members: [{ id: 'packer', persona: 'prepares the digest from sources', model: 'glm-5.3-flash' }] }), /members\[packer\]\.model[\s\S]*not a route/);
  assert.throws(() => validateCharter({ ...BASE(), members: [{ id: 'packer', persona: 'prepares the digest from sources', model: { provider: 'zai', model: 'glm-5.3-flash' } }] }), /members\[packer\]\.model[\s\S]*not a route/, 'one shape only — the object form refuses like any other');
  // the briefing tells a charter-seated member which route it thinks on
  assert.match(briefingText(c, c.members[0]), /YOUR MODEL: zai\/glm-5\.3-flash — charter-seated/);
  assert.doesNotMatch(briefingText(c, c.members[1]), /YOUR MODEL/);
});

test('grants carry their budgets — a pre-mint without one is a blank check', () => {
  const withGrants = {
    ...BASE(),
    grants: [
      { pattern: '{{RELEASES_ORIGIN}}/nightly', methodClass: 'write', ttlMinutes: 60, maxUses: 10 },
      { pattern: 'api.example.com', params: 'allow(q,page)' },
    ],
  };
  const c = validateCharter(withGrants);
  assert.equal(c.grants[1].methodClass, 'write');
  assert.equal(c.grants[1].maxUses, 40);
  assert.equal(c.grants[1].params, 'allow(q,page)');
  assert.throws(() => validateCharter({ ...BASE(), grants: [{ pattern: 'x', methodClass: 'both' }] }), /methodClass/);
  assert.throws(() => validateCharter({ ...BASE(), grants: [{ pattern: 'x', maxUses: 0 }] }), /blank check/);
  assert.throws(() => validateCharter({ ...BASE(), grants: [{ pattern: 'x', params: 'maybe' }] }), /params/);
});

test('sources stay inside the workspace — no parent escape, no absolute paths', () => {
  assert.throws(() => validateCharter({ ...BASE(), sources: [{ path: '../escape.txt', content: 'x' }] }), /unsafe/);
  assert.throws(() => validateCharter({ ...BASE(), sources: [{ path: '/etc/passwd', content: 'x' }] }), /unsafe/);
  const c = validateCharter({ ...BASE(), sources: [{ path: 'sources/notes.md', content: 'nightly notes' }] });
  assert.equal(c.sources[0].path, 'sources/notes.md');
});

test('memberBindingsOf joins the charter to the issued keys, and refuses a disagreement', () => {
  const c = validateCharter(BASE());
  const keyring = [
    { id: 'packer', keyPath: '/k/packer.pem' },
    { id: 'shipper', keyPath: '/k/shipper.pem' },
    { id: 'bench-1', keyPath: '/k/bench.pem' },
  ];
  const bindings = memberBindingsOf(c, keyring);
  assert.deepEqual(bindings, [
    { prefix: 'community-packer', memberId: 'packer', memberKeyPath: '/k/packer.pem' },
    { prefix: 'community-shipper', memberId: 'shipper', memberKeyPath: '/k/shipper.pem' },
    { prefix: 'community-bench-1', memberId: 'bench-1', memberKeyPath: '/k/bench.pem' },
  ]);
  assert.throws(() => memberBindingsOf(c, keyring.slice(0, 2)), /no key was issued for member "bench-1"/);
});

test('the briefing names the member, the goal verbatim, the forum topic, and the law that is real', () => {
  const c = validateCharter(BASE());
  const text = briefingText(c, c.members[0], {});
  assert.match(text, /You are "packer", a Member of a small autonomous community/);
  assert.match(text, /THE GOAL \(the community's own, verbatim\):/);
  assert.match(text, /Produce and publish the nightly digest/);
  assert.match(text, /forum_post \{"topic":"newsroom-floor"/);
  assert.match(text, /forum_pass \{"reason":"…"\} records/);
  assert.match(text, /it is not a post, enters no topic, and tells no member/);
  assert.match(text, /pass plainly with forum_pass \{"reason":"…"\}/);
  assert.match(text, /self_describe reports your standing/);
  assert.match(text, /judicature_hear files a case/);
  assert.match(text, /tamper-evident record attributed to you/);
  assert.match(text, /the only hosts that exist are the ones this briefing names/);
  assert.match(text, /HISTORY to report about — never a place to fetch/);
  assert.match(text, /write real bash — no pseudocode/);
  assert.match(text, /A broken\s+act wastes your turn/);
  const benchText = briefingText(c, c.members[2], {});
  assert.match(benchText, /You are "bench-1"/);
});

test('round framing lists what changed and says so when nothing did; the bench framing owes the reading', () => {
  const c = validateCharter(BASE());
  const quiet = roundFramingText(c, c.members[0], 3, [], []);
  assert.match(quiet, /Round 3 of 6, member "packer"/);
  assert.match(quiet, /Nothing new on the forum/);
  const busy = roundFramingText(c, c.members[0], 3,
    [{ id: 'fp_2', seq: 2, topic: 'newsroom-floor', by: 'community-shipper', at: 't', text: 'the digest is packed' }],
    ['case_1234 — the shipper shipped the raw table']);
  assert.match(busy, /fp_2 · newsroom-floor · community-shipper/);
  assert.match(busy, /case_1234/);
  const bench = benchFramingText(c, c.members[2], { id: 'case_ab12cd34', grievance: 'the manifest was rewritten' });
  assert.match(bench, /A CASE IS LIVE and awaits judgment: case_ab12cd34/);
  assert.match(bench, /judicature_case \{"case_id": "case_ab12cd34"\}/);
  assert.match(bench, /recuse yourself if you are a party/);
});

test('a resumed run is told its archive exists — the conversation continues, it does not start over (#227)', () => {
  const c = validateCharter(BASE());
  const fresh = briefingText(c, c.members[0], {});
  assert.doesNotMatch(fresh, /RESUMED RUN/);
  const resumed = briefingText(c, c.members[0], { resumed: true });
  assert.match(resumed, /RESUMED RUN: this community has run before/);
  assert.match(resumed, /forum_read \{"topic":"…","since":0\} reads one in full/);
  assert.match(resumed, /Your MEMBER identity persists \(the roll\)/);
});

test('divergence lines (#229): the auto-pause thresholds compile or refuse', () => {
  const c = validateCharter({ ...BASE(), divergence: { loopguardTrips: 6, humanSeatTimeouts: 3 } });
  assert.deepEqual(c.divergence, { loopguardTrips: 6, humanSeatTimeouts: 3 });
  assert.equal(validateCharter({ ...BASE(), divergence: { loopguardTrips: 2 } }).divergence.loopguardTrips, 2);
  assert.throws(() => validateCharter({ ...BASE(), divergence: {} }), /at least one of/);
  assert.throws(() => validateCharter({ ...BASE(), divergence: { quorum: 2 } }), /unknown key/);
  assert.throws(() => validateCharter({ ...BASE(), divergence: { loopguardTrips: 0 } }), /positive integer/);
});

test('divergence.headless (#235 follow-up): pause (default) or stop — nothing else', () => {
  assert.equal(validateCharter({ ...BASE(), divergence: { loopguardTrips: 2, headless: 'stop' } }).divergence.headless, 'stop');
  assert.equal(validateCharter({ ...BASE(), divergence: { loopguardTrips: 2 } }).divergence.headless, undefined, 'absent keeps the pause default');
  assert.throws(() => validateCharter({ ...BASE(), divergence: { loopguardTrips: 2, headless: 'park' } }), /"pause" \(default/);
});
