# Architecture Research: Git Workflow Integration for Hive

**Domain:** AI-agent orchestration system -- adding professional git workflow to existing markdown meta-prompting framework
**Researched:** 2026-02-12
**Confidence:** HIGH (based on thorough analysis of existing codebase + prior git-workflow research)

## System Overview: Before and After

### Current Architecture (v1.x)

```
User
  |
  v
Commands (commands/hive/*.md)        -- 29 thin dispatchers
  |
  v
Workflows (workflows/*.md)           -- 30 orchestration files
  |                                     (execute-phase, execute-plan, etc.)
  |--- hive-tools.js init --------->  hive-tools.js (162K monolith)
  |                                     - init commands (context loading)
  |                                     - state commands (STATE.md ops)
  |                                     - commit command (git add + commit)
  |                                     - roadmap/phase/milestone commands
  |                                     - verify/validate commands
  |                                     - telemetry commands
  |
  v
Agents (agents/hive-*.md)            -- 11 specialized workers
  |                                     (executor, planner, verifier, etc.)
  |
  v
.planning/ (file-based state)        -- All communication via disk
  |-- STATE.md                        -- Current position, decisions
  |-- ROADMAP.md                      -- Phase structure
  |-- config.json                     -- User preferences
  |-- phases/XX-name/                 -- Plan + Summary files
  +-- telemetry/                      -- Events, insights
```

### Target Architecture (v2.0 Git Workflow)

```
User
  |
  v
Commands (commands/hive/*.md)        -- 29 existing + 2 NEW
  |                                     NEW: start-worker.md, manage-repo.md
  |
  v
Workflows (workflows/*.md)           -- 30 existing (5 MODIFIED) + 0 new
  |                                     MOD: execute-phase, execute-plan,
  |                                          settings, complete-milestone,
  |                                          new-project
  |--- hive-tools.js --------->  hive-tools.js (extended)
  |                                     EXISTING commands unchanged
  |                                     NEW git subcommand group:
  |                                       git create-dev-branch
  |                                       git create-plan-branch
  |                                       git delete-plan-branch
  |                                       git detect-build-cmd
  |                                       git run-build-gate
  |                                       git create-pr
  |                                       git self-merge-pr
  |                                       git merge-dev-to-main
  |                                     NEW init subcommands:
  |                                       init start-worker
  |                                       init manage-repo
  |
  v
Agents (agents/hive-*.md)            -- 11 existing + 1 NEW
  |                                     NEW: hive-repo-manager.md
  |
  v
.planning/ (file-based state)        -- Existing + NEW git state
  |-- config.json                     -- EXTENDED with git section
  |-- (everything else unchanged)
  |
.hive-workers/ (NEW, multi-terminal) -- Only when multi_terminal: true
  |-- registry.json                   -- Active worker tracking
  |-- merge-queue.json                -- Ordered merge requests
  +-- signals/                        -- File-based worker signaling
```

## Component Responsibilities

### Existing Components (Unchanged)

| Component | Responsibility | Git Workflow Impact |
|-----------|---------------|---------------------|
| Commands (commands/hive/*.md) | Thin dispatchers that route to workflows | No changes to existing. 2 new commands added. |
| Agents (11 existing) | Specialized workers spawned with fresh context | No changes. Executors already commit per-task. |
| .planning/ state files | Project state, roadmap, plans, summaries | No changes. Git workflow is orthogonal to planning state. |
| hive-tools.js `init` commands | Pre-load context for workflows as JSON | `init execute-phase` EXTENDED to include git config. |
| hive-tools.js `commit` command | `git add` + `git commit` with message | No changes. Per-task commits continue exactly as-is. |
| hive-tools.js `state` commands | Read/write STATE.md | No changes. |

### Existing Components (Modified)

| Component | Current | Modification | Why |
|-----------|---------|-------------|-----|
| `execute-phase.md` | Creates phase branch, spawns per-wave agents | Add plan branch creation/deletion per wave. Add PR creation after plan completion. Add wave-gating on merge. | Plan-level branching replaces phase-level for `"github"` strategy. |
| `execute-plan.md` | Executes tasks, creates SUMMARY, commits metadata | Add build gate before creating PR. Add PR submission step. | Build validation gate between plan completion and PR. |
| `settings.md` | 5 settings (model, research, plan_check, verifier, branching) | Add git flow options. Expand branching to include "github" mode. Add build gate toggles. | Users need to configure git workflow features. |
| `complete-milestone.md` | Git tag, branch merge (phase/milestone strategy) | Add dev-to-main merge flow for "github" strategy. | `dev` branch needs to merge to `main` at milestone boundary. |
| `new-project.md` | Git init, creates .planning/ | Add dev branch creation when `branching_strategy: "github"`. | Dev branch created once at project init. |
| `config.json` template | No git section | Add `git` section with flow, build_gates, multi_terminal, plan_branches, auto_pr. | Config schema drives all new behavior. |
| `git-integration.md` reference | Commit formats, branching basics | Add PR workflow, build gates, plan branch lifecycle. | Reference doc agents read during execution. |
| `hive-tools.js loadConfig` | Reads branching_strategy, templates from git section | Add git.flow, git.build_gates, git.multi_terminal, git.build_command, git.auto_pr, git.dev_branch. | Config loading needs to surface new fields. |
| `hive-tools.js cmdInitExecutePhase` | Returns branching_strategy, branch_name | Add git_flow, build_gates, dev_branch, plan_branch_template, auto_pr, multi_terminal to init JSON. | execute-phase workflow needs git config at init time. |

### New Components

| Component | Responsibility | Created By | Communicates With |
|-----------|---------------|------------|-------------------|
| `hive-tools.js git` subcommands | All git operations: branch create/delete, build detection, build gate, PR create/merge, dev-to-main merge | Phase 1 (foundation) | Called by workflows (execute-phase, execute-plan, complete-milestone) |
| `agents/hive-repo-manager.md` | Agent definition for merge queue management, PR review, conflict detection, worker signaling | Phase 2 (repo manager) | merge-queue.json, registry.json, signals/ |
| `commands/hive/start-worker.md` | Thin dispatcher for starting a worker terminal | Phase 3 (multi-terminal) | Routes to worker init workflow |
| `commands/hive/manage-repo.md` | Thin dispatcher for starting repo manager terminal | Phase 2 (repo manager) | Routes to repo manager workflow |
| `.hive-workers/` directory | Worker coordination state (registry, merge queue, signals) | Phase 2 (repo manager) | Read/written by hive-tools.js, repo manager agent |

## Integration Design: hive-tools.js New Commands

### New `git` Subcommand Group

Following the existing pattern (e.g., `state`, `verify`, `phase`, `milestone` subcommand groups):

```
hive-tools.js git <subcommand> [args]
```

| Subcommand | Purpose | Input | Output (JSON) |
|------------|---------|-------|---------------|
| `create-dev-branch` | Create `dev` branch from current HEAD | None (reads config for branch name) | `{ created: bool, branch: string, from: string }` |
| `create-plan-branch --phase X --plan Y` | Create plan branch from dev | Phase num, plan num | `{ created: bool, branch: string, from: "dev" }` |
| `delete-plan-branch --branch NAME` | Delete merged plan branch | Branch name | `{ deleted: bool, branch: string }` |
| `detect-build-cmd` | Auto-detect project build command | None (reads package.json, Cargo.toml, etc.) | `{ command: string, source: string, confidence: string }` |
| `run-build-gate --gate pre_pr\|pre_merge\|pre_main` | Execute build validation | Gate type | `{ passed: bool, gate: string, command: string, output: string, duration_ms: number }` |
| `create-pr --branch NAME --base dev --title TITLE` | Create PR via `gh pr create` | Branch, base, title | `{ created: bool, pr_number: number, url: string }` |
| `self-merge-pr --pr NUMBER` | Merge PR (single-terminal mode) | PR number | `{ merged: bool, pr_number: number, merge_sha: string }` |
| `merge-dev-to-main` | Merge dev branch to main | None | `{ merged: bool, from: "dev", to: "main", sha: string }` |
| `check-conflicts --branch NAME --base dev` | Check for merge conflicts | Branch, base | `{ clean: bool, conflicts: [string] }` |
| `current-branch` | Get current git branch | None | `{ branch: string }` |

### Implementation Pattern

Each new command follows the existing pattern in hive-tools.js:

```javascript
// 1. Function definition (follows existing naming: cmdGitCreateDevBranch)
function cmdGitCreateDevBranch(cwd, raw) {
  const config = loadConfig(cwd);
  const devBranch = config.git_dev_branch || 'dev';

  // Check if branch already exists
  const exists = execGit(cwd, ['rev-parse', '--verify', devBranch]);
  if (exists.exitCode === 0) {
    output({ created: false, branch: devBranch, reason: 'already_exists' }, raw, devBranch);
    return;
  }

  // Create from current HEAD
  const result = execGit(cwd, ['checkout', '-b', devBranch]);
  if (result.exitCode !== 0) {
    error('Failed to create dev branch: ' + result.stderr);
  }

  output({ created: true, branch: devBranch, from: 'HEAD' }, raw, devBranch);
}

// 2. Route in main() switch (follows existing pattern)
case 'git': {
  const subcommand = args[1];
  if (subcommand === 'create-dev-branch') {
    cmdGitCreateDevBranch(cwd, raw);
  } else if (subcommand === 'create-plan-branch') {
    // ...
  }
  // ...
  break;
}
```

### Extending `loadConfig`

The existing `loadConfig` reads `git.branching_strategy`. New fields extend the same section:

```javascript
// In loadConfig(), add to the return object:
return {
  // ...existing fields...
  branching_strategy: get('branching_strategy', { section: 'git', field: 'branching_strategy' }) ?? defaults.branching_strategy,
  // NEW fields:
  git_flow: get('git_flow', { section: 'git', field: 'flow' }) ?? 'none',
  git_dev_branch: get('git_dev_branch', { section: 'git', field: 'dev_branch' }) ?? 'dev',
  git_plan_branches: get('git_plan_branches', { section: 'git', field: 'plan_branches' }) ?? false,
  git_auto_pr: get('git_auto_pr', { section: 'git', field: 'auto_pr' }) ?? false,
  git_build_before_merge: get('git_build_before_merge', { section: 'git', field: 'build_before_merge' }) ?? false,
  git_build_command: get('git_build_command', { section: 'git', field: 'build_command' }) ?? null,
  git_build_gates: get('git_build_gates', { section: 'git', field: 'build_gates' }) ?? { pre_pr: false, pre_merge: false, pre_main: false },
  git_multi_terminal: get('git_multi_terminal', { section: 'git', field: 'multi_terminal' }) ?? false,
};
```

### Extending `cmdInitExecutePhase`

The init command already returns `branching_strategy` and `branch_name`. For git workflow, extend the result:

```javascript
// In cmdInitExecutePhase(), add to result object:
result.git_flow = config.git_flow;
result.git_dev_branch = config.git_dev_branch;
result.git_plan_branches = config.git_plan_branches;
result.git_auto_pr = config.git_auto_pr;
result.git_build_gates = config.git_build_gates;
result.git_build_command = config.git_build_command;
result.git_multi_terminal = config.git_multi_terminal;

// Pre-compute plan branch template
result.plan_branch_template = 'hive/phase-{phase}-{plan}-{slug}';
```

## Data Flow: Plan Execution with Git Workflow

### Single-Terminal Flow (Primary Target)

```
/hive:execute-phase 3
       |
       v
  [execute-phase.md]
       |
       |-- hive-tools.js init execute-phase 3
       |     Returns: git_flow, git_plan_branches, git_build_gates, etc.
       |
       |-- IF git_flow == "github":
       |     Check dev branch exists (git rev-parse --verify dev)
       |     If not: hive-tools.js git create-dev-branch
       |
       |-- FOR each wave:
       |     |
       |     |-- FOR each plan in wave:
       |     |     |
       |     |     |-- IF git_plan_branches:
       |     |     |     hive-tools.js git create-plan-branch --phase 3 --plan 1
       |     |     |     (creates hive/phase-03-01-auth-setup from dev)
       |     |     |
       |     |     |-- Spawn executor agent (existing flow, unchanged)
       |     |     |     Executor commits tasks per-task (existing behavior)
       |     |     |     Executor creates SUMMARY.md (existing behavior)
       |     |     |
       |     |     |-- [execute-plan.md] NEW steps at end:
       |     |     |     |
       |     |     |     |-- IF git_build_gates.pre_pr:
       |     |     |     |     hive-tools.js git run-build-gate --gate pre_pr
       |     |     |     |     IF failed: retry/fix loop (executor investigates)
       |     |     |     |
       |     |     |     |-- IF git_auto_pr:
       |     |     |     |     hive-tools.js git create-pr --branch $PLAN_BRANCH --base dev
       |     |     |     |     hive-tools.js git self-merge-pr --pr $PR_NUMBER
       |     |     |     |
       |     |     |     +-- hive-tools.js git delete-plan-branch --branch $PLAN_BRANCH
       |     |     |
       |     |     +-- Report plan complete (existing behavior)
       |     |
       |     +-- Wave complete: all plan branches merged to dev
       |
       +-- Phase complete: dev has all changes
```

### Key Design Decision: Where Git Operations Live

Git operations are in **hive-tools.js**, NOT in workflows or agents. This follows the existing pattern where:

- **hive-tools.js** handles all git operations (existing `commit`, `execGit`)
- **Workflows** orchestrate by calling hive-tools.js commands
- **Agents** never run git commands directly; they call hive-tools.js

This means executors do NOT need to know about plan branches. The orchestrator (execute-phase) handles branching before/after spawning executors. The executor's job is unchanged: execute tasks, commit per task, create SUMMARY.

## Config Schema Extension

### Current config.json (v1.x)

```json
{
  "mode": "yolo",
  "depth": "standard",
  "workflow": { "research": true, "plan_check": true, "verifier": true },
  "planning": { "commit_docs": true, "search_gitignored": false },
  "parallelization": { "enabled": true, "max_concurrent_agents": 3 },
  "teams": { "execution_team": true },
  "gates": { "confirm_project": true },
  "safety": { "always_confirm_destructive": true }
}
```

### Extended config.json (v2.0)

```json
{
  "...existing sections unchanged...",
  "git": {
    "branching_strategy": "github",
    "flow": "github",
    "dev_branch": "dev",
    "plan_branches": true,
    "auto_pr": true,
    "build_before_merge": true,
    "build_command": null,
    "build_gates": {
      "pre_pr": true,
      "pre_merge": true,
      "pre_main": true,
      "timeout_seconds": 300
    },
    "multi_terminal": false,
    "merge_strategy": "squash"
  }
}
```

### Backward Compatibility

The `branching_strategy` field is the toggle. Current valid values are `"none"`, `"phase"`, `"milestone"`. Adding `"github"` enables the full new workflow. When `branching_strategy` is any of the old values, ALL new git workflow features are disabled. Zero behavior change.

```javascript
// Decision logic in workflows:
const gitFlow = branching_strategy === 'github';

if (gitFlow) {
  // New plan-branch + PR + build-gate flow
} else if (branching_strategy === 'phase' || branching_strategy === 'milestone') {
  // Existing branch behavior (checkout phase/milestone branch)
} else {
  // No branching at all (current default)
}
```

## Workflow Modifications: Detailed Integration Points

### 1. execute-phase.md Modifications

**Current `handle_branching` step:**
```markdown
Check `branching_strategy` from init:
- "none": Skip
- "phase" or "milestone": checkout branch
```

**Modified `handle_branching` step:**
```markdown
Check `branching_strategy` from init:
- "none": Skip
- "phase" or "milestone": checkout branch (unchanged)
- "github": Ensure dev branch exists. Do NOT create a phase branch.
  Plan branches are created per-plan in execute_waves step.
```

**Current `execute_waves` step:** Spawns agents per wave, waits for completion.

**Modified `execute_waves` step (github strategy only):**
```markdown
For each wave:
  For each plan in wave:
    1. Create plan branch: hive-tools.js git create-plan-branch --phase X --plan Y
    2. Checkout plan branch (single-terminal) or create worktree (multi-terminal)
    3. Spawn executor agent (UNCHANGED -- executor commits to current branch)
    4. On plan complete:
       a. Build gate (if enabled): hive-tools.js git run-build-gate --gate pre_pr
       b. Create PR: hive-tools.js git create-pr --branch $BRANCH --base dev
       c. Self-merge (single-terminal): hive-tools.js git self-merge-pr --pr $PR
       d. Delete plan branch: hive-tools.js git delete-plan-branch --branch $BRANCH
       e. Checkout dev for next plan
  End wave: all plans merged to dev
```

**New `wave_gating` addition (after wave complete):**
```markdown
After wave N complete:
  IF git_build_gates.pre_merge:
    Checkout dev, run build gate to validate integration
    If failed: report to user, offer investigation
  Proceed to wave N+1 (branches from updated dev)
```

### 2. execute-plan.md Modifications

**Current final steps:** create_summary -> update_current_position -> git_commit_metadata -> offer_next

**Modified final steps (insert between git_commit_metadata and offer_next):**
```markdown
<step name="build_gate" condition="git_flow == 'github' AND git_build_gates.pre_pr">
  Run build validation before PR creation:

  ```bash
  BUILD_RESULT=$(node ./.claude/hive/bin/hive-tools.js git run-build-gate --gate pre_pr)
  ```

  If failed:
    - Report failure to orchestrator (execute-phase)
    - Orchestrator decides: retry (re-run build), fix (executor investigates), skip
  If passed:
    - Continue to PR creation
</step>

<step name="create_pr" condition="git_flow == 'github' AND git_auto_pr">
  Create PR from plan branch to dev:

  ```bash
  PR_RESULT=$(node ./.claude/hive/bin/hive-tools.js git create-pr \
    --branch "hive/phase-${PHASE}-${PLAN}-${SLUG}" \
    --base dev \
    --title "feat(${PHASE}-${PLAN}): ${PLAN_NAME}")
  ```

  Note: PR creation happens in execute-plan (agent level), but merge
  happens in execute-phase (orchestrator level). This separation ensures
  the orchestrator controls merge ordering.
</step>
```

**Important:** The executor agent does NOT need to know about branches. The orchestrator (execute-phase) handles `git checkout` to the plan branch BEFORE spawning the executor and handles merge AFTER. The executor just commits to "current branch" as it already does.

### 3. settings.md Modifications

**Current branching question:**
```
options: [None, Per Phase, Per Milestone]
```

**Modified branching question:**
```
options: [
  { label: "None (Recommended)", description: "Commit directly to current branch" },
  { label: "Per Phase", description: "Create branch for each phase" },
  { label: "Per Milestone", description: "Create branch for entire milestone" },
  { label: "GitHub Flow", description: "Dev branch + plan branches + PRs + build gates" }
]
```

**New build gate question (shown only when GitHub Flow selected):**
```
options: [
  { label: "All gates (Recommended)", description: "Build before PR, before merge, before main" },
  { label: "PR only", description: "Build validation before PR creation only" },
  { label: "None", description: "No build validation (fastest)" }
]
```

### 4. complete-milestone.md Modifications

**Current `handle_branches` step:** Merges phase/milestone branches to main.

**Modified `handle_branches` step:**
```markdown
IF branching_strategy == "github":
  Dev branch contains all merged plan PRs.

  1. Run final build gate: hive-tools.js git run-build-gate --gate pre_main
  2. Present to user:
     "Dev branch has all changes. Merge to main?"
     Options: Squash merge, Merge with history, Keep dev (manual)
  3. If merge:
     hive-tools.js git merge-dev-to-main
  4. Tag as usual

ELSE:
  Existing phase/milestone branch handling (unchanged)
```

### 5. new-project.md Modifications

**Current git init:** `git init` if no `.git/`

**Modified project init:**
```markdown
IF has_git is false:
  git init (unchanged)

IF branching_strategy == "github" (from config, set during workflow preferences):
  hive-tools.js git create-dev-branch
  Initial commit goes to main, then checkout dev for all work
```

### 6. git-integration.md Reference Update

Add new sections:

```markdown
## Plan Branch Lifecycle (GitHub Flow)

Branch naming: hive/phase-{phase}-{plan}-{slug}
Example: hive/phase-03-01-auth-setup

Lifecycle:
1. Created from dev at plan start
2. Executor commits tasks to this branch
3. Build gate validates before PR
4. PR created to dev
5. PR merged (squash or merge)
6. Branch deleted

## Build Gates

Three validation points:
- pre_pr: Before creating PR (plan-level)
- pre_merge: Before merging PR to dev (integration-level)
- pre_main: Before merging dev to main (release-level)

## PR Convention

Title: feat({phase}-{plan}): {plan-name}
Body: Auto-generated from SUMMARY.md
```

## Architectural Patterns

### Pattern 1: Orchestrator-Owned Branching

**What:** The orchestrator (execute-phase) owns all branch operations. Executors never create, switch, or delete branches.

**When to use:** Always for git workflow integration.

**Why:** Executors already commit to "current branch" via hive-tools.js commit. If the orchestrator checks out the right branch before spawning, the executor's commits land on that branch automatically. No executor changes needed.

**Trade-off:** Slightly more complex orchestrator logic. But executor simplicity is preserved, and the existing 11 agents need zero modifications.

```
Orchestrator: git checkout plan-branch -> Spawn executor -> Executor commits to plan-branch -> Orchestrator: merge, cleanup
```

### Pattern 2: hive-tools.js as Git Abstraction Layer

**What:** All git operations go through hive-tools.js commands, never raw git in workflows.

**When to use:** Every git operation in the new workflow.

**Why:** Consistent error handling, JSON output for parsing, testability. Follows the existing pattern where `cmdCommit` wraps `git add` + `git commit` and `execGit` wraps all git calls with error handling.

**Trade-off:** More functions in hive-tools.js (already 162K). But this is the established pattern and keeps workflows declarative.

### Pattern 3: Config-Gated Progressive Enhancement

**What:** Every new feature is behind a config flag. `branching_strategy: "github"` is the master toggle. Individual build gates have their own sub-toggles.

**When to use:** All git workflow features.

**Why:** Users who set `branching_strategy: "none"` (the default) see zero behavior change. Users can adopt progressively: first just plan branches, then add build gates, then add PRs.

**Config cascade:**
```
branching_strategy: "github"  -> enables plan branches
  + auto_pr: true             -> enables PR creation
    + build_gates.pre_pr: true -> enables pre-PR build check
  + build_before_merge: true  -> enables pre-merge check
```

### Pattern 4: File-Based Coordination (Multi-Terminal)

**What:** Workers and repo manager communicate via `.hive-workers/` files, not sockets or IPC.

**When to use:** Multi-terminal mode only (Phase 3).

**Why:** Follows Hive's core pattern: all communication via files on disk. No new dependencies, no running servers, works across any terminal setup.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Git Operations in Agents

**What people might do:** Have executor agents run `git checkout`, `git merge`, `gh pr create` directly.

**Why it's wrong:** Agents have 200K context windows but no persistent state. If an agent dies mid-branch-operation, the repo is in an inconsistent state. Agents should only do what they already do: commit code changes.

**Do this instead:** All branch/PR/merge operations in hive-tools.js, called by the orchestrator workflow, not by agents.

### Anti-Pattern 2: Phase-Level Branches with Parallel Plans

**What people might do:** Create one branch per phase, then run parallel plans on that single branch.

**Why it's wrong:** Parallel plans modify different files simultaneously. On a single branch, they create race conditions. Plan A commits file X, Plan B commits file Y, but they are interleaved on the same branch.

**Do this instead:** Plan-level branches. Each plan gets its own branch from dev. Plans execute in isolation. PRs merge atomically to dev.

### Anti-Pattern 3: Building the Merge Queue Before Single-Terminal Works

**What people might do:** Implement merge-queue.json, worker registry, and file signaling in Phase 1.

**Why it's wrong:** The merge queue is only needed for multi-terminal. Single-terminal uses self-merge. Building the queue first adds complexity before the basic flow works.

**Do this instead:** Phase 1 = single-terminal with self-merge. Phase 2 = repo manager with merge queue. Phase 3 = multi-terminal with worktrees.

### Anti-Pattern 4: Modifying Executor Agent Contract

**What people might do:** Change execute-plan.md to make executors aware of branches, PRs, or build gates.

**Why it's wrong:** The executor agent's contract is well-defined: read plan, execute tasks, commit per task, create SUMMARY. Adding git workflow awareness bloats the agent's context and breaks the separation of concerns.

**Do this instead:** The orchestrator (execute-phase) handles all git workflow around the executor. The executor's pre-conditions (correct branch checked out) and post-conditions (commits on correct branch) are handled externally.

## Build Order and Dependencies

### Dependency Graph

```
[1] Config Schema Extension
  |
  +---> [2] loadConfig Extension (reads new fields)
  |       |
  |       +---> [3] cmdInitExecutePhase Extension (returns new fields)
  |       |       |
  |       |       +---> [6] execute-phase.md Modification
  |       |       |       |
  |       |       |       +---> [8] execute-plan.md Modification
  |       |       |
  |       |       +---> [9] complete-milestone.md Modification
  |       |
  |       +---> [5] settings.md Modification
  |
  +---> [4] hive-tools.js git Subcommands
  |       |
  |       +---> [6] execute-phase.md (calls git subcommands)
  |       +---> [8] execute-plan.md (calls git subcommands)
  |       +---> [9] complete-milestone.md (calls git subcommands)
  |
  +---> [7] git-integration.md Reference Update
  |
  +---> [10] new-project.md Modification (dev branch at init)

Phase 2 deps (repo manager):
  [4] git subcommands
    +---> [11] merge-queue.json format
    +---> [12] hive-repo-manager.md agent definition
    +---> [13] manage-repo.md command
    +---> [14] Merge queue commands in hive-tools.js

Phase 3 deps (multi-terminal):
  [12] repo manager agent
    +---> [15] Worktree commands in hive-tools.js
    +---> [16] Worker registry
    +---> [17] start-worker.md command
    +---> [18] File-based signaling
```

### Recommended Build Sequence

**Phase 1: Single-Terminal Foundation** (items 1-10)
1. Config schema extension (config.json template + loadConfig)
2. hive-tools.js git subcommands (all 10 commands)
3. cmdInitExecutePhase extension (return new git fields)
4. git-integration.md reference update
5. settings.md modification (new branching option)
6. new-project.md modification (dev branch at init)
7. execute-phase.md modification (plan branching + PR in wave loop)
8. execute-plan.md modification (build gate + PR creation)
9. complete-milestone.md modification (dev-to-main merge)
10. Integration testing: full single-terminal cycle

**Phase 2: Repo Manager** (items 11-14)
11. merge-queue.json format definition
12. hive-tools.js merge queue commands
13. hive-repo-manager.md agent definition
14. manage-repo.md command + workflow

**Phase 3: Multi-Terminal** (items 15-18)
15. hive-tools.js worktree commands
16. Worker registry implementation
17. start-worker.md command + workflow
18. File-based signaling

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single terminal, 1-5 plans/phase | Default mode. Sequential plan branches, self-merge PRs. No merge queue. |
| Single terminal, 5-15 plans/phase | Same architecture. Parallel agents within wave, sequential waves. Build gates add time but catch integration issues. |
| Multi-terminal, 2-3 workers | Worktrees + merge queue. Repo manager in dedicated terminal. File-based signaling with polling (5s). |
| Multi-terminal, 4+ workers | Same architecture but with concurrency limits (max_concurrent_agents). inotifywait replaces polling. Dynamic wave scheduling. |

### Scaling Priority

1. **First bottleneck:** Build gate execution time. A 60-second test suite run 10 times per phase adds 10 minutes. Mitigation: configurable gates, skip pre-merge if pre-PR passed.
2. **Second bottleneck:** Sequential PR merges in single-terminal. Each PR: create (2s) + merge (3s) + delete branch (1s) = ~6s. 10 plans = 60s. Acceptable.
3. **Third bottleneck (multi-terminal only):** Merge queue contention. Multiple workers submitting simultaneously. Mitigation: file locking via `flock`, atomic writes.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| GitHub CLI (`gh`) | Called by hive-tools.js for PR create/merge | Requires `gh` installed and authenticated. Detect with `which gh`. Fallback: git-only merge (no PR). |
| Build tools (npm, cargo, pytest, go) | Auto-detected by `detect-build-cmd` | User can override with `git.build_command` in config. Timeout configurable. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Orchestrator (execute-phase) <-> hive-tools.js git | CLI calls returning JSON | Same pattern as all other hive-tools.js calls |
| Orchestrator <-> Executor agents | Task spawn (unchanged) | Executor is unaware of git workflow; just commits to current branch |
| Repo manager <-> Workers | .hive-workers/ files | File-based, polled or inotify-watched |
| Repo manager <-> GitHub | `gh` CLI | PR creation, merge, status checks |

## Sources

- Existing codebase analysis: `/home/dico/dico-dev/hive-disaster/.claude/hive/bin/hive-tools.js` (full read of 5440 lines)
- Existing codebase analysis: `/home/dico/dico-dev/hive-disaster/.claude/hive/workflows/execute-phase.md` (924 lines)
- Existing codebase analysis: `/home/dico/dico-dev/hive-disaster/.claude/hive/workflows/execute-plan.md` (549 lines)
- Existing codebase analysis: `/home/dico/dico-dev/hive-disaster/.claude/hive/workflows/complete-milestone.md` (645 lines)
- Existing codebase analysis: `/home/dico/dico-dev/hive-disaster/.claude/hive/workflows/settings.md` (146 lines)
- Existing codebase analysis: `/home/dico/dico-dev/hive-disaster/.claude/hive/workflows/new-project.md` (1369 lines)
- Prior research: `.planning/research/GIT-WORKFLOW-RECOMMENDATIONS.md` (552 lines)
- Existing config: `/home/dico/dico-dev/hive-disaster/.claude/hive/templates/config.json`
- Existing reference: `/home/dico/dico-dev/hive-disaster/.claude/hive/references/git-integration.md`

---
*Architecture research for: Git Workflow Integration with Hive*
*Researched: 2026-02-12*
