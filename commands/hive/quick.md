---
name: hive:quick
description: Execute a quick task with Hive guarantees (atomic commits, state tracking) but skip optional agents
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
---
<objective>
Execute small, ad-hoc tasks with Hive guarantees (atomic commits, STATE.md tracking) while skipping optional agents (research, plan-checker, verifier).

Quick mode is the same system with a shorter path:
- Spawns hive-planner (quick mode) + hive-executor(s)
- Skips hive-phase-researcher, hive-plan-checker, hive-verifier
- Quick tasks live in `.planning/quick/` separate from planned phases
- Updates STATE.md "Quick Tasks Completed" table (NOT ROADMAP.md)

Use when: You know exactly what to do and the task is small enough to not need research or verification.
</objective>

<execution_context>
@~/.claude/hive/workflows/quick.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<process>
Execute the quick workflow from @~/.claude/hive/workflows/quick.md end-to-end.
Preserve all workflow gates (validation, task description, planning, execution, state updates, commits).
</process>
