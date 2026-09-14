# Concept: Constitution Coupling — the law and its enforcement, mechanically bound

Compact bindings: F-5 (annex) · D-8 (annex is an affidavit) · A-2
(entrenchment) · A-4 (Enforcer code is constitutional). This is the
Compact's differentiator; predecessor: the enforcement register +
`every_parseable_citation_resolves`.

## The concept

A constitution is only as strong as its coupling to enforcement. The
Compact binds the two **bidirectionally and mechanically**:

- **Downward — no decorative law.** Every clause in force maps to: the
  package that enforces it, the verifier that proves it, and a cited test.
  A clause whose register row cannot resolve is unimplemented, and a
  runtime claiming it fails at boot.
- **Upward — no rogue enforcement.** Every piece of enforcing code
  registers the clause IDs it enforces. Code acting without an authorizing
  clause is a violation by the Enforcer (D-8), not a feature.
- **Composition coupling — the boot refusal.** The constitution service
  declares requirements on services only the enforcement packages provide.
  Missing enforcement = boot failure, not degraded mode. The composition
  either enforces the law or does not start.
- **Verifier strength.** A verifier is an executable check that can fail;
  its failure mode and an example failing input are recorded. A verifier
  that cannot fail proves nothing.
- **The law table.** Generated incidence view: every clause → bound roles,
  invokers, against whom — completeness- and symmetry-linted (every duty
  has its corresponding claim).
- **Convention, labeled.** Anything not mechanizable on a runtime is
  declared *convention* in its annex — visibly, and never counted as
  enforcement.

## Invariants

- Clause IDs are the join key across body, register, law table, and tests;
  renames update all four together (CI enforces the join).
- Weakening an entrenched clause's enforcement is weakening the clause
  (A-2/A-4): editing enforcing conduct without editing the annex row is
  enforcement fraud.
- The register is public: conformance claims are auditable by anyone,
  offline, without the Enforcer's cooperation.

## Mapping to a runtime

On dsh: the constitution plugin (boot verification, rule registry,
inject-based composition coupling) + the generated register under
`docs/register/` with a verify gate (port plan Phase 4). Generalization:
any host that can (1) refuse to boot, (2) cite tests, and (3) expose
records can be a Compact jurisdiction.
