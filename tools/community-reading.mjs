#!/usr/bin/env node
// community-reading — an OPTIONAL model-authored reading of a community
// archive. It is not a record act, not a verdict, and not the brief.
//
// The deterministic brief (tools/community-brief.mjs) remains the audit and
// the authority. This tool reads ONLY the rendered brief, asks a model for a
// short interpretive reading, and writes READING.md with a machine header
// that names the brief hash, the model, and what the artifact is not. It
// never writes the forum, a chain, or run.json.
//
// Two paths keep it honest even when no model route is available:
//   --prompt-only  print the exact prompt; make no model call.
//   --answer FILE  use a model answer produced elsewhere (offline review).
//   --check FILE   audit an existing reading against the archive.
//
// Usage:
//   node tools/community-reading.mjs docs/runs/agent-tongue -o READING.md
//   node tools/community-reading.mjs docs/runs/agent-tongue --prompt-only
//   node tools/community-reading.mjs docs/runs/agent-tongue --check READING.md
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readBriefSources, renderBrief } from './community-brief.mjs';
import { proxyEnvNotice } from './proxy-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROMPT_VERSION = 'community-reading/v1';

const SYSTEM = `You are a reading assistant for the archive of a live community run.
You are NOT a member, a judge, an auditor, or the record. You did not participate.
The deterministic brief is your only source. Do not use outside knowledge.

Write a concise reading of 500-800 words, with exactly these sections:
## What the record shows
## What remains open
## What this reading does not decide

Rules:
- Every factual claim about a post must cite its fp_n id when the brief gives one.
- Do not invent posts, members, passes, counts, motives, agreements, or quotations.
- Do not use "unanimous", "consensus", "everyone agreed", or "endorsed by all" unless the brief quotes those words from the latest accepted ledger.
- A pass is not a position. Silence is not consent. An attempt that did not land is not a post.
- Do not issue a verdict, finding, sanction, or prediction.
- Separate the brief's statements from your interpretation. Prefer "the brief shows" and "read together, these suggest".
- Do not mention private reasoning or anything the brief does not contain.`;

export function buildReadingPrompt(brief) {
  return {
    version: PROMPT_VERSION,
    system: SYSTEM,
    user: `Read this deterministic brief and write the reading.\n\n${brief}`,
  };
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Deterministic guards over a model-authored reading. They cannot prove the
 *  prose right; they catch the named failure modes: invented citations,
 *  wrong counts, consensus language, silence-as-consent, and verdicts. */
export function auditReading(reading, data) {
  const text = String(reading);
  const failures = [];
  const forum = data.forum ?? [];
  const members = data.members ?? [];
  const checks = data.checks ?? {};
  const ids = new Set(forum.map((p) => p.id));
  const citations = [...new Set([...text.matchAll(/\bfp_\d+\b/g)].map((m) => m[0]))];
  for (const id of citations) if (!ids.has(id)) failures.push(`citation ${id} is not an accepted forum post in the archive`);

  const count = (label, actual) => {
    const patterns = [
      new RegExp(`(\\d+)\\s+${label}`, 'i'),
      new RegExp(`${label}\\s*[:|]?\\s*(\\d+)`, 'i'),
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m && Number(m[1]) !== actual) failures.push(`claims ${m[1]} ${label}; the brief records ${actual}`);
    }
  };
  count('accepted posts?', forum.length);
  count('members?', members.length);
  count('recorded passes?', checks.passes ?? 0);
  count('pass calls?', checks.passCalls ?? 0);
  count('turns?', checks.turnSum ?? 0);

  const ledger = String(data.latestLedger?.text ?? '');
  const consensus = /\b(unanimous|consensus|everyone agreed|all members agreed|endorsed by all)\b/i;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!consensus.test(sentence)) continue;
    if (/\b(no|not|never|without|does not|doesn't|cannot)\b/i.test(sentence)) continue;
    if (consensus.test(ledger)) continue;
    failures.push(`consensus language not in the latest ledger: "${sentence.trim().slice(0, 120)}"`);
  }
  const verdict = /\b(guilty|convicted|sanctioned|liable)\b/i;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (verdict.test(sentence) && !verdict.test(ledger)) {
      failures.push(`verdict language not in the latest ledger: "${sentence.trim().slice(0, 120)}"`);
    }
  }
  for (const m of members) {
    const re = new RegExp(`\\b${escapeRe(m.id)}\\b[^.]{0,160}\\b(silent|silence)\\b`, 'i');
    if (re.test(text) && ((m.passes ?? 0) > 0 || (m.notLanded ?? 0) > 0)) {
      failures.push(`"${m.id}" is called silent, but the brief records ${m.passes ?? 0} pass(es) and ${m.notLanded ?? 0} attempt(s) that did not land; qualify it as accepted posts only`);
    }
  }
  return { ok: failures.length === 0, failures, citations: citations.length };
}

/** A reading names the brief it read by hash. When the archive's brief
 *  no longer renders to that hash, the reading may contradict what the
 *  brief now says — the v2 finding: the reading said "no filing" because
 *  its brief could not see two refused filings. Returns null when the
 *  source still matches (with or without the file's trailing newline —
 *  the CLI hashes the bare brief, the pack hashes the written file). */
export function staleSource(reading, brief) {
  const declared = /sha256 `([0-9a-f]{64})`/.exec(String(reading ?? ''))?.[1] ?? null;
  if (!declared) return 'the reading names no source brief hash — it cannot be checked against the brief';
  const hash = (text) => createHash('sha256').update(text).digest('hex');
  const now = [hash(String(brief)), hash(`${brief}\n`)];
  if (now.includes(declared)) return null;
  return `STALE SOURCE: the reading was made from brief sha256 ${declared.slice(0, 12)}…, but the archive's brief now renders as ${now[0].slice(0, 12)}… — the brief changed since, and the reading may contradict it`;
}

export function renderReading({ body, brief, model, generatedAt = new Date().toISOString() }) {
  const hash = createHash('sha256').update(brief).digest('hex');
  return [
    '# READING — a model-authored reading, not the record',
    '',
    '> **Optional reading, not a record act.** Source: the deterministic brief',
    `> (sha256 \`${hash}\`). Model: \`${model}\` · generated: ${generatedAt} · prompt: \`${PROMPT_VERSION}\`.`,
    '> It adds no verdict, endorsement, consensus, or standing. The forum, chains,',
    '> and brief are the authority. This text may be wrong; it is not citable as an act.',
    '',
    '---',
    '',
    String(body).trim(),
    '',
  ].join('\n');
}

function cleanModelText(text) {
  let s = String(text).trim();
  const fence = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) s = fence[1].trim();
  return s;
}

async function bootRoute(settingsPath, modelOverride) {
  const state = mkdtempSync(join(tmpdir(), 'community-reading-'));
  const savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = state;
  process.env.DSH_TELEMETRY_DISABLED = '1';
  if (settingsPath && existsSync(settingsPath)) copyFileSync(settingsPath, join(state, 'settings.yaml'));
  const configFile = join(state, 'cordis.yml');
  writeFileSync(configFile, '[]\n');
  const { boot, loadOverlayPatches } = await import('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline');
  const { operatorSettingsRows } = await import('./operator-settings.mjs');
  const baseFile = fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve('@deepseek-ai/dsh-base/package.json')));
  const patches = [
    ...loadOverlayPatches('community-reading', baseFile),
    ...operatorSettingsRows({ settingsPath: join(state, 'settings.yaml'), web: false, notice: (m) => process.stderr.write(`community-reading: ${m}\n`) }),
  ];
  const ctx = await boot('community-reading', configFile, patches, (host) => {
    provideCmdline(host, { args: [], exit: () => {} });
  }, pathToFileURL(join(ROOT, 'package.json')).href);
  const adm = ctx.agentDefaultModel ?? ctx.get?.('agentDefaultModel');
  let selection = typeof adm?.currentSelection === 'function' ? adm.currentSelection() : adm;
  if (modelOverride) {
    const [provider, ...rest] = modelOverride.split('/');
    selection = { provider, model: rest.join('/') };
  }
  if (!selection?.provider || !selection?.model) {
    await ctx.fiber.dispose().catch(() => {});
    if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
    throw new Error('no model route: set settings.yaml (COMPACT_READING_SETTINGS) or DEEPSEEK_API_KEY');
  }
  return {
    selection,
    async generate(prompt, maxTokens) {
      const { BlockAssembler, createUserMessage } = await import('@deepseek-ai/dsh-llm');
      const asm = new BlockAssembler();
      let failure = null;
      for await (const chunk of ctx.llm.stream({
        provider: selection.provider,
        model: selection.model,
        system: prompt.system,
        maxTokens,
        purpose: 'community-reading',
        messages: [createUserMessage({
          content: [{ type: 'text', text: prompt.user }],
          source: { kind: 'community-reading', version: PROMPT_VERSION },
        })],
      })) {
        if (chunk?.type === 'finish' && chunk.reason?.kind && chunk.reason.kind !== 'stop') {
          failure = chunk.reason.failure?.message ?? chunk.reason.kind;
        }
        asm.push(chunk);
      }
      if (failure) throw new Error(`model call failed: ${failure}`);
      const msg = asm.message();
      const text = (msg?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('').trim();
      if (!text) throw new Error('model returned no text');
      return text;
    },
    async dispose() {
      await ctx.fiber.dispose().catch(() => {});
      if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
    },
  };
}

/** Produce one reading and its audit. The caller decides where it goes;
 *  this function writes no archive artifact. `answerPath` is the offline
 *  path: no model is called and the header says so. */
export async function generateReading({
  brief, data, answerPath = null, settingsPath = null, model = null, maxTokens = 1800,
}) {
  const prompt = buildReadingPrompt(brief);
  let body;
  let modelLabel = 'answer-file (no model called)';
  if (answerPath) {
    body = cleanModelText(readFileSync(resolve(answerPath), 'utf8'));
  } else {
    const route = await bootRoute(
      settingsPath || process.env.COMPACT_READING_SETTINGS
        || process.env.COMPACT_LIVE_SETTINGS
        || join(homedir(), '.compact-dsh', 'settings.yaml'),
      model,
    );
    try {
      body = cleanModelText(await route.generate(prompt, maxTokens));
      modelLabel = `${route.selection.provider}/${route.selection.model}`;
    } finally {
      await route.dispose();
    }
  }
  const text = renderReading({ body, brief, model: modelLabel });
  return { text, model: modelLabel, audit: auditReading(text, data) };
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

async function main() {
  const argv = process.argv.slice(2).map((a) => (a === '-o' ? '--out' : a));
  const positionals = [];
  const booleans = new Set(['--prompt-only']);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      if (!booleans.has(argv[i])) i += 1;
    } else {
      positionals.push(argv[i]);
    }
  }
  const dir = positionals[0];
  if (!dir) throw new Error('usage: node tools/community-reading.mjs <archive-dir> [-o READING.md] [--check READING.md]');
  const data = readBriefSources(dir);
  const brief = renderBrief(data);
  const checkPath = argValue(argv, 'check');
  if (checkPath) {
    const reading = readFileSync(resolve(checkPath), 'utf8');
    const result = auditReading(reading, data);
    const stale = staleSource(reading, brief);
    if (stale) { result.failures.push(stale); result.ok = false; }
    if (result.ok) {
      process.stdout.write(`community-reading: AUDIT PASS — ${result.citations} citation(s), ${data.forum.length} post(s), ${data.members.length} member(s)\n`);
    } else {
      process.stdout.write(`community-reading: AUDIT FAIL — ${result.failures.length} finding(s)\n`);
      for (const f of result.failures) process.stdout.write(`  - ${f}\n`);
      process.exitCode = 1;
    }
    return;
  }
  const prompt = buildReadingPrompt(brief);
  if (argv.includes('--prompt-only')) {
    process.stdout.write(`${prompt.system}\n\n---\n\n${prompt.user}\n`);
    return;
  }
  const answerPath = argValue(argv, 'answer');
  const maxTokens = Number(argValue(argv, 'max-tokens') ?? 1800);
  // an answer file makes no model call; generating one rides the route
  const proxyNotice = answerPath ? null : proxyEnvNotice();
  if (proxyNotice) process.stderr.write(`community-reading: WARNING: ${proxyNotice}\n`);
  const { text: reading, audit: result } = await generateReading({
    brief, data,
    answerPath: answerPath ? resolve(answerPath) : null,
    settingsPath: process.env.COMPACT_READING_SETTINGS
      || process.env.COMPACT_LIVE_SETTINGS
      || join(homedir(), '.compact-dsh', 'settings.yaml'),
    model: argValue(argv, 'model'),
    maxTokens,
  });
  const outPath = argValue(argv, 'out');
  if (outPath) writeFileSync(resolve(outPath), reading);
  else process.stdout.write(reading);
  if (!result.ok) {
    process.stderr.write(`community-reading: AUDIT FAIL — ${result.failures.length} finding(s)\n`);
    for (const f of result.failures) process.stderr.write(`  - ${f}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { process.stderr.write(`community-reading: ${e?.stack ?? e}\n`); process.exitCode = 1; });
