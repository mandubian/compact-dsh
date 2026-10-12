// The night watch's ex-post report (#176 slice 2b) — the morning-after read.
// A session log carries every watch verdict as an attributed, motivated
// note; this tool reads the list back: one block per verdict, who decided,
// under which grant, and why — the deliverable the reporting contract
// exists for ("auto-approve things but reported so they can be analysed
// later in case of any problem"). Read-only over the log; works offline
// against any session file, no runtime cooperation needed.
import { readFileSync } from 'node:fs';

/**
 * The pure extraction: session-log text (JSONL) → the watch's verdicts, in
 * order. A verdict is a plugin-sourced user/message row whose summary
 * begins "Night watch:" — the recorded answerer's attribution. The
 * motivation rides the expanded note text.
 */
export function watchVerdictsFromLog(text) {
  const verdicts = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }   // a torn tail line never kills the report
    const data = row?.type === 'user/message' ? row.data : row;
    const source = data?.source;
    if (source?.kind !== 'compact-approval' || !String(source?.summary ?? '').startsWith('Night watch:')) continue;
    const text_ = data?.content?.map(b => b?.text ?? '').join('') ?? '';
    const motivation = text_.includes('Motivation: ')
      ? text_.split('Motivation: ')[1].replace(/\s*$/, '')
      : null;
    verdicts.push({
      seq: row.seq ?? null,
      time: row.time ?? null,
      summary: source.summary,
      motivation,
      basis: text_.match(/under grant (sg_[a-z0-9]+)/)?.[1] ?? null,
    });
  }
  return verdicts;
}

/** The human report: one block per verdict, then the tally. */
export function formatWatchReport(verdicts) {
  if (!verdicts.length) return 'no night-watch verdicts in this session';
  const blocks = verdicts.map(v => {
    const lines = [`  ${v.summary}`];
    if (v.basis) lines.push(`  basis: ${v.basis}`);
    if (v.motivation) lines.push(`  motivation: ${v.motivation}`);
    return lines.join('\n');
  });
  return `${verdicts.length} night-watch verdict(s):\n${blocks.join('\n')}`;
}

export function main(argv = process.argv.slice(2)) {
  const [file] = argv;
  if (!file) {
    console.error('usage: node tools/watch-report.mjs <session.v4.jsonl>');
    return 2;
  }
  console.log(formatWatchReport(watchVerdictsFromLog(readFileSync(file, 'utf8'))));
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  process.exitCode = main();
}
