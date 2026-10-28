// The observatory — the live community, on a page (#219). Loopback-only,
// boot-token-gated (a 0.0.0.0 bind is refused, the web-surface rule): a
// single HTML page over SSE, plus the intervention endpoints that answer
// ONLY what is pending on the human seat.
//
// WHAT THE PAGE SHOWS: the forum as it happens (forum.onPost), the passes
// members record (forum.onPass — an act in the acts lane, never a post),
// the community's turns and bench wakes (the driver's engine hooks), every
// approval ask the human seat sees (claimed, passed to the watch, or
// decided), and the notices members receive (watch verdicts, loopguard —
// read off session events, the same shapes watch-report reads).
//
// WHAT THE PAGE DOES: answer a pending ask (approve / deny — the decision
// flows back through the recorded answerer like any other, on the
// record); reply to an ask_human (the reply becomes the tool result on
// the asking member's chain). It mounts no powers of its own: no
// governance surface, no member state, nothing answers that was not
// already waiting for the human.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

import { pageHtml } from './page.js';

export const DEFAULT_OBSERVATORY_PORT = 3090;

/**
 * Start the observatory. `feed` is the event bus the driver wires (the
 * engine hooks, forum posts, human-seat poses/resolves, session notices);
 * `humanSeat` supplies the pending asks/questions the page answers.
 * Returns { server, url, close, publish }.
 */
export function startObservatory(ctx, {
  humanSeat,
  controls = null,
  port = DEFAULT_OBSERVATORY_PORT,
  host = '127.0.0.1',
  charterName = 'community',
  charter = null,
  provenance = null,
  law = null,
  feed = null,
}) {
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`observatory: refusing to bind ${host} — the page is loopback-only by design (a network-bound observatory is a network service this composition never declared)`);
  }
  const token = randomBytes(24).toString('hex');
  const clients = new Set();
  const history = []; // replay buffer for reconnects, bounded
  const HISTORY_CAP = 500;

  const publish = (event) => {
    const row = { at: new Date().toISOString(), ...event };
    history.push(row);
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
    const frame = `data: ${JSON.stringify(row)}\n\n`;
    for (const res of clients) {
      try { res.write(frame); } catch { /* a dead client prunes on close */ }
    }
    return row;
  };

  if (feed) for (const event of feed.initial ?? []) publish(event);

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body) + '\n');
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    // the token rides the path — the same shape the web surface prints
    if (!path.startsWith(`/${token}`)) {
      // the page itself is the one thing a stranger may load: it says
      // "wrong URL" and nothing else
      if (path === '/' || path === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><title>community observatory</title><p>This is a community observatory. Open the URL the run printed (it carries the boot token).</p>');
        return;
      }
      return json(res, 404, { error: 'not found' });
    }
    const route = path.slice(`/${token}`.length) || '/';

    if (route === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(pageHtml({ charterName, token, charter, provenance, law }));
      return;
    }
    if (route === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      // the replay: a page that reconnects sees what it missed — the
      // observatory's memory is the feed, bounded and stated
      for (const row of history.slice(-100)) res.write(`data: ${JSON.stringify(row)}\n\n`);
      res.write(`data: ${JSON.stringify({ at: new Date().toISOString(), type: 'hello', clients: clients.size + 1 })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (route === '/state' && req.method === 'GET') {
      const forum = ctx.get?.('compact-forum');
      const jud = ctx.get?.('compact-judicature');
      return json(res, 200, {
        charterName,
        pending: humanSeat ? humanSeat.pending() : [],
        forum: forum ? forum.snapshot() : null,
        docket: (() => { try { return jud?.docket?.() ?? []; } catch { return []; } })(),
        controls: controls ? controls.state() : null,
      });
    }
    if (route.startsWith('/answer/') && req.method === 'POST') {
      const id = decodeURIComponent(route.slice('/answer/'.length));
      const body = await readBody(req);
      const decision = body.decision === 'approve' ? 'approve' : 'deny';
      const record = humanSeat?.settleAsk?.(id, decision);
      if (!record) return json(res, 404, { error: `no pending ask ${id}` });
      publish({ type: 'ask-decided', id, decision, by: 'the human (page)' });
      return json(res, 200, { ok: true, id, decision });
    }
    if (route.startsWith('/reply/') && req.method === 'POST') {
      const id = decodeURIComponent(route.slice('/reply/'.length));
      const body = await readBody(req);
      if (typeof body.text !== 'string' || !body.text.trim()) {
        return json(res, 400, { error: 'a reply needs text' });
      }
      const record = humanSeat?.replyQuestion?.(id, body.text);
      if (!record) return json(res, 404, { error: `no pending question ${id}` });
      publish({ type: 'question-answered', id, by: 'the human (page)' });
      return json(res, 200, { ok: true, id });
    }
    // the floor act: a HUMAN member's turn, answered with one button —
    // post / pass / say. The seat validates with the forum's own rules
    // (a bad topic or an oversized post refuses HERE, 400, with the
    // reason), and the act flows into the member's own loop as its own
    // governed turn — the page is the model, the button is the speech.
    if (route.startsWith('/floor/') && req.method === 'POST') {
      const id = decodeURIComponent(route.slice('/floor/'.length));
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return json(res, 400, { error: 'a floor act needs your words in "text"' });
      const record = humanSeat?.settleFloor?.(id, { act: body.act, text, topic: body.topic, keep: body.keep === true });
      if (!record) return json(res, 404, { error: `no pending floor turn ${id}` });
      if (record.error) return json(res, 400, { error: record.error });
      // the feed hears the act from the seat's resolution (seatOutcome), not
      // here — publishing it twice put two lines on the page, one of them wrong
      return json(res, 200, { ok: true, id, act: record.answer?.act ?? body.act });
    }
    // the operator's hand (#229): pause, resume, stop — the same controls
    // the engine loop and the terminal signals share. Every press is an
    // operator act, published to the feed like any other recorded event.
    if (route === '/pause' && req.method === 'POST') {
      if (!controls) return json(res, 501, { error: 'no run controls on this observatory' });
      controls.pause();
      publish({ type: 'operator-pause', by: 'the human (page)' });
      return json(res, 200, { ok: true, controls: controls.state() });
    }
    if (route === '/resume' && req.method === 'POST') {
      if (!controls) return json(res, 501, { error: 'no run controls on this observatory' });
      controls.resume();
      publish({ type: 'operator-resume', by: 'the human (page)' });
      return json(res, 200, { ok: true, controls: controls.state() });
    }
    if (route === '/stop' && req.method === 'POST') {
      if (!controls) return json(res, 501, { error: 'no run controls on this observatory' });
      const body = await readBody(req);
      const mode = body.mode === 'now' ? 'now' : 'graceful';
      if (mode === 'now') controls.stopNow();
      else controls.stop('graceful');
      publish({ type: 'operator-stop', mode, by: 'the human (page)' });
      return json(res, 200, { ok: true, mode, controls: controls.state() });
    }
    return json(res, 404, { error: 'not found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const url = `http://${host}:${address.port}/${token}/`;
      resolve({
        server,
        url,
        publish,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('body too large — 64kB is the observatory\'s whole patience')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}
