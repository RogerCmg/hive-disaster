# Stack Research: Git Workflow Integration

**Domain:** Git workflow automation for AI-agent orchestration system
**Researched:** 2026-02-12
**Confidence:** HIGH (Node.js stdlib APIs verified against official docs; git commands verified against official manpages)

## Existing Stack (DO NOT CHANGE)

| Technology | Version | Purpose | Constraint |
|------------|---------|---------|------------|
| Node.js | >=16.7.0 | Runtime (package.json engines) | Zero npm dependencies; stdlib only |
| `fs` module | stdlib | File I/O, state management | Already used extensively in hive-tools.js |
| `path` module | stdlib | Path resolution | Already used in hive-tools.js |
| `child_process` | stdlib | Git command execution via `execSync` | Existing `execGit()` wrapper at line 239 |
| `os` module | stdlib | `homedir()` for config paths | Already used inline |

## Recommended Stack Additions

### Core: Subprocess Execution for Git/GH Commands

| API | Purpose | Why Recommended |
|-----|---------|-----------------|
| `child_process.execSync` (existing) | Short git commands (branch, checkout, rev-parse, merge-base) | Already used via `execGit()` wrapper. Synchronous model matches codebase. Keep for simple, fast commands. |
| `child_process.spawnSync` (NEW) | Long-running git commands (merge-tree, worktree add, rebase) and `gh` CLI | Returns structured `{status, stdout, stderr, signal, error}` instead of throwing. Better for commands that may take 10+ seconds. Does NOT invoke a shell by default (safer against injection). |

**Decision: Use BOTH, not either/or.**

`execSync` via the existing `execGit()` wrapper handles fast, simple git commands. `spawnSync` should be used for NEW commands that are:
- Potentially long-running (build gates, `gh pr create`, `git worktree add`)
- Need structured error information (merge-tree conflict detection where exit 1 = conflicts, not error)
- Interact with external CLIs that may not be installed (`gh`)

**New wrapper function pattern (conceptual):**

A new `execCommand(cwd, command, args, options)` function using `spawnSync` with:
- `encoding: 'utf-8'` and `stdio: 'pipe'` (match existing `execGit` pattern)
- `timeout` option (default 60s; build gates get 300s)
- `maxBuffer: 10 * 1024 * 1024` (10MB, up from default 1MB -- build output can be large)
- Returns normalized `{exitCode, stdout, stderr, signal, error, timedOut}` object

**Why spawnSync over execSync for new commands:**
1. `spawnSync` returns a result object; `execSync` throws on non-zero exit. For `git merge-tree` (exit code 1 = conflicts, not error), `spawnSync` avoids try/catch abuse.
2. `spawnSync` does not invoke a shell by default, eliminating shell injection risk when passing branch names containing special characters.
3. `spawnSync` provides `signal` and `error` fields, critical for detecting timeout vs crash vs build failure.
4. `spawnSync` handles stdout/stderr separately with no maxBuffer overflow since they are buffered independently.

**Confidence: HIGH** -- Verified against [Node.js v25 child_process docs](https://nodejs.org/api/child_process.html). All APIs available since Node.js 0.12 (well within our 16.7.0 minimum).

### File Locking: mkdir-Based Lock Pattern

| API | Purpose | Why Recommended |
|-----|---------|-----------------|
| `fs.mkdirSync(lockPath)` | Atomic lock acquisition | `mkdir` is atomic on all POSIX systems and Windows NTFS. If directory exists, throws `EEXIST`. Same strategy used by `proper-lockfile` (most popular npm locking library), implemented in-house to maintain zero-dep constraint. |
| `fs.rmSync(lockPath, {recursive: true})` | Lock release | Remove lock directory. `rmSync` with `recursive` available since Node.js 14.14.0. |
| `fs.statSync(lockPath).mtimeMs` | Stale lock detection | Check if lock is older than threshold (e.g., 10 minutes). Handles crash recovery. |

**Implementation approach:**

An `acquireLock(filePath, options)` function that:
1. Attempts `mkdirSync(filePath + '.lock')` -- atomic create-or-fail
2. On `EEXIST`, checks `statSync` for stale lock (mtime > threshold)
3. If stale, removes and retries
4. Writes PID into lock directory for debugging
5. Returns true/false for success/failure
6. Companion `releaseLock(filePath)` removes the lock directory

**Why mkdir over alternatives:**
- `fs.openSync(path, 'wx')` creates a file exclusively, but file locks are less visible for debugging and cannot store metadata (PID) as easily.
- `flock()` is not available in Node.js stdlib -- [GitHub issue #122](https://github.com/nodejs/node/issues/122) has been open since 2014, never implemented.
- npm packages (`proper-lockfile`, `os-lock`) violate the zero-dependency constraint.
- `mkdir` is atomic cross-platform (Linux, macOS, Windows/NTFS, even NFS).

**Where locks are needed:**
1. `merge-queue.json` -- multiple workers may submit simultaneously
2. `registry.json` -- workers register/deregister concurrently
3. `.planning/STATE.md` -- if multiple terminals update state (existing risk, currently unprotected)

**Confidence: HIGH** -- mkdir atomicity is POSIX-guaranteed. Pattern verified via [LogRocket blog](https://blog.logrocket.com/understanding-node-js-file-locking/) and `proper-lockfile` source. `fs.rmSync({recursive:true})` available since Node.js 14.14.0 (our minimum is 16.7.0).

### Atomic File Writes: write-to-temp + rename

| API | Purpose | Why Recommended |
|-----|---------|-----------------|
| `fs.writeFileSync(tempPath, data)` | Write to temp file | Existing pattern. |
| `fs.renameSync(tempPath, targetPath)` | Atomic swap | `rename()` is atomic on same filesystem (POSIX guarantee). |

**Critical rule: Temp file MUST be in the SAME directory as the target file.**

An `atomicWriteFileSync(filePath, data, options)` function that:
1. Creates temp file in `path.dirname(filePath)` as `.tmp-<pid>-<timestamp>`
2. Writes data to temp file
3. Renames temp file to target (atomic on same filesystem)
4. On failure, cleans up temp file

**Why NOT use `os.tmpdir()` + rename:**
On Linux, `/tmp` is often a tmpfs (RAM filesystem). The project directory is on ext4/btrfs. `rename()` across different filesystems is NOT atomic -- it falls back to copy+delete, which can leave partial files on crash.

**Why NOT use `writeFileSync` with `flush: true`:**
The `flush` option was added in Node.js 21. Our minimum is 16.7.0. For crash-safe writes on Node 16-20, the rename pattern provides equivalent atomicity guarantees.

**Where atomic writes are needed:**
1. `merge-queue.json` -- corruption blocks all merges
2. `registry.json` -- corruption orphans workers
3. `config.json` -- corruption breaks all operations
4. Signal files in `.hive-workers/signals/`

**Confidence: HIGH** -- `rename()` atomicity on same-filesystem is POSIX-guaranteed. Pattern is the industry standard (used by databases, editors, lockfile libraries).

### Git Commands: Version Requirements

| Git Command | Minimum Version | Purpose | Fallback |
|-------------|-----------------|---------|----------|
| `git worktree add <path> -b <branch>` | Git 2.5+ (2015) | Create worker worktrees | None needed; universally available |
| `git worktree remove <path>` | Git 2.17+ (2018) | Clean up worktrees | `rm -rf <path> && git worktree prune` |
| `git worktree list --porcelain` | Git 2.5+ | Enumerate worktrees | Parse non-porcelain output |
| `git worktree prune` | Git 2.5+ | Remove stale worktree refs | None needed |
| `git merge-tree --write-tree <a> <b>` | **Git 2.38+** (2022-10) | Conflict detection without touching worktree | Fall back to `git merge --no-commit --no-ff` (modifies index, requires abort) |
| `git merge-base <a> <b>` | Git 1.0+ | Find common ancestor | None needed |
| `git branch -D <branch>` | Git 1.0+ | Delete plan branches | None needed |
| `git checkout -b <branch>` | Git 1.0+ | Create plan branches | None needed |
| `git rev-parse --verify <ref>` | Git 1.0+ | Verify branch/ref existence | None needed |

**Critical version dependency: `git merge-tree --write-tree` requires Git 2.38+**

The modern `git merge-tree` mode:
- Exit code 0 = clean merge, exit code 1 = conflicts (not an error!)
- Performs real three-way merge with rename detection
- Does NOT modify index or working tree
- Returns OID of resulting tree + conflict info on stdout

The deprecated `--trivial-merge` mode (pre-2.38) cannot handle content merges, rename detection, or directory/file conflicts. Essentially useless for real conflict detection.

**Recommendation:** Detect git version at init time. If < 2.38, disable conflict detection or fall back to `git merge --no-commit --no-ff` (which modifies the index and requires `git merge --abort`).

**Feature degradation table:**

| Git Version | Available Features | Unavailable |
|-------------|-------------------|-------------|
| < 2.5 | None (too old) | Everything |
| 2.5 - 2.16 | Worktree add/list/prune, basic branching | `worktree remove` (use rm+prune fallback) |
| 2.17 - 2.37 | All worktree ops, branching, PRs | `merge-tree --write-tree` (use merge --no-commit fallback) |
| **2.38+** | **All features** | Nothing |

**Confidence: HIGH** -- `git merge-tree --write-tree` introduction in Git 2.38 verified via [Git 2.38.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.38.0.txt) and [official git-merge-tree docs](https://git-scm.com/docs/git-merge-tree).

### GitHub CLI (`gh`): Version and Commands

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `gh pr create` | Create PR from plan branch to dev | `--base <dev>`, `--head <plan-branch>`, `--title`, `--body`, `--fill` |
| `gh pr merge` | Merge PR (repo manager) | `--squash` or `--merge`, `--delete-branch`, `--auto`, `--admin` |
| `gh pr view` | Check PR status | `--json state,number,mergeable` |
| `gh pr list` | List open PRs | `--json number,headRefName,state` |
| `gh auth status` | Verify gh authentication | Exit code 0 = authenticated |

**gh CLI is OPTIONAL, not required.** The workflow must degrade gracefully:
- If `gh` is installed and authenticated: Full PR workflow (create, merge, view)
- If `gh` is missing: Git-only workflow (merge directly via `git merge`, no PR audit trail)

Detection: Run `gh auth status` via `spawnSync`. If ENOENT, gh not installed. If exit code != 0, not authenticated.

**Minimum gh version: 2.0+** (all versions support `pr create/merge/view`). The `--auto` flag for merge queues requires gh 2.4+.

**Confidence: MEDIUM** -- gh CLI commands verified against [official manual](https://cli.github.com/manual/gh_pr_create) and [gh pr merge docs](https://cli.github.com/manual/gh_pr_merge). Exact minimum version for `--auto` flag sourced from training data, not independently verified.

### File Watching: Polling over fs.watch

| Approach | Recommendation | Why |
|----------|---------------|-----|
| `fs.watch()` | DO NOT USE for merge queue | Unreliable cross-platform: no recursive support on Linux pre-Node 19, different event semantics per OS, inotify handle limits on Linux |
| `fs.watchFile()` | FALLBACK OPTION | stat-based polling, reliable but 5s minimum interval, higher CPU |
| **Polling with setInterval** | PRIMARY APPROACH | Simple, predictable, zero edge cases. Check `merge-queue.json` mtime every 3-5 seconds. |

**Why polling wins for this use case:**
1. The merge queue updates infrequently (every few minutes when a plan completes)
2. A 3-5 second polling interval is perfectly acceptable latency
3. `fs.watch` has documented reliability issues ([Node.js issue #36005](https://github.com/nodejs/node/issues/36005))
4. Zero-dependency constraint eliminates chokidar
5. The repo manager is a long-running process; polling overhead is negligible

**Implementation:** A `watchFile(filePath, callback, intervalMs)` function that uses `setInterval` + `statSync(path).mtimeMs` comparison. Returns a handle with `stop()` method.

**Confidence: HIGH** -- fs.watch limitations verified via [Node.js GitHub issue #36005](https://github.com/nodejs/node/issues/36005) and [chokidar README](https://github.com/paulmillr/chokidar).

### Build Gate Execution

| API | Purpose | Why |
|-----|---------|-----|
| `child_process.spawnSync` | Run build/test commands | Build commands can run 30+ seconds. Timeout support via `timeout` option. |

**Build command detection** extends existing brownfield detection in `cmdInitNewProject`:
1. Check user config: `git.build_gates.build_command`
2. Check `package.json` scripts.test (skip if default "Error: no test specified")
3. Check `Cargo.toml` -> `cargo test`
4. Check `pyproject.toml` / `setup.py` -> `pytest`
5. Check `go.mod` -> `go test ./...`
6. Check `Makefile` -> `make test`
7. Return null if none found (build gate passes with `skipped: true`)

**Build gate runner** returns structured result: `{passed, skipped, command, exitCode, stdout (last 2KB), stderr (last 2KB), timedOut}`

**Confidence: HIGH** -- spawnSync timeout behavior verified against official docs. Detection pattern extends existing `cmdInitNewProject` brownfield detection already in hive-tools.js.

## Integration with Existing hive-tools.js

### New Commands to Add

| Command | Signature | Returns |
|---------|-----------|---------|
| `git-init` | `hive-tools git-init` | `{dev_branch, git_version, gh_available, merge_tree_available}` |
| `git-create-branch` | `hive-tools git-create-branch <name> [--from <ref>]` | `{created, branch, from}` |
| `git-delete-branch` | `hive-tools git-delete-branch <name>` | `{deleted, branch}` |
| `git-merge-check` | `hive-tools git-merge-check <branch-a> <branch-b>` | `{conflicts, files[], conflicted_files[]}` |
| `git-worktree-add` | `hive-tools git-worktree-add <path> <branch>` | `{created, path, branch}` |
| `git-worktree-remove` | `hive-tools git-worktree-remove <path>` | `{removed, path}` |
| `git-worktree-list` | `hive-tools git-worktree-list` | `{worktrees: [{path, branch, head}]}` |
| `pr-create` | `hive-tools pr-create --base <dev> --head <branch> --title <t> --body <b>` | `{created, number, url}` |
| `pr-merge` | `hive-tools pr-merge <number> [--squash\|--merge]` | `{merged, number, strategy}` |
| `pr-status` | `hive-tools pr-status <number>` | `{number, state, mergeable}` |
| `build-gate` | `hive-tools build-gate [--timeout N]` | `{passed, command, exitCode}` |
| `detect-build-cmd` | `hive-tools detect-build-cmd` | `{command, source}` |
| `merge-queue` (sub) | `hive-tools merge-queue submit\|status\|process\|list` | Varies |
| `worker-register` | `hive-tools worker-register <worker-id>` | `{registered, worker_id}` |
| `worker-deregister` | `hive-tools worker-deregister <worker-id>` | `{deregistered, worker_id}` |

### Pattern Alignment

All new commands follow existing patterns:
1. **JSON output** via the existing `output()` function (`--raw` for JSON)
2. **cwd-based** path resolution (same as all existing commands)
3. **Config-driven** behavior (read from `.planning/config.json`)
4. **Error handling** via the existing `error()` function
5. **Idempotent** where possible (creating existing branch returns `{created: false, already_exists: true}`)

### Config Schema Extension

```json
{
  "git": {
    "flow": "github",
    "dev_branch": "dev",
    "multi_terminal": false,
    "plan_branches": true,
    "auto_pr": true,
    "merge_strategy": "squash",
    "build_gates": {
      "pre_pr": true,
      "pre_merge": true,
      "pre_main": true,
      "build_command": null,
      "timeout_seconds": 300
    },
    "plan_branch_template": "hive/plan-{phase}-{plan}-{slug}",
    "phase_branch_template": "hive/phase-{phase}-{slug}",
    "milestone_branch_template": "hive/{milestone}-{slug}"
  }
}
```

This extends the existing `branching_strategy`, `phase_branch_template`, and `milestone_branch_template` fields already in `loadConfig()`.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `spawnSync` for new git commands | `execSync` for everything | execSync throws on non-zero exit. merge-tree exit 1 = conflicts, not error. spawnSync returns structured result. |
| mkdir-based lock | `fs.openSync('wx')` exclusive file create | mkdir is more visible (directory vs file), can store metadata (PID), industry-standard zero-dep pattern |
| mkdir-based lock | npm `proper-lockfile` | Violates zero-dependency constraint |
| Same-dir temp + rename | `os.tmpdir()` + rename | Cross-filesystem rename is NOT atomic |
| Polling for file watch | `fs.watch()` | Unreliable cross-platform |
| Polling for file watch | npm `chokidar` | Violates zero-dependency constraint |
| `gh` CLI for PRs | GitHub REST API via `https` module | gh handles auth, pagination, rate limiting. REST client is massive scope creep |
| `git merge-tree --write-tree` | `git merge --no-commit --no-ff` | merge-tree does not touch index/worktree; merge modifies state and requires abort |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `fs.watch()` for merge queue | Unreliable cross-platform, inotify limits | Poll `stat.mtimeMs` on interval |
| `os.tmpdir()` for atomic writes | Different filesystem; rename not atomic across FS | Temp file in same directory as target |
| `child_process.exec()` (async) | Entire codebase is synchronous | `execSync` or `spawnSync` |
| `fs.writeFileSync` with `flush: true` | Added in Node.js 21; minimum is 16.7.0 | Atomic write via temp+rename |
| `flock()` syscall | Not in Node.js stdlib ([issue #122](https://github.com/nodejs/node/issues/122)) | mkdir-based lock pattern |
| Shell `flock` command | Not on macOS or Windows; Linux-only | mkdir-based lock pattern |
| `git merge-tree <base> <a> <b>` (old mode) | Deprecated; cannot handle content merges or renames | `git merge-tree --write-tree` (2.38+) |

## Cross-Platform Considerations

| Concern | Linux/WSL | macOS | Windows (native) |
|---------|-----------|-------|-------------------|
| `mkdir` atomicity | Yes (POSIX) | Yes (POSIX) | Yes (NTFS) |
| `rename` same-fs atomicity | Yes (POSIX) | Yes (POSIX) | Yes (NTFS, mostly) |
| `git worktree` | Full support | Full support | Full support |
| `gh` CLI | Available | Available | Available |
| `fs.watch` reliability | Limited (inotify) | Good (FSEvents) | Dirs only |
| Path separators | `/` | `/` | `\` (path.join handles) |
| Process signals (SIGTERM) | Full support | Full support | Limited |

**Primary target: Linux/WSL** (per env context). macOS secondary. Native Windows out of scope but should not be actively broken.

## Version Compatibility Matrix

| Component | Minimum Version | Why | How to Check |
|-----------|-----------------|-----|--------------|
| Node.js | 16.7.0 | Existing constraint | `process.version` |
| Git | 2.17 (basic), **2.38 (full)** | 2.17: `worktree remove`. 2.38: `merge-tree --write-tree` | `git --version` |
| gh CLI | 2.0 (basic), 2.4 (auto-merge) | 2.0: `pr create/merge`. 2.4: `--auto` flag | `gh --version` |

## Node.js API Summary Table

| API | Module | Available Since | Used For |
|-----|--------|-----------------|----------|
| `execSync(cmd, opts)` | child_process | 0.12 | Existing git commands |
| `spawnSync(cmd, args, opts)` | child_process | 0.12 | New git/gh commands |
| `mkdirSync(path)` | fs | 0.x | Lock acquisition |
| `rmSync(path, {recursive})` | fs | 14.14 | Lock release, cleanup |
| `renameSync(old, new)` | fs | 0.x | Atomic file swap |
| `writeFileSync(path, data)` | fs | 0.x | Write to temp files |
| `mkdtempSync(prefix)` | fs | 5.10 | Unique temp directories |
| `statSync(path).mtimeMs` | fs | 0.x | Stale lock detection, polling |
| `existsSync(path)` | fs | 0.x | Path checks (already used) |
| `unlinkSync(path)` | fs | 0.x | Temp file cleanup (already used) |
| `realpathSync(path)` | fs | 0.x | Resolve symlinks |
| `homedir()` | os | 2.0 | Config paths (already used) |
| `platform` | process | 0.x | Platform detection |

## Installation

No installation needed. Zero new dependencies. All APIs are Node.js stdlib.

```bash
# Verify prerequisites
node --version    # Must be >= 16.7.0
git --version     # Should be >= 2.38 for full features
gh --version      # Optional; enables PR workflow
gh auth status    # Optional; must be authenticated
```

## Sources

- [Node.js v25 child_process documentation](https://nodejs.org/api/child_process.html) -- execSync vs spawnSync API, maxBuffer, timeout, stdio options (HIGH confidence)
- [Node.js v25 fs documentation](https://nodejs.org/api/fs.html) -- writeFileSync, mkdirSync, renameSync, mkdtempSync, watch APIs (HIGH confidence)
- [Git merge-tree official documentation](https://git-scm.com/docs/git-merge-tree) -- write-tree mode, exit codes, conflict detection (HIGH confidence)
- [Git 2.38.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.38.0.txt) -- merge-tree new mode introduction (HIGH confidence)
- [Git worktree official documentation](https://git-scm.com/docs/git-worktree) -- add, remove, list, prune commands (HIGH confidence)
- [gh pr create manual](https://cli.github.com/manual/gh_pr_create) -- flags: --base, --head, --title, --body, --fill (HIGH confidence)
- [gh pr merge manual](https://cli.github.com/manual/gh_pr_merge) -- flags: --squash, --merge, --auto, --delete-branch, --admin (HIGH confidence)
- [Node.js file locking via mkdir pattern](https://blog.logrocket.com/understanding-node-js-file-locking/) -- atomic mkdir strategy (HIGH confidence)
- [Node.js issue #122: add flock API](https://github.com/nodejs/node/issues/122) -- confirms flock not in stdlib (HIGH confidence)
- [Node.js issue #36005: recursive fs.watch](https://github.com/nodejs/node/issues/36005) -- confirms fs.watch limitations (HIGH confidence)
- [Secure tempfiles in Node.js](https://advancedweb.hu/secure-tempfiles-in-nodejs-without-dependencies/) -- mkdtempSync patterns (MEDIUM confidence)

---
*Stack research for: Git workflow integration in Hive meta-prompting system*
*Researched: 2026-02-12*
