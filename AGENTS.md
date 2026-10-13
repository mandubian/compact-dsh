# AGENTS.md — guidance for agent sessions in this repo

## The doctrine: say it twice — precisely, then plainly

The Compact is a constitution. Its vocabulary — standing, ratification,
recusal, remedies, attestation, honesty labels — is legal on purpose, and
this repo's docs speak it fluently. But a reader who doesn't catch the law
is not served by a more exact statement of it.

So whenever you explain a situation, a mechanism, a refusal, a verdict, or
a design decision to the operator, say it **twice**:

1. **The precise version** — the real names: the clause, the register
   entry, the exact machinery. This is the version that is true.
2. **The plain version** — the same thing in everyday words, with one
   concrete before/after example: what you could not do before, what you
   can do now, shown on a real command or output. This is the version that
   makes the first one land.

Neither substitutes for the other. The precise version without the example
can be technically perfect and still not caught. The example without the
precise version is a vibe — and this project exists because trust is not
a vibe.

## Both tellings take points, not walls

The failure case, named: two dense paragraphs — one precise, one plain —
is the jargon problem with the jargon removed. The reader bounces off
both walls equally, and trust that is not read protects no one. **Never
ship that shape.** This holds everywhere the operator reads you — chat
replies, PR and issue descriptions, review answers, commit narratives,
and the docs.

Each telling instead:

- opens with a one-breath headline — what happened, in one sentence;
- continues as bullets with several levels of detail — each point's
  headline bolded, its detail nested beneath;
- uses tables for anything enumerable (files, checks, results);
- keeps the plain telling plain: short sentences, no clause numbers, no
  function names — the machinery's names live in the precise telling.

Two dense paragraphs are as indigestible as jargon, however plain the
words. The law reader and the coffee reader both read points.

## How to write the plain version

- **No metaphor.** Story frames — a club, a doorman, passes and badges —
  add a second vocabulary to translate instead of removing the first one.
  Retired by operator decision (2026-10-12): the plain version shows what
  the code **does**, on a real example.
- **One concrete before/after example, carried by real commands and real
  output.** The command that failed and the actual error; the command that
  now succeeds; the rule, file, or row that changed. Where a behavior did
  *not* change, say "unchanged" — negative space is information. Example
  shape:
  ```bash
  /grants-grant https://api.example.com/v1/ 60 50 read
  # before: 1 grant → the gate allows https calls to /v1/*, the proxy refuses them (403)
  # after:  2 grants → the gate allows, the proxy carries
  ```
- **Simple facts in short sentences.** No clause numbers, no function
  names in the plain telling.
- **Define specific terms inline, or link the vocabulary** — the concept
  docs (`docs/concept-*.md`) and the register (`docs/register/register.json`)
  are the canonical definitions. One link beats a renamed story character.
- **The example obeys the same honesty discipline as the code.** Say where
  the example stops. An example that overstates is the same sin as an
  attestation that overstates: the false answer, named.
- **In PR and issue descriptions**: the precise version carries the design;
  the plain version is the before/after example above plus a definitions
  list — the command or output that changed, not a story about it.

## The house already does this — imitate it

- `README.md` states the status in register numbers, then gives
  "The idea in one breath."
- `docs/demo.md` tells each demo twice: the machinery walkthrough, then a
  short plain summary of what it shows.
- `tools/community-demo.mjs` opens with a header that narrates what the
  run does and which honesty labels apply, before a line of code.

When you add a concept doc, a decision record, or a demo: the precise
account is the deliverable; the plain retelling — example first, terms
defined — is what makes it reviewable.

---

This file is guidance, not law. The law lives in the Compact and the
register; this file only asks that when you speak about them, you be
understood.
