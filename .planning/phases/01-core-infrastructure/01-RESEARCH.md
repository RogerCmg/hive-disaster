# Phase 1: Core Infrastructure - Research

**Researched:** 2026-02-11
**Domain:** JSONL telemetry storage, CLI command extension, config management in Node.js (zero-dep)
**Confidence:** HIGH

## Summary

Phase 1 builds the telemetry backbone for Hive Recall: a JSONL-based event storage engine, five CLI subcommands under `hive-tools.js telemetry`, file rotation, and a config section. This is entirely an extension of existing patterns in `hive-tools.js` (4597 lines, monolithic CLI with switch-based routing). No new files need to be created beyond what gets generated at runtime (`.planning/telemetry/events.jsonl`, `.planning/telemetry/INSIGHTS.md`). All code lives in `hive/bin/hive-tools.js` plus a config template update.

The codebase already has established patterns for every operation this phase requires: subcommand dispatch (see `state`, `verify`, `frontmatter` command groups), config loading/merging (`loadConfig()`, `cmdConfigEnsureSection()`), file I/O (`safeReadFile()`, `fs.appendFileSync`), JSON output (`output()` helper), and testing (`node:test` with temp directories). The research confirms that all 10 requirements (INFRA-01 through INFRA-10) can be implemented using Node.js stdlib only (`fs`, `path`, `os`), consistent with the zero-dependency philosophy.

**Primary recommendation:** Add a `telemetry` case to the CLI router's main switch statement, with subcommands `emit`, `query`, `digest`, `rotate`, `stats`. Follow the exact dispatch pattern used by `state`, `verify`, and `frontmatter` command groups. All functions go in the existing monolith. Estimated scope: ~300 lines of new JS code, following existing conventions exactly.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` | stdlib | File read/write/append/rename/stat | Zero-dep requirement; already used throughout hive-tools.js |
| Node.js `path` | stdlib | Path construction | Already used for all path operations |
| Node.js `os` | stdlib | Home directory resolution, temp dirs | Already used in config and hooks |
| Node.js `node:test` | stdlib (>=16.7.0) | Unit testing | Already used for hive-tools.test.js |
| Node.js `node:assert` | stdlib | Test assertions | Already used in test suite |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `JSON.parse()` / `JSON.stringify()` | native | JSONL line parsing/serialization | Every event read/write operation |
| `fs.appendFileSync()` | stdlib | Append event lines | Every emit call |
| `fs.readFileSync()` | stdlib | Read events for query/digest | Query, stats, digest commands |
| `fs.renameSync()` | stdlib | Archive rotation | Rotate command |
| `fs.statSync()` | stdlib | File size check | Auto-rotation trigger |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSONL flat file | SQLite | Previous intel system (v1.9.2) removed for 21MB SQLite dep; JSONL is the explicit project decision |
| `appendFileSync` | Write queue / stream | Unnecessary for CLI tool; each emit is a single synchronous call from one process at a time |
| Custom date parsing | `dayjs` / `date-fns` | Zero-dep requirement; native `Date` and simple regex suffice for `--since` duration parsing |

**Installation:**
```bash
# No installation needed — zero runtime dependencies, all Node.js stdlib
```

## Architecture Patterns

### Recommended Project Structure
```
hive/bin/hive-tools.js              # All telemetry functions added here (monolith pattern)
hive/bin/hive-tools.test.js         # All telemetry tests added here
hive/templates/config.json          # Add telemetry section to default config template
.planning/config.json               # User's config (telemetry section added at runtime)
.planning/telemetry/                # Created on first emit (runtime-generated)
  events.jsonl                      # Append-only event store
  events-{ISO-timestamp}.jsonl      # Archived rotated files
  INSIGHTS.md                       # Human-readable digest (committed to git)
.gitignore                          # Add events*.jsonl pattern
```

### Pattern 1: Subcommand Dispatch (existing pattern to follow)
**What:** Top-level command with nested subcommand routing via if/else chain
**When to use:** When adding a new command group with multiple operations
**Example:**
```javascript
// Source: hive-tools.js line 4227-4287 (state command group pattern)
case 'telemetry': {
  const subcommand = args[1];
  if (subcommand === 'emit') {
    const type = args[2];
    const dataIdx = args.indexOf('--data');
    const data = dataIdx !== -1 ? args[dataIdx + 1] : null;
    cmdTelemetryEmit(cwd, type, data, raw);
  } else if (subcommand === 'query') {
    const typeIdx = args.indexOf('--type');
    const sinceIdx = args.indexOf('--since');
    const limitIdx = args.indexOf('--limit');
    cmdTelemetryQuery(cwd, {
      type: typeIdx !== -1 ? args[typeIdx + 1] : null,
      since: sinceIdx !== -1 ? args[sinceIdx + 1] : null,
      limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 50,
    }, raw);
  } else if (subcommand === 'digest') {
    cmdTelemetryDigest(cwd, raw);
  } else if (subcommand === 'rotate') {
    cmdTelemetryRotate(cwd, raw);
  } else if (subcommand === 'stats') {
    cmdTelemetryStats(cwd, raw);
  } else {
    error('Unknown telemetry subcommand. Available: emit, query, digest, rotate, stats');
  }
  break;
}
```

### Pattern 2: Event Envelope (INFRA-02)
**What:** Common wrapper for all telemetry events with required fields
**When to use:** Every event emission
**Example:**
```javascript
// Source: SELF-IMPROVEMENT-PROPOSAL.md section 3.1
function createEventEnvelope(type, data, session) {
  return {
    ts: new Date().toISOString(),
    session: session || process.env.CLAUDE_SESSION_ID || 'unknown',
    type,
    v: 1,
    data: data || {},
  };
}
```

### Pattern 3: Config-Gated Operation (INFRA-10)
**What:** Check telemetry.enabled before performing any emit
**When to use:** Every emit call, to respect user's telemetry toggle
**Example:**
```javascript
// Source: hive-tools.js loadConfig() pattern (line 157-208)
function getTelemetryConfig(cwd) {
  const configPath = path.join(cwd, '.planning', 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      enabled: config.telemetry?.enabled !== false, // default: true
      hooks: config.telemetry?.hooks !== false,
      workflow_events: config.telemetry?.workflow_events !== false,
      transcript_analysis: config.telemetry?.transcript_analysis || false,
      rotation_threshold_kb: config.telemetry?.rotation_threshold_kb || 500,
      max_archives: config.telemetry?.max_archives || 10,
    };
  } catch {
    return { enabled: true, hooks: true, workflow_events: true,
             transcript_analysis: false, rotation_threshold_kb: 500, max_archives: 10 };
  }
}
```

### Pattern 4: Duration String Parsing (for --since flag)
**What:** Parse human-readable duration strings like "7d", "24h", "30m"
**When to use:** `telemetry query --since` flag
**Example:**
```javascript
function parseSinceDuration(sinceStr) {
  if (!sinceStr) return null;
  const match = sinceStr.match(/^(\d+)([dhm])$/);
  if (!match) {
    // Try ISO date string
    const date = new Date(sinceStr);
    return isNaN(date.getTime()) ? null : date;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = Date.now();
  const msMap = { d: 86400000, h: 3600000, m: 60000 };
  return new Date(now - value * msMap[unit]);
}
```

### Pattern 5: File Rotation (INFRA-07, INFRA-09)
**What:** Archive events.jsonl when over threshold, keep max N archives
**When to use:** Explicit `rotate` command and auto-check on `emit`
**Example:**
```javascript
function rotateIfNeeded(telemetryDir, config) {
  const eventsFile = path.join(telemetryDir, 'events.jsonl');
  try {
    const stat = fs.statSync(eventsFile);
    if (stat.size < config.rotation_threshold_kb * 1024) return false;

    // Archive with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const archiveName = `events-${timestamp}.jsonl`;
    fs.renameSync(eventsFile, path.join(telemetryDir, archiveName));

    // Prune old archives
    const archives = fs.readdirSync(telemetryDir)
      .filter(f => f.startsWith('events-') && f.endsWith('.jsonl'))
      .sort();
    while (archives.length > config.max_archives) {
      fs.unlinkSync(path.join(telemetryDir, archives.shift()));
    }
    return true;
  } catch {
    return false;
  }
}
```

### Anti-Patterns to Avoid
- **Reading entire JSONL into memory for query:** For files approaching 500KB this is fine (well within memory limits), but always stream line-by-line with `split('\n')` rather than `JSON.parse()` on the whole file. The file is NOT valid JSON; it is newline-delimited JSON.
- **Using `writeFileSync` for appending:** Always use `appendFileSync` for the append-only log. `writeFileSync` would overwrite.
- **Creating telemetry dir in every function:** Extract `ensureTelemetryDir(cwd)` as a shared helper, similar to how `safeReadFile` is reused across commands.
- **Parsing `--data` JSON without try/catch:** The `--data` flag receives user-provided JSON. Always wrap `JSON.parse()` in try/catch and return a clear error message.
- **Forgetting the newline in appendFileSync:** Each JSONL line MUST end with `\n`. Use `JSON.stringify(event) + '\n'`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ISO timestamp generation | Custom date formatter | `new Date().toISOString()` | Native JS, handles timezone correctly |
| JSON serialization | Custom serializer | `JSON.stringify()` / `JSON.parse()` | Standard, handles edge cases |
| File path construction | String concatenation | `path.join()` | Cross-platform (Windows backslashes) |
| Directory creation | Manual mkdir chain | `fs.mkdirSync(dir, { recursive: true })` | Handles nested creation atomically |
| Config merging | Deep merge utility | Simple spread/fallback pattern | Existing pattern in loadConfig(), no deep nesting needed |

**Key insight:** This entire phase is an extension of existing patterns. Every operation maps to something already done in hive-tools.js. The risk is in diverging from established patterns, not in technical complexity.

## Common Pitfalls

### Pitfall 1: JSONL vs JSON confusion
**What goes wrong:** Treating `events.jsonl` as a single JSON document (array of objects) instead of newline-delimited independent JSON lines.
**Why it happens:** Developers familiar with JSON files expect `[{...}, {...}]` format.
**How to avoid:** Each line is independently parseable. Read with `content.split('\n').filter(Boolean).map(line => JSON.parse(line))`. Never wrap in array brackets.
**Warning signs:** Using `JSON.parse(entireFile)` without splitting first.

### Pitfall 2: Missing newline on append
**What goes wrong:** Events get concatenated on the same line, producing unparseable JSONL.
**Why it happens:** Forgetting the `+ '\n'` in `appendFileSync`.
**How to avoid:** Always append `JSON.stringify(event) + '\n'`. Add a test that verifies line count matches event count.
**Warning signs:** Query returning fewer events than expected.

### Pitfall 3: File stat race condition on rotation
**What goes wrong:** Check file size, another process appends, then rotate — losing the appended event.
**Why it happens:** Non-atomic check-and-rename pattern.
**How to avoid:** This is acceptable for this use case. Hooks and CLI commands run sequentially within a session. The window is negligible. Document this as a known limitation, not a bug.
**Warning signs:** N/A (theoretical, not practical in single-session CLI usage).

### Pitfall 4: Telemetry breaking workflow execution
**What goes wrong:** An error in telemetry code (disk full, permission denied, malformed JSON) crashes the workflow.
**Why it happens:** Missing try/catch in the emit path.
**How to avoid:** Every telemetry function called from hooks/workflows MUST be wrapped in try/catch. The `emit` command should return `{ success: false, error: ... }` on failure, never `process.exit(1)` when called from hooks. The CLI command itself can error normally.
**Warning signs:** Workflows failing with telemetry-related error messages.

### Pitfall 5: Config section not present in existing projects
**What goes wrong:** `config.telemetry` is `undefined` because existing projects created before Recall don't have the telemetry section.
**Why it happens:** The template update only affects new projects. Existing `config.json` files remain unchanged.
**How to avoid:** Always use defensive access: `config.telemetry?.enabled !== false` (treating undefined as enabled=true). The `getTelemetryConfig()` helper must handle missing section gracefully with sensible defaults.
**Warning signs:** `Cannot read property 'enabled' of undefined` errors.

### Pitfall 6: Digest command failing on empty/missing events file
**What goes wrong:** `telemetry digest` crashes when no events exist yet.
**Why it happens:** No events.jsonl file exists on first run before any emit calls.
**How to avoid:** Check for file existence before reading. Return empty/stub INSIGHTS.md with "No events recorded yet" message.
**Warning signs:** File not found errors from digest command.

### Pitfall 7: The --since flag accepting invalid input silently
**What goes wrong:** `--since invalid` silently returns all events instead of warning the user.
**Why it happens:** Duration parser returns null on invalid input, and null is treated as "no filter".
**How to avoid:** If `--since` is provided but cannot be parsed, return an error. Only treat absent flag as "no filter".
**Warning signs:** Users getting unfiltered results when they expected filtered ones.

## Code Examples

Verified patterns from the existing codebase:

### Emit Command (core of INFRA-01, INFRA-02, INFRA-04)
```javascript
// Pattern: follows cmdStateUpdate / cmdFrontmatterSet structure
const VALID_EVENT_TYPES = [
  'agent_completion', 'tool_error', 'deviation', 'checkpoint',
  'verification_gap', 'plan_revision', 'user_correction',
  'fallback', 'context_compaction', 'session_summary'
];

function cmdTelemetryEmit(cwd, type, dataStr, raw) {
  if (!type) { error('Event type required. Valid types: ' + VALID_EVENT_TYPES.join(', ')); }
  if (!VALID_EVENT_TYPES.includes(type)) {
    error('Invalid event type: ' + type + '. Valid: ' + VALID_EVENT_TYPES.join(', '));
  }

  // Check config
  const telConfig = getTelemetryConfig(cwd);
  if (!telConfig.enabled) {
    output({ emitted: false, reason: 'telemetry disabled' }, raw, 'disabled');
    return;
  }

  // Parse data
  let data = {};
  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch (e) {
      error('Invalid JSON in --data: ' + e.message);
    }
  }

  // Build envelope
  const event = {
    ts: new Date().toISOString(),
    session: process.env.CLAUDE_SESSION_ID || 'unknown',
    type,
    v: 1,
    data,
  };

  // Ensure directory
  const telemetryDir = path.join(cwd, '.planning', 'telemetry');
  fs.mkdirSync(telemetryDir, { recursive: true });

  // Append
  const eventsFile = path.join(telemetryDir, 'events.jsonl');
  fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');

  // Auto-rotate check
  rotateIfNeeded(telemetryDir, telConfig);

  output({ emitted: true, type, ts: event.ts }, raw, 'ok');
}
```

### Query Command (INFRA-05)
```javascript
// Pattern: read JSONL, filter, return JSON array
function cmdTelemetryQuery(cwd, options, raw) {
  const telemetryDir = path.join(cwd, '.planning', 'telemetry');
  const eventsFile = path.join(telemetryDir, 'events.jsonl');
  const content = safeReadFile(eventsFile);

  if (!content) {
    output({ events: [], total: 0 }, raw, 'No events');
    return;
  }

  let events = content.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  // Filter by type
  if (options.type) {
    events = events.filter(e => e.type === options.type);
  }

  // Filter by since
  if (options.since) {
    const sinceDate = parseSinceDuration(options.since);
    if (!sinceDate) { error('Invalid --since value: ' + options.since + '. Use: 7d, 24h, 30m, or ISO date'); }
    events = events.filter(e => new Date(e.ts) >= sinceDate);
  }

  // Apply limit (from end — most recent first)
  const limit = options.limit || 50;
  if (events.length > limit) {
    events = events.slice(-limit);
  }

  output({ events, total: events.length }, raw, events.map(e => JSON.stringify(e)).join('\n'));
}
```

### Stats Command (INFRA-08)
```javascript
// Pattern: aggregate counts from JSONL
function cmdTelemetryStats(cwd, raw) {
  const telemetryDir = path.join(cwd, '.planning', 'telemetry');
  const eventsFile = path.join(telemetryDir, 'events.jsonl');

  // File size
  let fileSize = 0;
  try {
    fileSize = fs.statSync(eventsFile).size;
  } catch { /* no file yet */ }

  // Count archives
  let archiveCount = 0;
  try {
    archiveCount = fs.readdirSync(telemetryDir)
      .filter(f => f.startsWith('events-') && f.endsWith('.jsonl')).length;
  } catch { /* no dir yet */ }

  // Event counts by type
  const content = safeReadFile(eventsFile);
  const typeCounts = {};
  let totalEvents = 0;
  if (content) {
    content.split('\n').filter(Boolean).forEach(line => {
      try {
        const event = JSON.parse(line);
        typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
        totalEvents++;
      } catch { /* skip malformed */ }
    });
  }

  output({
    total_events: totalEvents,
    file_size_bytes: fileSize,
    file_size_kb: Math.round(fileSize / 1024 * 10) / 10,
    archive_count: archiveCount,
    types: typeCounts,
  }, raw, `Events: ${totalEvents} | Size: ${Math.round(fileSize / 1024)}KB | Archives: ${archiveCount}`);
}
```

### Test Pattern (following existing test suite)
```javascript
// Source: hive-tools.test.js existing pattern (lines 1-100)
describe('telemetry emit command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create minimal config with telemetry enabled
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ telemetry: { enabled: true } })
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('emits valid JSONL event', () => {
    const result = runGsdTools(
      'telemetry emit agent_completion --data \'{"agent":"hive-executor","duration_ms":1500}\'',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const eventsFile = path.join(tmpDir, '.planning', 'telemetry', 'events.jsonl');
    assert.ok(fs.existsSync(eventsFile), 'events.jsonl should be created');

    const lines = fs.readFileSync(eventsFile, 'utf-8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, 'should have exactly one event');

    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.type, 'agent_completion', 'type should match');
    assert.ok(event.ts, 'should have timestamp');
    assert.strictEqual(event.v, 1, 'schema version should be 1');
    assert.strictEqual(event.data.agent, 'hive-executor', 'data payload preserved');
  });

  test('respects telemetry disabled config', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ telemetry: { enabled: false } })
    );

    const result = runGsdTools(
      'telemetry emit agent_completion --data \'{"agent":"test"}\'',
      tmpDir
    );
    assert.ok(result.success, 'should succeed silently');

    const eventsFile = path.join(tmpDir, '.planning', 'telemetry', 'events.jsonl');
    assert.ok(!fs.existsSync(eventsFile), 'no events file when disabled');
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SQLite-based intel system (v1.9.2) | Removed entirely | v1.10+ | 21MB dep eliminated; lesson learned: zero-dep is non-negotiable |
| No telemetry | JSONL-based Recall system | This phase | Lightweight observation without dependency cost |

**Deprecated/outdated:**
- **SQLite-based intel**: Removed in v1.10+. The new system must NOT reintroduce any database dependency. JSONL + `fs` is the explicit design decision.

## Open Questions

1. **Session ID source**
   - What we know: The proposal uses `process.env.CLAUDE_SESSION_ID` for the session field. Hooks receive `data.session_id` from Claude Code.
   - What's unclear: Whether `CLAUDE_SESSION_ID` is reliably available as an environment variable in CLI command context (vs. hook context where it comes via stdin JSON).
   - Recommendation: Use `process.env.CLAUDE_SESSION_ID || process.env.SESSION_ID || 'cli-' + Date.now()` as fallback chain. The session field is informational, not critical -- 'unknown' is acceptable for CLI-initiated events.

2. **Digest algorithm complexity**
   - What we know: INFRA-06 requires generating INSIGHTS.md with "agent performance tables and pattern summaries". The proposal shows a rich format with recurring patterns, agent scoreboard, and session trends.
   - What's unclear: How sophisticated the Phase 1 digest needs to be, given that Phase 4 (FEED-01) also specifies enhanced digest generation.
   - Recommendation: Phase 1 digest should be functional but simple: count events by type, calculate basic agent stats (count, avg duration if available), list recent deviations. Phase 4 will enhance this with pattern detection and trend analysis. Keep Phase 1 digest to ~50 lines of logic.

3. **Auto-rotation timing**
   - What we know: INFRA-09 says "System rotates events.jsonl automatically when exceeding 500KB". INFRA-07 says `rotate` is a manual command.
   - What's unclear: Whether auto-rotation should happen on every emit (adds a stat call per emit) or only periodically.
   - Recommendation: Check on every emit -- a single `fs.statSync` call is <0.1ms. This is the simplest approach and matches the proposal's design. The overhead is negligible for a CLI tool that runs at most a few times per session.

## Sources

### Primary (HIGH confidence)
- `hive/bin/hive-tools.js` (4597 lines) - All patterns verified by reading actual source code
- `hive/bin/hive-tools.test.js` - Test patterns verified from actual test file
- `hive/templates/config.json` - Current config template structure
- `.planning/SELF-IMPROVEMENT-PROPOSAL.md` - 713-line detailed design proposal with code examples
- `.planning/REQUIREMENTS.md` - INFRA-01 through INFRA-10 requirements
- `.planning/ROADMAP.md` - Phase 1 success criteria and plan breakdown
- `.planning/codebase/ARCHITECTURE.md` - System architecture patterns
- `.planning/codebase/CONVENTIONS.md` - Coding conventions (naming, style, error handling)
- `.planning/codebase/TESTING.md` - Testing patterns (node:test, temp dirs, assertion style)
- `.planning/codebase/STACK.md` - Technology stack (zero-dep philosophy)
- `.planning/codebase/STRUCTURE.md` - File organization and where to add new code

### Secondary (MEDIUM confidence)
- [Node.js fs documentation](https://nodejs.org/api/fs.html) - `appendFileSync`, `statSync`, `renameSync` behavior
- [JSONL format specification](https://jsonltools.com/jsonl-for-developers) - JSONL handling best practices

### Tertiary (LOW confidence)
- None. All findings verified against primary sources (actual codebase).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - This is pure Node.js stdlib, verified against existing codebase patterns
- Architecture: HIGH - All patterns observed directly in hive-tools.js source code (4597 lines read)
- Pitfalls: HIGH - Derived from actual code patterns and the proposal's explicit risk mitigations
- Code examples: HIGH - Based on real patterns from the codebase, adapted for telemetry domain

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable domain -- Node.js stdlib and JSONL are mature, unlikely to change)
