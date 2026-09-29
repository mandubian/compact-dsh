# Concept — judicature, the hearing layer (Part V: J-1 … J-8)

*The implementation-agnostic spec a future `packages/judicature/` would cite.
Design-first by decree ([issue #99](https://github.com/mandubian/compact-dsh/issues/99)):
no code before this page lands — this is the one layer where building first
would build the theater D-8 forbids.*

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
discipline). So the cascade terminates, honestly: a case whose every declared
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
