---
name: hive:manage-repo
description: Launch the repo manager to process the merge queue with conflict detection and build validation
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

Process the merge queue using the repo manager workflow.

@./.claude/hive/workflows/manage-repo.md

Follow the workflow instructions. The repo manager reads `.hive-workers/merge-queue.json` and processes pending merges in wave-aware order with conflict detection and Gate 2 build validation.
