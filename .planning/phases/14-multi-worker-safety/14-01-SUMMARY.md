---
phase: 14-multi-worker-safety
plan: 01
subsystem: infra
tags: [queue, lease, merge-queue, config, branch-protection]

# Dependency graph
requires:
  - phase: 13-build-pipeline
    provides: "Build gates and pre_main_command in hive-tools.js"
provides:
  - "Queue lease fields (lease_owner, lease_expires_at) for multi-worker safety"
  - "Configurable protected branches via git.main_branch and git.protected_branches"
  - "Config-driven merge-dev-to-main (no hardcoded main/master)"
affects: [14-02, merge-queue, git-operations]

# Tech tracking
tech-stack:
  added: []
  patterns: [lease-based-queue-ownership, config-driven-branch-protection]

key-files:
  created: []
  modified:
    - "hive/bin/hive-tools.js"
    - ".claude/hive/bin/hive-tools.js"
    - "hive/templates/config.json"
    - ".claude/hive/templates/config.json"

key-decisions:
  - "Queue entries start unleased (null/null) for backward compatibility; lease only set via queue-update"
  - "Empty protected_branches array auto-derives from [main_branch, dev_branch] for zero-config defaults"
  - "Lease cleared on any terminal status (merged, conflict, build_failed, merge_failed)"

patterns-established:
  - "Lease ownership: lease_owner + lease_expires_at fields on queue entries for worker coordination"
  - "Config-driven branch protection: git.protected_branches overrides hardcoded defaults"

# Metrics
duration: 3min
completed: 2026-02-16
---

# Phase 14 Plan 01: Queue Lease & Configurable Branches Summary

**Queue lease fields (lease_owner/lease_expires_at) for multi-worker safety and config-driven protected branches replacing hardcoded main/master**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T00:34:20Z
- **Completed:** 2026-02-16T00:37:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Queue entries now include lease_owner and lease_expires_at fields for multi-worker coordination
- queue-update accepts --lease-owner and --lease-ttl for claiming entries; leases auto-clear on terminal status
- queue-status reports leased_count and stale_lease_count for monitoring
- merge-dev-to-main uses config.git.main_branch instead of hardcoded main/master fallback
- delete-plan-branch uses config.git.protected_branches or auto-derives from main + dev

## Task Commits

Each task was committed atomically:

1. **Task 1: Add queue lease fields and configurable protected branches to hive-tools.js** - `d6687ef` (feat)
2. **Task 2: Update config template with main_branch and protected_branches fields** - `1231308` (chore)

## Files Created/Modified
- `hive/bin/hive-tools.js` - loadConfig, queue-submit, queue-update, queue-status, merge-dev-to-main, delete-plan-branch modifications
- `.claude/hive/bin/hive-tools.js` - Identical installed copy
- `hive/templates/config.json` - Added git.main_branch and git.protected_branches fields
- `.claude/hive/templates/config.json` - Identical installed copy

## Decisions Made
- Queue entries start unleased (null/null) on submit for full backward compatibility; lease only set when a worker claims via queue-update
- Empty protected_branches array (default) auto-derives protection from [main_branch, dev_branch] for zero-config operation
- Lease cleared on any terminal status to prevent stale lease accumulation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Queue lease infrastructure ready for 14-02 (queue processor with lease-aware claim logic)
- Config template updated for projects to configure their branch names
- Backward compatible: existing queue entries without lease fields will work (null defaults)

## Self-Check: PASSED

All 5 files found. All 2 commits verified.

---
*Phase: 14-multi-worker-safety*
*Completed: 2026-02-16*
