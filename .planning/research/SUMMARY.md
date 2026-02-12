# Project Research Summary

**Project:** Hive v2.0 - Pro Git Flow
**Domain:** AI agent orchestration - professional git workflow integration
**Researched:** 2026-02-12
**Confidence:** HIGH

## Executive Summary

This research establishes the foundation for adding enterprise-grade git workflow capabilities to Hive, targeting the critical gap in the AI agent orchestration ecosystem: no existing tool provides build validation, project-aware merge management, and graceful single-to-multi-terminal scaling. The recommended approach is Modified GitHub Flow with plan-level branch isolation, three-tier build gates, and a repo manager pattern that works identically in single-terminal (sequential, self-merge) and multi-terminal (parallel, managed queue) modes.

The technical foundation is exceptionally strong: Node.js stdlib provides all necessary primitives (spawnSync for long-running commands, mkdir-based atomic locking, same-directory temp+rename for atomic writes) without adding dependencies. Git 2.38+ provides conflict detection via merge-tree without touching the worktree. The gh CLI handles PR creation/merge with proper non-interactive safeguards. The architecture leverages Hive's existing file-based communication pattern, extending it with .hive-workers/ for merge queues and worker coordination.

Key risks center on cross-platform file operations (flock unavailable on macOS requires mkdir-based locks, cross-filesystem rename breaks atomicity, index.lock contention from Claude Code background operations), gh CLI interactive mode hangs (requires explicit stdin redirection and all required flags), and merge queue corruption from concurrent access (requires proper locking and atomic writes from day one). All risks have proven mitigations documented in PITFALLS.md. The zero-dependency constraint drives every architectural decision and remains achievable.

## Key Findings

### Recommended Stack

The existing Node.js stdlib provides everything needed without new dependencies. Critical additions: spawnSync for new git/gh commands (returns structured results without throwing on non-zero exit, safer than execSync for merge-tree which uses exit 1 for conflicts), mkdir-based file locking (atomic on all platforms, used by proper-lockfile library), and same-directory temp+rename for atomic writes (rename() is only atomic on same filesystem, os.tmpdir() would break this).

**Core technologies:**
- **child_process.spawnSync** (new usage): Long-running git/gh commands - structured exit handling, no shell injection, timeout support
- **fs.mkdirSync** (new usage): File locking via atomic directory creation - POSIX-guaranteed atomicity, works on macOS/Linux/Windows
- **fs.renameSync** with same-dir temp files (new pattern): Atomic file writes - prevents corruption on crash, safe for merge-queue.json/registry.json
- **git merge-tree --write-tree** (Git 2.38+): Conflict detection - read-only, exit 1 = conflicts not error, requires version check
- **gh CLI** (optional dependency): PR workflow - requires pre-flight auth check, all commands need non-interactive mode with stdin redirection

**Version compatibility:**
- Node.js 16.7.0+ (existing constraint)
- Git 2.38+ recommended (2.17 minimum with degraded merge-tree)
- gh CLI 2.0+ (optional, full degradation when missing)

### Expected Features

Research across ccswarm, Gas Town, workmux, Clash, and multi-agent-worktrees reveals a stark gap: **every tool provides branch isolation, but NONE provide build validation**. This is Hive's opportunity.

**Must have (table stakes):**
- **Dev branch + plan-level branching** - Universal across all competitors, isolates agent work from main
- **Build command auto-detection** - Detect from package.json/Cargo.toml/pyproject.toml/go.mod/Makefile, user override supported
- **PR creation via gh CLI** - Creates audit trail, integrates with GitHub ecosystem, standard in Copilot/Claude-flow
- **Pre-PR build gate (Gate 1)** - Validates plan before PR creation, catches obvious breaks early
- **Atomic task commits** - Already built in Hive v1, confirmed table stakes by all sources
- **Configurable opt-in** - Backward compatible branching_strategy: "none" preserves current behavior

**Should have (differentiators):**
- **Pre-merge build gate (Gate 2)** - Tests MERGE RESULT not just branch, catches integration failures, no competitor does this
- **Merge queue with wave-aware ordering** - Leverages Hive's wave/dependency model, sequences merges intelligently
- **Repo manager agent** - Dedicated agent for git ops, understands roadmap/waves/dependencies unlike Gas Town's shallow Refinery
- **Conflict detection via merge-tree** - Proactive detection without modifying repo, Clash does this but as separate tool
- **Plan-aware PR descriptions** - Auto-populated from SUMMARY.md with task list and dependency context
- **Seamless single/multi-terminal degradation** - Same workflow, different parallelism level, no competitor handles this

**Defer (v2+, multi-terminal milestone):**
- **Worktree management** - Explicitly deferred per v2.0 scope, Foundation targets single-terminal
- **Worker registry and file signaling** - Multi-terminal coordination, not needed for Foundation
- **Continuous conflict monitoring** - Advanced optimization, basic conflict detection sufficient
- **AI-powered merge resolution** (anti-feature) - Prevention (wave planning, file overlap detection) over resolution

### Architecture Approach

The architecture extends Hive's existing patterns without breaking them. All git operations live in hive-tools.js (new git subcommand group), workflows orchestrate by calling hive-tools commands (existing pattern), agents never touch git directly (existing pattern). The orchestrator (execute-phase) owns branching, the executor commits to "current branch" as it already does.

**Major components:**
1. **hive-tools.js git subcommands** (Phase 1) - 10 new commands: create-dev-branch, create-plan-branch, delete-plan-branch, detect-build-cmd, run-build-gate, create-pr, self-merge-pr, merge-dev-to-main, check-conflicts, current-branch. All return JSON. All follow existing patterns.
2. **Config schema extension** (Phase 1) - New git section in config.json: flow ("none" | "github"), dev_branch, plan_branches, auto_pr, build_gates (pre_pr/pre_merge/pre_main), multi_terminal. Backward compatible via loadConfig defaults.
3. **Workflow modifications** (Phase 1) - Execute-phase adds plan branching per wave, execute-plan adds build gate before PR, complete-milestone adds dev-to-main merge, settings adds git flow options. 5 files modified, zero new files.
4. **Merge queue + repo manager** (Phase 2) - .hive-workers/merge-queue.json with ordered PR requests, file-based signaling via signals/, repo manager agent watches queue and merges in wave order. Single-terminal: self-managed mode (each worker is own repo manager).
5. **Worktree coordination** (Phase 3, deferred) - Worker registry, worktree creation/cleanup, multi-terminal assignment, file-based signals between workers.

**Key architectural decisions:**
- **Orchestrator-owned branching** - Executors commit to current branch, orchestrator handles checkout. No agent modifications needed.
- **hive-tools.js as git abstraction** - All git ops through CLI returning JSON, never raw git in workflows. Consistent error handling.
- **Config-gated progressive enhancement** - Every feature behind flags, branching_strategy: "github" is master toggle. Users opt in.
- **File-based coordination** - Extends existing .planning/ pattern with .hive-workers/, no sockets/IPC, works across any terminal setup.

### Critical Pitfalls

The research identifies 16 documented pitfalls with proven prevention strategies. Top 5 must be addressed in Phase 1:

1. **flock CLI unavailable on macOS** - Do NOT use shell flock command. Implement all locking in Node.js via fs.mkdirSync (atomic on all platforms). WSL1 also has flock directory lock bugs. Use mkdir-based pattern from proper-lockfile library.

2. **Claude Code index.lock contention** - Background git status creates stale .git/index.lock files lasting 20+ seconds. Use --no-optional-locks for ALL read-only git operations. Implement retry-with-backoff for writes (max 3 attempts). Worktrees provide index isolation in multi-terminal.

3. **gh pr create hangs in interactive mode** - Always push branch first, provide all required flags (--base, --head, --title, --body, --repo), redirect stdin from /dev/null, set GH_PROMPT_DISABLED=1, timeout all gh commands at 30s.

4. **gh CLI not installed/authenticated (late discovery)** - Pre-flight check during init execute-phase returns gh_available and gh_authenticated. Check BEFORE spawning agents. Graceful degradation: missing → git-only merge, not authenticated → warn and offer gh auth login.

5. **Merge queue corruption from concurrent read-modify-write** - All queue operations through single function: acquire lock (mkdir + stale detection), read inside lock, modify in memory, write to same-dir temp file, fsync, atomic rename, release lock. JSON schema validation on every read.

**Additional critical pitfalls (Phase 2/3):**
- Orphaned worktrees after crashes - Startup cleanup via git worktree prune + registry heartbeat stale detection
- Cross-filesystem rename breaks atomicity - Temp files MUST be in path.dirname(targetFile), never os.tmpdir()
- execSync throws on merge-tree exit 1 - Use spawnSync for conflict detection, exit 1 = conflicts not error
- Build timeout without cleanup - Always git merge --abort in finally block for Gate 2

## Implications for Roadmap

Research strongly suggests three-phase structure aligned with v2.0 scope: Foundation (single-terminal end-to-end), Repo Manager (merge queue + validation), Multi-Terminal (deferred). This ordering validates dependencies, enables incremental testing, and defers worktree complexity until the core flow proves stable.

### Phase 1: Foundation (Single-Terminal Git Workflow)
**Rationale:** Establish complete end-to-end flow in single-terminal mode before adding multi-terminal complexity. Sequential plan execution with plan-level branches, build gates, PRs, and self-merge. Every new command and workflow modification proven in simplest case.

**Delivers:**
- Dev branch auto-creation on project init
- Plan-level branch lifecycle (create from dev, commit tasks, delete after merge)
- Build command auto-detection across 5 ecosystems (npm/cargo/pytest/go/make)
- Pre-PR build gate (Gate 1) with retry/fix loop
- PR creation via gh CLI with full non-interactive safeguards
- Self-merge in single-terminal mode
- Plan-aware PR descriptions from SUMMARY.md

**Addresses features:** Dev branch creation, plan-level branching, build detection, pre-PR gate, PR creation, self-merge, atomic commits, configurable opt-in (all table stakes)

**Avoids pitfalls:** flock unavailability (#1 via mkdir locks), index.lock contention (#2 via --no-optional-locks), gh hangs (#3 via non-interactive mode), gh auth late discovery (#4 via init preflight), merge queue corruption prevention (#5 via atomic file writes), config backward compat (#16 via loadConfig defaults)

**Implements stack:** spawnSync for new commands, mkdir-based locks, same-dir atomic writes, gh CLI with auth check, build command detection pattern

**Modifies files:** hive-tools.js (git subcommands + loadConfig + cmdInitExecutePhase), config.json template, execute-phase.md, execute-plan.md, settings.md, complete-milestone.md, new-project.md, git-integration.md

**Research flags:** Standard patterns, skip /hive:research-phase. All features have well-documented approaches in STACK/FEATURES/ARCHITECTURE.

### Phase 2: Repo Manager (Merge Queue and Integration Testing)
**Rationale:** Builds on proven Phase 1 foundation. Adds merge queue for ordered PR processing and pre-merge build gate (Gate 2) for integration testing. Repo manager agent processes queue in wave-aware order. Single-terminal uses self-managed mode (proof of concept for multi-terminal without worktrees).

**Delivers:**
- .hive-workers/merge-queue.json with ordered PR requests
- Pre-merge build gate (Gate 2) testing merge result
- Conflict detection via git merge-tree (Git 2.38+ required)
- Wave-aware merge ordering (Wave 1 before Wave 2, smallest diff first within wave)
- Repo manager agent definition (hive-repo-manager.md)
- Worker signaling via signals/ directory
- Pre-main build gate (Gate 3) for dev-to-main merge
- Self-managed mode for single-terminal (each executor acts as own repo manager)

**Addresses features:** Pre-merge build gate (differentiator), merge queue with wave ordering (differentiator), repo manager agent (differentiator), conflict detection (differentiator), pre-main gate (differentiator)

**Avoids pitfalls:** Merge queue corruption (#5 via proper locking), execSync merge-tree (#8 via spawnSync), build timeout cleanup (#9 via finally blocks), self-merge branch protection (#10 via API detection), merge conflict cascade (#11 via wave ordering + retry limits), git version merge-tree (#13 via version check + fallback)

**Implements stack:** git merge-tree --write-tree with version detection, merge queue with mkdir locks, polling with configurable interval (5s default), atomic queue operations

**New files:** agents/hive-repo-manager.md, commands/hive/manage-repo.md

**Research flags:** Needs /hive:research-phase. Wave-aware merge ordering requires understanding Hive's dependency graph. Conflict detection and resolution strategies need validation during planning.

### Phase 3: Multi-Terminal (Worktree Coordination) - DEFERRED
**Rationale:** Explicitly deferred per v2.0 scope. Phases 1-2 provide full single-terminal workflow and self-managed repo manager pattern. Multi-terminal adds worktrees and worker registry but uses same merge queue, same repo manager, same build gates.

**Delivers:**
- git worktree add/remove commands
- Worker registry in .hive-workers/registry.json
- Startup cleanup (prune stale worktrees, orphaned branches)
- Worker heartbeat and stale detection
- /hive:start-worker command
- Parallel plan execution across terminals
- File-based worker signaling

**Addresses features:** Seamless multi-terminal degradation (differentiator already proven in single-terminal self-managed mode)

**Avoids pitfalls:** Orphaned worktrees (#6 via startup cleanup + heartbeat), cross-filesystem rename (#7 already solved in Phase 1), context bloat (#12 via JSON-only returns in Phase 1)

**Implements stack:** git worktree commands (2.17+ required), worker registry with locking, inotifywait for zero-CPU signaling (Linux), polling fallback (cross-platform)

**Research flags:** Standard patterns, skip /hive:research-phase. Worktree management is well-documented (Git official docs, multiple blog posts, existing tools like ccswarm/Gas Town).

### Phase Ordering Rationale

**Why Foundation first:**
- Validates all new hive-tools.js commands in simplest case (no worktrees, no concurrent access)
- Proves build gates work before adding merge complexity
- Establishes PR workflow and gh CLI integration patterns
- Tests atomic file writes and locking before merge queue depends on them
- Every workflow modification tested with sequential execution before parallel

**Why Repo Manager second:**
- Depends on Phase 1's proven git subcommands and atomic file operations
- Self-managed mode in single-terminal proves the repo manager pattern without worktrees
- Merge queue file format can be tested with simulated concurrent access
- Wave-aware ordering leverages existing Hive dependency graph (already built)
- Conflict detection via merge-tree is optional enhancement, not blocker

**Why Multi-Terminal deferred:**
- Worktrees are ONLY needed for true parallel execution across terminals
- Phase 1 proves the git workflow works sequentially
- Phase 2 proves the merge queue and repo manager work (self-managed mode)
- Combining unproven worktrees + unproven merge queue = untestable
- v2.0 scope explicitly states "Foundation + Repo Manager, defer multi-terminal"

**Dependency chain validation:**
- Phase 2 requires Phase 1's git subcommands, config, atomic writes
- Phase 3 requires Phase 2's merge queue, repo manager pattern, signaling
- No circular dependencies, clean linear progression
- Each phase deliverable and testable independently

### Research Flags

**Needs /hive:research-phase during planning:**
- **Phase 2 (Repo Manager):** Wave-aware merge ordering requires deep understanding of dependency graph traversal. Conflict resolution strategies (auto-rebase vs escalate vs queue reordering) need validation against edge cases.

**Standard patterns (skip research-phase):**
- **Phase 1 (Foundation):** All features are table stakes with well-documented implementations. Build command detection patterns proven in brownfield init. PR workflow standard across Copilot/Claude-flow.
- **Phase 3 (Multi-Terminal, deferred):** Worktree management has official Git docs and multiple existing implementations (ccswarm, Gas Town, workmux).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | All Node.js stdlib APIs verified against official v25 docs. Git commands verified against official manpages and release notes. gh CLI verified against official manual. Version requirements cross-checked (Git 2.38 for merge-tree confirmed in release notes). |
| Features | **HIGH** | Comprehensive competitor analysis (7 tools: ccswarm, Gas Town, workmux, Clash, multi-agent-worktrees, Copilot, Claude-flow). Feature gaps validated across multiple sources. Table stakes confirmed by convergence across tools. Differentiators identified where no competitor provides solution. |
| Architecture | **HIGH** | Analyzed existing codebase (hive-tools.js 5440 lines, execute-phase 924 lines, execute-plan 549 lines). All modifications extend existing patterns. Zero breaking changes to agent contract. Integration points identified with line numbers. |
| Pitfalls | **HIGH** | 16 pitfalls documented with sources: flock macOS issue (Homebrew docs), index.lock contention (Claude Code issue #11005), gh hangs (CLI issues #5848, #6468), merge queue corruption (.claude.json issue #18998), worktree orphaning (Auto-Claude #694). All have proven mitigations from production systems. |

**Overall confidence:** HIGH

The research is exceptionally thorough with verified sources for every technical claim. Stack recommendations are stdlib-only and version-compatible. Feature analysis covers the entire ecosystem. Architecture leverages proven Hive patterns. Pitfalls are documented issues with tested solutions, not hypothetical risks.

### Gaps to Address

**Gap: Git 2.38 adoption rate**
- merge-tree --write-tree requires Git 2.38+ (October 2022)
- Ubuntu 22.04 LTS ships Git 2.34
- **Resolution:** Version check at init, graceful fallback to git merge --no-commit for conflict detection, document minimum version in prerequisites

**Gap: gh CLI scope requirements**
- PR merge may need repo scope, some features need workflow scope
- **Resolution:** Pre-flight check includes scope validation via gh api user, clear error message with required scopes if insufficient

**Gap: Branch protection rules on dev branch**
- Self-merge fails if dev has required reviews or status checks
- **Resolution:** Detect via gh api repos/{owner}/{repo}/branches/dev/protection during init, offer options (admin bypass with opt-in, skip PRs and use git merge, manual merge mode)

**Gap: Build command detection accuracy**
- Default npm test script ("Error: no test specified") should be skipped
- Some projects have test scripts that require setup (DB, env vars)
- **Resolution:** Skip known placeholder scripts, allow user override in config.git.build_command, build gate failure offers "skip gates" option

**Gap: Wave-aware merge ordering edge cases**
- Two plans in same wave modify same file (both pass build alone, conflict when merged)
- Second plan's rebase creates NEW conflicts that didn't exist before
- **Resolution:** Pre-execution file overlap detection (compare files_modified from frontmatter), max 2 rebase retry attempts then escalate, merge smaller diffs first within wave

All gaps have clear resolution strategies and do not block Phase 1 implementation. Most can be handled with graceful degradation or user configuration.

## Sources

### Primary Research Files (Generated)
- `.planning/research/STACK.md` - Node.js stdlib APIs, git commands, version requirements (HIGH confidence, official docs)
- `.planning/research/FEATURES.md` - Ecosystem analysis, feature categories, MVP definition (HIGH confidence, 7 competitor tools)
- `.planning/research/ARCHITECTURE.md` - Component design, integration patterns, data flow (HIGH confidence, codebase analysis)
- `.planning/research/PITFALLS.md` - 16 documented pitfalls with sources and prevention (HIGH confidence, verified issues)
- `.planning/research/GIT-WORKFLOW-RECOMMENDATIONS.md` - Pre-research analysis, risk assessment (MEDIUM confidence, initial exploration)

### Stack Sources (HIGH confidence)
- [Node.js v25 child_process documentation](https://nodejs.org/api/child_process.html)
- [Node.js v25 fs documentation](https://nodejs.org/api/fs.html)
- [Git merge-tree official documentation](https://git-scm.com/docs/git-merge-tree)
- [Git 2.38.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.38.0.txt)
- [Git worktree official documentation](https://git-scm.com/docs/git-worktree)
- [gh pr create manual](https://cli.github.com/manual/gh_pr_create)
- [gh pr merge manual](https://cli.github.com/manual/gh_pr_merge)

### Feature Sources (HIGH confidence)
- [ccswarm: Multi-agent orchestration](https://github.com/nwiizo/ccswarm)
- [Gas Town: Multi-agent workspace manager](https://github.com/steveyegge/gastown)
- [Clash: Merge conflict detection](https://github.com/clash-sh/clash)
- [workmux: Git worktrees + tmux](https://github.com/raine/workmux)
- [multi-agent-worktrees: Git worktree setup](https://github.com/dtedesco1/multi-agent-worktrees)
- [GitHub Copilot coding agent docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)
- [claude-flow: Agent orchestration platform](https://github.com/ruvnet/claude-flow)

### Pitfall Sources (HIGH confidence)
- [flock not available on macOS - Homebrew](https://formulae.brew.sh/formula/flock)
- [Stale index.lock - Claude Code #11005](https://github.com/anthropics/claude-code/issues/11005)
- [gh pr create non-interactive - gh CLI #5848](https://github.com/cli/cli/issues/5848)
- [gh pr merge --admin bypass - gh CLI #8971](https://github.com/cli/cli/issues/8971)
- [Stale worktree branch - Auto-Claude #694](https://github.com/AndyMik90/Auto-Claude/issues/694)
- [.claude.json corruption - Claude Code #18998](https://github.com/anthropics/claude-code/issues/18998)
- [proper-lockfile npm package](https://www.npmjs.com/package/proper-lockfile)

---
*Research completed: 2026-02-12*
*Ready for roadmap: YES*
*Synthesized by: hive-synthesizer agent*
