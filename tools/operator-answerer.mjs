// Attended-mode operator answerer for the compact-dsh launcher (opt-in
// `--attended`): the human gate on the terminal. Registered on the settled
// boot context AFTER the compact composition, so compact-approval's recorded
// answerer claims its own asks first and delegates the decision via next();
// this answerer is the downstream decider the deny→ask→approve→replay cycle
// materializes through. Fail-closed by construction: empty answer, EOF, ^C,
// and malformed input all answer 'rejected'; asks without a compact envelope
// reason are delegated untouched (no further answerer → host 'unavailable').
// The prompt writes to stderr only — stdout stays clean for the task output.
// The wire request carries agent + toolName + callId? + reason? + signal?
// (no tool arguments). The prompt therefore shows exactly those fields, plus
// the compact gate's per-decision preview when available: the recorded
// answerer publishes {command, target, fingerprint} on
// approval.deciding for exactly the decision's duration, so the operator
// approves the actual command — never a bare "bash" with a fingerprint.

import { createInterface as defaultCreateInterface } from 'node:readline';

// Only the compact gate's envelope asks are the operator's business; anything
// else reaching this point is not ours to decide and fails closed downstream.
const COMPACT_ENVELOPE_REASON = /^\[AG(\/|\])/;
const OUTCOMES = ['allowed-once', 'rejected'];

export function createOperatorPrompter({ input = process.stdin, output = process.stderr, createInterface = defaultCreateInterface } = {}) {
  return function prompt(req, view) {
    return new Promise(resolve => {
      const rl = createInterface({ input, output, terminal: input.isTTY === true });
      let settled = false;
      const done = outcome => {
        if (settled) return;
        settled = true;
        rl.close();
        resolve(outcome);
      };
      rl.on('SIGINT', () => done('rejected'));
      rl.on('close', () => done('rejected')); // EOF before an answer: default NO
      const reason = String(req.reason ?? '(no reason given)');
      const targetBits = Object.entries(view?.target ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');
      output.write(
        `\n[compact-dsh] approval requested\n  tool: ${req.toolName ?? 'unknown'}` +
        (view?.command ? `\n  command: ${view.command}` : '') +
        (targetBits ? `\n  target: ${targetBits}` : '') +
        (view?.fingerprint ? `\n  fingerprint: ${view.fingerprint}` : (req.callId != null ? `\n  call: ${req.callId}` : '')) +
        `\n${reason.split('\n').map(line => `  ${line}`).join('\n')}` +
        `\n  1) deny (default)\n  2) allow once\n`);
      rl.question('choice [1]: ', answer => {
        const a = answer.trim().toLowerCase();
        if (a === '2' || a === 'allow' || a === 'allow once') return done('allowed-once');
        if (a === '' || a === '1' || a === 'deny' || a === 'no') return done('rejected');
        output.write('unrecognized answer; defaulting to deny\n');
        done('rejected');
      });
    });
  };
}

/** Append the operator answerer to the approval/request waterfall. */
export function operatorAnswerer(ctx, prompter = createOperatorPrompter()) {
  return ctx.on('approval/request', async (req, next) => {
    if (!COMPACT_ENVELOPE_REASON.test(String(req.reason ?? ''))) return next();
    // mirrors the recorded answerer's deciding key (callId, else agent+tool)
    const key = req.callId != null ? String(req.callId) : `${req.agent?.id ?? '?'}:${req.toolName}`;
    const view = ctx.get('compact-approval')?.deciding?.get(key);
    const outcome = await prompter(req, view);
    return OUTCOMES.includes(outcome) ? outcome : 'rejected';
  });
}
