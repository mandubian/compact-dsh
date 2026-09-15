// classify_tool_result port (port plan Phase 3): the frozen tools/result
// outcome → {outcome, errorClass, terminal}. The classes feed the trip
// budgets; terminal is the deterministic trip (LG-7).
//
// The denial classes recognize the docker backend's own dialect (the
// sandbox-docker denial signatures) so a confinement denial is accounted as
// 'denied', not an anonymous failure.

const DENIED = ['read-only file system', 'permission denied', 'eacces', 'eperm', 'not permitted', 'access denied'];
const NOT_FOUND = ['enoent', 'no such file', 'does not exist', 'not found'];
const TIMEOUT = ['timeout', 'etimedout', 'timed out'];
const REJECTED = ['rejected', 'the user rejected', 'was cancelled'];
export const DEFAULT_TERMINAL_CODES = ['workflow_terminal', 'terminal_error', 'workflow_failed', 'unrecoverable'];

export function classifyToolResult(result, { terminalCodes = DEFAULT_TERMINAL_CODES } = {}) {
  if (!result?.isError) return { outcome: 'success', errorClass: null, terminal: false };
  const err = result.error ?? {};
  const text = String(err.message ?? err.code ?? JSON.stringify(err.content ?? result.content ?? '')).toLowerCase();
  if (terminalCodes.some(c => text.includes(c.toLowerCase()))) {
    return { outcome: 'failure', errorClass: 'terminal', terminal: true };
  }
  let errorClass = 'unknown';
  if (DENIED.some(s => text.includes(s))) errorClass = 'denied';
  else if (NOT_FOUND.some(s => text.includes(s))) errorClass = 'not-found';
  else if (TIMEOUT.some(s => text.includes(s))) errorClass = 'timeout';
  else if (REJECTED.some(s => text.includes(s))) errorClass = 'rejected';
  return { outcome: 'failure', errorClass, terminal: false };
}
