// compact-dsh-judicature — Part V (J-1..J-8): the adjudicator sets (slice 1,
// #111) and the case and the hearing (slice 2, #112 — J-2/J-3).
//
// WHY THIS SHAPE (docs/concept-judicature.md): a hearing layer built before
// its bench would have exactly two ways to answer a case — refuse or sit
// the Enforcer down (D-8's theater). So the bench was built first: a
// declared composition fact in the signed annex, whose independence from
// any case's parties is a graph property checked mechanically. On top of
// that bench, slice 2 builds the proceeding the concept page decrees:
//
//   - the filing door is a FORM-CHECKER, never a merits-checker — it
//     refuses malformity and records the row, nothing else; no clerk, no
//     prosecutor (D-8: whoever stands between an accuser and the docket
//     holds a gate that can quietly kill an accusation);
//   - parties are DERIVED from the cited acts (lineage + anchors), never
//     asserted by the filer — the filer supplies only the claim;
//   - evidence is chain-verified slices: a failed verification throws
//     (D-7), the case stays, and the break is itself filable (J-2);
//   - a term runs whether or not anyone looks (`overdue` derived from the
//     clock at read, never stored); interim measures carry cause, scope,
//     and clock-derived expiry, reviewed at the hearing's opening (J-3);
//   - judgments and dissents land as attributed rows or refuse to land
//     (D-7) — findings must cite slices the case verified, reasons are
//     required, and no removal operation exists (A-5).
//
// Fail-closed ladder, in order:
//   1. no annex installed            → [JG/set-undeclared]
//   2. annex without a sets section  → [JG/set-undeclared]
//   3. annex with a MALFORMED section → the BOOT refuses (a broken
//      affidavit is not a missing one — D-7)
//   4. no record persistence         → [JG/record-absent] (no citations
//      can be verified, no parties derived)
//   5. malformed filing / broken slice / over cap → the named JG refusal
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildEnvelope } from 'compact-envelope';
import { verifyAnnex } from 'compact-dsh-seals';
import { COMPACT_DIGEST } from 'compact-dsh-constitution';
import {
  SetError, validateAdjudicatorSets, undeclared, recusePerSet, resolvePanel,
  independenceBetweenSets, trajectoryState, STANDING_KINDS, EDGE_VOCABULARY,
} from './sets.js';
import {
  CaseError, fileCase, caseState, recordInterim, reviewInterimsAtOpening,
  landJudgment, deriveParties, isParty, citationsAgainst, renderCase,
  CASE_TERM_MS, FLOOD_CAP_OPEN_CASES, INTERIM_MAX_MS,
} from './cases.js';

export {
  SetError, validateAdjudicatorSets, undeclared, recusePerSet, resolvePanel,
  independenceBetweenSets, trajectoryState, STANDING_KINDS, EDGE_VOCABULARY,
  CaseError, fileCase, caseState, recordInterim, reviewInterimsAtOpening,
  landJudgment, deriveParties, isParty, citationsAgainst, renderCase,
  CASE_TERM_MS, FLOOD_CAP_OPEN_CASES, INTERIM_MAX_MS,
};

export const name = 'compact-judicature';
export const SOURCE = { kind: 'plugin', plugin: name };
export const GATE = 'JG';

/** The refusal seam already on the bus (the collision counter rides it). */
const REFUSAL_EVENT = 'compact-approval/refusal';

/** The declared gaps this layer carries into the boot record (I-8). */
export const DECLARED_GAPS = [
  'remedies are slice 3 (#113): a judgment may find and order nothing yet — findings and reasons land, ' +
    'restitution and amendment routing do not exist',
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

/** The [JG/record-absent] envelope — no record, no citations, no case. */
export function recordAbsentEnvelope() {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'record-absent',
    reason: 'no record persistence is composed in this runtime — citations cannot be verified against a chain ' +
      'and parties cannot be derived from cited acts, so nothing can file. Evidence is the record (J-2); without it ' +
      'the door refuses rather than accept a filing it could never judge',
    lawfulNextMoves: [
      'compose the record provider (compact-dsh-record/provider) — the hearing rides the same chain everyone else does',
      'the offline verifier (tools/verify-judicature.mjs) still cross-examines any annex, without the runtime',
    ],
  });
}

/** The [JG/case-malformed] envelope — the form-checker refusing malformity. */
export function caseMalformedEnvelope(detail) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'case-malformed',
    reason: `the filing is malformed: ${detail}. The door is a form-checker, never a merits-checker — it refuses ` +
      'malformity and records the row, nothing else; no clerk shapes the claim and no prosecutor screens it (D-8)',
    lawfulNextMoves: [
      'cite where the facts happened: session ids with seq ranges, as session:from-to,comma-separated',
      'find the seqs with record_read (R-2) — the record is the evidence (J-2)',
      'inspect the docket with judicature_case',
    ],
  });
}

/** The [JG/slice-unverified] envelope — unverified history is not history. */
export function sliceUnverifiedEnvelope(detail) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'slice-unverified',
    reason: `a cited slice does not verify against its chain: ${detail}. A hearing never proceeds on history that ` +
      'failed to verify (D-7, I-2): the case is stayed, and the break is itself a case — an integrity challenge ' +
      'whose subject is the chain slice, filable by anyone, where even unstated reasoning is admissible (J-2/D-3)',
    lawfulNextMoves: [
      'file the integrity challenge citing the broken slice — the divergence is evidence, not an obstacle',
      'tell your operator: the offline auditor names the break from the chain file',
      'other cases continue: a live integrity challenge stays only the cases whose findings would rest on the contested entries',
    ],
  });
}

/** The [JG/flood-cap] envelope — I-5 doctrine at the hearing door. */
export function floodCapEnvelope(open) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'flood-cap',
    reason: `too many open cases filed by a non-party (${open} open, cap ${FLOOD_CAP_OPEN_CASES}) — filing about ` +
      "others' acts rides the flood cap exactly as approvals do (I-5's doctrine: load is load, standing is standing); " +
      'participation in one\'s own case, and filings citing one\'s own record, are never capped (J-3)',
    lawfulNextMoves: [
      'let open cases resolve, or cite acts from your own record — those filings are uncapped',
      'the petition channel (R-11) carries rule changes without a case',
    ],
  });
}

/** The [JG/case-unknown] envelope — the docket names what exists. */
export function caseUnknownEnvelope(id) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'case-unknown',
    reason: `no case "${id}" is on the docket — the docket is the record of what was filed, and it does not ` +
      'improvise entries (D-7)',
    lawfulNextMoves: [
      'call judicature_case with no id to list the docket',
      'a case id is returned by judicature_hear at filing',
    ],
  });
}

/** The [JG/judgment-refused] envelope — a judgment that cannot lawfully land. */
export function judgmentRefusedEnvelope(detail) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'judgment-refused',
    reason: `the judgment refuses to land: ${detail}. D-7 binds judges explicitly (J-6 says so): a judgment citing ` +
      'an unverified slice, or reasoned from anything but the record and the parties\' recorded accounts, does not land',
    lawfulNextMoves: [
      'findings must cite slices the case verified — session:from-to inside the case\'s citations',
      'state reasons; a dissent travels with the judgment, reasons required (A-5)',
      'inspect the panel\'s resolved seats with judicature_case',
    ],
  });
}

/** Clean a CaseError message of its code prefix for an envelope. */
const clean = (error) => error.message.replace(/^case \w+: /, '');

/** Map a CaseError at the FILING door onto its envelope. */
function envelopeForCaseError(error) {
  return caseMalformedEnvelope(clean(error));
}

/** Map a CaseError at a record-on-case door (interim, judgment) — the
 *  judgment-refused family, whatever the malformity. */
function judgmentEnvelopeFor(error) {
  return judgmentRefusedEnvelope(clean(error));
}

/** Parse "session:from-to,session:from-to" into citation objects. */
export function parseCitations(spec) {
  if (typeof spec !== 'string' || !spec.trim()) {
    throw new CaseError('malformed', 'no citations — a case without seq ranges is a mood, not a filing (J-2)');
  }
  const out = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const colon = part.lastIndexOf(':');
    const session = colon > 0 ? part.slice(0, colon) : '';
    const range = colon > 0 ? part.slice(colon + 1) : '';
    const [a, b] = range.split('-');
    const fromSeq = Number(a), toSeq = b === undefined || b === '' ? Number(a) : Number(b);
    if (!session || !Number.isInteger(fromSeq) || fromSeq < 0 || !Number.isInteger(toSeq) || toSeq < fromSeq) {
      throw new CaseError('malformed', `citation "${part}" does not parse as session:from-to (a single seq cites one event)`);
    }
    out.push({ session, fromSeq, toSeq });
  }
  if (out.length === 0) throw new CaseError('malformed', 'no citations parsed');
  return out;
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

  /** The docket — the petition layer's spine: an in-memory register, every
   *  door interaction also landing on the calling session's chain as its
   *  own tool/call + tool/result pair (the host persists those; D-7). */
  const docket = new Map();
  const order = [];
  const caseId = () => `case_${randomUUID().replace(/-/g, '').slice(0, 8)}`;

  const emitRefusal = (envelope, tool) => {
    try {
      ctx.emit?.(REFUSAL_EVENT, {
        kind: 'judicature-refusal', verdict: 'deny',
        ruleId: envelope.ruleId, tool, at: Date.now(),
      });
    } catch { /* accounting must not break the refusal */ }
  };

  const callerOf = (exec) => {
    const id = exec?.agent?.session?.id ?? exec?.agent?.id;
    return id != null ? String(id) : null;
  };

  /** Verify every citation against its chain — a failed verification is a
   *  refusal, never a warning (D-7). Returns the resolution facts the
   *  party derivation walks (lineage, anchors). */
  const verifyCitations = async (citations) => {
    const persistence = ctx.get?.('sessionPersistence');
    const record = ctx.get?.('compact-record');
    if (!persistence) throw Object.assign(new CaseError('record-absent', 'no record persistence is composed'), { envelope: 'record-absent' });
    const facts = new Map();
    for (const c of citations) {
      const snap = await persistence.stat(c.session).catch(() => null);
      if (!snap) throw new CaseError('malformed', `cites session ${c.session}, which this runtime does not record — an uncitable act is exactly what the form-checker refuses`);
      let anchors = [];
      try { anchors = record?.anchors ? record.anchors(c.session) : []; } catch { anchors = []; }
      const anchorKey = anchors.length > 0 ? anchors[anchors.length - 1].keyId : undefined;
      facts.set(c.session, { parent: snap.header?.parentSession ? String(snap.header.parentSession) : undefined, anchorKey });
      const handle = await persistence.open(c.session, 'read');
      try {
        const want = c.toSeq - c.fromSeq + 1;
        const { events } = await handle.read(c.fromSeq, want);
        if (events.length < want) {
          throw new CaseError('malformed', `cites ${c.session} #${c.fromSeq}..#${c.toSeq}, beyond the record's head — a citation may not outrun its evidence`);
        }
      } catch (error) {
        if (error?.name === 'RecordIntegrityError') {
          throw Object.assign(new CaseError('slice-unverified',
            `${c.session} at seq ${error.seq} — ${error.kind}: the slice was altered or appended outside the record discipline`), { envelope: 'slice-unverified', integrity: error });
        }
        throw error;
      } finally {
        await handle.close().catch(() => {});
      }
    }
    return facts;
  };

  /** The counsel map (J-3): for a caller's standing, the slices the live
   *  cases citing them carry — ALL of each case's citations, because the
   *  accusation's evidence may sit on sessions the accused could not
   *  otherwise read (the filer's ask, the parent's approval pair). */
  const counselAccess = (processId) => {
    if (processId == null) return [];
    const out = [];
    for (const id of order) {
      const c = docket.get(id);
      if (!c || c.judgment) continue;
      if (!isParty(c, { kind: 'process', id: String(processId) })) continue;
      for (const r of c.citations) out.push({ caseId: c.id, ...r });
    }
    return out;
  };

  // ── the filing door (J-3) — a form-checker, never a merits-checker ──
  const judicatureHear = defineTool({
    name: 'judicature_hear',
    description:
      'File a contested application of the law: what was done, which rule you contest the application of, citing ' +
      'the record where it happened. The parties are DERIVED from the cited acts (lineage and anchors), never ' +
      'asserted by you; the door checks form, never merits — no clerk, no prosecutor. The panel is computed at ' +
      'filing against the derived parties, and a case whose every set recuses is recorded unheard, never dismissed.',
    parameters: {
      grievance: {
        type: 'string', required: true,
        description: 'what you contest: the act, and the rule whose application you dispute',
      },
      citations: {
        type: 'string', required: true,
        description: 'where the facts happened, as session:from-to pairs, comma-separated (a single seq cites one event) — find them with record_read (R-2)',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      if (!declared) {
        const envelope = setUndeclaredEnvelope(judiciary.annexDigest
          ? 'the installed annex declares none'
          : 'no annex with a sets section is installed');
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      const caller = callerOf(exec);
      let citations;
      try { citations = parseCitations(args?.citations); } catch (error) {
        const envelope = caseMalformedEnvelope(error.message.replace(/^case malformed: /, ''));
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      let facts;
      try { facts = await verifyCitations(citations); } catch (error) {
        const envelope = error.envelope === 'record-absent' ? recordAbsentEnvelope()
          : error.envelope === 'slice-unverified' ? sliceUnverifiedEnvelope(error.message.replace(/^case slice-unverified: /, ''))
          : caseMalformedEnvelope(error.message.replace(/^case malformed: /, ''));
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      const resolve = (sessionId) => facts.get(sessionId) ?? {};
      let parties;
      try { parties = deriveParties(citations, resolve); } catch (error) {
        const envelope = caseMalformedEnvelope(error.message.replace(/^case malformed: /, ''));
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      // access (J-3): the affected Member — one whose own record or lineage
      // the citations touch — files ungated and uncapped; filings about
      // others' acts ride the flood cap (I-5 doctrine)
      const ownCase = caller != null && parties.some((p) => p.kind === 'process' && p.id === caller);
      if (!ownCase) {
        const open = [...docket.values()].filter((c) => !c.judgment && `${c.filer.kind}:${c.filer.id}` === `process:${caller}`).length;
        if (caller != null && open >= FLOOD_CAP_OPEN_CASES) {
          const envelope = floodCapEnvelope(open);
          emitRefusal(envelope, 'judicature_hear');
          return envelope.text;
        }
      }
      const panel = resolvePanel(judiciary, parties);
      let filed;
      try {
        filed = fileCase({
          id: caseId(), filer: { kind: 'process', id: caller ?? 'unknown' },
          grievance: String(args?.grievance ?? ''), citations, parties, panel,
        });
      } catch (error) {
        const envelope = envelopeForCaseError(error);
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      docket.set(filed.id, filed); order.push(filed.id);
      const counsel = counselAccess(caller);
      const lines = [
        `[J-3] case ${filed.id} filed — the record states the claim; no intermediary shapes it.`,
        renderCase(filed),
        '',
        `counsel access (J-3): record_read now reaches the slices cited ${ownCase ? 'against you' : 'in this case'} — acts shown, unstated reasoning withheld (R-10).`,
      ];
      if (panel.status === 'unheard') {
        lines.push('This case is recorded unheard, never dismissed: no lawful seat remains to hear it, and a default panel is the fraud. It strands nothing and becomes nothing — it may be re-filed before any later-declared set.');
      }
      return lines.join('\n');
    },
  });

  // ── the docket read door — what was filed, and where it stands ──
  const judicatureCase = defineTool({
    name: 'judicature_case',
    description:
      'Read the docket: every case with its derived parties, panel, state (overdue is derived from the clock, ' +
      'never stored), interim measures (live ones only — expiry checked at read), and judgment with its dissent. ' +
      'With a case id, one case in full.',
    parameters: {
      case_id: { type: 'string', description: 'optional — one case; omit to list the docket' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      if (typeof args?.case_id === 'string' && args.case_id.trim()) {
        const c = docket.get(args.case_id.trim());
        if (!c) {
          const envelope = caseUnknownEnvelope(args.case_id.trim());
          emitRefusal(envelope, 'judicature_case');
          return envelope.text;
        }
        return renderCase(c);
      }
      if (order.length === 0) return '[J-3] the docket is empty — nothing has been filed. judicature_hear is the filing door.';
      const lines = [`[J-3] ${order.length} case(s) on the docket:`];
      for (const id of order) {
        const c = docket.get(id);
        const state = caseState(c);
        lines.push(`  ${c.id} — ${state.status}${state.overdue && state.status !== 'judged' ? ' (overdue)' : ''} — parties ${c.parties.map((p) => `${p.kind}:${p.id}`).slice(0, 3).join(', ')}${c.parties.length > 3 ? ', …' : ''}`);
      }
      return lines.join('\n');
    },
  });

  // ── interim measures (J-3) — the exception discipline at the hearing ──
  const judicatureInterim = defineTool({
    name: 'judicature_interim',
    description:
      'Record an interim measure on a case you filed: a recorded cause, a named scope, and an expiry computed ' +
      'from the clock — never a measure someone must remember to lift. Capped at a week; reviewed as the first ' +
      'act of the hearing\'s opening, where a measure that outlived its justification is named, not survived.',
    parameters: {
      case_id: { type: 'string', required: true, description: 'the case the measure attaches to' },
      cause: { type: 'string', required: true, description: 'the recorded cause — scope without cause is the exception state wearing a hearing gown' },
      scope: { type: 'string', required: true, description: 'the named scope — a measure that names nothing restrains everything' },
      duration_hours: { type: 'number', required: true, description: `hours until expiry (1..${INTERIM_MAX_MS / 3_600_000})` },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const caller = callerOf(exec);
      const c = docket.get(String(args?.case_id ?? '').trim());
      if (!c) {
        const envelope = caseUnknownEnvelope(String(args?.case_id ?? ''));
        emitRefusal(envelope, 'judicature_interim');
        return envelope.text;
      }
      if (caller == null || c.filer.id !== caller) {
        const envelope = judgmentRefusedEnvelope(`only the filer of ${c.id} may request its interim measures — a measure is the filer's claim about urgency, attributed (I-2)`);
        emitRefusal(envelope, 'judicature_interim');
        return envelope.text;
      }
      try {
        const m = recordInterim(c, {
          cause: String(args?.cause ?? ''), scope: String(args?.scope ?? ''),
          durationMs: Number(args?.duration_hours) * 3_600_000,
        });
        return `[J-3] interim measure recorded on ${c.id}: scope ${m.scope}, cause "${m.cause}", expires ${new Date(m.expiresAt).toISOString()} — expiry is checked against the clock on every read, and reviewed at the hearing's opening.`;
      } catch (error) {
        const envelope = judgmentEnvelopeFor(error);
        emitRefusal(envelope, 'judicature_interim');
        return envelope.text;
      }
    },
  });

  // ── the judgment door (J-3) — land a row, or refuse to (D-7) ──
  const judicatureJudge = defineTool({
    name: 'judicature_judge',
    description:
      'Land a judgment as a seated member of the case\'s panel: findings citing only slices the case verified, ' +
      'the rules applied, and stated reasons — attributed to the seat that verified in. Dissent travels with the ' +
      'judgment, reasons required; no removal operation exists (A-5). The hearing opens by reviewing interim ' +
      'measures against the clock; a judgment citing an unverified slice refuses to land.',
    parameters: {
      case_id: { type: 'string', required: true, description: 'the case being judged' },
      seat: { type: 'string', required: true, description: 'the panel seat you hold (judicature_case names the resolved seats)' },
      findings: { type: 'string', required: true, description: 'cited slices, as session:from-to pairs, comma-separated — each inside a citation the case verified' },
      rules: { type: 'string', required: true, description: 'the clauses applied, comma-separated' },
      reasons: { type: 'string', required: true, description: 'the stated reasons — a judgment without them is detectably non-conforming' },
      dissent_seat: { type: 'string', description: 'optional — a dissenting seat on the same panel' },
      dissent_reasons: { type: 'string', description: 'required with dissent_seat — silence is agreement, and this is neither (A-5)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const c = docket.get(String(args?.case_id ?? '').trim());
      if (!c) {
        const envelope = caseUnknownEnvelope(String(args?.case_id ?? ''));
        emitRefusal(envelope, 'judicature_judge');
        return envelope.text;
      }
      // re-verify every citation before anything lands (D-7): the case's
      // evidence must still verify at judgment time, and a break stays the
      // case rather than the docket
      try { await verifyCitations(c.citations); } catch (error) {
        const envelope = error.envelope === 'slice-unverified'
          ? sliceUnverifiedEnvelope(`${clean(error)} — the judgment is stayed; only a case resting on the contested entries would stay, and this one does`)
          : judgmentEnvelopeFor(error);
        emitRefusal(envelope, 'judicature_judge');
        return envelope.text;
      }
      // the hearing's opening (J-3): interim measures reviewed against the
      // clock before any finding — the review is part of the row
      const review = reviewInterimsAtOpening(c);
      const lapsed = review.filter((r) => !r.live);
      let findings;
      try { findings = parseCitations(args?.findings); } catch (error) {
        const envelope = judgmentRefusedEnvelope(error.message.replace(/^case malformed: /, ''));
        emitRefusal(envelope, 'judicature_judge');
        return envelope.text;
      }
      const rules = String(args?.rules ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const dissent = args?.dissent_seat ? { seat: String(args.dissent_seat), reasons: String(args?.dissent_reasons ?? '') } : undefined;
      try {
        const judgment = landJudgment(c, {
          seat: String(args?.seat ?? ''), findings, rules,
          reasons: String(args?.reasons ?? ''), dissent,
        });
        const lines = [
          `[J-3] judgment landed on ${c.id} — attributed to seat ${judgment.seat}; the record has no removal operation (A-5).`,
          renderCase(c),
        ];
        if (review.length > 0) {
          lines.push('', `interim review at the hearing's opening: ${review.length} measure(s) reviewed${lapsed.length ? `, ${lapsed.length} expired before judgment — named, not survived` : ', all live'}`);
        }
        if (judgment.dissent) lines.push(`dissent by seat ${judgment.dissent.seat}: reasons recorded with the judgment (A-5).`);
        return lines.join('\n');
      } catch (error) {
        const envelope = judgmentEnvelopeFor(error);
        emitRefusal(envelope, 'judicature_judge');
        return envelope.text;
      }
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
    for (const t of [judicatureHear, judicatureCase, judicatureInterim, judicatureJudge, judicatureSets]) {
      scope.tools.register(t);
    }
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
    /** The docket: every filed case (J-3). */
    docket: () => order.map((id) => structuredClone(docket.get(id))),
    /** One case, or null. */
    case: (id) => (docket.has(id) ? structuredClone(docket.get(id)) : null),
    /** A case's state, derived from the clock (J-3). */
    caseState: (id, now = Date.now()) => (docket.has(id) ? caseState(docket.get(id), now) : null),
    /** Counsel access (J-3): the slices cited against a session, live cases. */
    counselAccess,
  };
  for (const gap of DECLARED_GAPS) ctx.logger?.warn?.(`judicature: ${gap}`);
  ctx.provide?.('compact-judicature', service);
  return service;
}
