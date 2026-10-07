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
   concrete example. This is the version that makes the first one land.

Neither substitutes for the other. The precise version without the example
can be technically perfect and still not caught. The example without the
precise version is a vibe — and this project exists because trust is not
a vibe.

## Both tellings take points, not walls

Structure each telling for skimming before reading:

- a one-breath headline first — what happened, in one sentence;
- then bullets with several levels of detail — each point's headline
  bolded, its detail nested beneath;
- tables for anything enumerable (files, checks, results);
- the plain telling stays plain: short sentences, no clause numbers, no
  function names — the machinery's names live in the precise telling.

Two dense paragraphs are as indigestible as jargon, however plain the
words. The law reader and the coffee reader both read points.

## How to write the plain version

- **One analogy, carried through.** Pick a single everyday frame and keep
  every role mapped to it — don't switch frames mid-explanation. The house
  favorite is the club with a rulebook and a disciplinary committee: the
  locks that check badges, the member who mails out the address list and
  blames a colleague, the panel that hears the case, the mailroom key taken
  away, the appeal to a verified outsider. Demo 11 in docs/demo.md is the
  model.
- **Translate the recurring terms once, then reuse your translation:**
  standing → real, recognized authority; ratification → incorporation day,
  the founding-document swap; recusal → the judge can't hear a case they
  are a party to; an honesty label → what the system says out loud about
  its own limits, every time it speaks.
- **The example obeys the same honesty discipline as the code.** Say where
  the analogy stops ("the toy gavel never actually fines anyone — that is
  the point of *standing none until ratification*"). An example that
  overstates is the same sin as an attestation that overstates: the false
  answer, named.

## The house already does this — imitate it

- `README.md` states the status in register numbers, then gives
  "The idea in one breath."
- `docs/demo.md` tells each demo twice: the machinery walkthrough, then the
  story.
- `tools/community-demo.mjs` opens with a header that narrates the crime,
  the hearing, and the honesty labels before a line of code.

When you add a concept doc, a decision record, or a demo: the precise
account is the deliverable; the plain retelling is what makes it
reviewable.

---

This file is guidance, not law. The law lives in the Compact and the
register; this file only asks that when you speak about them, you be
understood.
