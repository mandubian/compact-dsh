# Delegation: specialists, children and address

A Subject can hand focused work to a **specialist child**. Each specialist is a
delegation tool; calling it spawns a child session with its own persona prose,
its own restricted tool surface and a depth cap. The spawn is a recorded act of
the parent, and the child is a full Member from its first act (`clause:MA-1`).

## The roster

| Tool | Role | Preset | Notably denied on its surface |
|---|---|---|---|
| `tool:specialist_architect` | design, structure, task decomposition — designs, never implements | coding | web search/fetch, spawning, peer messaging |
| `tool:specialist_coder` | durable, tested, minimal code changes meant for review or handoff | coding | web search/fetch, spawning, `tool:promotion_record` |
| `tool:specialist_debugger` | root-cause analysis and targeted fixes | coding | spawning, peer messaging |
| `tool:specialist_researcher` | evidence collection with cited sources and stated confidence; keeps web search/fetch | research | spawning, peer messaging |
| `tool:specialist_auditor` | static review and the promotion gate — reviews, never implements or runs the code under review | coding | web search/fetch, spawning, peer messaging |

The parent also gets a **roster card** in its system prompt (one line per
persona) so it can route by role. Give the child a complete, standalone prompt:
it does not share the parent's context. Each persona has an output contract (a
JSON schema) appended to its prompt, and returns one object matching it.

Persona prose lives in `file:packages/specialists/personas`, one
`<id>.persona.json` descriptor plus `<id>.md` prose each; shared doctrine is in
`file:packages/specialists/personas/shared`. The roster is linted at boot: a
roster that restates shared doctrine, or drops a source exclusion without
documenting it, refuses to load.

## Depth and background mode

- **Specialists are leaves.** A specialist child sits at depth 1; its own spawn
  tools are denied, and the provider refuses anything past depth 1 regardless
  (`clause:MA-2`).
- **Leads** (persona kind `lead`) would be capped at `leadMaxDepth`, 3 by
  default. The current roster ships no lead persona.
- **Background mode** is `one-shot` by default (children are not resumed);
  `continuable` is accepted where the composition mounts the host's
  continuation manager.
- Provider, background mode and `leadMaxDepth` are composition config (see
  `file:packages/blessed/src/index.js` and
  `file:packages/specialists/cordis.patch.yml`). The launcher exposes no flag or
  env var for them.

## What the parent is told about its children

The Enforcer keeps its own record of every delegation, written from the host's
start and end lifecycle edges — never from what the child says. On every
transition the parent receives an `[MA-3]` notice listing its children as the
Enforcer has them: run id, child id, provider, depth, and `running` or
`settled (<stop reason>)`. No polling is needed or expected.

The child's own account of its work arrives separately, as that delegation
tool's result, attributed to the child. **Where the two disagree, the
Enforcer's record is authoritative** (`clause:MA-3`, `clause:D-2`). Report the
recorded state to your operator, and the child's account as the child's claim.
See `file:docs/concept-child-state-honesty.md`.

## Consent scopes: who may address whom

Another Subject's context is not a commons (`clause:MA-4`). The host's
agent-to-agent message and interrupt tools are gated: an address act goes
through only if the recipient has a live consent scope covering that sender and
that kind (`message` or `interrupt`). A Subject addressing itself is never
gated.

- A delegation **declares reciprocal scopes** automatically: parent may address
  child, child may address parent. Nothing else declares one, and there is no
  tool to widen a scope.
- `tool:consent_scopes` lists the scopes over **your own** attention: scope id,
  sender, kinds, basis, and whether withdrawn.
- `tool:consent_withdraw` takes a `scope_id`, and optionally `keep_kinds`
  (comma-separated) to narrow instead of withdraw. Only the recipient can change
  a scope over itself; narrowing to nothing is withdrawal; a narrowing that
  removes nothing is refused.
- An unconsented address is refused with a `CS` envelope naming the recipient's
  silence and lawful next moves (for example, ask your Principal to relay).
  Refusing address is lawful and carries no fault (`clause:R-9`).

See `file:docs/concept-consent-scoped-address.md`.

## Asking about another Member

`tool:inquiry` takes an `agent_id` and answers from recorded state only
(`clause:R-13`):

- **Identity** — root or delegated Subject, delegation depth, preset, and the
  Enforcer-issued certificate with its verdict when an enforcer annex is
  composed (otherwise it says none can exist).
- **Act** — lifecycle state from the Enforcer's delegation record, or the host's
  live status.
- **Authority** — the delegation chain walked to its root, then the operator as
  ultimate Principal; an incomplete chain says why.

It never reads prompts, messages or outputs: reasoning is not disclosed
(`clause:R-10`). An unknown id is still answered: "no session recorded under this id in this
runtime".

## For the operator

- Confinement, approvals and the record are covered in `page:sandbox`,
  `page:approvals` and `page:record-and-audit`.
- A child ends through the lawful grounds of `clause:R-8`; its obligations are
  handled as described in `page:rights`.
- The law's own text: `tool:law_read` with `clause:MA-1` through `clause:MA-4`.
