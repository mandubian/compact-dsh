# Secrets: injection under agreement

The agent never holds a credential. It holds a **reference**: the name of an environment variable. The value stays in the operator's environment and is injected into the confined container only while an operator-approved grant is live (`clause:I-5`, `clause:CF-1`). The design is in `file:docs/concept-secret-grants.md`.

## Declaring secrets (operator)

To let the agent use a GitHub token without seeing it:

```bash
export GH_TOKEN=…                          # the value: your shell only
COMPACT_SECRETS='["GH_TOKEN"]' npm run compact -- --attended --workspace /path/to/project "…"
```

- `env:COMPACT_SECRETS` is a JSON array of env-var **names**, never values. Each name must match `^[A-Z_][A-Z0-9_]*$`, or the boot refuses.
- The boot log states the posture: injection is declared and grant-bound for the listed names, or **absent** when none are declared. Declaring none is the default: nothing can be injected.
- An ask needs a decider: `flag:--attended` or `flag:--web`. See `page:approvals`.

## The agreement

1. A `tool:bash` command whose text **names** a declared secret is gated. Matching is by whole word, so `$GH_TOKEN`, `${GH_TOKEN}`, `printenv GH_TOKEN` and `os.environ['GH_TOKEN']` all count. `GH_TOKENS` does not.
2. The ask (`I-5/secret-use`) names the secret and states what approving means: a session-scoped, time-limited, revocable secret grant. The credential goes into the confined execution and never into the conversation, but **the command may print it, and the record keeps what it prints**.
3. Approving once does two things:
   - It creates a **secret grant** for each referenced name, scoped to this session. It lasts as long as the exec-cache TTL, 24 hours by default.
   - It creates an exec-cache entry for **that exact command**, so the identical command replays without asking again. A different command that names the secret asks again.
4. A command that also reaches the network is gated per host as well. See `page:network`.

## Injection

- At confine time, the sandbox reads each live grant's name from the launcher's environment and passes it to the container as an environment variable. The value appears only in the docker invocation. It never enters the grant store, which records the name only, and never the session log or model context.
- If a name is granted but not set in the launcher's environment, injection is skipped with a warning on the operator's log. The command then sees an empty variable and fails visibly.
- **Scope is the session, not the command.** While a grant is live, every confined call in that session receives the variable, including calls that never name it. A bare `env` can print it without an ask. This is part of what the operator agrees to, and it is bounded by the session and the TTL. See `page:sandbox`.

## Revoking and inspecting

`command:/grants-list` shows which secret names are declared, but it does not list live secret grants. `command:/grants-revoke` acts on session grants, and secret grants are stored separately. **No operator command in this runtime revokes a secret grant.** It lapses at its TTL. To stop injection sooner, launch without the variable in your environment.

## The leak detector

After every tool call, the arguments and the result are scanned for credential shapes: `sk-` tokens, authorization header values, `*TOKEN*`/`*SECRET*`/`*API_KEY*`-style assignments, secrets in URL queries, URL userinfo, and PEM private keys. A match logs a warning on the operator's log that names the tool and call id. The detector **only warns**: it withholds nothing and alters nothing, because the record cannot be scrubbed. Rotate the credential. Separately, the command preview shown to the operator in an ask has these shapes masked.

## What the Subject may and may not do

| May | May not |
|---|---|
| Reference a declared secret by name in a command that needs it, and say so in the reasoning the operator sees | Ask the operator to paste a credential into the conversation |
| Wait for the ask and respect a refusal | Print, echo, `env`-dump, or write an injected value to files or output |
| Rephrase without the reference (a lawful next move) | Read an undeclared variable and treat it as a grant. Undeclared names are simply absent |

If output unexpectedly contains a credential, say so to the operator so they can rotate it. The record has already kept it.
