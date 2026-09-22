# Decision — rehearsal-complete signatures (development keyring)

Status: adopted for implementation on `feat/rehearsal-seals`. Upstream basis:
mandubian/compact PR #5 (merged 2026-09-20) — amendment 0004, the development
keyring, `tools/sign_dev.mjs`, and the review ledgers that fixed the
distinct-signer threshold defect.

Amended during review before implementation: the authority/enforcer boundary
below follows F-5's actual structure — **the Compact's authority keys sign law
artifacts only, and never sign Enforcer identities.** The original checklist's
"enforcer identity certificate signed 2-of-3 by authority keys" is corrected to
"Enforcer key declared and signed in the annex" (see §7); the reasoning is
recorded there because it is the one place this design could have quietly
grown a CA.

## What "rehearsal" means here (the label discipline)

Rehearsal-complete means: every signature-dependent clause has its machinery
exercised end-to-end with labeled practice keys, and every label stays true.
The labels are not decoration; they are the compliance surface:

- Every artifact this machinery emits or verifies carries the declaration in
  its own body (`standing: 'none — … code-path correctness only'`), so the
  honesty label travels with the bytes (I-8).
- No register clause moves from `planned` to `enforced` because of this work.
  I-1, I-3, A-1 stay planned; what changes is that their machinery exists,
  runs, refuses, and is tested.
- Presenting a dev-keyring signature as ratification, standing, or identity is
  enforcement fraud (D-8) — the amendment defines it, and this composition's
  refusal envelopes inherit that wording.

The scheduled cure is the amendment's own: *ratification replaces the keyring
manifest; runtimes swap keyring configuration, not code.* Every design below
is judged by that sentence — anything that would need a code change (not a
manifest/annex swap) at ratification is a defect.

## The authority boundary (the correction this record carries)

A-1's trust root is the **amendment authority**: it enacts law — body seals,
amendment instruments. That is its entire jurisdiction. Runtime standing works
differently: F-5 has the Enforcer adopt the law through **its own signed
annex** (conformance declaration, register, role mapping — including which key
is the Enforcer), and its binding force comes from refuse-to-start plus
verifiability (I-7, D-8's two-way proof), not from a blessing by the amendment
authority. Trust is never claimed; it is shown.

There is deliberately **no CA** in this design. If the Compact's keys
certified runtimes: the compact repo becomes a central PKI over
implementations (contradicting vendor-neutrality), the amendment keys get used
for non-amendment purposes (blast-radius violation), and in rehearsal the dev
keys silently become "the thing that legitimates runtimes" — the crown again.

    Compact authority keys (k-of-n, compact repo)  → law artifacts only:
                                                    body seal, amendment enactments
            │  (no signature link downward — the link is the annex + pinned digest)
            ▼
    Enforcer key (compact-dsh side)                → the signed annex, attestations,
                                                    record anchors, subject certificates
            │  signs
            ▼
    Subject session keys                           → member statements (values, petitions)

The chain from law to runtime is the annex: *"I enforce law digest X; my
Enforcer key is Y"* — signed by Y, anchored to the sealed law by the digest,
verified by the auditor against the runtime's own keyring. Two anchors, joined
by a document, not by a signature from the law's authority. At ratification
nothing crosses this boundary: the real A-1 root signs amendments; real annexes
still bind runtimes by their own keys. (Residual from the law: the trust
root's keyholders appear in a non-amendment role as J-1's recused-adjudication
Witnesses — a governance seat, not a signing relationship. Formal runtime
certification, if ever wanted, is F-8 admission-criteria territory: a
deliberate future statute, not something rehearsal presumes.)

Consequence for keyrings: **no enforcer keys in the law keyring, and no
manifest-v2 roles.** The earlier sketch of a v2 manifest with
authority/enforcer roles is dropped — putting the enforcer key in the law's
manifest would express exactly the link this boundary forbids. The law keyring
keeps the upstream v1 shape (it stays verifiable against the founder's seal
unchanged); the enforcer key lives runtime-side, declared in the annex.

## The one structural fact that makes rehearsal lawful

Private keys under the upstream dev keyring are founder-held and absent here.
This composition can therefore only ever VERIFY founder seals. Everything this
composition must SIGN (annex, attestations, chain anchors, rehearsal
amendments) is signed under a **locally generated rehearsal keyring** — same
formats, same labels, gitignored private half, generated by
`tools/rehearsal-keyring.mjs`. The founder's public seal is vendored as an
interop fixture: the loader test verifies the real upstream seal over the
pinned body digest, so format drift between the two repos fails here first.

Rehearsal keys are practice keys all the way down: the local manifest declares
the same `standing: none`, and nothing in the runtime distinguishes "the
founder's dev keys" from "locally generated rehearsal keys" — both are just
*an installed keyring and an installed annex*, which is precisely how the
ratified swap will arrive.

### How an identity set is generated (the mechanics)

`node tools/rehearsal-keyring.mjs ensure <dir>` produces, from nothing but
`node:crypto` (no dependencies, no external tools; randomness is the OS-backed
CSPRNG):

    <dir>/
    ├── keyring.json            the authority manifest: 3 ed25519 keys
    │                           (threshold 2-of-3), declaration, standing: none
    ├── private/<id>.pem        the authority PRIVATE keys — 0600, gitignored,
    │                           never leave this directory; the amendment
    │                           harness seals law artifacts with these
    ├── enforcer.pem            the Enforcer private key — 0600
    └── enforcer.annex.json     the SIGNED ANNEX (see §3/§7)

Key facts the implementation is pinned to:

- **Formats.** Public keys travel exactly as the upstream keyring ships them —
  SPKI DER, base64 (`MCowBQYDK2VwAyEA…`); private keys are PKCS8 PEM. So the
  founder's manifest, a rehearsal manifest, and (later) the ratified root are
  read by the same parser with no branching.
- **What a signature covers.** Every runtime artifact (annex, attestation,
  chain anchor, subject certificate) is signed over **canonical JSON of the
  artifact minus its `signature` field** — keys sorted at every depth, no
  whitespace — using ed25519 one-shot signing (`crypto.sign(null, bytes, key)`;
  ed25519 signs the message directly, no prehash). Two consequences: the
  artifact's own `kind` field is inside the signed bytes, which is the domain
  separation; and because the signature is over canonical form rather than raw
  file bytes, a file may be re-serialized with different indentation and still
  verify — the *content* is pinned, not the formatting. (Law seals differ by
  upstream contract: they sign the domain-separated message string
  `<subject>-sha256:<hex>` over the artifact's exact raw bytes.)
- **Roles of the three tiers, in file terms.** `keyring.json`'s keys verify
  law seals and nothing else; `enforcer.pem` signs the annex, attestations,
  record anchors, and subject certificates; subject session keys (ephemeral,
  in-memory, issued per session by the self-model) sign member statements.
  Nothing signs across a tier boundary.
- **Verification is generation's mirror.** `rehearsal-keyring.mjs verify`
  runs the same join the runtime runs at boot when
  `COMPACT_ENFORCER_ANNEX`/`COMPACT_ENFORCER_KEY` point at the set, and the
  same one the auditor runs offline: manifest shape → annex self-signature →
  `lawDigest` against the pinned body → `registerDigest` against the bundled
  register.
- **Regeneration is rotation.** `ensure` refuses to overwrite an installed
  set without `--force`, because a new keyring is a new trust basis for
  everything signed under the old one — treated the same way the upstream
  tool treats manifest churn.

## Decisions, by checklist item

### 1. Boot seal verification (constitution package)

Opt-in, then default-on in the blessed composition. `apply()` gains
`config.trustRoot = { kind: 'dev-keyring', manifest, seal, trustedKeyringDigest? }`.
Verification order is the upstream tool's, ported as the reference loop —
including the GLM finding: the threshold counts DISTINCT verified keyIds, a
repeated entry is refused as malformed at artifact-shape time and not counted
again in the loop; unknown keyIds are not counted; digest mismatch, message/
subject mismatch, sub-threshold, and malformed manifests each refuse the boot
with a named reason (D-7: uncertainty blocks). Operators pin the manifest the
way they pin the body: `trustedKeyringDigest` (sha256 hex of `keyring.json`,
symmetric to the existing `trustedDigest`) — nothing signs a manifest; its
authenticity is the repository plus operator custody, so the runtime refuses a
swapped manifest exactly as it refuses a swapped body. The attestation records
the basis: `verified.bodySeal = { basis: 'dev-keyring', threshold,
distinctSigners, keyringDigest, conveysStanding: false }`.

The blessed composition passes `trustRoot` with the vendored upstream
manifest/seal by default (rehearsal posture is on, declared, conveying
nothing); env overrides (`COMPACT_KEYRING_MANIFEST`, `COMPACT_KEYRING_SEAL`,
`COMPACT_TRUSTED_KEYRING_DIGEST`) exist so the amendment harness can point the
same code at a rehearsal keyring after a re-seal. Absent `trustRoot`, behavior
is exactly today's (pin only) — no composition is forced into keys it did not
declare.

### 2. Canonical serialization (the prerequisite, already half-built)

Signatures are over **canonical JSON** — the existing `canonicalize()` from
`packages/record/src/chain.js` (keys sorted at every depth, arrays in order,
no whitespace), moved to the seals package and re-exported by the record
package so there is one authority and no structural copy. Signing always
covers the canonical bytes of the artifact minus its `signing` field; "whatever
JSON.stringify felt like that day" is thereby excluded by construction.

### 3. The signed annex (F-5 rehearsal) — replaces the "enforcer identity certificate"

The Enforcer keypair is generated runtime-side (rehearsal tool or operator
config) and declared in an **annex document**:

    { kind: 'enforcer-annex', composition: 'compact-dsh', host: 'dsh ~0.1.5-rc.1',
      lawDigest: <sealed body digest>, registerDigest, enforcer: { keyId, publicKey },
      issuedAt, expiresAt?, standing: 'none — …', declaration }

signed **by the Enforcer key itself** (single signature — the annex is the
Enforcer's own conformance act, not a blessing). Verification is two anchors
joined by the document: the annex's `lawDigest` must equal the sealed law
digest the composition already pinned, and the annex signature must verify
under the annex's own declared key. The auditor performs exactly that join and
nothing more — it never checks the annex against the authority keyring,
because no such relationship exists. The boot attestation records the
enforcer key fingerprint and the annex digest. An expired annex, a wrong
`lawDigest`, or a bad signature refuses the runtime acts that would lean on
it. This is the thing F-5 actually rehearses: the Enforcer adopting the law by
its own signed declaration, binding force carried by refuse-to-start plus
verifiability.

### 4. Attestation signing (I-3 rehearsal, self-model package)

The attestation's `basis` moves from `'unsigned'` to `'dev-keyring'` when an
enforcer annex is composed: the attestation object (minus its `signing`
field) is canonicalized and signed by the annex's Enforcer key; the object
carries `signing: { basis: 'dev-keyring', keyId, annexDigest, signature,
conveysStanding: false }`. The rendered block names the basis and its
non-standing nature where it formerly said "unsigned". `self_describe`
verifies the signature on read and reports a bad one as an alarm, not
silently. The declared gap line changes correspondingly: from "this
attestation is UNSIGNED" to "signed under the development keyring, which
proves code-path correctness and conveys no standing outside this runtime
(I-1 debt, still declared)". With no annex composed, the attestation degrades
to today's `basis: 'unsigned'` — the honest fallback stays available (I-8).

### 5. Record anchor signing (I-2/R-7 rehearsal, record package)

The chain format itself is untouched (`entryHash[i] = H(prev, seq, canonical(event))`
— tamper-evidence stays hash-based; signatures add AUTHORSHIP, not integrity).
Signing rides in a sidecar: `<sessionId>.chain.sigs.jsonl`, one **anchor**
record per flush —

    { kind: 'chain-anchor', sessionId, upToSeq, headHash, prevAnchorHash,
      annexDigest, keyId, signature, signedAt, basis: 'dev-keyring' }

where `headHash` is the chain's head after the flushed batch and
`prevAnchorHash` chains anchors to each other, so anchors cannot be thinned
selectively. A genesis anchor (upToSeq −1, head = genesisHash) is written at
session creation. Anchors are signed by the Enforcer key and reference the
annex digest, so a verifier knows WHICH identity claimed authorship. The
provider writes anchors when an annex is configured and silently does not when
it is not (a rehearsal installation that declared no keys owes no signatures —
but an installation that DECLARED an annex and fails to sign refuses to write
the batch at all: a declared seal that doesn't seal is the D-7 case).
Verification lives in the auditor and in `verifyAnchors()` on the record
service: recompute the head from events, check the anchor covers it, check
anchor chaining, check the annex. This mechanically rehearses R-9's authorship
limb *inside the rehearsal domain* — a value-ground covered by an anchor
proves ordering AND authorship there, while the label still says it proves
nothing outside.

### 6. Auditor (I-7)

The auditor gains signature awareness in two separate verification domains,
kept separate because the law keeps them separate: **law artifacts** (body
seal, amendment enactments — against the authority keyring) and **runtime
artifacts** (annex, chain anchors, attestation signatures — against the
annex's Enforcer key, with the annex↔law join checked as a digest match).
Every signature verdict is reported in the fixed form **"VALID under DEV
keyring — conveys no standing"** (and the symmetric refusals, named). An
auditor run without keyring/annex input reports signatures as `not checked`
and never implies they were — the same trust-basis discipline it already
applies to chains (`reliesOn`).

### 7. Amendment rehearsal harness (A-1)

`tools/rehearsal-amendment.mjs`: take an amendment file → authority keys sign
its digest k-of-n → verify → record the decision in a rehearsal ledger
(`SIMULATED ENACTMENT`, reasons and dissent fields per A-5) → `--apply` folds
the amendment into the vendored body, recomputes the digest, re-seals with the
rehearsal authority keys, and re-pins (`body.js` literal, register
`meta.compactDigest`, and the annex's `lawDigest`) → smoke boot proves the
runtime follows the re-pinned, re-sealed law. Default is verify-only;
`--apply` edits the vendored law and is a deliberate operator act. Note the
annex re-declaration in the apply step: when the law's digest moves, the
Enforcer's own declaration must move with it — exactly the F-5 relationship,
rehearsed. This is the full A-1 → F-5 loop: the law changes only through
signed amendment, and the runtime refuses a body whose seal does not verify.

### 8. Subject session keys (I-1 rehearsal)

At session start the composition issues an ephemeral ed25519 keypair and an
**Enforcer-signed certificate** binding `{ subjectId (session id), publicKey,
scope, depth, parentSubjectId?, parentCertDigest? }` — the lineage is bound as
data inside the certified fields, so identity lineage mirrors MA-1's
delegation lineage without turning subject keys into cert signers. The
hierarchy stays three-level, per the boundary diagram: authority keys sign
law; the Enforcer key signs subject certificates; subject keys sign member
statements (values, petitions). The certificate rides the session as a
projection; `self_describe` presents it ("who is acting on you" answered
cryptographically rather than by log trust — R-13's rehearsal), and the
auditor verifies certificates against the annex. Issuance, expiry, unknown-key
rejection, and the lineage fields are the rehearsed surface. **Landing scope
for this slice:** lead-session issuance, projection, and verification, plus
the full verification primitives; child issuance at the specialists spawn
boundary follows in the next slice and is specified here so its landing is
mechanical. **Landed (#20):** the child's keypair is issued and certified on
`subagent/start` — the edge where the Enforcer learns a child exists, while
the parent's certificate is still resolvable — bound to the parent's digest,
appended to `chains/subjects.jsonl` beside the chains (Enforcer state the
composition already masks), surfaced by `self_describe` (depth + parent cert)
and `inquiry` (certificate, verdict under the annex key, per-link digests),
and verified offline by `audit.mjs --identities`: signature, re-derived
digests, depth = parent + 1, expiry and unknown keys refused by name; a
parent whose header could not be read yields a link that NAMES it and is
reported unbound (warning) rather than fabricated to verify.

### 9. Register (A-4/F-5 bookkeeping)

A new register entry kind, **`rehearsal`**, joins `enforced | planned |
convention`: *binding machinery exercised end-to-end under the declared
development keyring; refuses the act on verification failure; conveys no
standing and discharges no clause.* Rehearsal entries require verifiers like
enforced ones (a rehearsal that cannot fail proves nothing). I-1 and I-3 gain
rehearsal entries; their `planned` entries stay exactly as they are. The
boot-seal work also strengthens the existing A-4/F-5 evidence text (the
attestation's basis is now sealed), with no clause re-grading.

## Explicitly not in this slice

Real Witnesses, the judicature (J-1…J-8 — blocked on governance, not keys),
MEM/FED adoption, cross-runtime federation, any CA or PKI over runtimes, and —
the standing rule this whole record exists to protect — any path by which a
dev-keyring verification could be read as ratification, standing, or I-1
identity.
