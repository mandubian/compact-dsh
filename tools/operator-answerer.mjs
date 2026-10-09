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
// slice 3, as amended by the 2026-09-25 live capture (#90): the compact ask's
// reason is the canonical disclosure alone, so the marker is matched at line
// start anywhere in the reason, not only at position 0
const COMPACT_ENVELOPE_REASON = /(^|\n)\[AG(\/|\])/;
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
        // rl.close() releases the INTERFACE, not the input stream: an open
        // stdin fd stays ref'd on the loop, so an attended run whose harness
        // (or terminal) never EOFs stdin hangs forever after the task
        // completes (#36). unref the stream once the prompt is settled — the
        // launcher's keep-alive interval and the in-flight model stream keep
        // the loop ref'd while the session lives, later asks still deliver
        // input, and at drain time stdin no longer holds the process open.
        input.unref?.();
        resolve(outcome);
      };
      rl.on('SIGINT', () => done('rejected'));
      rl.on('close', () => done('rejected')); // EOF before an answer: default NO
      const reason = String(req.reason ?? '(no reason given)');
      const targetBits = Object.entries(view?.target ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');
      const pinShown = Array.isArray(view?.addresses) && view.addresses.length > 0;
      if (pinShown) view.addressesShown = true;   // the ack the pin materializes on (compact-approval answerRequest)
      // #173: the composer emits each disclosure on its own labeled line —
      // `Replay: …`, `Connectivity: …` — the structure the moves block has
      // always had. On a TTY the label is bolded (ANSI) so the eye lands on
      // the row that matters; the codes never enter the text, and a piped
      // stderr (a harness, a log) receives the lines exactly as emitted.
      const tty = output.isTTY === true;
      const bold = tty ? (s) => `\x1b[1m${s}\x1b[22m` : (s) => s;
      const LABEL_LEAD = /^([A-Z][A-Za-z]+): /;
      output.write(
        `\n[compact-dsh] approval requested\n  tool: ${req.toolName ?? 'unknown'}` +
        (view?.command ? `\n  command: ${view.command}` : '') +
        (targetBits ? `\n  target: ${targetBits}` : '') +
        // the pin offer (#55 follow-up): the addresses the name resolved to at
        // ask time — approving pins the grant to exactly these
        (pinShown ? `\n  pin: ${view.addresses.join(', ')} — allow once pins the grant to these addresses` : '') +
        (view?.fingerprint ? `\n  fingerprint: ${view.fingerprint}` : (req.callId != null ? `\n  call: ${req.callId}` : '')) +
        `\n${reason.split('\n').map(line => {
          const m = LABEL_LEAD.exec(line);
          return `  ${m ? `${bold(m[1] + ':')} ${line.slice(m[0].length)}` : line}`;
        }).join('\n')}` +
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
