# Hive Recall — Self-Improvement Through Observation

## What This Is

Hive Recall is a lightweight telemetry and insight system for the Hive plugin. It passively observes agent execution, records structured events, and distills patterns into actionable insights that feed back into future sessions. This is the foundational milestone — everything built after Recall is in place will be automatically observed and improved.

## Core Value

Give Hive persistent memory across sessions so agents learn from past failures, deviations, and user corrections — without breaking the fresh-context architecture or adding dependencies.

## Requirements

### Validated

- ✓ Multi-runtime installation (Claude Code, OpenCode, Gemini CLI) — existing
- ✓ 4-layer command dispatch (Commands → Workflows → Agents → Tools) — existing
- ✓ Wave-based parallel agent execution — existing
- ✓ File-based agent communication via .planning/ — existing
- ✓ Agent Teams dual-mode (team + standalone fallback) — existing
- ✓ Hooks system (statusline, update checker) — existing
- ✓ hive-tools.js CLI utility with init pattern — existing
- ✓ State management via STATE.md with atomic commits — existing

### Active

- [ ] JSONL event storage (`.planning/telemetry/events.jsonl`)
- [ ] Common event envelope (ts, session, type, v, data)
- [ ] 10 event types (agent_completion, tool_error, deviation, checkpoint, verification_gap, plan_revision, user_correction, fallback, context_compaction, session_summary)
- [ ] 5 CLI commands in hive-tools.js (telemetry emit|query|digest|rotate|stats)
- [ ] 4 hook observers (SubagentStop, PostToolUseFailure, PreCompact, SessionStart/SessionEnd)
- [ ] INSIGHTS.md human-readable digest generation
- [ ] Event rotation (500KB threshold, max 10 archives)
- [ ] Config section with per-tier toggles (hooks, workflow_events, transcript_analysis)
- [ ] Workflow integration — telemetry emit calls at deviation, checkpoint, verification, and plan revision points
- [ ] Feedback injection — `<recall>` block in agent prompts via init commands
- [ ] `/hive:insights` command for on-demand insight review
- [ ] Installer integration — hook registration during `npx hive-cc` install

### Out of Scope

- SQLite or database storage — learned from removed intel system (v1.9.2), must stay file-based
- Runtime dependencies — zero-dep philosophy is non-negotiable
- Real-time dashboards — CLI-only, markdown digest is sufficient
- Transcript analysis agent (Phase 5) — deferred, implement only after MVP proves value
- Cross-project global insights — deferred to future milestone

## Context

- Hive agents operate with fresh 200k context per spawn — no memory between sessions
- Previous intel system (v1.9.2) was removed as overengineered (used SQLite, 21MB dep)
- Codebase already has hooks infrastructure (statusline, update checker)
- hive-tools.js has established command patterns for new subcommands
- Research identified 47 observation points across 4 lifecycle phases (16 critical)
- Top 5 highest-value signals: executor deviations, user corrections, artifact stubs, UAT feedback, architectural misses
- Detailed proposal: `.planning/SELF-IMPROVEMENT-PROPOSAL.md` (713 lines)

## Constraints

- **Zero dependencies**: No npm packages — pure Node.js stdlib (fs, path, JSON)
- **Fail-silent**: Observation failures must NEVER break workflow execution
- **Async hooks**: All hooks must be non-blocking
- **File-based**: JSONL for events, Markdown for insights — no databases
- **Lightweight**: ~500 lines for MVP, not 21MB like the removed intel system
- **Privacy-aware**: Events contain metadata only (no code, no secrets), JSONL gitignored
- **Backward compatible**: Hive works identically with telemetry disabled

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Implement Recall before other features | Everything built after gets tracked automatically | — Pending |
| JSONL over SQLite | Zero deps, append-only, learned from v1.9.2 removal | — Pending |
| 3-tier architecture (hooks + workflow + transcript) | Each tier adds context the previous can't see | — Pending |
| MVP = Phase 1+2 only | Ship small, measure, expand only if data proves value | — Pending |
| events.jsonl gitignored, INSIGHTS.md committed | Privacy for raw data, shareability for insights | — Pending |
| `<recall>` block in agent prompts | Fits existing prompt-block pattern (objective, context, constraints) | — Pending |

---
*Last updated: 2026-02-11 after initialization (Hive Recall milestone)*
