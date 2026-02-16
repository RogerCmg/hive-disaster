# Milestones

## v1.0 Hive Recall (Shipped: 2026-02-12)

**Delivered:** Complete observe-record-digest-feedback loop giving Hive agents persistent memory across sessions — zero runtime dependencies, fully backward compatible.

**Stats:** 7 phases, 14 plans | 72 commits | 219 files changed | +33,395 lines | ~7 hours
**Git range:** `feat(01-01)` → `docs(phase-7)` on `hive/v1.0-milestone`
**Requirements:** 34/34 satisfied | Audit: PASSED (68/68 truths, 32/32 integrations, 4/4 flows)

**Key accomplishments:**
1. JSONL telemetry engine with 10 event types, 5 CLI commands (emit, query, digest, rotate, stats), and 500KB auto-rotation
2. 4 passive hook observers (SubagentStop, PostToolUseFailure, PreCompact, Session) with fail-silent design
3. 13 semantic emit points across execution, verification, and planning workflows
4. Feedback loop with pattern detection, recall_context in 8 init commands, `<recall>` blocks in 11 workflows (36 injection points)
5. Automatic hook registration and config provisioning during `npx hive-cc` install
6. Transcript analysis agent with cross-session pattern detection and trend tracking

**Archives:** `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`

---


## v2.0 Hive Pro Git Flow (Shipped: 2026-02-12)

**Delivered:** Professional git workflow — dev branch, plan-level branching, 3-gate build validation, PR-based integration, and a repo manager — so code flows safely from agents to main.

**Stats:** 4 phases (8-11), 10 plans, 19 tasks | 41 commits | 45 files changed | +10,261 lines | ~6 hours
**Git range:** `8743694` → `8b8400b` on `dev`
**Requirements:** 28/28 satisfied | Audit: PASSED (40/40 truths, 24/24 integrations, 5/5 flows)

**Key accomplishments:**
1. Crash-safe file operations — mkdir-based locking and atomic temp+rename writes with execCommand spawnSync wrapper
2. 11 git subcommands in hive-tools.js — branch lifecycle, build gates, PR management, conflict detection, merge-to-main
3. Plan-level branching — dev branch on init, isolated hive/phase-{N}-{plan}-{slug} branches, auto-cleanup after merge
4. 3-gate build validation — Gate 1 (pre-PR), Gate 2 (pre-merge via --no-commit), Gate 3 (pre-main) with fix/skip/stop options
5. PR creation and self-merge — SUMMARY.md-based PR body with full degradation chain and configurable merge strategy
6. Repo manager — file-based merge queue, wave-aware ordering, conflict detection via merge-tree, opt-in config flag

**Archives:** `milestones/v2.0-ROADMAP.md`, `milestones/v2.0-REQUIREMENTS.md`, `milestones/v2.0-MILESTONE-AUDIT.md`

---


## v2.1 Git Flow Hardening (Shipped: 2026-02-16)

**Phases completed:** 15 phases, 32 plans, 0 tasks

**Key accomplishments:**
- CHANGELOG generation from SUMMARY.md one-liners in Keep a Changelog format, plus config-gated auto-push after dev-to-main merge

---

