# P0.2: Planner↔Checker Live Dialogue - Implementation Report

> Completed: 2026-02-11
> Pattern: Live Dialogue (persistent teammates with messaging)
> Status: IMPLEMENTED (4 files updated)

---

## Summary

Transformed the planning revision loop from "spawn planner → kill → spawn checker → kill → respawn planner → kill → respawn checker → kill" (4-6 sequential Task() spawns) to "2 persistent teammates communicating via SendMessage with targeted re-verification". All changes are dual-mode (team mode + standalone mode) with zero breaking changes.

## Key Innovation: Targeted Re-Verification

In standalone mode, every revision cycle requires the checker to re-read and re-verify ALL plans from scratch. In team mode, the planner reports WHICH plans changed, and the checker only re-checks those specific plans while skipping already-verified unchanged plans.

## Files Modified

### Wave 1 (Parallel - 3 changes)

#### 1. `hive/templates/config.json`
- Added `"planning_team": true` to teams section
- Now has both `execution_team` and `planning_team` flags

#### 2. `agents/hive-planner.md` (6 sections modified)
- **Frontmatter**: Added SendMessage, TaskUpdate, TaskList to tools
- **`<role>`**: Added team mode note (persistent teammate, revision with context)
- **New `<team_protocol>` section** (~75 lines):
  - Mode detection (SendMessage available + teammate invocation)
  - Mode differences table
  - Message protocol tables (planner→orchestrator, orchestrator→planner)
  - Message formats for PLANNING COMPLETE, REVISION COMPLETE, CHECKPOINT
  - "Revision With Context" section (key advantage: surgical revisions with full reasoning)
- **`<revision_mode>` Step 7**: Team mode SendMessage alternative
- **`<structured_returns>`**: Dual-mode gates for Planning Complete, Gap Closure, Checkpoint
- **`<success_criteria>`**: Team mode criteria (5 items)
- File grew from ~1158 to ~1316 lines (+158 lines)

#### 3. `agents/hive-plan-checker.md` (6 sections modified)
- **Frontmatter**: Added SendMessage, TaskUpdate, TaskList to tools
- **`<role>`**: Added team mode note (persistent teammate, targeted re-verification)
- **New `<team_protocol>` section** (~85 lines):
  - Mode detection
  - Mode differences table
  - Message protocol tables (checker→orchestrator, orchestrator→checker)
  - Message formats for VERIFICATION PASSED, ISSUES FOUND
  - **Targeted Re-Verification** section (key innovation: skip unchanged plans)
  - Direct clarification note (optional checker↔planner communication)
- **`<verification_process>`**: Team mode preamble for verification scope
- **`<structured_returns>`**: Dual-mode gates for VERIFICATION PASSED, ISSUES FOUND
- **`<success_criteria>`**: Team mode criteria (6 items)
- File grew from ~623 to ~778 lines (+155 lines)

### Wave 2 (Sequential - 1 change, depended on Wave 1)

#### 4. `hive/workflows/plan-phase.md` (8 sections modified/added)
- **New Step 7.5**: Create planning team with `TeamCreate("hive-plan-{phase}-{slug}")` + auto-fallback
- **Step 8**: Dual-mode planner spawn (teammate vs Task())
- **Step 9**: Dual-mode planner output (message monitoring vs return parsing)
- **Step 10**: Dual-mode checker spawn (teammate + VERIFY message vs Task())
- **Step 11**: Dual-mode checker output (message monitoring vs return parsing)
- **Step 12**: Dual-mode revision loop:
  - Team mode: Send REVISE → wait REVISION COMPLETE → Send RE-VERIFY with changed plan IDs → wait result (0 new spawns!)
  - Standalone: Original Task() respawn loop unchanged
- **New Step 12.5**: Team cleanup (shutdown requests + TeamDelete)
- **`<success_criteria>`**: 7 new team mode criteria
- File grew from ~377 to ~559 lines (+182 lines)

## Message Protocol Contract

### Planner → Orchestrator (4 message types)
| Prefix | When | Content |
|--------|------|---------|
| `PLANNING COMPLETE:` | Plans created | Plan count, wave count, file list |
| `CHECKPOINT:` | Need user input | Type, details, resume signal |
| `PLANNING INCONCLUSIVE:` | Cannot complete | Attempt count, reason |
| `REVISION COMPLETE:` | Revised after checker feedback | Changed plan IDs, changes summary |

### Checker → Orchestrator (2 message types)
| Prefix | When | Content |
|--------|------|---------|
| `VERIFICATION PASSED:` | All checks pass | Plan count, coverage summary |
| `ISSUES FOUND:` | Problems detected | Blocker/warning counts, structured YAML |

### Orchestrator → Planner (2 message types)
| Prefix | When | Content |
|--------|------|---------|
| `CHECKPOINT RESPONSE:` | User responded | User's response text |
| `REVISE:` | Checker found issues | Structured checker issues |

### Orchestrator → Checker (2 message types)
| Prefix | When | Content |
|--------|------|---------|
| `VERIFY:` | Plans ready | Path, focus scope (all or specific IDs) |
| `RE-VERIFY:` | Plans revised | Changed plan IDs, revision summary |

## Spawn Count Comparison

| Scenario | Standalone Mode | Team Mode |
|----------|----------------|-----------|
| Plan + verify (pass first time) | 2 spawns | 2 spawns (same) |
| Plan + verify + 1 revision | 4 spawns | 2 spawns (saved 2) |
| Plan + verify + 2 revisions | 6 spawns | 2 spawns (saved 4) |
| Plan + verify + 3 revisions | 8 spawns | 2 spawns (saved 6) |

## Backward Compatibility

- **Detection mechanism**: `planning_team` config flag + SendMessage availability
- **Mode gates**: `<team_mode>`, `<standalone_mode>`, `<team_mode_setup>` blocks
- **Zero breaking changes**: Standalone mode code preserved verbatim
- **Graceful degradation**: If TeamCreate fails, auto-falls back to standalone
- **Skip-verify shortcut**: If `--skip-verify`, no team created (no checker needed)

## Config Changes

```json
{
  "teams": {
    "execution_team": true,
    "planning_team": true
  }
}
```

## Cumulative Progress (P0.1 + P0.2)

### P0.1: Checkpoint as Messaging (5 files)
- config.json, checkpoints.md, hive-executor.md, execute-plan.md, execute-phase.md

### P0.2: Planner↔Checker Live Dialogue (4 files, 1 shared)
- config.json (shared), hive-planner.md, hive-plan-checker.md, plan-phase.md

### Total: 8 unique files modified across P0
- 3 agents: hive-executor.md, hive-planner.md, hive-plan-checker.md
- 3 workflows: execute-phase.md, execute-plan.md, plan-phase.md
- 1 reference: checkpoints.md
- 1 config: config.json

## What's Next

- **P1.1**: Shared Root Cause Discovery (diagnose-issues workflow)
- **P1.2**: Streaming Diagnose→Plan→Check Pipeline (verify-work workflow)
- **P1.3**: Dynamic Wave Scheduling (execute-phase enhancement)
- **Testing**: Verify both P0.1 and P0.2 team modes work end-to-end
