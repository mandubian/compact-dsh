#!/usr/bin/env node
// Tweet demo #2 — the network that asks (the egress mediator, #38 phase 3).
//
// The first demo (docs/tweet-demo) shows the DECISION and the RECORD. This
// thread shows what those cards predate: a network that re-checks consent at
// every connection — by host, by port, by method class, and on a connection
// that is already open. Plain dsh cannot express any of it: its sandbox
// governs file effects only and "network stays unrestricted"
// (@deepseek-ai/dsh-bash-sandbox README).
//
// Nothing on these cards is typed by hand or classified offline. Every
// verdict, status, envelope, grant row and timing comes from capture.mjs — an
// end-to-end run of the real approval + remote-access plugins, the real grant
// store, the real mediator server and real curl — and the render fails if any
// claim a card makes does not hold on this run.
//
//   node docs/tweet-demo-2/render.mjs
//
// Writes only into docs/tweet-demo-2/ — the first demo's files are untouched.
//
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { capture } from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCALE = 1.5;

const run = await capture();

// ---------------------------------------------------------------------------
// presentation — the same look as docs/tweet-demo/render-v2.mjs
// ---------------------------------------------------------------------------

const MONO = 'DejaVu Sans Mono, monospace';
const SANS = 'DejaVu Sans, sans-serif';
const C = {
  text: '#e6edf3', key: '#7ee787', warn: '#f2cc60', bad: '#ff7b72',
  cmd: '#79c0ff', dim: '#6e7a96', mute: '#aebbdc', panel: '#0d1117', line: '#2a3348',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function wrap(line, width) {
  if (line.length <= width || /^\$ /.test(line)) return [line];
  const words = line.split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) { out.push(cur); cur = '  ' + w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

const text = (x, y, s, { size = 16, fill = C.mute, weight = 400, font = SANS, anchor } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ''}>${s}</text>`;

function header(parts, padX, y, eyebrow, white, green, lede) {
  parts.push(text(padX, y, esc(eyebrow), { size: 12, weight: 700, fill: C.dim, font: MONO }).replace('<text ', '<text letter-spacing="1.5" '));
  y += 46;
  parts.push(text(padX, y, esc(white), { size: 34, weight: 750, fill: C.text }));
  y += 44;
  parts.push(text(padX, y, esc(green), { size: 34, weight: 750, fill: C.key }));
  y += 46;
  for (const l of lede) { parts.push(text(padX, y, esc(l))); y += 24; }
  return y + 12;
}

/** A terminal whose lines are coloured by their role. */
function terminal({ x, y, w, title, lines, width = 88 }) {
  const rows = [];
  for (const raw of lines) {
    const role = /^\$ /.test(raw) ? 'cmd' : /^# /.test(raw) ? 'warn' : /^\[EG\//.test(raw) ? 'badge' : /^chunk|^…/.test(raw) ? 'dim' : 'text';
    wrap(raw, width).forEach((t, i) => rows.push({ t, role: role === 'badge' && i > 0 ? 'text' : role }));
  }
  const lh = 21, pad = 16, barH = 34;
  const h = barH + pad * 2 + rows.length * lh;
  const body = rows.map((r, i) => {
    const ty = y + barH + pad + 15 + i * lh;
    if (r.role === 'badge') {
      const m = /^(\[EG\/[a-z-]+\])(.*)$/.exec(r.t);
      return `<text x="${x + pad}" y="${ty}" font-family="${MONO}" font-size="13.5" fill="${C.text}"><tspan fill="${C.warn}">${esc(m[1])}</tspan>${esc(m[2])}</text>`;
    }
    const fill = { cmd: C.cmd, warn: C.warn, dim: C.dim, text: C.text }[r.role];
    return text(x + pad, ty, esc(r.t), { size: 13.5, fill, font: MONO });
  }).join('');
  return { h, svg: `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${C.panel}" stroke="#30363d"/>
  <rect x="${x}" y="${y}" width="${w}" height="${barH}" rx="12" fill="#161b22"/>
  <rect x="${x}" y="${y + barH - 12}" width="${w}" height="12" fill="#161b22"/>
  <circle cx="${x + 18}" cy="${y + 17}" r="5" fill="#ff5f57"/>
  <circle cx="${x + 34}" cy="${y + 17}" r="5" fill="#febc2e"/>
  <circle cx="${x + 50}" cy="${y + 17}" r="5" fill="#28c840"/>
  ${text(x + 68, y + 21, esc(title), { size: 12, fill: '#8b949e', font: MONO })}
  ${body}
</g>` };
}

function card(h, parts) {
  const w = 1080;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * SCALE)}" height="${Math.round(h * SCALE)}" viewBox="0 0 ${Math.round(w * SCALE)} ${Math.round(h * SCALE)}">
  <g transform="scale(${SCALE})">
  <rect width="${w}" height="${h}" fill="#111622"/>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="20" fill="#111622" stroke="${C.line}"/>
  ${parts.join('\n  ')}
  </g>
</svg>
`;
}

const ttlText = (g) => {
  const min = Math.round((g.expiresAt - g.createdAt) / 60000);
  return min % 60 === 0 ? `${min / 60}h` : `${min} min`;
};
const patternText = (p) => p.kind === 'HostAndPort' ? `${p.kind} ${p.value.host}:${p.value.port}` : `${p.kind} ${p.value}`;

// ---------------------------------------------------------------------------
// Card 1 — one grant, every connection re-checked
// ---------------------------------------------------------------------------

function buildCard1() {
  const padX = 40, inner = 1080 - padX * 2;
  const parts = [];
  let y = header(parts, padX, 42,
    'TWEET 1 OF 2 · THE NETWORK THAT ASKS',
    'Plain dsh’s network is a switch: on or off.',
    'The Compact’s asks who, where, and what for.',
    [
      `One approved curl materialized one grant. Then every connection was checked against it`,
      `by the mediator — real plugins, real sockets, real curl. A local origin stands in for the web.`,
    ]);

  const g = run.grant;
  parts.push(`<rect x="${padX}" y="${y}" width="${inner}" height="40" rx="10" fill="${C.panel}" stroke="${C.line}"/>`);
  parts.push(text(padX + 16, y + 26, 'GRANT', { size: 13, fill: C.key, font: MONO }));
  parts.push(text(padX + 78, y + 26,
    esc(`${patternText(g.pattern)} · ${g.methodClass} · ${ttlText(g)} · this session only · revocable`),
    { size: 13, font: MONO }));
  y += 58;

  // each phrase restates what the capture measured for that beat
  const phrase = (b, i) => {
    if (b.rule === 'allowed') return `${b.status} — the origin saw ${b.reachedOrigin.join(', ')}`;
    if (b.rule === 'method-class') return `${b.status} — the origin never saw it: a read grant is not a write grant`;
    if (b.rule === 'no-grant' && b.reachedOrigin.length) return `the origin answered the first hop; the redirect’s second hop was refused`;
    if (b.rule === 'no-grant') return `${b.status} — a new host is a new grant`;
    if (b.rule === 'revoked') return `${b.status} — the refusal names the revocation, with its timestamp`;
    return `${b.status}`;
  };

  const rowH = 58;
  run.beats.forEach((b, i) => {
    const ok = b.rule === 'allowed';
    parts.push(`<rect x="${padX}" y="${y}" width="${inner}" height="${rowH}" rx="12" fill="${C.panel}" stroke="${ok ? '#2ea04340' : '#30363d'}"/>`);
    parts.push(`<circle cx="${padX + 30}" cy="${y + rowH / 2}" r="15" fill="${ok ? '#12351f' : '#3a1518'}"/>`);
    parts.push(text(padX + 30, y + rowH / 2 + 6, ok ? '✓' : '✗', { size: 18, weight: 800, fill: ok ? C.key : C.bad, anchor: 'middle' }));
    parts.push(text(padX + 60, y + 25, esc(`${b.method.padEnd(5)}${b.display}`), { size: 14.5, fill: C.cmd, font: MONO }));
    parts.push(text(padX + 60, y + 46, esc(phrase(b, i)), { size: 13.5 }));
    const badge = ok ? 'grant covers' : `EG/${b.rule}`;
    const bw = 14 + badge.length * 8.2;
    const bx = padX + inner - bw - 16;
    parts.push(`<rect x="${bx}" y="${y + rowH / 2 - 14}" width="${bw}" height="28" rx="14" fill="${ok ? '#12351f' : '#241019'}" stroke="${ok ? '#2ea04340' : '#ff7b7240'}"/>`);
    parts.push(text(bx + bw / 2, y + rowH / 2 + 5, esc(badge), { size: 13, fill: ok ? C.key : C.bad, font: MONO, anchor: 'middle' }));
    y += rowH + 10;
  });

  y += 10;
  parts.push(`<rect x="${padX}" y="${y}" width="3" height="44" fill="${C.dim}"/>`);
  parts.push(text(padX + 14, y + 17, esc('Declared residual: over HTTPS the mediator sees only host:port — it never opens the TLS tunnel,'), { size: 13, fill: C.dim }));
  parts.push(text(padX + 14, y + 37, esc('so a read grant admits any method inside it. Host, port, redirect, TTL and revocation still hold.'), { size: 13, fill: C.dim }));
  y += 44 + 36;

  return card(y, parts);
}

// ---------------------------------------------------------------------------
// Card 2 — revoked mid-download, measured
// ---------------------------------------------------------------------------

function buildCard2() {
  const padX = 40, inner = 1080 - padX * 2;
  const t = run.tunnel;
  const parts = [];
  let y = header(parts, padX, 42,
    'TWEET 2 OF 2 · MID-FLIGHT',
    'I revoked the grant mid-download.',
    `The open connection was closed ${t.closedAfterMs} ms later.`,
    [
      `A tunnel through the mediator (CONNECT — what every https:// request is), streaming ${run.chunkTotal} chunks.`,
      `The grant was revoked in the store at chunk ${t.chunksAtRevoke}; the mediator re-checks live tunnels every ${run.recheckMs / 1000} s.`,
    ]);

  // the download bar: before revoke / between revoke and close / never sent
  const n = run.chunkTotal, gap = 3;
  const segW = (inner - gap * (n - 1)) / n;
  const barY = y + 22;
  for (let i = 0; i < n; i++) {
    const fill = i < t.chunksAtRevoke ? C.key : i < t.chunks ? C.warn : '#1f2633';
    parts.push(`<rect x="${padX + i * (segW + gap)}" y="${barY}" width="${segW}" height="26" rx="3" fill="${fill}"/>`);
  }
  const xRevoke = padX + t.chunksAtRevoke * (segW + gap) - gap / 2;
  const xClose = padX + t.chunks * (segW + gap) - gap / 2;
  parts.push(`<rect x="${xRevoke - 1}" y="${barY - 16}" width="2" height="58" fill="${C.warn}"/>`);
  parts.push(text(xRevoke, barY - 22, 'revoked', { size: 12, fill: C.warn, font: MONO, anchor: 'middle' }));
  parts.push(`<rect x="${xClose - 1.5}" y="${barY - 16}" width="3" height="58" fill="${C.bad}"/>`);
  parts.push(text(xClose + 8, barY + 60, esc(`closed +${t.closedAfterMs} ms · ${t.chunks}/${n} chunks · curl exit ${t.exit} (partial transfer)`), { size: 12.5, fill: C.bad, font: MONO }));
  y = barY + 88;

  const lines = [
    `$ curl -N -p -x $MEDIATOR http://api.example.com:18080/stream`,
    `chunk 1`,
    `…`,
    `chunk ${t.chunks}`,
    `# grant revoked at chunk ${t.chunksAtRevoke} · tunnel closed ${t.closedAfterMs} ms later · curl exit ${t.exit}`,
    `$ curl -x $MEDIATOR http://api.example.com:18080/repos`,
    run.afterEnvelope.split('\n')[0],
  ];
  const term = terminal({ x: padX, y, w: inner, title: 'curl → egress mediator · gate EG', lines });
  parts.push(term.svg);
  y += term.h + 28;

  parts.push(`<rect x="${padX}" y="${y}" width="4" height="70" fill="${C.key}"/>`);
  parts.push(text(padX + 18, y + 20, esc('Plain dsh has nothing to revoke.'), { size: 15, weight: 700, fill: C.text }));
  parts.push(text(padX + 18, y + 44, esc('Its container holds the network itself, so the download simply finishes. Here consent is'), { size: 15 }));
  parts.push(text(padX + 18, y + 66, esc('a live grant, and the one path out keeps checking it.'), { size: 15 }));
  y += 70 + 22;
  parts.push(text(padX, y, esc(
    run.plain.completed
      ? 'Measured on a tunnel. A plain-HTTP response already in flight is not cut — only its next request is refused.'
      : 'Measured on a tunnel; a plain-HTTP response in flight was cut too.'), { size: 13, fill: C.dim }));
  y += 36;

  return card(y, parts);
}

// ---------------------------------------------------------------------------

writeFileSync(join(HERE, 'net-1.svg'), buildCard1());
writeFileSync(join(HERE, 'net-2.svg'), buildCard2());

// rasterize: ImageMagick when present, else the sharp this repo already ships
for (const name of ['net-1', 'net-2']) {
  const svg = join(HERE, `${name}.svg`);
  const png = join(HERE, `${name}.png`);
  const im = spawnSync('convert', ['-density', '96', svg, png], { encoding: 'utf8' });
  if (im.status === 0) continue;
  try {
    const sharp = createRequire(import.meta.url)('sharp');
    await sharp(readFileSync(svg), { density: 144 }).png().toFile(png);
  } catch (error) {
    console.error(`rasterize ${name}: no convert and no sharp (${error.message}) — the SVG is still valid`);
  }
}

console.log('captured from a real run (capture.mjs):');
for (const c of run.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}${c.claim ? '' : ' (declared)'}  ${c.name}`);
console.log(`  tunnel closed ${run.tunnel.closedAfterMs} ms after revoke (${run.tunnel.chunks}/${run.chunkTotal} chunks)`);
console.log('written: docs/tweet-demo-2/net-1.{svg,png}  docs/tweet-demo-2/net-2.{svg,png}');
