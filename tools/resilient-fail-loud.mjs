// The launcher's uncaught-failure classifier. Fail-loud is the right default
// for everything this runtime OWNS: a contract breach, a broken configuration,
// a gate violation — those must stop the composition, never limp on (D-7).
// But a TCP peer reset is not ours: a browser tab closed mid-stream, a refresh
// that tears down an SSE socket, a flaky remote endpoint — the peer's RST
// surfaces as an uncaught ECONNRESET/EPIPE on some socket nobody owns a
// handler for, and the stock fail-loud path then kills the whole governed
// runtime mid-session for weather the network did. The operator restarts
// nothing for that; the boot log says it out loud instead.
//
// This replaces dsh-app-boot's installFailLoud on the launcher's process (the
// two cannot coexist: any fatal handler runs to its exit for every emit). The
// fatal path mirrors it — one loud report, the launcher's own dispose grace,
// exit 1 — so everything the runtime owns stays exactly as loud as before.
//
// Scope is deliberately two error codes — ECONNRESET (peer reset the
// connection) and EPIPE (wrote to a peer already gone). Every other
// exception and rejection, with or without a code, is fatal.

/**
 * Install the classifier.
 * @param {object} options
 * @param {string} options.binName - the log prefix ('compact-dsh').
 * @param {NodeJS.Process} [options.proc] - the process to guard.
 * @param {() => Promise<void>} options.dispose - the launcher's disposal;
 *   the fatal path awaits it (bounded by the launcher's own timeout) before
 *   exiting, exactly like the stock fail-loud release.
 */
export function installResilientFailLoud({ binName, proc = process, dispose }) {
  let exiting = false;
  const fatal = (err, label) => {
    if (exiting) return;
    exiting = true;
    proc.stderr.write(`${binName}: ${label}: ${err?.stack ?? String(err)}\n`);
    void Promise.resolve(dispose?.())
      .catch(() => {})
      .finally(() => proc.exit(1));
  };
  const contained = (err, on) => {
    proc.stderr.write(`${binName}: contained peer reset (${err.code} on ${err.syscall ?? on}): ` +
      `a remote end dropped its connection — the runtime keeps serving; the failed request errors on its own\n`);
  };
  const onException = (err) => {
    if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) return contained(err, 'socket');
    fatal(err, 'fatal uncaught exception');
  };
  const onRejection = (err) => {
    if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) return contained(err, 'rejected stream');
    fatal(err, 'fatal load failure');
  };
  proc.on('uncaughtException', onException);
  proc.on('unhandledRejection', onRejection);
  return () => {
    proc.off('uncaughtException', onException);
    proc.off('unhandledRejection', onRejection);
  };
}
