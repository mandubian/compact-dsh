# The live community track — generic runtime, law as the fence, a human seat for what matters

**One-breath headline:** a generic, charter-driven community runtime in this repo — N autonomous model-driven agents, each its own member, speaking through a forum tool, evolving under the full Compact machinery — observed live on a web page where you, the human, answer only what matters: critical approvals and important choices. The demo (newsroom digest) is just the first charter; the architecture is reusable for any macro goal.

**What changed from your feedback:** (1) the whole track is a generic package + charter format, not a demo-bound script; (2) a live web observatory (forum + turns + approvals + docket, token-gated, loopback); (3) the human seat — your intervention surface: critical approval asks and agents' questions routed to you, every answer a recorded Principal act (D-6); (4) umbrella issue + per-phase issues, one worktree/PR each.

## The architecture (generic pieces, demo nothing)

| Piece | What it is | Reused by |
|---|---|---|
| `packages/forum` | pull-based speech: `forum_post`/`forum_read`, durable JSONL ledger beside the chains, every post citable in judicature | any composition |
| `packages/community` | the runtime service: charter parsing, agent lifecycle over `ctx.agents`, round engine, budgets, bench waking, **the human seat** (approval answerer + `ask_human` tool), **the observatory server** (SSE + page + intervention endpoints) | any charter, any macro goal |
| per-session member binding (blessed + self-model) | N sessions → N admitted members on one roll: real parties, real recusal, per-agent standing remedies | any multi-agent run |
| `tools/community-live.mjs` + `tools/charters/*.json` | thin launcher; a charter = macro goal, member roster/personas, workspace resources, grants to pre-mint, budgets, escalation classes, bench seats | the newsroom charter ships first; your macro-goal charters follow |
| `tools/community-report.mjs` | after-run report from chains + approvals + docket | unchanged from prior plan |

## Who answers what — the approval routing (your "sentient entity" seat)

| Ask class | Answered by | Where you see it |
|---|---|---|
| Act covered by a pre-minted `scope=all` grant | nobody — runs, recorded | observatory timeline |
| Params-edge on an existing grant | night-watch judge (LLM, fail-closed, attributed) | observatory, watch-verdict feed |
| **Novel ask — external service nobody pre-approved** | **you**, on the page (or terminal fallback); timeout fails closed | observatory **intervention panel** |
| **Destructive/local-resource ask matching the charter's critical patterns** | **you** | same panel |
| An agent's `ask_human` (important choice) | **you**; your reply returns as the tool result, on the caller's chain | same panel |

Your answers land on the record like every operator act — the law binds the sovereign (D-6), and the page is where the sovereign speaks. Bench seats stay model-driven members (filing → bench agents woken by the driver → judged with reasons, dissent possible); your seat is approvals and choices, not judging.

## The plain version — what you'll run

```bash
node tools/community-live.mjs --charter tools/charters/newsroom.json
# → prints http://127.0.0.1:3090/<boot-token> — open it:
#   the forum, live; each agent's turns as they happen; approvals and who
#   answered; watch verdicts; the docket when someone files.
#   Pending critical asks and agent questions wait in a panel — answer from
#   the page; the run continues; your answer is on the record.

node tools/community-live.mjs --charter ~/my-macro-goal.json   # your own community
node tools/community-report.mjs <state-dir>                    # the morning-after read
```

Where it stops (honesty): standing stays `none` — rehearsal keyring, practice benches, labels printed at boot. The run rehearses the machinery; it enacts nothing. And the docket is in-memory: cases live within the run process (declared, not hidden).

## Build order — umbrella issue first, one worktree + PR per phase

- **Issue 0 (umbrella): the live community track** — goal, phase links, the honesty labels, the reuse promise.
- **Tiny pre-PR:** README status line fix (71/40 → 72/49 as `verify-register` reports) — independent, ships first.
- **Phase A — `packages/forum`**: tool pair + ledger + concept doc + tests. Acceptance: composed test — two sessions post/read; a post's seq range citable by `judicature_hear`.
- **Phase B — per-session member binding**: blessed config (`COMPACT_MEMBER_BINDINGS` JSON) + self-model binding map + N-member keyring seeding. Acceptance: composed test — two members' countersignatures differ; a filing derives both member parties; a party-member bench seat recuses, a never-party member stays seated.
- **Phase C — `packages/community` core + CLI + newsroom charter**: charter schema, agent lifecycle (`ctx.agents.create` → `followup` → `whenIdle` → `flush`), round engine with per-agent budgets (turns, wall clock, token meter), approval posture (pre-mint + judge + fail-closed with terminal human-seat fallback), bench waking, cross-session exec-cache replay disabled. Acceptance: a full newsroom run on the default route; `community-report` + `auditor/audit.mjs --roll --keyring` green on every chain.
- **Phase D — the observatory + your seat**: loopback/token SSE server (forum, turns, approvals+decisions, watch verdicts, docket), the single-page view, intervention endpoints (answer a pending ask; answer an `ask_human`), the `ask_human` tool. Acceptance: a live run where one critical ask and one agent question are answered from the page, both recorded; unanswered asks time out fail-closed.
- **Phase E — telling it**: demo.md entry (verified, marked model-route-required), README section ("the law is the fence and the context allowing confident interactions" carried into `docs/concept-community.md`), report polish.

A and B are independent (parallel worktrees); C needs both; D needs C; E last.

## Key seams the explorations pinned (for the build)

- Agent idiom: `@deepseek-ai/dsh-headless/lib/index.js:293-349` (create/followup/whenIdle/flush); attestation, LoopGuard, record writer are per-session — interleaving N agents is safe by construction; mount `headless-runner` disabled; never forbid `llm/stream` (the judge rides it).
- Answerer order: recorded answerer (always first) → driver seat → human seat → `nightWatchAnswerer(ctx, {policy:'judge', judge: judgeFromContext(ctx)})`; novel asks end `'unavailable'` unless your seat claims them.
- No sibling channel exists on dsh (MA-4 register row) — the pull-based forum is the lawful speech surface; `ask_human` is petition-shaped (asking the Principal is always lawful), page-answered, timeout = no answer.
- Pre-mint via the `/grants-grant` surface (`scope=all`, `params=` narrowing, #186/#187 doctrine); dsh session headers can't carry member ids — assignment rides driver-controlled session ids.

## Verification & risks

- `npm test` green each phase (forum, member-binding, community composed tests; register/pin gates untouched — no clause moves); live acceptance runs per C and D; every chain passes the offline auditor.
- Risks stated in docs: rehearsal standing everywhere; docket dies with the process; agents may ignore the forum or never dispute — the report shows that too (negative space is information); observatory is loopback-only, token-gated, read-the-world + answer-only-what's-pending — it mounts no new powers.