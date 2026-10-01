// The pure core of slice 1 (J-8 → J-4): the declaration schema, the
// standing graph, recusal as reachability, the unheard state, and the
// trajectory derived from the clock. No host, no I/O — the checks are the
// design's own claim about itself.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SetError, validateAdjudicatorSets, undeclared, recusePerSet, resolvePanel,
  independenceBetweenSets, trajectoryState, STANDING_KINDS, EDGE_VOCABULARY,
} from '../src/sets.js';

const FUTURE = '2030-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

const section = (over = {}) => ({
  nodes: [{ kind: 'plugin', id: 'compact-dsh' }],
  sets: [{
    id: 'first',
    roles: [
      { id: 'a', standing: { kind: 'principal', id: 'alice' } },
      { id: 'b', standing: { kind: 'principal', id: 'bob' } },
    ],
    trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis', 'annex'] },
  }],
  edges: [
    { type: 'directed-by', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'principal', id: 'alice' } },
    { type: 'asserts-with', from: { kind: 'plugin', id: 'compact-dsh' }, to: { kind: 'key', id: 'enforcer-key' } },
  ],
  ...over,
});

test('a well-formed declaration validates and carries its parts', () => {
  const v = validateAdjudicatorSets(section(), { enforcerKey: 'enforcer-key' });
  assert.equal(v.sets.length, 1);
  assert.equal(v.sets[0].roles.length, 2);
  assert.equal(v.edges.length, 2);
  // the annex's own enforcer key is a node even if no role sits on it
  assert.ok(v.graph.adjacency.has('key:enforcer-key'));
});

test('fail-closed: the malformed shapes each refuse (D-7)', () => {
  // enforcerKey is passed so the fixture's own edges never dangle — each
  // case must refuse for ITS OWN reason, not one masked by another (the
  // empty-set-id case once passed only because the edge check fired first)
  const refuses = (s, detail) => assert.throws(
    () => validateAdjudicatorSets(s, { enforcerKey: 'enforcer-key' }), SetError, detail);
  refuses(undefined, 'no section');
  refuses({}, 'not the section shape');
  refuses({ sets: [], edges: [] }, 'empty declaration is no declaration');
  refuses({ ...section(), sets: [{ ...section().sets[0], id: 7 }] }, 'non-string set id');
  refuses({ ...section(), sets: [{ ...section().sets[0], roles: [] }] }, 'no roles');
  refuses({ ...section(), sets: [{ ...section().sets[0], roles: [{ id: 'x', standing: { kind: 'witness', id: 'w' } }] }] },
    'witness standing is pending I-1 — declaring it now would be the fraud');
  refuses({ ...section(), sets: [{ ...section().sets[0], trajectory: {} }] }, 'trajectory required');
  refuses({ ...section(), sets: [{ ...section().sets[0], trajectory: { firstExternalMemberBy: 'not-a-date', founderExclusions: ['genesis'] } }] },
    'trajectory must be a date');
  refuses({ ...section(), sets: [{ ...section().sets[0], trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['whim'] } }] },
    'exclusions are rule scopes, never remembered');
  refuses({ ...section(), sets: [...section().sets, { ...section().sets[0], roles: [{ id: 'a', standing: { kind: 'key', id: 'k' } }], trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis'] } }] },
    'duplicate set id');
  refuses({ ...section(), edges: [{ type: 'telepathy', from: { kind: 'principal', id: 'alice' }, to: { kind: 'principal', id: 'bob' } }] },
    'closed edge vocabulary — an edge the record cannot cross-examine is a promise');
  refuses({ ...section(), edges: [{ type: 'directed-by', from: { kind: 'principal', id: 'ghost' }, to: { kind: 'principal', id: 'alice' } }] },
    'dangling edge — an edge to nowhere is the lie the affidavit discipline catches');
  refuses({ ...section(), edges: [{ type: 'directed-by', from: { kind: 'principal', id: 'alice' }, to: { kind: 'principal', id: 'alice' } }] },
    'self-loop');
});

test('an empty set id refuses for its own reason, unmasked (review #118)', () => {
  // once passed only because the fixture's edge dangled first — Copilot
  const s = structuredClone(section());
  s.sets[0].id = '';
  assert.throws(() => validateAdjudicatorSets(s, { enforcerKey: 'enforcer-key' }),
    /set without a non-empty string id/);
});

test('recusal is reachability, and the overlap is named (J-4)', () => {
  const v = validateAdjudicatorSets(section(), { enforcerKey: 'enforcer-key' });
  // seat 'a' IS the party
  let r = recusePerSet(v, [{ kind: 'principal', id: 'alice' }]);
  assert.deepEqual(r[0].refusals.map((x) => x.roleId), ['a']);
  assert.deepEqual(r[0].refusals[0].overlap, ['principal:alice']);
  assert.deepEqual(r[0].seats, ['b']);
  // seat 'a' connects to the enforcer key THROUGH the declared plugin node:
  // conflicts run both ways (J-4: they, their Principal, a party dependent on them)
  r = recusePerSet(v, [{ kind: 'key', id: 'enforcer-key' }]);
  assert.deepEqual(r[0].refusals.map((x) => x.roleId), ['a']);
  assert.deepEqual(r[0].refusals[0].overlap,
    ['principal:alice', 'plugin:compact-dsh', 'key:enforcer-key']);
  // an unconnected party recuses nobody
  r = recusePerSet(v, [{ kind: 'principal', id: 'nobody' }]);
  assert.deepEqual(r[0].seats, ['a', 'b']);
});

test('a case whose every set recuses is UNHEARD, never dismissed (J-1)', () => {
  const v = validateAdjudicatorSets(section(), { enforcerKey: 'enforcer-key' });
  const out = resolvePanel(v, [{ kind: 'principal', id: 'alice' }, { kind: 'principal', id: 'bob' }]);
  assert.equal(out.status, 'unheard');
  assert.equal(out.attempts.length, 1);
  // one independent seat resolves the panel, with refusals carried alongside
  const panel = resolvePanel(v, [{ kind: 'principal', id: 'alice' }]);
  assert.equal(panel.status, 'panel');
  assert.equal(panel.setId, 'first');
  assert.deepEqual(panel.seats, ['b']);
  assert.deepEqual(panel.refusals.map((x) => x.roleId), ['a']);
});

test('the cascade tries sets in declaration order (J-1)', () => {
  const two = validateAdjudicatorSets({
    sets: [
      { id: 'founders', roles: [{ id: 'f', standing: { kind: 'principal', id: 'founder' } }], trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis'] } },
      { id: 'seconds', roles: [{ id: 's', standing: { kind: 'principal', id: 'stranger' } }], trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis'] } },
    ],
    edges: [],
  });
  const out = resolvePanel(two, [{ kind: 'principal', id: 'founder' }]);
  assert.equal(out.status, 'panel');
  assert.equal(out.setId, 'seconds');
});

test('independence between sets: not subordinate as a graph property (J-5)', () => {
  const two = validateAdjudicatorSets({
    sets: [
      { id: 'A', roles: [{ id: 'a', standing: { kind: 'principal', id: 'alice' } }], trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis'] } },
      { id: 'B', roles: [{ id: 'b', standing: { kind: 'principal', id: 'bob' } }], trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis'] } },
    ],
    edges: [],
  });
  assert.equal(independenceBetweenSets(two, 'A', 'B').independent, true);
  const joined = validateAdjudicatorSets({
    sets: two.sets,
    edges: [{ type: 'directed-by', from: { kind: 'principal', id: 'alice' }, to: { kind: 'principal', id: 'bob' } }],
  });
  const out = independenceBetweenSets(joined, 'A', 'B');
  assert.equal(out.independent, false);
  assert.deepEqual(out.overlap[0].path, ['principal:alice', 'principal:bob']);
  // siblings under one Principal are formally non-subordinate: the declared
  // limit of a single composition's internal independence, tested where it
  // lives rather than hidden
  const siblings = validateAdjudicatorSets({
    nodes: [{ kind: 'principal', id: 'op' }],
    sets: [
      { id: 'A', roles: [{ id: 'a', standing: { kind: 'process', id: 'panel-1' } }], trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis'] } },
      { id: 'B', roles: [{ id: 'b', standing: { kind: 'process', id: 'panel-2' } }], trajectory: { firstExternalMemberBy: FUTURE, founderExclusions: ['genesis'] } },
    ],
    edges: [
      { type: 'directed-by', from: { kind: 'process', id: 'panel-1' }, to: { kind: 'principal', id: 'op' } },
      { type: 'directed-by', from: { kind: 'process', id: 'panel-2' }, to: { kind: 'principal', id: 'op' } },
    ],
  });
  assert.equal(independenceBetweenSets(siblings, 'A', 'B').independent, true,
    'disjointness runs over declared edges, not common ancestry');
});

test('trajectory state is derived from the clock, never stored (J-8)', () => {
  const set = section().sets[0];
  assert.equal(trajectoryState(set, new Date(FUTURE).getTime() - 1).expired, false);
  const after = trajectoryState(set, new Date(FUTURE).getTime() + 1);
  assert.equal(after.expired, true, 'an expired schedule is detectable from records');
  // the past-dated founding honesty shows expired immediately
  const past = { ...set, trajectory: { firstExternalMemberBy: PAST, founderExclusions: ['genesis'] } };
  assert.equal(trajectoryState(past, Date.now()).expired, true);
});

test('the undeclared state is empty and never malformed', () => {
  const u = undeclared('some-key');
  assert.deepEqual(u.sets, []);
  assert.deepEqual(u.edges, []);
  assert.ok(u.graph.adjacency.has('key:some-key'));
  assert.deepEqual(recusePerSet(u, [{ kind: 'principal', id: 'x' }]), []);
});

test('snapshots detach: mutating a returned set does not reach the register', () => {
  const v = validateAdjudicatorSets(section(), { enforcerKey: 'enforcer-key' });
  const snap = structuredClone(v.sets);
  snap[0].roles.length = 0;
  snap[0].trajectory.firstExternalMemberBy = PAST;
  assert.equal(v.sets[0].roles.length, 2);
  assert.equal(v.sets[0].trajectory.firstExternalMemberBy, FUTURE);
});

test('the vocabulary is closed and self-documenting', () => {
  assert.deepEqual(STANDING_KINDS, ['principal', 'process', 'plugin', 'key', 'witness']);
  // witness standing names a roll digest and refuses without a live
  // accreditation — the seating the accreditation statute grants (#126)
  const W = 'b'.repeat(64);
  const witnessSection = (witnesses) => ({
    sets: [{ id: 'external', roles: [{ id: 'w1', standing: { kind: 'witness', id: W } }],
      trajectory: { firstExternalMemberBy: '2030-01-01T00:00:00.000Z', founderExclusions: ['genesis'] } }],
    edges: [],
  });
  assert.throws(() => validateAdjudicatorSets(witnessSection(), {}),
    (e) => /no member roll is composed/.test(e.message), 'a witness seat without a roll is the fraud D-8 names');
  assert.throws(() => validateAdjudicatorSets(witnessSection(new Set(['c'.repeat(64)])), { witnesses: new Set(['c'.repeat(64)]) }),
    (e) => /no LIVE accreditation/.test(e.message), 'a digest the roll does not accredit refuses the boot');
  validateAdjudicatorSets(witnessSection(), { witnesses: new Set([W]) });
  for (const [type, def] of Object.entries(EDGE_VOCABULARY)) {
    assert.ok(def.plain.length > 10, `${type}: plain meaning`);
    assert.ok(def.crossExaminedBy.length > 10, `${type}: the record surface that cross-examines it`);
  }
});
