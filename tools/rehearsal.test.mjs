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
import { parseManifest, parseSeal, verifySeal, verifyAnnex, sha256Hex } from 'compact-dsh-seals';

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
    // ensure seeds the ledger with the member roll's two SIMULATED acts (the
    // admission statute, the epoch-0 checkpoint); this enactment is the third
    assert.equal(ledger.entries.length, 3);
    const entry = ledger.entries.at(-1);
    assert.equal(entry.kind, 'SIMULATED ENACTMENT');
    assert.ok(entry.reason);
    assert.deepEqual(entry.dissent, []);
    assert.equal(entry.standing, 'none');

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
    // the two ensure-seeded roll acts plus the one successful enactment; the
    // refused apply recorded nothing new
    assert.equal(ledger.entries.length, 3, 'the refused act recorded nothing new');
  } finally {
    rmSync(kr, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ── the member roll (identity slice 1, #124): the seeded roll, the SIMULATED
// admission statute, and the auditor's --roll walk ──
const AUDITOR = fileURLToPath(new URL('../auditor/audit.mjs', import.meta.url));

test('rehearsal-keyring: the member roll — statute enacted in simulation, admissions seeded, epoch 0 checkpointed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rehearsal-roll-'));
  try {
    run(KEYRING, ['ensure', dir]);
    // the statute is sealed k-of-n and recorded as SIMULATED, with the
    // checkpoint's closing recorded beside it in ONE ledger
    const ledger = JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8'));
    assert.equal(ledger.entries.length, 2);
    assert.match(ledger.entries[0].reason, /ADMISSION STATUTE/);
    assert.match(ledger.entries[1].reason, /"the roll stood thus"/);
    for (const e of ledger.entries) {
      assert.equal(e.kind, 'SIMULATED ENACTMENT');
      assert.equal(e.standing, 'none');
    }
    const statuteBytes = readFileSync(join(dir, 'statute-admission.md'));
    const statuteSeal = parseSeal(readFileSync(join(dir, 'statute-admission.sig.json'), 'utf8'));
    const verdict = verifySeal({ bytes: statuteBytes, subject: 'amendment', seal: statuteSeal, manifest: parseManifest(readFileSync(join(dir, 'keyring.json'), 'utf8')) });
    assert.equal(verdict.conveysStanding, false);

    // the roll: two admissions under the statute's digest, epoch 0 checkpoint
    const roll = JSON.parse(readFileSync(join(dir, 'roll.json'), 'utf8'));
    assert.equal(roll.kind, 'rehearsal-member-roll');
    assert.equal(roll.standing.startsWith('none'), true);
    assert.equal(roll.entries.length, 2);
    assert.equal(roll.genesis.admissionStatute.digest, sha256Hex(statuteBytes));
    assert.ok(roll.entries.every((e) => e.kind === 'admission' && e.grounds.includes('SIMULATED')));
    assert.equal(roll.checkpoints.length, 1);
    assert.equal(roll.checkpoints[0].epoch, 0);
    // the member private halves stay local and owner-only, like every key here
    assert.equal(statSync(join(dir, 'private', 'member-rehearsal-founder.pem')).mode & 0o777, 0o600);

    const out = run(KEYRING, ['verify', dir]);
    assert.match(out, /member roll OK: 2 entries, 2 member\(s\) \(2 live\), anchored through seq 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auditor --roll: the walk verifies offline, and a tampered roll refuses by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rehearsal-roll-'));
  try {
    run(KEYRING, ['ensure', dir]);
    const log = join(dir, 'log.json');
    writeFileSync(log, '[]\n');
    const ok = run(AUDITOR, [log, '--roll', join(dir, 'roll.json'), '--keyring', join(dir, 'keyring.json'), '--quiet']);
    assert.match(ok, /auditor: conforming/);
    const full = JSON.parse(run(AUDITOR, [log, '--roll', join(dir, 'roll.json'), '--keyring', join(dir, 'keyring.json')]));
    assert.equal(full.checked.roll, 'verified');
    assert.equal(full.memberRoll.entries, 2);
    assert.equal(full.memberRoll.members, 2);
    assert.equal(full.memberRoll.conveysStanding, false);
    assert.ok(full.reliesOn.some((r) => r.includes('member roll') && r.includes('conveys no standing')));

    // the forgery: a row changed after chaining fails its hash AND its
    // signatures (every field is inside the signed bytes), by name
    const rollPath = join(dir, 'roll.json');
    const roll = JSON.parse(readFileSync(rollPath, 'utf8'));
    roll.entries[0].grounds = 'forged grounds';
    writeFileSync(rollPath, JSON.stringify(roll, null, 2) + '\n');
    let refused = null;
    try {
      run(AUDITOR, [log, '--roll', rollPath, '--keyring', join(dir, 'keyring.json'), '--quiet']);
    } catch (e) {
      refused = e;
    }
    assert.ok(refused, 'the tampered roll must refuse');
    assert.match(String(refused.stderr), /\[roll-hash\]/);
    assert.match(String(refused.stderr), /\[roll-sub-threshold\]/);

    // and --roll without --keyring names its own want, never guessing
    let noKey = null;
    try {
      run(AUDITOR, [log, '--roll', rollPath, '--quiet']);
    } catch (e) {
      noKey = e;
    }
    assert.match(String(noKey.stderr), /requires the authority manifest/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
