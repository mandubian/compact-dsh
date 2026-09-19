# Concept — Secret Grants (injection under agreement)

*The implementation-agnostic spec for the secret-injection capability. Cited
by the register's I-5 entries; `packages/approval` (the agreement) and
`packages/sandbox-docker` (the injection) implement it.*

## The question

An agent legitimately needs a credential inside confinement — pushing to a
remote, pulling a package, decrypting a file. Two bad answers exist:

- **Tell the agent the secret.** It enters model context, and the Compact's
  completeness invariant (model-visible ⟺ logged) means the record now holds
  the secret forever, provably attached to this Member.
- **Deny the capability entirely.** Safe, but a jurisdiction that cannot let
  a Subject push its work to a remote is a cage with good documentation.

## The third answer: injection under agreement

The Subject never holds the secret; it holds a **reference**:

1. **Declaration (D-8).** The composition declares which secret refs exist —
   environment variable NAMES (`GH_TOKEN`), never values. Declaring none is
   the capability-absent posture: nothing is injectable, enforced by the same
   lookup that would inject.
2. **The agreement (I-5).** When a gated call's command references a declared
   ref (`$GH_TOKEN`), the ask envelope says so, and approving it
   materializes a **SecretGrant** — session-scoped, TTL-bounded, revocable —
   in the same grant store as every other grant. The operator therefore
   agrees to exactly one thing: "this session's confined calls may receive
   this credential, for this long."
3. **The injection (CF-1).** At confine time the provider resolves each live
   ref from the Enforcer's environment and adds `--env REF=<value>` to the
   container argv. The value transits provider→daemon only.
4. **The boundary.** The value never enters model context, the session log,
   or the grant store. The store records the NAME; a store file carrying a
   value field refuses to load.

## What is honestly exposed

Once the command runs with the secret, the command can *print* the secret —
`env`, a careless flag, a chatty tool. That exposure is inherent to
execution and is disclosed three ways: the ask envelope names the injection
before the operator agrees; the grant is scoped and expiring so exposure has
a boundary; and the leak detector (`credentialShapeIn`) warns on the
operator's log when output carries a credential shape — without altering the
record, because the record must remain what the Subject actually saw.

## Why this composes with the invariant

Every secret flow that passes *through* the model becomes unremovable
evidence. Injection-at-execution is the only flow where the secret never
enters that set at all — so it needs no redaction, no ViewerClass, no
exceptions. It is the one secret mechanism that treats the record as
inviolable *and* keeps it clean, by keeping the two apart.
