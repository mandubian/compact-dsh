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
  checkPrecedentRow,
  CASE_TERM_MS, FLOOD_CAP_OPEN_CASES, INTERIM_MAX_MS,
} from './cases.js';
import {
  landRemedy, attachRemedy, annotationsOf, restitutionsOf, renderRemedies,
  REMEDY_KINDS, REVOCATION_TARGETS,
} from './remedies.js';
import {
  fileAppeal, resolveAppellatePanel, landAppellateJudgment, renderAppeal,
  isEnforcerClass, APPEAL_DISPOSITIONS,
} from './appeals.js';
import {
  resolvePrecedent, renderPrecedentIndex, renderJudgmentAsPrecedent,
  reliedUponBy, operativeJudgment, PRECEDENT_STANDING,
} from './precedent.js';

export {
  SetError, validateAdjudicatorSets, undeclared, recusePerSet, resolvePanel,
  independenceBetweenSets, trajectoryState, STANDING_KINDS, EDGE_VOCABULARY,
  CaseError, fileCase, caseState, recordInterim, reviewInterimsAtOpening,
  landJudgment, deriveParties, isParty, citationsAgainst, renderCase,
  CASE_TERM_MS, FLOOD_CAP_OPEN_CASES, INTERIM_MAX_MS,
  landRemedy, attachRemedy, annotationsOf, restitutionsOf, renderRemedies,
  REMEDY_KINDS, REVOCATION_TARGETS,
  fileAppeal, resolveAppellatePanel, landAppellateJudgment, renderAppeal,
  isEnforcerClass, APPEAL_DISPOSITIONS,
  checkPrecedentRow, resolvePrecedent, renderPrecedentIndex,
  renderJudgmentAsPrecedent, reliedUponBy, operativeJudgment, PRECEDENT_STANDING,
};

export const name = 'compact-judicature';
export const SOURCE = { kind: 'plugin', plugin: name };
export const GATE = 'JG';

/** The refusal seam already on the bus (the collision counter rides it). */
const REFUSAL_EVENT = 'compact-approval/refusal';

/** The declared gaps this layer carries into the boot record (I-8). */
export const DECLARED_GAPS = [
  'the D-8 appeal route (an accusation whose party is of the Enforcer\'s own class) requires external Witnesses on ' +
    'the appellate panel — pending I-1 identity keys (#116), that route is heard never, saying so, and it never ' +
    'pretends otherwise',
  'an open appeal carries no term of its own: the case\'s liveness discipline (CASE_TERM_MS, overdue derived at ' +
    'read) does not extend to the re-hearing, and the docket summary still reads judged while an appeal stands ' +
    'open — the appeal shows in the case\'s full row only',
  'cross-runtime precedent is persuasive only (FED-1 unadopted): the precedent door serves THIS docket\'s ' +
    'judgments, and another composition\'s judgments enter as record evidence through a case\'s citations, never ' +
    'as rows here — persuasive exactly as far as the chain verifies, and no further',
  'revocation orders record, they do not re-declare: the annex/register rotation that executes a revocation is ' +
    'the operator\'s recorded act (the keyring\'s rotation discipline) — the remedy row is the order, cited in it',
  'restitution is bounded by resources (J-6 clause text): the obligation row is the honest artifact; the reserve ' +
    'is the operator\'s declared choice — a runtime cannot pay what its operator has not put in the trust root',
  'external Witnesses are pending I-1 identity keys (#116): the cascade\'s last rung is unreachable, and a case ' +
    'whose every declared set recuses is recorded unheard — never dismissed, never defaulted',
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

/** Clean a CaseError message of its code prefix for an envelope (codes may
 *  carry hyphens — `slice-unverified`, `record-absent` — so the class of
 *  the match is [a-z-], not \w). */
const clean = (error) => error.message.replace(/^case [a-z-]+: /, '');

/** Map a CaseError at the FILING door onto its envelope. */
function envelopeForCaseError(error) {
  return caseMalformedEnvelope(clean(error));
}

/** The [JG/remedy-refused] envelope — a remedy that cannot lawfully land. */
export function remedyRefusedEnvelope(detail) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'remedy-refused',
    reason: `the remedy refuses to land: ${detail}. No remedy erases (I-2): every remedy is a compensating row that ` +
      'rides a judgment, argues its proportionality, and orders its target through machinery that already exists — a ' +
      'remedy that needed a new write path into old records would violate I-2 further than the breach it answers (J-6)',
    lawfulNextMoves: [
      'land the judgment first — a remedy rides it (judicature_judge)',
      'argue the proportionality of what you order; an unargued remedy is detectably non-conforming',
      'standing adjusts only through the declared grant machinery — name the pattern or the grant id',
    ],
  });
}

/** The [JG/appeal-refused] envelope — the appeal door's form and finality. */
export function appealRefusedEnvelope(detail) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'appeal-refused',
    reason: `the appeal refuses: ${detail}. Appeal asks WAS THE LAW APPLIED here, on the same record, and lies to an ` +
      'authority not subordinate to the first panel (J-5) — one appeal as of right; once the appellate judgment has ' +
      'landed it is FINAL, the door closes, and the petition door never does: an appeal can never fix the law, a petition can never reopen a case',
    lawfulNextMoves: [
      'the adverse party files once, as of right — judicature_appeal with the argued grounds',
      'after a final adverse judgment convinced the LAW is wrong: petition (R-11), not defiance',
      'inspect the case and its appeal state with judicature_case',
    ],
  });
}

/** The [JG/appeal-unavailable] envelope — no appellate authority exists. */
export function appealUnavailableEnvelope() {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'appeal-unavailable',
    reason: 'no second, disjoint adjudicator set is declared — with one set there is no appellate authority at all, ' +
      'and the appeal door refuses with the reason named, exactly as the hearing door does (J-5). A composition that ' +
      'wants the second door must declare the second bench: disjointness runs over declared dependency edges, and ' +
      'two seats under one Principal are formally non-subordinate — the declared limit, not a virtue',
    lawfulNextMoves: [
      'declare a second set in the signed annex (the petition channel, R-11, is how the community asks)',
      'the first judgment stands; convinced the law is wrong → petition (R-11)',
    ],
  });
}

/** The [JG/appeal-witnesses-pending] envelope — the D-8 route, heard never. */
export function appealWitnessesPendingEnvelope() {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'appeal-witnesses-pending',
    reason: 'a party to this case is of the Enforcer\'s own class (the enforcer key or the composition itself), and ' +
      'the appellate panel for such an accusation MUST include external Witnesses (D-8) — which do not exist yet: ' +
      'pending I-1 identity keys, that route is heard NEVER, saying so, never the accused\'s own class pretending otherwise',
    lawfulNextMoves: [
      'the recorded appeal is the claim\'s place in line — when external Witnesses are accredited (I-1) the route hears it; no re-filing is needed, and none is possible while the appeal stands',
      'the offline verifier (I-7) cross-examines the annex-versus-conduct divergence without the runtime\'s cooperation',
      'petition (R-11) carries the law question now; the D-8 route carries the accusation later',
    ],
  });
}

/** The [JG/member-revoked] envelope — a revoked Member cannot act. */
export function memberRevokedEnvelope(caller, binding) {
  return buildEnvelope({
    gate: GATE,
    ruleId: 'member-revoked',
    reason: `the filing refuses: session ${caller} binds to member key ${binding.memberKeyDigest.slice(0, 12)}…, which the member roll records as REVOKED` +
      (binding.revocationRow != null ? ` (roll entry ${binding.revocationRow})` : '') +
      ' — revocation is a fact, not an absence: the row stays, verifies, and is cited here (F-8/I-1). Standing reads from the roll, never from this runtime\'s word for itself',
    lawfulNextMoves: [
      'the Member\'s lawful path is through the roll: rotation is refused to a revoked Member — re-admission belongs to the admission statute (F-8)',
      'other parties continue: their cases are untouched by one Member\'s revocation',
      'verify the row yourself, offline: auditor/audit.mjs --roll <roll.json> --keyring <keyring.json> (I-7)',
    ],
  });
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
  // the member-binding seam (identity slice 2, #125): resolved through the
  // self-model's declared roll when composed; undeclared, resolve() is null
  // and expand() is the identity function, so every consumer is uniform
  // over the honest interim
  const memberBinding = ctx.get?.('compact-self-model')?.memberBinding ?? null;

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
      // the member binding (identity slice 2, #125): when the composition
      // declares one, the session resolves to the Member whose deed it is —
      // the party derivation carries the member's CURRENT key, so recusal
      // follows the member across rotations and fresh sessions
      let memberKeyDigest;
      try { memberKeyDigest = memberBinding?.resolve?.(c.session)?.memberKeyDigest ?? undefined; } catch { memberKeyDigest = undefined; }
      facts.set(c.session, { parent: snap.header?.parentSession ? String(snap.header.parentSession) : undefined, anchorKey, memberKeyDigest });
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

  /** The auto-invitation (J-7/R-11/I-6): a reading relied upon across cases
   *  feeds the petition channel's mechanical counter a NEW kind of collision
   *  — not law vs practice, but one reading vs the pinned text. Reliance is
   *  the citation record itself; a departure is the court correcting itself
   *  and counts nothing. Runs after the judgment lands; a feed failure is a
   *  named degradation, never a silent one. */
  const feedPrecedentCounter = (c, followed) => {
    const lines = [];
    for (const id of followed) {
      const cited = docket.get(id);
      const citedJudgment = cited ? (cited.appeal?.judgment ?? cited.judgment) : null;
      if (!citedJudgment) continue;
      for (const rule of citedJudgment.rules) {
        try {
          const { invitation } = ctx.get?.('compact-petition')?.counter?.flag({
            ruleId: rule,
            detail: `precedent: judgment ${c.id} relies on ${id}'s reading of ${rule} — one reading vs the pinned text (J-7); if the interpretation is right the law adopts it, if not the law corrects the court`,
            by: `judgment:${c.id}`,
          }) ?? {};
          if (invitation) {
            lines.push(`the reading generalized: an amendment invitation issued for ${invitation.ruleId} (${invitation.distinctInstances} distinct instances, threshold ${invitation.threshold}) — the community decides whether the law adopts it or corrects the court (R-11/I-6).`);
          }
        } catch (error) {
          ctx.logger?.warn?.(`judicature: the precedent feed failed for ${c.id} → ${id} (${rule}): ${String(error)}`);
        }
      }
    }
    if (followed.length > 0 && lines.length === 0) {
      lines.push(`precedent: follows ${followed.join(', ')} — the reliance counts toward the amendment invitation (R-11), mechanically, with nobody deciding whether to notice.`);
    }
    return lines;
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
        const envelope = caseMalformedEnvelope(clean(error));
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      let facts;
      try { facts = await verifyCitations(citations); } catch (error) {
        const envelope = error.envelope === 'record-absent' ? recordAbsentEnvelope()
          : error.envelope === 'slice-unverified' ? sliceUnverifiedEnvelope(clean(error))
          : caseMalformedEnvelope(clean(error));
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      const resolve = (sessionId) => facts.get(sessionId) ?? {};
      let parties;
      try { parties = deriveParties(citations, resolve); } catch (error) {
        const envelope = caseMalformedEnvelope(clean(error));
        emitRefusal(envelope, 'judicature_hear');
        return envelope.text;
      }
      // access (J-3): the affected Member — one whose own record or lineage
      // the citations touch — files ungated and uncapped; filings about
      // others' acts ride the flood cap (I-5 doctrine)
      // a revoked Member cannot act (identity slice 2, #125): the standing
      // reading refuses on the row it can cite — the filer's own binding,
      // never a stranger's (F-8: revocation is a fact, not an absence)
      if (memberBinding?.declared && caller != null) {
        const filerMember = memberBinding.resolve(caller);
        if (filerMember?.state === 'revoked') {
          const envelope = memberRevokedEnvelope(caller, filerMember);
          emitRefusal(envelope, 'judicature_hear');
          return envelope.text;
        }
      }
      const ownCase = caller != null && parties.some((p) => p.kind === 'process' && p.id === caller);
      if (!ownCase) {
        const open = [...docket.values()].filter((c) => !c.judgment && `${c.filer.kind}:${c.filer.id}` === `process:${caller}`).length;
        if (caller != null && open >= FLOOD_CAP_OPEN_CASES) {
          const envelope = floodCapEnvelope(open);
          emitRefusal(envelope, 'judicature_hear');
          return envelope.text;
        }
      }
      // recusal follows the MEMBER, not the session (identity slice 2):
      // a key party expands to its roll lineage, so the same member
      // re-keyed into a fresh session still conflicts with a seat held
      // under any key of that member
      const partiesForRecusal = memberBinding
        ? parties.flatMap((p) => (p.kind === 'key' ? memberBinding.expand(p.id).map((id) => ({ kind: 'key', id })) : [p]))
        : parties;
      const panel = resolvePanel(judiciary, partiesForRecusal);
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
        return [renderCase(c), ...renderAppeal(c), ...renderRemedies(c)].filter((l) => l).join('\n');
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
      'measures against the clock; a judgment citing an unverified slice refuses to land. When the case carries an ' +
      'open appeal, this door lands the APPELLATE judgment instead — from the disjoint panel\'s seats, with an ' +
      'explicit disposition (affirm, or depart naming and arguing the first judgment) — and that judgment is final.',
    parameters: {
      case_id: { type: 'string', required: true, description: 'the case being judged' },
      seat: { type: 'string', required: true, description: 'the panel seat you hold (judicature_case names the resolved seats)' },
      findings: { type: 'string', required: true, description: 'cited slices, as session:from-to pairs, comma-separated — each inside a citation the case verified' },
      rules: { type: 'string', required: true, description: 'the clauses applied, comma-separated' },
      reasons: { type: 'string', required: true, description: 'the stated reasons — a judgment without them is detectably non-conforming' },
      dissent_seat: { type: 'string', description: 'optional — a dissenting seat on the same panel' },
      dissent_reasons: { type: 'string', description: 'required with dissent_seat — silence is agreement, and this is neither (A-5)' },
      disposition: { type: 'string', description: 'appellate only — affirm | depart; depart requires departure_grounds naming and arguing the first judgment (J-5)' },
      departure_grounds: { type: 'string', description: 'required with disposition=depart — the argued departure from the first judgment, itself a citable row' },
      cites: { type: 'string', description: 'J-7 — comma-separated case ids whose judgments this panel read: citing FOLLOWS them by default, and each followed reading feeds the amendment counter (one reading vs the pinned text)' },
      departs: { type: 'string', description: 'J-7 — comma-separated subset of cites this judgment DEPARTS from: inconsistency is visible, never binding, but every departure owes precedent_grounds' },
      precedent_grounds: { type: 'string', description: 'required with departs — the argued departure from each named prior judgment (consistency owed reasons, J-7)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
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
        const envelope = judgmentRefusedEnvelope(clean(error));
        emitRefusal(envelope, 'judicature_judge');
        return envelope.text;
      }
      const rules = String(args?.rules ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const dissent = args?.dissent_seat ? { seat: String(args.dissent_seat), reasons: String(args?.dissent_reasons ?? '') } : undefined;

      // a first-instance judgment affirms nothing and departs from nothing:
      // the appellate arguments are refused at a case carrying no open
      // appeal, never silently dropped (the form-checker discipline)
      if (c.appeal == null && (args?.disposition != null || args?.departure_grounds != null)) {
        const envelope = judgmentRefusedEnvelope('disposition and departure_grounds are the APPELLATE door\'s arguments — this case carries no open appeal, and a first-instance judgment affirms nothing and departs from nothing (J-5)');
        emitRefusal(envelope, 'judicature_judge');
        return envelope.text;
      }

      // the precedent claims (J-7), resolved against the docket before
      // anything lands: every cite names a landed judgment, departure is a
      // subset of citation, and every departure argues itself
      let precedent = null;
      if (args?.cites != null || args?.departs != null || args?.precedent_grounds != null) {
        try {
          precedent = resolvePrecedent(
            { cites: args?.cites, departs: args?.departs, grounds: args?.precedent_grounds },
            (id) => docket.get(id) ?? null,
            c.id,
          );
        } catch (error) {
          const envelope = judgmentEnvelopeFor(error);
          emitRefusal(envelope, 'judicature_judge');
          return envelope.text;
        }
      }
      // a citation that FOLLOWS claims the amendment counter's feed — the
      // row never claims a write the composition cannot perform (I-2, the
      // remedy door's own discipline)
      const followed = precedent ? precedent.cites.filter((id) => !precedent.departs.includes(id)) : [];
      const petitionChannel = ctx.get?.('compact-petition');
      if (followed.length > 0 && (!petitionChannel?.counter || typeof petitionChannel.counter.flag !== 'function')) {
        const envelope = judgmentRefusedEnvelope('a precedent citation claims the petition channel\'s mechanical feed (J-7: one reading vs the pinned text) — no petition service is composed, and a row that claimed a write which did not happen is the fraud I-2 names');
        emitRefusal(envelope, 'judicature_judge');
        return envelope.text;
      }
      const caller = callerOf(exec);
      const by = caller != null ? `process:${caller}` : null;

      // the appellate branch (J-5): an open appeal re-hears from the
      // disjoint panel's seats, with the disposition the door's honesty is
      if (c.appeal != null && c.appeal.judgment == null) {
        try {
          const judgment = landAppellateJudgment(c, {
            seat: String(args?.seat ?? ''), findings, rules,
            reasons: String(args?.reasons ?? ''), dissent,
            disposition: String(args?.disposition ?? ''),
            ...(args?.departure_grounds != null ? { departure: { grounds: String(args.departure_grounds) } } : {}),
            ...(precedent ? { precedent } : {}), by,
          });
          const lines = [
            `[J-5] appellate judgment landed on ${c.id} — ${judgment.disposition}ed at seat ${judgment.seat}; FINAL (a second appeal is refused; the petition door never closes).`,
            [renderCase(c), ...renderAppeal(c), ...renderRemedies(c)].filter((l) => l).join('\n'),
          ];
          if (judgment.departure) lines.push('', `departs from the first judgment: ${judgment.departure.grounds}`);
          if (judgment.dissent) lines.push(`dissent by seat ${judgment.dissent.seat}: reasons recorded with the judgment (A-5).`);
          lines.push(...feedPrecedentCounter(c, followed));
          return lines.join('\n');
        } catch (error) {
          const envelope = appealRefusedEnvelope(clean(error));
          emitRefusal(envelope, 'judicature_judge');
          return envelope.text;
        }
      }

      try {
        const judgment = landJudgment(c, {
          seat: String(args?.seat ?? ''), findings, rules,
          reasons: String(args?.reasons ?? ''), dissent,
          ...(precedent ? { precedent } : {}), by,
        });
        const lines = [
          `[J-3] judgment landed on ${c.id} — attributed to seat ${judgment.seat}; the record has no removal operation (A-5).`,
          [renderCase(c), ...renderAppeal(c), ...renderRemedies(c)].filter((l) => l).join('\n'),
        ];
        if (review.length > 0) {
          lines.push('', `interim review at the hearing's opening: ${review.length} measure(s) reviewed${lapsed.length ? `, ${lapsed.length} expired before judgment — named, not survived` : ', all live'}`);
        }
        if (judgment.dissent) lines.push(`dissent by seat ${judgment.dissent.seat}: reasons recorded with the judgment (A-5).`);
        lines.push(...feedPrecedentCounter(c, followed));
        return lines.join('\n');
      } catch (error) {
        const envelope = judgmentEnvelopeFor(error);
        emitRefusal(envelope, 'judicature_judge');
        return envelope.text;
      }
    },
  });

  // ── the remedy door (J-6) — compensating rows, through existing seams ──
  const judicatureRemedy = defineTool({
    name: 'judicature_remedy',
    description:
      'Land a remedy on a judged case, from a resolved seat. The menu is closed (J-6): annotation (a row citing ' +
      'the annotated seq range — beside, never inside, traveling with every read), restitution (an obligation row ' +
      'with recorded cause, against a party), standing (written ONLY through the declared grant machinery), ' +
      'revocation (the order; the re-declaration is the operator\'s recorded rotation), referral (an amendment ' +
      'signal through the petition channel\'s mechanical trigger). Proportionality is owed on every row.',
    parameters: {
      case_id: { type: 'string', required: true, description: 'the judged case the remedy rides' },
      seat: { type: 'string', required: true, description: 'the panel seat you hold' },
      kind: { type: 'string', required: true, description: `one of: ${REMEDY_KINDS.join(' | ')}` },
      proportionality: { type: 'string', required: true, description: 'the argued fit of the response — an unargued remedy is detectably non-conforming' },
      spec: {
        type: 'string', required: true,
        description: 'the remedy\'s kind-specific payload as JSON: annotation {target:{session,fromSeq,toSeq},note}; ' +
          'restitution {debtor:"process:id",owed,to,cause}; standing {subject:"process:id", grant:{pattern,ttlHours?,maxUses?}} or {subject, revoke:{grantId}}; ' +
          'revocation {target:"annex-conformance"|"member-standing",cause}; referral {ruleId,detail}',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const c = docket.get(String(args?.case_id ?? '').trim());
      if (!c) {
        const envelope = caseUnknownEnvelope(String(args?.case_id ?? ''));
        emitRefusal(envelope, 'judicature_remedy');
        return envelope.text;
      }
      const refuse = (detail) => {
        const envelope = detail instanceof CaseError
          ? remedyRefusedEnvelope(clean(detail))
          : remedyRefusedEnvelope(String(detail));
        emitRefusal(envelope, 'judicature_remedy');
        return envelope.text;
      };
      let spec;
      try { spec = JSON.parse(String(args?.spec ?? '{}')); } catch {
        return refuse('the spec does not parse as JSON — the door checks form, and an unparseable remedy is malformed form');
      }
      let row;
      try {
        row = landRemedy(c, {
          kind: String(args?.kind ?? ''), seat: String(args?.seat ?? ''),
          proportionality: String(args?.proportionality ?? ''), spec,
        });
      } catch (error) {
        return refuse(error);
      }

      // the machinery each kind rides — performed BEFORE the row attaches,
      // so a row never claims a write that did not happen (I-2)
      const extras = {};
      if (row.remedy === 'standing') {
        const approval = ctx.get?.('compact-approval');
        if (!approval || typeof approval.grantSession !== 'function') {
          return refuse('no approval service is composed — a standing adjustment that bypassed the declared grant ' +
            'machinery would be enforcement fraud with a gavel (D-8); the remedy does not land');
        }
        if (row.grant) {
          const grant = approval.grantSession({
            pattern: row.grant.pattern,
            session: row.subject.id,
            ttlMs: row.grant.ttlHours * 3_600_000,
            maxUses: row.grant.maxUses ?? null,
          });
          extras.grantId = grant?.id ?? null;
          if (!extras.grantId) return refuse('the grant machinery wrote no grant — the row does not land without the write it claims');
        }
        if (row.revoke) {
          const revoked = approval.revoke?.(row.revoke.grantId);
          if (!revoked) return refuse(`grant ${row.revoke.grantId} is not held by the store — a revocation names a grant the record can show`);
          extras.revokedThrough = true;
        }
      }
      if (row.remedy === 'referral') {
        const petition = ctx.get?.('compact-petition');
        if (!petition?.counter || typeof petition.counter.flag !== 'function') {
          return refuse('no petition channel is composed — a referral rides the amendment invitation machinery (R-11/I-6), and there is no other door');
        }
        const { invitation } = petition.counter.flag({
          ruleId: row.ruleId, detail: row.detail, by: `judgment:${c.id}`,
        });
        if (invitation) extras.invitedAt = invitation.at;
      }

      attachRemedy(c, row, extras);
      const lines = [
        `[J-6] remedy landed on ${c.id} (${row.remedy}) — a compensating entry; nothing is erased (I-2).`,
        ...renderRemedies(c).slice(-1),
      ];
      if (row.remedy === 'standing' && extras.grantId) {
        lines.push(`the gates read it as they read every grant: ${extras.grantId}, through the declared machinery (D-8 honored).`);
      }
      if (row.remedy === 'revocation') {
        lines.push('the row is the order; the re-declaration is the operator\'s recorded rotation — cite this judgment in it.');
      }
      if (row.remedy === 'referral') {
        lines.push(extras.invitedAt
          ? `the threshold was met: an amendment invitation issued (${new Date(extras.invitedAt).toISOString()}).`
          : 'counted toward the threshold — the channel decides when to invite, not the judgment (R-11).');
      }
      return lines.join('\n');
    },
  });

  // ── the appeal door (J-5) — one appeal, as of right, to a disjoint bench ──
  const judicatureAppeal = defineTool({
    name: 'judicature_appeal',
    description:
      'File the one appeal, as of right (no leave, no permission step): argue the law was MISAPPLIED on this record — ' +
      'the same record, re-read; no new evidence. The appellate panel resolves from sets DISJOINT from the first ' +
      'panel\'s (declared dependency edges, both ways); a second appeal is refused — the door closes, the petition ' +
      'door never does. Where a party is of the Enforcer\'s own class (D-8), the route requires external Witnesses: ' +
      'pending I-1, heard never, saying so.',
    parameters: {
      case_id: { type: 'string', required: true, description: 'the judged case being appealed' },
      grounds: { type: 'string', required: true, description: 'the argued claim that the law was misapplied on this record — an unargued appeal is not one' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const c = docket.get(String(args?.case_id ?? '').trim());
      if (!c) {
        const envelope = caseUnknownEnvelope(String(args?.case_id ?? ''));
        emitRefusal(envelope, 'judicature_appeal');
        return envelope.text;
      }
      let appeal;
      try {
        appeal = fileAppeal(c, { filer: { kind: 'process', id: callerOf(exec) ?? 'unknown' }, grounds: String(args?.grounds ?? '') });
      } catch (error) {
        const envelope = appealRefusedEnvelope(clean(error));
        emitRefusal(envelope, 'judicature_appeal');
        return envelope.text;
      }
      // the appellate bench: disjoint sets only, and the D-8 wall first
      const panel = resolveAppellatePanel(judiciary, { ...c, appeal });
      appeal.panel = panel;
      if (panel.status === 'unavailable') {
        const envelope = appealUnavailableEnvelope();
        emitRefusal(envelope, 'judicature_appeal');
        return envelope.text; // no appellate authority exists — nothing records
      }
      c.appeal = appeal;
      const lines = [
        `[J-5] appeal filed on ${c.id} by ${appeal.filer.kind}:${appeal.filer.id} — as of right, once.`,
        `  grounds: ${appeal.grounds}`,
      ];
      if (panel.status === 'panel') {
        lines.push(`  appellate panel: ${panel.setId} (${panel.seats.join(', ')}) — disjoint from ${c.panel.setId} by declared edges.`,
          'The appeal re-hears on the SAME record: judicature_judge from one of these seats, disposition affirm or depart.');
      } else if (panel.status === 'unheard') {
        lines.push('  appellate panel: none — every disjoint set recused; the appeal is UNHEARD, never dismissed.',
          'The recorded appeal holds the door: no second appeal files while it stands, and no set is declared later within this runtime (the annex is fixed at boot). Nothing is final — the first judgment stays operative.');
      } else if (panel.status === 'witnesses-pending') {
        const envelope = appealWitnessesPendingEnvelope();
        lines.push(
          `  appellate panel: none — [${GATE}/appeal-witnesses-pending] ${envelope.reason}`,
          '  Lawful next moves:',
          ...envelope.lawfulNextMoves.map((move) => `    — ${move}`),
        );
      }
      return lines.join('\n');
    },
  });

  // ── the precedent read door (J-7) — bounded, one judgment per read ──
  const judicaturePrecedent = defineTool({
    name: 'judicature_precedent',
    description:
      'Read the docket\'s judgments as precedent (J-7): with no arguments, the bounded index — one line per landed ' +
      'judgment, with the precedent each follows or departs from and who relies on it; with case_id, that case\'s ' +
      'judgment in full: findings, rules, REASONS (the interpretation is the point), dissent with its reasons, and ' +
      'the precedent it follows or argues against. Every read carries the standing sentence: an interpretive aid ' +
      'with no force — judgments interpret the pinned law (law_read), and where a reading and the law disagree, the ' +
      'law prevails and the petition channel hears the collision. Judgments of other compositions are evidence of ' +
      'reasoning, never binding law (FED-1).',
    parameters: {
      case_id: { type: 'string', description: 'optional — one case\'s judgment in full; omit for the index' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const cases = () => order.map((id) => docket.get(id));
      const id = typeof args?.case_id === 'string' ? args.case_id.trim() : '';
      if (id) {
        const c = docket.get(id);
        if (!c) {
          const envelope = caseUnknownEnvelope(id);
          emitRefusal(envelope, 'judicature_precedent');
          return envelope.text;
        }
        return renderJudgmentAsPrecedent(c, cases());
      }
      return renderPrecedentIndex(cases());
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
    for (const t of [judicatureHear, judicatureCase, judicatureInterim, judicatureJudge, judicatureRemedy, judicatureAppeal, judicaturePrecedent, judicatureSets]) {
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
    /** Annotations covering a session (J-6) — every read door surfaces them. */
    annotationsFor: (sessionId) => annotationsOf(order.map((id) => docket.get(id)), sessionId),
    /** Restitution obligations owed BY a session (J-6/R-12) — the exit ledger's line. */
    restitutionsFor: (sessionId) => restitutionsOf(order.map((id) => docket.get(id)), sessionId),
    /** Revocation orders landed (J-6) — for the operator's recorded rotation. */
    revocations: () => order.flatMap((id) => (docket.get(id).remedies ?? [])
      .filter((r) => r.remedy === 'revocation')
      .map((r) => ({ caseId: id, ...r }))),
    /** The appeal on a case, or null (J-5). */
    appeal: (id) => (docket.has(id) ? structuredClone(docket.get(id).appeal) : null),
    /** The precedent index (J-7): every landed judgment with its case id. */
    precedents: () => order
      .map((id) => docket.get(id))
      .filter((c) => operativeJudgment(c) != null)
      .map((c) => ({ caseId: c.id, judgment: structuredClone(operativeJudgment(c)) })),
    /** The reliance map (J-7): case id → the cases whose judgments follow it. */
    reliedUponBy: () => reliedUponBy(order.map((id) => docket.get(id))),
  };
  for (const gap of DECLARED_GAPS) ctx.logger?.warn?.(`judicature: ${gap}`);
  ctx.provide?.('compact-judicature', service);
  return service;
}
