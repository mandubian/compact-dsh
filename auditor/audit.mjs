#!/usr/bin/env node
// auditor — the offline verification CLI (port plan Phase 4 item 4; I-7).
//
// Replays a session log and checks the constitution invariants over complete
// history, WITHOUT the Enforcer's cooperation:
//   - seq contiguity (the log is an ordered record, not a bag)
//   - every approval/decided has a matching, earlier approval/asked (and a
//     still-open approval/asked at the tail is a crash-tail finding)
//   - approval outcomes are in the closed vocabulary
//   - the approval pair is turn-enclosed (the host's own discipline)
//   - command/run / command/done are paired
//
// INTEGRITY (I-2/R-7, Phase 6). Given the session's chain sidecar
// (`--chain <id>.chain`), the auditor verifies the log against its committed
// links here, offline, with no cooperation from the Enforcer — which is the
// whole point of I-7: a verifier that had to ask the Enforcer whether the
// Enforcer had behaved would verify nothing. Without a chain the auditor
// still runs, and says plainly that it is relying on log completeness alone.
// The attestation always names which basis it used.
//
// SIGNATURES (the rehearsal, docs/decision-rehearsal-identity.md). Two
// verification domains, kept separate because the law keeps them separate:
//   law artifacts  — `--keyring <manifest> --seal <sig.json> --body <compact.md>`
//                    verifies the law seal k-of-n under the development keyring.
//   runtime arti.  — `--annex <enforcer.annex.json>` verifies the signed annex
//                    (self-signature + law-digest join); `--anchors
//                    <id>.chain.sigs.jsonl` (with --annex) verifies the
//                    record's authorship anchors against the log;
//                    `--identities <subjects.jsonl>` (with --annex) verifies
//                    the subject certificates and the certified delegation
//                    lineage — every signature under the annex key, every
//                    child bound to its parent's digest at depth+1, expiry
//                    and unknown keys refused by name.
// Every signature verdict is reported in the fixed form "VALID under DEV
// keyring — conveys no standing"; refusals are named. Nothing given, nothing
// implied: signature checks default to `not checked`.
//
// Usage: node auditor/audit.mjs <session-log.{json|jsonl}> [--chain <file>] [--annex <file>] [--anchors <file>] [--identities <file>] [--roll <roll.json> --keyring <manifest>] [--declarations <file> --roll <roll.json>] [--keyring <file> --seal <file> --body <file>] [--quiet]
// Exit 0 with a per-session attestation on stdout, exit 1 with findings.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { genesisHash, verifySlice, RecordIntegrityError, extendChain, readAnchors } from '../packages/record/src/index.js';
import { verifyAnchorChain } from '../packages/record/src/anchors.js';
import { COMPACT_DIGEST } from '../packages/constitution/src/body.js';
import { parseManifest, parseSeal, verifySeal, verifyAnnex, verifySubjectCert, verifyRoll, verifyPriorDeclaration, certUnsignedBytes, canonicalBytes, withoutField, sha256Hex, SealError } from '../packages/seals/src/index.js';

const DEV_BASIS_PHRASE = 'VALID under DEV keyring — conveys no standing';

const OUTCOMES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable']);

function parseLog(file) {
  const text = readFileSync(file, 'utf8');
  if (text.trim().startsWith('[')) return JSON.parse(text);
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

/**
 * The dsh v3 JSONL format writes a session HEADER line (type:'session', no
 * seq) before the first event. The chain commits to seq'd acts only, so the
 * header is deployment metadata, not an act: it is counted, not audited. Any
 * OTHER line without a numeric seq stays in the event list, where the
 * contiguity check flags it — an act that cannot be ordered cannot be chained.
 */
export function splitPreamble(lines) {
  const events = [];
  let headerLines = 0;
  for (const e of lines) {
    if (e?.seq === undefined && e?.type === 'session' && (e?.version === 3 || e?.version === 4)) headerLines += 1;
    else events.push(e);
  }
  return { events, headerLines };
}

export function audit(events, chainFile, headerLines = 0, extras = {}) {
  const chain = chainFile ? checkChain(chainFile, events) : null;
  const signatures = checkSignatures(events, extras);
  const findings = [];
  const askedIds = new Map();   // approval id -> seq
  const openTurns = [];
  const commandRuns = new Map();
  let lastSeq = -1;

  events.forEach((e, index) => {
    const seq = e?.seq;
    if (typeof seq !== 'number' || seq !== index) {
      findings.push({ seq, type: e?.type, severity: 'error', rule: 'I-2', detail: `seq ${seq} at position ${index} — the log is not contiguous` });
    }
    if (seq !== undefined && seq <= lastSeq && lastSeq !== -1) {
      findings.push({ seq, type: e?.type, severity: 'error', rule: 'I-2', detail: `seq ${seq} after ${lastSeq} — the log is out of order` });
    }
    if (typeof seq === 'number') lastSeq = seq;

    const inTurn = openTurns.length > 0;
    switch (e?.type) {
      case 'turn/start':
        openTurns.push(seq);
        break;
      case 'turn/end': {
        const top = openTurns.pop();
        if (top === undefined) {
          findings.push({ seq, type: e.type, severity: 'error', rule: 'D-3', detail: 'turn/end without an open turn — the log is unbalanced' });
        }
        break;
      }
      case 'approval/asked':
        askedIds.set(e.data?.id, seq);
        if (!inTurn) {
          findings.push({ seq, type: e.type, severity: 'error', rule: 'I-5', detail: 'approval/asked outside an open turn — the audit pair must be turn-enclosed' });
        }
        break;
      case 'approval/decided': {
        const id = e.data?.id;
        if (!askedIds.has(id)) {
          findings.push({ seq, type: e.type, severity: 'error', rule: 'D-7', detail: `approval/decided ${id} with no recorded ask — a decision from nowhere violates the pair discipline` });
        } else if (!inTurn) {
          findings.push({ seq, type: e.type, severity: 'error', rule: 'I-5', detail: 'approval/decided outside an open turn — the audit pair must be turn-enclosed' });
        }
        if (!OUTCOMES.has(e.data?.outcome)) {
          findings.push({ seq, type: e.type, severity: 'error', rule: 'I-5', detail: `outcome ${JSON.stringify(e.data?.outcome)} is outside the closed vocabulary` });
        }
        break;
      }
      case 'command/run':
        commandRuns.set(e.data?.commandId, seq);
        break;
      case 'command/done': {
        if (!commandRuns.has(e.data?.commandId)) {
          findings.push({ seq, type: e.type, severity: 'error', rule: 'D-3', detail: `command/done ${e.data?.commandId} with no recorded command/run` });
        }
        break;
      }
      default:
        break;
    }
  });

  // a still-open approval/asked at the tail: the Enforcer crashed mid-decision
  for (const [id, seq] of askedIds) {
    if (!events.some(e => e?.type === 'approval/decided' && e.data?.id === id)) {
      findings.push({ seq, type: 'approval/asked', severity: 'warning', rule: 'I-5', detail: `approval ask ${id} was never decided — the log ends mid-decision` });
    }
  }
  if (openTurns.length > 0) {
    findings.push({ seq: lastSeq, type: 'turn/end', severity: 'warning', rule: 'D-3', detail: 'the log ends inside an open turn (a crash tail — legal mid-session, a finding in an export)' });
  }

  if (chain?.finding) findings.push(chain.finding);
  for (const f of signatures.findings) findings.push(f);

  const errors = findings.filter(f => f.severity === 'error');
  const anchorsChecked = signatures.anchors ? (signatures.anchors.ok ? 'verified' : 'BROKEN') : 'not checked';
  const annexChecked = signatures.annex ? (signatures.annex.ok ? 'verified' : 'BROKEN') : 'not checked';
  const bodySealChecked = signatures.bodySeal ? (signatures.bodySeal.ok ? 'verified' : 'BROKEN') : 'not checked';
  const identitiesChecked = signatures.identities ? (signatures.identities.ok ? 'verified' : 'BROKEN') : 'not checked';
  const rollChecked = signatures.roll ? (signatures.roll.ok ? 'verified' : 'BROKEN') : 'not checked';
  const declarationsChecked = signatures.declarations ? (signatures.declarations.ok ? 'verified' : 'BROKEN') : 'not checked';
  return {
    verdict: errors.length === 0 ? 'conforming' : 'violations',
    checked: {
      events: events.length, asks: askedIds.size, headerLines: headerLines ?? 0,
      chain: chain ? (chain.ok ? 'verified' : 'BROKEN') : 'not checked',
      annex: annexChecked, anchors: anchorsChecked, bodySeal: bodySealChecked, identities: identitiesChecked, roll: rollChecked, declarations: declarationsChecked,
    },
    ...(chain?.ok ? { chainHead: chain.head } : {}),
    ...(signatures.annex?.ok ? { enforcer: signatures.annex } : {}),
    ...(signatures.anchors?.ok ? { authorship: signatures.anchors } : {}),
    ...(signatures.identities?.ok ? { identityChain: signatures.identities } : {}),
    ...(signatures.roll?.ok ? { memberRoll: signatures.roll } : {}),
    ...(signatures.declarations ? { declarations: signatures.declarations } : {}),
    ...(signatures.declarations?.ok ? { priorDeclarations: signatures.declarations } : {}),
    ...(signatures.bodySeal?.ok ? { lawSeal: signatures.bodySeal } : {}),
    reliesOn: [
      chain
        ? `the hash chain in ${chain.file} (session ${chain.sessionId}), verified here — the log's integrity was checked ` +
          `offline, without the Enforcer's cooperation (I-2/R-7); ` +
          (signatures.anchors?.ok
            ? 'integrity and authorship are reported separately below'
            : 'the links themselves are unsigned (I-1 declared debt)')
        : 'log completeness only — no chain sidecar was given, so this run verifies continuity and conformance but NOT ' +
          'integrity; pass --chain <id>.chain to verify the record has not been rewritten (I-2)',
      ...(signatures.annex?.ok
        ? [`the enforcer annex ${signatures.annex.file} (key ${signatures.annex.keyId}), self-signature and law-digest join verified here — authorship claims under this key carry no standing (I-1 rehearsal)`]
        : []),
      ...(signatures.anchors?.ok
        ? [`${signatures.anchors.anchors} chain anchor(s) in ${signatures.anchors.file}, verified here: ${DEV_BASIS_PHRASE} (R-7 rehearsal)`]
        : []),
      ...(signatures.bodySeal?.ok
        ? [`${DEV_BASIS_PHRASE}: the law seal over ${signatures.bodySeal.file} verifies at threshold ${signatures.bodySeal.threshold} (${signatures.bodySeal.distinctSigners} distinct signers)`]
        : []),
      ...(signatures.identities?.ok
        ? [`${signatures.identities.certificates} subject certificate(s) in ${signatures.identities.file} verify under enforcer key ${signatures.identities.keyId} — ` +
          `${signatures.identities.roots} root(s), ${signatures.identities.chained} chained to their parent's digest, ` +
          `${signatures.identities.incomplete} declared-but-unverifiable link(s), ` +
          `${signatures.identities.bound ?? 0} member-bound (countersignature verified against the roll${signatures.roll?.ok ? '' : ' — give --roll to verify the binding'}), ` +
          `${signatures.identities.unbound ?? 0} unbound: ${DEV_BASIS_PHRASE} (I-1/MA-1 rehearsal)`]
        : []),
      ...(signatures.roll?.ok
        ? [`the member roll ${signatures.roll.file}: ${signatures.roll.entries} identity event(s), ${signatures.roll.members} member(s) (${signatures.roll.live} live, ${signatures.roll.revoked} revoked, ${signatures.roll.rotations} rotation(s)), ` +
          `epoch checkpoints anchored through seq ${signatures.roll.anchoredThrough ?? 'none'} — every event signature verified (admission by the statute quorum AND the member's own key; rotation by the predecessor; revocation by the quorum): ${DEV_BASIS_PHRASE} (I-1 rehearsal)`]
        : []),
      ...(signatures.declarations?.ok
        ? [`${signatures.declarations.valid}/${signatures.declarations.declarations} prior declaration(s) in ${signatures.declarations.file} carry the Member's OWN signature, verified against the roll — the authorship half of R-9's value-scoped limb (amendment 0002), offline: ${DEV_BASIS_PHRASE} (R-9 rehearsal, identity slice 4)`]
        : []),
    ],
    findings,
  };
}

/**
 * Verify the subject-identity ledger (#20), the offline half of the
 * certified delegation lineage:
 *
 *   1. SIGNATURE — every certificate against the annex key: an unknown or
 *      forged key, a malformed certificate, and an EXPIRED one each refuse by
 *      name (`cert-signature-invalid`, `cert-malformed`, `cert-expired`).
 *   2. FRAMING — the line's declared subjectId and digest are re-derived from
 *      the certificate it carries: a ledger line that disagrees with its own
 *      artifact is evidence, not bookkeeping, and it fails.
 *   3. LINEAGE — a child naming a parent certificate must resolve that digest
 *      HERE, at exactly one depth less. A digest that resolves nowhere is an
 *      ERROR (the chain cannot be verified past that link); a child that
 *      names a parent WITHOUT a digest was issued against an unreadable
 *      parent header — honestly incomplete, reported as a warning rather than
 *      left to look complete (D-7).
 *
 * Superseded certificates are not a defect: a restarted runtime issues a new
 * keypair for the same session id, and every issuance still verifies on its
 * own line. An unreadable ledger is an ERROR — evidence that cannot be read
 * is refused, never skipped.
 */
function checkIdentities(file, annex, roll = null, now = Date.now()) {
  const findings = [];
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
  } catch (e) {
    return {
      ok: false,
      summary: { certificates: 0, roots: 0, chained: 0, incomplete: 0 },
      findings: [{ seq: null, type: 'identities', severity: 'error', rule: 'I-1', detail: `subject-identity ledger unreadable: ${e.message}` }],
    };
  }
  const certs = [];
  const byDigest = new Map();
  lines.forEach((line, index) => {
    const at = `identity ledger line ${index + 1}`;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      findings.push({ seq: null, type: 'identities', severity: 'error', rule: 'I-1', detail: `${at} is not JSON (${e.message}) — evidence that cannot be read is refused, not skipped` });
      return;
    }
    if (entry?.kind !== 'subject-certificate') {
      findings.push({ seq: null, type: 'identities', severity: 'error', rule: 'I-1', detail: `${at} does not declare kind "subject-certificate" — a line the verifier cannot place is refused, not interpreted` });
      return;
    }
    try {
      verifySubjectCert({
        cert: entry.cert,
        enforcerKey: annex.enforcerKey,
        expectedSubjectId: typeof entry.subjectId === 'string' ? entry.subjectId : null,
        now,
      });
    } catch (e) {
      findings.push({ seq: null, type: 'identities', severity: 'error', rule: 'I-1', detail: `${at}: ${e.message}` });
      return;
    }
    const digest = sha256Hex(canonicalBytes(withoutField(entry.cert, 'signature')));
    if (entry.certDigest !== digest) {
      findings.push({ seq: null, type: 'identities', severity: 'error', rule: 'I-1', detail: `${at} declares digest ${String(entry.certDigest).slice(0, 12)}… but its own certificate hashes to ${digest.slice(0, 12)}… — the line and the artifact disagree, and the artifact is what verifies` });
      return;
    }
    byDigest.set(digest, entry.cert);
    certs.push({ cert: entry.cert, digest, line: index + 1 });
  });

  const summary = { certificates: certs.length, roots: 0, chained: 0, incomplete: 0, bound: 0, unbound: 0 };
  for (const { cert, line } of certs) {
    const at = `identity ledger line ${line}`;
    // THE MEMBER BINDING JOIN (identity slice 2, #125): a certificate that
    // names a member key is checked against the ROLL — the roll is the
    // source of who holds which key, so the countersignature verifies
    // against the roll's public half for that digest, and standing reads
    // from rows, never from the issuing runtime's word
    if (cert.memberKeyDigest) {
      const bound = roll?.byKey?.get(cert.memberKeyDigest);
      if (roll && !bound) {
        findings.push({
          seq: null, type: 'identities', severity: 'error', rule: 'I-1',
          detail: `${at}: names member key ${cert.memberKeyDigest.slice(0, 12)}…, which the roll never bound — a binding to a member the roll does not show is the false answer D-3 names`,
        });
      } else if (bound && bound.member.state === 'revoked') {
        findings.push({
          seq: null, type: 'identities', severity: 'error', rule: 'F-8',
          detail: `${at}: the bound Member was REVOKED at roll entry ${bound.member.revocationRow} — the act that leans on this certificate refuses on a row it can cite (revocation is a fact, not an absence)`,
        });
      } else if (bound) {
        summary.bound += 1;
        try {
          verifySubjectCert({ cert, enforcerKey: annex.enforcerKey, memberPublicKey: bound.publicKey, now });
        } catch (e) {
          if (e instanceof SealError && e.reason === 'cert-countersignature-invalid') {
            findings.push({ seq: null, type: 'identities', severity: 'error', rule: 'I-1', detail: `${at}: ${e.message}` });
          } else {
            findings.push({ seq: null, type: 'identities', severity: 'warning', rule: 'I-1', detail: `${at}: ${e.message}` });
          }
        }
      } else {
        // a roll was not given: the countersignature is structurally present
        // but cannot be verified offline — declared, never passed silently
        findings.push({
          seq: null, type: 'identities', severity: 'warning', rule: 'I-1',
          detail: `${at}: names member key ${cert.memberKeyDigest.slice(0, 12)}… with a countersignature this run CANNOT verify — pass --roll to resolve the member's key from the roll (I-7)`,
        });
      }
    } else if (roll) {
      summary.unbound += 1;
    }
    if (!cert.parentSubjectId && !cert.parentCertDigest) { summary.roots += 1; continue; }
    if (!cert.parentCertDigest) {
      summary.incomplete += 1;
      findings.push({
        seq: null, type: 'identities', severity: 'warning', rule: 'MA-1',
        detail: `${at}: ${cert.subjectId} names parent ${cert.parentSubjectId} but binds no parent digest — issued against a parent header this runtime could not read; the link is declared but CANNOT be verified offline`,
      });
      continue;
    }
    const parent = byDigest.get(cert.parentCertDigest);
    if (!parent) {
      findings.push({
        seq: null, type: 'identities', severity: 'error', rule: 'MA-1',
        detail: `${at}: broken certified lineage — ${cert.subjectId} binds parent certificate ${cert.parentCertDigest.slice(0, 12)}…, which is not in this ledger; the chain cannot be verified past that link`,
      });
      continue;
    }
    if (parent.subjectId !== cert.parentSubjectId) {
      findings.push({
        seq: null, type: 'identities', severity: 'error', rule: 'MA-1',
        detail: `${at}: ${cert.subjectId} names parent ${cert.parentSubjectId}, but the bound certificate belongs to ${parent.subjectId} — the binding names one Member and certifies another`,
      });
      continue;
    }
    if (cert.depth !== parent.depth + 1) {
      findings.push({
        seq: null, type: 'identities', severity: 'error', rule: 'MA-1',
        detail: `${at}: ${cert.subjectId} declares depth ${cert.depth} under a parent certified at depth ${parent.depth} — delegation depth is off by ${cert.depth - (parent.depth + 1)}`,
      });
      continue;
    }
    summary.chained += 1;
  }

  return {
    ok: !findings.some((f) => f.severity === 'error'),
    summary: { ...summary, keyId: annex.keyId, basis: 'dev-keyring', conveysStanding: false, phrase: DEV_BASIS_PHRASE },
    findings,
  };
}

/**
 * Verify the rehearsal signatures, given optional inputs. Every refusal is a
 * named ERROR finding: a broken declared seal is not a warning (D-7). Absent
 * inputs are `not checked` and imply nothing.
 */
function checkSignatures(events, { annexFile, anchorsFile, identitiesFile, rollFile, declarationsFile, keyringFile, sealFile, bodyFile }) {
  const findings = [];
  const out = {};

  let annex = null;
  if (annexFile) {
    try {
      const parsed = JSON.parse(readFileSync(annexFile, 'utf8'));
      // the auditor checks the join against ITS OWN law: an annex over another
      // digest is another jurisdiction, and refuses here
      const joined = verifyAnnex({ annex: parsed, expectedLawDigest: COMPACT_DIGEST });
      out.annex = { file: annexFile, ok: true, keyId: joined.keyId, annexDigest: joined.annexDigest, lawDigest: joined.lawDigest, basis: 'dev-keyring', conveysStanding: false };
      annex = joined;
    } catch (e) {
      out.annex = { file: annexFile, ok: false };
      findings.push({ seq: null, type: 'annex', severity: 'error', rule: 'I-1', detail: `enforcer annex refused: ${e.message}` });
    }
  }

  if (anchorsFile) {
    if (!annex) {
      out.anchors = { file: anchorsFile, ok: false };
      findings.push({ seq: null, type: 'anchors', severity: 'error', rule: 'I-1', detail: 'anchor verification requires a verified enforcer annex (--annex) — authorship is checked against a key, never against nothing' });
    } else {
      try {
        const sessionId = basename(anchorsFile).replace(/\.chain\.sigs\.jsonl$/, '');
        // the record's own reader parses the sidecar: a corrupted line is a
        // named anchor-malformed refusal, not a bare SyntaxError
        const anchors = readAnchors(dirname(anchorsFile), sessionId);
        const lastSeq = events.length > 0 ? (events[events.length - 1]?.seq ?? -1) : -1;
        const head = lastSeq >= 0
          ? extendChain(genesisHash(sessionId), 0, events).at(-1).h
          : genesisHash(sessionId);
        const verdict = verifyAnchorChain({
          sessionId, anchors,
          expectedHeadHash: head, expectedUpToSeq: lastSeq,
          enforcerKey: annex.enforcerKey, expectedAnnexDigest: annex.annexDigest,
        });
        out.anchors = { file: anchorsFile, ok: true, sessionId, ...verdict, phrase: DEV_BASIS_PHRASE };
      } catch (e) {
        out.anchors = { file: anchorsFile, ok: false };
        findings.push({ seq: null, type: 'anchors', severity: 'error', rule: 'R-7', detail: `chain anchors refused: ${e.message}` });
      }
    }
  }

  let rollVerdict = null;
  if (rollFile) {
    if (!keyringFile) {
      out.roll = { file: rollFile, ok: false };
      findings.push({ seq: null, type: 'roll', severity: 'error', rule: 'I-1', detail: 'roll verification requires the authority manifest (--keyring) — roll events are signed by the keys the statute empowers, checked against a manifest, never against nothing' });
    } else {
      try {
        const manifest = parseManifest(readFileSync(keyringFile, 'utf8'));
        const roll = JSON.parse(readFileSync(rollFile, 'utf8'));
        const verdict = verifyRoll({ roll, manifest });
        out.roll = { file: rollFile, ok: verdict.ok, ...verdict.summary, phrase: DEV_BASIS_PHRASE };
        rollVerdict = verdict;
        findings.push(...verdict.findings.map((f) => ({
          seq: null, type: 'roll', severity: f.severity, rule: f.rule,
          detail: `[${f.reason}] ${f.detail}`,
        })));
      } catch (e) {
        out.roll = { file: rollFile, ok: false };
        findings.push({ seq: null, type: 'roll', severity: 'error', rule: 'I-1', detail: `member roll refused: ${e.message}` });
      }
    }
  }

  if (identitiesFile) {
    if (!annex) {
      out.identities = { file: identitiesFile, ok: false };
      findings.push({ seq: null, type: 'identities', severity: 'error', rule: 'I-1', detail: 'identity verification requires a verified enforcer annex (--annex) — a subject certificate is checked against the key that signed it, never against nothing' });
    } else {
      const verdict = checkIdentities(identitiesFile, annex, rollVerdict?.byKey ? rollVerdict : null);
      out.identities = { file: identitiesFile, ok: verdict.ok, ...verdict.summary };
      findings.push(...verdict.findings);
    }
  }
  // Prior declarations (identity slice 4, #127): the authorship half of
  // R-9's value-scoped limb, verified offline — each declaration's
  // signature resolves through the roll's public half for the digest it
  // names, and the Member's standing reads from rows. No --roll, no
  // verification: the authorship question is exactly what the roll answers.
  if (declarationsFile) {
    if (!rollFile) {
      out.declarations = { file: declarationsFile, ok: false };
      findings.push({ seq: null, type: 'declarations', severity: 'error', rule: 'R-9', detail: 'prior-declaration verification requires the member roll (--roll) — authorship resolves through the roll\'s keys, never through this log\'s word for itself' });
    } else {
      try {
        const lines = readFileSync(declarationsFile, 'utf8').split('\n').filter((l) => l.trim() !== '');
        const declFindings = [];
        let valid = 0;
        lines.forEach((line, i) => {
          const at = `declaration ledger line ${i + 1}`;
          let row;
          try { row = JSON.parse(line); } catch (e) {
            declFindings.push({ seq: null, type: 'declarations', severity: 'error', rule: 'R-9', detail: `${at} is not JSON (${e.message}) — evidence that cannot be read is refused, not skipped` });
            return;
          }
          const verdict = verifyPriorDeclaration(row, rollVerdict);
          if (verdict.valid) valid += 1;
          else declFindings.push({ seq: null, type: 'declarations', severity: 'error', rule: 'R-9', detail: `${at}: ${verdict.reason}` });
        });
        out.declarations = { file: declarationsFile, ok: !declFindings.some((f) => f.severity === 'error'), declarations: lines.length, valid, phrase: DEV_BASIS_PHRASE };
        findings.push(...declFindings);
      } catch (e) {
        out.declarations = { file: declarationsFile, ok: false };
        findings.push({ seq: null, type: 'declarations', severity: 'error', rule: 'R-9', detail: `declarations ledger refused: ${e.message}` });
      }
    }
  }


  // --keyring may ride alone for the roll domain above; the LAW seal needs
  // all three inputs together, so it wakes on --seal/--body (or a --keyring
  // that is not serving a roll)
  if (sealFile || bodyFile || (keyringFile && !rollFile)) {
    if (!keyringFile || !sealFile || !bodyFile) {
      out.bodySeal = { ok: false };
      findings.push({ seq: null, type: 'law-seal', severity: 'error', rule: 'I-1', detail: 'the law seal needs all three inputs together: --keyring <manifest> --seal <sig.json> --body <compact.md>' });
    } else {
      try {
        const verdict = verifySeal({
          bytes: readFileSync(bodyFile),
          subject: 'compact-body',
          seal: parseSeal(readFileSync(sealFile, 'utf8')),
          manifest: parseManifest(readFileSync(keyringFile, 'utf8')),
        });
        out.bodySeal = { file: bodyFile, ok: true, ...verdict, phrase: DEV_BASIS_PHRASE };
      } catch (e) {
        out.bodySeal = { ok: false };
        findings.push({ seq: null, type: 'law-seal', severity: 'error', rule: 'I-1', detail: `law seal refused: ${e.message}` });
      }
    }
  }
  return { ...out, findings };
}


/**
 * Verify a log against its committed chain. A break is an ERROR finding, not a
 * warning: a record that cannot be verified is not evidence (I-2, R-7).
 */
function checkChain(file, events) {
  const sessionId = basename(file).replace(/\.chain$/, '');
  const links = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line === '') continue;
    try {
      const rec = JSON.parse(line);
      if (typeof rec?.seq === 'number' && typeof rec?.h === 'string') links.set(rec.seq, rec.h);
    } catch { /* a torn tail line commits to nothing */ }
  }
  try {
    verifySlice({ sessionId, firstSeq: 0, events, links });
    const lastSeq = events.length > 0 ? events[events.length - 1]?.seq : undefined;
    return { file, sessionId, ok: true, head: (typeof lastSeq === 'number' ? links.get(lastSeq) : undefined) ?? genesisHash(sessionId), finding: null };
  } catch (e) {
    if (!(e instanceof RecordIntegrityError)) throw e;
    return {
      file, sessionId, ok: false, head: null,
      finding: { seq: e.seq, type: 'chain', severity: 'error', rule: 'I-2', detail: `${e.kind}: ${e.message}` },
    };
  }
}

function main() {
  const file = process.argv[2];
  const quiet = process.argv.includes('--quiet');
  const opt = (name) => {
    const idx = process.argv.indexOf(name);
    return idx > 0 ? process.argv[idx + 1] : undefined;
  };
  const chainFile = opt('--chain');
  const annexFile = opt('--annex');
  const anchorsFile = opt('--anchors');
  const identitiesFile = opt('--identities');
  const keyringFile = opt('--keyring');
  const sealFile = opt('--seal');
  const bodyFile = opt('--body');
  const rollFile = opt('--roll');
  const declarationsFile = opt('--declarations');
  const has = (name) => process.argv.includes(name);
  if (!file || (has('--chain') && !chainFile) || (has('--annex') && !annexFile) || (has('--anchors') && !anchorsFile) || (has('--identities') && !identitiesFile) || (has('--roll') && !rollFile) || (has('--declarations') && !declarationsFile)) {
    console.error('usage: node auditor/audit.mjs <session-log.{json|jsonl}> [--chain <id>.chain] [--annex <enforcer.annex.json>] [--anchors <id>.chain.sigs.jsonl] [--identities <subjects.jsonl>] [--roll <roll.json> --keyring <manifest>] [--declarations <declarations.jsonl> --roll <roll.json>] [--keyring <manifest> --seal <sig.json> --body <compact.md>] [--quiet]');
    process.exit(2);
  }
  let parsed;
  try {
    parsed = parseLog(file);
  } catch (e) {
    console.error(`auditor: cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const { events, headerLines } = splitPreamble(parsed);
  const attestation = { session: file, ...audit(events, chainFile, headerLines, { annexFile, anchorsFile, identitiesFile, rollFile, declarationsFile, keyringFile, sealFile, bodyFile }) };
  if (!quiet) console.log(JSON.stringify(attestation, null, 2));
  const errors = attestation.findings.filter(f => f.severity === 'error');
  if (errors.length > 0) {
    if (quiet) for (const f of errors) console.error(`${f.seq} ${f.type} [${f.rule}] ${f.detail}`);
    console.error(`auditor: ${errors.length} violation(s) — the session does not conform`);
    process.exit(1);
  }
  if (quiet) console.log(`auditor: conforming (${attestation.checked.events} events, ${attestation.checked.asks} approval asks)`);
}

if (process.argv[1] && process.argv[1].endsWith('audit.mjs')) main();
