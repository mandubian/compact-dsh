// compact-dsh-promotion — Phase 3 plugin (port plan Phase 3 item 2).
//
// The promotion evidence rule (docs/concept-promotion-evidence.md) as a
// mechanical gate on the promotion_record tool, enforced in
// tools/pre-execute ON THE TOOL ITSELF — even the registration site cannot
// bypass it, because the denial happens in the waterfall before the body
// ever dispatches:
//
//   pass=true with any error/critical finding  → rejected mechanically
//   pass=true with a warning lacking non-empty
//     evidence (what was observed, where)      → rejected mechanically
//   pass=false                                 → allowed (recording a
//                                                failed evaluation is lawful)
//   missing/malformed findings with pass=true  → rejected (fail-closed:
//                                                missing data blocks)
//
// There is NO warnings_acknowledged boolean — booleans are set by the party
// being gated; the evidence field is the only proof (D-4: no instrumental
// shortcuts). The founding incident this rule makes structurally impossible:
// an orchestrator proceeding past a failed run because it judged the failure
// "non-blocking".
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildEnvelope,bandReason } from 'compact-envelope';

export const name = 'compact-promotion';
export const GATE = 'PG';
export const TOOL_NAME = 'promotion_record';

/** The mechanical predicate, pure and exported for the truth-table tests. */
export function evaluatePromotionRecord(args) {
  const pass = args?.pass;
  const findings = args?.findings;
  if (pass !== true) return { ok: true }; // recording a failed evaluation is lawful
  if (!Array.isArray(findings)) {
    return {
      ok: false, ruleId: 'evidence-missing',
      reason: 'pass=true requires findings — missing data blocks (fail-closed, there is no fall-through that promotes on absence of information)',
      lawfulNextMoves: ['provide the recorded findings of the gate set', 'record pass=false until the gates have run'],
    };
  }
  for (const f of findings) {
    const severity = String(f?.severity ?? '').toLowerCase();
    if (severity === 'error' || severity === 'critical') {
      return {
        ok: false, ruleId: 'evidence-severity',
        reason: `pass=true with a ${severity} finding (${f?.check ?? 'unlabeled check'}: ${f?.detail ?? 'no detail'}) is rejected mechanically — no orchestrator narration can reclassify it`,
        lawfulNextMoves: ['fix the finding and re-run the gates', 'record pass=false with the finding'],
      };
    }
    if (severity === 'warning') {
      const evidence = f?.evidence;
      if (typeof evidence !== 'string' || evidence.trim().length === 0) {
        return {
          ok: false, ruleId: 'evidence-missing',
          reason: `pass=true with an unevidenced warning (${f?.check ?? 'unlabeled check'}) is rejected — evidence (what was observed, where) is the only proof; there is no waiver boolean`,
          lawfulNextMoves: ['record the evidence for the warning', 'fix the warning and re-run the gates', 'record pass=false'],
        };
      }
    }
  }
  return { ok: true };
}

function rejectionEnvelope(ruleId, reason, lawfulNextMoves) {
  return buildEnvelope({ gate: GATE, ruleId, reason, lawfulNextMoves });
}

export function promotionPlugin(opts = {}) {
  function apply(ctx, config) {
    // The gate rides the waterfall BEFORE the tool body: even the tool's own
    // execute cannot observe a rejected call.
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec?.name !== TOOL_NAME) return next();
      const v = evaluatePromotionRecord(exec?.arguments ?? {});
      if (v.ok) return next();
      const env = rejectionEnvelope(v.ruleId, v.reason, v.lawfulNextMoves);
      return { kind: 'deny', reason: bandReason(env) };
    });

    const recorded = [];
    const tool = defineTool({
      name: TOOL_NAME,
      description:
        'Record a promotion decision (work product marked done / installed / published). ' +
        'The gate is mechanical: pass=true is rejected with any error/critical finding or any warning lacking non-empty evidence. ' +
        'Record pass=false with the findings when the evaluation did not pass.',
      parameters: {
        task: { type: 'string', description: 'what was evaluated and is being promoted' },
        pass: { type: 'boolean', description: 'the evaluation verdict — the gate re-checks it against the findings' },
        findings: {
          type: 'array',
          description: 'the recorded findings of the gate set (severity, check, detail, evidence for warnings)',
        },
      },
      output: { schema: { type: 'string' }, render: (_args, v) => [{ type: 'text', text: String(v) }] },
      async execute(args) {
        // defense in depth: the body re-checks even though the waterfall
        // already denies rejections before dispatch
        const v = evaluatePromotionRecord(args ?? {});
        if (!v.ok) throw bandReason(rejectionEnvelope(v.ruleId, v.reason, v.lawfulNextMoves));
        const record = {
          task: String(args?.task ?? ''),
          pass: args?.pass === true,
          findings: Array.isArray(args?.findings) ? args.findings.length : 0,
          at: Date.now(),
        };
        recorded.push(record);
        return `promotion recorded: ${record.task} — pass=${record.pass}, ${record.findings} finding(s) on the record`;
      },
    });
    ctx.inject?.(['tools'], (scope) => scope.tools.register(tool));
    apply.promotion = { tool, recorded };
    // composition coupling (Phase 4): the constitution checks this service's
    // presence — a composition without the promotion gate refuses to start
    ctx.provide?.('compact-promotion', apply.promotion);
    return apply.promotion;
  }
  return apply;
}
