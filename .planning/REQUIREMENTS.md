# Requirements: Hive Pro Git Flow

**Defined:** 2026-02-12
**Core Value:** Safe path from plan to merged code — quality scales with parallelism

## v2.0 Requirements

Requirements for v2.0 milestone. Each maps to roadmap phases.

### Concurrency & Safety

- [ ] **SAFE-01**: Shared files (STATE.md, config.json, merge-queue.json) protected by mkdir-based locks during writes
- [ ] **SAFE-02**: All file writes use atomic pattern (write to temp + rename in same directory)

### Configuration & Detection

- [ ] **SETUP-01**: config.json extended with `git` section (flow, build_gates, build_command, merge_strategy, dev_branch)
- [ ] **SETUP-02**: hive-tools.js auto-detects git version (2.38+ for merge-tree), gh CLI availability, and build command
- [ ] **SETUP-03**: User can override build command via `git.build_command` config
- [ ] **SETUP-04**: All git workflow features bypass when `git.flow: "none"` (backward compatible)

### Branch Lifecycle

- [ ] **BRANCH-01**: Dev branch auto-created on project/milestone init when git flow enabled
- [ ] **BRANCH-02**: Plan-level branches created from dev with naming `hive/phase-{N}-{plan}-{slug}`
- [ ] **BRANCH-03**: Plan branches cleaned up (deleted) after successful merge to dev

### Build Validation

- [ ] **BUILD-01**: Gate 1 (pre-PR) — build runs after plan completion, blocks PR creation on failure
- [ ] **BUILD-02**: Gate 2 (pre-merge) — build runs on merge result (git merge --no-commit), blocks merge to dev on failure
- [ ] **BUILD-03**: Gate 3 (pre-main) — full build before dev-to-main merge on milestone completion
- [ ] **BUILD-04**: Build gates always on by default, individually configurable via `git.build_gates`
- [ ] **BUILD-05**: Build timeout configurable (default 300s), kills hung processes

### PR & Merge

- [ ] **PR-01**: PR created via `gh pr create` from plan branch to dev after Gate 1 passes
- [ ] **PR-02**: PR body auto-populated from plan SUMMARY.md with task list, commits, phase context
- [ ] **PR-03**: Single-terminal self-merge — PR created and immediately merged with merge commit (--no-ff)
- [ ] **PR-04**: Merge strategy configurable (merge commit default, squash optional)

### Repo Manager

- [ ] **REPO-01**: Merge queue stored in `.hive-workers/merge-queue.json` with pending/merged/dev_head structure
- [ ] **REPO-02**: `/hive:manage-repo` command with hive-repo-manager agent definition
- [ ] **REPO-03**: Queue processed in wave-aware order (Wave 1 merges before Wave 2)
- [ ] **REPO-04**: Conflict detection via `git merge-tree` before merge attempt
- [ ] **REPO-05**: File-based signaling between workers and manager (merge results, dev head updates)

### Workflow Integration

- [ ] **INTG-01**: execute-phase.md creates plan branches per wave, deletes after merge
- [ ] **INTG-02**: execute-plan.md adds build gate check and PR creation after plan completion
- [ ] **INTG-03**: complete-milestone.md adds dev-to-main merge flow with Gate 3
- [ ] **INTG-04**: hive-tools.js adds ~10 new git subcommands (create-dev-branch, create-plan-branch, detect-build-cmd, run-build-gate, create-pr, self-merge-pr, merge-dev-to-main, check-conflicts, delete-plan-branch, current-branch)
- [ ] **INTG-05**: Progress display shows git status (current branch, ahead/behind, open PRs)

## Future Requirements

Deferred to v2.1+ (multi-terminal milestone). Tracked but not in current roadmap.

### Multi-Terminal

- **MT-01**: Git worktree creation/cleanup per worker terminal
- **MT-02**: Worker registry at `.hive-workers/registry.json`
- **MT-03**: `/hive:start-worker` command for spawning worker terminals
- **MT-04**: Worktree-aware execution in execute-plan workflow
- **MT-05**: `/hive:cleanup-workers` for orphaned worktree pruning
- **MT-06**: Continuous conflict monitoring between active worktrees (Clash-style)
- **MT-07**: Dynamic worker assignment and load balancing

### Cross-Project Insights

- **CROSS-01**: Global insights aggregation across projects
- **CROSS-02**: Cross-project pattern detection
- **CROSS-03**: Shared insight library

### Auto-Suggestions

- **AUTO-01**: Auto-suggest when deviation threshold exceeded
- **AUTO-02**: Proactive recall injection based on pattern frequency

## Out of Scope

| Feature | Reason |
|---------|--------|
| Git worktrees / multi-terminal | Deferred to v2.1+ — single-terminal must prove stable first |
| AI-powered conflict resolution | Unreliable — prevention + detection is safer than auto-resolution |
| Entity-level merge (Weave/tree-sitter) | Adds native binary dependency, breaks zero-dep philosophy |
| inotifywait signaling | Platform-specific (Linux only), polling is simpler and sufficient |
| Task-level branches | Branch explosion (50+ branches), plan-level is correct granularity |
| GitHub Actions / CI integration | Local build gates are faster; GitHub CI runs on PRs automatically |
| Multi-repo orchestration | Exponential complexity; single-repo scope for v2.0 |
| Real-time dashboards | CLI-only philosophy; markdown + progress display is sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SAFE-01 | Phase 8 | Pending |
| SAFE-02 | Phase 8 | Pending |
| SETUP-01 | Phase 8 | Pending |
| SETUP-02 | Phase 8 | Pending |
| SETUP-03 | Phase 8 | Pending |
| SETUP-04 | Phase 8 | Pending |
| BRANCH-01 | Phase 9 | Pending |
| BRANCH-02 | Phase 9 | Pending |
| BRANCH-03 | Phase 9 | Pending |
| BUILD-01 | Phase 9 | Pending |
| BUILD-02 | Phase 11 | Pending |
| BUILD-03 | Phase 11 | Pending |
| BUILD-04 | Phase 9 | Pending |
| BUILD-05 | Phase 9 | Pending |
| PR-01 | Phase 10 | Pending |
| PR-02 | Phase 10 | Pending |
| PR-03 | Phase 10 | Pending |
| PR-04 | Phase 10 | Pending |
| REPO-01 | Phase 11 | Pending |
| REPO-02 | Phase 11 | Pending |
| REPO-03 | Phase 11 | Pending |
| REPO-04 | Phase 11 | Pending |
| REPO-05 | Phase 11 | Pending |
| INTG-01 | Phase 10 | Pending |
| INTG-02 | Phase 10 | Pending |
| INTG-03 | Phase 10 | Pending |
| INTG-04 | Phase 8 | Pending |
| INTG-05 | Phase 10 | Pending |

**Coverage:**
- v2.0 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-02-12*
*Last updated: 2026-02-12 after roadmap creation (traceability complete)*
