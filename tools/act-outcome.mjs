// The outcome of one governed act, read from its own tool/result row.
//
// The live finding this answers (weight-of-voice-v2, a980e1): the filer
// called judicature_hear twice and LoopGuard LG-3 refused both. The
// archive kept the calls and dropped the results, so the replay showed
// two filings, the report counted "2 filing(s)", and the published
// account said the case was never filed because the filer never tried.
// A call is an attempt; only its result says whether it landed.
//
// The classification reads markers, never meaning:
//   refused — the result names the rule that refused it: an error that
//             opens with a [FAMILY/RULE] tag (LG/LG-3, RA/D-1/…,
//             SC/CF-2/…), or a non-error result whose tag says
//             "refused" ([JG/judgment-refused] lands as plain text)
//   error   — an error that names no rule (e.g. no approval channel)
//   ok      — the tool returned without either; for bash this means the
//             command was CARRIED, not that it exited 0
// Anything else — a call whose result never reached the log — keeps no
// outcome at all, and readers must say "not in the log", not "ok".

const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) : s; };

/** The text of a tool/result row, whichever shape the log carried. */
export function resultText(data) {
  const content = data?.message?.content ?? data?.content ?? [];
  return Array.isArray(content) ? content.map((b) => b?.text ?? '').join('') : String(content ?? '');
}

/** The call id a tool/result row answers. */
export function resultCallId(data) {
  return String(data?.message?.toolCallId ?? data?.toolCallId ?? data?.callId ?? '');
}

/** Classify one tool/result row. Returns { outcome, rule?, result?, post?, ref? }:
 *  `result` is the first line (refusals and errors only — a carried bash
 *  command's output stays out of the archive), `post` the fp id a
 *  forum_post landed as, `ref` the case id a judicature act named. */
export function classifyResult(data, toolName = '') {
  const text = resultText(data);
  const isError = (data?.message?.isError ?? data?.isError) === true;
  const first = text.split('\n')[0].replace(/^Error:\s*/, '').trim();
  const tag = /^\[([A-Z]{1,4}\/[^\]\s]+)\]/.exec(first)?.[1] ?? null;
  if (isError) {
    return tag
      ? { outcome: 'refused', rule: tag, result: cut(first, 220) }
      : { outcome: 'error', result: cut(first, 220) };
  }
  if (tag && /refused/i.test(tag)) return { outcome: 'refused', rule: tag, result: cut(first, 220) };
  const out = { outcome: 'ok' };
  if (toolName === 'forum_post') {
    const post = /\[forum\] (fp_\d+) posted/.exec(first)?.[1];
    if (post) out.post = post;
  }
  if (/^judicature_/.test(toolName)) {
    const ref = /\b(case_[0-9a-f]+)\b/.exec(first)?.[1];
    if (ref) out.ref = ref;
  }
  return out;
}
