---
name: hive:insights
description: Display current telemetry insights and offer to regenerate the digest
allowed-tools:
  - Read
  - Bash
  - Write
  - Glob
  - Grep
---
<objective>
Display current project telemetry insights, show pattern summary, check staleness, and offer to regenerate the digest.
</objective>

<execution_context>
@./.claude/hive/workflows/insights.md
</execution_context>

<process>
Execute the insights workflow from @./.claude/hive/workflows/insights.md end-to-end.
</process>
