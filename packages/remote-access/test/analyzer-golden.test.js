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

test('package managers resolve through the default registry map', () => {
  assert.deepEqual(targets('npm install lodash'), [{ host: 'registry.npmjs.org' }]);
  assert.deepEqual(targets('pip install requests'), [{ host: 'pypi.org' }]);
  assert.deepEqual(targets('cargo install ripgrep'), [{ host: 'crates.io' }]);
  assert.deepEqual(targets('docker pull ubuntu:24.04'), [{ host: 'registry-1.docker.io' }]);
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
