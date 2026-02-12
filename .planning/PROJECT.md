# Hive — Spec-Driven Development System for AI Agents

## What This Is

Hive is a meta-prompting and context engineering system for Claude Code. It orchestrates AI agents through spec-driven workflows (commands → workflows → agents → tools), manages project state via markdown artifacts in `.planning/`, and executes phased roadmaps with wave-based parallelization. v1.0 added persistent memory via telemetry/recall. v2.0 shipped professional git workflow — dev branch, plan-level branching, 3-gate build validation, PR-based integration, and a repo manager with file-based merge queue.

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
- ✓ mkdir-based locks and atomic temp+rename for crash-safe file operations — v2.0
- ✓ config.json git section with flow, build_gates, build_command, merge_strategy, dev_branch — v2.0
- ✓ Auto-detection of git version, gh CLI, and build command (8 project types) — v2.0
- ✓ All git features bypass when git.flow="none" (backward compatible) — v2.0
- ✓ Dev branch auto-created on project/milestone init — v2.0
- ✓ Plan-level branches (hive/phase-{N}-{plan}-{slug}) from dev with auto-cleanup — v2.0
- ✓ Gate 1 (pre-PR) blocks PR creation on build failure — v2.0
- ✓ Gate 2 (pre-merge) validates merge result via --no-commit before merge to dev — v2.0
- ✓ Gate 3 (pre-main) full build before dev-to-main merge on milestone completion — v2.0
- ✓ Build gates on by default, individually configurable, with timeout (300s default) — v2.0
- ✓ PR creation via gh pr create with SUMMARY.md-based body — v2.0
- ✓ Single-terminal self-merge with configurable strategy (merge commit default, squash optional) — v2.0
- ✓ Merge queue in .hive-workers/merge-queue.json with file-lock safety — v2.0
- ✓ /hive:manage-repo command with repo manager agent — v2.0
- ✓ Wave-aware merge ordering and conflict detection via git merge-tree — v2.0
- ✓ File-based signaling between workers and manager — v2.0
- ✓ 11 git subcommands in hive-tools.js — v2.0
- ✓ Git status in progress display (branch, ahead/behind, open PRs) — v2.0
- ✓ execute-phase branch orchestration per wave — v2.0
- ✓ execute-plan build gate + PR creation integration — v2.0
- ✓ complete-milestone dev-to-main merge with Gate 3 — v2.0

### Active

(No active requirements — define in next milestone via `/hive:new-milestone`)

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
- AI-powered conflict resolution — prevention + detection is safer than auto-resolution
- Entity-level merge (Weave/tree-sitter) — adds native binary dependency, breaks zero-dep
- Task-level branches — branch explosion; plan-level is correct granularity

## Context

Shipped v2.0 with ~6,400 lines in hive-tools.js (both copies), 10,261 new lines total across 45 files.
Tech stack: Pure Node.js stdlib (fs, path, child_process, os) — zero runtime dependencies.
Git workflow integration via native `git` and `gh` CLI commands through spawnSync wrapper.
Two milestones shipped in same day (v1.0 Recall + v2.0 Git Flow).

## Constraints

- **Zero dependencies**: No npm packages — pure Node.js stdlib (fs, path, child_process, os)
- **Backward compatible**: `git.flow: "none"` bypasses all git features (current behavior preserved)
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
| Foundation first (single-terminal before multi-terminal) | Ship incremental; prove stability first | ✓ Good — all 28 requirements met in single day |
| Build gates always on by default | Safety > convenience; user disables if needed | ✓ Good — fail-safe by default, configurable |
| Merge commit (--no-ff) | Preserves per-task commit granularity on dev branch | ✓ Good — full history preserved |
| mkdir-based locks (not flock) | Cross-platform compatibility | ✓ Good — works on all OS |
| Modified GitHub Flow | Plan-level branches, dev integration branch, PRs to dev | ✓ Good — clean isolation per plan |
| spawnSync over execSync | Structured exit handling without exceptions | ✓ Good — all 11 subcommands return JSON |
| repo_manager defaults to false | Opt-in only, zero behavior change for existing users | ✓ Good — progressive adoption |
| Gate 2 always aborts in finally | Crash recovery, never leaves merge state | ✓ Good — fail-safe |

---
*Last updated: 2026-02-12 after v2.0 milestone completion*
