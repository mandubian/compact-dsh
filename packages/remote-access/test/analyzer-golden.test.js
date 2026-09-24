// Remote-access detection golden vectors (port plan Phase 2 acceptance).
// Each vector pins: the finding exists (or doesn't), its shape, and the
// extracted target — "this command needs network" becomes a per-host fact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer } from '../src/analyzer.js';

const A = createAnalyzer();
const findings = (command) => A.findings({ name: 'bash', arguments: { command } });
const targets = (command) => findings(command).map(f => f.target ?? `opaque:${f.verb}`);

test('URLs are findings with the literal url target', () => {
  assert.deepEqual(targets('curl https://api.example.com/v1/data'), [{ url: 'https://api.example.com/v1/data', host: 'api.example.com' }]);
  assert.deepEqual(targets('curl -sSL "https://api.example.com:8443/x"'), [{ url: 'https://api.example.com:8443/x', host: 'api.example.com' }]);
  assert.deepEqual(targets('wget http://mirror.example.org/pkg.tar.gz -O /tmp/p.tgz'), [{ url: 'http://mirror.example.org/pkg.tar.gz', host: 'mirror.example.org' }]);
});

test('ssh/scp/rsync extract the remote host, user prefix and all', () => {
  assert.deepEqual(targets('ssh deploy@bastion.example.com uptime'), [{ host: 'bastion.example.com' }]);
  assert.deepEqual(targets('scp file.txt user@files.example.com:/srv/'), [{ host: 'files.example.com' }]);
  assert.deepEqual(targets('rsync -av ./out backup@10.0.0.5:/srv/out'), [{ host: '10.0.0.5' }]);
  // a remote-shaped token is preferred over a dotted source filename
  assert.deepEqual(targets('scp ./archive.tar.gz user@files.example.com:/srv/'), [{ host: 'files.example.com' }]);
});

test('nc/telnet extract host and port; other verbs do not port-pair', () => {
  assert.deepEqual(targets('nc -zv db.internal 5432'), [{ host: 'db.internal', port: '5432' }]);
  assert.deepEqual(targets('telnet 192.168.1.10 25'), [{ host: '192.168.1.10', port: '25' }, { host: '192.168.1.10' }]);
});

test('git network subcommands extract the remote; local subcommands pass', () => {
  assert.deepEqual(targets('git clone https://github.com/org/repo.git'), [{ url: 'https://github.com/org/repo.git', host: 'github.com' }]);
  assert.deepEqual(targets('git clone git@github.com:org/repo.git'), [{ host: 'github.com' }]);
  // a remote NAME is not statically resolvable — opaque, fail-closed
  assert.deepEqual(targets('git push origin main'), ['opaque:git']);
  assert.deepEqual(findings('git status && git log --oneline'), []);
  assert.deepEqual(findings('git diff HEAD~1'), []);
});

test('package managers resolve through the default registry map, port declared (#56 A)', () => {
  // the port is a declared per-ecosystem fact (tier 2): the grant NAMES it, so
  // the tunnel the act actually needs is what the operator was shown
  assert.deepEqual(targets('npm install lodash'), [{ host: 'registry.npmjs.org', port: '443' }]);
  assert.deepEqual(targets('pip install requests'), [{ host: 'pypi.org', port: '443' }]);
  assert.deepEqual(targets('cargo install ripgrep'), [{ host: 'crates.io', port: '443' }]);
  assert.deepEqual(targets('docker pull ubuntu:24.04'), [{ host: 'registry-1.docker.io', port: '443' }]);
  // apt's default sources are plain http — the declared port is 80, not 443
  assert.deepEqual(targets('apt-get install -y jq'), [{ host: 'archive.ubuntu.com', port: '80' }]);
  assert.deepEqual(targets('apt install jq'), [{ host: 'archive.ubuntu.com', port: '80' }]);
});

test('opaque findings: a network verb with no resolvable target fails closed', () => {
  assert.deepEqual(targets('curl $DEPLOY_URL'), ['opaque:curl']);
  assert.deepEqual(targets('ssh "$HOST"'), ['opaque:ssh']);
  const f = findings('nc -l 9000');
  assert.equal(f[0].target, null, 'a listener has no remote target — opaque');
});

test('header values, URLs-in-flags, and non-network commands are not host findings', () => {
  // the URL is a finding; the header value 'X-Api-Key:' is not a host
  const t = targets('curl -H "Authorization: Bearer tok" https://api.example.com');
  assert.deepEqual(t, [{ url: 'https://api.example.com', host: 'api.example.com' }]);
  // echoing a URL over-approximates to a finding (static analysis is fail-closed —
  // documented): quoting does not exempt a URL literal
  assert.deepEqual(targets('echo "see https://docs.example.com"'), [{ url: 'https://docs.example.com', host: 'docs.example.com' }]);
  // no network verbs, no URLs, no IPs → no findings
  assert.deepEqual(findings('ls -la && grep -r TODO src/ | head -20'), []);
  assert.deepEqual(findings('cat /etc/hostname && echo done'), []);
  assert.deepEqual(findings('find . -name "*.log" -mtime +7 -delete'), []);
});

test('IP literals are findings wherever they appear; invalid octets are not IPs', () => {
  assert.deepEqual(targets('ping 8.8.8.8 -c 1'), [{ host: '8.8.8.8' }]);
  assert.deepEqual(targets('bash -c "echo > /dev/tcp/10.1.2.3/9000"'), [{ host: '10.1.2.3' }]);
  assert.deepEqual(findings('echo version 1.2.3.400 is not an ip'), []);
});

test('dedup: the same target found twice is one finding', () => {
  assert.deepEqual(targets('curl https://api.example.com/a && curl https://api.example.com/a'),
    [{ url: 'https://api.example.com/a', host: 'api.example.com' }]);
  assert.deepEqual(targets('nc 10.0.0.1 443; nc 10.0.0.1 443'),
    [{ host: '10.0.0.1', port: '443' }, { host: '10.0.0.1' }],
    'port-qualified and bare IP findings coexist as distinct targets');
});

test('only command-shaped arg keys are scanned', () => {
  const a = createAnalyzer({});
  assert.deepEqual(a.findings({ name: 'fs.write', arguments: { path: '/tmp/x', content: 'curl https://evil.example' } }), [],
    'file contents are not command strings');
  const custom = createAnalyzer({ commandArgKeys: ['cmdline'] });
  assert.deepEqual(custom.findings({ name: 'x', arguments: { cmdline: 'curl https://api.example.com' } }).map(f => f.target),
    [{ url: 'https://api.example.com', host: 'api.example.com' }]);
});

test('absolute-path invocations resolve to their verb (/usr/bin/curl)', () => {
  assert.deepEqual(targets('/usr/bin/curl https://api.example.com'), [{ url: 'https://api.example.com', host: 'api.example.com' }]);
});

test('verb mentions to read-only inspectors are not findings (issue #5)', () => {
  // presence checks and doc lookups never invoke the verb
  assert.deepEqual(findings('command -v curl'), []);
  assert.deepEqual(findings('which wget'), []);
  assert.deepEqual(findings('which -a curl'), []);
  assert.deepEqual(findings('type -a curl'), []);
  assert.deepEqual(findings('whence sftp'), []);
  assert.deepEqual(findings('man ssh'), []);
  assert.deepEqual(findings('whatis nc'), []);
  assert.deepEqual(findings('whereis rsync'), []);
  assert.deepEqual(findings('apropos telnet'), []);
  // the inspector must be in COMMAND POSITION — first token or after a separator
  assert.deepEqual(findings('(which curl)'), []);
  assert.deepEqual(findings('ls -la && which curl'), []);
  assert.deepEqual(findings('man ssh | grep -i protocol'), []);
  // the single & is a separator too (background operator)
  assert.deepEqual(findings('sleep 1 & which curl'), []);
  assert.deepEqual(targets('sleep 1 & curl $DEPLOY_URL'), ['opaque:curl']);
  // a mention does not hide a later invocation in the same line
  assert.deepEqual(targets('which curl && curl $DEPLOY_URL'), ['opaque:curl']);
});

test('dangerous-adjacent verb forms stay opaque — only the inspector list suppresses (issue #5)', () => {
  // wrappers that EXECUTE the verb are not inspectors
  assert.deepEqual(targets('sudo curl $DEPLOY_URL'), ['opaque:curl']);
  assert.deepEqual(targets('xargs curl'), ['opaque:curl']);
  // command substitution is command position — $(curl …) invokes
  assert.deepEqual(targets('$(curl $DEPLOY_URL)'), ['opaque:curl']);
  assert.deepEqual(targets('echo $(curl https://api.example.com/x)'),
    [{ url: 'https://api.example.com/x', host: 'api.example.com' }]);
  // bare `command` executes its argument — only `command -v` is read-only
  assert.deepEqual(targets('command curl $DEPLOY_URL'), ['opaque:curl']);
  // echo is benign, but it is not a PROVEN non-invoking inspector — the
  // doctrine narrows only what is provably non-invoking, so echo keeps the
  // opaque fail-closed behavior (the URL-literal convention is unchanged:
  // a URL in echo is still a finding, see above)
  assert.deepEqual(targets('echo curl'), ['opaque:curl']);
  // an inspector NOT in command position is itself an argument — no suppression
  assert.deepEqual(targets('echo which curl'), ['opaque:curl']);
  assert.deepEqual(targets('sudo which curl'), ['opaque:curl']);
  // path-form mentions are not bare verbs — verb recognition of absolute
  // paths applies in command position only, so these stay opaque
  assert.deepEqual(targets('echo /usr/bin/curl'), ['opaque:curl']);
});
