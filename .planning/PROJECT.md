# Hive Recall — Self-Improvement Through Observation

## What This Is

Hive Recall is a lightweight telemetry and insight system for the Hive plugin. It passively observes agent execution across 4 hook observers and 13 workflow emit points, records structured events in JSONL format, distills patterns into actionable insights, and feeds them back into future agent sessions via `<recall>` blocks. Shipped as v1.0 with zero runtime dependencies and full backward compatibility.

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
- ✓ JSONL event storage (`.planning/telemetry/events.jsonl`) — v1.0
- ✓ Common event envelope (ts, session, type, v, data) — v1.0
- ✓ 10 event types (agent_completion, tool_error, deviation, checkpoint, verification_gap, plan_revision, user_correction, fallback, context_compaction, session_summary) — v1.0
- ✓ 5 CLI commands in hive-tools.js (telemetry emit|query|digest|rotate|stats) — v1.0
- ✓ 4 hook observers (SubagentStop, PostToolUseFailure, PreCompact, SessionStart/SessionEnd) — v1.0
- ✓ INSIGHTS.md human-readable digest generation with pattern detection — v1.0
- ✓ Event rotation (500KB threshold, max 10 archives) — v1.0
- ✓ Config section with per-tier toggles (hooks, workflow_events, transcript_analysis) — v1.0
- ✓ Workflow integration — 13 telemetry emit calls at deviation, checkpoint, verification, and plan revision points — v1.0
- ✓ Feedback injection — `<recall>` block in 11 agent-spawning workflows (36 injection points) via 8 init commands — v1.0
- ✓ `/hive:insights` command for on-demand insight review — v1.0
- ✓ Installer integration — hook registration during `npx hive-cc` install — v1.0
- ✓ Transcript analysis agent with session quality scoring — v1.0
- ✓ Cross-session pattern detection and trend tracking — v1.0

### Active

(Empty — next milestone will define new requirements via `/hive:new-milestone`)

### Out of Scope

- SQLite or database storage — learned from removed intel system (v1.9.2), must stay file-based
- Runtime dependencies — zero-dep philosophy is non-negotiable
- Real-time dashboards — CLI-only, markdown digest is sufficient
- Cross-project global insights — deferred to future milestone (CROSS-01, CROSS-02, CROSS-03 in v2 backlog)
- Auto-suggestion when deviation thresholds exceeded — deferred (AUTO-01, AUTO-02 in v2 backlog)

## Context

Shipped v1.0 Hive Recall with ~5,500 lines across 219 files (Node.js, Markdown).
Tech stack: Pure Node.js stdlib (fs, path, JSON) — zero runtime dependencies.
Architecture: 3-tier observation (hooks + workflow events + transcript analysis) → JSONL storage → digest → recall injection.
All 34 requirements satisfied, 68 truths verified, 32 cross-phase integrations wired.
Hive works identically with telemetry disabled (backward compatible).

## Constraints

- **Zero dependencies**: No npm packages — pure Node.js stdlib (fs, path, JSON)
- **Fail-silent**: Observation failures must NEVER break workflow execution
- **Async hooks**: All hooks must be non-blocking
- **File-based**: JSONL for events, Markdown for insights — no databases
- **Privacy-aware**: Events contain metadata only (no code, no secrets), JSONL gitignored
- **Backward compatible**: Hive works identically with telemetry disabled

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Implement Recall before other features | Everything built after gets tracked automatically | ✓ Good — all phases observed |
| JSONL over SQLite | Zero deps, append-only, learned from v1.9.2 removal | ✓ Good — simple, fast, no deps |
| 3-tier architecture (hooks + workflow + transcript) | Each tier adds context the previous can't see | ✓ Good — 10 + 13 + transcript emit points |
| MVP expanded to full 7 phases | Transcript analysis and integration closure added after initial 4 phases proved solid | ✓ Good — complete loop shipped |
| events.jsonl gitignored, INSIGHTS.md committed | Privacy for raw data, shareability for insights | ✓ Good — clean separation |
| `<recall>` block in agent prompts | Fits existing prompt-block pattern (objective, context, constraints) | ✓ Good — 36 injection points across 11 workflows |
| Hooks write directly to JSONL (no CLI child process) | Avoids ~100ms subprocess overhead per hook | ✓ Good — near-zero latency |
| Telemetry enabled by default (missing config = enabled) | Zero-friction adoption, users can opt out | ✓ Good — works out of the box |
| Cap recall patterns at 5 lines with PATTERN/TREND/REC prefixes | Bounded agent context, machine-parseable | ✓ Good — fits in prompt blocks |

---
*Last updated: 2026-02-12 after v1.0 milestone*
