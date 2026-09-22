// compact-dsh-sandbox-docker — the docker SandboxProvider (port plan Phase 2
// item 1). `confine(argv, policy)` wraps the caller's exact argv as a
// per-call container: no network by default, read-only rootfs, the workspace
// bound ro (`read-only`) or rw plus a tmpfs temp area (`workspace-write`),
// live PathPrefix mount grants of the calling session added as binds at
// their granted ceiling, and the sensitive-path deny-list over-mounted over
// every bound root. Enforcement completeness is reported honestly: `full`
// only after the daemon probe has confirmed the backend; daemon unavailable
// throws SandboxUnavailableError — fail closed, never passthrough.
//
// Verified against the installed @deepseek-ai/dsh-sandbox types: confine is
// synchronous and returns {argv, enforcement, denialSignatures,
// runnerFailureRules}; SandboxPolicy = {mode:'read-only'|'workspace-write',
// workspaceRoot, sessionId?}; the abstract provider registers as ctx.sandbox.
//
// CF-2 (supply-chain honesty, Phase 6): the image is a reused execution
// environment, so every confine re-resolves its content digest and checks it
// against the composition's declared acquisition history. An undeclared image,
// an unresolvable digest, or a tag that has drifted off its record refuses the
// confinement (SupplyChainRefusal, a Compact envelope). Build-time approvals
// are recorded and surfaced but never permit anything at run time — see
// src/provenance.js.
//
// Honest degradation (documented in the annex): the host's sandbox vocabulary
// does not govern network ("network and process visibility are outside this
// vocabulary") — the docker backend confines it anyway (no-network default),
// so a Phase 1 network grant is necessary but never sufficient on this
// backend; `config.network: 'host'` is the composition-level escape hatch.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { spawnSync } from 'node:child_process';
import SandboxProvider, { SANDBOX_UNAVAILABLE, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox';
import { canonicalizeBestEffort, statSafe, within, DEFAULT_SENSITIVE_PATHS } from './mounts.js';
import { normalizeProvenanceRecords, defaultDigestResolver, checkSupplyChain } from './provenance.js';

/** The docker backend's denial dialect (what THIS backend's confinement produces). */
export const DENIAL_SIGNATURES = ['read-only file system', 'permission denied'];
/** Docker CLI failures mean the command never ran — confinement was never the question. */
export const RUNNER_FAILURE_RULES = [
  { allowedExitCodes: [125, 126, 127], fatalSignatures: ['docker: ', 'cannot connect to the docker daemon'] },
];

export function defaultProbe({ dockerCommand, timeoutMs }) {
  try {
    const out = spawnSync(dockerCommand, ['info'], { encoding: 'utf8', timeout: timeoutMs });
    if (out.error) return { ok: false, detail: `docker probe failed: ${out.error.message}` };
    if (out.status !== 0) return { ok: false, detail: `docker info exited ${out.status}: ${String(out.stderr).split('\n')[0] ?? ''}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: `docker probe failed: ${e.message}` };
  }
}

export class DockerSandboxProvider extends SandboxProvider {
  constructor(ctx, config = {}) {
    super(ctx);
    this.image = config.image ?? 'ubuntu:24.04';
    // CF-2: the declared acquisition history of every image this provider may
    // run. Malformed records throw HERE — a composition that cannot state its
    // supply chain does not start claiming the clause (F-5).
    this.imageProvenance = normalizeProvenanceRecords(config.imageProvenance);
    this.digestResolver = config.digestResolver ?? defaultDigestResolver;
    this.dockerCommand = config.dockerCommand ?? 'docker';
    this.network = config.network ?? 'none';
    // #38 phase 3: the MEDIATED posture. 'proxy' attaches to the internal
    // mediation network and hands the container only its own session's
    // listener. Declared without a network name, with 'none', or without the
    // mediator factory → refuse HERE: a posture that cannot deliver is not
    // composed, and it never degrades silently to raw egress or to no path at
    // all (D-7, CF-1).
    this.egress = config.egress ?? 'none';
    this.proxyEnvFor = config.proxyEnvFor;
    if (this.egress === 'proxy') {
      if (!config.network || config.network === 'none') {
        throw new Error('sandbox-docker: egress posture "proxy" needs the internal mediation network NAME (never "none") — refusing (D-7)');
      }
      if (typeof this.proxyEnvFor !== 'function') {
        throw new Error('sandbox-docker: egress posture "proxy" needs proxyEnvFor(sessionId) — the mediator IS the posture; ' +
          'attaching to the mediation network without it would hand the container a path nobody enforces (D-7)');
      }
    }
    this.probeTimeoutMs = config.probeTimeoutMs ?? 5_000;
    this.probe = config.probe ?? defaultProbe;             // injectable: tests never require a daemon
    this.uid = config.uid ?? process.getuid?.() ?? 0;
    this.gid = config.gid ?? process.getgid?.() ?? 0;
    this.maskedPaths = [...DEFAULT_SENSITIVE_PATHS, ...(config.maskedPaths ?? [])].map(canonicalizeBestEffort);
    // (sessionId) => [{path, ceiling, id}] — live PathPrefix grants, wired from the composition
    this.grantsFor = config.grantsFor ?? (() => []);
    // (sessionId) => [grant] — live RUN-TIME network grants. CF-2 answers a
    // run-time demand from these only; build approvals never reach this path.
    this.networkGrantsFor = config.networkGrantsFor ?? (() => []);
    // (sessionId) => [{ref}] — live secret grants. The agreement side lives
    // in the grant store; this side resolves each ref from the Enforcer's
    // environment at confine time and never records the value.
    this.secretsFor = config.secretsFor ?? (() => []);
    this._warnedRefs = new Set();
    this._probeResult = undefined;
    this._digestByRef = new Map();
  }

  /** One bounded probe, cached for the provider's lifetime (mirrors sandbox-local). */
  ensureAvailable(mode) {
    this._probeResult ??= this.probe({ dockerCommand: this.dockerCommand, timeoutMs: this.probeTimeoutMs });
    if (!this._probeResult.ok) throw new SandboxUnavailableError(mode, this._probeResult.detail);
  }

  /** The daemon's content digest for a ref, resolved once per provider lifetime. */
  resolveDigest(ref) {
    if (!this._digestByRef.has(ref)) {
      this._digestByRef.set(ref, this.digestResolver({ dockerCommand: this.dockerCommand, ref, timeoutMs: this.probeTimeoutMs }));
    }
    return this._digestByRef.get(ref);
  }

  /** The declared acquisition history of the image this provider runs, if any. */
  provenance() { return this.imageProvenance.get(this.image); }

  /**
   * CF-2 at confine time: the image carries its acquisition history, that
   * history describes the content that will actually run, and no build-time
   * approval is inherited as run-time reach.
   * @throws {SupplyChainRefusal} carrying the Compact envelope.
   */
  ensureSupplyChain(policy) {
    const refusal = checkSupplyChain({
      ref: this.image,
      record: this.imageProvenance.get(this.image),
      resolved: this.resolveDigest(this.image),
      network: this.network,
      networkGrants: this.networkGrantsFor(policy?.sessionId),
      // #38: under the mediated posture the network is internal — no route
      // exists, so the open-posture rule has no excess to answer; grants are
      // enforced per connection at the mediator instead
      mediated: this.egress === 'proxy',
    });
    if (refusal) throw refusal;
  }

  confine(argv, policy) {
    this.ensureAvailable(policy.mode);
    this.ensureSupplyChain(policy);
    const root = canonicalizeBestEffort(policy.workspaceRoot);
    const run = [this.dockerCommand, 'run', '--rm',
      '--network', this.network, '--read-only',
      '--user', `${this.uid}:${this.gid}`];

    const binds = [];
    if (policy.mode === 'workspace-write') {
      // backend-defined temp area (mirrors the bwrap profile's --tmpfs /tmp)
      run.push('--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777', '--env', 'HOME=/tmp');
      binds.push({ source: root, target: root, rw: true });
    } else {
      binds.push({ source: root, target: root, rw: false });
    }
    // mount grants: the approved extra mounts, at their granted ceiling (ro
    // never upgrades to rw — the ceiling is the bind mode)
    for (const g of this.grantsFor(policy.sessionId)) {
      binds.push({ source: g.path, target: g.path, rw: g.ceiling === 'rw' });
    }
    for (const b of binds) {
      // --mount (not -v): a missing source fails loudly instead of creating it
      run.push('--mount', `type=bind,source=${b.source},target=${b.target}${b.rw ? '' : ',readonly'}`);
    }
    // host-fs deny-list: over-mount masked paths that fall under a bound root
    // (tmpfs hides directories; a ro /dev/null bind hides files). Masked paths
    // outside every bound root are invisible to the container by construction.
    for (const m of this.maskedPaths) {
      if (!binds.some(b => within(b.source, m))) continue;
      const st = statSafe(m);
      if (!st) continue;
      if (st.isDirectory()) run.push('--mount', `type=tmpfs,destination=${m}`);
      else run.push('--mount', `type=bind,source=/dev/null,target=${m},readonly`);
    }
    // secret injection: the agreement side lives in the grant store (a
    // SecretGrant is fingerprint-scoped and operator-approved); this side
    // resolves the env NAME from the Enforcer's own environment at confine
    // time. The value transits the confine argv only — never a log, never
    // model context, never the grant store (which stores the NAME). A ref
    // granted but unresolved from the environment is skipped with a warning:
    // the command will fail visibly on the empty variable, which is the
    // fail-closed direction.
    for (const { ref } of this.secretsFor(policy.sessionId)) {
      const value = process.env[ref];
      if (value === undefined) {
        if (!this._warnedRefs.has(ref)) {
          this._warnedRefs.add(ref);
          this.ctx?.logger?.warn?.(`sandbox-docker: secret ${ref} is granted but not present in the Enforcer environment; skipping injection — the command will fail on the empty variable`);
        }
        continue;
      }
      run.push('--env', `${ref}=${value}`);
    }
    // #38 phase 3: under the mediated posture the container gets exactly ONE
    // path — its own session's listener on the internal network. No listener
    // means no confinement: never a fall-back to raw (an unenforced route),
    // never a silent fall-back to none (the posture was declared; a posture
    // that cannot deliver must say so, D-7).
    if (this.egress === 'proxy') {
      const env = this.proxyEnvFor(policy.sessionId);
      if (!env) {
        throw new Error(`sandbox-docker: the mediator has no listener for session ${policy.sessionId ?? '(none)'} — ` +
          'refusing to confine under an egress posture that cannot deliver (D-7)');
      }
      for (const [key, value] of Object.entries(env)) run.push('--env', `${key}=${value}`);
    }
    run.push('-w', root, this.image, ...argv);
    return { argv: run, enforcement: 'full', denialSignatures: DENIAL_SIGNATURES, runnerFailureRules: RUNNER_FAILURE_RULES };
  }
}

export default DockerSandboxProvider;
export { SANDBOX_UNAVAILABLE };
