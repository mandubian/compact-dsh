// Provision the mediation network (#38 phase 3): the internal bridge whose
// only meaning is "the confined container has a path to its session's
// mediator and no route anywhere else". Inspect-or-create, then INSPECT the
// facts that make the posture true — an existing network that is not
// internal, or one with no gateway to bind, refuses the boot by name rather
// than letting a declared egress posture quietly become raw egress (CF-1,
// D-8, D-7; spec: docs/decision-network-egress-proxy.md).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * @param {object} options
 * @param {string} options.name - the docker network NAME (never 'none').
 * @param {(args: string[]) => Promise<string>} [options.run] - injectable
 *   `docker …` runner (tests); defaults to the real CLI.
 * @returns {Promise<{name: string, gateway: string, driver: string, id: string}>}
 */
export async function ensureEgressNetwork({ name: requested, run } = {}) {
  // normalize ONCE: the trimmed value is what every docker call and the
  // refusal below see (a padded "none" or whitespace name refuses like its
  // bare form — the posture check reads the name the daemon will get)
  const name = typeof requested === 'string' ? requested.trim() : requested;
  if (typeof name !== 'string' || !name || name === 'none') {
    throw new Error(
      `compact-dsh-egress-proxy: the mediation network must be a docker network NAME (never "none"), got ` +
      `${JSON.stringify(name)} — an egress posture with no network is a declared capability that cannot deliver (D-7)`);
  }
  const exec = run ?? (async (args) => (await execFileAsync('docker', args, { timeout: 15_000 })).stdout.trim());

  const inspect = async () => {
    const out = await exec(['network', 'inspect', name, '--format', '{{.Id}}|{{.Driver}}|{{.Internal}}|{{(index .IPAM.Config 0).Gateway}}']);
    const [id, driver, internal, gateway] = String(out).trim().split('|');
    return { id, driver, internal: internal === 'true', gateway };
  };

  let info;
  try {
    info = await inspect();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!/no such network|not found/i.test(message)) {
      throw new Error(`compact-dsh-egress-proxy: cannot inspect the mediation network "${name}": ${message} — refusing to start (D-7)`);
    }
    try {
      await exec(['network', 'create', '--internal', '--driver', 'bridge', name]);
      info = await inspect();
    } catch (createError) {
      // a race is fine: whoever created it, the inspection below decides
      try { info = await inspect(); }
      catch {
        throw new Error(
          `compact-dsh-egress-proxy: cannot provision the internal mediation network "${name}": ` +
          `${String(createError?.message ?? createError)} — refusing to start rather than boot an egress posture with no mediator (D-7)`);
      }
    }
  }

  if (!info.internal) {
    throw new Error(
      `compact-dsh-egress-proxy: docker network "${name}" exists but is NOT internal — the mediation plane must carry ` +
      `no route (the container's only path is to its session's mediator); refusing rather than composing raw egress (CF-1, D-8)`);
  }
  if (!info.gateway) {
    throw new Error(
      `compact-dsh-egress-proxy: docker network "${name}" has no gateway address — the mediator has nothing to bind and ` +
      `the posture cannot deliver (D-7)`);
  }
  return { name, gateway: info.gateway, driver: info.driver, id: info.id };
}
