// The immutable-toolchain recognition (#152), pure logic: the pre-execute
// family (systemPackageWriteOf) with its precision requirement — a
// workspace-scoped install is LAWFUL and passes untouched — the belt's wider
// shape (packageManagerCommandOf), and the envelope's canonical text.
// No host, no daemon: the recognition is static command analysis.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  systemPackageWriteOf, packageManagerCommandOf,
  immutableToolchainEnvelope, immutableToolchainDenial, immutableToolchainBlock,
  GATE, IMMUTABLE_TOOLCHAIN_RULE,
} from '../src/toolchain.js';

const writeOf = (command) => systemPackageWriteOf({ command });

// -- the doomed family: system package managers --------------------------------

test('the named family refuses: apt/apt-get install, dnf/yum install, apk add', () => {
  for (const command of [
    'apt-get install -y python3',
    'apt install python3',
    'apt-get install python3 python3-pip',
    'dnf install -y jq',
    'yum install jq',
    'apk add --no-cache curl',
  ]) {
    const w = writeOf(command);
    assert.ok(w, `${command} is a doomed system write`);
    assert.equal(w.command, command);
  }
});

test('the rest of the named binaries\' write surface refuses by the same doctrine', () => {
  for (const command of [
    'apt-get update && apt-get install -y jq',
    'apt-get upgrade -y',
    'apt-get remove python3',
    'dnf upgrade',
    'apk del curl',
  ]) {
    assert.ok(writeOf(command), `${command} writes the immutable stores too`);
  }
});

test('the write verb is recognized anywhere in the line (the analyzer\'s package-verb precedent)', () => {
  assert.ok(writeOf('sudo apt-get install -y python3'), 'sudo does not launder the act');
  assert.ok(writeOf('sh -c "apt-get install -y python3"'), 'a wrapper does not launder the act');
  assert.ok(writeOf('cd /src && dnf install jq'), 'a compound head does not launder the act');
});

test('package-manager READS and the workspace language managers are not the family', () => {
  for (const command of [
    'apt list --installed',
    'apt-cache policy python3',
    'dpkg -l | grep python3',
    'apk info',
    'npm install left-pad',
    'pnpm add express',
    'cargo build --release',
    'pip download requests -d ./wheels',   // download lands in the workspace, not the stores
    'python3 -m venv .venv',
  ]) {
    assert.equal(writeOf(command), null, `${command} is not a doomed system write`);
  }
});

// -- the precision requirement: workspace-scoped installs are LAWFUL ----------

test('precision: a workspace venv install rides clean — the issue\'s own lawful move', () => {
  for (const command of [
    'python3 -m venv .venv && .venv/bin/pip install requests',
    '.venv/bin/pip install requests',
    './.venv/bin/pip3 install requests',
    'venv/bin/pip install -r requirements.txt',
    'source .venv/bin/activate && pip install requests',
    '. .venv/bin/activate && pip3 install requests',
    'VIRTUAL_ENV=.venv pip install requests',
    'PATH=.venv/bin:$PATH pip install requests',
    '.venv/bin/python -m pip install requests',
  ]) {
    assert.equal(writeOf(command), null, `${command} is LAWFUL (workspace venv)`);
  }
});

test('precision: destination-scoped pip installs ride clean', () => {
  for (const command of [
    'pip install --target ./vendor requests',
    'pip install --target=.venv/lib/python3.12/site-packages requests',
    'pip install -t ./libs requests',
    'pip install --prefix ./local requests',
    'pip install --user requests',         // HOME-scoped: the belt's named shape, not pre-execute
    'python3 -m pip install --user requests',
  ]) {
    assert.equal(writeOf(command), null, `${command} is scoped away from the system stores`);
  }
});

test('an unscoped pip install is the doomed shape (the system site-packages)', () => {
  for (const command of [
    'pip install requests',
    'pip3 install requests flask',
    'pip install -r requirements.txt',
    'python3 -m pip install requests',
    'python -m pip install --break-system-packages requests',
    '/usr/bin/pip3 install requests',
    '/usr/local/bin/python -m pip install requests',
  ]) {
    const w = writeOf(command);
    assert.ok(w, `${command} writes the system site-packages`);
    assert.equal(w.family, 'pip');
  }
});

test('a venv in the line never spares the system package managers', () => {
  const w = writeOf('source .venv/bin/activate && apt-get install -y libpq-dev');
  assert.ok(w, 'apt writes /usr and dpkg regardless of any venv');
  assert.equal(w.family, 'system');
});

// -- the belt: wider by design, never workspace-scoped -------------------------

test('the belt keeps the pre-execute family and adds the shapes precision spares', () => {
  for (const command of [
    'apt-get install -y python3',
    'pip install requests',
    'pip install --user requests',
    'pip3 install --user --upgrade requests',
    'npm install -g left-pad',
    'yarn add --global left-pad',
    'cargo install ripgrep',
    'go install golang.org/x/tools/cmd/goimports@latest',
    'gem install nokogiri',
  ]) {
    const s = packageManagerCommandOf({ command });
    assert.ok(s, `${command} is a belt shape`);
  }
});

test('the belt never teaches over a workspace-scoped act', () => {
  for (const command of [
    'npm install left-pad',
    'npm ci',
    'pnpm add express',
    'pip install --target ./vendor requests',
    '.venv/bin/pip install requests',
    'CARGO_HOME=./.cargo cargo install ripgrep',
    'GOBIN=./bin go install golang.org/x/tools/cmd/goimports@latest',
    'grep -r needle /usr/share',
  ]) {
    assert.equal(packageManagerCommandOf({ command }), null, `${command} is lawful or not a package-manager act`);
  }
});

// -- the envelope ----------------------------------------------------------------

test('the envelope carries the canonical sentence and the four lawful moves', () => {
  const env = immutableToolchainEnvelope({ verb: 'apt-get install' });
  assert.equal(env.gate, GATE);
  assert.equal(env.ruleId, IMMUTABLE_TOOLCHAIN_RULE);
  assert.equal(GATE, 'SC');
  assert.equal(IMMUTABLE_TOOLCHAIN_RULE, 'CF-1/immutable-toolchain');
  // the canonical sentence, byte for byte (the doctrine is the envelope)
  assert.ok(env.text.includes(
    'the system toolchain is immutable and digest-pinned (CF-2) — installing system packages inside a confined act cannot succeed by design'));
  assert.ok(env.text.includes('[SC/CF-1/immutable-toolchain]'));
  assert.ok(env.text.startsWith('[SC/CF-1/immutable-toolchain] "apt-get install" writes the system package store:'));
  assert.deepEqual(env.lawfulNextMoves, [
    'language dependencies: install into the workspace (`python3 -m venv .venv && .venv/bin/pip install …`) — it persists across every act',
    'self-contained tools: fetch a static binary into `./bin/` and invoke by path',
    'request a read-only mount grant over an operator-provisioned tools directory',
    'escalate to your Principal to bake a derived image (the operator\'s act, CF-2 re-declared)',
  ]);
});

test('the pre-execute denial decision carries the envelope in the band reason', () => {
  const d = immutableToolchainDenial({ verb: 'apt-get install' });
  assert.equal(d.kind, 'deny');
  assert.ok(d.reason.includes('[SC/CF-1/immutable-toolchain]'));
  assert.ok(d.reason.includes('Lawful next moves'));
});

test('the belt block keeps the container\'s own words on the record below the envelope', () => {
  const raw = "pip: cannot install 'requests': Read-only file system";
  const b = immutableToolchainBlock({ verb: 'pip install --user' }, raw);
  assert.equal(b.kind, 'block');
  assert.ok(b.feedback[0].text.includes('[SC/CF-1/immutable-toolchain]'));
  assert.ok(b.feedback[0].text.includes(raw), 'the container\'s words are kept, not replaced');
  const bare = immutableToolchainBlock({ verb: 'pip install --user' }, '  ');
  assert.ok(!bare.feedback[0].text.includes('The container reported'), 'nothing is quoted where nothing was said');
});
