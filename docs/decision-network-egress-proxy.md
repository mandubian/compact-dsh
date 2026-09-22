# Decision record — network egress under grant: the mediated proxy (CF grant family)

**Status: ADOPTED for implementation — phase 2 of
[#38](https://github.com/mandubian/compact-dsh/issues/38).** Recorded 2026-09-22,
constitutional under A-4 (recorded before the work). Phase 1 of that issue — the
envelope's consent-vs-connectivity disclosure — already landed (PRs #45/#46);
this record decides the mechanism phase 3 builds, and nothing below is
enforcement until the phase-3 slice lands with its pinning tests and its
register entry. Grounding: [secret grants](concept-secret-grants.md) (the
template this design transposes), [approval layers](concept-approval-layers.md),
[consent identity](decision-consent-identity.md) (§1's method-class axis, folded
in here), and [#26](https://github.com/mandubian/compact-dsh/issues/26),
[#8](https://github.com/mandubian/compact-dsh/issues/8).

## Where phase 1 left it

The grant machinery for network targets already exists end to end — what it
lacks is a wire to enforce it on:

- the analyzer (`packages/remote-access`) turns a command's network target into
  a **per-host finding** (or a fail-closed opaque refusal);
- the finding rides the approval layers (`docs/concept-approval-layers.md`):
  session grants with `ExactHost`/`HostSuffix`/`HostAndPort`/`UrlPrefix`
  patterns are session-scoped, TTL-bounded, revocable, persisted;
- `networkGrantsFor` (`packages/sandbox-docker/src/provenance.js`) is already
  the ONLY source CF-2 accepts for a run-time network demand, and CF-2 already
  refuses an open posture that no live grant answers;
- yet the container runs `--network none`, so **no grant has ever changed a
  packet**. Phase 1 made the ask say exactly that: approval is consent, not
  connectivity, and "a session grant changes this gate's answer, not the
  container's network" (`egressHonesty`, `packages/approval/src/index.js`).

An approval that cannot change anything is a survey. Phase 3 makes it able to
change something — without handing the Subject the wire.

## The invariant

**The confined container never carries a route to the internet. A mediator
outside the boundary does, and it consults the live grant table at every
connection.**

Everything else follows from that sentence:

- **no in-container proxy.** A proxy the Subject controls governs itself;
  its environment is the first thing a confined command can edit.
- **no host-level allowlisting in the container.** Host firewall rules break
  on DNS (queries leak, rebinding redirects), on redirects (`example.com` →
  `www.example.com` is a different host), and on the exfiltration reality that
  *any* egress — POST bodies, GET query strings — is a channel for everything
  the Subject read via bash.
- **no TLS interception.** A planted CA crosses a trust boundary the Compact
  has no authority to cross. HTTPS stays end-to-end: the proxy filters the
  `CONNECT` on hostname/port (SNI is client-side; the tunnel itself is opaque
  to it, and that opacity is declared below under residuals).

## Enforcement, at every connection

The proxy is an HTTP/HTTPS forwarder (no other protocol has a route):

| Surface | What the proxy does |
|---|---|
| plain HTTP | client sends the absolute URI; the proxy checks `host:port` + method class against **this session's** live grants, then resolves the name **itself** and forwards |
| HTTPS | client sends `CONNECT host:port`; same check; on pass, a byte tunnel — TLS end-to-end, never terminated |
| DNS | the container never resolves: the hostname travels to the proxy in the request line / `CONNECT` (verified below: on the internal bridge, `getent` fails) |
| redirect | the proxy **never follows one** — the client's next request or `CONNECT` re-enters the check, so a cross-host redirect is refused with a named reason: *a new host is a new grant* |
| method class | **observed, never guessed**: read = `GET`/`HEAD`/`OPTIONS`/`TRACE`, write = `POST`/`PUT`/`PATCH`/`DELETE`/…, an unknown method refused (D-7) |
| TTL, revocation | the store is the single authority, checked per connection; an established tunnel is tracked against its grant, so **revocation closes mid-flight tunnels** — the route dies, not just the next attempt |
| other protocols | no route exists at all (ICMP, UDP, raw sockets): unreachable by construction, not filtered |

**Session binding is the socket, not a credential.** One listener per session,
bound to the mediation network's gateway address for exactly as long as the
session lives; the container receives only `HTTP_PROXY`/`HTTPS_PROXY` pointing
at *its* listener, injected at confine time the way secret refs are. Nothing in
the container can name another session's grants: there is no token to replay,
and a command that rewrites its proxy env reaches only its own listener — or a
dead port.

## Grant identity: `(host, port, method-class, session, TTL, revocable)`

Consent identity is risk identity (#26), and the grant must carry the identity
the operator was shown:

- **method-class rides the grant and the fingerprint.** Approving a `GET` must
  not cover a `POST` to the same URL: the ask's fingerprint gains the method
  class, so `GET→GET` replays and `GET→POST` asks — #26's worked examples,
  landing as the **network half** of `decision-consent-identity.md` §1. That
  record's other half (bash effect classes) stays with #26 and its own
  adjudication; this record folds in only the axis the CF grant family needs.
- **egress grants are session grants, extended — not a parallel family.** The
  pattern kinds already exist; rows gain `methodClass`. One store means one
  TTL doctrine, one revocation surface, one persistence format (v2 load
  validation checks `id` + `pattern.kind`, so older rows still load).
- **absence gives the proxy nothing to enforce.** A network-kind grant without
  a `methodClass` still counts as evidence for CF-2's posture check (unchanged:
  it is a live grant, and its row was lawfully made) but covers **no
  connection** at the proxy (D-7: an unclassifiable grant is no coverage, never
  read-by-default).
- **budgets stay gate-owned.** `maxUses` is consumed when a grant answers the
  gate (`concept-approval-layers.md`); the proxy does not decrement it —
  order-is-the-semantics, and two counters over one grant is two truths.

**Materialization uses the secret-grant template**: an `allowed-once` on a
network target, in a composition whose egress posture is `proxy`, materializes
a session-scoped, TTL-bounded, revocable grant for `(host, port, method-class)`
in the same store — disclosed before it exists (below), recorded when it does,
revocable afterwards.

## What the ask must then say — the fourth posture

Phase 1 added three `egressHonesty` postures (`none`, `open`, undeclared).
`proxy` joins them, and it is the first one where approval *does* something:

> approving materializes a live egress grant — host, port, method class, this
> session, TTL-bounded, revocable — and the mediator will deliver connectivity
> under exactly that grant and nothing beyond it. Anything the grant covers can
> still carry data out; the record keeps what was sent (it is never scrubbed),
> the credential-shape detector watches it, and revoking the grant kills the
> route.

The disclosure keeps the phase-1 discipline honest: consent still is not raw
connectivity, and the residual that *does* exist under a live grant (below) is
stated at the moment the operator decides, not discovered afterwards.

## Constitutional posture: ABSENT → BOUND

- **Today: ABSENT** — declared (`--network none`) and enforced (no route, no
  grant consumption). Correct, and it stays the default.
- **This design: BOUND** — every egress happens under a live, revocable,
  recorded grant, mediated outside the boundary. Present-but-unbound (raw
  container networking) remains forbidden: `CF-2`'s refusal of an open posture
  with no live grant is untouched, and the new posture attaches containers only
  to a bridge that carries **no route** — asserted at boot (D-7: the provider
  refuses to attach to a network that is not internal, and a posture declared
  without a provisionable mediator refuses the boot; it never degrades
  silently, and it never degrades to `open`).
- **Register (lands with the enforcement, `[baseline-update]`):** one CF
  **grant-gated-exception** entry in the secret-grant family's shape — the
  exception to CF-1's no-network default is a mediated path whose every use is
  a grant — with CF-2's evidence gaining the third posture vocabulary and
  I-5/R-3's evidence gaining the method-class materialization disclosure (#26's
  own register note). Evidence moves with enforcement, never before it.

## Platform evidence (measured 2026-09-22, before this record)

Four probes × three Docker network postures, `ubuntu:24.04`, engine 29.1.3 on
`Linux …-WSL2` (Docker Desktop, WSL2 engine); a host listener bound
`0.0.0.0:80999`:

| Probe | ordinary user-defined bridge | `--internal` bridge | `--network none` |
|---|---|---|---|
| DNS (`getent hosts example.com`) | resolves (exit 0) | **fails (exit 2)** — no query leaves | n/a |
| TCP `1.1.1.1:443` (internet) | **reached — raw egress** | `Network is unreachable` | loopback only |
| host listener via `host.docker.internal` | **reached** | refused | n/a |
| host listener via bridge gateway `172.x.0.1` | refused | refused | n/a |

**The conclusion this table forces:** on Docker Desktop/WSL2 the host is
reachable from a container only through `host.docker.internal`, which exists
only on non-internal networks — i.e. exactly the networks that also carry raw
egress. *reachable-host ∩ no-raw-egress = ∅*, so the **host-side placement
does not compose on this platform**. The measurements are the design input, not
an obstacle to it: the adopted placement is the host-side proxy on **native
Linux**, where the internal bridge's gateway *is* the host (container → gateway
is ordinary host-bound traffic behind no NAT rule) — the one cell this host
cannot measure. That cell is therefore a **phase-3 acceptance item**, to be
pinned by the composed docker suite where CI already runs a native daemon.

**Fallback profile, decided now so a later change is not a redesign:** if the
native cell fails, the mediator runs as a dedicated **container attached to
both** the internal network and an egress-capable one. The invariant is
identical (the confined container has no route; a mediator outside it enforces
the live grants); only the placement moves. Taking that profile is a
configuration decision under this record, not a new decision.

## Residuals — said, not solved (I-8)

1. **Exfiltration under a live grant is possible.** A `GET` can carry data in
   its query string; the read class is itself a channel. What bounds it: the
   grant names host, port, method class, session and TTL; the record keeps
   *what was sent* (completeness forbids scrubbing); the credential-shape
   detector watches tool output; revocation kills the route. Declared, never
   pretended away.
2. **HTTPS bodies are opaque to the proxy** (no interception, by decision):
   the detector sees what enters the record, not what crosses the wire. The
   wire's privacy is the Subject's; the record's completeness is the
   operator's; neither is traded for the other.
3. **Host services on the mediator's interface are reachable** from the
   mediation network (on native Linux: whatever the host binds to that
   gateway). The launcher already refuses `0.0.0.0` for the pilot's own web
   surface; deployments must bind pilot services to loopback. Declared.
4. **In-tunnel redirects are invisible until the next `CONNECT`** — and are
   enforced there: the new host must be granted or the tunnel is refused.
5. **Platform placement** (above): host-side on native Linux; the
   mediator-container profile where it does not compose.

## Phase 3 — the implementation slice, specified so it lands mechanically

1. **`packages/egress-proxy`**: the mediator (per-session listeners, HTTP +
   `CONNECT`, DNS at the proxy, method classes, per-connection grant checks,
   tunnel tracking for mid-flight revocation), refusing loudly at every seam.
2. **Materialization**: `egressHonesty('proxy')`; `allowed-once` on a network
   target materializes the `(host, port, method-class)` session grant when the
   posture is `proxy`; the fingerprint carries the method class (#26's network
   half).
3. **Posture `proxy`** in `packages/sandbox-docker`: internal-bridge assertion,
   proxy env injection at confine time, CF-2's third vocabulary value,
   refuse-to-boot without a provisionable mediator.
4. **Register**: the CF grant-gated-exception entry + the evidence lines named
   above (`[baseline-update]`).
5. **Pinning tests** — the acceptance list, exactly as #38 states them:
   - grant covering `(host, port, class)` → connect **allowed**;
   - no grant → connect **refused with a named reason** (envelope: gate, rule,
     reason, lawful next moves);
   - same-grant redirect to another host → **refused** (*new host, new grant*);
   - grant TTL expired → **refused**;
   - revocation → **kills the mid-flight tunnel**, not only the next attempt;
   - plus the identity axis: read grant + `POST` → refused; another session's
     grant → refused; unknown method → refused.

## Not in this slice

Budget/`maxUses` accounting at the proxy (gate-owned, see above); WebSocket and
HTTP/2 upgrades (an upgrade rides the same request-line check — noted, not
specified); UDP/QUIC/ICMP (unreachable by construction); the mediator-container
fallback profile (only if the native cell fails); and #26's bash effect-class
half, which keeps its own record and adjudication.
