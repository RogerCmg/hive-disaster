# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-12)

**Core value:** Safe path from plan to merged code — quality scales with parallelism
**Current focus:** v2.0 milestone complete — all phases done

## Current Position

Phase: 11 of 11 (Repo Manager)
Plan: 3 of 3 in current phase
Status: Complete (verified 5/5)
Last activity: 2026-02-12 — Phase 11 complete, verification passed

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 14 (v1.0)
- Average duration: ~30 min
- Total execution time: ~7 hours (v1.0)

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1-7 (v1.0) | 14 | ~7h | ~30m |
| 8 (v2.0) | 2 | 9m | 4.5m |

**Recent Trend:**
- 08-01: 4min, 2 tasks, 4 files
- 08-02: 5min, 2 tasks, 2 files
- 09-01: 5min, 2 tasks, 4 files
- 09-02: 3min, 1 task, 2 files
- 10-01: 2min, 2 tasks, 1 file
- 10-02: 4min, 2 tasks, 2 files
- 10-03: 2min, 2 tasks, 2 files
- 11-01: 4min, 2 tasks, 2 files
- 11-02: 2min, 2 tasks, 4 files
- 11-03: 2min, 2 tasks, 2 files
- Trend: Stable (sub-5min per plan)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Foundation first: single-terminal + repo manager before multi-terminal
- Build gates always on by default, user disables if needed
- Merge commit (--no-ff) to preserve per-task granularity
- mkdir-based locks (not flock) for cross-platform compatibility
- spawnSync (not execSync) for git/gh commands — structured exit handling
- Same-directory temp+rename for atomic writes — cross-filesystem rename breaks atomicity
- npm default placeholder detection prevents false positives on fresh projects
- current-branch exempt from flow bypass (informational, not workflow action)
- Protected branch list includes configured dev_branch dynamically
- merge-tree preferred for conflict detection on git >= 2.38, dry-run fallback for older
- Build gate placed between record_completion_time and generate_user_setup in execute-plan workflow
- BUILD_GATE_RESULT propagates from build_gate step to create_summary for SUMMARY inclusion
- Plan branches per-plan (not per-phase) for maximum isolation
- Branch cleanup is best-effort and non-blocking
- Legacy branching_strategy preserved as fallback alongside git_flow
- [Phase 10]: Reorder create_summary before create_pr_and_merge so PR body can reference SUMMARY.md content
- [Phase 10]: cmdGitStatus is informational (no flow bypass), same rationale as current-branch
- [Phase 10]: progress.md git-status call uses JSON output (not --raw) for jq parsing
- [Phase 10]: Branch cleanup verifies dev checkout before deletion (defensive check)
- [Phase 10]: Gate 3 reuses run-build-gate with same pass/fail/timeout/skip handling
- [Phase 10]: git_flow=github and legacy handle_branches are mutually exclusive paths
- [Phase 11]: Queue entries use mr-NNN IDs, merged array capped at 50
- [Phase 11]: Signal files written atomically on terminal status changes
- [Phase 11]: Gate 2 always aborts merge in finally block, crash recovery aborts leftovers
- [Phase 11]: Repo manager agent uses 7 rules enforcing wave ordering, dev-branch verification, crash recovery
- [Phase 11]: Workflow dual-location pattern: source (hive/) with ~/ paths, installed (.claude/) with ./ paths
- [Phase 11]: Agents live only in .claude/agents/ (no hive/agents/ source directory)
- [Phase 11]: repo_manager defaults to false (opt-in), queue failure falls back to self-merge
- [Phase 11]: Queued plans skip self-merge and dev checkout, repo manager handles lifecycle

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

**Last session:** 2026-02-12
**Stopped at:** Phase 11 verified (5/5 must-haves passed)
**Resume file:** v2.0 milestone complete. Next: `/hive:complete-milestone`
