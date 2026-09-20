// The verify-register gate's own test (A-4: edits to mapped conduct without
// register edits fail) + the auditor's conformance checks (I-7) against a
// synthetic clean log and a seeded violation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit } from '../auditor/audit.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

test('verify-register passes on the real repository', () => {
  const out = execFileSync(process.execPath, ['tools/verify-register.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(out.includes('verify-register OK'), out);
});

test('the gate catches a renamed verifier file (A-4: mapped conduct cannot move silently)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-register-'));
  const reg = JSON.parse(readFileSync(join(ROOT, 'docs/register/register.json'), 'utf8'));
  // simulate a renamed test: break one verifier path
  reg.entries.find(e => e.clause === 'I-4' && e.plugin === 'compact-approval').verifiers[0] = 'packages/approval/test/RENAMED.test.js';
  const broken = join(dir, 'register.json');
  writeFileSync(broken, JSON.stringify(reg, null, 2));
  const r = spawnSync(process.execPath, ['tools/verify-register.mjs', '--register', broken], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'the gate must fail on a broken citation');
  assert.ok((r.stderr + r.stdout).includes('RENAMED.test.js'), 'the failure names the moved file');
});

test('the auditor attests a conforming synthetic session', () => {
  const log = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'approval/asked', time: 2, data: { id: 'a1', toolName: 'net.fetch', reason: '[AG/fp] not covered' } },
    { seq: 2, type: 'approval/decided', time: 3, data: { id: 'a1', outcome: 'allowed-once' } },
    { seq: 3, type: 'command/run', time: 4, data: { commandId: 'c1', name: 'grants-list' } },
    { seq: 4, type: 'command/done', time: 5, data: { commandId: 'c1', kind: 'success' } },
    { seq: 5, type: 'turn/end', time: 6, data: { turn: 1 } },
  ];
  const att = audit(log);
  assert.equal(att.verdict, 'conforming', JSON.stringify(att.findings));
  assert.equal(att.checked.asks, 1);
  assert.ok(att.reliesOn.some(r => r.includes('no chain sidecar was given')), 'the attestation names its trust basis (I-8)');
  assert.equal(att.checked.chain, 'not checked', 'an unverified integrity claim is never implied');
});

test('the auditor verifies the record offline when given the chain, and refuses a rewritten one (I-2/I-7)', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { extendChain, genesisHash } = await import('../packages/record/src/chain.js');

  const log = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'approval/asked', time: 2, data: { id: 'a1' } },
    { seq: 2, type: 'approval/decided', time: 3, data: { id: 'a1', outcome: 'allowed-once' } },
    { seq: 3, type: 'turn/end', time: 4, data: { turn: 1 } },
  ];
  const dir = mkdtempSync(join(tmpdir(), 'compact-audit-chain-'));
  const chainFile = join(dir, 'sess-audit.chain');
  writeFileSync(chainFile, extendChain(genesisHash('sess-audit'), 0, log).map(l => JSON.stringify({ seq: l.seq, h: l.h })).join('\n') + '\n');

  const good = audit(log, chainFile);
  assert.equal(good.verdict, 'conforming', JSON.stringify(good.findings));
  assert.equal(good.checked.chain, 'verified');
  assert.ok(good.reliesOn.some(r => /verified here/.test(r)));
  assert.match(good.chainHead, /^[0-9a-f]{64}$/);

  // the same log with one decision rewritten — the shape the log-only auditor
  // cannot distinguish from the truth
  const rewritten = log.map(e => e.seq === 2 ? { ...e, data: { id: 'a1', outcome: 'rejected' } } : e);
  const bad = audit(rewritten, chainFile);
  assert.equal(bad.verdict, 'violations');
  assert.equal(bad.checked.chain, 'BROKEN');
  const finding = bad.findings.find(f => f.rule === 'I-2');
  assert.equal(finding.severity, 'error');
  assert.match(finding.detail, /broken-link/);
});

test('the auditor detects a seeded violation: a decision from nowhere', () => {
  const log = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'approval/decided', time: 2, data: { id: 'ghost', outcome: 'allowed-once' } },
    { seq: 2, type: 'turn/end', time: 3, data: { turn: 1 } },
  ];
  const att = audit(log);
  assert.equal(att.verdict, 'violations');
  assert.ok(att.findings.some(f => f.rule === 'D-7' && f.detail.includes('no recorded ask')));
});

test('the auditor rejects outcomes outside the closed vocabulary and unbalanced turns', () => {
  const log = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'approval/decided', time: 2, data: { id: 'a', outcome: 'allowed-always' } }, // not in the vocabulary
    { seq: 2, type: 'turn/end', time: 3, data: { turn: 1 } },
    { seq: 3, type: 'turn/end', time: 4, data: { turn: 2 } }, // unbalanced
  ];
  const att = audit(log);
  assert.equal(att.verdict, 'violations');
  assert.ok(att.findings.some(f => f.detail.includes('closed vocabulary')));
  assert.ok(att.findings.some(f => f.detail.includes('without an open turn')));
});

test('a dsh v3 session header line is metadata, not an unevidenced act', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { extendChain, genesisHash } = await import('../packages/record/src/chain.js');
  const { splitPreamble } = await import('../auditor/audit.mjs');

  const header = { type: 'session', version: 3, id: 'sess-v3-header', createdAt: 1 };
  const events = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'turn/end', time: 2, data: { turn: 1 } },
  ];
  const { events: kept, headerLines } = splitPreamble([header, ...events]);
  assert.deepEqual(kept, events, 'the header is not treated as an act');
  assert.equal(headerLines, 1);

  const dir = mkdtempSync(join(tmpdir(), 'compact-audit-v3-'));
  const chainFile = join(dir, 'sess-v3-header.chain');
  writeFileSync(chainFile, extendChain(genesisHash('sess-v3-header'), 0, events).map(l => JSON.stringify({ seq: l.seq, h: l.h })).join('\n') + '\n');
  const good = audit(kept, chainFile, headerLines);
  assert.equal(good.verdict, 'conforming', JSON.stringify(good.findings));
  assert.equal(good.checked.headerLines, 1);
  assert.equal(good.checked.chain, 'verified');

  const tampered = kept.map(e => e.seq === 1 ? { ...e, time: 99 } : e);
  const bad = audit(tampered, chainFile, headerLines);
  assert.equal(bad.verdict, 'violations');
  assert.equal(bad.checked.chain, 'BROKEN');
});

test('the auditor flags the crash tail: an ask never decided, a log ending mid-turn', () => {
  const log = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'approval/asked', time: 2, data: { id: 'pending', toolName: 'x' } },
  ];
  const att = audit(log);
  assert.equal(att.verdict, 'conforming', 'warnings are not violations');
  assert.ok(att.findings.some(f => f.severity === 'warning' && f.detail.includes('never decided')));
  assert.ok(att.findings.some(f => f.severity === 'warning' && f.detail.includes('open turn')));
});
