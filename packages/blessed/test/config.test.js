import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveConfig } = await import('../src/index.js');

const IMAGE_DIGEST = 'sha256:' + 'a'.repeat(64);
const BASE = () => ({
  approval: { persistPath: '/state/approvals.json' },
  sandbox: { image: 'ubuntu:24.04', imageProvenance: [{ ref: 'ubuntu:24.04', digest: IMAGE_DIGEST, attestation: 'operator-declared' }] },
  protectedState: ['/state/sessions', '/state/chains', '/state/approvals.json'],
});

test('a composition that cannot name its protected Enforcer state refuses to start (F-5, D-8)', () => {
  for (const missing of [undefined, null, []]) {
    const config = BASE();
    if (missing === undefined) delete config.protectedState; else config.protectedState = missing;
    assert.throws(() => resolveConfig(config), /protectedState[\s\S]*rewrite its own record[\s\S]*refusing to start/);
  }
});

test('the Enforcer state is FORCED into the sandbox masks and the mount-grant protected list', () => {
  const resolved = resolveConfig(BASE());
  for (const p of ['/state/sessions', '/state/chains', '/state/approvals.json']) {
    assert.ok(resolved.sandbox.maskedPaths.includes(p), `maskedPaths must cover ${p} — a confined Subject must not reach it`);
    assert.ok(resolved.sandbox.protectedPaths.includes(p), `protectedPaths must cover ${p} — a mount grant must never name it`);
  }
});

test('operator-declared masks survive the merge alongside the state paths', () => {
  const config = BASE();
  config.sandbox.maskedPaths = ['/extra/secret'];
  const resolved = resolveConfig(config);
  assert.ok(resolved.sandbox.maskedPaths.includes('/extra/secret'));
  assert.ok(resolved.sandbox.maskedPaths.includes('/state/chains'));
});

test('blank state paths are rejected rather than canonicalized into junk', () => {
  const config = BASE();
  config.protectedState = ['/state/sessions', '  '];
  assert.throws(() => resolveConfig(config), /protectedState entry/);
});

test('a mistyped mask list fails loudly instead of spreading into character junk', () => {
  for (const key of ['maskedPaths', 'protectedPaths']) {
    const config = BASE();
    config.sandbox[key] = '/extra/secret';
    assert.throws(() => resolveConfig(config), new RegExp(`sandbox\\.${key} must be an array`));
    const nested = BASE();
    nested.sandbox[key] = { path: '/x' };
    assert.throws(() => resolveConfig(nested), new RegExp(`sandbox\\.${key} must be an array`));
  }
});

test('secrets are declared as env-var NAMES — values never enter the composition', () => {
  const config = BASE();
  config.secrets = ['GH_TOKEN', 'AWS_SECRET_ACCESS_KEY'];
  const resolved = resolveConfig(config);
  assert.deepEqual(resolved.secrets, ['GH_TOKEN', 'AWS_SECRET_ACCESS_KEY']);
  assert.deepEqual(resolved.approval.secretRefs, ['GH_TOKEN', 'AWS_SECRET_ACCESS_KEY'],
    'the approval gate learns the NAMES — its envelope can then name the injection agreement');

  const invalid = BASE();
  invalid.secrets = ['GH_TOKEN', '/path/oops'];
  assert.throws(() => resolveConfig(invalid), /env-var NAMES/);
  const defaulted = BASE();
  assert.deepEqual(resolveConfig(defaulted).secrets, [], 'the absent posture: nothing declared, nothing injectable');
});

test('the egress posture is the sandbox declaration — approval.egress is not a knob (#38)', () => {
  const config = BASE();
  config.approval.egress = 'open';
  assert.throws(() => resolveConfig(config), /approval\.egress[\s\S]*two truths[\s\S]*one of them is the wire/,
    'an approval-level posture could contradict the wire the sandbox runs — refuse, never pick a side');
});

test('an explicitly undefined sandbox.network resolves to the docker default (none), never a posture of egress', () => {
  const config = BASE();
  config.sandbox.network = undefined;
  const resolved = resolveConfig(config);
  assert.equal(resolved.sandbox.network, 'none',
    'the spread of {network: undefined} would undo the default while docker runs `?? \'none\'` — normalize at the boundary');
});

test('sandbox.network must be a non-empty docker network name when present', () => {
  for (const bad of [42, '', '  ', {}]) {
    const config = BASE();
    config.sandbox.network = bad;
    assert.throws(() => resolveConfig(config), /sandbox\.network/);
  }
  const config = BASE();
  config.sandbox.network = 'host';
  assert.equal(resolveConfig(config).sandbox.network, 'host');
});

test('the subject-identity ledger rides the enforcer block — beside the chains the masks already cover (#20)', () => {
  const config = BASE();
  config.enforcer = {
    annexPath: '/state/enforcer.annex.json',
    privateKeyPath: '/state/enforcer.pem',
    ledgerPath: '/state/chains/subjects.jsonl',
  };
  const resolved = resolveConfig(config);
  assert.equal(resolved.enforcer.ledgerPath, '/state/chains/subjects.jsonl',
    'the offline auditor reads the certified lineage from here — an enforcer that writes its certificates nowhere is one whose lineage nobody can check');
  assert.ok(resolved.sandbox.protectedPaths.includes('/state/chains'),
    'the ledger sits inside Enforcer state the composition already protects — no new mask, same boundary');
  assert.ok(resolved.sandbox.maskedPaths.includes('/state/chains'));

  // a blank path is refused like every other declared path, never coerced
  const blank = { ...config, enforcer: { ...config.enforcer, ledgerPath: '  ' } };
  assert.throws(() => resolveConfig(blank), /enforcer\.ledgerPath must be a non-empty string/);

  // a ledger with no annex means nothing to ledger: no signing identity, no block
  const annexless = { ...config, enforcer: { ledgerPath: config.enforcer.ledgerPath } };
  assert.equal(resolveConfig(annexless).enforcer, undefined);
});

test('#38: the mediated posture is opt-in, named, and needs its network (D-7 at the config seam)', () => {
  // default: absent — a composition that says nothing runs the posture it has
  const plain = resolveConfig(BASE());
  assert.equal(plain.sandbox.egress, undefined, 'no declaration, no mediator: the default boot carries no egress capability');
  assert.equal(plain.sandbox.network, 'none');

  // declared properly: both halves survive into the resolved config
  const mediated = BASE();
  mediated.sandbox = { ...mediated.sandbox, egress: 'proxy', network: 'compact-egress' };
  const resolved = resolveConfig(mediated);
  assert.equal(resolved.sandbox.egress, 'proxy');
  assert.equal(resolved.sandbox.network, 'compact-egress');

  // declared badly: named refusals, never a silently composed posture
  const noNetwork = BASE();
  noNetwork.sandbox = { ...noNetwork.sandbox, egress: 'proxy' };
  assert.throws(() => resolveConfig(noNetwork), /requires sandbox\.network to name the INTERNAL mediation network \(never "none"\)/);

  const noneNetwork = BASE();
  noneNetwork.sandbox = { ...noneNetwork.sandbox, egress: 'proxy', network: 'none' };
  assert.throws(() => resolveConfig(noneNetwork), /never "none"/);

  const unknown = BASE();
  unknown.sandbox = { ...unknown.sandbox, egress: 'wide-open', network: 'compact-egress' };
  assert.throws(() => resolveConfig(unknown), /sandbox\.egress must be 'proxy'/);
});

test("#55: egressAddressClasses is the mediated posture's declared exception — validated, normalized, resolved", () => {
  // declared properly: the classes ride the resolved sandbox, de-duplicated —
  // apply dials from the NORMALIZED list, never the raw declaration
  const declared = BASE();
  declared.sandbox = { ...declared.sandbox, egress: 'proxy', network: 'compact-egress', egressAddressClasses: ['private', 'private', 'ula'] };
  const resolved = resolveConfig(declared);
  assert.deepEqual(resolved.sandbox.egressAddressClasses, ['private', 'ula']);

  // absent by composition: the default boot names no exception at all
  const plain = resolveConfig(BASE());
  assert.equal(plain.sandbox.egressAddressClasses, undefined);

  // refused outside the mediated posture — the exception extends THE MEDIATED posture, nothing else
  const unmediated = BASE();
  unmediated.sandbox = { ...unmediated.sandbox, egressAddressClasses: ['private'] };
  assert.throws(() => resolveConfig(unmediated), /extends the MEDIATED posture/);

  // refused when malformed: unknown class, empty list, not even a list
  for (const bad of [['metadata'], ['loopback', 'link-local'], [], 'private', {}]) {
    const malformed = BASE();
    malformed.sandbox = { ...malformed.sandbox, egress: 'proxy', network: 'compact-egress', egressAddressClasses: bad };
    assert.throws(() => resolveConfig(malformed), /must be a non-empty list from \(loopback, private, ula\)/);
  }
});

test('#55 follow-up: approval.egressPinOffers is declared, boolean, and MEDIATED-only — dead config is refused, never ignored', () => {
  // default absent: no offer, grants materialize unpinned exactly as before
  const plain = resolveConfig(BASE());
  assert.equal(plain.approval.egressPinOffers, undefined);

  // declared under the mediated posture: the offer rides the resolved approval
  const declared = BASE();
  declared.approval = { ...declared.approval, egressPinOffers: true };
  declared.sandbox = { ...declared.sandbox, egress: 'proxy', network: 'compact-egress' };
  assert.equal(resolveConfig(declared).approval.egressPinOffers, true);

  // declared without the mediator: the offer is the mediated posture's
  // resolution shown at decision time — meaningless without it, refused
  const unmediated = BASE();
  unmediated.approval = { ...unmediated.approval, egressPinOffers: true };
  assert.throws(() => resolveConfig(unmediated), /egressPinOffers[\s\S]*MEDIATED posture/);

  // non-boolean: refused by name, never coerced
  const malformed = BASE();
  malformed.approval = { ...malformed.approval, egressPinOffers: 'yes' };
  malformed.sandbox = { ...malformed.sandbox, egress: 'proxy', network: 'compact-egress' };
  assert.throws(() => resolveConfig(malformed), /egressPinOffers must be a boolean/);
});

test('I-1 slice 2: memberBinding is declared ALL of itself or not at all, and rides the resolved config', () => {
  // default absent: sessions bind to nobody, exactly as before
  const plain = resolveConfig(BASE());
  assert.equal(plain.memberBinding, undefined);

  // a binding that names a roll but no member is the false answer D-3 names
  for (const partial of [
    { rollPath: '/state/roll.json' },
    { rollPath: '/state/roll.json', keyringPath: '/state/keyring.json' },
    { rollPath: '/state/roll.json', keyringPath: '/state/keyring.json', memberKeyPath: '/state/founder.pem' },
    { memberId: 'rehearsal-founder' },
  ]) {
    const p = BASE();
    p.memberBinding = partial;
    assert.throws(() => resolveConfig(p), /memberBinding\.\w+ must be an explicit non-empty string/, JSON.stringify(Object.keys(partial)));
  }

  // declared whole: rides the resolved config for the self-model (the
  // binding) and the judicature (the roll a witness seat verifies against)
  const declared = BASE();
  declared.memberBinding = {
    rollPath: '/state/roll.json', keyringPath: '/state/keyring.json',
    memberKeyPath: '/state/founder.pem', memberId: 'rehearsal-founder',
  };
  assert.deepEqual(resolveConfig(declared).memberBinding, declared.memberBinding);
});
