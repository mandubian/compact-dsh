#!/usr/bin/env node
// community-artifacts — the publication pack for a finished community run.
//
// One command, three readings of the same durable archive:
//
//   REPORT.md  the operator's morning-after read, from sessions/chains/store
//   BRIEF.md   the deterministic citation-bound brief
//   READING.md the optional model-authored reading of that brief
//   PACK.md    the index: status, hashes, limits, and what was not generated
//
// The pack is written beside the run (default <run-dir>/publish). It does not
// write the forum, a chain, or run.json. REPORT and BRIEF are deterministic;
// READING is labeled model text and its audit is deterministic. If the model
// reading fails, the pack still exists and PACK.md says so — no placeholder
// prose is passed off as a reading.
//
// Usage:
//   node tools/community-artifacts.mjs <run-dir> [--out DIR]
//   node tools/community-artifacts.mjs <run-dir> --no-reading
//   node tools/community-artifacts.mjs <run-dir> --answer FILE
//   node tools/community-artifacts.mjs <run-dir> --settings FILE [--model provider/model]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveRunPaths, findSessionLogs, agentStatsFromLog, forumFromLedger,
  grantsFromStore, formatReport,
} from './community-report.mjs';
import { readBriefSources, renderBrief, auditBrief } from './community-brief.mjs';
import { generateReading } from './community-reading.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const sessionIdOfLog = (logPath) => logPath.split('/').slice(-2)[0];
const code = (s) => `\`${String(s).replace(/`/g, '\\`')}\``;

function oneLine(s, n = 180) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** Build and write the pack. Returns the same facts the index states, so
 *  the live launcher and tests can report them without parsing Markdown. */
export async function buildPublishPack({
  dir, out = null, settingsPath = null, answerPath = null, model = null,
  maxTokens = 1800, noReading = false, generatedAt = new Date().toISOString(),
}) {
  const archive = resolve(dir);
  const publishDir = resolve(out ?? join(archive, 'publish'));
  mkdirSync(publishDir, { recursive: true });

  // REPORT: the operator's read, from the durable state
  const paths = resolveRunPaths(archive);
  const logs = findSessionLogs(paths.recordRoot);
  const statsByLog = logs.map((p) => agentStatsFromLog(readFileSync(p, 'utf8'), sessionIdOfLog(p)));
  const forum = forumFromLedger(paths.forumLedger);
  const grants = grantsFromStore(paths.approvals);
  let run = null;
  if (paths.runJson) {
    try { run = JSON.parse(readFileSync(paths.runJson, 'utf8')); } catch { run = null; }
  }
  const report = `${formatReport({ paths, logs, statsByLog, forum, grants, run })}\n`;
  writeFileSync(join(publishDir, 'REPORT.md'), report, { mode: 0o644 });

  // BRIEF: deterministic, audited against the same archive
  const data = readBriefSources(archive);
  const brief = `${renderBrief(data)}\n`;
  const briefAudit = auditBrief(brief, data);
  writeFileSync(join(publishDir, 'BRIEF.md'), brief, { mode: 0o644 });

  // READING: optional model text, separately labeled and audited
  let reading = null;
  let readingAudit = null;
  let readingModel = null;
  let readingError = null;
  if (noReading) {
    readingError = 'skipped (--no-reading)';
  } else {
    try {
      const result = await generateReading({
        brief, data, answerPath, settingsPath, model, maxTokens,
      });
      reading = result.text;
      readingAudit = result.audit;
      readingModel = result.model;
      if (result.audit.ok) {
        writeFileSync(join(publishDir, 'READING.md'), reading, { mode: 0o644 });
      } else {
        const rejected = `${reading}\n\n---\n\n**AUDIT FAILED — not a publishable reading.**\n\n` +
          result.audit.failures.map((f) => `- ${f}`).join('\n') + '\n';
        writeFileSync(join(publishDir, 'READING.rejected.md'), rejected, { mode: 0o644 });
      }
    } catch (e) {
      readingError = e?.message ?? String(e);
    }
  }

  // the cut manifest, copied (not rewritten): provenance for the pack
  let runText = null;
  if (paths.runJson) {
    runText = readFileSync(paths.runJson, 'utf8');
    writeFileSync(join(publishDir, 'run.json'), runText, { mode: 0o644 });
  }

  const files = [
    ['REPORT.md', report, 'operator read, deterministic'],
    ['BRIEF.md', brief, 'derived brief, deterministic'],
  ];
  if (reading && readingAudit?.ok) files.push(['READING.md', reading, `model reading (${readingModel})`]);
  if (runText) files.push(['run.json', runText, 'copy of the cut manifest']);

  const readingStatus = noReading
    ? 'skipped (--no-reading)'
    : readingError
      ? `not generated — ${oneLine(readingError, 220)}`
      : readingAudit?.ok
        ? `written (${readingModel}; audit PASS — ${readingAudit.citations} citation(s))`
        : `rejected (audit FAIL — see READING.rejected.md)`;

  const index = [
    `# FINAL PACK — ${run?.charter ?? 'community'}${run?.runTag ? ` ${run.runTag}` : ''}`,
    '',
    '> **Publication pack, derived at the end of the run.** The forum and chains are',
    '> the authority. `REPORT.md` and `BRIEF.md` are deterministic reads; `READING.md`',
    '> is optional model text and is not an act, verdict, endorsement, consensus, or',
    '> standing. `PACK.md` is the index; it decides nothing.',
    '',
    '## Read in this order',
    '',
    '| file | what it is | status |',
    '|---|---|---|',
    `| \`REPORT.md\` | the operator's morning-after read: members, speech, fence, docket | written (deterministic) |`,
    `| \`BRIEF.md\` | the citation-bound archive brief | ${briefAudit.ok ? `written; audit PASS — ${briefAudit.citations} citation(s)` : `written; **audit FAIL** — ${briefAudit.failures.length} finding(s)`} |`,
    `| \`READING.md\` | optional model reading of the brief | ${readingStatus} |`,
    runText ? '| `run.json` | copy of the cut manifest (provenance, not a new record) | copied |' : '| `run.json` | no manifest at the cut | absent |',
    '',
    '## The cut',
    '',
    '| field | value |',
    '|---|---|',
    `| charter | ${run?.charter ?? '—'} |`,
    `| run | ${run?.runTag ?? '—'}${run?.resumed ? ' (resumed)' : ''} |`,
    `| ended | ${run?.endReason ?? 'no run.json'} |`,
    `| rounds | ${run?.rounds ?? '—'} |`,
    `| turns | ${run?.turns ?? '—'} |`,
    `| tokens | ${run?.tokens ?? '—'} |`,
    `| continued from | ${run?.continuedFrom?.runTag ?? '—'} |`,
    '',
    '## Provenance',
    '',
    '| file | sha256 |',
    '|---|---|',
    ...files.map(([name, text]) => `| \`${name}\` | \`${sha256(text)}\` |`),
    '',
    '## What this pack does not decide',
    '',
    '- It adds no verdict, sanction, endorsement, consensus, or standing.',
    '- The model reading is not a member, a judge, or the record. A failed or rejected',
    '  reading is named above; it is never replaced with prose that pretends to be one.',
    '- `REPORT.md` contains the operator path (`state:` and the audit commands). Remove',
    '  or rewrite that line before public distribution if the path is not yours to share.',
    '- The pack is a reading aid; the forum, the chains, and the auditors remain the proof.',
    '',
    '## Verify',
    '',
    '```bash',
    `node tools/community-brief.mjs <run-dir> --check <run-dir>/publish/BRIEF.md`,
    ...(reading && readingAudit?.ok
      ? [`node tools/community-reading.mjs <run-dir> --check <run-dir>/publish/READING.md`]
      : []),
    '```',
    '',
    `Generated at ${generatedAt}.`,
    '',
  ].join('\n');
  writeFileSync(join(publishDir, 'PACK.md'), index, { mode: 0o644 });

  return {
    dir: publishDir, report, brief, briefAudit, reading, readingAudit,
    readingModel, readingError, readingStatus, run, files,
    index,
  };
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

async function main() {
  const argv = process.argv.slice(2).map((a) => (a === '-o' ? '--out' : a));
  const positionals = [];
  const booleans = new Set(['--no-reading']);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      if (!booleans.has(argv[i])) i += 1;
    } else {
      positionals.push(argv[i]);
    }
  }
  const dir = positionals[0];
  if (!dir) throw new Error('usage: node tools/community-artifacts.mjs <run-dir> [--out DIR] [--no-reading]');
  const pack = await buildPublishPack({
    dir,
    out: argValue(argv, 'out'),
    settingsPath: argValue(argv, 'settings'),
    answerPath: argValue(argv, 'answer') ? resolve(argValue(argv, 'answer')) : null,
    model: argValue(argv, 'model'),
    maxTokens: Number(argValue(argv, 'max-tokens') ?? 1800),
    noReading: argv.includes('--no-reading'),
  });
  process.stdout.write(`community-artifacts: wrote ${pack.dir}\n`);
  process.stdout.write(`  REPORT.md — deterministic\n`);
  process.stdout.write(`  BRIEF.md — ${pack.briefAudit.ok ? 'AUDIT PASS' : 'AUDIT FAIL'} (${pack.briefAudit.citations} citation(s))\n`);
  process.stdout.write(`  READING.md — ${pack.readingStatus}\n`);
  if (!pack.briefAudit.ok) {
    for (const f of pack.briefAudit.failures) process.stdout.write(`  - ${f}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { process.stderr.write(`community-artifacts: ${e?.stack ?? e}\n`); process.exitCode = 1; });
