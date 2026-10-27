// The proxy trap, named at launch: Node's built-in fetch IGNORES
// http_proxy/https_proxy unless NODE_USE_ENV_PROXY=1, so on a proxy-only
// network every model call times out and the run spends its rounds on
// TRANSPORT errors (the live finding: a weight-of-voice-v2 re-run's first
// two rounds — ~80 "Connection error." retries, zero replies, zero
// tokens). The README says it; the launch now says it too, where the
// operator is looking. A notice, not a refusal: a host may set proxy
// variables and still have direct egress.
const PROXY_KEYS = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY'];

/** The notice to print, or null when there is nothing to say. */
export function proxyEnvNotice(env = process.env) {
  const set = PROXY_KEYS.filter((k) => typeof env[k] === 'string' && env[k].trim() !== '');
  if (set.length === 0 || env.NODE_USE_ENV_PROXY === '1') return null;
  return `${set[0]} is set but NODE_USE_ENV_PROXY is not — Node's fetch ignores the proxy, so on a ` +
    'proxy-only network every model call times out (TRANSPORT errors, zero replies). ' +
    'Relaunch with NODE_USE_ENV_PROXY=1 if this host has no direct egress.';
}
