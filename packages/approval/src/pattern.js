// Pattern parsing shared by grants (mirrors the allowlist gate's classes).
// Canonicalization is security (docs/concept-approval-layers.md): a pattern
// must match the CANONICAL form of a target — the same normalization the
// fingerprint applies. Hosts are case-insensitive; URL authorities are
// lowercased here exactly as canonicalTarget does, while URL paths keep
// their case (paths are case-sensitive on many servers).
export function parseAllowlistLikePattern(r) {
  if (r.startsWith('https://') || r.startsWith('http://')) {
    const raw = r.endsWith('/') ? r : r + '/';
    try {
      const u = new URL(raw);
      const authority = `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}`;
      return { kind: 'UrlPrefix', value: authority + u.pathname };
    } catch { /* unparsable pattern: matches nothing, fails closed */ }
    return { kind: 'UrlPrefix', value: '\u0000never:' + raw };
  }
  if (r.startsWith('*.')) return { kind: 'HostSuffix', value: r.slice(2).toLowerCase() };
  if (r.includes(':')) { const [h, p] = r.split(':'); return { kind: 'HostAndPort', value: { host: h.toLowerCase(), port: p } }; }
  return { kind: 'ExactHost', value: r.toLowerCase() };
}
