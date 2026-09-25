// Canonical operation fingerprints: the same operation on the same target is
// the same call, however phrased (R-3/I-5 exec-cache identity).
import { createHash } from 'node:crypto';

export function canonicalTarget({ host, port, url } = {}) {
  const out = {};
  if (typeof url === 'string') {
    try {
      const u = new URL(url);
      out.url = `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}${u.pathname.replace(/\/+$/, '')}/`;
    } catch { /* unparsable: left uncaptured */ }
  }
  if (typeof host === 'string') out.host = host.toLowerCase();
  if (port != null && port !== '' && !(url && ((url.startsWith('https:') && String(port) === '443') || (url.startsWith('http:') && String(port) === '80')))) {
    out.port = String(port);
  }
  return out;
}

/**
 * The query string joins the REPLAY identity (#8 G5, tightened — decision:
 * docs/decision-secret-hygiene.md). A query is operation parameters, not
 * target spelling: approving `?page=1` never covers `?page=2`, and an
 * allowed-once call never replays with different credentials riding the
 * query — the operator approved the operation they were shown, nothing
 * wider (the old query-stripped identity let one approval authorize every
 * query variant of the target until the TTL, without a decision). Wider
 * coverage remains a grant's explicit act (UrlPrefix matching stays
 * prefix-over-path; grants match raw URLs regardless of query).
 *
 * Normalization: parameter ORDER is not identity (`?a=1&b=2` ≡ `?b=2&a=1`,
 * and repeated names collapse by sorted name=value); everything else —
 * names, values, presence — is exact. Absent or empty query contributes no
 * component. The query lives only inside the one-way fingerprint payload —
 * like the path, it is never persisted or rendered from here.
 */
export function canonicalQuery(url) {
  if (typeof url !== 'string') return null;
  try {
    const params = [...new URL(url).searchParams.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    return params.length ? params.join('&') : null;
  } catch { return null; }   // unparsable: no query component, like canonicalTarget
}

export function fingerprint(tool, args) {
  const t = canonicalTarget(args);
  // Consent identity is risk identity (#26, folded into #38): when the caller
  // DECLARES a method class, it joins the identity, so approving a read never
  // covers the state-changing act to the same target (GET→GET replays,
  // GET→POST asks). Absent the class the payload is exactly what it always
  // was — every pre-existing fingerprint still matches (no mass re-ask on
  // upgrade).
  const methodClass = args?.methodClass;
  // #8 G5: the query joins the replay identity (canonicalQuery above). One
  // upgrade cost, stated in the decision record: persisted cache entries
  // keyed on the old query-stripped fingerprint simply never match again and
  // expire within the TTL — fail-closed, never fail-open.
  const q = canonicalQuery(args?.url);
  // #26's bash half (docs/decision-bash-effect-class.md, option A): a
  // target-less call's command IS its identity. canonicalTarget extracts only
  // host/port/url, so a bare bash command contributed nothing and every
  // command hashed to the same fingerprint — approving `ls /` admitted
  // `rm -rf` for the cache TTL. The command joins the payload exactly as the
  // gate's secret-reference path already hashes it: allow-once covers exactly
  // this command, never a blanket over the tool. Target-ful calls are
  // untouched (the network family's phrasing abstraction stands; the finding
  // gates fingerprint per-target), and no normalization — a whitespace
  // variant is a new ask, because normalization is abstraction. Persisted
  // entries keyed on the old constant fingerprint never match again and
  // expire within the TTL — fail-closed, never fail-open.
  // #26's bash half, option A: a target-less call's command IS its identity —
  // canonicalTarget extracts only host/port/url, so a bare bash command
  // contributed nothing and every command hashed to the same fingerprint. The
  // command joins the payload exactly as the gate's secret-reference path
  // already hashes it: allow-once covers exactly this command, never a
  // blanket over the tool.
  //
  // #26's bash half, option B (adopted on top of A): the analyzer's bash
  // effect class refines who joins. A command the classifier PROVES read-only
  // carries the class identity instead — class+verb, the record's granularity
  // decision — so the read family keeps a phrasing abstraction of its own
  // (target-less: `ls /a` and `ls /b` are one `ls` identity; target-ful: the
  // payload is UNCHANGED, zero churn for the network family). A command the
  // classifier cannot prove — mutating, off-vocabulary, unresolvable, a
  // non-bash wrapper (effectClass null) — falls back to A's exact-command
  // payload for target-less AND target-ful calls alike: that is what closes
  // the measured compound rider (`curl x && rm -rf /workspace` stops sharing
  // the plain read's identity). No normalization anywhere — a whitespace
  // variant of a command-scoped act is a new ask, because normalization is
  // abstraction. Persisted entries keyed on any superseded payload shape
  // never match again and expire within the TTL — fail-closed, never
  // fail-open.
  const isTargetless = Object.keys(t).length === 0;
  const effectClass = args?.effectClass;   // 'read' | null (unprovable) | undefined (undeclared)
  // the command joins when nothing finer vouches for the act: a target-less
  // call whose class was not declared (option A) or whose class is null
  // (unprovable — option B, target-ful included). A declared read carries the
  // class identity instead — the command stays out of its payload.
  const command = ((isTargetless && effectClass !== 'read') || effectClass === null) && typeof args?.command === 'string' && args.command.length > 0
    ? args.command
    : null;
  const effect = isTargetless && effectClass === 'read' && Array.isArray(args?.effectVerbs) && args.effectVerbs.length > 0
    ? { effectClass, verbs: args.effectVerbs }
    : null;
  const payload = JSON.stringify({
    tool: String(tool),
    ...t,
    ...(effect ?? {}),
    ...(command ? { command } : {}),
    ...(methodClass ? { methodClass } : {}),
    ...(q != null ? { urlQuery: q } : {}),
  });
  return 'fp_' + createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
