# Tweet demo #2 — the network that asks

A second, standalone thread. The first thread (`docs/tweet-demo`) shows the
**decision** (the gate) and the **record** (the hash chain). This one shows what
those cards predate: the **egress mediator** (#38 phase 3,
`COMPACT_EGRESS=proxy`), a network that re-checks consent at every connection
— by host, by port, by method class, and on a connection that is already open.
Plain dsh cannot express any of it: its sandbox governs file effects only and
"network stays unrestricted" (`@deepseek-ai/dsh-bash-sandbox` README).

The first demo's files are untouched. This writes only into `docs/tweet-demo-2/`.

```bash
node docs/tweet-demo-2/capture.mjs   # the evidence: every check, PASS/FAIL
node docs/tweet-demo-2/render.mjs    # runs the capture, then draws the cards
```

| file | what |
|---|---|
| `capture.mjs` | the end-to-end run the cards are drawn from — throws if any card claim fails |
| `render.mjs` | draws `net-1` / `net-2` from the capture; rasterizes with `convert`, else the repo's `sharp` |
| `net-1.svg` / `net-1.png` | card 1 — one grant, every connection re-checked |
| `net-2.svg` / `net-2.png` | card 2 — revoked mid-download, measured |

## What is real, and what is harness

**Real compact-dsh code, run end to end:** the approval plugin
(`egress: 'proxy'`) and the remote-access plugin, composed on a Cordis-shaped
ctx. The analyzer finds the curl's target, `methodClassOf` classes it, the gate
**asks**, and the recorded answerer materializes the egress grant on
allow-once. That grant lands in the real `GrantStore`, as
`HostAndPort api.example.com:18080 · read · 1h · session-scoped`. From there:

- the real `createEgressProxy` server reads it through `networkGrantsForSession`,
  the exact `resolveGrants` of `packages/egress-proxy/src/index.js`;
- it re-checks revocation at its **default** interval, because the plugin passes
  none;
- revocation goes through the real `revokeSessionGrant`;
- every connection is real `curl`: `-x` for plain HTTP, `-p` for a CONNECT tunnel
  (what every `https://` request is).

**Harness (declared):**
- There is no model and no Docker. curl runs on the host, pointed at the
  mediator the way the container is pointed at it via `HTTP(S)_PROXY`.
- The origin is a local server. The lookup answers `127.0.0.1` for every name,
  and the dial policy admits loopback, which the default refuses (#55). This is
  the same harness `packages/egress-proxy/test/proxy.test.js` uses. On this
  machine the mediator cannot reach the internet directly: outbound traffic
  goes only through a corporate proxy.

The socket-level suite for the same behaviour passes too:
`node --test packages/egress-proxy/test/*.test.js` → 34/34.

## What the run found — and what the cards therefore do NOT claim

1. **Over HTTPS, the method class is not enforced.** A `POST` inside a CONNECT
   tunnel under a *read* grant reaches the origin. That is the declared residual
   of not intercepting TLS (`docs/decision-network-egress-proxy.md`). The
   method-class beat on card 1 is therefore plain `http://`, and card 1 states
   the residual in its footer.
2. **Revocation closes open tunnels, but not a plain-HTTP response already in
   flight.** The reaper tracks CONNECT tunnels only. A plain-HTTP stream
   revoked mid-way ran to completion, and only its *next* request was refused.
   Card 2 measures the tunnel case and says this in its footnote.

   Filed as [#79](https://github.com/mandubian/compact-dsh/issues/79): the
   envelope's own wording, *"revocation kills the route, mid-flight
   included"*, is broader than what happens on plain HTTP.

The first draft of these cards used the classifier offline. It showed
`POST api.github.com:443 → EG/method-class`, a combination the real mediator
never produces. Point 1 is why the capture replaced it.

---

## Tweet 1 — one grant, every connection re-checked

Attach `net-1.png`. About 250 characters with the link:

```
Plain dsh's network is a switch: on or off.

compact-dsh: one approved curl became one grant — host, port, read-only, 1h.
A mediator outside the container re-checks every connection ↓

✓ GET that host
✗ POST it
✗ another host
✗ a redirect's 2nd hop
✗ anything after revoke

https://github.com/mandubian/compact-dsh
```

## Tweet 2 — revoked mid-download

Attach `net-2.png`, as a reply to tweet 1. The millisecond figure is the
**measured** one: it changes on every render, so copy it from the card.

```
Then I revoked the grant mid-download.

The open connection was closed 905 ms later.

Plain dsh has nothing to revoke: its container holds the network, so the
download just finishes.

(Measured on a tunnel — a plain-HTTP response already in flight isn't cut,
only the next request is.)
```

## Before posting

- The **mediated posture is opt-in** (`COMPACT_EGRESS=proxy`). The default is
  still `--network none`.
- "Plain dsh: on or off" comes from dsh's documentation, not from a
  head-to-head run. One plain-dsh run of the same curl would make it a
  capture.
- The strongest follow-up is a fully live capture: the model asking, the
  operator answering, curl inside the container, and `/grants-revoke` from the
  terminal. Every piece of that path is shown working here except the model and
  the container.
