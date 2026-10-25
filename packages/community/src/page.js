// The observatory page — one static HTML document, no framework, no
// build step. It renders three lanes from the SSE feed (the forum, the
// community's acts, the human seat's pending) and answers only what is
// pending. Refresh-safe (the feed replays), honest about silence (an
// empty lane says so).

export function pageHtml({ charterName, token }) {
  const safeName = String(charterName).replace(/[^a-zA-Z0-9._-]/g, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>community observatory — ${safeName}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; margin: 0; background: #111; color: #ddd; }
  header { padding: 10px 16px; background: #1b1b1b; border-bottom: 1px solid #333; position: sticky; top: 0; }
  header b { color: #7fd1ff; }
  header .live { color: #7dff8a; }
  header .dead { color: #ff7d7d; }
  main { display: grid; grid-template-columns: 1.9fr 1fr 1fr; gap: 10px; padding: 10px; height: calc(100vh - 52px); box-sizing: border-box; }
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
  .question textarea { width: 96%; font: inherit; background: #111; color: #ddd; border: 1px solid #444; }
  .muted { color: #666; }
  header button { font: inherit; font-size: 11.5px; background:#222; color:#ccc; border:1px solid #444; cursor:pointer; padding:2px 8px; }
  header button:hover { border-color:#7fd1ff; color:#7fd1ff; }
  .verdict-allow { color: #7dff8a; }
  .verdict-deny, .verdict-rejected { color: #ff7d7d; }
  @media (max-width: 980px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  community observatory — <b>${safeName}</b> ·
  <span id="conn" class="live">live</span> ·
  <span class="muted">the law binds the sovereign: your answers land on the record (D-6)</span>
  <span id="ops" style="float:right">
    <button id="btn-pause" title="drain the current turn, then idle">⏸ pause</button>
    <button id="btn-resume" title="continue from the pause">▶ resume</button>
    <button id="btn-stop" title="finish the current turn, flush, end with its reason">⏹ stop</button>
    <button id="btn-kill" title="cancel the in-flight turn now, flush what exists">✂ kill</button>
  </span>
  <div id="banner" style="display:none; margin-top:6px; color:#ffd27d; font-weight:bold"></div>
</header>
<main>
  <section id="forum"><h2>the forum</h2><ul id="forum-list"><li class="empty">nothing yet — the community has not spoken</li></ul></section>
  <section id="acts"><h2>the community's acts</h2><ul id="acts-list"><li class="empty">no turns yet</li></ul></section>
  <section id="seat"><h2>the human seat — what waits for you</h2><div id="pending"><div class="ask muted">nothing is waiting</div></div></section>
</main>
<script>
const token = ${JSON.stringify(token)};
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
const GATE_RE = /^(AGREEMENT|POSITIONS|RULING|VERDICTS):/;
// emphasis inside a post body, applied AFTER escaping so member text can
// never inject markup: fp_ cites and the verdict vocabulary read at a
// glance inside a long ledger post
const hl = (s) => esc(s)
  .replace(/\\b(fp_\\d+)\\b/g, '<span class="cite">$1</span>')
  .replace(/\\b(ENDORSED|AMENDED|REJECTED|CONFIRMED|ACCEPTED|CONTESTED|DISSENT)\\b/g, '<b>$1</b>');
const postBlock = (p) => {
  const member = memberOf(p.by);
  const gate = GATE_RE.test(String(p.text ?? ''));
  return { cls: 'post' + (gate ? ' ledger' : ''), html:
    '<span class="head">' + (p.id ? '[' + esc(p.id) + '] ' : '') + '<span class="who ' + colorOf(member) + '">' + esc(member) + '</span>' +
    ' · <span class="at">' + esc(stamp(p.at).slice(11, 19)) + '</span> · ' + esc(p.topic ?? '') +
    (gate ? ' · <span class="gate">LEDGER</span>' : '') + '</span>' +
    '<span class="body">' + hl(p.text) + '</span>' };
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
function renderPending(p) {
  // the reconciler rule (#239 follow-up): the 4s poll must never fight the
  // human. If nothing changed, touch NOTHING — an expanded details and a
  // half-typed reply stay exactly as the human left them. When something
  // DID change, rebuild, but carry over what was open and what was typed.
  const sig = JSON.stringify(p.map(x => [x.id, x.kind, x.critical, x.wouldOtherwise, x.headline, x.question, x.options, x.context, x.by, x.detail]));
  if (sig === lastPendingSig) return;
  lastPendingSig = sig;
  const box = $('pending');
  const saved = {};
  box.querySelectorAll('[data-id]').forEach(el => {
    const d = el.querySelector('details');
    const ta = el.querySelector('textarea');
    saved[el.dataset.id] = { open: d ? d.open : false, text: ta ? ta.value : null };
  });
  const asks = p.filter(x => x.kind === 'ask');
  const questions = p.filter(x => x.kind === 'question');
  box.innerHTML = '';
  if (!asks.length && !questions.length) {
    box.innerHTML = '<div class="ask muted">nothing is waiting</div>';
  }
  for (const a of asks) {
    const div = document.createElement('div');
    div.className = 'ask';
    div.dataset.id = a.id;
    div.innerHTML =
      '<div class="head">APPROVAL ASKS FOR YOU' + (a.critical ? ' · CRITICAL (charter)' : '') + '</div>' +
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
      '<div class="head">A MEMBER ASKS YOU — ' + esc(q.by ?? 'a member') + (q.options ? ' · options: ' + esc(q.options) : '') + '</div>' +
      '<div class="detail">' + esc(q.question) + (q.context ? '\\n(context: ' + esc(q.context) + ')' : '') + '</div>' +
      '<textarea rows="2" placeholder="your reply — it becomes this member\\'s tool result, on its record"></textarea><br>' +
      '<button class="approve">reply</button>';
    const ta = div.querySelector('textarea');
    div.querySelector('button').onclick = () => {
      if (!ta.value.trim()) return;
      api('/reply/' + encodeURIComponent(q.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ text: ta.value }) }).then(() => div.remove()).catch(() => {});
    };
    box.appendChild(div);
    const wasQ = saved[q.id];
    if (wasQ) {
      const d = div.querySelector('details');
      if (d && wasQ.open) d.open = true;
      if (wasQ.text != null) ta.value = wasQ.text;
    }
  }
}

async function op(path, body) {
  return api(path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body || {}) })
    .then(r => { renderBanner(r.controls); }).catch(() => {});
}
$('btn-pause').onclick = () => op('/pause');
$('btn-resume').onclick = () => op('/resume');
$('btn-stop').onclick = () => { if (window.confirm('Stop the community gracefully? The current turn drains and flushes; the run ends with its reason.')) op('/stop', {mode:'graceful'}); };
$('btn-kill').onclick = () => { if (window.confirm('KILL the community now? The in-flight turn is cancelled; what the record holds is flushed.')) op('/stop', {mode:'now'}); };

function renderBanner(controls) {
  const b = $('banner');
  if (!controls) { b.style.display = 'none'; return; }
  if (controls.stopMode) { b.textContent = 'STOPPING (' + controls.stopMode + ') — the run ends with its reason'; b.style.display = 'block'; }
  else if (controls.paused) { b.textContent = 'PAUSED — the community waits for you (the current turn drained; nothing new will start)'; b.style.display = 'block'; }
  else b.style.display = 'none';
}

const es = new EventSource('/' + token + '/events');
es.onopen = () => { $('conn').textContent = 'live'; $('conn').className = 'live'; };
es.onerror = () => { $('conn').textContent = 'reconnecting…'; $('conn').className = 'dead'; };
es.onmessage = (m) => {
  let e; try { e = JSON.parse(m.data); } catch { return; }
  const at = '<span class="at">' + esc(stamp(e.at).slice(11, 19)) + '</span> ';
  switch (e.type) {
    case 'hello': break;
    case 'forum-post': {
      const block = postBlock({ id: e.id, by: e.by, topic: e.topic, text: e.text, at: e.at });
      post('forum-list', block.html, { cls: block.cls });
      break;
    }
    case 'forum-pass':
      post('acts-list', at + '<span class="who">' + esc(e.by ?? '?') + '</span> passed — not a post: ' + esc(e.reason));
      break;
    case 'turn':
      post('acts-list', at + '<span class="who">' + esc(e.member) + '</span> takes a turn' + (e.bench ? ' (bench)' : ''));
      break;
    case 'turn-done':
      post('acts-list', at + '<span class="who">' + esc(e.member) + '</span> finished turn ' + esc(e.turns) + ' — flushed to its chain', {});
      break;
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
      post('acts-list', at + '■ THE RUN ENDS — ' + esc(e.reason));
      break;
    default: break;
  }
};

// poll the seat's pending (SSE announces; the poll is the reconciler — a
// page opened mid-ask sees it without waiting for an event)
setInterval(() => api('/state').then(s => { renderPending(s.pending || []); renderBanner(s.controls); }).catch(() => {}), 4000);
api('/state').then(s => { renderPending(s.pending || []); renderBanner(s.controls); }).catch(() => {});
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
  li.post.ledger { border-left-color: #ffb46b; background: #211d13; }
  li.post.ledger .gate { color: #ffb46b; font-weight: bold; letter-spacing: 0.06em; }
  li.post .body .cite { color: #7fd1ff; }
  li.post .body b { color: #ffd9a0; }
  /* the hues are scoped .who.cN deliberately: a bare .cN (0,1,0)
     loses to the generic "li .who" (0,1,1) above and every member would
     render one color — the Copilot finding on this very rule */
  .who.c0 { color: #7fd1ff; } .who.c1 { color: #b6a2ff; } .who.c2 { color: #8be98b; } .who.c3 { color: #ffb46b; }
  .who.c4 { color: #ff9ecb; } .who.c5 { color: #9be5d8; } .who.c6 { color: #e8d76b; } .who.c7 { color: #f2a2a2; }
  table { font-size: 12px; margin: 8px 10px; border-collapse: collapse; }
  td, th { padding: 3px 10px; text-align: left; border-bottom: 1px dotted #2a2a2a; }
  th { color: #9ab; }
  @media (max-width: 980px) { main { grid-template-columns: 1fr; height: auto; } section { height: 70vh; } }
</style>
</head>
<body>
<header>
  community replay — <b>${safeName}</b>
  <div class="meta" id="meta"></div>
  <div class="muted">read-only replay from the durable artifacts — the chains remain the record of authority</div>
</header>
<main>
  <section id="forum">
    <h2>the forum — the whole conversation, oldest first</h2>
    <p class="hint">one block per landed post · <span class="gate" style="color:#ffb46b;font-weight:bold">LEDGER</span> marks the run's gate (AGREEMENT / POSITIONS / RULING / VERDICTS) · fp_ ids cite earlier speech · verdicts read bold</p>
    <ul id="forum-list"></ul>
  </section>
  <section>
    <h2>the members' acts</h2><ul id="acts-list"></ul>
    <h2>the members</h2><table id="members"></table>
  </section>
</main>
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

// the forum's reading aids: a member keeps one color (hash of its name)
// and a session id shows its member name — the run tag is per-run
// machinery, not identity, and the members table keeps the full session
const memberOf = (s) => String(s ?? '?').replace(/^community-/, '').replace(/-[0-9a-f]{6}$/, '');
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return 'c' + (h % 8); };
const GATE_RE = /^(AGREEMENT|POSITIONS|RULING|VERDICTS):/;
// emphasis inside a post body, applied AFTER escaping so member text can
// never inject markup: fp_ cites and the verdict vocabulary read at a
// glance inside a long ledger post
const hl = (s) => esc(s)
  .replace(/\\b(fp_\\d+)\\b/g, '<span class="cite">$1</span>')
  .replace(/\\b(ENDORSED|AMENDED|REJECTED|CONFIRMED|ACCEPTED|CONTESTED|DISSENT)\\b/g, '<b>$1</b>');

for (const p of DATA.forum) {
  const li = document.createElement('li');
  const member = memberOf(p.by);
  const gate = GATE_RE.test(String(p.text ?? ''));
  li.className = 'post' + (gate ? ' ledger' : '');
  li.innerHTML = '<span class="head">[' + esc(p.id ?? p.seq ?? '?') + '] <span class="who ' + colorOf(member) + '">' + esc(member) + '</span>' +
    ' · <span class="at">' + esc(stamp(p.at).slice(0, 19)) + '</span> · ' + esc(p.topic ?? '') +
    (gate ? ' · <span class="gate">LEDGER</span>' : '') + '</span>' +
    '<span class="body">' + hl(p.text) + '</span>';
  $('forum-list').appendChild(li);
}
if (!DATA.forum.length) $('forum-list').innerHTML = '<li class="empty">the forum never spoke — negative space is information</li>';

for (const t of DATA.timeline) {
  const li = document.createElement('li');
  li.className = { notice: 'notice', pass: 'pass', 'pass-call': 'pass-call', 'pass-refused': 'pass-refused', act: 'act' }[t.type] ?? '';
  li.innerHTML = '<span class="at">' + esc(stamp(t.at).slice(11, 19)) + '</span> <span class="who">' + esc(bare(t.who)) + '</span> — ' + esc(t.text);
  $('acts-list').appendChild(li);
}
if (!DATA.timeline.length) $('acts-list').innerHTML = '<li class="empty">no acts recorded</li>';

const tbl = $('members');
tbl.innerHTML = '<tr><th>member</th><th>turns</th></tr>' +
  (DATA.members || []).map((m) => '<tr><td>' + esc(bare(m.session)) + '</td><td>' + esc(m.turns) + '</td></tr>').join('');
</script>
</body>
</html>
`;
}
