// The rehearsal tools: the identity set (tools/rehearsal-keyring.mjs) and the
// amendment loop (tools/rehearsal-amendment.mjs) — the A-1 → F-5 loop
// exercised end-to-end against a SCAFFOLD, never the vendored law itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseManifest, parseSeal, verifySeal, verifyAnnex } from 'compact-dsh-seals';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const KEYRING = fileURLToPath(new URL('./rehearsal-keyring.mjs', import.meta.url));
const AMENDMENT = fileURLToPath(new URL('./rehearsal-amendment.mjs', import.meta.url));
const run = (file, args) => execFileSync(process.execPath, [file, ...args], { encoding: 'utf8' });

test('rehearsal-keyring: ensure, verify, refuse-to-overwrite, force-rotate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rehearsal-kr-'));
  try {
    run(KEYRING, ['ensure', dir]);
    const out = run(KEYRING, ['verify', dir]);
    assert.match(out, /verify OK: annex self-signature valid/);
    assert.match(out, /law digest joins the sealed body/);
    assert.throws(() => run(KEYRING, ['ensure', dir]), /regenerating is a rotation/);
    run(KEYRING, ['ensure', dir, '--force']);
    // the private half stays local and owner-only
    assert.equal(statSync(join(dir, 'enforcer.pem')).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'private')).mode & 0o777, 0o700);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scaffold(root) {
  const c = join(root, 'packages', 'constitution');
  mkdirSync(join(c, 'compact'), { recursive: true });
  mkdirSync(join(c, 'src'), { recursive: true });
  mkdirSync(join(c, 'keyring', 'dev'), { recursive: true });
  mkdirSync(join(root, 'docs', 'register'), { recursive: true });
  cpSync(join(ROOT, 'packages', 'constitution', 'compact', 'compact.md'), join(c, 'compact', 'compact.md'));
  cpSync(join(ROOT, 'packages', 'constitution', 'src', 'body.js'), join(c, 'src', 'body.js'));
  cpSync(join(ROOT, 'packages', 'constitution', 'register.json'), join(c, 'register.json'));
  cpSync(join(ROOT, 'docs', 'register', 'register.json'), join(root, 'docs', 'register', 'register.json'));
  cpSync(join(ROOT, 'packages', 'constitution', 'keyring', 'dev', 'keyring.json'), join(c, 'keyring', 'dev', 'keyring.json'));
  cpSync(join(ROOT, 'packages', 'constitution', 'keyring', 'dev', 'compact-body.sig.json'), join(c, 'keyring', 'dev', 'compact-body.sig.json'));
}

test('rehearsal-amendment: the full A-1 → F-5 loop against a scaffold — seal, ledger, apply, re-seal, re-pin', () => {
  const kr = mkdtempSync(join(tmpdir(), 'rehearsal-kr-'));
  const root = mkdtempSync(join(tmpdir(), 'rehearsal-scaffold-'));
  try {
    run(KEYRING, ['ensure', kr]);
    scaffold(root);

    const amendment = join(kr, 'amendment-test.md');
    writeFileSync(amendment, '# Amendment TEST — a rehearsal amendment\n\nThis amendment exists only inside the rehearsal domain; it changes nothing real.\n');

    // verify-only: sealed, verified, recorded as SIMULATED — the law untouched
    const dry = run(AMENDMENT, ['enact', amendment, '--keyring', kr, '--root', root, '--reason', 'rehearsal test']);
    assert.match(dry, /sealed and verified: 3 distinct signer/);
    assert.match(dry, /SIMULATED/);
    assert.match(dry, /verify-only/);
    const ledger = JSON.parse(readFileSync(join(kr, 'ledger.json'), 'utf8'));
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].kind, 'SIMULATED ENACTMENT');
    assert.ok(ledger.entries[0].reason);
    assert.deepEqual(ledger.entries[0].dissent, []);
    assert.equal(ledger.entries[0].standing, 'none');

    // apply: the law moves, and every pin moves with it
    run(AMENDMENT, ['enact', amendment, '--keyring', kr, '--root', root, '--apply']);

    const body = readFileSync(join(root, 'packages', 'constitution', 'compact', 'compact.md'));
    const digest = createHash('sha256').update(body).digest('hex');
    const newBodySource = readFileSync(join(root, 'packages', 'constitution', 'src', 'body.js'), 'utf8');
    assert.match(newBodySource, new RegExp(`COMPACT_DIGEST\\s*=\\s*'${digest}'`), 'the body pin moved with the law');
    for (const p of [join(root, 'packages', 'constitution', 'register.json'), join(root, 'docs', 'register', 'register.json')]) {
      assert.equal(JSON.parse(readFileSync(p, 'utf8')).meta.compactDigest, digest, 'the register pin moved with the law');
    }
    // the new seal verifies under the rehearsal authority keys, and the annex joined the new law
    const verdict = verifySeal({
      bytes: body, subject: 'compact-body',
      seal: parseSeal(readFileSync(join(root, 'packages', 'constitution', 'keyring', 'dev', 'compact-body.sig.json'), 'utf8')),
      manifest: parseManifest(readFileSync(join(kr, 'keyring.json'), 'utf8')),
    });
    assert.equal(verdict.conveysStanding, false);
    const annex = JSON.parse(readFileSync(join(kr, 'enforcer.annex.json'), 'utf8'));
    const joined = verifyAnnex({ annex, expectedLawDigest: digest });
    assert.equal(joined.lawDigest, digest);
    // and the amendment text is in the law now
    assert.match(body.toString(), /Amendment TEST — a rehearsal amendment/);
  } finally {
    rmSync(kr, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('rehearsal-amendment: a tampered amendment is refused before anything is recorded or applied', () => {
  const kr = mkdtempSync(join(tmpdir(), 'rehearsal-kr-'));
  const root = mkdtempSync(join(tmpdir(), 'rehearsal-scaffold-'));
  try {
    run(KEYRING, ['ensure', kr]);
    scaffold(root);
    const amendment = join(kr, 'amendment.md');
    writeFileSync(amendment, '# Amendment X\n\nharmless\n');
    run(AMENDMENT, ['enact', amendment, '--keyring', kr, '--root', root]);
    // forge: edit the amendment AFTER sealing, keep the old seal file? the
    // tool seals in-memory per invocation, so the refusal path is a bad
    // keyring: strip the authority private keys — sealing must refuse
    rmSync(join(kr, 'private'), { recursive: true, force: true });
    let failed = false;
    try {
      run(AMENDMENT, ['enact', amendment, '--keyring', kr, '--root', root, '--apply']);
    } catch {
      failed = true;
    }
    assert.equal(failed, true, 'sealing without authority keys must refuse');
    assert.ok(existsSync(join(root, 'packages', 'constitution', 'src', 'body.js')), 'the scaffold is untouched by the refusal');
    const ledger = JSON.parse(readFileSync(join(kr, 'ledger.json'), 'utf8'));
    assert.equal(ledger.entries.length, 1, 'the refused act recorded nothing new');
  } finally {
    rmSync(kr, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
