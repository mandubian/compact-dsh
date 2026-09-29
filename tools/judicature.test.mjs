// The offline verifier's own tests: the rehearsal keyring generates a real
// signed annex WITH an adjudicator-set declaration, and the verifier
// cross-examines it the way any Witness would (I-7) — accepting the lawful
// declaration, computing the founding conflict, and refusing tampered or
// malformed bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'verify-judicature.mjs');
const KEYRING = join(ROOT, 'tools', 'rehearsal-keyring.mjs');

const run = (args) => {
  try {
    const stdout = execFileSync('node', [TOOL, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
};

function ensureKeyring(dir) {
  execFileSync('node', [KEYRING, 'ensure', dir], { encoding: 'utf8' });
  return join(dir, 'enforcer.annex.json');
}

test('the rehearsal annex declares its set, and the verifier accepts it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const annexPath = ensureKeyring(dir);

  const ok = run(['--annex', annexPath]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /annex verifies/);
  assert.match(ok.stdout, /set rehearsal-first-instance: 1 role\(s\)/);
  assert.match(ok.stdout, /seat founder — standing principal:founder/);
  assert.match(ok.stdout, /first external Member by 2030/);
  // the founding edges are visible in the offline read
  assert.match(ok.stdout, /edge plugin:compact-dsh —directed-by→ principal:founder/);
  assert.match(ok.stdout, /edge plugin:compact-dsh —asserts-with→ key:dev-rehearsal-enforcer/);
});

test('the founding conflict computes offline: a case against the composition is unheard', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const annexPath = ensureKeyring(dir);

  // against the founder directly: his own seat is the overlap
  const vsFounder = run(['--annex', annexPath, '--parties', 'principal:founder']);
  assert.equal(vsFounder.code, 0);
  assert.match(vsFounder.stdout, /REFUSED rehearsal-first-instance\/founder — overlap: principal:founder/);
  assert.match(vsFounder.stdout, /UNHEARD, never dismissed/);

  // against the Enforcer key THROUGH the composition node: the founder
  // directs the composition that asserts with that key — the recusal the
  // whole founding honesty exists to make computable
  const vsEnforcer = run(['--annex', annexPath, '--parties', 'key:dev-rehearsal-enforcer']);
  assert.equal(vsEnforcer.code, 0);
  assert.match(vsEnforcer.stdout,
    /overlap: principal:founder → plugin:compact-dsh → key:dev-rehearsal-enforcer/);
  assert.match(vsEnforcer.stdout, /UNHEARD/);

  // against a stranger: the founder seat remains and the panel resolves
  const vsStranger = run(['--annex', annexPath, '--parties', 'principal:stranger']);
  assert.equal(vsStranger.code, 0);
  assert.match(vsStranger.stdout, /panel: rehearsal-first-instance \(founder\)/);
});

test('a tampered declaration fails the annex signature, not the schema', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const annexPath = ensureKeyring(dir);
  const annex = JSON.parse(readFileSync(annexPath, 'utf8'));
  annex.adjudicatorSets.sets[0].roles.push({ id: 'smuggled', standing: { kind: 'principal', id: 'x' } });
  writeFileSync(annexPath, JSON.stringify(annex));
  const out = run(['--annex', annexPath]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /annex-signature-invalid/);
});

test('a malformed but SIGNED section is refused by the schema (D-7)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const annexPath = ensureKeyring(dir);
  const annex = JSON.parse(readFileSync(annexPath, 'utf8'));
  // re-sign the broken section with the enforcer private key from the keyring:
  // the signature will verify, the affidavit itself will not
  annex.adjudicatorSets.edges.push({ type: 'directed-by', from: { kind: 'principal', id: 'ghost' }, to: { kind: 'principal', id: 'founder' } });
  const { signAnnex } = await import('compact-dsh-seals');
  const privateKey = readFileSync(join(dir, 'enforcer.pem'), 'utf8');
  const reSigned = signAnnex({
    composition: annex.composition, host: annex.host, lawDigest: annex.lawDigest,
    registerDigest: annex.registerDigest, keyId: annex.enforcer.keyId,
    publicKey: annex.enforcer.publicKey, privateKey,
    adjudicatorSets: annex.adjudicatorSets, issuedAt: annex.issuedAt,
  });
  const brokenPath = join(dir, 'broken.annex.json');
  writeFileSync(brokenPath, JSON.stringify(reSigned));
  const out = run(['--annex', brokenPath]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /dangling edge/);
});

test('an annex without a section reads as UNDECLARED, and that is not a failure', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const annexPath = ensureKeyring(dir);
  const annex = JSON.parse(readFileSync(annexPath, 'utf8'));
  delete annex.adjudicatorSets;
  const { signAnnex } = await import('compact-dsh-seals');
  const privateKey = readFileSync(join(dir, 'enforcer.pem'), 'utf8');
  const bare = signAnnex({
    composition: annex.composition, host: annex.host, lawDigest: annex.lawDigest,
    registerDigest: annex.registerDigest, keyId: annex.enforcer.keyId,
    publicKey: annex.enforcer.publicKey, privateKey, issuedAt: annex.issuedAt,
  });
  const barePath = join(dir, 'bare.annex.json');
  writeFileSync(barePath, JSON.stringify(bare));
  const out = run(['--annex', barePath]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /UNDECLARED — nothing can be heard, by design/);
});

test('no --annex is a usage refusal, and keyring artifacts stay private', async (t) => {
  const out = run([]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /--annex/);
  const dir = mkdtempSync(join(tmpdir(), 'jg-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  ensureKeyring(dir);
  const priv = join(dir, 'enforcer.pem');
  const mode = (readdirSync(dir), (readFileSync(priv), (await import('node:fs')).statSync(priv).mode & 0o777));
  assert.equal(mode, 0o600, 'the enforcer private key stays 0600');
});
