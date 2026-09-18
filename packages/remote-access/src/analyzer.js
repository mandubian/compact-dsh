// Static network-access analysis of shell args (port plan Phase 2 item 3,
// the runtime/remote_access.rs port). Pure logic over (tool, args): no host,
// no I/O. The analyzer OVER-approximates — a URL literal in a command string
// is treated as network intent even in `echo` — because static analysis
// cannot prove the negative and the port's doctrine is fail-closed.
//
// Findings come in two shapes:
//   target   — {host} | {host, port} | {url}: routed through the Phase 1
//              grant layers (approvable per-host, not per-command)
//   opaque   — a network verb with no statically resolvable target: the gate
//              cannot grant it per-host, so it is refused with an envelope
//              (fail-closed) rather than asked forever
//
// Package-manager verbs resolve through packageHosts — the DEFAULT registry
// per ecosystem (npm→registry.npmjs.org, …). A registry override in tool
// config is invisible to static analysis; compositions that override
// registries MUST override packageHosts too (recorded in the annex).

const DEFAULT_COMMAND_ARG_KEYS = ['command', 'cmd', 'script'];

const DEFAULT_PACKAGE_HOSTS = {
  npm: 'registry.npmjs.org', pnpm: 'registry.npmjs.org', yarn: 'registry.npmjs.org', bun: 'registry.npmjs.org',
  pip: 'pypi.org', pip3: 'pypi.org', pipx: 'pypi.org',
  cargo: 'crates.io', go: 'proxy.golang.org', gem: 'rubygems.org',
  apt: 'archive.ubuntu.com', 'apt-get': 'archive.ubuntu.com',
  docker: 'registry-1.docker.io', podman: 'registry-1.docker.io', helm: 'registry-1.docker.io',
};

// verbs whose presence in a command token stream means network access
const NETWORK_VERBS = new Set([
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat',
  'telnet', 'ftp', 'ping', 'dig', 'nslookup', 'host', 'traceroute', 'mtr',
]);
const GIT_NETWORK_SUB = new Set(['clone', 'fetch', 'pull', 'push', 'ls-remote', 'submodule']);
const PACKAGE_VERBS = {
  npm: ['install', 'add', 'i', 'ci', 'update'], pnpm: ['install', 'add', 'i', 'update'],
  yarn: ['install', 'add'], bun: ['install', 'add', 'i'],
  pip: ['install', 'download'], pip3: ['install', 'download'], pipx: ['install'],
  cargo: ['install', 'add', 'fetch'], go: ['get', 'install', 'mod'],
  gem: ['install'], apt: ['install', 'update', 'upgrade'], 'apt-get': ['install', 'update', 'upgrade'],
  docker: ['pull', 'push'], podman: ['pull', 'push'], helm: ['install', 'pull', 'push'],
};

// read-only inspectors: a network verb as their bare ARGUMENT is a mention,
// not an invocation (issue #5) — `command -v curl` proves a presence, it does
// not open a socket. 'command' qualifies ONLY with -v: bare `command curl`
// executes curl. The inspector must itself be in command position.
const VERB_INSPECTORS = new Set(['command', 'which', 'type', 'whence', 'man', 'whatis', 'whereis', 'apropos']);

const URL_RE = /https?:\/\/[^\s'"`<>()\[\]{}|\\;]+/gi;      // matchAll only (global = stateful)
const URL_ONCE = /https?:\/\/[^\s'"`<>()\[\]{}|\\;]+/i;      // .test only
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const SCP_LIKE_RE = /^[\w.-]+@([\w.-]+):/; // git@github.com:org/repo
// shell-naive tokenization: separators are their own matches so command
// position is decidable — a token opens a command when it is the first token
// or follows && || ; | ( ) (hence also $( — substitution stays an invocation)
const TOKEN_RE = /&&|\|\||[;|()]|[^\s;&|()]+/g;
const SEPARATORS = new Set(['&&', '||', ';', '|', '(', ')']);

function validIpv4(s) {
  return s.split('.').every(o => Number(o) <= 255);
}

function hostOf(token) {
  if (!token || token.includes('/')) return null;
  const scp = SCP_LIKE_RE.exec(token);
  if (scp) return scp[1];
  if (token.includes('@')) token = token.slice(token.lastIndexOf('@') + 1);
  // 'host:port' keeps the host when the port is numeric; any OTHER colon use
  // (header values like 'X-Foo: y', URLs, times) is not a host token
  const colon = token.indexOf(':');
  if (colon >= 0) {
    if (!/^\d+$/.test(token.slice(colon + 1))) return null;
    token = token.slice(0, colon);
  }
  // a gated host is an FQDN or an IP — a bare word ('Bearer', 'origin',
  // 'localhost') is never statically provable as a network target
  return /^[\w.-]+$/.test(token) && /[a-zA-Z0-9]/.test(token) && token.includes('.') ? token : null;
}

/** Is this token a flag/option assignment rather than a positional? */
function isFlag(token) {
  return token.startsWith('-') || /^[\w-]+=/.test(token);
}

/** The remote of a verb invocation: prefer remote-shaped tokens (@, scp-colon,
 *  URLs), then dotted hosts/IPs; a URL token belongs to rule 1. */
function remoteOf(rest) {
  return rest.find(t => SCP_LIKE_RE.test(t) || t.includes('@') || URL_ONCE.test(t))
       ?? rest.find(t => hostOf(t) || IPV4_RE.test(t))
       ?? null;
}

export function createAnalyzer({ commandArgKeys = DEFAULT_COMMAND_ARG_KEYS, packageHosts = DEFAULT_PACKAGE_HOSTS } = {}) {
  function findingsIn(command, argKey) {
    const out = [];
    // 1. URL literals — the target carries BOTH the url and its host: the
    // exec cache keys per (tool, url), while host-shaped session grants
    // (ExactHost/HostSuffix) match the host — "approvable per-host"
    for (const m of command.matchAll(URL_RE)) {
      try {
        const u = new URL(m[0]);
        out.push({ arg: argKey, match: m[0], kind: 'url', target: { url: m[0], host: u.hostname.toLowerCase() } });
      } catch {
        out.push({ arg: argKey, match: m[0], kind: 'url', target: null, verb: 'url' });
      }
    }
    // 2. verb-led forms — tokens carry their command-position flag; head is
    // the bare name of the command whose argument list we are inside
    const tokens = [];
    const cmdPos = [];
    let atCmd = true;
    for (const m of command.matchAll(TOKEN_RE)) {
      if (SEPARATORS.has(m[0])) { atCmd = true; continue; }
      tokens.push(m[0]);
      cmdPos.push(atCmd);
      atCmd = false;
    }
    let head = null; // {name, index} of the current command's head token
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const bare = tok.replace(/^.*\//, ''); // /usr/bin/curl → curl
      if (cmdPos[i]) head = { name: bare, index: i };
      if (bare === 'git') {
        const sub = tokens[i + 1];
        if (!GIT_NETWORK_SUB.has(sub)) continue;
        const rest = tokens.slice(i + 2).filter(t => !isFlag(t));
        const remote = remoteOf(rest);
        if (!remote) {
          // 'git push origin main' — a remote NAME is not statically resolvable
          out.push({ arg: argKey, match: `git ${sub}`, kind: 'host', target: null, verb: 'git' });
        } else if (URL_ONCE.test(remote)) {
          // rule 1 owns the URL finding
        } else {
          const scp = SCP_LIKE_RE.exec(remote);
          const ip = remote.match(IPV4_RE)?.[0];
          const h = scp ? scp[1] : (ip ?? hostOf(remote));
          out.push(h
            ? { arg: argKey, match: `git ${sub} ${remote}`, kind: 'host', target: { host: h }, verb: 'git' }
            : { arg: argKey, match: `git ${sub} ${remote}`, kind: 'host', target: null, verb: 'git' });
        }
        continue;
      }
      if (NETWORK_VERBS.has(bare)) {
        // issue #5: a verb MENTIONED as a bare argument to a read-only
        // inspector in command position never invokes — drop the finding.
        // ONLY the inspector list suppresses, and only bare tokens (a path
        // form like /usr/bin/curl is verb-recognised in command position
        // only). Everything else — `echo curl`, `sudo curl`, `xargs curl`,
        // `$(curl …)` — keeps the opaque fail-closed behavior: echo is
        // benign, but the doctrine narrows only what is PROVABLY non-invoking.
        if (!cmdPos[i] && tok === bare && head && VERB_INSPECTORS.has(head.name)
            && (head.name !== 'command' || tokens.slice(head.index + 1, i).includes('-v'))) {
          continue;
        }
        const rest = tokens.slice(i + 1).filter(t => !isFlag(t));
        const positional = remoteOf(rest);
        if (!positional) {
          out.push({ arg: argKey, match: bare, kind: 'host', target: null, verb: bare });
        } else if (URL_ONCE.test(positional)) {
          // rule 1 owns the URL finding
        } else {
          const scp = SCP_LIKE_RE.exec(positional);
          const ip = positional.match(IPV4_RE)?.[0];
          const h = scp ? scp[1] : (ip ?? hostOf(positional));
          if (!h) {
            out.push({ arg: argKey, match: `${bare} ${positional}`, kind: 'host', target: null, verb: bare });
          } else {
            // nc-style port pairing only — 'ping -c 1' is not a port
            const portVerb = ['nc', 'ncat', 'netcat', 'telnet'].includes(bare);
            const after = portVerb ? rest.slice(rest.indexOf(positional) + 1).find(t => /^\d+$/.test(t)) : null;
            out.push({ arg: argKey, match: `${bare} ${positional}`, kind: 'host', target: after ? { host: h, port: after } : { host: h }, verb: bare });
          }
        }
        continue;
      }
      const pkgSub = PACKAGE_VERBS[bare];
      if (pkgSub && pkgSub.includes(tokens[i + 1])) {
        const host = packageHosts[bare] ?? null;
        out.push({ arg: argKey, match: `${bare} ${tokens[i + 1]}`, kind: 'host', target: host ? { host } : null, verb: bare });
      }
    }
    // 3. bare IP literals anywhere (e.g. a redirected /dev/tcp target)
    for (const m of command.matchAll(new RegExp(IPV4_RE.source, 'g'))) {
      if (validIpv4(m[0])) out.push({ arg: argKey, match: m[0], kind: 'host', target: { host: m[0] } });
    }
    return out;
  }

  return {
    /**
     * Network-access findings for one tool execution, deduplicated by target.
     * Only command-shaped argument keys are scanned (config.commandArgKeys).
     */
    findings(exec) {
      const args = exec?.arguments ?? {};
      const found = [];
      for (const key of commandArgKeys) {
        const value = args[key];
        if (typeof value === 'string') found.push(...findingsIn(value, key));
      }
      const seen = new Set();
      return found.filter(f => {
        const k = f.target ? JSON.stringify(f.target) : `opaque:${f.verb}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
  };
}

export { DEFAULT_COMMAND_ARG_KEYS, DEFAULT_PACKAGE_HOSTS };
