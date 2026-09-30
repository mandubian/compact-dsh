#!/usr/bin/env node
// The evidence behind tweet-demo-2 — an end-to-end run of REAL compact-dsh
// code, over real sockets, with real curl. render.mjs draws only what this
// returns, and this THROWS if any claim a card makes does not hold.
//
// Real: the approval plugin (egress:'proxy') and the remote-access plugin on a
// Cordis-shaped ctx — the analyzer finds the curl's target, methodClassOf
// classes it, the gate ASKS, the recorded answerer materializes the egress
// grant on allow-once — the GrantStore, networkGrantsForSession (the exact
// resolveGrants of packages/egress-proxy/src/index.js), createEgressProxy with
// its DEFAULT revocation re-check (the plugin passes none), revokeSessionGrant,
// and curl speaking the proxy protocol (-x, and -p for a CONNECT tunnel —
// what every https:// request is).
//
// Harness, declared: no model, no Docker — curl runs on the host pointed at
// the mediator, as the container would be via HTTP(S)_PROXY; the origin is a
// local server, so the lookup answers 127.0.0.1 for every name and the dial
// policy admits loopback (the default refuses it, #55). The same harness as
// packages/egress-proxy/test/proxy.test.js.
//
//   node docs/tweet-demo-2/capture.mjs     # prints every check
//
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { approvalPlugin, networkGrantsForSession } from '../../packages/approval/src/index.js';
import { apply as remoteAccessApply } from '../../packages/remote-access/src/index.js';
import { createEgressProxy } from '../../packages/egress-proxy/src/proxy.js';

const ORIGIN_PORT = 18080;
const HOST = 'api.example.com';
const OTHER = 'other.example.com';
const STREAM_CHUNKS = 40;
const CHUNK_MS = 100;
const REVOKE_AFTER_MS = 1000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function capture({ log = () => {} } = {}) {
  const checks = [];
  const check = (name, pass, detail, { claim = true } = {}) => {
    checks.push({ name, pass, detail, claim });
    log(`${pass ? 'PASS' : claim ? 'FAIL' : 'NOTE'}  ${name}\n      ${String(detail).split('\n').join('\n      ')}`);
  };

  // -- the composition: approval + remote-access on a Cordis-shaped ctx -----
  const listeners = {};
  const services = {};
  const ctx = {
    on(ev, fn, opts) { (listeners[ev] ??= []); opts?.prepend ? listeners[ev].unshift(fn) : listeners[ev].push(fn); },
    emit() {},
    provide(name, svc) { services[name] = svc; },
    inject(deps, fn) { if (deps.every((d) => services[d])) fn({ ...services, on: ctx.on, provide: ctx.provide }); },
  };
  const waterfall = (ev, arg, final) => {
    const ls = listeners[ev] ?? [];
    const run = (i) => (i < ls.length ? ls[i](arg, () => run(i + 1)) : final());
    return run(0);
  };
  const approval = approvalPlugin({ egress: 'proxy' })(ctx, {});
  remoteAccessApply(ctx, {});
  ctx.on('approval/request', async () => 'allowed-once');   // the operator, downstream of the recorded answerer

  // -- 1. one approved curl → one grant, through the real path --------------
  const agent = { id: 'sess-demo', session: { id: 'sess-demo', header: {} } };
  const grantCommand = `curl http://${HOST}:${ORIGIN_PORT}/repos`;
  const decision = await waterfall('tools/pre-execute',
    { name: 'bash', arguments: { command: grantCommand }, agent, callId: 'c1' }, async () => null);
  check('the curl is gated: the runtime ASKS', decision?.kind === 'ask', decision?.reason?.slice(0, 160) ?? JSON.stringify(decision));
  const outcome = await waterfall('approval/request',
    { toolName: 'bash', agent, callId: 'c1', reason: decision?.reason }, async () => 'unavailable');
  const grant = approval.store.sessionGrants[0];
  check('allow-once materializes one classed egress grant',
    outcome === 'allowed-once' && approval.store.sessionGrants.length === 1 && grant?.methodClass === 'read',
    JSON.stringify({ pattern: grant?.pattern, methodClass: grant?.methodClass, session: grant?.session }));

  // -- the origin + the REAL mediator reading the REAL store ----------------
  const seen = [];
  const origin = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/redirect') { res.writeHead(302, { location: `http://${OTHER}:${ORIGIN_PORT}/landed` }); return res.end(); }
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      let n = 0;
      const t = setInterval(() => { res.write(`chunk ${++n}\n`); if (n >= STREAM_CHUNKS) { clearInterval(t); res.end('done\n'); } }, CHUNK_MS);
      res.on('close', () => clearInterval(t));
      return;
    }
    req.resume();
    req.on('end', () => res.end(`origin saw ${req.method} ${req.url}\n`));
  });
  await new Promise((r) => origin.listen(ORIGIN_PORT, '127.0.0.1', r));
  const proxy = createEgressProxy({
    resolveGrants: () => networkGrantsForSession(approval.store, grant.session),
    lookup: (h, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)),
    addressAllowed: () => true,
    // recheckMs: NOT passed — the plugin passes none, so this is the default
  });
  const { port: proxyPort } = await proxy.start();

  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY', 'all_proxy', 'ALL_PROXY']) delete env[k];
  const run = (args, { max = 10 } = {}) => new Promise((resolve) => {
    const c = spawn('curl', ['-s', '--max-time', String(max), '-x', `http://127.0.0.1:${proxyPort}`, '-w', '\n%{http_code}', ...args], { env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => {
      const lines = out.trimEnd().split('\n');
      const status = lines.pop();
      resolve({ exit: code, status, body: lines.join('\n') });
    });
  });
  const rule = (body) => /^\[EG\/([a-z-]+)\]/m.exec(body)?.[1] ?? null;
  const beats = [];
  const beat = async ({ method = 'GET', display, args, expect }) => {
    const before = seen.length;
    const r = await run(args);
    const reached = seen.slice(before);
    const got = rule(r.body) ?? (r.status === '200' ? 'allowed' : `http-${r.status}`);
    const b = { method, display, status: r.status, rule: got, reachedOrigin: reached, envelope: rule(r.body) ? r.body : null };
    beats.push(b);
    check(`${method} ${display} → ${expect}`, got === expect,
      `http ${r.status}; origin saw: ${reached.length ? reached.join(', ') : 'nothing'}${b.envelope ? `\n${b.envelope.split('\n')[0]}` : ''}`);
    return b;
  };

  try {
    // -- 2. the beats a card may claim ---------------------------------------
    const url = `http://${HOST}:${ORIGIN_PORT}`;
    await beat({ display: `${url}/repos`, args: [`${url}/repos`], expect: 'allowed' });
    const post = await beat({ method: 'POST', display: `${url}/repos`, args: ['-X', 'POST', '-d', '{"x":1}', `${url}/repos`], expect: 'method-class' });
    if (post.reachedOrigin.length) throw new Error('the refused POST reached the origin — card 1 would lie');
    await beat({ display: `http://${OTHER}:${ORIGIN_PORT}/`, args: [`http://${OTHER}:${ORIGIN_PORT}/`], expect: 'no-grant' });
    await beat({ display: `${url}/redirect → ${OTHER}`, args: ['-L', `${url}/redirect`], expect: 'no-grant' });

    // -- 3. the declared residual: inside a tunnel the class is not observed --
    {
      const before = seen.length;
      const r = await run(['-p', '-X', 'POST', '-d', '{"x":1}', `${url}/repos`]);
      const reached = seen.slice(before);
      check('RESIDUAL (declared): POST inside a CONNECT tunnel under a read grant is admitted',
        reached.includes('POST /repos'), `http ${r.status}; origin saw: ${reached.join(', ')}`, { claim: false });
    }

    // -- 4. revocation while a download is open ------------------------------
    const streamThenRevoke = async ({ tunnel }) => {
      const args = ['-s', '-N', '--max-time', '15', '-x', `http://127.0.0.1:${proxyPort}`, ...(tunnel ? ['-p'] : []), `${url}/stream`];
      const child = spawn('curl', args, { env });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      const closed = new Promise((res) => child.on('close', res));
      await wait(REVOKE_AFTER_MS);
      const revokedAt = Date.now();
      const chunksAtRevoke = (out.match(/chunk \d+/g) ?? []).length;
      approval.store.revokeSessionGrant(grant.id, revokedAt);
      const exit = await closed;
      const closedAfterMs = Date.now() - revokedAt;
      const chunks = (out.match(/chunk \d+/g) ?? []).length;
      approval.store.sessionGrants.find((g) => g.id === grant.id).revokedAt = null;   // harness: re-arm for the next run
      return { exit, chunks, chunksAtRevoke, completed: /done/.test(out), closedAfterMs };
    };

    const tunnel = await streamThenRevoke({ tunnel: true });
    check('revoked mid-download over a tunnel → the open connection is closed',
      !tunnel.completed && tunnel.chunks < STREAM_CHUNKS,
      `curl exit ${tunnel.exit}; ${tunnel.chunks}/${STREAM_CHUNKS} chunks (${tunnel.chunksAtRevoke} at revoke); closed ${tunnel.closedAfterMs} ms after revoke`);

    const plain = await streamThenRevoke({ tunnel: false });
    check('plain HTTP response already in flight when revoked',
      true, `curl exit ${plain.exit}; ${plain.chunks}/${STREAM_CHUNKS} chunks; ${plain.completed ? 'COMPLETED — not cut (only tunnels are tracked)' : `cut ${plain.closedAfterMs} ms after revoke`}`,
      { claim: false });

    approval.store.revokeSessionGrant(grant.id, Date.now());
    const after = await beat({ display: `${url}/repos  · after revoke`, args: [`${url}/repos`], expect: 'revoked' });

    const failed = checks.filter((c) => c.claim && !c.pass);
    if (failed.length) throw new Error(`card claims that did not hold: ${failed.map((c) => c.name).join('; ')}`);

    return {
      grantCommand, grant, beats, tunnel, plain, afterEnvelope: after.envelope,
      postEnvelope: post.envelope, recheckMs: 1000, chunkTotal: STREAM_CHUNKS, checks,
    };
  } finally {
    proxy.close();
    origin.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await capture({ log: console.log });
  const claims = r.checks.filter((c) => c.claim);
  console.log(`\n${claims.filter((c) => c.pass).length}/${claims.length} card claims hold; ${r.checks.length - claims.length} declared fact(s) recorded`);
}
