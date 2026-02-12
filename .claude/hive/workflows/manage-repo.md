<purpose>
Process the merge queue with wave-aware ordering, conflict detection, Gate 2 pre-merge build validation, and file-based signaling. Ensures parallel plan merges never break dev.
</purpose>

<required_reading>
@./.claude/hive/references/git-integration.md
</required_reading>

<process>

<step name="init_context" priority="first">
Load repo manager context:

```bash
QUEUE_STATUS=$(node ./.claude/hive/bin/hive-tools.js git queue-status --raw)
PENDING=$(echo "$QUEUE_STATUS" | jq -r '.pending_count')
FAILED=$(echo "$QUEUE_STATUS" | jq -r '.failed_count')
```

If PENDING is 0 and FAILED is 0:
- Report: "Merge queue is empty. Nothing to process."
- Suggest: "Submit plans to the queue via execute-phase with repo_manager enabled, or manually via `hive-tools.js git queue-submit`."
- Exit.

If PENDING is 0 but FAILED > 0:
- Report: "No pending entries, but ${FAILED} failed entries remain."
- Show failed entries from QUEUE_STATUS
- Suggest resolution options
- Exit unless user wants to retry.
</step>

<step name="verify_environment">
Verify git environment is ready:

```bash
GIT_DETECT=$(node ./.claude/hive/bin/hive-tools.js git detect --raw)
GIT_VERSION=$(echo "$GIT_DETECT" | jq -r '.git.version')
MERGE_TREE=$(echo "$GIT_DETECT" | jq -r '.git.merge_tree_available')
```

Report: "Git ${GIT_VERSION}, merge-tree: ${MERGE_TREE}"

Check current branch and ensure on dev:
```bash
CURRENT_BRANCH=$(node ./.claude/hive/bin/hive-tools.js git current-branch --raw | jq -r '.branch')
DEV_BRANCH=$(cat .planning/config.json 2>/dev/null | jq -r '.git.dev_branch // "dev"')
```

If not on dev: `git checkout "${DEV_BRANCH}"`.
Clean leftover merge state: `git merge --abort 2>/dev/null || true`.
</step>

<step name="process_waves">
Read queue and process by wave.

```bash
QUEUE_STATUS=$(node ./.claude/hive/bin/hive-tools.js git queue-status --raw)
PENDING_ENTRIES=$(echo "$QUEUE_STATUS" | jq -c '.pending')
```

Extract unique waves:
```bash
WAVES=$(echo "$PENDING_ENTRIES" | jq -r '[.[].wave] | unique | sort_by(.) | .[]')
```

For each wave (lowest first):

1. Log: "Processing Wave ${WAVE} (${ENTRY_COUNT} entries)"

2. For each entry in wave:
   a. **Conflict check:** `node ./.claude/hive/bin/hive-tools.js git check-conflicts --branch "${BRANCH}" --raw`
      - Clean -> proceed
      - Conflict -> `queue-update --status conflict`, skip entry

   b. **Gate 2 build:** `node ./.claude/hive/bin/hive-tools.js git run-gate-2 --branch "${BRANCH}" --raw`
      - Pass/skip -> proceed
      - Fail -> `queue-update --status build_failed`, present fix/skip/stop options

   c. **Merge PR:** `node ./.claude/hive/bin/hive-tools.js git self-merge-pr "${PR_NUMBER}" --raw`
      - Success -> `queue-update --status merged --merge-sha ${SHA}`, checkout dev, pull
      - Fail -> `queue-update --status merge_failed`, report

3. After wave: check for failures. If any failed: STOP, report, wait for resolution or force.
</step>

<step name="report_results">
After all processing:

```bash
FINAL=$(node ./.claude/hive/bin/hive-tools.js git queue-status --raw)
```

Display summary: total processed, merged count, failed count, dev HEAD.

If all merged: suggest next steps (complete-milestone if last phase).
If failures remain: list them with recommended actions.
</step>

</process>

<success_criteria>
- All pending queue entries processed in wave-aware order
- Conflicts detected before merge attempt
- Gate 2 validates integration before merge
- Failed entries flagged with clear error information
- Dev branch updated after each successful merge
- Wave ordering preserved (Wave N must complete before Wave N+1)
</success_criteria>
