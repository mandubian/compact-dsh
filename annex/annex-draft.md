# dsh Annex — DRAFT (no standing yet)

**Runtime**: DeepSeek Harness, `@deepseek-ai/dsh ~0.1.5-rc.1` ·
**Composition**: the `compact-dsh` plugin set · **Status per F-5:
drafting** — this document is the annex in progress. Until the mandatory
floor is fully enforced and ratified, this composition claims **no Compact
standing** and makes no trust claims (F-5's refuse-to-start discipline
applies from the first enforced phase onward).

## 1. Conformance declaration

- **[M] mandatory floor**: partially enforced as of Phase 1. Enforced now:
  I-4 (envelope shape on every refusal of the two gate plugins) and I-5
  (layered gates with grants, budgets, persistence, revocation). Still
  *planned*, not yet implemented:
  | Clause | Planned enforcement | Verifier (planned) |
  |---|---|---|
  | I-1 identity & keys | `dsh-identity` (undrafted) | signature checks over attestations |
  | I-2 the record | chained SessionPersistence decorator (port plan Phase 8) | continuity check at read |
  | I-3 attestation | `dsh-rights` (undrafted) | attestation signature + freshness |
  | I-6 contestation | `dsh-rights` amendment queue | petition-lifecycle audit |
  | I-7 verification | `auditor/` CLI (port plan Phase 4) | the auditor itself |
  | I-8 degradation honesty | constitution service surface | degradation notices in log |
  | R-1–R-13 rights | the plugins above + `dsh-rights` | auditor invariants |
  | D-1/D-5–D-8 duties | gates + attestation teaching + register | auditor invariants |
  Enforced (see §2 for the register):
  | Clause | Enforced by | Verifier |
  |---|---|---|
  | I-4 denial envelope (partial) | `dsh-allowlist-gate` v0.1.0 + `dsh-approval` v0.4.0 | envelope lint over every refusal path |
  | I-5 gates (partial — network targets) | `dsh-approval` v0.4.0 (five layers, grants, budgets, persistence, revocation, LoopGuard refusal seam) | composed deny→ask→approve→replay-hit cycle + audit-pair test |
- **[C] capabilities provided**: none yet (confinement, multi-agent,
  scheduling, memory, federation — wake their parts when provided).
- **[O] optional clauses adopted**: none yet.
- **Standing sought**: basic (floor) → full as capability parts land.

## 2. Enforcement register

To be generated per phase: `clause ID → enforcing package → verifying test`.
Registered so far (v0.1.0 of the gate package, v0.4.0 of the approval
package — partial floor only):

| Clause | Enforced by | Verifier |
|---|---|---|
| R-3 (envelope shape, partial — first slice) | `packages/allowlist-gate/src/allowlist.js::envelope` | `test/allowlist.test.js::denial envelope carries rule ID, reason, lawful next moves` |
| I-5 (gates — layered approval, partial) | `packages/approval/src/evaluate.js::evaluate` (five ordered layers over `GrantStore`) | `packages/approval/test/evaluation.test.js`, `packages/approval/test/answerer.test.js` |
| I-5 (gates — the human gate composed, partial) | `packages/approval/src/index.js::approvalPlugin` — ask via `tools/pre-execute`, decision materialized by the `approval/request` answerer, flood cap enforced pre-dispatch | `packages/approval/test/composed.dsh.test.js::deny→ask→approve→replay-hit cycle in the real runtime` |
| I-4 (denial envelope — ask/deny paths, partial) | `packages/approval/src/index.js` (envelopes carry rule ID + lawful next moves into the ask `reason`) | `packages/approval/test/composed.dsh.test.js::the ask envelope lists lawful next moves`; envelope lint over every refusal path: `packages/approval/test/envelope-lint.test.js` |
| D-7 (fail-closed, decisions from recorded state — grant durability) | `packages/approval/src/persist.js::PersistentGrantStore` — grants/budgets/revocations survive restart; corrupt store refuses the boot (no silent reset → no privilege resurrection); pending asks deliberately do not persist (park, not checkpoint) | `packages/approval/test/persist.test.js::a corrupt store file fails the boot loudly`; `::pending-approval bookkeeping never survives a restart` |
| I-5 (gates — budgets) | `packages/approval/src/grants.js` (`maxUses`/`uses`) + `evaluate.js` (consumption at the answering layer) | `packages/approval/test/budget.test.js` |
| I-5→D-1 (gate refusals are on the record for the Phase 3 guard) | `packages/approval/src/index.js::REFUSAL_EVENT` — every ask/deny emitted on the Cordis bus; decision outcomes are NOT re-emitted (the host audit pair is the record, D-7) | `packages/approval/test/loopguard-seam.test.js` |
| I-5 (gates — confinement) | `packages/sandbox-docker/src/provider.js::DockerSandboxProvider` — per-call container; fail-closed unavailability; honest enforcement reporting | `packages/sandbox-docker/test/composed.docker.test.js` (confinement matrix, real daemon) |
| I-5 (gates — mount grants, the #1002 analog) | `packages/sandbox-docker/src/mount-tool.js` — canonical (realpath) request; protected/missing paths terminal; approval materializes the PathPrefix grant row; provider binds at ceiling; revocation un-mounts | `packages/sandbox-docker/test/composed.docker.test.js::composed cure` |
| D-8 (no undeclared capability — the host-fs deny-list) | `packages/sandbox-docker/src/mounts.js::DEFAULT_SENSITIVE_PATHS` + provider over-mounts | `packages/sandbox-docker/test/composed.docker.test.js::the deny-list hides secrets` |

Conventions recorded (verified against installed dsh `~0.1.5-rc.1` types):
the plan's dotted `grants.*` command names are not legal in the host
command grammar (`/^[a-z][a-z0-9_-]*$/`) — the faithful adaptation is
`grants-grant` / `grants-list` / `grants-revoke`. dsh has no native
`allowed-always`: the only native grant is `allowed-once`, so this plugin's
grant store IS the runtime's grant layer; `allowed-once` decisions
materialize exec-cache entries (fingerprint-level, TTL, cross-session).
The host `ApprovalService` owns the `approval/asked`/`approval/decided`
audit pair; this composition never appends it.

Semantics decisions (reviewed, each with a regression test):

- **Budgets consume at gate time, not outcome time.** An approved execution
  that later fails still consumed the grant — the conservative direction.
  `tools/result` outcome accounting belongs to the Phase 3 guard, not to
  grant semantics.
- **Exec-cache replay is identity-based.** A failed approved execution does
  not burn its cache entry; the identical operation replays until the TTL.
- **Root scope is separator-anchored.** A root-scoped grant covers exactly
  the root session and its `/`-descendants; non-hierarchical session ids
  (dsh uuids) match exactly (documented under-grant, never over — a bare
  `startsWith` would collide `sess-1`/`sess-10`).
- **Session grants always expire** ("grants are scoped and expiring" — no
  blanket grants): a falsy ttlMs means the default hour, never permanent.
  Plan grants are the exception: their bound is the session itself.
- **Ask correlation is callId-keyed, FIFO-fallback, stale-dropping.**
  The host request carries no arguments; a single rec per (agent, tool)
  would let a later ask overwrite an earlier one and the operator's
  approval of A could materialize B's fingerprint.
- **Durability is actually fsync.** The grant store flushes data to disk
  (fsync before rename, best-effort directory fsync after) on every
  durable-state mutation — including budget consumption; a restart must
  never resurrect spent uses or revoked grants.
- **The approval gate gates identifiable targets only.** A call with no
  canonical target (opaque command string) would collapse to one
  fingerprint per tool — approving it once would be a hidden blanket grant
  (D-8). Opaque strings are the remote-access analyzer's domain (Phase 2).
- **The docker backend confines the network; the host vocabulary does not.**
  dsh's sandbox vocabulary excludes network/process visibility — so on this
  backend a Phase 1 network grant is necessary but never sufficient;
  `network: 'host'` is the composition-level escape hatch, recorded here.
- **Mount requests are explicit tool calls, not denial-carried fields.**
  dsh's tool schemas carry no mount declaration, so the machine-readable
  grant request of the mount-grant concept rides `sandbox_request_mount`
  (canonical path, mode ceiling, justification) — the concept's invariants
  (protected/missing terminal, recorded cure, ro ceiling, canonical prefix)
  are unchanged.

## 3. Role mapping (draft)

- **Enforcer**: the `compact-dsh` plugin composition on a pinned dsh.
- **Subject**: agent sessions on the pinned dsh.
- **Principal**: operator accounts (human) — and, post-v0.5, any
  artificial Member whose direction initiates or governs (F-3).
- **Witness**: `auditor/` offline CLI; external Witnesses per A-1 trust
  root (does not exist yet — J-8 deficiency, disclosed).

## 4. Trust-model honesty

The dsh host is unaudited, pre-1.0, and in-process; the enforcement here is
compositional, not physical. The five fidelity losses of the port plan §5
apply to this annex and are inherited by every standing claim made under
it.
