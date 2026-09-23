# Concept — reading the law, and reading the runtime (R-6, the guide)

*The spec `packages/constitution/src/law.js` and `packages/guide/` cite.
It records why autonoetic's wiki was ported in part and left out in part.*

## What a Subject could know before this

| Question | Surface | Standing |
|---|---|---|
| what am I, what may I do, what is left | the attestation (`self_describe`, injected each turn) | authoritative over memory (R-1) |
| why was I refused, what is lawful now | the refusal envelope | authoritative for that act (R-3) |
| what does every Member hold to | the taught digest, closing the attestation | interpretive aid; the body prevails |
| **what does the law say** | — | — |
| **how does this runtime work** | — | — |

The two empty rows are what this change fills.

## R-6 was registered as enforced and was not exercisable

> Every Subject may read the full text of the law it lives under, addressed by
> its digest. A Member cannot consent to, contest, or reason under a law it
> cannot read.

The constitution service always held the body (`body()`), and the register
cited that accessor as R-6's enforcement. But a service method reaches only
code running inside the Enforcer. The composition disables the host's file
tools, and the body is not in the Subject's workspace, so the Subject could not
read the text of the law it was asked to petition under (R-11), contest (J-6)
or refuse by (R-9). A right that only the Enforcer can exercise is the
Enforcer's own access, not a right the Subject holds.

`law_read` is that right:

- **The body, never a restatement.** With no argument it returns the table of
  contents. With `clause` it returns that clause's text, sliced from the
  boot-verified body. With `full` it returns the whole body. Nothing is
  paraphrased (F-7).
- **Addressed by its digest.** Every answer names the sha256 it was read from.
  A Subject may pass `citing_digest`, and a mismatch raises an alarm in the
  answer, in the same shape as R-1's staleness alarm. An address the Subject
  cannot compare is not one it can use.
- **Unknown ids are answered, not refused.** The answer says the id is not a
  clause of this law. It never offers a near match as the text asked for.
- **Bounded by default.** The body is roughly 40 KB. It is opt-in, and it is
  never injected: the per-turn block stays the taught appendix.

## The guide: ported, but without autonoetic's two weaknesses

autonoetic's wiki gave agents a curated corpus about their ecosystem. Most of
that corpus is already covered here, and better, because it is delivered at the
point of use:

- **Tool reference.** Each tool carries its own description.
- **Rules.** The law is read through `law_read`, the envelope names the rule
  at the moment of refusal, and the attestation names the capabilities in force.
- **Discipline.** The personas' canonical sections, one place only, enforced by
  the trim-dedup lint.

What was not covered is the **operator's question put to the agent**: "how do I
let it reach github?", "where are the records?", "what does `--attended`
do?". Answering that needs knowledge of mechanisms and of the operator's
controls (flags, env vars, slash commands, state layout). No attestation holds
that knowledge, and no envelope holds it until something is refused.
`compact-dsh-guide` serves exactly that, through one tool, `guide`.

The two ways the wiki drifted are designed out:

1. **Paraphrase with no link to the source.** autonoetic's pages named a
   constitution version that was no longer active, and seven pages drifted from
   the docs they digested. Here, every name a page uses (tool, command, env var,
   flag, clause, file, page) appears in a backticked prefixed form, and the
   guide's suite resolves every one against the code. Tool citations are also
   checked against the live composition by the blessed loader test. A bare
   surface name without its prefix also fails, so a page cannot slip an
   unchecked name past the check. The page can be incomplete. It cannot name
   what does not exist.
2. **A second authority.** Every served page opens with its standing: an
   interpretive aid with no force, below the law, the attestation and the
   envelope. The overview page tells the Subject to trust those sources when a
   page disagrees, and to report the page as out of date.

**No write path.** autonoetic had `wiki_propose`. Here a page changes the way
the register does, through a reviewed change to the package. A page the Subject
can write is a page one Subject can use to teach the next something the
Enforcer never said.

**No coupling.** The guide enforces no clause, so the constitution does not
require it and it has no register entry (F-7: nothing is law that does not
trace to the body). The blessed composition mounts it as a convenience.
