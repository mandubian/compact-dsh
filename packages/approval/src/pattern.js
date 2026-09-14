// Pattern parsing shared by grants (mirrors the allowlist gate's classes).
export function parseAllowlistLikePattern(r) {
  if (r.startsWith('https://') || r.startsWith('http://')) {
    return { kind: 'UrlPrefix', value: r.endsWith('/') ? r : r + '/' };
  }
  if (r.startsWith('*.')) return { kind: 'HostSuffix', value: r.slice(2).toLowerCase() };
  if (r.includes(':')) { const [h, p] = r.split(':'); return { kind: 'HostAndPort', value: { host: h.toLowerCase(), port: p } }; }
  return { kind: 'ExactHost', value: r.toLowerCase() };
}
