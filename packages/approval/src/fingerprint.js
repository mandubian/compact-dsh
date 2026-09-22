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

export function fingerprint(tool, args) {
  const t = canonicalTarget(args);
  // Consent identity is risk identity (#26, folded into #38): when the caller
  // DECLARES a method class, it joins the identity, so approving a read never
  // covers the state-changing act to the same target (GET→GET replays,
  // GET→POST asks). Absent the class the payload is exactly what it always
  // was — every pre-existing fingerprint still matches (no mass re-ask on
  // upgrade).
  const methodClass = args?.methodClass;
  const payload = JSON.stringify({ tool: String(tool), ...t, ...(methodClass ? { methodClass } : {}) });
  return 'fp_' + createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
