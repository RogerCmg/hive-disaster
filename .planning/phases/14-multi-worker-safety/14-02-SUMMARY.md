---
phase: 14-multi-worker-safety
plan: 02
subsystem: infra
tags: [merge-strategy, per-plan-override, queue, self-merge, git-flow]

# Dependency graph
requires:
  - phase: 14-01
    provides: "Queue lease fields and configurable branches in hive-tools.js"
provides:
  - "Per-plan merge strategy override via PLAN.md frontmatter merge_strategy field"
  - "self-merge-pr --strategy flag with validation (merge/squash/rebase)"
  - "queue-submit --merge-strategy flag stored in queue entries"
  - "execute-plan reads frontmatter and passes strategy to self-merge-pr and queue-submit"
  - "manage-repo reads per-entry merge_strategy and passes to self-merge-pr"
affects: [merge-queue, git-operations, execute-plan]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-plan-strategy-override, frontmatter-driven-config]

key-files:
  created: []
  modified:
    - "hive/bin/hive-tools.js"
    - ".claude/hive/bin/hive-tools.js"
    - "hive/workflows/execute-plan.md"
    - ".claude/hive/workflows/execute-plan.md"
    - "hive/workflows/manage-repo.md"
    - ".claude/hive/workflows/manage-repo.md"

key-decisions:
  - "Strategy override uses precedence chain: --strategy flag > plan frontmatter > config.git_merge_strategy > 'merge' default"
  - "Invalid strategies rejected with explicit error listing valid options (merge/squash/rebase)"
  - "merge_strategy stored as null in queue entries when not specified for backward compatibility"

patterns-established:
  - "Per-plan override via frontmatter: plans can set merge_strategy in YAML frontmatter to override global config"
  - "Strategy passthrough: execute-plan reads frontmatter and passes to both self-merge and queue-submit paths"

# Metrics
duration: 3min
completed: 2026-02-16
---

# Phase 14 Plan 02: Per-Plan Merge Strategy Summary

**Per-plan merge strategy override via PLAN.md frontmatter with --strategy flag on self-merge-pr and --merge-strategy on queue-submit**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T00:40:16Z
- **Completed:** 2026-02-16T00:43:16Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- self-merge-pr now accepts --strategy flag that overrides global config with validation (merge/squash/rebase)
- queue-submit stores per-plan merge_strategy in queue entries via --merge-strategy flag
- execute-plan reads merge_strategy from PLAN.md frontmatter and passes it to both self-merge-pr and queue-submit
- manage-repo reads merge_strategy from queue entries and passes it to self-merge-pr during wave processing
- Full backward compatibility: no merge_strategy in frontmatter uses global config default

## Task Commits

Each task was committed atomically:

1. **Task 1: Add --strategy override to self-merge-pr and --merge-strategy to queue-submit** - `eea35a9` (feat)
2. **Task 2: Update execute-plan.md and manage-repo.md to pass per-plan merge strategy** - `b42d61d` (feat)

## Files Created/Modified
- `hive/bin/hive-tools.js` - cmdGitSelfMergePr with strategyOverride param, queue entry merge_strategy field, CLI dispatch for both flags
- `.claude/hive/bin/hive-tools.js` - Identical installed copy
- `hive/workflows/execute-plan.md` - Reads merge_strategy from frontmatter, passes --strategy to self-merge-pr, passes --merge-strategy to queue-submit
- `.claude/hive/workflows/execute-plan.md` - Identical installed copy
- `hive/workflows/manage-repo.md` - Reads merge_strategy from queue entry, passes --strategy to self-merge-pr
- `.claude/hive/workflows/manage-repo.md` - Identical installed copy

## Decisions Made
- Strategy override precedence: --strategy CLI flag > plan frontmatter merge_strategy > config.git_merge_strategy > 'merge' default
- Invalid strategies rejected with clear error message listing valid options
- Queue entries store merge_strategy as null when not specified for backward compat

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Per-plan merge strategy fully wired through both single-terminal and repo-manager merge paths
- Plans can now set `merge_strategy: squash` in frontmatter to override the global merge strategy
- Backward compatible: existing plans without merge_strategy continue using global config

## Self-Check: PASSED

All 7 files found. All 2 commits verified.

---
*Phase: 14-multi-worker-safety*
*Completed: 2026-02-16*
