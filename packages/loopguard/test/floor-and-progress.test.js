// The floor and the meaning of progress — the live findings of the
// community runs (weight-of-voice, weight-of-voice-v2, workshop, bug-court):
//
//   1. a latch denied the lawful next moves its own envelope names —
//      ask_human (R-9 escalate) and request_termination (R-12 exit);
//   2. a cleared latch kept its evidence, so the first call after the
//      Principal's message re-tripped on the same stale window;
//   3. LG-3 refused a first-seen operation as "polling without progress";
//   4. the loop fingerprint ignored arguments, so six different posts were
//      "the identical operation";
//   5. the guard counted its own denials as tool failures.
//
// Replaying the four runs' real session logs through the unmodified guard
// reproduced all 29 recorded LoopGuard denials, call for call; through the
// fixed guard none of them stands. These tests pin each fix on its own, and
// pin that real loops still trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Guard } from '../src/trips.js';
import { FLOOR_TOOLS, loopFingerprint, isOwnDenial } from '../src/index.js';

/** Drive a guard the way the plugin does: floor tools by their own path,
 *  `|` as the Principal's message (turn/start). Returns each step's trip. */
function drive(g, steps, { floor = FLOOR_TOOLS } = {}) {
  const out = [];
  for (const step of steps) {
    if (step === '|') { g.clearOnUserSignal(); continue; }
    const [tool, id] = step.split(':');
    const fp = `${tool}:${id}`;
    const trip = floor.includes(tool) ? g.observeFloorCall({ fp }) : g.observeCall({ fp, tool });
    out.push({ step, trip: trip ? trip.id : null });
  }
  return out;
}

test('the floor is never latched: escalation and exit pass a latch and a halt', () => {
  const g = new Guard();
  for (let i = 0; i < 5; i++) g.observeCall({ fp: 'same', tool: 'roster.list' });
  assert.equal(g.latch?.id, 'LG-5', 'work is latched');
  assert.equal(g.observeCall({ fp: 'other', tool: 'bash' })?.id, 'LG-5', 'work stays denied');
  assert.equal(g.observeFloorCall({ fp: 'ask_human:q1' }), null, 'escalation passes the latch');
  assert.equal(g.observeFloorCall({ fp: 'request_termination:x' }), null, 'exit passes the latch');
  // a halt (deterministic trip) denies all work — never the floor
  const h = new Guard();
  h.observeResult({ fp: 'w', tool: 'workflow', outcome: 'failure', errorClass: 'terminal', terminal: true });
  assert.equal(h.denyAll?.id, 'LG-7');
  assert.equal(h.observeFloorCall({ fp: 'petition:p1' }), null, 'a petition passes the halt');
});

test('an identical floor call repeated is refused per call — no latch, no repair spent', () => {
  const g = new Guard();
  for (let i = 0; i < 4; i++) assert.equal(g.observeFloorCall({ fp: 'ask_human:same' }), null);
  const fifth = g.observeFloorCall({ fp: 'ask_human:same' });
  assert.equal(fifth?.id, 'LG-5');
  assert.equal(fifth.floor, true);
  assert.equal(g.latch, null, 'the floor\'s own refusal raises no latch');
  assert.equal(g.repairs.size, 0, 'and spends no repair');
  assert.equal(g.observeCall({ fp: 'work', tool: 'bash' }), null, 'work is untouched');
  assert.equal(g.observeFloorCall({ fp: 'ask_human:a-new-question' }), null, 'a different escalation passes');
});

// LG-1 (no new operation in 10 calls) is raised out of the way where a test
// isolates LG-3, the way the trip suite isolates each condition
const lg3Only = () => new Guard({ limits: { NO_MEANINGFUL_PROGRESS: 100 } });

test('a cleared latch takes its evidence: the next call is judged on what follows the Principal', () => {
  const g = lg3Only();
  // a rotation of 5 operations trips LG-3
  const trips = drive(g, Array.from({ length: 16 }, (_, i) => `read:${i % 5}`));
  assert.equal(trips.at(-1).trip, 'LG-3');
  g.clearOnUserSignal();
  // before the fix: this first call after the Principal's message re-tripped
  // LG-3 on the same 16-call window
  assert.equal(g.observeCall({ fp: 'read:0', tool: 'read' }), null, 'judged fresh after the clear');
  // the repair budget still counts every trip: three more rotations exhaust it
  for (let round = 0; round < 3; round++) {
    drive(g, Array.from({ length: 16 }, (_, i) => `read:${i % 5}`));
    g.clearOnUserSignal();
  }
  drive(g, Array.from({ length: 16 }, (_, i) => `read:${i % 5}`));
  assert.equal(g.denyAll?.id, 'LG-3', 'the fourth repair exhausts the budget — real loops still end the session');
});

test('LG-3 never refuses a first-seen operation; a real rotation still trips', () => {
  const g = lg3Only();
  for (let i = 0; i < 15; i++) assert.equal(g.observeCall({ fp: `poll${i % 5}`, tool: 'poll' }), null);
  // the 16th call is NEW: it breaks the rotation, it is progress
  assert.equal(g.observeCall({ fp: 'file-the-case', tool: 'judicature_hear' }), null);
  // back to the rotation: now it is polling
  assert.equal(g.observeCall({ fp: 'poll0', tool: 'poll' })?.id, 'LG-3');
});

test('the identical operation is the same tool with the same arguments', () => {
  const post = (text) => loopFingerprint('forum_post', { topic: 'floor', text });
  assert.notEqual(post('my opening'), post('a reply to fp_3'), 'two different posts are two operations');
  assert.equal(post('the same words'), post('the same words'), 'the same post twice is one operation');
  assert.equal(loopFingerprint('forum_pass', { reason: 'x', b: 1 }), loopFingerprint('forum_pass', { b: 1, reason: 'x' }), 'argument order is not identity');
  assert.notEqual(loopFingerprint('ask_human', { question: 'q1' }), loopFingerprint('ask_human', { question: 'q2' }));
  // genuine repetition still trips LG-5
  const g = new Guard();
  for (let i = 0; i < 4; i++) g.observeCall({ fp: post('the same words'), tool: 'forum_post' });
  assert.equal(g.observeCall({ fp: post('the same words'), tool: 'forum_post' })?.id, 'LG-5');
});

test('the guard\'s own denial is not a tool failure', () => {
  assert.equal(isOwnDenial({ isError: true, error: { message: '[LG/LG-3] loop guard trip (RotatingPollingPattern): …' } }), true);
  assert.equal(isOwnDenial({ isError: true, content: [{ type: 'text', text: 'Error: [LG/LG-5] loop guard trip' }] }), true);
  assert.equal(isOwnDenial({ isError: true, error: { message: '[RA/D-7/opaque-network] "host" requires network access' } }), false, 'another gate\'s refusal is evidence');
  assert.equal(isOwnDenial({ isError: true, error: { message: 'ENOENT: no such file' } }), false);
  assert.equal(isOwnDenial({ isError: false, content: [{ type: 'text', text: '[LG/ in a successful output' }] }), false);
});

// The weight-of-voice-v2 filer, call for call, as the UNMODIFIED guard's
// fingerprint saw it (letters are operations; `|` is the Principal's
// message). The run recorded: LG-1 on the 6th post (turn 6), then LG-3 on
// the filing, LG-3 on the ask_human, LG-3 on the second filing.
const FILER_V2_OLD_SHAPE = '| self_describe:a forum_read:b forum_read:b forum_post:c record_read:d record_read:d | record_read:d forum_post:c | forum_post:c | forum_post:c record_read:d | forum_post:c record_read:d record_read:d | forum_post:c | judicature_hear:e ask_human:f | judicature_hear:e'.split(' ');

test('the v2 filer, replayed: the filing and the escalation pass', () => {
  const steps = drive(new Guard(), FILER_V2_OLD_SHAPE);
  const at = (step, nth = 0) => steps.filter((s) => s.step === step)[nth].trip;
  // with posts fingerprinted blind to their text, six different posts still
  // look like one operation, and LG-1 still fires — the argument-aware
  // fingerprint (above) is what tells them apart
  assert.equal(steps.filter((s) => s.trip).map((s) => `${s.step}→${s.trip}`).join(' '), 'forum_post:c→LG-1');
  assert.equal(at('judicature_hear:e', 0), null, 'the filing passes: the cleared latch took its stale window');
  assert.equal(at('ask_human:f'), null, 'the escalation passes: the floor is never latched');
  assert.equal(at('judicature_hear:e', 1), null, 'the second filing passes');
});
