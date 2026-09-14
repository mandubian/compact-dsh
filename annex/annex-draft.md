# dsh Annex — DRAFT (no standing yet)

**Runtime**: DeepSeek Harness, `@deepseek-ai/dsh ~0.1.5-rc.1` ·
**Composition**: the `autonoetic-dsh` plugin set · **Status per F-5:
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
Registered so far (v0.1.0 of the gate package, partial floor only):

| Clause | Enforced by | Verifier |
|---|---|---|
| R-3 (envelope shape, partial — first slice) | `packages/allowlist-gate/src/allowlist.js::envelope` | `test/allowlist.test.js::denial envelope carries rule ID, reason, lawful next moves` |

## 3. Role mapping (draft)

- **Enforcer**: the `autonoetic-dsh` plugin composition on a pinned dsh.
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
