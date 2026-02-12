# Phase 10: PR & Workflow Integration - Research

**Researched:** 2026-02-12
**Domain:** Composing Phase 8 git subcommands and Phase 9 lifecycle/gates into end-to-end PR creation, self-merge, workflow modifications, and git-status progress display
**Confidence:** HIGH

## Summary

Phase 10 is the final "wiring" phase that connects the primitives built in Phase 8 (git subcommands: `create-pr`, `self-merge-pr`, `merge-dev-to-main`, `current-branch`, `delete-plan-branch`) and Phase 9 (branch lifecycle in execute-phase, build gates in execute-plan) into a complete single-terminal PR workflow. After a plan passes its build gate, a PR is automatically created from the plan branch to dev, immediately self-merged with `--merge` (preserving per-task commit history), and the branch is cleaned up. This phase also wires the dev-to-main merge into `complete-milestone.md` and adds git-status information to the progress display.

All the low-level primitives already exist and are tested. Phase 10 does NOT add new JavaScript functions to hive-tools.js. Instead, it modifies 4 workflow markdown files (`execute-plan.md`, `execute-phase.md`, `complete-milestone.md`, `progress.md`) and optionally extends the statusline hook. The `create-pr` subcommand accepts `--base`, `--title`, `--body`; the `self-merge-pr` subcommand accepts a PR number and reads `git_merge_strategy` from config; `merge-dev-to-main` checks out main and merges dev with `--no-ff`. All return structured JSON. The only new hive-tools.js additions needed are: (1) a `git git-status` subcommand (or extend `current-branch`) to return ahead/behind counts and open PR count, and (2) a `git pr-body` subcommand (or inline it in the workflow) to read SUMMARY.md and format it as a PR body.

**Primary recommendation:** Implement in 3 plans: Plan 1 covers PR creation and self-merge flow in execute-plan.md (PR-01, PR-02, PR-03, PR-04, INTG-02). Plan 2 covers execute-phase branch orchestration refinement and complete-milestone dev-to-main merge (INTG-01, INTG-03). Plan 3 covers progress display git status (INTG-05).

## Standard Stack

### Core

No new libraries or dependencies. All changes compose existing Phase 8/9 primitives.

| Component | Already Exists | Purpose for Phase 10 | Location |
|-----------|---------------|---------------------|----------|
| `cmdGitCreatePr` | Yes (line 5360) | Creates PR via `gh pr create --base --title --body` | hive-tools.js |
| `cmdGitSelfMergePr` | Yes (line 5386) | Merges PR via `gh pr merge N --merge --delete-branch` | hive-tools.js |
| `cmdGitMergeDevToMain` | Yes (line 5409) | Checkout main, merge dev `--no-ff`, abort on conflict | hive-tools.js |
| `cmdGitDeletePlanBranch` | Yes (line 5481) | Safe branch delete with protected branch check | hive-tools.js |
| `cmdGitCurrentBranch` | Yes (line 5275) | Returns current branch name | hive-tools.js |
| `cmdGitRunBuildGate` | Yes (line 5333) | Build validation (Phase 9 wired into execute-plan) | hive-tools.js |
| `cmdGitCheckConflicts` | Yes (line 5440) | Conflict detection via merge-tree or dry-run | hive-tools.js |
| `cmdGitDetect` | Yes (line 5221) | Detects git/gh versions | hive-tools.js |
| `loadConfig` git fields | Yes (line 175) | `git_flow`, `git_merge_strategy`, `git_dev_branch` | hive-tools.js |
| `cmdSummaryExtract` | Yes (line 2471) | Extracts structured data from SUMMARY.md | hive-tools.js |
| Build gate step | Yes (execute-plan.md) | Runs pre-PR build validation (Phase 9) | execute-plan.md |
| Branch lifecycle | Yes (execute-phase.md) | Plan branches per wave, cleanup hooks (Phase 9) | execute-phase.md |

### Files to Modify

| File | Change Required | Type |
|------|----------------|------|
| `hive/workflows/execute-plan.md` | Add PR creation + self-merge steps after build gate passes | Markdown workflow |
| `hive/workflows/execute-phase.md` | Wire branch cleanup to post-merge (not post-wave), ensure dev checkout after merge | Markdown workflow |
| `hive/workflows/complete-milestone.md` | Add dev-to-main merge with Gate 3 before archival | Markdown workflow |
| `hive/workflows/progress.md` | Add git status section (current branch, ahead/behind, open PRs) | Markdown workflow |
| `hive/bin/hive-tools.js` | Add `git git-status` subcommand (branch + ahead/behind + open PR count) | JavaScript |
| `hooks/hive-statusline.js` | Optionally add branch indicator | JavaScript (optional) |

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| Adding `git git-status` subcommand | Inline git commands in workflow markdown | Subcommand is reusable across progress.md and statusline; single source of truth |
| Reading SUMMARY.md in workflow for PR body | Adding `git pr-body` subcommand | SUMMARY.md reading is already done by the workflow after summary creation; inline construction is simpler |
| Modifying statusline for branch display | Adding branch to progress.md only | Both should have it, but progress.md is the primary display point; statusline is optional enhancement |
| PR creation in execute-phase.md | PR creation in execute-plan.md | PR creation belongs in execute-plan because it happens after the build gate (which is already in execute-plan). The plan executor has the SUMMARY.md context needed for the PR body. |

## Architecture Patterns

### Recommended Change Structure

```
Changes by requirement:

PR-01 (PR created after Gate 1):
  execute-plan.md  -> Add create_pr step after build_gate passes

PR-02 (PR body from SUMMARY.md):
  execute-plan.md  -> Read SUMMARY.md, format PR body with task list + commits + phase context

PR-03 (Single-terminal self-merge):
  execute-plan.md  -> Call self-merge-pr immediately after PR creation

PR-04 (Merge strategy configurable):
  Already handled  -> cmdGitSelfMergePr reads config.git_merge_strategy (merge/squash)

INTG-01 (execute-phase branch orchestration):
  execute-phase.md -> Wire branch cleanup to post-merge trigger, ensure dev checkout after self-merge

INTG-02 (execute-plan PR creation):
  execute-plan.md  -> Full PR flow: build gate -> create PR -> self-merge -> checkout dev

INTG-03 (complete-milestone dev-to-main):
  complete-milestone.md -> Add Gate 3 + merge-dev-to-main step before archival

INTG-05 (progress display git status):
  hive-tools.js    -> Add git git-status subcommand
  progress.md      -> Add Git Status section to progress report
```

### Pattern 1: PR Creation After Build Gate (PR-01, PR-02, INTG-02)

**What:** After the build gate passes in execute-plan.md, create a PR from the plan branch to dev with the SUMMARY.md content as the PR body.

**When to use:** In execute-plan.md, as a new step immediately after `build_gate` and before `generate_user_setup`.

**Workflow integration (new step in execute-plan.md):**

```markdown
<step name="create_pr_and_merge">
**Create PR from plan branch to dev and self-merge.**

**Check if PR flow applies:**

GIT_FLOW=$(echo "$CONFIG_CONTENT" | jq -r '.git.flow // "github"')

**Skip conditions (any one skips):**
- GIT_FLOW is "none" -> Skip: "Git flow disabled. Skipping PR creation."
- BUILD_GATE_RESULT is "failed" or "timeout" (and user did not "skip") -> Skip: "Build gate did not pass. PR creation blocked."

**Construct PR title and body:**

PR_TITLE="${PHASE}-${PLAN}: [plan-name]"

PR body is constructed from the SUMMARY.md that was just created. Read the summary:
- One-liner from SUMMARY.md (the substantive description)
- Task list with commit hashes
- Build gate result
- Phase context (phase number, plan number)

Format:
```
## Plan ${PHASE}-${PLAN}: [plan-name]

[One-liner from SUMMARY.md]

### Tasks
| # | Task | Commit |
|---|------|--------|
| 1 | [task name] | abc123f |
| 2 | [task name] | def456g |

### Build Gate
**Result:** ${BUILD_GATE_RESULT}
**Command:** ${BUILD_CMD}

### Phase Context
Phase: ${PHASE_NUMBER} - ${PHASE_NAME}
Plan: ${PLAN_NUMBER} of ${PLAN_COUNT}
```

**Create PR:**

```bash
GIT_DEV_BRANCH=$(echo "$CONFIG_CONTENT" | jq -r '.git.dev_branch // "dev"')

# Push plan branch to remote first (required for gh pr create)
git push -u origin "$(git branch --show-current)" 2>/dev/null

PR_RESULT=$(node ./.claude/hive/bin/hive-tools.js git create-pr \
  --base "${GIT_DEV_BRANCH}" \
  --title "${PR_TITLE}" \
  --body "${PR_BODY}" \
  --raw)
PR_SUCCESS=$(echo "$PR_RESULT" | jq -r '.success')
PR_URL=$(echo "$PR_RESULT" | jq -r '.pr_url // empty')
```

**Handle PR creation result:**

| Result | Action |
|--------|--------|
| success: true | Log: "PR created: ${PR_URL}". Continue to self-merge. |
| success: false, error contains "gh" | gh CLI not available or not authenticated. Log warning. Skip PR, note in SUMMARY. |
| success: false, other | Log error. Skip PR, note in SUMMARY. |

**Self-merge PR (single-terminal mode):**

Extract PR number from PR_URL:
```bash
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')

MERGE_RESULT=$(node ./.claude/hive/bin/hive-tools.js git self-merge-pr "${PR_NUMBER}" --raw)
MERGE_SUCCESS=$(echo "$MERGE_RESULT" | jq -r '.success')
MERGE_STRATEGY=$(echo "$MERGE_RESULT" | jq -r '.strategy')
```

**Handle merge result:**

| Result | Action |
|--------|--------|
| success: true | Log: "PR #${PR_NUMBER} merged (${MERGE_STRATEGY}). Branch deleted by gh." |
| success: false, error contains "merge conflict" | Conflict detected. Report to user with options: resolve, skip, stop. |
| success: false, other | Log error. Branch remains. Note in SUMMARY. |

**After successful merge, checkout dev:**

```bash
git checkout "${GIT_DEV_BRANCH}"
# Pull to get the merge commit locally
git pull origin "${GIT_DEV_BRANCH}" 2>/dev/null || true
```

**Record PR result for SUMMARY:**

Set PR_RESULT_STATUS (created_and_merged / created_not_merged / skipped / failed).
</step>
```

**Key details:**
- `gh pr create` requires the branch to be pushed to remote first
- `gh pr merge N --merge --delete-branch` does the merge AND deletes the remote branch
- The local branch may still exist after `--delete-branch`; that is fine because execute-phase cleanup handles local deletion
- The PR number is extracted from the PR URL (last numeric segment)
- `cmdGitSelfMergePr` already reads `git_merge_strategy` from config (default: "merge", alternative: "squash")
- When strategy is "merge" (default), `gh pr merge --merge` creates a merge commit equivalent to `--no-ff`, preserving per-task commit history
- When strategy is "squash", `gh pr merge --squash` squashes all plan commits into one (configured alternative)

### Pattern 2: Execute-Phase Branch Cleanup After Merge (INTG-01)

**What:** After a plan's PR is self-merged in execute-plan.md, the plan branch is already deleted remotely by `--delete-branch`. Execute-phase needs to handle the local branch cleanup and ensure the working directory is on dev before the next plan starts.

**When to use:** In execute-phase.md, the existing branch cleanup step (added in Phase 9) needs to be wired to the post-merge state.

**Current state (Phase 9):** The cleanup step exists but notes:
> "Branch not yet merged -- skipping cleanup (will be cleaned after merge in Phase 10)"

**Phase 10 change:** Since the PR self-merge in execute-plan.md already:
1. Merges the PR (remote merge)
2. Deletes the remote branch (`--delete-branch` flag)
3. Checks out dev locally (`git checkout ${GIT_DEV_BRANCH}`)

The execute-phase cleanup step becomes:
1. Verify we are on dev (should be after execute-plan PR flow)
2. Delete local plan branch: `git branch -d ${BRANCH_NAME}` (should succeed since branch is now merged)
3. If delete fails: log warning, do not block (best-effort)

**Key change:** Remove the "not yet merged" warning and make the cleanup unconditional after plan completion. The branch IS merged at this point because execute-plan handles the PR + merge.

**Key details:**
- `gh pr merge --delete-branch` deletes the REMOTE branch; local cleanup still needed
- `git branch -d` (safe delete) works because the branch is now merged to dev
- If for some reason the merge did not happen (PR flow was skipped due to no gh CLI, etc.), the branch cleanup will fail with "not fully merged" -- the existing warning is appropriate
- Between waves in single-terminal mode, only one plan branch exists at a time, so no branch accumulation

### Pattern 3: Dev-to-Main Merge in Complete-Milestone (INTG-03)

**What:** When running `/hive:complete-milestone`, before archiving, run Gate 3 (pre-main build gate) and merge dev to main.

**When to use:** In complete-milestone.md, as a new step before `git_tag`.

**Workflow integration (new step in complete-milestone.md):**

```markdown
<step name="merge_dev_to_main">
**Merge dev branch to main with Gate 3 validation.**

```bash
INIT=$(node ./.claude/hive/bin/hive-tools.js init execute-phase "1")
GIT_FLOW=$(echo "$INIT" | jq -r '.git_flow // "none"')
```

**If GIT_FLOW is "none":** Skip to handle_branches step (existing legacy flow).

**Gate 3 (pre-main build):**

```bash
PRE_MAIN_GATE=$(cat .planning/config.json 2>/dev/null | jq -r '.git.build_gates.pre_main // true')
```

If PRE_MAIN_GATE is true:

```bash
# Ensure we are on dev for the build
GIT_DEV_BRANCH=$(echo "$INIT" | jq -r '.git_dev_branch // "dev"')
git checkout "${GIT_DEV_BRANCH}"

BUILD_RESULT=$(node ./.claude/hive/bin/hive-tools.js git run-build-gate --raw)
BUILD_SUCCESS=$(echo "$BUILD_RESULT" | jq -r '.success')
```

If build fails: present fix/skip/stop options (same pattern as execute-plan build gate).

**Merge dev to main:**

```bash
MERGE_RESULT=$(node ./.claude/hive/bin/hive-tools.js git merge-dev-to-main --raw)
MERGE_SUCCESS=$(echo "$MERGE_RESULT" | jq -r '.success')
MERGE_FROM=$(echo "$MERGE_RESULT" | jq -r '.from')
MERGE_TO=$(echo "$MERGE_RESULT" | jq -r '.to')
```

If success: "Merged ${MERGE_FROM} into ${MERGE_TO}."
If failure: "Merge conflict between dev and main." Offer: resolve, abort, skip.

**After merge, return to dev:**

```bash
git checkout "${GIT_DEV_BRANCH}"
```
</step>
```

**Key details:**
- `cmdGitMergeDevToMain` already handles: checkout main (with master fallback), merge `--no-ff`, abort on conflict
- Gate 3 uses the same `run-build-gate` subcommand as Gate 1 but is checked in a different workflow
- Gate 3 runs on the dev branch (where all plan PRs have been merged), not on a plan branch
- The existing `handle_branches` step in complete-milestone.md handles the legacy branching_strategy cases (phase/milestone). The new `merge_dev_to_main` step handles `git.flow: "github"` specifically.
- These two paths are mutually exclusive: if `git_flow` is "github", the new step runs and skips `handle_branches`. If `git_flow` is "none", the legacy `handle_branches` runs.

### Pattern 4: Progress Display Git Status (INTG-05)

**What:** The progress display (`/hive:progress`) shows current git branch, ahead/behind status relative to remote, and count of open PRs.

**When to use:** In progress.md, as an additional section in the report step.

**Implementation approach:**

Option A (recommended): Add a `git git-status` subcommand to hive-tools.js that returns:
```json
{
  "branch": "dev",
  "ahead": 3,
  "behind": 0,
  "open_prs": 2,
  "git_flow": "github",
  "dev_branch": "dev"
}
```

This subcommand composes:
1. `git rev-parse --abbrev-ref HEAD` for current branch
2. `git rev-list --count HEAD..@{u}` for behind count (if tracking branch exists)
3. `git rev-list --count @{u}..HEAD` for ahead count (if tracking branch exists)
4. `gh pr list --state open --json number --jq length` for open PR count (if gh available)

Option B: Inline git commands in the workflow markdown. Less clean but avoids new JS.

**Recommended: Option A.** The subcommand is reusable in progress.md, statusline, and future integration points. It handles the edge cases (no remote, no tracking branch, no gh CLI) gracefully with structured JSON.

**Progress.md integration:**

```markdown
## Git Status
Branch: ${BRANCH} ${AHEAD_BEHIND}
Open PRs: ${OPEN_PR_COUNT}
Flow: ${GIT_FLOW}
```

Where AHEAD_BEHIND is formatted as:
- "up to date" if ahead=0 and behind=0
- "3 ahead" if ahead>0 and behind=0
- "2 behind" if ahead=0 and behind>0
- "3 ahead, 2 behind" if both

**Statusline enhancement (optional):**

The existing statusline (hooks/hive-statusline.js) shows: `model | task | directory | context%`. Adding the branch name would look like: `model | task | directory (dev) | context%`.

This is a low-priority enhancement since the statusline runs on every prompt and adding git commands would slow it down. The branch name could be cached from the last `git rev-parse` call or read from a temp file.

### Anti-Patterns to Avoid

- **Creating PR before build gate passes:** The build gate is the quality check. If it fails, no PR should be created. The step ordering must be: tasks -> build gate -> PR -> merge.
- **Pushing plan branch to remote before tasks are committed:** The branch should only be pushed right before PR creation, after all tasks are committed and the build gate passes. Premature pushes waste network round-trips.
- **Using `git merge --no-ff` locally instead of `gh pr merge`:** The requirement is to create a PR and merge it via GitHub's API. This preserves the PR record on GitHub and uses `--delete-branch` for remote cleanup. Direct local merges would skip the PR record.
- **Running Gate 3 on main instead of dev:** Gate 3 validates the dev branch (which contains all merged plans) before it flows to main. Running the build on main would test the pre-merge state, missing the new code.
- **Blocking on open PR count in progress display:** The open PR count is informational. It should never block workflow execution or report an error.
- **Assuming gh CLI is always available:** The PR flow must degrade gracefully when gh is not installed or not authenticated. The fallback is: skip PR creation, note in SUMMARY, continue execution. Branch still needs local cleanup.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PR creation | Inline `gh pr create` | `hive-tools.js git create-pr` | Structured JSON, flow bypass, error handling, already tested |
| PR merge | Inline `gh pr merge` | `hive-tools.js git self-merge-pr` | Reads merge_strategy from config, --delete-branch, structured output |
| Dev-to-main merge | Inline `git merge` | `hive-tools.js git merge-dev-to-main` | main/master detection, --no-ff, abort on conflict, already tested |
| PR body formatting | Custom template engine | Inline string construction from SUMMARY.md | The body is simple markdown; no engine needed |
| Branch cleanup | Inline `git branch -d` | `hive-tools.js git delete-plan-branch` | Protected branch safety, structured error handling |
| Git status info | Multiple inline git commands | New `git git-status` subcommand | Reusable, edge case handling, structured JSON |

**Key insight:** Phase 10 is the COMPOSITION phase that wires Phase 8 primitives into workflow orchestration. Almost no new JavaScript is needed (only the `git-status` subcommand). The bulk of the work is markdown workflow modifications.

## Common Pitfalls

### Pitfall 1: gh CLI Not Authenticated or No Remote

**What goes wrong:** `gh pr create` fails because the user has not run `gh auth login` or the repo has no remote.
**Why it happens:** Not all local dev setups have GitHub configured. Some users work offline.
**How to avoid:** Before the PR step, check gh availability: `node ./.claude/hive/bin/hive-tools.js git detect --raw` returns `{ gh: { available: true/false } }`. If gh is unavailable, skip PR creation entirely with a clear message and note in SUMMARY.md. The plan's code is still committed to the plan branch and merged locally.
**Warning signs:** `gh pr create` returning "not authenticated" or "no remote" errors.

### Pitfall 2: Plan Branch Not Pushed to Remote

**What goes wrong:** `gh pr create` fails because the plan branch only exists locally -- no remote ref.
**Why it happens:** Task commits are local. The branch needs to be pushed before PR creation.
**How to avoid:** Before calling `create-pr`, push the plan branch: `git push -u origin ${BRANCH_NAME}`. Handle push failure (no remote, no permissions) by falling back to skip-PR mode.
**Warning signs:** "origin does not appear to be a git repository" or "remote rejected" errors.

### Pitfall 3: Self-Merge Fails Due to Branch Protection Rules

**What goes wrong:** `gh pr merge` fails because the repo has branch protection rules requiring reviews, status checks, etc.
**Why it happens:** GitHub repos can be configured to require PR reviews before merge.
**How to avoid:** The `--admin` flag bypasses protection rules, but it requires admin access. For single-terminal mode (solo developer), this is acceptable. However, do NOT add `--admin` by default. Instead, if merge fails with "protected branch" or "required status checks" error, inform the user and offer options: (1) add `--admin` flag, (2) merge manually via GitHub UI, (3) skip merge (leave PR open).
**Warning signs:** "required status check" or "review required" errors from `gh pr merge`.

### Pitfall 4: PR Number Extraction from URL Fails

**What goes wrong:** The PR URL returned by `gh pr create` doesn't match the expected format, so PR number extraction fails.
**Why it happens:** Different GitHub Enterprise instances may return different URL formats. The standard format is `https://github.com/owner/repo/pull/123`.
**How to avoid:** Use a robust extraction: `echo "$PR_URL" | grep -oE '[0-9]+$'`. This captures the last numeric segment. If extraction fails, fall back to `gh pr list --head ${BRANCH_NAME} --json number --jq '.[0].number'`.
**Warning signs:** Empty PR_NUMBER variable after extraction.

### Pitfall 5: Merge Conflicts on Self-Merge

**What goes wrong:** The self-merge fails because another plan (in a parallel wave) was merged to dev while this plan was building/PR'ing.
**Why it happens:** In single-terminal mode with sequential execution, this should be rare. But in parallel execution, two plan PRs could conflict.
**How to avoid:** In single-terminal sequential mode (Phase 10 scope), this is nearly impossible since plans execute one at a time. For safety, check the merge result and if conflicts detected, offer the user options: (1) resolve conflicts, (2) abort and re-run plan, (3) skip this plan.
**Warning signs:** `gh pr merge` returning "merge conflict" error.

### Pitfall 6: Dev Branch Drift After Self-Merge

**What goes wrong:** After `gh pr merge --delete-branch` and `git checkout dev`, the local dev is behind the remote dev (which now has the merge commit).
**Why it happens:** `gh pr merge` creates the merge commit on the remote. The local dev branch does not automatically pull.
**How to avoid:** After checkout dev, run `git pull origin ${GIT_DEV_BRANCH}` to sync the merge commit locally. Without this, the next plan branch creation would fork from the old dev state, missing the previous plan's code.
**Warning signs:** Next plan branch does not contain the previous plan's code. `git log --oneline dev` shows fewer commits than expected.

### Pitfall 7: Complete-Milestone Gate 3 Runs on Wrong Branch

**What goes wrong:** Gate 3 build runs on a plan branch (left over from the last execution) instead of dev.
**Why it happens:** After the last plan execution, the working directory may still be on a plan branch or main.
**How to avoid:** Explicitly checkout dev before running Gate 3: `git checkout ${GIT_DEV_BRANCH}`. Verify with `git branch --show-current`.
**Warning signs:** Gate 3 build results inconsistent with what was tested in per-plan Gate 1 builds.

### Pitfall 8: Installed Copy Desync After Workflow Changes

**What goes wrong:** Modified workflow files under `hive/workflows/` but the installed copy at `.claude/hive/workflows/` is stale.
**Why it happens:** The dual-file architecture requires syncing source and installed copies.
**How to avoid:** After modifying any workflow file, sync the installed copy. Verify with `diff hive/workflows/file.md .claude/hive/workflows/file.md`.
**Warning signs:** Running `/hive:execute-plan` or `/hive:complete-milestone` uses old workflow without PR flow steps.

### Pitfall 9: SUMMARY.md Not Yet Created When PR Body Is Constructed

**What goes wrong:** The PR body references SUMMARY.md content, but the step ordering places PR creation before summary creation.
**Why it happens:** Incorrect step ordering in execute-plan.md.
**How to avoid:** The correct step ordering is: tasks -> record_completion_time -> build_gate -> **create_summary** -> create_pr_and_merge -> generate_user_setup. The summary MUST be created before the PR so that the PR body can include the summary content. Note: this differs from the Phase 9 ordering where build_gate was between record_completion_time and generate_user_setup. Phase 10 must insert create_summary BEFORE create_pr_and_merge, which means reordering relative to the current flow.
**Warning signs:** PR body is empty or has placeholder text instead of actual summary content.

## Code Examples

### Example 1: PR Creation Step in execute-plan.md

```markdown
<step name="create_pr_and_merge">
**Create PR and self-merge after build gate passes.**

Check if PR flow applies:

```bash
GIT_FLOW=$(echo "$CONFIG_CONTENT" | jq -r '.git.flow // "github"')
GIT_DEV_BRANCH=$(echo "$CONFIG_CONTENT" | jq -r '.git.dev_branch // "dev"')
```

**Skip conditions:**
- GIT_FLOW is "none": skip PR flow.
- BUILD_GATE_RESULT is "failed" or "timeout" (user chose "stop"): skip.
- gh CLI not available: check via `git detect`, skip PR if gh unavailable.

**Construct PR body from SUMMARY.md:**

```bash
# Read the one-liner and task list from SUMMARY.md
SUMMARY_PATH=".planning/phases/${PHASE_DIR}/${PHASE}-${PLAN}-SUMMARY.md"

# Extract one-liner (first bold line after the title)
ONE_LINER=$(sed -n 's/^\*\*\(.*\)\*\*$/\1/p' "$SUMMARY_PATH" | head -1)

# Extract task commits section
TASK_COMMITS=$(sed -n '/^## Task Commits/,/^##/p' "$SUMMARY_PATH" | head -20)

# Build gate result
BUILD_INFO="**Build Gate:** ${BUILD_GATE_RESULT}"

PR_TITLE="${PHASE}-${PLAN}: ${ONE_LINER}"
```

PR body format (constructed inline):

```
## ${PHASE}-${PLAN}: ${PLAN_NAME}

${ONE_LINER}

### Task Commits
${TASK_COMMITS}

### Build Gate
Result: ${BUILD_GATE_RESULT}
Command: ${BUILD_CMD}

### Context
Phase: ${PHASE_NUMBER} - ${PHASE_NAME}
Branch: $(git branch --show-current)
```

**Push branch and create PR:**

```bash
git push -u origin "$(git branch --show-current)" 2>/dev/null

PR_RESULT=$(node ./.claude/hive/bin/hive-tools.js git create-pr \
  --base "${GIT_DEV_BRANCH}" \
  --title "${PR_TITLE}" \
  --body "${PR_BODY}" \
  --raw)
```

**Self-merge (single-terminal):**

```bash
PR_URL=$(echo "$PR_RESULT" | jq -r '.pr_url')
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')

MERGE_RESULT=$(node ./.claude/hive/bin/hive-tools.js git self-merge-pr "${PR_NUMBER}" --raw)
```

**After merge, sync local dev:**

```bash
git checkout "${GIT_DEV_BRANCH}"
git pull origin "${GIT_DEV_BRANCH}" 2>/dev/null || true
```

Set PR_FLOW_RESULT for SUMMARY inclusion.
</step>
```

### Example 2: Dev-to-Main Merge in complete-milestone.md

```markdown
<step name="merge_dev_to_main">
Check git flow config:

```bash
CONFIG=$(cat .planning/config.json 2>/dev/null)
GIT_FLOW=$(echo "$CONFIG" | jq -r '.git.flow // "none"')
```

If GIT_FLOW is "none": skip to existing handle_branches step.

**Gate 3 (pre-main build):**

```bash
PRE_MAIN=$(echo "$CONFIG" | jq -r '.git.build_gates.pre_main // true')
GIT_DEV_BRANCH=$(echo "$CONFIG" | jq -r '.git.dev_branch // "dev"')
```

If PRE_MAIN is true:

```bash
git checkout "${GIT_DEV_BRANCH}"
BUILD_RESULT=$(node ./.claude/hive/bin/hive-tools.js git run-build-gate --raw)
```

Handle pass/fail/skip same as execute-plan build gate.

**Merge:**

```bash
MERGE_RESULT=$(node ./.claude/hive/bin/hive-tools.js git merge-dev-to-main --raw)
```

After merge: `git checkout "${GIT_DEV_BRANCH}"`
</step>
```

### Example 3: Git Status Subcommand (new in hive-tools.js)

```javascript
function cmdGitStatus(cwd, raw) {
  const config = loadConfig(cwd);

  // Current branch
  const branchResult = execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  const branch = branchResult.success ? branchResult.stdout.trim() : 'unknown';

  // Ahead/behind (only if tracking branch exists)
  let ahead = 0, behind = 0, hasRemote = false;
  const trackResult = execCommand('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd });
  if (trackResult.success) {
    hasRemote = true;
    const aheadResult = execCommand('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd });
    const behindResult = execCommand('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd });
    ahead = aheadResult.success ? parseInt(aheadResult.stdout.trim(), 10) || 0 : 0;
    behind = behindResult.success ? parseInt(behindResult.stdout.trim(), 10) || 0 : 0;
  }

  // Open PR count (only if gh available)
  let openPRs = 0, ghAvailable = false;
  const ghResult = execCommand('gh', ['pr', 'list', '--state', 'open', '--json', 'number', '--jq', 'length'], { cwd });
  if (ghResult.success) {
    ghAvailable = true;
    openPRs = parseInt(ghResult.stdout.trim(), 10) || 0;
  }

  output({
    success: true,
    branch,
    ahead,
    behind,
    has_remote: hasRemote,
    open_prs: openPRs,
    gh_available: ghAvailable,
    git_flow: config.git_flow,
    dev_branch: config.git_dev_branch,
  }, raw, branch);
}
```

### Example 4: Progress Display Integration

```markdown
<step name="git_status">
**Add git status to progress report (if git flow enabled):**

```bash
GIT_STATUS=$(node ./.claude/hive/bin/hive-tools.js git git-status --raw)
GIT_FLOW=$(echo "$GIT_STATUS" | jq -r '.git_flow')
```

If GIT_FLOW is not "none":

```
## Git Status
Branch: ${BRANCH} ${AHEAD_BEHIND_DISPLAY}
Open PRs: ${OPEN_PRS}
Flow: ${GIT_FLOW} (dev: ${DEV_BRANCH})
```

Where AHEAD_BEHIND_DISPLAY is:
- "" (empty) if no remote tracking
- "(up to date)" if ahead=0, behind=0
- "(3 ahead)" if ahead>0
- "(2 behind)" if behind>0
- "(3 ahead, 2 behind)" if both
</step>
```

## Step Ordering in execute-plan.md (Critical)

The current step ordering in execute-plan.md (after Phase 9) is:

```
1. init_context
2. identify_plan
3. record_start_time
4. parse_segments
5. init_agent_tracking
6. segment_execution / execute (task execution)
7. record_completion_time
8. build_gate          <-- Phase 9 added here
9. generate_user_setup
10. create_summary
11. update_current_position
12. extract_decisions_and_issues
13. update_session_continuity
14. issues_review_gate
15. update_roadmap
16. git_commit_metadata
17. update_codebase_map
18. offer_next
```

**Phase 10 required reordering:**

The PR body needs SUMMARY.md content (PR-02). Therefore, `create_summary` must come BEFORE `create_pr_and_merge`. But `create_summary` needs BUILD_GATE_RESULT (from Phase 9).

New ordering:
```
7. record_completion_time
8. build_gate              <-- Phase 9 (unchanged)
9. create_summary          <-- MOVED UP (was step 10)
10. create_pr_and_merge    <-- Phase 10 NEW STEP (after summary, needs PR body from summary)
11. generate_user_setup    <-- shifted
12. update_current_position
13. extract_decisions_and_issues
14. update_session_continuity
15. issues_review_gate
16. update_roadmap
17. git_commit_metadata
18. update_codebase_map
19. offer_next
```

**Key insight:** The summary must be created before the PR so the PR body can reference it. The build gate result is already captured as a variable and flows into both the summary and the PR body.

## State of the Art

| Phase 9 State | Phase 10 Change | Impact |
|---------------|----------------|--------|
| Build gate runs, blocks "PR creation" (placeholder) | Build gate now actually blocks real PR creation | Quality gate enforced end-to-end |
| Branch cleanup logs "not yet merged" warning | Branch cleanup executes successfully post-merge | No stale branches accumulate |
| execute-phase creates/cleans branches | execute-phase orchestrates; execute-plan handles PR+merge | Clean separation of concerns |
| complete-milestone has legacy handle_branches | complete-milestone has git-flow-aware dev-to-main merge | Professional merge flow for milestones |
| Progress shows phase/plan/task counts | Progress also shows branch, ahead/behind, open PRs | Full situational awareness |

**Compatibility note:** When `git.flow` is `"none"`, all new steps are skipped. The existing behavior is preserved exactly. When gh CLI is unavailable, PR steps degrade to local-only (no PR created, note in SUMMARY). This ensures the system works on machines without GitHub access.

## Open Questions

1. **Should the PR body use a file-based approach (--body-file) instead of --body?**
   - What we know: `gh pr create --body` passes the body as a command-line argument. Very long summaries could exceed shell argument limits.
   - What's unclear: Whether SUMMARY.md content is typically large enough to hit limits.
   - Recommendation: Use `--body-file` with a temp file for safety. Write the PR body to a temp file, pass `--body-file /tmp/pr-body.md`, delete after. This avoids shell escaping issues and argument length limits. However, this requires modifying `cmdGitCreatePr` to accept `--body-file` or handling it in the workflow. **For Plan 1, use `--body` with truncation at 4000 chars. If issues arise, switch to `--body-file` in a gap closure.**

2. **Should create_summary step be moved before create_pr_and_merge?**
   - What we know: The PR body needs SUMMARY.md content. Currently create_summary comes after build_gate.
   - What's unclear: Whether the summary template handles BUILD_GATE_RESULT correctly when summary is created before PR.
   - Recommendation: **Yes, reorder.** The summary already includes BUILD_GATE_RESULT via the variable set in the build_gate step. Moving summary creation earlier does not break anything since it only needs: task commits, build gate result, plan metadata -- all available after the build_gate step. The PR step then reads the summary file.

3. **Should the statusline show branch name?**
   - What we know: The statusline currently shows: model, task, directory, context%. Adding branch would require a git command on every prompt.
   - What's unclear: Whether the performance impact is acceptable.
   - Recommendation: **Defer to optional enhancement.** The progress.md display handles INTG-05. The statusline enhancement is nice-to-have but not required by any requirement. If implemented, cache the branch name and only refresh every 30 seconds.

4. **How to handle `git push` failures (no remote, SSH key issues)?**
   - What we know: `git push -u origin ${BRANCH}` can fail for many reasons.
   - What's unclear: How to degrade gracefully.
   - Recommendation: **If push fails, skip PR creation entirely.** Log: "Could not push branch to remote. Skipping PR creation. Plan code committed locally on branch ${BRANCH}." The plan's code is still safe in local git. PR creation is a convenience, not a requirement for code safety.

5. **Should `git git-status` be a new subcommand or extend `current-branch`?**
   - What we know: `current-branch` already returns `{ branch: "name" }`. Extending it with ahead/behind/PRs would change its interface.
   - What's unclear: Whether existing callers of `current-branch` would break.
   - Recommendation: **New subcommand `git-status`.** Keep `current-branch` simple (used by execute-phase for branch validation). The `git-status` subcommand is richer and used only by progress display.

## Sources

### Primary (HIGH confidence)

All findings based on direct source code reading of the existing codebase:

- `hive/bin/hive-tools.js` (5970+ lines): All Phase 8 git subcommands
  - Lines 5360-5384: `cmdGitCreatePr` -- accepts --base, --title, --body, calls `gh pr create`
  - Lines 5386-5407: `cmdGitSelfMergePr` -- accepts PR number, reads `git_merge_strategy`, calls `gh pr merge --{strategy} --delete-branch`
  - Lines 5409-5438: `cmdGitMergeDevToMain` -- checkout main/master, merge --no-ff dev, abort on conflict
  - Lines 5481-5507: `cmdGitDeletePlanBranch` -- protected branch safety, safe delete -d
  - Lines 5275-5282: `cmdGitCurrentBranch` -- returns current branch
  - Lines 5221-5253: `cmdGitDetect` -- git and gh version detection
  - Lines 175-245: `loadConfig` -- all git_* fields with defaults
- `hive/workflows/execute-plan.md`: Current plan execution flow with build gate step (Phase 9)
- `hive/workflows/execute-phase.md`: Current phase orchestration with branch lifecycle (Phase 9)
- `hive/workflows/complete-milestone.md`: Current milestone completion with legacy handle_branches
- `hive/workflows/progress.md`: Current progress display (no git status yet)
- `hooks/hive-statusline.js`: Current statusline hook (no branch display)
- `hive/templates/config.json`: Config template with `git.merge_strategy: "merge"` default
- `.planning/REQUIREMENTS.md`: PR-01/02/03/04, INTG-01/02/03/05 requirements
- `.planning/phases/09-branch-lifecycle-build-gates/09-01-SUMMARY.md`: Branch lifecycle completion details
- `.planning/phases/09-branch-lifecycle-build-gates/09-02-SUMMARY.md`: Build gate wiring details
- `.planning/phases/08-safety-configuration/08-02-SUMMARY.md`: Git subcommand implementation details

### Secondary (MEDIUM confidence)

- `gh pr create --help` (gh 2.86.0): Verified `--base`, `--title`, `--body`, `--body-file` flags
- `gh pr merge --help` (gh 2.86.0): Verified `--merge`, `--squash`, `--delete-branch`, `--admin` flags
- `git --version` (git 2.43.0): Confirmed merge-tree available (>= 2.38)

### Tertiary (LOW confidence)

None. All findings verified with primary sources.

## Metadata

**Confidence breakdown:**
- PR creation and self-merge: HIGH -- All subcommands exist and are tested; workflow integration is markdown-level changes
- Execute-phase branch cleanup: HIGH -- Phase 9 already placed the cleanup hooks; Phase 10 removes the "not yet merged" guard
- Complete-milestone dev-to-main: HIGH -- `cmdGitMergeDevToMain` already exists; workflow just needs to call it with Gate 3
- Progress display git status: HIGH -- Standard git commands; new subcommand is straightforward
- Step ordering: HIGH -- Analyzed dependency chain between build gate, summary, and PR body
- Edge cases (no gh, no remote): HIGH -- Degradation paths identified and documented

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (internal codebase patterns, unlikely to change)
