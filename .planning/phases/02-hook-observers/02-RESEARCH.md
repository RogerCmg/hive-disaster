# Phase 2: Hook Observers - Research

**Researched:** 2026-02-11
**Domain:** Claude Code hooks system, passive telemetry capture, Node.js stdin-driven event observers
**Confidence:** HIGH

## Summary

Phase 2 creates 4 hook observer scripts that passively capture agent lifecycle events into the JSONL telemetry store built in Phase 1. These hooks fire on Claude Code lifecycle events (SubagentStop, PostToolUseFailure, PreCompact, SessionStart, SessionEnd) and write structured events to `.planning/telemetry/events.jsonl` using the existing `createEventEnvelope` format and `appendFileSync` pattern.

The Claude Code hooks system is well-documented and the project already has 2 working hooks (`hive-check-update.js` and `hive-statusline.js`) that establish the exact patterns to follow: read JSON from stdin, process in try/catch, output results or fail silently. The official docs confirm all 5 required hook events exist with documented stdin JSON schemas. Each hook receives `session_id`, `transcript_path`, `cwd`, `permission_mode`, and `hook_event_name` as common fields, plus event-specific fields documented below.

The primary design challenge is HOOK-07 (filtering for Hive-specific events only). For SubagentStop, the `agent_type` field contains the agent name from frontmatter (e.g., `"hive-executor"`, `"hive-planner"`), so filtering on `agent_type.startsWith('hive-')` works. For PostToolUseFailure, there is no direct agent context in the hook input -- the hook receives `tool_name` and `tool_input` but not which agent triggered the tool. The recommended approach is to check if Hive is active by verifying `.planning/` directory exists (indicating a Hive project) rather than trying to filter per-tool-call by agent. A secondary concern: VALID_EVENT_TYPES needs `session_boundary` added (the proposal and roadmap reference it, but Phase 1 only included `session_summary`).

**Primary recommendation:** Create 4 standalone hook scripts in `hooks/` following the exact stdin-parsing pattern of `hive-check-update.js`. Each hook reads JSON from stdin, filters for Hive relevance, constructs an event envelope, and appends to events.jsonl via `fs.appendFileSync`. All wrapped in try/catch with empty catch. Register hooks in `.claude/settings.json`. Add `session_boundary` to VALID_EVENT_TYPES. Do NOT use `hive-tools.js telemetry emit` from hooks (avoid spawning child processes -- write directly to events.jsonl for speed and reliability).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` | stdlib | appendFileSync for event writing, mkdirSync for dir creation | Zero-dep; same pattern as existing hooks |
| Node.js `path` | stdlib | Cross-platform path construction | Same pattern as hive-check-update.js |
| Node.js `process.stdin` | stdlib | Reading hook input JSON from Claude Code | Required by hook contract |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `JSON.parse()` | native | Parse stdin JSON from Claude Code | Every hook invocation |
| `JSON.stringify()` | native | Serialize event envelope to JSONL line | Every event write |
| `fs.existsSync()` | stdlib | Check for `.planning/` to determine Hive project | HOOK-07 filtering in PostToolUseFailure |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct `appendFileSync` in hooks | Shell out to `hive-tools.js telemetry emit` | Slower (spawns child process), adds failure mode, violates proposal constraint "no spawned child processes" |
| Separate files per hook | Single monolithic hook file | Single file is harder to test, harder to register with matchers, harder to enable/disable individually |
| Async hooks (`"async": true`) | Synchronous hooks (default) | Async hooks cannot block execution but also cannot provide feedback; for write-only telemetry, async would work but adds complexity. Sync is fine since appendFileSync is <1ms |

**Installation:**
```bash
# No installation needed -- zero runtime dependencies, all Node.js stdlib
# Hook files are copied by the installer (Phase 5)
```

## Architecture Patterns

### Recommended Project Structure
```
hooks/
  hive-check-update.js       # Existing: update checker (SessionStart)
  hive-statusline.js         # Existing: statusline renderer
  hive-recall-agent.js       # NEW: SubagentStop observer (HOOK-01)
  hive-recall-error.js       # NEW: PostToolUseFailure observer (HOOK-02)
  hive-recall-compact.js     # NEW: PreCompact observer (HOOK-03)
  hive-recall-session.js     # NEW: SessionStart + SessionEnd observer (HOOK-04, HOOK-05)
  dist/                      # Built copies for installation
hive/bin/hive-tools.js       # MODIFIED: Add session_boundary to VALID_EVENT_TYPES
.claude/settings.json        # MODIFIED: Register new hooks
scripts/build-hooks.js       # MODIFIED: Add new hooks to HOOKS_TO_COPY
```

### Pattern 1: Hook Stdin Parser (the universal hook scaffold)
**What:** Every Claude Code command hook reads JSON from stdin, processes it, and exits
**When to use:** Every hook script
**Example:**
```javascript
// Source: hooks/hive-check-update.js (existing pattern) + official docs
#!/usr/bin/env node
// Hive Recall -- [Purpose] observer
// Hook: [EventName] | Fail-silent

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    // ... process event ...
  } catch (e) {
    // Fail silent -- observation never breaks execution
  }
});
```

### Pattern 2: Direct JSONL Append (not via hive-tools.js CLI)
**What:** Hooks write directly to events.jsonl using appendFileSync, not by spawning `hive-tools.js telemetry emit`
**When to use:** All telemetry hooks
**Why:** No child process overhead, no PATH dependency, single syscall (<1ms), matches proposal design constraint
**Example:**
```javascript
// Source: SELF-IMPROVEMENT-PROPOSAL.md Phase 2 design
const event = {
  ts: new Date().toISOString(),
  session: data.session_id || 'unknown',
  type: 'agent_completion',
  v: 1,
  data: {
    agent: data.agent_type,
    duration_ms: null, // Not available from SubagentStop input
    exit_code: 0,
  }
};

const telemetryDir = path.join(data.cwd, '.planning', 'telemetry');
fs.mkdirSync(telemetryDir, { recursive: true });
fs.appendFileSync(
  path.join(telemetryDir, 'events.jsonl'),
  JSON.stringify(event) + '\n'
);
```

### Pattern 3: Config-Gated Hook Execution
**What:** Before writing any telemetry, check if telemetry is enabled and hooks are enabled
**When to use:** Every hook, before the event write
**Example:**
```javascript
// Source: hive-tools.js getTelemetryConfig pattern
function isTelemetryEnabled(cwd) {
  try {
    const configPath = path.join(cwd, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.telemetry?.enabled === false) return false;
    if (config.telemetry?.hooks === false) return false;
    return true;
  } catch {
    return true; // Default: enabled (same as getTelemetryConfig)
  }
}
```

### Pattern 4: Hive-Specific Filtering (HOOK-07)
**What:** Only capture events from Hive agents/operations, ignore non-Hive activity
**When to use:** SubagentStop, PostToolUseFailure
**Example:**
```javascript
// SubagentStop: filter by agent_type prefix
const agentType = data.agent_type || '';
if (!agentType.startsWith('hive-')) return; // Not a Hive agent

// PostToolUseFailure: check for Hive project context
// The hook cannot know which agent triggered a tool failure, but it can
// check if this is a Hive-managed project by verifying .planning/ exists
const planningDir = path.join(data.cwd, '.planning');
if (!fs.existsSync(planningDir)) return; // Not a Hive project
```

### Pattern 5: Session Hook with Mode Argument
**What:** A single script handles both SessionStart and SessionEnd via a CLI argument
**When to use:** hive-recall-session.js
**Example:**
```javascript
// Source: SELF-IMPROVEMENT-PROPOSAL.md hook registration
// Registration in settings.json:
// "command": "node .claude/hooks/hive-recall-session.js start"
// "command": "node .claude/hooks/hive-recall-session.js end"

const mode = process.argv[2]; // 'start' or 'end'
```

### Anti-Patterns to Avoid
- **Spawning hive-tools.js from hooks:** Adds ~100ms startup time per hook fire, creates PATH dependency, adds failure mode. Write directly to events.jsonl.
- **Using process.stdout for hook output:** These are observation-only hooks. They should NOT return JSON output or decisions. Silent exit 0 is correct.
- **Blocking on config read failures:** If config.json is missing or corrupt, default to enabled=true. Never let a config error prevent the hook from completing.
- **Forgetting the newline:** `JSON.stringify(event) + '\n'` -- the `\n` is critical for JSONL format.
- **Using async/await or Promises in hooks:** The hooks read from stdin which is callback-based. Keep the entire flow synchronous after stdin is consumed. No reason for async here.
- **Reading process.env.CLAUDE_SESSION_ID in hooks:** Hooks receive `session_id` via stdin JSON. Do NOT use the environment variable -- use `data.session_id` from stdin.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event envelope format | Custom per-hook format | Match Phase 1 envelope: `{ts, session, type, v, data}` | Consistency with `createEventEnvelope()` output ensures query/digest commands work |
| Telemetry directory creation | Inline mkdirSync in each hook | Extract shared `ensureDir()` helper or inline `fs.mkdirSync(dir, { recursive: true })` | `{ recursive: true }` is idempotent, safe to call every time |
| Config loading | Complex config parser in hooks | Simple `JSON.parse(fs.readFileSync(...))` with try/catch defaulting to true | Hooks should be minimal; the full getTelemetryConfig is in hive-tools.js |
| Duration tracking | Custom timer in SubagentStop | Accept that SubagentStop stdin JSON does NOT provide duration_ms | Claude Code does not include duration in SubagentStop input; record null, Phase 6 can derive from transcript timestamps |
| Agent spawned count for SessionEnd | Counting SubagentStart events | Read events.jsonl and count agent_completion events for this session | SessionEnd hook can count events already recorded in this session |

**Key insight:** Each hook is ~30-50 lines of straightforward Node.js. The complexity is in understanding the hook input schemas, not in the code itself. Resist over-engineering.

## Common Pitfalls

### Pitfall 1: SubagentStop does not provide duration_ms
**What goes wrong:** The proposal's example shows `data.duration_ms` in the SubagentStop hook, but the actual Claude Code SubagentStop input schema does NOT include duration_ms. It provides: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`.
**Why it happens:** The proposal was written speculatively before verifying the actual hook input schema.
**How to avoid:** Set `duration_ms: null` in the agent_completion event data. Duration can be derived later from transcript timestamps (Phase 6) or by recording SubagentStart time and computing delta.
**Warning signs:** Accessing `data.duration_ms` returns `undefined`.

### Pitfall 2: PostToolUseFailure has no agent context
**What goes wrong:** Trying to filter PostToolUseFailure by which agent triggered the tool (HOOK-07). The hook input has `tool_name`, `tool_input`, `error`, and `is_interrupt` but no agent identifier.
**Why it happens:** Tool hooks fire at the tool level, not the agent level. Claude Code doesn't propagate agent context to tool hooks.
**How to avoid:** For HOOK-07, use project-level filtering (check `.planning/` exists) rather than agent-level filtering. In a Hive project, all tool errors are potentially relevant. Alternatively, check if the `cwd` has a `.planning/` directory which indicates Hive is active.
**Warning signs:** Looking for `data.agent` or `data.agent_type` on PostToolUseFailure input and getting undefined.

### Pitfall 3: Forgetting to add `session_boundary` to VALID_EVENT_TYPES
**What goes wrong:** SessionStart/SessionEnd hooks try to emit `session_boundary` events, but `hive-tools.js telemetry query --type session_boundary` returns no results because the type is not in VALID_EVENT_TYPES.
**Why it happens:** Phase 1 defined VALID_EVENT_TYPES with `session_summary` (for Phase 6 transcript analysis), but `session_boundary` (for Phase 2 session hooks) was not included.
**How to avoid:** Add `session_boundary` to VALID_EVENT_TYPES in hive-tools.js as part of Phase 2. The hooks write directly to events.jsonl (bypassing type validation), but the query/stats commands will need to recognize this type.
**Warning signs:** `telemetry stats` shows events of unknown type, or `telemetry query --type session_boundary` returns empty.

### Pitfall 4: SessionEnd hook blocking on event counting
**What goes wrong:** HOOK-05 requires `agents_spawned_count` and `events_recorded_count` in the SessionEnd event. Reading and parsing the entire events.jsonl file to count events adds latency to session termination.
**How to avoid:** Keep it simple: read events.jsonl, filter by current session_id, count. For a 500KB file (the rotation threshold), this takes <5ms. Wrap in try/catch in case the file is missing or corrupt.
**Warning signs:** Noticeable delay when exiting Claude Code.

### Pitfall 5: Hook registration breaking existing hooks
**What goes wrong:** Overwriting `.claude/settings.json` removes the existing SessionStart hook for `hive-check-update.js`.
**Why it happens:** Naive JSON write replaces the entire file.
**How to avoid:** Read existing settings.json, merge new hook registrations additively into the existing `hooks` object, write back. For SessionStart, append to the existing array rather than replacing it.
**Warning signs:** Update checker stops working after Phase 2 deployment.

### Pitfall 6: Hook input field names differ from proposal
**What goes wrong:** The proposal uses `data.agent?.name` for SubagentStop, but the actual field is `data.agent_type`. The proposal shows `data.exit_code`, but SubagentStop doesn't have exit_code.
**Why it happens:** Proposal was speculative, actual Claude Code docs differ.
**How to avoid:** Use the verified field names from official Claude Code docs:
- SubagentStop: `agent_id`, `agent_type`, `agent_transcript_path`, `stop_hook_active`
- PostToolUseFailure: `tool_name`, `tool_input`, `error`, `is_interrupt`, `tool_use_id`
- PreCompact: `trigger` ("manual" or "auto"), `custom_instructions`
- SessionStart: `source` ("startup"/"resume"/"clear"/"compact"), `model`, optionally `agent_type`
- SessionEnd: `reason` ("clear"/"logout"/"prompt_input_exit"/"bypass_permissions_disabled"/"other")
**Warning signs:** Accessing wrong field names, getting undefined.

### Pitfall 7: PreCompact hook looking for context_pressure data that doesn't exist
**What goes wrong:** HOOK-03 requires "context pressure signal" but PreCompact input only has `trigger` and `custom_instructions`. There is no `remaining_pct`, `tokens_before`, or `tokens_after`.
**Why it happens:** The proposal assumed richer data than Claude Code actually provides.
**How to avoid:** Record what is available: `trigger` type (manual/auto). The proposal's `remaining_pct` and token counts cannot be obtained from PreCompact input. Could potentially be extracted from the transcript or context_window data, but that would require reading the transcript file -- keep it simple, record `trigger` only.
**Warning signs:** Trying to access `data.remaining_pct` and getting undefined.

## Code Examples

Verified patterns from official sources and existing codebase:

### SubagentStop Observer (hive-recall-agent.js)
```javascript
// Source: Official Claude Code docs (SubagentStop input schema) + existing hook pattern
#!/usr/bin/env node
// Hive Recall -- Agent completion observer
// Hook: SubagentStop | Fail-silent

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // HOOK-07: Only log Hive agents (agent_type starts with "hive-")
    const agentType = data.agent_type || '';
    if (!agentType.startsWith('hive-')) return;

    // Config check: telemetry enabled and hooks enabled?
    const configPath = path.join(data.cwd, '.planning', 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.telemetry?.enabled === false) return;
      if (config.telemetry?.hooks === false) return;
    } catch {
      // Missing config = enabled by default
    }

    // Build event envelope (matches Phase 1 createEventEnvelope format)
    const event = {
      ts: new Date().toISOString(),
      session: data.session_id || 'unknown',
      type: 'agent_completion',
      v: 1,
      data: {
        agent: agentType,
        agent_id: data.agent_id || null,
        duration_ms: null, // Not available from SubagentStop input
        exit_code: 0,      // SubagentStop = successful completion
        error: null,
      }
    };

    // Write to events.jsonl
    const telemetryDir = path.join(data.cwd, '.planning', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.appendFileSync(
      path.join(telemetryDir, 'events.jsonl'),
      JSON.stringify(event) + '\n'
    );
  } catch (e) {
    // HOOK-06: Fail silent -- observation never breaks execution
  }
});
```

### PostToolUseFailure Observer (hive-recall-error.js)
```javascript
// Source: Official Claude Code docs (PostToolUseFailure input schema)
#!/usr/bin/env node
// Hive Recall -- Tool error observer
// Hook: PostToolUseFailure | Fail-silent

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // HOOK-07: Only log in Hive projects (check .planning/ exists)
    const planningDir = path.join(data.cwd, '.planning');
    if (!fs.existsSync(planningDir)) return;

    // Config check
    const configPath = path.join(data.cwd, '.planning', 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.telemetry?.enabled === false) return;
      if (config.telemetry?.hooks === false) return;
    } catch {}

    // Skip user interrupts (not real errors)
    if (data.is_interrupt) return;

    const event = {
      ts: new Date().toISOString(),
      session: data.session_id || 'unknown',
      type: 'tool_error',
      v: 1,
      data: {
        tool: data.tool_name || 'unknown',
        command: data.tool_input?.command || null, // For Bash tools
        error: data.error || 'unknown error',
      }
    };

    const telemetryDir = path.join(data.cwd, '.planning', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.appendFileSync(
      path.join(telemetryDir, 'events.jsonl'),
      JSON.stringify(event) + '\n'
    );
  } catch (e) {
    // HOOK-06: Fail silent
  }
});
```

### PreCompact Observer (hive-recall-compact.js)
```javascript
// Source: Official Claude Code docs (PreCompact input schema)
#!/usr/bin/env node
// Hive Recall -- Context compaction observer
// Hook: PreCompact | Fail-silent

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // HOOK-07: Only log in Hive projects
    const planningDir = path.join(data.cwd, '.planning');
    if (!fs.existsSync(planningDir)) return;

    // Config check
    const configPath = path.join(data.cwd, '.planning', 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.telemetry?.enabled === false) return;
      if (config.telemetry?.hooks === false) return;
    } catch {}

    const event = {
      ts: new Date().toISOString(),
      session: data.session_id || 'unknown',
      type: 'context_compaction',
      v: 1,
      data: {
        trigger: data.trigger || 'unknown', // "manual" or "auto"
        custom_instructions: data.custom_instructions || null,
      }
    };

    const telemetryDir = path.join(data.cwd, '.planning', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.appendFileSync(
      path.join(telemetryDir, 'events.jsonl'),
      JSON.stringify(event) + '\n'
    );
  } catch (e) {
    // HOOK-06: Fail silent
  }
});
```

### Session Boundary Observer (hive-recall-session.js)
```javascript
// Source: Official Claude Code docs (SessionStart/SessionEnd schemas)
#!/usr/bin/env node
// Hive Recall -- Session boundary observer
// Hook: SessionStart + SessionEnd | Fail-silent

const fs = require('fs');
const path = require('path');

const mode = process.argv[2]; // 'start' or 'end' (passed via settings.json command)

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // HOOK-07: Only log in Hive projects
    const planningDir = path.join(data.cwd, '.planning');
    if (!fs.existsSync(planningDir)) return;

    // Config check
    const configPath = path.join(data.cwd, '.planning', 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.telemetry?.enabled === false) return;
      if (config.telemetry?.hooks === false) return;
    } catch {}

    const eventData = { action: mode };

    if (mode === 'start') {
      eventData.session_type = data.source || 'unknown'; // startup/resume/clear/compact
      eventData.model = data.model || null;
    } else if (mode === 'end') {
      eventData.reason = data.reason || 'unknown';

      // Count agents spawned and events recorded in this session
      try {
        const eventsFile = path.join(data.cwd, '.planning', 'telemetry', 'events.jsonl');
        const content = fs.readFileSync(eventsFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const sessionEvents = lines.filter(line => {
          try {
            const e = JSON.parse(line);
            return e.session === data.session_id;
          } catch { return false; }
        });
        eventData.events_count = sessionEvents.length;
        eventData.agents_spawned = sessionEvents.filter(line => {
          try {
            const e = JSON.parse(line);
            return e.type === 'agent_completion';
          } catch { return false; }
        }).length;
      } catch {
        eventData.events_count = 0;
        eventData.agents_spawned = 0;
      }
    }

    const event = {
      ts: new Date().toISOString(),
      session: data.session_id || 'unknown',
      type: 'session_boundary',
      v: 1,
      data: eventData,
    };

    const telemetryDir = path.join(data.cwd, '.planning', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.appendFileSync(
      path.join(telemetryDir, 'events.jsonl'),
      JSON.stringify(event) + '\n'
    );
  } catch (e) {
    // HOOK-06: Fail silent
  }
});
```

### Hook Registration in settings.json
```json
// Source: Official Claude Code docs + SELF-IMPROVEMENT-PROPOSAL.md
{
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/hive-recall-agent.js"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/hive-recall-error.js"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/hive-recall-compact.js"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/hive-check-update.js"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/hive-recall-session.js start"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/hive-recall-session.js end"
          }
        ]
      }
    ]
  }
}
```

## Verified Claude Code Hook Input Schemas

These are the exact fields each hook event receives via stdin JSON. Verified from official documentation at https://code.claude.com/docs/en/hooks.

### Common Fields (all hooks)
| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Current session identifier |
| `transcript_path` | string | Path to conversation JSONL file |
| `cwd` | string | Current working directory |
| `permission_mode` | string | "default", "plan", "acceptEdits", "dontAsk", or "bypassPermissions" |
| `hook_event_name` | string | Name of the event that fired |

### SubagentStop-Specific Fields
| Field | Type | Description |
|-------|------|-------------|
| `stop_hook_active` | boolean | Whether stop hook is already active (prevents infinite loops) |
| `agent_id` | string | Unique identifier for the subagent instance |
| `agent_type` | string | Agent name from frontmatter (e.g., "hive-executor", "hive-planner") |
| `agent_transcript_path` | string | Path to subagent's own transcript JSONL |

### PostToolUseFailure-Specific Fields
| Field | Type | Description |
|-------|------|-------------|
| `tool_name` | string | Name of the tool that failed (e.g., "Bash", "Write", "Read") |
| `tool_input` | object | The tool's input parameters |
| `tool_use_id` | string | Unique identifier for this tool use |
| `error` | string | Error description |
| `is_interrupt` | boolean | Whether failure was caused by user interruption |

### PreCompact-Specific Fields
| Field | Type | Description |
|-------|------|-------------|
| `trigger` | string | "manual" (user /compact) or "auto" (context window full) |
| `custom_instructions` | string | User instructions (for manual), empty for auto |

### SessionStart-Specific Fields
| Field | Type | Description |
|-------|------|-------------|
| `source` | string | "startup", "resume", "clear", or "compact" |
| `model` | string | Model identifier |
| `agent_type` | string | Optional: agent name if started with --agent |

### SessionEnd-Specific Fields
| Field | Type | Description |
|-------|------|-------------|
| `reason` | string | "clear", "logout", "prompt_input_exit", "bypass_permissions_disabled", "other" |

## Matcher Values

| Event | Matcher Filters | Relevant Values |
|-------|----------------|-----------------|
| SubagentStop | agent_type | "hive-executor", "hive-planner", "hive-verifier", etc. (but we use no matcher -- filter in code instead) |
| PostToolUseFailure | tool_name | "Bash", "Edit", "Write", "Read", etc. (no matcher -- capture all tool errors) |
| PreCompact | trigger | "manual", "auto" (no matcher -- capture both) |
| SessionStart | source | "startup", "resume", "clear", "compact" (no matcher -- capture all) |
| SessionEnd | reason | "clear", "logout", "prompt_input_exit", etc. (no matcher -- capture all) |

**Matcher strategy:** Do NOT use matchers for Hive filtering. Use in-code filtering (HOOK-07) instead. This avoids regex overhead and gives more flexible control. Matchers are regex-based on tool_name/agent_type -- but we want all events to reach our hook, then filter inside the hook based on Hive project context.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual telemetry calls in code | Automatic hook-based capture | Claude Code hooks system (current) | Zero-effort observation |
| SQLite-based intel (v1.9.2) | JSONL append-only + hooks | v1.10+ removed SQLite | 21MB dep eliminated |
| No agent lifecycle tracking | SubagentStop/Start hooks | Claude Code current version | Subagent completion visibility |

**Deprecated/outdated:**
- The proposal assumed `data.agent?.name` for SubagentStop. Actual field is `data.agent_type`.
- The proposal assumed `data.duration_ms` and `data.exit_code` from SubagentStop. Neither is provided.
- The proposal assumed `data.remaining_pct` from PreCompact. Not provided.

## Open Questions

1. **Duration tracking for agent completions**
   - What we know: SubagentStop does NOT provide `duration_ms`. SubagentStart provides `agent_id` and `agent_type`.
   - What's unclear: Whether to add a SubagentStart hook to record start time, then compute duration in SubagentStop by reading the events.jsonl for the matching SubagentStart event.
   - Recommendation: For Phase 2, set `duration_ms: null`. This keeps hooks simple. Duration derivation can be added later by: (a) adding a SubagentStart hook that records `{agent_id, start_ts}` events, or (b) Phase 6 transcript analysis which has full timeline access. The marginal value of duration in Phase 2 is low.

2. **PostToolUseFailure agent-level filtering (HOOK-07)**
   - What we know: PostToolUseFailure input has no agent identifier. Cannot distinguish tool errors from Hive agents vs. user-initiated tools.
   - What's unclear: Whether capturing ALL tool errors in a Hive project is acceptable, or if there's a way to determine if a tool error occurred during a Hive agent execution.
   - Recommendation: Use project-level filtering (`.planning/` exists = Hive project). In practice, when Hive is running, the vast majority of tool calls are from Hive agents. Non-Hive tool errors in a Hive project are still useful context (e.g., a user's manual `npm test` failure before running Hive is relevant background).

3. **Whether to use `async: true` for hook registration**
   - What we know: HOOK-06 says "all hooks are async and fail-silent". The Claude Code `async` field makes hooks non-blocking.
   - What's unclear: Whether "async" in HOOK-06 means Claude Code's `"async": true` (background execution) or just the pattern of not blocking workflow execution (which all hooks inherently achieve via fail-silent try/catch).
   - Recommendation: Do NOT use `"async": true` in hook registration. The hooks are fast (<5ms) due to synchronous `appendFileSync`. Making them truly async would complicate testing and prevent the SessionEnd hook from reading final event counts. The requirement's intent is "observation never breaks execution" which is achieved by try/catch, not by async.

4. **Whether `session_boundary` needs to be added to VALID_EVENT_TYPES**
   - What we know: The proposal and roadmap reference `session_boundary` events. VALID_EVENT_TYPES has `session_summary` but NOT `session_boundary`. Hooks write directly to events.jsonl bypassing validation.
   - What's unclear: Whether query/stats commands need to recognize `session_boundary` or if it works without being in VALID_EVENT_TYPES.
   - Recommendation: Add `session_boundary` to VALID_EVENT_TYPES. While direct writes bypass validation, the `telemetry emit` CLI command validates types, and `telemetry stats` should recognize all event types. Adding it maintains consistency and allows CLI-based event emission for testing.

## Sources

### Primary (HIGH confidence)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) -- Complete hook event documentation with input schemas, matcher patterns, decision control, and configuration
- [Anthropic claude-code/plugins/plugin-dev/skills/hook-development/SKILL.md](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md) -- Hook development patterns and best practices
- `hooks/hive-check-update.js` -- Existing working hook (SessionStart), verified stdin parsing pattern
- `hooks/hive-statusline.js` -- Existing working hook, verified stdin parsing and fail-silent pattern
- `.claude/settings.json` -- Existing hook registration structure
- `hive/bin/hive-tools.js` -- Phase 1 telemetry infrastructure (VALID_EVENT_TYPES, createEventEnvelope, getTelemetryConfig, ensureTelemetryDir)
- `.planning/SELF-IMPROVEMENT-PROPOSAL.md` -- Detailed Phase 2 design with code examples
- `.planning/REQUIREMENTS.md` -- HOOK-01 through HOOK-07 requirement definitions

### Secondary (MEDIUM confidence)
- [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) -- Community project implementing observability via all hook events, confirms patterns
- `.planning/ROADMAP.md` -- Phase 2 success criteria and plan breakdown

### Tertiary (LOW confidence)
- None. All findings verified against official documentation and existing codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Pure Node.js stdlib, exact pattern from existing hooks in codebase
- Architecture: HIGH -- Hook input schemas verified from official Claude Code docs, patterns from existing working hooks
- Pitfalls: HIGH -- Key discrepancies between proposal and actual hook schemas identified and documented with verified field names
- Code examples: HIGH -- Based on official hook schemas + existing hook patterns in the codebase

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (Claude Code hook system is stable; Node.js stdlib is mature)
