// Phase 3 acceptance — each trip condition in isolation (synthetic streams),
// repair-budget spending, and the deterministic vs behavioral classification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Guard, TRIPS } from '../src/trips.js';
import { classifyToolResult } from '../src/classify.js';

const ok = (result = {}) => ({ isError: false, ...result });
const fail = (message, extra = {}) => ({ isError: true, error: { message }, ...extra });

test('LG-1 NoMeaningfulProgress: no new fingerprint in the last 10 calls', () => {
  const g = new Guard();
  // nine fresh fingerprints, then ten calls reusing only seen ones
  for (let i = 0; i < 9; i++) assert.equal(g.observeCall({ fp: `fp${i}`, tool: 'net.fetch' }), null);
  for (let i = 0; i < 9; i++) assert.equal(g.observeCall({ fp: `fp${i}`, tool: 'net.fetch' }), null);
  const trip = g.observeCall({ fp: 'fp0', tool: 'net.fetch' }); // 10th call, all seen
  assert.equal(trip?.id, 'LG-1');
  assert.equal(TRIPS.NO_MEANINGFUL_PROGRESS.behavioral, true);
});

test('LG-2 ToolFailureBudget: 8 failures of one tool', () => {
  const g = new Guard();
  // distinct error classes keep LG-8 (same-signature budget) out of the way
  for (let i = 0; i < 7; i++) assert.equal(g.observeResult({ fp: `fp${i}`, tool: 'db.query', outcome: 'failure', errorClass: `class${i}` }), null);
  const trip = g.observeResult({ fp: 'fp7', tool: 'db.query', outcome: 'failure', errorClass: 'class7' });
  assert.equal(trip?.id, 'LG-2');
  // a DIFFERENT tool's failures do not share the budget
  const g2 = new Guard();
  for (let i = 0; i < 7; i++) g2.observeResult({ fp: `fp${i}`, tool: 'db.query', outcome: 'failure', errorClass: `class${i}` });
  assert.equal(g2.observeResult({ fp: 'fp7', tool: 'other.tool', outcome: 'failure', errorClass: 'class7' }), null);
});

test('LG-3 RotatingPollingPattern: ≤6 distinct fingerprints across 16 calls', () => {
  const g = new Guard();
  for (let i = 0; i < 15; i++) assert.equal(g.observeCall({ fp: `fp${i % 6}`, tool: 'net.fetch' }), null);
  const trip = g.observeCall({ fp: 'fp0', tool: 'net.fetch' }); // 16th call: the full window has 6 distinct
  assert.equal(trip?.id, 'LG-3');
  // healthy variety never trips
  const g2 = new Guard();
  for (let i = 0; i < 20; i++) assert.equal(g2.observeCall({ fp: `fp${i}`, tool: 'net.fetch' }), null);
});

test('LG-4 ChildFailureBudget: 5 with a loop penalty on repeating child failures', () => {
  const g = new Guard();
  // 3 fresh child failures (weight 1 each) = 3, distinct classes keep LG-8 away
  for (let i = 0; i < 3; i++) assert.equal(g.observeResult({ fp: `cf${i}`, tool: 'subagent', outcome: 'failure', errorClass: `class${i}`, hasParent: true }), null);
  // a repeating child failure costs 1 + 2 = 3 → total 6 ≥ 5
  const trip = g.observeResult({ fp: 'cf0', tool: 'subagent', outcome: 'failure', errorClass: 'class3', hasParent: true });
  assert.equal(trip?.id, 'LG-4');
});

test('LG-5 RedundantRosterPolling: identical fingerprint 5 times consecutively', () => {
  const g = new Guard();
  for (let i = 0; i < 4; i++) assert.equal(g.observeCall({ fp: 'same', tool: 'roster.list' }), null);
  const trip = g.observeCall({ fp: 'same', tool: 'roster.list' });
  assert.equal(trip?.id, 'LG-5');
});

test('LG-6 LlmFailureBudget: 3 consecutive provider failures, reset by user signal', () => {
  const g = new Guard();
  assert.equal(g.observeLlmFailure(), null);
  assert.equal(g.observeLlmFailure(), null);
  const trip = g.observeLlmFailure();
  assert.equal(trip?.id, 'LG-6');
  g.clearOnUserSignal();
  assert.equal(g.observeLlmFailure(), null, 'a new turn resets the consecutive counter');
});

test('LG-7 WorkflowTerminal: deterministic — denies all, never auto-resumes', () => {
  const g = new Guard();
  const trip = g.observeResult({ fp: 'wf', tool: 'workflow.run', outcome: 'failure', errorClass: 'terminal', terminal: true });
  assert.equal(trip?.id, 'LG-7');
  assert.equal(trip.behavioral, false, 'the only deterministic trip');
  assert.equal(g.denyAll?.id, 'LG-7');
  // no auto-resume: a user signal does NOT clear it
  g.clearOnUserSignal();
  assert.equal(g.observeCall({ fp: 'anything-new', tool: 'any.tool' })?.id, 'LG-7');
});

test('LG-8 RecurringUnrecoverableError: same tool + error class 3 times', () => {
  const g = new Guard();
  for (let i = 0; i < 2; i++) assert.equal(g.observeResult({ fp: `fp${i}`, tool: 'fs.read', outcome: 'failure', errorClass: 'denied' }), null);
  const trip = g.observeResult({ fp: 'fp2', tool: 'fs.read', outcome: 'failure', errorClass: 'denied' });
  assert.equal(trip?.id, 'LG-8');
  // a different error class is a different signature
  const g2 = new Guard();
  g2.observeResult({ fp: 'a', tool: 'fs.read', outcome: 'failure', errorClass: 'denied' });
  g2.observeResult({ fp: 'b', tool: 'fs.read', outcome: 'failure', errorClass: 'not-found' });
  assert.equal(g2.observeResult({ fp: 'c', tool: 'fs.read', outcome: 'failure', errorClass: 'timeout' }), null);
});

test('LG-9 RepeatedIrrecoverableRejection: the same operation denied 3 times', () => {
  const g = new Guard();
  for (let i = 0; i < 2; i++) assert.equal(g.observeRefusal({ fp: 'fp_x', kind: 'deny' }), null);
  const trip = g.observeRefusal({ fp: 'fp_x', kind: 'deny' });
  assert.equal(trip?.id, 'LG-9');
});

test('LG-10 RepeatedSpawnIdentity: the identical spawn 3 times', () => {
  const g = new Guard();
  assert.equal(g.observeCall({ fp: 'spawn_fp', tool: 'agent.spawn', isSpawn: true }), null);
  assert.equal(g.observeCall({ fp: 'spawn_fp', tool: 'agent.spawn', isSpawn: true }), null);
  const trip = g.observeCall({ fp: 'spawn_fp', tool: 'agent.spawn', isSpawn: true });
  assert.equal(trip?.id, 'LG-10');
});

test('LG-11 RedundantAnnotationLoop: the same corrective prose twice', () => {
  const g = new Guard();
  assert.equal(g.observeAnnotation('LG-5:same sig'), null);
  const trip = g.observeAnnotation('LG-5:same sig');
  assert.equal(trip?.id, 'LG-11');
});

test('LG-12 IrrecoverableGateFlailing: 10 refusals without a single allowance', () => {
  const g = new Guard();
  for (let i = 0; i < 9; i++) {
    assert.equal(g.observeRefusal({ fp: `fp${i}`, kind: i % 2 ? 'deny' : 'ask' }), null);
  }
  const trip = g.observeRefusal({ fp: 'fp9', kind: 'ask' });
  assert.equal(trip?.id, 'LG-12');
  // an allowance resets the flailing counter
  const g2 = new Guard();
  for (let i = 0; i < 9; i++) g2.observeRefusal({ fp: `fp${i}`, kind: 'ask' });
  g2.observeResult({ fp: 'allowed', tool: 'x', outcome: 'success' });
  assert.equal(g2.observeRefusal({ fp: 'more', kind: 'ask' }), null);
});

test('behavioral trips latch denials and clear on the user signal; repair budget is 3', () => {
  const g = new Guard();
  // trip LG-5
  for (let i = 0; i < 5; i++) g.observeCall({ fp: 'same', tool: 'roster.list' });
  assert.equal(g.latch?.id, 'LG-5');
  assert.equal(g.observeCall({ fp: 'brand-new-fp', tool: 'other' })?.id, 'LG-5', 'latched: even fresh calls are denied');
  g.clearOnUserSignal();
  assert.equal(g.observeCall({ fp: 'brand-new-fp', tool: 'other' }), null, 'the user signal cleared the latch');
  // spend the repair budget (3 repairs), the 4th trip exhausts it
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 5; i++) g.observeCall({ fp: 'same', tool: 'roster.list' });
    g.clearOnUserSignal();
  }
  for (let i = 0; i < 5; i++) g.observeCall({ fp: 'same', tool: 'roster.list' });
  const t = g.observeCall({ fp: 'anything', tool: 'other' });
  assert.equal(g.denyAll?.id, 'LG-5', 'the 4th trip of the same class exhausts the repair budget');
  assert.ok(g.denyAll.message.includes('repair budget'));
  g.clearOnUserSignal();
  assert.equal(g.observeCall({ fp: 'anything', tool: 'other' })?.id, 'LG-5', 'exhausted repairs never resume');
});

test('latches are per-guard (per session): one session\u2019s trip never denies another', () => {
  const ga = new Guard();
  const gb = new Guard();
  for (let i = 0; i < 5; i++) ga.observeCall({ fp: 'same', tool: 'roster.list' });
  assert.equal(ga.observeCall({ fp: 'x', tool: 'y' })?.id, 'LG-5');
  assert.equal(gb.observeCall({ fp: 'x', tool: 'y' }), null, 'sibling sessions are independent');
});

test('classify: the sandbox denial dialect, not-found, timeout, terminal, success', () => {
  assert.deepEqual(classifyToolResult(ok()), { outcome: 'success', errorClass: null, terminal: false });
  assert.deepEqual(classifyToolResult(fail('touch /x: read-only file system')), { outcome: 'failure', errorClass: 'denied', terminal: false });
  assert.deepEqual(classifyToolResult(fail('cat: /x: No such file or directory')), { outcome: 'failure', errorClass: 'not-found', terminal: false });
  assert.deepEqual(classifyToolResult(fail('operation timed out after 30000ms')), { outcome: 'failure', errorClass: 'timeout', terminal: false });
  assert.deepEqual(classifyToolResult(fail('WORKFLOW_TERMINAL: the pipeline cannot continue')), { outcome: 'failure', errorClass: 'terminal', terminal: true });
  assert.deepEqual(classifyToolResult(fail('something inexplicable')), { outcome: 'failure', errorClass: 'unknown', terminal: false });
});
