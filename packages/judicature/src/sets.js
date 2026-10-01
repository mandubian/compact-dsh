// compact-dsh-judicature — the pure core: set declarations, the standing
// graph, and the checks J-4 makes mechanical.
//
// THE UNIT OF THE DESIGN (docs/concept-judicature.md, "Adjudicator sets"):
// an adjudicator set is a DECLARED COMPOSITION FACT in the signed annex — a
// named set of roles, each with its standing provenance, over a declared
// dependency graph. Independence is then a graph property, not a promise:
// a seat is independent of a case's parties when no declared edge connects
// the seat's standing to any party's standing — checked the way
// verify-register checks evidence paths exist: mechanically, before
// anything hears.
//
// THE GRAPH IS AN AFFIDAVIT, NOT AN ORACLE. Nodes are shown (the annex is
// signed, F-5); edges are declared, and every edge type in the vocabulary
// below is one the RECORD can cross-examine — that is the admission rule
// for the vocabulary. An edge the record cannot contradict is a promise
// wearing a graph's clothes.
//
// CONNECTIVITY IS UNDIRECTED, on purpose. J-4's own sentence is three
// directions at once: "they" (identity), "their Principal" (upstream), "a
// party dependent on them" (downstream). A conflict of interest runs both
// ways along a dependency, so the check is reachability over the graph
// treated as undirected.
//
// THE CHECKS BIND TO MEMBERS, NOT SESSIONS (J-4/F-6) — since the member
// roll and session binding landed (identity slices 1–2, #124/#125), a
// witness seat names the roll digest of an accredited external, and the
// graph sees keys, lineages, and accreditations. Minds remain the
// ratification world's to show; the vocabulary stays honest about that.

/** Failure shape for every validation refusal in this module. */
export class SetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The kinds of standing a role (or a party) may assert. Each is a node
 *  kind in the graph. `witness` arrived with the accreditation statute
 *  (identity slice 3, #126): an external Witness is seated by an
 *  ACCREDITATION ROW on the member roll — the annex names the roll digest,
 *  the boot verifies the row, and a witness seat whose accreditation the
 *  roll cannot show refuses the boot (an accreditation the record
 *  contradicts is D-8). The root signs no Witness, ever: the chain to A-1
 *  runs through the statute, a document. */
export const STANDING_KINDS = ['principal', 'process', 'plugin', 'key', 'witness'];

/** The edge vocabulary — the closed set of declared dependency types an
 *  annex may assert, each with the record surface that cross-examines it.
 *  Admission rule: a new edge type ships only with the record check that
 *  can contradict it. ARROW DIRECTION IS LOAD-BEARING and uniform across
 *  the vocabulary: every edge points from the DEPENDENT to the DEPENDENCY
 *  (X —directed-by→ Y: X is directed by Y; X —asserts-with→ K: X signs as
 *  K) — so a directed path is "depends on, transitively". */
export const EDGE_VOCABULARY = {
  'directed-by': {
    plain: 'the process/key acts under a Principal\'s direction',
    crossExaminedBy: 'approval acts and ask records name the directing Principal (I-5)',
  },
  'spawned-by': {
    plain: 'the child process was spawned by the parent process',
    crossExaminedBy: 'session/event spawn acts on the record (I-2, bound attribution)',
  },
  'asserts-with': {
    plain: 'the process/principal signs as that key',
    crossExaminedBy: 'the signed annex and the record anchors carry the keyId (F-5, I-2)',
  },
  'runs-in': {
    plain: 'the plugin operates inside that process',
    crossExaminedBy: 'the composition/annex role mapping declares the placement',
  },
};

/** The exclusion scopes J-8/J-1 name for the founder: rule-based, never
 *  discretionary — a recusal computed, not remembered. */
export const FOUNDER_EXCLUSION_SCOPES = ['genesis', 'annex', 'a-8-review'];

const nodeKey = (n) => `${n.kind}:${n.id}`;

function isNodeShape(n) {
  return !!n && typeof n === 'object' && typeof n.kind === 'string'
    && typeof n.id === 'string' && n.id.length > 0;
}

/**
 * Validate the annex's `adjudicatorSets` section, fail-closed (D-7): a
 * malformed declaration is not a missing one, and neither is it ignored.
 *
 * Section shape (all inside the signed annex bytes):
 *   { nodes?: [ {kind, id} ],              // extra declared standing (connective
 *                                           // tissue: e.g. the composition plugin)
 *     sets: [ { id, roles: [ { id, standing: {kind, id} } ],
 *               trajectory: { firstExternalMemberBy, founderExclusions: [...] },
 *               notice? } ],
 *     edges: [ { type, from: {kind,id}, to: {kind,id} } ] }
 *
 * @param {object} [options.witnesses] - the LIVE accredited witness key
 *   digests (resolved from a verified member roll by the caller). A role
 *   declaring `witness` standing names a digest this set must contain, or
 *   the declaration refuses the boot — a seat without a seating is the
 *   fraud D-8 names, the same in rehearsal as at ratification.
 * @returns {{sets: Array, edges: Array, graph: object, enforcerKey: string|null}}
 * @throws {SetError} sets-malformed
 */
export function validateAdjudicatorSets(section, { enforcerKey = null, witnesses = null } = {}) {
  const bad = (detail) => new SetError('sets-malformed',
    `malformed adjudicatorSets section: ${detail} — the declaration is a signed affidavit; a shape that will not validate refuses the boot rather than degrade (D-7)`);
  if (!(section && typeof section === 'object' && Array.isArray(section.sets)
    && Array.isArray(section.edges))) throw bad('must be { nodes?, sets: [...], edges: [...] }');
  if (section.sets.length === 0) throw bad('declares no sets — an empty declaration is no declaration');

  // nodes: extra declared standing + every role's standing + the enforcer key
  const nodeKeys = new Set();
  if (enforcerKey) nodeKeys.add(`key:${enforcerKey}`);
  for (const n of section.nodes ?? []) {
    if (!isNodeShape(n)) throw bad('nodes[] entries must be { kind, id }');
    if (nodeKeys.has(nodeKey(n))) throw bad(`duplicate declared node ${nodeKey(n)}`);
    nodeKeys.add(nodeKey(n));
  }

  const seenSetIds = new Set();
  for (const set of section.sets) {
    if (!(set && typeof set.id === 'string' && set.id.length > 0)) throw bad('a set without a non-empty string id');
    if (seenSetIds.has(set.id)) throw bad(`duplicate set id "${set.id}"`);
    seenSetIds.add(set.id);
    if (!Array.isArray(set.roles) || set.roles.length === 0) throw bad(`set "${set.id}" declares no roles`);
    const seenRoleIds = new Set();
    for (const role of set.roles) {
      if (!(role && typeof role.id === 'string' && role.id.length > 0)) throw bad(`set "${set.id}": a role without a string id`);
      if (seenRoleIds.has(role.id)) throw bad(`set "${set.id}": duplicate role id "${role.id}"`);
      seenRoleIds.add(role.id);
      if (!isNodeShape(role.standing)) throw bad(`role "${role.id}": standing must be { kind, id }`);
      if (!STANDING_KINDS.includes(role.standing.kind)) {
        throw bad(`role "${role.id}": standing kind "${role.standing.kind}" is not in the vocabulary (${STANDING_KINDS.join(', ')})`);
      }
      if (role.standing.kind === 'witness') {
        if (!/^[0-9a-f]{64}$/.test(role.standing.id)) {
          throw bad(`role "${role.id}": witness standing names a member key DIGEST (the accreditation row's coordinate on the roll), not "${role.standing.id}"`);
        }
        if (witnesses == null) {
          throw bad(`role "${role.id}": the annex seats an external Witness but no member roll is composed — witness standing shows an accreditation the roll verifies, and a seat without a seating is the fraud D-8 names`);
        }
        if (!witnesses.has(role.standing.id)) {
          throw bad(`role "${role.id}": no LIVE accreditation on the member roll for ${role.standing.id.slice(0, 12)}… — an accreditation the record contradicts (or does not show) refuses the boot, in rehearsal as at ratification (D-8)`);
        }
      }
      nodeKeys.add(nodeKey(role.standing));
    }
    const t = set.trajectory;
    if (!(t && typeof t === 'object')) throw bad(`set "${set.id}": trajectory is required — "a court whose independence is promised but never scheduled has been promised nothing" (J-8)`);
    if (!t.firstExternalMemberBy || Number.isNaN(new Date(t.firstExternalMemberBy).getTime())) {
      throw bad(`set "${set.id}": trajectory.firstExternalMemberBy must be an ISO date — the schedule is a field, and an expired one is detectable from records`);
    }
    if (!Array.isArray(t.founderExclusions) || t.founderExclusions.length === 0) {
      throw bad(`set "${set.id}": trajectory.founderExclusions must be a non-empty list of rule scopes (${FOUNDER_EXCLUSION_SCOPES.join(', ')})`);
    }
    for (const scope of t.founderExclusions) {
      if (!FOUNDER_EXCLUSION_SCOPES.includes(scope)) {
        throw bad(`set "${set.id}": founder exclusion "${scope}" is not a rule scope (${FOUNDER_EXCLUSION_SCOPES.join(', ')}) — exclusions are computed, never remembered`);
      }
    }
  }

  // edges: closed vocabulary, both endpoints declared (dangling = malformed,
  // fail-closed — an edge to nowhere is exactly the lie the affidavit
  // discipline exists to catch). Two adjacencies, two different questions:
  //   undirected — RECUSAL (J-4): a conflict of interest runs both ways
  //     along a dependency ("they, their Principal, a party dependent on
  //     them" is one sentence in three directions)
  //   directed   — SUBORDINATION (J-5): "not subordinate" is about control,
  //     not co-membership; two seats under one Principal are formally
  //     non-subordinate, and that limit is declared, not hidden
  const adjacency = new Map();
  const directed = new Map();
  for (const n of nodeKeys) { adjacency.set(n, new Set()); directed.set(n, new Set()); }
  const edges = [];
  for (const e of section.edges) {
    if (!(e && EDGE_VOCABULARY[e.type])) {
      throw bad(`edge type "${e?.type}" is not in the vocabulary (${Object.keys(EDGE_VOCABULARY).join(', ')}) — the admission rule is the record surface that can cross-examine it`);
    }
    if (!isNodeShape(e.from) || !isNodeShape(e.to)) throw bad(`${e.type}: from/to must be { kind, id }`);
    if (nodeKey(e.from) === nodeKey(e.to)) throw bad(`${e.type}: a self-loop connects a node to itself and proves nothing`);
    if (!nodeKeys.has(nodeKey(e.from)) || !nodeKeys.has(nodeKey(e.to))) {
      throw bad(`${e.type} ${nodeKey(e.from)} → ${nodeKey(e.to)}: dangling edge — both endpoints must be declared standing (a role's standing, a declared node, or the annex's own enforcer key)`);
    }
    adjacency.get(nodeKey(e.from)).add(nodeKey(e.to));
    adjacency.get(nodeKey(e.to)).add(nodeKey(e.from)); // conflicts run both ways
    directed.get(nodeKey(e.from)).add(nodeKey(e.to));  // dependence has a direction
    edges.push({ type: e.type, from: nodeKey(e.from), to: nodeKey(e.to) });
  }

  return {
    sets: structuredClone(section.sets),
    edges,
    graph: { adjacency, directed },
    enforcerKey: enforcerKey ?? null,
  };
}

/** The empty state: no annex section at all. Not malformed — just undeclared. */
export function undeclared(enforcerKey = null) {
  const adjacency = new Map();
  const directed = new Map();
  if (enforcerKey) {
    adjacency.set(`key:${enforcerKey}`, new Set());
    directed.set(`key:${enforcerKey}`, new Set());
  }
  return { sets: [], edges: [], graph: { adjacency, directed }, enforcerKey };
}

/** Undirected reachability with the path named — the overlap a recusal row
 *  records. Returns the node-key path from a to b, or null. */
export function conflictPath(graph, a, b) {
  if (a === b) return [a];
  const prev = new Map([[a, null]]);
  const queue = [a];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const next of graph.adjacency.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === b) {
        const path = [b];
        for (let p = cur; p !== null; p = prev.get(p)) path.unshift(p);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Directed reachability following the arrows (dependent → dependency): the
 *  path by which a is subordinate to b, or null. Subordination is control,
 *  not co-membership — this is the walk behind J-5's "not subordinate". */
export function subordinationPath(graph, a, b) {
  if (a === b) return [a];
  const prev = new Map([[a, null]]);
  const queue = [a];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const next of graph.directed.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === b) {
        const path = [b];
        for (let p = cur; p !== null; p = prev.get(p)) path.unshift(p);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Recusal is the independence check run per seat (J-1/J-4): a seat whose
 * standing connects to any party's standing REFUSES — refused, not
 * discretionarily withdrawn — and the refusal names the overlap.
 *
 * @param {object} validated - validateAdjudicatorSets output
 * @param {Array<{kind:string,id:string}>} parties - the case's parties as standing nodes
 * @returns {Array<{setId, seats: string[], refusals: Array<{roleId, overlap: string[]}>}>}
 */
export function recusePerSet(validated, parties) {
  const partyKeys = (parties ?? []).filter(isNodeShape).map(nodeKey);
  return validated.sets.map((set) => {
    const refusals = [];
    const seats = [];
    for (const role of set.roles) {
      const seatKey = nodeKey(role.standing);
      let overlap = null;
      for (const pk of partyKeys) {
        if (seatKey === pk) { overlap = [seatKey]; break; }
        const path = conflictPath(validated.graph, seatKey, pk);
        if (path) { overlap = path; break; }
      }
      if (overlap) refusals.push({ roleId: role.id, overlap });
      else seats.push(role.id);
    }
    return { setId: set.id, seats, refusals };
  });
}

/**
 * Resolve the panel for a case: the first declared set that keeps at least
 * one independent seat after recusal, per J-1's cascade. A case whose every
 * declared set recuses is UNHEARD — never dismissed, because dismissal is
 * itself a judgment and nobody lawful remains to make it.
 *
 * @returns {{status:'panel', setId, seats, refusals} | {status:'unheard', attempts}}
 */
export function resolvePanel(validated, parties) {
  const attempts = recusePerSet(validated, parties);
  const first = attempts.find((a) => a.seats.length > 0);
  if (first) return { status: 'panel', ...first, refusals: attempts.flatMap((a) => a.refusals) };
  return { status: 'unheard', attempts };
}

/**
 * Set-level independence, run BETWEEN sets (J-5's "not subordinate" as a
 * graph property — slice 4 consumes this; slice 1 ships and tests it):
 * two sets are independent when no seat of one is SUBORDINATE to any seat
 * of the other — a directed walk along declared dependence, both ways
 * checked. Disjointness runs over declared dependency edges, not common
 * ancestry — two seats under one Principal are formally non-subordinate,
 * and that limit is declared, not hidden.
 *
 * @returns {{independent: boolean, overlap: Array<{a: string, b: string, path: string[]}>}}
 */
export function independenceBetweenSets(validated, setAId, setBId) {
  const a = validated.sets.find((s) => s.id === setAId);
  const b = validated.sets.find((s) => s.id === setBId);
  if (!a || !b) throw new SetError('sets-malformed', `independence asked between unknown sets (${setAId}, ${setBId})`);
  const overlap = [];
  for (const ra of a.roles) {
    for (const rb of b.roles) {
      const path = subordinationPath(validated.graph, nodeKey(ra.standing), nodeKey(rb.standing))
        ?? subordinationPath(validated.graph, nodeKey(rb.standing), nodeKey(ra.standing));
      if (path) overlap.push({ a: ra.id, b: rb.id, path });
    }
  }
  return { independent: overlap.length === 0, overlap };
}

/**
 * Trajectory state is DERIVED from the clock at read time, never stored
 * (the same discipline as a petition's `overdue`): "an expired one is
 * detectable from records" only if expiry is computed on every read.
 */
export function trajectoryState(set, now = Date.now()) {
  const due = new Date(set.trajectory.firstExternalMemberBy).getTime();
  return {
    firstExternalMemberBy: set.trajectory.firstExternalMemberBy,
    founderExclusions: [...set.trajectory.founderExclusions],
    expired: Number.isFinite(due) && now > due,
  };
}
