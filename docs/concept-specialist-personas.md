# Concept — specialist personas (the agent roster)

The implementation-agnostic spec for `packages/specialists` (port plan
Phase 5). Code in this repository cites this page; the port of record is
`agents/specialists/*` + `agents/lead` in the autonoetic workspace.

## What a specialist is

A specialist is a **delegation target with a declared surface**, not a prompt
vibe. Its full specification is five parts:

1. **Identity prose** — who the agent is, what it owes back (the durable
   output contract), and the doctrine that makes its behavior reviewable.
2. **Tool surface** — the list of tools the agent may *not* touch
   (`excluded_tools` at home; a `deny` filter on dsh). The surface is the
   enforcement: a denied tool is invisible to the agent and refuses execution
   — one visibility, never two. Granting happens by *shrinking the deny
   list*, never by prompt instructions.
3. **Output contract** — a JSON-schema-shaped return value the delegator can
   machine-check (`io.returns` at home). The prose teaches the contract; the
   schema is data beside it.
4. **Delegation budget** — whether the agent may spawn at all
   (`AgentSpawn max_children` at home), and how deep delegation may nest.
   Leaf specialists do not spawn: **no-recursive-spawn is a property of the
   surface, not a prompt request.**
5. **Phase gates** — sections of doctrine that only apply once the session
   has produced an artifact (`sections: heading/when` at home). Gate
   conditions are data, validated against a phase vocabulary; a gate never
   hides turn-1 doctrine.

The roster is the set of specialists + leads a composition offers. One
profile line composes the whole roster; each member is individually
spawnable by name.

## Roster composition: active vs archived

The roster is **data**, and a deployment mounts a *composition* of it — not
everything ported must be mounted. A persona can be **archived**: kept as
data (descriptor, prose, gates) but out of the loader, the lint, and the
tool surface. The archive is honest about why each member is out (substrate
not yet built, orchestrator role subsumed by the parent session, routing
replaced by the roster card) and revival is a file move, not a rewrite.

Mounting has a cost the home gateway did not price: on dsh every mounted
persona is a delegation-tool row on the **parent's** model-facing surface,
and the host contract derives every row's description from the provider
type — rows are description-identical, so each extra persona is surface cost
with name-only routing signal. Hence the companion rule:

- **The roster card.** The parent is taught the mounted roster — one line
  per persona (tool name, role, description), rendered from the descriptors —
  as a scoped system-prompt section beside the host's delegation guidance.
  Routing is a prompt-space decision backed by surface enforcement, never a
  guess from tool names.
- **Surface stays where it pays.** The default composition mounts the
  personas whose substrate exists; the rest wait in the archive until the
  phases that make them true land.

## The trimming doctrine

Skill content drifts by restatement: two copies of the same rule evolve into
two rules. The counter-doctrine (the #1329–#1331 line of work):

- **Canonical sections live in exactly one place.** Doctrine shared by
  several specialists (resumption, clarification protocol, output-contract
  deferral, gate-failure handling, retry discipline) is a canonical section;
  a specialist's file holds only what is unique to it.
- **Specialists dedup, never restate.** A specialist references a canonical
  section; it does not copy it. The roster composer assembles the final
  prompt (identity prose + referenced canonical sections + the output
  contract); the delivered prompt is self-contained even though the sources
  are shared.
- **A lint makes drift a build failure.** Verbatim restatement of a canonical
  section inside a specialist file fails the lint. So does an unresolved
  reference, a schema that does not parse, or a duplicate deny entry.

## Mapping to dsh (what degrades, honestly)

| At home (autonoetic) | On dsh | Note |
|---|---|---|
| SKILL.md frontmatter (YAML) | persona descriptor JSON + prose markdown beside it | same data, split for linting |
| `excluded_tools` (gateway tool names) | `toolFilter.deny` over **dsh** tool names | names are translated to the host's real tool surface; categories with no dsh analog (wiki, observability, federation, sentinel, constitution, capsule, planframe, scheduler where unmounted) have nothing to deny — the translation is documented per persona, never silently dropped |
| per-tool denial enforced by the gateway | per-child `tools.restrict()` in the child's creation window | identical semantics: invisible + refuses |
| `AgentSpawn max_children` (breadth) | `maxDepth` (depth only) | dsh bounds depth, not breadth — a counted, declared fidelity loss; a mounted leaf row caps at `maxDepth: 1` (the spawned child itself sits at depth 1 — 0 would refuse the first spawn), while the spawn tools stay denied on the leaf's own surface, so no grandchild is ever attempted |
| phase-gated sections | preserved as gated data, rendered as marked extended doctrine | dsh's prompt registry has no phase machinery — the gate travels with the data and is documented, not silently flattened |
| durable stateful agents (`runtime.lock`, resumption) | one-shot children by default; `backgroundMode: 'continuable'` where the composition mounts the continuation manager | the resumption doctrine stays in the prose; the mechanical resume is the host's continuable-child surface |
| `llm_preset` (coding/research/smart/…) | carried as metadata | dsh model routes are deployment-owned; the roster does not pretend to select models |
| write-path scopes (`WriteAccess scopes: self.*`) | not expressible per persona | dsh's fs policy is host-plane; recorded as a fidelity loss — read-only personas deny `write`/`edit` outright, workers keep them |
| structured `io.returns` | schema preserved as data; rendered into the prompt as the taught contract | dsh callers may additionally pass `outputSchema` at spawn time |
