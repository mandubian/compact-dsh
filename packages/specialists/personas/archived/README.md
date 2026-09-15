# Archived personas — out of the active roster

These personas are **ported but not mounted**: the loader reads only the
top level of `personas/` (non-recursive), so a persona in this directory is
invisible to the roster, the trim-dedup lint, and the delegation-tool mount.
They stay as data — descriptors, prose, and gated sections intact — so
revival is a `git mv` back to `personas/`, nothing more.

## Why archived (2026-09-15)

The active roster is the **basic five** — `architect`, `auditor`, `coder`,
`debugger`, `researcher` — the personas that earn their keep on dsh today.
Every mounted persona costs the parent model a delegation-tool row, and the
host contract (`@deepseek-ai/dsh-tool-subagent`) gives every row an
identical generic description, so each extra persona is tool-surface cost
with name-only routing signal. The archive keeps the surface to what pays
for itself now.

| Archived | Reason |
|---|---|
| `packager`, `unit_test_runner`, `sealed_evaluator`, `static_evaluator`, `improvement_orchestrator` | Presuppose the Phase 6–7 artifact/eval machinery (CENSUS "Phase-6 pressure"); their doctrine is ahead of the substrate. Revive with Phases 6–7. |
| `planner`, `planner_collaborative` | Leads (the only spawning personas). The parent session is the orchestrator on dsh; a lead layer is not needed while the roster is flat. Revive when specialist-to-specialist delegation earns its keep. |
| `discovery` | Semantic roster search — the roster card in the parent's system prompt covers routing for a five-persona roster. |
| `outcome_grader`, `watchdog`, `watchdog_fast` | Post-session judges over session traces; host-side lifecycle wiring (session query → prompt) is not built yet. |
| `credential_onboarding` | Human-in-the-loop credential ceremony; niche, and the web-fetch half of its cold start needs an honest mapping first (see CENSUS port note). |
| `executor` | Marginal on dsh: the parent already runs bash directly; a delegation round-trip for one-shot scripts adds cost, not capability. |

`CENSUS.md` (one level up) remains the canonical port guidance for every
persona here, including the consolidation notes.
