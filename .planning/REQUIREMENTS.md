# Requirements: Hive

**Defined:** 2026-02-15
**Core Value:** Safe path from plan to merged code — quality scales with parallelism

## v2.1 Requirements

Requirements for v2.1 Git Flow Hardening. Each maps to roadmap phases.

### Resilience

- [ ] **RESIL-01**: Queue fallback runs Gate 2 before self-merge when queue-submit fails
- [ ] **RESIL-02**: Execute-phase syncs dev branch between waves via git pull
- [ ] **RESIL-03**: Build timeout kills process group (detached spawn + -pid signal), not just parent

### Build Pipeline

- [ ] **BUILD-01**: build_command accepts array of commands, executes sequentially, stops on first failure
- [ ] **BUILD-02**: Gate 3 uses separate pre_main_command when configured, falls back to build_command
- [ ] **BUILD-03**: build_gates.require_build flag errors when no build detected (vs silent skip)

### Multi-Worker

- [ ] **MULTI-01**: Queue entries include lease_owner and lease_expires_at fields
- [ ] **MULTI-02**: Per-plan merge strategy via PLAN.md frontmatter overrides global config
- [ ] **MULTI-03**: Protected branches configurable via config (not hardcoded main/master)

### Developer Experience

- [ ] **DX-01**: Automatic CHANGELOG.md generated from SUMMARY.md files on milestone complete
- [ ] **DX-02**: merge-dev-to-main returns needs_push flag or auto-pushes based on config
- [ ] **DX-03**: Rebase merge strategy documented in config template and references

## Future Requirements

Deferred beyond v2.1. Tracked but not in current roadmap.

### Multi-Terminal Orchestration

- **ORCH-01**: Git worktrees for parallel terminal execution
- **ORCH-02**: Worker registry and /hive:start-worker command
- **ORCH-03**: Continuous conflict monitoring (Clash-style)
- **ORCH-04**: Dynamic worker assignment

### Cross-Project Intelligence

- **CROSS-01**: Cross-project global insights aggregation
- **CROSS-02**: Pattern sharing between projects
- **CROSS-03**: Global recall context

### Automation

- **AUTO-01**: Auto-suggestion when deviation thresholds exceeded
- **AUTO-02**: Proactive pattern-based recommendations

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| SQLite/database storage | Learned from removed intel system (v1.9.2), must stay file-based |
| Runtime dependencies | Zero-dep philosophy is non-negotiable |
| Real-time dashboards | CLI-only, markdown digest is sufficient |
| Entity-level merge (tree-sitter) | Adds native binary dependency, breaks zero-dep |
| Task-level branches | Branch explosion; plan-level is correct granularity |
| AI-powered conflict resolution | Prevention + detection is safer than auto-resolution |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RESIL-01 | Phase 12 | Pending |
| RESIL-02 | Phase 12 | Pending |
| RESIL-03 | Phase 12 | Pending |
| BUILD-01 | Phase 13 | Pending |
| BUILD-02 | Phase 13 | Pending |
| BUILD-03 | Phase 13 | Pending |
| MULTI-01 | Phase 14 | Pending |
| MULTI-02 | Phase 14 | Pending |
| MULTI-03 | Phase 14 | Pending |
| DX-01 | Phase 15 | Pending |
| DX-02 | Phase 15 | Pending |
| DX-03 | Phase 15 | Pending |

**Coverage:**
- v2.1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-02-15*
*Last updated: 2026-02-15 after roadmap creation (traceability populated)*
