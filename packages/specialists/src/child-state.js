// compact-dsh-specialists — MA-3 child-state honesty (Phase 6, re-scoped; see
// docs/decision-phase6-scope.md).
//
// MA-3: "A parent is informed of child transitions by the Enforcer, from
// recorded state, without polling obligations; the parent's picture of its
// children is the Enforcer's picture, never the child's self-report alone."
//
// Three duties, and each shapes the implementation:
//
//   BY THE ENFORCER. Every fact in the projection comes from the host's own
//   lifecycle seam — `subagent/start` and `subagent/end`, published by
//   @deepseek-ai/dsh-subagent — or from the child's durable session header.
//   Nothing is taken from the child's messages.
//
//   WITHOUT POLLING OBLIGATIONS. The parent is told. `agent.inject()` queues
//   model-facing context for the parent's next pre-step without waking its
//   driver, so a transition reaches the parent's picture whether or not the
//   parent thought to ask. No tool call, no status poll, no obligation.
//
//   NEVER THE CHILD'S SELF-REPORT ALONE. `SubagentRunEndInfo` carries
//   `lastAssistantMessage` — the child's OWN account of what it did. That is
//   evidence, not state, so it is deliberately excluded from the state line
//   and the parent is told where the authority lies. The child's account
//   reaches the parent through the delegation tool's own result, attributed to
//   the child; it never becomes the Enforcer's picture by being reprinted here.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const CHILD_STATE_PLUGIN = 'compact-specialists';

/**
 * The Enforcer's record of every delegation, keyed by parent session.
 *
 * This registry IS "the Enforcer's picture" the clause names: it is written
 * only from lifecycle edges and durable headers, and it is what both the
 * pushed notice and the queryable snapshot render.
 */
export class ChildStateRegistry {
  constructor() {
    this.byParent = new Map();   // parentSessionId -> Map(runId -> record)
    this.parentOfRun = new Map(); // runId -> parentSessionId (end edges carry no parent)
  }

  /** Record a start edge. Returns the record, or null when no parent resolves. */
  start({ runId, childId, provider, local, parentId, delegationDepth, at }) {
    if (parentId == null) return null;
    const record = {
      runId, childId: childId ?? null, provider: provider ?? null,
      local: local ?? null, parentId,
      delegationDepth: delegationDepth ?? null,
      state: 'running', stopReason: null,
      startedAt: at, settledAt: null,
    };
    const children = this.byParent.get(parentId) ?? new Map();
    children.set(runId, record);
    this.byParent.set(parentId, children);
    this.parentOfRun.set(runId, parentId);
    return record;
  }

  /**
   * Record an end edge. The end event carries no parent, so the pairing is by
   * `runId` — the identity the seam guarantees is shared with the start edge.
   * An unpaired end (a start this composition never saw) yields null rather
   * than a record invented from the terminal event alone.
   */
  end({ runId, stopReason, at }) {
    const parentId = this.parentOfRun.get(runId);
    if (parentId == null) return null;
    const record = this.byParent.get(parentId)?.get(runId);
    if (!record) return null;
    record.state = 'settled';
    record.stopReason = stopReason ?? null;
    record.settledAt = at;
    this.parentOfRun.delete(runId);
    return record;
  }

  /** The parent's picture, from recorded state — queryable, never obligatory. */
  childrenOf(parentId) {
    return [...(this.byParent.get(parentId)?.values() ?? [])].map(r => ({ ...r }));
  }
}

/** One child's state, rendered from Enforcer-held facts only. */
export function childStateLine(record) {
  const parts = [
    `run ${record.runId}`,
    `child ${record.childId ?? 'unidentified'}`,
    `via ${record.provider ?? 'unknown provider'}`,
  ];
  if (record.delegationDepth != null) parts.push(`depth ${record.delegationDepth}`);
  parts.push(record.state === 'settled' ? `settled (${record.stopReason ?? 'no stop reason recorded'})` : 'running');
  return `- ${parts.join(' · ')}`;
}

/**
 * The transition notice pushed to the parent.
 *
 * The closing sentence is not decoration: MA-3 makes the Enforcer's picture
 * authoritative over the child's account, and D-2 obliges a Subject to consult
 * the authoritative record over its own recollection. A parent that is not
 * told which of the two is authoritative cannot comply with either.
 */
export function transitionProse(record, children) {
  const head = record.state === 'settled'
    ? `Child delegation settled — ${record.stopReason ?? 'no stop reason recorded'}.`
    : 'Child delegation started.';
  const lines = [
    `[MA-3] ${head} This notice is from the Enforcer's record of your delegations, not from the child.`,
    '',
    'Your children, as the Enforcer has them recorded:',
    ...children.map(childStateLine),
    '',
    "The child's own account of its work reaches you as that delegation's tool result, attributed to the child. " +
    'Where the two disagree, this record is the authoritative one (MA-3, D-2).',
  ];
  return lines.join('\n');
}

/**
 * Resolve the delegating parent for a start edge, from the host's own state.
 *
 * The lifecycle seam scopes dispatch by the delegating parent rather than
 * naming it in the payload, so the parent is recovered the way the host
 * records it: the child's durable session header carries `parentSession`, the
 * same lineage that survives a restart.
 */
export function resolveParent(ctx, childId) {
  try {
    const child = ctx.get?.('agents')?.get?.(childId);
    const header = child?.session?.header;
    if (!header?.parentSession) return { parentId: null, delegationDepth: header?.delegationDepth ?? null };
    return { parentId: String(header.parentSession), delegationDepth: header.delegationDepth ?? null };
  } catch {
    return { parentId: null, delegationDepth: null };
  }
}

/**
 * Bind MA-3 to the composition: listen on the host lifecycle edges, keep the
 * Enforcer's picture, and inform the parent on every transition.
 *
 * @returns the registry, so the plugin can expose the queryable snapshot.
 */
export function bindChildState(ctx, { registry = new ChildStateRegistry(), now = () => Date.now() } = {}) {
  const inform = (record) => {
    try {
      const parent = ctx.get?.('agents')?.get?.(record.parentId);
      if (typeof parent?.inject !== 'function') return;
      parent.inject(createUserMessage({
        content: [{ type: 'text', text: transitionProse(record, registry.childrenOf(record.parentId)) }],
        source: { kind: 'plugin', plugin: CHILD_STATE_PLUGIN },
      }));
    } catch { /* a failed notice must never break the child's lifecycle */ }
  };

  ctx.on?.('subagent/start', (info) => {
    try {
      const { parentId, delegationDepth } = resolveParent(ctx, info?.id);
      const record = registry.start({
        runId: info?.runId, childId: info?.id != null ? String(info.id) : null,
        provider: info?.provider, local: info?.local, parentId, delegationDepth, at: now(),
      });
      if (record) inform(record);
    } catch { /* accounting must never break the lifecycle */ }
  });

  ctx.on?.('subagent/end', (info) => {
    try {
      // NOTE: info.lastAssistantMessage is the child's self-report. It is read
      // nowhere in this handler — that omission is the clause.
      const record = registry.end({ runId: info?.runId, stopReason: info?.stopReason, at: now() });
      if (record) inform(record);
    } catch { /* accounting must never break the lifecycle */ }
  });

  return registry;
}
