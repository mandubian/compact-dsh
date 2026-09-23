# Network: detection, postures and the egress mediator

The network is controlled in two places. The **gate** decides whether the operator consents to a network act. The **posture** decides whether a connection can exist at all. Approving a network act is consent. It is not connectivity: that depends on the posture.

## 1. Detection: the remote-access analyzer

Before a `tool:bash` call runs, its command text is scanned for network intent. The scan deliberately over-approximates: a URL literal counts as network intent even inside `echo`.

| Detected | Target it yields |
|---|---|
| `http(s)://` URL literals | the URL and its host |
| `curl`, `wget`, `ssh`, `scp`, `sftp`, `rsync`, `nc`/`ncat`/`netcat`, `telnet`, `ftp`, `ping`, `dig`, `nslookup`, `host`, `traceroute`, `mtr` | the first host-shaped argument (a dotted name, an IP, `user@host`, `git@host:`). `nc`/`telnet` also pick up a port |
| `git clone/fetch/pull/push/ls-remote/submodule` | the remote's host |
| package managers (`npm`/`pnpm`/`yarn`/`bun`, `pip`/`pipx`, `cargo`, `go`, `gem`, `apt`/`apt-get`, `docker`/`podman`/`helm`), install-type subcommands only | the ecosystem's default registry, e.g. `registry.npmjs.org`, `pypi.org` |
| bare IPv4 literals anywhere | that address |

Mentions such as `which curl` or `command -v curl` are not treated as invocations. Everything else follows the rules above.

- **A target was found**: the call goes to the approval gate, keyed per host rather than per command (see `page:approvals`). The analyzer also derives a **method class**: `write` for signals such as `-X POST`, `-d`, a data, form or upload option, or `git push`; `read` for plain fetches, clones and installs; nothing when neither can be derived. The method class is part of the approval's identity, so approving a read does not cover a write.
- **No resolvable target (opaque)**: the call is refused with `D-7/opaque-network`, and nothing is asked. Examples are `git push origin main` (a remote name) and `curl "$URL"`. **The fix is to rephrase with a literal host or URL**, for example `git push https://github.com/org/repo main`.

## 2. Postures

| Posture | How it is set | What happens after approval |
|---|---|---|
| **none** (default) | `env:COMPACT_EGRESS` unset | The container runs with `--network none`. The approval is recorded, but **the command still fails at connect**. The ask says so. |
| **proxy** (mediated) | `env:COMPACT_EGRESS` set to `proxy`. The network name is `env:COMPACT_EGRESS_NETWORK` (default `compact-egress`) | Approving creates an **egress grant** that the mediator enforces on every connection. |
| **open** | Not reachable from the launcher: it only ever produces `none` or the mediation network. | Under a composition that declares a named, non-internal network without `proxy`, confinement is refused with `CF-2/uninherited-network` unless the session holds a live network grant (`clause:CF-2`). |

With the default launcher, confined commands have **no route to any host**. `env:COMPACT_EGRESS` set to `proxy` is the only switch that delivers network access.

## 3. The mediated posture

At boot, the runtime inspects the mediation Docker network, or creates it as an internal bridge. An existing network that is not internal, or one with no gateway, refuses the boot. It then binds a pool of **16 per-session listeners** on that network's gateway. Each container gets only its own session's listener, through the standard proxy variables (HTTP_PROXY and HTTPS_PROXY, upper- and lower-case; `localhost` is excluded). A session keeps its listener for the rest of the boot. Once all 16 are taken, confinement for any further session is refused rather than share a listener.

On every connection, the mediator (`file:packages/egress-proxy/src/proxy.js`):

- re-reads this session's grants. An expired or revoked grant is refused on the next connection, and open tunnels are closed within about a second;
- reads plain HTTP by method: `GET`/`HEAD`/`OPTIONS`/`TRACE` count as read, `POST`/`PUT`/`PATCH`/`DELETE`/… count as write, and any other method is refused. A write grant also covers reads, but not the reverse;
- filters HTTPS on the `CONNECT` host and port without intercepting TLS, so what travels inside the tunnel cannot be seen;
- resolves DNS itself and does not follow redirects: a redirect to another host needs its own grant.

Refusals come back as envelopes under gate `EG`. Their rule names say why: `no-grant`, `classless-grant`, `expired`, `revoked`, `method-class`, `unknown-method`, `use-connect`.

**Platform:** the design targets native Linux. The record measured that it does **not** work on Docker Desktop/WSL2. Where the mediator cannot bind, the boot is refused with the reason. See `file:docs/decision-network-egress-proxy.md`, including its declared residuals (for example, data can still leave through a granted host).

## 4. Letting the agent reach a host

To let the agent `git clone https://github.com/org/repo` under the mediated posture:

1. Launch with `env:COMPACT_EGRESS` set to `proxy`, and with `flag:--attended` or `flag:--web` so asks have someone to answer them.
2. The agent runs the command with a literal URL. The analyzer asks. Approve it once. That creates an egress grant scoped to this session: `HostAndPort` on `github.com:443`, class `read`, lasting 1 hour. It also creates an exec-cache entry so the identical command replays without asking again.
3. To inspect or cut it short, use `command:/grants-list` and `command:/grants-revoke`.

**Do not pre-grant hosts with `command:/grants-grant` under the mediated posture.** Its grants carry no method class. They satisfy the gate, so the ask never happens and no classed grant is created. The mediator then refuses with `classless-grant`. `command:/grants-grant` changes only the gate's answer. Under `none`, it never creates connectivity.

`env:COMPACT_ALLOWLIST` is a different mechanism. It applies to tool calls that carry a `url`/`host` argument, and it does not apply to `tool:bash`, whose argument is a command string. See `page:approvals`.

## For the Subject

Write network commands with literal hosts or URLs, and use the least method you need. If you are refused under gate `EG` or `RA`, read the envelope's lawful next moves instead of retrying another way (`clause:R-3`). An approval under the `none` posture does not mean the connection will succeed.
