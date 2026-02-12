# Hive — Spec-Driven Development System for AI Agents

## What This Is

Hive is a meta-prompting and context engineering system for Claude Code. It orchestrates AI agents through spec-driven workflows (commands → workflows → agents → tools), manages project state via markdown artifacts in `.planning/`, and executes phased roadmaps with wave-based parallelization. v1.0 added persistent memory via telemetry/recall. v2.0 adds professional git workflow — dev branch, plan-level branching, build gates, PR-based integration, and a repo manager.

## Core Value

Give AI agents a structured, safe path from plan to merged code — so quality scales with parallelism instead of degrading.

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

(Defined in REQUIREMENTS.md for v2.0)

### Out of Scope

- SQLite or database storage — learned from removed intel system (v1.9.2), must stay file-based
- Runtime dependencies — zero-dep philosophy is non-negotiable
- Real-time dashboards — CLI-only, markdown digest is sufficient
- Cross-project global insights — deferred (CROSS-01, CROSS-02, CROSS-03)
- Auto-suggestion when deviation thresholds exceeded — deferred (AUTO-01, AUTO-02)
- Git worktrees / multi-terminal orchestration — deferred to v2.1+
- Worker registry and /hive:start-worker — deferred to v2.1+
- Continuous conflict monitoring (Clash-style) — deferred to v2.1+
- Dynamic worker assignment — deferred to v2.1+

## Current Milestone: v2.0 Hive Pro Git Flow

**Goal:** Give Hive a professional git workflow — dev branch, plan-level branching, build gates, PR-based integration, and a repo manager — so code flows safely from agents to main.

**Target features:**
- Atomic file writes with flock for concurrency safety
- Dev branch creation during project/milestone init
- Plan-level branching (extends existing branching_strategy)
- Build command auto-detection and 3-gate validation
- PR creation and self-merge for single-terminal mode
- Merge queue and repo manager agent for coordinated merges
- Git status display in progress output

## Context

Shipped v1.0 Hive Recall with ~5,500 lines across 219 files (Node.js, Markdown).
Tech stack: Pure Node.js stdlib (fs, path, JSON) — zero runtime dependencies.
v2.0 adds git workflow integration via `gh` CLI and native `git` commands.
Research completed: `.planning/research/GIT-WORKFLOW-RECOMMENDATIONS.md` — Modified GitHub Flow with plan-level branches, 3 build gates, file-based merge queue.

## Constraints

- **Zero dependencies**: No npm packages — pure Node.js stdlib (fs, path, JSON)
- **Backward compatible**: `git.flow: "none"` bypasses all new git features (current behavior preserved)
- **`gh` CLI required**: PR operations depend on GitHub CLI being installed
- **Single-terminal first**: v2.0 targets single-terminal; multi-terminal deferred to v2.1+
- **File-based coordination**: Merge queue, signals use JSON files (no sockets, no databases)
- **Fail-safe**: Build gate failures block progression, never silently pass broken code

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Implement Recall before other features | Everything built after gets tracked automatically | ✓ Good — all phases observed |
| JSONL over SQLite | Zero deps, append-only, learned from v1.9.2 removal | ✓ Good — simple, fast, no deps |
| 3-tier architecture (hooks + workflow + transcript) | Each tier adds context the previous can't see | ✓ Good — 10 + 13 + transcript emit points |
| events.jsonl gitignored, INSIGHTS.md committed | Privacy for raw data, shareability for insights | ✓ Good — clean separation |
| Foundation first (v2.0 = Phase 1-2 only) | Ship incremental; single-terminal + repo manager before multi-terminal | — Pending |
| Build gates always on by default | Safety > convenience; user disables if needed | — Pending |
| Merge commit (--no-ff) | Preserves per-task commit granularity on dev branch | — Pending |
| Concurrency locks in this milestone | File locking is prerequisite for safe parallel writes | — Pending |
| Modified GitHub Flow | Plan-level branches, dev integration branch, PRs to dev | — Pending |

---
*Last updated: 2026-02-12 after v2.0 milestone start*
