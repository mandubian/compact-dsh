# Concept — the envelope and its audiences (R-3, I-4, and who is listening)

*The spec the gloss table (`packages/guide/`), the structured-fields renderers,
and the tiered band copy cite. Written before the work, per the house
accountability mechanism.*

## The envelope is doing two jobs, and only one is styled

R-3 and I-4 make every refusal name the rule that caused it and the lawful
next moves available — the denial envelope. The same shape reaches three
readers through four surfaces:

| Surface | Who reads it | What they get today | The problem |
|---|---|---|---|
| the durable record (I-2) | the auditor, years later | the canonical envelope text | none — this is the identity |
| the Subject, in band | the agent that was refused | the canonical envelope text | none for a deep model; see T2 below |
| the terminal ask (attended) | the operator | tool, command, target, fingerprint | structured, but assumes the law is known |
| the web transcript / approval card | the operator | the same text through the host's renderer | one collapsed paragraph; no example; no operator action |

The last row is the observed failure (live web page, 2026-09-24): the
`[RA/D-7/opaque-network]` envelope renders as a single block, the reason
presupposes the law ("static analysis cannot gate it per-host (fail-closed)"),
and nothing tells the operator what *they* can do. The envelope was designed
as "the same shape for humans and agents" — same **content** is not the same
as same **presentation**.

Two code facts make the status quo fragile as well as unstyled:

- The text is flattened at build time. `buildEnvelope()` returns structured
  fields (`ruleId`, `reason`, `lawfulNextMoves`) *and* a pre-flattened `text`;
  the text is what travels.
- The shape is maintained by convention, not by one code path. The shared
  builder (`packages/envelope`) serves `approval`, `loopguard`, `blessed`,
  `capability-gate` — but `packages/allowlist-gate` carries its **own local
  builder** (`src/allowlist.js`) and re-stringifies by hand
  (`src/index.js`, the deny path). Two producers of "the same" shape.

## The principle: one envelope, many renderings

The secret-hygiene adjudication (G3, `docs/decision-secret-hygiene.md`)
already established the split this generalizes: credential paths are *masked
in every rendering* and *exact in fingerprints, grants, and matching*. The
rendering is not the identity. Applied to envelopes:

- The **canonical envelope** — rule ID, reason, lawful next moves, the exact
  text — is the identity. It lands on the record (I-2) and in the Subject's
  in-band copy. Golden vectors keep it byte-stable.
- A **rendering** is a projection of the structured fields for one audience.
  Renderings may reorganize, gloss, and exemplify. They may never *decide*
  anything (the decision reads the canonical fields), never narrow the moves
  (R-3 names *the lawful next moves available* — all of them, at every tier),
  and never misstate the rule — a gloss that contradicts the rule it renders
  is enforcement fraud in prose (D-8). Renderings are declared and
  machine-checked so drift is a build failure, not a discovery.

This is presentation-only by construction: no new event vocabulary, no change
to what is recorded, no change to any decision path.

## The audience ladder

| Tier | Reader | Form | Preserves |
|---|---|---|---|
| **T0 — record** | auditor, Witness | the canonical envelope, byte-exact | everything (I-2) |
| **T1 — agent, full** | the default Subject in band | the canonical envelope text (today's form) | rule + all moves, verbatim (R-3) |
| **T2 — agent, instructional** | a lighter model, a smaller context | lead with the *instruction*: refused, do-not-retry-as-is, then the moves | rule + all moves (compressed prose, not narrowed options) |
| **T3 — operator** | the human | plain-language card: what happened, why it protects them, a worked example, per-move actions, raw envelope one click away | the raw envelope, reachable |

The insight the ladder encodes: a lighter model does not need *less law* — it
needs less prose and more procedure. R-3's floor (rule ID + lawful next moves)
is the invariant every tier carries; a lint asserts it rather than trusting
the renderer.

F-4 symmetry: the same machinery serves every audience — the deep model's
full-fidelity copy is the default tier, the human gets the richest *gloss*,
and no tier is privileged over another. The LoopGuard's corrective
`agent.inject` prose is the precedent: the Enforcer already authors
instructional text; T2 applies that discipline to envelopes.

## The gloss record: one row, four projections

One record per rule that an envelope can carry, hosted beside the guide
(whose charter — interpretive aid, no force, machine-checked citations —
fits exactly):

```js
{
  rule: 'RA/D-7/opaque-network',
  title: 'The network target is not named',
  why: `The runtime protects hosts one at a time. This command reaches for
        the network without naming a host, so there is nothing to approve —
        a "yes" here would approve anything.`,
  example: { blocked: ['curl $URL', 'git push origin'],
             lawful:  ['curl https://api.example.com/v1'] },
  instruction: `Do not retry this command as-is. Name the host literally,
                or ask your operator for the concrete target.`,
  operatorMoves: { // canonical move → what the operator can literally do
    'rephrase with a literal host or URL …': 'reply with the concrete URL',
    'escalate to your Principal': 'the agent will ask you; decide there',
  },
  cites: ['R-3', 'I-4', 'D-7'],
}
```

The same wget envelope, projected:

- **T0/T1** — exactly today's text (unchanged).
- **T2** — `Refused [RA/D-7/opaque-network]: the network target is not
  named. Do not retry this command as-is — name the host literally, or ask
  your operator. Lawful next moves: — rephrase with a literal host or URL so
  the request can be gated per-host — use an approved alternative — escalate
  to your Principal`
- **T3** — *✗ Not run: `wget` needs the network but doesn't say where to.
  The runtime gates network access per host — with no host named, there is
  nothing to approve.* (rule RA/D-7/opaque-network) · **What can happen next:**
  the agent rephrases with a literal URL — the ask becomes approvable for
  that host · you reply with the concrete target, e.g. `use https://…` · or
  the task continues without this fetch · ▾ raw envelope.

Note what T3 refuses to do: it does not hide "fail-closed" — it explains it
(*if nobody can answer, the call does not run — that is the feature*), and
the raw envelope stays one click away. Comprehensibility that launders the
mechanism is the one thing this composition cannot do honestly.

## Machine-checks

1. **Coverage** — every gate/rule combination the envelope builders can emit
   has a gloss. The lint walks the builders (the AG, RA, LG, CF, EG families
   and the shared builder), not a hand-written list.
2. **Citations resolve** — every gloss `cites[]` resolves through the guide's
   existing citation machinery against the register (the same discipline as
   the guide pages and `verify-register`).
3. **The R-3 floor survives projection** — for every gloss, the T2 projection
   must contain the rule ID and *every* canonical move string (a superset
   check) within a declared line budget; the T3 rendering must render every
   move somewhere. A tier that drops a move is a build failure.
4. **The identity is byte-stable** — the canonical golden vectors are
   untouched; renderers consume the structured fields only. The manual
   re-stringification in `packages/allowlist-gate` (and any second builder)
   is retired onto the shared fields.
5. **Renderings never decide** — asserted by construction: the renderers read
   the same structured fields the decision already used, write nothing, and
   provide no service the constitution couples on.

## What changes per surface

- `packages/guide/` — hosts the gloss records and serves them as a guide page
  (the Subject can read *why it was refused* in band — R-3 and R-6 pointing
  at the same door).
- `packages/envelope/` — grows a projection module (T2, T3) over the
  structured fields; the canonical `text` is untouched.
- The terminal operator prompter — adds the gloss title/why line and the
  per-move operator actions to the ask it already renders.
- The gateway ask (`reason`) — carries the T3 form so the host's approval
  card shows the human face; the compact composition's transcript notes keep
  their current one-line discipline.

## Declared gaps and open questions

- **Web client rendering is unverified** — whether dsh's transcript pane
  renders markdown (bullets, bold) or collapses all whitespace is a recon
  item: send one formatted refusal, look at the page. T3 on the web page is
  the *text form* until that lands; the approval card widget itself is
  upstream's, fed by the `reason` we send.
- **How T2 is selected** — decided: operator-declared per composition
  (`COMPACT_ENVELOPE_TIER=instructional`; default `full`; an unknown value
  refuses rather than degrading). Per-model auto-detection was rejected —
  guessing the audience from a route name is the Enforcer guessing (D-7);
  per-agent override waits for a second agent class. The adjudication is
  recorded at [decision-envelope-tier.md](decision-envelope-tier.md).
- **Language** — English only at first; the runtime has one working language.
  i18n of glosses is not taken.
- **What the gloss is not** — it is not law, not a register entry, not
  coupled on. Where a gloss and the canonical envelope disagree, the envelope
  wins and the gloss is a bug with a failing lint.
