// The plugin's shape: the boot-time pool (ports known synchronously at
// confine time), session identity as the socket, the explicit ceiling, and
// the two refusals that keep the posture honest — no grant store means no
// mediator, and an unbindable gateway means this platform cannot carry the
// posture (#38's platform cell, refused at boot rather than at first use).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { request as httpRequest } from 'node:http';
import { GrantStore } from 'compact-dsh-approval';
import { apply, name, ensureEgressNetwork } from '../src/index.js';

const tick = () => new Promise((r) => setImmediate(r));

const inspectRun = (gateway = '127.0.0.1') => async (args) => {
  if (args[0] === 'network' && args[1] === 'inspect') return `sha256:net|bridge|true|${gateway}`;
  throw new Error(`unexpected docker call: ${args.join(' ')}`);
};

async function boot({ poolSize = 3, gateway = '127.0.0.1', store = new GrantStore() } = {}) {
  const ctx = new Context();
  if (store) ctx.provide('compact-approval', { store });
  await tick();
  const service = await apply(ctx, { network: 'compact-egress-test', run: inspectRun(gateway), poolSize, recheckMs: 40 });
  await tick();
  return { ctx, service, store };
}

const PROXY_URL = /^http:\/\/127\.0\.0\.1:\d+$/;

test('envFor hands out one stable endpoint per session — synchronously, from the boot pool', async (t) => {
  const { service } = await boot({ poolSize: 3 });
  t.after(() => service.closeAll());

  const env1 = service.envFor('session-a');
  assert.match(env1.HTTP_PROXY, PROXY_URL);
  assert.equal(env1.HTTP_PROXY, env1.http_proxy, 'both cases, because clients read either');
  assert.equal(env1.HTTPS_PROXY, env1.HTTP_PROXY);
  assert.match(env1.NO_PROXY, /localhost/);

  assert.equal(service.envFor('session-a').HTTP_PROXY, env1.HTTP_PROXY, 'stable for the session');
  const env2 = service.envFor('session-b');
  assert.notEqual(env2.HTTP_PROXY, env1.HTTP_PROXY,
    'a DIFFERENT socket per session — session identity is the socket, so no credential is replayable');
  assert.equal(service.envFor(null), null, 'no session → no endpoint');
  assert.deepEqual(
    service.pool().endpoints.map(e => e.session).sort(),
    ['session-a', 'session-b'],
    'the operator can enumerate what the pool handed out');
  assert.equal(service.pool().size, 3);
  assert.equal(service.pool().assigned, 2);
});

test('pool exhaustion refuses by name instead of sharing a socket across sessions', async (t) => {
  const { service } = await boot({ poolSize: 2 });
  t.after(() => service.closeAll());
  service.envFor('session-a');
  service.envFor('session-b');
  assert.throws(
    () => service.envFor('session-c'),
    /all 2 mediator listeners are assigned — refusing this session's confinement rather than share one listener/);
  // and a released slot is reusable — the listener stays bound
  assert.equal(service.release('session-a'), true);
  assert.equal(service.release('session-never-held'), false);
  assert.match(service.envFor('session-c').HTTP_PROXY, PROXY_URL);
});

test('a bound listener answers (403 without grants), and closeAll leaves nothing listening', async (t) => {
  const { service } = await boot({ poolSize: 1 });
  t.after(() => service.closeAll());
  const url = new URL(service.envFor('session-a').HTTP_PROXY);

  const status = await new Promise((resolve, reject) => {
    const req = httpRequest({
      host: url.hostname, port: url.port, method: 'GET',
      path: 'http://nowhere.example/x', headers: { host: 'nowhere.example' },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403, 'the listener is live and refuses without grants — never an open pipe');

  service.closeAll();
  // close() is asynchronous: poll until the port actually stops answering,
  // and accept only the error that means NOTHING listens any more
  let last = null;
  for (let i = 0; i < 100 && last?.code !== 'ECONNREFUSED'; i++) {
    await new Promise((r) => setTimeout(r, 10));
    try {
      await new Promise((resolve, reject) => {
        const req = httpRequest({ host: url.hostname, port: url.port, method: 'GET', path: '/' }, () => resolve());
        req.on('error', reject);
        req.end();
      });
      last = null;
    } catch (error) { last = error; }
  }
  assert.equal(last?.code, 'ECONNREFUSED',
    `disposal closes the pool completely (last: ${last?.code ?? 'still listening'})`);
});

test('no grant store → no mediator: composition coupling refuses, loudly (D-8)', async () => {
  const ctx = new Context();
  await tick();
  await assert.rejects(
    () => apply(ctx, { network: 'compact-egress-test', run: inspectRun() }),
    /the approval grant store \(compact-approval\) is the mediator's only authority/);
});

test('the platform cell: a gateway this host does not own refuses AT BOOT, named (#38 record)', async () => {
  const ctx = new Context();
  ctx.provide('compact-approval', { store: new GrantStore() });
  await tick();
  await assert.rejects(
    () => apply(ctx, { network: 'compact-egress-test', run: inspectRun('203.0.113.7'), poolSize: 1 }),
    (error) => {
      assert.match(error.message, /cannot bind the mediator to 203\.0\.113\.7/);
      assert.match(error.message, /this host does not own that address/);
      assert.match(error.message, /platform cell/);
      assert.match(error.message, /Refusing to start rather than booting an egress posture with no mediator/);
      return true;
    });
});

test('the network refusal reaches the plugin untouched (provisioning is one authority)', async () => {
  await assert.rejects(
    () => ensureEgressNetwork({ name: 'none', run: inspectRun() }),
    /must be a docker network NAME/);
  assert.equal(name, 'compact-egress-proxy');
});

test('NOT declared: the service resolves (F-5) while the capability stays absent — no docker, no socket, no path', async () => {
  let dockerCalls = 0;
  const ctx = new Context();
  ctx.provide('compact-approval', { store: new GrantStore() });
  await tick();
  const service = await apply(ctx, { network: undefined, run: async (args) => { dockerCalls++; return args.join(' '); } });
  await tick();

  assert.equal(service.declared, false, 'the service says which posture it is in');
  assert.equal(service.network, null);
  assert.deepEqual(service.pool(), { size: 0, assigned: 0, endpoints: [] }, 'nothing bound');
  assert.equal(dockerCalls, 0, 'an undeclared posture never touches docker');
  assert.equal(service.endpointFor('anyone'), null);
  assert.equal(service.release('anyone'), false);
  assert.throws(() => service.envFor('session-a'),
    /mediated egress posture is NOT declared.*COMPACT_EGRESS=proxy/);
  assert.equal(ctx.get(name)?.declared, false, 'the enforced register row resolves — F-5 is satisfied by a service that binds nothing');
  service.closeAll();
});
