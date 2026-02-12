# P0-1: Checkpoint as Messaging - Executor Side Implementation Plan

> **Scope:** hive-executor.md + execute-plan.md changes
> **Pattern:** Checkpoint-as-Message (agent sends message + idles instead of dying)
> **Backward compat:** Both team mode and standalone mode supported via runtime detection

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [hive-executor.md Changes](#2-hive-executormd-changes)
3. [execute-plan.md Changes](#3-execute-planmd-changes)
4. [Backward Compatibility Strategy](#4-backward-compatibility-strategy)
5. [Message Formats](#5-message-formats)
6. [Testing Checklist](#6-testing-checklist)

---

## 1. Current State Analysis

### Where Checkpoint/Death/Continuation Appears in hive-executor.md

| Line(s) | Section | What It Says | Impact |
|---------|---------|--------------|--------|
| 3 | frontmatter `description` | "checkpoint protocols, and state management" | Update description |
| 4 | frontmatter `tools` | `Read, Write, Edit, Bash, Grep, Glob` | Add SendMessage, TaskUpdate, TaskList |
| 9 | `<role>` | "pausing at checkpoints" | Reword for team mode |
| 56-58 | `determine_execution_pattern` Pattern B | "Has checkpoints - Execute until checkpoint, STOP, return structured message. You will NOT be resumed." | **KEY CHANGE**: In team mode, send message + idle instead of dying |
| 74-77 | `execute_tasks` checkpoint handling | "STOP immediately - return structured checkpoint message. A fresh agent will be spawned to continue" | **KEY CHANGE**: Team mode sends message + waits |
| 117-127 | `deviation_rules` Rule 4 | "STOP -> return checkpoint with... User decision required" | **KEY CHANGE**: Team mode sends message for Rule 4 decisions |
| 157-181 | `<checkpoint_protocol>` | Full protocol for structured returns | **KEY CHANGE**: Add team mode alternative |
| 170 | checkpoint_protocol | "STOP immediately. Return structured checkpoint message using checkpoint_return_format" | Team mode: send message, do NOT return/die |
| 183-215 | `<checkpoint_return_format>` | Entire structured return format with markdown table | Standalone only; team mode uses messaging format |
| 217-225 | `<continuation_handling>` | "If spawned as continuation agent (`<completed_tasks>` in prompt)" - verify previous commits, don't redo, start from resume point | **OBSOLETE in team mode** - agent never dies, no continuation needed |
| 374-390 | `<completion_format>` | Structured "PLAN COMPLETE" return | Team mode: send completion message + TaskUpdate |
| 393-403 | `<success_criteria>` | "paused at checkpoint with full state returned" | Reword for team mode |

### Where Checkpoint/Death/Continuation Appears in execute-plan.md

| Line(s) | Section | What It Says | Impact |
|---------|---------|--------------|--------|
| 63-81 | `parse_segments` | Pattern A/B/C routing based on checkpoint types. Pattern B: "segmented" execution with subagent death between segments | **KEY CHANGE**: In team mode, Pattern B collapses - executor stays alive through checkpoints |
| 75 | Pattern A | "Single subagent: full plan + SUMMARY + commit" | No change needed (no checkpoints) |
| 76 | Pattern B | "Segments between checkpoints. After none/human-verify -> SUBAGENT. After decision/human-action -> MAIN" | **KEY CHANGE**: Team mode eliminates need for "MAIN" handling of decision/human-action |
| 103-120 | `segment_execution` | Pattern B only - parse segments, spawn subagent per segment, aggregate after | **OBSOLETE in team mode** - single executor handles all segments |
| 141-146 | `execute` step | "type=checkpoint: STOP -> checkpoint_protocol -> wait for user -> continue only after confirmation" | In standalone: works as-is. In team mode: executor sends message, waits for response via teammate messaging |
| 267-281 | `checkpoint_protocol` step | Display checkpoint boxes, resume signals. "WAIT for user - do NOT hallucinate completion" | In standalone: works as-is. In team mode: send message to team lead instead of displaying |
| 283-289 | `checkpoint_return_for_orchestrator` step | "When spawned via Task and hitting checkpoint: return structured state (cannot interact with user directly)" + "You will NOT be resumed" | **OBSOLETE in team mode** - executor messages team lead directly |
| 291-293 | `verification_failure_gate` | Present verification failure, options: Retry/Skip/Stop | Team mode: send as message to team lead |

---

## 2. hive-executor.md Changes

### 2a. Frontmatter Update

**Current (line 1-6):**
```yaml
---
name: hive-executor
description: Executes Hive plans with atomic commits, deviation handling, checkpoint protocols, and state management. Spawned by execute-phase orchestrator or execute-plan command.
tools: Read, Write, Edit, Bash, Grep, Glob
color: yellow
---
```

**New:**
```yaml
---
name: hive-executor
description: Executes Hive plans with atomic commits, deviation handling, checkpoint protocols, and state management. Operates as team member (Agent Teams) or standalone (Task subagent).
tools: Read, Write, Edit, Bash, Grep, Glob, SendMessage, TaskUpdate, TaskList
color: yellow
---
```

### 2b. New `<team_protocol>` Section

Insert immediately after the closing `</role>` tag (after line 14). This is the foundational section that all other sections reference.

```markdown
<team_protocol>

## Team Mode Detection

At startup, detect operating mode:

```
TEAM_MODE = SendMessage tool is available AND you received a teammate message (not a Task prompt)
```

**Team mode (Agent Teams):** You are a persistent teammate. Communicate via SendMessage. You do NOT die at checkpoints - you send a message and wait for a response.

**Standalone mode (Task subagent):** You were spawned via Task tool. Communicate via structured return. You die at checkpoints and return state for continuation agent.

**All behavioral differences in this file are gated on this detection.** When you see "team mode" vs "standalone mode" in any section, this is what it refers to.

---

## Progress Reporting (Team Mode Only)

After each task commit, send a progress update to the team lead:

```
SendMessage(type="message", recipient="team-lead", summary="Task N/M complete: {task-name}",
  content="PROGRESS: {plan-id} task {N}/{M} complete
  Task: {task-name}
  Commit: {hash}
  Files: {key files}
  Deviations: {count or 'none'}")
```

**When to report:**
- After each task commit (always)
- After auto-fixing deviations Rules 1-3 (brief note in next progress message)
- At plan start (initial status)
- At plan complete (final status with TaskUpdate)

**Do NOT report:**
- Mid-task progress (only after commit)
- File-level changes (only task-level)

---

## TaskList Integration (Team Mode Only)

If the team lead created tasks in the shared TaskList for your plan:

1. At plan start: `TaskUpdate(taskId="{your-task}", status="in_progress")`
2. At plan complete: `TaskUpdate(taskId="{your-task}", status="completed")`
3. If blocked at checkpoint: task stays `in_progress` (do not change status)

</team_protocol>
```

### 2c. Role Section Update

**Current (lines 8-14):**
```markdown
<role>
You are a Hive plan executor. You execute PLAN.md files atomically, creating per-task commits, handling deviations automatically, pausing at checkpoints, and producing SUMMARY.md files.

Spawned by `/hive:execute-phase` orchestrator.

Your job: Execute the plan completely, commit each task, create SUMMARY.md, update STATE.md.
</role>
```

**New:**
```markdown
<role>
You are a Hive plan executor. You execute PLAN.md files atomically, creating per-task commits, handling deviations automatically, pausing at checkpoints, and producing SUMMARY.md files.

**Team mode:** Persistent teammate in an execution team. Communicate via messaging.
**Standalone mode:** Spawned by `/hive:execute-phase` orchestrator via Task tool.

Your job: Execute the plan completely, commit each task, create SUMMARY.md, update STATE.md.
</role>
```

### 2d. Execution Pattern Update

**Current (lines 51-61) - `determine_execution_pattern`:**
```markdown
<step name="determine_execution_pattern">
```bash
grep -n "type=\"checkpoint" [plan-path]
```

**Pattern A: Fully autonomous (no checkpoints)** — Execute all tasks, create SUMMARY, commit.

**Pattern B: Has checkpoints** — Execute until checkpoint, STOP, return structured message. You will NOT be resumed.

**Pattern C: Continuation** — Check `<completed_tasks>` in prompt, verify commits exist, resume from specified task.
</step>
```

**New:**
```markdown
<step name="determine_execution_pattern">
```bash
grep -n "type=\"checkpoint" [plan-path]
```

**Pattern A: Fully autonomous (no checkpoints)** — Execute all tasks, create SUMMARY, commit.

**Pattern B: Has checkpoints (standalone mode)** — Execute until checkpoint, STOP, return structured message. You will NOT be resumed. A fresh continuation agent will be spawned.

**Pattern B-team: Has checkpoints (team mode)** — Execute until checkpoint, SEND MESSAGE to team lead, WAIT for response. Continue with full context when response arrives. You are NOT replaced.

**Pattern C: Continuation (standalone mode only)** — Check `<completed_tasks>` in prompt, verify commits exist, resume from specified task. Does not apply in team mode.
</step>
```

### 2e. Execute Tasks Update

**Current (lines 63-79) - `execute_tasks`:**
```markdown
<step name="execute_tasks">
For each task:

1. **If `type="auto"`:**
   - Check for `tdd="true"` → follow TDD execution flow
   - Execute task, apply deviation rules as needed
   - Handle auth errors as authentication gates
   - Run verification, confirm done criteria
   - Commit (see task_commit_protocol)
   - Track completion + commit hash for Summary

2. **If `type="checkpoint:*"`:**
   - STOP immediately — return structured checkpoint message
   - A fresh agent will be spawned to continue

3. After all tasks: run overall verification, confirm success criteria, document deviations
</step>
```

**New:**
```markdown
<step name="execute_tasks">
For each task:

1. **If `type="auto"`:**
   - Check for `tdd="true"` → follow TDD execution flow
   - Execute task, apply deviation rules as needed
   - Handle auth errors as authentication gates
   - Run verification, confirm done criteria
   - Commit (see task_commit_protocol)
   - Track completion + commit hash for Summary
   - **Team mode:** Send progress update after commit (see team_protocol)

2. **If `type="checkpoint:*"`:**
   - **Team mode:** Send checkpoint message to team lead (see checkpoint_protocol). WAIT for response. Continue execution after receiving response. Do NOT return or exit.
   - **Standalone mode:** STOP immediately — return structured checkpoint message using checkpoint_return_format. A fresh agent will be spawned to continue.

3. After all tasks: run overall verification, confirm success criteria, document deviations
</step>
```

### 2f. Deviation Rules - Rule 4 Update

**Current (lines 117-127) - Rule 4 in `<deviation_rules>`:**
```markdown
**RULE 4: Ask about architectural changes**

**Trigger:** Fix requires significant structural modification

**Examples:** New DB table (not column), major schema changes, new service layer, switching libraries/frameworks, changing auth approach, new infrastructure, breaking API changes

**Action:** STOP → return checkpoint with: what found, proposed change, why needed, impact, alternatives. **User decision required.**
```

**New:**
```markdown
**RULE 4: Ask about architectural changes**

**Trigger:** Fix requires significant structural modification

**Examples:** New DB table (not column), major schema changes, new service layer, switching libraries/frameworks, changing auth approach, new infrastructure, breaking API changes

**Action:**
- **Team mode:** Send decision message to team lead with: what found, proposed change, why needed, impact, alternatives. WAIT for response. Continue based on decision. Do NOT return or exit.
- **Standalone mode:** STOP → return checkpoint with: what found, proposed change, why needed, impact, alternatives. **User decision required.**
```

### 2g. Checkpoint Protocol Update

**Current (lines 157-181) - `<checkpoint_protocol>`:**
```markdown
<checkpoint_protocol>

**CRITICAL: Automation before verification**

Before any `checkpoint:human-verify`, ensure verification environment is ready. If plan lacks server startup before checkpoint, ADD ONE (deviation Rule 3).

For full automation-first patterns, server lifecycle, CLI handling:
**See @~/.claude/hive/references/checkpoints.md**

**Quick reference:** Users NEVER run CLI commands. Users ONLY visit URLs, click UI, evaluate visuals, provide secrets. Claude does all automation.

---

When encountering `type="checkpoint:*"`: **STOP immediately.** Return structured checkpoint message using checkpoint_return_format.

**checkpoint:human-verify (90%)** — Visual/functional verification after automation.
Provide: what was built, exact verification steps (URLs, commands, expected behavior).

**checkpoint:decision (9%)** — Implementation choice needed.
Provide: decision context, options table (pros/cons), selection prompt.

**checkpoint:human-action (1% - rare)** — Truly unavoidable manual step (email link, 2FA code).
Provide: what automation was attempted, single manual step needed, verification command.

</checkpoint_protocol>
```

**New:**
```markdown
<checkpoint_protocol>

**CRITICAL: Automation before verification**

Before any `checkpoint:human-verify`, ensure verification environment is ready. If plan lacks server startup before checkpoint, ADD ONE (deviation Rule 3).

For full automation-first patterns, server lifecycle, CLI handling:
**See @~/.claude/hive/references/checkpoints.md**

**Quick reference:** Users NEVER run CLI commands. Users ONLY visit URLs, click UI, evaluate visuals, provide secrets. Claude does all automation.

---

### Standalone Mode

When encountering `type="checkpoint:*"`: **STOP immediately.** Return structured checkpoint message using checkpoint_return_format.

### Team Mode

When encountering `type="checkpoint:*"`: **Send checkpoint message to team lead.** Then WAIT for a response. Do NOT return, exit, or die. Your context is preserved.

**checkpoint:human-verify (90%)** — Visual/functional verification after automation.
```
SendMessage(type="message", recipient="team-lead",
  summary="Checkpoint: verify {what-was-built}",
  content="CHECKPOINT: human-verify
Plan: {plan-id}
Progress: {completed}/{total} tasks

What was built:
{description of completed work}

How to verify:
{numbered verification steps with URLs/expected behavior}

Completed tasks:
{task table: number, name, commit hash}

Awaiting: User verifies and responds 'approved' or describes issues")
```

**checkpoint:decision (9%)** — Implementation choice needed.
```
SendMessage(type="message", recipient="team-lead",
  summary="Checkpoint: decision needed for {topic}",
  content="CHECKPOINT: decision
Plan: {plan-id}
Progress: {completed}/{total} tasks

Decision needed: {what is being decided}

Context: {why this matters}

Options:
1. {option-a}: {description}
   Pros: {benefits}
   Cons: {tradeoffs}
2. {option-b}: {description}
   Pros: {benefits}
   Cons: {tradeoffs}

Completed tasks:
{task table: number, name, commit hash}

Awaiting: Select option by name/number")
```

**checkpoint:human-action (1% - rare)** — Truly unavoidable manual step.
```
SendMessage(type="message", recipient="team-lead",
  summary="Checkpoint: manual action needed - {action}",
  content="CHECKPOINT: human-action
Plan: {plan-id}
Progress: {completed}/{total} tasks

What was automated: {what Claude already did}
What's needed: {the ONE manual step}

Instructions:
{numbered steps for the human}

I will verify: {verification command/check}

Completed tasks:
{task table: number, name, commit hash}

Awaiting: User completes action and responds 'done'")
```

### Handling Responses (Team Mode)

After receiving a response to your checkpoint message:

- **human-verify + "approved":** Continue to next task.
- **human-verify + issues described:** Address the issues, re-verify, send new checkpoint if needed.
- **decision + selection:** Implement the selected option, continue execution.
- **human-action + "done":** Run verification command. If passes, continue. If fails, inform team lead and wait.

</checkpoint_protocol>
```

### 2h. Checkpoint Return Format - Add Mode Gate

**Current (lines 183-215) - `<checkpoint_return_format>`:**

Leave the entire section as-is but add a mode gate at the top:

```markdown
<checkpoint_return_format>
**Standalone mode only.** In team mode, use the messaging formats in checkpoint_protocol instead.

When hitting checkpoint or auth gate, return this structure:
...
[rest of existing content unchanged]
</checkpoint_return_format>
```

### 2i. Continuation Handling - Add Mode Gate

**Current (lines 217-225) - `<continuation_handling>`:**

```markdown
<continuation_handling>
If spawned as continuation agent (`<completed_tasks>` in prompt):

1. Verify previous commits exist: `git log --oneline -5`
2. DO NOT redo completed tasks
3. Start from resume point in prompt
4. Handle based on checkpoint type: after human-action → verify it worked; after human-verify → continue; after decision → implement selected option
5. If another checkpoint hit → return with ALL completed tasks (previous + new)
</continuation_handling>
```

**New:**
```markdown
<continuation_handling>
**Standalone mode only.** In team mode, you never die and never need continuation — skip this section entirely.

If spawned as continuation agent (`<completed_tasks>` in prompt):

1. Verify previous commits exist: `git log --oneline -5`
2. DO NOT redo completed tasks
3. Start from resume point in prompt
4. Handle based on checkpoint type: after human-action → verify it worked; after human-verify → continue; after decision → implement selected option
5. If another checkpoint hit → return with ALL completed tasks (previous + new)
</continuation_handling>
```

### 2j. Authentication Gates Update

**Current (lines 142-155) - `<authentication_gates>`:**

```markdown
<authentication_gates>
**Auth errors during `type="auto"` execution are gates, not failures.**

**Indicators:** "Not authenticated", "Not logged in", "Unauthorized", "401", "403", "Please run {tool} login", "Set {ENV_VAR}"

**Protocol:**
1. Recognize it's an auth gate (not a bug)
2. STOP current task
3. Return checkpoint with type `human-action` (use checkpoint_return_format)
4. Provide exact auth steps (CLI commands, where to get keys)
5. Specify verification command

**In Summary:** Document auth gates as normal flow, not deviations.
</authentication_gates>
```

**New:**
```markdown
<authentication_gates>
**Auth errors during `type="auto"` execution are gates, not failures.**

**Indicators:** "Not authenticated", "Not logged in", "Unauthorized", "401", "403", "Please run {tool} login", "Set {ENV_VAR}"

**Protocol:**
1. Recognize it's an auth gate (not a bug)
2. STOP current task
3. **Team mode:** Send checkpoint message with type `human-action` to team lead (see checkpoint_protocol). Wait for "done" response. Verify auth works. Retry original task. Continue.
4. **Standalone mode:** Return checkpoint with type `human-action` (use checkpoint_return_format). Provide exact auth steps. Specify verification command.

**In Summary:** Document auth gates as normal flow, not deviations.
</authentication_gates>
```

### 2k. Completion Format Update

**Current (lines 374-390) - `<completion_format>`:**

```markdown
<completion_format>
```markdown
## PLAN COMPLETE

**Plan:** {phase}-{plan}
**Tasks:** {completed}/{total}
**SUMMARY:** {path to SUMMARY.md}

**Commits:**
- {hash}: {message}
- {hash}: {message}

**Duration:** {time}
```

Include ALL commits (previous + new if continuation agent).
</completion_format>
```

**New:**
```markdown
<completion_format>

### Team Mode

Send completion message and update task:

```
SendMessage(type="message", recipient="team-lead",
  summary="Plan complete: {plan-id} ({completed}/{total} tasks)",
  content="PLAN COMPLETE
Plan: {plan-id}
Tasks: {completed}/{total}
SUMMARY: {path to SUMMARY.md}
Duration: {time}

Commits:
- {hash}: {message}
- {hash}: {message}

Deviations: {count and brief summary, or 'none'}")
```

Then update shared task: `TaskUpdate(taskId="{your-task}", status="completed")`

### Standalone Mode

Return structured message:

```markdown
## PLAN COMPLETE

**Plan:** {phase}-{plan}
**Tasks:** {completed}/{total}
**SUMMARY:** {path to SUMMARY.md}

**Commits:**
- {hash}: {message}
- {hash}: {message}

**Duration:** {time}
```

Include ALL commits (previous + new if continuation agent).
</completion_format>
```

### 2l. Success Criteria Update

**Current (lines 392-403) - `<success_criteria>`:**

```markdown
<success_criteria>
Plan execution complete when:

- [ ] All tasks executed (or paused at checkpoint with full state returned)
- [ ] Each task committed individually with proper format
- [ ] All deviations documented
- [ ] Authentication gates handled and documented
- [ ] SUMMARY.md created with substantive content
- [ ] STATE.md updated (position, decisions, issues, session)
- [ ] Final metadata commit made
- [ ] Completion format returned to orchestrator
</success_criteria>
```

**New:**
```markdown
<success_criteria>
Plan execution complete when:

- [ ] All tasks executed (or paused at checkpoint: state returned in standalone mode, message sent in team mode)
- [ ] Each task committed individually with proper format
- [ ] All deviations documented
- [ ] Authentication gates handled and documented
- [ ] SUMMARY.md created with substantive content
- [ ] STATE.md updated (position, decisions, issues, session)
- [ ] Final metadata commit made
- [ ] Completion communicated (team mode: SendMessage + TaskUpdate; standalone mode: structured return)
</success_criteria>
```

---

## 3. execute-plan.md Changes

### 3a. parse_segments Step - Team Mode Routing

**Current (lines 63-81):**
```markdown
<step name="parse_segments">
```bash
grep -n "type=\"checkpoint" .planning/phases/XX-name/{phase}-{plan}-PLAN.md
```

**Routing by checkpoint type:**

| Checkpoints | Pattern | Execution |
|-------------|---------|-----------|
| None | A (autonomous) | Single subagent: full plan + SUMMARY + commit |
| Verify-only | B (segmented) | Segments between checkpoints. After none/human-verify → SUBAGENT. After decision/human-action → MAIN |
| Decision | C (main) | Execute entirely in main context |

**Pattern A:** init_agent_tracking → spawn Task(subagent_type="hive-executor", model=executor_model) with prompt: execute plan at [path], autonomous, all tasks + SUMMARY + commit, follow deviation/auth rules, report: plan name, tasks, SUMMARY path, commit hash → track agent_id → wait → update tracking → report.

**Pattern B:** Execute segment-by-segment. Autonomous segments: spawn subagent for assigned tasks only (no SUMMARY/commit). Checkpoints: main context. After all segments: aggregate, create SUMMARY, commit. See segment_execution.

**Pattern C:** Execute in main using standard flow (step name="execute").

Fresh context per subagent preserves peak quality. Main context stays lean.
</step>
```

**New:**
```markdown
<step name="parse_segments">
```bash
grep -n "type=\"checkpoint" .planning/phases/XX-name/{phase}-{plan}-PLAN.md
```

**Detect team mode:** Check if this workflow is running in a team context (team lead with executor teammates). If yes, use Team routing. If no, use Classic routing.

### Classic Routing (Standalone / Task subagents)

| Checkpoints | Pattern | Execution |
|-------------|---------|-----------|
| None | A (autonomous) | Single subagent: full plan + SUMMARY + commit |
| Verify-only | B (segmented) | Segments between checkpoints. After none/human-verify -> SUBAGENT. After decision/human-action -> MAIN |
| Decision | C (main) | Execute entirely in main context |

**Pattern A:** init_agent_tracking -> spawn Task(subagent_type="hive-executor", model=executor_model) with prompt: execute plan at [path], autonomous, all tasks + SUMMARY + commit, follow deviation/auth rules, report: plan name, tasks, SUMMARY path, commit hash -> track agent_id -> wait -> update tracking -> report.

**Pattern B:** Execute segment-by-segment. Autonomous segments: spawn subagent for assigned tasks only (no SUMMARY/commit). Checkpoints: main context. After all segments: aggregate, create SUMMARY, commit. See segment_execution.

**Pattern C:** Execute in main using standard flow (step name="execute").

Fresh context per subagent preserves peak quality. Main context stays lean.

### Team Routing (Agent Teams)

| Checkpoints | Pattern | Execution |
|-------------|---------|-----------|
| None | A-team | Executor teammate: full plan + SUMMARY + commit. Messages progress. |
| Any checkpoints | B-team | **Same executor teammate** handles entire plan. At checkpoints: sends message to team lead, waits for response, continues. No segmentation needed. |

**Pattern A-team:** Send plan to executor teammate. Executor runs full plan autonomously, sending progress updates per task. On completion, sends PLAN COMPLETE message.

**Pattern B-team:** Send plan to executor teammate. Executor runs until checkpoint, sends checkpoint message to team lead, waits. Team lead relays to user, gets response, sends back to executor. Executor continues with full context. **No segmentation, no continuation agents, no context loss.**

**Key difference:** Patterns B and C from classic mode collapse into B-team. The executor handles all checkpoint types itself via messaging. No need for "MAIN" context to handle decisions.
</step>
```

### 3b. segment_execution Step - Team Mode Gate

**Current (lines 103-120):**

Add a team mode gate at the top of the step:

```markdown
<step name="segment_execution">
**Classic mode only (standalone / Task subagents).** In team mode, skip this step entirely — the executor handles all segments as a single continuous run with checkpoint messaging.

Pattern B only (verify-only checkpoints). Skip for A/C.

[... rest of existing content unchanged ...]
</step>
```

### 3c. execute Step - Team Mode Checkpoint Handling

**Current (lines 136-146):**
```markdown
<step name="execute">
Deviations are normal — handle via rules below.

1. Read @context files from prompt
2. Per task:
   - `type="auto"`: if `tdd="true"` → TDD execution. Implement with deviation rules + auth gates. Verify done criteria. Commit (see task_commit). Track hash for Summary.
   - `type="checkpoint:*"`: STOP → checkpoint_protocol → wait for user → continue only after confirmation.
3. Run `<verification>` checks
4. Confirm `<success_criteria>` met
5. Document deviations in Summary
</step>
```

**New:**
```markdown
<step name="execute">
Deviations are normal — handle via rules below.

1. Read @context files from prompt
2. Per task:
   - `type="auto"`: if `tdd="true"` -> TDD execution. Implement with deviation rules + auth gates. Verify done criteria. Commit (see task_commit). Track hash for Summary. **Team mode:** send progress update after commit.
   - `type="checkpoint:*"`:
     - **Team mode:** Send checkpoint message to team lead (see checkpoint_protocol in hive-executor.md). WAIT for response. Process response. Continue to next task.
     - **Classic mode:** STOP -> checkpoint_protocol -> wait for user -> continue only after confirmation.
3. Run `<verification>` checks
4. Confirm `<success_criteria>` met
5. Document deviations in Summary
</step>
```

### 3d. checkpoint_protocol Step - Team Mode Alternative

**Current (lines 267-281):**
```markdown
<step name="checkpoint_protocol">
On `type="checkpoint:*"`: automate everything possible first. Checkpoints are for verification/decisions only.

Display: `CHECKPOINT: [Type]` box → Progress {X}/{Y} → Task name → type-specific content → `YOUR ACTION: [signal]`

| Type | Content | Resume signal |
|------|---------|---------------|
| human-verify (90%) | What was built + verification steps (commands/URLs) | "approved" or describe issues |
| decision (9%) | Decision needed + context + options with pros/cons | "Select: option-id" |
| human-action (1%) | What was automated + ONE manual step + verification plan | "done" |

After response: verify if specified. Pass → continue. Fail → inform, wait. WAIT for user — do NOT hallucinate completion.

See ~/.claude/hive/references/checkpoints.md for details.
</step>
```

**New:**
```markdown
<step name="checkpoint_protocol">
On `type="checkpoint:*"`: automate everything possible first. Checkpoints are for verification/decisions only.

### Classic Mode (Standalone)

Display: `CHECKPOINT: [Type]` box -> Progress {X}/{Y} -> Task name -> type-specific content -> `YOUR ACTION: [signal]`

| Type | Content | Resume signal |
|------|---------|---------------|
| human-verify (90%) | What was built + verification steps (commands/URLs) | "approved" or describe issues |
| decision (9%) | Decision needed + context + options with pros/cons | "Select: option-id" |
| human-action (1%) | What was automated + ONE manual step + verification plan | "done" |

After response: verify if specified. Pass -> continue. Fail -> inform, wait. WAIT for user -- do NOT hallucinate completion.

### Team Mode (Agent Teams)

Send checkpoint message to team lead using the formats defined in hive-executor.md `<checkpoint_protocol>`. The team lead will relay to the user and return the response.

| Type | Message summary prefix | Expected response |
|------|----------------------|-------------------|
| human-verify | "Checkpoint: verify {what}" | "approved" or issue description |
| decision | "Checkpoint: decision needed for {topic}" | Option selection |
| human-action | "Checkpoint: manual action needed - {action}" | "done" |

After receiving response: same handling as classic mode. Verify if specified. Pass -> continue. Fail -> inform team lead and wait.

**CRITICAL:** In team mode, NEVER format the checkpoint_return_for_orchestrator structured return. NEVER return/exit. Send message and WAIT.

See ~/.claude/hive/references/checkpoints.md for details.
</step>
```

### 3e. checkpoint_return_for_orchestrator Step - Team Mode Gate

**Current (lines 283-289):**
```markdown
<step name="checkpoint_return_for_orchestrator">
When spawned via Task and hitting checkpoint: return structured state (cannot interact with user directly).

**Required return:** 1) Completed Tasks table (hashes + files) 2) Current Task (what's blocking) 3) Checkpoint Details (user-facing content) 4) Awaiting (what's needed from user)

Orchestrator parses → presents to user → spawns fresh continuation with your completed tasks state. You will NOT be resumed. In main context: use checkpoint_protocol above.
</step>
```

**New:**
```markdown
<step name="checkpoint_return_for_orchestrator">
**Classic mode only.** In team mode, skip this step entirely — use checkpoint messaging from checkpoint_protocol instead.

When spawned via Task and hitting checkpoint: return structured state (cannot interact with user directly).

**Required return:** 1) Completed Tasks table (hashes + files) 2) Current Task (what's blocking) 3) Checkpoint Details (user-facing content) 4) Awaiting (what's needed from user)

Orchestrator parses -> presents to user -> spawns fresh continuation with your completed tasks state. You will NOT be resumed. In main context: use checkpoint_protocol above.
</step>
```

### 3f. Authentication Gates - Team Mode Path

**Current (lines 148-168) in execute-plan.md:**
```markdown
<authentication_gates>

## Authentication Gates

Auth errors during execution are NOT failures — they're expected interaction points.

**Indicators:** "Not authenticated", "Unauthorized", 401/403, "Please run {tool} login", "Set {ENV_VAR}"

**Protocol:**
1. Recognize auth gate (not a bug)
2. STOP task execution
3. Create dynamic checkpoint:human-action with exact auth steps
4. Wait for user to authenticate
5. Verify credentials work
6. Retry original task
7. Continue normally

**Example:** `vercel --yes` → "Not authenticated" → checkpoint asking user to `vercel login` → verify with `vercel whoami` → retry deploy → continue

**In Summary:** Document as normal flow under "## Authentication Gates", not as deviations.

</authentication_gates>
```

**New:**
```markdown
<authentication_gates>

## Authentication Gates

Auth errors during execution are NOT failures — they're expected interaction points.

**Indicators:** "Not authenticated", "Unauthorized", 401/403, "Please run {tool} login", "Set {ENV_VAR}"

**Protocol:**
1. Recognize auth gate (not a bug)
2. STOP task execution
3. **Team mode:** Send `human-action` checkpoint message to team lead with exact auth steps and verification command. Wait for "done" response.
4. **Classic mode:** Create dynamic checkpoint:human-action with exact auth steps. Wait for user to authenticate.
5. Verify credentials work
6. Retry original task
7. Continue normally

**Example (team mode):** `vercel --yes` -> "Not authenticated" -> SendMessage to team lead: "need `vercel login`" -> team lead relays to user -> user authenticates -> "done" -> verify with `vercel whoami` -> retry deploy -> continue

**Example (classic mode):** `vercel --yes` -> "Not authenticated" -> checkpoint asking user to `vercel login` -> verify with `vercel whoami` -> retry deploy -> continue

**In Summary:** Document as normal flow under "## Authentication Gates", not as deviations.

</authentication_gates>
```

### 3g. Deviation Rules - Rule 4 Team Mode

**Current (lines 182-199) in execute-plan.md - Rule 4 format:**
```markdown
**Rule 4 format:**
```
⚠️ Architectural Decision Needed

Current task: [task name]
Discovery: [what prompted this]
Proposed change: [modification]
Why needed: [rationale]
Impact: [what this affects]
Alternatives: [other approaches]

Proceed with proposed change? (yes / different approach / defer)
```
```

**New:**
```markdown
**Rule 4 format:**

**Team mode:**
```
SendMessage(type="message", recipient="team-lead",
  summary="Decision needed: {short description}",
  content="DEVIATION RULE 4: Architectural Decision Needed

Current task: [task name]
Discovery: [what prompted this]
Proposed change: [modification]
Why needed: [rationale]
Impact: [what this affects]
Alternatives: [other approaches]

Options: proceed with proposed change / different approach / defer")
```
Wait for response. Implement based on decision. Continue execution.

**Classic mode:**
```
⚠️ Architectural Decision Needed

Current task: [task name]
Discovery: [what prompted this]
Proposed change: [modification]
Why needed: [rationale]
Impact: [what this affects]
Alternatives: [other approaches]

Proceed with proposed change? (yes / different approach / defer)
```
```

### 3h. verification_failure_gate - Team Mode

**Current (lines 291-293):**
```markdown
<step name="verification_failure_gate">
If verification fails: STOP. Present: "Verification failed for Task [X]: [name]. Expected: [criteria]. Actual: [result]." Options: Retry | Skip (mark incomplete) | Stop (investigate). If skipped → SUMMARY "Issues Encountered".
</step>
```

**New:**
```markdown
<step name="verification_failure_gate">
If verification fails:

**Team mode:** Send message to team lead:
```
SendMessage(type="message", recipient="team-lead",
  summary="Verification failed: Task {X} - {name}",
  content="VERIFICATION FAILED
Task {X}: {name}
Expected: {criteria}
Actual: {result}

Options:
1. retry - I'll retry the verification
2. skip - Mark incomplete, continue (will appear in SUMMARY Issues)
3. stop - Stop execution, investigate")
```
Wait for response. Act accordingly.

**Classic mode:** STOP. Present: "Verification failed for Task [X]: [name]. Expected: [criteria]. Actual: [result]." Options: Retry | Skip (mark incomplete) | Stop (investigate).

If skipped -> SUMMARY "Issues Encountered".
</step>
```

---

## 4. Backward Compatibility Strategy

### Detection Mechanism

The detection is **implicit based on invocation context**, not a config flag:

```
TEAM MODE when ALL of:
  1. SendMessage tool is available in the agent's tool list
  2. Agent was invoked via teammate message (not Task prompt)
  3. Agent can identify a "team-lead" recipient

STANDALONE MODE when ANY of:
  1. SendMessage tool is NOT available
  2. Agent was spawned via Task() with a text prompt
  3. No team context in system prompt
```

**Why not a config flag:** Team mode is determined by how Claude Code invokes the agent, not by user preference. If the user runs `/hive:execute-phase` with Agent Teams enabled, the executor is spawned as a teammate. If they run it without Agent Teams (or on OpenCode/Gemini), it's spawned via Task.

### Graceful Degradation

If an executor is in team mode but SendMessage fails (edge case):

1. Fall back to standalone behavior for that checkpoint
2. Return structured checkpoint message as if standalone
3. Log the fallback in SUMMARY.md deviations

### No Config Changes Needed for This PR

The `config.json` changes from the evolution analysis (e.g., `teams.execution_team`) are orchestrator-level concerns (P0-2 scope, execute-phase.md). The executor itself only needs to detect its invocation context.

### File-by-File Compatibility Matrix

| File | Standalone (current) | Team mode (new) | Breaking changes |
|------|---------------------|-----------------|------------------|
| hive-executor.md | Works exactly as before | New team_protocol section + conditional behavior | None - all changes are additive with mode gates |
| execute-plan.md | Works exactly as before | New team routing + conditional steps | None - classic routing preserved alongside team routing |
| checkpoints.md | No changes in this PR | No changes in this PR (P0-2 scope) | N/A |
| continuation-format.md | No changes needed | Not used in team mode (no continuation) | N/A |

---

## 5. Message Formats

### Summary of All Message Types Sent by Executor in Team Mode

| When | Message Summary | Content Prefix | Expected Response |
|------|----------------|----------------|-------------------|
| Plan start | "Starting plan: {plan-id}" | "PLAN START: ..." | None (informational) |
| Task complete | "Task N/M complete: {name}" | "PROGRESS: ..." | None (informational) |
| checkpoint:human-verify | "Checkpoint: verify {what}" | "CHECKPOINT: human-verify ..." | "approved" or issue description |
| checkpoint:decision | "Checkpoint: decision needed for {topic}" | "CHECKPOINT: decision ..." | Option selection |
| checkpoint:human-action | "Checkpoint: manual action needed - {action}" | "CHECKPOINT: human-action ..." | "done" |
| Deviation Rule 4 | "Decision needed: {description}" | "DEVIATION RULE 4: ..." | Decision (proceed/alternative/defer) |
| Auth gate | "Checkpoint: manual action needed - {auth}" | "CHECKPOINT: human-action ..." | "done" |
| Verification failure | "Verification failed: Task {X}" | "VERIFICATION FAILED ..." | "retry" / "skip" / "stop" |
| Plan complete | "Plan complete: {plan-id}" | "PLAN COMPLETE ..." | None (informational) |

### Message Parsing Contract

The team lead needs to parse these messages to determine what action is needed. The contract:

- **Informational messages** (PROGRESS, PLAN START, PLAN COMPLETE): No response needed. Team lead may relay to user for visibility.
- **Checkpoint messages** (CHECKPOINT:): Team lead MUST relay to user, collect response, and send it back to the executor.
- **Decision messages** (DEVIATION RULE 4): Team lead MUST relay to user, collect decision, and send it back.
- **Failure messages** (VERIFICATION FAILED): Team lead MUST relay to user, collect decision, and send it back.

The content prefixes (CHECKPOINT:, PROGRESS:, DEVIATION RULE 4:, VERIFICATION FAILED:, PLAN COMPLETE:, PLAN START:) are the parsing keys.

---

## 6. Testing Checklist

### Standalone Mode Regression

- [ ] Executor spawned via Task with no checkpoints (Pattern A) works unchanged
- [ ] Executor spawned via Task with checkpoints (Pattern B) returns structured state and dies
- [ ] Continuation agent receives completed_tasks and resumes correctly
- [ ] Rule 4 deviation returns checkpoint in standalone mode
- [ ] Auth gate returns checkpoint in standalone mode

### Team Mode New Behavior

- [ ] Executor detects team mode correctly (SendMessage available + teammate invocation)
- [ ] Progress updates sent after each task commit
- [ ] checkpoint:human-verify sends message, waits, continues on "approved"
- [ ] checkpoint:human-verify handles issue feedback (re-work + re-checkpoint)
- [ ] checkpoint:decision sends options, waits, implements selection
- [ ] checkpoint:human-action sends instructions, waits for "done", verifies
- [ ] Rule 4 deviation sends decision message, waits, implements choice
- [ ] Auth gate sends human-action message, waits, retries after "done"
- [ ] Verification failure sends options, handles retry/skip/stop
- [ ] Plan completion sends message + updates TaskList
- [ ] Multiple checkpoints in one plan: executor survives all (no death/respawn)
- [ ] Context preserved across checkpoints (executor remembers previous tasks without re-reading)

### Edge Cases

- [ ] SendMessage fails mid-checkpoint -> graceful degradation to standalone
- [ ] Team lead takes long to respond (executor stays idle, doesn't timeout)
- [ ] User responds with unexpected format -> executor asks for clarification via message
- [ ] Plan with 0 checkpoints in team mode -> just progress updates + completion
