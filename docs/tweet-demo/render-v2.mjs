#!/usr/bin/env node
// v2 tweet frames — same discipline as render.mjs (every string from the real
// system at render time), with two differences:
//
//   frame 1  the ask      unchanged pipeline; the stock box now shows the same
//                         curl, so the lede's "Same curl" is true on both sides
//   frame 2  the record   NO staged session: the newest live session under
//                         ~/.compact-dsh is audited by the real auditor, a copy
//                         is rewritten, and the real verdict is rendered. The
//                         "never answered" footer line is derived from the
//                         record itself (no approval/decided event present).
//
// Existing render.mjs outputs are untouched: this writes only *-v2.{svg,png}.
// Both rasterize at 1.5x (1620px wide) so the mono text survives a phone.
//
//   node docs/tweet-demo/render-v2.mjs [session-id]
//
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { approvalPlugin, fingerprint } from '../../packages/approval/src/index.js';
import { createAnalyzer } from '../../packages/remote-access/src/analyzer.js';
import { createOperatorPrompter } from '../../tools/operator-answerer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCALE = 1.5;

const COMMAND = 'curl https://api.example.com/v1/data';

/** Terminal-width wrap. Words only — sentence coloring happens above.
 *  `$ `/`# ` lines are never wrapped: they must stay copy-pasteable. */
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
// (same pipeline as render.mjs)
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
    const text = captured.replace(/\nchoice \[1\]: $/, '\n');
    return { text, reason: decision.reason, fingerprint: fp, target };
  });
}

// ---------------------------------------------------------------------------
// frame 2 — the record, from the LIVE session on disk. No staging: the real
// chain file, the real auditor, a copy rewritten, the real verdict.
// ---------------------------------------------------------------------------

function findLiveSession(preferredId) {
  const chainsDir = join(homedir(), '.compact-dsh', 'chains');
  const sessionsRoot = join(homedir(), '.compact-dsh', 'sessions');
  let ids = readdirSync(chainsDir)
    .filter(f => /^session-.+\.chain$/.test(f))
    .map(f => f.replace(/\.chain$/, ''));
  if (preferredId) ids = ids.filter(id => id === preferredId);
  ids = ids
    .map(id => ({ id, m: statSync(join(chainsDir, id + '.chain')).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .map(x => x.id);
  for (const id of ids) {
    for (const ws of readdirSync(sessionsRoot)) {
      const log = join(sessionsRoot, ws, id, 'session.v3.jsonl');
      if (existsSync(log)) {
        return { id, workspace: ws, log, chain: join(chainsDir, id + '.chain') };
      }
    }
  }
  throw new Error('no live session with a log on disk — run one first, or pass a session id');
}

function captureLiveRecord() {
  const s = findLiveSession(process.argv[2]);

  const lines = readFileSync(s.log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const events = lines.filter(l => l.seq !== undefined).length;
  const asks = lines.filter(l => l.type === 'approval/asked').length;
  const decided = lines.some(l => l.type === 'approval/decided');
  const head = readFileSync(s.chain, 'utf8').trim().split('\n')
    .map(l => JSON.parse(l)).at(-1).h;

  const runAudit = (logPath) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'auditor', 'audit.mjs'), logPath, '--chain', s.chain, '--quiet'], {
      encoding: 'utf8',
    });
    return { code: r.status, text: `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd() };
  };

  const clean = runAudit(s.log);
  if (clean.code !== 0) throw new Error(`live session ${s.id} does not conform — pick another session`);

  // display paths exactly as a viewer would type them (real, ~-abbreviated)
  const home = homedir();
  const tilde = (p) => p.startsWith(home) ? '~' + p.slice(home.length) : p;
  const D = tilde(dirname(s.log));
  const C = tilde(s.chain);

  // the same sed anyone would try, on a COPY; displayed commands reproduce
  // this verbatim
  const dir = mkdtempSync(join(tmpdir(), 'tweet-live-'));
  const tampered = join(dir, 'tampered.jsonl');
  copyFileSync(s.log, tampered);
  const before = readFileSync(tampered, 'utf8');
  const rewritten = before.replace('"preset":"workspace-write"', '"preset":"danger-full-access"');
  if (rewritten === before) throw new Error('the flip matched nothing — pass a session id whose log records preset workspace-write');
  writeFileSync(tampered, rewritten);
  const dirty = runAudit(tampered);
  if (dirty.code === 0) throw new Error('tampered audit still conforms — the rewrite did not land');

  const sedLine = `sed -i '0,/"preset":"workspace-write"/s//"preset":"danger-full-access"/' /tmp/tampered.jsonl`;

  // one terminal, four beats: attest → copy → rewrite → caught
  const text = [
    `$ D=${D}`,
    `$ C=${C}`,
    `$ node auditor/audit.mjs "$D/session.v3.jsonl" --chain "$C" --quiet`,
    clean.text,
    `# exit ${clean.code} · chain head ${head.slice(0, 16)}…`,
    ``,
    `$ cp "$D/session.v3.jsonl" /tmp/tampered.jsonl`,
    `$ ${sedLine}`,
    ``,
    `$ node auditor/audit.mjs /tmp/tampered.jsonl --chain "$C" --quiet`,
    dirty.text,
    `# exit ${dirty.code}`,
  ].join('\n');

  return { text, id: s.id, events, asks, decided, head };
}

// ---------------------------------------------------------------------------
// presentation — same look as render.mjs, rendered at SCALE for phones
// ---------------------------------------------------------------------------

const STOCK_ASK = `$ curl https://api.example.com/v1/data
Allow this tool call? [y/N]`;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

function lineClass(line) {
  if (/^\$ |^sed -i/.test(line)) return 'cmd';
  if (/^# exit/.test(line)) return line.includes('exit 0') ? 'good' : 'bad';
  if (/^\s{2}— /.test(line)) return 'key';
  return 'text';
}

function sentenceClass(text) {
  for (const [cls, re] of PHRASES) {
    re.lastIndex = 0;
    if (re.test(text)) return cls;
  }
  return null;
}

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

function mark(line) {
  let html = esc(line);
  for (const [cls, re] of PHRASES) {
    re.lastIndex = 0;
    html = html.replace(re, (m) => `<mark class="${cls}">${m}</mark>`);
  }
  return html;
}

const paint = (body) => layoutBody(body).map(({ t, cls }) => {
  const inner = mark(t);
  return cls === 'text' ? inner : `<span class="${cls}">${inner}</span>`;
}).join('\n');

const MONO = 'DejaVu Sans Mono, monospace';
const SANS = 'DejaVu Sans, sans-serif';

function svgText(x, y, run, size = 13) {
  const r = run ?? { t: '', cls: 'text' };
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${COLORS[r.cls] ?? COLORS.text}">${esc(r.t)}</text>`;
}

function svgTerminal({ x, y, w, title, body, titleColor = '#8b949e', dim = false }) {
  const lines = layoutBody(body).map(r => (dim ? { t: r.t, cls: 'dim' } : r));
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

/** Card wrapper: 1080-wide layout coordinates, rasterized at SCALE. The
 *  scale transform keeps every renderer (and ImageMagick) honest. */
function cardSvg(h, parts) {
  const w = 1080;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * SCALE)}" height="${Math.round(h * SCALE)}" viewBox="0 0 ${Math.round(w * SCALE)} ${Math.round(h * SCALE)}">
  <g transform="scale(${SCALE})">
  <rect width="${w}" height="${h}" fill="#111622"/>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="20" fill="#111622" stroke="#2a3348"/>
  ${parts.join('\n  ')}
  </g>
</svg>
`;
}

/** Tweet 1 v2: the same contrast, but "Same curl" is now true on BOTH sides. */
function buildTweet1Svg(ask) {
  const w = 1080;
  const padX = 36;
  const inner = w - padX * 2;
  const leftW = 340;
  const gap = 20;
  const rightW = inner - leftW - gap - 40;

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
    body: STOCK_ASK, titleColor: '#6e7a96', dim: true,
  }).svg);
  parts.push(`<text x="${padX + leftW + 18}" y="${bodyY + maxTermH / 2}" font-family="${MONO}" font-size="20" font-weight="800" fill="#6e7a96">vs</text>`);
  parts.push(svgTerminal({
    x: padX + leftW + gap + 40, y: bodyY, w: rightW, title: 'bash · attended · gate AG',
    body: ask.text,
  }).svg);

  y = bodyY + maxTermH + 28;
  const caps = [
    ['Rule named', 'Every answer is an envelope: gate, rule ID,', 'cost of yes, lawful exits — not a dead end.'],
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

  return cardSvg(y + 86 + 36, parts);
}

/** Tweet 2 v2: the live session — real chain, real auditor, real verdict. */
function buildTweet2Svg(record) {
  const w = 1080;
  const padX = 36;
  const inner = w - padX * 2;
  const termH = termHeight(record.text);

  let y = 36;
  const parts = [];
  parts.push(`<text x="${padX}" y="${y}" font-family="${MONO}" font-size="12" font-weight="700" letter-spacing="1.5" fill="#6e7a96">TWEET 2 OF 2 · THE EVIDENCE · LIVE SESSION</text>`);
  y += 48;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="34" font-weight="750" fill="#e6edf3">Then I rewrote that session with sed.</text>`);
  y += 44;
  parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="34" font-weight="750" fill="#7ee787">The auditor caught it.</text>`);
  y += 48;
  const lede = record.decided
    ? [
        'No staged frame: the auditor runs on this machine’s live session. Then one recorded',
        'fact is flipped on a copy. Plain JSONL would never tell.',
      ]
    : [
        'No staged frame: the auditor runs on this machine’s live session — its one approval ask',
        'was never answered. Then one recorded fact was flipped on a copy.',
      ];
  for (const l of lede) {
    parts.push(`<text x="${padX}" y="${y}" font-family="${SANS}" font-size="16" fill="#aebbdc">${esc(l)}</text>`);
    y += 24;
  }
  y += 6;

  parts.push(svgTerminal({
    x: padX, y, w: inner, title: `auditor · live session ${record.id.replace(/^session-/, '').slice(0, 8)}…`, body: record.text,
  }).svg);
  y += termH + 28;

  const foot2 = record.decided
    ? 'Anyone who kept the chain head — one string — can prove what changed, years later.'
    : 'No one answered the gate. The ask went on the record anyway — and that record was already evidence.';
  parts.push(`<rect x="${padX}" y="${y}" width="4" height="58" fill="#7ee787"/>`);
  parts.push(`<text x="${padX + 16}" y="${y + 22}" font-family="${SANS}" font-size="15" fill="#aebbdc">The most motivated forger of an agent session is the operator. Even that rewrite fails.</text>`);
  parts.push(`<text x="${padX + 16}" y="${y + 46}" font-family="${SANS}" font-size="15" fill="#aebbdc">${esc(foot2)}</text>`);

  return cardSvg(y + 58 + 36, parts);
}

// ---------------------------------------------------------------------------

const ask = await captureAsk();
const record = captureLiveRecord();

writeFileSync(join(HERE, 'tweet-1-v2.svg'), buildTweet1Svg(ask));
writeFileSync(join(HERE, 'tweet-2-v2.svg'), buildTweet2Svg(record));

for (const n of ['tweet-1-v2', 'tweet-2-v2']) {
  const r = spawnSync('convert', [join(HERE, `${n}.svg`), join(HERE, `${n}.png`)], { encoding: 'utf8' });
  if (r.status !== 0) console.error(`convert ${n}: ${r.stderr ?? 'failed'} (SVG is still valid)`);
}

console.log(`live session: ${record.id} (${record.events} events, ${record.asks} ask(s), ${record.decided ? 'decided' : 'NOT answered'})`);
console.log(`  clean audit exit 0 · tampered exit 1 · chain head ${record.head.slice(0, 16)}…`);
console.log('written (originals untouched):');
console.log('  docs/tweet-demo/tweet-1-v2.{svg,png}   docs/tweet-demo/tweet-2-v2.{svg,png}');
