# Decision — the envelope band tier, and the register anchor (issue #90, slice 2)

*The adjudication the T2 projection and its selection mechanism implement
(`packages/envelope/src/project.js`), recorded before the wiring. Extends
[concept-envelope-rendering.md](concept-envelope-rendering.md), whose
"Declared gaps and open questions" named the tier mechanism as open.*

## The question

The concept page established the audience ladder: the canonical envelope is
the identity (T0 record, T1 full-fidelity band copy), and lighter models need
the instructional form (T2). Open when the concept landed: **how does the
runtime know an agent's tier?**

## The options, and why the loser loses

1. **Per-model auto-detection from the route** — map the model route's name
   to a capability class and tier the band copy accordingly. **Rejected.**
   Route names are operator-local facts with no measured relationship to how
   much prose a model can carry; guessing the audience from a name is the
   Enforcer guessing (D-7: uncertainty blocks, never passes silently), and a
   wrong guess silently starves a strong model or drowns a weak one. Also
   unmeasurable today: no fixture compares models on envelope comprehension.
2. **Per-agent declared class** (each preset/agent declares its tier).
   **Deferred, not rejected.** The mechanism without a consumer is dead code:
   the pilot's roster is one preset (compact-pilot), and specialist personas
   are phase-gate marked, not tiered. When a second agent class exists, this
   becomes the per-agent override of the composition default — the projection
   functions already take the tier implicitly through the caller.
3. **Operator-declared composition tier** — **chosen.** The operator knows
   which model drives the runtime; a declared switch is honest, reversible,
   and costs one environment read.

## The decision

- The band tier — the band being the channel between Enforcer and Subject; the *band copy* is the text the runtime actually emits to the Subject's context (defined with the full vocabulary in the [concept page's glossary](concept-envelope-rendering.md#the-words-plainly)) — is **operator-declared per composition**:
  `COMPACT_ENVELOPE_TIER=instructional` selects T2 for band copy; the
  default, and the absence of the variable, is `full` (T1).
- **An unknown value refuses** — `resolveTier` throws. A typo'd tier is a
  configuration error, not a preference: silently degrading to T1 would
  break the operator's declared expectation without a word (D-7).
- **T2 is never a downgrade of rights, only of prose**: the projection
  carries the rule id and every lawful next move, verbatim — the lint's
  property test enforces the floor across the whole gloss table, for every
  glossed rule.
- **T3 is not tiered.** The operator card is a *surface* (the terminal
  prompter, the gateway ask — slice 3), not an audience class: the human
  always gets the full card, and the raw envelope stays one glance away in
  every rendering.

## The register anchor (this slice's second cargo)

The slice-1 lint proved a gloss *exists* for every rule and cites *real*
clauses; it could not prove the prose tracks what the gate actually does.
This slice adds the anchor the register makes possible: **every gloss must
cite at least one clause that the register says its own gate's plugin
enforces.** Writing it immediately corrected four families' citations — the
register credits the egress mediator with **CF-1** (the connectivity half of
confinement), the remote-access analyzer with **I-5**, the promotion gate
with **D-4** (an unevidenced pass presented to the Principal is instrumental
deception, not mere optimism), and the capability gate with **SCH-1** —
and the glosses now say so. The anchor makes half the drift question
mechanical: a gloss whose prose wanders from its gate's registered clause
family fails the build; a re-attribution in the register fails every gloss
that anchored to the old clause, forcing reconciliation in the same PR.

## Declared limits

- The prose itself remains the human link: the anchor ties a gloss to its
  gate's clause family; it cannot verify the prose's sentences. Review
  discipline carries the rest, and the canonical envelope always wins.
- T2's consumer does not exist yet (the wiring is slice 3); until then the
  projection is exercised by its property tests, not by a live surface.
- The tier is composition-wide; per-agent override waits for a second agent
  class (option 2 above).

## Slice-3 addendum — the band copy is the recorded copy, and the gloss moved

Wiring the tier into the gates surfaced two facts the record states plainly:

- **The band text is the recorded text.** The denial reason the waterfall
  carries is what the session log records — there is no second, private
  canonical copy. So under `instructional`, the record carries the T2 form;
  the floor lint guarantees the rule and every lawful move survive it. Under
  the default (`full`), every byte is exactly what the record has always
  carried — the wiring is byte-identical until the operator declares a tier.
- **The gloss lives with the envelope now.** Band-time prose must be available
  where the band copy is built; hosting it in the guide would have made every
  gate import the interpretive package and made the "no force" aid load-bearing.
  `gloss.js` and its lint moved to `packages/envelope/` — the guide will serve
  the same records as a page (interpretation reading machinery, the right
  direction). The register anchor moved with it, unchanged.
- **Asks render the T3 card always** (a surface, not a tier): the card carries
  the canonical reason and embeds the canonical envelope verbatim, so the
  human-facing ask keeps the identity on the record. The approval wire lint
  now reads the envelope out of the card.
- **The card caught its own overclaim**: the static `AG/*` gloss asserted the
  exec-cache replay unconditionally, contradicting the canonical ask's
  ttl-disabled disclosure ("Approving covers this ask only"). The gloss now
  defers — what "yes" materializes is stated on the ask itself. A static
  gloss contradicting a configuration-aware envelope is precisely the drift
  the lint cannot parse; here, the approval suite's own honesty test caught it.
