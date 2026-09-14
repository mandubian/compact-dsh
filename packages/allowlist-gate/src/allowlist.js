// Pure allowlist semantics — no dsh imports. Fully unit-testable.
// Patterns mirror the Compact approval layers (Phase 1 targets):
//   ExactHost, HostSuffix, HostAndPort, UrlPrefix.

/**
 * Parse an allowlist of rule strings into matchers.
 * Accepted forms:
 *   host            → ExactHost          e.g. "api.example.com"
 *   *.suffix        → HostSuffix         e.g. "*.example.com"
 *   host:443        → HostAndPort        e.g. "api.example.com:443"
 *   https://prefix/ → UrlPrefix          e.g. "https://api.example.com/v1/"
 * Each rule keeps the id of the declaration that produced it, so denials
 * can name the exact rule (R-3) and the lawful next moves.
 */
export function parseAllowlist(rules) {
  return rules.map(r => {
    if (r.startsWith('https://') || r.startsWith('http://')) {
      return { kind: 'UrlPrefix', value: r.endsWith('/') ? r : r + '/', id: r };
    }
    if (r.startsWith('*.')) return { kind: 'HostSuffix', value: r.slice(2).toLowerCase(), id: r };
    if (r.includes(':')) {
      const [host, port] = r.split(':');
      return { kind: 'HostAndPort', value: { host: host.toLowerCase(), port }, id: r };
    }
    return { kind: 'ExactHost', value: r.toLowerCase(), id: r };
  });
}

/** Extract {host, port, url} from a tool call's arguments, when present. */
export function extractTarget(args = {}) {
  const out = {};
  if (typeof args.url === 'string') {
    try { const u = new URL(args.url); out.host = u.hostname.toLowerCase(); out.port = u.port || ''; out.url = args.url; }
    catch { /* unparsable url: no target derivable */ }
  }
  if (typeof args.host === 'string') { out.host = args.host.toLowerCase(); }
  if (typeof args.port === 'number' || typeof args.port === 'string') { out.port = String(args.port); }
  return out;
}

function ruleMatches(rule, target) {
  switch (rule.kind) {
    case 'ExactHost':  return target.host != null && target.host === rule.value && target.port == null;
    case 'HostSuffix': return target.host != null && (target.host === rule.value || target.host.endsWith('.' + rule.value)) && target.port == null;
    case 'HostAndPort': return target.host === rule.value.host && target.port === rule.value.port;
    case 'UrlPrefix':  return typeof target.url === 'string' && target.url.startsWith(rule.value);
    default: return false;
  }
}

/**
 * Decide a tool call against the allowlist.
 * Returns { decision: 'allow', rule } | { decision: 'deny', rule: null }.
 * The envelope (rule id + lawful next moves) is built by the plugin layer.
 */
export function decide(target, rules) {
  for (const rule of rules) {
    if (target.host == null && target.url == null) continue; // no network target: not this gate's business
    if (ruleMatches(rule, target)) return { decision: 'allow', rule };
  }
  if (target.host != null || target.url != null) return { decision: 'deny', rule: null };
  return { decision: 'pass' }; // no network target at all: gate abstains
}

/** Compact-shaped denial envelope (R-3/I-4): rule ID + reason + lawful next moves. */
export function envelope(tool, target) {
  return {
    kind: 'deny',
    reason: `DENIED by allowlist gate [AG-1] — "${tool}" to ${target.host ?? ''}${target.port ? ':' + target.port : ''}${target.url ? ' (' + target.url + ')' : ''} is not covered by this runtime's network allowlist.`,
    lawfulNextMoves: [
      'request a scoped session grant for this host (Gates Act, when enacted)',
      'use an approved mirror already on the allowlist',
      'escalate to your Principal with reasons',
    ],
  };
}
