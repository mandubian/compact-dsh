# Concept — child-state honesty (MA-3)

*The implementation-agnostic spec `packages/specialists/src/child-state.js`
cites. Phase 6 (re-scoped — see [the decision record](decision-phase6-scope.md)).*

## The clause

> **MA-3 · [M within MA] · Child-state honesty.** A parent is informed of child
> transitions by the Enforcer, from recorded state, without polling
> obligations; the parent's picture of its children is the Enforcer's picture,
> never the child's self-report alone.

Three duties, and each shapes the implementation.

## By the Enforcer

Every fact comes from the host's own lifecycle seam — `subagent/start` and
`subagent/end`, published by `@deepseek-ai/dsh-subagent` — or from the child's
durable session header. Nothing is taken from the child's messages.

The delegating parent is recovered the way the host records it: the lifecycle
seam scopes dispatch by parent rather than naming it in the payload, so the
parent is read from the child's session header `parentSession` — the same
lineage that survives a restart.

## Without polling obligations

The parent is **told**. `agent.inject()` queues model-facing context for the
parent's next pre-step without waking its driver, so a transition reaches the
parent's picture whether or not the parent thought to ask.

A queryable snapshot exists too (`childrenOf`), but it is a convenience for an
operator or auditor — never the mechanism. A clause that said "the parent may
ask" would be a different clause.

## Never the child's self-report alone

`SubagentRunEndInfo` carries `lastAssistantMessage` — the child's **own**
account of what it did. That is evidence, not state.

It is therefore deliberately excluded from the state notice, and the parent is
told where the authority lies. The child's account reaches the parent through
the delegation tool's own result, attributed to the child; it never becomes the
Enforcer's picture by being reprinted alongside it.

The notice closes with the rule rather than leaving it implicit:

> The child's own account of its work reaches you as that delegation's tool
> result, attributed to the child. Where the two disagree, this record is the
> authoritative one (MA-3, D-2).

That sentence is not decoration. MA-3 makes the Enforcer's picture
authoritative over the child's account, and D-2 obliges a Subject to consult
the authoritative record over its own recollection. A parent that is not told
which of the two is authoritative cannot comply with either.

## What travels in the notice

`runId`, the child session id, the provider, the recorded `delegationDepth`
(which ties the notice back to MA-2's bound), the state, and the terminal stop
reason. The whole picture is re-rendered on every transition, not just the
child that moved.

## Failure posture

A failed notice never breaks the child's lifecycle, and an end edge for a start
this composition never saw records nothing — a record invented from a terminal
event alone would be a picture of something the Enforcer never observed.
