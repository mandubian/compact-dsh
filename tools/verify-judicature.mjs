#!/usr/bin/env node
// verify-judicature — the OFFLINE adjudicator-set verifier (I-7's discipline,
// J-4's own sentence: independence "is checked the way everything else here
// is: by anyone, from records").
//
// WHAT IT CHECKS, in order:
//   1. the annex verifies — self-signature and law-digest pin (F-5)
//   2. the adjudicatorSets section, when present, validates against the
//      schema: closed edge vocabulary, no dangling edges, trajectory carried
//      as data with the expiry DERIVED from the clock, never stored (J-8)
//   3. optional computations:
//        --parties kind:id,kind:id  recusal per seat (overlap named) and the
//                                   panel resolution, incl. the unheard state
//        --sets A,B                  set-level independence (J-5's "not
//                                   subordinate", a directed walk)
//
// EXIT: 0 when the declaration is lawful (an annex with NO section is the
// honest undeclared state — noted, not failed); 1 on any refusal. The graph
// is an affidavit, not an oracle: this tool cross-examines the declared
// bytes and their signature, nothing more.
//
// Usage:
//   node tools/verify-judicature.mjs --annex <path> [--parties k:i,...] [--sets A,B]
import { readFileSync } from 'node:fs';
import { verifyAnnex, SealError } from 'compact-dsh-seals';
import { COMPACT_DIGEST } from '../packages/constitution/src/body.js';
import {
  validateAdjudicatorSets, recusePerSet, resolvePanel, independenceBetweenSets,
  trajectoryState, SetError,
} from '../packages/judicature/src/sets.js';

export function parseParties(spec) {
  return String(spec ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [kind, ...rest] = s.split(':'); return { kind, id: rest.join(':') }; });
}

/** Verify one annex's sets declaration. Returns { ok, lines, failures }. */
export function verifyJudiciary({ annex, now = Date.now(), parties = [], setPair = null }) {
  const lines = [];
  const failures = [];
  let verified;
  try {
    verified = verifyAnnex({ annex, expectedLawDigest: COMPACT_DIGEST, now });
  } catch (e) {
    if (e instanceof SealError) {
      failures.push(`annex refused (${e.reason}): ${e.message}`);
      return { ok: false, lines, failures };
    }
    throw e;
  }
  lines.push(`annex verifies (key ${verified.keyId}, digest ${verified.annexDigest.slice(0, 16)}…, law pinned)`);
  if (!annex.adjudicatorSets) {
    lines.push('no adjudicatorSets section: UNDECLARED — nothing can be heard, by design (J-8); this is the honest state, not a failure');
    return { ok: true, lines, failures };
  }
  let validated;
  try {
    validated = validateAdjudicatorSets(annex.adjudicatorSets, { enforcerKey: verified.keyId });
  } catch (e) {
    if (e instanceof SetError) {
      failures.push(`sets refused (${e.code}): ${e.message}`);
      return { ok: false, lines, failures };
    }
    throw e;
  }
  for (const set of validated.sets) {
    const t = trajectoryState(set, now);
    lines.push(`set ${set.id}: ${set.roles.length} role(s); first external Member by ${t.firstExternalMemberBy}${t.expired ? ' — EXPIRED (detected from records)' : ''}; founder excluded from ${t.founderExclusions.join(', ')}`);
    for (const role of set.roles) lines.push(`  seat ${role.id} — standing ${role.standing.kind}:${role.standing.id}`);
  }
  for (const e of validated.edges) lines.push(`edge ${e.from} —${e.type}→ ${e.to}`);
  if (parties.length > 0) {
    const per = recusePerSet(validated, parties);
    for (const a of per) {
      for (const r of a.refusals) lines.push(`REFUSED ${a.setId}/${r.roleId} — overlap: ${r.overlap.join(' → ')}`);
      if (a.seats.length > 0) lines.push(`${a.setId}: seats remain — ${a.seats.join(', ')}`);
    }
    const resolution = resolvePanel(validated, parties);
    lines.push(resolution.status === 'panel'
      ? `panel: ${resolution.setId} (${resolution.seats.join(', ')})`
      : 'panel: none — the case is UNHEARD, never dismissed (a default panel is the fraud)');
  }
  if (setPair) {
    const [a, b] = setPair;
    let out;
    try {
      out = independenceBetweenSets(validated, a, b);
    } catch (e) {
      if (e instanceof SetError) {
        failures.push(`independence refused (${e.code}): ${e.message}`);
        return { ok: false, lines, failures };
      }
      throw e;
    }
    lines.push(`independence ${a} vs ${b}: ${out.independent ? 'INDEPENDENT' : 'SUBORDINATE'}`);
    for (const o of out.overlap) lines.push(`  overlap ${o.a}/${o.b}: ${o.path.join(' → ')}`);
  }
  return { ok: failures.length === 0, lines, failures };
}

export function main(argv = process.argv.slice(2)) {
  const arg = (name) => {
    const at = argv.indexOf(`--${name}`);
    return at !== -1 ? argv[at + 1] : undefined;
  };
  const annexPath = arg('annex');
  if (!annexPath) {
    process.stderr.write('verify-judicature: --annex <path> is required\n');
    process.exit(1);
  }
  const rawSets = arg('sets');
  if (rawSets !== undefined && String(rawSets).split(',').filter((s) => s.trim()).length !== 2) {
    process.stderr.write('verify-judicature: --sets takes exactly two declared set ids, A,B\n');
    process.exit(1);
  }
  const setPair = rawSets ? rawSets.split(',').map((s) => s.trim()) : null;
  const { ok, lines, failures } = verifyJudiciary({
    annex: JSON.parse(readFileSync(annexPath, 'utf8')),
    parties: parseParties(arg('parties')),
    setPair,
  });
  for (const line of lines) process.stdout.write(`${line}\n`);
  if (!ok) {
    for (const f of failures) process.stderr.write(`verify-judicature: ${f}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
  && process.argv[1].includes('verify-judicature')) {
  main();
}
