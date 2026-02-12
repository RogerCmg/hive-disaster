# Phase 11: Repo Manager - Research

**Researched:** 2026-02-12
**Domain:** Merge queue management, wave-aware merge ordering, conflict detection, Gate 2 pre-merge build validation, file-based inter-process signaling
**Confidence:** HIGH

## Summary

Phase 11 introduces a dedicated repo manager agent that owns the merge lifecycle: reading a merge queue, processing merges in wave-aware order, detecting conflicts before merge attempts, running Gate 2 (pre-merge) build validation on merge results, and communicating merge outcomes via file-based signals. This is the capstone phase for the v2.0 Git Flow milestone -- it adds the last layer of safety between plan branches and the dev integration branch.

All the git primitives already exist from Phase 8 (`check-conflicts`, `self-merge-pr`, `merge-dev-to-main`, `run-build-gate`, `delete-plan-branch`) and the workflow wiring from Phases 9-10 (branch lifecycle, PR creation, self-merge, Gate 3 dev-to-main). Phase 11 does NOT replace the Phase 10 single-terminal self-merge flow. Instead, it introduces an alternative merge path: the repo manager processes a merge queue (populated by execute-plan) and performs conflict detection + Gate 2 build validation before merging. In single-terminal mode, this gives the user an opt-in upgrade from "immediate self-merge" to "validated merge with pre-merge build gate."

The implementation requires: (1) new merge queue data structure in `.hive-workers/merge-queue.json`, (2) new hive-tools.js subcommands for queue operations, (3) a new `hive-repo-manager.md` agent definition, (4) a new `/hive:manage-repo` command + workflow, (5) modifications to `execute-plan.md` to submit to the merge queue instead of (or in addition to) self-merging, and (6) file-based signal files for communicating merge results.

**Primary recommendation:** Implement in 3 plans: Plan 1 covers merge queue data structure + hive-tools.js queue subcommands + Gate 2 pre-merge build validation (REPO-01, REPO-04, BUILD-02). Plan 2 covers the repo manager agent + command + workflow (REPO-02, REPO-03, REPO-05). Plan 3 covers execute-plan integration to submit to merge queue + Gate 3 refinement (BUILD-03 refinement, signal flow wiring).

## Standard Stack

### Core

No new libraries or dependencies. All changes compose existing Phase 8/9/10 primitives plus new JavaScript functions in hive-tools.js.

| Component | Already Exists | Purpose for Phase 11 | Location |
|-----------|---------------|---------------------|----------|
| `cmdGitCheckConflicts` | Yes (line 5479) | Conflict detection via merge-tree or dry-run | hive-tools.js |
| `cmdGitRunBuildGate` | Yes (line 5372) | Build validation for Gate 2 | hive-tools.js |
| `cmdGitSelfMergePr` | Yes (line 5425) | PR merge (used by repo manager after validation) | hive-tools.js |
| `cmdGitDeletePlanBranch` | Yes (line 5520) | Cleanup after merge | hive-tools.js |
| `cmdGitCurrentBranch` | Yes (line 5275) | Branch verification | hive-tools.js |
| `cmdGitMergeDevToMain` | Yes (line 5448) | Gate 3 dev-to-main (already wired in Phase 10) | hive-tools.js |
| `acquireLock` / `releaseLock` | Yes (line 282/339) | mkdir-based file locking for merge-queue.json | hive-tools.js |
| `atomicWriteFileSync` | Yes (line 347) | Atomic writes for merge-queue.json | hive-tools.js |
| `withFileLock` | Yes (line 362) | Lock + operation + unlock pattern | hive-tools.js |
| `execCommand` (spawnSync) | Yes (line 373) | All git/gh CLI invocations | hive-tools.js |
| `loadConfig` git fields | Yes (line 175) | flow, dev_branch, build_gates, merge_strategy | hive-tools.js |
| `detectBuildCommand` | Yes (line 391) | Build command detection for Gate 2 | hive-tools.js |
| execute-plan `create_pr_and_merge` | Yes (Phase 10) | Current single-terminal PR + self-merge flow | execute-plan.md |
| complete-milestone `merge_dev_to_main` | Yes (Phase 10) | Gate 3 + dev-to-main (already wired) | complete-milestone.md |

### New Components to Build

| Component | Purpose | Type |
|-----------|---------|------|
| `.hive-workers/merge-queue.json` | Merge request queue with pending/merged/dev_head | Data file |
| `hive-tools.js` queue subcommands | CRUD operations on merge queue: submit, process, status, drain | JavaScript |
| `hive-tools.js` Gate 2 subcommand | `git merge --no-commit` + build + `git merge --abort` | JavaScript |
| `agents/hive-repo-manager.md` | Agent definition for merge queue processor | Agent markdown |
| `commands/hive/manage-repo.md` | Thin command dispatcher | Command markdown |
| `hive/workflows/manage-repo.md` | Repo manager workflow (queue processing loop) | Workflow markdown |
| `.hive-workers/signals/` | File-based merge result signals | Signal files |

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| File-based merge queue | In-memory queue | State lost on crash. Multi-terminal needs disk persistence. |
| mkdir-based locks | flock CLI | flock not available on macOS (Pitfall #1 from PITFALLS.md). mkdir-based already implemented. |
| Polling for queue changes | inotifywait | Platform-specific (Linux only). Polling is simpler, cross-platform, and sufficient for v2.0. inotifywait deferred to v2.1+. |
| Separate Gate 2 subcommand | Reuse run-build-gate | Gate 2 requires `git merge --no-commit` setup and `git merge --abort` cleanup. Different lifecycle from Gate 1. Separate function is clearer. |
| Agent-based repo manager | Pure hive-tools.js loop | Agent has full Claude reasoning for conflict triage, retry decisions, user escalation. Pure loop lacks intelligence. |
| PR-based merge (gh pr merge) for repo manager | Local git merge | PR-based preserves GitHub audit trail. Consistent with Phase 10 flow. Allows future multi-terminal workers to submit PRs and have repo manager merge. |

## Architecture Patterns

### Recommended Project Structure

```
.hive-workers/                      # Worker coordination directory (gitignored)
  merge-queue.json                  # Ordered merge request queue
  signals/                          # File-based signaling
    merge-{plan-id}.result.json     # Merge result per plan
    dev-head.json                   # Current dev HEAD after merges
```

### Pattern 1: Merge Queue Data Structure (REPO-01)

**What:** A JSON file at `.hive-workers/merge-queue.json` stores ordered merge requests with status tracking.

**Structure:**

```json
{
  "queue": [
    {
      "id": "mr-001",
      "plan_id": "11-01",
      "phase": "11",
      "plan": "01",
      "branch": "hive/phase-11-01-merge-queue",
      "wave": 1,
      "status": "pending",
      "submitted_at": "2026-02-12T10:30:00Z",
      "pr_number": null,
      "pr_url": null,
      "checks": {
        "conflicts": null,
        "build": null
      },
      "error": null,
      "merged_at": null
    }
  ],
  "merged": [
    {
      "id": "mr-000",
      "plan_id": "10-03",
      "branch": "hive/phase-10-03-git-status",
      "merged_at": "2026-02-12T10:25:00Z",
      "merge_sha": "abc1234"
    }
  ],
  "dev_head": "abc1234",
  "last_updated": "2026-02-12T10:30:00Z"
}
```

**Status flow:** `pending` -> `checking` -> `building` -> `merging` -> `merged` (success path)
Alternative: `pending` -> `checking` -> `conflict` (conflict detected, not attempted)
Alternative: `pending` -> `checking` -> `building` -> `build_failed` (Gate 2 fail, merge aborted)
Alternative: `pending` -> `checking` -> `building` -> `merging` -> `merge_failed` (merge error)

**Key details:**
- `queue` contains items in submission order. The repo manager processes them in wave-aware order (wave 1 before wave 2).
- `merged` is a capped history (max 50 entries) for audit trail and rebuild capability.
- `dev_head` is the current dev branch HEAD SHA after the last merge. Workers read this to know when dev has updated.
- File is protected by mkdir-based locks during all writes.
- All writes use `atomicWriteFileSync` (temp+rename in same directory).

### Pattern 2: Wave-Aware Merge Ordering (REPO-03)

**What:** The repo manager processes queue entries in wave order, not submission order. Wave 1 entries are all processed before any Wave 2 entry.

**When to use:** Always. This preserves the dependency semantics from plan frontmatter.

**Algorithm:**

```
1. Read queue, filter to status === 'pending'
2. Group by wave number
3. Sort waves ascending (1, 2, 3, ...)
4. Process lowest wave first:
   a. For each entry in the wave (any order within wave):
      - Check conflicts (merge-tree)
      - If clean: run Gate 2 build, if pass: merge
      - If conflict: flag, skip this entry
   b. After all entries in wave processed:
      - If any entries conflicted: report, offer resolution
      - If all merged: proceed to next wave
5. Within a wave, prefer the entry with fewer changed files first (less likely to cause cascading conflicts)
```

**Key insight:** Plans within the same wave are designed to be independent (no `depends_on` between them). Wave ordering is the dependency enforcement mechanism. The repo manager MUST NOT merge a Wave 2 entry while Wave 1 entries are still pending.

### Pattern 3: Conflict Detection Before Merge (REPO-04)

**What:** Before attempting to merge a plan branch, run `git merge-tree --write-tree --no-messages dev plan-branch` to detect conflicts without modifying the worktree.

**When to use:** Always, before every merge attempt in the repo manager.

**Existing primitive:** `cmdGitCheckConflicts` (line 5479) already implements this with merge-tree (git >= 2.38) and dry-run fallback. Returns `{ success: true, has_conflicts: true/false, method: 'merge-tree' }`.

**Repo manager behavior on conflict:**
- `has_conflicts: false` -> proceed to Gate 2 build
- `has_conflicts: true` -> set queue status to `conflict`, write signal file, skip this entry. Try remaining entries in the wave. After wave, report conflicting entries to user.

**Key details:**
- merge-tree does NOT modify the index or working tree (safe for parallel checking)
- The existing `cmdGitCheckConflicts` checks git version and falls back to dry-run merge for older git
- For dry-run fallback, `git merge --abort` is called regardless of result (already implemented)

### Pattern 4: Gate 2 Pre-Merge Build Validation (BUILD-02)

**What:** Before merging a plan branch to dev, run the build on the merge result. This catches integration failures (plan works alone, but breaks when combined with current dev).

**Implementation:**

```javascript
function cmdGitRunGate2(cwd, branchName, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') { /* skip */ }

  const devBranch = config.git_dev_branch || 'dev';

  // 1. Ensure on dev
  execCommand('git', ['checkout', devBranch], { cwd });

  // 2. Merge plan branch without committing
  const mergeResult = execCommand('git', ['merge', '--no-commit', '--no-ff', branchName], { cwd });

  if (!mergeResult.success) {
    // Merge itself failed (conflict)
    execCommand('git', ['merge', '--abort'], { cwd });
    return output({ success: false, gate: 'pre_merge', error: 'merge_conflict', stderr: mergeResult.stderr }, raw, 'conflict');
  }

  // 3. Run build on merge result
  const buildCmd = config.git_build_command || detectBuildCommand(cwd).command;
  if (!buildCmd) {
    execCommand('git', ['merge', '--abort'], { cwd });
    return output({ success: true, gate: 'pre_merge', skipped: true, reason: 'no build command' }, raw, 'skipped');
  }

  const timeoutMs = (config.git_build_timeout || 300) * 1000;
  const parts = buildCmd.split(/\s+/);
  const buildResult = execCommand(parts[0], parts.slice(1), { cwd, timeout: timeoutMs });

  // 4. ALWAYS abort the merge (we tested the result, actual merge via gh pr merge)
  execCommand('git', ['merge', '--abort'], { cwd });

  output({
    success: buildResult.success,
    gate: 'pre_merge',
    command: buildCmd,
    exitCode: buildResult.exitCode,
    timedOut: buildResult.timedOut || false,
    stdout: buildResult.stdout.slice(0, 2000),
    stderr: buildResult.stderr.slice(0, 2000),
  }, raw, buildResult.success ? 'pass' : 'fail');
}
```

**Critical: Always `git merge --abort`** after Gate 2 regardless of build result. The actual merge is done via `gh pr merge` (or `git merge` if gh unavailable), not by committing the test merge. This prevents leaving the working tree in a dirty merge state (Pitfall #9 from PITFALLS.md).

**Difference from Gate 1 (pre-PR) and Gate 3 (pre-main):**
- Gate 1: Runs on the plan branch BEFORE PR creation. Tests the plan in isolation. Already wired in Phase 9/10.
- Gate 2: Runs on the MERGE RESULT of dev + plan branch. Tests integration. New in Phase 11.
- Gate 3: Runs on the dev branch BEFORE dev-to-main merge. Tests the final integration. Already wired in Phase 10.

### Pattern 5: File-Based Signaling (REPO-05)

**What:** Workers and the repo manager communicate merge outcomes via signal files in `.hive-workers/signals/`.

**Signal types:**

1. **Merge result signal** (repo manager -> workers):
   ```json
   // .hive-workers/signals/merge-{plan_id}.result.json
   {
     "plan_id": "11-01",
     "status": "merged",
     "merge_sha": "abc1234",
     "dev_head": "abc1234",
     "timestamp": "2026-02-12T10:31:00Z"
   }
   ```

2. **Dev head update signal** (repo manager -> all workers):
   ```json
   // .hive-workers/signals/dev-head.json
   {
     "sha": "abc1234",
     "updated_at": "2026-02-12T10:31:00Z",
     "last_merged": "11-01"
   }
   ```

3. **Merge request submission** (worker -> repo manager):
   Done by writing to `merge-queue.json` via `hive-tools.js git queue-submit`.

**Signaling flow:**
1. Worker completes plan, calls `hive-tools.js git queue-submit` -> writes to merge-queue.json
2. Repo manager reads queue, processes entry, writes merge result signal
3. Worker polls for signal file (or execute-phase reads signal after repo manager completes)
4. Repo manager updates dev-head.json after each merge

**In single-terminal mode:** The repo manager runs in the same terminal. Signaling is synchronous -- the repo manager processes the queue and the result is immediately available. Signal files serve as durable state (crash recovery) and future multi-terminal compatibility.

### Pattern 6: Repo Manager Agent (REPO-02)

**What:** A dedicated agent (`hive-repo-manager.md`) that reads the merge queue and processes pending merges.

**Agent responsibilities:**
1. Read merge-queue.json
2. Process entries in wave-aware order
3. For each entry: check conflicts -> Gate 2 build -> merge PR -> write signal
4. Report results to user
5. Handle conflicts (flag, skip, offer resolution)
6. Handle build failures (flag, skip, offer investigation)

**Invocation:** `/hive:manage-repo` command launches the agent. In single-terminal mode, this is called by execute-phase after all plans in a wave are complete (or manually by the user). In future multi-terminal mode, this runs in a dedicated terminal.

**Agent prompt structure:**
```markdown
<role>
You are a Hive repo manager. You process the merge queue, validate merges,
and ensure clean integration to dev.
</role>

<process>
1. Read .hive-workers/merge-queue.json
2. If no pending entries: report "Queue empty. Nothing to merge."
3. Group pending entries by wave
4. For lowest wave with pending entries:
   a. For each pending entry:
      - Check conflicts: hive-tools.js git check-conflicts --branch {branch}
      - If conflict: set status "conflict", write signal, skip
      - Run Gate 2: hive-tools.js git run-gate-2 --branch {branch}
      - If build fails: set status "build_failed", write signal, skip
      - Merge: hive-tools.js git self-merge-pr {pr_number}
      - If merge fails: set status "merge_failed", write signal, report
      - If success: set status "merged", write signal, update dev_head
   b. Report wave results
5. Proceed to next wave
6. After all waves: report summary
</process>
```

### Pattern 7: Execute-Plan Queue Submission Integration

**What:** The execute-plan workflow submits to the merge queue instead of (or in addition to) self-merging.

**Current flow (Phase 10):** After build gate -> create summary -> push branch -> create PR -> self-merge PR -> checkout dev.

**Phase 11 modification:** Add a queue submission path. When a repo manager is active (or configured), instead of self-merging, the executor submits to the queue and leaves merging to the repo manager.

**Decision logic:**
```
if config.git.repo_manager === true:
  # Queue-based path (repo manager handles merge)
  push branch -> create PR -> submit to queue -> done (repo manager merges later)
else:
  # Self-merge path (current Phase 10 behavior, unchanged)
  push branch -> create PR -> self-merge -> checkout dev
```

**Key: Phase 10 self-merge flow MUST remain as the default.** The repo manager path is opt-in via config. This preserves backward compatibility.

### Anti-Patterns to Avoid

- **Processing queue entries out of wave order:** Wave 2 entries must NEVER be processed while Wave 1 entries are pending. This is the core dependency enforcement mechanism.
- **Skipping `git merge --abort` after Gate 2:** Leaving a `--no-commit` merge state causes all subsequent git operations to fail with "You have not concluded your merge."
- **Writing merge-queue.json without file locking:** Concurrent read-modify-write corrupts the queue. Always use `withFileLock()`.
- **Storing sensitive data in signal files:** No tokens, no auth info. Only plan IDs, SHAs, timestamps, statuses.
- **Blocking on conflict detection:** A conflicting entry should be flagged and skipped, not block the entire wave. Other non-conflicting entries in the same wave can proceed.
- **Running Gate 2 on the plan branch instead of the merge result:** Gate 2 validates INTEGRATION (dev + plan), not the plan in isolation. That is Gate 1's job.
- **Adding `.hive-workers/` to git:** This directory must be gitignored. It contains runtime state, not project code.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File locking | Custom lock files, flock CLI | `acquireLock`/`releaseLock` (existing) | Already implemented with mkdir-based locking, stale detection, retry. Cross-platform. |
| Atomic file writes | `fs.writeFileSync` directly | `atomicWriteFileSync` (existing) | Temp+rename in same directory. Crash-safe. |
| Conflict detection | Raw `git merge` attempts | `cmdGitCheckConflicts` (existing) | merge-tree detection with fallback. No worktree modification. |
| Build command detection | Hardcoded build commands | `detectBuildCommand` (existing) | Package.json, Cargo.toml, go.mod, Makefile detection with npm default placeholder detection. |
| PR merge | Raw `gh pr merge` calls | `cmdGitSelfMergePr` (existing) | Reads merge strategy from config. --delete-branch flag. Structured JSON output. |
| Git version detection | Assume modern git | `cmdGitDetect` (existing) | Returns git version + merge-tree availability. |

**Key insight:** Phase 11 is a COMPOSITION and ORCHESTRATION phase. Most primitives exist. The new code is: queue data structure, queue CRUD operations, Gate 2 (merge --no-commit + build + abort), repo manager agent/workflow, signal files. No new npm dependencies.

## Common Pitfalls

### Pitfall 1: Gate 2 Leaves Merge State on Timeout/Crash

**What goes wrong:** `git merge --no-commit` creates a merge state in the index. If the build gate times out or the process crashes, the merge state persists. All subsequent git operations fail with "You have not concluded your merge" or "Uncommitted changes would be overwritten."
**Why it happens:** Timeout kills the build process but not the git merge state. Crash skips the `git merge --abort` cleanup.
**How to avoid:** Use try/finally pattern. The `git merge --abort` MUST run on ALL exit paths: success, failure, timeout, exception. Additionally, at repo manager startup, check for leftover merge state: `git merge HEAD` (returns error if in merge state) and run `git merge --abort` as cleanup.
**Warning signs:** "MERGE_HEAD exists" errors. Build gate failures that succeed on manual retry.

### Pitfall 2: Merge Queue Corruption from Concurrent Writes

**What goes wrong:** Multiple processes (executor submitting, repo manager updating status) write to merge-queue.json simultaneously. Classic TOCTOU race condition.
**Why it happens:** `JSON.parse(readFileSync(...))` + modify + `writeFileSync(...)` is not atomic.
**How to avoid:** ALL queue operations go through `withFileLock(queuePath, fn)`. Never read-modify-write outside a lock. Use `atomicWriteFileSync` inside the lock.
**Warning signs:** Lost merge requests. Duplicate entries. Malformed JSON.

### Pitfall 3: Wave Ordering Violated During Partial Failures

**What goes wrong:** Wave 1 has plans A, B, C. A merges. B has a conflict. C merges. Repo manager proceeds to Wave 2. But B's code was expected by Wave 2 dependencies.
**Why it happens:** Treating each entry independently instead of wave-as-a-unit.
**How to avoid:** After processing all entries in a wave, check if any are in `conflict` or `build_failed` status. If so, DO NOT proceed to the next wave. Report the blocked entries and wait for resolution.
**Warning signs:** Wave 2 plans failing due to missing code from a skipped Wave 1 plan.

### Pitfall 4: Signal Files Not Cleaned Up

**What goes wrong:** Signal files accumulate across phases and milestones. `.hive-workers/signals/` grows unbounded.
**Why it happens:** No cleanup mechanism.
**How to avoid:** After the repo manager finishes processing all queued entries, clean up signal files for merged entries. Keep signal files for failed/conflict entries until resolution. Add a `queue drain` subcommand that clears all processed signals.
**Warning signs:** Hundreds of signal files after many phases. Slow directory listing.

### Pitfall 5: Repo Manager Runs on Wrong Branch

**What goes wrong:** Gate 2 runs `git merge --no-commit` but the repo manager is not on the dev branch. The merge targets the wrong branch.
**Why it happens:** Previous operation left the working tree on a plan branch or main.
**How to avoid:** At repo manager startup and before each merge cycle, explicitly checkout dev: `git checkout ${dev_branch}`. Verify with `git branch --show-current`. If not on dev, abort.
**Warning signs:** Merges landing on wrong branch. Dev branch not advancing.

### Pitfall 6: Self-Merge Still Runs When Repo Manager Is Active

**What goes wrong:** execute-plan self-merges the PR, then the repo manager also tries to merge the same PR. Double merge attempt.
**Why it happens:** Phase 10 self-merge flow not properly gated when repo manager is active.
**How to avoid:** When `config.git.repo_manager` is true, execute-plan MUST skip the self-merge step and instead submit to the queue. The `create_pr_and_merge` step in execute-plan.md needs a new branch:
```
if REPO_MANAGER_ACTIVE: push + create PR + submit to queue (skip self-merge)
else: push + create PR + self-merge (existing Phase 10 flow)
```
**Warning signs:** "PR already merged" errors from the repo manager.

## Code Examples

### Example 1: Queue Submit Subcommand

```javascript
function cmdGitQueueSubmit(cwd, options, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const { plan_id, phase, plan, branch, wave, pr_number, pr_url } = options;
  if (!plan_id || !branch) {
    output({ success: false, error: 'plan_id and branch required' }, raw, '');
    return;
  }

  const queuePath = path.join(cwd, '.hive-workers', 'merge-queue.json');

  // Ensure directory exists
  const dir = path.dirname(queuePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  withFileLock(queuePath, () => {
    // Read current queue (or create empty)
    let data = { queue: [], merged: [], dev_head: null, last_updated: null };
    try {
      data = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    } catch {
      // File doesn't exist or corrupt — start fresh
    }

    // Generate merge request ID
    const id = 'mr-' + String(data.queue.length + data.merged.length + 1).padStart(3, '0');

    // Add entry
    data.queue.push({
      id,
      plan_id: plan_id,
      phase: phase || plan_id.split('-')[0],
      plan: plan || plan_id.split('-')[1],
      branch,
      wave: parseInt(wave, 10) || 1,
      status: 'pending',
      submitted_at: new Date().toISOString(),
      pr_number: pr_number ? parseInt(pr_number, 10) : null,
      pr_url: pr_url || null,
      checks: { conflicts: null, build: null },
      error: null,
      merged_at: null,
    });
    data.last_updated = new Date().toISOString();

    atomicWriteFileSync(queuePath, JSON.stringify(data, null, 2));
  });

  output({ success: true, id: data.queue[data.queue.length - 1].id, plan_id }, raw, plan_id);
}
```

### Example 2: Gate 2 Pre-Merge Build Subcommand

```javascript
function cmdGitRunGate2(cwd, branchName, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  if (!branchName) {
    output({ success: false, error: 'branch name required (--branch <name>)' }, raw, '');
    return;
  }

  // Check if Gate 2 is enabled
  if (!config.git_build_gates_pre_merge) {
    output({ success: true, skipped: true, reason: 'pre_merge gate disabled' }, raw, 'skipped');
    return;
  }

  const devBranch = config.git_dev_branch || 'dev';

  // Ensure on dev
  execCommand('git', ['checkout', devBranch], { cwd });

  // Clean any leftover merge state (crash recovery)
  execCommand('git', ['merge', '--abort'], { cwd });

  // Merge plan branch without committing
  const mergeResult = execCommand('git', ['merge', '--no-commit', '--no-ff', branchName], { cwd });

  if (!mergeResult.success) {
    // Merge conflict — abort and report
    execCommand('git', ['merge', '--abort'], { cwd });
    output({
      success: false,
      gate: 'pre_merge',
      error: 'merge_conflict',
      branch: branchName,
      stderr: mergeResult.stderr.slice(0, 2000),
    }, raw, 'conflict');
    return;
  }

  // Run build on merge result
  const buildCmd = config.git_build_command || detectBuildCommand(cwd).command;
  if (!buildCmd) {
    execCommand('git', ['merge', '--abort'], { cwd });
    output({ success: true, gate: 'pre_merge', skipped: true, reason: 'no build command' }, raw, 'skipped');
    return;
  }

  const timeoutMs = (config.git_build_timeout || 300) * 1000;
  const parts = buildCmd.split(/\s+/);
  let buildResult;
  try {
    buildResult = execCommand(parts[0], parts.slice(1), { cwd, timeout: timeoutMs });
  } finally {
    // ALWAYS abort — actual merge via gh pr merge or git merge
    execCommand('git', ['merge', '--abort'], { cwd });
  }

  output({
    success: buildResult.success,
    gate: 'pre_merge',
    branch: branchName,
    command: buildCmd,
    exitCode: buildResult.exitCode,
    timedOut: buildResult.timedOut || false,
    stdout: buildResult.stdout.slice(0, 2000),
    stderr: buildResult.stderr.slice(0, 2000),
  }, raw, buildResult.success ? 'pass' : 'fail');
}
```

### Example 3: Queue Status Subcommand

```javascript
function cmdGitQueueStatus(cwd, raw) {
  const queuePath = path.join(cwd, '.hive-workers', 'merge-queue.json');

  let data = { queue: [], merged: [], dev_head: null };
  try {
    data = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  } catch {
    output({ success: true, empty: true, queue: [], merged: [], dev_head: null }, raw, 'empty');
    return;
  }

  const pending = data.queue.filter(e => e.status === 'pending');
  const checking = data.queue.filter(e => ['checking', 'building', 'merging'].includes(e.status));
  const failed = data.queue.filter(e => ['conflict', 'build_failed', 'merge_failed'].includes(e.status));
  const merged = data.merged || [];

  output({
    success: true,
    pending_count: pending.length,
    in_progress_count: checking.length,
    failed_count: failed.length,
    merged_count: merged.length,
    dev_head: data.dev_head,
    last_updated: data.last_updated,
    pending,
    failed,
  }, raw, `${pending.length} pending, ${merged.length} merged`);
}
```

### Example 4: Signal File Write

```javascript
function writeMergeSignal(cwd, planId, status, details) {
  const signalDir = path.join(cwd, '.hive-workers', 'signals');
  if (!fs.existsSync(signalDir)) {
    fs.mkdirSync(signalDir, { recursive: true });
  }

  const signalPath = path.join(signalDir, `merge-${planId}.result.json`);
  const data = {
    plan_id: planId,
    status,
    ...details,
    timestamp: new Date().toISOString(),
  };

  atomicWriteFileSync(signalPath, JSON.stringify(data, null, 2));
}

function writeDevHeadSignal(cwd, sha, lastMerged) {
  const signalDir = path.join(cwd, '.hive-workers', 'signals');
  if (!fs.existsSync(signalDir)) {
    fs.mkdirSync(signalDir, { recursive: true });
  }

  const signalPath = path.join(signalDir, 'dev-head.json');
  const data = {
    sha,
    updated_at: new Date().toISOString(),
    last_merged: lastMerged,
  };

  atomicWriteFileSync(signalPath, JSON.stringify(data, null, 2));
}
```

### Example 5: Repo Manager Workflow Loop

```markdown
<step name="process_queue">
**Process merge queue in wave-aware order.**

```bash
QUEUE_STATUS=$(node ~/.claude/hive/bin/hive-tools.js git queue-status --raw)
PENDING=$(echo "$QUEUE_STATUS" | jq -r '.pending_count')
```

If PENDING is 0: "Queue empty. Nothing to merge." Exit.

Group pending entries by wave:

```bash
WAVES=$(echo "$QUEUE_STATUS" | jq -r '[.pending[].wave] | unique | sort | .[]')
```

For each wave (ascending):

```bash
WAVE_ENTRIES=$(echo "$QUEUE_STATUS" | jq -r "[.pending[] | select(.wave == ${WAVE})]")
```

For each entry in wave:

1. **Conflict check:**
   ```bash
   CONFLICTS=$(node ~/.claude/hive/bin/hive-tools.js git check-conflicts --branch "${BRANCH}" --raw)
   HAS_CONFLICTS=$(echo "$CONFLICTS" | jq -r '.has_conflicts')
   ```

   If has_conflicts true:
   - Update queue status: `node ~/.claude/hive/bin/hive-tools.js git queue-update --id "${ID}" --status conflict`
   - Write signal: merge result with status "conflict"
   - Skip to next entry

2. **Gate 2 build:**
   ```bash
   GATE2=$(node ~/.claude/hive/bin/hive-tools.js git run-gate-2 --branch "${BRANCH}" --raw)
   GATE2_SUCCESS=$(echo "$GATE2" | jq -r '.success')
   ```

   If failed:
   - Update queue status: `queue-update --id "${ID}" --status build_failed`
   - Write signal: merge result with status "build_failed"
   - Present to user: "Gate 2 failed for ${PLAN_ID}. Fix/Skip/Stop?"
   - If fix: investigate, commit fix to plan branch, retry gate
   - If skip: move to next entry
   - If stop: halt processing

3. **Merge:**
   ```bash
   MERGE=$(node ~/.claude/hive/bin/hive-tools.js git self-merge-pr "${PR_NUMBER}" --raw)
   MERGE_SUCCESS=$(echo "$MERGE" | jq -r '.success')
   ```

   If success:
   - Update queue: status "merged", record merge SHA
   - Move entry from queue to merged
   - Write merge signal
   - Update dev-head signal
   - Log: "Merged ${PLAN_ID} to dev (PR #${PR_NUMBER})"

   If failure:
   - Update queue: status "merge_failed"
   - Write signal
   - Report to user

After wave complete:
- Check if any entries in wave have conflict/build_failed/merge_failed
- If yes: DO NOT proceed to next wave. Report blockers.
- If all merged: proceed to next wave.
</step>
```

## State of the Art

| Phase 10 State | Phase 11 Change | Impact |
|---------------|----------------|--------|
| Single-terminal self-merge (immediate) | Opt-in queue-based merge with validation | Pre-merge build gate catches integration failures |
| No merge queue | `.hive-workers/merge-queue.json` with CRUD ops | Durable merge state, crash-recoverable, future multi-terminal ready |
| No conflict pre-check before merge | merge-tree conflict detection before every merge | Conflicting merges flagged, not attempted |
| Gate 1 (pre-PR) + Gate 3 (pre-main) | Gate 2 (pre-merge) added between PR and merge | Three-gate build validation chain complete |
| No file-based signaling | Signal files in `.hive-workers/signals/` | Worker-manager communication, dev head tracking |
| No dedicated merge agent | hive-repo-manager agent + /hive:manage-repo | Intelligent merge processing with conflict triage |

**Compatibility notes:**
- When `git.flow` is `"none"`: all Phase 11 features are bypassed. Zero behavior change.
- When repo manager is not configured (default): Phase 10 self-merge flow continues as-is.
- The repo manager is an OPT-IN upgrade path, not a replacement for self-merge.
- `.hive-workers/` must be added to `.gitignore` during setup.

## Open Questions

1. **Should `.hive-workers/` be gitignored automatically or manually?**
   - What we know: `.hive-workers/` contains runtime state (merge queue, signals). It should NOT be committed to git.
   - What's unclear: Whether to auto-add to `.gitignore` during init or document as a manual step.
   - Recommendation: **Auto-add during the first queue-submit call.** Check `.gitignore` for `.hive-workers/` entry. If missing, append it. This is a one-time operation, not every call.

2. **Should the repo manager run automatically in execute-phase or be manual?**
   - What we know: In single-terminal mode, the user runs `/hive:manage-repo` after plans complete. In future multi-terminal, it runs in a dedicated terminal.
   - What's unclear: Whether execute-phase should automatically invoke the repo manager after each wave.
   - Recommendation: **Start with manual invocation (`/hive:manage-repo`) for v2.0.** Auto-invocation from execute-phase can be added as a gap closure or in v2.1 multi-terminal. This keeps the system modular and debuggable.

3. **Should the merged history in merge-queue.json be capped?**
   - What we know: Across a large milestone with many phases, the merged array could grow large.
   - What's unclear: At what size JSON parsing becomes noticeable.
   - Recommendation: **Cap at 50 entries.** When adding a new merged entry, if count > 50, remove the oldest. 50 is enough for audit trail and queue rebuild. JSON parsing of 50 entries is < 1ms.

4. **How should the config flag for repo manager be named?**
   - What we know: Need a config toggle to switch between self-merge (Phase 10) and queue-based merge (Phase 11).
   - What's unclear: Best naming convention.
   - Recommendation: **`git.repo_manager: true/false`** (default: false). When true, execute-plan submits to queue instead of self-merging. When false, Phase 10 self-merge behavior unchanged.

5. **Should Gate 2 run on the plan branch or on the dev branch with --no-commit merge?**
   - What we know: Success criteria #3 says "Gate 2 runs the build on the merge result via `git merge --no-commit`."
   - What's unclear: N/A -- the requirement is explicit.
   - Recommendation: **Run on dev with `git merge --no-commit` of the plan branch.** This tests integration, not isolation. Always `git merge --abort` after, regardless of result.

## Sources

### Primary (HIGH confidence)

All findings based on direct source code reading of the existing codebase:

- `hive/bin/hive-tools.js` (6013 lines): All Phase 8 git subcommands, safety primitives (acquireLock, atomicWriteFileSync, withFileLock, execCommand)
  - Lines 282-337: `acquireLock` -- mkdir-based locking with stale detection and retry
  - Lines 339-345: `releaseLock` -- best-effort lock removal
  - Lines 347-360: `atomicWriteFileSync` -- temp+rename in same directory
  - Lines 362-369: `withFileLock` -- lock + operation + unlock
  - Lines 373-389: `execCommand` -- spawnSync wrapper with structured output
  - Lines 391-430: `detectBuildCommand` -- package.json, Cargo.toml, go.mod, Makefile
  - Lines 5372-5397: `cmdGitRunBuildGate` -- Gate 1/3 build validation
  - Lines 5479-5518: `cmdGitCheckConflicts` -- merge-tree (>= 2.38) with dry-run fallback
  - Lines 5425-5446: `cmdGitSelfMergePr` -- PR merge with configurable strategy
  - Lines 5520-5546: `cmdGitDeletePlanBranch` -- safe branch delete with protection
  - Lines 5965-6006: CLI router git dispatch section
- `.claude/hive/workflows/execute-plan.md`: Current plan execution flow with Phase 10 PR creation/self-merge
- `.claude/hive/workflows/execute-phase.md`: Current phase orchestration with wave execution and branch lifecycle
- `.claude/hive/workflows/complete-milestone.md`: Phase 10 Gate 3 + merge-dev-to-main
- `.planning/REQUIREMENTS.md`: REPO-01 through REPO-05, BUILD-02, BUILD-03
- `.planning/ROADMAP.md`: Phase 11 success criteria and requirements mapping
- `.planning/research/ARCHITECTURE.md`: Full architecture design for repo manager integration
- `.planning/research/GIT-WORKFLOW-RECOMMENDATIONS.md`: Merge queue format, repo manager loop design, signal patterns
- `.planning/research/PITFALLS.md`: Pitfalls #1 (flock), #5 (queue corruption), #8 (execSync merge-tree), #9 (timeout cleanup)
- `.planning/phases/10-pr-workflow-integration/10-RESEARCH.md`: Phase 10 research showing current PR flow
- `.planning/phases/08-safety-configuration/08-02-SUMMARY.md`: Phase 8 git subcommand implementation details
- `.planning/phases/10-pr-workflow-integration/10-VERIFICATION.md`: Phase 10 verification confirming all integration points

### Secondary (MEDIUM confidence)

- `git merge-tree --help` (git 2.43.0): Verified `--write-tree --no-messages` flags, exit code semantics
- `git merge --help`: Verified `--no-commit --no-ff` and `--abort` behavior
- Existing codebase git version: 2.43.0 (confirmed merge-tree available)

### Tertiary (LOW confidence)

None. All findings verified with primary sources.

## Metadata

**Confidence breakdown:**
- Merge queue data structure: HIGH -- Follows established patterns from research/ARCHITECTURE.md and research/GIT-WORKFLOW-RECOMMENDATIONS.md, plus existing safety primitives proven in Phase 8
- Gate 2 pre-merge build: HIGH -- `git merge --no-commit` + build + `git merge --abort` is a well-documented pattern. Existing `run-build-gate` provides the build execution template.
- Conflict detection: HIGH -- `cmdGitCheckConflicts` already exists and is tested. Repo manager just calls it.
- Wave-aware ordering: HIGH -- Wave structure already established in plan frontmatter and execute-phase orchestration. Repo manager reads the wave field.
- File-based signaling: HIGH -- Follows Hive's core communication pattern (files on disk). Uses existing atomicWriteFileSync.
- Agent/command/workflow: HIGH -- Follows established patterns from all 12 existing agents, 30 commands, 30 workflows.
- Execute-plan integration: MEDIUM -- Requires modifying Phase 10's `create_pr_and_merge` step with a config-gated branch. Need to ensure backward compatibility.

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (internal codebase patterns, unlikely to change)
