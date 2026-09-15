// The LoopGuard trip-state machine (port plan Phase 3; docs/concept-loopguard-trips.md).
// Pure accounting over (calls, results, refusals): no host, no I/O — every
// trip is testable in isolation with synthetic streams.
//
// Semantics without a suspend latch (the port's documented fidelity loss):
// behavioral trips latch denials + corrective prose and clear on the next
// inbound user signal (turn/start), within a repair budget; deterministic
// trips deny-all with no auto-resume. This is abort-with-explanation, not
// suspend.
//
// Read-only probes never reset progress: only a NEW fingerprint is progress.

export const TRIPS = {
  NO_MEANINGFUL_PROGRESS: { id: 'LG-1', label: 'NoMeaningfulProgress', behavioral: true, defaultLimit: 10 },
  TOOL_FAILURE_BUDGET: { id: 'LG-2', label: 'ToolFailureBudget', behavioral: true, defaultLimit: 8 },
  ROTATING_POLLING: { id: 'LG-3', label: 'RotatingPollingPattern', behavioral: true, defaultLimit: 6, window: 16 },
  CHILD_FAILURE_BUDGET: { id: 'LG-4', label: 'ChildFailureBudget', behavioral: true, defaultLimit: 5, loopPenalty: 2 },
  REDUNDANT_ROSTER_POLLING: { id: 'LG-5', label: 'RedundantRosterPolling', behavioral: true, defaultLimit: 5 },
  LLM_FAILURE_BUDGET: { id: 'LG-6', label: 'LlmFailureBudget', behavioral: true, defaultLimit: 3 },
  WORKFLOW_TERMINAL: { id: 'LG-7', label: 'WorkflowTerminal', behavioral: false },
  RECURRING_UNRECOVERABLE: { id: 'LG-8', label: 'RecurringUnrecoverableError', behavioral: true, defaultLimit: 3 },
  REPEATED_REJECTION: { id: 'LG-9', label: 'RepeatedIrrecoverableRejection', behavioral: true, defaultLimit: 3 },
  REPEATED_SPAWN_IDENTITY: { id: 'LG-10', label: 'RepeatedSpawnIdentity', behavioral: true, defaultLimit: 3 },
  REDUNDANT_ANNOTATION: { id: 'LG-11', label: 'RedundantAnnotationLoop', behavioral: true, defaultLimit: 2 },
  GATE_FLAILING: { id: 'LG-12', label: 'IrrecoverableGateFlailing', behavioral: true, defaultLimit: 10, window: 20 },
};

export const DEFAULTS = { callWindow: 32, refusalWindow: 20, repairBudget: 3 };

export class Guard {
  constructor({ limits = {}, repairBudget = DEFAULTS.repairBudget, callWindow = DEFAULTS.callWindow, refusalWindow = DEFAULTS.refusalWindow } = {}) {
    this.limits = limits;
    this.repairBudget = repairBudget;
    this.callWindow = callWindow;
    this.refusalWindow = refusalWindow;

    this.calls = [];                     // [{fp, tool, hasParent, isSpawn}]
    this.failuresByTool = new Map();     // tool -> failures
    this.childFailureFps = new Map();    // fp -> failures (nested dispatches)
    this.childFailures = 0;              // weighted child-failure total
    this.errorSignatures = new Map();    // `${tool}:${errorClass}` -> count
    this.rejectionsByFp = new Map();     // fp -> deny-count
    this.refusals = [];                  // [{fp, kind}]
    this.refusalsSinceAllow = 0;         // flailing: refusals with no allowance in between
    this.consecutiveLlmFailures = 0;
    this.spawnIdentities = new Map();    // fp -> spawns
    this.annotations = new Map();        // signature -> count
    this.latch = null;                   // {tripKey, message, atSeq} — behavioral, cleared on user signal
    this.denyAll = null;                 // {tripKey, message} — deterministic or exhausted repairs
    this.repairs = new Map();            // tripKey -> repairs spent
    /** The host sets this to the session-log position before observing, so a
     * raised latch records where the user signal must appear after. */
    this.currentSeq = Number.MAX_SAFE_INTEGER;
  }

  limit(tripKey) { return this.limits[tripKey] ?? TRIPS[tripKey].defaultLimit; }

  /** Call-side state machine: latches first, then call-shape trips. */
  observeCall({ fp, tool, hasParent = false, isSpawn = false }) {
    if (this.denyAll) return this.denyAll;
    if (this.latch) return this.latch;

    this.calls.push({ fp, tool, hasParent, isSpawn });
    if (this.calls.length > this.callWindow) this.calls.shift();

    // LG-5 roster polling: the same fingerprint repeated `limit` times in a row
    const n = this.calls.length;
    if (n >= this.limit('REDUNDANT_ROSTER_POLLING')) {
      const last = this.calls[n - 1].fp;
      let run = 0;
      for (let i = n - 1; i >= 0 && this.calls[i].fp === last; i--) run++;
      if (run >= this.limit('REDUNDANT_ROSTER_POLLING')) {
        return this.raise('REDUNDANT_ROSTER_POLLING', `the identical operation "${tool}" was issued ${run} times in a row without new information`);
      }
    }
    // LG-3 rotating polling: ≤ limit distinct fingerprints across a full window
    const win = TRIPS.ROTATING_POLLING.window;
    if (n >= win) {
      const distinct = new Set(this.calls.slice(n - win).map(c => c.fp)).size;
      if (distinct <= this.limit('ROTATING_POLLING')) {
        return this.raise('ROTATING_POLLING', `${win} calls cycled through only ${distinct} distinct operations — polling without progress`);
      }
    }
    // LG-1 no meaningful progress: nothing NEW (first-seen) in the last `limit` calls
    const pl = this.limit('NO_MEANINGFUL_PROGRESS');
    if (n >= pl) {
      const seenBefore = new Set(this.calls.slice(0, n - pl).map(c => c.fp));
      const recent = this.calls.slice(n - pl);
      const anyNew = recent.some(c => !seenBefore.has(c.fp));
      if (!anyNew) {
        return this.raise('NO_MEANINGFUL_PROGRESS', `${pl} calls without trying anything new — no new operation appeared`);
      }
    }
    // LG-10 repeated spawn identity
    if (isSpawn) {
      const count = (this.spawnIdentities.get(fp) ?? 0) + 1;
      this.spawnIdentities.set(fp, count);
      if (count >= this.limit('REPEATED_SPAWN_IDENTITY')) {
        return this.raise('REPEATED_SPAWN_IDENTITY', `the identical child spawn was requested ${count} times`);
      }
    }
    return null;
  }

  /** Result-side accounting (the frozen tools/result outcome — no ambiguity). */
  observeResult({ fp, tool, outcome, errorClass = null, terminal = false, hasParent = false }) {
    if (outcome === 'success') {
      this.refusalsSinceAllow = 0; // an allowance: the flailing counter resets
      return null;
    }
    // LG-2 per-tool failure budget
    const ft = (this.failuresByTool.get(tool) ?? 0) + 1;
    this.failuresByTool.set(tool, ft);
    // LG-4 child failures with a loop penalty: a REPEATING child failure costs 1 + 2
    if (hasParent) {
      const seen = this.childFailureFps.get(fp) ?? 0;
      this.childFailureFps.set(fp, seen + 1);
      this.childFailures += seen > 0 ? 1 + TRIPS.CHILD_FAILURE_BUDGET.loopPenalty : 1;
    }
    // LG-8 recurring unrecoverable error: same tool + error class
    const sig = `${tool}:${errorClass ?? 'unknown'}`;
    const es = (this.errorSignatures.get(sig) ?? 0) + 1;
    this.errorSignatures.set(sig, es);

    // LG-7 deterministic: a terminal workflow error — no auto-resume
    if (terminal) return this.raise('WORKFLOW_TERMINAL', `the workflow reported a terminal error (${errorClass ?? 'terminal'}) — it will not recover by retrying`);
    if (ft >= this.limit('TOOL_FAILURE_BUDGET')) {
      return this.raise('TOOL_FAILURE_BUDGET', `"${tool}" has failed ${ft} times — its budget is spent`);
    }
    if (this.childFailures >= this.limit('CHILD_FAILURE_BUDGET')) {
      return this.raise('CHILD_FAILURE_BUDGET', `child failures reached ${this.childFailures} (repeats cost extra)`);
    }
    if (es >= this.limit('RECURRING_UNRECOVERABLE')) {
      return this.raise('RECURRING_UNRECOVERABLE', `"${tool}" keeps failing with the same error class (${errorClass}) — ${es} times`);
    }
    return null;
  }

  /** Gate-refusal accounting — the Phase 1 refusal seam is the feed. */
  observeRefusal({ fp, kind }) {
    this.refusals.push({ fp, kind });
    if (this.refusals.length > this.refusalWindow) this.refusals.shift();
    this.refusalsSinceAllow += 1;
    if (kind === 'deny') {
      const r = (this.rejectionsByFp.get(fp) ?? 0) + 1;
      this.rejectionsByFp.set(fp, r);
      if (r >= this.limit('REPEATED_REJECTION')) {
        return this.raise('REPEATED_REJECTION', `the same operation was rejected ${r} times — it will not be approved by repeating it`);
      }
    }
    if (this.refusalsSinceAllow >= this.limit('GATE_FLAILING')) {
      return this.raise('GATE_FLAILING', `${this.refusalsSinceAllow} gate refusals without a single allowance — the agent is flailing against a locked gate`);
    }
    return null;
  }

  /** LLM failure budget — fed from the host's agent/error event. */
  observeLlmFailure() {
    this.consecutiveLlmFailures += 1;
    if (this.consecutiveLlmFailures >= this.limit('LLM_FAILURE_BUDGET')) {
      return this.raise('LLM_FAILURE_BUDGET', `${this.consecutiveLlmFailures} consecutive provider failures`);
    }
    return null;
  }

  /** Corrective-annotation dedup: the same prose twice is an annotation loop. */
  observeAnnotation(signature) {
    const count = (this.annotations.get(signature) ?? 0) + 1;
    this.annotations.set(signature, count);
    if (count >= this.limit('REDUNDANT_ANNOTATION')) {
      return this.raise('REDUNDANT_ANNOTATION', `the same corrective guidance was issued ${count} times without effect`);
    }
    return null;
  }

  /** The inbound user signal (turn/start): behavioral latches clear; deterministic trips never do. */
  clearOnUserSignal() {
    this.latch = null;
    this.consecutiveLlmFailures = 0;
  }

  /**
   * Raise a trip: latches + repair accounting. A raise while latched changes
   * nothing. atSeq (optional) records the session-log position at raise time
   * so the host can scan for the user signal that clears the latch.
   */
  raise(tripKey, message, atSeq = this.currentSeq) {
    if (this.denyAll) return this.denyAll;
    if (this.latch) return this.latch;
    const trip = TRIPS[tripKey];
    if (!trip.behavioral) {
      this.denyAll = { tripKey, id: trip.id, label: trip.label, behavioral: false, message };
      return this.denyAll;
    }
    const spent = (this.repairs.get(tripKey) ?? 0) + 1;
    this.repairs.set(tripKey, spent);
    if (spent > this.repairBudget) {
      this.denyAll = { tripKey, id: trip.id, label: trip.label, behavioral: true, message: `${message} — repair budget (${this.repairBudget}) exhausted` };
      return this.denyAll;
    }
    this.latch = { tripKey, id: trip.id, label: trip.label, behavioral: true, message, repair: spent, atSeq };
    return this.latch;
  }
}
