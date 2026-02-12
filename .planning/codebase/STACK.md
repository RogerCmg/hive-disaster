# Technology Stack

**Analysis Date:** 2026-02-11

## Languages

**Primary:**
- JavaScript (Node.js) - All runtime code, CLI tools, hooks, installer

**Secondary:**
- Markdown - Core system logic (commands, workflows, agents, templates)
- JSON - Configuration files

## Runtime

**Environment:**
- Node.js >= 16.7.0 (specified in `package.json`)

**Package Manager:**
- npm (primary)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- None - Zero runtime dependencies (pure Node.js stdlib)

**Testing:**
- Node.js built-in test runner (`node:test` module) - Unit tests in `hive/bin/hive-tools.test.js`

**Build/Dev:**
- esbuild 0.24.0 (devDependency) - Build hooks for distribution via `scripts/build-hooks.js`

## Key Dependencies

**Critical:**
- **Zero runtime dependencies** - Core design principle. Package is markdown-only meta-prompting system.

**Infrastructure:**
- Node.js stdlib only:
  - `fs` - File system operations
  - `path` - Path manipulation
  - `child_process` - Git operations via `execSync`, hook spawning via `spawn`
  - `os` - Home directory resolution, platform detection
  - `readline` - Interactive installer prompts
  - `crypto` - Hash generation for update checks

## Configuration

**Environment:**
- Optional `BRAVE_API_KEY` - Brave Search API integration for web search commands
- Optional `OPENCODE_CONFIG_DIR`, `GEMINI_CONFIG_DIR`, `CLAUDE_CONFIG_DIR` - Override default config locations
- Brave API key file: `~/.hive/brave_api_key` (alternative to env var)

**Build:**
- `package.json` - npm scripts for hook building and testing
- `scripts/build-hooks.js` - Copies hooks to `hooks/dist/` for distribution

## Platform Requirements

**Development:**
- Node.js >= 16.7.0
- Git (used by workflows for commit operations)
- npm (for installation)

**Production:**
- Deploys to AI coding assistants: Claude Code (`~/.claude/`), OpenCode (`~/.config/opencode/`), Gemini CLI (`~/.gemini/`)
- Multi-runtime installer: `bin/install.js` (~1500 lines, handles global/local installation)
- Works on Mac, Windows, and Linux (cross-platform)

## Core Files

**Installer:**
- `bin/install.js` - Multi-runtime installer with interactive prompts

**CLI Tools:**
- `hive/bin/hive-tools.js` - 4597-line monolithic CLI utility (state management, git commits, roadmap operations, web search, frontmatter CRUD, verification suite)

**Hooks:**
- `hooks/hive-statusline.js` - Custom statusline showing model, task, directory, context usage bar
- `hooks/hive-check-update.js` - Background npm version checker

**Templates:**
- `hive/templates/config.json` - Default workflow configuration (modes, gates, parallelization, team settings)

## Architecture Philosophy

**Zero Dependencies:**
- Deliberate choice to avoid npm supply chain vulnerabilities
- Pure Node.js stdlib for all runtime operations
- Markdown files contain all system logic (meta-prompting architecture)

**File-Based Communication:**
- Agents communicate via files in `.planning/` directory
- No direct inter-process communication
- Each agent spawned with fresh 200k context

---

*Stack analysis: 2026-02-11*
