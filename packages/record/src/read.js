// R-2 in band — the Subject reads its own record (#67).
//
// "Every Subject may read the record of acts done in its name and on its
// behalf. The Enforcer does not hide actions from the governed. Audit is not a
// privilege of operators; it is a right of the subject."
//
// The composition masks the record root and chain dir from every confined call
// (protected state), and rightly: a Subject that can WRITE its evidence can
// rewrite it. Until this tool, that masking also removed the READ — the record
// was complete and readable by the operator and the offline auditor only,
// which is exactly the posture R-2 forbids. The read path here goes through
// the Enforcer, never the filesystem:
//
//   THROUGH THE CHAIN. Every read is the chained persistence's read, so the
//   slice is verified against the session's hash chain before a single event
//   is rendered. A slice that does not verify is answered as an ALARM naming
//   the break (`broken-link` / `missing-link` / `no-anchor`) — never returned
//   as history (D-7), the same fail-closed discipline the record itself keeps.
//
//   IN ITS NAME AND ON ITS BEHALF. The Subject's own session, in full; and the
//   sessions of its delegated descendants — the acts done on its behalf. The
//   lineage is walked from the DURABLE session headers (`parentSession`), not
//   from any live registry, so the answer is the record's own. Any other
//   session is refused with its reason: another Member's record is not this
//   Subject's history.
//
//   ACTS, NOT MINDS. In a descendant's record the reasoning-bearing events
//   (the model's messages and attempts, compaction summaries, assembled
//   request context) are WITHHELD — R-10 keeps unstated reasoning private
//   except through a declared capability visible to the disclosed-about
//   party, and R-2 grants acts. Withheld events are still LISTED by seq and
//   type, so the Subject sees that they exist and that nothing is missing:
//   "the Enforcer does not hide actions" holds for the record's shape too.
//
//   FRESH AND CITABLE. The session's buffered events are flushed first, so the
//   Subject reads up to its own latest act; every answer names the verified
//   range and the chain head it was read under, so a Subject can cite exactly
//   the record state it relied on.

import { RecordIntegrityError } from './chain.js';

export const RECORD_TOOL = 'record_read';

/** Reasoning-bearing event types: withheld from a descendant's record (R-10). */
export const REASONING_TYPES = new Set(['assistant/message', 'assistant/attempt', 'compaction/summary', 'request/context']);

export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 200;
export const FULL_LIMIT = 10;
const EVENT_CHARS = 500;
const SCAN_CHUNK = 500;
const MAX_DEPTH = 64;

/**
 * Where does `target` stand relative to `caller`? Walked upward from the
 * target's durable header: the caller itself, one of its descendants, or
 * neither (with the reason). Bounded, and cycle-safe: a corrupt lineage still
 * yields an answer.
 */
export async function scopeOf(persistence, caller, target) {
  if (target === caller) return { ok: true, relation: 'self' };
  const seen = new Set();
  let id = target;
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    if (seen.has(id)) return { ok: false, reason: 'its recorded lineage loops, so it cannot be traced to you' };
    seen.add(id);
    const snap = await persistence.stat(id);
    if (!snap) {
      return { ok: false, reason: depth === 1 ? 'no session is recorded under this id in this runtime'
        : `its lineage names ${id}, which is not recorded in this runtime` };
    }
    const parent = snap.header?.parentSession;
    if (parent == null) return { ok: false, reason: 'it is not in your delegation lineage — another Member\'s record is not your history' };
    if (String(parent) === caller) return { ok: true, relation: 'descendant', depth };
    id = String(parent);
  }
  return { ok: false, reason: `its lineage is deeper than ${MAX_DEPTH} and was not followed further` };
}

function typeFilter(types) {
  if (typeof types !== 'string' || !types.trim()) return null;
  const prefixes = types.split(',').map(t => t.trim()).filter(Boolean);
  return prefixes.length ? (type) => prefixes.some(p => type === p || type.startsWith(p.endsWith('/') ? p : `${p}/`)) : null;
}

function renderEvent(event, { withheld, full }) {
  const time = typeof event.time === 'number' ? new Date(event.time).toISOString() : '-';
  const head = `#${event.seq} ${event.type} ${time}`;
  if (withheld) return `${head} — withheld: another Member's reasoning (R-10)`;
  const { seq: _s, type: _t, time: _m, ...rest } = event;
  let body;
  try { body = JSON.stringify(rest.data !== undefined && Object.keys(rest).length === 1 ? rest.data : rest); } catch { body = '(unrenderable)'; }
  if (body === undefined) body = '';
  if (!full && body.length > EVENT_CHARS) {
    body = `${body.slice(0, EVENT_CHARS)}… [+${body.length - EVENT_CHARS} chars — read it with from_seq=${event.seq}, full=true]`;
  }
  return `${head} ${body}`;
}

/**
 * Answer one record_read call, as text. `deps` is the record's own surface:
 * the chained persistence (verifies on read), `length` (events the chain
 * commits), the head, and a flush for the target's buffered writer.
 */
export async function readRecord(deps, { caller, session, fromSeq, limit, types, full } = {}) {
  if (caller == null) return '[R-2] No calling Subject is identifiable, so there is no "own record" to read.';
  const target = typeof session === 'string' && session.trim() ? session.trim() : caller;
  const scope = await scopeOf(deps.persistence, caller, target);
  if (!scope.ok) {
    return `[R-2] The record of "${target}" is not yours to read: ${scope.reason}. R-2 covers acts done in your ` +
      'name and on your behalf — your own session and those of Members you delegated to. Call record_read with ' +
      'no session for your own.';
  }

  try { await deps.flush?.(target); } catch { /* a flush failure must not block the read; the range says what was read */ }

  const withheldType = (type) => scope.relation === 'descendant' && REASONING_TYPES.has(type);
  const filter = typeFilter(types);
  const cap = full === true ? FULL_LIMIT : MAX_LIMIT;
  const asked = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : (full === true ? FULL_LIMIT : DEFAULT_LIMIT);
  const n = Math.max(1, Math.min(cap, asked));
  const hasFrom = fromSeq !== null && fromSeq !== undefined && Number.isFinite(Number(fromSeq));
  const from = hasFrom ? Math.max(0, Math.floor(Number(fromSeq))) : null;
  const committed = deps.length(target);

  // BOUNDED READS. Only what the answer needs is read — and every event read
  // is verified by the chained handle:
  //   - no filter: the window itself. The tail read runs to the END OF THE
  //     LOG (no length bound), so an event appended outside the chain still
  //     trips `missing-link` rather than sitting unseen past the window;
  //   - a type filter: a chunked scan holding at most `n` matches in memory.
  let window;
  let verified = null;   // [first, last] seq of everything read and verified
  try {
    const handle = await deps.persistence.open(target, 'read');
    try {
      const mark = (events) => {
        if (!events.length) return;
        verified = verified ? [Math.min(verified[0], events[0].seq), Math.max(verified[1], events.at(-1).seq)]
          : [events[0].seq, events.at(-1).seq];
      };
      if (!filter) {
        const { events } = hasFrom ? await handle.read(from, n) : await handle.read(Math.max(0, committed - n));
        mark(events);
        window = hasFrom ? events : events.slice(-n);
      } else {
        const matches = [];
        let offset = hasFrom ? from : 0;
        for (;;) {
          const { events } = await handle.read(offset, SCAN_CHUNK);
          mark(events);
          for (const e of events) {
            if (!filter(e.type)) continue;
            matches.push(e);
            if (!hasFrom && matches.length > n) matches.shift();
          }
          offset += events.length;
          if (events.length < SCAN_CHUNK || (hasFrom && matches.length >= n)) break;
        }
        window = hasFrom ? matches.slice(0, n) : matches;
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof RecordIntegrityError || error?.name === 'RecordIntegrityError') {
      return `[R-2 ALARM] The record of "${target}" does not verify against its chain — ${error.kind ?? 'integrity failure'} ` +
        `at seq ${error.seq ?? '?'}. It is not returned: unverified history is not history (D-7, I-2). This is a ` +
        'record-integrity event — tell your operator; the offline auditor with the chain file names the break.';
    }
    return `[R-2] The record of "${target}" could not be read: ${String(error?.message ?? error)}.`;
  }

  const withheldCount = window.filter(e => withheldType(e.type)).length;
  const whose = scope.relation === 'self' ? 'your own session' : `a session delegated from yours (depth ${scope.depth})`;

  const lines = [
    `[R-2] The record of "${target}" — ${whose}.`,
    committed > 0
      ? `The chain commits events 0..${committed - 1} (${committed}); chain head ${deps.head(target)}.`
      : `The record holds no events yet; chain head ${deps.head(target)}.`,
    verified ? `Verified against the chain: every event read, #${verified[0]}..#${verified[1]}.` : null,
    scope.relation === 'descendant'
      ? 'Acts only: reasoning-bearing events are listed by seq and type and their content withheld (R-10).'
      : null,
    window.length
      ? `Showing ${window.length} event(s)${filter ? ` matching "${types}"` : ''}: #${window[0].seq}..#${window.at(-1).seq}` +
        `${withheldCount ? `, ${withheldCount} withheld` : ''}. Page with from_seq and limit (max ${MAX_LIMIT}; ${FULL_LIMIT} with full=true).`
      : `No events${filter ? ` match "${types}"` : ''} in the requested range.`,
    '',
    ...window.map(e => renderEvent(e, { withheld: withheldType(e.type), full: full === true })),
  ].filter(l => l !== null);
  return lines.join('\n');
}
