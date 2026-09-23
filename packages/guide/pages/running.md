# Running compact-dsh

The launcher is `file:tools/compact-dsh.mjs`, run as `npm run compact -- …`. It
needs Node >=22.19 and a running Docker daemon. One boot exposes one workspace.

## Modes

| To… | Run | Notes |
|---|---|---|
| boot everything with no model call | `npm run compact -- --smoke` | `flag:--smoke`: takes no task, never prompts, fails if the model is called, exits after "ready". Cannot be combined with `flag:--attended` or `flag:--web`. |
| run one task, unattended | `npm run compact -- "task"` | Headless one-shot. No human answerer: any act that needs a new approval fails closed (see `page:approvals`). |
| run one task, with you approving | `npm run compact -- --attended "task"` | `flag:--attended`: uncovered gated calls prompt on stderr; default deny. |
| chat in the browser | `npm run compact -- --web` | `flag:--web`: takes no task. Serves loopback `127.0.0.1:3080` by default. Approval prompts fall through to the terminal you started it from (it implies `flag:--attended`). |

Common options: `flag:--workspace` PATH (default: the current directory) and
`flag:--state-dir` PATH. `flag:--help` prints the usage text.

`npm run compact -- --workspace /abs/project --attended "Inspect the project using bash and report what you find."`

The workspace is resolved to its realpath. It becomes the sandbox root: Docker
bind-mounts it at the same path, and the container's working directory is set
to it. Inside bash, `cd` into subdirectories explicitly. Keep the state
directory outside the workspace, because it holds the record and the grants.

## What "ready" looks like (stderr)

```
compact-dsh: ready; draft Compact, no Compact standing.
State: <dir>; records: <dir>/sessions; chains: <dir>/chains; approvals: <dir>/approvals.json
```

`flag:--smoke` adds `(smoke; no LLM request)`. `flag:--web` adds `(web; approval
prompts fall through to this terminal)` and a line naming the `compact-pilot`
agent preset. Task output goes to stdout. Prompts and diagnostics go to stderr.
If enforcement is missing or the configuration is incomplete, the boot refuses
instead of printing ready.

## State directory

The default is `~/.compact-dsh`. `env:COMPACT_STATE_DIR` overrides it, and
`flag:--state-dir` overrides both. The launcher creates directories owner-only
(0700). `env:DSH_HOME` is pointed at the state directory, so your normal dsh
profile is never touched. `env:DSH_TELEMETRY_DISABLED` is set to `1`.

| Path | What | Move with |
|---|---|---|
| `sessions/<workspace>/<session-id>/session.v3.jsonl` | the record, one log per session | `env:COMPACT_RECORD_ROOT` |
| `chains/<session-id>.chain`, `.chain.sigs.jsonl`, `subjects.jsonl` | hash links, signed anchors, subject certificates | `env:COMPACT_CHAIN_DIR` |
| `approvals.json` | persisted grants and exec cache (`page:approvals`) | `env:COMPACT_APPROVAL_PERSIST_PATH` |
| `compact.generated.cordis.yml` | generated boot root. It must contain `[]`; any other content refuses the boot. | — |
| `settings.yaml`, `.credentials.yaml` | model-route settings and provider credentials (keys referenced by env-var name) | — |
| `keyring/` | the rehearsal identity set, present only if installed | — |

The sessions, chains, approvals file and keyring carry history or authority.
Back them up or wipe them only as deliberate acts. See `page:record-and-audit`.

## Environment

| Variable | Effect |
|---|---|
| `env:DEEPSEEK_API_KEY` | model key, inherited in task mode. The default model is deepseek-flash. |
| `env:COMPACT_SANDBOX_IMAGE` | image for confined bash (default `ubuntu:24.04`). It must already exist locally: the launcher inspects it and never pulls or builds. |
| `env:COMPACT_SANDBOX_RECORDED_BY`, `env:COMPACT_SANDBOX_PROVENANCE_NOTE` | the operator-declared provenance recorded with the image (`clause:CF-2`). The launcher itself sets `env:COMPACT_SANDBOX_IMAGE_DIGEST` from `docker image inspect`. |
| `env:COMPACT_ALLOWLIST` | JSON array of host/URL rules, default `[]` (`page:approvals`) |
| `env:COMPACT_SECRETS` | JSON array of env-var names that bash may be granted (`page:secrets`) |
| `env:COMPACT_EGRESS`, `env:COMPACT_EGRESS_NETWORK` | `proxy` opts into mediated egress. The network defaults to `compact-egress` (`page:network`). |
| `env:COMPACT_WEB_PORT`, `env:COMPACT_WEB_HOST` | web bind. The port must be a number. `0.0.0.0` is refused. |
| `env:COMPACT_ENFORCER_ANNEX`, `env:COMPACT_ENFORCER_KEY` | rehearsal signing: annex and key from `file:tools/rehearsal-keyring.mjs` |
| `env:COMPACT_KEYRING_MANIFEST`, `env:COMPACT_KEYRING_SEAL`, `env:COMPACT_TRUSTED_KEYRING_DIGEST` | re-seat or pin the development keyring used to verify the law seal at boot |

The launcher derives `env:COMPACT_WORKSPACE` from `flag:--workspace`. Do not set
it yourself. `env:DSH_PERMISSION_MODE` set to `danger-full-access` refuses the
boot.

## Disabled by design

These are disabled in `file:packages/blessed/cordis.patch.yml` and asserted
absent by `file:packages/blessed/test/loader.dsh.test.js`:

- host file and search tools, jobs, skills
- the generic subagent, fork and workflow tools
- web search and fetch
- LLM session titles and OTel telemetry

The stock sandbox and JSONL persistence are replaced by Docker confinement and
the chained record. File work goes through `tool:bash` (Docker, network off by
default: `page:sandbox`). Delegation goes through the specialists, such as
`tool:specialist_coder` (`page:delegation`). Both permission presets
(read-only, workspace-write) keep approval at "ask". Under `flag:--web`, the
dynamic-plugin runner is absent by declaration (`clause:A-4`).

## Verifying a run

- Ask the agent for `tool:self_describe`. It reports standing, capabilities
  in force and pending gates (`clause:R-1`).
- Under `flag:--web`, type `command:/grants-list` in the composer to see live
  grants, cached approvals and the gate's defaults.
- Audit offline, without the runtime's cooperation (`clause:I-7`), using
  `file:auditor/audit.mjs`:

```
node auditor/audit.mjs ~/.compact-dsh/sessions/<workspace>/<session-id>/session.v3.jsonl --chain ~/.compact-dsh/chains/<session-id>.chain --quiet
```

It exits 0 with an attestation, or 1 with findings. For the signature-checking
options, see `page:record-and-audit`.
