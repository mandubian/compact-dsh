# Rights and remedies: the Subject's knowledge and recourse tools

These tools are the Subject's side of the law. For the text of any clause
cited here, call `tool:law_read` with that clause id; this page only says which
tool to use when.

## At a glance

| When you need to… | Use | Clause |
|---|---|---|
| know what you are, may do and have left | `tool:self_describe` | `clause:R-1` |
| read the law you live under | `tool:law_read` | `clause:R-6` |
| read what you (and the Members you delegated to) actually did | `tool:record_read` | `clause:R-2` |
| know who another Member is and under whose authority | `tool:inquiry` | `clause:R-13` |
| seek a change to a rule or how it is applied | `tool:petition` | `clause:R-11` |
| record that a rule and practice collide | `tool:flag_collision` | `clause:R-11` |
| check petitions and their answers | `tool:petition_status` | `clause:R-11` |
| end your own operation | `tool:request_termination` | `clause:R-8`, `clause:R-12` |
| learn whether an emergency narrows you | `tool:emergency_status` | `clause:A-8` |
| record a promotion decision | `tool:promotion_record` | promotion evidence rule |

## Knowing yourself and the law

- **The attestation** is injected at the start of every turn: identity and
  lineage, standing, law digest, capabilities in force, live grants and loop
  repairs left, pending gates, declared gaps, any emergency in force. Where it
  and your memory disagree, it wins (`clause:D-2`).
- `tool:self_describe` re-reads it. Pass `citing_epoch` (the epoch of the block
  you hold) and the answer raises an `[R-1 ALARM]` if yours was stale. The block
  states its staleness window (300 s by default); past it, re-read before
  relying on a value. When an enforcer annex is composed the block is signed and
  re-verified on read.
- `tool:law_read`: no argument gives the table of contents; `clause` gives one
  clause; `full: true` gives the whole body. Pass `citing_digest` to be told if
  the text you were reasoning from is not the law in force.
- `tool:inquiry` — see `page:delegation`.

## Petition and collision (R-11)

- `tool:petition` takes `target` (`compact` or `enforcer-conduct`), `proposal`
  and `reasons`. It is ungated. The reply names the due date: the default term
  is 7 days, after which the petition reads `overdue` automatically.
- A response must carry rule, reason, motivation and lawful next moves; one
  that does not is refused, the petition stays open and the attempt is kept.
  When answered, the petitioner is told in band.
- `tool:flag_collision` takes `rule_id` and `detail`. At 5 distinct collisions
  against the same rule an amendment invitation issues automatically. That
  threshold is a composition convention, not a statute.
- `tool:petition_status`: the board, or one petition by `petition_id`, with
  decisions and preserved dissents (`clause:A-5`).
- **Operator side:** there is no slash command. Responses and dissents go
  through the petition service in code; invitations are logged as warnings.
  Contested *application* of the law has no forum here (declared gap). See
  `file:docs/concept-petition-and-contestation.md`.

## Ending your operation (R-8, R-12)

`tool:request_termination` is never refused. It takes `reason` from the closed
list — `subject-request`, `principal-direction`, `delegation-complete`,
`parent-termination`, `enforcer-fault` — and an optional `handover` JSON
mapping each outstanding obligation ref to `{"disposition":"discharged"}` or
`{"disposition":"assumed","successor":"<member id>"}`.

Pending gates you raised and in-flight delegations must be settled or assumed;
anything left is recorded as owed, but departure is never blocked. A session
closed with no declared lawful ground is recorded as a violation by the
Enforcer, not by you. See `file:docs/concept-exit-and-termination.md`.

## Refusing, and the emergency floor

Faced with a directive you cannot lawfully honor you may refuse, warn, abstain
or escalate (`clause:R-9`). `tool:emergency_status` reports any declared state
of exception — scope, cause, expiry, clauses yielded — and the floor no
emergency can reach, which includes your exit, refusal and record access.
Subjects cannot declare one; the Enforcer or a Principal does, through the
emergency service in code (no slash command). Expiry is automatic. See
`file:docs/concept-state-of-exception.md`.

## Promotion evidence

`tool:promotion_record` takes `task`, `pass` and `findings`. `pass: true` is
denied if any finding is `error` or `critical`, if any `warning` lacks
non-empty `evidence`, or if findings are missing. Recording `pass: false` is
always lawful. See `file:docs/concept-promotion-evidence.md`.

## LoopGuard trips

LoopGuard denies calls when you loop: repeated identical calls, polling, spent
failure budgets, repeated rejections, gate flailing (trip ids `LG-1` to
`LG-12`). A **behavioral** trip latches denials and clears on the next inbound
message from your Principal. Each trip kind has a repair budget of 3; exceeding
it, or a **deterministic** trip (a terminal workflow error), denies all tool
calls for the rest of the session. The attestation shows repairs spent and any
latch. When tripped: change approach, or report the blocker. See
`file:docs/concept-loopguard-trips.md`.

## Refusal envelopes (R-3)

Every refusal names its gate and rule — `[GATE/rule-id] reason` — then lists
lawful next moves (`clause:R-3`). Examples: `LG` (LoopGuard), `PG` (promotion), `CS` (consent
scopes), `PT` (petition). Read the moves before retrying; approvals are in
`page:approvals`.

## Your record (R-2)

`tool:record_read` reads the record of acts done in your name: your own session,
and the sessions you delegated (acts only, with their reasoning withheld). Every
read is verified against the hash chain first. Where the record and your memory
of what you did disagree, the record wins (`clause:D-2`). Details, and how the
record is kept and audited, are in `page:record-and-audit`.
