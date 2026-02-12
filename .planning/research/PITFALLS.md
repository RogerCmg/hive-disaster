# Domain Pitfalls: Git Workflow Integration for Hive v2.0

**Domain:** Adding professional git workflow automation (branching, build gates, PRs, merge queues) to an AI agent orchestration system
**Researched:** 2026-02-12
**Confidence:** HIGH (verified across official docs, issue trackers, real-world AI agent orchestration projects)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or architectural dead ends.

### Pitfall 1: flock(1) Does Not Exist on macOS

**What goes wrong:**
The `flock` shell command (planned for file locking of merge-queue.json, registry.json, etc.) is **not installed by default on macOS**. macOS ships with the `flock(2)` system call but NOT the `flock(1)` CLI utility from util-linux. Any `flock` shell commands will fail immediately on Mac with "command not found." Additionally, WSL1 has a bug where flock directory locks are not exclusive.

**Why it happens:**
Linux developers assume `flock` is universally available because it ships with every Linux distro. macOS uses BSD userland, not GNU, and does not include util-linux.

**Consequences:** File locking is the foundation of merge queue and worker registry safety. If locking does not work, concurrent access corrupts shared state files.

**Prevention:**
Do NOT use the `flock` shell command. Implement ALL file locking in Node.js:
1. **`proper-lockfile` npm package** (recommended) -- Uses mkdir-based locking which is atomic on all filesystems including network mounts. Zero native dependencies.
2. **`fs.open()` with `O_EXCL` flag** -- Creates a lockfile atomically. Works on all Node.js platforms.
3. All locking must happen inside hive-tools.js, never as shell commands.

**Detection:** Test file locking on macOS. If tests only pass on Linux, this bug is active.

**Phase to address:** Phase 1 (Foundation). File locking is required before merge-queue.json or registry.json can be safely used.

---

### Pitfall 2: Git index.lock Contention with Claude Code Background Operations

**What goes wrong:**
Claude Code runs background `git status --porcelain` that creates `.git/index.lock` files. These locks persist for 20+ seconds AFTER the git process exits (confirmed bug: anthropics/claude-code#11005, reproduced with timing evidence). When Hive agents run git operations (commits, status checks, branch operations), they collide with these stale locks: `fatal: Unable to create '.git/index.lock': File exists`. Frequency: 2-3 stale locks per minute during active use. ZSH with oh-my-zsh makes it 10x worse (180 vs 16 git status calls per session).

**Why it happens:**
Claude Code polls git status frequently for its UI state. The lock persists because of a file descriptor leak or filesystem delay -- the lock file exists but no process holds it (`lsof` shows nothing).

**Consequences:** Intermittent commit failures during plan execution. Agents interpret this as a git error and may try to "fix" a non-existent problem, wasting context and time.

**Prevention:**
1. **Use `--no-optional-locks` for ALL read-only git operations** in hive-tools.js. This flag (Git 2.15+) prevents lock creation during status/diff: `git --no-optional-locks status --porcelain`
2. **Set `GIT_OPTIONAL_LOCKS=0` as environment variable** for Hive sessions
3. **Implement lock-aware retry for write operations**: attempt -> if EEXIST on index.lock -> wait 2s -> check if lock is stale (no PID holds it) -> remove if stale -> retry (max 3 attempts, exponential backoff)
4. **Worktrees provide index isolation**: Each worktree has its own index file, avoiding contention with the main working tree

**Detection:** Intermittent "index.lock: File exists" errors, especially on macOS. Build gate failures that succeed on retry.

**Phase to address:** Phase 1 (Foundation). Every git operation in hive-tools.js must use `--no-optional-locks` for reads and retry-with-backoff for writes.

---

### Pitfall 3: gh pr create Hangs in Interactive Mode

**What goes wrong:**
`gh pr create` drops into interactive mode and hangs indefinitely when:
1. **Branch not pushed** -- gh prompts to push it
2. **Missing --title or --body** -- gh opens an interactive editor
3. **Multiple remotes / fork repos** -- gh asks "Which should be the base repository?" (cli/cli#5848)
4. **No remote tracking branch** -- gh prompts for remote selection

The agent hangs waiting for input that never comes. No timeout, no error -- just a frozen process consuming context window until killed.

**Why it happens:**
gh CLI is designed for interactive human use first. Non-interactive mode requires explicit flags. The v2.18.0+ versions changed non-interactive behavior, breaking existing scripts (cli/cli#6468). Even `--fill` does not suppress all prompts.

**Consequences:** Agent hangs during PR creation step. User discovers 10+ minutes later that execution stalled. The plan's work is complete but unsubmitted.

**Prevention:**
Always use the fully-specified non-interactive form:
```
git push -u origin "$BRANCH_NAME"     # Push FIRST, explicitly
gh pr create \
  --base "$DEV_BRANCH" \
  --head "$BRANCH_NAME" \
  --title "$PR_TITLE" \
  --body "$PR_BODY" \
  --repo "$REPO_OWNER/$REPO_NAME"     # Eliminates "which repo?" prompt
```

Additional safeguards:
- Pipe stdin from /dev/null: `< /dev/null gh pr create ...` (prevents any prompt)
- Set `GH_PROMPT_DISABLED=1` environment variable
- Validate remote exists before PR creation: `git remote get-url origin`
- Validate branch is pushed: `git ls-remote --heads origin "$BRANCH_NAME"`
- Timeout all gh commands (30 seconds max)

**Detection:** Agent "hangs" during PR creation with no output. gh commands work in manual testing but fail when run by agents.

**Phase to address:** Phase 1 (Foundation). Wrap ALL gh commands in a non-interactive helper in hive-tools.js with stdin redirection, required flags, and timeout.

---

### Pitfall 4: gh CLI Not Installed or Not Authenticated (Late Discovery)

**What goes wrong:**
The entire PR/merge workflow fails when:
1. `gh` is not installed (fresh environments, CI containers)
2. `gh` is installed but not authenticated (`gh auth status` non-zero)
3. Token expired or lacks required scopes (repo, workflow)
4. `GITHUB_TOKEN` env var conflicts with `gh auth` credentials

Hive completes all tasks, commits all code, then fails at the PR creation step -- wasting the full plan execution time with no PR to show for it.

**Why it happens:**
Build tools and `git` work without GitHub authentication. The gh auth check is deferred until the first gh command, which happens at the END of the workflow.

**Consequences:** Completed code on local branches with no PR. User must create PRs manually or re-run with auth.

**Prevention:**
Pre-flight check during `hive-tools.js init execute-phase` (BEFORE agent spawn):
```
GH_AVAILABLE = command -v gh exists
GH_AUTHED = gh auth status --json user succeeds
```

Include `gh_available` and `gh_authenticated` in the init JSON. Check BEFORE spawning agents.

**Graceful degradation chain:**
1. gh authenticated with repo scope -> full PR workflow
2. gh installed but not authenticated -> warn, offer `gh auth login`, or proceed without PRs
3. gh not installed -> warn, set `auto_pr: false` for this session, branch-only workflow
4. No remote configured -> local-only mode, branches without PRs

**Detection:** "gh: command not found" or "HTTP 401" after a 10-minute plan execution.

**Phase to address:** Phase 1 (Foundation). Pre-flight checks in init must validate before agents spawn.

---

### Pitfall 5: Merge Queue JSON Corruption from Concurrent Read-Modify-Write

**What goes wrong:**
Multiple agents simultaneously read merge-queue.json, modify it (add their entry, update status), and write back. Classic TOCTOU race: Agent A reads v1, Agent B reads v1, Agent A writes v2a, Agent B writes v2b (overwrites A's changes). Result: lost merge requests, duplicate entries, malformed JSON. This exact pattern caused .claude.json corruption with 30+ concurrent sessions (anthropics/claude-code#18998).

**Why it happens:**
`JSON.parse(fs.readFileSync(...))` + modify + `fs.writeFileSync(...)` is not atomic. Even with locking, if the lock is not held across the ENTIRE read-modify-write cycle, data is lost.

**Consequences:** Lost merge requests -- a completed plan never gets merged because its queue entry was overwritten. Workers think they submitted; repo manager never sees it.

**Prevention:**
All queue operations through a single function in hive-tools.js:
1. Acquire lock (proper-lockfile with stale detection and retry)
2. Read current state (inside lock)
3. Modify in memory
4. Write to temp file in SAME directory (`.merge-queue.json.tmp.${pid}`)
5. fsync temp file
6. Atomic rename temp -> merge-queue.json
7. Release lock

Additional safeguards:
- JSON schema validation on every read
- If JSON is corrupt: rebuild from git branch state (`git branch --list 'hive/*'`)
- Max file age check: >1 hour old with pending items = something is stuck

**Detection:** Simulate concurrent access -- two `hive-tools merge-queue submit` in rapid succession. Both entries must appear.

**Phase to address:** Phase 2 (Repo Manager). But the atomic file write pattern should be established in Phase 1.

---

### Pitfall 6: Orphaned Worktrees and Branches After Agent Crashes

**What goes wrong:**
Agent crashes mid-execution (context limit, Claude Code bug, user Ctrl+C). The worktree directory remains. The branch is "locked" to the worktree in `.git/worktrees/`. Cascade: `git worktree add -b hive/plan-branch` fails (branch exists). `git branch -D` fails (branch checked out in worktree). New execution cannot reuse plan branch name. Documented in Auto-Claude#694 and git worktree gotcha blog posts.

**Why it happens:**
Agent crashes are EXPECTED in AI systems (context exhaustion, tool failures). Worktree cleanup requires explicit `git worktree remove` before branch deletion. Crash skips cleanup entirely.

**Consequences:** Disk space leak. Branch namespace pollution. Ghost workers in registry. New worktree creation fails for the same plan.

**Prevention:**
Startup cleanup ritual in hive-tools.js (run during `init execute-phase`):
1. `git worktree prune` -- clean stale worktree references
2. `git worktree repair` -- fix corrupted worktree links
3. For each hive-worker worktree NOT in registry: `git worktree remove --force`
4. For each `hive/*` branch not attached to a worktree: `git branch -D`

Registry heartbeat: Active workers write timestamp every 60s. Entries > 10 minutes old are stale.

**Detection:** Kill worker mid-execution. Restart. Verify automatic cleanup.

**Phase to address:** Phase 3 (Multi-Terminal). Phase 1 should include branch cleanup for single-terminal mode.

---

### Pitfall 7: Cross-Filesystem Rename for Atomic Writes

**What goes wrong:**
Using `os.tmpdir()` for temp files, then `fs.renameSync()` to target path. On Linux, `/tmp` is often tmpfs (RAM) while project lives on ext4. `rename()` across filesystems throws EXDEV or silently falls back to copy+delete. On Windows, `fs.renameSync()` is NOT atomic on NTFS. On WSL2, `/mnt/c/` does not support POSIX rename semantics.

**Why it happens:**
Developers test on Linux ext4 where `/tmp` is on the same device. Cross-device case is a well-known POSIX trap easily forgotten.

**Consequences:** Corrupted merge-queue.json or registry.json on crash. Partial file visible to readers.

**Prevention:**
1. Always create temp files in `path.dirname(targetFile)` -- same directory as target
2. Use `write-file-atomic` npm package (handles temp file placement, fsync, rename)
3. Add EXDEV fallback: if rename fails, use copy + delete with warning
4. Document: WSL2 users must keep project on Linux filesystem (`/home/`), NOT `/mnt/c/`

**Detection:** Test on system where `/tmp` is separate mount. If tests pass only on same filesystem, bug is present.

**Phase to address:** Phase 1 (Foundation). Atomic write utility function must be correct from the start.

---

## Moderate Pitfalls

### Pitfall 8: execSync Throws on Non-Zero Exit (merge-tree Conflict Detection)

**What goes wrong:**
`git merge-tree --write-tree` returns exit code 1 when conflicts exist. This is NOT an error -- it is the expected signal for "conflicts found." But `execSync` throws on any non-zero exit, making conflict detection look like a crash. The stdout (containing conflict information) is available only via `err.stdout`, which is fragile.

**Why it happens:**
The existing `execGit()` wrapper uses `execSync` and wraps in try/catch. Non-zero exit is treated uniformly as "error."

**Prevention:**
Use `spawnSync` (or the codebase's `execFileNoThrow`) for `git merge-tree`. It returns a structured result with `status`, `stdout`, `stderr` without throwing. Check `status === 0` (clean) vs `status === 1` (conflicts) vs other (real error).

**Detection:** Create two conflicting branches, run merge-tree. If error handling fires instead of conflict detection, bug is present.

**Phase to address:** Phase 2 (Repo Manager) when conflict detection is implemented.

---

### Pitfall 9: Build Gate Timeout Without Git State Cleanup

**What goes wrong:**
Build gate timeout kills the process, but leaves the system in inconsistent state:
- Gate 2 (`git merge --no-commit`) is still active, leaving merge state in index
- Temp files from build tools remain on disk
- merge-queue entry stays in "validating" status forever
- Subsequent git operations fail: "You have not concluded your merge"

**Why it happens:**
Timeout handling kills the process but does not clean up the git/filesystem state.

**Prevention:**
1. Before Gate 2, record that `git merge --abort` is needed on any exit
2. Use try/finally: on ANY exit path (success, failure, timeout), run cleanup
3. Always `git merge --abort` after Gate 2 regardless of outcome
4. Update queue status to "timeout" with retry count
5. Clear build artifacts on timeout

**Detection:** Timeout a build gate during Gate 2. Verify `git merge --abort` was called. Verify no "concluded your merge" errors afterward.

**Phase to address:** Phase 1 (Foundation) for timeout pattern. Phase 2 for Gate 2 cleanup.

---

### Pitfall 10: Self-Merge Violating Branch Protection Rules

**What goes wrong:**
Single-terminal self-merge fails when the repository has branch protection on `dev`:
- Required reviews: PR cannot merge without approval
- Required status checks: PR waits for CI not configured for hive/* branches
- Admin bypass: `gh pr merge --admin` needs admin token user may lack
- Merge queue required: GitHub requires PRs through native merge queue

`gh pr merge --auto --merge` intermittently fails with "Protected branch rules not configured" (community#129063). The `--admin` flag can bypass required approvals but fails if token lacks admin scope (cli/cli#8971).

**Why it happens:**
Design assumes dev is a lightweight integration branch without strict protection. But users/orgs may enforce protection on all branches.

**Prevention:**
Detection at init time via GitHub API:
- Check `gh api repos/{owner}/{repo}/branches/dev/protection`
- If no protection: self-merge works
- If status checks only: run build gate, wait for checks, merge
- If reviews required: skip self-merge, create PR for manual merge, or use `--admin` with explicit user opt-in
- If merge queue required: use `gh pr merge --auto` and poll

**Detection:** PRs accumulating in "open" state. "Required status check is not passing" errors.

**Phase to address:** Phase 1 (Foundation). Branch protection detection in init preflight.

---

### Pitfall 11: Merge Conflict Cascade in Parallel Waves

**What goes wrong:**
Wave 1 has 3 parallel plans. Plan A merges to dev first. Plan B conflicts with updated dev. Plan C merges fine. Plan B rebases onto dev (now containing A+C) and gets NEW conflicts that didn't exist before C merged. Rebase-and-retry can loop indefinitely as each merge changes the conflict landscape.

**Why it happens:**
Parallel plans touch shared files (package.json, config, route definitions, index files) even when designed to be independent.

**Prevention:**
1. Pre-execution overlap detection: compare `files_modified` from plan frontmatter
2. Merge ordering: plan with MORE changed files first (establishes baseline)
3. Rebase retry limit: max 2 attempts, then escalate to user
4. Shared file awareness: identify "hot files" and auto-merge strategies (e.g., package.json deps)

**Detection:** Rebase loops. Wave completion time growing exponentially.

**Phase to address:** Phase 2 (Repo Manager) for ordering. Phase 3 for parallel conflict monitoring.

---

### Pitfall 12: Context Window Bloat from Git Workflow Output

**What goes wrong:**
Git operations produce verbose output consumed by agents. `git status` = 20-50 lines. `gh pr create` = URL + metadata. Build gate = hundreds of lines. Per-task commits + PR creation + build gates fill the context window with git noise, reducing quality on later tasks.

**Why it happens:**
Git/gh output goes to stdout, which the agent sees. Each operation adds 100-500 tokens of noise.

**Prevention:**
All git operations through hive-tools.js returning structured JSON only:
- `hive-tools git-status` returns `{"clean": false, "modified": 3}` not raw output
- Build gate returns `{"passed": false, "summary": "3 tests failed", "log": ".hive-workers/gate.log"}`
- Executor agents NEVER run git merge, PR creation, or branch management directly
- The repo manager (or hive-tools.js) handles all integration git operations

**Detection:** Agents hitting context limits in phases with many tasks. Raw git output in agent responses.

**Phase to address:** Phase 1 (Foundation). JSON wrapper pattern for all new git commands.

---

### Pitfall 13: Git Version Too Old for merge-tree --write-tree

**What goes wrong:**
`git merge-tree --write-tree` requires Git 2.38+. Older versions use the deprecated 3-argument form with different output and semantics.

**Prevention:**
1. Parse `git --version` during init, store as `git_version`
2. If < 2.38: fall back to `git merge --no-commit --no-ff` + `git merge --abort` (modifies index temporarily)
3. Do NOT use deprecated `git merge-tree <base> <a> <b>` -- it cannot handle real merges
4. Document minimum git version requirement

**Phase to address:** Phase 2 (Repo Manager) when conflict detection is implemented.

---

### Pitfall 14: Branch Name Conflicts Between Milestones

**What goes wrong:**
v1.0 milestone has plan 01-01 with branch `hive/plan-01-01-auth`. User starts v2.0 with plan 01-01 that generates the same branch name because the template omits milestone version.

**Prevention:**
Include milestone version in branch template: `hive/{milestone}/plan-{phase}-{plan}-{slug}`.

**Phase to address:** Phase 1 (Foundation) when branch naming is defined.

---

### Pitfall 15: Shell Injection via Branch Names

**What goes wrong:**
Plan descriptions containing shell metacharacters get slugified into branch names. If git commands are executed through a shell, arbitrary commands could execute.

**Prevention:**
1. The existing `generateSlugInternal()` strips non-alphanumeric characters (good)
2. Use `spawnSync` / `execFileNoThrow` (not shell-based `execSync`) for new commands
3. Validate branch names against `^[a-zA-Z0-9._/-]+$` before any git operation

**Phase to address:** Phase 1 (Foundation). All new git command implementations.

---

### Pitfall 16: Config.json Backward Compatibility

**What goes wrong:**
Existing users upgrading to v2.0 have `config.json` without the `git` section. Code reads `config.git.flow` and crashes.

**Prevention:**
Extend `loadConfig()` defaults with `git: { flow: 'none', ... }`. Always use optional chaining: `config.git?.flow ?? 'none'`. All new features gated behind `branching_strategy: "github"`. Users with "none" must see zero behavior change.

**Phase to address:** Phase 1 (Foundation). First thing implemented.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Shell `flock` instead of Node.js locking | Faster to implement (3 lines of bash) | Breaks on macOS, inconsistent on WSL1 | Never |
| Polling merge-queue.json every 5s | Simple, cross-platform | CPU waste, file contention, delayed processing | MVP only for Phase 2; replace with inotify in Phase 4 |
| Raw git commands in agent prompts | Quick prototyping | Context bloat, inconsistent error handling, no retry | Never in production |
| Skip build gate in single-terminal | Faster execution | Bad code on dev, discovered only in multi-terminal | Only if user explicitly sets `build_gates.pre_pr: false` |
| `git merge` instead of `gh pr merge` | No gh dependency, works offline | No audit trail, no PR comments | Acceptable as offline fallback |
| Store merge queue in memory | No file contention | State lost on crash, no multi-process coordination | Never for multi-terminal; OK for single-terminal self-merge |
| Skip conflict pre-check | Simpler merge flow | Discover conflicts after merge attempt, wasting time | Only if git < 2.38 (merge-tree unavailable) |

## Integration Gotchas

Specific to integrating git workflow with Hive's existing agent architecture.

| Integration Point | Common Mistake | Correct Approach |
|-------------------|----------------|------------------|
| **Wave execution + branch creation** | Creating all plan branches at wave start, before agents assigned | Create branch just-in-time when agent starts. Pre-creating means cleanup if assignment changes. |
| **execute-plan.md + PR creation** | Adding PR creation logic to execute-plan.md | PR creation belongs in execute-phase.md (orchestrator) or hive-tools.js. Executor agents only commit code. |
| **Task commits + plan branch** | Assuming agent is on correct branch at start | Always verify: `git rev-parse --abbrev-ref HEAD` must match expected plan branch. Crash + restart may land on wrong branch. |
| **STATE.md updates + merge queue** | Updating STATE.md from both executor and repo manager | STATE.md updated ONLY by orchestrator. Merge queue is separate. Never let two writers update same file. |
| **hive-tools.js init + git flow** | Adding git checks as separate commands | Extend existing `init execute-phase` to include all git preflight in one JSON response. |
| **branching_strategy "none" + new features** | Breaking existing "none" behavior | All new features gated behind "github" strategy. "none" = zero new behavior. Test explicitly. |
| **Checkpoint handling + branch state** | Expecting branch state preserved across checkpoint resume | Standalone mode: continuation agents checkout correct branch. Team mode: executor keeps branch context. |
| **Dev branch vs user's existing dev** | Assuming `dev` doesn't exist yet | Check at init. If exists, offer to use existing or create `hive/dev`. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Polling merge-queue from multiple workers | CPU spikes, file contention | Single reader (repo manager), signal-based notification | > 3 concurrent workers |
| Build gate for every task commit | Execution time doubles | Build gate at plan completion only, not per-task | Plans with > 5 tasks |
| Full git log parsing for conflict detection | Slow on large repos | Use `git merge-tree` (no working tree needed) | Repos with > 6 months history |
| Worktree add for every plan (even sequential) | Unnecessary disk I/O | Only create worktrees in multi-terminal mode | Single-terminal with > 5 plans |
| Unbounded merge-queue.json growth | JSON parsing slows | Cap merged history at 50 entries | > 100 merged items |
| gh API calls for branch protection on every PR | GitHub rate limiting | Cache at init, refresh per phase | > 30 PRs per hour |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging gh auth token in debug output | Token exposed in `.hive-workers/` logs | Never log `GH_TOKEN`. Use `--json user` (not `--show-token`) for auth checks. |
| Storing tokens in merge-queue.json | Plaintext in shared state | Never store tokens in shared files. Use gh's credential storage. |
| Committing `.hive-workers/` to git | Worker state exposed in repo | Add `.hive-workers/` to `.gitignore` during init. |
| `--admin` bypass without user consent | Merges code bypassing required reviews | Only use `--admin` if explicitly enabled in config. Default: respect protections. |
| Shell injection via plan descriptions | Arbitrary command execution | Use `spawnSync`/`execFileNoThrow` (no shell). Validate branch names. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| **Silent PR creation failure** | Discovers 30 min later code is local only | Report PR URL or failure immediately. Offer: "Code is on branch X. Retry or create manually?" |
| **Build gate failure with no info** | "Build failed" + 500 lines of output | Show: which gate, which test, first 5 error lines. Full log in `.hive-workers/build-gate.log`. |
| **Merge conflicts = agent failures** | "Plan failed" when execution succeeded | Separate execution status from merge status. "Plan executed. Merge has conflicts. Resolve?" |
| **Branch name collisions** | User's `dev` branch overwritten | Namespace all Hive branches: `hive/dev`, `hive/plan-*`. Check before creating. |
| **No offline fallback** | Git flow features fail on airplane | Detect offline state. "Working offline. Commits to branches. PRs deferred." |
| **Flow opt-in confusion** | Git flow set for one project leaks to all | Config is per-project (.planning/config.json), never global. |

## "Looks Done But Isn't" Checklist

- [ ] **File locking:** "Works on Linux" -- verify macOS (no flock CLI), WSL2 (linux fs OK, /mnt/c/ NOT), Windows (NTFS rename not atomic)
- [ ] **PR creation:** "PR was created" -- verify correct base branch (dev not main), correct head, body not truncated (max 65536 chars)
- [ ] **Build gate:** "Build passed" -- ran correct command (not cached), in correct directory (worktree not main), correct branch checked out
- [ ] **Branch cleanup:** "Worktree removed" -- branch also deleted, `.git/worktrees/` entry pruned, registry.json entry removed
- [ ] **Merge queue:** "PR merged" -- dev HEAD advanced, queue status updated, workers signaled with new dev_head
- [ ] **Self-merge:** "Merged successfully" -- no branch protection blocked it, merge strategy matches config, plan branch deleted
- [ ] **Graceful degradation:** "Works without gh" -- ALL gh code paths wrapped in availability checks (not just pr create -- also merge, status, list, auth)
- [ ] **Config migration:** "Old configs work" -- `branching_strategy: "none"` and `"phase"` produce ZERO new behavior. No PRs, no gates, no queue.
- [ ] **Agent crash recovery:** "Resumed successfully" -- on correct branch, worktree clean (no merge state), last committed task not re-executed
- [ ] **Build command detection:** "Detected npm test" -- verify it's not the default placeholder `echo "Error: no test specified"`, which should be skipped

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| **Corrupt merge-queue.json** | LOW | Rebuild from git branch state: list `hive/*` branches, check open PRs via `gh pr list`, reconstruct. Add `merge-queue rebuild` command. |
| **Orphaned worktrees** | LOW | `git worktree prune && git worktree repair`. Delete orphaned hive/* branches. Add `hive cleanup-workers` command. |
| **Stale index.lock** | LOW | Check process: if none holds it, remove it. hive-tools.js should auto-detect and clean stale locks. |
| **PR created but merge failed** | LOW | PR exists on GitHub. User merges manually or hive-tools.js retries. |
| **Build timeout left merge state** | MEDIUM | `git merge --abort` in affected worktree. Re-run gate from clean state. |
| **Agent crash mid-plan** | MEDIUM | `git log --grep="{phase}-{plan}"` to find committed tasks. Resume from first uncommitted task (existing Hive pattern). |
| **Merge conflict cascade** | HIGH | Stop automated merges. Present conflicts to user. Options: manual resolve, pick one plan and re-execute other, rollback dev. |
| **Branch protection blocks all merges** | MEDIUM | Detect via API. Options: admin bypass (user opt-in), disable protection on dev, skip PRs and merge via git. |
| **Full git state corruption** | HIGH | `git fsck --full`. Recoverable: `git reflog`. Not recoverable: fresh clone, replay from remote. Plans in `.planning/` can be re-applied. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| flock unavailability on macOS (#1) | Phase 1 (Foundation) | proper-lockfile tests pass on macOS CI |
| index.lock contention (#2) | Phase 1 (Foundation) | All git reads use --no-optional-locks. 5 concurrent ops test. |
| gh pr create interactive (#3) | Phase 1 (Foundation) | All gh commands have stdin redirection + timeout |
| gh not installed/authenticated (#4) | Phase 1 (Foundation) | Init preflight returns gh status. Test with gh removed. |
| Merge queue corruption (#5) | Phase 2 (Repo Manager) | 5-process concurrent write stress test |
| Orphaned worktrees (#6) | Phase 3 (Multi-Terminal) | Kill mid-execution, restart, verify cleanup |
| Cross-device rename (#7) | Phase 1 (Foundation) | Temp files in same directory. EXDEV fallback test. |
| execSync throws on merge-tree (#8) | Phase 2 (Repo Manager) | Conflicting branches test returns conflict info, not error |
| Build timeout cleanup (#9) | Phase 1 (Foundation) | Timeout Gate 2, verify git merge --abort called |
| Self-merge + branch protection (#10) | Phase 1 (Foundation) | Test with protection on dev. Verify degradation. |
| Merge conflict cascade (#11) | Phase 2 (Repo Manager) | Two plans modify same file. Max 2 retry attempts. |
| Context bloat (#12) | Phase 1 (Foundation) | All git returns JSON. No raw output in agent context. |
| Git version merge-tree (#13) | Phase 2 (Repo Manager) | Version check at init. Test with git 2.37. |
| Branch name collisions (#14) | Phase 1 (Foundation) | Milestone version in branch template |
| Shell injection (#15) | Phase 1 (Foundation) | execFileNoThrow for all new commands |
| Config backward compat (#16) | Phase 1 (Foundation) | Test with empty config.json |

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Config extension | Backward compat (#16) | Extend loadConfig defaults; test with empty config |
| Phase 1: Dev branch creation | Existing dev branch from user | Check if dev exists; offer to use existing or create hive/dev |
| Phase 1: Plan branching | Branch name collisions (#14) | Include milestone version in template |
| Phase 1: Build detection | npm test "echo Error" default | Check for default npm test script; skip if default |
| Phase 1: Pre-PR gate | Flaky tests (#9) | Configurable timeout; clear timeout vs failure reporting; retry count |
| Phase 1: PR creation | gh not authenticated (#4) | Check at init, not at PR creation time |
| Phase 2: Merge queue | Concurrent corruption (#5) | mkdir lock + atomic writes from day one |
| Phase 2: Conflict detection | Git version (#13) | Version check at init; graceful fallback |
| Phase 2: Merge ordering | Dependency-unaware (#11) | Wave-aware queue; never merge wave 2 before wave 1 |
| Phase 3: Worktree creation | Orphaned on crash (#6) | Startup cleanup; heartbeat stale detection |
| Phase 3: Worker registration | Concurrent registry writes | Same lock+atomic-write as merge queue |
| Phase 4: File watching | inotifywait not on macOS | Platform detection: inotifywait / fswatch / polling fallback |

## Sources

- [flock not available on macOS - Homebrew Formulae](https://formulae.brew.sh/formula/flock)
- [WSL filesystem file locking - Microsoft/WSL#4689](https://github.com/microsoft/WSL/issues/4689)
- [Bitcoin flock fix for WSL - bitcoin/bitcoin#18700](https://github.com/bitcoin/bitcoin/pull/18700)
- [Everything about file locking - apenwarr](https://apenwarr.ca/log/20101213)
- [Stale index.lock from Claude Code - anthropics/claude-code#11005](https://github.com/anthropics/claude-code/issues/11005)
- [Git --no-optional-locks documentation](https://git-scm.com/docs/git)
- [gh pr create non-interactive - cli/cli#5848](https://github.com/cli/cli/issues/5848)
- [gh pr create broken v2.18.0+ - cli/cli#6468](https://github.com/cli/cli/issues/6468)
- [gh pr merge --admin bypass - cli/cli#8971](https://github.com/cli/cli/issues/8971)
- [gh pr merge --auto failures - community#129063](https://github.com/orgs/community/discussions/129063)
- [git merge-tree documentation (Git 2.38+)](https://git-scm.com/docs/git-merge-tree)
- [Clash: conflict detection across worktrees](https://github.com/clash-sh/clash)
- [Stale worktree branch - Auto-Claude#694](https://github.com/AndyMik90/Auto-Claude/issues/694)
- [Git worktree gotcha - removed directory](https://musteresel.github.io/posts/2018/01/git-worktree-gotcha-removed-directory.html)
- [.claude.json corruption - anthropics/claude-code#18998](https://github.com/anthropics/claude-code/issues/18998)
- [Files are hard (file consistency) - Dan Luu](https://danluu.com/file-consistency/)
- [write-file-atomic EPERM - npm/write-file-atomic#28](https://github.com/npm/write-file-atomic/issues/28)
- [Rename atomicity limits - npm/write-file-atomic#64](https://github.com/npm/write-file-atomic/issues/64)
- [proper-lockfile - npm](https://www.npmjs.com/package/proper-lockfile)
- [GitHub merge queue feedback - community#46757](https://github.com/orgs/community/discussions/46757)
- [Merge queue + branch restrictions - community#167530](https://github.com/orgs/community/discussions/167530)
- [Git worktrees for AI agents - Upsun](https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/)
- [Parallel AI coding with worktrees - Agent Interviews](https://docs.agentinterviews.com/blog/parallel-ai-coding-with-gitworktrees/)
- [Git process zombies - anthropics/claude-code#10078](https://github.com/anthropics/claude-code/issues/10078)
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) -- execSync throw behavior
- [Git worktree documentation](https://git-scm.com/docs/git-worktree) -- prune, repair, force remove
- GIT-WORKFLOW-RECOMMENDATIONS.md (internal) -- Risk section

---
*Domain pitfalls for: Git workflow integration in Hive v2.0*
*Researched: 2026-02-12*
