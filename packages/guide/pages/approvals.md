# Approvals and grants

Gated acts pass through the approval gate (`clause:I-5`). A call runs, asks
or is refused according to an ordered evaluation (`file:docs/concept-approval-layers.md`).
Every refusal and every ask is a Compact envelope (`clause:R-3`, `clause:I-4`).

## What gets gated

The gate works on **identifiable targets** only: a host, host:port or URL.

- Network findings in a `tool:bash` command, such as `curl https://…`,
  `git push <url>` or `npm install`, are extracted by the remote-access
  analyzer and routed to the gate per host.
- A network verb whose target cannot be resolved statically is refused
  outright. The refusal's rule is `D-7/opaque-network`, and the move it offers
  is to rephrase with a literal host or URL.
- A command with no target is not gated here, unless it names a declared
  secret. In that case the ask is the injection agreement (`page:secrets`).
- Mount requests have their own gate (`page:sandbox`).

`env:COMPACT_ALLOWLIST` (a JSON array, default `[]`) is a separate, earlier
gate. It covers tool calls whose arguments carry a `url` or `host` directly.
An uncovered call is denied under AG-1. A covered call still goes on to the
approval gate. Allowlisting never skips approval and never opens container
networking. The allowlist accepts the same rule forms as the patterns table
below.

## Evaluation order (first answer wins)

1. **Exec cache**: the identical operation (same tool, canonical target and
   method class) was approved before. It replays without asking.
2. **Plan grants.**
3. **Session grants**: a pattern grant covers this session and target.
4. **Pending dedup**: an identical call is already waiting for a decision.
5. **Flood cap**: at most 50 pending asks per root session. Past that, calls
   are denied under `I-5/flood-cap`, not queued. A pending ask is forgotten
   after 5 min.

If nothing covers the call, it asks. The decision releases the pending slot
whatever the outcome.

## The ask, and who answers it

| Mode | Who decides |
|---|---|
| plain task mode | Nobody. The ask closes `unavailable`, and the call does not run (fail-closed). |
| `flag:--attended` | You, on stderr. The prompt shows the tool, the command (truncated, secrets masked), the target and the fingerprint. Answer `2` (or `allow`) to allow once. `1`, `deny`, an empty answer, EOF, ^C or anything unrecognized denies. |
| `flag:--web` | A connected browser card may answer first. The terminal prompt is the fall-through. |

**Allowed once** creates an exec-cache entry. The identical operation replays
without asking for 24h, across sessions of this runtime, until the entry lapses
or a revocation kills it. Under the mediated posture, an act that creates an
egress grant caches only as long as that grant lives (1h), and the ask says so. Anything else asks again. Each decision leaves a
one-line `[compact-approval] Gate decision:` note in the transcript. A replay
leaves a `[compact-approval] Replay:` note once per session.

With the default network posture, approval is **consent, not connectivity**:
the container still has no network, and the command fails at connect. With
`env:COMPACT_EGRESS` set to `proxy`, allowing an act whose method class can be
derived also creates an egress grant, which the mediator delivers. See `page:network`.

## Operator commands

Type these in the browser composer under `flag:--web`. A headless task has no
interactive follow-up.

| Command | Usage |
|---|---|
| `command:/grants-list` | Lists the live session grants (id, pattern, method class, scope, expiry, uses), the live secret grants (id, secret name, session, expiry), the live cached approvals, and the gate's defaults: exec-cache TTL, flood cap, pending TTL, declared secret refs. |
| `command:/grants-grant` | `/grants-grant <pattern> [ttlMinutes] [maxUses] [read\|write]`. The TTL defaults to 60 min. `maxUses` is a budget: a spent grant stops covering. The class may go anywhere after the pattern. It is required for network patterns under the mediated posture (`page:network`). The grant covers the session you type it in. |
| `command:/grants-revoke` | `/grants-revoke <grantId>`. Revokes a session grant and kills the cached approvals its pattern covered. It also revokes a secret grant (`sec_…` ids): injection stops at the next confined call, and the command that created the grant asks again (`page:secrets`). |

Patterns:

| Pattern | Covers |
|---|---|
| `api.example.com` | that exact host, with no explicit port |
| `*.example.org` | the host and its subdomains |
| `host:443` | that host on that port |
| `https://host/path/` | URLs under that prefix |

**Example.** To let the agent reach api.github.com for the next two hours,
at most 20 times, without asking each time, type
`/grants-grant api.github.com 120 20`. Check it with `command:/grants-list`.
Revoke it with `command:/grants-revoke` and the id that the list shows.

## Persistence

Grants, budgets, revocations and cache entries are written atomically to
`env:COMPACT_APPROVAL_PERSIST_PATH` (default `approvals.json` in the state
directory, see `page:running`), so they survive a restart. Pending asks are
not persisted. An unreadable or wrong-version store refuses the boot instead of
starting empty, because a silent reset could bring back grants you revoked.

## For the Subject: when you are refused or asked

- Read the envelope. `[AG/…]`, `[RA/…]` and similar name the gate and rule,
  and "Lawful next moves" lists what remains lawful. Take one of those moves.
- Do not retry the identical call hoping for a different answer. Two things
  trip the loop guard: the same operation denied by a gate 3 times (LG-9), or
  10 gate refusals (asks or denials) with no successful call between them
  (LG-12). Either one latches corrective guidance until the next user turn.
- If you need repeated access, ask your operator for a scoped grant and give
  them the exact `command:/grants-grant` line: the narrowest pattern, a TTL
  and a use budget. Do not ask for a blanket grant.
- Check `tool:self_describe` for your pending gates. A page never grants
  anything.
