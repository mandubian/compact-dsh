# Concept: Layered Approval & Grants

Compact bindings: R-3 (reasons) · I-5 (gates) · D-7 (fail-closed, decisions
from recorded state) · D-8 (no rogue enforcement). Predecessor: approval
system, five dedup layers.

## The concept

Dangerous acts pass through **gates**. A gate is not a single checkpoint but
an **ordered evaluation of grant layers**, checked top-down; the first layer
that answers wins, and every answer is recorded. The layers:

1. **Exec cache (fingerprint-level).** Identical operations grant
   deduplicate. The fingerprint is computed from a *canonicalized* call —
   same operation on the same target is the same call, however phrased.
   Entries carry a TTL (default ~24h, 0 disables). Concrete targets only.
2. **Plan grants.** An approved plan envelope materializes standing grants
   for the acts it describes.
3. **Session grants (target-level).** Scoped grants with pattern targets —
   `ExactHost`, `HostSuffix`, `HostAndPort`, `UrlPrefix` — at a scope
   (root/session), with optional expiry, revocable at any time.
4. **Existing approvals.** An already-approved, still-pending request
   deduplicates instead of re-asking.
5. **Flood cap.** Unanswered pending requests per root are capped
   (default ~50); over-cap requests are rejected loudly, not queued
   silently.

## Invariants

- **Order is the semantics.** The same call may match several layers;
  evaluation order decides which grant is consumed and what is recorded.
- **Denials are envelopes.** A refusal carries: acting party, rule, reason,
  lawful next moves. "Denied" without "why" and "what remains" is arbitrary
  authority.
- **Canonicalization is security.** Fingerprint identity depends on the
  canonical form (host lowercase, URL prefix-anchored, ports exact). Weak
  canonicalization = grant confusion.
- **Grants are scoped and expiring.** No blanket grants, no implicit
  escalation: widening requires a new grant through the gate.

## Mapping to a runtime (host-agnostic)

The layers are pure decision logic over (call, grants, now) — testable
without any host. The host provides: where the gate hooks (tool-call
interception), where grants persist, and where envelopes are rendered.
On dsh: `tools/pre-execute` waterfall + the grant store (port plan Phase 1).
