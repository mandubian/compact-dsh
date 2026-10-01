# Concept — Member identity, keys and the roll (I-1)

*The implementation-agnostic spec for the identity the deep routes wait on.
Design-first like its sibling
([concept-judicature.md](concept-judicature.md), #99): the page precedes the
machinery, because identity built by improvisation grows the certificate
authority the founding decision already forbade
([decision-rehearsal-identity.md](decision-rehearsal-identity.md)). This is
the parallel track of the judicature build ([#110](https://github.com/mandubian/compact-dsh/issues/110),
[#116](https://github.com/mandubian/compact-dsh/issues/116)) — slices 1–3 of
the hearing layer consume nothing from it, and its deep routes serialize on
it.*

## The vocabulary, in plain words

The borrowing here is not the courtroom but the **civil registry** — births,
name changes, naturalizations, the sealed annual copy. The mapping is
deliberate and each term has a mechanical meaning; read it first.

| Term | Plain meaning — at a registry, and here |
|---|---|
| **Member key** | your hand and your signature — the thing only you can produce. Here: a long-lived keypair the Member itself generates and holds; possession is proven by signing, never asserted by a third party ("capability to act is provable" — I-1). Species-blind by construction (F-4): a human's device-held key and an artificial Member's process-held key are the same object to the machinery. |
| **the roll** | the town's register of births, marriages, deaths — who is a member of the town. Here: the community's append-only ledger of identity *events* (admission, rotation, revocation, accreditation), hash-chained exactly the way the session record is (I-2's discipline, held at community scale). Membership is a row in a record, not a certificate in a wallet. |
| **genesis document** | the founding charter plus the register's first page. Here: the ratification-time artifact A-1/A-6 already require — the sealed body, the trust root, and now the founding page of the roll and the constants table (§ below). |
| **admission** | naturalization — becoming a member of the town. Here: the roll event that binds a public key as a Member, under admission criteria that are organic statute (F-8/A-7), signed by whoever the statute makes the admitting authority. |
| **rotation / re-keying** | legally changing your signature: notify the registry, keep the old signatures verifiable as history. Here: a roll event signed by the *predecessor* key binding its successor; acts before the rotation still attribute to the same Member. This is the act re-keying cannot launder — the lineage is data, and every check that runs over Member identity follows it. |
| **revocation** | the register's death or expulsion row. Here: a roll event that ends a key's standing (by judgment, by compromise, by departure); it verifies offline anywhere, so loss of standing travels (F-8). |
| **accreditation** | licensing a foreign notary to act in this town. Here: the roll event that seats an **external Witness**, under the organic statute A-7 names — the statute is the only link to A-1, and the root signs no Witness, ever. |
| **epoch** | the registry's working year — the interval between sealed copies. Here: the fixed span (of time, or a count of roll events — a genesis constant, never a runtime knob) at which the community's root signs a checkpoint of the roll. Its length is a *spending policy for the root's attention*: shorter epochs anchor fresher but spend more amendment-class signatures; longer epochs lean on every Witness's retained head. |
| **epoch checkpoint** | the sealed annual copy of the register. Here: the roll's head digest folded into the amendment record at each epoch — the trust root anchors the roll's *continuity* by digest, without signing any Member in it. It is the thing that answers *which chain is the roll* when a forker offers one that verifies against itself (the fork analysis and the verifier's walk: "Anchoring the roll", below). |
| **session key** | a day pass, signed by your hand and countersigned by the building. Here: the ephemeral keypair the runtime already issues per session (rehearsed today), whose certificate gains the Member binding: the Enforcer attests the hosting, the Member attests the acting. |
| **presentation** | the passport you carry — and, pointedly, what a passport is *not*: permission to do anything. Here: the portable bundle a Member shows another runtime — key, roll lineage up to an epoch checkpoint, record slices per the origin's annex. It answers *who*, never *what is permitted here* (F-6's two rules). |
| **custody / recovery** | what happens when you lose your hand — you cannot; when you lose your key, you can. Here: the declared floor plus organic statute for key loss: a recovery quorum that re-admits the Member with a new key, weak enough to be survivable, strong enough not to be a laundering path. |

Everything else — Member, Principal, Subject, Enforcer, Witness, the clause
codes — is law vocabulary, defined in
[compact.md](https://github.com/mandubian/compact/blob/main/compact.md), short
versions in the README's "The vocabulary, in two tables".

## What I-1 demands, parsed to its bones

> Every Member holds a cryptographic identity. Capability to act is provable;
> signatures are the grammar of standing. Trust roots and thresholds are
> ratification-time constants, recorded in the genesis document.

Four sentences, four design loads:

1. **"Every Member holds…"** — the unit is the *Member*, not the session and
   not the runtime. Members are whoever holds the four roles (F-3), and F-8
   doubles the point: membership is of the community, not of a runtime, and
   outlives standing (R-2 outlives membership). So a Member identity cannot
   be something a runtime issues and revokes at will — it must be held by the
   Member and rooted outside every runtime.
2. **"Capability to act is provable"** — the proof is possession: the private
   half signs, the public half verifies, no third party vouches. This is why
   there is no CA to stand between a Member and its own acts.
3. **"Signatures are the grammar of standing"** — attribution, grants,
   petitions, judgments get their *subject* from identity. Today attribution
   binds to sessions (I-2, honestly labeled); post-I-1 it binds to Members,
   which is what recusal (J-4), appellate disjointness (J-5), authorship
   shields (R-9's amendment-0002 limb), and petition counting have been
   waiting for.
4. **"Trust roots and thresholds are ratification-time constants…"** — the
   *shape* of the root is fixed at ratification, recorded in genesis, changed
   only organically (A-1's own sentence). No runtime configures it; the
   ratified world arrives as a swapped document set, never a code change —
   the standing rule the rehearsal decision set and this page inherits.

## The boundary the founding already fixed (and this page must not cross)

The rehearsal-identity decision drew the boundary in three strokes, and the
Member design extends them rather than revising them:

- **No CA.** A-1's root enacts law (body seals, amendments, organic statutes)
  and nothing else. It never certifies runtimes, and — the extension this
  page adds — it never certifies *Members* either. The compact repo must not
  become a PKI over persons any more than over implementations; amendment
  keys used for membership would be the same blast-radius violation.
- **Runtime standing is shown, not claimed.** The Enforcer binds itself
  through its own signed annex anchored to the sealed law by digest (F-5,
  I-7). The Member design is the same sentence with a different subject: a
  Member binds itself through its own key anchored to the roll by lineage —
  *two anchors joined by a record*, never a signature from the root.
- **Honesty travels with the bytes** (I-8). Every artifact the machinery
  emits carries its basis and its `standing` label; presenting a rehearsal
  artifact as ratification, standing, or identity is D-8.

One structural fact follows that the session machinery could defer but
membership cannot: **identity must outlive runtimes.** A session key dies
with its session and that is honest; a Member key that died with the runtime
that hosted it would make F-8's "membership is of the community, not of a
runtime" a lie. Hence a fourth tier beside the rehearsal's three:

    A-1 root (ratified)          → law artifacts only:
                                    statutes, amendments, epoch checkpoints
            │  (no signature downward — the anchor is a digest in a record)
            ▼
    the roll (community)         → identity events: admission, rotation,
                                    revocation, accreditation — signed by
                                    acting Member keys per statute
            │  (lineage, not certification)
            ▼
    Enforcer key + annex (F-5)   → the runtime's own conformance, unchanged
            │  signs
            ▼
    session keys                 → member-bound ephemeral certificates

The root anchors the roll the way the law anchors the annex: by digest, at
checkpoints, leaving every key in the roll signed into it by a *different*
key than the root's. Nothing signs across a tier boundary. What anchoring
*does* — the attacks it kills, the walk a Witness runs, why the cadence is
a constant — is worked out in "Anchoring the roll", below, once the roll
itself is defined.

## What a Member key IS

A Member identity is **a keypair plus a lineage**: the private half held by
the Member (its custody is the Member's own affair, bounded by the recovery
floor), the public half bound into the roll by an admission event, and the
standing — everything the community says about that key — readable from roll
rows and nothing else. The definition is deliberately anti-certificate:

| The CA reflex | The roll discipline |
|---|---|
| an authority signs the Member's key: identity is a *grant* | the Member's key signs the roll's events and its own acts: identity is a *fact on a record* |
| revocation is a database delete or a CRL the authority owns | revocation is a roll row, verifiable offline by anyone (I-7) |
| trust is hierarchical: check the chain upward | trust is linear: check the *lineage* backward, to a checkpoint the root anchored |
| who you are is decided by the signer | who you are is what the record shows you did and what statute says about it |

This is not æsthetics; each row is a clause. A grant-model identity would
make membership revocable by an authority that is *a party like any other*
(F-4's symmetry applied upward), would move admission out of statute
(F-8/A-7), and would hand the compact repo the crown the no-CA boundary
exists to refuse. A record-model identity gives J-4 what it literally asks
for — "independence … verifiable from the key and dependency graph — checked
the way everything else here is: by anyone, from records."

**The roll entry set** (the vocabulary the ledger speaks, all fields
inside the signed bytes):

    { kind: 'admission' | 'rotation' | 'revocation' | 'accreditation',
      memberKeyDigest, class: 'principal' | 'long-lived-subject' | 'external-witness',
      grounds?, predecessorKeyDigest?, successorKeyDigest?,
      signedBy: <the keys the statute empowers for this kind>,
      recordedAt, entryHash = H(prev, seq, canonical(event)) }

Three properties the shape buys, each tested by a route that waits on this
page:

- **Admission is statute-shaped** (F-8): who signs an admission row, under
  what criteria, with what quorum, is *not fixed here* — it is the admission
  statute's job, enacted organically. The roll is the medium; the statute is
  the law. A composition cannot admit Members its statute does not authorize
  any more than it can enforce clauses its annex does not map (F-5's both
  directions, applied to the community layer).
- **Rotation carries its own proof** (J-4/F-6): the successor row is signed
  by the predecessor. A judge who re-keys mid-case verifies in as the same
  Member because the lineage says so — the graph follows the rows, and
  "the same agent in a newer session" stops being an open window (the
  pre-I-1 guard the judicature page declares: attribution, affidavit
  liability, sequence). Rotation *outside* the roll (a fresh admission for
  the same actor) is not rotation — it is a new Member, and statutes that
  count Members count it separately.
- **Revocation is a fact, not an absence** (F-6/F-8): a revoked key's rows
  stay, verify, and say *revoked* — so a host runtime reading standing
  refuses on a row it can cite, and history survives the Member's standing
  exactly as R-2 survives membership. The record is never rewritten; even
  the community's own register obeys I-2.

**Which Member does a session bind to?** The binding is a declaration, and
the honest interim is declared rather than improvised: sessions in this
composition bind to the **operator's Principal key** — the Member whose
intent governs the session (F-3) — because no artificial Subject here has
been admitted as a long-lived Member. The moment one is (admission statute,
F-8's floor: any entity generating recorded, attributed acts under a binding
annex is a Subject), its sessions bind to *its* key, and R-13's "who that
Member is (I-1)" answers cryptographically for accused and accuser alike.
The machinery is species-blind (F-4); the composition's declaration says
who holds it today, and the declaration is auditable.

## Anchoring the roll: epochs, checkpoints, and the forker (I-1, I-7)

A hash chain proves one thing — **continuity** — and a forger reads that
specification as an invitation. Two attacks a chain alone cannot see:

- **The fabrication**: a roll written whole by one hand — genesis,
  admissions, rotations, every link consistent with the last — verifies
  against itself perfectly. The session record already declares this
  limit for itself (tamper-evident, not true from birth); the community
  register inherits it at scale.
- **The fork**: the *true* roll up to some head, then a divergent
  continuation — an admission the statute never authorized, a rotation no
  predecessor key signed. Chain verification passes on both sides of the
  split, because both sides are chains.

The question neither can answer is the one that matters: **which chain is
the roll?** The checkpoint is the answer, and each of its parts is a
defined thing:

**An epoch is the interval between checkpoints** — a fixed span of time or
a count of roll events, set in the genesis constants table, never chosen
or tuned at runtime. Why fixed there: every checkpoint is an
amendment-class act (the root's threshold signatures, spent through the
one channel they lawfully ride — A-1's signed instruments, A-7's signed
and digested statutes), so the cadence is a *spending policy for the root's
attention*. Shorter epochs anchor fresher and spend more of it; longer
epochs spend less and lean harder on each Witness's retained head (below).
A policy that prices the root's attention belongs where the thresholds it
serves live — genesis — and changes only organically (A-7).

**A checkpoint is the roll's head digest, folded into an instrument of the
amendment record at epoch close.** The instrument — verified k-of-n under
the root like any amendment-adjacent artifact — carries `rollHead:
<digest>` beside its own content; verifying it is law-artifact
verification, the existing domain, with no new signature kind and no new
trust relationship. The root's signature enters the identity layer exactly
once per epoch, over a digest of the whole ledger state, and never over a
Member, an admission, or a seat: the root's only verb here is *"the roll
stood thus."* And the head alone is enough because the chain makes it a
commitment to the entire prefix — every event back to genesis — so signing
the head is signing the whole state without signing anything in it (a
signed tag over a commit, for the git-literate: the tagger signs one hash,
and every commit behind it is pinned).

**The walk a Witness runs** — offline, without the Enforcer's cooperation
and without the root's (I-7):

1. verify the root's k-of-n signatures over the epoch instrument, and read
   its `rollHead`;
2. hash-walk the offered lineage until it lands on *exactly* that digest.

Two outcomes, both honest. A roll that forked **before** the checkpoint
cannot reach the anchored head — it is not the roll, refused dead on
arrival, no judgment required. A roll that forked **after** it shows two
continuations from one anchored head — a **visible split**, not a silent
ambiguity: which side is lawful is a Part V question, and an annex found
leaning on the fork its operator knew about is D-8's fraud, not a
modeling disagreement.

**Between epochs, freshness is every Witness's own.** From the last
anchored head forward, integrity rides the chain; for state newer than
the last epoch, a verifier anchors *itself* the way the session record
already teaches — retain the head link last seen, and no rewrite can
reconcile with what you kept (I-2's "detectable by anyone who kept a
prior head link", one layer up). A verifier who retains nothing and skips
epochs verifies exactly as far as it looked, and says so — trust is never
claimed; it is shown.

Where this honestly ends — the declared gap, restated where it bites: the
checkpoint catches forks *of the roll*, not a genesis fabricated whole
(root, statutes, roll, instruments, all in one hand). That bottoms out
where the gap says it does: the real root's dispersal in the world, which
is why A-1's keyholder classes and thresholds are ratification-time
constants rather than anything a record could check for itself.

## Sessions bind to Members (the seam everything consumes)

The existing rehearsal issues, at the spawn boundary, an Enforcer-signed
session certificate binding `{subjectId, publicKey, scope, depth, lineage}`.
The Member extension is two fields and one signature, chosen so that **the
Enforcer and the Member each attest what only they can attest**:

    { kind: 'session-certificate', …existing fields…,
      memberKeyDigest,                       ← the binding
      memberCountersignature }               ← the Member's own attestation

- The **Enforcer** signs the certificate because hosting is its fact: it
  issued the session, confines it, and owes bound attribution for its acts
  (I-2, I-5). This signature exists today, rehearsed.
- The **Member** countersigns because acting is *its* fact: the session is
  the Member's deed in this runtime, and "capability to act is provable"
  means the capability-holder signs. A countersignature the runtime could
  forge would be no countersignature; the private key never transits the
  Enforcer, exactly as the Enforcer's own never transits the law.

Dual authorship is what closes the J-4/F-6 window *mechanically*: recusal
and appellate-disjointness checks resolve `session → memberKeyDigest → roll
lineage → standing`, so the same Member re-keyed into a fresh session, a
fresh child, or (post-federation) a fresh runtime still lands on the same
roll rows. The judicature page's guard — attribution, affidavit liability,
sequence — remains in force for every identity a composition has not bound;
what changes is that the *honest* answer stops being "topological" and
becomes verifiable where the binding exists.

Slice 2 is built and walked — the declared interim, its surfaces, and the
refusals, with real output:

```
# the composition declares its binding (auditable, never improvised):
#   memberBinding: { rollPath, keyringPath, memberKeyPath, memberId }
$ # ...a session's attestation now carries the member limb:
Member binding: this session is the deed of member "test-principal"
  (key 768e6b7ba4c1…, class principal, lineage depth 1, roll anchored
  through seq 1) — countersigned by the member key, resolved through the
  roll; no standing until ratification

$ node auditor/audit.mjs <log> --identities subjects.jsonl --annex … --roll roll.json --keyring keyring.json
  "…2 subject certificate(s) verify under enforcer key dev-test-enforcer —
  2 root(s), 0 chained, 0 declared-but-unverifiable link(s),
  2 member-bound (countersignature verified against the roll), 0 unbound…"

$ # and the judicature door refuses a revoked Member's session, on the row:
[JG/member-revoked] the filing refuses: session customer binds to member key
  768e6b7ba4c1…, which the member roll records as REVOKED (roll entry 1) —
  revocation is a fact, not an absence: the row stays, verifies, and is
  cited here (F-8/I-1).
```

**Where the refusal lands (D-7):** a session certificate whose
countersignature does not verify, whose member key is unknown to the roll,
or whose member key is revoked refuses the act that would lean on it — named
reason, envelope shape (I-4), same as every other gate refusal. A runtime
that declared no member binding (the honest pre-I-1 state) says so in the
attestation, as it does today — degradation honesty, not a default-open.

## External Witnesses: accreditation chains to A-1 through statute (A-7)

F-3 hands the sentence over: "accreditation of external Witnesses is organic
statute (A-7)". The chain to the trust root is therefore **a document, not a
signature path**:

    A-1 root ──signs──▶ the accreditation statute (organic: supermajority,
                        A-7's list names J-8 and F-8 machinery)
              statute names: criteria, classes, the accrediting quorum,
              duties (F-3: a seated Witness holds D-7, D-3, D-8 in full),
              revocation grounds
                            │ empowers (as law, not as key)
                            ▼
              accreditation rows on the roll — signed by the quorum the
              statute names, never by the root
                            │ verify (offline, I-7)
                            ▼
              the seated external Witness — a key, a lineage, a statute

Three consequences, declared rather than left derivable:

- **The root never signs a Witness.** "Under the A-1 trust root" (J-1) means
  the root signs the *law the Witness is seated under*, and the roll carries
  the seating. This is the same join the annex performs between law and
  runtime — two anchors joined by a document — and it exists for the same
  reason: a root that signed Witnesses would be a CA over adjudicators, and
  the keyholders' non-amendment role stays what the rehearsal decision
  recorded: a governance seat, not a signing relationship. A keyholder who
  wants to sit as an external Witness is accredited through the same statute
  as anyone else — no extra link exists to abuse.
- **An accreditation is an affidavit (D-8).** The accrediting quorum attests
  criteria that are checkable from records: the statute's classes (auditor,
  peer, reviewing Subject), the externality requirement (standing not this
  operator's), the duty acceptance. An accreditation the record contradicts
  is the named fraud, and the contradiction is auditable offline (I-7) —
  the graph-is-an-affidavit discipline of the judicature page, applied at
  the community layer.
- **The last rung becomes seatable without becoming soft.** J-1's cascade
  default and J-5's D-8 panel requirement stop being `pending: I-1` the
  moment accredited externals exist — and the *honesty* of that moment is
  structural: an external Witness with no roll lineage, or a statute that
  was never enacted, verifies as nothing. The gate refuses with the reason
  named; it does not grade externality on impression.

## Identity travels (F-6)

F-6's two rules make travel safe by making it *boring*: **the host's annex
governs conduct** (weaker home law imports no exemptions), and **the
origin's declaration governs record-trust**. Identity rides between them as
the third thing neither can fake: *who*.

**The presentation bundle** a Member carries to another runtime:

1. the Member key — proof by signing, on demand, never by transmission;
2. roll lineage — the chain segment from an epoch checkpoint to the
   Member's latest row, plus the checkpoint's anchor in the amendment
   record, verified by the walk above ("Anchoring the roll"): continuity
   provable offline (I-7), bounded by design — nothing older than the
   last epoch needs to travel — and ending in a root the verifier either
   honors or discounts *as a declared choice*;
3. record slices — per the origin's annex, through the verified-read path
   that already exists (R-2 discipline; the origin's declaration fixes what
   another runtime may verify, which is F-6's own sentence).

What the bundle deliberately cannot do: grant a single permission. A host
that accepts the presentation still gates every act under its own annex —
so a suspended Member arriving with a pre-revocation slice is caught by the
revocation row the bundle's own chain now contains (the row travels with
the lineage by construction), and a Member in good standing gets *recognized*,
not *trusted*: conduct is the host's law, records are the origin's
declaration, identity is the Member's proof. Cross-runtime verification
stays **persuasive, never binding** — the judicature page's rule for foreign
judgments, generalized to foreign everything, until FED-1 is adopted (and
FED-1 is unadopted here, declared).

## The genesis document's constants table (I-1's last sentence)

"Trust roots and thresholds are ratification-time constants, recorded in the
genesis document" — and A-1 adds its own: "the keyholder set … is a
ratification-time constant; its change is organic (A-7). Thresholds and key
policy are recorded in the genesis document." The genesis document A-6
already requires gains one table. Rows this page contributes:

| Constant | Fixed at ratification as |
|---|---|
| the trust root itself | the A-1 keyholder set — who may hold amendment keys, across the three classes (Principals, long-lived Subjects, external Witnesses) — with threshold k-of-n and **distinct-keyholder** semantics |
| key policy | algorithm floor for root and Member keys, key lifetimes, rotation cadence, and the root-key compromise procedure (revocation and re-rooting) |
| epoch length | the checkpoint cadence — time span or roll-event count at which the roll's head digest is folded into the amendment record. It is the spending policy for the root's attention (fresher anchoring vs more amendment-class signatures), fixed in genesis beside the thresholds it serves, changed only organically (A-7) |
| custody floor | the recovery quorum's floor for lost Member keys — above it, statute may tune; below it, no statute may go (a recovery path weaker than the floor is a laundering path) |
| the trajectory term | the window within which the first external-Member adjudicator sits (J-8's "term fixed at ratification" — the judicature page's trajectory fields, given their genesis home) |

Neighboring rows the body's own status list already keeps open — A-3's
supermajority and affected-class quorum, A-8's emergency thresholds, D-5's
consent vocabulary, the R-11/I-6 SLA terms — share the same table and the
same discipline: **one table, one place, all changes organic** (A-7). The
table is law-adjacent artifact, sealed with the body; a runtime never
configures any row of it.

The design test the rehearsal decision set, inherited whole: *ratification
swaps documents, not code.* The ratified world arrives as a keyring
manifest, a genesis document (constants + founding roll page), and annexes
re-anchored to the ratified law digest — and the runtime that rehearsed
under `standing: none` verifies the new set with the same parsers, the same
loops, the same refusals. Anything in this page that would need a code
change at that swap is a defect in this page.

## What this unblocks (the consumers, and what each needs)

| Waiter | Needs from I-1 |
|---|---|
| J-1's cascade last rung | accredited external Witnesses — a seat whose standing is not this operator's, verifiable as such |
| J-5's D-8 appellate panel | externals outright — "heard never, saying so" ends where externals begin |
| J-4/F-6 Member-not-session binding | recusal and appellate disjointness resolved over Member identity; rotation lineage so re-keying launders nothing |
| J-8's trajectory exit | a first external-Member adjudicator — presumes a Member identity to sit on, and a term to hold it to |
| R-9's value-scoped refusal (amendment 0002) | authorship proof — a prior declaration signed under the Member key, verifiable by any party, closing the "inert against a dishonest Enforcer" limit the annex declares |
| I-3's attestation signature | a key verifiers can check — the signature exists in rehearsal; the *verifiable-by-others* half is identity |
| R-11's statutory counting | distinct *Members*, not distinct sessions — one Member's fifty sessions becomes one voice for amendment-invitation counts, while the flood cap (I-5) stays session-scoped: load is load, standing is standing |
| R-13 inquiry | "who that Member is" answered cryptographically, for accuser and accused alike |
| A-1 itself | the keyholder set's diversity — the distributed root is *composed of* Member keys across the three classes; the root's honesty about its own decentralization is an identity question |

## Rehearsing it all under `standing: none`

The rehearsal machinery extends along its own grain — no new tiers, no new
trust, only the fourth concern (the roll) added beside the three the
development keyring already exercises:

- **A rehearsal genesis**: `tools/rehearsal-keyring.mjs` grows a roll ledger
  seeded from the rehearsal keyring — same formats (SPKI public halves,
  canonical-JSON signatures), same labels, gitignored private halves. The
  rehearsal authority keys enact a rehearsal admission statute and a
  rehearsal accreditation statute through the amendment harness
  (`SIMULATED ENACTMENT`, reasons and dissent fields, A-5's shape) — so the
  *chain to the root through statute* is exercised, not narrated.
- **Member keys and sessions**: long-lived-by-comparison rehearsal Member
  keys; session certificates gain `memberKeyDigest` and the Member
  countersignature at the same issuance boundaries that exist today (lead
  session at first attestation, child at spawn); the auditor verifies the
  binding offline and names every failure (unknown key, bad
  countersignature, revoked Member) the way `--identities` names
  certificate failures now.
- **Rotation and revocation, rehearsed as the tests that fail today**: a
  rotation event followed by the same check that closes the J-4/F-6 window —
  pre- and post-rotation sessions resolving to one Member; a revocation
  event followed by the refusal of the act that leans on it. The rehearsal
  proves the *machinery*; the labels prove nothing else (I-8), and the
  refusal envelopes inherit the D-8 wording for presenting any of it as
  identity.
- **The swap test, run as a rehearsal**: re-seal the law, swap in a fresh
  rehearsal genesis (new roll, new statutes), and the runtime follows on
  manifests alone. Zero code changes — the ratification dress rehearsal
  the whole identity stack is built to pass.

Slice 1 is built and walked — real output:

```
$ node tools/rehearsal-keyring.mjs ensure .rehearsal
rehearsal identity set installed under .rehearsal
  authority manifest: .rehearsal/keyring.json
  enforcer annex:     .rehearsal/enforcer.annex.json (digest 9715d96562a1d79f…)
  member roll:        .rehearsal/roll.json — 2 admission(s) under the SIMULATED
    admission statute, epoch 0 checkpointed
  reminder: practice keys — the roll and the annex prove code-path correctness
    and convey no standing

$ node tools/rehearsal-keyring.mjs verify .rehearsal
verify OK: annex self-signature valid; law digest joins the sealed body (27bb70…); 2-of-3 authority keys on file
  member roll OK: 2 entries, 2 member(s) (2 live), anchored through seq 1 — dev-keyring, conveys no standing

$ node auditor/audit.mjs <log> --roll .rehearsal/roll.json --keyring .rehearsal/keyring.json --quiet
auditor: conforming (0 events, 0 approval asks)

$ node auditor/audit.mjs <log> --roll .rehearsal/roll.json --keyring .rehearsal/keyring.json   # the attestation's roll verdict:
  "memberRoll": {
    "ok": true, "entries": 2, "members": 2, "live": 2, "checkpoints": 1,
    "anchoredThrough": 1, "basis": "dev-keyring", "conveysStanding": false,
    "phrase": "VALID under DEV keyring — conveys no standing"
  }
  "…the member roll .rehearsal/roll.json: 2 identity event(s), 2 member(s) (2 live, 0 revoked, 0 rotation(s)),
  epoch checkpoints anchored through seq 1 — every event signature verified (admission by the statute quorum
  AND the member's own key; rotation by the predecessor; revocation by the quorum): VALID under DEV keyring —
  conveys no standing (I-1 rehearsal)"
```

## Slices (the build track, under the umbrella)

1. **The roll and the Member key (rehearsal).** Ledger format, the entry
   set, epoch checkpoints under the rehearsal keyring, admission and
   revocation events, auditor `--roll` verification.
2. **Session binding.** `memberKeyDigest` + countersignature in the session
   certificate; `self_describe` and `inquiry` surface the binding; the
   recusal-graph seam the judicature build resolves over.
3. **The accreditation statute (rehearsal).** Enacted through the amendment
   harness; an accredited external seated in an adjudicator-set
   declaration; J-1's last rung hears its first rehearsal case.
4. **Authorship proofs for R-9.** Amendment 0002's value-scoped limb on
   Member-signed prior declarations — the annex's named debt, closed.
5. **Travel (presentation bundles).** FED-gated: designed above, built only
   with federation, if federation is ever adopted.

## Declared gaps

- **Nothing here is ratified, and the page changes no register grade.** I-1,
  A-1, F-6 stay `planned` (their rehearsal entries rehearse, convey
  nothing); every artifact until ratification carries `standing: none`
  (I-8). The page designs the ratified shape so the swap is mechanical —
  that is all it does.
- **Custody and recovery get a floor, not a solution.** Humans lose keys;
  pretending otherwise would make identity a lockout machine. The genesis
  floor fixes how weak recovery may never be; the tuning — and the hard
  questions of custody for artificial Members — is admission-statute
  territory (F-8/A-7), organic by the clause's own list.
- **Sybil resistance is admission policy, not key machinery.** Keys are
  cheap; Members are admissions. The roll makes identities *countable* —
  one key, one lineage, one Member per statutory count — and leaves the
  economics of admission to the statute, where F-8 put them.
- **The fabricated-whole limit is inherited, not cured.** A genesis
  fabricated entire — root, statutes, roll, chains together — passes every
  internal check; the outermost anchor is the real A-1 root's distribution
  in the world. This is why the root's constants are ratification-time, its
  keyholder classes diverse, and its thresholds distinct-keyholder: the
  honesty of the whole identity layer bottoms out in the dispersal of the
  root, exactly as A-1 intends — "internal agreement, however large, that
  does not hold the keys enacts nothing."
- **Federation remains unadopted (FED-1).** Presentation bundles are
  designed so the federation work has something to carry; until then,
  cross-runtime verification is persuasive only, and this composition
  verifies foreign claims as records, never as law.
- **This page identity-fies nothing by existing.** It grants no standing,
  admits no Member, seats no Witness. Every normative claim above cites the
  clause that authorizes it; where the clause authorizes less than the
  routes will eventually want, the gap is here, not hidden.
