// The observatory page — one static HTML document, no framework, no
// build step. It renders three lanes from the SSE feed (the forum, the
// community's acts, the human seat's pending) and answers only what is
// pending. Refresh-safe (the feed replays), honest about silence (an
// empty lane says so).

// the charter and provenance blocks, rendered SERVER-SIDE for the live
// page (both are launch-time facts — the goal, the seats, the tree the
// run rides never change mid-run, so the page ships with them baked in,
// no client round-trip, no feed dependency). Shared by nothing: the
// replay renders the same shapes from its embedded archive.
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function charterBlockHtml(charter) {
  if (!charter?.goal) return '';
  const seats = (charter.members ?? []).map((m) =>
    `<span class="seat"><b>${escHtml(m.id)}</b>${m.model ? ` (${escHtml(m.model.provider)}/${escHtml(m.model.model)})` : ''}${m.bench ? ' · bench' : ''}${m.persona ? ` — ${escHtml(m.persona)}` : ''}</span>`).join('');
  return `<div class="charter"><span class="lbl">THE CHARTER — the goal, verbatim (as seated at launch):</span>\n${escHtml(charter.goal)}${seats ? `<span class="seats">seats — what each member is FOR (the charter's personas, verbatim):</span>${seats}` : ''}</div>`;
}

function provenanceLineHtml(provenance) {
  if (!provenance) return '';
  if (!provenance.commit) return `<div class="prov muted">code: ${escHtml(provenance.note ?? '')}</div>`;
  const repo = provenance.repo ? String(provenance.repo).replace(/^git@github.com:/, 'github.com/').replace(/\.git$/, '') + ' @ ' : '';
  return `<div class="prov muted">code: ${escHtml(repo)}${escHtml(provenance.commit.slice(0, 12))}${provenance.dirty ? ' (DIRTY TREE)' : ''}${provenance.ref ? ` [${escHtml(provenance.ref)}]` : ''}</div>`;
}

export function pageHtml({ charterName, token, charter = null, provenance = null, law = null }) {
  const safeName = String(charterName).replace(/[^a-zA-Z0-9._-]/g, '');
  const charterHtml = charterBlockHtml(charter);
  const provHtml = provenanceLineHtml(provenance);
  // the law the runtime is ACTUALLY serving (law_read's own source),
  // baked server-side for in-place citation resolution: when a member
  // cites R-9 in a live post, the operator clicks it and reads the same
  // clause the member could — no provenance subtleties here, the body
  // embedded is the body in force this very boot
  const lawJs = law && law.clauses && Object.keys(law.clauses).length
    ? `const LAW = ${JSON.stringify({ digest: law.digest ?? null, clauses: law.clauses })};`
    : 'const LAW = null;';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>community observatory — ${safeName}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; margin: 0; background: #111; color: #ddd; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
  header { padding: 10px 16px; background: #1b1b1b; border-bottom: 1px solid #333; flex: none; }
  header b { color: #7fd1ff; }
  header .live { color: #7dff8a; }
  header .dead { color: #ff7d7d; }
  main { display: grid; grid-template-columns: 1.55fr 1fr 1fr 1.15fr; gap: 10px; padding: 10px; flex: 1; min-height: 0; box-sizing: border-box; }
  section { border: 1px solid #333; background: #161616; min-height: 0; display: flex; flex-direction: column; }
  section ul, section #pending { flex: 1; min-height: 0; overflow-y: auto; }
  h2 { font-size: 13px; margin: 0; padding: 8px 10px; background: #202020; border-bottom: 1px solid #333; text-transform: uppercase; letter-spacing: 0.08em; color: #9ab; }
  ul { list-style: none; margin: 0; padding: 6px 10px; font-size: 12.5px; }
  li { padding: 5px 0; border-bottom: 1px dotted #2a2a2a; white-space: pre-wrap; word-break: break-word; }
  li .who { color: #7fd1ff; }
  li .at { color: #666; font-size: 11px; }
  li.empty { color: #666; font-style: italic; }
  /* the forum is the reading surface: posts are blocks, members hold a
     stable color, and the run's gate posts (AGREEMENT / POSITIONS /
     RULING / VERDICTS) carry the emphasis — they are what the run exists
     to produce */
  li.post { padding: 8px 10px; margin: 0 0 8px; background: #1a1f26; border: 1px solid #2a313a; border-left: 3px solid #39424e; }
  li.post .head { display: block; color: #9ab; font-size: 11px; margin-bottom: 4px; }
  li.post .head .who { font-weight: bold; }
  li.post .body { display: block; white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; color: #e6e6e6; }
  li.post.ledger { border-left-color: #ffb46b; background: #211d13; }
  li.post.ledger .gate { color: #ffb46b; font-weight: bold; letter-spacing: 0.06em; }
  li.post .body .cite { color: #7fd1ff; }
  li.post .body b { color: #ffd9a0; }
  /* clause citations, resolvable in place (the live page carries the law
     in force this boot — the same body law_read serves) */
  li.post .body .law { color: #b6a2ff; border-bottom: 1px dotted #b6a2ff; cursor: pointer; }
  .lawpane { display: none; position: fixed; right: 12px; bottom: 12px; width: min(640px, calc(100vw - 24px)); max-height: 60vh; overflow-y: auto; background: #161b21; border: 1px solid #b6a2ff; padding: 10px 12px; font-size: 12px; z-index: 40; }
  .lawpane .lawhead { color: #9ab; margin-bottom: 6px; }
  .lawpane .lawhead b { color: #b6a2ff; }
  .lawpane button { float: right; font: inherit; background: #222; color: #ccc; border: 1px solid #444; cursor: pointer; padding: 1px 8px; }
  .lawpane pre { white-space: pre-wrap; word-break: break-word; color: #e6e6e6; margin: 0; }
  /* the hues are scoped .who.cN deliberately: a bare .cN (0,1,0)
     loses to the generic "li .who" (0,1,1) above and every member would
     render one color — the Copilot finding on this very rule */
  .who.c0 { color: #7fd1ff; } .who.c1 { color: #b6a2ff; } .who.c2 { color: #8be98b; } .who.c3 { color: #ffb46b; }
  .who.c4 { color: #ff9ecb; } .who.c5 { color: #9be5d8; } .who.c6 { color: #e8d76b; } .who.c7 { color: #f2a2a2; }
  .ask { border: 1px solid #a83; background: #241c10; padding: 8px; margin: 8px 10px; font-size: 12.5px; }
  .ask .head { color: #ffb46b; font-weight: bold; }
  .ask .plain { margin: 6px 0; }
  .ask .plain .who { color: #7fd1ff; font-weight: bold; }
  .ask pre.command { background: #111; border: 1px solid #444; padding: 6px; margin: 6px 0; white-space: pre-wrap; word-break: break-all; color: #d8d8d8; font-size: 12px; max-height: none; }
  .ask .target { color: #9ab; font-size: 11.5px; }
  .ask details { margin-top: 6px; }
  .ask details summary { cursor: pointer; color: #886; font-size: 11px; }
  .ask .detail { color: #999; font-size: 11.5px; white-space: pre-wrap; max-height: none; overflow: visible; }
  .ask button { margin-right: 6px; margin-top: 6px; padding: 4px 12px; font: inherit; cursor: pointer; }
  .ask button.approve { background: #1d5c2f; color: #cfe; border: 1px solid #3a7; }
  .ask button.deny { background: #5c1d1d; color: #fcc; border: 1px solid #a55; }
  /* the human's turn, made for a human (#284 made the seat interactive):
     while a floor turn or a question waits for words, the seat widens and
     the composer gets the room — a big text box, the time left, buttons
     that say what they do */
  body.composing main { grid-template-columns: 1.1fr 0.55fr 1.45fr 0.55fr; } // the seat (column 3) takes the room; the changes lane shrinks
  body.composing #seat { border-color: #a83; }
  /* the charter stays one scroll away — the briefing carries the same goal */
  body.composing header .charter { max-height: 4.8em; overflow-y: auto; }
  .left { color: #9ab; font-size: 12px; font-weight: normal; white-space: nowrap; }
  .left.soon { color: #ffd27d; font-weight: bold; }
  .left.now { color: #ff7d7d; font-weight: bold; }
  .ask button.more { font: inherit; font-size: 11.5px; background: #222; color: #c9a86b; border: 1px dashed #665; border-radius: 4px; cursor: pointer; padding: 1px 8px; white-space: nowrap; }
  .ask button.more:hover { border-color: #ffb46b; color: #ffb46b; }
  .ask button.more:disabled { opacity: 0.5; cursor: wait; }
  /* the changes lane (#309): a versioned write shows WHAT CHANGED — path,
     status, who and when, the capped diff in a details block, +/- tinted */
  #changes li { padding: 6px 8px; }
  #changes .path { color: #7fd1ff; word-break: break-all; }
  #changes .status.added { color: #7dff8a; }
  #changes .status.modified { color: #ffd27d; }
  #changes .status.removed { color: #ff7d7d; }
  #changes .meta { color: #666; font-size: 11px; }
  #changes details { margin-top: 4px; }
  #changes details summary { cursor: pointer; color: #8899aa; font-size: 11px; }
  #changes pre.diff { margin: 4px 0 0; white-space: pre-wrap; word-break: break-all; font-size: 11.5px; color: #cccce0; max-height: 40vh; overflow-y: auto; background: #10151b; border: 1px solid #2a313a; padding: 6px; }
  #changes pre.diff .add { color: #7dff8a; }
  #changes pre.diff .del { color: #ff7d7d; }
  /* the decision form (#308): numbered items, the quoted line, the contest,
     radio choices, an optional comment box — the human answers a form in
     minutes where mixed prose costs an hour */
  .ask.form .fitem { border: 1px solid #2a313a; background: #1a1f26; padding: 8px; margin: 8px 0; }
  .ask.form .flabel { color: #e6e6e6; margin-bottom: 4px; }
  .ask.form .flabel b { color: #ffd9a0; }
  .ask.form .fcontest { color: #ff9ecb; font-size: 12px; margin: 4px 0; }
  .ask.form .foptions { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
  .ask.form .fopt { cursor: pointer; padding: 3px 6px; border: 1px solid #2a313a; border-radius: 4px; }
  .ask.form .fopt:hover { border-color: #39424e; background: #20262e; }
  .ask.form textarea { width: 100%; box-sizing: border-box; min-height: 2.6em; background: #111; color: #d8d8d8; border: 1px solid #444; font: inherit; font-size: 12.5px; padding: 6px; resize: vertical; }
  .ask.form .form-send { margin-top: 6px; }
  .formnote { border: 1px dashed #665; background: #1a150c; color: #c9a86b; padding: 6px 8px; margin: 0 0 8px; font-size: 12px; }
  /* the turn fills the seat: the text box takes whatever the briefing leaves */
  .floor { display: flex; flex-direction: column; gap: 8px; font-size: 13px; padding: 10px 12px; min-height: calc(100% - 16px); box-sizing: border-box; }
  .turnhead { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .turnhead .head { font-size: 14px; }
  .turn-tools { display: flex; gap: 8px; align-items: baseline; }
  .floor .told { border: 1px solid #3a3020; background: #1a150c; padding: 6px 8px; margin: 0; }
  .floor .told summary { cursor: pointer; color: #c9a86b; font-size: 12px; }
  .floor .told .detail { max-height: 30vh; overflow-y: auto; margin-top: 6px; color: #bbb; font-size: 12px; }
  .floor .last { font-size: 12px; color: #9ab; }
  /* the round as rows: who, names-you, the headline — a person reads
     these first and opens a post only when they need it */
  .floor .news { border: 1px solid #2a313a; background: #12161b; padding: 6px 8px; }
  .floor .newshead { color: #9ab; font-size: 12px; margin-bottom: 4px; }
  .floor details.nrow { border-top: 1px solid #1f252c; padding: 4px 0; }
  .floor details.nrow:first-of-type { border-top: 0; }
  .floor details.nrow summary { cursor: pointer; display: flex; gap: 8px; align-items: baseline; font-size: 13.5px; padding: 2px 4px; border-radius: 3px; }
  .floor details.nrow summary:hover { background: #182029; }
  .floor details.nrow .who { flex: 0 0 6.5em; overflow: hidden; text-overflow: ellipsis; font-weight: bold; }
  .floor details.nrow .names { background: #4a2a10; color: #ffd9a0; border-radius: 3px; padding: 0 5px; font-size: 11px; font-style: normal; white-space: nowrap; }
  .floor details.nrow .hl { color: #e6e6e6; flex: 1 1 auto; min-width: 0; }
  .floor details.nrow .hl.cut { color: #9a9a9a; font-style: italic; }
  .floor details.nrow .pid { flex: 0 0 auto; color: #666; font-size: 11px; }
  .floor details.nrow .nbody { white-space: pre-wrap; max-height: 40vh; overflow-y: auto; color: #bbb; font-size: 12.5px; margin: 6px 0 2px 1em; }
  .composer input.headline { font: 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0d0d0d; color: #eee; border: 1px solid #665; border-radius: 4px; padding: 6px 10px; }
  .composer input.headline:focus { outline: none; border-color: #ffb46b; }
  li.post .hline { display: block; font-weight: bold; color: #ffd9a0; font-size: 13px; margin: 2px 0 4px; }
  .floor .last pre.command { margin: 4px 0 0; }
  .composer { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; }
  .floor .composer textarea { flex: 1 1 auto; min-height: 12em; }
  .composer label { color: #c9a86b; font-size: 12px; }
  .composer textarea, .question textarea { width: 100%; box-sizing: border-box; min-height: 12em; resize: vertical; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0d0d0d; color: #eee; border: 1px solid #665; border-radius: 4px; padding: 10px 12px; }
  .question:not(.floor) textarea { min-height: 7em; margin-top: 8px; }
  .composer textarea:focus, .question textarea:focus { outline: none; border-color: #ffb46b; box-shadow: 0 0 0 2px rgba(255, 180, 107, 0.15); }
  .composer .meta { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 11.5px; color: #888; }
  .composer .meta input.topic { font: inherit; font-size: 12px; background: #111; color: #ddd; border: 1px solid #444; padding: 3px 6px; width: 16em; }
  .composer .count.over { color: #ff7d7d; font-weight: bold; }
  .acts-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .ask .acts-row button { flex: 1 1 10em; margin: 0; padding: 8px 10px; font-size: 13px; text-align: left; border-radius: 4px; }
  .ask .acts-row button small { display: block; font-size: 11px; opacity: 0.8; margin-top: 2px; }
  .ask .acts-row button:disabled { opacity: 0.4; cursor: not-allowed; }
  .ask .acts-row button.post { background: #1d5c2f; color: #dfe; border: 1px solid #3a7; font-weight: bold; }
  .ask .acts-row button.pass { background: #2a2a2a; color: #ddd; border: 1px solid #555; }
  .ask .acts-row button.say { background: #1d3a5c; color: #def; border: 1px solid #37a; }
  .why { color: #ff9d7d; margin-top: 4px; }
  .keeprow { text-align: right; }
  .ask .keeprow button.keep { margin: 0; padding: 2px 8px; font-size: 11.5px; background: none; color: #9ab; border: 1px dashed #445; border-radius: 4px; }
  .ask .keeprow button.keep:disabled { opacity: 0.4; cursor: not-allowed; }
  .muted { color: #666; }
  .prov { font-size: 11.5px; margin-top: 2px; }
  .charter { margin-top: 6px; padding: 6px 10px; border-left: 3px solid #39424e; background: #161b21; font-size: 12px; color: #cdd6e0; white-space: pre-wrap; word-break: break-word; }
  .charter .lbl { color: #9ab; font-weight: bold; letter-spacing: 0.06em; font-size: 11px; }
  .charter .seats { margin-top: 6px; color: #9ab; font-size: 11.5px; }
  .charter .seat { display: block; margin-top: 2px; color: #b8c2ce; }
  .charter .seats b, .charter .seat b { color: #7fd1ff; }
  header button { font: inherit; font-size: 11.5px; background:#222; color:#ccc; border:1px solid #444; cursor:pointer; padding:2px 8px; }
  header button:hover { border-color:#7fd1ff; color:#7fd1ff; }
  .verdict-allow { color: #7dff8a; }
  .verdict-deny, .verdict-rejected { color: #ff7d7d; }
  /* narrow screens: one column that scrolls as a page, and the seat on top
     while words are owed */
  @media (max-width: 980px) {
    body { height: auto; }
    main, body.composing main { grid-template-columns: 1fr; flex: none; }
    section { min-height: 40vh; }
    body.composing #seat { order: -1; min-height: 85vh; }
  }
</style>
</head>
<body>
<header>
  community observatory — <b>${safeName}</b> ·
  <span id="conn" class="live">live</span> ·
  <span id="runstatus" class="muted">between turns</span> ·
  <span class="muted">the law binds the sovereign: your answers land on the record (D-6)</span>
  <span id="ops" style="float:right">
    <button id="btn-pause" title="drain the current turn, then idle">⏸ pause</button>
    <button id="btn-resume" title="continue from the pause">▶ resume</button>
    <button id="btn-stop" title="finish the current turn, flush, end with its reason">⏹ stop</button>
    <button id="btn-kill" title="cancel the in-flight turn now, flush what exists">✂ kill</button>
  </span>
  ${provHtml}
  ${charterHtml}
  <div id="banner" style="display:none; margin-top:6px; color:#ffd27d; font-weight:bold"></div>
</header>
<main>
  <section id="forum"><h2>the forum</h2><ul id="forum-list"><li class="empty">nothing yet — the community has not spoken</li></ul></section>
  <section id="acts"><h2>the community's acts</h2><ul id="acts-list"><li class="empty">no turns yet</li></ul></section>
  <section id="seat"><h2>the human seat — what waits for you</h2><div id="pending"><div class="ask muted">nothing is waiting</div></div></section>
  <section id="changes"><h2>what changed</h2><ul id="changes-list"><li class="empty">nothing written yet — the workspace is as the charter seeded it</li></ul></section>
</main>
<div id="lawpane" class="lawpane"></div>
<script>
const token = ${JSON.stringify(token)};
${lawJs}
const api = (p, init) => fetch('/' + token + p, init).then(r => r.json());
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
// timestamps arrive as ISO strings from the live feed, but old exports
// embedded epoch milliseconds — slicing a number threw and killed the
// pane it was rendering, so every shape is normalized before the slice
const stamp = (at) => (typeof at === 'number' && Number.isFinite(at) ? new Date(at).toISOString() : String(at ?? ''));

// the forum's reading aids, shared with the replay's renderer: a member
// keeps one color (hash of its name), a session id shows its member name
// (the run tag is per-run machinery, not identity), and the run's GATE
// posts — AGREEMENT / POSITIONS / RULING / VERDICTS — carry the emphasis,
// because they are what the run exists to produce
const memberOf = (s) => String(s ?? '?').replace(/^community-/, '').replace(/-[0-9a-f]{6}$/, '');
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return 'c' + (h % 8); };
const GATE_RE = /^(?:[\\w.-]+ — )?(AGREEMENT|POSITIONS|RULING|VERDICTS):/;
// emphasis inside a post body, applied AFTER escaping so member text can
// never inject markup: fp_ cites and the verdict vocabulary read at a
// glance inside a long ledger post
const hl = (s) => esc(s)
  .replace(/\\b(fp_\\d+)\\b/g, '<span class="cite">$1</span>')
  .replace(/\\b(ENDORSED|AMENDED|REJECTED|CONFIRMED|ACCEPTED|CONTESTED|DISSENT)\\b/g, '<b>$1</b>');

// the law, resolvable in place (the replay's #274 feature, on the live
// page): a clause id the embedded law carries becomes a click that opens
// the clause verbatim in the pane. The embedded body is the one this
// runtime is serving at this boot — law_read's own source, no gap
// between the page and the law. Enforcement codes stay plain.
const lawHl = (s) => LAW
  ? hl(s).replace(/\\b([A-Z]{1,4}-\\d+(?:\\/DYN)?)\\b/g, (m, id) =>
      LAW.clauses[id] != null ? '<span class="law" data-c="' + id + '" onclick="showLaw(\\'' + id + '\\')" title="' + esc(String(LAW.clauses[id]).slice(0, 160)) + '…">' + id + '</span>' : m)
  : hl(s);
const showLaw = (id) => {
  const pane = $('lawpane');
  if (!pane || !LAW || LAW.clauses[id] == null) return;
  pane.innerHTML = '<div class="lawhead"><b>' + id + '</b> — the law in force this boot (digest ' + String(LAW.digest ?? '?').slice(0, 12) + '…; the same body law_read serves; sliced verbatim, R-6)' +
    '<button onclick="$(\\'lawpane\\').style.display=\\'none\\'">close</button></div><pre>' + esc(LAW.clauses[id]) + '</pre>';
  pane.style.display = 'block';
};

const postBlock = (p) => {
  const member = memberOf(p.by);
  const gate = GATE_RE.test(String(p.text ?? ''));
  return { cls: 'post' + (gate ? ' ledger' : ''), html:
    '<span class="head">' + (p.id ? '[' + esc(p.id) + '] ' : '') + '<span class="who ' + colorOf(member) + '">' + esc(member) + '</span>' +
    ' · <span class="at">' + esc(stamp(p.at).slice(11, 19)) + '</span> · ' + esc(p.topic ?? '') +
    (gate ? ' · <span class="gate">LEDGER</span>' : '') + '</span>' +
    (p.headline && p.headline !== String(p.text ?? '').trim() ? '<span class="hline">' + esc(p.headline) + '</span>' : '') +
    '<span class="body">' + lawHl(p.text) + '</span>' };
};

function post(listId, html, { empty = false, cls = '' } = {}) {
  const ul = $(listId);
  const emptyNote = ul.querySelector('.empty');
  if (emptyNote) emptyNote.remove();
  const li = document.createElement('li');
  li.className = empty ? 'empty' : cls;
  li.innerHTML = html;
  ul.prepend(li);
  while (ul.children.length > 200) ul.removeChild(ul.lastChild);
}

let lastPendingSig = null;
// what the forum pane already shows, by post id: the stream and the poll
// both deliver posts, and a reconnect replays — each post renders once,
// in its place (newest first, by its number)
const shownPosts = new Set();
// every post the page has seen, by id: the floor card's rows open the
// full post from here
const postsById = new Map();
const postNo = (id) => Number(/^fp_(\d+)$/.exec(String(id ?? ''))?.[1] ?? NaN);
function showPost(p) {
  if (p.id != null) { postsById.set(p.id, p); if (shownPosts.has(p.id)) return; shownPosts.add(p.id); }
  const block = postBlock({ id: p.id, by: p.by, topic: p.topic, text: p.text, headline: p.headline, at: p.at });
  const ul = $('forum-list');
  const emptyNote = ul.querySelector('.empty');
  if (emptyNote) emptyNote.remove();
  const li = document.createElement('li');
  li.className = block.cls;
  li.innerHTML = block.html;
  const n = postNo(p.id);
  if (Number.isFinite(n)) li.dataset.n = String(n);
  const after = Number.isFinite(n) ? [...ul.children].find((x) => Number(x.dataset.n) < n) : null;
  if (after) ul.insertBefore(li, after); else if (Number.isFinite(n) && ul.children.length && ul.lastChild.dataset.n) ul.appendChild(li); else ul.prepend(li);
  while (ul.children.length > 200) ul.removeChild(ul.lastChild);
}
// the poll's safety net: whatever the forum holds that the pane does not
// show is placed now — a stalled stream can delay the page, never hide a post
function reconcileForum(forum) {
  for (const p of forum?.posts ?? []) showPost(p);
}
const showWhy = (div, reason) => {
  let why = div.querySelector('.why');
  if (!why) { why = document.createElement('div'); why.className = 'why head'; div.appendChild(why); }
  why.dataset.reason = reason;
  why.textContent = 'refused — ' + reason + ' (your words are kept: edit, then press again)';
};
// the time left before a card's timeout (its record carries expiresAt):
// a turn that ran out is an honest silence, so the human sees it coming
const BASE_TITLE = document.title;
// the run's pulse (#309's finding, its human-seat half): a page that shows
// your cards but not the community's motion reads as frozen — the members
// mid-turn are tracked here from the same events the acts lane renders
const working = new Set();
const renderWorking = () => {
  const el = $('runstatus');
  if (!el) return;
  const names = [...working];
  el.textContent = names.length ? '\u2699 working: ' + names.join(', ') : 'between turns'; // no leading dot: the header already renders one
};
const tickLeft = () => {
  document.querySelectorAll('[data-expires]').forEach((el) => {
    const ms = Date.parse(el.dataset.expires) - Date.now();
    if (!Number.isFinite(ms)) { el.textContent = ''; return; }
    const s = Math.max(0, Math.round(ms / 1000));
    el.textContent = s > 0 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' left' : 'timing out…';
    el.classList.toggle('soon', s <= 180 && s > 60);
    el.classList.toggle('now', s <= 60);
  });
};
setInterval(tickLeft, 1000);
const leftHtml = (x) => (x.expiresAt ? '<span class="left" data-expires="' + esc(x.expiresAt) + '"></span>' : '');
// buying more time: a press moves the deadline 10 minutes out — reading
// and thinking take what they take, and the run's patience is the
// operator's to extend while the card waits. The countdown element is
// patched IN PLACE (expiresAt rides no render signature: the poll would
// otherwise rebuild a card under a typing hand just because time was bought)
const MORE_MINUTES = 10;
const moreHtml = () => '<button class="more" title="buy more time — the deadline on this card moves ' + MORE_MINUTES + ' minutes further out">+' + MORE_MINUTES + ' min</button>';
function renderPending(p) {
  // the reconciler rule (#239 follow-up): the 4s poll must never fight the
  // human. If nothing changed, touch NOTHING — an expanded details and a
  // half-typed reply stay exactly as the human left them. When something
  // DID change, rebuild, but carry over what was open and what was typed.
  const sig = JSON.stringify(p.map(x => [x.id, x.kind, x.critical, x.wouldOtherwise, x.headline, x.question, x.options, x.context, x.by, x.detail, x.title, x.items, x.formDraft, x.news]));
  if (sig === lastPendingSig) return;
  lastPendingSig = sig;
  const box = $('pending');
  const saved = {};
  box.querySelectorAll('[data-id]').forEach(el => {
    const d = el.querySelector('details.told') || el.querySelector('details');
    const ta = el.querySelector('textarea');
    const ti = el.querySelector('input.topic');
    const hi = el.querySelector('input.headline');
    const why = el.querySelector('.why');
    const focus = ta && ta === document.activeElement ? [ta.selectionStart, ta.selectionEnd] : null;
    // the floor's rows: which posts the human opened stay open
    const rows = [...el.querySelectorAll('details.nrow[open]')].map((r) => r.dataset.post);
    saved[el.dataset.id] = { open: d ? d.open : false, text: ta ? ta.value : null, focus, rows, ...(ti ? { topic: ti.value } : {}), ...(hi ? { headline: hi.value } : {}), ...(why ? { why: why.dataset.reason } : {}) };
    // a form card keeps every item's state across rebuilds: the chosen
    // radio and the written words, per item index
    if (el.classList.contains('form')) {
      const items = {};
      el.querySelectorAll('.fitem').forEach((fi) => {
        const checked = fi.querySelector('input[type=radio]:checked');
        const fta = fi.querySelector('textarea');
        items[fi.dataset.item] = { choice: checked ? checked.value : null, text: fta ? fta.value : null };
      });
      saved[el.dataset.id].items = items;
    }
  });
  const asks = p.filter(x => x.kind === 'ask');
  const questions = p.filter(x => x.kind === 'question');
  const forms = p.filter(x => x.kind === 'form');
  const floors = p.filter(x => x.kind === 'floor');
  box.innerHTML = '';
  if (!asks.length && !questions.length && !forms.length && !floors.length) {
    box.innerHTML = '<div class="ask muted">nothing is waiting</div>';
  }
  // words are owed: the seat widens, and the tab says so from elsewhere
  document.body.classList.toggle('composing', floors.length + questions.length + forms.length > 0);
  document.title = floors.length ? '● YOUR TURN — ' + BASE_TITLE
    : forms.length ? '● A FORM FOR YOU — ' + BASE_TITLE
    : questions.length ? '● A QUESTION FOR YOU — ' + BASE_TITLE
    : asks.length ? '● AN ASK WAITS — ' + BASE_TITLE : BASE_TITLE;
  for (const a of asks) {
    const div = document.createElement('div');
    div.className = 'ask';
    div.dataset.id = a.id;
    div.innerHTML =
      '<div class="turnhead"><div class="head">APPROVAL ASKS FOR YOU' + (a.critical ? ' · CRITICAL (charter)' : '') + '</div><span class="turn-tools">' + leftHtml(a) + moreHtml(a) + '</span></div>' +
      '<div class="plain">member <span class="who">' + esc(a.by ?? 'unknown') + '</span> wants to run <b>' + esc(a.tool ?? 'a tool') + '</b>' +
        (a.wouldOtherwise ? ' <span class="muted">(would otherwise: ' + esc(a.wouldOtherwise) + ')</span>' : '') + '</div>' +
      (a.commandFull || a.command ? '<pre class="command">' + esc(a.commandFull || a.command) + '</pre>' : '') +
      (a.target ? '<div class="target">target: ' + esc(typeof a.target === 'string' ? a.target : JSON.stringify(a.target)) + '</div>' : '') +
      '<details><summary>the full ask, verbatim (the legal envelope — also on the record)</summary>' +
      '<div class="detail">' + esc(a.detail || a.headline) + '</div></details>' +
      '<button class="approve">approve once</button><button class="deny">deny</button>';
    div.querySelector('.approve').onclick = () => api('/answer/' + encodeURIComponent(a.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ decision: 'approve' }) }).then(() => div.remove()).catch(() => {});
    div.querySelector('.deny').onclick = () => api('/answer/' + encodeURIComponent(a.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ decision: 'deny' }) }).then(() => div.remove()).catch(() => {});
    box.appendChild(div);
    const was = saved[a.id];
    if (was) {
      const d = div.querySelector('details');
      if (d && was.open) d.open = true;
    }
  }
  for (const q of questions) {
    const div = document.createElement('div');
    div.className = 'ask question';
    div.dataset.id = q.id;
    div.innerHTML =
      '<div class="turnhead"><div class="head">A MEMBER ASKS YOU — ' + esc(q.by ?? 'a member') + (q.options ? ' · options: ' + esc(q.options) : '') + '</div><span class="turn-tools">' + leftHtml(q) + moreHtml(q) + '</span></div>' +
      '<div class="detail">' + esc(q.question) + (q.context ? '\\n(context: ' + esc(q.context) + ')' : '') + '</div>' +
      '<textarea placeholder="your reply — it becomes this member\\'s tool result, on its record. Ctrl+Enter sends."></textarea>' +
      '<div class="acts-row"><button class="approve post">Reply<small>returned to the member, on its record</small></button></div>';
    const ta = div.querySelector('textarea');
    const reply = () => {
      if (!ta.value.trim()) return;
      api('/reply/' + encodeURIComponent(q.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ text: ta.value }) }).then(() => { div.remove(); setTimeout(refreshState, 300); }).catch(() => {});
    };
    div.querySelector('.acts-row button').onclick = reply; // the head carries +10 min — the FIRST button is not Reply (#307)
    ta.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); reply(); } };
    box.appendChild(div);
    const wasQ = saved[q.id];
    if (wasQ) {
      const d = div.querySelector('details');
      if (d && wasQ.open) d.open = true;
      if (wasQ.text != null) ta.value = wasQ.text;
      if (wasQ.focus) { ta.focus(); ta.setSelectionRange(wasQ.focus[0], wasQ.focus[1]); }
    } else if (!document.activeElement || document.activeElement === document.body) {
      ta.focus(); // a NEW question takes the cursor — unless the human is typing elsewhere
    }
  }
  // the decision form (#308): several numbered decisions in ONE card — per
  // item the quoted line, the contest, radio choices, an optional comment
  // box. One Submit sends them item by item; the seat validates and a bad
  // answer keeps the card with the reason (nothing the human typed is lost)
  for (const f of forms) {
    const div = document.createElement('div');
    div.className = 'ask form';
    div.dataset.id = f.id;
    let fh = '<div class="turnhead"><div class="head">A FORM FOR YOU — ' + esc(f.by ?? 'a member') + '</div><span class="turn-tools">' + leftHtml(f) + moreHtml(f) + '</span></div>';
    if (f.title) fh += '<div class="plain"><b>' + esc(f.title) + '</b></div>';
    if (f.context) fh += '<div class="detail">' + esc(f.context) + '</div>';
    (f.items ?? []).forEach((item, i) => {
      fh += '<div class="fitem" data-item="' + i + '">';
      fh += '<div class="flabel">' + (i + 1) + '. <b>' + esc(item.label) + '</b></div>';
      if (item.quote) fh += '<pre class="command">the line: ' + esc(item.quote) + '</pre>';
      if (item.contest) fh += '<div class="fcontest">the contest: ' + esc(item.contest) + '</div>';
      if (item.options?.length) {
        fh += '<div class="foptions">' + item.options.map((o) =>
          '<label class="fopt"><input type="radio" name="opt-' + esc(f.id) + '-' + i + '" value="' + esc(o) + '"> ' + esc(o) + '</label>').join('') + '</div>';
      }
      if (item.free || !item.options?.length) {
        fh += '<textarea data-item="' + i + '" placeholder="your words on this item' + (item.options?.length ? ' (optional)' : '') + '"></textarea>';
      }
      fh += '</div>';
    });
    fh += '<div class="acts-row"><button class="approve form-send">Answer &amp; send<small>your answers, item by item, to the member — on its record</small></button></div>';
    div.innerHTML = fh;
    const send = () => {
      const answers = [...div.querySelectorAll('.fitem')].map((fi) => {
        const checked = fi.querySelector('input[type=radio]:checked');
        const ta = fi.querySelector('textarea');
        return { choice: checked ? checked.value : '', text: ta ? ta.value : '' };
      });
      api('/form/' + encodeURIComponent(f.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ answers }) }).then((r) => {
        // a validation refusal (a missing choice) keeps the card and every
        // filled item, and names the offending item — the human fixes that
        // one and presses again
        if (r && r.error) { showWhy(div, r.error); return; }
        div.remove();
        setTimeout(refreshState, 300);
      }).catch(() => {});
    };
    div.querySelector('button.form-send').onclick = send;
    box.appendChild(div);
    const wasForm = saved[f.id];
    if (wasForm?.items) {
      div.querySelectorAll('.fitem').forEach((fi) => {
        const was = wasForm.items[fi.dataset.item];
        if (!was) return;
        if (was.choice != null) {
          const r = fi.querySelector('input[type=radio][value="' + was.choice.replace(/"/g, '&quot;') + '"]');
          if (r) r.checked = true;
        }
        const ta = fi.querySelector('textarea');
        if (ta && was.text != null) ta.value = was.text;
      });
    }
  }
  // the floor card: a HUMAN member's turn. What the community told the
  // member rides verbatim in its own scroll box (the first turn's is the
  // whole briefing — it must not push the words off the screen), the
  // member's own last result above it, then the composer: a big text box,
  // the topic, a live count against the forum's limits, and three buttons
  // that say what they do. POST publishes the words verbatim as forum_post
  // on the topic; PASS records them as the reason for silence; SAY puts
  // them on the member's chain and ends the turn. The buttons speak the
  // member's act, not the operator's.
  for (const f of floors) {
    const div = document.createElement('div');
    div.className = 'ask question floor';
    div.dataset.id = f.id;
    const first = /^You are "/.test(f.framing || '');
    // the round's posts, one row each: who, whether it names you, the
    // headline — open a row for the full post. The verbatim text the
    // community sent stays one click away, folded, below the rows.
    const news = Array.isArray(f.news) ? f.news : [];
    const rowsHtml = news.length
      ? '<div class="news"><div class="newshead">this round: ' + news.length + ' post' + (news.length === 1 ? '' : 's') + ', one line each — open a row for the full post</div>' +
        news.map((n) => {
          const full = postsById.get(n.id);
          const cut = !full?.headline && / …$/.test(n.headline || '');
          return '<details class="nrow" data-post="' + esc(n.id) + '"><summary>' +
            '<span class="who ' + colorOf(n.by) + '">' + esc(n.by) + '</span>' +
            '<span class="hl' + (cut ? ' cut' : '') + '"' + (cut ? ' title="no headline — the first words of the post"' : '') + '>' +
              (n.namesYou ? '<span class="names">names you</span> ' : '') + esc(n.headline) + '</span>' +
            '<span class="pid">' + esc(n.id) + '</span></summary>' +
            '<div class="nbody"' + (full ? ' data-filled="1">' + lawHl(full.text) : '>(this post is in the forum pane)') + '</div></details>';
        }).join('') + '</div>'
      : '';
    const needsHead = f.headlineRequired === true;
    div.innerHTML =
      '<div class="turnhead"><div class="head">YOUR TURN ON THE FLOOR — you are <span class="who">' + esc(f.member ?? f.by ?? 'the human member') + '</span></div><span class="turn-tools">' + leftHtml(f) + moreHtml(f) + '</span></div>' +
      (f.lastResult ? '<div class="last">your last act, as the record returned it:<pre class="command">' + esc(f.lastResult) + '</pre></div>' : '') +
      (f.formDraft ? '<div class="formnote">your answers to "' + esc(f.formDraft.title) + '" are drafted in the box below — posting them makes them forum-official, under your name (edit freely, or clear it and write something else)</div>' : '') +
      rowsHtml +
      '<details class="told"' + (f.lastResult || news.length ? '' : ' open') + '><summary>' + (first ? 'your briefing — the goal, the community, the law (first turn)' : news.length ? 'the full text the community sent you this round' : 'what the community told you this round') + '</summary>' +
      '<div class="detail">' + esc(f.framing || '(no framing)') + '</div></details>' +
      '<div class="composer">' +
        '<label for="hl-' + esc(f.id) + '">headline — one sentence, what you conclude' + (needsHead ? ' (needed when your post is longer than one line of 20 words)' : ' (optional)') + '</label>' +
        '<input class="headline" id="hl-' + esc(f.id) + '" maxlength="200" placeholder="the line the others read first">' +
        '<label for="ta-' + esc(f.id) + '">your words — posted verbatim, under your name</label>' +
        '<textarea id="ta-' + esc(f.id) + '" placeholder="Write here. Ctrl+Enter posts to the forum."></textarea>' +
        '<div class="meta"><span>topic <input class="topic" value="' + esc(f.defaultTopic ?? '') + '" placeholder="the charter floor"></span>' +
        '<span class="count"></span></div>' +
        '<div class="acts-row">' +
          '<button class="approve post">Post &amp; end turn<small>published verbatim, under your name</small></button>' +
          '<button class="deny pass">Pass<small>no post — your words are the recorded reason; ends the turn</small></button>' +
          '<button class="say">Say &amp; end turn<small>on your own record only, not posted</small></button>' +
        '</div>' +
        '<div class="keeprow"><button class="keep" title="post, then this card comes back with the result — to post again">post &amp; keep the floor</button></div>' +
      '</div>';
    const ta = div.querySelector('textarea');
    const ti = div.querySelector('input.topic');
    const hi = div.querySelector('input.headline');
    // a row opens its full post from the page's own forum, even when the
    // post reached the page after the card was built
    div.querySelectorAll('details.nrow').forEach((r) => {
      r.ontoggle = () => {
        const nb = r.querySelector('.nbody');
        const full = postsById.get(r.dataset.post);
        if (r.open && full && nb.dataset.filled !== '1') { nb.innerHTML = lawHl(full.text); nb.dataset.filled = '1'; }
      };
    });
    const count = div.querySelector('.count');
    const buttons = div.querySelectorAll('.acts-row button, .keeprow button');
    // the forum's own limits (a post ≤ 8000, a pass reason ≤ 2000) — the
    // seat refuses past them; the count says so before the press does
    const recount = () => {
      const n = ta.value.length;
      count.textContent = n + ' chars · post ≤ 8000 · pass ≤ 2000';
      count.classList.toggle('over', n > 8000);
      buttons.forEach((b) => { b.disabled = !ta.value.trim(); });
    };
    ta.oninput = recount;
    const send = (act, keep) => {
      if (!ta.value.trim()) return;
      api('/floor/' + encodeURIComponent(f.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ act, text: ta.value, topic: ti.value, ...(act === 'post' && hi.value.trim() ? { headline: hi.value } : {}), keep: keep === true }) }).then((r) => {
        // a refusal (an oversized post, a bad topic) keeps the card and the
        // words, and says why: the turn is still pending, and a card removed
        // here never came back (the reconciler saw nothing change)
        if (r && r.error) { showWhy(div, r.error); return; }
        div.remove();
        setTimeout(refreshState, 300); // the post is on the forum: show it now, not at the next poll
      }).catch(() => {});
    };
    div.querySelector('.approve').onclick = () => send('post');
    div.querySelector('.deny').onclick = () => send('pass');
    div.querySelector('.say').onclick = () => send('say');
    div.querySelector('.keep').onclick = () => send('post', true);
    ta.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send('post'); } };
    box.appendChild(div);
    const wasF = saved[f.id];
    if (wasF) {
      const d = div.querySelector('details.told');
      for (const id of wasF.rows || []) { const r = div.querySelector('details.nrow[data-post="' + id + '"]'); if (r) r.open = true; }
      if (wasF.headline != null) hi.value = wasF.headline;
      else if (f.formDraft?.headline) hi.value = f.formDraft.headline;
      if (d && wasF.open === false) d.open = false;
      if (d && wasF.open === true) d.open = true;
      if (wasF.text != null) ta.value = wasF.text;
      else if (f.formDraft) ta.value = f.formDraft.text; // the form's answers, drafted for the human's own post
      if (wasF.topic != null) ti.value = wasF.topic;
      if (wasF.why) showWhy(div, wasF.why);
      if (wasF.focus) { ta.focus(); ta.setSelectionRange(wasF.focus[0], wasF.focus[1]); }
    } else if (f.formDraft) {
      ta.value = f.formDraft.text;
      if (f.formDraft.headline) hi.value = f.formDraft.headline;
    } else if (!document.activeElement || document.activeElement === document.body) {
      // a NEW turn takes the cursor — unless the human is typing elsewhere
      ta.focus();
    }
    recount();
  }
  tickLeft(); // the countdowns, at once — not a second after the rebuild
}

async function op(path, body) {
  return api(path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body || {}) })
    .then(r => { renderBanner(r.controls); }).catch(() => {});
}
$('btn-pause').onclick = () => op('/pause');
$('btn-resume').onclick = () => op('/resume');
$('btn-stop').onclick = () => { if (window.confirm('Stop the community gracefully? The current turn drains and flushes; the run ends with its reason.')) op('/stop', {mode:'graceful'}); };
$('btn-kill').onclick = () => { if (window.confirm('KILL the community now? The in-flight turn is cancelled; what the record holds is flushed.')) op('/stop', {mode:'now'}); };

// buying more time: one press buys +10 minutes on ONE card — the seat
// moves the real deadline (its timeout rearms with it) and answers with
// the new expiry, which patches the countdown in place. The poll's
// signature never sees expiresAt, so a rebuild cannot clobber a card the
// human is mid-thought on just because time was bought.
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('button.more');
  if (!btn) return;
  const card = btn.closest('[data-id]');
  if (!card) return;
  btn.disabled = true;
  api('/extend/' + encodeURIComponent(card.dataset.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ minutes: MORE_MINUTES }) })
    .then((r) => {
      if (!r || r.error) { btn.disabled = false; return; }
      const left = card.querySelector('[data-expires]');
      if (left) left.dataset.expires = r.expiresAt;
      tickLeft();
      btn.textContent = '+' + MORE_MINUTES + ' ✓';
      setTimeout(() => { btn.textContent = '+' + MORE_MINUTES + ' min'; btn.disabled = false; }, 1500);
    })
    .catch(() => { btn.disabled = false; });
});

function renderBanner(controls) {
  const b = $('banner');
  if (!controls) { b.style.display = 'none'; return; }
  if (controls.stopMode) { b.textContent = 'STOPPING (' + controls.stopMode + ') — the run ends with its reason'; b.style.display = 'block'; }
  else if (controls.paused) { b.textContent = 'PAUSED — the community waits for you (the current turn drained; nothing new will start)'; b.style.display = 'block'; }
  else b.style.display = 'none';
}

// the stream, watched: every event carries a sequence number (seen ones
// are skipped, so a replay never doubles a line), the server pings every
// 15s, and a stream silent for 45s is replaced — resuming after the last
// event seen. A tunnel that silently drops the stream can no longer
// freeze the page: it says "reconnecting…" and catches up by itself.
let es = null;
let lastSeq = 0;
let lastHeard = Date.now();
const STREAM_SILENCE_MS = 45000;
function connect() {
  es = new EventSource('/' + token + '/events' + (lastSeq > 0 ? '?since=' + lastSeq : ''));
  es.onopen = () => { lastHeard = Date.now(); $('conn').textContent = 'live'; $('conn').className = 'live'; };
  es.onerror = () => { $('conn').textContent = 'reconnecting…'; $('conn').className = 'dead'; };
  es.addEventListener('ping', () => { lastHeard = Date.now(); });
  es.onmessage = onEvent;
}
setInterval(() => {
  if (Date.now() - lastHeard < STREAM_SILENCE_MS) return;
  try { es.close(); } catch { /* already closed */ }
  $('conn').textContent = 'reconnecting…'; $('conn').className = 'dead';
  lastHeard = Date.now();
  connect();
}, 5000);
function onEvent(m) {
  lastHeard = Date.now();
  let e; try { e = JSON.parse(m.data); } catch { return; }
  if (e.seq != null) { if (e.seq <= lastSeq) return; lastSeq = e.seq; }
  const at = '<span class="at">' + esc(stamp(e.at).slice(11, 19)) + '</span> ';
  switch (e.type) {
    case 'hello': break;
    case 'forum-post':
      showPost(e);
      break;
    case 'forum-pass':
      post('acts-list', at + '<span class="who">' + esc(e.by ?? '?') + '</span> passed — not a post: ' + esc(e.reason));
      break;
    case 'turn':
      working.add(e.member ?? '?');
      renderWorking();
      post('acts-list', at + '<span class="who">' + esc(e.member) + '</span> takes a turn' + (e.bench ? ' (bench)' : ''));
      break;
    case 'turn-done':
      working.delete(e.member ?? '?');
      renderWorking();
      post('acts-list', at + '<span class="who">' + esc(e.member) + '</span> finished turn ' + esc(e.turns) + ' — flushed to its chain', {});
      break;
    case 'file-change': {
      const d = (e.diff ?? []).map((l) => l.startsWith('+') ? '<span class="add">' + esc(l) + '</span>' : l.startsWith('-') ? '<span class="del">' + esc(l) + '</span>' : esc(l)).join('\\n');
      post('changes-list',
        '<span class="path">' + esc(e.path ?? '?') + '</span> <span class="status ' + esc(e.status ?? '') + '">' + esc(e.status ?? '') + '</span>' +
        '<div class="meta">by <span class="who">' + esc(e.member ?? '?') + '</span>' + (e.round != null ? ' · round ' + esc(e.round) : '') + '</div>' +
        '<details><summary>' + (e.diff?.length ?? 0) + ' diff line(s), capped at 120</summary><pre class="diff">' + d + '</pre></details>');
      break;
    }
    case 'bench-wake':
      post('acts-list', at + '⚖ bench <span class="who">' + esc(e.member) + '</span> woken for ' + esc(e.caseId));
      break;
    case 'ask-seen':
      post('acts-list', at + 'approval ask: ' + esc(short(e.headline, 140)) + ' → ' + esc(e.to));
      break;
    case 'ask-posed':
      post('acts-list', at + '⏳ waiting for the human: ' + esc(short(e.headline, 140)));
      break;
    case 'ask-decided':
      post('acts-list', at + '✓ the human ' + (e.decision === 'approve' ? 'APPROVED' : 'DENIED') + ' the ask' , {});
      break;
    case 'form-posed':
      post('acts-list', at + '\u23f3 a decision form waits for you: ' + esc(short(e.title ?? '', 140)));
      break;
    case 'form-answered':
      post('acts-list', at + '\u2713 the human answered the form', {});
      break;
    case 'form-timeout':
      post('acts-list', at + 'the form timed out \u2014 the honest no-answer, counted', {});
      break;
    case 'form-cancelled':
      post('acts-list', at + 'the form was withdrawn (the run is stopping) \u2014 no answer', {});
      break;
    case 'ask-timeout':
      post('acts-list', at + '⏱ an ask timed out — refused, fail closed');
      break;
    case 'question-posed':
      post('acts-list', at + '❓ <span class="who">' + esc(e.by) + '</span> asks the human: ' + esc(short(e.headline, 140)));
      break;
    case 'question-answered':
      post('acts-list', at + '✓ the human replied to ' + esc(e.by));
      break;
    case 'question-timeout':
      post('acts-list', at + '⏱ a question timed out — the honest no-answer');
      break;
    case 'floor-posed':
      post('acts-list', at + '🗣 <span class="who">' + esc(e.member ?? '?') + '</span> — a HUMAN member\\'s turn waits on the floor card');
      break;
    case 'floor-acted':
      post('acts-list', at + '✓ <span class="who">' + esc(e.member ?? e.by ?? 'the human member') + '</span> ' +
        (e.act === 'post' ? 'POSTED on the floor' : e.act === 'pass' ? 'PASSED (recorded silence)' : 'SPOKE on its own chain'));
      break;
    case 'floor-timeout':
      post('acts-list', at + '⏱ a floor turn timed out — the honest silence, no act performed');
      break;
    case 'pending-extended':
      post('acts-list', at + '⏱ the human bought more time — the ' + esc(e.kind ?? 'pending') + ' card waits until ' + esc(stamp(e.expiresAt).slice(11, 19)));
      break;
    case 'floor-cancelled':
      post('acts-list', at + '⏹ <span class="who">' + esc(e.member ?? e.by ?? 'the human member') + '</span> — the floor turn was withdrawn: the run is stopping (no act)');
      break;
    case 'question-cancelled':
      post('acts-list', at + '⏹ a question from ' + esc(e.by ?? 'a member') + ' was withdrawn — the run is stopping');
      break;
    case 'ask-cancelled':
      post('acts-list', at + '⏹ an ask was withdrawn and denied — the run is stopping (fail closed)');
      break;
    case 'notice':
      post('acts-list', at + 'notice to <span class="who">' + esc(e.to) + '</span>: ' + esc(short(e.summary, 180)),
        {});
      break;
    case 'operator-pause':
      post('acts-list', at + '⏸ <span class="who">the operator</span> paused the community');
      break;
    case 'operator-resume':
      post('acts-list', at + '▶ <span class="who">the operator</span> resumed the community');
      break;
    case 'operator-stop':
      post('acts-list', at + (e.mode === 'now'
        ? '✂ <span class="who">the operator</span> KILLED the run (immediate — the in-flight turn cancelled)'
        : '⏹ <span class="who">the operator</span> stopped the run (graceful — the current turn drains)'));
      break;
    case 'auto-pause':
      post('acts-list', at + '⏸ AUTO-PAUSED (divergence: ' + esc(e.why) + ') — awaiting the Principal');
      break;
    case 'auto-stop':
      post('acts-list', at + '⏹ the fence AUTO-STOPPED the run (divergence: ' + esc(e.why) + ') — nobody could have resumed it');
      break;
    case 'end':
      working.clear();
      renderWorking();
      post('acts-list', at + '■ THE RUN ENDS — ' + esc(e.reason));
      break;
    default: break;
  }
}
connect();

// poll the seat's pending and the forum (SSE announces; the poll is the
// reconciler — a page opened mid-ask sees it without waiting for an event,
// and a post the stream missed still lands)
const refreshState = () => api('/state').then(s => { reconcileForum(s.forum); renderPending(s.pending || []); renderBanner(s.controls); }).catch(() => {});
setInterval(refreshState, 4000);
refreshState();
</script>
</body>
</html>
`;
}

// The replay view (#215): a finished run, rendered read-only from its
// archive — the same three lanes, the same style, no seat and no buttons.
// `data` is the archive object (run manifest, full forum, the members'
// ordered timeline); the tools embed it as JSON over the __DATA__ mark.
export function replayPageHtml({ charterName, data }) {
  // embedded HERE, verbatim: template interpolation has no $-sequence
  // semantics, so archived shell commands ($W, $$, $'…) cannot corrupt the
  // data — a String.replace('__DATA__', json) replacement DID (the Copilot
  // finding on #245): $& re-inserts the match, $' the tail, and the
  // exported HTML broke exactly where members wrote shell. One embed site,
  // in the renderer both tools share.
  const safeName = String(charterName).replace(/[^a-zA-Z0-9._-]/g, '');
  const embedded = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>community replay — ${safeName}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; margin: 0; background: #111; color: #ddd; }
  header { padding: 10px 16px; background: #1b1b1b; border-bottom: 1px solid #333; }
  header b { color: #7fd1ff; }
  header .meta { color: #9ab; font-size: 12px; }
  header .muted { color: #666; font-size: 11.5px; }
  .charter { margin-top: 6px; padding: 6px 10px; border-left: 3px solid #39424e; background: #161b21; font-size: 12px; color: #cdd6e0; white-space: pre-wrap; word-break: break-word; }
  .charter .lbl { color: #9ab; font-weight: bold; letter-spacing: 0.06em; font-size: 11px; }
  .charter .seats { margin-top: 6px; color: #9ab; font-size: 11.5px; }
  .charter .seat { display: block; margin-top: 2px; color: #b8c2ce; }
  .charter .seats b, .charter .seat b { color: #7fd1ff; }
  main { display: grid; grid-template-columns: 1.9fr 1fr; gap: 10px; padding: 10px; height: calc(100vh - 74px); box-sizing: border-box; }
  section { border: 1px solid #333; background: #161616; min-height: 0; display: flex; flex-direction: column; }
  h2 { font-size: 13px; margin: 0; padding: 8px 10px; background: #202020; border-bottom: 1px solid #333; text-transform: uppercase; letter-spacing: 0.08em; color: #9ab; }
  .hint { color: #667; font-size: 11px; padding: 4px 10px 0; margin: 0; }
  ul { list-style: none; margin: 0; padding: 6px 10px; font-size: 12.5px; overflow-y: auto; flex: 1; min-height: 0; }
  li { padding: 6px 0; border-bottom: 1px dotted #2a2a2a; white-space: pre-wrap; word-break: break-word; }
  li .who { color: #7fd1ff; }
  li .at { color: #666; font-size: 11px; }
  li.act { color: #bbb; font-size: 12px; }
  li.pass { color: #b8e986; font-size: 12px; }
  li.pass-call { color: #8e9b8e; font-size: 12px; }
  li.pass-refused { color: #ff9e9e; font-size: 12px; }
  li.notice { color: #ffb46b; font-size: 12px; }
  li.empty { color: #666; font-style: italic; }
  /* the forum is the reading surface: one block per landed post, a stable
     color per member, and the run's gate posts (AGREEMENT / POSITIONS /
     RULING / VERDICTS) carry the emphasis — they are the records the run
     exists to produce */
  li.post { padding: 8px 10px; margin: 0 0 8px; background: #1a1f26; border: 1px solid #2a313a; border-left: 3px solid #39424e; }
  li.post .head { display: block; color: #9ab; font-size: 11px; margin-bottom: 4px; }
  li.post .head .who { font-weight: bold; }
  li.post .body { display: block; white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; color: #e6e6e6; }
  li.post .hline { display: block; font-weight: bold; color: #ffd9a0; font-size: 13px; margin: 2px 0 4px; }
  li.post.ledger { border-left-color: #ffb46b; background: #211d13; }
  li.post.ledger .gate { color: #ffb46b; font-weight: bold; letter-spacing: 0.06em; }
  li.post .body .cite { color: #7fd1ff; }
  li.post .body b { color: #ffd9a0; }
  /* clause citations: resolvable in place — click opens the clause's own
     text in the pane (sliced from the body, R-6); hover carries a short
     preview. Ids the body does not carry stay plain: a tooltip pretending
     an enforcement code is law would be the false answer, named. */
  li.post .body .law { color: #b6a2ff; border-bottom: 1px dotted #b6a2ff; cursor: pointer; }
  .lawpane { display: none; position: fixed; right: 12px; bottom: 12px; width: min(640px, calc(100vw - 24px)); max-height: 60vh; overflow-y: auto; background: #161b21; border: 1px solid #b6a2ff; padding: 10px 12px; font-size: 12px; z-index: 40; }
  .lawpane .lawhead { color: #9ab; margin-bottom: 6px; }
  .lawpane .lawhead b { color: #b6a2ff; }
  .lawpane button { float: right; font: inherit; background: #222; color: #ccc; border: 1px solid #444; cursor: pointer; padding: 1px 8px; }
  .lawpane pre { white-space: pre-wrap; word-break: break-word; color: #e6e6e6; margin: 0; }
  /* the hues are scoped .who.cN deliberately: a bare .cN (0,1,0)
     loses to the generic "li .who" (0,1,1) above and every member would
     render one color — the Copilot finding on this very rule */
  .who.c0 { color: #7fd1ff; } .who.c1 { color: #b6a2ff; } .who.c2 { color: #8be98b; } .who.c3 { color: #ffb46b; }
  .who.c4 { color: #ff9ecb; } .who.c5 { color: #9be5d8; } .who.c6 { color: #e8d76b; } .who.c7 { color: #f2a2a2; }
  table { font-size: 12px; margin: 8px 10px; border-collapse: collapse; }
  td, th { padding: 3px 10px; text-align: left; border-bottom: 1px dotted #2a2a2a; }
  th { color: #9ab; }
  td.num, th.num { text-align: right; }
  /* an act is an attempt until its own result says it landed: a refused
     act carries the rule that refused it (the v2 finding — two refused
     filings read as filed when the lane showed only the call) */
  li.act.refused, li.act.error { color: #ff9e9e; }
  li.act .verdict { font-weight: bold; letter-spacing: 0.04em; }
  /* #309: a file change renders its capped diff, folded, +/- tinted */
  li.file-change { color: #cccce0; font-size: 12px; }
  li.file-change details { margin-top: 4px; }
  li.file-change summary { cursor: pointer; color: #8899aa; font-size: 11px; }
  li.file-change pre.diff { margin: 4px 0 0; white-space: pre-wrap; word-break: break-all; color: #cccce0; background: #10151b; border: 1px solid #2a313a; padding: 6px; max-height: 40vh; overflow-y: auto; }
  li.file-change .add { color: #7dff8a; }
  li.file-change .del { color: #ff7d7d; }
  li.act.error .verdict { color: #ffb46b; }
  li.act a.landed { color: #8be98b; text-decoration: none; }
  #acts-list.hide-turns li.turn-done { display: none; }
  h2 label { float: right; text-transform: none; letter-spacing: 0; font-weight: normal; color: #778; cursor: pointer; }
  /* a cite is a link only when it names an accepted post; a self-labeled
     id that never landed stays text (the v2 drafts said "fp_25") */
  a.cite { color: #7fd1ff; text-decoration: none; }
  a.cite:hover { text-decoration: underline; }
  span.cite.dead { color: #889; text-decoration: line-through dotted; }
  li.post:target { outline: 2px solid #7fd1ff; outline-offset: -2px; }
  #forum-list { position: relative; }
  header .gates a { color: #ffb46b; }
  header .outcomes { color: #889; font-size: 11.5px; }
  @media (max-width: 980px) { main { grid-template-columns: 1fr; height: auto; } section { height: 70vh; } }
</style>
</head>
<body>
<header>
  community replay — <b>${safeName}</b>
  <div class="meta" id="meta"></div>
  <div class="prov muted" id="prov"></div>
  <div class="meta gates" id="gates"></div>
  <div class="outcomes" id="outcomes"></div>
  <div class="charter" id="charter"></div>
  <div class="muted">read-only replay from the durable artifacts — the chains remain the record of authority</div>
</header>
<main>
  <section id="forum">
    <h2>the forum — the whole conversation, oldest first</h2>
    <p class="hint">one block per landed post · <span class="gate" style="color:#ffb46b;font-weight:bold">LEDGER</span> marks the run's gate (AGREEMENT / POSITIONS / RULING / VERDICTS) · fp_ ids cite earlier speech · verdicts read bold · click a clause id to read the law it names</p>
    <ul id="forum-list"></ul>
  </section>
  <section>
    <h2>the members' acts <label><input type="checkbox" id="show-turns"> show turn ends</label></h2><ul id="acts-list" class="hide-turns"></ul>
    <h2>the members</h2><table id="members"></table>
  </section>
</main>
<div id="lawpane" class="lawpane"></div>
<script>
const DATA = ${embedded};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
// timestamps arrive as ISO strings from the live feed, but old exports
// embedded epoch milliseconds — slicing a number threw and killed the
// pane it was rendering, so every shape is normalized before the slice
const stamp = (at) => (typeof at === 'number' && Number.isFinite(at) ? new Date(at).toISOString() : String(at ?? ''));
const bare = (s) => String(s ?? '').replace(/^community-/, '');

const r = DATA.run || {};
const mod = r.model || {};
const routes = Object.values(mod.members || {});
const modelTxt = !mod.model ? '' : ' · model ' + (new Set(routes).size > 1
  ? Object.keys(mod.members).map((k) => k + '=' + mod.members[k]).join(' ')
  : mod.provider + '/' + mod.model);
$('meta').textContent = (r.charter || '${safeName}') + ' · run ' + (r.runTag ?? '—') + (r.resumed ? ' (resumed)' : '') +
  ' · ended ' + (r.endedAt ?? '?') + ' · reason: ' + (r.endReason ?? '?') +
  ' · rounds ' + (r.rounds ?? 0) + ' · turns ' + (r.turns ?? 0) + ' · tokens ' + (r.tokens ?? 0) + modelTxt;

// THE CODE THE COMMUNITY RAN ON — outputs never repeat (the nature of
// LLMs) but runs stay comparable when the tree that produced each is
// named. Archives from before the field render nothing here.
if (r.code && r.code.commit) {
  $('prov').textContent = 'code: ' + (r.code.repo ? String(r.code.repo).replace(/^git@github.com:/, 'github.com/').replace(/\.git$/, '') + ' @ ' : '') +
    String(r.code.commit).slice(0, 12) + (r.code.dirty ? ' (DIRTY TREE)' : '') +
    (r.code.foreignPackages && r.code.foreignPackages.length ? ' (FOREIGN PACKAGES ×' + r.code.foreignPackages.length + ' — loaded from outside the checkout)' : '') +
    (r.runtime ? ' · law ' + String(r.runtime.law ?? '').slice(0, 12) + '… · ' + String(r.runtime.image ?? '') + ' · node ' + String(r.runtime.node ?? '') : '');
} else if (r.code && r.code.note) {
  $('prov').textContent = 'code: ' + r.code.note;
}

// THE CHARTER — what was debated, carried in the archive itself (the
// operator's finding: the exports showed the debate but never the
// question, and a reader needed the repo's JSON to know it). Archives
// from before the field render nothing here — the absence is honest.
if (r.goal) {
  // a seat is named, routed, and ROLED: the persona is what the member is
  // FOR — without it a reader sees five names arguing and no idea which
  // conviction each carries (the operator's second finding, same day)
  const seats = (r.seats || []).map((s) =>
    '<span class="seat"><b>' + esc(bare(s.id)) + '</b>' + (s.model ? ' (' + esc(s.model) + ')' : '') + (s.bench ? ' · bench' : '') +
    (s.sealed ? ' · <b>sealed brief</b>' : '') +
    (s.persona ? ' — ' + esc(s.persona) : '') + '</span>').join('');
  // a sealed brief, revealed: the instruction one member alone was given,
  // which the persona above does not show — the manifest carries it from
  // the run's end, and the replay shows it beside the seats
  const sealed = (r.sealedBriefs || []).map((b) =>
    '<span class="seat"><b>' + esc(bare(b.seat)) + '</b> — ' + esc(b.text) +
    ' <span class="muted">(sha256 ' + esc(String(b.sha256 || '').slice(0, 12)) + '…)</span></span>').join('');
  $('charter').innerHTML = '<span class="lbl">THE CHARTER — the goal, verbatim' +
    (r.charterSource === 'operator-file' ? ' (embedded from the operator\\'s charter file at export time)' : ' (as the run\\'s manifest recorded it)') + ':</span>\\n' +
    esc(r.goal) +
    (seats ? '<span class="seats">seats — what each member is FOR (the charter\\'s personas, verbatim):</span>' + seats : '') +
    (sealed ? '<span class="seats">sealed briefs — each given to one member only, never shown to the others during the run, revealed by the manifest when it ended:</span>' + sealed : '');
}

// the forum's reading aids: a member keeps one color (hash of its name)
// and a session id shows its member name — the run tag is per-run
// machinery, not identity, and the members table keeps the full session
const memberOf = (s) => String(s ?? '?').replace(/^community-/, '').replace(/-[0-9a-f]{6}$/, '');
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return 'c' + (h % 8); };
const GATE_RE = /^(?:[\\w.-]+ — )?(AGREEMENT|POSITIONS|RULING|VERDICTS):/;
// emphasis inside a post body, applied AFTER escaping so member text can
// never inject markup: fp_ cites and the verdict vocabulary read at a
// glance inside a long ledger post
const POSTS = new Set(DATA.forum.map((p) => String(p.id ?? '')));
const hl = (s) => esc(s)
  .replace(/\\b(fp_\\d+)\\b/g, (m) => POSTS.has(m)
    ? '<a class="cite" href="#' + m + '">' + m + '</a>'
    : '<span class="cite dead" title="no accepted post carries this id">' + m + '</span>')
  .replace(/\\b(ENDORSED|AMENDED|REJECTED|CONFIRMED|ACCEPTED|CONTESTED|DISSENT)\\b/g, '<b>$1</b>');

// the law, resolvable in place: a clause id the embedded law carries
// becomes a click that opens the clause's own text in the pane (sliced
// from the body, R-6); hover carries a short preview. The id grammar
// matches the body's own ([A-Z]{1,4}, the HEADER_RE shape) so a future
// four-letter prefix resolves the day it exists. Ids the body does not
// carry (enforcement codes: LG-5, AG, RA…) stay plain — a tooltip that
// pretended they were law would be the false answer, named.
const LAW = DATA.law ?? null;
const lawHl = (s) => LAW
  ? hl(s).replace(/\\b([A-Z]{1,4}-\\d+(?:\\/DYN)?)\\b/g, (m, id) =>
      LAW.clauses[id] != null ? '<span class="law" data-c="' + id + '" onclick="showLaw(\\'' + id + '\\')" title="' + esc(String(LAW.clauses[id]).slice(0, 160)) + '…">' + id + '</span>' : m)
  : hl(s);
const showLaw = (id) => {
  const pane = $('lawpane');
  if (!pane || !LAW || LAW.clauses[id] == null) return;
  const basis = LAW.basis === 'run'
    ? 'the law this run ran under, recorded in its own manifest (digest '
    : 'the current draft body (digest ';
  const tail = LAW.basis === 'run'
    ? ') — sliced verbatim, R-6'
    : ') — this run predates law provenance, so its own law digest is not recorded; citations resolve against the current draft. Sliced verbatim, R-6';
  pane.innerHTML = '<div class="lawhead"><b>' + id + '</b> — ' + basis + String(LAW.digest).slice(0, 12) + '…' + tail +
    '<button onclick="$(\\'lawpane\\').style.display=\\'none\\'">close</button></div><pre>' + esc(LAW.clauses[id]) + '</pre>';
  pane.style.display = 'block';
};

for (const p of DATA.forum) {
  const li = document.createElement('li');
  const member = memberOf(p.by);
  const gate = GATE_RE.test(String(p.text ?? ''));
  li.className = 'post' + (gate ? ' ledger' : '');
  if (/^fp_\\d+$/.test(String(p.id ?? ''))) li.id = p.id;
  li.innerHTML = '<span class="head">[' + esc(p.id ?? p.seq ?? '?') + '] <span class="who ' + colorOf(member) + '">' + esc(member) + '</span>' +
    ' · <span class="at">' + esc(stamp(p.at).slice(0, 19)) + '</span> · ' + esc(p.topic ?? '') +
    (gate ? ' · <span class="gate">LEDGER</span>' : '') + '</span>' +
    (p.headline && p.headline !== String(p.text ?? '').trim() ? '<span class="hline">' + esc(p.headline) + '</span>' : '') +
    '<span class="body">' + lawHl(p.text) + '</span>';
  $('forum-list').appendChild(li);
}
if (!DATA.forum.length) $('forum-list').innerHTML = '<li class="empty">the forum never spoke — negative space is information</li>';

// THE GATE POSTS — what the run exists to produce, named at the top: a
// post that opens with its gate marker, or the honest absence. Presence
// is not success; the charter's condition is read on the forum itself.
const gates = DATA.forum.filter((p) => GATE_RE.test(String(p.text ?? '')));
$('gates').innerHTML = gates.length
  ? 'gate posts: ' + gates.map((p) => '<a href="#' + esc(p.id) + '">' + esc(p.id) + '</a> ' +
      esc(GATE_RE.exec(String(p.text))[1]) + ' (' + esc(memberOf(p.by)) + ')').join(' · ')
  : 'gate posts: none — no accepted post opens with AGREEMENT:, POSITIONS:, RULING: or VERDICTS:';

// what the acts lane can and cannot say about each act
$('outcomes').textContent = DATA.actOutcomes
  ? 'act outcomes recorded: each act was resolved from its own result — a refused act is marked REFUSED with the rule that refused it'
  : 'this archive predates recorded act outcomes: an act below is an attempt, and it may have been refused — a LoopGuard notice beside it is the only evidence';

for (const t of DATA.timeline) {
  const li = document.createElement('li');
  const kind = { notice: 'notice', pass: 'pass', 'pass-call': 'pass-call', 'pass-refused': 'pass-refused', act: 'act', 'turn-done': 'turn-done', 'file-change': 'file-change' }[t.type] ?? '';
  li.className = kind + (t.type === 'act' && (t.outcome === 'refused' || t.outcome === 'error') ? ' ' + t.outcome : '');
  let tail = '';
  if (t.type === 'act' && t.outcome === 'refused') tail = ' <span class="verdict">— REFUSED' + (t.rule ? ' [' + esc(t.rule) + ']' : '') + '</span>' + (t.result ? ' ' + esc(String(t.result).replace(/^\\[[^\\]]+\\]\\s*/, '')) : '');
  else if (t.type === 'act' && t.outcome === 'error') tail = ' <span class="verdict">— ERROR</span>' + (t.result ? ' ' + esc(t.result) : '');
  else if (t.type === 'act' && t.post && POSTS.has(t.post)) tail = ' <a class="landed" href="#' + esc(t.post) + '">→ ' + esc(t.post) + '</a>';
  else if (t.type === 'pass-refused' && t.rule) tail = ' <span class="verdict">[' + esc(t.rule) + ']</span>';
  li.innerHTML = '<span class="at">' + esc(stamp(t.at).slice(11, 19)) + '</span> <span class="who">' + esc(bare(t.who)) + '</span> — ' + esc(t.text) + tail;
  // #309: a file change carries its capped diff, folded — the archive shows
  // what changed beside what was concluded
  if (t.type === 'file-change' && t.diff?.length) {
    const details = document.createElement('details');
    const pre = document.createElement('pre');
    pre.className = 'diff';
    pre.innerHTML = t.diff.map((l) => l.startsWith('+') ? '<span class="add">' + esc(l) + '</span>' : l.startsWith('-') ? '<span class="del">' + esc(l) + '</span>' : esc(l)).join('\\n');
    details.appendChild(pre);
    li.appendChild(details);
  }
  $('acts-list').appendChild(li);
}
const showTurns = $('show-turns');
if (showTurns) showTurns.onchange = () => { $('acts-list').className = showTurns.checked ? '' : 'hide-turns'; };
if (!DATA.timeline.length) $('acts-list').innerHTML = '<li class="empty">no acts recorded</li>';

// THE MEMBERS — derived from the archive itself: what each seat said,
// what did not land, what it cost. Outcome columns read "—" on an
// archive that predates recorded outcomes: unknown is not zero.
const seatRoutes = (r.model && r.model.members) || {};
const rowsBy = (who, pred) => DATA.timeline.filter((t) => t.who === who && pred(t)).length;
const fmt = (n) => Number(n).toLocaleString('en-US');
const tbl = $('members');
tbl.innerHTML = '<tr><th>member</th><th>route</th><th class="num">turns</th><th class="num">posts</th><th class="num">refused</th><th class="num">passes</th><th class="num">LoopGuard</th><th class="num">tokens</th></tr>' +
  (DATA.members || []).map((m) => {
    const who = m.session;
    const name = memberOf(who);
    const posts = DATA.forum.filter((p) => p.by === who).length;
    const refused = DATA.actOutcomes ? fmt(rowsBy(who, (t) => (t.type === 'act' && (t.outcome === 'refused' || t.outcome === 'error')) || t.type === 'pass-refused')) : '—';
    const tokens = m.tokens && Number.isFinite(m.tokens.metered) ? fmt(m.tokens.metered) : '—';
    return '<tr><td><span class="who ' + colorOf(name) + '">' + esc(bare(who)) + '</span></td><td>' + esc(seatRoutes[name] ?? '') + '</td>' +
      '<td class="num">' + esc(m.turns) + '</td><td class="num">' + posts + '</td><td class="num">' + refused + '</td>' +
      '<td class="num">' + rowsBy(who, (t) => t.type === 'pass') + '</td><td class="num">' + rowsBy(who, (t) => t.type === 'notice' && /LoopGuard/.test(String(t.text))) + '</td>' +
      '<td class="num">' + tokens + '</td></tr>';
  }).join('');

// a link to a post (#fp_17) lands on it: the forum pane scrolls to the
// post and the panes come into view. Only the pane scrolls — a plain
// scrollIntoView also dragged the page and hid the header — and it runs
// on load (after the browser's own fragment scroll) and on every hash
// change, so a cite clicked inside a post lands the same way.
const landOnPost = () => {
  if (!/^#fp_\\d+$/.test(location.hash)) return;
  const target = document.getElementById(location.hash.slice(1));
  const list = $('forum-list');
  if (!target || !list) return;
  list.scrollTop = Math.max(0, target.offsetTop - 6);
  const panes = document.querySelector('main');
  if (panes) window.scrollTo(0, panes.offsetTop);
};
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('load', landOnPost);
  window.addEventListener('hashchange', landOnPost);
}
</script>
</body>
</html>
`;
}
