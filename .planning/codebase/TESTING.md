# Testing Patterns

**Analysis Date:** 2026-02-11

## Test Framework

**Runner:**
- Node.js built-in test runner (introduced Node 16.7.0+)
- No external test framework dependencies (Jest, Mocha, Vitest)
- Config: None required (uses native Node.js test API)

**Assertion Library:**
- Node.js built-in `assert` module
- Methods used: `assert.ok()`, `assert.strictEqual()`, `assert.deepStrictEqual()`

**Run Commands:**
```bash
npm test                   # Run all tests via package.json script
node --test hive/bin/hive-tools.test.js  # Direct test execution
```

**Coverage:**
- Not configured (no coverage reporting setup)

## Test File Organization

**Location:**
- Co-located with source files (same directory as implementation)
- Example: `hive/bin/hive-tools.test.js` next to `hive/bin/hive-tools.js`
- Mirrored in `.claude/hive/bin/hive-tools.test.js` (installation copy)

**Naming:**
- Pattern: `{source-name}.test.js`
- Examples: `hive-tools.test.js`

**Structure:**
```
hive/
├── bin/
│   ├── hive-tools.js
│   └── hive-tools.test.js
```

## Test Structure

**Suite Organization:**
```javascript
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('command-name command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('describes expected behavior', () => {
    // Arrange
    const input = setupTestData();

    // Act
    const result = runCommand(input);

    // Assert
    assert.ok(result.success, 'Command should succeed');
    assert.strictEqual(result.value, expected);
  });
});
```

**Patterns:**
- One `describe()` block per CLI command
- `beforeEach()` creates fresh temporary directory structure
- `afterEach()` cleans up temp directories
- Tests are independent (no shared state between tests)
- Descriptive test names: `'extracts single plan with frontmatter'`

**Grouping:**
- Tests grouped by CLI command/feature
- Multiple test cases per describe block (5-15 tests typical)
- Sequential test execution (no parallel test runs)

## Mocking

**Framework:** None (using real filesystem operations)

**Patterns:**
- **Real filesystem I/O** via Node.js `fs` module
- **Temporary directories** via `fs.mkdtempSync()`:
  ```javascript
  function createTempProject() {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hive-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
    return tmpDir;
  }
  ```
- **Real command execution** via `child_process.execSync()` (test harness only)

**What to Mock:**
- Nothing is mocked - tests use real implementations
- Isolation via temporary directories (each test gets clean filesystem state)

**What NOT to Mock:**
- Filesystem operations (use temp dirs instead)
- Child processes (test actual CLI behavior)
- JSON parsing/file I/O (test real data flow)

## Fixtures and Factories

**Test Data:**
```javascript
// Create test files inline
fs.writeFileSync(
  path.join(phaseDir, '01-01-PLAN.md'),
  `---
wave: 1
autonomous: true
objective: Set up database schema
---

## Task 1: Create schema
## Task 2: Generate client
`
);

// Create roadmap with specific content
fs.writeFileSync(
  path.join(tmpDir, '.planning', 'ROADMAP.md'),
  `# Roadmap v1.0

### Phase 1: Foundation
**Goal:** Set up project infrastructure
`
);
```

**Location:**
- No dedicated fixtures directory
- Test data created inline within each test case
- Helper functions for common setup patterns (e.g., `createTempProject()`)

**Factory Pattern:**
```javascript
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hive-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
```

## Coverage

**Requirements:** None enforced

**Current Coverage:**
- Primary coverage: `hive-tools.js` CLI commands
- Tests cover: 20+ commands across state management, phase operations, roadmap analysis
- Untested: `install.js`, `build-hooks.js`, hooks (`hive-statusline.js`, `hive-check-update.js`)

**View Coverage:**
- Not configured (no coverage tooling)

## Test Types

**Unit Tests:**
- Scope: Individual CLI command behavior
- Approach: Execute command, verify JSON output structure and values
- Example: Testing `state-snapshot` command extracts correct STATE.md fields

**Integration Tests:**
- Scope: Multi-step workflows (create phase → add plan → complete phase)
- Approach: Sequential commands on shared temp directory, verify filesystem changes
- Example: `phase remove` renumbers subsequent phases and updates ROADMAP.md

**E2E Tests:**
- Not present (no end-to-end test suite)
- Manual testing via actual CLI usage

## Common Patterns

**Async Testing:**
- Not needed (all tests are synchronous)
- File I/O uses sync methods: `fs.readFileSync()`, `fs.writeFileSync()`
- CLI execution blocks until complete

**Error Testing:**
```javascript
test('rejects removal of phase with summaries unless --force', () => {
  // Setup phase with completed work
  fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');

  // Should fail without --force
  const result = runGsdTools('phase remove 1', tmpDir);
  assert.ok(!result.success, 'should fail without --force');
  assert.ok(result.error.includes('executed plan'), 'error mentions executed plans');

  // Should succeed with --force
  const forceResult = runGsdTools('phase remove 1 --force', tmpDir);
  assert.ok(forceResult.success, `Force remove failed: ${forceResult.error}`);
});
```

**JSON Parsing:**
```javascript
test('extracts basic fields from STATE.md', () => {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'STATE.md'),
    `# Project State\n\n**Current Phase:** 03\n**Status:** In progress\n`
  );

  const result = runGsdTools('state-snapshot', tmpDir);
  assert.ok(result.success, `Command failed: ${result.error}`);

  const output = JSON.parse(result.output);
  assert.strictEqual(output.current_phase, '03', 'current phase extracted');
  assert.strictEqual(output.status, 'In progress', 'status extracted');
});
```

**File System Assertions:**
```javascript
test('creates phase directory', () => {
  const result = runGsdTools('scaffold phase-dir --phase 5 --name User Dashboard', tmpDir);
  assert.ok(result.success, `Command failed: ${result.error}`);

  const output = JSON.parse(result.output);
  assert.strictEqual(output.created, true);
  assert.ok(
    fs.existsSync(path.join(tmpDir, '.planning', 'phases', '05-user-dashboard')),
    'directory should be created'
  );
});
```

**Frontmatter Parsing:**
```javascript
test('extracts nested frontmatter fields', () => {
  fs.writeFileSync(
    path.join(phaseDir, '01-01-SUMMARY.md'),
    `---
phase: "01"
dependency-graph:
  provides:
    - "Database schema"
tech-stack:
  added:
    - "prisma"
---
# Summary
`
  );

  const result = runGsdTools('history-digest', tmpDir);
  const digest = JSON.parse(result.output);

  assert.deepStrictEqual(
    digest.phases['01'].provides,
    ['Database schema'],
    'nested provides extracted'
  );
  assert.deepStrictEqual(
    digest.tech_stack,
    ['prisma'],
    'tech stack flattened correctly'
  );
});
```

## Test Naming Conventions

**Describe Blocks:**
- Format: `'{command-name} command'`
- Examples: `'history-digest command'`, `'phase remove command'`

**Test Cases:**
- Descriptive sentences (no "should" prefix)
- Focus on behavior: `'extracts basic fields from STATE.md'`
- Include failure cases: `'missing ROADMAP.md returns error'`
- Edge cases explicit: `'handles decimal phase numbers'`, `'handles gaps in phase numbering'`

## Assertion Style

**Primary Methods:**
- `assert.ok(condition, message)` - Boolean assertions
- `assert.strictEqual(actual, expected, message)` - Primitive equality
- `assert.deepStrictEqual(actual, expected, message)` - Object/array equality

**Message Pattern:**
- Always include descriptive failure messages
- Format: `'should {expected behavior}'` or `'{field} should be {value}'`
- Examples:
  ```javascript
  assert.ok(result.success, `Command failed: ${result.error}`);
  assert.strictEqual(output.phase, '03', 'phase number correct');
  assert.deepStrictEqual(output.plans, [], 'plans should be empty');
  ```

## Setup and Teardown

**Lifecycle Hooks:**
```javascript
describe('command tests', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Tests share setup/teardown but operate on isolated state
});
```

**Pattern:**
- Create fresh temp directory before each test
- Clean up (delete) temp directory after each test
- No shared state between tests (full isolation)

## Test Data Strategies

**Inline Creation:**
- Most common: create test files inline within test case
- Keeps test self-contained and readable
- Example: Writing markdown with embedded YAML frontmatter

**Minimal Data:**
- Create only the data needed for specific test
- Don't create complete project structures unless testing integration

**Edge Cases:**
- Explicitly test malformed inputs:
  ```javascript
  test('malformed SUMMARY.md skipped gracefully', () => {
    fs.writeFileSync(path.join(phaseDir, '01-02-SUMMARY.md'), '# Just a heading\nNo frontmatter');

    const result = runGsdTools('history-digest', tmpDir);
    assert.ok(result.success, 'should succeed despite malformed files');
  });
  ```

---

*Testing analysis: 2026-02-11*
