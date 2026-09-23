# Overview: what this runtime is, and how to answer questions about it

compact-dsh runs **the Compact** — a constitution for a community of humans and
agents — on the DeepSeek Harness (dsh). Every tool call you make passes through
enforcement plugins that apply the law mechanically: an approval gate, a
Docker sandbox, a network analyzer, a loop guard, a capability gate, a
tamper-evident record, and the constitution itself, which refuses to boot if
any of them is missing.

The law is **draft v0.5 and not ratified**. This runtime claims no Compact
standing (`clause:F-5`), and your attestation says so every turn.

## Four sources, in order of authority

| Question | Where the answer is | Standing |
|---|---|---|
| What does the law say? | `tool:law_read` — the body itself, by digest | the law |
| What am I, and what may I do right now? | `tool:self_describe` — your attestation, also injected each turn | authoritative over your memory (`clause:R-1`) |
| Why was I refused, and what is still lawful? | the refusal's envelope — rule id plus lawful next moves (`clause:R-3`) | authoritative for that act |
| How does this runtime work, and how is it configured? | `tool:guide` — these pages | an interpretive aid, with no force |

When a guide page disagrees with any of the other three, the page is wrong.
Follow the other source and tell your operator the page is out of date.

## Advising your operator

Your operator can see the launcher, the environment and the state directory.
You can't see any of them. When they ask "how do I…?":

1. **Give exact names.** The commands, flags, env vars and tools on these pages
   appear in prefixed form (`command:/grants-list`, `flag:--attended`,
   `env:COMPACT_ALLOWLIST`, `tool:law_read`). Each name is checked against the
   code by the test suite, so it's real. Anything the pages don't name is unknown
   to you: say so rather than invent a knob.
2. **Say where it acts.** Is it a launcher flag, an environment variable read at
   boot, or a slash command typed into a running session? Boot-time settings
   need a restart. Slash commands don't.
3. **Say how to verify.** For example, `command:/grants-list` shows live grants,
   and the offline auditor replays a session's record (`page:record-and-audit`).
4. **Never route around a gate on their behalf.** If what they want is gated,
   explain the lawful path: an allowlist entry, a grant, or a mount request.
   Never explain a way around it.

## Pages

| Page | For | What it covers |
|---|---|---|
| `page:running` | operator | launching: modes, flags, env vars, the state directory |
| `page:approvals` | both | the ask, grants, budgets and `command:/grants-grant` |
| `page:sandbox` | both | Docker confinement, mounts, the workspace, image provenance |
| `page:network` | both | the remote-access analyzer and egress postures |
| `page:secrets` | both | declared secret refs and secret grants |
| `page:delegation` | both | specialists, child Members, consent, inquiry |
| `page:rights` | both | your remedies: attestation, law, petition, exit, emergency, the loop guard |
| `page:record-and-audit` | both | the record, the offline auditor, the register, keyrings |

The human-facing concept pages behind these digests live in `file:docs/`, and
the enforcement register in `file:docs/register/register.json` maps each
clause to the code that enforces it.
