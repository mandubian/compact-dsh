# The sandbox: how every command is confined

Every `tool:bash` call runs in its own Docker container, created for that call and removed afterwards (`docker run --rm`). Confined bash is the only file surface: host-side file tools are not composed. The law behind this is `clause:CF-1`, and the image rules come from `clause:CF-2`.

## What a confined call gets

| Aspect | What the container sees |
|---|---|
| Root filesystem | read-only |
| Workspace | bind-mounted at its own canonical path, which is also the working directory. Read-only in `read-only` mode, read-write in `workspace-write` mode (this composition's default) |
| Temp area | in `workspace-write` mode, a tmpfs at `/tmp`, with `HOME=/tmp` |
| User | the launcher's own uid:gid, never root unless the launcher runs as root |
| Network | `--network none` by default. See `page:network` |
| Extra paths | only live mount grants for this session, each at its granted mode (below) |
| Secrets | only env names covered by a live secret grant. See `page:secrets` |

The workspace is the directory given with `flag:--workspace` (or the launcher's working directory), resolved through realpath. Any other host path is simply not there.

## Paths that are always hidden

Where a bound root contains them, these paths are covered: a tmpfs over directories, a read-only `/dev/null` over files.

- `~/.ssh`, `~/.aws`, `~/.azure`, `~/.gnupg`, `~/.config/gcloud`, `~/.config/gh`, `~/.netrc`, `~/.docker`, `~/.kube`
- `~/.compact-dsh` (the default state directory)
- `/etc/shadow`, `/etc/gshadow`, `/etc/sudoers`
- **The Enforcer's protected state**: the record root, the chain directory and the approval store (`env:COMPACT_RECORD_ROOT`, `env:COMPACT_CHAIN_DIR`, `env:COMPACT_APPROVAL_PERSIST_PATH`, all under `flag:--state-dir` / `env:COMPACT_STATE_DIR` by default). The composition refuses to start unless these are named, so the Subject can never reach its own evidence (`clause:D-8`).

Keep the state directory outside the workspace anyway. Masking hides it, but a separate directory is the cleaner boundary.

## Fail-closed

- If Docker is unavailable, confinement is refused. It never falls back to running the command unconfined. The daemon is checked once with `docker info` on the first confined call.
- `env:DSH_PERMISSION_MODE` set to `danger-full-access` refuses the boot.
- **Workspace anchor.** A session recorded under a different workspace (for example, a session reopened after relaunching on another directory) has every tool call refused with `CF-1/workspace-anchor`. To fix it, start a fresh session, or relaunch with `flag:--workspace` set to the workspace that session recorded.

## Letting the agent read a directory outside the workspace

To let the agent read `~/datasets`:

1. The agent calls `tool:sandbox_request_mount` with an absolute `path`, a `mode` (`ro` is the default; ask for `rw` only if the command must write) and a one-sentence `justification`. The operator sees the justification exactly as written.
2. The path is canonicalized (realpath), so symlinks cannot widen it. Then:
   - **Protected path**, or a parent of one: refused terminally, with no gate. Requesting all of `~` fails because `~/.ssh` is inside it, so ask for the specific subdirectory. This check runs before the existence check, so a refusal never reveals whether a protected path exists.
   - **Missing path**: refused terminally.
   - **Already covered** by a live grant: the tool names the existing grant and asks nothing.
   - **Otherwise**: the human gate. The operator decides at the terminal (`flag:--attended`) or in the browser (`flag:--web`). See `page:approvals`.
3. On approval, a grant row is created: `PathPrefix` on the canonical path, capped at the requested mode, scoped to this session, lasting **1 hour** by default. The agent retries the same command, and it now passes.

A mount grant is ceiling-bound: an `ro` grant is bound read-only and never upgrades to `rw`. Grants are read on every confined call, so revoking one takes effect on the next command. To see or revoke a grant, use `command:/grants-list` (it shows `PathPrefix:<path>(ro|rw)` with its id) and `command:/grants-revoke` with that id. `command:/grants-grant` cannot create a mount grant: it only takes host and URL patterns. The design is in `file:docs/concept-mount-grants.md`.

## The image (`clause:CF-2` supply chain)

- `env:COMPACT_SANDBOX_IMAGE` selects the image (default `ubuntu:24.04`, which is a bare shell). To give the agent tooling, build or pull an image yourself and set this variable.
- The image **must already exist locally**. At start, the launcher runs `docker image inspect` and stops if that fails. It never pulls.
- The launcher records the digest it observed (`env:COMPACT_SANDBOX_IMAGE_DIGEST`, which the launcher sets itself) as an `operator-declared` provenance record. You can label that record with `env:COMPACT_SANDBOX_RECORDED_BY` and `env:COMPACT_SANDBOX_PROVENANCE_NOTE`. The boot log lists it as a declared gap: a person asserted the history, and nothing verified it.
- Confined calls are refused with a `CF-2/…` envelope in these cases:
  - `undeclared-image`: the image has no provenance record.
  - `unresolvable-digest`: the daemon cannot report the image's digest.
  - `digest-drift`: the tag now points to different content than the record declares.
  - `uninherited-network`: an open network with no run-time grant.
- Build-time approvals never grant anything at run time.

Details are in `file:docs/concept-supply-chain.md`.

## For the Subject

A `read-only file system` or `permission denied` error on a path outside the workspace means that path is not mounted. Request the narrowest path with `tool:sandbox_request_mount` instead of working around it. Protected and missing paths are final: do not re-ask for them. The operator can list your live grants with `command:/grants-list`.
