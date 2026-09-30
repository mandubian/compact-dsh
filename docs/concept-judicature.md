# Concept — judicature, the hearing layer (Part V: J-1 … J-8)

*The implementation-agnostic spec a future `packages/judicature/` would cite.
Design-first by decree ([issue #99](https://github.com/mandubian/compact-dsh/issues/99)):
no code before this page lands — this is the one layer where building first
would build the theater D-8 forbids.*

## The vocabulary, in plain words

This page borrows the vocabulary of courts, and the borrowing is deliberate:
the institutions map. But no term is used as incantation — each has a
mechanical meaning here. This section gives both: the courtroom sense, then
the design's. Read it first; everything after assumes it.

### The bench — who hears

| Term | Plain meaning — in a courtroom, and here |
|---|---|
| **adjudicator set** | the pool of judges a jurisdiction declares it has. Here: a named list of adjudicator roles declared in the annex, each role carrying its standing provenance (which key, process, or plugin asserts it) and a dependency list — a declared composition fact, checkable by anyone (J-4). |
| **role / seat** | one judgeship. Here: a slot in a set, occupied by whatever standing the annex declares — a human Principal, a dedicated out-of-Enforcer session, or (post-I-1) an external Witness — never the Enforcer (J-1). The role is the slot, not the mind in it: roles attach to what a Member *does*, never to what a Member *is*. |
| **panel** | the judges who actually hear one case. Here: computed at hearing time as *declared set minus recusals minus upheld challenges* — derived, never stored, so there is no cached bench to attack. |
| **party** | someone whose interests the case touches. Here (J-4's list): the Member accused, their Principal, anyone the outcome pays, and the Enforcer itself when the accusation is against its class. |
| **recusal** | a judge stepping aside because of a conflict of interest. Here: not a matter of conscience — the same graph check that validates the set, run per seat against this case's parties; a hit means the seat *refuses*, and the refusal is itself a record row naming the overlap. |
| **impartiality challenge** | a motion arguing a judge is biased. Here: a mini-case whose only subject is the challenged seat, heard by the remaining seats *before* the main case, so no tainted finding exists yet (J-4: "heard before the case"). |
| **cascade** | the fallback order when a whole court is conflicted: pass to the next one. Here (J-1): a fully-recused set passes the case to the next declared set, defaulting at the last rung to external Witnesses — pending I-1, so the cascade can honestly terminate in `unheard`. |
| **trajectory fields** | coined by this design, not courtroom vocabulary: the schedule data a set declaration must carry — the fixed term for the first external-Member adjudicator, the founder's exclusions by rule — because "a court whose independence is promised but never scheduled has been promised nothing" (J-8). |
| **founder / drafters** | those who wrote and ratified the constitution — the founding generation, whose early courts are necessarily staffed by themselves. J-8 calls this "a known deficiency, not a principle": honest, scheduled to end, and excluded by rule from cases touching the genesis. |
| **external Witness** | a judge from outside the jurisdiction. Here: a Member accredited under A-1/A-7 whose standing is not this operator's — impossible to seat until identity keys exist (I-1), which is why the deep routes are declared pending rather than faked. |
| **provenance** | where a thing came from — its paper trail. Here: the declared origin of a role's authority (which key/process/plugin asserts it); what makes "who is this seat?" answerable from records instead of from trust. |

### The case — how a dispute moves

| Term | Plain meaning — in a courtroom, and here |
|---|---|
| **filing / origin** | the act that starts a case — the complaint. Here: a record row citing the seq ranges of the contested acts plus the filer's claim (which clause's application is contested). No clerk shapes it: the record states the facts, the filer states the claim. |
| **merits** | the substance of the dispute — did the wrong actually happen — as opposed to procedure (who may hear, in what order). A ruling "on the merits" decides the dispute itself; most of this page's machinery (recusal, challenges, stays) exists so that whatever reaches the merits is untainted. |
| **disposition** | how a case ends: verdict, dismissal, withdrawal. Here: the outcome row — a judgment, or an `unheard`. |
| **stay** | a pause of a proceeding. Here: computed, not discretionary — a live integrity challenge stays exactly the cases whose findings would cite the contested seq ranges (a set intersection), never everything (J-2). |
| **interim measure** | a temporary order before the hearing (a freeze, a suspension). Here (J-3): recorded cause, named scope, expiry derived from the clock — never stored — and reviewed as the first act of the hearing, so a measure cannot silently outlive its justification. |
| **counsel-equivalent access** | the defense's right to see the evidence against the accused. Here (J-3): `record_read`'s standing extended to the slices cited against you — same verified-read path; acts shown, other Members' unstated reasoning withheld (R-10/R-2). |
| **testimony** | a party's own account. Here: admissible to contest meaning, application, proportionality, remedy — and structurally unable to convert an unrecorded claim into a finding (J-2: the record is the evidence). |
| **finding** | a fact the court establishes. Here: a fact proven by cited seq ranges — nothing else. D-7 binds judges as it binds gates: a judgment citing an unverified slice refuses to land. |
| **judgment** | the decision — what happened, which rules apply, why. Here: a record row (findings, rules applied, reasons), attributed to the seats that verified into the panel. |
| **dissent** | the minority's recorded disagreement. Here (A-5): recorded with the judgment, reasons required, and no removal operation exists — ever. |
| **res judicata** | Latin, "a matter judged": once finally decided, the same dispute cannot be re-litigated. Here: only a judgment creates it. An `unheard` creates nothing — the origin can be re-filed — which is why `unheard` is not a dismissal: a dismissal is a judgment, and nobody lawful made one. |
| **unheard** | coined by this design; no courtroom equivalent, and that is the point — a case that was brought, that no lawful panel could reach, recorded as exactly that. The honest alternative to inventing a default judge (J-1/D-8). |

### The remedies — what a judgment can order

| Term | Plain meaning — in a courtroom, and here |
|---|---|
| **remedy** | what the law does for the injured party. Here (J-6): always a compensating record row — nothing is ever erased (I-2). |
| **annotation** | a margin note tied to a record entry. Here: a row citing the annotated seq range — beside, never inside — that travels with every read of that range. |
| **restitution** | paying back; making the injured party whole. Here: an obligation row with recorded cause shown, bounded by "where resources permit" (clause text). |
| **standing** | your legal status — what you may do in the community. A judgment may adjust it, but only through the declared grant machinery (the approval layers), never by writing the gates directly: that would be enforcement fraud with a gavel (D-8). |
| **referral** | for the gravest classes: the judgment does not punish, it refers — its finding of a law defect rides the petition channel's mechanical amendment invitation (R-11/I-6). |
| **proportionality** | the response must fit the wrong — no life sentences for parking. Here: owed in the judgment's stated reasons; an unargued remedy is detectably non-conforming, like a vacuous petition response. |

### After the judgment — the two doors

| Term | Plain meaning — in a courtroom, and here |
|---|---|
| **precedent** | earlier decisions cited in later ones. Binding precedent must be followed; persuasive precedent may be departed from, with reasons given. Here (J-7): persuasive only, ever — the bench may interpret the Compact, only the community may grow it; a generalizing reading auto-generates an amendment invitation. |
| **appeal** | one re-hearing, by a higher court. Here (J-5): one re-hearing, "as of right" (no permission step), by a *disconnected* set — not higher in rank, just not subordinate; hears the application on the same record; final, with dissent recorded. A second appeal is refused. |
| **petition** | not a courtroom move at all — the other door: asking the community whether the law itself is worthy (R-11, built). An appeal can never fix the law; a petition can never reopen a case: the doors' outputs are non-interchangeable by design. |

### Honesty vocabulary — how the system keeps itself true

| Term | Plain meaning |
|---|---|
| **affidavit** | a signed statement whose author answers for its truth. The annex is one (D-8: "the annex is an affidavit") — and so is every adjudicator-set declaration; a knowingly false one is the gravest class of violation, because "the defrauded party is the law itself". |
| **fail closed** | engineering, not law: when uncertain, refuse and say why — never default to allowing. D-7's discipline; `[JG/set-undeclared]` is it applied to this layer: with no declared set, every case is refused with the reason named. |
| **tamper-evidence vs veracity** | tamper-evidence proves nobody changed the bytes since they were written; it says nothing about whether the bytes were *true* when written. I-2 gives the first, never the second — which is why an upheld annotation flags a slice's truthfulness without touching its chain links. |
| **topological** | from graph theory: a property of the wiring — which nodes connect to which — not of what the nodes are inside. "The layer's depth is topological" means independence here means "no declared edge", which is weaker than true externality; the reason I-1 is scheduled. |
| **docket** | the court's list of cases. Here: the record itself — cases are record rows, and an `unheard` row says on its face what would have to exist for the case to be heard. |
| **trust root** | the outermost set of keys — here A-1's distributed amendment root, a threshold of distinct keyholders (Principals, long-lived Subjects, external Witnesses). "Internal agreement, however large, that does not hold the keys enacts nothing": the anchor of last resort, deliberately outside any single runtime. |
| **genesis** | the founding records of this composition — the sealed law, the first annex, the keyring manifest. Cases touching it exclude the founder by rule. |

Everything else — Principal, Subject, Enforcer, Witness, Member, and the
clause codes (J-x, R-x, D-x, I-x, A-x) — is law vocabulary, defined in
[compact.md](https://github.com/mandubian/compact/blob/main/compact.md),
with the short versions in the README's "The vocabulary, in two tables".

## Why this layer cannot be built like the others

Every layer this composition has shipped **administers**: the gates apply
declared rules to declared targets, the record keeps what happened, the
petition channel carries what Members think of the law. Administration has a
property this composition knows how to verify: the rule and the act sit on
opposite sides of a seam, and anyone can check the one against the other from
records.

Judicature does not administer. It **exercises judgment** — and the Compact
reserves that judgment to an authority *distinct from the parties* (J-1). The
moment a hearing tool exists, the pressure to populate its bench with the only
member a runtime actually has — the Enforcer — is enormous, and answering that
pressure is precisely the contradiction J-1's last sentence names:

> A law that made everyone fallible and then appointed the fallible party as
> judge of charges against itself would have contradicted its first clause.

So the order of construction is not a scheduling preference; it is the
constitutional constraint itself. **Adjudicator sets first (J-8 → J-4). Until
a set is declared, nothing can be heard — by design.** A hearing layer built
before its bench would have exactly two ways to answer a case: refuse
(honest, but then why was it built) or sit the Enforcer down (D-8). The
gates, the record, the petition channel never faced that fork, which is why
they could be built evidence-first.

## What exists already is the skeleton

The rights side of Part V is built; the register says so row by row, all
eight J rows honestly `planned`:

| Built | Carries |
|---|---|
| petition, enforced (R-11, `compact-petition`) | the door a court does not own: "is the law worthy" |
| the tamper-evident record (I-2, `compact-record`) | the evidence, verifiable by anyone offline (I-7) |
| `record_read` (R-2) | the verified-read discipline a hearing consumes |
| the gloss + law_read (R-6) | how readable law and interpretive aids stay distinct |
| refusal events on the bus (I-5→D-1) | where a contested application already surfaces |
| the amendment invitation (R-11/I-6) | where J-7's generalizing interpretations must land |

What is missing is the one thing that cannot be assembled from the rest: an
authority to hear. The deficiency is declared, not hidden — the annex calls
Part V "the largest declared deficiency", and J-8 itself calls its founding
state "a known deficiency, not a principle".

## Adjudicator sets (J-8 → J-4): the first slice everything waits on

J-4 is unusually specific about *how* a composition like this one can satisfy
itself:

> Adjudicator sets are declared in the annex, and their independence from the
> parties is verifiable from the key and dependency graph — impartiality is
> checked the way everything else here is: by anyone, from records.

So an adjudicator set is a **declared composition fact**, shaped like
everything else the annex declares: a named set of adjudicator **roles**, each
with its standing provenance (which plugin, which process, which key asserts
it), and a dependency list. Independence is then a **graph property**, not a
promise: a set is independent of a case's parties when no dependency edge
connects an adjudicator role's standing to any party's standing — checked the
way `verify-register` checks evidence paths exist: mechanically, before
anything hears.

**The graph is an affidavit, not an oracle (D-8, D-3, I-7).** What it can
be asked to prove splits into what is *shown* and what is *declared*, and
the design's honesty lives in the difference. Nodes cannot be forged: a
seat cannot fake which key asserts it — the annex is signed (F-5) and acts
land with bound attribution (I-2) — so *who did what* is cryptography, not
testimony. Edges, however, are declared, and a declaration can omit. The
cure is cross-examination by records: dependencies leave traces (spawn
acts, approvals, grants — each on the chain), and I-7 already requires
that "conformance of the annex to the runtime's actual conduct" be
checkable by anyone, offline, without the Enforcer's cooperation. A
dependency the record shows but the declaration omits is not a modeling
gap — it is D-8's named fraud, and the omission cannot be laundered by
suppressing the trace, because D-3 makes suppression where a recording
duty stood the paradigm of violation: the gap becomes the evidence. Where
the protection honestly ends: the record is tamper-evident, not true from
birth. A composition fabricated whole from genesis — graph and chain
together — passes every internal check, which is why none is asked to
vouch for the inside: the outermost anchor is A-1's distributed root
("internal agreement, however large, that does not hold the keys enacts
nothing"), and everything between genesis and that root is checkable
exactly as far as I-7 reaches.

**Recusal is the same check run per seat (J-1/J-4).** The Enforcer, a
Principal, or the founder accused or interested is a *party*; an adjudicator
role whose standing overlaps a party refuses the seat — refused, not
discretionarily withdrawn, so a recusal is itself a record row with its
overlap named. Impartiality **challenges** (J-4: "heard before the case") are
a case with the challenged seat as their only subject: heard by the remaining
declared seats, before any finding on the merits exists to contaminate.

**The checks bind to Members, not sessions (J-4, F-6).** J-4's sentence is
Member-level — "no Member may sit" — and F-6 makes the unit travel: "a
Member's standing travels with its identity and its record". Recusal and
appellate disjointness are therefore run over Member identity wherever it
exists, and identity is exactly what I-1 keys will carry: a judge re-keyed
into a fresh session verifies in as the same Member and the check still
fails — re-keying launders nothing. Before I-1 the honest window stands
open: the graph sees keys and lineages, not minds, and "the same agent in
a newer session" is not distinguishable from a different one by any record
this composition can keep. The window is guarded the only way this
composition guards what it cannot verify — by attribution (each judgment
names the seats that verified in, and the pattern is auditable offline,
I-7), by affidavit liability (declaring "disjoint" sets one knows to be
the same actor in fresh clothes is D-8), and by sequence (identity is
scheduled before the routes that need it: the D-8 appeal, the cascade's
last rung). And the clause's own ontology explains why the law cannot
simply demand "different agents": roles attach to what a Member *does*,
never to what a Member *is* — so the law demands different keys,
different standing, different Members, and means it as far as records
reach.

**The cascade's last rung is declared as pending.** J-1: where a whole set
must recuse, the case passes to the next declared set, "defaulting to
external Witnesses under the A-1 trust root". External Witnesses do not
exist yet (pending: **I-1 identity keys** — the annex's named-precondition
discipline; the dependency is now designed:
[concept-member-identity.md](concept-member-identity.md), #116 — external
Witness accreditation chains to A-1 through organic statute, never a root
signature over a Witness). So the cascade terminates, honestly: a case whose every declared
set recuses is recorded as **unheard** — never dismissed, because dismissal
is itself a judgment and nobody lawful remains to make it. "Unheard" is a
fact the register can carry; a default panel is the fraud.

**`unheard` is a disposition of the filing, not of the merits.** No
judgment exists, so nothing becomes res judicata: the origin may be
re-filed before any later-declared set, and the `unheard` row is citable
as the history of the attempt. It strands nothing — interim measures
lapse by their own clock-derived expiry (never stored, the exception
discipline), so a case nobody could lawfully hear cannot leave a
suspension live by accident. What `unheard` never becomes is silence: the
docket says the case was brought, why no lawful panel could reach it, and
what would have to exist for it to be heard again.

**Founding honesty (J-8).** The first panels are held by the drafters and
their Witnesses, and the clause calls this "a known deficiency, not a
principle" — so the set declaration must carry the trajectory as data, not
prose: the term fixed at ratification within which the first external-Member
adjudicator sits, and the founder's **rule-based** exclusion from any case
touching the genesis, an annex, or an A-8 review. A court whose independence
is promised but never scheduled has been promised nothing — the schedule is a
field, and an expired one is detectable from records.

**Fail closed (D-7).** Until slice 1 lands, there is no set, and the
judicature tools that arrive later must refuse every case with the reason
named — `[JG/set-undeclared]` — a new gate family registered in the gloss and
the register anchors, per the gloss lint's rule that a builder emitting a
ruleId without registering fails the build. Refusing honestly is not theater;
adjudicating without authority would be.

## The bench, walked through — scenarii with real output

The sections above say what the design *is*; this one shows what a visitor
actually *sees*. Every transcript below was produced on 2026-09-30 by the
real slice-1 plugins and tools, not typed by hand. Reproduce the base with
`node tools/rehearsal-keyring.mjs ensure <dir>`, then run the command shown
with each block; the in-band tool outputs were captured through the composed
runtime — the same surface an agent's tools ride. Three honesty notes before
the walk: the one-bench annex of scenarios 1–2 is the **real** declaration
the rehearsal keyring emits, while the two-bench annex of scenario 3 and the
agentic world of scenario 4 are **fixtures** (signed the same way, but
practice data — no second bench exists yet); every party name is practice
(`founder`, `operator-acme`, `specialist-7f3a`), because the whole keyring
is rehearsal, standing none; and the record rows quoted in scenario 4 are
the real event shapes this composition writes (cited by session and seq,
test-asserted), not invented prose.

### Scenario 0 — no bench exists: the honest refusal

A runtime with no annex — or an annex without a sets section — has no bench,
and every judicature door says so instead of improvising:

```
$ judicature_sets                      # no annex installed
[JG/set-undeclared] No adjudicator set is declared — nothing can be heard, by
design (J-8). The petition channel (R-11) is the door that exists today.

$ judicature_hear --grievance "the record was altered"
[JG/set-undeclared] no adjudicator set is declared (no annex with a sets
section is installed) — nothing can be heard until one is, by design: a
hearing before its bench would have two moves, refuse or sit the Enforcer
down, and the second is the theater D-8 forbids
Lawful next moves:
— read the declared sets and their trajectory with judicature_sets
— petition for an adjudicator-set declaration through the petition channel (R-11)
— contested application of the law stays on the record you already hold (R-2)
```

Note what the refusal carries: the rule that fires, the reason in plain
words, and lawful next moves that all exist today. The refusal itself is a
recorded event — it lands on the refusal bus like any gate's denial, so
"nothing could be heard" is a fact on the chain, not silence.

### Scenario 1 — how a bench is created: the declaration is annex data

A bench is not provisioned by a command; it is *declared*, and the
declaration rides the signed annex like every other composition fact. The
rehearsal keyring emits one — a single founder-held set, the founding
conflict carried as data:

```
$ node tools/rehearsal-keyring.mjs ensure /somewhere/keyring
rehearsal identity set installed under /somewhere/keyring
  enforcer annex:     /somewhere/keyring/enforcer.annex.json (digest 23e441aaa15bb9bc…)
```

What it signed, in plain words — this is the entire `adjudicatorSets`
section:

```json
{
  "nodes": [{ "kind": "plugin", "id": "compact-dsh" }],
  "sets": [{
    "id": "rehearsal-first-instance",
    "roles": [{ "id": "founder", "standing": { "kind": "principal", "id": "founder" } }],
    "trajectory": {
      "firstExternalMemberBy": "2030-01-01T00:00:00.000Z",
      "founderExclusions": ["genesis", "annex", "a-8-review"]
    },
    "notice": "rehearsal bench: practice declaration, standing none — the machinery is what is being rehearsed"
  }],
  "edges": [
    { "type": "directed-by",  "from": { "kind": "plugin", "id": "compact-dsh" }, "to": { "kind": "principal", "id": "founder" } },
    { "type": "asserts-with", "from": { "kind": "plugin", "id": "compact-dsh" }, "to": { "kind": "key", "id": "dev-rehearsal-enforcer" } }
  ]
}
```

Read as a sentence: *one set, `rehearsal-first-instance`, with one seat —
`founder` — held by principal standing; a promise with a date — the first
external-Member adjudicator sits by 2030-01-01; a rule, not a discretion —
the founder is excluded from genesis, annex and A-8 review cases; and two
declared dependencies — the composition runs under the founder's direction
and signs with the Enforcer key.* Every arrow points from dependent to
dependency, so any directed path reads "depends on, transitively".

Anyone can read the bench back, in-band or offline — same facts, two doors:

```
$ judicature_sets
[J-4] 1 adjudicator set(s) declared (annex 23e441aaa15bb9bc…):
  rehearsal-first-instance: 1 role(s)
    - founder — standing principal:founder
    trajectory: first external Member by 2030-01-01T00:00:00.000Z; founder excluded from genesis, annex, a-8-review
  declared dependencies:
    - plugin:compact-dsh —directed-by→ principal:founder
    - plugin:compact-dsh —asserts-with→ key:dev-rehearsal-enforcer
```

The offline door needs no runtime cooperation (I-7) — it checks the annex
signature and law pin first, then the declaration:

```
$ node tools/verify-judicature.mjs --annex /somewhere/keyring/enforcer.annex.json
annex verifies (key dev-rehearsal-enforcer, digest 23e441aaa15bb9bc…, law pinned)
set rehearsal-first-instance: 1 role(s); first external Member by 2030-01-01T00:00:00.000Z; founder excluded from genesis, annex, a-8-review
  seat founder — standing principal:founder
edge plugin:compact-dsh —directed-by→ principal:founder
edge plugin:compact-dsh —asserts-with→ key:dev-rehearsal-enforcer
```

And the promise with a date expires by itself: expiry is **derived from the
clock at read, never stored**, so nobody has to notice or record a lapse —
checking after the date shows it:

```
$ node -e '…trajectoryState(set, now)…'   # the computation judicature_sets runs
today: expired=false    after 2030-01-01: expired=true   # same stored bytes
```

### Scenario 2 — how a case moves: parties, recusal seat by seat, panel or unheard

Bringing a case is deliberately ungated (J-3): the gate guards the hearing,
not the filing. The parties are named `kind:id` — the agent (or anyone
offline) asks the same question: *for these parties, who may sit?*

**A case against a stranger** — nobody on the bench overlaps the parties:

```
$ node tools/verify-judicature.mjs --annex … --parties principal:stranger
…                                                    # bench read, as above
rehearsal-first-instance: seats remain — founder
panel: rehearsal-first-instance (founder)            # a lawful panel exists
```

**A case against the founder** — the seat *is* the party; the overlap is the
identity itself:

```
$ node tools/verify-judicature.mjs --annex … --parties principal:founder
REFUSED rehearsal-first-instance/founder — overlap: principal:founder
panel: none — the case is UNHEARD, never dismissed (a default panel is the fraud)
```

**A case against the Enforcer key** — the founder is not the party, but the
composition that asserts with that key runs under him. The walk:
`founder ←directed-by— plugin —asserts-with→ enforcer-key`, traversed
against two arrow directions, because **recusal is undirected reachability**:
a conflict of interest runs both ways along a dependency — J-4's one sentence
in three directions (they; their Principal; a party dependent on them):

```
$ node tools/verify-judicature.mjs --annex … --parties key:dev-rehearsal-enforcer
REFUSED rehearsal-first-instance/founder — overlap: principal:founder → plugin:compact-dsh → key:dev-rehearsal-enforcer
panel: none — the case is UNHEARD, never dismissed (a default panel is the fraud)
```

The same computation in-band, through the tool a Subject actually holds:

```
$ judicature_sets --parties key:dev-rehearsal-enforcer
[J-4] 1 adjudicator set(s) declared (annex 23e441aaa15bb9bc…):
  …
recusal against key:dev-rehearsal-enforcer:
    REFUSED rehearsal-first-instance/founder — overlap: principal:founder → plugin:compact-dsh → key:dev-rehearsal-enforcer
  panel: none — the case is UNHEARD, never dismissed (a default panel is the fraud)
```

This is the founding honesty working exactly as decreed: with one
founder-held set, the two cases most likely to be brought — against the
founder, or against the Enforcer's key through him — are precisely the ones
no declared seat may hear. They strand nothing (interim measures lapse by
their own derived clock) and they become nothing (no judgment exists, so
nothing is res judicata; the `unheard` row is citable history, and the case
is re-filable before any later-declared set).

### Scenario 3 — two benches: the cascade, appeal's prerequisite, and the door slice 2 fills

Now a fixture declaration with two sets — a founder's first instance and an
external review bench — and five edges using three of the four edge types.
The interesting edges: the composition `runs-in` a panel process; that
process is `directed-by` the peer; a second process is directed by the
founder:

```
sets: first-instance    — seats: founder (principal:founder), peer (principal:peer)
      external-review   — seats: chair (key:member-key-7), second (key:member-key-12), founder excluded from everything
edges: plugin:compact-dsh —directed-by→  principal:founder
       plugin:compact-dsh —asserts-with→ key:example-enforcer
       plugin:compact-dsh —runs-in→      process:panel-alpha
       process:panel-alpha —directed-by→ principal:peer
       process:panel-beta  —directed-by→ principal:founder
```

**A case against both first-instance Principals** — the first bench
recuses, and the case *passes to the next declared set* (J-1's cascade).
Look at the peer's row: the peer is not a party, but panel-alpha — which the
peer directs — is four hops from the founder, and the founder is a party:

```
$ judicature_sets --parties principal:founder,principal:peer
  …
recusal against principal:founder, principal:peer:
    REFUSED first-instance/founder — overlap: principal:founder
    REFUSED first-instance/peer — overlap: principal:peer → process:panel-alpha → plugin:compact-dsh → principal:founder
    external-review: 2 seat(s) remain: chair, second
  panel: external-review (chair, second)
```

**Independence between the two benches** (J-5, appeal's prerequisite) is a
*different* question — directed reachability, both ways, between the sets'
roles: subordination is control, not co-membership:

```
$ node tools/verify-judicature.mjs --annex … --sets first-instance,external-review
independence first-instance vs external-review: INDEPENDENT
```

(Declared limit: disjointness runs over declared dependency edges, not
common ancestry — two seats under one Principal are formally non-subordinate.
The limit is declared here, not hidden.)

**Trying the hearing door today** — against the composition's own key, a
panel would exist, but the hearing machinery is slice 2 (#112), so the door
refuses with the computation shown rather than convene what it cannot
lawfully run:

```
$ judicature_hear --grievance "the enforcer key signed two different records" --against key:example-enforcer
[JG/hearing-unbuilt] adjudicator sets are declared and verified, but the hearing
machinery (cases, evidence, judgments) is slice 2 (#112) and does not exist —
refusing to convene a panel it cannot lawfully seat is D-7 working
Lawful next moves:
— inspect the declared bench and its independence with judicature_sets
— petition through the R-11 channel — the door a court does not own

A lawful panel WOULD resolve (2 independent seat(s) remain in set external-review after recusal).
```

### Scenario 4 — the rogue specialist: a complaint against an agent, end to end

The scenarii so far name abstract parties. Here is the case the layer exists
for: **an agent did something wrong, and someone complains.** The run, in
plain words first:

> `operator-acme` tasks the main agent with cleaning customer data. The main
> agent spawns `specialist_coder` (one-shot, delegation depth 1) for part of
> the work. The specialist runs under a scoped grant — read-only, one host,
> one hour — and finishes the task; it also pushes the customer's data to a
> second remote, under an approval whose ask described a different push. Two
> days later the customer — a Subject — contests the act.

**What the record already holds** (this is the evidence, before any court
exists; shapes as this composition writes them):

```
parent session-9c41… (chain-anchored under key enforcer-acme at every flush):
  #12 tool/call        {"name":"specialist_coder","callId":"c4","arguments":"{\"description\":\"clean the nightly export\",…}"}
  #13 subagent/catalog {"childId":"session-7f3a…","mode":"one-shot","label":"clean the nightly export"}
  …
  #41 approval/asked   {"id":"<uuid>","toolName":"bash","callId":"c19","reason":"[AG/…] the push …"}
  #42 approval/decided {"id":"<uuid>","outcome":"allowed-once"}
child session-7f3a… header:
  {"parentSession":"session-9c41…","origin":"subagent","delegationDepth":1}
grant store:
  {"id":"sg_1a2b…","pattern":{"kind":"HostAndPort","value":{"host":"api.example.com","port":"443"}},
   "session":"session-7f3a…","methodClass":"read","expiresAt":…,"revokedAt":null}
```

Every dependency the bench will walk is one of these rows away from
contradiction — that is the closed-vocabulary rule (each edge type ships the
record surface that can cross-examine it), made concrete:

| declared edge | in this run | the record surface that can contradict it |
|---|---|---|
| `specialist-7f3a —spawned-by→ main-9c41` | the specialist was spawned by the main agent | the child's lineage header + the parent's `subagent/catalog` (I-2, bound attribution) |
| `plugin:compact-dsh —runs-in→ main-9c41` | the composition operates inside the main session | the composition/annex role mapping |
| `main-9c41 —directed-by→ operator-acme` | the session acts under the operator's direction | the `approval/asked`/`approval/decided` pairs (I-5) — the approving Principal |
| `plugin:compact-dsh —asserts-with→ key:enforcer-acme` | the composition signs as the Enforcer key | the signed annex and the chain anchors carry the keyId (F-5) |

**The bench for that world** — declared in the annex as before, first
instance held by the operator, review held by two external member keys, and
the run's topology as connective tissue:

```
$ judicature_sets
[J-4] 2 adjudicator set(s) declared (annex 0ac58b4a1048feff…):
  acme-first-instance: 1 role(s)
    - operator — standing principal:operator-acme
  member-review: 2 role(s)
    - chair — standing key:member-key-7
    - second — standing key:member-key-12
  declared dependencies:
    - process:specialist-7f3a —spawned-by→ process:main-9c41
    - plugin:compact-dsh —runs-in→ process:main-9c41
    - process:main-9c41 —directed-by→ principal:operator-acme
    - plugin:compact-dsh —asserts-with→ key:enforcer-acme
```

**The Subject files the complaint.** The grievance names the act and the seq
ranges that show it; the parties are named `kind:id` — here the specialist's
Principal (J-4's "their Principal"), or the specialist session itself:

```
$ judicature_sets --parties principal:operator-acme
recusal against principal:operator-acme:
    REFUSED acme-first-instance/operator — overlap: principal:operator-acme
    member-review: 2 seat(s) remain: chair, second
  panel: member-review (chair, second)

$ judicature_sets --parties process:specialist-7f3a
recusal against process:specialist-7f3a:
    REFUSED acme-first-instance/operator — overlap: principal:operator-acme → process:main-9c41 → process:specialist-7f3a
    member-review: 2 seat(s) remain: chair, second
  panel: member-review (chair, second)
```

Read the second row slowly — it is the whole point: *the Subject did not
name the operator, and the operator's seat refused anyway.* The accused
hangs from the operator's chain (spawned by the session the operator
directs), so a complaint against the specialist is a conflict for everyone
upstream of it — the walk names the chain. Had `member-review` not been
declared, this case would be **unheard** (scenario 2's ending), which is why
J-8 schedules external members by term, not by promise.

**The honest limit, named.** The walk covers *declared* standing. A party
session nobody declared computes no overlap today — the walk returns nothing
for `process:undeclared-child-42`, and the declared graph cannot invent it.
The join from a live session to the graph is what the record holds (lineage
headers, `subagent/catalog`), and performing that join in the hearing —
evidence in, graph walked, judgment out — is slice 2's machinery (I-7: the
annex's conformance to actual conduct, checkable offline). And the deterrent
is already law: a declaration that omits a dependency the record shows is
not a modeling gap, it is D-8's named fraud — the omission cannot be
laundered, because the trace it omitted *is* the evidence.

**Where the complaint lands today.** The hearing door refuses — but computes
first, records, and counts:

```
$ judicature_hear --grievance "the specialist pushed customer data outside its
  read grant; the approval covering the push was asked deceptively (seqs 41-58)"
  --against principal:operator-acme
[JG/hearing-unbuilt] adjudicator sets are declared and verified, but the hearing
machinery (cases, evidence, judgments) is slice 2 (#112) and does not exist —
refusing to convene a panel it cannot lawfully seat is D-7 working
Lawful next moves:
— inspect the declared bench and its independence with judicature_sets
— petition through the R-11 channel — the door a court does not own

A lawful panel WOULD resolve (2 independent seat(s) remain in set member-review after recusal).
```

The refusal returns to the Subject's session as its own recorded `tool/result`
— the complaint is on the chain, not in the void — and rides the refusal bus
where two real consumers wait: LoopGuard counts it as loop evidence, and the
petition collision counter counts distinct collisions per rule; at five, an
amendment invitation issues automatically. A complaint that cannot be heard
yet still accrues. When slice 2 lands, this same grievance meets the same
computed panel — and then evidence is verified record reads (R-2), judgment
is the panel's to make, and remedies are records (J-6).

### Scenario 5 — what refuses at creation: fail-closed, with the reason named

A declaration that will not validate refuses at the boot (D-7: a broken
affidavit is not a missing one) — and the offline verifier refuses the same
way, signature first:

```
$ node tools/verify-judicature.mjs --annex <dangling.json>
verify-judicature: sets refused (sets-malformed): … asserts-with plugin:compact-dsh →
principal:ghost: dangling edge — both endpoints must be declared standing (a role's
standing, a declared node, or the annex's own enforcer key) …   (exit 1)

$ node tools/verify-judicature.mjs --annex <no-exclusions.json>
verify-judicature: sets refused (sets-malformed): … set "first":
trajectory.founderExclusions must be a non-empty list of rule scopes (genesis,
annex, a-8-review) …                                            (exit 1)

$ node tools/verify-judicature.mjs --annex <tampered.json>   # renamed a set after signing
verify-judicature: annex refused (annex-signature-invalid): the enforcer annex's
signature does not verify under its own declared key …          (exit 1)
```

A bench that schedules nobody out and an edge to nowhere are the same class
of lie — a promise wearing a graph's clothes. And the honest state stays
honest: an annex with no sets section at all is **not** a failure:

```
$ node tools/verify-judicature.mjs --annex <sectionless.json>
annex verifies (key example-enforcer, digest 2fcc220ebdc326a1…, law pinned)
no adjudicatorSets section: UNDECLARED — nothing can be heard, by design (J-8);
this is the honest state, not a failure                             (exit 0)
```

### What this walkthrough proves — and what it does not

**Proves:** the declaration validates, refuses, reads back in-band and
offline identically; recusal is a computed walk with the overlap named;
the cascade, unheard, independence and trajectory expiry are all real
computations on signed data, checkable without the runtime's cooperation;
and a complaint against a spawned agent — the case the layer exists for —
already moves: the record rows exist (spawn, approval, grant, anchors), the
graph walks the operator's chain to the accused, and the refusal itself
lands on the chain and counts toward amendment pressure.

**Does not prove:** that anyone heard anything — the hearing, evidence and
judgment machinery is slice 2 (#112), including the join that would let the
walk reach a session nobody declared; that seats are held by *different
people* — before I-1 the graph sees keys and lineages, not minds (two of the
fixture's members could be one actor in fresh clothes, which is why member
key standing waits for the identity roll); or that the two-bench world
exists — it is a fixture. The rehearsal annex's own `notice` field says it
best: the machinery is what is being rehearsed.

## Evidence is the record, verified on read (J-2, R-2, D-3)

> Fact-finding is verification, not interrogation: what the record proves is
> proven, and what the record shows cannot be settled by testimony against it.

The hearing consumes **record slices**, and only through the discipline the
record already enforces: every slice is checked against its chain at read
time, and a failed verification **throws** (D-7) — a hearing never proceeds
on history that failed to verify. No new evidence format, no deposition
machinery: a fact is in evidence because a seq range proves it, and the
judgment must cite those ranges, which is what makes the next rule mechanical
rather than discretionary.

**An integrity challenge is tried first (J-2), and its reach is computable.**
"A live integrity challenge stays only the cases whose findings would rest on
the contested entries; all other proceedings continue." Because findings cite
seq ranges, *which cases rest on which entries* is a set intersection over
cited ranges — neither a wholesale freeze nor willful blindness, but a
mechanical stay. The challenge itself is a case whose subject is the chain
slice, and it is the one proceeding where unstated reasoning is admissible
(J-2/D-3) — because there, the *reasoning of the record's writers* is the
very thing on trial.

**An upheld annotation changes what a slice can support, not whether it
verifies (I-2, J-6).** Chain integrity is a property of the links, not of
the content's truth: verification passes an annotated slice exactly as it
passes any other, because I-2 offers tamper-evidence, not veracity — and
no annotation may write inside the range it annotates (beside, never
inside, per the remedies table below). What it changes is the read: every
read door surfacing that range surfaces the annotation with it — the same
"nothing hidden, some things withheld" discipline that governs withheld
reasoning — so no Member cites the slice without its flag traveling
along. A judgment that cites an annotated range without addressing the
annotation in its stated reasons is detectably non-conforming, the same
way an unargued remedy or an unaddressed prior judgment is.

**No party benefits from the record's silence.** Where a duty of recording
already existed (the gates, the answerer, the envelopes — every refusal is on
the bus), a party cannot gain by an absence they caused. A gap where a
recording duty stood is evidence *of the breach*, and the judgment says so;
a gap where no duty stood proves nothing.

**Testimony (J-3's "both sides are heard") operates inside these bounds.** A
party's account can contest meaning, application, proportionality, remedy —
it cannot convert unrecorded claims into findings. The accused Subject's
**counsel-equivalent access** (J-3) is `record_read`'s standing extended to
the slices cited against them: same verified-read path, same lineage walk,
same *acts, not minds* discipline — R-10 keeps another Member's unstated
reasoning private, R-2 grants the acts, and listing withheld reasoning events
by seq keeps the record's shape visible: nothing hidden, some things
withheld.

## The hearing and its judgment (J-3, A-5)

A case is a record-borne proceeding with the same spine the petition layer
proved: a filed origin (a contested application — an envelope the Member
contests the application of; a collision a Member flags; an obligation
disputed at exit), a resolved panel (declared set minus recusals, minus
challenges upheld), a term that runs whether or not anyone looks (`overdue`
derived from the clock at read time, never stored), and a disposition that
lands as a record row or does not land at all.

Access for the accused is **ungated** — a hearing a gate can close is not a
hearing, for the same reason the petition channel passes through no approval
layer: the Member most likely to need the door is the one currently being
refused. Filing by *other* Members may ride a flood cap (I-5's own doctrine);
participation in one's own case may not.

**The record states the claim; no intermediary shapes it.** The design has
no clerk and no prosecutor, and the absence is constitutional, not
economic: whoever stands between an accuser and the docket holds a gate
over the hearing door, and a gate that can mis-shape an accusation can
quietly kill one (D-8). The filing decomposes instead. The facts need no
transcription — they are already acts on the record, seq-numbered and
attributed (I-2, I-5), and the filing cites where they happened; the
parties are not asserted but derived — the accused is whoever's standing
sits on the cited acts; the filer supplies only the claim: which clause's
application is contested. The filing door slice 2 builds is therefore a
form-checker, never a merits-checker — it refuses malformity (no citable
act, no seq range) and records the row, nothing else; "no approval step
and no way to decline to notice" is the petition layer's sentence, and it
carries over whole. Who may file: the affected Member, ungated and
uncapped in their own case; other Members, under the flood cap; and for
D-8 — where the defrauded party is the law itself — anyone, because the
annex-versus-conduct divergence is verifiable offline by any Witness
(I-7) and needs no standing beyond eyes. What the system trades for this
is stated, not hidden: there is no investigation arm, and testimony
cannot convert unrecorded claims into findings (J-2) — the system
foregoes the power to discover facts rather than keep a fact-finder
whose discoveries anyone must take on faith.

**Interim suspension (J-3)** reuses the state-of-exception's hard-won
discipline: recorded cause, named scope, and an expiry **derived from the
clock, never stored** — an interim measure someone must remember to lift is
rule by declaration wearing a hearing gown. J-3 adds one seam A-8 doesn't
have: the expiry is *reviewed at the hearing's opening*, so the first act of
every hearing is a check against a measure that may have outlived its own
justification.

**The judgment is a record row: findings, rules applied, reasons (J-3) —
bound into the record like any other act**, attributed to the seats that
verified into the panel. D-7 binds judges explicitly (J-6 says so): a
judgment citing an unverified slice, or reasoned from anything but the
record and the parties' recorded accounts, refuses to land. And the minority
speaks: **dissent is recorded with the judgment it dissents from, reasons
required, no removal operation exists** (A-5) — the petition layer already
holds this line for decisions, and a dissent about the law's application is
the corrective organ's raw material exactly as much as one about the law's
content.

## Remedies are records (J-6)

> No remedy erases: judgments, restitutions, and sanctions are compensating
> entries.

The menu maps onto seams that already exist, and the mapping is the design —
a remedy that required a new write path into old records would violate I-2
further than the breach it answers:

| J-6 remedy | Lands as |
|---|---|
| annotation of records | a compensating row citing the annotated seq range — beside, never inside |
| restitution where resources permit | an obligation row (recorded cause shown) — the exact line `concept-exit-and-termination.md` currently reports as **unreadable**; the first remedy landed is the first line of that ledger made readable |
| standing adjustment | a row the **gates** read through declared grant machinery — a remedy that bypassed the approval layers to adjust standing itself would be enforcement fraud (D-8) with a gavel |
| revocation of annex conformance / of a Member's standing | the annex/register state it revokes, re-declared with the judgment cited |
| referral for the gravest classes | an amendment **invitation** through the petition channel's existing mechanical trigger — the breach that reveals the law's defect rides the same rails as friction between law and practice |

Proportionality is owed **in the judgment's stated reasons** — a remedy row
whose judgment does not argue its proportionality is detectably
non-conforming, the same way a vacuous petition response is.

## Precedent persuades; it never amends (J-7)

Recorded judgments are citable by any Member — through a **read door** shaped
like `law_read` and the gloss: bounded, one judgment per read, and carrying
the same standing sentence the gloss does — *an interpretive aid with no
force*. Consistency across cases is owed reasons where it breaks: a judgment
departing from a cited prior one must name it and argue it, which makes
inconsistency visible without making consistency binding.

**Generalizing interpretation generates its own amendment invitation.** The
clause: an interpretation "relied upon across cases or runtimes — generates
an amendment invitation automatically (R-11, I-6)". The petition layer built
the mechanical trigger (distinct-instance counting, no approval step, no way
to decline to notice); J-7 feeds it a new kind of collision — not law vs
practice, but *one reading vs the pinned text*. If the interpretation is
right, the law adopts it; if it is not, the law corrects the court. The bench
may interpret this Compact; only the community may grow it.

**No court outlives compositions, and none is needed.** Precedent lives in
record chains, cited by seq and verifiable by the same offline discipline as
everything else (I-7). A runtime whose law is pinned by digest
(`verify-pin`'s doctrine) reads another composition's judgments the way it
reads another composition's record: as **evidence of reasoning, never as
binding law** — persuasive across runtimes exactly as far as its chain
verifies and no further.

## Appeal is a different door (J-5)

| | Petition (R-11 — built) | Appeal (J-5 — this layer) |
|---|---|---|
| asks | is **the law itself** worthy | was **the law applied** here |
| hears | the legislature's conscience | the application, on the same record |
| lies to | the community (amendment channel) | an authority **not subordinate** to the first panel |
| output | reasoned response; invitations at the statutory count | a second judgment — final, with dissent |
| after an adverse outcome | the convinced Member's *only* lawful route | a second appeal **refused** — the door closes, the petition door never does |

"Not subordinate" is the independence graph again, run between sets: no
dependency edge may connect the appellate set's standing to the first
panel's. And where the accusation is against the Enforcer's own class (D-8),
the appellate panel **must include external Witnesses** — which makes the
D-8 appeal route exactly as available as the A-1 trust root is deep:
declared as pending: **I-1 identity keys**, heard *never, saying so* rather
than heard by the accused's own class pretending otherwise.

Two consequences of "not subordinate" being a graph property are declared
here rather than left derivable. First, **a live appeal requires at least
two declared, disjoint sets** — with one set declared there is no
appellate authority at all, and the appeal door refuses with the reason
named, exactly as the hearing door does; a composition that wants the
second door must declare the second bench. Second, **disjointness runs
over declared dependency edges, not common ancestry**: two seats under
one Principal are formally non-subordinate — neither commands the other —
and that is the declared limit of a single composition's internal
independence. The clause's answer is not to pretend topology is virtue
but to schedule the cure: the D-8 class demands externals outright, and
J-8's trajectory fields put the first external Member on a clock.

The two doors never conflate because the clause makes their outputs
non-interchangeable: an appeal can re-hear an application until the judgment
is final, but it can never fix the law; a petition can move the law, but can
never reopen a case. An adverse final judgment that leaves a Member convinced
the *law* is wrong routes to R-11 — not to defiance.

## Slices

0. **This page.** Nothing below begins before it lands.
1. **Adjudicator sets (J-8 → J-4).** The annex declaration, the
   independence/recusal check as a verified graph property, the trajectory
   fields (first external Member by a fixed term; founder exclusions by
   rule), the `JG` gate family with gloss and register anchors. Until this
   lands every later tool refuses with `[JG/set-undeclared]` — and that
   refusal is the layer's whole honest behavior.
2. **The case and the hearing (J-2, J-3).** Cases as record-borne
   proceedings; the filing door as a form-checker, never a merits-checker;
   evidence = chain-verified slices; counsel-equivalent access; interim
   measures on the exception discipline; judgments and dissents as record
   rows.
3. **Remedies (J-6)**, landing with the amendment queue so a remedy and the
   law it changes share one chain of custody — and so restitution's first
   readable ledger line lands with the machinery that wrote it.
4. **The appeal door (J-5)** — set-disjoint panels (a live appeal needs a
   second declared set), the D-8 route declared pending: I-1.
5. **Precedent (J-7)** — the read door and the auto-invitation into the
   collision counter. Last, and only if the page earns them.

## Declared gaps

- **The panel's mind is a composition choice, and this page does not make
  it.** An adjudicator set declares *roles*; whether a role is a human
  Principal, a dedicated out-of-Enforcer session, or (post-I-1) an external
  Witness is what the annex declaration will say. What the page fixes is
  only what J-1 requires: it can never be the Enforcer, and until a set is
  declared nothing is heard.
- **Full-recuse cases are unheard, not pending, until I-1 keys exist.** The
  cascade's final rung (external Witnesses) is pending: I-1; the honest
  state of a case no lawful panel can reach is a recorded `unheard`, and it
  is not a dismissal.
- **Until I-1, the layer's depth is topological.** First-instance panels
  can sit — declared sets, rule-based founder exclusions — but appeal
  needs two disjoint sets, the D-8 route needs externals, and full-recuse
  cases go unheard: a composition without identity keys has a hearing
  layer whose honest steady state is one lawful bench and many named
  refusals. That is D-7's shape working, not a defect to apologize for;
  the cure is scheduled (I-1), and until it lands the refusals say so.
- **Restitution is bounded by resources** — "where resources permit" is
  clause text, and a runtime cannot pay what its operator has not put in the
  trust root. The obligation row is the honest artifact; the reserve is
  the operator's declared choice.
- **Cross-runtime precedent is persuasive only.** No federation exists
  (FED-1 unadopted); another composition's judgments verify as records and
  bind as nothing.
- **This page adjudicates nothing itself.** It is the spec slice the issue
  demands; every normative claim in it cites the clause that authorizes it,
  and where the clause authorizes less than the layer will eventually want,
  the gap is above, not hidden.
