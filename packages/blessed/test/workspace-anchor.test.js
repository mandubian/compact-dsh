// CF-1/workspace-anchor (#18): a session whose header names a workspace this
// boot does not expose is refused with a named envelope at the composition
// layer, before any other gate. The dsh layer resolves BOTH the UI file root
// and the sandbox's write boundary from `header.cwd`, so a stale header would
// otherwise re-anchor confinement to a directory the boot never declared.
import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceAnchorDecision } from '../src/index.js';

test('a session naming the boot workspace — or no workspace at all — passes', () => {
  assert.equal(workspaceAnchorDecision(null, '/repo'), null, 'no named cwd: the boot root applies by the dsh fallback');
  assert.equal(workspaceAnchorDecision(undefined, '/repo'), null);
  assert.equal(workspaceAnchorDecision('/repo', '/repo'), null);
  assert.equal(workspaceAnchorDecision('/repo/', '/repo'), null, 'the canonical form is the anchor, not string identity');
  assert.equal(workspaceAnchorDecision('/repo/./', '/repo'), null);
});

test('a stale header.cwd is refused with a named envelope', () => {
  const decision = workspaceAnchorDecision('/home/me/compact-dsh', '/tmp/dsh-compact-demo');
  assert.equal(decision?.kind, 'deny');
  assert.match(decision.reason, /^\[CF\/CF-1\/workspace-anchor\]/, 'the refusal names its gate and rule');
  assert.match(decision.reason, /\/home\/me\/compact-dsh/, 'the session\'s named workspace is on the record');
  assert.match(decision.reason, /\/tmp\/dsh-compact-demo/, 'the boot\'s exposed workspace is named');
  assert.match(decision.reason, /Lawful next moves:/, 'the envelope lists lawful next moves (R-3/I-4)');
  assert.match(decision.reason, /--workspace/, 'the remedy names the launcher flag');
});

test('the anchor decision comes from the composition, never from the session', () => {
  // a stale session cannot argue its way in: the boot root is the second
  // argument, supplied by the composition's own sandbox policy
  const stale = '/home/me/compact-dsh';
  assert.equal(workspaceAnchorDecision(stale, stale)?.kind, undefined,
    'the same directory under the boot\'s own declaration is lawful');
});
