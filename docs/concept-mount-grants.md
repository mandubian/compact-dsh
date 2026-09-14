# Concept: Mount Grants & Cure-on-Retry

Compact bindings: R-3 (denial envelopes) · I-5 (gates) · D-5 (absent
parties) · D-8 (no undeclared capability). Predecessor: sandbox mount
grants (#1002 slice 5).

## The concept

Sandboxes declare what they mount. When a call requires a mount that is
neither declared nor granted, the denial is not prose — it is a
**machine-readable grant request**: path, mode (ro/rw), and scope. On
approval, the request **materializes a scoped mount grant** (canonical-path
prefix coverage, per-grant ro-ceiling, TTL, revocation) and the *same call
retried* now passes. The denial cured itself through the lawful channel.

## Invariants

- **Protected paths are never grantable** — system internals, secrets,
  other Members' records. The envelope says so terminally: no gate exists
  to approve this, by constitution.
- **Missing paths are never grantable** — mounting what does not exist is
  a malformed request, refused without a gate.
- **The cure is the recorded approval.** No out-of-band "the operator said
  it was fine": the grant row *is* the operator's decision, hash-chained.
- **Ceilings hold.** A ro-grant never upgrades to rw; prefix coverage
  never expands by symlink or path trickery (canonicalize, then match).

## Mapping to a runtime

Grant logic is pure (path canonicalization, prefix coverage, ceiling
check). The host provides the mount enforcement point and the approval
channel. On dsh: the sandbox provider's bind configuration + the Phase 1
approval store (port plan Phase 2). Generalization: this is the universal
pattern for *any* resource grant — denial carries the request; approval
materializes the scoped right; the retry proves the cure.
