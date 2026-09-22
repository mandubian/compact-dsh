// compact-dsh-specialists — Phase 5 plugin (port plan Phase 5).
//
// The autonoetic specialist roster as dsh subagent personas. Each roster
// member maps to one delegation-tool row on the verified
// @deepseek-ai/dsh-tool-subagent contract (the same composition idiom the
// host's own standard preset uses for per-provider delegation tools):
//
//   persona prose  → config.persona    (shadows the deployment persona for the child)
//   excluded_tools → config.toolFilter.deny  (scoped tools.restrict(): invisible AND refuses)
//   no-recursive-spawn / depth bounds → config.maxDepth + toolFilter.deny
//     (specialists capped at 1: the child a parent spawns sits at depth 1 —
//     0 would refuse the first spawn, not recursion. The "leaves" half of the
//     doctrine is the surface property: the child's own spawn tools are denied
//     via toolFilter.deny, so no grandchild is ever attempted — and depth 2
//     refuses at the provider regardless. Leads stay capped at leadMaxDepth.)
//
// Every spawn through these tools is a recorded tool call naming the persona,
// and the child is session-backed with a durable descriptor — spawn under
// law, attributed (MA-1); the depth cap is enforced by the provider at every
// start (MA-2). The roster itself is exposed as the `compact-specialists`
// service so the constitution can couple on it and callers can enumerate it.
// The host contract derives every delegation-tool description from the
// provider type, so the parent also gets a **roster card** — one line per
// persona — as a scoped `systemPrompt` section right after the host's own
// delegation guidance; without it, routing among the rows is name-guessing.
//
// The trim-dedup lint runs at boot: a roster that restates canonical doctrine
// or drops a source exclusion undocumented refuses to load — drift is a
// build failure, not a style note (#1329–#1331).
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { defineTool } from '@deepseek-ai/dsh-tools';
import { apply as applySubagentTool } from '@deepseek-ai/dsh-tool-subagent';
import { loadRoster, composePersona, DSH_TOOL_VOCABULARY } from './roster.js';
import { assertLintClean, lintRoster } from './lint.js';
import { bindChildState, ChildStateRegistry, transitionProse, childStateLine, resolveParent } from './child-state.js';
import { bindConsentScopes, ConsentScopeRegistry, consentTools, gateAddress, ADDRESS_TOOLS } from './consent.js';

export { loadRoster, composePersona, lintRoster, DSH_TOOL_VOCABULARY };
export { bindChildState, ChildStateRegistry, transitionProse, childStateLine };
export { bindConsentScopes, ConsentScopeRegistry, consentTools, gateAddress, ADDRESS_TOOLS };

export const name = 'compact-specialists';
export const ROSTER_CARD_SECTION = 'compact:roster-card';

/**
 * The parent-facing roster card — the routing signal the delegation-tool rows
 * cannot carry: the host contract derives every tool description from the
 * provider type, so without this section the parent picks among
 * identically-described tools by name alone. One line per persona, rendered
 * from the descriptors (single source of truth).
 */
export function rosterCardText(roster) {
  const lines = [
    '## Specialist roster',
    '',
    'Delegate focused work to a specialist child — it works in its own context, under its own doctrine and restricted tool surface. Pick by role, and give the child a complete, standalone prompt:',
    '',
  ];
  for (const p of roster.personas) {
    lines.push(`- \`${p.descriptor.toolName}\` — ${p.descriptor.name}: ${p.descriptor.description}`);
  }
  return lines.join('\n');
}

// The delegation rows we mount ride the verified @deepseek-ai/dsh-tool-subagent
// contract, whose inject is ['tools','subagents','systemPrompt','sessionProjections']
// — the same four must exist when we load or the mount cannot register its
// rows. Fail loud, never degrade.
export const inject = ['tools', 'subagents', 'systemPrompt', 'sessionProjections'];

export function specialistsPlugin(opts = {}) {
  return (ctx, config = {}) => {
    // the lint IS the boot gate for the roster data
    assertLintClean();

    const roster = loadRoster();
    const provider = config.provider ?? opts.provider ?? 'spawn';
    const backgroundMode = config.backgroundMode ?? opts.backgroundMode ?? 'one-shot';
    const leadMaxDepth = config.leadMaxDepth ?? opts.leadMaxDepth ?? 3;
    // The mounted tool's maxDepth caps the SPAWNED CHILD's depth (provider
    // arithmetic: child depth = parent depth + 1, refused past maxDepth). A
    // top-level parent spawning a specialist produces a depth-1 child, so the
    // cap for a non-lead row is 1 — 0 would refuse the very first spawn
    // (#37). That a specialist never spawns is enforced on its own surface
    // (deny: subagent, subagent_fork); maxDepth 1 is the provider-side backstop.
    const specialistMaxDepth = 1;
    const mountedMaxDepth = (p) => (p.descriptor.kind === 'lead' ? leadMaxDepth : specialistMaxDepth);

    // MA-3: the Enforcer's picture of every delegation, written from the host
    // lifecycle edges and pushed to the parent on each transition (never
    // polled, never taken from the child's own account) — see child-state.js.
    const childState = bindChildState(ctx);

    // MA-4: one Subject's context is not a commons. The delegation edge
    // declares the reciprocal scope; every address act is gated against the
    // recipient's live scopes; the recipient narrows or withdraws its own.
    const consent = bindConsentScopes(ctx, { resolveParent });
    for (const tool of consentTools(consent, { defineTool })) ctx.tools.register(tool);

    const service = {
      provider,
      backgroundMode,
      personas: roster.personas.map(p => ({
        name: p.descriptor.name,
        toolName: p.descriptor.toolName,
        kind: p.descriptor.kind,
        description: p.descriptor.description,
        preset: p.descriptor.preset,
        spawns: p.descriptor.spawns,
        maxDepth: mountedMaxDepth(p),
        deny: p.descriptor.deny,
        source: p.descriptor.source,
      })),
      list: () => service.personas.map(p => p.name),
      surface: (name) => {
        const p = service.personas.find(x => x.name === name);
        return p && { toolName: p.toolName, deny: p.deny, maxDepth: p.maxDepth, spawns: p.spawns };
      },
      /** The delivered persona prompt (assembled: unique prose + canonical sections). */
      prompt: (name) => {
        const p = roster.byId.get(name);
        return p ? composePersona(p) : undefined;
      },
      /**
       * MA-3: a parent's children as the ENFORCER has them recorded. Offered
       * as a convenience for an operator or auditor, never as an obligation —
       * the parent is informed by injection whether or not it ever asks.
       */
      childrenOf: (parentSessionId) => childState.childrenOf(String(parentSessionId)),
      /** MA-4: the consent scopes over one Subject's attention. */
      consentScopesOver: (sessionId) => consent.scopesOver(String(sessionId)),
    };

    for (const p of roster.personas) {
      applySubagentTool(ctx, {
        provider,
        toolName: p.descriptor.toolName,
        backgroundMode,
        persona: composePersona(p),
        toolFilter: { deny: [...p.descriptor.deny] },
        maxDepth: mountedMaxDepth(p),
      });
    }

    // The roster card rides the host prompt registry as a scoped section,
    // directly after the host's own subagent-tool guidance (fail loud if the
    // registry or the placement name is absent — never a silent skip).
    ctx.systemPrompt.section({
      name: ROSTER_CARD_SECTION,
      order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 1,
      text: rosterCardText(roster),
    });

    ctx.provide?.('compact-specialists', service);
    return service;
  };
}

export const apply = specialistsPlugin();
