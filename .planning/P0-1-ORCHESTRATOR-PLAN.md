# P0-1: Orchestrator-Side Checkpoint-as-Messaging Implementation Plan

> Generated: 2026-02-11
> Scope: execute-phase.md, checkpoints.md, config.json
> Pattern: Checkpoint-as-Message (P0 item #1 from HIVE-EVOLUTION-ANALYSIS.md)
> Depends on: Executor-side changes (P0-1-EXECUTOR-PLAN.md)

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [execute-phase.md Changes](#2-execute-phasemd-changes)
3. [checkpoints.md Changes](#3-checkpointsmd-changes)
4. [config.json Changes](#4-configjson-changes)
5. [Error Handling & Edge Cases](#5-error-handling--edge-cases)
6. [Migration & Compatibility](#6-migration--compatibility)

---

## 1. Current State Analysis

### How execute-phase.md Currently Works

The orchestrator follows this flow:

1. **Initialize** (lines 15-29): Loads context via `hive-tools.js init execute-phase`, gets `executor_model`, `parallelization`, plans, waves
2. **Discover & Group Plans** (lines 50-72): Uses `hive-tools.js phase-plan-index` to get wave groupings
3. **Execute Waves** (lines 74-172): The core loop:
   - Describes what each wave builds
   - Spawns executors via `Task(subagent_type="hive-executor")` with file paths only
   - Waits for all agents in wave to complete (blocking)
   - Spot-checks SUMMARY.md claims (files exist, git commits present, no Self-Check: FAILED)
   - Reports wave completion
4. **Checkpoint Handling** (lines 174-204): Currently a separate step:
   - Agent returns structured "CHECKPOINT REACHED" markdown
   - Orchestrator parses the return for: completed tasks table, current task, checkpoint type, awaiting info
   - Presents checkpoint to user
   - Spawns FRESH "continuation agent" with state from checkpoint return
   - Continuation agent re-reads files, verifies previous commits, resumes
5. **Aggregate Results** (lines 206-227): Summary table after all waves
6. **Verify Phase Goal** (lines 229-287): Spawns verifier

### Key Pain Points Being Solved

| Pain Point | Current Behavior | Team Mode Behavior |
|------------|-----------------|-------------------|
| Context loss | Agent dies at checkpoint, new agent re-reads everything | Agent goes idle, wakes with full context |
| Continuation fragility | Must parse structured return, spawn fresh agent | SendMessage back, agent continues |
| Multiple checkpoints | Each checkpoint = 2 agent spawns (die + continuation) | Same agent throughout |
| Parallel + checkpoint | Wave blocks, checkpoint plan serializes everything | Checkpoint plan goes idle, others continue |
| No mid-wave visibility | Orchestrator blind until wave completes | Real-time progress messages |
| Rigid waves | Must wait for entire wave before starting next | Can start plan when actual deps met |

### Inventory of Orchestrator Checkpoint Touchpoints

These are every location in execute-phase.md where checkpoint-related logic exists:

1. **Line 97-134** (`execute_waves` step): `Task()` call to spawn executors - must become team member spawning
2. **Line 136**: "Wait for all agents in wave to complete" - must become message-based monitoring
3. **Lines 139-158**: Spot-check + completion reporting - can be augmented with in-flight messages
4. **Lines 169**: "Execute checkpoint plans between waves" - reference to `checkpoint_handling`
5. **Lines 174-204** (`checkpoint_handling` step): The entire step must be rewritten for team mode
6. **Lines 193-198**: Continuation agent spawn with `continuation-prompt.md` template - eliminated in team mode
7. **Line 201**: "Fresh agent, not resume" rationale - inverted for team mode

---

## 2. execute-phase.md Changes

### 2.1 New Step: Team Creation (insert after `handle_branching`, before `validate_phase`)

**Current:** No team creation step exists. Agents are spawned ad-hoc per wave.

**New content to insert after `<step name="handle_branching">` closing tag:**

```xml
<step name="create_execution_team">
Check if Agent Teams is available and enabled:

**Detection:** Attempt `TeamCreate` — if tool unavailable, fall back to standalone mode (existing Task-based execution).

**Team creation (if available):**

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

**Fallback:** If TeamCreate is not available (standalone Claude Code, older version), fall back to existing `Task()` + checkpoint_handling flow. Set `TEAM_MODE=false` and skip all team-specific logic.

```bash
TEAM_MODE=true  # Set to false if TeamCreate unavailable
TEAM_NAME="hive-execute-${PHASE_NUMBER}-${PHASE_SLUG}"
```
</step>
```

### 2.2 Modified Step: execute_waves (major rewrite)

**Current content (lines 74-172):** Task-based fire-and-forget with blocking wait.

**Replacement content:**

```xml
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
   | `PROGRESS:` | Task completed | Log progress, update wave status display |
   | `CHECKPOINT:` | Executor hit checkpoint | Parse, relay to user, send response back |
   | `DEVIATION:` | Rule 4 architectural decision | Present to user, send decision back |
   | `PLAN COMPLETE` | Executor finished all tasks | Mark plan done, spot-check SUMMARY |
   | `PLAN FAILED` | Unrecoverable error | Mark plan failed, route to failure handler |

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

6. **Shutdown wave executors:**

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

7. **Handle failures:**

   **classifyHandoffIfNeeded bug:** Same handling as current. If executor sends
   error containing this string, run spot-checks. Pass = success.

   **Real failure:** Report to user, ask Continue/Stop.

   **Executor dies without completing:** If executor teammate becomes unresponsive
   (no messages for extended period), check SUMMARY.md on disk. If present with
   Self-Check: PASSED, treat as success. Otherwise, report as failure.

8. **Proceed to next wave.**

</team_mode>

<standalone_mode>
## Standalone Mode (TEAM_MODE=false — fallback)

Identical to current execute_waves implementation. Uses Task() for spawning,
checkpoint_handling step for checkpoints, continuation agents for resumption.

This is the existing code, preserved verbatim for backward compatibility.

[Current lines 74-172 preserved here unchanged]
</standalone_mode>
</step>
```

### 2.3 Modified Step: checkpoint_handling (rewritten for team mode)

**Current content (lines 174-204):** Spawn-die-respawn pattern.

**Replacement content:**

```xml
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

[Current checkpoint_handling content preserved verbatim - lines 174-204]

1. Spawn agent for checkpoint plan
2. Agent runs until checkpoint task or auth gate -> returns structured state
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
```

### 2.4 Modified Step: aggregate_results (minor additions)

**Current content (lines 206-227):** Summary table.

**Addition for team mode — insert team execution stats:**

```xml
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

After aggregation, shut down the execution team:
```
# All executors should already be shut down per-wave.
# This is a safety cleanup for any stragglers.
TeamShutdown(team="{TEAM_NAME}")
```
</step>
```

### 2.5 Dynamic Wave Scheduling (new optional enhancement)

**Insert as new step after execute_waves, before aggregate_results:**

```xml
<step name="dynamic_wave_scheduling" condition="config.parallelization.dynamic_scheduling AND TEAM_MODE">
## Dynamic Wave Scheduling (Team Mode Only)

When `dynamic_scheduling: true` in config, waves are not rigidly sequential.
Instead, plans start as soon as their actual dependencies complete.

**How it works:**

1. At phase start, build a dependency graph from plan `depends_on` frontmatter:
   ```
   plan-01: no deps (wave 1)
   plan-02: no deps (wave 1)
   plan-03: depends on plan-01 (wave 2)
   plan-04: depends on plan-01, plan-02 (wave 2)
   plan-05: depends on plan-03 (wave 3)
   ```

2. Start all wave-1 plans immediately as executor teammates.

3. When executor-01 sends `PLAN COMPLETE`:
   - Mark plan-01 as done
   - Check: plan-03 depends only on plan-01 -> ALL deps met -> spawn executor-03
   - Check: plan-04 depends on plan-01 AND plan-02 -> plan-02 still running -> wait

4. When executor-02 sends `PLAN COMPLETE`:
   - Mark plan-02 as done
   - Check: plan-04 deps (plan-01 done, plan-02 done) -> ALL met -> spawn executor-04

5. Continue until all plans complete.

**Concurrency limit:** Never exceed `max_concurrent_agents` active executors.
If limit reached, queue the plan until an executor completes.

**Benefits:**
- plan-03 starts as soon as plan-01 finishes (doesn't wait for plan-02)
- Wall-clock time reduced when dependency chains are narrow
- Better resource utilization

**Display to user:**
```
## Dynamic Scheduling

plan-01 COMPLETE -> starting plan-03 (dependency satisfied)
plan-02 still running (2/5 tasks)
plan-03 starting (was wave 2, promoted early)
```

**Fallback:** If `dynamic_scheduling: false` (default), use rigid wave execution.
</step>
```

### 2.6 Context Efficiency Update

**Current content (lines 322-324):**
```xml
<context_efficiency>
Orchestrator: ~10-15% context. Subagents: fresh 200k each. No polling (Task blocks). No context bleed.
</context_efficiency>
```

**Replacement:**

```xml
<context_efficiency>
<standalone_mode>
Orchestrator: ~10-15% context. Subagents: fresh 200k each. No polling (Task blocks). No context bleed.
</standalone_mode>

<team_mode>
Orchestrator: ~15-25% context (higher due to message traffic from executors).
Executors: fresh 200k each, PRESERVED across checkpoints.
Progress messages are concise (1-2 lines) to minimize orchestrator context growth.
Checkpoint messages are structured but compact.

**Context budget monitoring:** If orchestrator context exceeds 40%, reduce progress
message verbosity. Executors send task-completion count only, not detailed descriptions.

**Key savings vs. standalone:** No continuation agent spawns. A plan with 3 checkpoints
uses 1 executor (team mode) vs. 4 executors (standalone mode). Net token savings: ~60%
for checkpoint-heavy plans.
</team_mode>
</context_efficiency>
```

### 2.7 Failure Handling Update

**Current content (lines 326-332):** Five bullet points.

**Replacement content:**

```xml
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
```

### 2.8 Resumption Update

**Current content (lines 334-338):**

**Replacement:**

```xml
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
```

---

## 3. checkpoints.md Changes

### 3.1 New Section: Team Mode Checkpoints

**Insert after `</execution_protocol>` (after line 357), before `<authentication_gates>` (line 359):**

```xml
<team_mode_checkpoints>

## Team Mode Checkpoint Protocol

When running as a teammate in an execution team (Hive mode), checkpoints use
messaging instead of die-and-respawn. The executor stays alive with full context.

**Detection:** If you were spawned with a `<team_protocol>` block in your prompt,
you are in team mode. Use SendMessage for checkpoints. NEVER use checkpoint_return_format.
NEVER return/exit at checkpoints.

### Protocol

1. **Hit checkpoint task** -> STOP execution (do not proceed to next task)
2. **Send checkpoint message** to team lead:

```
SendMessage(
  type="message",
  recipient="{team_lead}",
  content="CHECKPOINT: {type}
PLAN: {plan_id}
PROGRESS: {completed}/{total}

### Checkpoint Details
{type-specific content}

### Awaiting
{what is needed from user}",
  summary="Checkpoint: {type} for {plan_id}"
)
```

3. **Go idle** — do NOT proceed, do NOT poll, do NOT retry. Wait for incoming message.
4. **Receive response** from team lead: `CHECKPOINT_RESPONSE: {user_response}`
5. **Resume execution** based on checkpoint type:

| Checkpoint Type | Response | Resume Action |
|----------------|----------|---------------|
| human-verify | "approved" | Continue to next task |
| human-verify | issue description | Address issues, re-verify, send new checkpoint if needed |
| decision | "{option_id}" | Implement selected option, continue |
| human-action | "done" | Run verification command, if passes continue, if fails send new checkpoint |

### Type-Specific Message Content

**checkpoint:human-verify:**
```
CHECKPOINT: human-verify
PLAN: 03-02
PROGRESS: 4/6

### Checkpoint Details
**What was built:** Responsive dashboard at http://localhost:3000/dashboard
**How to verify:**
1. Visit http://localhost:3000/dashboard
2. Desktop (>1024px): Sidebar visible, content fills remaining space
3. Tablet (768px): Sidebar collapses to icons
4. Mobile (375px): Sidebar hidden, hamburger menu appears

### Awaiting
Type "approved" or describe layout issues
```

**checkpoint:decision:**
```
CHECKPOINT: decision
PLAN: 03-01
PROGRESS: 2/6

### Checkpoint Details
**Decision:** Select authentication provider
**Context:** Need user auth. Three options with different tradeoffs.

**Options:**
1. **supabase** - Built-in with our DB, generous free tier
   Pros: Row-level security integration
   Cons: Less customizable UI, ecosystem lock-in

2. **clerk** - Beautiful pre-built UI, best DX
   Pros: Excellent docs, pre-built components
   Cons: Paid after 10k MAU, vendor lock-in

3. **nextauth** - Self-hosted, maximum control
   Pros: Free, no vendor lock-in
   Cons: More setup work, DIY security

### Awaiting
Select: supabase, clerk, or nextauth
```

**checkpoint:human-action:**
```
CHECKPOINT: human-action
PLAN: 03-03
PROGRESS: 3/8

### Checkpoint Details
**Action:** Complete email verification for SendGrid
**What I automated:** Created account via API, requested verification email
**What you need to do:** Check inbox for SendGrid verification link, click it
**I'll verify:** SendGrid API key works after you confirm

### Awaiting
Type "done" when email verified
```

### Auth Gates in Team Mode

Auth gates are dramatically simplified in team mode:

```
OLD (standalone):
1. Executor hits auth error
2. Returns CHECKPOINT REACHED with structured state
3. Dies
4. Orchestrator presents to user
5. User authenticates
6. Orchestrator spawns continuation agent
7. Continuation re-reads everything
8. Continuation retries original command

NEW (team mode):
1. Executor hits auth error
2. Sends message: "CHECKPOINT: human-action ... need vercel login"
3. Goes idle (keeps full context)
4. Orchestrator relays to user
5. User authenticates
6. Orchestrator sends: "CHECKPOINT_RESPONSE: done"
7. Executor wakes up, runs verification, retries original command
8. Continues with full context
```

Steps reduced from 8 to 8, but steps 2-8 are TRIVIAL (no agent death, no
re-reading, no commit verification). Wall-clock time: ~30 seconds vs ~3 minutes.

### Deviation Rule 4 in Team Mode

Architectural decisions that would previously cause agent death now use the
same messaging pattern:

```
SendMessage(
  type="message",
  recipient="{team_lead}",
  content="DEVIATION: rule-4
PLAN: {plan_id}
TASK: {current_task}

### Discovery
{what prompted this}

### Proposed Change
{modification}

### Why Needed
{rationale}

### Impact
{what this affects}

### Alternatives
{other approaches}

Proceed with proposed change? (yes / different approach / defer)",
  summary="Architectural decision needed for {plan_id}"
)
```

Wait for: `DEVIATION_RESPONSE: {decision}`

### Error Scenarios

**Executor dies while idle at checkpoint:**
- The executor process crashes or times out while waiting for user response
- The checkpoint state is LOST (it was in-memory only)
- Team lead detects unresponsive executor
- Recovery: spawn replacement executor as standalone continuation agent using
  the last known state (commits on disk, task progress from the checkpoint message
  that was already received)
- This is the WORST CASE for team mode and equals the NORMAL CASE for standalone mode

**Team lead dies while executors are idle:**
- Executors will eventually time out waiting for response
- On next `/hive:execute-phase` run, team is gone, executors are gone
- Discovery finds completed SUMMARYs, skips them, restarts incomplete plans
- At most 1 task of work lost per incomplete plan (same as standalone)

**User takes hours to respond:**
- Executor remains idle (Claude Code keeps agent alive)
- If Claude Code session times out, executor dies -> same recovery as "executor dies" above
- Recommendation: if user needs significant time, save checkpoint context to disk:
  orchestrator writes `.planning/phases/XX-name/.pending-checkpoint.json` with
  checkpoint details, so that on resume a new executor can continue from checkpoint

</team_mode_checkpoints>
```

### 3.2 Additions to Existing Sections

**In `<execution_protocol>` section (line 271-357), add team mode note after step 5:**

Insert after line 279 ("5. **Resume execution** - continue to next task only after confirmation"):

```xml
**Team mode override:** If running as team member, steps 2-5 above are replaced
by the team_mode_checkpoints protocol. Send message instead of displaying.
Wait for message instead of waiting for user input directly.
```

**In `<authentication_gates>` section (lines 359-378), add team mode note:**

Insert after line 377 (closing of Gate protocol list):

```xml
**Team mode:** Same 7-step protocol, but steps 3-6 use SendMessage instead of
checkpoint_return_format + die + continuation spawn. Executor stays alive.
See team_mode_checkpoints section for message format.
```

---

## 4. config.json Changes

### 4.1 Current config.json (for reference)

```json
{
  "mode": "interactive",
  "depth": "standard",
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true
  },
  "planning": {
    "commit_docs": true,
    "search_gitignored": false
  },
  "parallelization": {
    "enabled": true,
    "plan_level": true,
    "task_level": false,
    "skip_checkpoints": true,
    "max_concurrent_agents": 3,
    "min_plans_for_parallel": 2
  },
  "gates": {
    "confirm_project": true,
    "confirm_phases": true,
    "confirm_roadmap": true,
    "confirm_breakdown": true,
    "confirm_plan": true,
    "execute_next_plan": true,
    "issues_review": true,
    "confirm_transition": true
  },
  "safety": {
    "always_confirm_destructive": true,
    "always_confirm_external_services": true
  }
}
```

### 4.2 Updated config.json

```json
{
  "mode": "interactive",
  "depth": "standard",
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true
  },
  "planning": {
    "commit_docs": true,
    "search_gitignored": false
  },
  "parallelization": {
    "enabled": true,
    "plan_level": true,
    "task_level": false,
    "skip_checkpoints": true,
    "max_concurrent_agents": 3,
    "min_plans_for_parallel": 2,
    "dynamic_scheduling": false
  },
  "teams": {
    "execution_team": true
  },
  "gates": {
    "confirm_project": true,
    "confirm_phases": true,
    "confirm_roadmap": true,
    "confirm_breakdown": true,
    "confirm_plan": true,
    "execute_next_plan": true,
    "issues_review": true,
    "confirm_transition": true
  },
  "safety": {
    "always_confirm_destructive": true,
    "always_confirm_external_services": true
  }
}
```

### 4.3 Config Change Rationale

**`skip_checkpoints` becoming obsolete:**

Currently `skip_checkpoints: true` exists because checkpoints are EXPENSIVE in
standalone mode. Each checkpoint costs:
- 1 agent death (wasted context)
- 1 continuation agent spawn (full 200k re-read)
- Commit verification overhead
- Re-reading all plan files

In team mode, checkpoints cost:
- 1 message sent (a few hundred tokens)
- 1 message received (user response)
- Agent wakes up with full context

Checkpoints go from ~3 minutes + wasted tokens to ~30 seconds + minimal tokens.
Therefore `skip_checkpoints` becomes unnecessary.

**However:** We keep `skip_checkpoints` in the schema for backward compatibility with
standalone mode. In team mode, it is IGNORED (checkpoints are always processed because
they're cheap). The setting only applies when `teams.execution_team: false` or when
team mode is unavailable.

**New `parallelization.dynamic_scheduling`:**

- `false` (default): Rigid wave execution. Wave N must fully complete before wave N+1 starts.
- `true`: Plans start as soon as their `depends_on` dependencies complete. Requires team mode.
- Only effective when `teams.execution_team: true` AND team mode is available.
- Falls back to rigid waves if team mode unavailable.

**New `teams.execution_team`:**

- `true` (default): Use Agent Teams for execution if available. Executors are teammates with SendMessage.
- `false`: Force standalone mode. Use Task() for spawning, continuation agents for checkpoints.
- Auto-detection: if set to `true` but TeamCreate is unavailable, silently falls back to standalone.

**Future team settings (not implemented in P0-1, reserved for later):**

```json
{
  "teams": {
    "execution_team": true,
    "planning_team": true,
    "research_team": true,
    "qa_team": "auto",
    "debug_team": "complex_only"
  }
}
```

These are documented in HIVE-EVOLUTION-ANALYSIS.md section 15 and will be implemented
in subsequent P1/P2 work items. For P0-1, only `execution_team` is added.

---

## 5. Error Handling & Edge Cases

### 5.1 Executor Dies Mid-Checkpoint

**Scenario:** Executor is idle at checkpoint, waiting for user response. The executor
process crashes (OOM, timeout, network issue).

**Detection:** Team lead sends `CHECKPOINT_RESPONSE` but executor doesn't acknowledge
or send any follow-up messages within 60 seconds.

**Recovery:**
1. Team lead logs: "Executor executor-{plan_id} unresponsive after checkpoint response"
2. Check disk state:
   - `git log --oneline --grep="{phase}-{plan}"` — how many commits?
   - `ls .planning/phases/XX-name/{phase}-{plan}-SUMMARY.md` — exists?
3. If SUMMARY.md exists with Self-Check: PASSED -> plan actually completed, treat as success
4. If partial commits exist but no SUMMARY -> spawn STANDALONE continuation agent:
   - Use the checkpoint message content (already received by orchestrator) as state
   - This is equivalent to the old standalone checkpoint flow
   - The continuation agent picks up from the checkpoint task
5. If no commits at all -> plan failed, report to user

**Key insight:** This worst-case for team mode equals the NORMAL case for standalone mode.
Team mode never does worse than standalone.

### 5.2 User Takes Very Long to Respond (Hours)

**Scenario:** User steps away after checkpoint is presented. Comes back hours later.

**What happens:**
- Executor teammate remains idle (no CPU/token cost while idle)
- Claude Code session may time out (typically 30-60 minutes of inactivity)
- If session alive: user responds, executor wakes up, continues normally
- If session timed out: executor is dead

**Mitigation:**
When presenting a checkpoint to user, orchestrator also writes checkpoint state to disk:

```bash
# Write pending checkpoint to disk for crash recovery
cat > .planning/phases/XX-name/.pending-checkpoint-{plan_id}.json << 'EOF'
{
  "plan_id": "{plan_id}",
  "checkpoint_type": "{type}",
  "progress": "{completed}/{total}",
  "checkpoint_details": "{details}",
  "timestamp": "{ISO timestamp}"
}
EOF
```

On next `/hive:execute-phase` run, if `.pending-checkpoint-*.json` files exist:
- Plan has partial work committed
- Restart from checkpoint task using standalone continuation pattern
- Delete the pending checkpoint file after spawning continuation

### 5.3 Multiple Checkpoints from Different Executors Simultaneously

**Scenario:** Wave has 3 executors. Executor-01 and executor-02 both hit checkpoints
within seconds of each other. Executor-03 is still running.

**Handling:**
1. Both messages arrive in orchestrator's message queue
2. Process in FIFO order (first received, first presented)
3. Present checkpoint #1 to user, wait for response
4. Send response to executor-01 (it wakes up and continues)
5. Present checkpoint #2 to user, wait for response
6. Send response to executor-02 (it wakes up and continues)
7. Meanwhile, executor-03 may have completed during steps 3-6

**User experience:**
```
## Checkpoint Queue

### 1 of 2: executor-01 (Plan 03-01) -- Verification Required
[details]
-> YOUR ACTION: ...

[User responds "approved"]
-> Response sent to executor-01

### 2 of 2: executor-02 (Plan 03-02) -- Decision Required
[details]
-> YOUR ACTION: ...

[User responds "clerk"]
-> Response sent to executor-02

Meanwhile: executor-03 completed Plan 03-03 (no checkpoint)
```

**Edge case:** What if a THIRD checkpoint arrives while user is reviewing checkpoint #2?
-> Add to queue, present after #2 is resolved. Queue is unbounded.

### 5.4 Team Lead Context Fills Up from Too Many Messages

**Scenario:** Phase has 10 plans across 4 waves. Each executor sends 5-10 progress
messages per plan. That's 50-100 messages filling orchestrator context.

**Mitigation strategy (graduated):**

| Context Usage | Action |
|--------------|--------|
| < 40% | Full progress messages with details |
| 40-60% | Compact progress: "executor-01: 3/5 tasks done" (one line) |
| 60-80% | Suppress progress messages entirely. Only process CHECKPOINT, DEVIATION, PLAN COMPLETE, PLAN FAILED |
| > 80% | Emergency: complete current wave, fall back to standalone mode for remaining waves |

**Implementation:** Orchestrator checks its own context usage periodically (after each
message processed). Adjusts verbosity dynamically.

**Alternative (simpler):** Executors always send compact progress messages (1 line).
Detailed information goes to SUMMARY.md on disk, not to messages. This keeps orchestrator
context growth linear and predictable.

**Recommended approach for P0-1:** Use the simpler alternative. Progress messages are
always compact. Detailed info lives on disk. This avoids the complexity of dynamic
verbosity adjustment.

### 5.5 Fallback to Standalone Mode if Agent Teams Unavailable

**Scenario:** User runs Hive on a version of Claude Code that doesn't support Agent Teams,
or TeamCreate fails for any reason.

**Detection:**
```
TEAM_MODE = attempt TeamCreate -> success ? true : false
```

If `TeamCreate` tool is not available, or returns an error:
1. Set `TEAM_MODE=false`
2. Log: "Agent Teams not available. Using standalone execution mode."
3. All subsequent logic uses the `<standalone_mode>` code paths
4. No functional difference from current Hive behavior

**Graceful degradation:** Every team-mode feature has a standalone fallback. The file
structure uses `<team_mode>` / `<standalone_mode>` conditional blocks so the orchestrator
can branch at each decision point.

### 5.6 Executor Sends Unexpected Message Format

**Scenario:** Executor sends a message that doesn't match expected prefixes
(PROGRESS, CHECKPOINT, DEVIATION, PLAN COMPLETE, PLAN FAILED).

**Handling:** Log the raw message. If it contains checkpoint-like content (mentions
"awaiting", "verify", "decision"), attempt to parse as checkpoint. Otherwise, log
and continue monitoring.

### 5.7 Race Condition: Plan Completes During Checkpoint Resolution

**Scenario:** Executor-01 is at checkpoint. While user is reviewing, executor-02
completes its plan. Orchestrator receives PLAN COMPLETE from executor-02.

**Handling:**
1. Orchestrator processes PLAN COMPLETE for executor-02 (spot-check, mark done)
2. Continues presenting checkpoint for executor-01 to user
3. No conflict — messages are processed sequentially by orchestrator
4. Wave completion only triggers when ALL executors are done/failed

---

## 6. Migration & Compatibility

### 6.1 Backward Compatibility

All changes are **additive**. The standalone mode code paths are preserved verbatim.
Users who:
- Don't have Agent Teams -> automatic fallback to standalone
- Set `teams.execution_team: false` -> forced standalone
- Have existing `.planning/config.json` without `teams` key -> defaults apply (`execution_team: true` with auto-fallback)

### 6.2 Config Migration

Existing `config.json` files work unchanged. The new `teams` and `parallelization.dynamic_scheduling`
keys are optional with sensible defaults:
- `teams.execution_team`: defaults to `true` (auto-detect and use if available)
- `parallelization.dynamic_scheduling`: defaults to `false` (conservative)

### 6.3 File Changes Summary

| File | Change Type | Scope |
|------|------------|-------|
| `execute-phase.md` | Major rewrite | New step (create_execution_team), rewritten execute_waves with team/standalone split, rewritten checkpoint_handling, updated aggregate_results, new dynamic_wave_scheduling, updated context_efficiency, updated failure_handling, updated resumption |
| `checkpoints.md` | Additive | New `<team_mode_checkpoints>` section (~150 lines), minor notes in execution_protocol and authentication_gates |
| `config.json` (template) | Additive | New `teams.execution_team`, new `parallelization.dynamic_scheduling` |
| `execute-plan.md` | Minor note | Add team_protocol awareness in checkpoint_protocol step (handled by executor plan) |
| `hive-executor.md` | Separate plan | New tools (SendMessage), new behavioral contract (handled by P0-1-EXECUTOR-PLAN.md) |

### 6.4 Implementation Order

1. **config.json template** — Add new fields with defaults (smallest change, no risk)
2. **checkpoints.md** — Add `<team_mode_checkpoints>` section (additive, no existing behavior changed)
3. **execute-phase.md** — The main rewrite (largest change):
   a. Add `create_execution_team` step
   b. Rewrite `execute_waves` with team/standalone split
   c. Rewrite `checkpoint_handling` with team/standalone split
   d. Update supporting steps (aggregate_results, context_efficiency, failure_handling, resumption)
   e. Add `dynamic_wave_scheduling` step (optional, can be deferred)
4. **Integration test** — Run through a phase with checkpoints in both modes

### 6.5 Dependencies on Executor-Side Changes

This plan assumes the executor-side changes (P0-1-EXECUTOR-PLAN.md) implement:
- Executor recognizes `<team_protocol>` block in prompt
- Executor uses SendMessage instead of checkpoint_return_format when in team mode
- Executor sends PROGRESS, CHECKPOINT, DEVIATION, PLAN COMPLETE, PLAN FAILED messages
- Executor waits for CHECKPOINT_RESPONSE and DEVIATION_RESPONSE messages
- Executor approves shutdown requests when received

Both plans can be implemented in parallel as long as the message protocol (section 3.1
of this document) is agreed upon as the contract between orchestrator and executor.

---

## Appendix: Message Protocol Reference

### Executor -> Orchestrator Messages

| Message | Format | When Sent |
|---------|--------|-----------|
| Progress | `PROGRESS: Task {N}/{total} complete: {commit_message}` | After each task commit |
| Checkpoint | `CHECKPOINT: {type}\nPLAN: {id}\nPROGRESS: {n}/{total}\n\n### Checkpoint Details\n{content}\n\n### Awaiting\n{action}` | At checkpoint task |
| Deviation | `DEVIATION: rule-4\nPLAN: {id}\nTASK: {task}\n\n{details}` | At Rule 4 architectural decision |
| Complete | `PLAN COMPLETE\n\n**Plan:** {id}\n**Tasks:** {n}/{total}\n**SUMMARY:** {path}\n\n**Commits:**\n{list}` | After all tasks done |
| Failed | `PLAN FAILED\n\n**Plan:** {id}\n**Tasks:** {completed}/{total}\n**Error:** {description}` | On unrecoverable error |

### Orchestrator -> Executor Messages

| Message | Format | When Sent |
|---------|--------|-----------|
| Checkpoint Response | `CHECKPOINT_RESPONSE: {user_response}` | After user responds to checkpoint |
| Deviation Response | `DEVIATION_RESPONSE: {user_decision}` | After user responds to Rule 4 |
| Shutdown | `shutdown_request` (via SendMessage type) | After wave/phase completion |
