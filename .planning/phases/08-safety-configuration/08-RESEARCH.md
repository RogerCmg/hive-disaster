# Phase 8: Safety & Configuration - Research

**Researched:** 2026-02-12
**Domain:** File safety primitives, CLI configuration schema, git tooling subcommands (Node.js stdlib only)
**Confidence:** HIGH

## Summary

Phase 8 is the foundation layer for the entire v2.0 git workflow. It adds three capabilities to the existing `hive-tools.js` monolith: (1) crash-safe file operations via mkdir-based locks and atomic temp+rename writes, (2) an extended config.json schema with a `git` section for flow control, build gates, and auto-detection, and (3) approximately 10 new git subcommands that later phases (9-11) will compose into branch lifecycle, PR, and repo manager workflows.

All work is internal to the existing codebase with zero new dependencies. The changes target a single file (`hive-tools.js`, currently 5439 lines) and its config template (`config.json`). The prior decisions from the v2.0 planning session are prescriptive: mkdir-based locks (not flock), spawnSync (not the current execSync pattern), same-directory temp+rename, build gates on by default. These decisions constrain the implementation to well-understood Node.js stdlib patterns.

The primary risk is the volume of new code (estimated 400-600 lines of utility functions + 300-500 lines of git subcommand handlers + 200-300 lines of tests + config/router changes) being added to an already large monolith. Careful sectioning with ASCII-art separators (matching existing convention) and thorough tests will mitigate this.

**Primary recommendation:** Implement in two plans: Plan 1 covers safety primitives (lock, atomic write) + config schema + auto-detection; Plan 2 covers the approximately 10 git subcommands. This separates the "infrastructure" from the "features" and lets Plan 2 depend on Plan 1's utilities.

## Standard Stack

### Core

No new libraries. All changes use existing Node.js stdlib modules already imported in hive-tools.js.

| Module | Already Imported | Purpose for Phase 8 | Why Standard |
|--------|-----------------|---------------------|--------------|
| `fs` | Yes (line 127) | Atomic writes via `writeFileSync` + `renameSync`, lock dirs via `mkdirSync` | Core file operations |
| `path` | Yes (line 128) | Temp file paths, lock dir paths | Path manipulation |
| `child_process` | Yes (line 129, `execSync` only) | New: add `spawnSync` import for git/gh commands with structured exit handling | Process spawning |
| `os` | Not imported yet | `os.platform()` for cross-platform `which`/`where` detection | Platform detection |

### Supporting

| File | Purpose | Change Required |
|------|---------|-----------------|
| `.claude/hive/bin/hive-tools.js` | Runtime copy | Must be synced after source changes |
| `.claude/hive/templates/config.json` | Config template | Add `git` section |
| `.claude/hive/bin/hive-tools.test.js` | Test file | Add tests for new functions |

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| mkdir-based locks | `flock` (POSIX) | Not available on Windows; prior decision locks this to mkdir |
| mkdir-based locks | `proper-lockfile` npm package | Zero-dependency constraint; mkdir is sufficient for our use case |
| spawnSync for git | Continue using execSync | Prior decision: spawnSync gives structured `{status, stdout, stderr}` without try/catch for non-zero exits |
| Manual atomic write | `write-file-atomic` npm package | Zero-dependency constraint; temp+rename is 5 lines of code |

## Architecture Patterns

### Recommended Code Organization in hive-tools.js

New code should be organized as new sections within the existing monolith, using the established ASCII-art separator pattern:

```
// --- Existing sections ---
// (Model Profile Table, Telemetry, Helpers, Commands, CLI Router)

// --- File Safety Primitives ---
// acquireLock(), releaseLock(), atomicWriteFileSync(), withFileLock()

// --- Git/CLI Detection ---
// execCommand(), detectGitVersion(), detectGhCli(), detectBuildCommand()

// --- Git Subcommands ---
// cmdGitCreateDevBranch(), cmdGitCreatePlanBranch(), cmdGitDetectBuildCmd(),
// cmdGitRunBuildGate(), cmdGitCreatePr(), cmdGitSelfMergePr(),
// cmdGitMergeDevToMain(), cmdGitCheckConflicts(), cmdGitDeletePlanBranch(),
// cmdGitCurrentBranch()
```

### Pattern 1: mkdir-Based Lock (SAFE-01)

**What:** Use `fs.mkdirSync()` without `{ recursive: true }` to create a lock directory. The operation is atomic on both POSIX and NTFS -- if the directory already exists, it throws `EEXIST`, which serves as the "lock already held" signal.

**When to use:** Before any write to shared files (STATE.md, config.json, merge-queue.json).

**Implementation approach:**

```javascript
// Reference: proper-lockfile (https://github.com/moxystudio/node-proper-lockfile)
// Pattern: mkdir without recursive => EEXIST if lock held

function acquireLock(filePath, options) {
  // options: { retries: 50, retryDelay: 100, staleMs: 10000 }
  const lockDir = filePath + '.lock';

  // Loop: try mkdirSync(lockDir) -- if EEXIST, check stale, retry
  // On success: write PID + timestamp to lockDir/info for stale detection
  // On stale: rmSync(lockDir, { recursive: true, force: true }), retry
  // On timeout: throw Error with context

  // Key: mkdirSync WITHOUT { recursive: true } is the atomic primitive
}

function releaseLock(lockDir) {
  // rmSync(lockDir, { recursive: true, force: true })
  // Best-effort -- lock dir may already be gone
}
```

**Key details:**
- Lock path is `<filepath>.lock` (a directory, not a file)
- PID + timestamp in `info` file enables stale lock detection
- Default stale threshold: 10 seconds (hive-tools operations are fast)
- Default 50 retries at 100ms = 5 second max wait
- `fs.rmSync` with `{ recursive: true, force: true }` for cleanup

### Pattern 2: Atomic Write via temp+rename (SAFE-02)

**What:** Write data to a temporary file in the same directory as the target, then rename it over the target. This guarantees that readers always see either the old complete content or the new complete content, never a partial write.

**When to use:** Every write to shared files (STATE.md, config.json, merge-queue.json).

**Implementation approach:**

```javascript
// Reference: npm/write-file-atomic (https://github.com/npm/write-file-atomic)
// Pattern: writeFileSync to temp in same dir, then renameSync over target

function atomicWriteFileSync(filePath, content, encoding) {
  // 1. Compute tmpPath = same dir + '.tmp-' + basename + PID + timestamp
  // 2. writeFileSync(tmpPath, content, encoding)
  // 3. renameSync(tmpPath, filePath) -- atomic on same filesystem
  // 4. On error: try unlinkSync(tmpPath), re-throw
}
```

**Key details:**
- Temp file uses `.tmp-` prefix + original basename + PID + timestamp for uniqueness
- Same directory ensures rename is always on same filesystem (no EXDEV error)
- Cleanup on failure prevents orphaned temp files
- Works on Linux, macOS, and Windows (same-filesystem rename is atomic on all)

### Pattern 3: Combined Lock + Atomic Write Helper

**What:** A convenience wrapper that acquires a lock, performs a read-modify-write cycle with atomic write, then releases the lock.

```javascript
function withFileLock(filePath, fn) {
  const lockDir = acquireLock(filePath);
  try {
    return fn();
  } finally {
    releaseLock(lockDir);
  }
}
```

### Pattern 4: spawnSync-Based Command Runner (INTG-04)

**What:** Replace the try/catch-based `execSync` pattern with `spawnSync` for structured exit handling. The new function handles both `git` and `gh` commands.

**When to use:** All new git/gh subcommands. Existing `execGit` remains for backward compatibility.

**Implementation approach:**

```javascript
// Reference: https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options

const { spawnSync } = require('child_process');

function execCommand(command, args, options) {
  // options: { cwd, timeout }
  // spawnSync(command, args, { cwd, encoding: 'utf-8', timeout, stdio: pipes })
  // Returns: { success, exitCode, stdout, stderr, signal, timedOut }
  // No try/catch needed -- non-zero exit codes don't throw
}
```

**Key difference from existing `execGit`:**
- No shell interpolation (spawnSync passes args directly to the process)
- No try/catch needed for non-zero exit codes
- Structured timeout handling (returns `timedOut: true` instead of throwing)
- Works for both `git` and `gh` commands

### Pattern 5: Build Command Auto-Detection (SETUP-02)

**What:** Detect the project's build/test command by checking for known project manifest files in priority order.

**Detection chain (ordered by priority):**

| Priority | File | Detected Command | Notes |
|----------|------|-----------------|-------|
| 1 | `package.json` | `npm test` | Only if `scripts.test` exists AND is not the npm default placeholder |
| 2 | `Cargo.toml` | `cargo test` | Presence of file is sufficient |
| 3 | `go.mod` | `go test ./...` | Presence of file is sufficient |
| 4 | `pyproject.toml` | `pytest` | Presence of file is sufficient |
| 5 | `setup.py` | `pytest` | Presence of file is sufficient |
| 6 | `Makefile` | `make test` | Only if a `test:` target exists in the file |
| 7 | `build.gradle` | `./gradlew test` | Presence of file is sufficient |
| 8 | `pom.xml` | `mvn test` | Presence of file is sufficient |

**Returns:** `{ detected: bool, command: string|null, source: string|null }`

### Pattern 6: Config Schema Extension (SETUP-01)

**What:** Extend config.json with a `git` section. The `loadConfig` function must be updated to read new fields.

**New config.json shape (git section only):**

```json
{
  "git": {
    "flow": "github",
    "dev_branch": "dev",
    "build_gates": {
      "pre_pr": true,
      "pre_merge": true,
      "pre_main": true
    },
    "build_command": null,
    "build_timeout": 300,
    "merge_strategy": "merge"
  }
}
```

**Config field semantics:**

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `git.flow` | `"github"` or `"none"` | `"github"` | `"none"` disables all git workflow features (SETUP-04) |
| `git.dev_branch` | string | `"dev"` | Name of integration branch |
| `git.build_gates.pre_pr` | boolean | `true` | Gate 1: build before PR creation |
| `git.build_gates.pre_merge` | boolean | `true` | Gate 2: build on merge result |
| `git.build_gates.pre_main` | boolean | `true` | Gate 3: build before dev-to-main |
| `git.build_command` | string or null | `null` | Override auto-detected build command (SETUP-03) |
| `git.build_timeout` | number | `300` | Build timeout in seconds |
| `git.merge_strategy` | `"merge"` or `"squash"` | `"merge"` | PR merge strategy (--no-ff for merge) |

### Pattern 7: Git Flow Bypass (SETUP-04)

**What:** When `git.flow` is `"none"`, all git subcommands return a structured "skipped" result without performing any git operations. This mirrors the existing `commit_docs: false` bypass pattern already used in `cmdCommit`.

**Every git subcommand handler starts with:**

```javascript
const config = loadConfig(cwd);
if (config.git_flow === 'none') {
  output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
  return;
}
```

### Pattern 8: CLI Router Addition for Git Subcommands

**What:** A new `case 'git':` block in the `switch(command)` router (line 5032), following the same pattern as `state`, `phase`, `telemetry`, etc.

**Subcommands to route:**

| Subcommand | Handler | Args |
|------------|---------|------|
| `create-dev-branch` | `cmdGitCreateDevBranch` | none |
| `create-plan-branch` | `cmdGitCreatePlanBranch` | `--name <branch>` |
| `detect-build-cmd` | `cmdGitDetectBuildCmd` | none |
| `run-build-gate` | `cmdGitRunBuildGate` | none |
| `create-pr` | `cmdGitCreatePr` | `--base <branch> --title <title> --body <body>` |
| `self-merge-pr` | `cmdGitSelfMergePr` | `<pr-number>` |
| `merge-dev-to-main` | `cmdGitMergeDevToMain` | none |
| `check-conflicts` | `cmdGitCheckConflicts` | `--branch <branch>` |
| `delete-plan-branch` | `cmdGitDeletePlanBranch` | `<branch>` |
| `current-branch` | `cmdGitCurrentBranch` | none |
| `detect` | `cmdGitDetect` | none (git version, gh availability, build cmd) |

**All handlers return structured JSON via `output()` function with success/error status.**

### Anti-Patterns to Avoid

- **Using `{ recursive: true }` with mkdirSync for locks:** This silently succeeds when the directory exists, defeating the atomic lock-or-fail semantics. The lock MUST use plain `mkdirSync()` without recursive.
- **Writing temp files to `/tmp` or `os.tmpdir()`:** These may be on a different filesystem than the target, causing EXDEV errors on rename. Always write temp files in the same directory as the target.
- **Using execSync for new git commands:** Prior decision requires spawnSync. The existing `execGit` function uses execSync and will remain for backward compatibility, but all new commands MUST use the new `execCommand` helper with spawnSync.
- **Deep-merging config objects:** The existing `loadConfig` uses a flat extraction pattern with `get()`. New fields should follow this same pattern, not introduce a deep merge utility.
- **Modifying source but forgetting installed copy:** Both `hive-tools.js` and `config.json` have installed copies under `.claude/hive/` that must be synced.
- **Refactoring execGit in Phase 8:** Leave existing execGit as-is. Introducing a new `execCommand` alongside it avoids risk to 30+ existing call sites.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File locking | Custom IPC or socket-based lock manager | mkdir-based lock with stale detection | mkdir is atomic on all platforms; stale detection handles crashes |
| Atomic file writes | Two-phase write with flag files | temp file + renameSync in same directory | rename is atomic on local filesystems; zero-dep, 5 lines |
| Git command execution with structured output | Shell string interpolation via execSync | spawnSync with args array | No shell injection risk; structured exit code handling |
| Build command detection | Regex parsing of all config files | Priority-ordered file existence + minimal content parsing | Simple, deterministic, extensible check list |
| Cross-platform command existence check | npm `which` package | spawnSync with `which` (Unix) / `where` (Windows) | Zero-dep; only used for detection, not resolution |
| Config schema validation | JSON Schema library | Manual field extraction with defaults (existing `loadConfig` pattern) | Consistency with existing code; config is simple and flat |

**Key insight:** Every piece of Phase 8 is a small, well-understood Node.js stdlib pattern. The complexity is in correct composition, not in any individual piece.

## Common Pitfalls

### Pitfall 1: Lock Directory Left Behind After Crash

**What goes wrong:** Process crashes between `acquireLock()` and `releaseLock()`, leaving a `.lock` directory that blocks all future writes.
**Why it happens:** No automatic cleanup mechanism for crashed processes.
**How to avoid:** Include PID + timestamp in lock info file. On lock acquisition failure, check if the PID is still running (process.kill(pid, 0) wrapped in try/catch) OR if timestamp is older than stale threshold (10s). If stale, force-remove the lock and retry.
**Warning signs:** Operations hanging for 5+ seconds (the retry timeout).

### Pitfall 2: Retry Delay Blocks the Node.js Event Loop

**What goes wrong:** Using setTimeout or Atomics.wait for retry delays in synchronous code.
**Why it happens:** hive-tools.js is entirely synchronous (no async except websearch). Retry delays must also be synchronous.
**How to avoid:** Use a simple `Date.now()` polling loop for sub-second delays. In practice, lock contention in this project is rare because Claude Code agents are sequential within a terminal -- the retry is mostly a safety net.
**Warning signs:** Lock acquisition never succeeds despite stale detection.

### Pitfall 3: renameSync Fails on Windows with Open File Handles

**What goes wrong:** If another process has the target file open for reading, `renameSync` may fail on Windows.
**Why it happens:** Windows enforces exclusive file access by default, unlike POSIX where rename is atomic even with open readers.
**How to avoid:** Mitigated by the lock pattern -- if we hold the lock, no other Hive process should have the file open. External editors (VS Code) use read-sharing handles that don't block renames. LOW-probability issue.
**Warning signs:** EACCES errors on Windows only during file writes.

### Pitfall 4: Build Command Detection Returns npm Default Placeholder

**What goes wrong:** `package.json` has `"test": "echo \"Error: no test specified\" && exit 1"` (the npm init default). Detection returns `npm test` which always fails.
**Why it happens:** npm init creates this placeholder; many projects never change it.
**How to avoid:** Explicitly check for the npm default test script string and treat it as "no test command" when detected.
**Warning signs:** Build gate always fails in Node projects that have not configured tests.

### Pitfall 5: spawnSync Timeout Unit Mismatch

**What goes wrong:** A build command hangs because timeout was set in wrong units -- config uses seconds, spawnSync expects milliseconds.
**Why it happens:** Missing the `* 1000` conversion.
**How to avoid:** Explicitly convert: `timeout: (config.git_build_timeout || 300) * 1000`. Add a comment noting the conversion.
**Warning signs:** Build gates timing out immediately (near-zero timeout) or never timing out (effectively infinite).

### Pitfall 6: loadConfig Breaking Change for Existing Projects

**What goes wrong:** Adding git config fields causes existing projects (which have no `git` section in their config.json) to crash or behave differently.
**Why it happens:** The `loadConfig` function may not handle missing nested sections gracefully.
**How to avoid:** Follow the existing pattern: all new fields have defaults in the `defaults` object. The `get()` function already handles missing nested sections gracefully (returns `undefined`, falls through to default). Verify that `loadConfig` returns sensible defaults when config.json has no `git` section at all.
**Warning signs:** Existing projects breaking after hive-tools.js update.

### Pitfall 7: Source/Installed Copy Desync

**What goes wrong:** Modifying `hive/bin/hive-tools.js` but not `.claude/hive/bin/hive-tools.js` (or templates).
**Why it happens:** Dual-file architecture requires manual sync.
**How to avoid:** After every modification, copy source to installed location. Use `wc -l` comparison to verify sync.
**Warning signs:** `wc -l` mismatch between source and installed copy.

## Code Examples

### Example 1: withFileLock + atomicWrite Combined Usage

```javascript
// Safely update STATE.md (SAFE-01 + SAFE-02 combined)
function safeUpdateState(cwd, updateFn) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  withFileLock(statePath, () => {
    const current = safeReadFile(statePath) || '';
    const updated = updateFn(current);
    atomicWriteFileSync(statePath, updated);
  });
}
```

### Example 2: execCommand for Git Operations

```javascript
// Create dev branch using structured spawnSync wrapper
function cmdGitCreateDevBranch(cwd, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }
  const devBranch = config.git_dev_branch || 'dev';

  // Check if branch already exists
  const check = execCommand('git', ['rev-parse', '--verify', devBranch], { cwd });
  if (check.success) {
    output({ success: true, branch: devBranch, created: false,
             reason: 'already_exists' }, raw, devBranch);
    return;
  }

  // Create from current branch
  const create = execCommand('git', ['checkout', '-b', devBranch], { cwd });
  if (!create.success) {
    output({ success: false, error: create.stderr }, raw, 'failed');
    return;
  }
  output({ success: true, branch: devBranch, created: true }, raw, devBranch);
}
```

### Example 3: Build Command Detection with Config Override

```javascript
function cmdGitDetectBuildCmd(cwd, raw) {
  const config = loadConfig(cwd);
  // Config override takes precedence (SETUP-03)
  if (config.git_build_command) {
    output({ detected: true, command: config.git_build_command,
             source: 'config', override: true }, raw, config.git_build_command);
    return;
  }
  // Auto-detect (SETUP-02)
  const result = detectBuildCommand(cwd);
  if (result.detected) {
    output(result, raw, result.command);
  } else {
    output({ detected: false, command: null, source: null,
             message: 'none detected' }, raw, 'none detected');
  }
}
```

### Example 4: Git Version and gh CLI Detection

```javascript
function cmdGitDetect(cwd, raw) {
  const gitResult = execCommand('git', ['--version'], { cwd });
  let gitVersion = null;
  let mergeTreeAvailable = false;
  if (gitResult.success) {
    const match = gitResult.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (match) {
      gitVersion = match[1];
      const [major, minor] = gitVersion.split('.').map(Number);
      mergeTreeAvailable = major > 2 || (major === 2 && minor >= 38);
    }
  }

  const ghResult = execCommand('gh', ['--version'], { cwd });
  const ghAvailable = ghResult.success;
  let ghVersion = null;
  if (ghAvailable) {
    const match = ghResult.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (match) ghVersion = match[1];
  }

  output({
    git: { version: gitVersion, merge_tree: mergeTreeAvailable },
    gh: { available: ghAvailable, version: ghVersion },
  }, raw, 'git ' + (gitVersion || 'unknown') + ', gh ' + (ghAvailable ? ghVersion : 'not found'));
}
```

### Example 5: Run Build Gate with Timeout

```javascript
function cmdGitRunBuildGate(cwd, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const buildCmd = config.git_build_command || detectBuildCommand(cwd).command;
  if (!buildCmd) {
    output({ success: true, skipped: true,
             reason: 'no build command detected' }, raw, 'skipped');
    return;
  }

  // IMPORTANT: config timeout is seconds, spawnSync expects milliseconds
  const timeoutMs = (config.git_build_timeout || 300) * 1000;
  const parts = buildCmd.split(/\s+/);
  const result = execCommand(parts[0], parts.slice(1), { cwd, timeout: timeoutMs });

  output({
    success: result.success,
    command: buildCmd,
    exitCode: result.exitCode,
    timedOut: result.timedOut || false,
    stdout: result.stdout.slice(0, 2000),
    stderr: result.stderr.slice(0, 2000),
  }, raw, result.success ? 'passed' : 'failed');
}
```

### Example 6: CLI Router Addition Pattern

New `git` case in the switch(command) block, following the established pattern:

```javascript
case 'git': {
  const subcommand = args[1];
  if (subcommand === 'create-dev-branch') {
    cmdGitCreateDevBranch(cwd, raw);
  } else if (subcommand === 'create-plan-branch') {
    const nameIdx = args.indexOf('--name');
    cmdGitCreatePlanBranch(cwd, nameIdx !== -1 ? args[nameIdx + 1] : null, raw);
  } else if (subcommand === 'detect-build-cmd') {
    cmdGitDetectBuildCmd(cwd, raw);
  } else if (subcommand === 'run-build-gate') {
    cmdGitRunBuildGate(cwd, raw);
  } else if (subcommand === 'create-pr') {
    // parse --base, --title, --body flags
    cmdGitCreatePr(cwd, options, raw);
  } else if (subcommand === 'self-merge-pr') {
    cmdGitSelfMergePr(cwd, args[2], raw);
  } else if (subcommand === 'merge-dev-to-main') {
    cmdGitMergeDevToMain(cwd, raw);
  } else if (subcommand === 'check-conflicts') {
    const branchIdx = args.indexOf('--branch');
    cmdGitCheckConflicts(cwd, branchIdx !== -1 ? args[branchIdx + 1] : null, raw);
  } else if (subcommand === 'delete-plan-branch') {
    cmdGitDeletePlanBranch(cwd, args[2], raw);
  } else if (subcommand === 'current-branch') {
    cmdGitCurrentBranch(cwd, raw);
  } else if (subcommand === 'detect') {
    cmdGitDetect(cwd, raw);
  } else {
    error('Unknown git subcommand. Available: create-dev-branch, ..., detect');
  }
  break;
}
```

### Example 7: Test Patterns for Git Subcommands

Following the existing hive-tools.test.js convention of temp projects with beforeEach/afterEach:

```javascript
describe('git subcommands', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    // Initialize git repo in temp project
    execSync('git init && git add . && git commit -m "init" --allow-empty',
             { cwd: tmpDir, stdio: 'pipe' });
  });
  afterEach(() => { cleanup(tmpDir); });

  test('current-branch returns branch name', () => {
    const result = runGsdTools('git current-branch', tmpDir);
    assert.ok(result.success);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.success);
    assert.ok(parsed.branch);
  });

  test('detect-build-cmd detects npm test', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } }));
    const result = runGsdTools('git detect-build-cmd', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.command, 'npm test');
    assert.strictEqual(parsed.source, 'package.json');
  });

  test('detect-build-cmd returns none for empty project', () => {
    const result = runGsdTools('git detect-build-cmd', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.detected, false);
  });

  test('git subcommands skip when flow is none', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ git: { flow: 'none' } }));
    const result = runGsdTools('git create-dev-branch', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.skipped, true);
  });
});
```

### Example 8: Atomic Write Test

```javascript
describe('atomicWriteFileSync', () => {
  test('write is atomic - no partial content visible', () => {
    const tmpDir = createTempProject();
    const filePath = path.join(tmpDir, '.planning', 'test.md');
    fs.writeFileSync(filePath, 'original');

    // Atomic write should fully replace
    // (call atomicWriteFileSync via CLI if exposed, or test the function directly)
    atomicWriteFileSync(filePath, 'new content');
    assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), 'new content');

    // Verify no orphaned temp files
    const files = fs.readdirSync(path.dirname(filePath));
    const tmpFiles = files.filter(f => f.startsWith('.tmp-'));
    assert.strictEqual(tmpFiles.length, 0, 'No orphaned temp files');

    cleanup(tmpDir);
  });
});
```

## State of the Art

| Old Approach (current) | New Approach (Phase 8) | Impact |
|------------------------|----------------------|--------|
| `execSync` for git commands (try/catch for errors) | `spawnSync` via `execCommand` (structured return) | Clean error handling, no exceptions for expected failures |
| Direct `fs.writeFileSync` to shared files | `atomicWriteFileSync` (temp+rename) | Crash-safe writes, no partial file corruption |
| No file locking | mkdir-based `acquireLock`/`releaseLock` | Safe concurrent access from parallel agents |
| Flat config with no git section | `git` section in config.json | Configurable git workflow with auto-detection |
| No build command awareness | `detectBuildCommand` with 8 project types | Automatic build gate support |

**Not deprecated:**
- The existing `execGit` function is NOT deprecated. It continues to work for existing callers. New git subcommands use the new `execCommand` with spawnSync.
- The existing `loadConfig` flattened return format is NOT changed. New git fields are added following the same flat pattern (e.g., `git_flow`, `git_dev_branch`).

## Open Questions

1. **Should `acquireLock` use a synchronous sleep or a polling loop for retries?**
   - What we know: A busy-wait loop with `Date.now()` is simplest. `spawnSync('sleep', ['0.1'])` works but spawns a child process per retry.
   - What's unclear: Which is more appropriate for a CLI tool that runs briefly.
   - Recommendation: Use a `Date.now()` polling loop. Lock contention should be rare in practice (Claude Code agents are sequential within a terminal). LOW priority.

2. **Should the existing 30+ `writeFileSync` calls be refactored to use `atomicWriteFileSync`?**
   - What we know: SAFE-02 says "all file writes use atomic pattern." There are 30+ existing `writeFileSync` calls. Refactoring all is a large diff.
   - What's unclear: Whether the requirement means "all future writes" or "all existing + future writes."
   - Recommendation: Apply atomic writes to the three explicitly named shared files (STATE.md, config.json, merge-queue.json) and all new git subcommand writes. Refactoring all 30+ existing calls risks regressions in tested code and should be a separate follow-up if needed. The planner should decide scope.

3. **How should the `loadConfig` function be extended?**
   - What we know: It returns a flat object with ~11 fields. Adding 6+ git fields expands it.
   - What's unclear: Whether to keep the flat pattern or add a `git` sub-object.
   - Recommendation: Add git fields as flat properties with `git_` prefix (e.g., `git_flow`, `git_dev_branch`, `git_build_command`). The `get()` helper already supports `{ section: 'git', field: 'flow' }` syntax for reading from nested config JSON while returning flat results. This maintains consistency.

4. **Should `os` be imported at the module level?**
   - What we know: `os` is not currently imported. Needed for `os.platform()` to distinguish `which` vs `where`.
   - What's unclear: Whether platform detection is needed if we handle errors from spawnSync gracefully.
   - Recommendation: Import `os` at the top alongside `fs`, `path`, `child_process`. It is Node.js stdlib (no dependency). The platform check avoids unnecessary child process spawns on Windows.

## Sources

### Primary (HIGH confidence)

All findings based on direct source code reading and Node.js official documentation:

- `hive/bin/hive-tools.js` (5439 lines): Complete CLI utility with all existing patterns
  - Lines 127-129: Current imports (`fs`, `path`, `execSync` from `child_process`)
  - Lines 174-225: `loadConfig` function with flat config extraction and `get()` helper
  - Lines 239-258: `execGit` function using `execSync` with try/catch
  - Lines 796-808: `output` and `error` helpers for structured JSON output
  - Lines 5017-5439: CLI router with switch/case dispatch
  - 30+ `writeFileSync` calls throughout (non-atomic, would benefit from upgrade)
  - 0 `spawnSync` calls (not used yet in the codebase)
- `hive/templates/config.json` (45 lines): Current config template with no git section
- `hive/bin/hive-tools.test.js` (2033 lines): Test patterns with temp project setup
- `.planning/research/GIT-WORKFLOW-RECOMMENDATIONS.md`: Full git workflow design document including build gate strategy, conflict detection, and config schema
- `.planning/REQUIREMENTS.md`: v2.0 requirements (SAFE-01, SAFE-02, SETUP-01-04, INTG-04)
- `.planning/STATE.md`: Prior decisions (mkdir locks, spawnSync, same-dir rename, build gates on by default, merge commit --no-ff)
- `.planning/codebase/CONVENTIONS.md`: Naming patterns, code style, import order
- `.planning/codebase/ARCHITECTURE.md`: 4-layer architecture, file-based communication
- [Node.js fs.mkdirSync docs](https://nodejs.org/api/fs.html#fsmkdirsyncpath-options) - EEXIST throw behavior without recursive flag
- [Node.js child_process.spawnSync docs](https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options) - Structured return object with status, stdout, stderr
- [Node.js fs.renameSync docs](https://nodejs.org/api/fs.html#fsrenamesyncoldpath-newpath) - Atomic rename semantics on same filesystem
- [git-merge-tree documentation](https://git-scm.com/docs/git-merge-tree) - Available since git 2.38, conflict detection without worktree

### Secondary (MEDIUM confidence)

- [npm/write-file-atomic](https://github.com/npm/write-file-atomic) - Reference implementation for atomic writes; our pattern is the same logic without the dependency
- [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) - mkdir-based lock reference; confirms cross-platform atomicity of mkdir
- [LogRocket: Understanding Node.js file locking](https://blog.logrocket.com/understanding-node-js-file-locking/) - Confirms mkdir atomicity across filesystem types
- [Node.js issue #19077](https://github.com/nodejs/node/issues/19077) - EXDEV behavior confirming same-directory rename is required to avoid cross-device errors

### Tertiary (LOW confidence)

None. All findings verified with primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Safety primitives (locks, atomic writes): HIGH - Well-understood Node.js stdlib patterns with prior art in proper-lockfile and write-file-atomic
- Config schema extension: HIGH - Follows existing loadConfig pattern exactly; no new abstractions
- Git subcommands: HIGH - Each is a thin wrapper around spawnSync + git/gh commands; patterns verified against existing execGit
- Build detection: HIGH - File-existence-based detection is deterministic; npm default placeholder is the only edge case identified
- Pitfalls: HIGH - All identified from direct code reading and known platform behaviors

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (stable Node.js stdlib patterns, unlikely to change)
