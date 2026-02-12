<purpose>
Execute a phase prompt (PLAN.md) and create the outcome summary (SUMMARY.md).
</purpose>

<required_reading>
Read STATE.md before any operation to load project context.
Read config.json for planning behavior settings.

@~/.claude/hive/references/git-integration.md
</required_reading>

<process>

<step name="init_context" priority="first">
Load execution context (uses `init execute-phase` for full context, including file contents):

```bash
INIT=$(node ~/.claude/hive/bin/hive-tools.js init execute-phase "${PHASE}" --include state,config)
```

Extract from init JSON: `executor_model`, `commit_docs`, `phase_dir`, `phase_number`, `plans`, `summaries`, `incomplete_plans`.

Extract recall context for agent prompts:
```bash
RECALL=$(echo "$INIT" | jq -r '.recall_context // empty')
```

**File contents (from --include):** `state_content`, `config_content`. Access with:
```bash
STATE_CONTENT=$(echo "$INIT" | jq -r '.state_content // empty')
CONFIG_CONTENT=$(echo "$INIT" | jq -r '.config_content // empty')
```

If `.planning/` missing: error.
</step>

<step name="identify_plan">
```bash
# Use plans/summaries from INIT JSON, or list files
ls .planning/phases/XX-name/*-PLAN.md 2>/dev/null | sort
ls .planning/phases/XX-name/*-SUMMARY.md 2>/dev/null | sort
```

Find first PLAN without matching SUMMARY. Decimal phases supported (`01.1-hotfix/`):

```bash
PHASE=$(echo "$PLAN_PATH" | grep -oE '[0-9]+(\.[0-9]+)?-[0-9]+')
# config_content already loaded via --include config in init_context
```

<if mode="yolo">
Auto-approve: `⚡ Execute {phase}-{plan}-PLAN.md [Plan X of Y for Phase Z]` → parse_segments.
</if>

<if mode="interactive" OR="custom with gates.execute_next_plan true">
Present plan identification, wait for confirmation.

If user modifies the plan selection or provides different instructions, emit a user_correction event:

```bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit user_correction \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"what_changed\":\"plan-selection\",\"user_intent\":\"${USER_RESPONSE}\"}"
```
</if>
</step>

<step name="record_start_time">
```bash
PLAN_START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PLAN_START_EPOCH=$(date +%s)
```
</step>

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

**Pattern A:** init_agent_tracking -> spawn Task(subagent_type="hive-executor", model=executor_model) with prompt: execute plan at [path], autonomous, all tasks + SUMMARY + commit, follow deviation/auth rules, report: plan name, tasks, SUMMARY path, commit hash. {If RECALL is non-empty, include `<recall>` block with past project patterns.} -> track agent_id -> wait -> update tracking -> report.

**Pattern B:** Execute segment-by-segment. Autonomous segments: spawn subagent for assigned tasks only (no SUMMARY/commit). Checkpoints: main context. After all segments: aggregate, create SUMMARY, commit. See segment_execution.

**Pattern C:** Execute in main using standard flow (step name="execute").

Fresh context per subagent preserves peak quality. Main context stays lean.

### Team Routing (Agent Teams)

| Checkpoints | Pattern | Execution |
|-------------|---------|-----------|
| None | A-team | Executor teammate: full plan + SUMMARY + commit. Messages progress. |
| Any checkpoints | B-team | **Same executor teammate** handles entire plan. At checkpoints: sends message to team lead, waits for response, continues. No segmentation needed. |

**Pattern A-team:** Send plan to executor teammate. {If RECALL is non-empty, include `<recall>` block with past project patterns in the message.} Executor runs full plan autonomously, sending progress updates per task. On completion, sends PLAN COMPLETE message.

**Pattern B-team:** Send plan to executor teammate. {If RECALL is non-empty, include `<recall>` block with past project patterns in the message.} Executor runs until checkpoint, sends checkpoint message to team lead, waits. Team lead relays to user, gets response, sends back to executor. Executor continues with full context. **No segmentation, no continuation agents, no context loss.**

**Key difference:** Patterns B and C from classic mode collapse into B-team. The executor handles all checkpoint types itself via messaging. No need for "MAIN" context to handle decisions.
</step>

<step name="init_agent_tracking">
```bash
if [ ! -f .planning/agent-history.json ]; then
  echo '{"version":"1.0","max_entries":50,"entries":[]}' > .planning/agent-history.json
fi
rm -f .planning/current-agent-id.txt
if [ -f .planning/current-agent-id.txt ]; then
  INTERRUPTED_ID=$(cat .planning/current-agent-id.txt)
  echo "Found interrupted agent: $INTERRUPTED_ID"
fi
```

If interrupted: ask user to resume (Task `resume` parameter) or start fresh.

**Tracking protocol:** On spawn: write agent_id to `current-agent-id.txt`, append to agent-history.json: `{"agent_id":"[id]","task_description":"[desc]","phase":"[phase]","plan":"[plan]","segment":[num|null],"timestamp":"[ISO]","status":"spawned","completion_timestamp":null}`. On completion: status → "completed", set completion_timestamp, delete current-agent-id.txt. Prune: if entries > max_entries, remove oldest "completed" (never "spawned").

Run for Pattern A/B before spawning. Pattern C: skip.
</step>

<step name="segment_execution">
**Classic mode only (standalone / Task subagents).** In team mode, skip this step entirely — the executor handles all segments as a single continuous run with checkpoint messaging.

Pattern B only (verify-only checkpoints). Skip for A/C.

1. Parse segment map: checkpoint locations and types
2. Per segment:
   - Subagent route: spawn hive-executor for assigned tasks only. Prompt: task range, plan path, read full plan for context, execute assigned tasks, track deviations, NO SUMMARY/commit. {If RECALL is non-empty, include `<recall>` block with past project patterns.} Track via agent protocol.
   - Main route: execute tasks using standard flow (step name="execute")
3. After ALL segments: aggregate files/deviations/decisions → create SUMMARY.md → commit → self-check:
   - Verify key-files.created exist on disk with `[ -f ]`
   - Check `git log --oneline --all --grep="{phase}-{plan}"` returns ≥1 commit
   - Append `## Self-Check: PASSED` or `## Self-Check: FAILED` to SUMMARY

   **Known Claude Code bug (classifyHandoffIfNeeded):** If any segment agent reports "failed" with `classifyHandoffIfNeeded is not defined`, this is a Claude Code runtime bug — not a real failure. Run spot-checks; if they pass, treat as successful.




</step>

<step name="load_prompt">
```bash
cat .planning/phases/XX-name/{phase}-{plan}-PLAN.md
```
This IS the execution instructions. Follow exactly. If plan references CONTEXT.md: honor user's vision throughout.
</step>

<step name="previous_phase_check">
```bash
ls .planning/phases/*/SUMMARY.md 2>/dev/null | sort -r | head -2 | tail -1
```
If previous SUMMARY has unresolved "Issues Encountered" or "Next Phase Readiness" blockers: AskUserQuestion(header="Previous Issues", options: "Proceed anyway" | "Address first" | "Review previous").
</step>

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

<deviation_rules>

## Deviation Rules

You WILL discover unplanned work. Apply automatically, track all for Summary.

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **1: Bug** | Broken behavior, errors, wrong queries, type errors, security vulns, race conditions, leaks | Fix → test → verify → track `[Rule 1 - Bug]` | Auto |
| **2: Missing Critical** | Missing essentials: error handling, validation, auth, CSRF/CORS, rate limiting, indexes, logging | Add → test → verify → track `[Rule 2 - Missing Critical]` | Auto |
| **3: Blocking** | Prevents completion: missing deps, wrong types, broken imports, missing env/config/files, circular deps | Fix blocker → verify proceeds → track `[Rule 3 - Blocking]` | Auto |
| **4: Architectural** | Structural change: new DB table, schema change, new service, switching libs, breaking API, new infra | STOP → present decision (below) → track `[Rule 4 - Architectural]` | Ask user |

**After applying any auto-fix (Rules 1-3), emit a deviation event for Recall:**

```bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit deviation \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"deviation_type\":\"rule-${RULE_NUM}\",\"severity\":\"auto\",\"description\":\"${DEVIATION_TITLE}\",\"resolution\":\"${RESOLUTION}\"}"
```

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

**After Rule 4 resolution (user responded), emit the deviation event:**

```bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit deviation \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"deviation_type\":\"rule-4\",\"severity\":\"architectural\",\"description\":\"${DEVIATION_TITLE}\",\"resolution\":\"${USER_DECISION}\"}"
```

**Priority:** Rule 4 (STOP) > Rules 1-3 (auto) > unsure → Rule 4
**Edge cases:** missing validation → R2 | null crash → R1 | new table → R4 | new column → R1/2
**Heuristic:** Affects correctness/security/completion? → R1-3. Maybe? → R4.

</deviation_rules>

<deviation_documentation>

## Documenting Deviations

Summary MUST include deviations section. None? → `## Deviations from Plan\n\nNone - plan executed exactly as written.`

Per deviation: **[Rule N - Category] Title** — Found during: Task X | Issue | Fix | Files modified | Verification | Commit hash

End with: **Total deviations:** N auto-fixed (breakdown). **Impact:** assessment.

</deviation_documentation>

<tdd_plan_execution>
## TDD Execution

For `type: tdd` plans — RED-GREEN-REFACTOR:

1. **Infrastructure** (first TDD plan only): detect project, install framework, config, verify empty suite
2. **RED:** Read `<behavior>` → failing test(s) → run (MUST fail) → commit: `test({phase}-{plan}): add failing test for [feature]`
3. **GREEN:** Read `<implementation>` → minimal code → run (MUST pass) → commit: `feat({phase}-{plan}): implement [feature]`
4. **REFACTOR:** Clean up → tests MUST pass → commit: `refactor({phase}-{plan}): clean up [feature]`

Errors: RED doesn't fail → investigate test/existing feature. GREEN doesn't pass → debug, iterate. REFACTOR breaks → undo.

See `~/.claude/hive/references/tdd.md` for structure.
</tdd_plan_execution>

<task_commit>
## Task Commit Protocol

After each task (verification passed, done criteria met), commit immediately.

**1. Check:** `git status --short`

**2. Stage individually** (NEVER `git add .` or `git add -A`):
```bash
git add src/api/auth.ts
git add src/types/user.ts
```

**3. Commit type:**

| Type | When | Example |
|------|------|---------|
| `feat` | New functionality | feat(08-02): create user registration endpoint |
| `fix` | Bug fix | fix(08-02): correct email validation regex |
| `test` | Test-only (TDD RED) | test(08-02): add failing test for password hashing |
| `refactor` | No behavior change (TDD REFACTOR) | refactor(08-02): extract validation to helper |
| `perf` | Performance | perf(08-02): add database index |
| `docs` | Documentation | docs(08-02): add API docs |
| `style` | Formatting | style(08-02): format auth module |
| `chore` | Config/deps | chore(08-02): add bcrypt dependency |

**4. Format:** `{type}({phase}-{plan}): {description}` with bullet points for key changes.

**5. Record hash:**
```bash
TASK_COMMIT=$(git rev-parse --short HEAD)
TASK_COMMITS+=("Task ${TASK_NUM}: ${TASK_COMMIT}")
```

</task_commit>

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

<step name="checkpoint_return_for_orchestrator">
**Classic mode only.** In team mode, skip this step entirely — use checkpoint messaging from checkpoint_protocol instead.

When spawned via Task and hitting checkpoint: return structured state (cannot interact with user directly).

**Required return:** 1) Completed Tasks table (hashes + files) 2) Current Task (what's blocking) 3) Checkpoint Details (user-facing content) 4) Awaiting (what's needed from user)

Orchestrator parses -> presents to user -> spawns fresh continuation with your completed tasks state. You will NOT be resumed. In main context: use checkpoint_protocol above.
</step>

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

If user chose "skip", emit a user_correction event:

```bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit user_correction \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"what_changed\":\"verification-skip\",\"user_intent\":\"${USER_RESPONSE}\"}"
```
</step>

<step name="record_completion_time">
```bash
PLAN_END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PLAN_END_EPOCH=$(date +%s)

DURATION_SEC=$(( PLAN_END_EPOCH - PLAN_START_EPOCH ))
DURATION_MIN=$(( DURATION_SEC / 60 ))

if [[ $DURATION_MIN -ge 60 ]]; then
  HRS=$(( DURATION_MIN / 60 ))
  MIN=$(( DURATION_MIN % 60 ))
  DURATION="${HRS}h ${MIN}m"
else
  DURATION="${DURATION_MIN} min"
fi
```
</step>

<step name="build_gate">
**Pre-PR build validation.** Runs after all tasks completed and committed, before summary creation.

**Check if build gate applies:**

```bash
GIT_FLOW=$(echo "$CONFIG_CONTENT" | jq -r '.git.flow // "github"')
PRE_PR_GATE=$(echo "$CONFIG_CONTENT" | jq -r '.git.build_gates.pre_pr // true')
```

**Skip conditions (any one skips the gate):**
- `GIT_FLOW` is `"none"` -> Skip: "Git flow disabled. Skipping build gate."
- `PRE_PR_GATE` is `false` -> Skip: "Pre-PR build gate disabled in config. Skipping."

**Run build gate:**

```bash
BUILD_RESULT=$(node ./.claude/hive/bin/hive-tools.js git run-build-gate --raw)
BUILD_SUCCESS=$(echo "$BUILD_RESULT" | jq -r '.success')
BUILD_SKIPPED=$(echo "$BUILD_RESULT" | jq -r '.skipped // false')
BUILD_TIMED_OUT=$(echo "$BUILD_RESULT" | jq -r '.timedOut // false')
BUILD_CMD=$(echo "$BUILD_RESULT" | jq -r '.command // "unknown"')
BUILD_EXIT_CODE=$(echo "$BUILD_RESULT" | jq -r '.exitCode // "N/A"')
BUILD_STDERR=$(echo "$BUILD_RESULT" | jq -r '.stderr // ""')
```

**Handle results:**

| Condition | Action |
|-----------|--------|
| `BUILD_SKIPPED` is `"true"` | No build command detected. Log: "No build command detected. Skipping build gate." Set `BUILD_GATE_RESULT="skipped"`. Continue to summary. |
| `BUILD_SUCCESS` is `"true"` | Build passed. Log: "Build gate passed (command: ${BUILD_CMD})." Set `BUILD_GATE_RESULT="passed"`. Continue to summary. |
| `BUILD_TIMED_OUT` is `"true"` | Build hung. See timeout handling below. Set `BUILD_GATE_RESULT="timeout"`. |
| `BUILD_SUCCESS` is `"false"` | Build failed. See failure handling below. Set `BUILD_GATE_RESULT="failed"`. |

**On build timeout:**

**Team mode:**
```
SendMessage(type="message", recipient="team-lead",
  summary="Build gate timed out: ${PLAN_ID}",
  content="BUILD GATE TIMED OUT
Plan: ${PHASE}-${PLAN}
Command: ${BUILD_CMD}
Timeout: configured in git.build_timeout (default 300s)

The build process was killed after exceeding the configured timeout.

Possible causes:
- Build command is interactive (requires user input)
- Build command has an infinite loop or deadlock
- Timeout is too short for this project

Options:
1. fix - Investigate and fix the build issue
2. increase-timeout - Set a higher timeout
3. skip - Proceed without build validation (note in SUMMARY)
4. stop - Stop execution, investigate manually")
```

**Classic mode:**
```
## Build Gate Timed Out

**Plan:** ${PHASE}-${PLAN}
**Command:** ${BUILD_CMD}
**Timeout:** configured in git.build_timeout (default 300s)

The build process was killed after exceeding the configured timeout.

Possible causes:
- Build command is interactive (requires user input)
- Build command has an infinite loop or deadlock
- Timeout is too short for this project

Options:
- "fix" - Investigate and fix the build issue
- "increase-timeout" - Set a higher timeout
- "skip" - Proceed without build validation
- "stop" - Stop execution
```

**On build failure (not timeout):**

**Team mode:**
```
SendMessage(type="message", recipient="team-lead",
  summary="Build gate failed: ${PLAN_ID}",
  content="BUILD GATE FAILED
Plan: ${PHASE}-${PLAN}
Command: ${BUILD_CMD}
Exit code: ${BUILD_EXIT_CODE}

stderr (truncated):
${BUILD_STDERR}

Options:
1. fix - I'll attempt to fix the build issue
2. skip - Proceed without build validation (note in SUMMARY)
3. stop - Stop execution, investigate manually")
```

**Classic mode:**
```
## Build Gate Failed

**Plan:** ${PHASE}-${PLAN}
**Command:** ${BUILD_CMD}
**Exit code:** ${BUILD_EXIT_CODE}

**Output:**
${BUILD_STDERR}

Options:
- "fix" - Attempt to fix the build issue
- "skip" - Proceed without build validation
- "stop" - Stop execution
```

**Handle user response to failure/timeout:**

| Response | Action |
|----------|--------|
| "fix" | Investigate the build failure (read error output, check source files). Apply fixes. Commit fix: `fix(${PHASE}-${PLAN}): fix build failure - {description}`. Re-run build gate (loop back to `BUILD_RESULT` command). If passes: continue. If fails again: re-present options. |
| "increase-timeout" (timeout only) | Ask user for new timeout value. Note: Cannot change config at runtime. Advise user to update `git.build_timeout` in `.planning/config.json` and re-run. Or offer to skip. |
| "skip" | Set `BUILD_GATE_RESULT="skipped_by_user"`. Continue to summary. The SUMMARY must note: "Build gate skipped by user after failure." |
| "stop" | Stop execution. Report partial progress. Do NOT create SUMMARY.md. Exit. |

**Record build gate result for SUMMARY:**

Set `BUILD_GATE_RESULT` variable for use in create_summary step. Values: "passed", "skipped", "skipped_by_user", "failed", "timeout".
</step>

<step name="generate_user_setup">
```bash
grep -A 50 "^user_setup:" .planning/phases/XX-name/{phase}-{plan}-PLAN.md | head -50
```

If user_setup exists: create `{phase}-USER-SETUP.md` using template `~/.claude/hive/templates/user-setup.md`. Per service: env vars table, account setup checklist, dashboard config, local dev notes, verification commands. Status "Incomplete". Set `USER_SETUP_CREATED=true`. If empty/missing: skip.
</step>

<step name="create_summary">
Create `{phase}-{plan}-SUMMARY.md` at `.planning/phases/XX-name/`. Use `~/.claude/hive/templates/summary.md`.

**Frontmatter:** phase, plan, subsystem, tags | requires/provides/affects | tech-stack.added/patterns | key-files.created/modified | key-decisions | duration ($DURATION), completed ($PLAN_END_TIME date).

Title: `# Phase [X] Plan [Y]: [Name] Summary`

One-liner SUBSTANTIVE: "JWT auth with refresh rotation using jose library" not "Authentication implemented"

Include: duration, start/end times, task count, file count.

**Build Gate section (if BUILD_GATE_RESULT is set):**

After the "Issues Encountered" section, add:

```
## Build Gate

**Result:** ${BUILD_GATE_RESULT}
**Command:** ${BUILD_CMD}

{If "passed": "Build validation passed."}
{If "skipped": "No build command detected or git flow disabled."}
{If "skipped_by_user": "Build gate skipped by user after failure. Build command: ${BUILD_CMD}, Exit code: ${BUILD_EXIT_CODE}"}
{If "failed": "Build failed. See Issues Encountered."}
{If "timeout": "Build timed out. See Issues Encountered."}
```

If BUILD_GATE_RESULT is not set (git flow none, gate disabled): omit the section entirely.

Next: more plans → "Ready for {next-plan}" | last → "Phase complete, ready for transition".
</step>

<step name="update_current_position">
Update STATE.md using hive-tools:

```bash
# Advance plan counter (handles last-plan edge case)
node ~/.claude/hive/bin/hive-tools.js state advance-plan

# Recalculate progress bar from disk state
node ~/.claude/hive/bin/hive-tools.js state update-progress

# Record execution metrics
node ~/.claude/hive/bin/hive-tools.js state record-metric \
  --phase "${PHASE}" --plan "${PLAN}" --duration "${DURATION}" \
  --tasks "${TASK_COUNT}" --files "${FILE_COUNT}"
```
</step>

<step name="extract_decisions_and_issues">
From SUMMARY: Extract decisions and add to STATE.md:

```bash
# Add each decision from SUMMARY key-decisions
node ~/.claude/hive/bin/hive-tools.js state add-decision \
  --phase "${PHASE}" --summary "${DECISION_TEXT}" --rationale "${RATIONALE}"

# Add blockers if any found
node ~/.claude/hive/bin/hive-tools.js state add-blocker "Blocker description"
```
</step>

<step name="update_session_continuity">
Update session info using hive-tools:

```bash
node ~/.claude/hive/bin/hive-tools.js state record-session \
  --stopped-at "Completed ${PHASE}-${PLAN}-PLAN.md" \
  --resume-file "None"
```

Keep STATE.md under 150 lines.
</step>

<step name="issues_review_gate">
If SUMMARY "Issues Encountered" ≠ "None": yolo → log and continue. Interactive → present issues, wait for acknowledgment.
</step>

<step name="update_roadmap">
More plans → update plan count, keep "In progress". Last plan → mark phase "Complete", add date.
</step>

<step name="git_commit_metadata">
Task code already committed per-task. Commit plan metadata:

```bash
node ~/.claude/hive/bin/hive-tools.js commit "docs({phase}-{plan}): complete [plan-name] plan" --files .planning/phases/XX-name/{phase}-{plan}-SUMMARY.md .planning/STATE.md .planning/ROADMAP.md
```
</step>

<step name="update_codebase_map">
If .planning/codebase/ doesn't exist: skip.

```bash
FIRST_TASK=$(git log --oneline --grep="feat({phase}-{plan}):" --grep="fix({phase}-{plan}):" --grep="test({phase}-{plan}):" --reverse | head -1 | cut -d' ' -f1)
git diff --name-only ${FIRST_TASK}^..HEAD 2>/dev/null
```

Update only structural changes: new src/ dir → STRUCTURE.md | deps → STACK.md | file pattern → CONVENTIONS.md | API client → INTEGRATIONS.md | config → STACK.md | renamed → update paths. Skip code-only/bugfix/content changes.

```bash
node ~/.claude/hive/bin/hive-tools.js commit "" --files .planning/codebase/*.md --amend
```
</step>

<step name="offer_next">
If `USER_SETUP_CREATED=true`: display `⚠️ USER SETUP REQUIRED` with path + env/config tasks at TOP.

```bash
ls -1 .planning/phases/[current-phase-dir]/*-PLAN.md 2>/dev/null | wc -l
ls -1 .planning/phases/[current-phase-dir]/*-SUMMARY.md 2>/dev/null | wc -l
```

| Condition | Route | Action |
|-----------|-------|--------|
| summaries < plans | **A: More plans** | Find next PLAN without SUMMARY. Yolo: auto-continue. Interactive: show next plan, suggest `/hive:execute-phase {phase}` + `/hive:verify-work`. STOP here. |
| summaries = plans, current < highest phase | **B: Phase done** | Show completion, suggest `/hive:plan-phase {Z+1}` + `/hive:verify-work {Z}` + `/hive:discuss-phase {Z+1}` |
| summaries = plans, current = highest phase | **C: Milestone done** | Show banner, suggest `/hive:complete-milestone` + `/hive:verify-work` + `/hive:add-phase` |

All routes: `/clear` first for fresh context.
</step>

</process>

<success_criteria>

- All tasks from PLAN.md completed
- All verifications pass
- USER-SETUP.md generated if user_setup in frontmatter
- SUMMARY.md created with substantive content
- STATE.md updated (position, decisions, issues, session)
- ROADMAP.md updated
- If codebase map exists: map updated with execution changes (or skipped if no significant changes)
- If USER-SETUP.md created: prominently surfaced in completion output
</success_criteria>
