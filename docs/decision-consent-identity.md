# Decision record — consent identity is risk identity (fingerprint effect classes, G3/G5 residual)

**Status: PROPOSED — awaiting adjudication.** Drafted 2026-09-22 against
[#26](https://github.com/mandubian/compact-dsh/issues/26) and the secret-hygiene
audit's G3/G5 ([#8](https://github.com/mandubian/compact-dsh/issues/8)). Constitutional
under A-4 (recorded before the work); not enforcement until adopted — nothing
here changes a fingerprint, a grant, or an envelope.

## The principle

**Consent identity is risk identity.** The fingerprint may abstract over
*phrasing* — the same act however phrased is the same act, and that abstraction
is what makes replay honest (`curl` vs `python`, same GET → one approval). It
must never abstract over a dimension that changes the **risk the operator was
shown**. Where a risk dimension cannot be determined statically, the act
re-asks or fails closed (D-7) — abstraction by guessing is the quiet expansion
of consent.

Grounding: an approval that covers more than what was shown overclaims consent
(D-8's overclaim principle at the grant layer); R-3/I-4 require the ask to be
informed; R-5's inverse — capabilities are not quietly *expanded* any more than
narrowed.

## What today's fingerprint abstracts over, and what that costs

The fingerprint hashes `{tool, canonicalTarget}` only:

| Abstraction | Cost | Bounded by |
|---|---|---|
| no method class — `GET` and `POST` to one URL are one identity | approving the read covers the state-changing act | confinement (no egress today, #38); becomes live with any egress posture |
| no effect class — bash collapses to the tool name for targetless commands | `ls` and `rm -rf <workspace>` are one identity | the command-aware exception covers only declared-secret commands; otherwise targetless calls abstain (no cache materializes), so today this is latent, not live |
| query/userinfo stripped from URL identity (G5) | one `allowed-once` on `/v1?key=A` covers `/v1?key=B` until TTL | grant *matching* uses raw args, so the variant direction re-asks; the replay direction is the exposure |
| URL pathname kept verbatim (G3) | credential-shaped path segments (`/services/T00/B00/SECRET`) persist into fingerprints, `approvals.json`, attestation budget lines, and the operator preview | shape; no detector today |

## Proposed positions

### 1. Effect class joins the fingerprint — derived by ONE authority (#26)

Extend the fingerprint payload with an **effect class**, derived by the same
static analysis that already gates network targets and informs read-only vs
workspace-write (no second derivation, no drift):

- network acts → **method class** (read vs state-changing); a structured tool
  declares it from its schema; a fetch without a declared method fails closed.
- bash → **effect classification** (read-only vs mutating) where the analyzer
  is confident; anything opaque → D-7 fail-closed: the act re-asks, never
  silently shares an identity with a safer sibling.
- grant patterns gain the same axis (a `*.example.org` grant is a grant to
  READ it until the CF grant family adds method scopes).

Pinning tests as worked examples: GET→GET replays; GET→POST asks; `ls`→`ls`
replays; `ls`→`rm -rf` asks; `curl`→`python` same-GET replays.

Register: I-5/R-3 conduct refinement (evidence text), no clause re-grading.

### 2. G5 — replay identity stays canonical target identity; the wording stops overclaiming

Tightening (cache keyed on the full URL) reintroduces the hygiene problem G3
fights: query strings are where credentials ride, and putting them into
fingerprints, `approvals.json`, and attestation lines persists exactly the
material canonicalization exists to keep out. **Accepted, therefore, with the
abstraction declared**: replay identity is canonical target identity — and the
surfaces must say "the same canonical target replays", not "the identical
operation", wherever an URL with a query was what the operator was shown. The
operator preview already shows the actual URL (query included); the deciding
envelope and the notes use the canonical phrasing. (Adopting position 1
narrows the residual further: the method class travels with the identity even
when the query does not.)

### 3. G3 — keep the path load-bearing; shape-hash it where it is rendered, not where it is granted

Stripping path components wholesale breaks `UrlPrefix` grant scoping — the
path is grant semantics, not decoration. Proposed: the identity keeps the path
(prefix matching unchanged), while every **rendering/persistence surface**
(the operator deciding preview, attestation budget lines, and — if a future
feature ever renders them — grant listings) passes path segments through the
credential-shape catalogue (`redactEmbeddedSecrets`'s detector, already the
one authority for what a credential looks like) so `…/services/T00/B00/SECRET`
renders as `…/services/T00/B00/***` everywhere a human or the record reads it.
The fingerprint itself stays a one-way hash — no new surface there. Residual,
documented: the full path persists inside `approvals.json` cache targets;
accepted because that file is Enforcer state (`protectedState`), not Subject-
or record-readable. If that file ever leaves the Enforcer boundary, position 3
must be revisited (A-4 discipline).

## What adoption would touch

1. `fingerprint.js` (effect class in the payload — golden vectors gain the new
   axis; canonicalization of existing fields does not move), `evaluate.js`
   (nothing — the verdict already carries the fingerprint), grants
   (`parseAllowlistLikePattern` + `patternMatches` gain the method axis).
2. The analyzer boundary: one authority, one import direction (approval reads
   the classification; the analyzer never reads approval state).
3. Wording: ask consequence sentence + decision note + receipt ("canonical
   target" phrasing), per position 2.
4. Preview/budget-line shape-hashing, per position 3.
5. Register evidence lines for I-5 (fingerprint effect classes), G3/G5
   residuals as documented posture.

## Non-goals

- No mediation-layer semantics here — the host-side proxy and the CF grant
  family are #38's phases 2–3; this record only fixes the identity those
  grants must share ("fingerprint and grant must share the identity").
- No autonoetic credential vault — dsh's CredentialRef model stands; G2's
  output-side secret detection is its own adjudication.
