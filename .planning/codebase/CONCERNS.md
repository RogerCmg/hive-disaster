# Codebase Concerns

**Analysis Date:** 2026-02-11

## Tech Debt

**Monolithic hive-tools.js:**
- Issue: Single 4,597-line JavaScript file with 100+ functions handling all mechanical operations (state, commits, roadmap, verification, templates, frontmatter, progress, todos, scaffolding, milestone ops)
- Files: `hive/bin/hive-tools.js`
- Impact: Difficult to maintain, test, and reason about. Hard to onboard contributors. Change in one function risks breaking unrelated features. Currently has 2,033-line test file (93 tests) but cognitive load remains high.
- Fix approach: Refactor into modular structure with separate files per domain (state.js, roadmap.js, verification.js, templates.js, git.js). Maintain single entry point but separate concerns. Would improve maintainability without breaking CLI interface.

**Massive installer script:**
- Issue: 1,739-line install.js handles multi-runtime (Claude/OpenCode/Gemini), global/local, uninstall, config migration, patch backup/restore, settings merging, and legacy cleanup
- Files: `bin/install.js`
- Impact: Complex logic with 81 synchronous operations. Difficult to debug installation issues. Risk of partial install states on error.
- Fix approach: Split installer into phases (detect → backup → install → configure → verify) with rollback capability. Extract runtime-specific logic into separate modules. Add verbose logging mode.

**Massive agent prompts:**
- Issue: Agent markdown files range from 7KB to 36KB (hive-planner.md, hive-debugger.md both 1,300+ lines). These ARE the prompts Claude receives.
- Files: `agents/hive-planner.md` (1,316 lines), `agents/hive-debugger.md` (1,355 lines), `agents/hive-executor.md` (884 lines)
- Impact: Token-heavy agent spawns. While intentional (comprehensive instructions), risks hitting context limits before useful work. May degrade performance on smaller models (haiku).
- Fix approach: Extract common patterns to shared references loaded via context. Consider agent skill levels (novice gets full prompt, experienced gets abbreviated). Dynamic prompt assembly based on model profile.

**Dual-mode complexity:**
- Issue: Recent Agent Teams integration added dual-mode support across 15 files. Each workflow now has parallel logic paths for team mode vs standalone mode.
- Files: `hive/workflows/execute-phase.md` (+561 lines), `hive/workflows/new-project.md` (+304 lines), `agents/hive-executor.md` (+197 lines), plus 12 others
- Impact: Maintenance burden doubled - every bug fix needs verification in both modes. Unclear which mode is actually used in practice. Config flag controls behavior.
- Fix approach: Telemetry to measure standalone vs team mode usage. If team mode is universally superior and stable, deprecate standalone mode in v2.0. If mixed usage, consider separate files instead of interleaved logic.

**Legacy backward-compatibility code:**
- Issue: Multiple instances of deprecated features kept for backward compatibility (legacy `--both` flag in installer, old statusline path fixes, GSD→Hive rebrand artifacts)
- Files: `bin/install.js` (line 26: "Legacy flag, keeps working"), `bin/install.js` (lines 602, 740, 754: "Remove old" comments)
- Impact: Code bloat, maintenance overhead for unused features. Unclear when safe to remove.
- Fix approach: Deprecation policy with version timeline. Mark legacy features in v1.x, warn in v2.0, remove in v3.0. Document breaking changes clearly.

## Known Bugs

**Claude Code classifyHandoffIfNeeded bug:**
- Symptoms: Agents report success but Claude Code marks them as failed, killing workflow
- Files: `hive/workflows/execute-phase.md` (line 34 comment), `hive/workflows/quick.md`
- Trigger: Intermittent, appears to be Claude Code platform issue not Hive code
- Workaround: Workflows now "spot-check actual output before reporting failure" - verifies agent actually completed by checking disk artifacts
- Fix: Upstream Claude Code bug, Hive implements defensive detection

**Windows path handling:**
- Symptoms: Backslash paths cause hive-tools invocation failures on Windows
- Files: `hive/bin/hive-tools.js` (fixed in v1.16.0 per CHANGELOG)
- Trigger: Windows file system paths in bash command construction
- Workaround: "Normalized backslash paths in hive-tools invocations" (contributed by @rmindel)
- Status: Fixed but indicates platform compatibility is fragile

**JSONC parsing failures:**
- Symptoms: Installer deletes opencode.json on parse errors (comments, trailing commas, BOM)
- Files: `bin/install.js`
- Trigger: OpenCode config files with comments or non-standard JSON
- Workaround: Fixed in v1.14.0 - now handles comments, trailing commas, BOM correctly
- Status: Fixed but pattern suggests installer is brittle with malformed configs

## Security Considerations

**Secret detection in map-codebase:**
- Risk: Codebase mapper could read and commit API keys, credentials, tokens to .planning/codebase files
- Files: `hive/workflows/map-codebase.md` (lines 304-327), `agents/hive-codebase-mapper.md` (forbidden_files section)
- Current mitigation: Secret detection regex checks output before commit, forbidden file list prevents reading .env files, explicit instructions to never quote secret values
- Recommendations: Add pre-commit hook to scan .planning/codebase/ for common secret patterns. Consider using dedicated secret scanner library instead of regex. Enforce secret detection in CI.

**Synchronous git operations with shell interpolation:**
- Risk: Shell command construction with user input could enable command injection
- Files: `hive/bin/hive-tools.js` (line 228), 187 sync operations throughout
- Current mitigation: Input escaping with regex for paths
- Recommendations: Migrate to async child_process with full argument array (no shell interpolation). Use dedicated git library instead of shell commands.

**Unrestricted file system access:**
- Risk: Agents have broad file system read access via Read, Bash, Grep, Glob tools. Could leak sensitive files if agent hallucinates or is prompt-injected.
- Files: All agent definitions in `agents/` directory
- Current mitigation: Tool restrictions per agent type (verifiers are read-only, executors cannot access WebSearch). Forbidden file list in codebase-mapper.
- Recommendations: Implement agent sandboxing with explicit allow-lists for file access. Consider chroot-like restrictions for execution agents.

**Brave Search API key exposure:**
- Risk: If websearch enabled, BRAVE_API_KEY stored in config.json or env could be logged or committed
- Files: `hive/bin/hive-tools.js` (websearch command reads BRAVE_API_KEY from config or env)
- Current mitigation: Config.json not documented to store API keys (expects env var)
- Recommendations: Explicit documentation that API keys must be in env vars, never in config files. Add config.json to .gitignore templates.

## Performance Bottlenecks

**Sequential revision loops:**
- Problem: Planning revision cycle spawns planner → checker → planner → checker sequentially (4-6 spawns for complex plans)
- Files: `hive/workflows/plan-phase.md`, `agents/hive-planner.md`, `agents/hive-plan-checker.md`
- Cause: Agent death after each step requires context reconstruction from disk for next spawn
- Improvement path: Agent Teams "Live Dialogue" pattern (P0.2 implementation) reduces to 2 persistent teammates - implemented but unclear if enabled by default. Verify config adoption.

**Wave-based execution blocking:**
- Problem: Execute-phase uses wave-based parallelization - entire wave must complete before next wave starts, even if later plans have satisfied dependencies
- Files: `hive/workflows/execute-phase.md`
- Cause: Conservative dependency resolution, max 3 concurrent agents limit
- Improvement path: "Dynamic Wave Scheduling" (P1.3 implementation) with ready queue and dependency-based scheduling. Implemented but gated behind config flag set to false by default. Enable and measure impact.

**Large file synchronous reads:**
- Problem: hive-tools.js uses synchronous file operations for large files like ROADMAP.md, STATE.md, SUMMARY.md
- Files: `hive/bin/hive-tools.js` (187 sync operations)
- Cause: CLI utility runs synchronously, simpler error handling
- Improvement path: For files >100KB, migrate to async streaming reads. Profile actual file sizes in typical projects - may not be bottleneck in practice.

**Grep pattern complexity:**
- Problem: Some workflows use complex regex patterns with grep that may be slow on large codebases
- Files: `hive/workflows/map-codebase.md` (line 304: 10-alternative secret detection regex)
- Cause: Comprehensive pattern matching for security
- Improvement path: Pre-filter files by extension/size before regex scanning. Use faster compiled regex libraries for hot paths.

## Fragile Areas

**Codebase mapper documentation (current session):**
- Files: `.planning/codebase/*.md` (7 documents: STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS)
- Why fragile: If mapper writes vague descriptions ("UserService handles users") instead of file paths, downstream agents cannot navigate. No validation that documents are useful.
- Safe modification: Implement document quality scoring - verify file paths exist, check specificity of guidance, measure token efficiency
- Test coverage: None - no tests verify codebase documents are actionable

**Template consistency:**
- Files: `hive/templates/*.md` (34 templates)
- Why fragile: Templates are the source of truth for document structure. Inconsistent templates → inconsistent documents → parser failures
- Safe modification: Template schema validation. Pre-commit hook to verify all templates follow standard structure. Version templates with migration paths.
- Test coverage: Limited - no template validation tests detected

**Multi-runtime divergence risk:**
- Files: `bin/install.js` (handles 3 runtimes), command structure differs (flat for OpenCode, nested for Claude)
- Why fragile: Changes to Claude Code version may break OpenCode/Gemini. No automated testing across all three runtimes.
- Safe modification: Establish CI testing matrix (Claude/OpenCode/Gemini × Mac/Windows/Linux). Maintain runtime compatibility table.
- Test coverage: Manual only - no automated multi-runtime tests

## Scaling Limits

**Max 3 concurrent agents:**
- Current capacity: Hardcoded to 3 in `hive/templates/config.json`
- Limit: For phases with 10+ plans, only 3 execute concurrently. Wave 1: 3 plans, Wave 2: 3 plans, Wave 3: 3 plans, Wave 4: 1 plan = 4 serial rounds
- Scaling path: Make max_concurrent_agents configurable per user. Allow scaling to 5-10 for power users with fast machines. Measure actual impact on execution time vs context switch overhead.

**File-based state machine:**
- Current capacity: All state in `.planning/` directory as markdown files. Works well for single-digit phases and plans.
- Limit: For projects with 100+ phases, linear file scanning becomes slow. Roadmap parsing uses regex on entire ROADMAP.md file.
- Scaling path: Add optional database mode for large projects (SQLite). Keep markdown as source of truth, sync to DB for fast queries. Use hive-tools phase-plan-index for structured indexing.

**Monorepo support:**
- Current capacity: Assumes single project in repository root
- Limit: Monorepos with multiple projects would create conflicting `.planning/` directories
- Scaling path: Support `.planning/<project-name>/` namespacing. Detect monorepo structure, prompt for project selection. Update all file paths to be project-aware.

## Dependencies at Risk

**Zero runtime dependencies (by design):**
- Risk: None for runtime, but limits functionality. No proper git library, JSON parsing, secret detection, etc.
- Impact: More code to maintain, reinventing wheels (git commands via shell, manual JSON parsing, regex for secrets)
- Migration plan: Acceptable trade-off for simplicity. If complexity grows, consider minimal deps (simple-git, dotenv, glob). Monitor if lack of deps causes security issues.

**esbuild (devDependency):**
- Risk: Very stable, widely used. Low risk.
- Impact: Build step would break if esbuild changes API, but hooks are simple (just copy, no actual bundling)
- Status: Acceptable

**Node.js version requirement:**
- Current state: `"engines": { "node": ">=16.7.0" }`
- Risk: Node 16 reaches EOL 2023-09-11 (already past). Users on older Node may have security vulnerabilities.
- Impact: Should bump to Node 18 LTS minimum (EOL 2025-04-30) or Node 20 LTS (EOL 2026-04-30)
- Migration plan: Test on Node 18+, update engines field, document in CHANGELOG as breaking change for v2.0

## Missing Critical Features

**No rollback mechanism:**
- Problem: If execution fails mid-phase, no way to cleanly undo partial changes. State in `.planning/` may be inconsistent.
- Blocks: Recovery from failed executions requires manual cleanup
- Priority: High - users report state corruption after crashes

**No execution dry-run mode:**
- Problem: Cannot preview what execute-phase will do without actually executing
- Blocks: Risky to run execute-phase on production codebases without confidence
- Priority: Medium - power users want plan preview before execution

**No agent performance telemetry:**
- Problem: Unknown which agents are slow, token-heavy, or fail frequently. No visibility into team vs standalone performance.
- Blocks: Data-driven optimization of agent prompts and team mode adoption
- Priority: Low - system works, but optimization is guesswork

**No multi-user collaboration:**
- Problem: Single `.planning/` state assumes one user. No support for multiple developers working on same Hive project.
- Blocks: Team adoption of Hive workflow
- Priority: Low - primarily solo-developer tool by design

## Test Coverage Gaps

**Workflow integration tests:**
- What's not tested: End-to-end workflow execution (new-project → plan-phase → execute-phase → verify-work). Only hive-tools.js has unit tests (93 tests).
- Files: All workflows in `hive/workflows/` (30 files, zero test coverage)
- Risk: Breaking changes to workflows only caught manually. Refactoring is risky.
- Priority: High - core functionality has no automated verification

**Multi-runtime compatibility:**
- What's not tested: OpenCode and Gemini installations. No CI testing matrix.
- Files: `bin/install.js`, all command/workflow files
- Risk: Claude Code changes could break, OpenCode/Gemini support may silently regress
- Priority: Medium - community reports issues after release

**Windows platform testing:**
- What's not tested: Automated Windows testing. Fixes contributed by community (CHANGELOG line 63: "contributed by @rmindel").
- Files: All bash command generation, path handling
- Risk: Path separators, shell differences, Git bash vs PowerShell issues
- Priority: Medium - significant user base on Windows

**Agent Team mode coverage:**
- What's not tested: Team mode paths added in recent implementation (P0-P3, 15 files modified). Only standalone mode has implicit testing via usage.
- Files: `hive/workflows/execute-phase.md`, `hive/workflows/plan-phase.md`, plus 13 others with team mode
- Risk: Team mode may be broken and unused. No way to know which code path is active without telemetry.
- Priority: Medium - recent addition, unclear if working as intended

**Secret detection validation:**
- What's not tested: Verification that secret regex patterns actually catch all common API key formats. Validation that forbidden file list is comprehensive.
- Files: `hive/workflows/map-codebase.md` (line 304), `agents/hive-codebase-mapper.md` (forbidden_files)
- Risk: False negatives (secrets leak through) or false positives (legitimate code blocked)
- Priority: High - security-critical feature with no test coverage

**Error recovery paths:**
- What's not tested: Behavior when agents crash, git commands fail, files are corrupted, disk is full, network is down
- Files: All workflows and agents
- Risk: Unknown failure modes. Users report "state corruption" but no systematic error handling tests.
- Priority: Medium - reliability concern for production use

---

*Concerns audit: 2026-02-11*
