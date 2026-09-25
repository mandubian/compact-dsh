# Decision record — consent identity is risk identity (fingerprint effect classes, G3/G5 residual)

**Status: ADOPTED (status updated 2026-09-25 — the header now moves with the
enforcement it describes).** Drafted 2026-09-22 against
[#26](https://github.com/mandubian/compact-dsh/issues/26) and the secret-hygiene
audit's G3/G5 ([#8](https://github.com/mandubian/compact-dsh/issues/8)). What
adoption has already moved, per position (details at each heading):

- **Position 2 (G5) — ADOPTED** (the query joins the replay identity;
  `canonicalQuery`, secret-hygiene slice `6e46f58`, PR #63).
- **Position 3 (G3) — ADOPTED** (the rendering split;
  `redactEmbeddedSecrets` on every rendered surface, `6e46f58`, PR #63; the
  deciding-preview masking `35f7bae`, PR #9).
- **Position 1 — ADOPTED in full (2026-09-25)**: the network half (the
  method class joins the ask identity and the grant; the #38 phase-3 slice,
  `f8216f3`) and the bash effect-class half (the closed read-only vocabulary,
  class+verb identity, the null-class command-scoped fallback) — adjudicated
  in `docs/decision-bash-effect-class.md`, adopted by the slices #85 (option
  A) and #88 (option B).

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

**Status: ADOPTED in full (2026-09-25).** The network half: the method class
rides the ask identity and the grant — `fingerprint.js` hashes the declared
class, the grant stores it, the mediator enforces it per connection (the #38
phase-3 slice, `f8216f3`). The bash effect-class half: adjudicated in
[`docs/decision-bash-effect-class.md`](decision-bash-effect-class.md) and
enforced by the adoption slices [#85](https://github.com/mandubian/compact-dsh/pull/85)
(option A — the command-scoped fallback) and
[#88](https://github.com/mandubian/compact-dsh/pull/88) (option B — the
closed read-only vocabulary, the null-class fallback, the compound rider
closed; granularity tightened to command-scoped-everywhere on adoption
review).

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

**Status: ADOPTED** (the query joins the replay identity — `canonicalQuery`,
sorted name=value pairs, one-way payload only; secret-hygiene slice `6e46f58`,
PR #63; the residual wording lives in the ask and the decision notes).

Tightening (cache keyed on the full URL) reintroduces the hygiene problem G3
fights: query strings are where credentials ride, and putting them into
fingerprints, `approvals.json`, and attestation lines persists exactly the
material canonicalization exists to keep out. **Accepted, therefore, with the
abstraction declared**: replay identity is canonical target identity — and the
surfaces must say "the same canonical target replays", not "the identical
operation", wherever a URL with a query was what the operator was shown. The
operator preview already shows the actual URL (query included); the deciding
envelope and the notes use the canonical phrasing. (Adopting position 1
narrows the residual further: the method class travels with the identity even
when the query does not.)

### 3. G3 — keep the path load-bearing; shape-hash it where it is rendered, not where it is granted

**Status: ADOPTED** (the rendering split — every rendered surface passes
through the credential-shape catalogue `redactEmbeddedSecrets`; the identity
keeps the path verbatim; `6e46f58`, PR #63, and the deciding-preview masking
`35f7bae`, PR #9).

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

## What adoption touched — all of it, landed

1. `fingerprint.js`: the declared method class joins the payload (`f8216f3`),
   the query joins it (`6e46f58`), and the bash effect class joins it as the
   null-class fallback — unprovable commands are command-scoped, target-ful
   included; every target-less call is command-scoped (`#85` + `#88`);
   canonicalization of the existing fields
   never moved, `evaluate.js` needed nothing (the verdict already carries the
   fingerprint), and grants carry the method axis as they always have.
2. The analyzer boundary held as sketched: one authority, one import
   direction — the effect class is derived by the same analyzer that finds
   network targets and method classes; approval reads the classification and
   never derives it.
3. Wording: ask consequence sentence + decision note + receipt ("canonical
   target" phrasing), per position 2 — landed; the ask gained the
   unprovable-command sentence per position 1's bash half.
4. Preview/budget-line shape-hashing, per position 3 — landed.
5. Register evidence lines for I-5: the method-class half (in #38's slice)
   and the bash half (moved with its adoption slices, `#85` + `#88`) — the
   register moved with the enforcement, never before it (A-4).

## Non-goals

- No mediation-layer semantics here — the host-side proxy and the CF grant
  family are #38's phases 2–3, [decided there](decision-network-egress-proxy.md);
  this record only fixes the identity those
  grants must share ("fingerprint and grant must share the identity"), and that
  record folds this one's method-class axis in for the network family.
- No autonoetic credential vault — dsh's CredentialRef model stands; G2's
  output-side secret detection is its own adjudication.

## The approval-at-rest adjudication (#75) — DRAFTED, PENDING DECISION

Status: the three options below are **drafted for adjudication, none adopted**
(2026-09-24, filed from the issue). The record adopts one by amendment; where
the decision changes matching semantics or the store format, the register
evidence moves with it (A-4, `[baseline-update]`) — never before.

**The finding.** G3's adjudication kept the true URL path in the persisted
canonical targets (`approvals.json` cache entries and `UrlPrefix` grant rows)
because identity must stay exact — a redacted identity collides distinct
credentials and lets one webhook's approval replay for another. The residual
was declared (I-8), and the plumbing was hardened: the store file is `0600` on
every flush (the rename re-asserts it), created dirs are `0700`. What those
edits deliberately did NOT answer: **is there an at-rest design that removes
the plaintext without corrupting matching semantics?** Recorded so it is
adjudicated, not improvised — design decisions, not unilateral fixes.

**The threat boundary, stated honestly first.** No file mode, and no
encryption with a key that boots beside the data, defends against the
operator's own uid or root — that class is out of reach by construction. The
launcher's `0700` state root already excludes other local users, and the
owner-only store file closes the relocation regressions. What remains exposed
is **at-rest copies** — backups, snapshots, volume images of the state dir
that travel without the operator's keyring. That is the only adversary any
option below actually addresses.

**Option A — encrypted vault (autonoetic's design).** Persist `vault:k:ref`
placeholders; decrypt on load; hydrate true values in memory. What the vault
bought there: secrets were *inputs the agent requested* — artifacts carried
references because nothing matched against the value. Why it does not
transplant: here a path credential is part of the operation's *identity* —
allow-once replay, revocation sweeps, and `UrlPrefix` coverage all compare the
live call against the stored form, so every consumer (matching, the egress
mediator's per-connection reads, `describePattern`) needs reconstruction
machinery. What it would buy here: protection of at-rest copies — and only if
the operator splits the key onto other media; with the key in the same trust
root (the default, F-5), it is ceremony wearing a lock. Cost: a store format
bump (v3), a hydration layer, a key-management surface. (The record's
"no autonoetic vault" non-goal stands — that refusal was the CredentialRef
*delivery* model; this option is about the store's persisted *identity*, which
is why it is adjudicated here rather than assumed.)

**Option B — HMAC-encoded matching (no vault, no key distribution).** The
secret always rides *live args* at ask/fingerprint time; the persisted form
only ever needs to be **compared**, never reconstructed. Encode the persisted
target as `{cleanPrefix, mac(tail)}` with a per-store salt; revocation
matching becomes prefix-equality + mac-equality. What it buys: the plaintext
genuinely leaves the file — at-rest copies included — with no key to co-locate
or split. What it costs: it quietly downgrades `UrlPrefix` semantics
(prefix-over-path becomes prefix + exact tail — the grant stops covering
paths the operator's click implied), it touches the security-critical
matching path (subtle-bug surface where none exists today), and it is a store
format bump (v3) with migration, every renderer agreeing on the encoding.

**Option C — declared residual (the current posture).** Keep plaintext, keep
the declared residual, keep the owner-only plumbing. The store is Enforcer
state (`protectedState`), operator-owned — the same trust class as
`~/.ssh/id_rsa`. Zero churn, zero new machinery, and the G3 residual stays
exactly as documented.

| | at-rest copies | matching semantics | churn | new key surface |
|---|---|---|---|---|
| **A** encrypted vault | protected only with a split key — ceremony otherwise | unchanged, but every consumer reconstructs | store v3 + hydration | key management |
| **B** HMAC matching | tail plaintext removed (clean prefix remains) | `UrlPrefix` downgraded to prefix + exact tail | store v3 + migration | per-store salt only |
| **C** declared residual | exposed, as declared | unchanged | none | none |

**The recommendation, not the decision**: C, with B as the honest upgrade
path if at-rest copies ever become an adversary the composition actually
declares — and B then lands with its `UrlPrefix` semantics change adjudicated
in the same slice, never "quietly". A needs a key-placement design first;
without the split key it claims protection its placement cannot prove. The
doctrine the decision keeps in view either way: **an at-rest mechanism that
cannot fail loudly should not claim more than its key placement proves** —
whichever option is adopted, the residual that remains (copies that travel
with the key, and the same-uid/root class) is stated in the same breath. The
decision is the Principal's.
