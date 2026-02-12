# Phase 6: Transcript Analysis - Research

**Researched:** 2026-02-12
**Domain:** Claude Code session transcript parsing, agent-based post-hoc analysis, cross-session pattern detection, JSONL processing in Node.js (zero-dep)
**Confidence:** HIGH

## Summary

Phase 6 creates a `hive-recall-analyst` agent that reads Claude Code session transcripts, analyzes reasoning quality and wasted context, and produces `session_summary` events that feed back into the existing digest/recall pipeline. This is the final phase of Hive Recall, building on all prior infrastructure (Phases 1-5).

The key architectural insight is that Claude Code session transcripts are JSONL files stored at `~/.claude/projects/{encoded-project-path}/{session-uuid}.jsonl`. Each line is a JSON object with a `type` field (`user`, `assistant`, `progress`, `system`, `file-history-snapshot`). The critical finding from direct filesystem analysis is that **80% of transcript bytes are `progress` messages** (streaming deltas, hook notifications) that carry no analytical value. Filtering to just `user` + `assistant` messages reduces a 5MB transcript to ~21KB (~5400 tokens), which fits comfortably within an agent's context window. Therefore, the analyst agent does NOT need complex chunking or summarization -- a simple pre-processing extraction step in `hive-tools.js` is sufficient.

The system has three layers: (1) a `telemetry transcript` CLI command that extracts and prepares transcript data, (2) a `hive-recall-analyst` agent definition (markdown) that receives the extracted transcript and produces structured analysis, and (3) a `/hive:analyze-session` slash command + workflow that orchestrates the invocation, gated by the existing `transcript_analysis` config toggle. The analyst emits `session_summary` events (already a VALID_EVENT_TYPE since Phase 1) with quality score, waste percentage, and recommendations, which the existing digest pipeline already aggregates.

**Primary recommendation:** Build a `telemetry transcript` subcommand in hive-tools.js that extracts and condenses Claude Code JSONL transcripts, create the `hive-recall-analyst` agent markdown file following the existing agent pattern, create a `/hive:analyze-session` command+workflow pair, and add cross-session pattern detection by querying accumulated `session_summary` events. The `transcript_analysis: false` config toggle already exists and gates the entire feature.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hive-tools.js` (source: `hive/bin/hive-tools.js`) | Current monolith | Transcript extraction CLI command, telemetry emit for session_summary | Established pattern -- all CLI logic is in this file |
| Node.js `fs` | stdlib | Read transcript JSONL files, write extracted output | Zero-dep requirement; already used throughout |
| Node.js `path` | stdlib | Resolve transcript file paths across `~/.claude/projects/` | Already used for all path operations |
| Node.js `os` | stdlib | `os.homedir()` for resolving `~/.claude/` path | Already used in hooks and installer |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Agent markdown (`agents/hive-recall-analyst.md`) | New | Agent definition for transcript analysis | Spawned by analyze-session workflow via Task() |
| Command file (`commands/hive/analyze-session.md`) | New | Slash command entry point | User invokes `/hive:analyze-session` |
| Workflow file (`hive/workflows/analyze-session.md`) | New | Orchestration logic for analysis | Coordinates extraction, agent spawn, event emission |
| `JSON.parse()` / `JSON.stringify()` | native | Parse JSONL transcript lines, format session_summary events | Every transcript line, every event emission |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CLI pre-processing in hive-tools.js | Let the agent read raw JSONL directly | Raw transcripts are 700KB-9MB. Even filtered to user+assistant they're ~21KB for large sessions. Pre-processing keeps agent context clean and consistent. Use CLI extraction. |
| Single agent for per-session + cross-session | Separate commands for each | Cross-session analysis re-uses the same agent with different input. A single agent with mode parameter (`--mode single` vs `--mode cross`) keeps it simple. Use single agent, mode flag in prompt. |
| Automatic analysis at session end | Manual invocation only | Automatic adds hook complexity and cost (spawns an agent every session). Config already says `transcript_analysis: false` by default. Keep it manual-only for v1 via `/hive:analyze-session`. |
| Complex NLP for quality scoring | Heuristic metrics + LLM judgment | The analyst agent IS the LLM doing the reasoning. The heuristic pre-extraction (token counts, retry counts, tool error rates) gives it structured data. LLM judgment fills the qualitative gap. Use both: heuristics for numbers, LLM for interpretation. |

**Installation:**
```bash
# No installation needed -- modifications to existing files + new markdown files
# hive-tools.js telemetry infrastructure already exists from Phases 1-5
```

## Architecture Patterns

### Recommended File Structure
```
agents/
  hive-recall-analyst.md           # NEW: Agent definition
commands/hive/
  analyze-session.md               # NEW: /hive:analyze-session command
hive/
  bin/hive-tools.js                # MODIFIED: telemetry transcript subcommand
  workflows/
    analyze-session.md             # NEW: Analysis workflow
.claude/                           # MUST MIRROR all new files
```

### Pattern 1: Transcript Extraction via CLI (Pre-Processing)
**What:** A `telemetry transcript` subcommand in hive-tools.js that reads a Claude Code JSONL file, filters to meaningful messages, extracts key metrics, and outputs a condensed analysis-ready payload.
**When to use:** Before spawning the analyst agent, to prepare clean input.
**Example:**
```javascript
function cmdTelemetryTranscript(cwd, sessionId, raw) {
  const telConfig = getTelemetryConfig(cwd);
  if (!telConfig.transcript_analysis) {
    error('Transcript analysis is disabled. Enable with: transcript_analysis: true in config.json telemetry section');
  }

  // Resolve transcript path
  const projectDir = resolveClaudeProjectDir(cwd);
  const transcriptPath = sessionId
    ? path.join(projectDir, sessionId + '.jsonl')
    : findLatestTranscript(projectDir);

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    error('No transcript found' + (sessionId ? ' for session ' + sessionId : ''));
  }

  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  // Extract meaningful messages only (user + assistant)
  const messages = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolUses = {};
  let toolErrors = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' || entry.type === 'assistant') {
        messages.push(entry);
      }
      // Aggregate metrics from assistant messages
      if (entry.type === 'assistant') {
        const usage = entry.message?.usage || {};
        totalInputTokens += (usage.input_tokens || 0)
          + (usage.cache_read_input_tokens || 0)
          + (usage.cache_creation_input_tokens || 0);
        totalOutputTokens += usage.output_tokens || 0;
        // Count tool uses
        for (const block of (entry.message?.content || [])) {
          if (block?.type === 'tool_use') {
            const name = block.name || 'unknown';
            toolUses[name] = (toolUses[name] || 0) + 1;
          }
        }
      }
    } catch { /* skip malformed lines */ }
  }

  // Build condensed transcript for agent consumption
  const condensed = messages.map(m => {
    if (m.type === 'user') {
      const content = m.message?.content;
      const text = typeof content === 'string' ? content
        : Array.isArray(content) ? content
            .filter(b => b?.type === 'text')
            .map(b => b.text).join('\n')
        : '';
      return { role: 'user', text: text.substring(0, 2000), ts: m.timestamp };
    } else {
      const blocks = m.message?.content || [];
      const textParts = blocks
        .filter(b => b?.type === 'text')
        .map(b => b.text);
      const tools = blocks
        .filter(b => b?.type === 'tool_use')
        .map(b => b.name + '(' + Object.keys(b.input || {}).join(',') + ')');
      return {
        role: 'assistant',
        text: textParts.join('\n').substring(0, 2000),
        tools: tools,
        ts: m.timestamp,
      };
    }
  });

  const result = {
    session_id: messages[0]?.sessionId || sessionId || 'unknown',
    transcript_path: transcriptPath,
    message_count: messages.length,
    user_turns: messages.filter(m => m.type === 'user').length,
    assistant_turns: messages.filter(m => m.type === 'assistant').length,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    tool_uses: toolUses,
    condensed_transcript: condensed,
  };

  output(result, raw);
}
```

**Key design decisions:**
- Truncates individual messages to 2000 chars to bound total output
- Extracts token usage metrics automatically (no LLM needed for numbers)
- Strips `progress`, `system`, `file-history-snapshot` (80% of file size)
- Returns structured JSON that the workflow passes to the analyst agent

### Pattern 2: Analyst Agent Definition (Markdown)
**What:** A `hive-recall-analyst.md` agent file following the existing pattern (frontmatter + role + process + output).
**When to use:** Spawned via Task() by the analyze-session workflow.
**Example structure:**
```markdown
---
name: hive-recall-analyst
description: Analyzes session transcripts for reasoning quality, wasted context, retry patterns, and produces session_summary events.
tools: Read, Bash
color: yellow
---

<role>
You are a Hive Recall analyst. You examine session transcripts to identify quality patterns
that automated hooks and workflow events cannot capture.
</role>

<analysis_framework>
## Quality Dimensions

1. **Reasoning Quality** (0-100 score)
   - Did the agent follow instructions accurately?
   - Were tool uses purposeful or exploratory/redundant?
   - Did the agent recover from errors efficiently?

2. **Wasted Context** (0-100% waste)
   - Repeated tool calls with same/similar arguments
   - Reading files that were never used
   - Long reasoning chains that led nowhere
   - Unnecessary verification of already-verified work

3. **Retry Patterns**
   - Tool errors followed by retry
   - Same operation attempted multiple ways
   - Circular reasoning (returning to already-explored approaches)

4. **User Interaction Quality**
   - Were user corrections needed? How many?
   - Did the agent ask clarifying questions when needed?
   - Were responses appropriately scoped?
</analysis_framework>

<output_format>
Return a structured analysis as a JSON code block:

```json
{
  "quality_score": 75,
  "waste_pct": 15,
  "patterns": [
    "Agent read 3 files that were never referenced in output",
    "Two retry cycles on Bash command due to missing directory"
  ],
  "recommendations": [
    "Add directory existence check before file operations",
    "Reduce exploratory file reading -- use Grep to target search"
  ],
  "user_preference_signals": [
    "User prefers concise output (corrected verbosity twice)",
    "User expects atomic git commits per task"
  ],
  "agent_behavior_notes": [
    "Executor consistently over-reads context files",
    "Good error recovery on tool failures"
  ]
}
```
</output_format>
```

### Pattern 3: Cross-Session Pattern Detection
**What:** Query accumulated `session_summary` events to detect trends across sessions.
**When to use:** When user requests cross-session analysis, or as part of digest enhancement.
**Example:**
```javascript
// In hive-tools.js, as part of the transcript command or a separate subcommand
function detectCrossSessionPatterns(cwd) {
  const events = loadEvents(cwd).filter(e => e.type === 'session_summary');
  if (events.length < 2) return null;

  // Quality trend
  const scores = events.map(e => e.data?.quality_score).filter(Boolean);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const recentAvg = scores.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, scores.length);
  const trend = recentAvg > avgScore ? 'improving' : recentAvg < avgScore ? 'declining' : 'stable';

  // Recurring patterns (across all session summaries)
  const patternFreq = {};
  events.forEach(e => {
    (e.data?.patterns || []).forEach(p => {
      patternFreq[p] = (patternFreq[p] || 0) + 1;
    });
  });

  // Recurring recommendations
  const recFreq = {};
  events.forEach(e => {
    (e.data?.recommendations || []).forEach(r => {
      recFreq[r] = (recFreq[r] || 0) + 1;
    });
  });

  return {
    sessions_analyzed: events.length,
    avg_quality: avgScore,
    quality_trend: trend,
    avg_waste: events.map(e => e.data?.waste_pct).filter(Boolean).reduce((a, b) => a + b, 0) / events.length,
    recurring_patterns: Object.entries(patternFreq).filter(([_, c]) => c >= 2).sort((a, b) => b[1] - a[1]),
    recurring_recommendations: Object.entries(recFreq).filter(([_, c]) => c >= 2).sort((a, b) => b[1] - a[1]),
  };
}
```

### Pattern 4: Analyze-Session Workflow
**What:** Command + workflow pair following the insights.md pattern.
**When to use:** User invokes `/hive:analyze-session`.
**Workflow structure:**
```markdown
<process>
<step name="check_config">
  Verify transcript_analysis is enabled in config.
  If disabled, inform user and offer to enable.
</step>

<step name="extract_transcript">
  Run: node ./.claude/hive/bin/hive-tools.js telemetry transcript [--session ID] --raw
  Parse JSON output containing condensed transcript and metrics.
</step>

<step name="analyze">
  Spawn hive-recall-analyst via Task() with extracted transcript and metrics.
  Pass existing session_summary events (if any) for cross-session awareness.
</step>

<step name="emit_event">
  Parse analyst output (JSON from the agent).
  Run: node ./.claude/hive/bin/hive-tools.js telemetry emit session_summary --data '{...}'
</step>

<step name="report">
  Display analysis results to user.
  If cross-session patterns detected, show trend information.
  Offer to regenerate digest to incorporate new session_summary.
</step>
</process>
```

### Anti-Patterns to Avoid
- **Reading raw transcript in agent context:** Even filtered, a raw 764KB transcript will waste agent context. Always pre-process with the CLI command first. The CLI extracts metrics (token counts, tool usage) and condenses text.
- **Automatic analysis at session end:** The proposal mentions "spawned optionally at session end" but this adds significant complexity (hook-spawning-agent pattern) and cost. The config already defaults to `false`. Keep v1 as manual invocation only.
- **Storing transcript data in events.jsonl:** Transcripts contain user content and potentially sensitive code context. Events should contain metadata only (scores, patterns, recommendations), never raw transcript text. This aligns with the P6 (Privacy-Aware) design principle.
- **Complex quality scoring algorithms in JS:** The quality score should come from the LLM analyst agent, not from heuristic formulas in hive-tools.js. The CLI extracts quantitative metrics (token counts, retry counts); the agent provides qualitative assessment. Don't try to compute a quality score in pure JS.
- **Parsing thinking blocks:** Claude Code transcripts may contain `thinking` content blocks in assistant messages. These are internal reasoning and should NOT be included in the extracted transcript sent to the analyst agent (they would double the context usage for minimal analytical value).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transcript location resolution | Hard-coded `~/.claude/projects/` path | `os.homedir()` + path encoding matching Claude Code's pattern | Claude Code encodes project paths by replacing `/` with `-` and prefixing with `-`. The path `/home/dico/dico-dev/hive-disaster` becomes `-home-dico-dico-dev-hive-disaster`. Use this convention. |
| Quality scoring | Heuristic formula in JS | LLM analyst agent judgment | The analyst agent IS the intelligence. Heuristics can count retries and token waste but cannot assess reasoning quality. Let the LLM do what LLMs are good at. |
| Transcript format parsing | Custom format parser | Simple `JSON.parse()` per line + type filtering | JSONL is trivially parseable. Filter by `type` field. No complex parsing needed. |
| Cross-session trend detection | ML-based trend analysis | Simple average comparison (recent 3 vs all-time) | With typical project having 5-20 analyzed sessions, statistical sophistication is noise. Simple averaging is more interpretable and debuggable. |

**Key insight:** The analyst agent provides the "intelligence" -- the CLI provides the "data prep." Keep the CLI code simple (extract, filter, aggregate counts). The agent interprets what those numbers mean and provides the qualitative assessment.

## Common Pitfalls

### Pitfall 1: Transcript File Too Large for Agent Context
**What goes wrong:** Attempting to pass a raw 5MB+ transcript to the analyst agent overwhelms the context window, causing truncation, poor analysis, or failure.
**Why it happens:** Developers see JSONL and think "just read the file." But 80% of the file is `progress` messages (streaming deltas) with zero analytical value.
**How to avoid:** Always pre-process via `telemetry transcript` command. Filter to `user` + `assistant` types only. Truncate individual messages. The pre-processed output for even the largest sessions observed (1251 lines, 5.1MB raw) is ~21KB text-only content.
**Warning signs:** Agent context filling up before analysis starts; agent producing generic/unhelpful analysis; `progress` type messages appearing in agent prompt.

### Pitfall 2: Transcript Path Resolution Across Platforms
**What goes wrong:** The path encoding scheme (`/home/dico/project` -> `-home-dico-project`) may differ across platforms (Windows, macOS, Linux) or Claude Code versions.
**Why it happens:** Claude Code's path encoding is an internal implementation detail, not a documented API. It could change between versions.
**How to avoid:** Derive the encoded path from `cwd` using the same algorithm Claude Code uses (replace path separators with `-`, prefix with `-`). Fall back to listing the `~/.claude/projects/` directory and matching by suffix. Include the `cwd` field from transcript entries as a validation check.
**Warning signs:** "No transcript found" errors on a system that clearly has transcripts; path encoding mismatches between operating systems.

### Pitfall 3: Missing or Empty Session Transcripts
**What goes wrong:** User invokes analyze-session but no transcripts exist, or the transcript has only 1-2 messages.
**Why it happens:** New project, very short session, or Claude Code was used in a different mode/location.
**How to avoid:** Check for transcript existence and minimum message count (at least 5 user+assistant messages) before spawning the analyst. Return a clear message: "Session too short for meaningful analysis" rather than producing a vacuous summary.
**Warning signs:** Analyst producing quality scores for single-message sessions; empty patterns/recommendations.

### Pitfall 4: Privacy Leakage into Events
**What goes wrong:** Session summary events contain raw user prompts or code snippets, violating the P6 (Privacy-Aware) design principle.
**Why it happens:** The analyst generates patterns like "User asked about password hashing in file X.ts" which embeds project-specific content in events.
**How to avoid:** The analyst prompt must explicitly instruct: "Patterns and recommendations must be GENERIC and actionable. Never include file paths, variable names, code snippets, or user-specific content in your output." Validate the session_summary event data before emitting.
**Warning signs:** Session summary events containing file paths, code, or project-specific identifiers.

### Pitfall 5: Stale Cross-Session Patterns
**What goes wrong:** Cross-session analysis references patterns from 50 sessions ago that are no longer relevant.
**Why it happens:** The system accumulates session_summary events indefinitely. Old patterns persist even after the issue was resolved.
**How to avoid:** Cross-session analysis should focus on RECENT events (e.g., last 10 session summaries) rather than all-time. Use a sliding window. The `telemetry query --since 30d --type session_summary` command already supports this filtering.
**Warning signs:** Recommendations referencing issues that were fixed weeks ago; patterns contradicting recent behavior.

### Pitfall 6: Dual-File Synchronization (Source vs Installed)
**What goes wrong:** Source files (`agents/hive-recall-analyst.md`, `commands/hive/analyze-session.md`, `hive/workflows/analyze-session.md`) and installed copies (`.claude/agents/`, `.claude/commands/hive/`, `.claude/hive/workflows/`) diverge.
**Why it happens:** Developer modifies source but forgets to copy to `.claude/`, or vice versa.
**How to avoid:** The plan must explicitly list BOTH paths for every new file. Follow the same pattern used in Phase 2 (hooks), Phase 3 (workflow events), and Phase 4 (insights command). Use the build/install process to synchronize.
**Warning signs:** `/hive:analyze-session` command not recognized; agent definition not found when spawned.

## Code Examples

Verified patterns from the existing codebase:

### Claude Code Transcript JSONL Format (Verified via Direct Filesystem Analysis)
```javascript
// Each line in ~/.claude/projects/{encoded-path}/{session-uuid}.jsonl
// Type: 'user'
{
  "parentUuid": "uuid-or-null",
  "isSidechain": false,
  "userType": "external",
  "cwd": "/home/dico/dico-dev/hive-disaster",
  "sessionId": "session-uuid",
  "version": "2.1.39",
  "gitBranch": "main",
  "type": "user",
  "message": { "role": "user", "content": "text or [{type:'text',text:'...'}]" },
  "uuid": "message-uuid",
  "timestamp": "2026-02-12T00:47:23.727Z"
}

// Type: 'assistant'
{
  "parentUuid": "uuid",
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg-id",
    "role": "assistant",
    "content": [
      { "type": "text", "text": "response text" },
      { "type": "tool_use", "id": "tool-id", "name": "Bash", "input": { "command": "..." } },
      { "type": "thinking", "thinking": "internal reasoning..." }
    ],
    "stop_reason": "end_turn",
    "usage": {
      "input_tokens": 2,
      "cache_creation_input_tokens": 19815,
      "cache_read_input_tokens": 28431,
      "output_tokens": 9
    }
  },
  "timestamp": "2026-02-12T00:47:27.962Z"
}

// Type: 'progress' (80% of file, SKIP during analysis)
{ "type": "progress", "data": { "type": "agent_progress" | "hook_progress", ... } }

// Type: 'system' (hook summaries, SKIP during analysis)
{ "type": "system", "subtype": "stop_hook_summary", "hookCount": 2, ... }

// Type: 'file-history-snapshot' (SKIP during analysis)
{ "type": "file-history-snapshot", ... }
```

**Size analysis from real transcripts (this project):**
| Metric | Small Session (67 lines) | Large Session (1251 lines) |
|--------|--------------------------|----------------------------|
| Raw file size | 30KB | 5.1MB |
| Progress messages | 80% of size | 80% of size |
| User+Assistant only | 6KB | 764KB |
| Text-only extracted | 6KB (~1500 tokens) | 21KB (~5400 tokens) |
| User turns | 3 | 67 |
| Assistant turns | 5 | 107 |
| Tool uses | 2 | 56 |

### Project Path Encoding (Claude Code Convention)
```javascript
// Claude Code encodes project paths for the projects directory
function resolveClaudeProjectDir(cwd) {
  const homedir = require('os').homedir();
  // Replace path separators with '-', prefix with '-'
  const encoded = cwd.replace(/\//g, '-');
  // e.g., /home/dico/dico-dev/hive-disaster -> -home-dico-dico-dev-hive-disaster
  return path.join(homedir, '.claude', 'projects', encoded);
}
```

### Session Summary Event Envelope (Matches Existing INFRA-02 Pattern)
```javascript
// Session summary event emitted after analysis
const event = {
  ts: new Date().toISOString(),
  session: sessionId,
  type: 'session_summary',  // Already in VALID_EVENT_TYPES since Phase 1
  v: 1,
  data: {
    quality_score: 75,         // 0-100, from analyst agent
    waste_pct: 15,             // 0-100, from analyst agent
    patterns: [                // Array of strings, max 5
      "Repeated file reads without using content",
      "Good error recovery on Bash failures"
    ],
    recommendations: [         // Array of strings, max 3
      "Use Grep before Read for targeted file search",
      "Add directory check before file write operations"
    ],
    user_preferences: [        // Array of strings, max 3
      "Prefers concise output",
      "Expects atomic commits"
    ],
    metrics: {                 // Quantitative data from CLI extraction
      user_turns: 12,
      assistant_turns: 18,
      total_input_tokens: 450000,
      total_output_tokens: 8500,
      tool_uses: { "Bash": 8, "Read": 5, "Write": 3 }
    }
  }
};
```

### Config Toggle Check (Follows Existing Pattern)
```javascript
// In cmdTelemetryTranscript, check the existing config toggle
const telConfig = getTelemetryConfig(cwd);
if (!telConfig.transcript_analysis) {
  error('Transcript analysis is disabled. Set transcript_analysis: true in config.json telemetry section');
}
```

### Finding Latest Transcript (For Default Behavior)
```javascript
function findLatestTranscript(projectDir) {
  try {
    const files = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(projectDir, f),
        mtime: fs.statSync(path.join(projectDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].path : null;
  } catch {
    return null;
  }
}
```

## State of the Art

| Old Approach (Pre-Phase 6) | New Approach (Phase 6) | What Changed | Impact |
|---------------------------|------------------------|--------------|--------|
| No transcript analysis | Analyst agent parses session transcripts | New capability | Deep patterns not visible to hooks/workflows (reasoning quality, context waste) |
| `session_summary` type exists but unused | `session_summary` events emitted by analyst | Type activated | Cross-session trend data enters the digest pipeline |
| Digest has no quality scores | Session summaries include quality_score and waste_pct | Quality quantification | Trend tracking over time (improving/declining quality) |
| No user preference detection | Analyst identifies implicit preferences | Personalization signal | Future agents can adapt to user style |
| No agent behavior drift detection | Cross-session pattern comparison | Drift awareness | Detect when agent quality changes across sessions |

**Already completed in prior phases (Phase 6 builds on all of these):**
- JSONL storage engine, event envelope, all CLI commands (Phase 1)
- Hook observers for automatic event capture (Phase 2)
- Workflow event emissions (Phase 3)
- Digest generation with recall markers, init injection, `/hive:insights` command (Phase 4)
- Installer integration for hooks and config (Phase 5)
- `session_summary` already in VALID_EVENT_TYPES (Phase 1, INFRA-03)
- `transcript_analysis: false` already in config template (Phase 1, INFRA-10)
- `getRecallContext()` and recall injection already working (Phase 4)

## Requirement-to-Implementation Mapping

| Requirement | Implementation | Files Modified/Created |
|-------------|----------------|------------------------|
| TRANS-01: hive-recall-analyst agent | Create `agents/hive-recall-analyst.md` with analysis framework, quality dimensions, structured JSON output format. Create `telemetry transcript` subcommand in hive-tools.js for pre-processing. | `agents/hive-recall-analyst.md` (NEW), `hive/bin/hive-tools.js` (MODIFIED), `commands/hive/analyze-session.md` (NEW), `hive/workflows/analyze-session.md` (NEW) |
| TRANS-02: session_summary event with quality score and recommendations | Workflow parses analyst JSON output and emits via `telemetry emit session_summary --data '{...}'`. Event type already exists in VALID_EVENT_TYPES. | `hive/workflows/analyze-session.md` (workflow emits event after analysis) |
| TRANS-03: Cross-session pattern detection | Query accumulated session_summary events, compare quality trends, identify recurring patterns/recommendations. Can be done in hive-tools.js or in the analyst agent prompt with prior summaries passed as context. | `hive/bin/hive-tools.js` (add cross-session query helper or integrate into transcript command) |

## Plan Split Recommendation

The two-plan split from the roadmap is sound:

### Plan 06-01: Recall Analyst Agent and Session Summary (TRANS-01, TRANS-02)
**Scope:** Create `telemetry transcript` subcommand in hive-tools.js for extracting and condensing Claude Code session transcripts. Create `hive-recall-analyst.md` agent definition. Create `analyze-session.md` command + workflow pair. Wire the workflow to extract transcript, spawn analyst, parse results, and emit `session_summary` event.
**Files:**
- `hive/bin/hive-tools.js` -- Add `cmdTelemetryTranscript`, `resolveClaudeProjectDir`, `findLatestTranscript`
- `agents/hive-recall-analyst.md` -- NEW agent definition
- `commands/hive/analyze-session.md` -- NEW slash command
- `hive/workflows/analyze-session.md` -- NEW workflow
- Mirror all new files in `.claude/` (`.claude/agents/`, `.claude/commands/hive/`, `.claude/hive/workflows/`)
**Wave:** 1 (no dependencies within Phase 6)

### Plan 06-02: Cross-Session Pattern Detection (TRANS-03)
**Scope:** Add cross-session analysis capability to the analyst workflow. Query prior `session_summary` events, compute quality trends, identify recurring patterns and recommendations across sessions. Pass cross-session context to analyst agent for enhanced analysis. Add cross-session section to the analyze-session workflow output.
**Files:**
- `hive/bin/hive-tools.js` -- Add `detectCrossSessionPatterns` helper or enhance `cmdTelemetryTranscript` with `--cross-session` flag
- `hive/workflows/analyze-session.md` -- MODIFIED to include cross-session step
- `agents/hive-recall-analyst.md` -- MODIFIED to handle cross-session context in prompt
- Mirror modifications in `.claude/`
**Wave:** 2 (depends on 06-01 for session_summary events to exist)

## Open Questions

1. **Should analysis be invokable with a specific session ID?**
   - What we know: Transcripts are stored by session UUID. The latest session is most commonly desired. But users may want to analyze a previous session.
   - Recommendation: Support both: `/hive:analyze-session` (latest) and `/hive:analyze-session [session-id]` (specific). The CLI command supports `telemetry transcript [session-id]` with optional parameter. Default to latest by mtime.

2. **How many cross-session summaries to include in the analyst context?**
   - What we know: Each session_summary event is small (patterns + recommendations = ~500 bytes). Too many floods context; too few misses trends.
   - Recommendation: Include the 5 most recent session_summary events. This gives enough data for trend detection without bloating the agent prompt. Use `telemetry query --type session_summary --limit 5`.

3. **Should the analyst also examine events.jsonl data alongside the transcript?**
   - What we know: events.jsonl contains structured hook/workflow events (deviations, tool errors) that complement the transcript's raw conversation data. Including both gives richer analysis.
   - Recommendation: Yes, pass the output of `telemetry stats` alongside the transcript to give the analyst quantitative event data. This is a single JSON object and adds minimal context load.

4. **How to handle multi-agent sessions (where Task() spawns subagents)?**
   - What we know: The transcript JSONL includes `progress` messages with `agent_progress` subtype that track subagent activity. These are in the 80% we filter out.
   - Recommendation: For v1, analyze only the top-level conversation. Subagent transcripts are separate sessions with their own JSONL files. Cross-session detection (Plan 06-02) may surface patterns across parent and child sessions naturally.

## Sources

### Primary (HIGH confidence)
- **Direct filesystem analysis** of `~/.claude/projects/-home-dico-dico-dev-hive-disaster/*.jsonl` -- Verified JSONL format, message types, field structures, size distributions, content block formats
- **`hive/bin/hive-tools.js`** (source file) -- Verified: VALID_EVENT_TYPES includes `session_summary`, getTelemetryConfig reads `transcript_analysis`, getRecallContext extracts recall patterns, cmdTelemetryEmit validates event types
- **`hive/templates/config.json`** -- Verified: `transcript_analysis: false` already present in telemetry section
- **`.planning/SELF-IMPROVEMENT-PROPOSAL.md`** -- session_summary schema definition: `{patterns[], recommendations[], quality_score, waste_pct}`
- **Existing agent definitions** (`agents/hive-verifier.md`, `agents/hive-codebase-mapper.md`) -- Verified agent file pattern: frontmatter, role, process, output format
- **Existing command/workflow pairs** (`commands/hive/insights.md`, `hive/workflows/insights.md`) -- Verified command+workflow creation pattern

### Secondary (MEDIUM confidence)
- [Analyzing Claude Code Interaction Logs with DuckDB](https://liambx.com/blog/claude-code-log-analysis-with-duckdb) -- Confirmed JSONL field structure: parentUuid, sessionId, type, message, uuid, timestamp
- [Claude Code `--continue` migration guide](https://gist.github.com/gwpl/e0b78a711b4a6b2fc4b594c9b9fa2c4c) -- Confirmed session storage location and encoding scheme
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) -- Confirmed hook event model

### Tertiary (LOW confidence)
- [Context Rot research](https://research.trychroma.com/context-rot) -- Supporting evidence for context waste as a real phenomenon worth measuring
- [State of AI code quality 2025](https://www.qodo.ai/reports/state-of-ai-code-quality/) -- Context for quality metrics (65% of developers cite missing context as #1 issue)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All modifications use existing patterns in a codebase we fully examined. Zero new dependencies.
- Architecture: HIGH -- Agent definition pattern verified against 11 existing agents. Command+workflow pattern verified against insights.md. CLI command pattern verified against existing telemetry commands. Transcript JSONL format verified by direct filesystem analysis.
- Pitfalls: HIGH -- Size analysis from real transcripts (not theoretical). Privacy concern identified from existing design principles. Path encoding verified empirically.

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (stable -- primarily internal codebase patterns. Claude Code JSONL format is LOW stability but has been consistent across observed versions.)
