#!/usr/bin/env node
// community-export — a finished community run as ONE self-contained HTML
// file (#215): the same replay view, with the archive embedded. Commit it
// to a repository, serve it from Pages, or open it from the filesystem —
// it reads nothing but itself. This is how runs travel: an archive you
// can attach to a demo, a review, or a debate series under the law.
//
//   node tools/community-export.mjs <scratch-or-state-dir> -o agreement-run.html
//          [--charter tools/charters/agreement.json]
//
// --charter embeds the goal, topic and seats into the export when the
// run's manifest predates those fields — presentation only, labeled as
// such on the page ("embedded from the operator's charter file at export
// time"). A manifest that carries its own goal always wins; the record is
// never edited.
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readArchive } from './run-archive.mjs';
import { parseEmbeddedArchive } from './community-brief.mjs';
import { validateCharter } from '../packages/community/src/charter.js';
import { clauseIds, clauseText, COMPACT_DIGEST } from '../packages/constitution/src/body.js';
import { replayPageHtml } from '../packages/community/src/page.js';

/** The law, embedded for the replay's citation resolution: every clause
 *  id mapped to its text SLICED FROM THE BODY (R-6 — never restated), with
 *  the digest named so a reader knows exactly which law this is. ~40KB,
 *  the cost of a citation a reader can actually resolve. */
function lawForEmbedding() {
  const clauses = {};
  for (const id of clauseIds()) clauses[id] = clauseText(id);
  return { digest: COMPACT_DIGEST, clauses };
}


function main() {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith('-') && !a.startsWith('-o'));
  const outIdx = argv.indexOf('-o');
  const out = outIdx !== -1 ? resolve(argv[outIdx + 1]) : null;
  const charterIdx = argv.indexOf('--charter');
  const charterPath = charterIdx !== -1 ? resolve(argv[charterIdx + 1]) : null;
  if (!dir || !out) {
    console.error('usage: node tools/community-export.mjs <scratch-or-state-dir> -o <run.html> [--charter <charter.json>]');
    process.exit(1);
  }
  let archive;
  try {
    archive = readArchive(resolve(dir));
  } catch (stateError) {
    // an archive directory (a shipped docs/runs/*, no state/) carries its
    // own export HTML — the embedded DATA is the record. Re-rendering from
    // it is presentation only: the same archive, a newer renderer.
    const htmls = readdirSync(resolve(dir)).filter((f) => f.endsWith('.html')).sort();
    const embedded = htmls.length ? parseEmbeddedArchive(readFileSync(join(resolve(dir), htmls[0]), 'utf8')) : null;
    if (!embedded) throw stateError;
    archive = embedded;
    console.error(`community-export: no run state under ${dir} — re-rendering from the embedded DATA of ${htmls[0]} (the record, unchanged)`);
  }
  if (charterPath) {
    if (archive.run?.goal) {
      console.error('community-export: the manifest already carries its own goal — --charter ignored (the record wins over the operator file)');
    } else {
      // validate at the boundary, the charter's own discipline: a charter
      // that cannot parse refuses here, never half-embedded
      const charter = validateCharter(JSON.parse(readFileSync(charterPath, 'utf8')));
      archive.run = {
        ...(archive.run ?? {}),
        goal: charter.goal,
        topic: charter.topic,
        seats: charter.members.map((m) => ({
          id: m.id,
          model: m.model ? `${m.model.provider}/${m.model.model}` : null,
          bench: m.bench === true,
          persona: m.persona,
        })),
        charterSource: 'operator-file',
      };
      console.error(`community-export: charter embedded from ${charterPath} (goal, topic, ${charter.members.length} seats) — labeled as operator-file on the page`);
    }
  }
  const charterName = archive.run?.charter ?? 'community';
  // the law rides with the archive: citations in posts resolve to clause
  // text inside the page, offline, self-contained (R-6: sliced from the
  // body, never restated; the digest names which law this is)
  archive.law = archive.law ?? lawForEmbedding();
  const html = replayPageHtml({ charterName, data: archive });
  writeFileSync(out, html, { mode: 0o644 });
  console.log(`community-export: ${charterName} archived to ${out} (${Math.round(html.length / 1024)}kB, self-contained — commit it, serve it, or open it)`);
}

if (process.argv[1] && process.argv[1].endsWith('community-export.mjs')) main();
