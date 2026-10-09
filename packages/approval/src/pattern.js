// Pattern parsing shared by grants (mirrors the allowlist gate's classes).
// Canonicalization is security (docs/concept-approval-layers.md): a pattern
// must match the CANONICAL form of a target — the same normalization the
// fingerprint applies. Hosts are case-insensitive; URL authorities are
// lowercased here exactly as canonicalTarget does, while URL paths keep
// their case (paths are case-sensitive on many servers).
//
// #176 slice 1 — the query axis. A URL pattern typed WITH a query carries its
// PARAMETER NAMES (`params: { mode:'allow', names }`) — the operator typed
// `?q=` meaning "queries like this", never a specific value (values are
// operation parameters, not target spelling — G5 — and never persist here).
// A pattern without a query carries no axis: the row's query breadth is the
// legacy free one, unless an explicit params token says otherwise
// (grants-grant) or an offer mints one (#175's answers).
export function parseAllowlistLikePattern(r) {
  if (r.startsWith('https://') || r.startsWith('http://')) {
    const raw = r.endsWith('/') ? r : r + '/';
    try {
      const u = new URL(raw);
      const authority = `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}`;
      const names = [...new Set([...u.searchParams.keys()])].sort();
      const pattern = { kind: 'UrlPrefix', value: authority + u.pathname };
      if (names.length) pattern.params = { mode: 'allow', names };
      return pattern;
    } catch { /* unparsable pattern: matches nothing, fails closed */ }
    return { kind: 'UrlPrefix', value: '\u0000never:' + raw };
  }
  if (r.startsWith('*.')) return { kind: 'HostSuffix', value: r.slice(2).toLowerCase() };
  if (r.includes(':')) { const [h, p] = r.split(':'); return { kind: 'HostAndPort', value: { host: h.toLowerCase(), port: p } }; }
  return { kind: 'ExactHost', value: r.toLowerCase() };
}
