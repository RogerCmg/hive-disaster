---
phase: 04-feedback-loop
plan: "02"
subsystem: workflows
tags: [telemetry, recall, workflows, agent-prompts, feedback-loop]

# Dependency graph
requires:
  - phase: 04-feedback-loop
    provides: "getRecallContext helper, recall_context field in 8 agent-spawning init commands"
provides:
  - "Conditional <recall> block injection in all 10 agent-spawning workflow files"
  - "36 total recall injection points across all Task() prompts"
  - "Source (hive/) and installed (.claude/hive/) copies synchronized"
affects: [04-03-insights-command]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional recall block: {If RECALL is non-empty, include this block:} <recall>...</recall>"
    - "RECALL extraction via jq: $(echo $INIT | jq -r '.recall_context // empty')"
    - "Source-to-installed copy with sed path conversion: ~/. -> ./."

key-files:
  created: []
  modified:
    - "hive/workflows/execute-phase.md"
    - "hive/workflows/plan-phase.md"
    - "hive/workflows/quick.md"
    - "hive/workflows/new-project.md"
    - "hive/workflows/new-milestone.md"
    - "hive/workflows/research-phase.md"
    - "hive/workflows/verify-work.md"
    - "hive/workflows/diagnose-issues.md"
    - "hive/workflows/map-codebase.md"
    - "hive/workflows/audit-milestone.md"
    - ".claude/hive/workflows/execute-phase.md"
    - ".claude/hive/workflows/plan-phase.md"
    - ".claude/hive/workflows/quick.md"
    - ".claude/hive/workflows/new-project.md"
    - ".claude/hive/workflows/new-milestone.md"
    - ".claude/hive/workflows/research-phase.md"
    - ".claude/hive/workflows/verify-work.md"
    - ".claude/hive/workflows/diagnose-issues.md"
    - ".claude/hive/workflows/map-codebase.md"
    - ".claude/hive/workflows/audit-milestone.md"

key-decisions:
  - "Place recall block after files_to_read/context sections and before success_criteria in Task() prompts"
  - "Use {If RECALL is non-empty} conditional to avoid injecting empty recall blocks"
  - "For workflows without recall_context in init (research-phase, audit-milestone), use phase-op init as proxy"
  - "Append recall to debug subagent template (diagnose-issues) rather than inline in Task() calls"

patterns-established:
  - "Recall injection pattern: extract RECALL from INIT JSON, conditionally include <recall> block in Task() prompts"
  - "Source-to-installed synchronization: sed 's|~/\\.claude/|./.claude/|g' for path conversion"

# Metrics
duration: 8min
completed: 2026-02-12
---

# Phase 4 Plan 02: Recall Block Injection into Workflows Summary

**Conditional `<recall>` blocks injected into all 10 agent-spawning workflow files (20 file writes, 36 injection points) to feed telemetry patterns to every spawned agent**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-12T03:02:19Z
- **Completed:** 2026-02-12T03:10:56Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments
- Added RECALL extraction from init JSON to all 10 workflow files that spawn agents
- Injected conditional `<recall>` blocks into 36 Task() prompts across all workflows
- Core workflows (execute-phase, plan-phase, quick) handle 3+4+2=9 injection points for executors, planners, researchers, checkers, and verifiers
- Remaining 7 workflows (new-project, new-milestone, research-phase, verify-work, diagnose-issues, map-codebase, audit-milestone) handle 27 injection points across researchers, synthesizers, roadmappers, debug agents, mapper agents, and integration checkers
- Synchronized all 10 source files (hive/) with installed copies (.claude/hive/) maintaining path convention

## Task Commits

Each task was committed atomically:

1. **Task 1: Add recall block to core execution workflows (execute-phase, plan-phase, quick)** - `52bca27` (feat)
2. **Task 2: Add recall block to remaining 7 agent-spawning workflows** - `ab1b1b1` (feat)

## Files Created/Modified
- `hive/workflows/execute-phase.md` - RECALL extraction + 3 recall blocks (team executor, standalone executor, verifier)
- `hive/workflows/plan-phase.md` - RECALL extraction + 4 recall blocks (researcher, planner, checker, revision planner)
- `hive/workflows/quick.md` - RECALL extraction + 2 recall blocks (planner, executor)
- `hive/workflows/new-project.md` - RECALL extraction + 12 recall blocks (team: 4 researchers + synthesizer, standalone: 4 researchers + synthesizer, roadmapper, revision roadmapper)
- `hive/workflows/new-milestone.md` - RECALL extraction + 3 recall blocks (researcher template, synthesizer, roadmapper)
- `hive/workflows/research-phase.md` - RECALL extraction via phase-op + 1 recall block (phase researcher)
- `hive/workflows/verify-work.md` - RECALL extraction + 3 recall blocks (gap planner, checker, revision planner)
- `hive/workflows/diagnose-issues.md` - RECALL extraction + template injection for debug agents
- `hive/workflows/map-codebase.md` - RECALL extraction + 4 recall blocks (tech, arch, quality, concerns mappers)
- `hive/workflows/audit-milestone.md` - RECALL extraction via phase-op proxy + 3 recall blocks (integration checker team+standalone, phase readers)
- `.claude/hive/workflows/*` - All 10 installed copies synchronized (path-converted)

## Decisions Made
- Placed recall block after files_to_read/context sections and before success_criteria to be available during agent initialization but not distort task instructions
- Used `{If RECALL is non-empty, include this block:}` conditional pattern (consistent across all 36 injection points)
- For research-phase.md (no init JSON call), used `phase-op` init as proxy to get recall_context since getRecallContext reads from project-level INSIGHTS.md regardless of phase
- For audit-milestone.md (milestone-op init excluded from recall_context), also used phase-op init with phase 1 as proxy
- For diagnose-issues.md, appended recall to `filled_debug_subagent_prompt` template rather than duplicating in team+standalone Task() calls

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 10 workflows now pass telemetry patterns from INSIGHTS.md to every spawned agent via `<recall>` blocks
- The feedback loop is closed: events are recorded (Phase 1) -> observed by hooks (Phase 2) -> emitted by workflows (Phase 3) -> digested into patterns (Plan 04-01) -> fed back to agents (this plan)
- Plan 04-03 (insights command) can provide user-facing access to the same pattern data

## Self-Check: PASSED

- FOUND: 04-02-SUMMARY.md
- FOUND: commit 52bca27 (Task 1)
- FOUND: commit ab1b1b1 (Task 2)
- All 10 source files contain <recall>: verified
- All 10 installed copies contain <recall>: verified
- Conditional injection ("non-empty") counts: 3+4+2+12+3+1+3+1+4+3 = 36

---
*Phase: 04-feedback-loop*
*Completed: 2026-02-12*
