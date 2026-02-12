# Coding Conventions

**Analysis Date:** 2026-02-11

## Naming Patterns

**Files:**
- JavaScript executables: `kebab-case.js` (e.g., `hive-tools.js`, `build-hooks.js`)
- Test files: `{source-name}.test.js` (co-located with source, e.g., `hive-tools.test.js`)
- Markdown workflows/docs: `kebab-case.md` (e.g., `execute-phase.md`, `plan-phase.md`)
- Hooks: `hive-{purpose}.js` (e.g., `hive-statusline.js`, `hive-check-update.js`)

**Functions:**
- camelCase for standard functions: `parseIncludeFlag()`, `safeReadFile()`, `loadConfig()`
- camelCase for helpers: `getGlobalDir()`, `getDirName()`, `expandTilde()`

**Variables:**
- SCREAMING_SNAKE_CASE for constants and CLI parsing: `MODEL_PROFILES`, `INIT`, `PHASE_INFO`
- camelCase for local variables: `configPath`, `defaults`, `tmpDir`
- Descriptive names over abbreviations: `currentTimestamp` not `ts`, `phaseDirectory` not `phaseDir`

**Constants:**
- Object constants in SCREAMING_SNAKE_CASE: `MODEL_PROFILES`, `defaults`
- Inline constants use camelCase: `configDirIndex`, `includeIndex`

## Code Style

**Formatting:**
- No automated formatter detected (no `.prettierrc`, `.eslintrc`)
- Manual 2-space indentation observed in all JavaScript files
- Single quotes for strings: `'utf-8'`, `'planning'`
- Template literals for interpolation: `` `${phase}-${slug}` ``
- Line length: ~120-140 characters (no hard limit enforced)

**Linting:**
- No ESLint or other linter configuration found
- Code follows standard JavaScript conventions without automated enforcement

**Whitespace:**
- Blank lines separate logical blocks
- No trailing whitespace
- Single blank line between function definitions

## Import Organization

**Order:**
1. Node.js built-ins: `fs`, `path`, `os`, `child_process`
2. Package imports (minimal - zero runtime dependencies)
3. Local requires: `require('../package.json')`

**Path Resolution:**
- Absolute paths via `path.join()` for cross-platform compatibility
- Home directory via `os.homedir()` not `~`
- Use `path.join()` not string concatenation: `path.join(dir, 'file')` not `dir + '/file'`

**No Path Aliases:**
- All requires use relative paths: `require('../package.json')`
- No module aliasing configured

## Error Handling

**Patterns:**
- Try-catch blocks with silent failures for optional features:
  ```javascript
  try {
    const data = JSON.parse(input);
    // ... process
  } catch (e) {
    // Silent fail - don't break core functionality
  }
  ```
- Safe file reads with null fallback:
  ```javascript
  function safeReadFile(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
  ```
- Process exits with code 1 for fatal errors: `process.exit(1)`
- Return error objects in JSON for CLI tools:
  ```javascript
  { error: 'File not found' }
  ```

**Validation:**
- Early returns for missing required data
- Null checks before accessing properties: `data.model?.display_name`
- Explicit undefined checks: `if (value !== undefined)`

## Logging

**Framework:** Native `console` and `process.stdout`

**Patterns:**
- CLI output via `console.log()` for user-facing messages
- Structured JSON output for machine-readable results
- ANSI color codes for terminal formatting:
  ```javascript
  const cyan = '\x1b[36m';
  const reset = '\x1b[0m';
  console.log(`${cyan}Message${reset}`);
  ```
- Silent failures for non-critical operations (statusline, cache reads)
- No verbose/debug logging infrastructure

**Statusline:**
- Custom statusline via `process.stdout.write()` for real-time updates
- No trailing newline for statusline output

## Comments

**When to Comment:**
- File headers with purpose and usage examples (extensive in `hive-tools.js`)
- Section separators using ASCII art:
  ```javascript
  // ─── Model Profile Table ────────────────────────────────────
  ```
- Non-obvious logic (especially in statusline calculations)
- Algorithm explanations (context window scaling)

**JSDoc/TSDoc:**
- Not used systematically
- Inline comments preferred over JSDoc blocks
- Function purposes documented in header comments when complex

**Style:**
- Single-line comments: `// Comment`
- Multi-line blocks for headers:
  ```javascript
  /**
   * Hive Tools — CLI utility for Hive workflow operations
   * ...
   */
  ```

## Function Design

**Size:**
- Helper functions: 5-20 lines (e.g., `safeReadFile`, `parseIncludeFlag`)
- CLI command handlers: 20-100 lines
- Test cases: 10-40 lines per test
- Main entry points can be longer (100-200 lines for coordination)

**Parameters:**
- Positional for required: `loadConfig(cwd)`
- Named options objects not used - rely on positional + flags parsed from `process.argv`
- Default parameters: `function getGlobalDir(runtime, explicitDir = null)`

**Return Values:**
- JSON objects for CLI tools: `{ success: true, output: '...' }`
- Primitive types for helpers: strings, booleans, null
- Exit process for terminal errors (CLI context)

**Single Responsibility:**
- Each function does one thing well
- Helper functions are pure when possible (no side effects)
- CLI handlers coordinate calls, don't implement logic

## Module Design

**Exports:**
- No explicit exports in CLI entry points (use `#!/usr/bin/env node`)
- CommonJS `require()` not ES6 `import`
- No package exports (zero runtime dependencies)

**Barrel Files:**
- Not used
- Direct file requires: `require('../package.json')`

**File Organization:**
- Monolithic CLI utilities (e.g., `hive-tools.js` at 162KB)
- Test files co-located with source: `hive-tools.test.js` next to `hive-tools.js`
- Hooks in dedicated `hooks/` directory

## Markdown Conventions

**Workflows:**
- XML-style tags for structure: `<purpose>`, `<process>`, `<step>`
- Attributes: `<step name="initialize" priority="first">`
- Code blocks with language hints: ` ```bash `, ` ```javascript `
- Critical sections: `**CRITICAL:**` prefix for important notes

**Templates:**
- Placeholder syntax: `[YYYY-MM-DD]`, `{phase_number}`, `${VARIABLE}`
- Frontmatter in YAML format (triple-dash delimiters)
- Markdown tables for structured data

## Configuration

**Format:**
- JSON for configuration files: `.planning/config.json`
- No YAML, TOML, or other formats

**Defaults:**
- Defined inline with fallbacks:
  ```javascript
  const defaults = {
    model_profile: 'balanced',
    commit_docs: true,
    // ...
  };
  ```
- Merge strategy: user config overrides defaults
- Support for nested config keys: `config.git.branching_strategy`

## Testing Patterns (Preview)

**Framework:** Node.js built-in test runner (`node:test`)

**Assertions:** Node.js built-in `assert` module

**Structure:**
- `describe()` blocks for grouping related tests
- `beforeEach()` / `afterEach()` for setup/teardown
- `test()` for individual test cases

---

*Convention analysis: 2026-02-11*
