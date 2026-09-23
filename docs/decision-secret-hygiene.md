# Decision record — secret hygiene: G2 posture, G3 rendering split, G5 replay identity

**Status: DECIDED.** Recorded 2026-09-23, before the work. Discharges the
adjudication owed by the secret-hygiene audit (issue #8, 2026-09-18). The
register moves with the enforcement changes (A-4): I-5 carries the replay
identity and the rendering discipline, R-1 the attestation's redacted
renderings; this PR declares itself with the `[baseline-update]` prefix.

## The constraint the audit left open

The port plan deliberately dropped autonoetic's credential vault in favor of
dsh's CredentialRef model. The audit confirmed the composition safe on
container env, refusal envelopes, the deciding preview, and grant persistence
— and left three design decisions. This record adjudicates all three.

## G2 — workspace credential files: teach, redact, declare; do not classify

**Decision: no content-level secret detection over tool output.**

The exfil channel for a workspace secret is the model-facing surface itself —
but the answer is not a detector in this composition:

- **A warn-only scanner is rejected**: warnings that fire on ordinary
  workspace content train the operator to dismiss them; a gate that cries
  wolf is a gate turned off.
- **A detection/classification layer is rejected for this composition**: the
  approval gate is target-blind by construction (R-10), and a content
  classifier over tool output is a different machinery — D-7 territory, the
  same line the secret-grant scoping already draws ("widening detection is a
  content-classifier's job, not a name match").
- **What is done instead**: the Subject is taught (the law's own appendix,
  R-1's "is taught this"), and the Enforcer's own renderings stop
  multiplying credential material into model context (G3 below). The
  residual posture is **declared as a gap on the approval service** and
  reaches every attestation (I-8) — the composition says what it does not
  do, where the governed party reads.

## G3 — URL path credentials: identity keeps the path, renderings lose it

**Decision: the rendering/identity split.**

`canonicalTarget` strips userinfo and query but keeps the pathname, because
the path is load-bearing for UrlPrefix grant scoping — so
`https://hooks.example.com/services/T00/B00/SECRET` carried its token into
every surface. The split:

- **Identity keeps the true path.** Fingerprints, grant rows, cache targets
  and matching see the exact canonical form. A redacted identity would make
  two distinct webhooks collide — one allowed-once replaying for another is
  strictly worse than a stored secret, and a silent widening is the D-7
  direction.
- **Renderings are redacted.** The deciding view, transcript notes (#25),
  replay receipts (#40), `grants-list` output, and the attestation's budget
  block (`describePattern`) pass through `redactEmbeddedSecrets`, which now
  masks the credential path families — `services|webhooks|hooks|tokens|keys|
  secrets|credentials|oauth2` — from the family segment onward
  (`.../services/***`). The same closed-list, known-shape doctrine as the
  query and header rules: no entropy guessing, and ordinary API paths render
  verbatim. The userinfo masking set this precedent; the operator decides on
  the same masked rendering every other surface carries.
- **Declared residuals, not hidden ones**: the canonical target persisted in
  `approvals.json` keeps the true path (it is the matching/revocation form,
  in the operator-owned 0700 trust root), and the act itself is recorded
  under its raw argv (R-7 records the act; not recording it honestly would
  be a worse defect). Both are stated here and in the G2 gap line.

## G5 — exec-cache query variants: tightened

**Decision: the query string joins the replay identity.**

The old identity stripped the query, so one `allowed-once` on
`https://host/v1` authorized `https://host/v1?key=ANYTHING` until the TTL —
the operator consented to an operation and the replay covered every query
variant of its target. A query is **operation parameters, not target
spelling**: `fingerprint` now folds in `canonicalQuery` — sorted
`name=value` pairs, so parameter order is phrasing, not identity, and
repeated names collapse — while an added, changed, or removed parameter is a
different operation that re-asks. `allowed-once` now means what it says:
exactly the operation shown, once per TTL.

- **Wide coverage remains possible — as a grant, explicitly**: UrlPrefix
  matching is unchanged (prefix over path; grants match raw URLs regardless
  of query), so the operator who wants every query variant covered grants
  that scope through the lawful channel instead of receiving it silently.
- **Upgrade cost, stated**: persisted cache entries keyed on the old
  query-stripped fingerprint never match again and lapse within the TTL —
  a one-time mass re-ask, fail-closed. No store format change (entries are
  fingerprint-keyed; old entries simply expire).
- **Golden vectors move with the decision**: the pin that collapsed
  `?key=secret` into the bare target is inverted — "a canonicalization
  change that breaks one of these is a security-relevant change, not a
  refactor"; this record is that security rationale.

## Acceptance

One annex line per decision (annex draft §2); the register moved with the
enforcement change (I-5, R-1); golden vectors, rendering tests, and the
self-model attestation tests pin the split.
