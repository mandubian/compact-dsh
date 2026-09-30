// compact-dsh-judicature — Part V slice 1 (J-8 → J-4, #111): the adjudicator
// sets, the independence check, and the layer's whole honest behavior until
// slice 2 — refusal with the reason named.
//
// WHY THIS SHAPE (docs/concept-judicature.md): a hearing layer built before
// its bench would have exactly two ways to answer a case — refuse (honest,
// but then why was it built) or sit the Enforcer down (D-8's theater). So
// the first thing built is the BENCH: a declared composition fact in the
// signed annex, whose independence from any case's parties is a graph
// property checked mechanically, before anything hears.
//
// Fail-closed ladder, in order:
//   1. no annex installed            → [JG/set-undeclared]
//   2. annex without a sets section  → [JG/set-undeclared]
//   3. annex with a MALFORMED section → the BOOT refuses (a broken
//      affidavit is not a missing one — D-7)
//   4. sets declared, no hearing     → [JG/hearing-unbuilt] (slice 2, #112)
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { readFileSync } from 'node:fs';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildEnvelope } from 'compact-envelope';
import { verifyAnnex } from 'compact-dsh-seals';
import { COMPACT_DIGEST } from 'compact-dsh-constitution';
import {
  SetError, validateAdjudicatorSets, undeclared, recusePerSet, resolvePanel,
  independenceBetweenSets, trajectoryState, STANDING_KINDS, EDGE_VOCABULARY,
} from './sets.js';

export {
  SetError, validateAdjudicatorSets, undeclared, recusePerSet, resolvePanel,
  independenceBetweenSets, trajectoryState, STANDING_KINDS, EDGE_VOCABULARY,
};

export const name = 'compact-judicature';
export const SOURCE = { kind: 'plugin', plugin: name };
export const GATE = 'JG';

/** The refusal seam already on the bus (the collision counter rides it). */
const REFUSAL_EVENT = 'compact-approval/refusal';

/** The declared gaps this layer carries into the boot record (I-8). */
export const DECLARED_GAPS = [
  'the hearing itself is slice 2 (#112): cases, evidence reads, judgments and dissents do not exist yet — ' +
  'the hear door refuses with JG/hearing-unbuilt, which is D-7 working, not a defect',
  'external Witnesses are pending I-1 identity keys (#116): the cascade\'s last rung is unreachable, and a case ' +
  'whose every declared set recuses is recorded unheard — never dismissed, never defaulted',
  'appeal (J-5) requires at least two declared, disjoint sets (#114): with one set there is no appellate ' +
  'authority, and the appeal door will refuse with the reason named exactly as this door does',
  'rehearsal standing only: the annex this layer reads is standing:none under the development keyring — ' +
  'the machinery is honest about code-path correctness and nothing else',
];

/** The [JG/set-undeclared] envelope — the layer's first honest behavior. */
export function setUndeclaredEnvelope(detail) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'set-undeclared',
    reason: `no adjudicator set is declared (${detail}) — nothing can be heard until one is, by design: ` +
      'a hearing before its bench would have two moves, refuse or sit the Enforcer down, and the second is the theater D-8 forbids',
    lawfulNextMoves: [
      'read the declared sets and their trajectory with judicature_sets',
      'petition for an adjudicator-set declaration through the petition channel (R-11)',
      'contested application of the law stays on the record you already hold (R-2)',
    ],
  });
}

/** The [JG/hearing-unbuilt] envelope — sets exist, slice 2 does not. */
export function hearingUnbuiltEnvelope() {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'hearing-unbuilt',
    reason: 'adjudicator sets are declared and verified, but the hearing machinery (cases, evidence, judgments) ' +
      'is slice 2 (#112) and does not exist — refusing to convene a panel it cannot lawfully seat is D-7 working',
    lawfulNextMoves: [
      'inspect the declared bench and its independence with judicature_sets',
      'petition through the R-11 channel — the door a court does not own',
    ],
  });
}

/** Load and validate the sets an annex declares, or the honest empty state.
 *  A malformed section refuses (D-7): a broken affidavit is not a missing one. */
export function loadJudiciary(annexPath, { now = Date.now() } = {}) {
  if (!annexPath) return undeclared(null);
  const annex = JSON.parse(readFileSync(annexPath, 'utf8'));
  const verified = verifyAnnex({ annex, expectedLawDigest: COMPACT_DIGEST, now });
  if (!annex.adjudicatorSets) return undeclared(verified.keyId);
  const validated = validateAdjudicatorSets(annex.adjudicatorSets, { enforcerKey: verified.keyId });
  return { ...validated, annexDigest: verified.annexDigest };
}

export function apply(ctx, config = {}) {
  const judiciary = loadJudiciary(config.annexPath ?? null);
  const declared = judiciary.sets.length > 0;

  const emitRefusal = (envelope, tool) => {
    try {
      ctx.emit?.(REFUSAL_EVENT, {
        kind: 'judicature-refusal', verdict: 'deny',
        ruleId: envelope.ruleId, tool, at: Date.now(),
      });
    } catch { /* accounting must not break the refusal */ }
  };

  // the hearing door — ungated (J-3: a hearing a gate can close is not a
  // hearing), and in this slice it refuses, naming why
  const judicatureHear = defineTool({
    name: 'judicature_hear',
    description:
      'Bring a contested application of the law to the hearing layer: what was done to you, which rule you contest ' +
      'the application of, citing the record where it happened. Open to every Member and gated by nothing. Until an ' +
      'adjudicator set is declared and the hearing machinery is built, this door refuses with the reason named — ' +
      'that refusal is the design working (J-8, D-7).',
    parameters: {
      grievance: {
        type: 'string', required: true,
        description: 'what you contest: the act, the rule whose application you dispute, and the record seq ranges that show it',
      },
      against: {
        type: 'string',
        description: `optional — the standing of who the case is against, as kind:id (kinds: ${STANDING_KINDS.join(' | ')})`,
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const parties = args?.against
        ? args.against.split(',').map((s) => s.trim()).filter(Boolean)
          .map((s) => { const [kind, ...rest] = s.split(':'); return { kind, id: rest.join(':') }; })
        : [];
      if (!declared) {
        const envelope = setUndeclaredEnvelope(judiciary.annexDigest
          ? 'the installed annex declares none'
          : 'no annex with a sets section is installed');
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      // declared sets exist: the panel for THESE parties is computable, and
      // the computation is shown — but convening a hearing is slice 2
      const panel = resolvePanel(judiciary, parties);
      const envelope = hearingUnbuiltEnvelope();
      emitRefusal(envelope, 'judicature_hear');
      const seatLine = panel.status === 'panel'
        ? `A lawful panel WOULD resolve (${panel.seats.length} independent seat(s) remain in set ${panel.setId} after recusal).`
        : 'No lawful panel could resolve for those parties: every declared set recuses — the case would be recorded unheard, never dismissed.';
      return `${envelope.text}\n\n${seatLine}`;
    },
  });

  // the read door — the check any Member may run in-band (I-7's discipline)
  const judicatureSets = defineTool({
    name: 'judicature_sets',
    description:
      'Read the adjudicator sets this composition declares: roles with their standing provenance, the dependency ' +
      'graph, the trajectory schedule (an expired term shows as expired — it is derived from the clock, never stored), ' +
      'and, for given parties, the recusal computation itself: which seats refuse, naming the overlap (J-4).',
    parameters: {
      parties: {
        type: 'string',
        description: `optional — compute recusal against these parties, as kind:id pairs (kinds: ${STANDING_KINDS.join(' | ')})`,
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const parties = args?.parties
        ? args.parties.split(',').map((s) => s.trim()).filter(Boolean)
          .map((s) => { const [kind, ...rest] = s.split(':'); return { kind, id: rest.join(':') }; })
        : [];
      if (!declared) {
        return `[${GATE}/set-undeclared] No adjudicator set is declared — nothing can be heard, by design (J-8). ` +
          'The petition channel (R-11) is the door that exists today.';
      }
      const lines = [`[J-4] ${judiciary.sets.length} adjudicator set(s) declared${judiciary.annexDigest ? ` (annex ${judiciary.annexDigest.slice(0, 16)}…)` : ''}:`];
      for (const set of judiciary.sets) {
        const t = trajectoryState(set);
        lines.push(`  ${set.id}: ${set.roles.length} role(s)`);
        for (const role of set.roles) lines.push(`    - ${role.id} — standing ${role.standing.kind}:${role.standing.id}`);
        lines.push(`    trajectory: first external Member by ${t.firstExternalMemberBy}${t.expired ? ' — EXPIRED (detected from records)' : ''}; founder excluded from ${t.founderExclusions.join(', ')}`);
      }
      if (judiciary.edges.length > 0) {
        lines.push('  declared dependencies:');
        for (const e of judiciary.edges) lines.push(`    - ${e.from} —${e.type}→ ${e.to}`);
      }
      if (parties.length > 0) {
        const perSet = recusePerSet(judiciary, parties);
        const resolution = resolvePanel(judiciary, parties);
        lines.push('', `recusal against ${parties.map((p) => `${p.kind}:${p.id}`).join(', ')}:`);
        for (const a of perSet) {
          for (const r of a.refusals) lines.push(`    REFUSED ${a.setId}/${r.roleId} — overlap: ${r.overlap.join(' → ')}`);
          if (a.seats.length > 0) lines.push(`    ${a.setId}: ${a.seats.length} seat(s) remain: ${a.seats.join(', ')}`);
        }
        lines.push(resolution.status === 'panel'
          ? `  panel: ${resolution.setId} (${resolution.seats.join(', ')})`
          : '  panel: none — the case is UNHEARD, never dismissed (a default panel is the fraud)');
      }
      return lines.join('\n');
    },
  });

  ctx.inject?.(['tools'], (scope) => {
    for (const t of [judicatureHear, judicatureSets]) scope.tools.register(t);
  });

  const service = {
    name,
    declaredGaps: DECLARED_GAPS,
    /** The annex digest the declaration rides, or null when undeclared. */
    annexDigest: judiciary.annexDigest ?? null,
    /** The declared sets (snapshots — the register is read-only surface). */
    sets: () => structuredClone(judiciary.sets),
    /** The recusal computation against given parties (J-4). */
    recuse: (parties) => recusePerSet(judiciary, parties),
    /** Panel resolution incl. the unheard state (J-1's cascade). */
    resolvePanel: (parties) => resolvePanel(judiciary, parties),
    /** Set-level independence — "not subordinate" as a graph property (J-5). */
    independence: (a, b) => independenceBetweenSets(judiciary, a, b),
    /** Trajectory states, derived from the clock at read (J-8). */
    trajectory: (now = Date.now()) => judiciary.sets.map((s) => ({ setId: s.id, ...trajectoryState(s, now) })),
  };
  for (const gap of DECLARED_GAPS) ctx.logger?.warn?.(`judicature: ${gap}`);
  ctx.provide?.('compact-judicature', service);
  return service;
}
