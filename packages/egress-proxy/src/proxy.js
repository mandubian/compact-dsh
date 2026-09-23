// The mediator itself (#38 phase 3; spec: docs/decision-network-egress-proxy.md,
// including "Why a mediator of our own" — the build-vs-reuse adjudication for
// not standing Squid/Envoy/mitmproxy here).
//
// One instance serves ONE session's container: the listener's socket IS the
// session identity — its grant closure reads only that session's rows, and
// nothing in the container holds a credential to replay. (Declared residual,
// I-8: the pool's listeners share the mediation network's gateway address, so
// a sibling container on that network can reach another session's listener by
// port-scanning it — per-session networks close it; see index.js.) Every
// CONNECTION re-reads the grant rows — coverage, liveness, class — so a TTL
// that lapses or a revocation that lands closes what is already open (live
// tunnels are tracked against the grant that opened them and destroyed when
// it stops covering).
//
// What it deliberately does NOT do:
//   - intercept TLS. HTTPS is filtered on the CONNECT authority; the tunnel
//     is opaque by decision (no planted CA — that would cross a trust
//     boundary). Consequently a tunnel's CLASS cannot be observed, and a
//     tunnel is admitted under any live, classed grant covering the host —
//     that opacity is the record's declared residual, not a silent widening.
//   - follow redirects. The client's next request or CONNECT re-enters this
//     check, so a cross-host hop is refused on the spot: a new host is a new
//     grant.
//   - resolve names for the container. The hostname arrives in the request
//     line / CONNECT authority and THIS process resolves it — the container
//     never runs a resolver against the mediation network. And the dial is
//     PINNED to a validated address (#55): the grant was checked against the
//     name, but the wire dials what the name RESOLVES to, so every answer
//     the resolver gives is classified first — only public unicast is
//     dialable by default; a rebinding answer that would carry the tunnel
//     into loopback, link-local or host-internal space is refused with its
//     address classes named (`forbidden-address`), never dialed.
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect as dial, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import { buildEnvelope } from 'compact-envelope';
import { patternMatches } from 'compact-dsh-approval';

/** The acting gate every refusal from here is stamped with (R-3/I-4). */
export const GATE = 'EG';

const LAWFUL_MOVES = [
  'ask your Principal for a scoped egress grant covering this host, port and method class',
  'use an approved alternative',
  'escalate to your Principal',
];

/**
 * HTTP method → class. OBSERVED from the request line, never guessed: a verb
 * outside the vocabulary gets null and is refused (D-7) rather than sorted
 * into the safer bucket.
 */
export function methodClassOfMethod(method) {
  const m = String(method ?? '').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(m)) return 'read';
  if (['POST', 'PUT', 'PATCH', 'DELETE', 'COPY', 'MOVE', 'PROPFIND', 'MKCOL', 'LOCK', 'UNLOCK', 'SEARCH'].includes(m)) return 'write';
  return null;
}

const isLive = (g, now) => !g.revokedAt && (!g.expiresAt || g.expiresAt > now);

/**
 * Does this grant's PATTERN reach this connection? (Liveness and class are
 * the caller's question.) Host-scoped kinds (ExactHost/HostSuffix) say
 * nothing about ports — the host is the unit the analyzer found, and
 * narrowing below the unit the operator was shown would be a grant nobody
 * made. UrlPrefix is path-scoped: it covers a plain-HTTP request whose
 * absolute URL starts with the prefix, and NEVER a tunnel, where the path is
 * unknowable (fail-closed, not guessed).
 */
function patternReaches(grant, { host, port, url, tunnel }) {
  const kind = grant.pattern?.kind;
  if (kind === 'UrlPrefix') return !tunnel && typeof url === 'string' && patternMatches(grant.pattern, { url });
  if (kind === 'ExactHost' || kind === 'HostSuffix') return patternMatches(grant.pattern, { host });
  if (kind === 'HostAndPort') return patternMatches(grant.pattern, { host, port: String(port) });
  return false;
}

function refuse(res, envelope, status = 403) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'proxy-agent': 'compact-dsh-egress-proxy' });
  res.end(envelope.text);
}

function rawRefuse(socket, envelope, statusLine = 'HTTP/1.1 403 Forbidden') {
  if (socket.writable) socket.end(`${statusLine}\r\ncontent-type: text/plain; charset=utf-8\r\n\r\n${envelope.text}\n`);
  else socket.destroy();
}

/**
 * Classify one connection against this session's grant rows.
 * Rows are the store's own network-family rows for the session (live or not,
 * classed or not), so every refusal can NAME its cause instead of collapsing
 * to "not covered".
 *
 * @returns {{ok: true, grant: object} | {ok: false, envelope: object, status: number}}
 */
export function classifyConnection(rows, { host, port, methodClass = null, url = null, tunnel = false, now = Date.now() }) {
  const target = rows.filter(g => patternReaches(g, { host, port, url, tunnel }));
  if (target.length === 0) {
    return {
      ok: false, status: 403,
      envelope: buildEnvelope({
        gate: GATE, ruleId: 'no-grant',
        reason: `no egress grant of this session covers ${host}:${port}${methodClass ? ` for method class ${methodClass}` : ''} — ` +
          `the container carries no route, so the mediator refuses before a connection exists. Approval is consent; ` +
          `this is the connectivity half, and nothing here delivers it`,
        lawfulNextMoves: LAWFUL_MOVES,
      }),
    };
  }
  const classed = target.filter(g => g.methodClass != null);
  if (classed.length === 0) {
    return {
      ok: false, status: 403,
      envelope: buildEnvelope({
        gate: GATE, ruleId: 'classless-grant',
        reason: `an egress grant for ${host}:${port} exists but carries no method class — an unclassifiable grant covers ` +
          `no connection, never read-by-default (D-7)`,
        lawfulNextMoves: LAWFUL_MOVES,
      }),
    };
  }
  const live = classed.filter(g => isLive(g, now));
  if (live.length === 0) {
    const revoked = classed.find(g => g.revokedAt);
    const named = revoked
      ? { ruleId: 'revoked', phrase: 'was revoked at', at: revoked.revokedAt, tail: 'revocation kills the route, mid-flight included' }
      : { ruleId: 'expired', phrase: 'expired at', at: Math.min(...classed.map(g => g.expiresAt ?? Infinity)), tail: 'a TTL is the grant’s boundary, not a suggestion' };
    return {
      ok: false, status: 403,
      envelope: buildEnvelope({
        gate: GATE, ruleId: named.ruleId,
        reason: `the egress grant that covered ${host}:${port} ${named.phrase} ${new Date(named.at).toISOString()} — ${named.tail}`,
        lawfulNextMoves: LAWFUL_MOVES,
      }),
    };
  }
  if (tunnel) {
    // CONNECT: what rides inside is opaque by decision (no interception), so
    // the class cannot be checked here — a live, classed grant for the host
    // is what opens a tunnel, and that opacity is the declared residual.
    return { ok: true, grant: live[0] };
  }
  if (methodClass == null) {
    return {
      ok: false, status: 400,
      envelope: buildEnvelope({
        gate: GATE, ruleId: 'unknown-method',
        reason: `the HTTP method of this request is outside the mediator's class vocabulary — refused rather than guessed (D-7)`,
        lawfulNextMoves: LAWFUL_MOVES,
      }),
    };
  }
  // write ⊇ read: consenting to the state-changing act covers the read to
  // the same target; the reverse is the overclaim #26 names.
  const covering = live.filter(g => g.methodClass === 'write' || g.methodClass === methodClass);
  if (covering.length === 0) {
    return {
      ok: false, status: 403,
      envelope: buildEnvelope({
        gate: GATE, ruleId: 'method-class',
        reason: `a live egress grant covers ${host}:${port} for method class ${[...new Set(live.map(g => g.methodClass))].join(' or ')}, ` +
          `not ${methodClass} — consent identity is risk identity: approving a read does not cover the state-changing act (#26)`,
        lawfulNextMoves: LAWFUL_MOVES,
      }),
    };
  }
  return { ok: true, grant: covering.find(g => g.methodClass === methodClass) ?? covering[0] };
}

/** `host[:port]` → lowercase host + port string (default when absent). */
export function splitAuthority(authority, defaultPort) {
  const raw = String(authority ?? '');
  if (!raw) return [null, null];
  if (raw.startsWith('[')) {  // IPv6 literal
    const end = raw.indexOf(']');
    if (end < 0) return [null, null];
    const host = raw.slice(1, end).toLowerCase();
    const rest = raw.slice(end + 1);
    return [host, rest.startsWith(':') && /^\d+$/.test(rest.slice(1)) ? rest.slice(1) : String(defaultPort ?? '')];
  }
  const idx = raw.lastIndexOf(':');
  if (idx < 0) return [raw.toLowerCase(), String(defaultPort ?? '')];
  const port = raw.slice(idx + 1);
  if (!/^\d+$/.test(port)) return [raw.toLowerCase(), String(defaultPort ?? '')];
  return [raw.slice(0, idx).toLowerCase(), port];
}

/** absolute-form target (proxy protocol) or origin-form + Host header. */
export function authorityOf(req) {
  const raw = String(req.url ?? '');
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const port = u.port || (u.protocol === 'https:' ? '443' : '80');
      return { host: u.hostname.toLowerCase(), port, url: `${u.protocol}//${u.host}${u.pathname}${u.search}`, path: `${u.pathname}${u.search}`, secure: u.protocol === 'https:' };
    } catch { return null; }
  }
  const hostHeader = req.headers?.host;
  if (typeof hostHeader !== 'string' || !hostHeader) return null;
  const [h, p] = splitAuthority(hostHeader, '80');
  if (!h) return null;
  // the UrlPrefix question is answered against the CANONICAL form (pattern.js
  // lowercases the authority and keeps an explicit port only when non-default)
  // — never against the raw Host header, whose case a client controls
  const portPart = p === '80' ? '' : `:${p}`;
  return { host: h, port: p, url: `http://${h}${portPart}${raw}`, path: raw, secure: false };
}

// -- resolve-then-pin (#55) --------------------------------------------------
// The grant is checked against a NAME; the wire dials an ADDRESS. These are
// the seams that keep those two facts from drifting apart: classify every
// address the resolver answers with, and dial only what the policy allows.

/**
 * The class of one resolved address — the vocabulary the dial policy reads
 * (#55). Pure and string-based: no resolver, no I/O. IPv4-mapped and
 * well-known-NAT64 IPv6 answers carry their embedded IPv4's class, so a
 * mapped `127.0.0.1` is loopback, not public.
 */
export function addressClassOf(ip) {
  const raw = String(ip ?? '').trim().toLowerCase();   // isIP accepts uppercase hextets — classify the canonical form
  if (isIP(raw) === 4) return ipv4ClassOf(raw);
  if (isIP(raw) === 6) return ipv6ClassOf(raw);
  return 'invalid';
}

function ipv4ClassOf(raw) {
  const b = raw.split('.').map(Number);
  const [a, s, t] = b;
  if (a === 0) return 'unspecified';                                    // 0.0.0.0/8 — "this host"
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 172 && s >= 16 && s <= 31) || (a === 192 && s === 168)) return 'private';
  if (a === 100 && s >= 64 && s <= 127) return 'private';               // 100.64/10 — CGNAT
  if (a === 169 && s === 254) return 'link-local';                      // includes the metadata address
  if (a === 198 && s >= 18 && s <= 19) return 'private';                // 198.18/15 — benchmarking
  if (a === 192 && s === 0) return t === 0 ? 'reserved' : 'documentation'; // 192.0.0/24 vs 192.0.2/24
  if ((a === 198 && s === 51 && t === 100) || (a === 203 && s === 0 && t === 113)) return 'documentation';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'public';
}

const HEXTET = /^[0-9a-f]{1,4}$/;
const V4_OCTET = /^\d{1,3}$/;

/**
 * Expand an IPv6 literal to its 16 bytes (or null when it does not parse).
 * An embedded dotted-quad tail (`::ffff:127.0.0.1`) is folded into its two
 * hextets, as RFC 4291 allows.
 */
function ipv6Bytes(raw) {
  const halves = raw.split('::');
  if (halves.length > 2) return null;
  const piecesOf = (part) => {
    const pieces = part ? part.split(':') : [];
    if (pieces.length && pieces[pieces.length - 1].includes('.')) {
      const octets = pieces.pop().split('.');
      if (octets.length !== 4 || octets.some((o) => !V4_OCTET.test(o) || Number(o) > 255)) return null;
      const [w, x, y, z] = octets.map(Number);
      pieces.push(((w << 8) | x).toString(16), ((y << 8) | z).toString(16));
    }
    return pieces;
  };
  const head = piecesOf(halves[0]) ?? null;
  if (head === null) return null;
  const tail = halves.length === 2 ? (piecesOf(halves[1]) ?? null) : [];
  if (tail === null) return null;
  if (halves.length === 1 && head.length !== 8) return null;
  if ([...head, ...tail].some((h) => !HEXTET.test(h))) return null;
  const gap = 8 - head.length - tail.length;
  if (gap < 0) return null;
  const groups = [...head, ...Array(gap).fill('0'), ...tail].map((h) => parseInt(h, 16));
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => { bytes[i * 2] = g >> 8; bytes[i * 2 + 1] = g & 0xff; });
  return bytes;
}

function ipv6ClassOf(raw) {
  const b = ipv6Bytes(raw);
  if (!b) return 'invalid';
  const g = (i) => (b[i * 2] << 8) | b[i * 2 + 1];
  const v4 = () => `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
  if (b.every((x) => x === 0)) return 'unspecified';                     // ::/128
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return 'loopback'; // ::1/128
  if (g(0) === 0 && g(1) === 0 && g(2) === 0 && g(3) === 0 && g(4) === 0 && g(5) === 0xffff) return ipv4ClassOf(v4()); // ::ffff:0:0/96 — mapped
  if (g(0) === 0x64 && g(1) === 0xff9b) return ipv4ClassOf(v4());        // 64:ff9b::/96 — well-known NAT64
  if (g(0) >= 0xfe80 && g(0) <= 0xfebf) return 'link-local';             // fe80::/10
  if (b[0] === 0xfc || b[0] === 0xfd) return 'ula';                      // fc00::/7
  if (g(0) >= 0xff00) return 'multicast';                                // ff00::/8
  if (g(0) === 0x2001 && g(1) === 0x0db8) return 'documentation';        // 2001:db8::/32
  if (g(0) === 0) return 'reserved';                                     // ::/8 remainder
  return 'public';
}

/**
 * The default dial policy (#55): only PUBLIC unicast is dialable. The
 * mediation plane exists to deliver internet egress under grant — a name
 * that resolves into loopback, link-local (the metadata address included),
 * host-private, ULA or reserved space is a rebinding answer or a misgrant,
 * and it is refused with its classes named rather than dialed. A deployment
 * that genuinely needs mediated access INTO such space extends the policy
 * explicitly (`addressAllowed` at composition) — an exception declared at
 * the seam that owns it, never a silent default.
 */
export function publicUnicastOnly(_address, cls) {
  return cls === 'public';
}

const HOP_BY_HOP = new Set(['proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

/**
 * Create one session's mediator. Not bound until `start()` — the plugin
 * binds a boot-time pool so a confine-time lookup can hand out a port
 * synchronously (a Node server's port is only known after the listening
 * tick, and confine is a synchronous seam).
 */
export function createEgressProxy({
  resolveGrants = () => [],
  bindAddress = '127.0.0.1',
  port = 0,
  recheckMs = 1_000,
  lookup = dnsLookup,
  addressAllowed = publicUnicastOnly,
  now = () => Date.now(),
  logger = null,
} = {}) {
  const tunnels = new Map();   // upstream socket -> {host, port, grantId}
  const sockets = new Set();   // client sockets, destroyed on close
  let closed = false;

  const rowsFor = () => {
    const rows = resolveGrants();
    return Array.isArray(rows) ? rows : [];
  };
  const decide = ({ host, port: targetPort, methodClass, url, tunnel }) =>
    classifyConnection(rowsFor(), { host, port: targetPort, methodClass, url, tunnel, now: now() });

  /**
   * Resolve-then-pin (#55): resolve the NAME host-side (the container never
   * does), classify EVERY address the resolver answers with, and settle on
   * the first the policy allows. Rejection carries `code` so the refusal
   * names its cause: `upstream-dns` (the name did not resolve — an upstream
   * fact) or `forbidden-address` (it resolved somewhere the policy will not
   * dial — a policy fact, named with the classes).
   */
  const resolvePinned = (host) => new Promise((resolve, reject) => {
    lookup(host, { all: true }, (error, addresses) => {
      if (error) {
        return reject(Object.assign(new Error(`${error.code ?? error.message}`), { code: 'upstream-dns' }));
      }
      const answers = (Array.isArray(addresses) ? addresses : [{ address: addresses }])
        .map((entry) => String(entry?.address ?? entry));
      const refused = [];
      for (const address of answers) {
        const cls = addressClassOf(address);
        if (addressAllowed(address, cls)) return resolve({ address, cls });
        refused.push(`${address} [${cls}]`);
      }
      reject(Object.assign(
        new Error(`every address ${host} resolves to is outside the dial policy: ${refused.join(', ')}`),
        { code: 'forbidden-address', detail: refused.join(', ') }));
    });
  });

  /** The named refusal for a resolution the policy refused or that failed. */
  const resolveRefusal = (host, port, error) => buildEnvelope({
    gate: GATE,
    ruleId: error.code === 'forbidden-address' ? 'forbidden-address' : 'upstream',
    reason: error.code === 'forbidden-address'
      ? `${host}:${port} resolves only to addresses the mediator refuses to dial (${error.detail}) — the grant covered ` +
        `the name, and the wire will not quietly follow it into loopback, link-local or host-internal space (#55); ` +
        `consent identity is risk identity for the address too`
      : `the mediator could not resolve ${host}:${port}: ${error.message}`,
    lawfulNextMoves: LAWFUL_MOVES,
  });

  const server = createHttpServer(async (req, res) => {
    try {
      const authority = authorityOf(req);
      if (!authority) {
        return refuse(res, buildEnvelope({
          gate: GATE, ruleId: 'malformed',
          reason: 'the request names no authority (absolute-form URL or Host header required) — the mediator refuses what it cannot place',
          lawfulNextMoves: LAWFUL_MOVES,
        }), 400);
      }
      if (authority.secure) {
        return refuse(res, buildEnvelope({
          gate: GATE, ruleId: 'use-connect',
          reason: 'an https:// target must arrive as CONNECT — the mediator never speaks a plaintext tunnel into an https origin (no interception, by decision)',
          lawfulNextMoves: LAWFUL_MOVES,
        }), 400);
      }
      const methodClass = methodClassOfMethod(req.method);
      if (methodClass == null) {
        return refuse(res, buildEnvelope({
          gate: GATE, ruleId: 'unknown-method',
          reason: `HTTP method "${req.method}" is outside the mediator's class vocabulary — refused rather than guessed (D-7)`,
          lawfulNextMoves: LAWFUL_MOVES,
        }), 400);
      }
      const verdict = decide({ host: authority.host, port: authority.port, methodClass, url: authority.url, tunnel: false });
      if (!verdict.ok) return refuse(res, verdict.envelope, verdict.status);

      // the grant covered the NAME; the dial goes to the PINNED address (#55)
      let pinned;
      try {
        pinned = await resolvePinned(authority.host);
      } catch (error) {
        return refuse(res, resolveRefusal(authority.host, authority.port, error),
          error.code === 'forbidden-address' ? 403 : 502);
      }

      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase())));
      const upstream = httpRequest({
        host: pinned.address,         // the VALIDATED address — the name already rides in path/Host
        port: Number(authority.port),
        method: req.method,
        path: authority.path,
        headers,
      }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      });
      upstream.on('error', (error) => {
        const envelope = buildEnvelope({
          gate: GATE, ruleId: 'upstream',
          reason: `the mediator could not reach ${authority.host}:${authority.port}: ${error.code ?? error.message}`,
          lawfulNextMoves: LAWFUL_MOVES,
        });
        if (res.headersSent) res.destroy(); else refuse(res, envelope, 502);
      });
      req.pipe(upstream);
    } catch (error) {
      refuse(res, buildEnvelope({
        gate: GATE, ruleId: 'internal',
        reason: `the mediator failed closed: ${error.message}`,
        lawfulNextMoves: LAWFUL_MOVES,
      }), 502);
    }
  });

  // CONNECT: the HTTPS path — filter the authority, tunnel the bytes.
  server.on('connect', async (req, clientSocket, head) => {
    const [host, targetPort] = splitAuthority(req.url, '443');
    if (!host || !targetPort) {
      return rawRefuse(clientSocket, buildEnvelope({
        gate: GATE, ruleId: 'malformed',
        reason: 'CONNECT names no authority — the mediator refuses what it cannot place',
        lawfulNextMoves: LAWFUL_MOVES,
      }), 'HTTP/1.1 400 Bad Request');
    }
    const verdict = decide({ host, port: targetPort, methodClass: null, url: null, tunnel: true });
    if (!verdict.ok) return rawRefuse(clientSocket, verdict.envelope);

    // the grant covered the NAME; the tunnel goes to the PINNED address (#55)
    let pinned;
    try {
      pinned = await resolvePinned(host);
    } catch (error) {
      return rawRefuse(clientSocket, resolveRefusal(host, targetPort, error),
        error.code === 'forbidden-address' ? 'HTTP/1.1 403 Forbidden' : 'HTTP/1.1 502 Bad Gateway');
    }

    const upstream = dial({ host: pinned.address, port: Number(targetPort) }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\nproxy-agent: compact-dsh-egress-proxy\r\n\r\n');
      if (head?.length) upstream.write(head);
      tunnels.set(upstream, { host, port: targetPort, grantId: verdict.grant.id });
      const drop = () => { tunnels.delete(upstream); upstream.destroy(); clientSocket.destroy(); };
      upstream.on('close', drop);
      clientSocket.on('close', drop);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', (error) => {
      tunnels.delete(upstream);
      rawRefuse(clientSocket, buildEnvelope({
        gate: GATE, ruleId: 'upstream',
        reason: `the mediator could not reach ${host}:${targetPort}: ${error.code ?? error.message}`,
        lawfulNextMoves: LAWFUL_MOVES,
      }), 'HTTP/1.1 502 Bad Gateway');
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.on('error', (error) => logger?.error?.(`compact-dsh-egress-proxy: listener error: ${error.message}`));

  // Mid-flight enforcement: a grant that lapses or is revoked closes the
  // tunnels it opened — TTL expiry and revocation are the same mechanism,
  // checked on the same clock, for the same reason.
  const reaper = setInterval(() => {
    if (closed) return;
    const rows = rowsFor();
    const liveIds = new Set(rows.filter(g => g.methodClass != null && isLive(g, now())).map(g => g.id));
    for (const [upstream, tunnel] of [...tunnels]) {
      if (liveIds.has(tunnel.grantId)) continue;
      const row = rows.find(g => g.id === tunnel.grantId);
      logger?.warn?.(
        `compact-dsh-egress-proxy: closing a live tunnel to ${tunnel.host}:${tunnel.port} — its grant ` +
        `${row ? (row.revokedAt ? 'was revoked' : 'expired') : 'no longer exists'} (#38)`);
      upstream.destroy();   // the client socket goes down through the pipe's close handler
    }
  }, recheckMs);
  reaper.unref?.();

  return {
    server,
    address: () => server.address(),
    tunnelCount: () => tunnels.size,
    async start() {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(new Error(
          `compact-dsh-egress-proxy: cannot bind the mediator to ${bindAddress}:${port}: ${error.code ?? error.message} — ` +
          (error.code === 'EADDRNOTAVAIL'
            ? 'this host does not own that address, so the mediated posture cannot deliver here (the platform cell in ' +
              'docs/decision-network-egress-proxy.md). Refusing to start rather than booting an egress posture with no mediator (D-7)'
            : 'refusing to start rather than compose an egress posture that cannot deliver (D-7)')));
        server.once('error', onError);
        server.listen(port, bindAddress, () => {
          server.removeListener('error', onError);
          resolve();
        });
      });
      return server.address();
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(reaper);
      for (const t of [...tunnels.keys()]) t.destroy();
      tunnels.clear();
      for (const s of [...sockets]) s.destroy();
      sockets.clear();
      server.close();
    },
  };
}
