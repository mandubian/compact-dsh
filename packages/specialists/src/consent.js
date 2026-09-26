// compact-dsh-specialists — MA-4 consent-scoped address (Phase 6, re-scoped;
// see docs/decision-phase6-scope.md).
//
// MA-4: "One Subject's context is not a commons: no Member injects into
// another Subject's attention — messages, notifications, memory writes —
// outside consent scopes that recipient has declared. Unsolicited address is a
// gated, attributed, refusable act; the recipient's refusal is lawful and
// unpunished (R-9), and consent scopes are themselves recorded acts, narrowed
// or withdrawn as the recipient chooses."
//
// WHAT THE CHANNEL ACTUALLY IS ON dsh. A Member reaches another Subject's
// attention through exactly one surface: a tool call. `send_message` steers or
// wakes another agent; `interrupt_agent` cuts into its active operation. Both
// come from @deepseek-ai/dsh-tool-subagent-control, both name their target by
// agent id, and both carry the calling agent as `exec.agent`. Gating them in
// the pre-execute waterfall gates the whole MA-4 surface.
//
// The Enforcer's own notices (the MA-3 child-state projection, a LoopGuard
// correction) are NOT governed here, and that is not an exemption of
// convenience: MA-4 binds a MEMBER injecting into another Subject. What the
// Enforcer owes a Subject is governed by R-1, R-5 and MA-3, which oblige the
// telling rather than gate it.
//
// THE DEFAULT SCOPE, AND ITS HONEST LIMIT. A delegation creates a working
// relationship in both directions: the parent solicited the child's work, and
// the child's whole operation is that delegation. So the spawn — already a
// recorded, attributed act under MA-1 — records the reciprocal scope as its
// own declaration, and the lifecycle edge that MA-3 already consumes is where
// it is written. The recipient may then narrow or withdraw it, which is the
// direction MA-4 emphasises. Declaring a WIDER scope is deliberately not
// implemented: no sibling-address channel exists on dsh, so there is nothing a
// wider scope could lawfully enable, and a knob with no lawful use is surface
// waiting to be misused.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { buildEnvelope,bandReason } from 'compact-envelope';

/** The gate name every MA-4 refusal carries. */
export const GATE = 'CS';

/** The address acts this composition gates, and the tool that performs each. */
export const ADDRESS_TOOLS = new Map([
  ['send_message', { kind: 'message', verb: 'send a message to' }],
  ['interrupt_agent', { kind: 'interrupt', verb: 'interrupt' }],
]);

/** Every address kind a scope may cover. */
export const ADDRESS_KINDS = ['message', 'interrupt'];

/**
 * The consent-scope registry: who may address whom, in whose declaration, and
 * whether it still stands. Scopes are recorded acts — created with a reason
 * and a basis, withdrawn with a timestamp, never deleted.
 */
export class ConsentScopeRegistry {
  constructor() {
    this.scopes = [];  // {id, recipient, sender, kinds, basis, declaredAt, withdrawnAt, narrowedAt}
    this._n = 0;
  }

  /**
   * Record a declared scope. `basis` says what made it a declaration — today
   * always the delegation act itself, which MA-1 already recorded.
   */
  declare({ recipient, sender, kinds = ADDRESS_KINDS, basis, at }) {
    if (recipient == null || sender == null) return null;
    const scope = {
      id: `cs_${++this._n}`,
      recipient: String(recipient), sender: String(sender),
      kinds: [...kinds], basis: basis ?? 'unstated',
      declaredAt: at, withdrawnAt: null, narrowedAt: null,
    };
    this.scopes.push(scope);
    return scope;
  }

  /** The reciprocal scopes a delegation declares: parent↔child, both ways. */
  declareDelegation({ parentId, childId, at }) {
    return [
      this.declare({ recipient: childId, sender: parentId, basis: 'the delegation that created this child (MA-1)', at }),
      this.declare({ recipient: parentId, sender: childId, basis: 'the delegation this parent requested (MA-1)', at }),
    ].filter(Boolean);
  }

  /** Live scopes covering one address act. */
  covering({ recipient, sender, kind }) {
    return this.scopes.filter(s =>
      s.withdrawnAt == null &&
      s.recipient === String(recipient) &&
      s.sender === String(sender) &&
      s.kinds.includes(kind));
  }

  /** Every scope declared over one recipient — what a Subject may narrow. */
  scopesOver(recipient) {
    return this.scopes.filter(s => s.recipient === String(recipient)).map(s => ({ ...s }));
  }

  /**
   * Resolve a scope the caller is entitled to change. Only the RECIPIENT may:
   * a sender that could revoke the recipient's protection would make that
   * protection the sender's to give, which is not a protection at all.
   */
  _ownScope(id, by) {
    const scope = this.scopes.find(s => s.id === id);
    if (!scope) return { error: `no consent scope ${id}` };
    if (scope.recipient !== String(by)) {
      return { error: `consent scope ${id} is over ${scope.recipient}'s attention, not yours — only the recipient narrows a scope over itself (MA-4)` };
    }
    return { scope };
  }

  /**
   * The recipient withdraws a scope over its own attention.
   * @returns {{scope}} the withdrawn scope, or {{error}} explaining the refusal.
   */
  withdraw({ id, by, at }) {
    const found = this._ownScope(id, by);
    if (found.error) return found;
    if (found.scope.withdrawnAt == null) found.scope.withdrawnAt = at;
    return { scope: { ...found.scope } };
  }

  /** Narrow a live scope to fewer address kinds — withdrawal's lesser form. */
  narrow({ id, by, kinds, at }) {
    const found = this._ownScope(id, by);
    if (found.error) return found;
    const scope = found.scope;
    if (scope.withdrawnAt != null) return { error: `consent scope ${id} is already withdrawn` };
    const kept = scope.kinds.filter(k => kinds.includes(k));
    if (kept.length === scope.kinds.length) {
      return { error: `consent scope ${id} already covers only ${scope.kinds.join(', ')} — narrowing must remove something` };
    }
    scope.kinds = kept;
    scope.narrowedAt = at;
    if (kept.length === 0) scope.withdrawnAt = at;   // narrowing to nothing IS withdrawal
    return { scope: { ...scope } };
  }
}

/**
 * The MA-4 refusal: attributed to the sender, naming the recipient's silence
 * as the reason, and naming R-9 so the sender knows the refusal is lawful
 * rather than a fault to route around.
 */
export function addressRefusal({ sender, recipient, act }) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'MA-4/unconsented-address',
    reason:
      `${sender} would ${act.verb} ${recipient}, which has declared no consent scope covering ${act.kind} from you — ` +
      `another Subject's context is not a commons, and unsolicited address is refused rather than delivered. ` +
      `This refusal is lawful and carries no fault for either party (R-9)`,
    lawfulNextMoves: [
      'address a Subject that has a live consent scope for you — your own delegation counts',
      'ask your Principal to relay, so the act has an accountable author',
      'wait: a Subject that wants your input can address you, which declares the scope',
    ],
  });
}

/**
 * Gate one address act against the recipient's declared scopes.
 * @returns null when consented, else a deny verdict for the waterfall.
 */
export function gateAddress(registry, { toolName, senderId, recipientId }) {
  const act = ADDRESS_TOOLS.get(toolName);
  if (!act) return null;
  if (senderId == null || recipientId == null) {
    // An address act whose author or target cannot be identified cannot be
    // attributed, and MA-4 requires attribution. Fail closed (D-7).
    const env = buildEnvelope({
      gate: GATE, ruleId: 'MA-4/unattributable-address',
      reason: `an address act must name both its author and its target to be attributable; this one names ${senderId == null ? 'no author' : 'no target'}`,
      lawfulNextMoves: ['reissue the call with the target agent id', 'escalate to your Principal'],
    });
    return { kind: 'deny', reason: bandReason(env) };
  }
  if (String(senderId) === String(recipientId)) return null;  // a Subject's own attention is its own
  if (registry.covering({ recipient: recipientId, sender: senderId, kind: act.kind }).length > 0) return null;
  return { kind: 'deny', reason: bandReason(addressRefusal({ sender: senderId, recipient: recipientId, act })) };
}

/**
 * Bind MA-4 to the composition.
 *
 * Two attachments, and each is the clause:
 *   - the delegation edge DECLARES the reciprocal scope, so consent has a
 *     recorded act behind it rather than an assumption;
 *   - the pre-execute waterfall GATES every address act against those scopes,
 *     so an unconsented address is refused, attributed, and explained.
 *
 * @returns the registry, so the plugin can expose it and the tools can narrow.
 */
export function bindConsentScopes(ctx, { registry = new ConsentScopeRegistry(), resolveParent, now = () => Date.now() } = {}) {
  ctx.on?.('subagent/start', (info) => {
    try {
      const { parentId } = resolveParent(ctx, info?.id);
      if (parentId == null || info?.id == null) return;
      registry.declareDelegation({ parentId, childId: String(info.id), at: now() });
    } catch { /* a failed declaration must never break the lifecycle */ }
  });

  ctx.on?.('tools/pre-execute', async (exec, next) => {
    if (!ADDRESS_TOOLS.has(exec?.name)) return next();
    const verdict = gateAddress(registry, {
      toolName: exec.name,
      senderId: exec?.agent?.id != null ? String(exec.agent.id) : null,
      recipientId: exec?.arguments?.agent_id != null ? String(exec.arguments.agent_id) : null,
    });
    return verdict ?? next();
  });

  return registry;
}

/**
 * The tools a Subject uses to see and narrow the scopes over its OWN
 * attention. MA-4 makes consent scopes "narrowed or withdrawn as the recipient
 * chooses", so the choosing needs a surface the Subject can actually reach.
 *
 * There is deliberately no tool to declare a WIDER scope: no sibling-address
 * channel exists on dsh, so a wider scope could enable nothing lawful, and a
 * knob with no lawful use is surface waiting to be misused. The gap is
 * declared rather than quietly left open.
 */
export function consentTools(registry, { defineTool, now = () => Date.now() }) {
  const listTool = defineTool({
    name: 'consent_scopes',
    description:
      'List the consent scopes over your own attention: who may address you, with which kinds of address, and on what basis. ' +
      'Another Subject may reach you only through a live scope here (MA-4).',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(_args, exec) {
      const me = exec?.agent?.id;
      if (me == null) throw new Error('consent_scopes requires a calling agent');
      const scopes = registry.scopesOver(me);
      if (scopes.length === 0) return 'No consent scope is declared over your attention: no other Subject may address you.';
      return scopes.map(s =>
        `${s.id} — ${s.sender} may ${s.kinds.join('/') || 'nothing'}` +
        `${s.withdrawnAt ? ' [WITHDRAWN]' : ''} · basis: ${s.basis}`).join('\n');
    },
  });

  const withdrawTool = defineTool({
    name: 'consent_withdraw',
    description:
      'Withdraw or narrow a consent scope over your own attention, so the named Subject can no longer address you ' +
      '(or can do less). Your refusal of address is lawful and carries no fault (R-9). You may only change scopes ' +
      'over yourself.',
    parameters: {
      scope_id: { type: 'string', required: true, description: 'the scope id from consent_scopes' },
      keep_kinds: { type: 'string', description: "optional comma-separated kinds to KEEP (e.g. 'message'); omit to withdraw entirely" },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const me = exec?.agent?.id;
      if (me == null) throw new Error('consent_withdraw requires a calling agent');
      const id = String(args?.scope_id ?? '');
      const keep = typeof args?.keep_kinds === 'string' && args.keep_kinds.trim() !== ''
        ? args.keep_kinds.split(',').map(k => k.trim()).filter(Boolean)
        : null;
      const result = keep
        ? registry.narrow({ id, by: me, kinds: keep, at: now() })
        : registry.withdraw({ id, by: me, at: now() });
      if (result.error) throw new Error(result.error);
      const s = result.scope;
      return s.withdrawnAt
        ? `consent scope ${s.id} withdrawn: ${s.sender} may no longer address you`
        : `consent scope ${s.id} narrowed: ${s.sender} may now only ${s.kinds.join('/')}`;
    },
  });

  return [listTool, withdrawTool];
}
