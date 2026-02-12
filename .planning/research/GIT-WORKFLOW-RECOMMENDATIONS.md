# Git Workflow Recommendations for Hive

## Research Summary

This document recommends a professional git workflow architecture for Hive, covering branching strategy, multi-terminal coordination, PR-based integration, build validation, and a repo manager agent.

---

## 1. Recommended Git Flow Model: Modified GitHub Flow

### Why Not Git Flow or Trunk-Based

| Model | Pros | Cons for Hive |
|-------|------|---------------|
| **Git Flow** | Release branches, hotfix support | Too heavy for AI-agent workflow; develop/release/hotfix branches create cognitive overhead for agents; merge conflicts multiply with long-lived branches |
| **Trunk-Based** | Simple, CI-focused | Requires robust CI/CD pipeline; agents committing directly to main is dangerous; no isolation between parallel workers; single broken commit blocks everyone |
| **GitHub Flow** | Branch-per-feature, PR-based, simple | Almost right, but needs adaptation for multi-agent parallel work |

### Recommendation: Modified GitHub Flow with Worktree Isolation

```
main (protected)
  └── dev (integration branch, auto-created per project)
       ├── hive/phase-03-01-auth-setup     (plan-level branch, worktree 1)
       ├── hive/phase-03-02-token-refresh   (plan-level branch, worktree 2)
       └── hive/phase-03-03-dashboard       (plan-level branch, worktree 3)
```

**Key design decisions:**

1. **`dev` as integration branch** -- All plan branches merge to `dev` via PR. The `dev` branch is where integration testing happens. Merging `dev` to `main` is a deliberate user action (milestone completion or manual).

2. **Plan-level branches, not phase-level** -- Phases contain multiple plans that may execute in parallel. Phase-level branches would force serial execution or create merge hell between parallel plans. Plan-level branches give each executor agent its own isolated branch.

3. **PR-based integration** -- Every plan completion creates a PR from its branch to `dev`. The repo manager reviews and merges. This creates an audit trail and enables build validation.

4. **Single-terminal fallback** -- When running in single-terminal mode, the same flow works: sequential plan branches, sequential PRs, self-merge. The architecture degrades gracefully.

### Justification for This Model

- **AI agents need isolation**: An agent modifying files must not see half-complete work from another agent. Worktrees provide filesystem-level isolation.
- **PRs are natural checkpoints**: Hive already has a checkpoint concept. PRs extend this to git operations.
- **Bisectability preserved**: Each plan branch has atomic task commits. PRs squash or merge to `dev` preserving plan-level granularity.
- **Matches Hive's wave model**: Wave 1 plans get branches, execute in parallel, merge to `dev`. Wave 2 plans branch from updated `dev`.

---

## 2. Multi-Terminal Architecture: Worktree-Per-Worker

### Architecture Overview

```
project/                          # Main worktree (repo manager terminal)
├── .git/                         # Shared git database
├── .planning/                    # Shared planning state
├── .hive-workers/                # Worker coordination directory
│   ├── registry.json             # Active worker registry
│   ├── merge-queue.json          # Ordered merge requests
│   └── signals/                  # File-based signaling
│       ├── worker-1.signal       # Signal files per worker
│       └── worker-2.signal
├── src/                          # Main worktree working files
└── ...

../project-worker-1/              # Worktree for terminal 1
├── src/                          # Independent copy, own branch
└── ...

../project-worker-2/              # Worktree for terminal 2
├── src/                          # Independent copy, own branch
└── ...
```

### How It Works

**Worker Registration:**
When a Hive instance starts in a terminal and detects multi-terminal mode, it:
1. Creates a worktree: `git worktree add ../project-worker-N -b hive/plan-branch`
2. Registers itself in `.hive-workers/registry.json`
3. Begins executing its assigned plan in the worktree

**Repo Manager Terminal (hive-manage-repo):**
One terminal runs the "repo manager" agent. This agent:
1. Watches for incoming merge requests (polling `.hive-workers/merge-queue.json`)
2. Reviews PRs (or auto-merges based on policy)
3. Keeps `dev` branch updated
4. Signals workers when `dev` has new changes they should rebase on

**Worker Terminals (hive-workers):**
Each worker terminal:
1. Operates in its own worktree on its own plan branch
2. Commits tasks atomically (existing Hive behavior, unchanged)
3. When plan completes, submits a merge request to the queue
4. Waits for merge confirmation, then starts next assigned plan

### Single vs Multi-Terminal UX

| Aspect | Single Terminal | Multi-Terminal |
|--------|----------------|----------------|
| Worktrees | Not used; work on `dev` directly or on plan branches sequentially | One worktree per active plan |
| Merge queue | Self-merge; PR created and immediately merged | Repo manager processes queue |
| Build validation | Run before each commit/PR | Run in each worktree independently |
| Conflict detection | N/A (sequential) | Clash-style three-way merge simulation between active worktrees |
| Wave execution | Sequential within wave | Parallel across terminals |

**Config detection:**
```json
{
  "git": {
    "flow": "github",
    "multi_terminal": false,
    "dev_branch": "dev",
    "plan_branches": true,
    "auto_pr": true,
    "build_before_merge": true
  }
}
```

When `multi_terminal: true`, the system creates worktrees and the merge queue. When `false`, the same branch/PR flow operates sequentially in a single terminal.

---

## 3. Repo Manager Design

### What the Repo Manager Does

The repo manager is a persistent agent (or a long-running process in a dedicated terminal) that:

1. **Watches the merge queue** for incoming PRs from workers
2. **Validates PRs** (build passes, no conflicts, SUMMARY.md present)
3. **Merges PRs to dev** in dependency order (wave 1 before wave 2)
4. **Signals workers** to rebase when `dev` updates
5. **Reports status** to the user

### Implementation: File-Based Signal Queue

Rather than sockets or databases, use Hive's existing file-based communication pattern:

```
.hive-workers/merge-queue.json
```

```json
{
  "queue": [
    {
      "id": "mr-001",
      "plan": "03-01",
      "branch": "hive/phase-03-01-auth-setup",
      "worker": "worker-1",
      "status": "pending",
      "submitted_at": "2026-02-12T10:30:00Z",
      "pr_number": null,
      "checks": {
        "build": null,
        "conflicts": null,
        "summary": null
      }
    }
  ],
  "merged": [],
  "dev_head": "abc1234"
}
```

### Repo Manager Loop

```
while queue has pending items OR active workers exist:
  1. Read merge-queue.json
  2. For each pending item (in order):
     a. Check for conflicts: git merge-tree $(git merge-base dev $branch) dev $branch
     b. Run build validation (see section 4)
     c. If clean:
        - Create PR: gh pr create --base dev --head $branch
        - Merge PR: gh pr merge $pr --squash (or --merge based on config)
        - Update merge-queue.json status -> "merged"
        - Signal all workers: write new dev_head to signal files
     d. If conflicts:
        - Update status -> "conflict"
        - Signal worker to rebase
  3. Sleep 5 seconds (or use inotifywait on merge-queue.json)
```

### Watch Mechanism

Two options, in order of preference:

1. **inotifywait (Linux)**: Zero-CPU watch on `merge-queue.json` changes
   ```bash
   inotifywait -m -e modify .hive-workers/merge-queue.json
   ```

2. **Polling fallback**: Check every 5 seconds (cross-platform)

### Repo Manager Modes

| Mode | When | Behavior |
|------|------|----------|
| **Managed** | `multi_terminal: true` + dedicated terminal | Full repo manager agent running |
| **Self-managed** | `multi_terminal: false` or single terminal | Each worker acts as its own repo manager; create PR + self-merge |
| **Manual** | User preference | PRs created but not auto-merged; user reviews |

---

## 4. Build Gate Strategy

### Build Validation Points

```
Task complete → commit
                  ↓
Plan complete → build validation → create PR
                                      ↓
                              PR merge to dev → build validation → merge
                                                                     ↓
                                                            dev → main merge → build validation → merge
```

Three gates, progressively stricter:

### Gate 1: Pre-PR (plan completion)

When a plan finishes all tasks, before creating a PR:

```bash
# Detect and run project build
BUILD_CMD=$(node ~/.claude/hive/bin/hive-tools.js detect-build-cmd)
# Returns: npm test, cargo test, pytest, go test ./..., etc.

BUILD_RESULT=$($BUILD_CMD 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  # Build failed -- do NOT create PR
  # Write failure to merge-queue with status "build_failed"
  # Signal executor agent to investigate
fi
```

**Detection strategy** for build command:
1. Check `package.json` -> `scripts.test` or `scripts.build`
2. Check `Cargo.toml` -> `cargo test`
3. Check `pyproject.toml` or `setup.py` -> `pytest`
4. Check `go.mod` -> `go test ./...`
5. Check `Makefile` -> `make test`
6. Allow user override in config: `git.build_command`

### Gate 2: Pre-Merge (PR on dev)

Before the repo manager merges a PR to `dev`:

```bash
# Checkout the merge result locally and test
git checkout dev
git merge --no-commit --no-ff $BRANCH
$BUILD_CMD
if [ $? -ne 0 ]; then
  git merge --abort
  # Mark PR as "merge_build_failed"
fi
git merge --abort  # Always abort; actual merge via gh pr merge
```

This catches integration failures (plan A works alone, plan B works alone, but together they break).

### Gate 3: Pre-Main-Merge (dev to main)

When `dev` is merged to `main` (milestone completion or user-triggered):

```bash
# Full build + lint + any additional checks
$BUILD_CMD && $LINT_CMD
```

### Config

```json
{
  "git": {
    "build_gates": {
      "pre_pr": true,
      "pre_merge": true,
      "pre_main": true,
      "build_command": null,
      "timeout_seconds": 300
    }
  }
}
```

### Fail-Fast Principle

Build gates fail fast and block:
- **Pre-PR fails**: Executor agent gets a chance to fix (retry the last task or debug)
- **Pre-merge fails**: Repo manager signals the worker that its plan has integration issues
- **Pre-main fails**: User is informed; dev branch needs investigation

No git operations proceed past a failed gate. This prevents broken code from propagating.

---

## 5. Conflict Resolution Strategy

### Prevention First

1. **Plan-level branch isolation**: Each plan gets its own branch. Plans in the same wave are designed to touch different files (Hive's plan dependency system already handles this via `depends_on` and wave grouping).

2. **File-pattern awareness**: Before starting execution, detect potential file overlaps between parallel plans:
   ```bash
   # Compare files_modified lists from plan frontmatter
   OVERLAP=$(node ~/.claude/hive/bin/hive-tools.js detect-file-overlap --wave 1)
   ```
   If overlap detected: warn user, suggest sequential execution for overlapping plans.

3. **Clash-style continuous monitoring**: During parallel execution, periodically simulate merges between active plan branches to detect emerging conflicts:
   ```bash
   git merge-tree $(git merge-base branch-a branch-b) branch-a branch-b
   ```
   If conflicts detected: signal the relevant worker to adjust its approach.

### Resolution When Conflicts Occur

When the repo manager detects conflicts during PR merge:

1. **Automatic rebase attempt**: Try rebasing the plan branch onto updated `dev`:
   ```bash
   git checkout $PLAN_BRANCH
   git rebase dev
   ```

2. **If rebase succeeds**: Update the PR, re-run build gates, proceed with merge.

3. **If rebase fails (true conflict)**:
   - **Option A (preferred)**: Signal the worker agent to resolve. The agent has full context about what it changed and why. It can rebase interactively within its worktree.
   - **Option B**: Queue the conflicting PR and process non-conflicting ones first. Often, after other merges complete, the conflict landscape simplifies.
   - **Option C**: Escalate to user. Present the conflict files and ask for guidance.

### Ordering Strategy

Merge PRs in dependency order:
1. Wave 1 plans first (no dependencies)
2. Within a wave, merge the plan with fewer changed files first (less likely to cause conflicts)
3. Wave 2 plans after wave 1 is fully merged

---

## 6. Single vs Multi-Terminal UX

### The Seamless Degradation Principle

The same workflow MUST work in both modes. The difference is only in parallelism and the merge queue:

```
Single terminal:
  for each wave:
    for each plan in wave:
      create plan branch from dev
      execute plan (all tasks)
      build gate
      create PR to dev
      self-merge PR
      delete plan branch
    end
  end
  # All done: dev has all changes

Multi-terminal:
  repo-manager terminal: start repo manager agent
  for each wave:
    for each plan in wave:
      assign plan to available worker terminal
      worker creates worktree + plan branch
      worker executes plan (all tasks)
      worker submits to merge queue
      repo manager validates + merges
    end
    wait for all wave plans merged
  end
  # All done: dev has all changes
```

### Terminal Detection

How does Hive know it is in multi-terminal mode?

1. **Explicit config**: `multi_terminal: true` in config.json
2. **Auto-detection**: Check for `.hive-workers/registry.json`. If it exists and has active workers, we are in multi-terminal mode.
3. **Command flag**: `/hive:execute-phase 3 --workers 3` explicitly requests 3 worker terminals

### Worker Lifecycle

```
1. User runs: /hive:start-worker
2. Hive checks registry, gets next unassigned plan
3. Creates worktree: git worktree add ../project-worker-N -b hive/plan-branch
4. Executor agent starts in worktree directory
5. On plan completion:
   a. Build gate
   b. Submit to merge queue
   c. Wait for merge confirmation
   d. Clean up worktree: git worktree remove ../project-worker-N
   e. Check for next unassigned plan; if exists, loop to step 3
   f. If no more plans, worker exits
```

---

## 7. Key Risks and Mitigations

### Risk 1: Worktree Cleanup Failure

**Risk**: Worker crashes, leaving orphaned worktrees and stale branches.
**Mitigation**:
- Registry tracks all worktrees with timestamps
- On startup, `hive-tools.js` prunes stale entries (no heartbeat for >10 min)
- `git worktree prune` as part of init
- `/hive:cleanup-workers` command for manual cleanup

### Risk 2: Merge Queue Corruption

**Risk**: Multiple processes writing to `merge-queue.json` simultaneously.
**Mitigation**:
- Use `flock` for file locking on Linux/Mac
- Atomic writes: write to temp file, then `rename()` (atomic on POSIX)
- JSON validation on read; if corrupt, rebuild from git branch state

### Risk 3: Build Gate False Positives

**Risk**: Build passes in worktree but fails on `dev` due to missing integration.
**Mitigation**:
- Gate 2 (pre-merge) tests the merge result, not just the branch
- If Gate 2 fails, it is a legitimate integration issue, not a false positive
- Workers can be signaled to rebase and re-test before re-submitting

### Risk 4: Context Window Overhead

**Risk**: Git workflow management consumes too much agent context.
**Mitigation**:
- All git operations happen via `hive-tools.js` (single CLI calls returning JSON)
- Workers focus on execution; repo manager handles all git complexity
- Branch names are pre-computed during `init` (existing pattern)
- No agent needs to understand the full git workflow; each has a narrow role

### Risk 5: Partial Wave Failure

**Risk**: Plan A in wave 1 merges to `dev`, plan B fails. Wave 2 depends on both.
**Mitigation**:
- Wave 2 does not start until all wave 1 plans are merged
- Failed plans get retry option (existing Hive pattern)
- If a plan is abandoned, its branch is deleted without merge
- `dev` only receives working, validated code

### Risk 6: Single-Terminal Performance Regression

**Risk**: Adding branching/PR/build overhead makes single-terminal slower.
**Mitigation**:
- Build gates are configurable (can disable all three)
- Single-terminal mode can use "fast merge" (merge without PR creation)
- If `git.flow: "none"`, entire git workflow is bypassed (current behavior)
- Progressive adoption: users opt in to git flow features

### Risk 7: Disk Space from Worktrees

**Risk**: Multiple worktrees of a large repo consume significant disk space.
**Mitigation**:
- Git worktrees share the object store (`.git/` is shared)
- Only working directory files are duplicated
- Worktrees are cleaned up immediately after plan completion
- Max concurrent worktrees limited by `max_concurrent_agents` config (default: 3)

---

## 8. Implementation Priority

### Phase 1: Foundation (Single Terminal)
1. Add `dev` branch creation during project initialization
2. Implement plan-level branching (extend existing `branching_strategy`)
3. Add build command detection in `hive-tools.js`
4. Add pre-PR build gate in execute-plan workflow
5. Add PR creation via `gh pr create` after plan completion
6. Add self-merge for single-terminal mode

### Phase 2: Repo Manager
1. Design merge queue file format
2. Implement repo manager loop in `hive-tools.js` (new command)
3. Add conflict detection via `git merge-tree`
4. Add merge ordering logic (wave-aware)
5. Add file-based signaling between workers and manager

### Phase 3: Multi-Terminal
1. Implement worktree creation/cleanup in `hive-tools.js`
2. Add worker registry
3. Implement `/hive:start-worker` command
4. Add worktree-aware execution in execute-plan workflow
5. Integrate with repo manager merge queue

### Phase 4: Advanced
1. Clash-style continuous conflict monitoring
2. Dynamic worker assignment (auto-balance load)
3. inotifywait-based signaling (replace polling)
4. PR review templates for AI-generated code
5. Metrics/telemetry for merge queue performance

---

## 9. Hive-Specific Integration Points

### Files That Need Modification

| File | Change |
|------|--------|
| `hive/bin/hive-tools.js` | New commands: `create-dev-branch`, `create-plan-branch`, `detect-build-cmd`, `run-build-gate`, `merge-queue`, `worktree-create`, `worktree-remove`, `worker-register`, `worker-deregister`, `detect-file-overlap` |
| `hive/templates/config.json` | New `git` section with flow, multi_terminal, build_gates |
| `hive/references/git-integration.md` | Update with branching strategy, PR workflow, build gates |
| `hive/workflows/execute-phase.md` | Add plan branch creation per wave, PR creation after plan, wave-gating on merge completion |
| `hive/workflows/execute-plan.md` | Add build gate before PR creation, merge queue submission |
| `hive/workflows/settings.md` | Add git flow configuration options |
| `hive/workflows/complete-milestone.md` | Add dev-to-main merge flow |
| `commands/hive/start-worker.md` | New command for multi-terminal worker |
| `commands/hive/manage-repo.md` | New command for repo manager terminal |
| `agents/hive-repo-manager.md` | New agent definition for the repo manager |

### Compatibility with Existing Branching

Current config supports `branching_strategy: "none" | "phase" | "milestone"`. The new system adds:

- `"plan"` -- Branch per plan (recommended for multi-terminal)
- `"github"` -- Full GitHub Flow with dev branch, PRs, build gates

The old values continue to work as-is. `"none"` bypasses all new git workflow features.

---

## 10. Research Sources

- [Git Worktrees: The Secret Weapon for Running Multiple AI Coding Agents in Parallel](https://medium.com/@mabd.dev/git-worktrees-the-secret-weapon-for-running-multiple-ai-coding-agents-in-parallel-e9046451eb96)
- [How Git Worktrees Changed My AI Agent Workflow (Nx Blog)](https://nx.dev/blog/git-worktrees-ai-agents)
- [Using Git Worktrees for Multi-Feature Development with AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/)
- [Parallel Workflows: Git Worktrees and the Art of Managing Multiple AI Agents](https://medium.com/@dennis.somerville/parallel-workflows-git-worktrees-and-the-art-of-managing-multiple-ai-agents-6fa3dc5eec1d)
- [Parallel AI Coding with Git Worktrees and Custom Claude Code Commands](https://docs.agentinterviews.com/blog/parallel-ai-coding-with-gitworktrees/)
- [ccswarm: Multi-agent orchestration with Git worktree isolation](https://github.com/nwiizo/ccswarm)
- [multi-agent-shogun: Samurai-inspired multi-agent system with inotify signaling](https://github.com/yohey-w/multi-agent-shogun)
- [Clash: Manage merge conflicts across git worktrees](https://github.com/clash-sh/clash)
- [Gas Town vs Swarm-Tools: Multi-Agent AI Orchestration Compared](https://gist.github.com/johnlindquist/4174127de90e1734d58fce64c6b52b62)
- [Trunk-Based Development vs Gitflow (Mergify)](https://mergify.com/blog/trunk-based-development-vs-gitflow-which-branching-model-actually-works)
- [Git Branching Strategies: GitFlow, GitHub Flow, Trunk-Based](https://www.abtasty.com/blog/git-branching-strategies/)
- [Agent design patterns (2026)](https://rlancemartin.github.io/2026/01/09/agent_design/)
- [Agents, Subagents, and Multi Agents (Goose)](https://block.github.io/goose/blog/2025/08/14/agent-coordination-patterns/)
- [Claude Code Feature Request: Integrated Parallel Task Management and Worktree Orchestration](https://github.com/anthropics/claude-code/issues/4963)
