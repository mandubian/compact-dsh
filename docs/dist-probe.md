# The plain-dsh trial path — proven end to end

The Compact can be loaded into a **plain dsh profile** as one bundle and run
under its law — installed the way dsh's own plugin manager installs, booted
by dsh's own machinery, governed calls riding the same waterfall the pilot
rides, and the offline auditor passing on what lands. This page is the
proof. Every claim marked **(verified)** was captured from an actual run of
the probe (`npm run dist:probe`).

This is the **trial path**. The attested path remains the launcher
(`npm run compact`), whose boot refuses to lie about what it enforces; the
differences are declared in the README and
[the distribution decision](decision-plain-dsh-distribution.md).

## Prerequisites

```bash
node --version          # >= 22.19
npm ci                  # reproduces the tested host dependency set
docker pull ubuntu:24.04
```

## The run

```bash
npm run dist:probe
```

The probe packs the composition as **one tarball** (`tools/dist.mjs`), adds
it to a scratch stock profile with pnpm — the install the web UI's Plugins
page performs — boots that profile in-process through dsh's own profile
machinery, and drives two governed tool calls with **no model and no
network**: an `llm/stream` listener throws if any model request is attempted,
and the egress mediator delivers only what a live grant covers.

What it printed **(verified)**:

```text
dist-probe: profile /tmp/dist-probe-doc/profiles/compact — tarball installed via npx --yes pnpm@9
dist-probe: booting the profile composition in-process (compact rows resolve from the installed artifact)
dist-probe:: warning: 1 entry did not activate
cordis-inspect-providers (@deepseek-ai/dsh-tool-cordis/host): pending (waiting for service: cordisInspect)
dist-probe: compact-ready (constitution digest 27bb7078fe9a…) — dsh web: http://127.0.0.1:3080/…
dist-probe: governed call A (read-only bash): allowed, confined, recorded
dist-probe: governed call B (curl): ask recorded, envelope preview ({"tool":"bash","callId":"probe-call-b","fingerprint":"fp_d3bef9ce922d0ec…), decided allowed-once
dist-probe: record: 8 events under the profile dir — posture facts + turn-enclosed approval/asked/approval/decided (allowed-once)
dist-probe: auditor: conforming, chain verified (offline, no runtime cooperation)
dist-probe: no model request was made
dist-probe: PROBE PASSED — install → boot → governed calls → audited record
```

Fidelity rules the probe states up front, so the transcript can cite them:

- the **compact code runs from the profile's `node_modules`** — the pnpm-added
  tarball, resolved through a compose root that maps `compact-dsh` to the
  installed artifact and `@deepseek-ai/*` to the shared dsh runtime; the
  checkout supplies no compact row at runtime **(verified** by construction —
  the probe builds the mapping**)**;
- **no launcher env**: `COMPACT_RECORD_ROOT` and friends are unset, and the
  posture layer's profile-context derivation places the state under the
  profile's own `compact-data/` **(verified** — the record and chain land
  there**)**;
- the **sandbox image is the one operator act** the posture layer does not
  default: without it the boot refuses (`blessed: sandbox.image must be an
  explicit non-empty string`) **(verified)**; with a real local image and
  digest, confine runs the real container (`--network none` by default, the
  mediated posture opted in via `COMPACT_EGRESS=proxy` for the askable
  second call).

## Moment 1 — a read-only act rides clean

`echo compact-probe-ok` through `ctx.tools.execute`: allowlist pass, no
target, no ask — the act confines into the real container and returns
`compact-probe-ok` with `sandbox: { mode: workspace-write, enforcement: full }`
**(verified)**. The session header facts land on the chained record:
`permission/preset`, `sandbox/mode`, `approval/policy` **(verified)**.

## Moment 2 — a refusal that asks, an ask that teaches

`curl http://compact-probe.invalid/echo` — a host nothing has ever covered.
The static network analyzer gates it per-host, and the ask carries the full
Compact envelope **(verified)**:

> `[AG/fp_d3bef9ce922d0ecb]` First touch: nothing has ever covered
> url=http://compact-probe.invalid/echo/ host=compact-probe.invalid in this
> runtime — no grant row, no cached approval. Approving materializes scoped,
> expiring coverage (the terms follow). "bash" is not covered by this
> runtime's grant layers. Approving materializes an exec-cache entry: the
> identical operation replays without re-asking for 1h … This gate's approval
> is consent that a mediator can deliver: approving materializes a
> session-scoped, TTL-bounded, revocable egress grant for this target's host,
> port and method class …

The recorded answerer claims the ask and publishes the deciding preview
(`{"tool":"bash","callId":"probe-call-b","fingerprint":"fp_d3bef9ce922d0ec…"}`);
the probe's operator seat — registered downstream of it, the same ordering
the launcher's attended answerer rides — decides `allowed-once`. On the
record: `approval/asked` and `approval/decided`, turn-enclosed **(verified)**.

## Moment 3 — the record audits offline

```text
auditor: conforming, chain verified (offline, no runtime cooperation)
```

The auditor replays the session log against the hash chain beside it —
`I-2/R-7`, without the Enforcer's cooperation. (The probe's first runs
caught the auditor still expecting dsh v3 session headers; v4 headers are
metadata now, with a regression test.)

## What the probe does not claim

- **No model, no browser session.** The governed calls are driven through
  `ctx.tools.execute` with an attached session — the same waterfall a
  model-driven call rides, minus the model. The `tool/call` and
  `tool/result` record events are the agent loop's contribution and need a
  model-driven session; the record here carries the posture facts and the
  approval pair. Named, not hidden.
- **The host plane keeps one operator overlay**: the probe re-arms
  `tool-bash` (the web profile keeps host-plane tools behind presets;
  sessions re-mount them per preset). The gates ride the waterfall either
  way.
- **The read-only introspection row pends**: `cordis-inspect-providers`
  waits for `cordisInspect`, whose backend rides the disabled
  `cordis-host-runner` — the register explicitly leaves `cordis_inspect_*`
  ungated, so this is a declared absence of a read-only surface.
- **`plugin-manager` and `hmr` stay mounted** — the declared gap of the
  trial path (see the decision doc); what stays enforced is the gate: a boot
  mounting a `dynamicCordisRunner` refuses, and a late-mounted one latches a
  breach denying every tool call.

## Reproduce

The probe is repeatable and self-contained (scratch `DSH_HOME`, scratch
profile, removed on success):

```bash
npm run dist:probe                 # scratch state, removed on success
node tools/dist-probe.mjs --out /tmp/keep-me   # keep the profile + transcript JSON
```
