# dsh Annex — DRAFT (no standing yet)

**Runtime**: DeepSeek Harness, `@deepseek-ai/dsh ~0.1.5-rc.1` ·
**Composition**: the `compact-dsh` plugin set · **Status per F-5:
drafting** — this document is the annex in progress. Until the mandatory
floor is fully enforced and ratified, this composition claims **no Compact
standing** and makes no trust claims (F-5's refuse-to-start discipline
applies from the first enforced phase onward).

## 1. Conformance declaration

- **[M] mandatory floor**: enforcement *planned*, not yet implemented.
  Floor mapping (clause → planned enforcing package → verifier):
  | Clause | Planned enforcement | Verifier (planned) |
  |---|---|---|
  | I-1 identity & keys | `dsh-identity` (undrafted) | signature checks over attestations |
  | I-2 the record | chained SessionPersistence decorator (port plan Phase 8) | continuity check at read |
  | I-3 attestation | `dsh-rights` (undrafted) | attestation signature + freshness |
  | I-4 denial envelope | `dsh-allowlist-gate` **(first slice: this repo's first package)** + all later plugins | envelope-field lint |
  | I-5 gates | `dsh-approval` (port plan Phase 1) | gate-record audit |
  | I-6 contestation | `dsh-rights` amendment queue | petition-lifecycle audit |
  | I-7 verification | `auditor/` CLI (port plan Phase 4) | the auditor itself |
  | I-8 degradation honesty | constitution service surface | degradation notices in log |
  | R-1–R-13 rights | the plugins above + `dsh-rights` | auditor invariants |
  | D-1/D-5–D-8 duties | gates + attestation teaching + register | auditor invariants |
- **[C] capabilities provided**: none yet (confinement, multi-agent,
  scheduling, memory, federation — wake their parts when provided).
- **[O] optional clauses adopted**: none yet.
- **Standing sought**: basic (floor) → full as capability parts land.

## 2. Enforcement register

To be generated per phase: `clause ID → enforcing package → verifying test`.
Registered so far (v0.1.0 of the gate package, v0.2.0 of the approval
package — partial floor only):

| Clause | Enforced by | Verifier |
|---|---|---|
| R-3 (envelope shape, partial — first slice) | `packages/allowlist-gate/src/allowlist.js::envelope` | `test/allowlist.test.js::denial envelope carries rule ID, reason, lawful next moves` |
| I-5 (gates — layered approval, partial) | `packages/approval/src/evaluate.js::evaluate` (five ordered layers over `GrantStore`) | `packages/approval/test/evaluation.test.js`, `packages/approval/test/answerer.test.js` |
| I-5 (gates — the human gate composed, partial) | `packages/approval/src/index.js::approvalPlugin` — ask via `tools/pre-execute`, decision materialized by the `approval/request` answerer, flood cap enforced pre-dispatch | `packages/approval/test/composed.dsh.test.js::deny→ask→approve→replay-hit cycle in the real runtime` |
| I-4 (denial envelope — ask/deny paths, partial) | `packages/approval/src/index.js` (envelopes carry rule ID + lawful next moves into the ask `reason`) | `packages/approval/test/composed.dsh.test.js::the ask envelope lists lawful next moves`; envelope lint over every refusal path: `packages/approval/test/envelope-lint.test.js` |
| D-7 (fail-closed, decisions from recorded state — grant durability) | `packages/approval/src/persist.js::PersistentGrantStore` — grants/budgets/revocations survive restart; corrupt store refuses the boot (no silent reset → no privilege resurrection); pending asks deliberately do not persist (park, not checkpoint) | `packages/approval/test/persist.test.js::a corrupt store file fails the boot loudly`; `::pending-approval bookkeeping never survives a restart` |
| I-5 (gates — budgets) | `packages/approval/src/grants.js` (`maxUses`/`uses`) + `evaluate.js` (consumption at the answering layer) | `packages/approval/test/budget.test.js` |

Conventions recorded (verified against installed dsh `~0.1.5-rc.1` types):
the plan's dotted `grants.*` command names are not legal in the host
command grammar (`/^[a-z][a-z0-9_-]*$/`) — the faithful adaptation is
`grants-grant` / `grants-list` / `grants-revoke`. dsh has no native
`allowed-always`: the only native grant is `allowed-once`, so this plugin's
grant store IS the runtime's grant layer; `allowed-once` decisions
materialize exec-cache entries (fingerprint-level, TTL, cross-session).
The host `ApprovalService` owns the `approval/asked`/`approval/decided`
audit pair; this composition never appends it.

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
