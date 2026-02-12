# External Integrations

**Analysis Date:** 2026-02-11

## APIs & External Services

**Web Search:**
- Brave Search API - Optional web search integration
  - SDK/Client: Native fetch API
  - Auth: BRAVE_API_KEY environment variable or ~/.hive/brave_api_key file
  - Usage: hive/bin/hive-tools.js websearch command (line 2000-2062)
  - Endpoint: https://api.search.brave.com/res/v1/web/search
  - Fallback: If unavailable, agents use built-in WebSearch tool
  - Config flag: brave_search in .planning/config.json

**npm Registry:**
- npm package distribution - Package published as hive-cc on npmjs.com
  - Update checker: hooks/hive-check-update.js checks https://registry.npmjs.org/hive-cc for latest version
  - Installation: npx hive-cc@latest via npm

**Community Platforms:**
- Discord - Community invite embedded in installer (https://discord.gg/5JJgD5svVS)
- X/Twitter - @gsd_foundation
- GitHub - Source repository at https://github.com/glittercowboy/hive
- Dexscreener - Token tracking (Solana-based $GSD token)

## Data Storage

**Databases:**
- None - Pure file-based system

**File Storage:**
- Local filesystem only
  - Planning docs: .planning/ directory
  - State: .planning/STATE.md
  - Roadmap: .planning/ROADMAP.md
  - Phase plans: .planning/phases/{NN}-{slug}/
  - Config: .planning/config.json

**Caching:**
- None - No caching layer

## Authentication & Identity

**Auth Provider:**
- None - No user authentication required

**Installation Auth:**
- No authentication for package installation
- Works offline after initial npm download

## Monitoring & Observability

**Error Tracking:**
- None

**Logs:**
- Console output only
- No persistent logging infrastructure

## CI/CD & Deployment

**Hosting:**
- npm registry for package distribution
- GitHub for source code

**CI Pipeline:**
- None detected in repository

**Build Process:**
- Pre-publish hook: npm run build:hooks via prepublishOnly script
- Copies hooks from hooks/ to hooks/dist/ for distribution

## Environment Configuration

**Required env vars:**
- None - System works without any environment variables

**Optional env vars:**
- BRAVE_API_KEY - Brave Search API key (optional feature)
- OPENCODE_CONFIG_DIR - Override OpenCode config directory
- GEMINI_CONFIG_DIR - Override Gemini config directory
- CLAUDE_CONFIG_DIR - Override Claude config directory
- XDG_CONFIG_HOME - XDG Base Directory spec compliance for OpenCode

**Secrets location:**
- ~/.hive/brave_api_key - Optional Brave API key file
- No other secrets required

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## Version Control Integration

**Git Operations:**
- System uses git directly via Node.js child_process module
- Operations: commit, status, diff, log, add
- Planning docs committed to git automatically (configurable via commit_docs flag)
- Co-authorship attribution: "Co-Authored-By: Claude Opus 4.6"

## AI Runtime Integration

**Target Platforms:**
- Claude Code - Anthropic's AI coding assistant
  - Install location: ~/.claude/ (global) or ./.claude/ (local)
  - Settings: .claude/settings.json

- OpenCode - Open source alternative
  - Install location: ~/.config/opencode/ (XDG spec compliant)
  - Env vars: OPENCODE_CONFIG_DIR, OPENCODE_CONFIG

- Gemini CLI - Google's AI coding assistant
  - Install location: ~/.gemini/
  - Env var: GEMINI_CONFIG_DIR

**Installation Methods:**
- Interactive: npx hive-cc@latest
- Non-interactive: npx hive-cc --claude --global
- Supports --global, --local, --all, --both flags

## External Dependencies

**Development Only:**
- esbuild 0.24.0 - Build tool for hooks (devDependency only)

**Runtime:**
- Zero external dependencies - Core design principle
- All functionality built on Node.js stdlib

---

*Integration audit: 2026-02-11*
