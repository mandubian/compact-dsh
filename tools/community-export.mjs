#!/usr/bin/env node
// community-export — a finished community run as ONE self-contained HTML
// file (#215): the same replay view, with the archive embedded. Commit it
// to a repository, serve it from Pages, or open it from the filesystem —
// it reads nothing but itself. This is how runs travel: an archive you
// can attach to a demo, a review, or a debate series under the law.
//
//   node tools/community-export.mjs <scratch-or-state-dir> -o agreement-run.html
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readArchive } from './run-archive.mjs';
import { replayPageHtml } from '../packages/community/src/page.js';


function main() {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith('-') && !a.startsWith('-o'));
  const outIdx = argv.indexOf('-o');
  const out = outIdx !== -1 ? resolve(argv[outIdx + 1]) : null;
  if (!dir || !out) {
    console.error('usage: node tools/community-export.mjs <scratch-or-state-dir> -o <run.html>');
    process.exit(1);
  }
  const archive = readArchive(resolve(dir));
  const charterName = archive.run?.charter ?? 'community';
  const html = replayPageHtml({ charterName, data: archive });
  writeFileSync(out, html, { mode: 0o644 });
  console.log(`community-export: ${charterName} archived to ${out} (${Math.round(html.length / 1024)}kB, self-contained — commit it, serve it, or open it)`);
}

if (process.argv[1] && process.argv[1].endsWith('community-export.mjs')) main();
