# Roadmap: Hive

## Milestones

- ✅ **v1.0 Hive Recall** — Phases 1-7 (shipped 2026-02-12)
- ✅ **v2.0 Hive Pro Git Flow** — Phases 8-11 (shipped 2026-02-12)
- 🚧 **v2.1 Git Flow Hardening** — Phases 12-15 (in progress)

## Phases

<details>
<summary>✅ v1.0 Hive Recall (Phases 1-7) — SHIPPED 2026-02-12</summary>

- [x] Phase 1: Core Infrastructure (3/3 plans) — completed 2026-02-12
- [x] Phase 2: Hook Observers (2/2 plans) — completed 2026-02-12
- [x] Phase 3: Workflow Integration (2/2 plans) — completed 2026-02-12
- [x] Phase 4: Feedback Loop (3/3 plans) — completed 2026-02-12
- [x] Phase 5: Installation Integration (1/1 plan) — completed 2026-02-12
- [x] Phase 6: Transcript Analysis (2/2 plans) — completed 2026-02-12
- [x] Phase 7: Close Integration Gaps (1/1 plan) — completed 2026-02-12

</details>

<details>
<summary>✅ v2.0 Hive Pro Git Flow (Phases 8-11) — SHIPPED 2026-02-12</summary>

- [x] Phase 8: Safety & Configuration (2/2 plans) — completed 2026-02-12
- [x] Phase 9: Branch Lifecycle & Build Gates (2/2 plans) — completed 2026-02-12
- [x] Phase 10: PR & Workflow Integration (3/3 plans) — completed 2026-02-12
- [x] Phase 11: Repo Manager (3/3 plans) — completed 2026-02-12

</details>

### 🚧 v2.1 Git Flow Hardening (In Progress)

**Milestone Goal:** Harden the v2.0 git workflow with resilience fixes, build pipeline flexibility, multi-worker safety, and DX improvements — closing 12 verified gaps found via code audit.

#### Phase 12: Resilience
**Goal**: Git operations recover gracefully from failures instead of leaving broken state
**Depends on**: Phase 11 (existing git flow infrastructure)
**Requirements**: RESIL-01, RESIL-02, RESIL-03
**Success Criteria** (what must be TRUE):
  1. When queue submission fails, the fallback path runs Gate 2 validation before self-merging to dev
  2. Between execution waves, dev branch is synced via pull so later waves build on merged work from earlier waves
  3. When a build times out, the entire process tree is killed (not just the parent), leaving no orphan processes
**Plans**: 2 plans

Plans:
- [x] 12-01-PLAN.md — Process group killing on build timeout (RESIL-03) — completed 2026-02-15
- [x] 12-02-PLAN.md — Dev sync between waves + Gate 2 queue fallback (RESIL-01, RESIL-02) — completed 2026-02-15

#### Phase 13: Build Pipeline
**Goal**: Build commands support real-world project complexity — multi-step pipelines, separate main-branch validation, and explicit build enforcement
**Depends on**: Phase 12 (resilience fixes to timeout killing affect build execution)
**Requirements**: BUILD-01, BUILD-02, BUILD-03
**Success Criteria** (what must be TRUE):
  1. build_command accepts an array of commands that execute sequentially, stopping on first failure (e.g., ["npm run lint", "npm test", "npm run build"])
  2. Gate 3 (pre-main merge) uses a separate pre_main_command when configured, falling back to build_command when not set
  3. When require_build is true and no build command is detected, the gate errors explicitly instead of silently skipping
**Plans**: 2 plans

Plans:
- [x] 13-01-PLAN.md — Array build pipeline + require_build enforcement (BUILD-01, BUILD-03) — completed 2026-02-15
- [x] 13-02-PLAN.md — Gate 3 pre_main_command with fallback to build_command (BUILD-02) — completed 2026-02-15

#### Phase 14: Multi-Worker Safety
**Goal**: Multiple workers can safely share the merge queue without conflicts, with per-plan control over merge behavior and configurable branch protection
**Depends on**: Phase 12 (resilience fixes to queue fallback)
**Requirements**: MULTI-01, MULTI-02, MULTI-03
**Success Criteria** (what must be TRUE):
  1. Queue entries contain lease_owner and lease_expires_at fields, preventing two workers from processing the same entry
  2. A plan can specify its merge strategy in PLAN.md frontmatter, overriding the global config.json merge_strategy
  3. Protected branches are read from config (not hardcoded), so projects using branches other than main/master are supported
**Plans**: 2 plans

Plans:
- [x] 14-01-PLAN.md — Queue lease fields + configurable protected branches (MULTI-01, MULTI-03) — completed 2026-02-15
- [x] 14-02-PLAN.md — Per-plan merge strategy via PLAN.md frontmatter override (MULTI-02) — completed 2026-02-15

#### Phase 15: Developer Experience
**Goal**: Milestone completion produces publishable artifacts and handles post-merge logistics automatically
**Depends on**: Phase 13 (build pipeline for CHANGELOG generation context), Phase 14 (merge strategy for push behavior)
**Requirements**: DX-01, DX-02, DX-03
**Success Criteria** (what must be TRUE):
  1. On milestone completion, a CHANGELOG.md is automatically generated from all SUMMARY.md files across the milestone's phases
  2. After dev-to-main merge, the system either returns a needs_push flag or auto-pushes to remote based on config setting
  3. Rebase merge strategy is documented in the config template with usage guidance, so users know when and how to use it
**Plans**: 2 plans

Plans:
- [x] 15-01-PLAN.md — CHANGELOG generation + auto-push after merge (DX-01, DX-02) — completed 2026-02-16
- [x] 15-02-PLAN.md — Merge strategy documentation in config template and references (DX-03) — completed 2026-02-16

## Progress

**Execution Order:**
Phases execute in numeric order: 12 -> 13 -> 14 -> 15

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Core Infrastructure | v1.0 | 3/3 | Complete | 2026-02-12 |
| 2. Hook Observers | v1.0 | 2/2 | Complete | 2026-02-12 |
| 3. Workflow Integration | v1.0 | 2/2 | Complete | 2026-02-12 |
| 4. Feedback Loop | v1.0 | 3/3 | Complete | 2026-02-12 |
| 5. Installation Integration | v1.0 | 1/1 | Complete | 2026-02-12 |
| 6. Transcript Analysis | v1.0 | 2/2 | Complete | 2026-02-12 |
| 7. Close Integration Gaps | v1.0 | 1/1 | Complete | 2026-02-12 |
| 8. Safety & Configuration | v2.0 | 2/2 | Complete | 2026-02-12 |
| 9. Branch Lifecycle & Build Gates | v2.0 | 2/2 | Complete | 2026-02-12 |
| 10. PR & Workflow Integration | v2.0 | 3/3 | Complete | 2026-02-12 |
| 11. Repo Manager | v2.0 | 3/3 | Complete | 2026-02-12 |
| 12. Resilience | v2.1 | 2/2 | Complete | 2026-02-15 |
| 13. Build Pipeline | v2.1 | 2/2 | Complete | 2026-02-15 |
| 14. Multi-Worker Safety | v2.1 | 2/2 | Complete | 2026-02-15 |
| 15. Developer Experience | v2.1 | 2/2 | Complete | 2026-02-16 |

---
*Roadmap created: 2026-02-11*
*Last updated: 2026-02-16 after Phase 15 execution complete*
