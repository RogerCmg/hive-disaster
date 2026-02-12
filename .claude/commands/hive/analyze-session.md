---
name: hive:analyze-session
description: Analyze a Claude Code session transcript for reasoning quality, wasted context, and patterns
allowed-tools:
  - Read
  - Bash
  - Write
  - Glob
  - Grep
  - Task
---
<objective>
Analyze a Claude Code session transcript using the hive-recall-analyst agent. Extracts transcript data, spawns the analyst, and emits a session_summary event.
</objective>

<execution_context>
@./.claude/hive/workflows/analyze-session.md
</execution_context>

<process>
Execute the analyze-session workflow from @./.claude/hive/workflows/analyze-session.md end-to-end.
If a session ID was provided in the user's command, pass it to the workflow.
</process>
