// Phase 1 work item 1 — fingerprint canonicalization golden vectors.
// "Canonicalization is security" (docs/concept-approval-layers.md): phrasings
// that MUST collapse to one fingerprint are grant-replay identity; phrasings
// that MUST differ are grant-confusion resistance. Each vector is pinned
// explicitly — a canonicalization change that breaks one of these is a
// security-relevant change, not a refactor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, canonicalTarget } from '../src/index.js';
import { parseAllowlistLikePattern } from '../src/pattern.js';
import { patternMatches } from '../src/grants.js';

const same = (a, b, label) => assert.equal(fingerprint('net.fetch', a), fingerprint('net.fetch', b), `must collapse: ${label ?? `${JSON.stringify(a)} ~ ${JSON.stringify(b)}`}`);
const differs = (a, b, label) => assert.notEqual(fingerprint('net.fetch', a), fingerprint('net.fetch', b), `must differ: ${label ?? `${JSON.stringify(a)} !~ ${JSON.stringify(b)}`}`);

test('host case never changes identity', () => {
  same({ host: 'api.example.com' }, { host: 'API.EXAMPLE.COM' });
  same({ host: 'Api.Example.Com' }, { host: 'api.example.com' });
});

test('URL: trailing slashes are one prefix identity', () => {
  same({ url: 'https://api.example.com/v1' }, { url: 'https://api.example.com/v1/' });
  same({ url: 'https://api.example.com/v1///' }, { url: 'https://api.example.com/v1/' });
  same({ url: 'https://api.example.com' }, { url: 'https://api.example.com/' });
});

test('URL: the query joins the replay identity (#8 G5, tightened)', () => {
  // was pinned equal before the adjudication; the decision record is the
  // security rationale for moving this pin: a query is operation parameters,
  // not target spelling, and an approval never replays a variant it did not
  // show the operator
  differs({ url: 'https://api.example.com/v1?key=secret' }, { url: 'https://api.example.com/v1' });
  differs({ url: 'https://api.example.com/v1?key=one' }, { url: 'https://api.example.com/v1?key=two' });
  same({ url: 'https://api.example.com/v1' }, { url: 'https://api.example.com/v1?' }, 'present-but-empty query is absent');
  same({ url: 'https://api.example.com/v1?a=1&b=2' }, { url: 'https://api.example.com/v1?b=2&a=1' }, 'parameter order is not identity');
  same({ url: 'https://api.example.com/v1?a=2&a=1' }, { url: 'https://api.example.com/v1?a=1&a=2' }, 'repeated names collapse by sorted name=value');
  differs({ url: 'https://api.example.com/v1?a=1' }, { url: 'https://api.example.com/v1?a=1&a=2' }, 'an added parameter is a different operation');
  // the query variant asymmetry is what G5 closed: one allowed-once on the
  // bare target must NOT authorize `?key=ANYTHING` until the TTL
  differs({ url: 'https://api.example.com/v1?key=REAL' }, { url: 'https://api.example.com/v1?key=ANYTHING' });
  // host-only targets are untouched: no url, no query component
  same({ host: 'api.example.com' }, { host: 'api.example.com' });
});

test('URL: credentials in the userinfo never reach the identity', () => {
  // https://user:token@host/ is the same target as https://host/ — and the
  // token is not part of what is fingerprinted, granted, or persisted
  same({ url: 'https://user:secret-token@api.example.com/v1' }, { url: 'https://api.example.com/v1' });
  same({ url: 'https://user:secret-token@api.example.com:8443/v1' }, { url: 'https://api.example.com:8443/v1' });
});

test('URL: default ports for the scheme are dropped, others are exact', () => {
  same({ url: 'https://api.example.com:443/v1' }, { url: 'https://api.example.com/v1' });
  same({ url: 'http://api.example.com:80/v1' }, { url: 'http://api.example.com/v1' });
  differs({ url: 'http://api.example.com:8080/' }, { url: 'http://api.example.com/' });
  differs({ url: 'https://api.example.com:8443/' }, { url: 'https://api.example.com/' });
});

test('URL: scheme matters — http and https targets never collide', () => {
  differs({ url: 'http://api.example.com/v1' }, { url: 'https://api.example.com/v1' });
});

test('URL: path prefixes are anchored, not fuzzy', () => {
  differs({ url: 'https://api.example.com/v1' }, { url: 'https://api.example.com/v2' });
  differs({ url: 'https://api.example.com/ev' }, { url: 'https://api.example.com/evil' });
  differs({ url: 'https://api.example.com/v1' }, { url: 'https://api.example.com/v10' });
});

test('bare host + port: exact without scheme context (conservative)', () => {
  // no url = no scheme to infer a default from; the port stays part of identity
  differs({ host: 'api.example.com', port: 443 }, { host: 'api.example.com' });
  same({ host: 'api.example.com', port: 443 }, { host: 'API.example.com', port: '443' });
  differs({ host: 'api.example.com', port: 443 }, { host: 'api.example.com', port: 8443 });
});

test('different tools on the same target are different calls', () => {
  assert.notEqual(fingerprint('net.fetch', { host: 'api.example.com' }), fingerprint('db.query', { host: 'api.example.com' }));
});

test('canonical target shape: lowercase host, normalized url, scheme-default ports dropped', () => {
  assert.deepEqual(canonicalTarget({ host: 'API.Example.COM' }), { host: 'api.example.com' });
  assert.deepEqual(canonicalTarget({ url: 'HTTPS://API.Example.COM:443/V1//' }), { url: 'https://api.example.com/V1/' });
  assert.deepEqual(canonicalTarget({ url: 'http://api.example.com:80/x', port: 80 }), { url: 'http://api.example.com/x/' });
  assert.deepEqual(canonicalTarget({ host: 'h.example', port: 9000 }), { host: 'h.example', port: '9000' });
  assert.deepEqual(canonicalTarget({}), {});
});

test('grant patterns match the canonical form: mixed-case authority covers its targets', () => {
  const p = parseAllowlistLikePattern('https://API.Example.COM/v1');
  assert.deepEqual(p, { kind: 'UrlPrefix', value: 'https://api.example.com/v1/' });
  assert.equal(patternMatches(p, canonicalTarget({ url: 'https://api.example.com/v1/data' })), true);
  assert.equal(patternMatches(p, canonicalTarget({ url: 'https://api.example.com/v2' })), false);
  // paths keep their case: /V1 is a different prefix than /v1
  assert.equal(patternMatches(p, canonicalTarget({ url: 'https://api.example.com/V1/data' })), false);
});

test('grant pattern classes', () => {
  const exact = parseAllowlistLikePattern('api.example.com');
  assert.deepEqual(exact, { kind: 'ExactHost', value: 'api.example.com' });
  assert.equal(patternMatches(exact, { host: 'api.example.com' }), true);
  assert.equal(patternMatches(exact, { host: 'api.example.com', port: 443 }), false); // ExactHost = no port

  const suffix = parseAllowlistLikePattern('*.example.org');
  assert.deepEqual(suffix, { kind: 'HostSuffix', value: 'example.org' });
  assert.equal(patternMatches(suffix, { host: 'docs.example.org' }), true);
  assert.equal(patternMatches(suffix, { host: 'example.org' }), true);       // apex included
  assert.equal(patternMatches(suffix, { host: 'notexample.org' }), false);   // no lookalikes
  assert.equal(patternMatches(suffix, { host: 'evil.example.org', port: '8443' }), false); // port requires HostAndPort

  const hp = parseAllowlistLikePattern('api.example.com:8443');
  assert.deepEqual(hp, { kind: 'HostAndPort', value: { host: 'api.example.com', port: '8443' } });
  assert.equal(patternMatches(hp, { host: 'api.example.com', port: '8443' }), true);
  assert.equal(patternMatches(hp, { host: 'api.example.com' }), false);
});

test('mount path patterns: canonical prefix coverage with a ro ceiling', () => {
  const ro = { kind: 'PathPrefix', value: { path: '/data', ceiling: 'ro' } };
  const rw = { kind: 'PathPrefix', value: { path: '/data', ceiling: 'rw' } };
  // prefix coverage is separator-anchored: /data/x yes, /database no
  assert.equal(patternMatches(ro, { path: '/data' }), true);
  assert.equal(patternMatches(ro, { path: '/data/secrets/key' }), true);
  assert.equal(patternMatches(ro, { path: '/data/' }), true);              // trailing slash tolerated
  assert.equal(patternMatches(ro, { path: '/database' }), false);          // no lookalike prefixes
  assert.equal(patternMatches(ro, { path: '/dat' }), false);
  // root prefix covers everything
  assert.equal(patternMatches({ kind: 'PathPrefix', value: { path: '/', ceiling: 'ro' } }, { path: '/anything/deep' }), true);
  // the ceiling holds: a ro grant never upgrades to rw; absent mode reads ro
  assert.equal(patternMatches(ro, { path: '/data/x', mode: 'ro' }), true);
  assert.equal(patternMatches(ro, { path: '/data/x', mode: 'rw' }), false);
  assert.equal(patternMatches(rw, { path: '/data/x', mode: 'rw' }), true);
  assert.equal(patternMatches(rw, { path: '/data/x' }), true);
  // non-path targets never match a path pattern
  assert.equal(patternMatches(ro, { host: 'data.example' }), false);
});

test('bash: a target-less call is command-scoped (#26 bash half, option A)', () => {
  const bf = (args) => fingerprint('bash', args);
  // the identical command is the same act — replay identity holds
  assert.equal(bf({ command: 'ls /' }), bf({ command: 'ls /' }));
  // different commands are different identities: ls → rm -rf asks, always
  assert.notEqual(bf({ command: 'ls /' }), bf({ command: 'ls /b' }));
  assert.notEqual(bf({ command: 'ls /' }), bf({ command: 'rm -rf /' }), 'the read never covers the destructive act');
  // normalization stays out: whitespace is phrasing the operator was shown
  assert.notEqual(bf({ command: 'ls /' }), bf({ command: 'ls  /' }));
  assert.notEqual(bf({ command: 'ls / ' }), bf({ command: 'ls /' }));
  // an empty command contributes nothing — the payload stays tool-only, as before
  assert.equal(bf({}), bf({ command: '' }));
  assert.equal(bf({}), bf({}));
  // a target-ful call ignores the command text: the network family's
  // phrasing abstraction stands (curl -sS vs curl, same target → one identity)
  const withTarget = { url: 'https://api.example.com/v1', host: 'api.example.com' };
  assert.equal(bf({ ...withTarget, command: 'curl -sS https://api.example.com/v1' }), bf({ ...withTarget, command: 'curl https://api.example.com/v1' }));
  // and a target-ful fingerprint never collides with a command-scoped one
  assert.notEqual(bf(withTarget), bf({ command: 'curl https://api.example.com/v1' }));
});
