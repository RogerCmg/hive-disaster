---
phase: 13-build-pipeline
plan: 01
subsystem: infra
tags: [build-pipeline, array-commands, build-gates, config]

# Dependency graph
requires:
  - phase: 12-resilience
    provides: "Build gate functions (cmdGitRunBuildGate, cmdGitRunGate2) and orphan-safe execCommand"
provides:
  - "Array build pipeline execution (sequential, stop-on-first-failure)"
  - "require_build config flag for strict build enforcement"
affects: [build-pipeline, git-flow]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Array.isArray pipeline pattern for sequential command execution"]

key-files:
  created: []
  modified:
    - "hive/bin/hive-tools.js"
    - ".claude/hive/bin/hive-tools.js"
    - "hive/templates/config.json"
    - ".claude/hive/templates/config.json"

key-decisions:
  - "Array pipeline uses sequential execution with stop-on-first-failure (not parallel)"
  - "Pipeline field only present in output when commands.length > 1 (backward compatible)"
  - "require_build defaults to false to preserve existing skip behavior"

patterns-established:
  - "Array-or-string config: normalize with Array.isArray(x) ? x : [x] before iteration"

# Metrics
duration: 3min
completed: 2026-02-15
---

# Phase 13 Plan 01: Array Build Pipeline and require_build Summary

**Array build_command pipeline support (sequential, stop-on-first-failure) and require_build enforcement in all build gates**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-15T21:40:29Z
- **Completed:** 2026-02-15T21:43:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- build_command now accepts an array of commands that execute sequentially, stopping on first failure
- Single-string build_command continues to work unchanged (full backward compatibility)
- New require_build flag causes build gates to error instead of silently skipping when no build command is detected
- Both cmdGitRunBuildGate and cmdGitRunGate2 updated with matching behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Add array pipeline execution and require_build to hive-tools.js** - `d2672f7` (feat)
2. **Task 2: Update config template with require_build field** - `4f15b8c` (chore)

## Files Created/Modified
- `hive/bin/hive-tools.js` - loadConfig: git_require_build field; cmdGitRunBuildGate: array pipeline + require_build; cmdGitRunGate2: matching changes
- `.claude/hive/bin/hive-tools.js` - Identical copy of hive/bin/hive-tools.js
- `hive/templates/config.json` - Added require_build: false to build_gates section
- `.claude/hive/templates/config.json` - Identical copy of hive/templates/config.json

## Decisions Made
- Array pipeline uses sequential execution (not parallel) -- multi-step builds like lint/test/build must run in order
- Pipeline output field only included when more than one command exists, keeping single-command output unchanged
- require_build defaults to false so existing projects with no build command continue to skip silently

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Array build pipeline and require_build ready for use
- Config template updated for new projects
- Ready for Plan 02 (if applicable)

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 13-build-pipeline*
*Completed: 2026-02-15*
