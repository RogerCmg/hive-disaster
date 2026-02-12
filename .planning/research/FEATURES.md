# Feature Research: Professional Git Workflow for Hive

**Domain:** AI agent orchestration -- git workflow integration
**Researched:** 2026-02-12
**Confidence:** HIGH (ecosystem well-researched, patterns converging across tools)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that every AI agent orchestration tool with git integration provides or that users assume exist. Missing these means Hive's git workflow feels half-baked compared to ccswarm, Gas Town, workmux, and Claude Code Swarm Mode.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Dev branch creation** | Every tool isolates AI work from main. GitHub Copilot uses `copilot/` prefix branches, Gas Town uses worktree branches, multi-agent-worktrees uses `agent/**` branches. Working directly on main is universally rejected as dangerous. | LOW | Extend existing `branching_strategy` config. Auto-create `dev` on project init when `git.flow` is set. |
| **Plan-level branch isolation** | ccswarm, Gas Town, workmux, multi-agent-worktrees ALL create per-task/per-agent branches. This is the single most consistent pattern across the entire ecosystem. Agents need isolated workspaces to avoid corrupting each other's work. | MEDIUM | Branch from `dev`, one branch per plan. Naming: `hive/phase-{N}-{plan}-{slug}`. Must handle branch lifecycle (create/delete). |
| **Build command auto-detection** | Build validation before merge is table stakes. GitHub Copilot runs security scans before finalizing PRs. Claude Code Swarm Mode merges "only when tests pass." Every serious tool validates before integration. Detection of the build command is prerequisite. | MEDIUM | Detect from package.json/Cargo.toml/pyproject.toml/go.mod/Makefile. Allow user override via `git.build_command`. Hive-tools.js new command. |
| **Pre-PR build gate** | The first validation checkpoint. Run build/test BEFORE creating a PR. Catches obvious breaks early. Standard in all professional CI workflows and now expected in AI agent flows. | MEDIUM | Run detected build command after plan completion, before PR creation. Block PR if build fails. Give executor agent chance to fix. |
| **PR creation via gh CLI** | PRs are the universal integration mechanism. GitHub Copilot creates draft PRs automatically. Claude-flow has a pr-manager agent. multi-agent-worktrees uses PRs with required status checks. PRs create audit trail, enable review, and integrate with GitHub's ecosystem. | LOW | `gh pr create --base dev --head plan-branch`. Include plan SUMMARY in PR body. Tag with plan metadata. |
| **Self-merge for single-terminal** | Single-terminal mode cannot wait for external review. The agent must create AND merge its own PRs. workmux does this with `workmux merge`. This is the graceful degradation path. | LOW | `gh pr merge --squash` (or `--merge` per config) immediately after PR creation in single-terminal mode. |
| **Atomic task commits** | Already implemented in Hive v1. Per-task commits with conventional commit format. This is confirmed table stakes by every source -- Anthropic's own best practices say "commit small, logical changes often." | ALREADY BUILT | Existing `hive-tools.js commit` command. No changes needed. |
| **Configurable opt-in** | Users must be able to disable the entire git workflow. ccswarm, Gas Town, and workmux are all separate tools users install. Hive embeds this, so it MUST be optional. Current `branching_strategy: "none"` pattern is correct. | LOW | Add `git.flow: "none" | "github"` to config.json. When "none", all new features are bypassed. Backward compatible. |

### Differentiators (Competitive Advantage)

Features where Hive can stand apart from ccswarm, Gas Town, workmux, Clash, and multi-agent-worktrees. These tools are either shallow (worktree + branch only) or narrowly focused (Clash = conflict detection only). Hive can provide the integrated, end-to-end experience none of them offer.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Pre-merge build gate (Gate 2)** | Tests the MERGE RESULT, not just the branch. Catches integration failures where Plan A passes alone and Plan B passes alone but together they break. No competitor tool does this. ccswarm has no build gates. Gas Town has no build gates. workmux has no build gates. Clash only detects conflicts, not build failures. This is the gap in the ecosystem. | MEDIUM | `git merge --no-commit --no-ff $BRANCH` into dev, run build, `git merge --abort`. Real integration testing. Requires repo manager or self-managed mode. |
| **Pre-main build gate (Gate 3)** | Final validation before dev merges to main. Full build + lint. Milestone-level quality gate. No competitor does this because most don't model the dev-to-main promotion step at all. | LOW | Run on milestone completion or manual trigger. Straightforward extension of Gate 1/2 pattern. |
| **Merge queue with wave-aware ordering** | Sequential merge processing with dependency awareness. Gas Town's Refinery merges sequentially but without wave awareness. Swarm-Tools uses reservation-based locking. Hive's wave model (plans grouped by dependency) provides natural merge ordering that no competitor has. Wave 1 merges before Wave 2. Within a wave, merge smallest-diff first. | HIGH | File-based queue (`.hive-workers/merge-queue.json`). Requires understanding of plan dependency graph. Critical for multi-terminal but also valuable for single-terminal ordering. |
| **Repo manager agent** | Dedicated agent for git operations so executor agents stay focused on code. Gas Town has a "Refinery" role but it's shallow. Claude-flow has a pr-manager but it's a generic GitHub bot, not plan-aware. Hive's repo manager understands the roadmap, waves, dependencies, and plan state. | HIGH | New agent definition. Watches merge queue, validates PRs, merges in order, signals workers. Single-terminal: self-managed mode (each worker is its own repo manager). |
| **Conflict detection via git merge-tree** | Proactive conflict detection between active plan branches WITHOUT modifying the repo. Clash does this as a standalone tool. Hive can embed this directly into the workflow -- check for conflicts before plan completion, warn the executor agent to adjust approach. No context switch to a separate tool. | MEDIUM | `git merge-tree $(git merge-base branch-a branch-b) branch-a branch-b`. Integrate into repo manager loop and optionally into pre-PR gate. Read-only, safe for continuous monitoring. |
| **Seamless single/multi-terminal degradation** | Same workflow works in both modes. The ONLY difference is parallelism and who manages the merge queue. No competitor handles this well -- ccswarm is multi-terminal only, workmux is multi-terminal only, Clash is an external tool. Hive works identically in single-terminal (sequential plans, self-merge) and multi-terminal (parallel plans, repo manager merges). | MEDIUM | Architecture decision, not a feature to build separately. Single-terminal: sequential plans, create PR, self-merge. Multi-terminal: parallel plans, submit to merge queue, repo manager merges. Same branch/PR/gate flow. |
| **Plan-aware PR descriptions** | PRs auto-populated with plan metadata: tasks completed, files modified, dependency context, wave position. GitHub Copilot generates PR descriptions but without project-level context. Hive knows the entire roadmap and can create rich, contextual PR descriptions. | LOW | Template-based PR body generation from plan SUMMARY.md. Include task list, commit hashes, dependency links. Minimal effort, high value for audit trail. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem valuable but create complexity, fragility, or maintenance burden disproportionate to their value. These are explicitly called out as things NOT to build.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **AI-powered merge conflict resolution** | Reconcile-AI, SyncWright, and Graphite tout AI conflict resolution. Seems like a natural fit for an AI orchestration tool. | Git's line-based merge already produces 48% false conflicts (Weave benchmarks). AI resolution adds another layer of uncertainty. Hive agents lack the semantic understanding of the FULL codebase needed for reliable resolution. Incorrect auto-resolution is worse than a conflict error because it silently introduces bugs. The cost of debugging a bad auto-merge dwarfs the cost of manual resolution. | **Prevention over resolution.** Plan-level branch isolation + wave-based dependency ordering + file overlap detection before execution. When conflicts do occur: signal the executor agent to rebase (it has full context of its own changes), or escalate to user. |
| **Entity-level semantic merge (Weave-style)** | Weave's tree-sitter approach resolves Git's false conflicts by merging at function/class level instead of line level. Sounds like a silver bullet. | Requires tree-sitter parsers for every language the user's project uses. Adds a native binary dependency (tree-sitter is C-based). Hive is a zero-dependency markdown system -- adding tree-sitter breaks the architecture. The problem it solves (false conflicts between parallel agents) is better addressed by preventing file overlap in wave planning. | **File overlap detection** at plan time. If two plans in the same wave touch the same files, warn the user and suggest sequential execution. This is cheaper, more reliable, and language-agnostic. |
| **Real-time file watching with inotifywait** | multi-agent-shogun uses inotifywait for zero-CPU message passing. Seems efficient. | Platform-specific (Linux only, macOS needs fsevents, Windows needs ReadDirectoryChanges). Adds complexity for marginal benefit over polling. Hive's merge queue is a single JSON file checked every 5 seconds -- the polling cost is negligible. inotifywait also requires careful error handling for file system edge cases (atomic renames, NFS mounts). | **Polling with configurable interval.** Default 5 seconds. Simple, cross-platform, reliable. Can add inotifywait as optional optimization later if profiling shows it matters. |
| **Automatic branch creation for every task** | Some tools create a branch per task for maximum isolation. | Creates branch explosion (10 plans x 5 tasks = 50 branches). Each branch needs lifecycle management. Merge overhead multiplied. Task-level branches add no value because tasks within a plan are sequential (no parallel execution at task level). Plan-level isolation is the correct granularity. | **Plan-level branches** (already the recommendation). Tasks commit directly to the plan branch. One branch per plan, not per task. |
| **GitHub Actions / CI integration** | Claude-flow integrates with GitHub Actions. Seems like build gates should trigger CI. | Hive runs locally in a terminal. Waiting for remote CI adds latency (minutes per run). The feedback loop between "agent writes code" and "CI says it broke" is too slow for interactive development. Local build validation is faster and sufficient. | **Local build gates** (Gate 1, 2, 3). Run the project's test suite locally. If the user has CI set up, it runs on the PR automatically via GitHub's existing mechanisms -- Hive doesn't need to orchestrate this. |
| **Multi-repo orchestration** | Some projects span multiple repositories. Supporting multi-repo git workflow seems advanced. | Exponential complexity increase. Cross-repo conflict detection, multi-repo merge queues, distributed PR coordination. This is a fundamentally different problem from single-repo workflow. | **Single-repo focus.** Hive v2.0 scope is clear: one repo, professional git workflow. Multi-repo is a separate future milestone if ever needed. |
| **Worktree management** (in v2.0 Foundation scope) | Gas Town, ccswarm, workmux all use worktrees for multi-agent isolation. | Worktrees are specifically for multi-terminal parallel execution. The v2.0 scope explicitly states "Foundation (single-terminal) + Repo Manager. Multi-terminal deferred." Building worktree management now creates untestable code and premature complexity. | **Defer to multi-terminal milestone.** v2.0 Foundation uses sequential plan branches on a single worktree. Repo manager processes merge queue sequentially. Worktrees added when multi-terminal is in scope. |

## Feature Dependencies

```
[Config: git.flow = "github"]
    |
    +--requires--> [Dev branch creation]
    |                  |
    |                  +--requires--> [Plan-level branching]
    |                                     |
    |                                     +--requires--> [Pre-PR build gate (Gate 1)]
    |                                     |                  |
    |                                     |                  +--requires--> [Build command auto-detection]
    |                                     |
    |                                     +--requires--> [PR creation]
    |                                     |                  |
    |                                     |                  +--requires--> [gh CLI availability check]
    |                                     |                  |
    |                                     |                  +--enhances--> [Plan-aware PR descriptions]
    |                                     |
    |                                     +--requires--> [Self-merge (single-terminal)]
    |
    +--requires--> [Merge queue]
    |                  |
    |                  +--requires--> [Plan-level branching]
    |                  +--requires--> [Wave dependency graph]  (ALREADY BUILT)
    |                  +--enhances--> [Wave-aware merge ordering]
    |
    +--requires--> [Repo manager agent]
    |                  |
    |                  +--requires--> [Merge queue]
    |                  +--requires--> [Pre-merge build gate (Gate 2)]
    |                  |                  |
    |                  |                  +--requires--> [Build command auto-detection]
    |                  |
    |                  +--enhances--> [Conflict detection (git merge-tree)]
    |
    +--optional--> [Pre-main build gate (Gate 3)]
                       |
                       +--requires--> [Dev-to-main merge flow]
                       +--requires--> [Build command auto-detection]

[Conflict detection] --enhances--> [Pre-PR build gate]
[Conflict detection] --enhances--> [Repo manager agent]

[Atomic task commits]  (ALREADY BUILT, no dependencies)
[Configurable opt-in]  (ALREADY BUILT pattern, extend config)
```

### Dependency Notes

- **Plan-level branching requires dev branch:** Plans branch FROM dev. Dev must exist first.
- **All build gates require build auto-detection:** Cannot validate without knowing the build command. Detection is the foundational piece.
- **PR creation requires gh CLI:** Must verify `gh` is installed and authenticated. Graceful error if not available.
- **Merge queue requires wave dependency graph:** Already built in Hive's plan frontmatter (`depends_on` + wave grouping). Merge ordering leverages this existing data.
- **Repo manager requires merge queue:** The repo manager's primary job is processing the merge queue. Without it, there's nothing to manage.
- **Gate 2 (pre-merge) requires repo manager:** Only the repo manager tests merge results against dev. In single-terminal self-managed mode, the executor acts as its own repo manager.
- **Conflict detection enhances but does not require:** Useful for repo manager and pre-PR checks, but the workflow functions without it (conflicts surface as merge failures instead of proactive warnings).

## MVP Definition

### Launch With (v2.0 Foundation -- Single Terminal)

Minimum viable git workflow. Must work end-to-end in single-terminal mode.

- [x] Atomic task commits -- ALREADY BUILT
- [ ] Config extension: `git.flow`, `git.build_gates`, `git.build_command` -- prerequisite for everything
- [ ] Dev branch auto-creation on project init (when `git.flow: "github"`) -- foundation
- [ ] Plan-level branch creation/deletion -- core isolation mechanism
- [ ] Build command auto-detection (`detect-build-cmd` in hive-tools.js) -- prerequisite for all gates
- [ ] Pre-PR build gate (Gate 1) -- first quality checkpoint
- [ ] PR creation via `gh pr create` -- integration mechanism
- [ ] Self-merge in single-terminal mode -- close the loop
- [ ] Plan-aware PR descriptions -- low effort, high value audit trail

### Add After Validation (v2.0 Repo Manager)

Features that require the merge queue and repo manager architecture.

- [ ] Merge queue file format and processing -- when single-terminal PR flow is proven stable
- [ ] Pre-merge build gate (Gate 2: test merge result) -- when merge queue exists
- [ ] Repo manager agent definition -- when merge queue + Gate 2 exist
- [ ] Conflict detection via git merge-tree -- when repo manager exists to act on findings
- [ ] Wave-aware merge ordering -- when merge queue processes multiple PRs
- [ ] Pre-main build gate (Gate 3) -- when dev-to-main merge flow exists
- [ ] Dev-to-main merge flow in complete-milestone workflow -- when Gate 3 exists

### Future Consideration (Multi-Terminal Milestone -- deferred)

Features explicitly deferred per v2.0 scope. Do not build these now.

- [ ] Worktree creation/cleanup -- requires multi-terminal architecture
- [ ] Worker registry (`.hive-workers/registry.json`) -- requires multi-terminal
- [ ] File-based inter-worker signaling -- requires multi-terminal
- [ ] `/hive:start-worker` command -- requires multi-terminal
- [ ] Clash-style continuous conflict monitoring between worktrees -- requires multi-terminal
- [ ] Dynamic worker assignment and load balancing -- requires multi-terminal
- [ ] inotifywait-based signaling (replace polling) -- optimization, not needed yet

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Phase |
|---------|------------|---------------------|----------|-------|
| Config extension (`git` section) | HIGH | LOW | **P1** | Foundation |
| Dev branch creation | HIGH | LOW | **P1** | Foundation |
| Plan-level branching | HIGH | MEDIUM | **P1** | Foundation |
| Build command auto-detection | HIGH | MEDIUM | **P1** | Foundation |
| Pre-PR build gate (Gate 1) | HIGH | MEDIUM | **P1** | Foundation |
| PR creation (gh CLI) | HIGH | LOW | **P1** | Foundation |
| Self-merge (single-terminal) | HIGH | LOW | **P1** | Foundation |
| Plan-aware PR descriptions | MEDIUM | LOW | **P1** | Foundation |
| Merge queue | HIGH | HIGH | **P2** | Repo Manager |
| Pre-merge build gate (Gate 2) | HIGH | MEDIUM | **P2** | Repo Manager |
| Repo manager agent | HIGH | HIGH | **P2** | Repo Manager |
| Conflict detection (merge-tree) | MEDIUM | MEDIUM | **P2** | Repo Manager |
| Wave-aware merge ordering | MEDIUM | MEDIUM | **P2** | Repo Manager |
| Pre-main build gate (Gate 3) | MEDIUM | LOW | **P2** | Repo Manager |
| Dev-to-main merge flow | MEDIUM | LOW | **P2** | Repo Manager |
| Worktree management | HIGH | HIGH | **P3** | Multi-Terminal |
| Worker registry | HIGH | HIGH | **P3** | Multi-Terminal |
| Continuous conflict monitoring | MEDIUM | HIGH | **P3** | Multi-Terminal |

**Priority key:**
- **P1:** Must have for v2.0 Foundation launch. Single-terminal git workflow end-to-end.
- **P2:** Must have for v2.0 Repo Manager. Merge queue and integration testing.
- **P3:** Deferred to multi-terminal milestone. Not in v2.0 scope.

## Competitor Feature Analysis

| Feature | ccswarm | Gas Town | workmux | Clash | multi-agent-worktrees | Copilot Agent | Hive v2.0 Plan |
|---------|---------|----------|---------|-------|----------------------|---------------|----------------|
| **Branch isolation** | Worktree per agent | Worktree per worker | Worktree per feature | N/A (detection only) | Branch per agent (`agent/**`) | `copilot/` prefix branches | Plan-level branches from `dev` |
| **Build validation** | None | None | None | None | Required status checks (external CI) | Security scans before PR finalization | 3-tier local gates (pre-PR, pre-merge, pre-main) |
| **PR creation** | None | None | None | None | Yes (manual trigger) | Auto-creates draft PRs | Auto-create from plan completion |
| **Merge strategy** | Manual | Refinery (sequential rebase) | `workmux merge` (rebase option) | N/A | Manual with rebase requirement | Human-only merge | Merge queue with wave ordering |
| **Conflict detection** | None (relies on worktree isolation) | None | None (advice: "work on separate areas") | Core feature (git merge-tree) | None (rebase requirement) | None | git merge-tree integrated into workflow |
| **Merge queue** | None | Sequential Refinery | None | None | None | None | Wave-aware file-based queue |
| **Single-terminal mode** | No | No | No | N/A | No | N/A (cloud-based) | Yes, with self-merge |
| **Project-aware** | Agent pools (frontend/backend/etc) | Bead-based task tracking | None | None | Agent naming only | Issue-linked | Full roadmap/phase/plan/wave awareness |
| **Zero dependencies** | Requires Rust toolchain | Requires Claude Code | Requires Rust + tmux | Requires Rust | Requires bash scripts | GitHub cloud service | Node.js only (already required) |

### Key Ecosystem Gaps Hive Fills

1. **No tool provides build validation.** ccswarm, Gas Town, workmux, Clash -- none run tests before merging. They assume worktree isolation prevents all problems. It doesn't. Hive's 3-tier build gates are unique.

2. **No tool handles single-terminal gracefully.** Every competitor requires multi-terminal/multi-agent setup. Solo developers using Hive in one terminal get the same branch/PR/gate workflow without the multi-terminal overhead.

3. **No tool is project-aware.** Competitors know about branches and worktrees. Hive knows about phases, plans, waves, dependencies, and the roadmap. Merge ordering is informed by the project structure, not arbitrary.

4. **No tool integrates detection + prevention + validation.** Clash detects conflicts but doesn't prevent them. ccswarm prevents via isolation but doesn't validate. Hive does all three: prevent (wave planning), detect (merge-tree), validate (build gates).

## Feature Categories for Requirements Grouping

### Category 1: Configuration & Setup
- Config extension (`git` section in config.json)
- `gh` CLI availability check
- Build command auto-detection
- Backward compatibility with `branching_strategy: "none"`

### Category 2: Branch Lifecycle
- Dev branch creation on project init
- Plan-level branch creation (branch from dev)
- Plan-level branch deletion (after merge)
- Branch naming conventions (`hive/phase-{N}-{plan}-{slug}`)

### Category 3: Build Validation
- Build command detection (package.json, Cargo.toml, etc.)
- Pre-PR build gate (Gate 1)
- Pre-merge build gate (Gate 2)
- Pre-main build gate (Gate 3)
- Build timeout configuration
- Build failure handling (retry, escalate)

### Category 4: PR & Merge
- PR creation via `gh pr create`
- Plan-aware PR descriptions (SUMMARY.md template)
- Self-merge in single-terminal mode
- Merge queue file format
- Wave-aware merge ordering
- Squash vs merge commit configuration

### Category 5: Conflict Management
- Conflict detection via `git merge-tree`
- File overlap detection at plan time
- Conflict-triggered rebase signaling
- Escalation to user on unresolvable conflicts

### Category 6: Repo Manager
- Repo manager agent definition
- Merge queue watcher loop
- PR validation (build + conflict + summary checks)
- Worker signaling (dev head updates)
- Self-managed mode (single-terminal fallback)

### Category 7: Integration with Existing Hive
- execute-phase.md workflow updates (plan branching per wave)
- execute-plan.md workflow updates (build gate + PR creation)
- complete-milestone.md workflow updates (dev-to-main merge)
- git-integration.md reference updates (new commit points, branching)
- hive-tools.js new commands (8-10 new subcommands)
- STATE.md tracking (current branch, merge queue status)

## Sources

### Primary (HIGH confidence -- project repositories with code)
- [ccswarm: Multi-agent orchestration with Git worktree isolation](https://github.com/nwiizo/ccswarm) -- Rust-based, worktree isolation, no build gates or PRs
- [multi-agent-shogun: Samurai-inspired multi-agent system](https://github.com/yohey-w/multi-agent-shogun) -- tmux orchestration, inotifywait signaling, no git workflow
- [Clash: Merge conflict detection across git worktrees](https://github.com/clash-sh/clash) -- git merge-tree based, read-only, hook integration for Claude Code
- [Gas Town: Multi-agent workspace manager](https://github.com/steveyegge/gastown) -- Refinery sequential merge, git-backed state, worktree isolation
- [multi-agent-worktrees: Git worktree setup for AI agents](https://github.com/dtedesco1/multi-agent-worktrees) -- Branch per agent, rebase requirement, merge-green-prs workflow
- [workmux: Git worktrees + tmux for parallel AI agents](https://github.com/raine/workmux) -- Worktree-tmux binding, simple merge command, no build validation
- [Agent-MCP: Multi-agent coordination via MCP](https://github.com/rinadelph/Agent-MCP) -- File-level locking, task-based conflict prevention
- [claude-flow: Agent orchestration platform](https://github.com/ruvnet/claude-flow) -- PR manager agent, GitHub Actions integration, release management

### Secondary (MEDIUM confidence -- official documentation)
- [GitHub Copilot coding agent docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) -- `copilot/` branches, draft PRs, human-only merge
- [Claude Code common workflows](https://code.claude.com/docs/en/common-workflows) -- Git workflow best practices
- [Claude Code agent teams docs](https://code.claude.com/docs/en/agent-teams) -- Swarm mode, worktree per agent

### Tertiary (MEDIUM confidence -- community analysis)
- [Gas Town vs Swarm-Tools comparison](https://gist.github.com/johnlindquist/4174127de90e1734d58fce64c6b52b62) -- Reservation-based locking vs worktree isolation
- [Git's Line-Based Merge is Broken for the AI Agent Era](https://thenote.app/post/en/gits-line-based-merge-is-broken-for-the-ai-agent-era-1xm5pmgiey) -- 48% false conflict rate, entity-level merge
- [Weave: Entity-level semantic merge driver](https://github.com/Ataraxy-Labs/weave) -- tree-sitter based, 31/31 vs git's 15/31 clean merges
- [AI Agent Workflow Orchestration Guidelines](https://gist.github.com/OmerFarukOruc/a02a5883e27b5b52ce740cadae0e4d60) -- Community best practices

---
*Feature research for: Professional Git Workflow for Hive v2.0*
*Researched: 2026-02-12*
