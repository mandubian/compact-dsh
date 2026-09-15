// compact-dsh-specialists — Phase 5 plugin (port plan Phase 5).
//
// The autonoetic specialist roster as dsh subagent personas. Each roster
// member maps to one delegation-tool row on the verified
// @deepseek-ai/dsh-tool-subagent contract (the same composition idiom the
// host's own standard preset uses for per-provider delegation tools):
//
//   persona prose  → config.persona    (shadows the deployment persona for the child)
//   excluded_tools → config.toolFilter.deny  (scoped tools.restrict(): invisible AND refuses)
//   no-recursive-spawn / depth bounds → config.maxDepth (leaves 0; leads capped)
//
// Every spawn through these tools is a recorded tool call naming the persona,
// and the child is session-backed with a durable descriptor — spawn under
// law, attributed (MA-1); the depth cap is enforced by the provider at every
// start (MA-2). The roster itself is exposed as the `compact-specialists`
// service so the constitution can couple on it and callers can enumerate it.
//
// The trim-dedup lint runs at boot: a roster that restates canonical doctrine
// or drops a source exclusion undocumented refuses to load — drift is a
// build failure, not a style note (#1329–#1331).
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { apply as applySubagentTool } from '@deepseek-ai/dsh-tool-subagent';
import { loadRoster, composePersona, DSH_TOOL_VOCABULARY } from './roster.js';
import { assertLintClean, lintRoster } from './lint.js';

export { loadRoster, composePersona, lintRoster, DSH_TOOL_VOCABULARY };

export const name = 'compact-specialists';
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
        maxDepth: p.descriptor.kind === 'lead' ? leadMaxDepth : 0,
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
    };

    for (const p of roster.personas) {
      applySubagentTool(ctx, {
        provider,
        toolName: p.descriptor.toolName,
        backgroundMode,
        persona: composePersona(p),
        toolFilter: { deny: [...p.descriptor.deny] },
        maxDepth: p.descriptor.kind === 'lead' ? leadMaxDepth : 0,
      });
    }

    ctx.provide?.('compact-specialists', service);
    return service;
  };
}

export const apply = specialistsPlugin();
