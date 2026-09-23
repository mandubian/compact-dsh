// compact-dsh-egress-proxy — the network mediator (#38 phase 3).
//
// Spec: docs/decision-network-egress-proxy.md (the phase-2 decision record).
// The invariant this package exists for: THE CONFINED CONTAINER NEVER CARRIES
// A ROUTE TO THE INTERNET — a mediator outside the boundary does, and it
// consults the live grant table at every connection.
//
// Shape:
//   - ONE LISTENER PER SESSION, bound at BOOT into a fixed pool on the
//     mediation network's gateway. Boot-time binding is not decoration: a
//     Node server's port is only known after its listening tick, and the
//     confine seam that needs the proxy URL is synchronous — so the pool
//     makes `envFor` a lookup, and the platform cell (can this host own that
//     gateway address?) is proved at boot, where a failure refuses the boot
//     instead of failing the first command (D-7).
//   - SESSION IDENTITY IS THE SOCKET. A slot is assigned to a session once;
//     its grant closure reads only that session's rows, and the container
//     receives only its own listener's URL — no credential to replay, an
//     explicit pool ceiling whose exhaustion refuses confinement by name
//     rather than sharing one listener across sessions. Declared residual
//     (I-8): all listeners share the mediation network's gateway address, so
//     a sibling container on that network can reach another session's
//     listener by port-scanning it — per-session mediation networks are the
//     closure a deployment needs; never pretended unreachable.
//   - ABSENT UNTIL DECLARED. The plugin mounts only when the composition
//     declares the mediated posture (blessed passes `network`), so the
//     default boot still carries NO network capability at all (CF-1).
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { networkGrantsForSession } from 'compact-dsh-approval';
import { createEgressProxy } from './proxy.js';
import { ensureEgressNetwork } from './network.js';

export { createEgressProxy, ensureEgressNetwork };
export { methodClassOfMethod, classifyConnection, authorityOf, splitAuthority, addressClassOf, publicUnicastOnly, GATE } from './proxy.js';

export const name = 'compact-egress-proxy';
export const inject = ['compact-approval'];

const DEFAULT_POOL = 16;
const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1';

export async function apply(ctx, config = {}) {
  const store = ctx.get?.('compact-approval')?.store;
  if (!store) {
    throw new Error('compact-dsh-egress-proxy: the approval grant store (compact-approval) is the mediator\'s only ' +
      'authority — a composition without it cannot enforce grants, only pretend to (composition coupling, D-8)');
  }

  const declared = typeof config.network === 'string' && config.network.trim() !== '' && config.network !== 'none';

  // NOT DECLARED: the register's enforced row resolves (F-5 — a service that
  // exists but binds nothing), while the CAPABILITY is absent: no docker
  // call, no listener, no path. `envFor` refuses by name if anything ever
  // asks, so an undeclared posture can never hand a container a route or a
  // URL — absence that says what it is instead of answering with a default.
  if (!declared) {
    const inert = {
      name,
      declared: false,
      network: null,
      pool: () => ({ size: 0, assigned: 0, endpoints: [] }),
      envFor: () => {
        throw new Error('compact-dsh-egress-proxy: the mediated egress posture is NOT declared (set COMPACT_EGRESS=proxy ' +
          'to adopt it) — this runtime carries no egress capability and says so rather than answer with a path nobody enforces');
      },
      endpointFor: () => null,
      release: () => false,
      closeAll: () => {},
    };
    ctx.provide(name, inert);
    ctx.effect(() => () => {});
    return inert;
  }

  // The platform cell, proved at boot: inspect-or-create the internal
  // network, then BIND the pool on its gateway. Every failure path refuses
  // the boot with its reason — never a silent downgrade to `none` (the
  // posture was declared; a posture that cannot deliver must say so) and
  // never a downgrade to `open`.
  const net = await ensureEgressNetwork({ name: config.network, run: config.run });
  const poolSize = Number.isInteger(config.poolSize) && config.poolSize > 0 ? config.poolSize : DEFAULT_POOL;

  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    const slot = { sessionId: null, url: null, proxy: null };
    slot.proxy = createEgressProxy({
      bindAddress: net.gateway,
      port: 0,
      recheckMs: config.recheckMs,
      lookup: config.lookup,
      addressAllowed: config.addressAllowed,
      now: config.now,
      logger: ctx.logger,
      resolveGrants: () => (slot.sessionId ? networkGrantsForSession(store, slot.sessionId) : []),
    });
    const address = await slot.proxy.start();
    slot.url = `http://${net.gateway}:${address.port}`;
    pool.push(slot);
  }
  ctx.logger?.info?.(
    `compact-dsh-egress-proxy: mediator bound — ${poolSize} per-session listener(s) on ${net.gateway} ` +
    `(${net.driver} network "${net.name}", internal); egress is delivered per connection under live grants (#38)`);

  const noProxy = typeof config.noProxy === 'string' && config.noProxy ? config.noProxy : DEFAULT_NO_PROXY;

  const slotFor = (sessionId) => {
    const sid = sessionId != null ? String(sessionId) : null;
    if (!sid) return null;
    return pool.find(s => s.sessionId === sid) ?? null;
  };

  const service = {
    name,
    declared: true,
    network: net,
    /** Pool facts for the operator's surfaces: size, assigned, endpoints. */
    pool: () => ({
      size: poolSize,
      assigned: pool.filter(s => s.sessionId != null).length,
      endpoints: pool.filter(s => s.sessionId != null).map(s => ({ session: s.sessionId, url: s.url })),
    }),
    /**
     * The proxy environment for THIS session's confinement — synchronous by
     * construction (boot-time pool). An unassigned slot is claimed on first
     * use and keeps it for the boot; pool exhaustion THROWS so the provider
     * refuses the confinement with this reason instead of sharing a socket
     * across sessions (session identity IS the socket).
     */
    envFor(sessionId) {
      const sid = sessionId != null ? String(sessionId) : null;
      if (!sid) return null;
      let slot = slotFor(sid);
      if (!slot) {
        slot = pool.find(s => s.sessionId === null);
        if (!slot) {
          throw new Error(
            `compact-dsh-egress-proxy: all ${poolSize} mediator listeners are assigned — refusing this session's ` +
            `confinement rather than share one listener across sessions (session identity IS the socket); raise the pool size`);
        }
        slot.sessionId = sid;
      }
      return {
        HTTP_PROXY: slot.url, HTTPS_PROXY: slot.url,
        http_proxy: slot.url, https_proxy: slot.url,
        NO_PROXY: noProxy, no_proxy: noProxy,
      };
    },
    /** This session's endpoint (diagnostics/tests); null when unassigned. */
    endpointFor: (sessionId) => slotFor(sessionId)?.url ?? null,
    /** Release a session's slot (the listener stays bound and reusable). */
    release(sessionId) {
      const slot = slotFor(sessionId);
      if (slot) slot.sessionId = null;
      return slot != null;
    },
    closeAll() {
      for (const slot of pool) { slot.proxy.close(); slot.sessionId = null; }
    },
  };

  ctx.provide(name, service);
  ctx.effect(() => () => service.closeAll());
  return service;
}

export default { name, inject, apply };
