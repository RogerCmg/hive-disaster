# HIVE-DISASTER: Complete Codebase Analysis & Agent Teams Evolution Plan

> Generated: 2026-02-11
> Analyzed by: 7 parallel agents (4 codebase + 3 Agent Teams)
> Purpose: Reference document for evolving Hive into Hive with native Agent Teams

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Architecture Overview](#2-architecture-overview)
3. [Agent Inventory (11 Agents)](#3-agent-inventory)
4. [Command Catalog (29 Commands)](#4-command-catalog)
5. [Workflow Orchestration (30 Workflows)](#5-workflow-orchestration)
6. [Template System (34 Templates)](#6-template-system)
7. [Reference System (13 References)](#7-reference-system)
8. [State Management & .planning/ Structure](#8-state-management)
9. [Build & Distribution System](#9-build--distribution-system)
10. [Agent Teams Integration: The 4 Transformations](#10-agent-teams-the-4-transformations)
11. [Agent Teams: Execution Workflows](#11-agent-teams-execution-workflows)
12. [Agent Teams: Planning & Research Workflows](#12-agent-teams-planning--research-workflows)
13. [Agent Teams: Verification & Debugging Workflows](#13-agent-teams-verification--debugging-workflows)
14. [Priority Implementation Roadmap](#14-priority-implementation-roadmap)
15. [Config Changes Required](#15-config-changes-required)

---

## 1. Project Identity

- **Package**: `hive-cc` v1.18.0 (npm)
- **Author**: TACHES (glittercowboy)
- **Repo**: github.com/glittercowboy/hive
- **License**: MIT
- **Purpose**: Meta-prompting, context engineering, spec-driven dev system for Claude Code/OpenCode/Gemini CLI
- **Core problem**: Context rot - quality degradation as AI context window fills
- **Solution**: Fresh 200k context per agent, file-based state machine, goal-backward verification
- **Stats**: 141 files, zero runtime dependencies, markdown-only system

---

## 2. Architecture Overview

### Layered Architecture

```
USER
 |
 v
SLASH COMMANDS (commands/hive/*.md)         <- 29 thin dispatchers, entry points
 |
 v
WORKFLOWS (hive/workflows/*.md)   <- 30 orchestration files, real logic
 |
 v
AGENTS (agents/hive-*.md)                   <- 11 specialized workers via Task tool
 |
 v
FILES ON DISK (.planning/*)               <- Persistent state/communication
```

### Key Architectural Patterns

1. **Meta-prompting pure**: PLAN.md IS the execution prompt, not a doc that becomes one
2. **File-based state machine**: All state in `.planning/`, agents can die and resume from disk
3. **Goal-backward methodology**: Verify from objective backwards (truths -> artifacts -> wiring)
4. **Fresh context per agent**: Never resume, always spawn new with explicit state transfer
5. **Wave-based parallelization**: Max 3 concurrent agents, waves execute sequentially
6. **3-level verification**: Exists -> Substantive -> Wired (imported AND used)
7. **Cross-runtime**: Source of truth in Claude Code format, auto-conversion for OpenCode/Gemini

### Communication Model

- Agents communicate via FILES ON DISK (.planning/), never directly
- Orchestrator passes paths only, agents read files themselves
- Fresh 200k context per agent spawn (no resume, explicit state transfer)
- Init-once pattern via `hive-tools.js init` (returns all context as JSON)

---

## 3. Agent Inventory

### 11 Agents with Role-Based Tool Restrictions

| Agent | File | Purpose | Tools | Color |
|-------|------|---------|-------|-------|
| **hive-planner** | agents/hive-planner.md (36K) | Creates executable PLAN.md files | Read,Write,Bash,Glob,Grep,WebFetch,mcp__context7__* | green |
| **hive-executor** | agents/hive-executor.md (14K) | Executes plans atomically | Read,Write,Edit,Bash,Grep,Glob | yellow |
| **hive-debugger** | agents/hive-debugger.md (36K) | Scientific method debugging | Read,Write,Edit,Bash,Grep,Glob,WebSearch | orange |
| **hive-verifier** | agents/hive-verifier.md (16K) | Post-execution goal verification | Read,Bash,Grep,Glob (read-only!) | green |
| **hive-plan-checker** | agents/hive-plan-checker.md (19K) | Pre-execution plan QA gate | Read,Bash,Glob,Grep (read-only!) | green |
| **hive-project-researcher** | agents/hive-project-researcher.md (16K) | Domain ecosystem research | Read,Write,Bash,Grep,Glob,WebSearch,WebFetch,mcp__context7__* | cyan |
| **hive-phase-researcher** | agents/hive-phase-researcher.md (14K) | Phase-specific research | Read,Write,Bash,Grep,Glob,WebSearch,WebFetch,mcp__context7__* | cyan |
| **hive-research-synthesizer** | agents/hive-research-synthesizer.md (7K) | Combines 4 researcher outputs | Read,Write,Bash | purple |
| **hive-codebase-mapper** | agents/hive-codebase-mapper.md (16K) | Analyzes existing codebases | Read,Bash,Grep,Glob,Write | cyan |
| **hive-roadmapper** | agents/hive-roadmapper.md (16K) | Creates ROADMAP.md + STATE.md | Read,Write,Bash,Glob,Grep | purple |
| **hive-integration-checker** | agents/hive-integration-checker.md (12K) | Cross-phase E2E verification | Read,Bash,Grep,Glob | blue |

### Tool Restriction Pattern

- **Research agents**: Get WebSearch, WebFetch, mcp__context7__* (external knowledge)
- **Execution agents**: Get Edit (code modification) but NOT WebSearch
- **Verification agents**: Read-only tools only (Read, Bash, Grep, Glob) - deliberately limited
- **Synthesis agents**: Read + Write but NOT Grep/Glob (work with known files)

### Agent Spawn Map

| Workflow | Agent | Count | Parallel? |
|----------|-------|-------|-----------|
| new-project | hive-project-researcher | 4 | Yes |
| new-project | hive-research-synthesizer | 1 | No (after researchers) |
| new-project | hive-roadmapper | 1 | No |
| map-codebase | hive-codebase-mapper | 4 | Yes |
| plan-phase | hive-phase-researcher | 1 | No |
| plan-phase | hive-planner | 1-3 | No (revision loop) |
| plan-phase | hive-plan-checker | 1-3 | No (revision loop) |
| execute-phase | hive-executor | N (per plan) | Yes (within wave) |
| execute-phase | hive-verifier | 1 | No |
| verify-work | debug agents | N (per gap) | Yes |
| verify-work | hive-planner | 1-3 | No (gap closure) |
| verify-work | hive-plan-checker | 1-3 | No |
| audit-milestone | hive-integration-checker | 1 | No |
| quick | hive-planner + hive-executor | 1+1 | No |

---

## 4. Command Catalog

### 29 Commands by Category

#### A. Project Lifecycle (4)
| Command | Workflow | Key Feature |
|---------|----------|-------------|
| `/hive:new-project` | workflows/new-project.md | 9-step flow: questioning -> research (4 parallel) -> requirements -> roadmap |
| `/hive:new-milestone` | workflows/new-milestone.md | Brownfield equivalent, continues phase numbering |
| `/hive:complete-milestone` | workflows/complete-milestone.md | Archive, git tag, cleanup ROADMAP/REQUIREMENTS |
| `/hive:audit-milestone` | workflows/audit-milestone.md | Verify definition of done, spawns integration checker |

#### B. Phase Management (8)
| Command | Workflow | Key Feature |
|---------|----------|-------------|
| `/hive:plan-phase` | workflows/plan-phase.md | Research -> plan -> check cycle, max 3 revisions |
| `/hive:execute-phase` | workflows/execute-phase.md | Wave-based parallel execution, spot-checking |
| `/hive:discuss-phase` | workflows/discuss-phase.md | Gray area detection, creates CONTEXT.md |
| `/hive:research-phase` | **Inline** | Standalone research, modes: ecosystem/feasibility/implementation |
| `/hive:add-phase` | workflows/add-phase.md | Add integer phase to end |
| `/hive:insert-phase` | workflows/insert-phase.md | Decimal phase insertion (e.g., 72.1) |
| `/hive:remove-phase` | workflows/remove-phase.md | Remove unstarted phase, renumber |
| `/hive:list-phase-assumptions` | workflows/list-phase-assumptions.md | Surface assumptions before planning |

#### C. Verification (2)
| Command | Workflow | Key Feature |
|---------|----------|-------------|
| `/hive:verify-work` | workflows/verify-work.md | Conversational UAT, auto-diagnoses failures |
| `/hive:plan-milestone-gaps` | workflows/plan-milestone-gaps.md | Create phases from audit gaps |

#### D. Session Management (3)
| Command | Workflow | Key Feature |
|---------|----------|-------------|
| `/hive:resume-work` | workflows/resume-project.md | Context restoration, .continue-here detection |
| `/hive:pause-work` | workflows/pause-work.md | Creates .continue-here.md handoff |
| `/hive:progress` | workflows/progress.md | Smart routing with 6 routes (A-F) |

#### E. Debug (1)
| Command | Workflow | Key Feature |
|---------|----------|-------------|
| `/hive:debug` | **Inline** | Scientific method, persistent sessions in .planning/debug/ |

#### F. Configuration (3)
| Command | Workflow | Key Feature |
|---------|----------|-------------|
| `/hive:settings` | workflows/settings.md | 5-question interactive config |
| `/hive:set-profile` | workflows/set-profile.md | Quick profile switch (quality/balanced/budget) |
| `/hive:quick` | workflows/quick.md | Ad-hoc tasks with Hive guarantees |

#### G. Utility (5)
| Command | Workflow | Key Feature |
|---------|----------|-------------|
| `/hive:help` | workflows/help.md | Command reference |
| `/hive:update` | workflows/update.md | npm update with changelog |
| `/hive:reapply-patches` | **Inline** | Merge local modifications after update |
| `/hive:map-codebase` | workflows/map-codebase.md | 4 parallel mappers, 7 documents |
| `/hive:add-todo` / `/hive:check-todos` | workflows/add-todo.md, check-todos.md | Todo management |

### Command -> Workflow Routing

**Orphan workflows** (no direct command):
- `workflows/execute-plan.md` - loaded by executor subagents
- `workflows/transition.md` - internal routing from resume-project
- `workflows/discovery-phase.md` - loaded during plan-phase
- `workflows/diagnose-issues.md` - loaded by verify-work
- `workflows/verify-phase.md` - loaded by execute-phase

**Inline commands** (no separate workflow):
- `research-phase`, `debug`, `reapply-patches` - logic embedded in command file

---

## 5. Workflow Orchestration

### Core Execution Flow

```
new-project
  |
  v
[discuss-phase 1] -> plan-phase 1 -> execute-phase 1 -> [transition] -> plan-phase 2 -> ...
                       |                  |                  |
                   (optional)         (per plan)        (updates PROJECT.md)
                       |                  |
                  research-phase     verify-phase
```

### Phase Lifecycle (detail)

1. `/hive:discuss-phase N` - Gather decisions -> CONTEXT.md (Decisions/Discretion/Deferred)
2. `/hive:plan-phase N` - Research + Plan + Verify -> RESEARCH.md, *-PLAN.md (max 3 revisions)
3. `/hive:execute-phase N` - Waves + Verify Goal -> SUMMARY.md, VERIFICATION.md
4. Implicit transition -> Updates STATE.md, ROADMAP.md, PROJECT.md

### Milestone Lifecycle

```
new-project -> [phase cycle N times] -> audit-milestone -> complete-milestone -> new-milestone -> ...
```

### Error Recovery & Gap Closure

```
execute-phase -> verify-phase
                    |
                    +-> passed -> transition
                    +-> gaps_found -> plan-phase --gaps -> execute-phase --gaps-only -> verify-phase
                    +-> human_needed -> verify-work (UAT) -> diagnose-issues -> plan-phase --gaps
```

### Execution Model

**Wave-Based Parallelization:**
- Plans have `wave` frontmatter
- Waves execute sequentially (wave 1 before wave 2)
- Within a wave: plans execute in parallel (up to max_concurrent_agents)
- Orchestrator uses ~10-15% context, each subagent gets fresh 200k

**Checkpoint Types (from checkpoints.md):**
- `checkpoint:human-verify` (90%) - User confirms visual/functional
- `checkpoint:decision` (9%) - User makes architectural choice
- `checkpoint:human-action` (1%) - Truly manual steps (email verify, SMS)

**Deviation Rules:**
| Rule | Trigger | Action |
|------|---------|--------|
| 4: Architectural | Structural change | STOP, present decision |
| 1: Bug | Broken behavior | Auto-fix + test + verify |
| 2: Missing Critical | Missing essentials | Auto-add + test + verify |
| 3: Blocking | Prevents completion | Auto-fix blocker + verify |

### Smart Routing (/hive:progress)

| Route | Condition | Suggests |
|-------|-----------|----------|
| A | Unexecuted plans exist | /hive:execute-phase |
| B | Phase needs planning | /hive:discuss-phase or /hive:plan-phase |
| C | Phase complete, more phases | /hive:plan-phase {X+1} |
| D | Milestone complete | /hive:complete-milestone |
| E | UAT gaps found | /hive:plan-phase --gaps |
| F | Between milestones | /hive:new-milestone |

---

## 6. Template System

### 34 Templates by Category

#### Project Artifacts (4)
| Template | Generates | Used By |
|----------|-----------|---------|
| `project.md` | .planning/PROJECT.md | new-project, transitions |
| `roadmap.md` | .planning/ROADMAP.md | new-project, execute-phase |
| `milestone.md` | .planning/MILESTONES.md entries | complete-milestone |
| `requirements.md` | .planning/REQUIREMENTS.md | new-project |

#### Planning Artifacts (3)
| Template | Generates | Used By |
|----------|-----------|---------|
| `phase-prompt.md` (568 lines!) | {phase}-{plan}-PLAN.md | hive-planner |
| `planner-subagent-prompt.md` | Prompt for Task() call | plan-phase |
| `discovery.md` | DISCOVERY.md | plan-phase |

#### State Artifacts (3)
| Template | Generates | Used By |
|----------|-----------|---------|
| `state.md` | .planning/STATE.md | Every workflow reads first |
| `context.md` | {phase}-CONTEXT.md | discuss-phase |
| `continue-here.md` | .continue-here.md | pause-work, execute-plan |

#### Summary Variants (4)
| Template | When Used |
|----------|-----------|
| `summary-minimal.md` | Simple plans, no deviations |
| `summary-standard.md` | Typical plans |
| `summary-complex.md` | Plans with significant deviations |
| `summary.md` | Full canonical reference (233 lines) |

#### Verification (2)
| Template | Generates | Used By |
|----------|-----------|---------|
| `verification-report.md` | {phase}-VERIFICATION.md | hive-verifier |
| `UAT.md` | {phase}-UAT.md | verify-work |

#### Research (6)
| Template | Generates |
|----------|-----------|
| `research.md` (519 lines) | {phase}-RESEARCH.md |
| `research-project/SUMMARY.md` | .planning/research/SUMMARY.md |
| `research-project/ARCHITECTURE.md` | .planning/research/ARCHITECTURE.md |
| `research-project/STACK.md` | .planning/research/STACK.md |
| `research-project/PITFALLS.md` | .planning/research/PITFALLS.md |
| `research-project/FEATURES.md` | .planning/research/FEATURES.md |

#### Debug (2)
| Template | Generates |
|----------|-----------|
| `DEBUG.md` | .planning/debug/{slug}.md |
| `debug-subagent-prompt.md` | Prompt for hive-debugger |

#### Codebase Mapping (7)
| Template | Generates |
|----------|-----------|
| `codebase/structure.md` | .planning/codebase/STRUCTURE.md |
| `codebase/architecture.md` | .planning/codebase/ARCHITECTURE.md |
| `codebase/concerns.md` | .planning/codebase/CONCERNS.md |
| `codebase/testing.md` | .planning/codebase/TESTING.md |
| `codebase/stack.md` | .planning/codebase/STACK.md |
| `codebase/conventions.md` | .planning/codebase/CONVENTIONS.md |
| `codebase/integrations.md` | .planning/codebase/INTEGRATIONS.md |

#### Other (3)
| Template | Generates |
|----------|-----------|
| `config.json` | .planning/config.json |
| `milestone-archive.md` | .planning/milestones/v{X.Y}-*.md |
| `user-setup.md` | {phase}-USER-SETUP.md |

### Template Variable Syntaxes
1. `[Bracketed Text]` - Human-filled placeholders
2. `{curly_braces}` - Machine-filled variables
3. `{{DOUBLE_CURLY}}` - Machine-filled (milestone-archive.md only)
4. YAML frontmatter - Machine-readable metadata

---

## 7. Reference System

### 13 References by Domain

#### Git (2)
| Reference | Purpose |
|-----------|---------|
| `git-integration.md` | Commit patterns: per-task atomic, `{type}({phase}-{plan}): {description}` |
| `git-planning-commit.md` | How to commit planning artifacts via hive-tools.js |

#### Models (2)
| Reference | Purpose |
|-----------|---------|
| `model-profiles.md` | 3 profiles (quality/balanced/budget), 11 agents x 3 profiles matrix |
| `model-profile-resolution.md` | Bash command to resolve profile from config |

#### UI/UX (2)
| Reference | Purpose |
|-----------|---------|
| `ui-brand.md` | Visual patterns: stage banners, checkpoint boxes, status symbols, progress bars |
| `questioning.md` | "Thinking partner, not interviewer" - dream extraction methodology |

#### Operations (3)
| Reference | Purpose |
|-----------|---------|
| `phase-argument-parsing.md` | Parse phase numbers, zero-pad, `hive-tools.js find-phase` |
| `decimal-phase-calculation.md` | Next decimal for urgent insertions (06 -> 06.1 -> 06.2) |
| `planning-config.md` | Full config schema, branching strategies (none/phase/milestone) |

#### Quality (3)
| Reference | Purpose |
|-----------|---------|
| `tdd.md` | RED-GREEN-REFACTOR, heuristic for when to use TDD |
| `verification-patterns.md` | 4 levels: Exists/Substantive/Wired/Functional, stub detection |
| `checkpoints.md` (776 lines!) | Golden rules, 3 types, auth gates, automation reference |

#### Formatting (1)
| Reference | Purpose |
|-----------|---------|
| `continuation-format.md` | "Next Up" block format after commands/workflows |

---

## 8. State Management

### .planning/ Directory Structure

```
.planning/
  PROJECT.md              # Living project context (what, why, requirements, decisions)
  REQUIREMENTS.md         # Checkable requirements with phase traceability
  ROADMAP.md              # Phase structure, goals, progress table
  STATE.md                # Short-term memory: position, progress, decisions (<100 lines)
  config.json             # Mode, depth, parallelization, model profile, gates

  research/               # Project-level research (from new-project)
    SUMMARY.md, STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

  codebase/               # Codebase analysis (from map-codebase)
    STACK.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md,
    TESTING.md, INTEGRATIONS.md, CONCERNS.md

  phases/
    01-foundation/        # Per-phase directory
      01-CONTEXT.md       # From discuss-phase
      01-RESEARCH.md      # From plan-phase (research step)
      01-01-PLAN.md       # From plan-phase (planner)
      01-02-PLAN.md
      01-01-SUMMARY.md    # From execute-plan (executor)
      01-02-SUMMARY.md
      01-VERIFICATION.md  # From execute-phase (verifier)
      01-UAT.md           # From verify-work
      01-USER-SETUP.md    # If user_setup in plan
      .continue-here.md   # From pause-work (deleted after resume)
    02-auth/
      ...

  quick/                  # Quick ad-hoc tasks
    001-fix-bug/

  todos/                  # Todo tracking
    pending/
    completed/

  debug/                  # Active debug sessions
    {slug}.md
    resolved/             # Archived sessions

  milestones/             # Archived milestones
    v1.0-ROADMAP.md
    v1.0-REQUIREMENTS.md

  MILESTONES.md           # Summary of all shipped milestones
  agent-history.json      # Agent spawn/completion tracking
  current-agent-id.txt    # Currently running agent ID
```

### Key State File Lifecycles

| File | Created | Updated | Archived | Deleted |
|------|---------|---------|----------|---------|
| PROJECT.md | new-project | transitions, complete-milestone | Never | Never |
| ROADMAP.md | new-project (roadmapper) | execute-phase, add/insert/remove-phase | complete-milestone | complete-milestone |
| STATE.md | new-project (roadmapper) | Every significant action | Never | Never (reconstructible) |
| REQUIREMENTS.md | new-project | execute-phase (mark satisfied) | complete-milestone | complete-milestone |
| config.json | new-project | settings | Never | Never |

---

## 9. Build & Distribution System

### Installer (bin/install.js - 1740 lines)

**3 Runtimes:**
- Claude Code (`.claude/`)
- OpenCode (`.config/opencode/`)
- Gemini CLI (`.gemini/`)

**2 Modes:**
- Global (`~/.claude/`) - all projects
- Local (`./.claude/`) - current project only

**Cross-runtime conversion:**
- Claude Code: Native format (source of truth)
- OpenCode: Frontmatter conversion (`allowed-tools` -> `tools: { name: true }`), command flattening
- Gemini CLI: TOML format, tool name mapping (Read->read_file, Bash->run_shell_command)

**Local patch persistence:**
- SHA256 file manifest before update
- Backs up user-modified Hive files to `hive-local-patches/`
- `/hive:reapply-patches` to merge back

### CLI Utility (hive-tools.js - 162K)

Monolithic CLI providing:
- `init` - Load project state for command context
- `state` - STATE.md operations (advance-plan, update-progress, record-metric)
- `commit` - Git commit with configurable doc commit behavior
- `verify` - Artifact verification, key-link verification, plan structure validation
- `frontmatter` - YAML frontmatter parsing
- `roadmap` - Roadmap operations (get-phase, analyze)
- `history-digest` - Project history generation
- `websearch` - Brave Search API integration

### Hooks (2)

| Hook | Event | Purpose |
|------|-------|---------|
| `hive-check-update.js` | SessionStart | Background npm version check (detached process) |
| `hive-statusline.js` | Statusline | Model + task + directory + context bar (scaled to 80%) |

---

## 10. Agent Teams: The 4 Transformations

### Current Model vs. Agent Teams Model

```
CURRENT Hive MODEL:
- Agents are "fire and forget" - spawn via Task, wait, read result file
- Communication: exclusively via files on disk (.planning/)
- Checkpoints: agent dies, new agent spawned with text context
- Revision loops: spawn-kill-respawn cycle
- Parallel agents: completely isolated

AGENT TEAMS MODEL:
- Agents are persistent and conversational
- Communication: real-time messaging via SendMessage + files for artifacts
- Checkpoints: agent sends message, goes idle, wakes with full context
- Revision loops: live dialogue between teammates
- Parallel agents: coordinated via broadcasts and shared TaskList
```

### The 4 Fundamental Patterns

#### Pattern 1: Checkpoint as Message
```
OLD:  Agent works -> checkpoint -> DIES -> user responds -> NEW agent -> re-reads everything
NEW:  Agent works -> checkpoint -> SENDS MESSAGE -> idle -> user responds -> WAKES UP (context intact)
```
- **Impact**: 1 agent instead of 4 for plan with 2 checkpoints
- **Where**: execute-phase, execute-plan, checkpoints.md, hive-executor
- **Bonus**: `skip_checkpoints` config becomes obsolete (checkpoints are now cheap)

#### Pattern 2: Live Dialogue
```
OLD:  Spawn planner -> writes PLANs -> DIES -> spawn checker -> finds issues -> DIES -> respawn planner...
NEW:  Planner and Checker as permanent teammates, SendMessage back and forth, targeted revision
```
- **Impact**: 50-66% fewer spawns, targeted verification, context preserved
- **Where**: plan-phase (planner<->checker), verify-work (diagnose->plan->check)

#### Pattern 3: Coordinated Parallel
```
OLD:  4 agents run isolated, write files, orchestrator reads after all complete
NEW:  4 agents + lead, broadcast discoveries, shared TaskList
```
- **Impact**: Eliminates redundant investigation, cross-pollination in real-time
- **Where**: new-project (researchers), map-codebase (mappers), diagnose-issues (debuggers)

#### Pattern 4: Streaming Pipeline
```
OLD:  ALL diagnose -> THEN ALL plan -> THEN ALL verify (sequential stages)
NEW:  Bug 1 diagnosed -> planner starts fix 1 -> checker verifies fix 1 (while bug 2 still being investigated)
```
- **Impact**: ~50% wall-clock reduction for gap resolution
- **Where**: verify-work (UAT pipeline), audit-milestone (phase readers -> integration checker)

---

## 11. Agent Teams: Execution Workflows

### execute-phase.md - The Main Orchestrator

**Current Limitations:**
1. No mid-execution visibility (blocks until wave completes)
2. No dynamic work redistribution (rigid waves)
3. Checkpoint = agent death + rebirth (fragile context reconstruction)
4. No cross-executor coordination (duplicate discovery)
5. Binary failure recovery (continue/stop only)

**Agent Teams Enhancements:**

**1. Real-time progress reporting:**
```
TeamCreate("phase-{N}-execution")
# Each executor sends per-task updates:
SendMessage("PROGRESS: Task 2/5 complete: feat(03-01): create user model")
# Team lead relays to user in real-time
```

**2. Dynamic wave optimization:**
```
TaskCreate(subject="plan-01", ...)
TaskCreate(subject="plan-02", ...)
TaskCreate(subject="plan-03", blockedBy=["plan-01"])  # Only blocked by actual dep
# When plan-01 finishes, plan-03 starts even if plan-02 is still running
```

**3. Checkpoint without agent death:**
```
# Executor hits checkpoint -> sends message -> goes idle -> wakes with full context
SendMessage("CHECKPOINT: human-verify, please check http://localhost:3000")
# vs. current: return structured markdown, die, new agent spawns, re-reads everything
```

**4. Cross-executor coordination:**
```
# Executor A broadcasts: "Changed UserProfile type - added 'avatar' field"
# Executor B receives this BEFORE encountering the issue
```

**5. Shared TaskList for live tracking:**
```
# Each executor updates tasks in real-time
TaskUpdate(taskId="plan-01-task-3", status="completed")
# Replaces brittle SUMMARY.md spot-checking
```

### execute-plan.md - Individual Plan Execution

**Key enhancement: Deviation Rule 4 as team message:**
```
# OLD: Rule 4 -> checkpoint return -> agent death -> restart
# NEW: Rule 4 -> SendMessage -> goes idle -> receives answer -> continues
SendMessage("DECISION NEEDED: Need new verification_tokens table. Options: A) new table, B) reuse sessions")
# Receives: "Go with option A"
# Continues immediately with full context
```

### hive-executor.md - Agent Definition Changes

**New tools needed:** SendMessage, TaskUpdate, TaskList

**New behavioral contract:**
- After each task commit: send progress update
- At checkpoint: send message (NOT return), wait for response
- On deviation auto-fix: broadcast to team
- On Rule 4 deviation: message team lead, wait
- On completion: send PLAN COMPLETE + TaskUpdate

### checkpoints.md - Checkpoint Reference Changes

**Team mode checkpoints (new section):**
- `human-verify`: SendMessage -> idle -> "approved" -> continue
- `decision`: SendMessage with options -> idle -> selection -> implement
- `human-action`: SendMessage -> idle -> "done" -> verify -> continue
- **Key rule**: NEVER format checkpoint_return_format. NEVER return/exit. Send message and wait.

**Auth gates become trivial:**
```
# OLD: auth error -> checkpoint -> die -> user authenticates -> new agent -> retry
# NEW: auth error -> SendMessage("need vercel login") -> idle (30 sec) -> "done" -> retry
```

---

## 12. Agent Teams: Planning & Research Workflows

### plan-phase.md - Planner<->Checker Live Dialogue

**Current (spawn-kill-respawn):**
```
Orchestrator spawns Planner -> writes PLANs -> dies
Orchestrator spawns Checker -> finds issues -> dies
Orchestrator spawns Planner with issues -> revises -> dies
Orchestrator spawns Checker -> re-checks -> dies
= 6 agent spawns for 3 iterations
```

**With Agent Teams (live dialogue):**
```
TeamCreate("planning-team")
Planner and Checker as teammates

Planner writes PLANs -> messages Checker: "Plans ready"
Checker reviews -> messages Planner: "3 blockers found"
Planner asks: "Would splitting plan 01 work?"
Checker: "Yes, resolves scope_sanity"
Planner revises -> "Re-check plans 01a, 01b, 02 only"
Checker re-checks only changed plans -> "All clear"
= 2 agent spawns, persistent context, targeted dialogue
```

**Benefits:**
- 50-66% fewer spawns
- Targeted re-checking (only changed plans)
- Clarification dialogue (checker asks "Is AUTH-02 in task 3 or 4?")
- Context preservation across revisions
- Researcher stays alive for consultation during revision

### new-project.md - Research Team

**Current (isolated parallel):**
```
4 researchers run independently -> all finish -> synthesizer reads files -> SUMMARY.md
```

**With Agent Teams (coordinated parallel):**
```
TeamCreate("research-team") - synthesizer as lead, 4 researchers as teammates

Stack researcher discovers "Next.js 15 + Prisma + tRPC"
  -> broadcasts to team
Architecture researcher adjusts patterns around tRPC

Pitfalls researcher discovers "Prisma connection pooling issue"
  -> sends to arch-researcher
Architecture researcher adds connection pooling pattern

Features researcher completes first
  -> synthesizer begins incremental synthesis

Result: No contradictions, faster synthesis, less duplication
```

**Benefits:**
- Cross-pollination eliminates contradictions
- Incremental synthesis (40-60% faster end-to-end)
- De-duplication of effort
- Richer SUMMARY.md from dialogue context

### map-codebase.md - Mapping Team

**Current:** 4 isolated mappers write 7 documents independently.

**With Agent Teams:**
```
tech-mapper broadcasts: "Stack: Next.js 15, Prisma, Supabase, Tailwind"
arch-mapper focuses on Next.js app router patterns (not re-discovering stack)
quality-mapper organizes CONVENTIONS.md by arch-mapper's layers
concerns-mapper gets inputs from ALL other mappers

Result: Consistent terminology, deeper analysis, ~30% token savings
```

---

## 13. Agent Teams: Verification & Debugging Workflows

### diagnose-issues.md - Shared Root Cause Discovery

**Current:** Parallel debug agents isolated. Often find same root cause independently.

**With Agent Teams:**
```
TeamCreate("debug-squad")
debugger-4 finds: "auth middleware broken in api/middleware.ts"
  -> broadcasts finding
debugger-1 checks auth -> confirms same root cause -> resolves in SECONDS
debugger-2 checks auth -> confirms -> resolves in SECONDS
debugger-3 continues (unrelated CSS issue)

vs. current: all 4 independently trace through full stack
```

### verify-work.md - Streaming UAT Pipeline

**Current:** Sequential: all diagnose -> all plan -> all check

**With Agent Teams:**
```
TeamCreate("uat-resolution")
debugger-1..N, planner, checker all as teammates

debugger-2 completes -> planner starts fix plan for gap 2
debugger-1 completes -> planner starts fix plan for gap 1
                         checker starts checking gap 2's plan
debugger-3 completes -> planner starts fix plan for gap 3
                         checker checks gap 1's plan

~50% faster: streaming pipeline vs. batch sequential
```

### audit-milestone.md - Incremental Integration Checking

**Current:** Batch read all phases -> dump to integration checker

**With Agent Teams:**
```
TeamCreate("milestone-audit")
phase-reader-1..N (one per phase), integration-checker, requirements-checker

phase-reader-1: "Phase 1 exports: getCurrentUser, AuthProvider"
phase-reader-2: "Phase 2 imports: getCurrentUser"
integration-checker: starts Phase 1->2 check immediately (doesn't wait for all phases)
```

### debug.md - Specialized Debug Teams

**For complex cross-stack bugs (optional: `/hive:debug --team`):**
```
TeamCreate("debug-{slug}")
frontend-debugger, backend-debugger, data-debugger, debug-lead

frontend: "Form submits, fetch fires, response is 500"
  -> sends to backend
backend: "API tries DB write, gets connection error"
  -> sends to data
data: "Connection pool exhausted. Max=5, all in use."

~3 minutes (parallel) vs ~8 minutes (sequential through 3 layers)
```

### verify-phase.md - QA Team for Large Phases

**For phases with 5+ must_haves:**
```
TeamCreate("qa-team")
truth-verifier, artifact-checker, requirements-checker, qa-lead

All 3 verify in parallel
artifact-checker finds MISSING artifact -> creates blocker task
truth-verifier skips dependent truths (saves time)
qa-lead can terminate early if critical threshold exceeded
```

### The Ultimate: verify->diagnose->plan->execute as Single Team

```
TeamCreate("gap-resolution-{phase}")

Phase 1: verifier creates task per gap
Phase 2: debuggers pick up gaps from shared TaskList
Phase 3: planner picks up diagnosed gaps (wakes on task update)
Phase 4: checker picks up planned gaps

Entire pipeline as ONE team lifecycle, ONE shared TaskList
Each stage starts as soon as input available (not waiting for all previous)
```

---

## 14. Priority Implementation Roadmap

### P0 - TRANSFORMATIONAL (do first)

| # | Change | Files to Modify | Pattern |
|---|--------|----------------|---------|
| 1 | Checkpoint as messaging | execute-phase.md, execute-plan.md, hive-executor.md, checkpoints.md | Checkpoint-as-Message |
| 2 | Planner<->Checker dialogue | plan-phase.md, hive-planner.md, hive-plan-checker.md | Live Dialogue |

### P1 - HIGH VALUE

| # | Change | Files to Modify | Pattern |
|---|--------|----------------|---------|
| 3 | Debug agents coordination | diagnose-issues.md | Coordinated Parallel |
| 4 | Streaming UAT pipeline | verify-work.md | Streaming Pipeline |
| 5 | Dynamic wave scheduling | execute-phase.md, config.json | Checkpoint-as-Message + TaskList |

### P2 - MEDIUM VALUE

| # | Change | Files to Modify | Pattern |
|---|--------|----------------|---------|
| 6 | Research team coordination | new-project.md, new-milestone.md | Coordinated Parallel |
| 7 | Incremental milestone audit | audit-milestone.md | Streaming Pipeline |
| 8 | Real-time execution progress | execute-phase.md, hive-executor.md | Live Dialogue |

### P3 - NICE TO HAVE

| # | Change | Files to Modify | Pattern |
|---|--------|----------------|---------|
| 9 | Mapper coordination | map-codebase.md | Coordinated Parallel |
| 10 | Specialized debug teams | debug.md, hive-debugger.md | Coordinated Parallel |
| 11 | Gap analysis with debug insights | plan-milestone-gaps.md | Streaming Pipeline |

---

## 15. Config Changes Required

### Current config.json
```json
{
  "mode": "interactive",
  "depth": "standard",
  "workflow": { "research": true, "plan_check": true, "verifier": true },
  "planning": { "commit_docs": true, "search_gitignored": false },
  "parallelization": {
    "enabled": true,
    "plan_level": true,
    "task_level": false,
    "skip_checkpoints": true,
    "max_concurrent_agents": 3,
    "min_plans_for_parallel": 2
  },
  "gates": { ... },
  "safety": { ... }
}
```

### Proposed config.json additions for Hive
```json
{
  "parallelization": {
    "skip_checkpoints": false,           // OBSOLETE - checkpoints are cheap with messaging
    "dynamic_scheduling": true,           // NEW: start plans when actual deps met (not wave end)
    "executor_pool": false                // NEW: pool pattern vs 1:1 agent:plan
  },
  "teams": {
    "planning_team": true,                // NEW: planner+checker live dialogue
    "research_team": true,                // NEW: researcher cross-pollination
    "execution_team": true,               // NEW: executor coordination + progress
    "qa_team": "auto",                    // NEW: "auto" = use for 5+ must_haves, "always", "never"
    "debug_team": "complex_only"          // NEW: "complex_only", "always", "never"
  }
}
```

---

## Appendix: Key File Paths

```
# Agents
agents/hive-planner.md          (36K)
agents/hive-executor.md         (14K)
agents/hive-debugger.md         (36K)
agents/hive-verifier.md         (16K)
agents/hive-plan-checker.md     (19K)
agents/hive-project-researcher.md (16K)
agents/hive-phase-researcher.md (14K)
agents/hive-research-synthesizer.md (7K)
agents/hive-codebase-mapper.md  (16K)
agents/hive-roadmapper.md       (16K)
agents/hive-integration-checker.md (12K)

# Core Workflows
hive/workflows/new-project.md    (28K)
hive/workflows/execute-plan.md   (18K)
hive/workflows/execute-phase.md
hive/workflows/plan-phase.md     (13K)
hive/workflows/verify-work.md    (15K)
hive/workflows/verify-phase.md
hive/workflows/diagnose-issues.md
hive/workflows/audit-milestone.md
hive/workflows/progress.md

# Key Templates
hive/templates/phase-prompt.md   (568 lines)
hive/templates/research.md       (519 lines)
hive/templates/summary.md        (233 lines)
hive/templates/config.json

# Key References
hive/references/checkpoints.md   (776 lines)
hive/references/verification-patterns.md
hive/references/tdd.md
hive/references/git-integration.md

# Build System
bin/install.js                 (1740 lines)
hive/bin/hive-tools.js (162K)
hooks/hive-statusline.js
hooks/hive-check-update.js
scripts/build-hooks.js
```
