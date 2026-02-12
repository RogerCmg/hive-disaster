# Roadmap: Hive

## Milestones

- ✅ **v1.0 Hive Recall** — Phases 1-7 (shipped 2026-02-12)
- 🚧 **v2.0 Hive Pro Git Flow** — Phases 8-11 (in progress)

## Phases

<details>
<summary>v1.0 Hive Recall (Phases 1-7) — SHIPPED 2026-02-12</summary>

- [x] Phase 1: Core Infrastructure (3/3 plans) — completed 2026-02-12
- [x] Phase 2: Hook Observers (2/2 plans) — completed 2026-02-12
- [x] Phase 3: Workflow Integration (2/2 plans) — completed 2026-02-12
- [x] Phase 4: Feedback Loop (3/3 plans) — completed 2026-02-12
- [x] Phase 5: Installation Integration (1/1 plan) — completed 2026-02-12
- [x] Phase 6: Transcript Analysis (2/2 plans) — completed 2026-02-12
- [x] Phase 7: Close Integration Gaps (1/1 plan) — completed 2026-02-12

</details>

### v2.0 Hive Pro Git Flow (In Progress)

**Milestone Goal:** Give Hive a professional git workflow — dev branch, plan-level branching, build gates, PR-based integration, and a repo manager — so code flows safely from agents to main.

- [ ] **Phase 8: Safety & Configuration** — Atomic writes, file locking, config schema, auto-detection, git tooling primitives
- [ ] **Phase 9: Branch Lifecycle & Build Gates** — Dev branch, plan-level branching, branch cleanup, pre-PR build validation
- [ ] **Phase 10: PR & Workflow Integration** — PR creation, self-merge, workflow modifications, git status display
- [ ] **Phase 11: Repo Manager** — Merge queue, wave-aware ordering, conflict detection, integration build gates

## Phase Details

### Phase 8: Safety & Configuration
**Goal**: All file operations are crash-safe and the git workflow is fully configurable with auto-detection
**Depends on**: Phase 7 (v1.0 complete)
**Requirements**: SAFE-01, SAFE-02, SETUP-01, SETUP-02, SETUP-03, SETUP-04, INTG-04
**Success Criteria** (what must be TRUE):
  1. Concurrent writes to STATE.md from two processes never corrupt the file — mkdir-based locks serialize access
  2. A process killed mid-write to merge-queue.json leaves the previous valid version intact — atomic temp+rename pattern
  3. Running `hive-tools.js git detect-build-cmd` in a Node project returns `npm test`, in a Rust project returns `cargo test`, and in a project with no build file returns a clear "none detected" result
  4. Setting `git.flow: "none"` in config.json causes all git workflow features to be skipped — existing behavior preserved exactly
  5. Running `hive-tools.js git create-dev-branch`, `create-plan-branch`, `run-build-gate`, `create-pr`, and the other git subcommands all return structured JSON results with success/error status
**Plans**: TBD

### Phase 9: Branch Lifecycle & Build Gates
**Goal**: Plans execute on isolated branches that are validated before PR creation and cleaned up after merge
**Depends on**: Phase 8
**Requirements**: BRANCH-01, BRANCH-02, BRANCH-03, BUILD-01, BUILD-04, BUILD-05
**Success Criteria** (what must be TRUE):
  1. Running `/hive:new-project` or starting a new milestone with git flow enabled creates a dev branch and checks it out
  2. When a plan begins execution, a branch named `hive/phase-{N}-{plan}-{slug}` is created from dev and checked out
  3. After a plan completes, the build command runs automatically — if it fails, PR creation is blocked and the user is informed
  4. Build gates are on by default and each gate (pre-PR, pre-merge, pre-main) can be individually disabled in config
  5. A build that hangs beyond the configured timeout (default 300s) is killed and reported as a failure
**Plans**: TBD

### Phase 10: PR & Workflow Integration
**Goal**: Completed plans flow through PRs to dev branch with full workflow integration across execute-phase, execute-plan, and complete-milestone
**Depends on**: Phase 9
**Requirements**: PR-01, PR-02, PR-03, PR-04, INTG-01, INTG-02, INTG-03, INTG-05
**Success Criteria** (what must be TRUE):
  1. After a plan passes Gate 1, a PR is created via `gh pr create` from the plan branch to dev with a body populated from the plan's SUMMARY.md
  2. In single-terminal mode, the PR is immediately merged with a merge commit (--no-ff) preserving per-task commit history
  3. Execute-phase creates plan branches per wave and deletes them after successful merge — no stale branches accumulate
  4. Running `/hive:complete-milestone` triggers a dev-to-main merge flow (Gate 3 check included)
  5. Progress display shows current git branch, ahead/behind status, and open PR count
**Plans**: TBD

### Phase 11: Repo Manager
**Goal**: A dedicated agent manages merge ordering, conflict detection, and integration testing so parallel plan merges never break dev
**Depends on**: Phase 10
**Requirements**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05, BUILD-02, BUILD-03
**Success Criteria** (what must be TRUE):
  1. `/hive:manage-repo` launches the repo manager agent which reads the merge queue and processes pending merges in wave-aware order
  2. Before merging a plan branch, `git merge-tree` detects conflicts without modifying the worktree — conflicting merges are flagged, not attempted
  3. Gate 2 (pre-merge) runs the build on the merge result via `git merge --no-commit` — if the build fails, the merge is aborted and the plan branch is not merged
  4. Gate 3 (pre-main) runs a full build before dev-to-main merge on milestone completion — broken dev never reaches main
  5. File-based signals in `.hive-workers/` communicate merge results and dev head updates between workers and manager
**Plans**: TBD

## Progress

**Execution Order:** Phase 8 -> 9 -> 10 -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Core Infrastructure | v1.0 | 3/3 | Complete | 2026-02-12 |
| 2. Hook Observers | v1.0 | 2/2 | Complete | 2026-02-12 |
| 3. Workflow Integration | v1.0 | 2/2 | Complete | 2026-02-12 |
| 4. Feedback Loop | v1.0 | 3/3 | Complete | 2026-02-12 |
| 5. Installation Integration | v1.0 | 1/1 | Complete | 2026-02-12 |
| 6. Transcript Analysis | v1.0 | 2/2 | Complete | 2026-02-12 |
| 7. Close Integration Gaps | v1.0 | 1/1 | Complete | 2026-02-12 |
| 8. Safety & Configuration | v2.0 | 0/TBD | Not started | - |
| 9. Branch Lifecycle & Build Gates | v2.0 | 0/TBD | Not started | - |
| 10. PR & Workflow Integration | v2.0 | 0/TBD | Not started | - |
| 11. Repo Manager | v2.0 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-11*
*Last updated: 2026-02-12 after v2.0 roadmap creation*
