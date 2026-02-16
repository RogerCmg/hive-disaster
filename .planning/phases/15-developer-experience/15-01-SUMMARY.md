---
phase: 15-developer-experience
plan: 01
subsystem: tooling
tags: [changelog, keep-a-changelog, auto-push, git, hive-tools, milestone]
one-liner: "CHANGELOG generation from SUMMARY.md one-liners in Keep a Changelog format, plus config-gated auto-push after dev-to-main merge"

requires:
  - phase: 14-multi-worker-safety
    provides: "merge-dev-to-main and loadConfig infrastructure"
provides:
  - "generateChangelog function producing Keep a Changelog format from SUMMARY.md data"
  - "git_auto_push config field gating automatic push after merge"
  - "needs_push flag in merge result when auto_push is off"
  - "generate_changelog step in complete-milestone workflow"
affects: [complete-milestone, milestone-ops]

tech-stack:
  added: []
  patterns: [Keep a Changelog format generation, config-gated git push]

key-files:
  created: []
  modified:
    - hive/bin/hive-tools.js
    - .claude/hive/bin/hive-tools.js
    - hive/workflows/complete-milestone.md
    - .claude/hive/workflows/complete-milestone.md

key-decisions:
  - "CHANGELOG written to .planning/CHANGELOG.md (project-scoped, not package root)"
  - "auto_push defaults to false for safety — users must opt in"
  - "One-liners classified as Added/Changed/Fixed by prefix matching"

patterns-established:
  - "Config-gated side effects: dangerous operations (push) always default to off"

duration: 3min
completed: 2026-02-16
---

# Phase 15 Plan 01: CHANGELOG & Auto-Push Summary

**CHANGELOG generation from SUMMARY.md one-liners in Keep a Changelog format, plus config-gated auto-push after dev-to-main merge**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T18:09:36Z
- **Completed:** 2026-02-16T18:13:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- generateChangelog function reads SUMMARY.md one-liners and accomplishment bullets, categorizes as Added/Changed/Fixed, writes Keep a Changelog format
- cmdMilestoneComplete now calls generateChangelog and includes changelog_generated/changelog_entries in result
- loadConfig reads git.auto_push with false default, cmdGitMergeDevToMain auto-pushes or returns needs_push based on config
- complete-milestone.md workflow has new generate_changelog step and auto-push result handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CHANGELOG generation and auto-push to hive-tools** - `f4dd6c6` (feat)
2. **Task 2: Update complete-milestone workflow** - `648b4ad` (feat)

## Files Created/Modified
- `hive/bin/hive-tools.js` - Added generateChangelog function, updated cmdMilestoneComplete, loadConfig, cmdGitMergeDevToMain
- `.claude/hive/bin/hive-tools.js` - Synced installed copy
- `hive/workflows/complete-milestone.md` - Added generate_changelog step, auto-push handling, CHANGELOG.md in commit files
- `.claude/hive/workflows/complete-milestone.md` - Synced installed copy

## Decisions Made
- CHANGELOG.md placed in .planning/ directory (project-scoped, consistent with existing planning artifacts)
- auto_push defaults to false — safe default, users opt in via config.json git.auto_push: true
- Entry classification uses prefix matching on one-liners (fix/refactor/change/update -> Changed/Fixed, everything else -> Added)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CHANGELOG generation and auto-push ready for milestone completion workflows
- No blockers for remaining Phase 15 plans

---
*Phase: 15-developer-experience*
*Completed: 2026-02-16*
