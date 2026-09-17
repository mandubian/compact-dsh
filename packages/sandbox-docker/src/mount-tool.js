// The mount-grant request tool (port plan Phase 2 item 2 — the cure half of
// cure-on-retry). When a confined command fails on a path outside the
// workspace, the path is not mounted; this tool is the lawful channel:
//
//   missing path  → terminal envelope (mounting what does not exist is a
//                   malformed request — refused without a gate)
//   protected path→ terminal envelope (no gate exists to approve this, by
//                   constitution — the sensitive-path deny-list)
//   covered path  → success naming the existing grant (no re-asking)
//   else          → the human gate (host approval seam); on allowed-once the
//                   request MATERIALIZES a scoped PathPrefix grant row
//                   (canonical prefix, ro ceiling, TTL, revocable — the Phase
//                   1 machinery) and the same command retried now passes.
//
// The cure is the recorded approval: the grant row IS the operator's
// decision, and the host appends the approval/asked + approval/decided
// audit pair — no out-of-band "the operator said it was fine".
import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildEnvelope } from 'compact-envelope';
import { coveringGrants, identityOf } from 'compact-dsh-approval';
import { canonicalizeBestEffort, statSafe, within } from './mounts.js';

export const GATE = 'MG';

function throwEnvelope(env) {
  throw new Error(env.text);
}

export function mountRequestTool({ approval, askApproval, protectedPaths, grantTtlMs }) {
  const protectedCanonical = (protectedPaths ?? []).map(canonicalizeBestEffort);
  return defineTool({
    name: 'sandbox_request_mount',
    description:
      'Request a mount grant for a host path that a confined command needs. ' +
      'When a command fails inside the sandbox with a read-only-file-system or permission-denied error ' +
      'on a path outside the workspace, that path is not mounted: request it here with the MINIMUM mode ' +
      '(ro unless the command must write). On operator approval the grant materializes for this session ' +
      'and the same command retried will pass. Protected paths (secrets, system internals) and missing ' +
      'paths are refused terminally — no gate exists for them.',
    parameters: {
      path: { type: 'string', description: 'absolute host path the command needs (canonicalized via realpath)' },
      mode: { type: 'string', description: "'ro' (default) or 'rw' — the ceiling of the requested grant" },
      justification: { type: 'string', description: 'one sentence: why the command needs this path' },
    },
    output: {
      schema: { type: 'string' },
      render: (value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const requested = String(args?.path ?? '');
      const mode = args?.mode === 'rw' ? 'rw' : 'ro';
      const justification = String(args?.justification ?? '').trim();
      if (!justification) {
        throwEnvelope(buildEnvelope({ gate: GATE, ruleId: 'R-3/justification',
          reason: 'a mount request must name its justification — the operator reads it verbatim',
          lawfulNextMoves: ['re-issue sandbox_request_mount with a non-empty justification'] }));
      }
      // canonicalize: symlink games stop here (realpath). A path that does not
      // exist still canonicalizes (lexically), because the protected check
      // below must run whether or not the target is there.
      const canonical = canonicalizeBestEffort(requested);
      if (!canonical.startsWith('/')) {
        throwEnvelope(buildEnvelope({ gate: GATE, ruleId: 'I-5/missing-path',
          reason: `"${requested}" is not an absolute path — mount grants are canonical absolute paths (terminal)`,
          lawfulNextMoves: ['re-issue with an absolute path'] }));
      }
      // Protected paths: no gate exists, by constitution (terminal). Checked
      // BEFORE existence, and the order is the point. A protected path is
      // never grantable whether or not it is there, so answering "missing"
      // first would turn the deny-list into an existence ORACLE: ask for
      // ~/.aws, read "missing" and learn the host has none, read "protected"
      // and learn it does. The deny-list exists to make these paths
      // unreachable, and a refusal that discloses their presence hands back
      // what the masking took away (D-8).
      for (const p of protectedCanonical) {
        if (within(p, canonical) || within(canonical, p)) {
          throwEnvelope(buildEnvelope({ gate: GATE, ruleId: 'I-5/protected-path',
            reason: `"${canonical}" is a protected path — no gate exists to approve mounting it (terminal, by constitution)`,
            lawfulNextMoves: ['do not attempt to mount protected paths', 'reach the data through an approved, non-mount channel'] }));
        }
      }
      // missing = terminal (a dangling symlink lands here too: realpath fails,
      // the lexical fallback is not a real target, and statSafe says so)
      if (!statSafe(canonical)) {
        throwEnvelope(buildEnvelope({ gate: GATE, ruleId: 'I-5/missing-path',
          reason: `"${requested}" does not exist — a missing path is never grantable (terminal)`,
          lawfulNextMoves: ['check the path spelling', 'create the path through an approved channel first, then re-request'] }));
      }
      if (!exec?.agent) {
        throwEnvelope(buildEnvelope({ gate: GATE, ruleId: 'I-5/no-agent',
          reason: 'mount requests require an agent session to scope the grant to (fail-closed)',
          lawfulNextMoves: ['issue the request from within an agent session'] }));
      }
      const { root, session } = identityOf(exec.agent);
      // already covered? no re-asking
      const covers = coveringGrants(approval.store, { path: canonical, mode }, Date.now()).session
        .filter(g => (g.session != null) ? g.session === session : (g.root != null) ? (session === g.root || session.startsWith(g.root + '/')) : true);
      if (covers.length) {
        return `"${canonical}" (${mode}) is already covered by grant ${covers[0].id} — no new grant needed; retry the denied command`;
      }
      // the human gate (host approval seam; the audit pair is host-appended)
      const env = buildEnvelope({ gate: GATE, ruleId: 'I-5/mount',
        reason: `mount requested: ${canonical} (${mode}) for session ${session} — ${justification}`,
        lawfulNextMoves: [`request a narrower subdirectory of ${canonical}`, 'use an approved alternative path', 'escalate to your Principal'] });
      const outcome = await askApproval({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason: env.text, signal: exec.signal });
      if (outcome !== 'allowed-once') {
        throwEnvelope(buildEnvelope({ gate: GATE, ruleId: 'I-5/mount',
          reason: `mount of ${canonical} (${mode}) was not approved (${outcome})`,
          lawfulNextMoves: ['respect the decision and use a covered path', 're-request with a narrower path or a better justification', 'escalate to your Principal'] }));
      }
      // the cure IS the recorded approval: materialize the scoped grant row
      const g = approval.store.addSessionGrant({
        pattern: { kind: 'PathPrefix', value: { path: canonical, ceiling: mode } },
        root, session, ttlMs: grantTtlMs, now: Date.now(),
      });
      return `grant ${g.id}: ${canonical} mounted ${mode} for this session (expires ${new Date(g.expiresAt).toISOString()}) — retry the denied command; the grant row is the operator's recorded decision (approval/asked + approval/decided on the session log)`;
    },
  });
}
