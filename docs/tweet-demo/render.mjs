#!/usr/bin/env node
// Offline tweet frames — every string comes from the real plugins, never typed.
//
//   frame 1  the ask      approvalPlugin gate + createOperatorPrompter
//   frame 2  the record   real chain + real auditor, then a sed-shaped rewrite
//
// No model, no Docker, no key. Run: node docs/tweet-demo/render.mjs
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { approvalPlugin, fingerprint, canonicalTarget } from '../../packages/approval/src/index.js';
import { createAnalyzer } from '../../packages/remote-access/src/analyzer.js';
import { createOperatorPrompter } from '../../tools/operator-answerer.mjs';
import { extendChain, genesisHash } from '../../packages/record/src/chain.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'frames');

const COMMAND = 'curl https://api.example.com/v1/data';

/** Terminal-width wrap. Words only — sentence coloring happens above. */
function wrap(text, width = 72) {
  return String(text).split('\n').map(line => {
    if (line.length <= width || /^\$ |^# /.test(line)) return line;
    const indent = line.match(/^\s*/)[0];
    const words = line.trim().split(/\s+/);
    const out = [];
    let cur = indent;
    for (const w of words) {
      if (cur.length + (cur === indent ? 0 : 1) + w.length > width && cur.trim() !== '') {
        out.push(cur);
        cur = indent + '  ' + w;
      } else {
        cur += (cur === indent ? '' : ' ') + w;
      }
    }
    if (cur.trim()) out.push(cur);
    return out.join('\n');
  }).join('\n');
}

// ---------------------------------------------------------------------------
// frame 1 — the ask, through the real gate and the real operator prompter
// ---------------------------------------------------------------------------

async function captureAsk() {
  const registered = {};
  const ctx = {
    on: (name, fn) => { registered[name] = fn; },
    emit: () => {},
    inject: (deps, fn) => fn({}),
  };
  const instance = approvalPlugin({ egress: 'none' });
  instance(ctx, {});
  const approval = instance.approval ?? instance;

  // the remote-access analyzer's own extraction — the same routing the
  // composition uses at run time (URL finding → per-host gate)
  const analyzer = createAnalyzer({});
  const finding = analyzer.findings({ name: 'bash', arguments: { command: COMMAND } })
    .find(f => f.target);
  if (!finding) throw new Error('analyzer found no target — frame 1 cannot be honest');

  const agent = { id: 'sess-demo', session: { id: 'sess-demo', header: {} } };
  const target = finding.target;
  const fp = fingerprint('bash', target);

  const decision = await registered['tools/pre-execute'](
    { name: 'bash', arguments: target, agent, callId: 'call-7' },
    async () => { throw new Error('the ask must not fall through'); },
  );
  if (decision?.kind !== 'ask') throw new Error(`expected an ask, got ${JSON.stringify(decision)}`);

  // the real operator prompter, with a stubbed readline that answers "1" (deny)
  let captured = '';
  const output = { write: (s) => { captured += s; } };
  const prompter = createOperatorPrompter({
    input: { isTTY: false, unref() {} },
    output,
    createInterface: () => ({
      on() {},
      close() {},
      question(_q, cb) { cb('1'); },
    }),
  });
  const req = { toolName: 'bash', callId: 'call-7', reason: decision.reason };
  const view = { command: COMMAND, target, fingerprint: fp };

  return prompter(req, view).then((outcome) => {
    if (outcome !== 'rejected') throw new Error('stub answered 1, expected rejected');
    // raw prompter frame (minus the trailing "choice [1]: " cursor).
    // layoutBody() wraps and colors it — never pre-wrap here.
    const text = captured.replace(/\nchoice \[1\]: $/, '\n');
    return { text, reason: decision.reason, fingerprint: fp, target };
  });
}

// ---------------------------------------------------------------------------
// frame 2 — the record: chained session, then the same sed the docs demo uses
// ---------------------------------------------------------------------------

function captureRecord(askReason, fp) {
  const dir = mkdtempSync(join(tmpdir(), 'tweet-record-'));
  const sessionId = 'sess-demo';

  // a session header + one turn: the ask from frame 1, denied, on the record.
  // the flipped preset lives on a SEQ'D event — the header is deployment
  // metadata and is not chained, so rewriting it would not break anything.
  const header = { type: 'session', version: 3, id: sessionId };
  const events = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1, preset: 'workspace-write' } },
    {
      seq: 1, type: 'approval/asked', time: 2,
      data: {
        id: 'a1', callId: 'call-7', toolName: 'bash',
        fingerprint: fp, reason: askReason.split('\n')[0],
      },
    },
    { seq: 2, type: 'approval/decided', time: 3, data: { id: 'a1', outcome: 'rejected' } },
    { seq: 3, type: 'turn/end', time: 4, data: { turn: 1 } },
  ];

  const clean = join(dir, `${sessionId}.jsonl`);
  const chainPath = join(dir, `${sessionId}.chain`);
  writeFileSync(clean, [header, ...events].map(e => JSON.stringify(e)).join('\n') + '\n');
  const links = extendChain(genesisHash(sessionId), 0, events);
  writeFileSync(
    chainPath,
    links.map(l => JSON.stringify({ seq: l.seq, h: l.h })).join('\n') + '\n',
  );
  const head = links.at(-1).h;

  const runAudit = (logPath) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'auditor', 'audit.mjs'), logPath, '--chain', chainPath, '--quiet'], {
      encoding: 'utf8',
    });
    return {
      code: r.status,
      text: `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd(),
    };
  };

  const cleanAudit = runAudit(clean);

  // the docs/demo.md rewrite — one recorded fact flipped on a COPY
  const tampered = join(dir, `${sessionId}.tampered.jsonl`);
  copyFileSync(clean, tampered);
  const before = readFileSync(tampered, 'utf8');
  const rewritten = before.replace('"preset":"workspace-write"', '"preset":"danger-full-access"');
  if (rewritten === before) throw new Error('the sed-shaped rewrite matched nothing — the frame would lie');
  writeFileSync(tampered, rewritten);

  const dirtyAudit = runAudit(tampered);

  const sedLine = `sed -i '0,/"preset":"workspace-write"/s//"preset":"danger-full-access"/' session.v3.jsonl`;
  const auditCmd = (f) => `node auditor/audit.mjs ${f} --chain session.chain --quiet`;

  // one terminal, three beats: attest → rewrite → caught (raw; layoutBody wraps)
  const text = [
    `$ ${auditCmd('session.v3.jsonl')}`,
    cleanAudit.text,
    `# exit ${cleanAudit.code} · chain head ${head.slice(0, 16)}…`,
    ``,
    `$ ${sedLine}`,
    ``,
    `$ ${auditCmd('session.tampered.jsonl')}`,
    dirtyAudit.text,
    `# exit ${dirtyAudit.code}`,
  ].join('\n');

  return {
    text,
    cleanAudit: cleanAudit.text,
    dirtyAudit: dirtyAudit.text,
    sedLine,
    cleanCode: cleanAudit.code,
    dirtyCode: dirtyAudit.code,
    head,
  };
}

// ---------------------------------------------------------------------------
// HTML — one screenshot, two panels, the contrast doing the explaining
// ---------------------------------------------------------------------------
// presentation — one screenshot per tweet, the contrast doing the explaining
// ---------------------------------------------------------------------------

const STOCK_ASK = `Allow this tool call? [y/N]`;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Phrases a reader must catch. Short enough to survive a 68-col wrap. */
const PHRASES = [
  ['key', /Approving materializes an exec-cache entry/g],
  ['key', /replays without re-asking for 24h/g],
  ['key', /across sessions of this runtime/g],
  ['key', /until it lapses or is revoked/g],
  ['key', /This gate's approval is consent, not connectivity/g],
  ['warn', /the command will fail at connect/g],
  ['key', /A session grant changes this gate's answer/g],
  ['key', /not the container's network/g],
  ['key', /Lawful next moves:/g],
  ['good', /auditor: conforming \([^)]*\)/g],
  ['bad', /0 chain \[I-2\] broken-link: record:.*$/g],
  ['bad', /the stored event does not hash to its committed link \([^)]*\)/g],
  ['bad', /it was altered after it was recorded/g],
  ['bad', /auditor: 1 violation\(s\) — the session does not conform/g],
];

const COLORS = {
  text: '#e6edf3', key: '#7ee787', warn: '#f2cc60', good: '#7ee787',
  bad: '#ff7b72', cmd: '#79c0ff', dim: '#6e7a96',
};

/** Line-level class first, then inline phrase class wins. */
function lineClass(line) {
  if (/^\$ |^sed -i/.test(line)) return 'cmd';
  if (/^# exit/.test(line)) return line.includes('exit 0') ? 'good' : 'bad';
  if (/^\s{2}— /.test(line)) return 'key';
  return 'text';
}

/** Classify a sentence (a claim) as a whole — a wrapped claim keeps one color. */
function sentenceClass(text) {
  for (const [cls, re] of PHRASES) {
    re.lastIndex = 0;
    if (re.test(text)) return cls;
  }
  return null;
}

/**
 * Body → [{t, cls}] physical lines. Sentences are wrapped as units and keep
 * their color across the wrap; everything else is classified per line.
 */
function layoutBody(body) {
  const out = [];
  for (const raw of String(body).replace(/\n$/, '').split('\n')) {
    const base = lineClass(raw);
    const indent = raw.match(/^\s*/)[0];
    const trimmed = raw.trim();
    if (base !== 'text' || trimmed === '') {
      for (const t of wrap(raw, 68).split('\n')) out.push({ t, cls: base });
      continue;
    }
    // reason prose: split into sentences (period+space, never mid-URL),
    // color each, wrap each as a unit
    const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
    let cur = indent;
    let curCls = sentenceClass(sentences[0].trim()) ?? 'text';
    const flush = () => { if (cur.trim()) out.push({ t: cur, cls: curCls }); cur = indent; };
    for (const s of sentences) {
      const chunk = s.trim();
      if (!chunk) continue;
      const cls = sentenceClass(chunk) ?? 'text';
      if (cls !== curCls && cur.trim()) flush();
      curCls = cls;
      if (cur === indent) {
        cur += chunk;
      } else if (cur.length + 1 + chunk.length <= 68) {
        cur += ' ' + chunk;
      } else {
        flush();
        cur = indent + '  ' + chunk;
      }
      // a sentence longer than the width wraps at spaces, keeping its color
      while (cur.length > 68) {
        let brk = cur.lastIndexOf(' ', 68);
        if (brk <= indent.length + 2) brk = cur.indexOf(' ', indent.length + 2);
        if (brk < 0) break;
        out.push({ t: cur.slice(0, brk), cls: curCls });
        cur = indent + '  ' + cur.slice(brk + 1);
      }
    }
    flush();
  }
  return out;
}

/** HTML-only: inline phrase emphasis (browsers flow spans correctly). */
function mark(line) {
  let html = esc(line);
  for (const [cls, re] of PHRASES) {
    re.lastIndex = 0;
    html = html.replace(re, (m) => `<mark class="${cls}">${m}</mark>`);
  }
  return html;
}

function paint(body) {
  return layoutBody(body).map(({ t, cls }) => {
    const inner = mark(t);
    return cls === 'text' ? inner : `<span class="${cls}">${inner}</span>`;
  }).join('\n');
}

function terminal(title, body, opts = {}) {
  return `<div class="term ${opts.cls ?? ''}">
    <div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="title">${esc(title)}</span></div>
    <pre>${paint(body)}</pre>
  </div>`;
}

// --- SVG: the actual attachable image, one per tweet -------------------------

const MONO = 'DejaVu Sans Mono, monospace';
const SANS = 'DejaVu Sans, sans-serif';

function svgText(x, y, run, size = 13) {
  const r = run ?? { t: '', cls: 'text' };
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${COLORS[r.cls] ?? COLORS.text}">${esc(r.t)}</text>`;
}

function svgTerminal({ x, y, w, title, body, titleColor = '#8b949e' }) {
  const lines = layoutBody(body);
  const lh = 20;
  const pad = 16;
  const barH = 34;
  const h = barH + pad * 2 + lines.length * lh;
  const texts = lines.map((run, i) => svgText(x + pad, y + barH + pad + 14 + i * lh, run)).join('');
  return { h, svg: `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#0d1117" stroke="#30363d"/>
  <rect x="${x}" y="${y}" width="${w}" height="${barH}" rx="12" fill="#161b22"/>
  <rect x="${x}" y="${y + barH - 12}" width="${w}" height="12" fill="#161b22"/>
  <circle cx="${x + 18}" cy="${y + 17}" r="5" fill="#ff5f57"/>
  <circle cx="${x + 34}" cy="${y + 17}" r="5" fill="#febc2e"/>
  <circle cx="${x + 50}" cy="${y + 17}" r="5" fill="#28c840"/>
  <text x="${x + 68}" y="${y + 21}" font-family="${MONO}" font-size="12" fill="${titleColor}">${esc(title)}</text>
  ${texts}
</g>` };
}

const termHeight = (body) => 34 + 32 + layoutBody(body).length * 20;

/**
 * Tweet 1 image: the contrast. Tiny stock ask vs the Compact envelope.
 */
function buildTweet1Svg(ask) {
  const w = 1080;
  const padX = 36;
  const inner = w - padX * 2;
  const leftW = 240;
  const gap = 20;
  const rightW = inner - leftW - gap - 40;

  // layout: kicker, 2 head lines, 2 lede lines, terminals, 3 caption cards
  const maxTermH = Math.max(termHeight(ask.text), termHeight(STOCK_ASK));
  let y = 36;
  const parts = [];
  parts.push(`<text x="${padX}" y="${y}" font-family="${MONO}" font-size="12" font-weight="700" letter-spacing="1.5" fill="#6e7a96">TWEET 1 OF 2 · THE DECISION</text>`);
  y += 48;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="34" font-weight="750" fill="#e6edf3">Agent gates say y/N.</text>`);
  y += 44;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="34" font-weight="750" fill="#7ee787">The Compact’s gate says what “yes” costs.</text>`);
  y += 48;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="16" fill="#aebbdc">Same curl. Left is a shrug. Right is the rule, the consequence of approving,</text>`);
  y += 24;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="16" fill="#aebbdc">and the lawful exits — all of it before you decide.</text>`);
  y += 30;

  const termY = y;
  parts.push(`<text x="${padX}" y="${termY}" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="1" fill="#6e7a96">PLAIN DSH</text>`);
  parts.push(`<text x="${padX + leftW + gap + 40}" y="${termY}" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="1" fill="#6e7a96">COMPACT-DSH · THE COMPACT ON DSH</text>`);
  const bodyY = termY + 14;
  parts.push(svgTerminal({
    x: padX, y: bodyY, w: leftW, title: 'approval',
    body: STOCK_ASK, titleColor: '#6e7a96',
  }).svg);
  parts.push(`<text x="${padX + leftW + 18}" y="${bodyY + maxTermH / 2}" font-family="${MONO}" font-size="20" font-weight="800" fill="#6e7a96">vs</text>`);
  parts.push(svgTerminal({
    x: padX + leftW + gap + 40, y: bodyY, w: rightW, title: 'bash · attended · gate AG',
    body: ask.text,
  }).svg);

  y = bodyY + maxTermH + 28;
  const caps = [
    ['Rule named', 'Every refusal is an envelope: gate, rule ID,', 'reason, lawful next moves — not a dead end.'],
    ['Informed consent', 'Approving materializes a 24h, cross-session,', 'revocable exec-cache entry. Said first.'],
    ['Honest limits', 'Consent ≠ connectivity. No egress composed →', 'the command will fail at connect. Stated.'],
  ];
  const capW = (inner - 24) / 3;
  caps.forEach(([b, s1, s2], i) => {
    const x = padX + i * (capW + 12);
    parts.push(`<rect x="${x}" y="${y}" width="${capW}" height="86" rx="12" fill="#0d1117" stroke="#2a3348"/>`);
    parts.push(`<text x="${x + 14}" y="${y + 26}" font-family="${SANS}" font-size="14" font-weight="700" fill="#7ee787">${esc(b)}</text>`);
    parts.push(`<text x="${x + 14}" y="${y + 48}" font-family="${SANS}" font-size="13" fill="#aebbdc">${esc(s1)}</text>`);
    parts.push(`<text x="${x + 14}" y="${y + 68}" font-family="${SANS}" font-size="13" fill="#aebbdc">${esc(s2)}</text>`);
  });
  const h = y + 86 + 36;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#111622"/>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="20" fill="#111622" stroke="#2a3348"/>
  ${parts.join('\n  ')}
</svg>
`;
}

function buildTweet2Svg(record) {
  const w = 1080;
  const padX = 36;
  const inner = w - padX * 2;
  const termH = termHeight(record.text);

  let y = 36;
  const parts = [];
  parts.push(`<text x="${padX}" y="${y}" font-family="${MONO}" font-size="12" font-weight="700" letter-spacing="1.5" fill="#6e7a96">TWEET 2 OF 2 · THE EVIDENCE</text>`);
  y += 48;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="34" font-weight="750" fill="#e6edf3">Then I rewrote that session with sed.</text>`);
  y += 44;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="34" font-weight="750" fill="#7ee787">The auditor caught it.</text>`);
  y += 48;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="16" fill="#aebbdc">Plain agent logs are plain JSONL — that rewrite is invisible, forever. Here the</text>`);
  y += 24;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="16" fill="#aebbdc">log is hash-chained: one 64-hex head proves which events were forged, offline.</text>`);
  y += 30;

  parts.push(svgTerminal({
    x: padX, y, w: inner, title: 'auditor · offline · I-7', body: record.text,
  }).svg);
  y += termH + 28;

  parts.push(`<rect x="${padX}" y="${y}" width="4" height="58" fill="#7ee787"/>`);
  parts.push(`<text x="${padX + 16}" y="${y + 22}" font-family="${SANS}" font-size="15" fill="#aebbdc">The most motivated forger of an agent session is the operator. Even that rewrite fails.</text>`);
  parts.push(`<text x="${padX + 16}" y="${y + 46}" font-family="${SANS}" font-size="15" fill="#aebbdc">Anyone who kept the chain head — one string — can prove what changed, years later.</text>`);
  const h = y + 58 + 36;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#111622"/>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="20" fill="#111622" stroke="#2a3348"/>
  ${parts.join('\n  ')}
</svg>
`;
}

function buildHtml({ ask, record }) {
  return `<!doctype html>
<meta charset="utf-8">
<title>The Compact on dsh — tweet cards</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 36px 20px; background: #080a10; color: #e6edf3;
    font: 16px/1.45 ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; align-items: center; gap: 24px;
  }
  .card {
    width: 1080px; background: #111622; border: 1px solid #2a3348; border-radius: 20px;
    padding: 30px 34px 34px; display: flex; flex-direction: column; gap: 16px;
  }
  .kicker {
    font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .12em; text-transform: uppercase; color: #6e7a96;
  }
  h1 {
    margin: 0; font-size: 36px; line-height: 1.12; letter-spacing: -0.025em; font-weight: 750;
  }
  h1 .hl { color: #7ee787; }
  .lede { margin: 0; font-size: 17px; color: #aebbdc; max-width: 72ch; line-height: 1.5; }
  .lede code {
    font: 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #e6edf3; background: #0d1117; padding: 2px 7px; border-radius: 6px;
  }
  .row { display: grid; gap: 16px; align-items: stretch; }
  .row.ask { grid-template-columns: 250px 28px 1fr; }
  .term {
    background: #0d1117; border: 1px solid #30363d; border-radius: 14px; overflow: hidden;
    display: flex; flex-direction: column; min-width: 0;
  }
  .term.stock { opacity: .55; }
  .bar {
    display: flex; align-items: center; gap: 10px; padding: 10px 12px;
    background: #161b22; border-bottom: 1px solid #30363d;
  }
  .dots { display: inline-flex; gap: 6px; }
  .dots i { width: 10px; height: 10px; border-radius: 50%; background: #30363d; }
  .dots i:nth-child(1) { background: #ff5f57; }
  .dots i:nth-child(2) { background: #febc2e; }
  .dots i:nth-child(3) { background: #28c840; }
  .title { font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #8b949e; }
  pre {
    margin: 0; padding: 16px 18px;
    font: 13px/1.6 "DejaVu Sans Mono", monospace;
    color: #e6edf3; white-space: pre-wrap; word-break: break-word;
  }
  .stock pre { font-size: 16px; color: #8b949e; padding: 36px 18px; letter-spacing: .02em; }
  mark { background: transparent; color: inherit; font-weight: 650; }
  mark.key { color: #7ee787; }
  mark.warn { color: #f2cc60; }
  mark.good { color: #7ee787; }
  mark.bad { color: #ff7b72; }
  .key, mark.key { color: #7ee787; }
  .good, mark.good { color: #7ee787; }
  .bad, mark.bad { color: #ff7b72; }
  .cmd { color: #79c0ff; }
  .dim { color: #6e7a96; }
  .vs {
    align-self: center; text-align: center; color: #6e7a96;
    font: 800 22px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .captions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .cap {
    background: #0d1117; border: 1px solid #2a3348; border-radius: 12px; padding: 13px 15px;
  }
  .cap b { display: block; color: #7ee787; font-size: 14px; margin-bottom: 3px; }
  .cap span { color: #aebbdc; font-size: 13.5px; line-height: 1.4; }
  .label {
    font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #6e7a96; margin-bottom: 8px; letter-spacing: .08em; text-transform: uppercase;
  }
  .foot {
    color: #aebbdc; font-size: 15.5px; max-width: 78ch; line-height: 1.5;
    border-left: 3px solid #7ee787; padding-left: 14px; margin: 4px 0 0;
  }
</style>

<!-- ============================== TWEET 1 ============================== -->
<section class="card" id="tweet-1">
  <div class="kicker">tweet 1 of 2 · the decision</div>
  <h1>Agent gates say y/N.<br><span class="hl">The Compact’s gate says what “yes” costs.</span></h1>
  <p class="lede">Same <code>curl</code>. Left is a shrug. Right is the rule, the consequence of approving, and the lawful exits — all of it <em>before</em> you decide.</p>
  <div class="row ask">
    <div>
      <div class="label">plain dsh</div>
      ${terminal('approval', STOCK_ASK, { cls: 'stock' })}
    </div>
    <div class="vs">vs</div>
    <div>
      <div class="label">compact-dsh · the Compact on dsh</div>
      ${terminal('bash · attended · gate AG', ask.text)}
    </div>
  </div>
  <div class="captions">
    <div class="cap"><b>Rule named</b><span>Every refusal is an envelope: gate, rule ID, reason, lawful next moves — not a dead end.</span></div>
    <div class="cap"><b>Informed consent</b><span>Approving materializes a 24h, cross-session, revocable exec-cache entry. The ask says so first.</span></div>
    <div class="cap"><b>Honest limits</b><span>Consent ≠ connectivity. No egress composed → the command will fail at connect. Stated.</span></div>
  </div>
</section>

<!-- ============================== TWEET 2 ============================== -->
<section class="card" id="tweet-2">
  <div class="kicker">tweet 2 of 2 · the evidence</div>
  <h1>Then I rewrote that session with sed.<br><span class="hl">The auditor caught it.</span></h1>
  <p class="lede">Plain agent logs are plain JSONL — that rewrite is invisible, forever. Here the log is hash-chained: one 64-hex head proves which events were forged, offline, with no cooperation from the runtime.</p>
  <div class="row">
    ${terminal('auditor · offline · I-7', record.text, { cls: 'story' })}
  </div>
  <p class="foot">The most motivated forger of an agent session is the operator. Even that rewrite fails.<br>Anyone who kept the chain head — one string — can prove what changed, years later.</p>
</section>
`;
}

// ---------------------------------------------------------------------------

const ask = await captureAsk();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'ask.txt'), layoutBody(ask.text).map(l => l.t).join('\n') + '\n');

const record = captureRecord(ask.reason, ask.fingerprint);
writeFileSync(join(OUT, 'record-story.txt'), layoutBody(record.text).map(l => l.t).join('\n') + '\n');
writeFileSync(join(OUT, 'record-clean.txt'), record.cleanAudit + '\n');
writeFileSync(join(OUT, 'record-tampered.txt'), record.dirtyAudit + '\n');
writeFileSync(join(OUT, 'record-sed.txt'), record.sedLine + '\n');

writeFileSync(join(HERE, 'tweet-cards.html'), buildHtml({ ask, record }));
writeFileSync(join(HERE, 'tweet-1.svg'), buildTweet1Svg(ask));
writeFileSync(join(HERE, 'tweet-2.svg'), buildTweet2Svg(record));

// PNG export when ImageMagick is around — the attachable artifacts
for (const n of ['tweet-1', 'tweet-2']) {
  const r = spawnSync('convert', [join(HERE, `${n}.svg`), join(HERE, `${n}.png`)], { encoding: 'utf8' });
  if (r.status !== 0) console.error(`convert ${n}: ${r.stderr ?? 'failed'} (SVG is still valid)`);
}

console.log(`frames written to ${OUT}`);
console.log(`  ask.txt            ${layoutBody(ask.text).length} lines`);
console.log(`  record-story.txt   clean exit ${record.cleanCode} · tampered exit ${record.dirtyCode}`);
console.log(`images: docs/tweet-demo/tweet-1.{svg,png}  docs/tweet-demo/tweet-2.{svg,png}`);
console.log(`visual: docs/tweet-demo/tweet-cards.html`);
if (record.cleanCode !== 0) console.error('WARN: clean audit did not conform');
if (record.dirtyCode === 0) console.error('WARN: tampered audit still conformed — the rewrite did not land');
