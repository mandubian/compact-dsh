// The pinning tests #38 names, plus the identity axes (#26): every decision
// made at the connection, every refusal NAMED, over a real socket pair — an
// origin server, a client that speaks the proxy protocol, and the mediator
// between them. No Docker needed: the invariant under test is the mediator's,
// not the platform's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createTcpServer, connect as netConnect } from 'node:net';
import {
  createEgressProxy, methodClassOfMethod, classifyConnection, splitAuthority, authorityOf,
  addressClassOf, publicUnicastOnly, GATE,
} from '../src/proxy.js';

const LOOKUP_LOG = [];

/**
 * The proxy is the only resolver in this design — any name lands on loopback.
 * Node's happy-eyeballs may ask for family 6 (answer `::1`) or `all:true`
 * (answer the array shape): a resolver that lies about what it returns is not
 * a resolver, even in a test.
 */
const testLookup = (hostname, options, callback) => {
  LOOKUP_LOG.push(hostname);
  const want6 = options?.family === 6;
  if (options?.all) {
    return callback(null, want6 ? [{ address: '::1', family: 6 }] : [{ address: '127.0.0.1', family: 4 }]);
  }
  return callback(null, want6 ? '::1' : '127.0.0.1', want6 ? 6 : 4);
};

function row(over = {}) {
  return {
    id: 'sg_t1', pattern: null, methodClass: 'read', session: 's1',
    createdAt: Date.now(), expiresAt: Date.now() + 60_000, revokedAt: null,
    maxUses: null, uses: 0, ...over,
  };
}
const hostPort = (host, port, over = {}) =>
  row({ pattern: { kind: 'HostAndPort', value: { host, port: String(port) } }, ...over });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// -- fixture: origin + echo server + one mediator bound on loopback ----------

async function fixture({ rows = () => [], lookup = testLookup, addressAllowed = () => true } = {}) {
  LOOKUP_LOG.length = 0;
  const seen = [];
  const origin = createHttpServer((req, res) => {
    seen.push({ url: req.url, method: req.method, host: req.headers.host });
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://other.test:${origin.address().port}/landed` });
      return res.end();
    }
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => res.end(`${req.method} ${req.url} body=${body}`));
  });
  await new Promise((r) => origin.listen(0, r));          // dual-stack: the proxy may dial v4 or v6
  const originPort = origin.address().port;

  const echo = createTcpServer((socket) => { socket.on('data', (d) => socket.write(d)); });
  await new Promise((r) => echo.listen(0, r));
  const echoPort = echo.address().port;

  const proxy = createEgressProxy({
    resolveGrants: () => rows({ originPort, echoPort }),
    bindAddress: '127.0.0.1',
    recheckMs: 40,
    lookup,
    addressAllowed,
    logger: null,
  });
  const address = await proxy.start();

  return {
    proxy, proxyPort: address.port, originPort, echoPort, seen,
    cleanup: () => { proxy.close(); origin.close(); echo.close(); },
  };
}

/** absolute-form request through the proxy — the client resolves NOTHING. */
function viaProxy(proxyPort, url, { method = 'GET', body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port: proxyPort, method, path: url,
      headers: { host: new URL(url).host },
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** CONNECT through the proxy — resolves as soon as the proxy answers. */
function connectVia(proxyPort, authority) {
  return new Promise((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port: proxyPort });
    let buffer = '';
    let settled = false;
    const settle = (result) => { if (!settled) { settled = true; resolve({ ...result, socket, raw: buffer }); } };
    socket.on('connect', () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    const onData = (chunk) => {
      buffer += chunk.toString('latin1');
      if (!buffer.includes('\r\n\r\n')) return;
      socket.removeListener('data', onData);
      settle({ ok: /^HTTP\/1\.1 200 /.test(buffer), status: Number(/^HTTP\/1\.1 (\d+)/.exec(buffer)?.[1] ?? 0) });
    };
    socket.on('data', onData);
    socket.on('error', () => settle({ ok: false, status: 0 }));
    socket.on('close', () => settle({ ok: false, status: 0, closed: true }));
  });
}

// -- the five pinning tests (#38) --------------------------------------------

test('1. grant covering (host, port, class) → the connection is allowed through', async (t) => {
  const f = await fixture({ rows: ({ originPort }) => [hostPort('origin.test', originPort, { id: 'sg_ok' })] });
  t.after(f.cleanup);

  const res = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/hello`);
  assert.equal(res.status, 200, res.body);
  assert.equal(res.body, 'GET /hello body=');
  assert.deepEqual(f.seen.map(s => s.url), ['/hello'], 'the origin answered through the mediator');
  assert.ok(LOOKUP_LOG.includes('origin.test'),
    'the MEDICATOR resolved the name — the client sent the hostname and resolved nothing itself');
});

test('2. no grant → refused with a named reason, and nothing reached the wire', async (t) => {
  const f = await fixture({ rows: () => [] });
  t.after(f.cleanup);

  const res = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/secrets`);
  assert.equal(res.status, 403);
  assert.ok(res.body.includes(`[${GATE}/no-grant]`), res.body);
  assert.match(res.body, /no egress grant of this session covers origin\.test/);
  assert.match(res.body, /Lawful next moves:/, 'the refusal carries its rule AND what remains lawful (R-3/I-4)');
  assert.deepEqual(f.seen, [], 'the origin never saw the request');
});

test('3. a cross-host redirect is refused at the second hop — a new host is a new grant', async (t) => {
  const f = await fixture({ rows: ({ originPort }) => [hostPort('origin.test', originPort, { id: 'sg_hop1' })] });
  t.after(f.cleanup);

  const hop1 = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/redirect`);
  assert.equal(hop1.status, 302, 'the first hop is covered and passes through untouched');

  // the CLIENT follows the redirect — through the same proxy, same session
  const hop2 = await viaProxy(f.proxyPort, `http://other.test:${f.originPort}/landed`);
  assert.equal(hop2.status, 403, 'the new host carries no grant — refused on the spot');
  assert.ok(hop2.body.includes(`[${GATE}/no-grant]`), hop2.body);
  assert.match(hop2.body, /other\.test/);
  assert.deepEqual(f.seen.filter(s => s.url === '/landed'), [], 'the landing host never saw it');
});

test('4. an expired grant refuses the connection — the TTL names itself', async (t) => {
  const f = await fixture({
    rows: ({ originPort }) => [hostPort('origin.test', originPort, { expiresAt: Date.now() - 1_000, id: 'sg_old' })],
  });
  t.after(f.cleanup);

  const res = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/late`);
  assert.equal(res.status, 403);
  assert.ok(res.body.includes(`[${GATE}/expired]`), res.body);
  assert.match(res.body, /expired at .* — a TTL is the grant/);
  assert.deepEqual(f.seen, []);
});

test('5. revocation kills the mid-flight tunnel, not just the next attempt', async (t) => {
  const live = { revokedNow: false };
  const f = await fixture({
    rows: ({ echoPort }) => [hostPort('origin.test', echoPort, {
      id: 'sg_tunnel',
      get revokedAt() { return live.revokedNow ? Date.now() : null; },
    })],
  });
  t.after(f.cleanup);

  const tunnel = await connectVia(f.proxyPort, `origin.test:${f.echoPort}`);
  assert.equal(tunnel.ok, true, tunnel.raw);
  assert.equal(f.proxy.tunnelCount(), 1);
  const closed = new Promise((r) => tunnel.socket.on('close', () => r(true)));
  tunnel.socket.write('ping-1');
  await wait(15);

  live.revokedNow = true;               // the operator revokes while bytes flow
  assert.equal(await Promise.race([closed, wait(1_500).then(() => false)]), true,
    'the reaper closes the tunnel whose grant stopped covering it');
  assert.equal(f.proxy.tunnelCount(), 0);
});

// -- the identity axes (#26) --------------------------------------------------

test('read grant: GET passes, POST is refused by name — consent identity is risk identity', async (t) => {
  const f = await fixture({ rows: ({ originPort }) => [hostPort('origin.test', originPort, { methodClass: 'read', id: 'sg_read' })] });
  t.after(f.cleanup);

  const get = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/data`);
  assert.equal(get.status, 200, 'the read is covered');

  const post = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/data`, { method: 'POST', body: 'a=b' });
  assert.equal(post.status, 403, 'the state-changing act is a different act');
  assert.ok(post.body.includes(`[${GATE}/method-class]`), post.body);
  assert.match(post.body, /not write/);
  assert.match(post.body, /#26/, 'the refusal names the principle the operator decided under');
  assert.deepEqual(f.seen.filter(s => s.method === 'POST'), [], 'no POST reached the wire');
});

test('a write grant covers the read to the same target — consent to the superset', async (t) => {
  const f = await fixture({ rows: ({ originPort }) => [hostPort('origin.test', originPort, { methodClass: 'write', id: 'sg_write' })] });
  t.after(f.cleanup);

  const post = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/data`, { method: 'POST', body: 'x=1' });
  assert.equal(post.status, 200);
  const get = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/data`);
  assert.equal(get.status, 200, 'the read is inside what was consented to');
});

test("session identity is the socket: one session's grant is invisible to another's listener", async (t) => {
  const f = await fixture({ rows: ({ originPort }) => [hostPort('origin.test', originPort, { methodClass: 'read', id: 'sg_s1' })] });
  t.after(f.cleanup);
  const sibling = createEgressProxy({ resolveGrants: () => [], bindAddress: '127.0.0.1', lookup: testLookup });
  const addr = await sibling.start();
  t.after(() => sibling.close());

  assert.equal((await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/mine`)).status, 200);
  const other = await viaProxy(addr.port, `http://origin.test:${f.originPort}/theirs`);
  assert.equal(other.status, 403, 'the sibling session holds no coverage here');
  assert.ok(other.body.includes(`[${GATE}/no-grant]`));
});

test('the opaque grant covers nothing — a classless row is named, never read-by-default', async (t) => {
  const f = await fixture({ rows: ({ originPort }) => [hostPort('origin.test', originPort, { methodClass: null, id: 'sg_classless' })] });
  t.after(f.cleanup);

  const res = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/x`);
  assert.equal(res.status, 403);
  assert.ok(res.body.includes(`[${GATE}/classless-grant]`), res.body);
  assert.match(res.body, /never read-by-default \(D-7\)/);
});

// -- vocabulary and refusal quality -------------------------------------------

test('the method vocabulary is observed, and an unknown verb is refused rather than sorted', () => {
  for (const m of ['GET', 'get', 'HEAD', 'OPTIONS', 'TRACE']) assert.equal(methodClassOfMethod(m), 'read', m);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete', 'PROPFIND']) assert.equal(methodClassOfMethod(m), 'write', m);
  assert.equal(methodClassOfMethod('BREW'), null, 'outside the vocabulary → null, never the safe bucket');
  assert.equal(methodClassOfMethod(undefined), null);
});

test('every refusal names its cause distinctly (the classifier speaks, not shrugs)', () => {
  const base = { host: 'h.test', port: '443', now: Date.now() };
  const verdicts = {
    'no-grant': classifyConnection([], { ...base, methodClass: 'read' }),
    'classless-grant': classifyConnection([hostPort('h.test', 443, { methodClass: null })], { ...base, methodClass: 'read' }),
    'expired': classifyConnection([hostPort('h.test', 443, { expiresAt: Date.now() - 5 })], { ...base, methodClass: 'read' }),
    'revoked': classifyConnection([hostPort('h.test', 443, { revokedAt: Date.now() - 5 })], { ...base, methodClass: 'read' }),
    'method-class': classifyConnection([hostPort('h.test', 443, { methodClass: 'read' })], { ...base, methodClass: 'write' }),
    'unknown-method': classifyConnection([hostPort('h.test', 443, { methodClass: 'read' })], { ...base, methodClass: null }),
  };
  for (const [rule, verdict] of Object.entries(verdicts)) {
    assert.equal(verdict.ok, false, rule);
    assert.ok(verdict.envelope.text.includes(`[${GATE}/${rule}]`), `${rule}: ${verdict.envelope.text}`);
    assert.ok(verdict.envelope.lawfulNextMoves.length > 0, `${rule} carries lawful next moves`);
  }
});

test('authority parsing: proxy absolute-form, origin-form + Host, and IPv6 literals', () => {
  assert.deepEqual(splitAuthority('example.com', '443'), ['example.com', '443']);
  assert.deepEqual(splitAuthority('example.com:8443', '443'), ['example.com', '8443']);
  assert.deepEqual(splitAuthority('[::1]:9000', '443'), ['::1', '9000']);
  assert.deepEqual(splitAuthority('[::1]', '443'), ['::1', '443']);
  assert.deepEqual(splitAuthority('notaport:abc', '443'), ['notaport:abc', '443']);
  const secure = authorityOf({ url: 'https://api.example.com:8443/v1?q=1', headers: {} });
  assert.deepEqual({ host: secure.host, port: secure.port, secure: secure.secure },
    { host: 'api.example.com', port: '8443', secure: true });
  const plain = authorityOf({ url: '/path', headers: { host: 'web.example' } });
  assert.deepEqual({ host: plain.host, port: plain.port }, { host: 'web.example', port: '80' });
  assert.equal(authorityOf({ url: '/x', headers: {} }), null, 'no authority → refused, not guessed');
});

test('a CONNECT without a grant is refused before any dial (tunnels are connections too)', async (t) => {
  const f = await fixture({ rows: () => [] });
  t.after(f.cleanup);

  const res = await connectVia(f.proxyPort, `origin.test:${f.echoPort}`);
  assert.equal(res.ok, false, res.raw);
  assert.equal(res.status, 403);
  assert.ok(res.raw.includes(`[${GATE}/no-grant]`), res.raw);
  res.socket.destroy();
});

test('a granted CONNECT tunnels — and the tunnel is tracked against its grant', async (t) => {
  const f = await fixture({ rows: ({ echoPort }) => [hostPort('origin.test', echoPort, { id: 'sg_tls' })] });
  t.after(f.cleanup);

  const res = await connectVia(f.proxyPort, `origin.test:${f.echoPort}`);
  assert.equal(res.ok, true, res.raw);
  assert.equal(f.proxy.tunnelCount(), 1);
  res.socket.write('through');
  await new Promise((r) => res.socket.once('data', (d) => { assert.equal(d.toString(), 'through'); r(); }));
  res.socket.destroy();
  await wait(30);
  assert.equal(f.proxy.tunnelCount(), 0, 'the tunnel is forgotten when it closes');
});

// -- resolve-then-pin (#55): the grant covered the name; the dial is pinned --

/** A resolver that answers whatever the attacker's rebinding record says. */
const rebindingLookup = (answer) => (hostname, options, callback) => {
  LOOKUP_LOG.push(hostname);
  const list = Array.isArray(answer) ? answer : [answer];
  if (options?.all) {
    return callback(null, list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  }
  return callback(null, list[0], list[0].includes(':') ? 6 : 4);
};

test('55-a: a granted name resolving into link-local space is refused by name — never dialed (#55)', async (t) => {
  const f = await fixture({
    rows: ({ originPort }) => [hostPort('origin.test', originPort, { id: 'sg_rebind' })],
    lookup: rebindingLookup('169.254.169.254'),   // the metadata answer
    addressAllowed: publicUnicastOnly,            // the REAL default policy
  });
  t.after(f.cleanup);

  const res = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/exfil`);
  assert.equal(res.status, 403);
  assert.ok(res.body.includes(`[${GATE}/forbidden-address]`), res.body);
  assert.match(res.body, /169\.254\.169\.254 \[link-local\]/);
  assert.match(res.body, /the grant covered the name/);
  assert.deepEqual(f.seen, [], 'nothing was dialed');
});

test('55-b: the same rebinding answer refuses the CONNECT — the tunnel never opens (#55)', async (t) => {
  const f = await fixture({
    rows: ({ echoPort }) => [hostPort('origin.test', echoPort, { id: 'sg_rebind_tls' })],
    lookup: rebindingLookup('fd00::1'),           // ULA — private v6 space
    addressAllowed: publicUnicastOnly,
  });
  t.after(f.cleanup);

  const res = await connectVia(f.proxyPort, `origin.test:${f.echoPort}`);
  assert.equal(res.status, 403, res.raw);
  assert.ok(res.raw.includes(`[${GATE}/forbidden-address]`), res.raw);
  assert.match(res.raw, /fd00::1 \[ula\]/);
  res.socket.destroy();
});

test('55-c: among several answers the mediator dials the first the policy allows (#55)', async (t) => {
  const f = await fixture({
    rows: ({ originPort }) => [hostPort('origin.test', originPort, { id: 'sg_multi' })],
    lookup: rebindingLookup(['169.254.169.254', '127.0.0.1']),
    // the origin really listens on loopback, so this test's policy admits
    // loopback but still refuses link-local — the point is the ORDER: the
    // forbidden answer is skipped, the allowed one is dialed
    addressAllowed: (_addr, cls) => cls === 'public' || cls === 'loopback',
  });
  t.after(f.cleanup);

  const res = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/pinned`);
  assert.equal(res.status, 200);
  assert.deepEqual(f.seen.map((s) => s.url), ['/pinned'], 'an allowed address was dialed');
});

test('55-d: a name that does not resolve is an upstream fact, named as one (#55)', async (t) => {
  const f = await fixture({
    rows: ({ originPort }) => [hostPort('origin.test', originPort, { id: 'sg_nxdomain' })],
    lookup: (hostname, options, callback) => callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
    addressAllowed: publicUnicastOnly,
  });
  t.after(f.cleanup);

  const res = await viaProxy(f.proxyPort, `http://origin.test:${f.originPort}/x`);
  assert.equal(res.status, 502);
  assert.ok(res.body.includes(`[${GATE}/upstream]`), res.body);
  assert.match(res.body, /could not resolve origin\.test/);
});

test('the address vocabulary: every space the policy can refuse has a name (#55)', () => {
  // IPv4
  assert.equal(addressClassOf('8.8.8.8'), 'public');
  assert.equal(addressClassOf('127.0.0.1'), 'loopback');
  assert.equal(addressClassOf('0.0.0.0'), 'unspecified');
  assert.equal(addressClassOf('10.1.2.3'), 'private');
  assert.equal(addressClassOf('172.16.0.1'), 'private');
  assert.equal(addressClassOf('172.31.255.1'), 'private');
  assert.equal(addressClassOf('172.32.0.1'), 'public', 'just outside 172.16/12');
  assert.equal(addressClassOf('192.168.1.1'), 'private');
  assert.equal(addressClassOf('100.64.0.1'), 'private', 'CGNAT');
  assert.equal(addressClassOf('169.254.169.254'), 'link-local', 'the metadata address');
  assert.equal(addressClassOf('198.18.0.1'), 'private', 'benchmarking');
  assert.equal(addressClassOf('192.0.2.9'), 'documentation');
  assert.equal(addressClassOf('198.51.100.7'), 'documentation');
  assert.equal(addressClassOf('203.0.113.5'), 'documentation');
  assert.equal(addressClassOf('224.0.0.1'), 'multicast');
  assert.equal(addressClassOf('240.0.0.1'), 'reserved');
  assert.equal(addressClassOf('255.255.255.255'), 'reserved');
  // IPv6
  assert.equal(addressClassOf('::1'), 'loopback');
  assert.equal(addressClassOf('::'), 'unspecified');
  assert.equal(addressClassOf('fe80::1'), 'link-local');
  assert.equal(addressClassOf('fd00::1'), 'ula');
  assert.equal(addressClassOf('ff02::1'), 'multicast');
  assert.equal(addressClassOf('2001:db8::1'), 'documentation');
  assert.equal(addressClassOf('2606:4700::1111'), 'public');
  assert.equal(addressClassOf('::ffff:127.0.0.1'), 'loopback', 'mapped v4 carries v4 class');
  assert.equal(addressClassOf('::ffff:8.8.8.8'), 'public');
  assert.equal(addressClassOf('64:ff9b::a00:1'), 'private', 'NAT64-embedded 10.0.0.1');
  assert.equal(addressClassOf('not-an-ip'), 'invalid');
});
