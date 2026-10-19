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
  main { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 10px; padding: 10px; }
  section { border: 1px solid #333; background: #161616; min-height: 120px; }
  h2 { font-size: 13px; margin: 0; padding: 8px 10px; background: #202020; border-bottom: 1px solid #333; text-transform: uppercase; letter-spacing: 0.08em; color: #9ab; }
  ul { list-style: none; margin: 0; padding: 6px 10px; font-size: 12.5px; }
  li { padding: 5px 0; border-bottom: 1px dotted #2a2a2a; white-space: pre-wrap; word-break: break-word; }
  li .who { color: #7fd1ff; }
  li .at { color: #666; font-size: 11px; }
  li.empty { color: #666; font-style: italic; }
  .ask { border: 1px solid #a83; background: #241c10; padding: 8px; margin: 8px 10px; font-size: 12.5px; }
  .ask .head { color: #ffb46b; font-weight: bold; }
  .ask .detail { color: #999; font-size: 11.5px; max-height: 9em; overflow: auto; white-space: pre-wrap; }
  .ask button { margin-right: 6px; margin-top: 6px; padding: 4px 12px; font: inherit; cursor: pointer; }
  .ask button.approve { background: #1d5c2f; color: #cfe; border: 1px solid #3a7; }
  .ask button.deny { background: #5c1d1d; color: #fcc; border: 1px solid #a55; }
  .question textarea { width: 96%; font: inherit; background: #111; color: #ddd; border: 1px solid #444; }
  .muted { color: #666; }
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

function post(listId, html, { empty = false } = {}) {
  const ul = $(listId);
  const emptyNote = ul.querySelector('.empty');
  if (emptyNote) emptyNote.remove();
  const li = document.createElement('li');
  if (empty) li.className = 'empty';
  li.innerHTML = html;
  ul.prepend(li);
  while (ul.children.length > 200) ul.removeChild(ul.lastChild);
}

function renderPending(p) {
  const box = $('pending');
  const asks = p.filter(x => x.kind === 'ask');
  const questions = p.filter(x => x.kind === 'question');
  box.innerHTML = '';
  if (!asks.length && !questions.length) {
    box.innerHTML = '<div class="ask muted">nothing is waiting</div>';
  }
  for (const a of asks) {
    const div = document.createElement('div');
    div.className = 'ask';
    div.innerHTML =
      '<div class="head">APPROVAL ASKS FOR YOU — ' + esc(a.wouldOtherwise ? 'would otherwise: ' + a.wouldOtherwise : 'claimed') + (a.critical ? ' · CRITICAL (charter)' : '') + '</div>' +
      '<div class="detail">' + esc(a.detail || a.headline) + '</div>' +
      '<button class="approve">approve</button><button class="deny">deny</button>';
    div.querySelector('.approve').onclick = () => api('/answer/' + encodeURIComponent(a.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ decision: 'approve' }) }).then(() => div.remove()).catch(() => {});
    div.querySelector('.deny').onclick = () => api('/answer/' + encodeURIComponent(a.id), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ decision: 'deny' }) }).then(() => div.remove()).catch(() => {});
    box.appendChild(div);
  }
  for (const q of questions) {
    const div = document.createElement('div');
    div.className = 'ask question';
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
  }
}

const es = new EventSource('/' + token + '/events');
es.onopen = () => { $('conn').textContent = 'live'; $('conn').className = 'live'; };
es.onerror = () => { $('conn').textContent = 'reconnecting…'; $('conn').className = 'dead'; };
es.onmessage = (m) => {
  let e; try { e = JSON.parse(m.data); } catch { return; }
  const at = '<span class="at">' + esc((e.at || '').slice(11, 19)) + '</span> ';
  switch (e.type) {
    case 'hello': break;
    case 'forum-post':
      post('forum-list', at + '<span class="who">' + esc(e.by ?? '?') + '</span> on ' + esc(e.topic) + ':\\n' + esc(short(e.text, 500)));
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
    case 'end':
      post('acts-list', at + '■ THE RUN ENDS — ' + esc(e.reason));
      break;
    default: break;
  }
};

// poll the seat's pending (SSE announces; the poll is the reconciler — a
// page opened mid-ask sees it without waiting for an event)
setInterval(() => api('/state').then(s => renderPending(s.pending || [])).catch(() => {}), 4000);
api('/state').then(s => renderPending(s.pending || [])).catch(() => {});
</script>
</body>
</html>
`;
}
