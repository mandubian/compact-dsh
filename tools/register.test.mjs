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
import { enforcementPackages, enforcementPattern, guard } from './baseline-guard.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const REGISTER = JSON.parse(readFileSync(join(ROOT, 'docs/register/register.json'), 'utf8'));

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

test('the gate catches an evidence citation that does not resolve (pointer policy: a broken audit trail fails loudly)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-register-'));
  const reg = JSON.parse(readFileSync(join(ROOT, 'docs/register/register.json'), 'utf8'));
  // simulate a moved/renamed decision record: break one evidence citation
  reg.entries.find(e => e.clause === 'I-5' && e.plugin === 'compact-approval').evidence +=
    ' Adjudicated in docs/decision-RENAMED-RECORD.md.';
  const broken = join(dir, 'register.json');
  writeFileSync(broken, JSON.stringify(reg, null, 2));
  const r = spawnSync(process.execPath, ['tools/verify-register.mjs', '--register', broken], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'the gate must fail on a broken evidence citation');
  assert.ok((r.stderr + r.stdout).includes('docs/decision-RENAMED-RECORD.md'), 'the failure names the broken citation');
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

// --- baseline-guard (#58): the enforcement scope is derived from the register ---

test('the derived enforcement scope covers every register-cited package path', () => {
  const pattern = enforcementPattern(REGISTER);
  assert.ok(pattern, 'a non-empty register derives a pattern');
  for (const e of REGISTER.entries) {
    for (const kind of ['enforcedBy', 'verifiers']) {
      for (const p of e[kind] ?? []) {
        if (p.startsWith('packages/')) {
          assert.ok(pattern.test(p), `the guard must watch ${p} (${e.clause}, ${kind})`);
        }
      }
    }
  }
});

test('the derived scope names the packages the first hardcoded list silently dropped (#58)', () => {
  const pkgs = enforcementPackages(REGISTER);
  for (const dropped of ['envelope', 'blessed', 'egress-proxy']) {
    assert.ok(pkgs.includes(dropped), `${dropped} is register-cited and must be watched`);
  }
});

test('a new enforced package joins the watched scope through its register rows alone', () => {
  const next = {
    meta: REGISTER.meta,
    entries: [...REGISTER.entries, {
      clause: 'I-4',
      kind: 'enforced',
      plugin: 'compact-namespace-next',
      service: 'compact-namespace-next',
      enforcedBy: ['packages/namespace-next/src/index.js'],
      verifiers: ['packages/namespace-next/test/index.test.js'],
    }],
  };
  const pattern = enforcementPattern(next);
  assert.ok(pattern.test('packages/namespace-next/src/anything.js'), 'the row is the scope — no guard edit, no gap');
});

test('the guard classifies an undeclared amendment of conduct and names its remedy', () => {
  const files = ['packages/exit/src/reasons.js', 'docs/register/register.json', 'README.md'];
  const refused = guard({ title: 'feat(exit): new ground', register: REGISTER, files });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /\[baseline-update\]/);
  assert.ok(guard({ title: '[baseline-update] feat(exit): new ground', register: REGISTER, files }).ok, 'the declared form passes');
});

test('the guard stays silent when only one side of the sentinel moves', () => {
  const register = REGISTER;
  assert.ok(guard({ title: 'feat(exit): code only', register, files: ['packages/exit/src/reasons.js'] }).ok);
  assert.ok(guard({ title: 'docs(register): rows only', register, files: ['docs/register/register.json'] }).ok);
  assert.ok(guard({ title: 'docs: prose', register, files: ['README.md', 'docs/concept-the-record.md'] }).ok);
  // conduct also lives outside src/ and test/ — a cited package is watched whole
  assert.equal(guard({ title: 'feat(blessed): patch', register, files: ['packages/blessed/cordis.patch.yml', 'docs/register/register.json'] }).ok, false);
});

test('the guard refuses rather than passes on an unreadable or empty law', () => {
  assert.equal(guard({ title: 'x', register: null, files: [] }).ok, false);
  assert.equal(guard({ title: 'x', register: { entries: [] }, files: ['packages/x/src/a.js'] }).ok, false, 'an empty derived scope watches nothing — refuse');
});

test('the guard CLI emits the ::error remedy and exits non-zero on an undeclared amendment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-baseline-guard-'));
  const list = join(dir, 'files.txt');
  writeFileSync(list, 'packages/record/src/chain.js\ndocs/register/register.json\n');
  const bad = spawnSync(process.execPath, ['tools/baseline-guard.mjs', '--files', list, '--title', 'feat(record): rewrite history'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /::error::/);
  assert.match(bad.stderr, /\[baseline-update\]/);

  writeFileSync(list, 'README.md\n');
  const ok = spawnSync(process.execPath, ['tools/baseline-guard.mjs', '--files', list, '--title', 'docs: prose'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /baseline-guard ok/);

  // the acquisition itself fails closed: a missing list is a ::error::, not a stack trace
  const missing = spawnSync(process.execPath, ['tools/baseline-guard.mjs', '--files', join(dir, 'absent.txt'), '--title', 'x'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /::error::baseline-guard could not determine the changed files/);

  // CRLF lists parse the same way
  writeFileSync(list, 'packages/record/src/chain.js\r\ndocs/register/register.json\r\n');
  const crlf = spawnSync(process.execPath, ['tools/baseline-guard.mjs', '--files', list, '--title', 'feat(record): rewrite history'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(crlf.status, 0, 'a CRLF list still flags the amendment');
  assert.match(crlf.stderr, /\[baseline-update\]/);
});
