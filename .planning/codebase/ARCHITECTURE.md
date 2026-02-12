# Architecture

**Analysis Date:** 2026-02-11

## Pattern Overview

**Overall:** File-Based Message-Passing Architecture with Agent Orchestration

**Key Characteristics:**
- Zero runtime dependencies - pure markdown meta-prompting system
- Agents communicate exclusively via files on disk (`.planning/`)
- Fresh 200k context per agent spawn (no resume, explicit state transfer)
- 4-layer command dispatch pattern (Commands → Workflows → Agents → Tools)
- Wave-based parallel execution with dependency graphs

## Layers

**Commands (`commands/hive/*.md`):**
- Purpose: User entry points with argument parsing and tool allowlists
- Location: `/commands/hive/`
- Contains: 27 thin markdown dispatchers (30-80 lines each)
- Depends on: Workflows (via `@~/.claude/hive/workflows/`)
- Used by: Claude Code runtime via slash commands

**Workflows (`hive/workflows/*.md`):**
- Purpose: Orchestration logic - multi-step processes with gates and checkpoints
- Location: `/hive/workflows/`
- Contains: 29 orchestration files (150-500+ lines) with process steps
- Depends on: Agents (via Task tool spawns), References, Templates, hive-tools.js
- Used by: Commands
- Pattern: Init → Validate → Spawn agents → Collect results → Commit → Update STATE.md

**Agents (`agents/hive-*.md`):**
- Purpose: Specialized workers spawned as subagents
- Location: `/agents/`
- Contains: 11 agent definitions (executor, planner, verifier, researcher, etc.)
- Depends on: Templates for output shape, References for behavioral rules
- Used by: Workflows (via Task tool)
- Pattern: Load context → Execute specialized task → Return structured result → Die

**Templates (`hive/templates/*.md`):**
- Purpose: Artifact shape definitions and pre-filled structures
- Location: `/hive/templates/`
- Contains: 34 template files (PROJECT.md, PLAN.md, SUMMARY.md, STATE.md, etc.)
- Depends on: Nothing
- Used by: Workflows and Agents to ensure consistent output format

**References (`hive/references/*.md`):**
- Purpose: Behavioral rules and standards
- Location: `/hive/references/`
- Contains: 13 reference documents (checkpoints, verification, git integration, etc.)
- Depends on: Nothing
- Used by: All layers for consistent behavior patterns

**CLI Utilities (`hive/bin/hive-tools.js`):**
- Purpose: Centralized operations - state management, git commits, model resolution
- Location: `/hive/bin/hive-tools.js`
- Contains: 4597 lines, 80+ atomic commands + compound init commands
- Depends on: Node.js stdlib only
- Used by: All workflows and agents
- Pattern: Single JSON output, no side effects unless explicitly requested

## Data Flow

**Command Execution Flow:**

1. User invokes `/hive:command-name` in Claude Code
2. Command file (`commands/hive/*.md`) loads
3. Command references workflow via `@~/.claude/hive/workflows/command-name.md`
4. Workflow executes initialization via `hive-tools.js init <workflow-name>`
5. Workflow spawns agents via Task tool with context
6. Agents read `.planning/` files, execute work, write results to disk
7. Workflow collects results from disk, verifies, commits
8. STATE.md updated with new position/context
9. Control returns to user

**Agent Communication Pattern (File-Based):**

1. Orchestrator writes context/config to `.planning/phases/{N}/PLAN.md`
2. Agent spawned with path to file (not file contents)
3. Agent reads file itself in fresh 200k context
4. Agent executes work, writes output to `.planning/phases/{N}/SUMMARY.md`
5. Agent returns confirmation string and dies
6. Orchestrator reads SUMMARY.md to get results
7. No direct agent-to-agent communication - always via files

**State Management:**

- `.planning/STATE.md` - Current position, decisions, blockers, metrics
- `.planning/PROJECT.md` - Immutable project vision
- `.planning/ROADMAP.md` - Phase structure and goals
- `.planning/REQUIREMENTS.md` - Validated and active requirements
- `.planning/config.json` - Runtime preferences (parallelization, gates, teams)

## Key Abstractions

**Phase:**
- Purpose: Atomic unit of work with single goal
- Examples: `01-database-schema`, `02-api-endpoints`, `03.1-auth-bugfix`
- Pattern: Directory in `.planning/phases/` containing PLAN.md, SUMMARY.md, CONTEXT.md
- Lifecycle: Unplanned → Planned → In Progress → Complete

**Plan:**
- Purpose: Executable prompt for Claude to implement tasks
- Examples: `.planning/phases/01-database-schema/01-01-PLAN.md`
- Pattern: Markdown file with frontmatter (wave, dependencies) + task list + verification criteria
- Structure: Frontmatter → Objective → Context (@-references) → Tasks → Verification → Success Criteria

**Wave:**
- Purpose: Parallel execution group for plans with no dependencies
- Examples: Wave 1 (01-01, 01-02), Wave 2 (01-03 depends on Wave 1)
- Pattern: Plans execute in parallel within wave, waves execute sequentially
- Optimization: Max 3 concurrent agents per wave (configurable)

**Checkpoint:**
- Purpose: Human interaction points during autonomous execution
- Examples: `checkpoint:human-verify` (UI check), `checkpoint:decision` (tech choice)
- Pattern: Task type in PLAN.md that pauses execution, prompts user, resumes
- Types: human-verify (90%), decision (9%), human-action (1%)

**Agent Team:**
- Purpose: Persistent multi-agent collaboration vs. one-shot Task spawns
- Examples: execution_team, planning_team, research_team, qa_team
- Pattern: TeamCreate → Add members → SendMessage for coordination → TeamShutdown
- Modes: Team mode (persistent, message-based) vs. Standalone mode (Task spawn, return-based)

## Entry Points

**Installer (`bin/install.js`):**
- Location: `/bin/install.js`
- Triggers: `npx hive-cc@latest` or `npm install -g hive-cc`
- Responsibilities: Copy files to `~/.claude/`, `~/.opencode/`, or `~/.gemini/` depending on flags
- Multi-runtime: Supports --claude, --opencode, --gemini, --all flags
- Modes: --global (runtime config dirs) or --local (project .claude/)

**Project Initialization (`/hive:new-project`):**
- Location: `commands/hive/new-project.md` → `hive/workflows/new-project.md`
- Triggers: User starts new project
- Responsibilities: Deep questioning → PROJECT.md → optional research → REQUIREMENTS.md → ROADMAP.md → STATE.md
- Outputs: Complete `.planning/` structure ready for execution

**Phase Planning (`/hive:plan-phase`):**
- Location: `commands/hive/plan-phase.md` → `hive/workflows/plan-phase.md`
- Triggers: User ready to plan next phase
- Responsibilities: Research (optional) → Spawn planner → Verify plan quality → Commit
- Agents: hive-phase-researcher, hive-planner, hive-plan-checker

**Phase Execution (`/hive:execute-phase`):**
- Location: `commands/hive/execute-phase.md` → `hive/workflows/execute-phase.md`
- Triggers: User ready to build planned phase
- Responsibilities: Group plans into waves → Spawn executors → Handle checkpoints → Collect summaries
- Agents: hive-executor (multiple in parallel)

**Quick Command (`/hive:quick`):**
- Location: `commands/hive/quick.md` → `hive/workflows/quick.md`
- Triggers: One-off tasks without full project setup
- Responsibilities: Inline task → Plan → Execute → Summarize in single flow

## Error Handling

**Strategy:** Goal-backward verification with deviation auto-fix

**Patterns:**
- **Deviation Rules 1-3** (Bug/Missing/Blocking): Auto-fix by executor, note in SUMMARY.md
- **Deviation Rule 4** (Architectural): STOP, return checkpoint for user decision
- **Plan failures**: Max 3 revisions via hive-plan-checker, then escalate to user
- **Verification gaps**: Auto-generate gap-closure plans via `/hive:verify-work --fix`

**Verification Levels:**
1. **Exists**: Artifact present on disk (file created, function defined)
2. **Substantive**: Artifact non-trivial (not placeholder, has real logic)
3. **Wired**: Artifact integrated (imported, called, tested)

**Checkpoint Recovery:**
- Executor serializes state to CONTINUE-HERE.md before checkpoint
- User responds to checkpoint question
- Executor resumes from serialized state with user's response

## Cross-Cutting Concerns

**Logging:** Direct output to Claude Code UI, structured summaries to SUMMARY.md

**Validation:**
- hive-tools.js verify-* commands (plan-structure, phase-completeness, references, commits, artifacts)
- Frontmatter schema validation for PLAN.md, SUMMARY.md, VERIFICATION.md

**Authentication:** N/A (no external services required)

**State Persistence:**
- STATE.md - Updated after every major action (plan, execute, verify)
- Frontmatter - Embedded metadata in all markdown artifacts
- Git commits - Atomic commits with `hive-tools.js commit` after each planning/execution step

**Parallelization:**
- Config-controlled: `.planning/config.json` → `parallelization.enabled`
- Wave-based: Plans in same wave execute concurrently (max 3)
- Task-level: Disabled by default (tasks execute sequentially within plan)

**Model Selection:**
- Profile-based: quality/balanced/budget modes
- Agent-specific: hive-planner uses opus in quality mode, sonnet in balanced
- Resolution: `hive-tools.js resolve-model <agent-type>` reads config + profile table

---

*Architecture analysis: 2026-02-11*
