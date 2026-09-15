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
// Honesty (declared, I-8): the dsh session log is complete but NOT
// tamper-evident — this auditor verifies continuity and conformance of what
// it is given; integrity verification waits for the Phase 8 hash-chained
// decorator. The attestation says which it is relying on.
//
// Usage: node auditor/audit.mjs <session-log.{json|jsonl}> [--quiet]
// Exit 0 with a per-session attestation on stdout, exit 1 with findings.
import { readFileSync } from 'node:fs';

const OUTCOMES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable']);

function parseLog(file) {
  const text = readFileSync(file, 'utf8');
  if (text.trim().startsWith('[')) return JSON.parse(text);
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export function audit(events) {
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

  const errors = findings.filter(f => f.severity === 'error');
  return {
    verdict: errors.length === 0 ? 'conforming' : 'violations',
    checked: { events: events.length, asks: askedIds.size },
    reliesOn: 'log completeness only — the dsh session log is NOT tamper-evident; integrity verification waits for the Phase 8 hash-chained decorator (I-2 declared debt)',
    findings,
  };
}

function main() {
  const file = process.argv[2];
  const quiet = process.argv.includes('--quiet');
  if (!file) {
    console.error('usage: node auditor/audit.mjs <session-log.{json|jsonl}> [--quiet]');
    process.exit(2);
  }
  let events;
  try {
    events = parseLog(file);
  } catch (e) {
    console.error(`auditor: cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const attestation = { session: file, ...audit(events) };
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
