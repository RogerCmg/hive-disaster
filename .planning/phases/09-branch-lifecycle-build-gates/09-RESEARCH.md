# Phase 9: Branch Lifecycle & Build Gates - Research

**Researched:** 2026-02-12
**Domain:** Workflow integration of Phase 8 git primitives into branch lifecycle management and build validation gates
**Confidence:** HIGH

## Summary

Phase 9 composes the git subcommands delivered in Phase 8 into two workflow-level behaviors: (1) branch lifecycle management -- dev branch creation during project/milestone init, plan-level branch creation at execution start, and branch cleanup after merge, and (2) build gate orchestration -- running the build command after plan completion and blocking PR creation on failure, with configurable per-gate toggles and timeout enforcement.

All the low-level primitives already exist in hive-tools.js (Phase 8 delivered 11 git subcommands, the `execCommand` spawnSync wrapper, `detectBuildCommand` for 8 project types, and `loadConfig` with full `git_*` fields). Phase 9 does NOT add new subcommands to hive-tools.js. Instead, it modifies 3 workflow markdown files (`new-project.md`, `new-milestone.md`, `execute-plan.md`) and potentially `execute-phase.md` to call the existing subcommands at the right lifecycle points. The init commands (`init new-project`, `init new-milestone`, `init execute-phase`) already return git config fields -- the workflows just need to read them and act.

The implementation is primarily markdown-level workflow logic (meta-prompting), not new JavaScript code. The exception is that `init new-project` and `init new-milestone` should return `git_flow` and `git_dev_branch` so workflows know whether to create a dev branch. Currently `cmdInitNewProject` does not return git config fields -- this is the only hive-tools.js change needed.

**Primary recommendation:** Implement in two plans: Plan 1 covers branch lifecycle (BRANCH-01, BRANCH-02, BRANCH-03) -- modifying new-project, new-milestone, execute-phase, and execute-plan workflows to create/checkout/delete branches at the right points. Plan 2 covers build gate orchestration (BUILD-01, BUILD-04, BUILD-05) -- modifying execute-plan to run the build gate after plan completion and block PR creation on failure, with per-gate config checks and timeout reporting.

## Standard Stack

### Core

No new libraries or dependencies. All changes compose existing Phase 8 primitives.

| Component | Already Exists | Purpose for Phase 9 | Location |
|-----------|---------------|---------------------|----------|
| `cmdGitCreateDevBranch` | Yes (line 5272) | Called by new-project/new-milestone workflows | hive-tools.js |
| `cmdGitCreatePlanBranch` | Yes (line 5294) | Called by execute-phase/execute-plan before plan execution | hive-tools.js |
| `cmdGitDeletePlanBranch` | Yes (line 5469) | Called after successful plan merge to dev | hive-tools.js |
| `cmdGitRunBuildGate` | Yes (line 5321) | Called after plan completion, before PR creation | hive-tools.js |
| `cmdGitCurrentBranch` | Yes (line 5263) | Informational, used for validation | hive-tools.js |
| `loadConfig` git fields | Yes (line 175) | `git_flow`, `git_dev_branch`, `git_build_gates_pre_pr`, `git_build_timeout` | hive-tools.js |
| `execCommand` | Yes (line 373) | spawnSync wrapper used by all git subcommands | hive-tools.js |
| `detectBuildCommand` | Yes (line 391) | 8 project type detection, used by run-build-gate | hive-tools.js |

### Files to Modify

| File | Change Required | Type |
|------|----------------|------|
| `hive/workflows/new-project.md` | Add dev branch creation step after git init when `git_flow !== 'none'` | Markdown workflow |
| `hive/workflows/new-milestone.md` | Add dev branch creation step when starting milestone with git flow | Markdown workflow |
| `hive/workflows/execute-plan.md` | Add build gate step after plan completion, before PR creation placeholder | Markdown workflow |
| `hive/workflows/execute-phase.md` | Add plan branch creation before each plan execution, branch cleanup after merge | Markdown workflow |
| `hive/bin/hive-tools.js` | Extend `cmdInitNewProject` and `cmdInitNewMilestone` to return git config fields | JavaScript |
| `.claude/hive/bin/hive-tools.js` | Sync installed copy | JavaScript |

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| Modifying workflow markdown files | Adding a new workflow "git-lifecycle.md" | Branching is a cross-cutting concern that fits naturally into existing workflows; a separate file would require extra orchestration hops |
| Branch creation in execute-plan | Branch creation in execute-phase only | execute-phase already has `handle_branching` step; extend it rather than duplicate logic in execute-plan |
| Inline build gate logic in workflow | New hive-tools.js "plan-complete" composite command | Composing existing subcommands in workflow markdown is simpler and more transparent |

## Architecture Patterns

### Recommended Change Structure

```
Changes by requirement:

BRANCH-01 (dev branch on init):
  new-project.md   → Add step after git init
  new-milestone.md  → Add step in setup
  hive-tools.js     → Extend init new-project/new-milestone returns

BRANCH-02 (plan branches from dev):
  execute-phase.md  → Extend handle_branching step
  execute-plan.md   → Validate current branch at start

BRANCH-03 (branch cleanup after merge):
  execute-plan.md   → Add cleanup step (placeholder for Phase 10 merge)
  execute-phase.md  → Add cleanup in wave completion

BUILD-01 (pre-PR build gate):
  execute-plan.md   → Add build gate step after plan completion

BUILD-04 (gates configurable):
  execute-plan.md   → Check git_build_gates_pre_pr config before running

BUILD-05 (build timeout):
  Already handled → cmdGitRunBuildGate already does timeout conversion
  execute-plan.md   → Report timeout condition to user
```

### Pattern 1: Dev Branch Creation on Init (BRANCH-01)

**What:** When `git.flow` is not `"none"`, create and checkout the dev branch during project initialization or milestone start.

**When to use:** In `new-project.md` (after git init) and `new-milestone.md` (during setup).

**Workflow integration point in new-project.md (after Step 1 git init):**

```markdown
## 1.5. Git Flow Setup

**If git flow is enabled (git_flow !== 'none'):**

Create dev branch:
```bash
DEV_RESULT=$(node ./.claude/hive/bin/hive-tools.js git create-dev-branch --raw)
```

Parse JSON result. If `created: true`, the dev branch was created and checked out.
If `created: false, reason: 'already_exists'`, checkout dev:
```bash
git checkout $(echo "$INIT" | jq -r '.git_dev_branch // "dev"')
```

Display:
```
Git flow enabled. Created and checked out branch: dev
```
```

**Key details:**
- `cmdInitNewProject` must be extended to return `git_flow` and `git_dev_branch` in its result JSON
- `cmdInitNewMilestone` must similarly be extended
- The `create-dev-branch` subcommand already handles the "already exists" case gracefully
- No error if git is not initialized yet (new-project.md runs `git init` before this step)

### Pattern 2: Plan Branch Creation Before Execution (BRANCH-02)

**What:** When a plan starts execution, create a branch named `hive/phase-{N}-{plan}-{slug}` from the dev branch and check it out.

**When to use:** In `execute-phase.md` (handle_branching step) before spawning executor agents.

**Branch naming convention:**

```
hive/phase-{phase_number}-{plan_number}-{plan_slug}

Examples:
  hive/phase-09-01-branch-lifecycle
  hive/phase-09-02-build-gates
  hive/phase-10-01-pr-creation
```

The `phase_number` comes from init, `plan_number` is the plan's sequential number (e.g., "01"), and `plan_slug` is derived from the plan name using `generate-slug`.

**Workflow integration in execute-phase.md (handle_branching step):**

```markdown
<step name="handle_branching">
Check git config from init:

**"none" flow OR branching_strategy "none":** Skip, continue on current branch.

**git_flow is "github":**

For each plan in the current wave, BEFORE spawning the executor:

```bash
PLAN_SLUG=$(node ./.claude/hive/bin/hive-tools.js generate-slug "${PLAN_NAME}" --raw)
BRANCH_NAME="hive/phase-${PHASE_NUMBER}-${PLAN_NUMBER}-${PLAN_SLUG}"
BRANCH_RESULT=$(node ./.claude/hive/bin/hive-tools.js git create-plan-branch --name "${BRANCH_NAME}" --raw)
```

Parse result. If `success: false` with "dev branch does not exist" error, run `git create-dev-branch` first, then retry.

Pass `BRANCH_NAME` to the executor agent prompt so it knows which branch it is on.
</step>
```

**Key details:**
- Each plan in a wave gets its own branch
- In single-terminal (sequential) mode, only one plan branch exists at a time
- The executor agent operates on this branch; all task commits go to it
- `create-plan-branch` already validates that dev exists and creates from dev
- If parallel execution is enabled, multiple branches may exist simultaneously

### Pattern 3: Branch Cleanup After Merge (BRANCH-03)

**What:** After a plan branch is successfully merged to dev (via PR in Phase 10), delete the local plan branch.

**When to use:** After plan completion and successful merge. In Phase 9, we set up the cleanup hook; the actual merge-then-delete flow completes in Phase 10.

**Workflow integration point:**

```markdown
<step name="plan_branch_cleanup">
After plan completion (and future merge in Phase 10):

```bash
CLEANUP_RESULT=$(node ./.claude/hive/bin/hive-tools.js git delete-plan-branch "${BRANCH_NAME}" --raw)
```

Parse result:
- `success: true, deleted: true` -> Branch cleaned up
- `success: false, error: "not fully merged"` -> Branch has unmerged changes. Log warning, do not force-delete.
- `success: false, error: "Cannot delete protected branch"` -> Safety check caught an error in branch naming. Log error.

**Important:** In Phase 9, the cleanup step is defined but only triggered after merge. Since Phase 10 handles PR creation and merge, this step may not fire until Phase 10 is complete. In Phase 9, ensure the cleanup logic exists; in Phase 10, wire it to the post-merge flow.
</step>
```

**Key details:**
- Uses safe `-d` delete (requires branch to be fully merged)
- Protected branch check prevents accidental deletion of main/master/dev
- Cleanup is best-effort: failure to delete a branch does not block execution
- In single-terminal mode, cleanup happens immediately after self-merge (Phase 10)
- In multi-terminal mode (future), cleanup happens after repo manager confirms merge

### Pattern 4: Build Gate After Plan Completion (BUILD-01)

**What:** After all tasks in a plan are completed and committed, run the build command. If it fails, block PR creation and inform the user.

**When to use:** In `execute-plan.md`, after the last task commit but before any PR creation step.

**Workflow integration in execute-plan.md (new step between task_commit and create_summary):**

```markdown
<step name="build_gate" condition="git_flow !== 'none'">
After all tasks completed and committed, run build validation:

**Check if gate is enabled:**
```bash
# From config loaded at init
PRE_PR_GATE=$(echo "$CONFIG_CONTENT" | jq -r '.git.build_gates.pre_pr // true')
```

If pre_pr gate is disabled (`false`): skip build, continue to summary.

**Run build gate:**
```bash
BUILD_RESULT=$(node ./.claude/hive/bin/hive-tools.js git run-build-gate --raw)
```

Parse JSON result:

| Result | Action |
|--------|--------|
| `success: true` | Build passed. Continue to summary and PR creation. |
| `success: true, skipped: true` | No build command detected or flow is none. Continue. |
| `success: false, timedOut: true` | Build hung beyond timeout. Report: "Build timed out after {timeout}s. Killed." Block PR creation. |
| `success: false, timedOut: false` | Build failed. Report: "Build failed (exit code {exitCode})." Show truncated stderr. Block PR creation. |

**On build failure:**

**Team mode:**
```
SendMessage(type="message", recipient="team-lead",
  summary="Build gate failed: {plan_id}",
  content="BUILD GATE FAILED
Plan: {plan_id}
Command: {command}
Exit code: {exitCode}
Timed out: {timedOut}

stderr (truncated):
{stderr}

Options:
1. fix - I'll attempt to fix the build issue
2. skip - Proceed without build validation (PR will be created anyway)
3. stop - Stop execution, investigate manually")
```

**Classic mode:**
```
## Build Gate Failed

**Plan:** {plan_id}
**Command:** {command}
**Exit code:** {exitCode}
**Timed out:** {timedOut}

**Output:**
{stderr, truncated at 2000 chars}

Options:
- "fix" — Attempt to fix the build issue
- "skip" — Proceed without build validation
- "stop" — Stop execution
```

If user chooses "fix": investigate build failure, apply fixes, re-run build gate.
If user chooses "skip": continue to summary/PR but note in SUMMARY "Build gate skipped by user."
If user chooses "stop": stop execution, report partial progress.
</step>
```

**Key details:**
- `cmdGitRunBuildGate` already handles: config override, auto-detection, timeout conversion (seconds * 1000), stdout/stderr truncation at 2000 chars
- The build timeout default is 300s (5 minutes), configurable via `git.build_timeout`
- If `timedOut` is true, the process was killed via SIGTERM by spawnSync
- Build gates are always on by default (BUILD-04) -- the check only runs the gate if the config flag is not explicitly set to `false`

### Pattern 5: Per-Gate Configuration (BUILD-04)

**What:** Each build gate (pre-PR, pre-merge, pre-main) can be individually disabled in config. They are all on by default.

**Already implemented in Phase 8:**
- `config.json` template has `"build_gates": { "pre_pr": true, "pre_merge": true, "pre_main": true }`
- `loadConfig` returns `git_build_gates_pre_pr`, `git_build_gates_pre_merge`, `git_build_gates_pre_main`
- Default values are all `true`

**Phase 9 only needs to check `git_build_gates_pre_pr`:**

```javascript
// In workflow logic (parsed from config)
const preprGateEnabled = config.git_build_gates_pre_pr; // defaults to true
if (!preprGateEnabled) {
  // Skip build gate, proceed to PR creation
}
```

The pre-merge (Gate 2) and pre-main (Gate 3) gates are Phase 11 concerns, not Phase 9.

### Pattern 6: Build Timeout Reporting (BUILD-05)

**What:** A build that hangs beyond the configured timeout is killed and reported as a failure.

**Already implemented in Phase 8:**
- `cmdGitRunBuildGate` does `const timeoutMs = (config.git_build_timeout || 300) * 1000`
- `execCommand` returns `timedOut: true` when spawnSync's ETIMEDOUT fires
- Default is 300 seconds (5 minutes)

**Phase 9 adds user-facing reporting:**

```markdown
## Build Timed Out

**Plan:** {plan_id}
**Command:** {command}
**Timeout:** {timeout}s (configured in git.build_timeout)

The build process was killed after exceeding the configured timeout.

Possible causes:
- Build command is interactive (requires user input)
- Build command has an infinite loop or deadlock
- Timeout is too short for this project's build

Options:
- "fix" — Investigate and fix the build issue
- "increase-timeout" — Set a higher timeout (current: {timeout}s)
- "skip" — Proceed without build validation
- "stop" — Stop execution
```

### Anti-Patterns to Avoid

- **Creating plan branches inside execute-plan instead of execute-phase:** The execute-phase workflow orchestrates plan execution and has the wave context. Branch creation should happen there so that branch names are consistent and cleanup can be managed at the wave level. Execute-plan should validate it is on the expected branch but not create it.
- **Running build gate before task commits:** The build must run AFTER all tasks are committed so it tests the actual plan output, not a mid-execution state.
- **Force-deleting branches (-D) on cleanup:** Always use safe delete (-d) which requires the branch to be merged. This prevents accidental data loss. The existing `cmdGitDeletePlanBranch` already enforces this.
- **Checking out dev branch during plan execution:** Each plan executes on its own branch. Switching to dev mid-execution would lose uncommitted work. Only switch branches between plans, not during a plan.
- **Ignoring the "skipped" result from build gate:** When `run-build-gate` returns `skipped: true` (no build command or flow is none), treat it as a pass, not an error.
- **Hardcoding branch names:** Always use `generate-slug` for the slug portion and compose the branch name from config + phase info. Never hardcode "dev" -- use `config.git_dev_branch`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Branch creation | Inline `git checkout -b` in workflow | `hive-tools.js git create-dev-branch` / `create-plan-branch` | Structured JSON output, error handling, flow bypass, already tested |
| Build command detection | Inline `package.json` parsing in workflow | `hive-tools.js git run-build-gate` | Handles 8 project types, config override, timeout, already tested |
| Branch cleanup | Inline `git branch -d` in workflow | `hive-tools.js git delete-plan-branch` | Protected branch safety, structured error handling, already tested |
| Branch name generation | Manual string concatenation | `generate-slug` + template from config | Consistent slug generation, URL-safe characters |
| Git flow check | Manual config file reading | `init execute-phase` returns `git_flow` | Centralized config handling, defaults applied |

**Key insight:** Phase 9 is primarily a COMPOSITION phase -- it wires existing primitives into workflow orchestration. The temptation to add new JavaScript code should be resisted; almost everything needed already exists.

## Common Pitfalls

### Pitfall 1: Init Commands Missing Git Config Fields

**What goes wrong:** Workflow reads `git_flow` from init JSON but the init command does not include it.
**Why it happens:** `cmdInitNewProject` and `cmdInitNewMilestone` were written before Phase 8 added git fields to `loadConfig`. They return researcher/roadmapper models and file existence flags but not git config.
**How to avoid:** Extend both init commands to include `git_flow`, `git_dev_branch`, and `git_build_gates_pre_pr` in their return JSON. The config is already loaded via `loadConfig(cwd)` in both functions.
**Warning signs:** Workflow tries to read `git_flow` from init JSON and gets `undefined`, causing the git flow setup step to be silently skipped.

### Pitfall 2: Branch Creation Fails Because Dev Does Not Exist

**What goes wrong:** `create-plan-branch` fails with "dev branch does not exist" because the project was initialized before Phase 9 (no dev branch was created).
**Why it happens:** Existing projects initialized with older Hive versions have no dev branch.
**How to avoid:** Before creating a plan branch, check if dev exists. If not, create it first. The `create-plan-branch` subcommand already returns a clear error message about this, but the workflow should handle it proactively.
**Warning signs:** Plan execution fails on the first plan of any existing project upgraded to git flow.

### Pitfall 3: Build Gate Runs on Wrong Branch

**What goes wrong:** Build gate runs while still on the dev branch instead of the plan branch, testing the wrong code.
**Why it happens:** Branch checkout step was skipped or failed silently.
**How to avoid:** Before running the build gate, validate the current branch matches the expected plan branch using `git current-branch`. If mismatch, abort with a clear error.
**Warning signs:** Build gate passes but PR changes show incorrect files.

### Pitfall 4: Executor Agent Creates Branch Instead of Workflow

**What goes wrong:** Both `execute-phase.md` (orchestrator) and `execute-plan.md` (executor) try to create the plan branch, resulting in "already exists" or branch naming conflicts.
**Why it happens:** Unclear ownership of branch creation responsibility.
**How to avoid:** **execute-phase.md creates the branch and passes the branch name to the executor.** execute-plan.md receives the branch name and validates it but never creates branches. This is consistent with the existing pattern where execute-phase orchestrates and execute-plan executes.
**Warning signs:** Duplicate branch creation attempts in git log.

### Pitfall 5: Build Failure on Projects Without Tests

**What goes wrong:** Build gate fails on projects that have never configured a test command, causing execution to halt.
**Why it happens:** `detectBuildCommand` returns `{ detected: false }` and `run-build-gate` returns `skipped: true` -- but only if there is no config override. If the user set `git.build_command` to something that does not exist, the build always fails.
**How to avoid:** When `run-build-gate` returns `skipped: true`, treat it as a pass and continue. When it returns a failure, provide clear guidance about configuring the build command. The npm default placeholder detection (from Phase 8) already prevents the most common false positive.
**Warning signs:** New projects blocking on build gate with no test framework installed.

### Pitfall 6: Installed Copy Desync After Workflow Changes

**What goes wrong:** Modifying workflow files under `hive/workflows/` but forgetting that the installed copy is under `.claude/hive/workflows/`.
**Why it happens:** The dual-file architecture affects workflows too, not just hive-tools.js.
**How to avoid:** After modifying any workflow file, sync the installed copy. Verify with `diff hive/workflows/file.md .claude/hive/workflows/file.md`.
**Warning signs:** Running `/hive:execute-phase` uses old workflow without git flow steps.

### Pitfall 7: Branch Name Collisions on Re-execution

**What goes wrong:** Re-running a failed plan tries to create a branch that already exists from the previous attempt.
**Why it happens:** The branch was created but the plan failed mid-execution. The branch was not cleaned up because it was not merged.
**How to avoid:** Before creating a plan branch, check if it already exists. If it does, checkout that branch instead of trying to create a new one. The `create-plan-branch` subcommand returns an error for existing branches -- the workflow should handle this by falling back to a simple checkout.
**Warning signs:** "Branch already exists" error on plan re-execution.

## Code Examples

### Example 1: Dev Branch Creation in new-project.md

```markdown
## 1.5. Git Flow Setup

Check git flow from init context:
```bash
GIT_FLOW=$(echo "$INIT" | jq -r '.git_flow // "none"')
GIT_DEV_BRANCH=$(echo "$INIT" | jq -r '.git_dev_branch // "dev"')
```

**If GIT_FLOW is not "none":**

```bash
DEV_RESULT=$(node ./.claude/hive/bin/hive-tools.js git create-dev-branch --raw)
```

Parse result:
- `created: true` -> Display: "Git flow enabled. Created branch: {dev_branch}"
- `created: false, reason: 'already_exists'` -> Checkout dev: `git checkout ${GIT_DEV_BRANCH}`
- `skipped: true` -> Display: "Git flow disabled. Continuing on current branch."

**If GIT_FLOW is "none":** Skip. No branch operations.
```

### Example 2: Plan Branch Creation in execute-phase.md

```markdown
<step name="handle_branching">
GIT_FLOW=$(echo "$INIT" | jq -r '.git_flow // "none"')

**If GIT_FLOW is "none" or branching_strategy is "none":** Skip.

**If GIT_FLOW is "github":**

For each plan in the current wave:

```bash
PLAN_SLUG=$(node ./.claude/hive/bin/hive-tools.js generate-slug "${PLAN_NAME}" --raw)
BRANCH_NAME="hive/phase-${PHASE_NUMBER}-${PLAN_NUMBER}-${PLAN_SLUG}"

# Check if branch exists (re-execution case)
EXISTING=$(node ./.claude/hive/bin/hive-tools.js git current-branch --raw)
if [ "$EXISTING" = "$BRANCH_NAME" ]; then
  echo "Already on plan branch: $BRANCH_NAME"
else
  BRANCH_RESULT=$(node ./.claude/hive/bin/hive-tools.js git create-plan-branch --name "${BRANCH_NAME}" --raw)
  # Parse result - handle success, dev-missing, and branch-exists cases
fi
```

Pass BRANCH_NAME to executor agent in the spawn prompt.
</step>
```

### Example 3: Build Gate in execute-plan.md

```markdown
<step name="build_gate">
# After all tasks completed and committed

GIT_FLOW=$(echo "$CONFIG_CONTENT" | jq -r '.git.flow // "github"')
PRE_PR_GATE=$(echo "$CONFIG_CONTENT" | jq -r '.git.build_gates.pre_pr // true')

**If GIT_FLOW is "none" or PRE_PR_GATE is false:** Skip build gate.

**Run build:**
```bash
BUILD_RESULT=$(node ./.claude/hive/bin/hive-tools.js git run-build-gate --raw)
BUILD_SUCCESS=$(echo "$BUILD_RESULT" | jq -r '.success')
BUILD_SKIPPED=$(echo "$BUILD_RESULT" | jq -r '.skipped // false')
BUILD_TIMED_OUT=$(echo "$BUILD_RESULT" | jq -r '.timedOut // false')
BUILD_CMD=$(echo "$BUILD_RESULT" | jq -r '.command // "unknown"')
```

**If BUILD_SKIPPED is true:** No build command. Continue.
**If BUILD_SUCCESS is true:** Build passed. Continue to summary.
**If BUILD_TIMED_OUT is true:** Report timeout, block PR.
**If BUILD_SUCCESS is false:** Report failure, block PR. Offer fix/skip/stop.
</step>
```

### Example 4: Init Command Extension (hive-tools.js)

```javascript
// In cmdInitNewProject, add to result object:
function cmdInitNewProject(cwd, raw) {
  const config = loadConfig(cwd);
  // ... existing code ...

  const result = {
    // ... existing fields ...

    // Git flow config (Phase 9 addition)
    git_flow: config.git_flow,
    git_dev_branch: config.git_dev_branch,
  };

  // ... rest of function
}
```

### Example 5: Branch Cleanup in execute-phase.md

```markdown
<step name="wave_branch_cleanup">
After wave completion and successful merge (wired in Phase 10):

For each completed plan in the wave:
```bash
# Switch to dev before deleting plan branch
git checkout ${DEV_BRANCH}

CLEANUP=$(node ./.claude/hive/bin/hive-tools.js git delete-plan-branch "${BRANCH_NAME}" --raw)
CLEANUP_SUCCESS=$(echo "$CLEANUP" | jq -r '.success')
```

If cleanup fails: log warning but do not block. Stale branches are informational, not harmful.
</step>
```

## State of the Art

| Current Approach | Phase 9 Approach | Impact |
|-----------------|-----------------|--------|
| No branch isolation; all work on current branch | Dev branch created on init; plan branches created per execution | Each plan isolated; merge conflicts only at merge time |
| No build validation; code goes directly to next step | Build gate runs after plan completion; failures block progression | Broken code never flows past the plan boundary |
| `branching_strategy` config (none/phase/milestone) in loadConfig | `git.flow: "github"` plus plan-level branches with Phase 8 subcommands | Git flow replaces old branching_strategy for v2.0 projects |
| `execute-phase.md` handle_branching uses manual `git checkout -b` | `execute-phase.md` uses `hive-tools.js git create-plan-branch` | Structured JSON output, error handling, dev branch validation |
| No build timeout | `spawnSync` timeout with ETIMEDOUT detection, default 300s | Hung builds killed and reported instead of blocking forever |

**Compatibility note:** The existing `branching_strategy: "none" | "phase" | "milestone"` config field continues to work. The new `git.flow: "github"` is an independent config path. When `git.flow` is `"github"`, the plan-level branching from Phase 9 takes precedence over the old `branching_strategy`. When `git.flow` is `"none"`, all git workflow features are bypassed (same as today). The `execute-phase.md` handle_branching step should check `git_flow` first, then fall back to `branching_strategy` for backward compatibility.

## Open Questions

1. **Should execute-phase.md or execute-plan.md own branch creation?**
   - What we know: execute-phase.md has the wave context and orchestrates plan spawning. execute-plan.md runs inside the executor agent.
   - What's unclear: Whether branch creation is an orchestrator or executor responsibility.
   - Recommendation: **execute-phase.md creates the branch before spawning the executor.** The executor receives the branch name in its prompt. This keeps branch management at the orchestration level and avoids executor agents needing to understand wave context. If the executor agent were to create the branch, it would need to know the dev branch name and handle the "dev doesn't exist" case -- that complexity belongs in the orchestrator.

2. **How should branch name collisions be handled on re-execution?**
   - What we know: If a plan fails and is re-executed, the branch from the previous attempt may still exist.
   - What's unclear: Whether to delete and recreate, or checkout the existing branch.
   - Recommendation: **Check if branch exists first. If yes, checkout it.** This preserves any commits from the previous attempt. The executor picks up where it left off (existing resumption pattern -- SUMMARY.md on disk means plan completed). If no SUMMARY, the plan re-executes on the existing branch with its previous commits still present.

3. **Should build gate results be stored anywhere persistent?**
   - What we know: Currently, build gate results are consumed inline by the workflow and reported in SUMMARY.md as a deviation or issue.
   - What's unclear: Whether we need a structured build history file.
   - Recommendation: **No separate file for Phase 9.** Build results are reported in the plan SUMMARY.md under "Issues Encountered" or "Build Gate" section. If telemetry is enabled, emit a `build_gate` telemetry event. A separate build history file is unnecessary complexity for single-terminal mode.

4. **What happens if git flow is enabled but the project has no GitHub remote?**
   - What we know: `create-dev-branch`, `create-plan-branch`, `run-build-gate` all work locally without a remote. PR creation (`create-pr`) requires `gh` CLI and a remote.
   - What's unclear: Should Phase 9 validate remote availability?
   - Recommendation: **No. Phase 9 does not create PRs.** PR creation is Phase 10. Phase 9 only needs local git operations (branch, build, delete). Remote/PR validation belongs in Phase 10.

## Sources

### Primary (HIGH confidence)

All findings based on direct source code reading of the existing codebase:

- `hive/bin/hive-tools.js` (5960 lines): All Phase 8 git subcommands and primitives
  - Lines 5272-5495: All 9 git subcommand handlers (create-dev-branch, create-plan-branch, run-build-gate, etc.)
  - Lines 373-389: `execCommand` spawnSync wrapper
  - Lines 391-448: `detectBuildCommand` for 8 project types
  - Lines 175-245: `loadConfig` with full git_* field extraction
  - Lines 4261-4316: `cmdInitNewProject` (needs git field extension)
  - Lines 4318-4344: `cmdInitNewMilestone` (needs git field extension)
  - Lines 4091-4162: `cmdInitExecutePhase` (already returns branching_strategy, branch_name)
- `hive/templates/config.json`: Config template with git section (flow, build_gates, build_command, etc.)
- `hive/workflows/execute-phase.md`: Current handle_branching step at line ~36-48
- `hive/workflows/execute-plan.md`: Current plan execution flow (no build gate step yet)
- `hive/workflows/new-project.md`: Current init flow (no dev branch creation yet)
- `hive/workflows/new-milestone.md`: Current milestone start flow (no dev branch creation)
- `.planning/REQUIREMENTS.md`: BRANCH-01/02/03, BUILD-01/04/05 requirements
- `.planning/research/GIT-WORKFLOW-RECOMMENDATIONS.md`: Full git workflow design including branching model and build gate strategy
- `.planning/phases/08-safety-configuration/08-VERIFICATION.md`: Phase 8 verification confirming all 20 must-haves delivered
- `.planning/phases/08-safety-configuration/08-02-SUMMARY.md`: Phase 8 Plan 2 completion confirming all subcommands ready

### Secondary (MEDIUM confidence)

- `.planning/STATE.md`: Prior decisions list confirming: build gates on by default, merge commit --no-ff, mkdir locks, spawnSync, protected branch includes dev_branch
- Node.js `child_process.spawnSync` timeout behavior: ETIMEDOUT signal confirmed in Phase 8 implementation

### Tertiary (LOW confidence)

None. All findings verified with primary sources (direct code reading).

## Metadata

**Confidence breakdown:**
- Branch lifecycle patterns: HIGH - All subcommands exist and are tested; workflow integration is markdown-level changes
- Build gate orchestration: HIGH - `cmdGitRunBuildGate` already handles timeout, detection, config override; workflow just needs to call it
- Init command extension: HIGH - Both init functions already load config; adding 2 fields is trivial
- Workflow integration points: HIGH - execute-phase.md already has handle_branching step; execute-plan.md needs a new step but the pattern is established
- Pitfalls: HIGH - All identified from direct code reading and gap analysis between Phase 8 outputs and Phase 9 requirements

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (internal codebase patterns, unlikely to change)
