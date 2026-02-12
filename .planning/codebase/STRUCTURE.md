# Codebase Structure

**Analysis Date:** 2026-02-11

## Directory Layout

```
hive-disaster/
├── bin/                         # Package entry point
│   └── install.js              # Multi-runtime installer
├── commands/hive/              # User-facing slash commands (27 files)
├── hive/                       # Core system files
│   ├── bin/                    # CLI utilities
│   │   ├── hive-tools.js       # 4597-line monolithic utility
│   │   └── hive-tools.test.js  # Test suite
│   ├── workflows/              # Orchestration logic (29 files)
│   ├── references/             # Behavioral rules (13 files)
│   └── templates/              # Artifact shapes (34 files)
├── agents/                     # Specialized workers (11 files)
├── hooks/                      # Runtime hooks
│   ├── hive-statusline.js      # Custom statusline
│   └── hive-check-update.js    # Background updater
├── scripts/                    # Build scripts
│   └── build-hooks.js          # esbuild hook bundler
├── .claude/                    # Installed copy for Claude Code
├── .planning/                  # Project workspace (created by new-project)
│   ├── PROJECT.md              # Immutable project vision
│   ├── STATE.md                # Current position and memory
│   ├── ROADMAP.md              # Phase structure
│   ├── REQUIREMENTS.md         # Validated requirements
│   ├── config.json             # Runtime preferences
│   ├── phases/                 # Phase directories
│   │   ├── 01-{slug}/          # Phase 1
│   │   │   ├── 01-01-PLAN.md   # Executable plan
│   │   │   ├── 01-01-SUMMARY.md # Execution summary
│   │   │   ├── 01-CONTEXT.md   # User decisions
│   │   │   └── 01-VERIFICATION.md # Goal verification
│   ├── research/               # Domain research artifacts
│   └── todos/                  # Pending/completed todos
├── assets/                     # README images
├── .github/                    # GitHub config
│   ├── workflows/              # CI workflows
│   └── ISSUE_TEMPLATE/         # Issue templates
├── package.json                # npm package definition
├── README.md                   # User documentation
├── CHANGELOG.md                # Version history
├── LICENSE                     # MIT license
└── SECURITY.md                 # Security policy
```

## Directory Purposes

**`bin/`:**
- Purpose: Package entry point
- Contains: install.js (multi-runtime installer with --global/--local/--claude/--opencode/--gemini flags)
- Key files: `install.js` (handles copying hive/ to appropriate config directories)

**`commands/hive/`:**
- Purpose: User-facing entry points (slash commands)
- Contains: 27 markdown files with frontmatter (name, description, allowed-tools)
- Key files:
  - `new-project.md`: Initialize project
  - `plan-phase.md`: Create phase plans
  - `execute-phase.md`: Build phase
  - `verify-work.md`: Verify goal achievement
  - `quick.md`: One-off tasks
  - `progress.md`: Show completion status
  - `map-codebase.md`: Analyze existing code
- Pattern: 30-80 line dispatchers that load workflows via `@~/.claude/hive/workflows/{name}.md`

**`hive/`:**
- Purpose: Core system logic
- Contains: Subdirectories for workflows, references, templates, utilities
- Installed to: `~/.claude/hive/`, `~/.opencode/hive/`, or `~/.gemini/hive/`

**`hive/bin/`:**
- Purpose: CLI utilities for atomic operations
- Contains: hive-tools.js (4597 lines), hive-tools.test.js
- Key files:
  - `hive-tools.js`: State CRUD, git commits, model resolution, phase ops, roadmap ops, verification, template fill, frontmatter CRUD
- Usage pattern: `node ~/.claude/hive/bin/hive-tools.js <command> [args]` → JSON output

**`hive/workflows/`:**
- Purpose: Multi-step orchestration logic
- Contains: 29 markdown files (150-500+ lines each)
- Key files:
  - `new-project.md`: Questioning → research → requirements → roadmap
  - `plan-phase.md`: Research → plan → verify → commit
  - `execute-phase.md`: Group waves → spawn executors → handle checkpoints
  - `verify-work.md`: Goal-backward verification
  - `quick.md`: Inline plan → execute → summarize
  - `map-codebase.md`: Codebase analysis orchestration
- Pattern: `<process>` blocks with numbered steps, gates, agent spawns via Task tool

**`hive/references/`:**
- Purpose: Behavioral rules and standards
- Contains: 13 markdown reference documents
- Key files:
  - `checkpoints.md`: Human interaction patterns (35k lines)
  - `verification-patterns.md`: Goal-backward verification methodology
  - `git-integration.md`: Branching strategies, commit patterns
  - `questioning.md`: Deep context gathering techniques
  - `tdd.md`: Test-driven development workflow
  - `ui-brand.md`: UI/UX output formatting
  - `planning-config.md`: Config schema documentation
  - `model-profiles.md`: Agent-to-model mapping
- Used by: All layers via `@~/.claude/hive/references/{name}.md`

**`hive/templates/`:**
- Purpose: Artifact shape definitions
- Contains: 34 markdown and JSON template files
- Key files:
  - `project.md`: PROJECT.md template
  - `roadmap.md`: ROADMAP.md template
  - `state.md`: STATE.md template
  - `phase-prompt.md`: PLAN.md template
  - `summary.md`, `summary-minimal.md`, `summary-standard.md`, `summary-complex.md`: SUMMARY.md variants
  - `context.md`: CONTEXT.md template (user decisions)
  - `verification-report.md`: VERIFICATION.md template
  - `config.json`: Default config.json
  - `codebase/`: 7 codebase mapping templates (STACK.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md, CONCERNS.md)
- Used by: Workflows and agents to ensure consistent output

**`agents/`:**
- Purpose: Specialized worker definitions
- Contains: 11 markdown agent files
- Key files:
  - `hive-executor.md`: Executes PLAN.md files
  - `hive-planner.md`: Creates PLAN.md files
  - `hive-verifier.md`: Verifies goal achievement
  - `hive-phase-researcher.md`: Researches phase implementation
  - `hive-project-researcher.md`: Researches project domain
  - `hive-research-synthesizer.md`: Synthesizes research
  - `hive-roadmapper.md`: Creates roadmaps
  - `hive-debugger.md`: Diagnoses issues
  - `hive-plan-checker.md`: Validates plan quality
  - `hive-codebase-mapper.md`: Maps existing codebases
  - `hive-integration-checker.md`: Verifies plan integration
- Pattern: Frontmatter (name, description, tools, color) + `<role>` + `<process>` + mode-specific sections

**`hooks/`:**
- Purpose: Runtime hooks for Claude Code
- Contains: 2 JavaScript files
- Key files:
  - `hive-statusline.js`: Custom statusline with context bar
  - `hive-check-update.js`: Background npm update checker
- Bundled to: `hooks/dist/` via `npm run build:hooks` (esbuild)

**`.planning/`:**
- Purpose: Project workspace (created by `/hive:new-project`)
- Generated: Yes
- Committed: Yes (entire directory tracked in git)
- Contains:
  - `PROJECT.md`: Immutable vision
  - `STATE.md`: Current position, decisions, blockers
  - `ROADMAP.md`: Phase goals
  - `REQUIREMENTS.md`: Validated and active requirements
  - `config.json`: User preferences
  - `phases/{NN}-{slug}/`: Phase directories with PLAN.md, SUMMARY.md, CONTEXT.md, VERIFICATION.md
  - `research/`: Domain research (SUMMARY.md, STACK.md, ARCHITECTURE.md, FEATURES.md, PITFALLS.md)
  - `todos/pending/`, `todos/completed/`: Captured ideas
  - `codebase/`: Existing code analysis (STACK.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md, CONCERNS.md)

**`.claude/`:**
- Purpose: Installed copy for Claude Code runtime
- Generated: Yes (by bin/install.js)
- Committed: No (created in user's config directory)
- Contains: Mirror of `hive/`, `commands/`, `agents/`, `hooks/dist/`

**`.github/`:**
- Purpose: GitHub configuration
- Contains: CI workflows, issue templates
- Key files:
  - `workflows/auto-label.yml`: Auto-label new issues
  - `ISSUE_TEMPLATE/`: Bug report, feature request templates

## Key File Locations

**Entry Points:**
- `bin/install.js`: Package installer
- `commands/hive/*.md`: User slash commands (27 files)

**Configuration:**
- `package.json`: npm package definition
- `.planning/config.json`: Runtime preferences (created by new-project)
- `hive/templates/config.json`: Default config template

**Core Logic:**
- `hive/bin/hive-tools.js`: 4597-line CLI utility (all atomic operations)
- `hive/workflows/*.md`: 29 orchestration workflows
- `agents/*.md`: 11 specialized agents

**Testing:**
- `hive/bin/hive-tools.test.js`: Unit tests for hive-tools.js

## Naming Conventions

**Files:**
- Commands: `{verb}-{noun}.md` (e.g., `new-project.md`, `plan-phase.md`)
- Workflows: Same as command names (e.g., `new-project.md`, `execute-phase.md`)
- Agents: `hive-{role}.md` (e.g., `hive-executor.md`, `hive-planner.md`)
- Templates: `{artifact-name}.md` (e.g., `project.md`, `state.md`)
- References: `{topic}.md` (e.g., `checkpoints.md`, `verification-patterns.md`)
- Phase plans: `{NN}-{MM}-PLAN.md` (e.g., `01-01-PLAN.md`, `02.1-01-PLAN.md`)
- Phase summaries: `{NN}-{MM}-SUMMARY.md` (e.g., `01-01-SUMMARY.md`)
- Phase context: `{NN}-CONTEXT.md` (e.g., `01-CONTEXT.md`)

**Directories:**
- Phase dirs: `{NN}-{slug}` where NN is zero-padded (e.g., `01-database-schema`, `03-api-endpoints`)
- Decimal phases: `{NN}.{M}-{slug}` (e.g., `02.1-auth-bugfix`)

**Variables:**
- Bash: SCREAMING_SNAKE_CASE (e.g., `INIT`, `PHASE_DIR`, `PLAN_START_TIME`)
- JavaScript: camelCase for functions, SCREAMING_SNAKE for constants
- JSON fields: snake_case (e.g., `model_profile`, `commit_docs`, `phase_number`)

**Git branches:**
- Phase branches: `hive/phase-{N}-{slug}` (e.g., `hive/phase-01-database-schema`)
- Milestone branches: `hive/{version}-{slug}` (e.g., `hive/v1.0-mvp`)

## Where to Add New Code

**New Command:**
- Primary code: `commands/hive/{command-name}.md` (frontmatter + dispatch to workflow)
- Workflow: `hive/workflows/{command-name}.md` (orchestration logic)
- Tests: No automated tests for commands (markdown prompts)

**New Agent:**
- Implementation: `agents/hive-{role}.md` (frontmatter + role + process)
- Model profile: Add to `MODEL_PROFILES` table in `hive/bin/hive-tools.js` (line 125)
- Spawn from: Workflow files via Task tool

**New Workflow:**
- Implementation: `hive/workflows/{workflow-name}.md`
- Init command: Add to `hive-tools.js` compound commands section
- Reference from: Command file via `@~/.claude/hive/workflows/{workflow-name}.md`

**New Template:**
- Implementation: `hive/templates/{template-name}.md`
- Fill logic: Add to `cmdTemplateFill` in `hive-tools.js` (line 1570)

**New Reference:**
- Implementation: `hive/references/{topic}.md`
- Reference from: Workflows/agents via `@~/.claude/hive/references/{topic}.md`

**New hive-tools.js Command:**
- Implementation: Add function to `hive/bin/hive-tools.js`
- Export: Add case to main switch statement (bottom of file)
- Usage: Call from workflows via `node ~/.claude/hive/bin/hive-tools.js {command} [args]`

**Utilities:**
- Shared helpers: Add to `hive/bin/hive-tools.js` (not a separate utilities directory)

## Special Directories

**`hooks/dist/`:**
- Purpose: Bundled runtime hooks for distribution
- Generated: Yes (via `npm run build:hooks`)
- Committed: No (built during prepublish)
- Source: `hooks/*.js`

**`.planning/phases/`:**
- Purpose: Per-phase workspace
- Generated: Yes (by `hive-tools.js phase add` or `phase insert`)
- Committed: Yes (all phase artifacts tracked)
- Naming: `{NN}-{slug}` where slug is kebab-case phase name

**`.planning/research/`:**
- Purpose: Domain research artifacts
- Generated: Yes (by hive-project-researcher, hive-phase-researcher)
- Committed: Yes
- Contains: SUMMARY.md (synthesis), topic-specific research files

**`.planning/todos/`:**
- Purpose: Captured ideas and tasks
- Generated: Yes (by /hive:add-todo)
- Committed: Yes
- Structure: `pending/{slug}.md`, `completed/{slug}.md`

**`.planning/codebase/`:**
- Purpose: Existing codebase analysis
- Generated: Yes (by /hive:map-codebase)
- Committed: Yes
- Contains: 7 analysis documents (STACK.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md, CONCERNS.md)

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No
- Note: Zero runtime dependencies (only esbuild in devDependencies)

## Installation Patterns

**Global Install (Runtime Config):**
```bash
npx hive-cc@latest --global --claude
# Copies to: ~/.claude/hive/, ~/.claude/commands/, ~/.claude/agents/
```

**Local Install (Project):**
```bash
npx hive-cc@latest --local
# Copies to: ./.claude/hive/, ./.claude/commands/, ./.claude/agents/
```

**Multi-Runtime:**
```bash
npx hive-cc@latest --all
# Copies to: ~/.claude/, ~/.opencode/, ~/.gemini/
```

## File Path Patterns in Code

**Absolute paths used in workflows:**
- `~/.claude/hive/bin/hive-tools.js` (CLI utility)
- `~/.claude/hive/workflows/{name}.md` (@-references)
- `~/.claude/hive/references/{name}.md` (@-references)
- `~/.claude/hive/templates/{name}.md` (@-references)

**Relative paths from project root:**
- `.planning/PROJECT.md`
- `.planning/STATE.md`
- `.planning/ROADMAP.md`
- `.planning/phases/{NN}-{slug}/`

**Dynamic path construction:**
- Phase dir: From `hive-tools.js init` → `phase_dir` field
- Plan paths: From `hive-tools.js phase-plan-index` → `plans[]` array
- Model names: From `hive-tools.js resolve-model {agent}` → model string

---

*Structure analysis: 2026-02-11*
