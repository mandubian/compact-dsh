#!/usr/bin/env node
// community-replay — view a finished community run again (#215). A
// READ-ONLY server over the durable artifacts: the same three lanes as
// the live observatory, rendered from the archive — forum, the members'
// ordered acts, the run manifest. No human seat, no answer endpoints,
// nothing pending: the past has nothing to decide. Loopback-only,
// boot-token-gated, exactly like the live page.
//
//   node tools/community-replay.mjs <scratch-or-state-dir> [--port N]
//
// For the web: `community-export` writes the same view as ONE
// self-contained HTML file — commit it to a repo, open it anywhere.
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

import { readArchive } from './run-archive.mjs';
import { replayPageHtml } from '../packages/community/src/page.js';

const BIN = 'community-replay:';

function main() {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error(`usage: node tools/community-replay.mjs <scratch-or-state-dir> [--port N]`);
    process.exit(1);
  }
  const port = Number(argv[argv.indexOf('--port') + 1] ?? 3190) || 3190;
  const archive = readArchive(resolve(dir));
  const charterName = archive.run?.charter ?? 'community';
  const token = randomBytes(24).toString('hex');
  const page = replayPageHtml({ charterName, data: archive });

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== `/${token}/` && path !== `/${token}`) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>community replay</title><p>This is a run replay. Open the URL the tool printed (it carries the boot token).</p>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`${BIN} replay of "${charterName}" (${archive.run?.endReason ?? 'no manifest'}): http://127.0.0.1:${port}/${token}/`);
    console.log(`${BIN} read-only — the record is the authority; Ctrl-C to stop`);
  });
}

if (process.argv[1] && process.argv[1].endsWith('community-replay.mjs')) main();
