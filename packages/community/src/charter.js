// The pure charter model — no I/O, no dsh. A charter is the whole
// community declared as data: the macro goal, the member roster, the
// grants the operator pre-mints, the budgets that bound the run, the
// sources the workspace is seeded with. The driver reads one JSON
// document; everything the runtime does derives from what this file
// validates.
//
// The charter is the OPERATOR'S act. It names what the community may do
// before any member exists — the pre-minted grants, the round budget,
// the wall clock. Members arrive into a world already fenced; the fence
// is data, and this file is where it refuses to be vague.

export const CHARTER_VERSION = 1;

export const DEFAULT_BUDGETS = Object.freeze({
  rounds: 6,
  maxTurnsPerAgent: 8,
  wallClockMinutes: 30,
  tokenCap: 400_000,
});

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TOPIC = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function bad(field, why) {
  return new Error(`charter.${field}: ${why}`);
}

function asSlug(v, field) {
  if (typeof v !== 'string' || !SLUG.test(v)) {
    throw bad(field, `"${String(v).slice(0, 40)}" is not a slug (lowercase letters, digits, dashes; ≤32 chars)`);
  }
  return v;
}

/** Validate and normalize a charter document. Throws with the field and
 *  the reason — a charter the runtime cannot honor refuses here, at the
 *  boundary, never mid-run (D-7). */
export function validateCharter(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw bad('(root)', 'a charter is a JSON object');
  if (doc.version !== undefined && doc.version !== CHARTER_VERSION) {
    throw bad('version', `only charter version ${CHARTER_VERSION} is known (got ${doc.version})`);
  }
  const name = asSlug(doc.name, 'name');
  if (typeof doc.goal !== 'string' || doc.goal.trim().length < 10) {
    throw bad('goal', 'the macro goal is required — a community needs at least a sentence to work on');
  }
  const topic = (typeof doc.topic === 'string' && TOPIC.test(doc.topic)) ? doc.topic : `${name}-floor`;

  const budgets = { ...DEFAULT_BUDGETS, ...(doc.budgets ?? {}) };
  for (const k of ['rounds', 'maxTurnsPerAgent', 'wallClockMinutes', 'tokenCap']) {
    if (!Number.isInteger(budgets[k]) || budgets[k] < 1) {
      throw bad(`budgets.${k}`, `a positive integer, got ${JSON.stringify(budgets[k])}`);
    }
  }

  if (!Array.isArray(doc.members) || doc.members.length === 0) {
    throw bad('members', 'at least one member — a community of nobody is a mood');
  }
  if (doc.members.length > 8) throw bad('members', 'at most 8 members per charter (this is a rehearsal bound, not a law)');
  const members = [];
  const ids = new Set();
  const prefixes = new Set();
  let workers = 0;
  for (const m of doc.members) {
    if (!m || typeof m !== 'object') throw bad('members[]', 'each member is an object');
    const id = asSlug(m.id, 'members[].id');
    const prefix = asSlug(m.prefix ?? `community-${id}`, 'members[].prefix');
    if (ids.has(id)) throw bad('members[].id', `"${id}" declared twice`);
    if (prefixes.has(prefix)) throw bad('members[].prefix', `"${prefix}" declared twice — one prefix, one member`);
    ids.add(id);
    prefixes.add(prefix);
    if (typeof m.persona !== 'string' || m.persona.trim().length < 5) {
      throw bad(`members[${id}].persona`, 'every member carries a persona — what it is FOR, one honest sentence at least');
    }
    const bench = m.bench === true;
    if (!bench) workers += 1;
    members.push({ id, prefix, persona: m.persona.trim(), bench });
  }
  if (workers === 0) throw bad('members', 'at least one non-bench member — a bench with nobody to judge is theater');

  const grants = [];
  for (const g of doc.grants ?? []) {
    if (!g || typeof g !== 'object') throw bad('grants[]', 'each grant is an object');
    if (typeof g.pattern !== 'string' || !g.pattern.trim()) throw bad('grants[].pattern', 'required — the route this row covers (may carry {{RELEASES_ORIGIN}} for the local receiver)');
    const methodClass = g.methodClass ?? 'write';
    if (!['read', 'write'].includes(methodClass)) throw bad('grants[].methodClass', '"read" or "write"');
    const ttlMinutes = g.ttlMinutes ?? 120;
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1) throw bad('grants[].ttlMinutes', 'a positive integer of minutes');
    const maxUses = g.maxUses ?? 40;
    if (!Number.isInteger(maxUses) || maxUses < 1) throw bad('grants[].maxUses', 'a positive integer — a pre-mint without a budget is a blank check');
    if (g.params !== undefined && !/^(free|fixed|allow\([a-z0-9_.,-]*\))$/i.test(g.params)) {
      throw bad('grants[].params', 'params=free | params=fixed | params=allow(a,b)');
    }
    grants.push({ pattern: g.pattern.trim(), methodClass, ttlMinutes, maxUses, ...(g.params !== undefined ? { params: g.params } : {}) });
  }

  const sources = [];
  for (const s of doc.sources ?? []) {
    if (!s || typeof s !== 'object') throw bad('sources[]', 'each source is an object');
    if (typeof s.path !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(s.path) || s.path.includes('..')) {
      throw bad('sources[].path', `unsafe or malformed "${String(s.path).slice(0, 40)}" — a workspace-relative path with no parent escape`);
    }
    if (typeof s.content !== 'string' || !s.content.length) throw bad(`sources[${s.path}].content`, 'required — an empty source seeds nothing');
    sources.push({ path: s.path, content: s.content });
  }

  // the divergence auto-pause (#229): the fence does automatically what the
  // operator would do manually — when the community's total LoopGuard trips
  // or human-seat timeouts cross the line, the engine pauses itself and the
  // page says it is awaiting the Principal. Optional; both keys optional,
  // at least one must be set when the object is declared.
  let divergence = null;
  if (doc.divergence !== undefined) {
    if (!doc.divergence || typeof doc.divergence !== 'object' || Array.isArray(doc.divergence)) {
      throw bad('divergence', 'an object {loopguardTrips, humanSeatTimeouts}');
    }
    for (const key of Object.keys(doc.divergence)) {
      if (!['loopguardTrips', 'humanSeatTimeouts', 'headless'].includes(key)) throw bad(`divergence.${key}`, 'unknown key — {loopguardTrips, humanSeatTimeouts, headless}');
    }
    const limits = {};
    for (const k of ['loopguardTrips', 'humanSeatTimeouts']) {
      const v = doc.divergence[k];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 1) throw bad(`divergence.${k}`, 'a positive integer — the line the community may not cross unpaused');
      limits[k] = v;
    }
    if (doc.divergence.headless !== undefined) {
      if (!['pause', 'stop'].includes(doc.divergence.headless)) {
        throw bad('divergence.headless', '"pause" (default — wait for the Principal; SIGCONT resumes) or "stop" (end the run gracefully — for runs nobody can resume)');
      }
      limits.headless = doc.divergence.headless;
    }
    if (!(limits.loopguardTrips != null || limits.humanSeatTimeouts != null)) throw bad('divergence', 'declare at least one of loopguardTrips, humanSeatTimeouts');
    divergence = limits;
  }

  const publish = doc.publish && typeof doc.publish === 'object'
    ? { note: String(doc.publish.note ?? '').trim() || null, route: String(doc.publish.route ?? '').trim() || null }
    : null;

  // the escalation classes (#219): what the fence routes to the HUMAN
  // rather than the watch — regexes over the ask's reason (the decision
  // card the approval gate publishes), plus the seat's patience
  let escalation = null;
  if (doc.escalation !== undefined) {
    if (!doc.escalation || typeof doc.escalation !== 'object') throw bad('escalation', 'an object {criticalPatterns, askTimeoutMs, questionTimeoutMs}');
    for (const key of Object.keys(doc.escalation)) {
      if (!['criticalPatterns', 'askTimeoutMs', 'questionTimeoutMs'].includes(key)) throw bad(`escalation.${key}`, 'unknown key — {criticalPatterns, askTimeoutMs, questionTimeoutMs}');
    }
    const criticalPatterns = [];
    for (const p of doc.escalation.criticalPatterns ?? []) {
      if (typeof p !== 'string' || !p.trim()) throw bad('escalation.criticalPatterns[]', 'each pattern is a non-empty regex source over the ask\'s reason');
      try {
        new RegExp(p, 'i');
      } catch (e) {
        throw bad('escalation.criticalPatterns[]', `"${p.slice(0, 40)}" does not compile: ${e.message}`);
      }
      criticalPatterns.push(p);
    }
    for (const k of ['askTimeoutMs', 'questionTimeoutMs']) {
      if (doc.escalation[k] !== undefined && (!Number.isInteger(doc.escalation[k]) || doc.escalation[k] < 1000)) {
        throw bad(`escalation.${k}`, 'an integer of milliseconds ≥ 1000 — a human needs at least a second');
      }
    }
    escalation = {
      criticalPatterns,
      ...(doc.escalation.askTimeoutMs !== undefined ? { askTimeoutMs: doc.escalation.askTimeoutMs } : {}),
      ...(doc.escalation.questionTimeoutMs !== undefined ? { questionTimeoutMs: doc.escalation.questionTimeoutMs } : {}),
    };
  }

  return {
    version: CHARTER_VERSION,
    name, goal: doc.goal.trim(), topic,
    budgets,
    members,
    grants,
    sources,
    ...(publish ? { publish } : {}),
    ...(escalation ? { escalation } : {}),
    ...(divergence ? { divergence } : {}),
    ...(typeof doc.briefingExtra === 'string' && doc.briefingExtra.trim() ? { briefingExtra: doc.briefingExtra.trim() } : {}),
  };
}

/** The bindings env value (COMPACT_MEMBER_BINDINGS): the many-member
 *  binding's roster as the boot consumes it. */
export function memberBindingsOf(charter, keyringMembers) {
  const byId = new Map((keyringMembers ?? []).map((k) => [k.id, k]));
  return charter.members.map((m) => {
    const issued = byId.get(m.id);
    if (!issued) throw bad(`members[${m.id}]`, `no key was issued for member "${m.id}" — the keyring and the charter disagree`);
    return { prefix: m.prefix, memberId: m.id, memberKeyPath: issued.keyPath };
  });
}
