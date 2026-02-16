---
phase: 12-resilience
plan: 01
subsystem: infra
tags: [process-group, spawn, timeout, orphan-killing, node-child-process]

# Dependency graph
requires: []
provides:
  - "execCommand with process-group-aware timeout killing"
  - "No orphan child processes after build timeout"
affects: [build-gate, git-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "detached process group for tree killing on timeout"
    - "negative PID signal for process group SIGKILL"

key-files:
  created: []
  modified:
    - "hive/bin/hive-tools.js"
    - ".claude/hive/bin/hive-tools.js"

key-decisions:
  - "Use detached:true + process.kill(-pid) instead of alternative approaches like child_process shell kill"
  - "Skip detached on Windows where process groups work differently"
  - "Use SIGKILL (not SIGTERM) for process group kill since timeout already implies graceful window expired"

patterns-established:
  - "Process group killing: spawn detached, kill -pid on timeout"

# Metrics
duration: 1min
completed: 2026-02-15
---

# Phase 12 Plan 01: Process Group Killing on Build Timeout Summary

**execCommand hardened with detached process groups and SIGKILL to entire process tree on timeout, preventing orphan child processes**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-15T15:47:11Z
- **Completed:** 2026-02-15T15:48:09Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- execCommand now spawns child processes in their own process group (detached:true on non-Windows)
- On timeout, sends SIGKILL to the entire process group (-pid) instead of just the parent
- Return shape completely unchanged -- all callers (cmdGitRunBuildGate, cmdGitRunGate2, etc.) work without modification
- Both copies of hive-tools.js updated identically

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace spawnSync with process-group-aware timeout killing in execCommand** - `604f315` (feat)

## Files Created/Modified
- `hive/bin/hive-tools.js` - execCommand function updated with detached process group and group kill on timeout
- `.claude/hive/bin/hive-tools.js` - Installed copy updated identically

## Decisions Made
- Used `detached: true` on non-Windows only (Windows process groups work differently)
- Used SIGKILL (not SIGTERM) for the process group kill since timeout already implies the graceful termination window has expired
- Wrapped process.kill in try/catch since the process group may already be dead by the time we try to kill it

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `.claude/hive/bin/hive-tools.js` is in `.gitignore` but tracked by git -- required `git add -f` to stage. This is a known project pattern, not a bug.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Build timeout process killing is hardened
- Ready for Plan 02 (next resilience hardening)
- No blockers or concerns

## Self-Check: PASSED

- [x] hive/bin/hive-tools.js exists
- [x] .claude/hive/bin/hive-tools.js exists
- [x] 12-01-SUMMARY.md exists
- [x] Commit 604f315 exists

---
*Phase: 12-resilience*
*Completed: 2026-02-15*
