<purpose>
Execute all plans in a phase using wave-based parallel execution. Orchestrator stays lean — delegates plan execution to subagents.
</purpose>

<core_principle>
Orchestrator coordinates, not executes. Each subagent loads the full execute-plan context. Orchestrator: discover plans → analyze deps → group waves → spawn agents → handle checkpoints → collect results.
</core_principle>

<required_reading>
Read STATE.md before any operation to load project context.
</required_reading>

<process>

<step name="initialize" priority="first">
Load all context in one call:

```bash
INIT=$(node ~/.claude/hive/bin/hive-tools.js init execute-phase "${PHASE_ARG}")
```

Parse JSON for: `executor_model`, `verifier_model`, `commit_docs`, `parallelization`, `branching_strategy`, `branch_name`, `git_flow`, `git_dev_branch`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `plans`, `incomplete_plans`, `plan_count`, `incomplete_count`, `state_exists`, `roadmap_exists`.

Extract recall context for agent prompts:
```bash
RECALL=$(echo "$INIT" | jq -r '.recall_context // empty')
```

**If `phase_found` is false:** Error — phase directory not found.
**If `plan_count` is 0:** Error — no plans found in phase.
**If `state_exists` is false but `.planning/` exists:** Offer reconstruct or continue.

When `parallelization` is false, plans within a wave execute sequentially.
</step>

<step name="handle_branching">
Check git flow config from init:

```bash
GIT_FLOW=$(echo "$INIT" | jq -r '.git_flow // "none"')
GIT_DEV_BRANCH=$(echo "$INIT" | jq -r '.git_dev_branch // "dev"')
BRANCHING_STRATEGY=$(echo "$INIT" | jq -r '.branching_strategy // "none"')
```

**Git flow "none" AND branching_strategy "none":** Skip, continue on current branch.

**Git flow "github" (Phase 9+ plan-level branching):**

Plan branches are created PER PLAN, not per phase. For each plan in the current wave, BEFORE spawning the executor:

1. Generate the branch name:
```bash
PLAN_SLUG=$(node ~/.claude/hive/bin/hive-tools.js generate-slug "${PLAN_NAME}" --raw)
BRANCH_NAME="hive/phase-${PHASE_NUMBER}-${PLAN_NUMBER}-${PLAN_SLUG}"
```

2. Check if branch already exists (re-execution case):
```bash
CURRENT=$(node ~/.claude/hive/bin/hive-tools.js git current-branch --raw)
CURRENT_BRANCH=$(echo "$CURRENT" | jq -r '.branch')
```

3. If already on the target branch: skip creation, log "Already on plan branch: ${BRANCH_NAME}".

4. If not on target branch, ensure dev branch exists first:
```bash
# Ensure we are on dev before branching
git checkout "${GIT_DEV_BRANCH}" 2>/dev/null || {
  # Dev branch missing — create it (handles upgrade from pre-Phase-9 projects)
  node ~/.claude/hive/bin/hive-tools.js git create-dev-branch --raw
}
```

5. Create the plan branch:
```bash
BRANCH_RESULT=$(node ~/.claude/hive/bin/hive-tools.js git create-plan-branch --name "${BRANCH_NAME}" --raw)
BRANCH_SUCCESS=$(echo "$BRANCH_RESULT" | jq -r '.success')
```

6. If success: continue. If branch already exists (re-execution): `git checkout "${BRANCH_NAME}"`.

7. Pass BRANCH_NAME to the executor agent prompt so it knows which branch it is on. Add to the executor spawn prompt:
```
<branch_context>
You are executing on branch: ${BRANCH_NAME}
All task commits go to this branch. Do NOT switch branches during execution.
</branch_context>
```

**Branching_strategy "phase" or "milestone" (legacy fallback):**

Preserve the existing behavior — use pre-computed `branch_name` from init:
```bash
git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
```

All subsequent commits go to this branch. User handles merging.
</step>

<step name="create_execution_team">
Check config flag and create execution team if enabled:

```bash
EXECUTION_TEAM=$(echo "$INIT" | jq -r '.teams.execution_team // false')
```

**If disabled:** set `TEAM_MODE=false`, skip to standalone execution.

**If enabled:** Attempt `TeamCreate` — if tool unavailable, fall back to standalone mode.

**Team creation (if enabled and available):**

Team is created ONCE per phase execution and persists across all waves.

```
TeamCreate(
  name="hive-execute-{phase_number}-{phase_slug}",
  members=[
    // Members added dynamically per wave - see execute_waves
  ]
)
```

**Team naming:** `hive-execute-{phase_number}-{phase_slug}` (e.g., `hive-execute-03-authentication`)

**Team lead role:** The orchestrator (main context) IS the team lead. It:
- Creates executor teammates per wave
- Receives checkpoint messages from executors
- Relays checkpoint info to user (via direct output or AskUserQuestion)
- Sends user responses back to idle executors
- Monitors progress messages
- Manages team lifecycle (shutdown executors after wave/phase)

**Fallback:** If `execution_team` is false in config, OR TeamCreate is not available (standalone Claude Code, older version), fall back to existing `Task()` + checkpoint_handling flow. Set `TEAM_MODE=false` and skip all team-specific logic.

```bash
TEAM_MODE=false  # Default
TEAM_NAME="hive-execute-${PHASE_NUMBER}-${PHASE_SLUG}"

if [ "$EXECUTION_TEAM" = "true" ]; then
  # Attempt TeamCreate — fall back to standalone if unavailable
  TEAM_MODE=true
fi
```
</step>

<step name="validate_phase">
From init JSON: `phase_dir`, `plan_count`, `incomplete_count`.

Report: "Found {plan_count} plans in {phase_dir} ({incomplete_count} incomplete)"
</step>

<step name="discover_and_group_plans">
Load plan inventory with wave grouping in one call:

```bash
PLAN_INDEX=$(node ~/.claude/hive/bin/hive-tools.js phase-plan-index "${PHASE_NUMBER}")
```

Parse JSON for: `phase`, `plans[]` (each with `id`, `wave`, `autonomous`, `objective`, `files_modified`, `task_count`, `has_summary`), `waves` (map of wave number → plan IDs), `incomplete`, `has_checkpoints`.

**Filtering:** Skip plans where `has_summary: true`. If `--gaps-only`: also skip non-gap_closure plans. If all filtered: "No matching incomplete plans" → exit.

Report:
```
## Execution Plan

**Phase {X}: {Name}** — {total_plans} plans across {wave_count} waves

| Wave | Plans | What it builds |
|------|-------|----------------|
| 1 | 01-01, 01-02 | {from plan objectives, 3-8 words} |
| 2 | 01-03 | ... |
```
</step>

<step name="execute_waves">
Execute each wave. Within a wave: parallel if `PARALLELIZATION=true`, sequential if `false`.

**MODE SPLIT:** Team mode vs. standalone mode (fallback).

<team_mode>
## Team Mode Execution (TEAM_MODE=true)

**For each wave:**

1. **Describe what's being built (BEFORE spawning) — unchanged from current:**

   Read each plan's `<objective>`. Extract what's being built and why.

   ```
   ---
   ## Wave {N}

   **{Plan ID}: {Plan Name}**
   {2-3 sentences: what this builds, technical approach, why it matters}

   Spawning {count} executor(s) as team members...
   ---
   ```

2. **Add executor teammates to the team:**

   For each plan in the wave, add a teammate. Each executor gets a unique name
   derived from their plan ID.

   **Executor teammate prompt:**
   ```
   TeamAddMember(
     team="{TEAM_NAME}",
     name="executor-{plan_id}",
     agent_type="hive-executor",
     model="{executor_model}",
     prompt="
       <objective>
       Execute plan {plan_number} of phase {phase_number}-{phase_name}.
       You are a team member. Communicate via SendMessage.
       </objective>

       <team_protocol>
       You are executor-{plan_id} on team {TEAM_NAME}.
       Team lead is the orchestrator. Send all checkpoints and progress via SendMessage.
       DO NOT use checkpoint_return_format. DO NOT return/exit at checkpoints.
       Instead: SendMessage to team lead and WAIT for response.
       </team_protocol>

       <execution_context>
       @~/.claude/hive/workflows/execute-plan.md
       @~/.claude/hive/templates/summary.md
       @~/.claude/hive/references/checkpoints.md
       @~/.claude/hive/references/tdd.md
       </execution_context>

       <files_to_read>
       Read these files at execution start using the Read tool:
       - Plan: {phase_dir}/{plan_file}
       - State: .planning/STATE.md
       - Config: .planning/config.json (if exists)
       </files_to_read>

       {If RECALL is non-empty, include this block:}

       <recall>
       Past project patterns from telemetry:
       {RECALL}
       Use these patterns to avoid known issues and follow proven approaches.
       </recall>

       <success_criteria>
       - [ ] All tasks executed
       - [ ] Each task committed individually
       - [ ] SUMMARY.md created in plan directory
       - [ ] STATE.md updated with position and decisions
       - [ ] Send PLAN COMPLETE message to team lead when done
       </success_criteria>
     "
   )
   ```

3. **Monitor executor messages (event loop):**

   The orchestrator enters a monitoring loop for the wave. It processes messages
   from executors as they arrive. The loop exits when ALL executors in the wave
   have either completed or fatally failed.

   **Message types the orchestrator handles:**

   | Message Prefix | Meaning | Orchestrator Action |
   |---------------|---------|---------------------|
   | `PROGRESS:` | Task completed | Parse progress, display inline update, track totals |
   | `CHECKPOINT:` | Executor hit checkpoint | Parse, relay to user, send response back |
   | `DEVIATION:` | Rule 4 architectural decision | Present to user, send decision back |
   | `PLAN COMPLETE` | Executor finished all tasks | Mark plan done, spot-check SUMMARY |
   | `PLAN FAILED` | Unrecoverable error | Mark plan failed, route to failure handler |

   **`PROGRESS:` message handling (real-time execution progress):**

   When an executor sends a `PROGRESS:` message:

   a. Parse the progress message for: plan ID, task number, total tasks, commit type, description.

      Expected message format from executor (multi-line):
      ```
      PROGRESS: {plan_id} task {N}/{total} complete
      Task: {task-name}
      Commit: {hash}
      Files: {key files}
      Deviations: {count or 'none'}
      ```

      Parse first line for plan_id, task number, and total. Remaining lines are metadata.

   b. Display inline progress update to user:
      ```
      ◆ [{plan_id}] Task {N}/{total}: {task-name}
      ```

   c. Track cumulative progress across all active plans:
      - Maintain per-plan task counts: `plan_progress[plan_id] = {completed: N, total: M}`
      - Compute totals: `total_completed = sum(all completed)`, `total_tasks = sum(all totals)`

   d. Display cumulative phase progress after each update:
      ```
      Phase progress: {total_completed}/{total_tasks} tasks across {active_plan_count} active plans
      ```

   e. When a plan reaches its final task (N == total), expect `PLAN COMPLETE` to follow shortly.
      Do NOT mark plan as done based on progress alone — wait for the explicit completion message.

   **Progress display budget:** Progress messages are frequent (one per task commit).
   To keep orchestrator context lean:
   - Display at most 1 line per progress update (the `◆` line above)
   - Display cumulative summary every 5th progress message (not every one)
   - If more than 3 plans are active, collapse individual updates into summary only:
     ```
     Phase progress: 12/28 tasks [plan-01: 4/6, plan-02: 5/8, plan-03: 3/14]
     ```
   - Never store full progress history — only current counts per plan

   **Checkpoint message handling (replaces checkpoint_handling step):**

   When an executor sends a `CHECKPOINT:` message:

   a. Parse the checkpoint message for: type, plan ID, progress, checkpoint details, awaiting
   b. Present to user with the standard checkpoint display format:
      ```
      ## Checkpoint: [Type]

      **Plan:** {plan_id} {plan_name}
      **Executor:** executor-{plan_id}
      **Progress:** {completed}/{total} tasks complete

      [Checkpoint Details from executor message]
      [Awaiting section from executor message]
      ```
   c. Wait for user response
   d. Send user response back to the executor:
      ```
      SendMessage(
        type="message",
        recipient="executor-{plan_id}",
        content="CHECKPOINT_RESPONSE: {user_response}",
        summary="Checkpoint response for {plan_id}"
      )
      ```
   d2. Emit the checkpoint resolution event for Recall:
      ```bash
      node ~/.claude/hive/bin/hive-tools.js telemetry emit checkpoint \
        --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"checkpoint_type\":\"${CHECKPOINT_TYPE}\",\"user_response\":\"${USER_RESPONSE}\",\"outcome\":\"${OUTCOME}\"}"
      ```
   e. Executor wakes up with full context, continues execution
   f. Continue monitoring other executors in the wave

   **Deviation Rule 4 handling:**

   When an executor sends a `DEVIATION:` message:

   a. Parse the deviation details (discovery, proposed change, impact, alternatives)
   b. Present to user:
      ```
      ## Architectural Decision Needed

      **Executor:** executor-{plan_id}
      **Current task:** [task name]

      [Deviation details from executor message]

      Proceed with proposed change? (yes / different approach / defer)
      ```
   c. Wait for user response
   d. Send decision back:
      ```
      SendMessage(
        type="message",
        recipient="executor-{plan_id}",
        content="DEVIATION_RESPONSE: {user_decision}",
        summary="Deviation decision for {plan_id}"
      )
      ```

   **Handling MULTIPLE concurrent checkpoints:**

   When wave has 3 executors and 2 hit checkpoints simultaneously:

   a. Both checkpoint messages arrive in the orchestrator's inbox
   b. Present them sequentially to the user (one at a time):
      ```
      ## Checkpoint Queue (2 pending)

      ### 1 of 2: Plan 03-01 — Verification Required
      [checkpoint details]
      → YOUR ACTION: Type "approved" or describe issues

      (After user responds to #1, present #2)

      ### 2 of 2: Plan 03-02 — Decision Required
      [checkpoint details]
      → YOUR ACTION: Select option
      ```
   c. Send each response back to the respective executor as soon as user responds
   d. Both executors resume independently
   e. Meanwhile, executor #3 (no checkpoint) may have already completed

   **Key advantage:** While executor-01 is idle at checkpoint, executor-03 continues
   running. No wave-level blocking for checkpoints.

4. **Spot-check on plan completion (unchanged logic, new trigger):**

   When receiving `PLAN COMPLETE` message from an executor, run the same spot-checks:
   - Verify first 2 files from `key-files.created` exist on disk
   - Check `git log --oneline --all --grep="{phase}-{plan}"` returns >=1 commit
   - Check for `## Self-Check: FAILED` marker in SUMMARY.md

   If spot-check fails: report which plan failed, ask "Retry plan?" or "Continue?"

   If pass: log completion, check if all wave executors done.

5. **Wave completion report (unchanged format):**

   When ALL executors in the wave have completed (or failed):
   ```
   ---
   ## Wave {N} Complete

   **{Plan ID}: {Plan Name}**
   {What was built -- from SUMMARY.md}
   {Notable deviations, if any}

   {If more waves: what this enables for next wave}
   ---
   ```

6. **Plan branch cleanup (git flow "github" only):**

   After wave completion and BEFORE proceeding to next wave, clean up plan branches that were merged during execute-plan's PR flow.

   **Note:** Plan branches are merged to dev via PR self-merge in execute-plan.md. This cleanup step handles the LOCAL branch deletion. The remote branch is already deleted by `gh pr merge --delete-branch`.

   For each completed plan in the wave (where git_flow is "github"):
   ```bash
   # Verify we are on dev (execute-plan should have left us here after PR merge)
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "${GIT_DEV_BRANCH}" ]; then
     git checkout "${GIT_DEV_BRANCH}" 2>/dev/null || true
   fi

   # Delete local plan branch (safe delete — succeeds because branch is merged to dev)
   CLEANUP=$(node ~/.claude/hive/bin/hive-tools.js git delete-plan-branch "${BRANCH_NAME}" --raw)
   CLEANUP_SUCCESS=$(echo "$CLEANUP" | jq -r '.success')
   ```

   If cleanup succeeds: log "Cleaned up branch: ${BRANCH_NAME}".
   If cleanup fails with "not fully merged": the plan's PR may not have been merged (gh unavailable, merge failed, etc.). Log warning: "Branch ${BRANCH_NAME} not fully merged to dev. Keeping for manual resolution." Do NOT force-delete.
   If cleanup fails with other error: log warning but do not block execution.

   Branch cleanup is BEST EFFORT. Stale branches are informational, not harmful.

7. **Sync dev branch (git flow "github" only):**

   After branch cleanup and BEFORE proceeding to next wave, pull dev to incorporate all merged work from this wave. This ensures next wave's plan branches fork from the latest dev state.

   ```bash
   # Only sync if on dev branch and git flow is active
   if [ "$GIT_FLOW" = "github" ]; then
     CURRENT=$(git branch --show-current)
     if [ "$CURRENT" = "${GIT_DEV_BRANCH}" ]; then
       git pull origin "${GIT_DEV_BRANCH}" 2>/dev/null || true
     fi
   fi
   ```

   If pull fails (e.g., no remote, network error): log warning "Could not sync dev from remote. Continuing with local state." Do NOT block execution -- local merges from this wave are already on dev. The pull primarily helps when remote has changes from other sources.

8. **Shutdown wave executors:**

   After wave completion, send shutdown requests to all executors in the wave:
   ```
   SendMessage(
     type="shutdown_request",
     recipient="executor-{plan_id}",
     content="Wave {N} complete. Shutting down."
   )
   ```

   Wait for shutdown confirmations. If an executor rejects (still processing),
   wait and retry after 30 seconds.

9. **Handle failures:**

   **classifyHandoffIfNeeded bug:** Same handling as current. If executor sends
   error containing this string, run spot-checks. Pass = success.

   **Real failure:** Report to user, ask Continue/Stop.

   **Executor dies without completing:** If executor teammate becomes unresponsive
   (no messages for extended period), check SUMMARY.md on disk. If present with
   Self-Check: PASSED, treat as success. Otherwise, report as failure.

10. **Proceed to next wave.**

</team_mode>

<standalone_mode>
## Standalone Mode (TEAM_MODE=false — fallback)

Identical to current execute_waves implementation. Uses Task() for spawning,
checkpoint_handling step for checkpoints, continuation agents for resumption.

**For each wave:**

1. **Describe what's being built (BEFORE spawning):**

   Read each plan's `<objective>`. Extract what's being built and why.

   ```
   ---
   ## Wave {N}

   **{Plan ID}: {Plan Name}**
   {2-3 sentences: what this builds, technical approach, why it matters}

   Spawning {count} agent(s)...
   ---
   ```

2. **Spawn executor agents:**

   Pass paths only — executors read files themselves with their fresh 200k context.
   This keeps orchestrator context lean (~10-15%).

   ```
   Task(
     subagent_type="hive-executor",
     model="{executor_model}",
     prompt="
       <objective>
       Execute plan {plan_number} of phase {phase_number}-{phase_name}.
       Commit each task atomically. Create SUMMARY.md. Update STATE.md.
       </objective>

       <execution_context>
       @~/.claude/hive/workflows/execute-plan.md
       @~/.claude/hive/templates/summary.md
       @~/.claude/hive/references/checkpoints.md
       @~/.claude/hive/references/tdd.md
       </execution_context>

       <files_to_read>
       Read these files at execution start using the Read tool:
       - Plan: {phase_dir}/{plan_file}
       - State: .planning/STATE.md
       - Config: .planning/config.json (if exists)
       </files_to_read>

       {If RECALL is non-empty, include this block:}

       <recall>
       Past project patterns from telemetry:
       {RECALL}
       Use these patterns to avoid known issues and follow proven approaches.
       </recall>

       <success_criteria>
       - [ ] All tasks executed
       - [ ] Each task committed individually
       - [ ] SUMMARY.md created in plan directory
       - [ ] STATE.md updated with position and decisions
       </success_criteria>
     "
   )
   ```

3. **Wait for all agents in wave to complete.**

4. **Report completion — spot-check claims first:**

   For each SUMMARY.md:
   - Verify first 2 files from `key-files.created` exist on disk
   - Check `git log --oneline --all --grep="{phase}-{plan}"` returns >=1 commit
   - Check for `## Self-Check: FAILED` marker

   If ANY spot-check fails: report which plan failed, route to failure handler — ask "Retry plan?" or "Continue with remaining waves?"

   If pass:
   ```
   ---
   ## Wave {N} Complete

   **{Plan ID}: {Plan Name}**
   {What was built — from SUMMARY.md}
   {Notable deviations, if any}

   {If more waves: what this enables for next wave}
   ---
   ```

5. **Handle failures:**

   **Known Claude Code bug (classifyHandoffIfNeeded):** If an agent reports "failed" with error containing `classifyHandoffIfNeeded is not defined`, this is a Claude Code runtime bug — not a Hive or agent issue. The error fires in the completion handler AFTER all tool calls finish. In this case: run the same spot-checks as step 4 (SUMMARY.md exists, git commits present, no Self-Check: FAILED). If spot-checks PASS → treat as **successful**. If spot-checks FAIL → treat as real failure below.

   For real failures: report which plan failed → ask "Continue?" or "Stop?" → if continue, dependent plans may also fail. If stop, partial completion report.

6. **Plan branch cleanup (git flow "github" only):**

   After wave completion and BEFORE proceeding to next wave, clean up plan branches that were merged during execute-plan's PR flow.

   **Note:** Plan branches are merged to dev via PR self-merge in execute-plan.md. This cleanup step handles the LOCAL branch deletion. The remote branch is already deleted by `gh pr merge --delete-branch`.

   For each completed plan in the wave (where git_flow is "github"):
   ```bash
   # Verify we are on dev (execute-plan should have left us here after PR merge)
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "${GIT_DEV_BRANCH}" ]; then
     git checkout "${GIT_DEV_BRANCH}" 2>/dev/null || true
   fi

   # Delete local plan branch (safe delete — succeeds because branch is merged to dev)
   CLEANUP=$(node ~/.claude/hive/bin/hive-tools.js git delete-plan-branch "${BRANCH_NAME}" --raw)
   CLEANUP_SUCCESS=$(echo "$CLEANUP" | jq -r '.success')
   ```

   If cleanup succeeds: log "Cleaned up branch: ${BRANCH_NAME}".
   If cleanup fails with "not fully merged": the plan's PR may not have been merged (gh unavailable, merge failed, etc.). Log warning: "Branch ${BRANCH_NAME} not fully merged to dev. Keeping for manual resolution." Do NOT force-delete.
   If cleanup fails with other error: log warning but do not block execution.

   Branch cleanup is BEST EFFORT. Stale branches are informational, not harmful.

7. **Sync dev branch (git flow "github" only):**

   After branch cleanup and BEFORE proceeding to next wave, pull dev to incorporate all merged work from this wave. This ensures next wave's plan branches fork from the latest dev state.

   ```bash
   # Only sync if on dev branch and git flow is active
   if [ "$GIT_FLOW" = "github" ]; then
     CURRENT=$(git branch --show-current)
     if [ "$CURRENT" = "${GIT_DEV_BRANCH}" ]; then
       git pull origin "${GIT_DEV_BRANCH}" 2>/dev/null || true
     fi
   fi
   ```

   If pull fails: log warning but do not block execution. Local merges are already present.

8. **Execute checkpoint plans between waves** — see `<checkpoint_handling>`.

9. **Proceed to next wave.**
</standalone_mode>
</step>

<step name="checkpoint_handling">
Plans with `autonomous: false` require user interaction.

<team_mode_checkpoints>
## Team Mode Checkpoint Flow (TEAM_MODE=true)

Checkpoints are handled INLINE in the execute_waves monitoring loop. This step
documents the protocol; the actual handling happens in step execute_waves item 3.

**Flow (replaces the 7-step spawn-die-respawn cycle):**

1. Executor works on plan tasks normally
2. Executor hits checkpoint task -> sends structured message to team lead
3. Team lead (orchestrator) receives message in monitoring loop
4. Team lead presents checkpoint to user (same display format as current)
5. User responds
6. Team lead sends response back to executor via SendMessage
7. Executor wakes up WITH FULL CONTEXT and continues
8. If executor hits another checkpoint -> repeat from step 2 (same agent!)

**Key differences from standalone mode:**
- No continuation agent spawn (same agent continues)
- No state serialization/parsing (context preserved in agent memory)
- No commit verification on resume (agent remembers its own commits)
- No file re-reading on resume (agent has files in context)
- Multiple checkpoints in same plan = 1 agent (not N agents)

**Checkpoint message format (sent by executor):**

```markdown
CHECKPOINT: {type}
PLAN: {plan_id}
PROGRESS: {completed}/{total}

### Checkpoint Details
{type-specific content - same as current checkpoint display}

### Awaiting
{what user needs to do/provide}
```

**Orchestrator display format (presented to user) — unchanged from current:**

```
## Checkpoint: [Type]

**Plan:** {plan_id} {plan_name}
**Progress:** {completed}/{total} tasks complete

[Checkpoint Details from executor message]
[Awaiting section from executor message]
```

**Response format (sent back to executor):**

```
CHECKPOINT_RESPONSE: {user_response}
```

Executor parses this and continues based on checkpoint type:
- human-verify: "approved" -> continue, issues -> address and re-verify
- decision: "{option_id}" -> implement selected option
- human-action: "done" -> verify action completed, retry original task

**Checkpoints in parallel waves:** Executor pauses (goes idle) while other executors
in the same wave continue running. This is a MAJOR improvement over standalone mode
where the entire wave blocks on checkpoint resolution.

</team_mode_checkpoints>

<standalone_checkpoints>
## Standalone Checkpoint Flow (TEAM_MODE=false — fallback)

1. Spawn agent for checkpoint plan
2. Agent runs until checkpoint task or auth gate → returns structured state
3. Agent return includes: completed tasks table, current task + blocker, checkpoint type/details, what's awaited
4. **Present to user:**
   ```
   ## Checkpoint: [Type]

   **Plan:** 03-03 Dashboard Layout
   **Progress:** 2/3 tasks complete

   [Checkpoint Details from agent return]
   [Awaiting section from agent return]
   ```
5. User responds: "approved"/"done" | issue description | decision selection
5b. Emit the checkpoint resolution event for Recall:
   ```bash
   node ~/.claude/hive/bin/hive-tools.js telemetry emit checkpoint \
     --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"checkpoint_type\":\"${CHECKPOINT_TYPE}\",\"user_response\":\"${USER_RESPONSE}\",\"outcome\":\"${OUTCOME}\"}"
   ```
6. **Spawn continuation agent (NOT resume)** using continuation-prompt.md template:
   - `{completed_tasks_table}`: From checkpoint return
   - `{resume_task_number}` + `{resume_task_name}`: Current task
   - `{user_response}`: What user provided
   - `{resume_instructions}`: Based on checkpoint type
7. Continuation agent verifies previous commits, continues from resume point
8. Repeat until plan completes or user stops

**Why fresh agent, not resume:** Resume relies on internal serialization that breaks with parallel tool calls. Fresh agents with explicit state are more reliable.

**Checkpoints in parallel waves:** Agent pauses and returns while other parallel agents may complete. Present checkpoint, spawn continuation, wait for all before next wave.
</standalone_checkpoints>

</step>

<step name="aggregate_results">
After all waves:

```markdown
## Phase {X}: {Name} Execution Complete

**Waves:** {N} | **Plans:** {M}/{total} complete
{If TEAM_MODE: **Mode:** Team (hive-execute-{phase}-{slug}) | **Checkpoints resolved inline:** {count}}
{If not TEAM_MODE: **Mode:** Standalone}

| Wave | Plans | Status |
|------|-------|--------|
| 1 | plan-01, plan-02 | Complete |
| 2 | plan-03 (1 checkpoint resolved) | Complete |
| 3 | plan-04 | Complete |

### Plan Details
1. **03-01**: [one-liner from SUMMARY.md]
2. **03-02**: [one-liner from SUMMARY.md]

### Issues Encountered
[Aggregate from SUMMARYs, or "None"]
```

**Team cleanup (TEAM_MODE=true):**

After aggregation, shut down any remaining executor teammates and delete the team:
```
# Send shutdown requests to any still-active executors
for executor in active_executors:
  SendMessage(type="shutdown_request", recipient="{executor}", content="Phase execution complete. Shutting down.")

# Wait for shutdown confirmations (with timeout)
# Then delete the team
TeamDelete()
```
</step>

<step name="dynamic_wave_scheduling" condition="config.parallelization.dynamic_scheduling AND TEAM_MODE">

<dynamic_wave_scheduling>

## Dynamic Wave Scheduling (Team Mode Only)

**Config gate:** `parallelization.dynamic_scheduling` must be `true`.

**How it works:**

Instead of waiting for all Wave 1 plans to complete before starting Wave 2:

1. Track completed plan IDs in a set: `completed_plans = {}`
2. When a plan completes (receives `PLAN COMPLETE:` message):
   a. Add plan ID to `completed_plans`
   b. Check all remaining plans: for each unstarted plan, check if ALL its `depends_on` plans are in `completed_plans`
   c. If a plan's dependencies are ALL satisfied, start it immediately (spawn teammate)
3. Plans that depend on nothing (Wave 1) all start immediately
4. Wave boundaries become soft - plans flow based on actual dependency resolution

**Example:**
```
Plans: 01 (wave 1), 02 (wave 1), 03 (depends_on: [01]), 04 (depends_on: [01, 02])

Timeline with rigid waves:
  01 ████░░░░░░░░
  02 ████████░░░░
  03 ░░░░░░░░████  (waits for BOTH 01 and 02)
  04 ░░░░░░░░████  (waits for BOTH 01 and 02)

Timeline with dynamic scheduling:
  01 ████░░░░░░░░
  02 ████████░░░░
  03 ░░░░████░░░░  (starts when 01 finishes, doesn't wait for 02!)
  04 ░░░░░░░░████  (starts when BOTH 01 and 02 finish)
```

**Implementation in team mode execute_waves:**

When `dynamic_scheduling` is true, replace the wave-by-wave loop with:

```
remaining_plans = all_plans
completed_plans = {}
active_plans = {}

# Start all plans with no dependencies
for plan in remaining_plans where plan.depends_on is empty:
  spawn_teammate(plan)
  active_plans[plan.id] = plan
  remaining_plans.remove(plan)

# Monitor loop
while remaining_plans or active_plans:
  wait for message from any teammate

  if message is "PLAN COMPLETE:":
    completed_plans.add(plan.id)
    active_plans.remove(plan.id)

    # Sync dev if git flow is active (pulls merged work so next branch forks from latest)
    if GIT_FLOW == "github":
      git pull origin "${GIT_DEV_BRANCH}" 2>/dev/null || true

    # Check if any remaining plans can now start
    for plan in remaining_plans:
      if all(dep in completed_plans for dep in plan.depends_on):
        spawn_teammate(plan)
        active_plans[plan.id] = plan
        remaining_plans.remove(plan)

  elif message is "CHECKPOINT:" or "PROGRESS:" or other:
    handle normally (existing logic)
```

**Concurrency limit:** Never exceed `max_concurrent_agents` active executors.
If limit reached, queue the plan — add it to a `ready_queue` instead of spawning immediately.
When an active executor completes (or shuts down), pop from `ready_queue` and spawn.

**Display to user (dynamic scheduling events):**
```
## Dynamic Scheduling Active

◆ plan-01 COMPLETE → starting plan-03 (dependency satisfied: [01])
◆ plan-02 still running (2/5 tasks)
◆ plan-03 starting (was wave 2, promoted early — deps [01] met)
◆ plan-04 waiting (deps: [01 ✓, 02 pending])
```

When a plan is promoted early (starts before its original wave), display:
```
⤷ plan-03 promoted from wave 2 → started early (01 complete, no need to wait for 02)
```

**Fallback:** If `dynamic_scheduling` is false (default), use existing wave-by-wave execution.

</dynamic_wave_scheduling>

</step>

<step name="verify_phase_goal">
Verify phase achieved its GOAL, not just completed tasks.

```
Task(
  prompt="Verify phase {phase_number} goal achievement.
Phase directory: {phase_dir}
Phase goal: {goal from ROADMAP.md}
Check must_haves against actual codebase. Create VERIFICATION.md.

{If RECALL is non-empty, include this block:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>",
  subagent_type="hive-verifier",
  model="{verifier_model}"
)
```

Read status:
```bash
grep "^status:" "$PHASE_DIR"/*-VERIFICATION.md | cut -d: -f2 | tr -d ' '
```

| Status | Action |
|--------|--------|
| `passed` | → update_roadmap |
| `human_needed` | Present items for human testing, get approval or feedback |
| `gaps_found` | Present gap summary, offer `/hive:plan-phase {phase} --gaps` |

**If human_needed:**
```
## ✓ Phase {X}: {Name} — Human Verification Required

All automated checks passed. {N} items need human testing:

{From VERIFICATION.md human_verification section}

"approved" → continue | Report issues → gap closure
```

**If gaps_found:**
```
## ⚠ Phase {X}: {Name} — Gaps Found

**Score:** {N}/{M} must-haves verified
**Report:** {phase_dir}/{phase}-VERIFICATION.md

### What's Missing
{Gap summaries from VERIFICATION.md}

---
## ▶ Next Up

`/hive:plan-phase {X} --gaps`

<sub>`/clear` first → fresh context window</sub>

Also: `cat {phase_dir}/{phase}-VERIFICATION.md` — full report
Also: `/hive:verify-work {X}` — manual testing first
```

Gap closure cycle: `/hive:plan-phase {X} --gaps` reads VERIFICATION.md → creates gap plans with `gap_closure: true` → user runs `/hive:execute-phase {X} --gaps-only` → verifier re-runs.
</step>

<step name="update_roadmap">
Mark phase complete in ROADMAP.md (date, status).

```bash
node ~/.claude/hive/bin/hive-tools.js commit "docs(phase-{X}): complete phase execution" --files .planning/ROADMAP.md .planning/STATE.md .planning/phases/{phase_dir}/*-VERIFICATION.md .planning/REQUIREMENTS.md
```
</step>

<step name="refresh_recall">

Regenerate INSIGHTS.md so the next phase benefits from patterns learned in this one.

```bash
node ~/.claude/hive/bin/hive-tools.js telemetry digest 2>/dev/null && echo "Recall refreshed for next phase" || echo "Telemetry digest skipped (no events or telemetry disabled)"
```

This closes the observe → record → digest → feedback loop automatically.

</step>

<step name="offer_next">

**If more phases:**
```
## Next Up

**Phase {X+1}: {Name}** — {Goal}

`/hive:plan-phase {X+1}`

<sub>`/clear` first for fresh context</sub>
```

**If milestone complete:**
```
MILESTONE COMPLETE!

All {N} phases executed.

`/hive:complete-milestone`
```
</step>

</process>

<context_efficiency>
<standalone_mode>
Orchestrator: ~10-15% context. Subagents: fresh 200k each. No polling (Task blocks). No context bleed.
</standalone_mode>

<team_mode>
Orchestrator: ~15-25% context (higher due to message traffic from executors).
Executors: fresh 200k each, PRESERVED across checkpoints.
Progress messages are concise (1-2 lines) to minimize orchestrator context growth.
Checkpoint messages are structured but compact.

**Progress display budget:**
- Each `PROGRESS:` message consumes ~1 line of orchestrator output (~50-80 tokens)
- Cumulative summary line displayed every 5th progress message (~30 tokens)
- With 10 plans averaging 5 tasks each: ~50 progress messages total = ~3000-4000 tokens
- Budget cap: progress display should not exceed 5% of orchestrator context
- When >3 plans active simultaneously: collapse to summary-only mode (saves ~60% tokens)
- Dynamic scheduling events (plan promoted/started) are separate from progress and always displayed

**Context budget monitoring:** If orchestrator context exceeds 40%, reduce progress
message verbosity. Executors send task-completion count only, not detailed descriptions.
At 50% context, suppress all progress display — only process CHECKPOINT, DEVIATION,
PLAN COMPLETE, and PLAN FAILED messages.

**Key savings vs. standalone:** No continuation agent spawns. A plan with 3 checkpoints
uses 1 executor (team mode) vs. 4 executors (standalone mode). Net token savings: ~60%
for checkpoint-heavy plans.
</team_mode>
</context_efficiency>

<failure_handling>
**Shared (both modes):**
- **classifyHandoffIfNeeded false failure:** Agent reports "failed" but error is `classifyHandoffIfNeeded is not defined` -> Claude Code bug, not Hive. Spot-check (SUMMARY exists, commits present) -> if pass, treat as success
- **Agent fails mid-plan:** Missing SUMMARY.md -> report, ask user how to proceed
- **Dependency chain breaks:** Wave 1 fails -> Wave 2 dependents likely fail -> user chooses attempt or skip
- **All agents in wave fail:** Systemic issue -> stop, report for investigation

**Team mode additional:**
- **Executor dies while idle at checkpoint:** Orchestrator detects executor is unresponsive. Check disk: are commits present? Is SUMMARY.md partial? If recoverable state on disk, spawn replacement executor as continuation agent (fallback to standalone pattern for this plan only). If no disk state, report as failed.
- **Executor unresponsive (no messages for 5+ minutes during active execution):** Send ping message. If no response after 30 seconds, check git log for recent commits. If commits are progressing, executor is alive but not messaging (acceptable). If no recent commits, treat as dead.
- **Team lead context fills up:** If orchestrator context exceeds 50%, compress progress messages. If exceeds 70%, stop accepting new progress messages (checkpoints and completions still processed). If exceeds 85%, emergency: complete current wave, then fall back to standalone mode for remaining waves.
- **Multiple checkpoints queued:** Present to user one at a time in arrival order. Each executor remains idle until its specific response arrives. No executor starves — FIFO processing.

**Standalone mode:**
- **Checkpoint unresolvable:** "Skip this plan?" or "Abort phase execution?" -> record partial progress in STATE.md
</failure_handling>

<resumption>
**Standalone mode (unchanged):**
Re-run `/hive:execute-phase {phase}` -> discover_plans finds completed SUMMARYs -> skips them -> resumes from first incomplete plan -> continues wave execution.

STATE.md tracks: last completed plan, current wave, pending checkpoints.

**Team mode:**
Re-run `/hive:execute-phase {phase}` -> discover_plans finds completed SUMMARYs -> skips them -> creates NEW team for remaining plans -> resumes from first incomplete plan.

Previous team is gone (teams don't persist across sessions). This is fine because:
- Completed plans have SUMMARY.md on disk (durable state)
- Incomplete plans restart from scratch (fresh executor, fresh 200k context)
- No partial-checkpoint state to recover (checkpoint = in-memory only)

**Implication:** If user quits mid-checkpoint in team mode, that plan's progress since
last commit is lost. The plan restarts from its last committed task. This is acceptable
because tasks are committed atomically — at most 1 task of work is lost.
</resumption>
