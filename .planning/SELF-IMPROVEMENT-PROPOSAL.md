# Hive Recall: Self-Improvement Through Observation

> **System Name**: Hive Recall
> **Version**: Proposal v1.0
> **Date**: 2026-02-11
> **Authors**: Synthesized from 3 parallel research tracks (arch-observer, patterns-researcher, hooks-analyst)
> **Status**: PROPOSAL — Pending approval

---

## 1. Executive Summary

Hive Recall is a lightweight, zero-dependency telemetry and insight system for Hive. It passively observes agent execution, records structured events, and distills patterns into actionable insights that feed back into future sessions. The system learns from every session — what agents struggle with, where plans deviate, which verification gaps recur — and makes that knowledge available at session start.

**The core loop**: Observe → Record → Digest → Feed Back → Improve.

**Why "Recall"**: Hive agents operate with fresh 200k context every spawn. They have no memory. Recall gives Hive a persistent memory layer that accumulates wisdom across sessions and projects without breaking the fresh-context architecture.

---

## 2. Architecture Overview

Recall operates in three tiers, each progressively deeper in semantic understanding:

### Tier 1: Hook Observers (Automatic, Passive)

Hooks fire on Claude Code lifecycle events. They capture structured data automatically, with zero workflow changes required.

- **What they capture**: Agent completions (success/failure/duration), tool errors, context compaction events, session boundaries
- **How they work**: Node.js scripts registered in `.claude/settings.json`, receive JSON on stdin, append to JSONL on disk
- **Constraint**: Hooks cannot see inside agent reasoning or understand semantic quality — they only see event metadata

### Tier 2: Workflow Integration (Semantic, Active)

Strategic `telemetry emit` calls placed at key decision points in workflows and agents. These capture the *meaning* of what happened, not just that something happened.

- **What they capture**: Plan deviations (drift from spec), checkpoint outcomes, verification gaps, user corrections, wave completions, fallback activations
- **How they work**: Single-line `node hive-tools.js telemetry emit` calls inserted into existing workflows
- **Constraint**: Requires modifying workflow files (but each addition is a single line)

### Tier 3: Transcript Analysis (Deep, Post-hoc)

Optional end-of-session analysis that examines the full session transcript for patterns that neither hooks nor workflow logs can capture.

- **What it captures**: Repeated failed approaches, implicit user preferences, quality of agent outputs, reasoning patterns, wasted context
- **How it works**: A dedicated analysis agent spawned at session end (or on-demand via `/hive:insights`)
- **Constraint**: Most expensive tier. Optional. Runs only when explicitly invoked or at session end.

### How the Tiers Complement Each Other

```
Tier 1 (Hooks)         → "Agent X finished in 45s with exit code 0"
Tier 2 (Workflows)     → "Agent X deviated from plan: added error handling not in spec"
Tier 3 (Transcript)    → "Agent X consistently over-engineers error handling across 5 sessions"
```

Each tier adds context the previous tier cannot see.

---

## 3. Data Model

### 3.1 Event Storage: JSONL

All events are stored in `.planning/telemetry/events.jsonl` using a common envelope:

```jsonl
{"ts":"2026-02-11T14:30:00Z","session":"abc123","type":"agent_completion","v":1,"data":{...}}
{"ts":"2026-02-11T14:30:05Z","session":"abc123","type":"deviation","v":1,"data":{...}}
```

**Common envelope fields**:
| Field | Type | Description |
|-------|------|-------------|
| `ts` | ISO 8601 string | Event timestamp |
| `session` | string | Session ID (from Claude Code) |
| `type` | string | Event type (see below) |
| `v` | integer | Schema version (starts at 1) |
| `data` | object | Type-specific payload |

### 3.2 Event Types (10 Types)

| Type | Tier | Payload | Emitted By |
|------|------|---------|------------|
| `agent_completion` | 1 | `{agent, phase, plan, duration_ms, exit_code, error?}` | SubagentStop hook |
| `tool_error` | 1 | `{tool, error, agent?, context?}` | PostToolUseFailure hook |
| `context_compaction` | 1 | `{remaining_pct, tokens_before, tokens_after}` | PreCompact hook |
| `session_boundary` | 1 | `{action: "start"\|"end", agents_spawned?, events_count?}` | SessionStart/SessionEnd hooks |
| `deviation` | 2 | `{phase, plan, deviation_type, severity, description, resolution}` | execute-plan workflow |
| `checkpoint` | 2 | `{phase, plan, checkpoint_type, user_response?, outcome}` | execute-phase workflow |
| `verification_gap` | 2 | `{phase, level, what_failed, expected, actual}` | verify-work workflow |
| `user_correction` | 2 | `{phase?, plan?, what_changed, user_intent}` | Any workflow with gate |
| `plan_revision` | 2 | `{phase, plan, revision_type, reason, changes_summary}` | plan-phase workflow |
| `session_summary` | 3 | `{patterns[], recommendations[], quality_score, waste_pct}` | Transcript analysis |

### 3.3 Human-Readable Layer: INSIGHTS.md

Located at `.planning/telemetry/INSIGHTS.md`. Regenerated by `hive-tools.js telemetry digest`. Contains:

```markdown
# Hive Recall — Project Insights

> Last updated: 2026-02-11 | Sessions analyzed: 14 | Events recorded: 342

## Recurring Patterns

1. **Executor over-engineers error handling** (observed 5x across phases 2-4)
   - Impact: +20min average per plan, 3 deviations flagged
   - Suggestion: Add explicit "error handling scope" to PLAN.md template

2. **Verification gaps in CSS/styling** (observed 3x)
   - Impact: Visual regressions caught only at UAT
   - Suggestion: Add visual verification checklist to verifier agent

## Agent Performance

| Agent | Avg Duration | Success Rate | Common Failure |
|-------|-------------|-------------|----------------|
| hive-executor | 3.2min | 87% | Path resolution errors |
| hive-verifier | 1.1min | 95% | N/A |
| hive-planner | 4.8min | 92% | Overly granular tasks |

## Session Trends

- Context compaction: avg 2.3x per session (healthy: <3x)
- Deviation rate: 18% of plans (down from 24% last week)
- User corrections: 1.2 per session (target: <1)
```

### 3.4 Rotation Policy

- **Trigger**: When `events.jsonl` exceeds 500KB
- **Action**: Rename to `events-{timestamp}.jsonl`, create fresh `events.jsonl`
- **Retention**: Keep last 10 archived files, delete older
- **INSIGHTS.md**: Always regenerated from all available event files (archived + current)

---

## 4. Data Flow Diagram

```
SESSION START
     |
     v
[SessionStart Hook] ──emit──> events.jsonl
     |                              ^
     v                              |
[Workflow runs]                     |
     |                              |
     +──[Gate / Checkpoint]──emit───+
     |                              |
     +──[Deviation detected]──emit──+
     |                              |
     +──[Agent spawned]             |
     |      |                       |
     |      v                       |
     |  [SubagentStop Hook]──emit───+
     |      |                       |
     |  [PostToolUseFailure]──emit──+
     |                              |
     +──[Verification run]──emit────+
     |                              |
     +──[User correction]──emit─────+
     |
     v
[PreCompact Hook] ──emit──> events.jsonl
     |
     v
SESSION END
     |
     v
[SessionEnd Hook] ──emit──> events.jsonl
     |
     v
[Optional: Transcript Analysis Agent]
     |                    |
     v                    v
session_summary ──> events.jsonl
                         |
                         v
              [telemetry digest]
                         |
                    +----+----+
                    |         |
                    v         v
            INSIGHTS.md   stats cache
                    |
                    v
            NEXT SESSION START
                    |
                    v
            [init injects INSIGHTS.md summary
             into agent context]
                    |
                    v
            AGENTS START WITH AWARENESS
            OF PAST PATTERNS
```

---

## 5. Implementation Phases

### Phase 1: Core Infrastructure (MVP Foundation)

**Goal**: Event storage, CLI commands, directory structure. No observers yet — just the backbone.

**New files to create**:
| File | Purpose |
|------|---------|
| `.planning/telemetry/events.jsonl` | Event store (created on first emit) |
| `.planning/telemetry/INSIGHTS.md` | Human-readable digest (created on first digest) |

**New hive-tools.js commands** (5 commands added to existing monolith):

```
telemetry emit <type> --data '{json}'    Append event to events.jsonl
telemetry query [--type X] [--since Y]   Query events with filters
telemetry digest                          Generate INSIGHTS.md from events
telemetry rotate                          Archive events.jsonl if over threshold
telemetry stats                           Quick summary: event counts, file sizes
```

**Config addition** (in `hive/templates/config.json`):
```json
{
  "telemetry": {
    "enabled": true,
    "hooks": true,
    "workflow_events": true,
    "transcript_analysis": false,
    "rotation_threshold_kb": 500,
    "max_archives": 10
  }
}
```

**Existing files to modify**:
| File | Change |
|------|--------|
| `hive/bin/hive-tools.js` | Add `telemetry` command group (~200 lines) |
| `hive/templates/config.json` | Add `telemetry` section |
| `.gitignore` | Add `.planning/telemetry/events*.jsonl` (events are local, INSIGHTS.md is committed) |

**Estimated scope**: ~250 lines of JS in hive-tools.js, 1 config change, 1 gitignore entry.

### Phase 2: Hook Observers

**Goal**: Automatic passive capture of agent lifecycle events. No workflow changes.

**New files to create**:
| File | Purpose |
|------|---------|
| `hooks/hive-recall-agent.js` | SubagentStop hook — logs agent completions |
| `hooks/hive-recall-error.js` | PostToolUseFailure hook — logs tool errors |
| `hooks/hive-recall-compact.js` | PreCompact hook — logs context pressure |
| `hooks/hive-recall-session.js` | SessionStart + SessionEnd — session boundaries |

**Each hook follows the same pattern** (example: SubagentStop):
```javascript
#!/usr/bin/env node
// Hive Recall — Agent completion observer
// Hook: SubagentStop | Async, fail-silent

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // Only log Hive agents (name starts with "hive-")
    const agentName = data.agent?.name || '';
    if (!agentName.startsWith('hive-')) return;

    const event = {
      ts: new Date().toISOString(),
      session: data.session_id || 'unknown',
      type: 'agent_completion',
      v: 1,
      data: {
        agent: agentName,
        duration_ms: data.duration_ms || null,
        exit_code: data.exit_code ?? 0,
        error: data.error || null
      }
    };

    const telemetryDir = path.join(process.cwd(), '.planning', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });

    const eventsFile = path.join(telemetryDir, 'events.jsonl');
    fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');
  } catch (e) {
    // Fail silent — observation never breaks execution
  }
});
```

**Existing files to modify**:
| File | Change |
|------|--------|
| `.claude/settings.json` | Register 4 new hooks (SubagentStop, PostToolUseFailure, PreCompact, SessionStart/SessionEnd) |
| `bin/install.js` | Add hook registration to installer (so `npx hive-cc` sets up hooks) |

**Hook registration** (added to `.claude/settings.json`):
```json
{
  "hooks": {
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/hive-recall-agent.js" }] }],
    "PostToolUseFailure": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/hive-recall-error.js" }] }],
    "PreCompact": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/hive-recall-compact.js" }] }],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/hive-check-update.js" }] },
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/hive-recall-session.js start" }] }
    ],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/hive-recall-session.js end" }] }]
  }
}
```

**Design constraints**:
- All hooks use `appendFileSync` (atomic, no corruption on concurrent writes)
- All hooks wrapped in try/catch with empty catch (fail-silent)
- All hooks filter for Hive-specific events (ignore non-Hive agents/tools)
- No spawned child processes — hooks execute inline, fast, synchronous

### Phase 3: Workflow Integration

**Goal**: Capture semantic events that hooks cannot see — deviations, checkpoints, verification outcomes.

**Approach**: Add single-line `telemetry emit` calls at strategic points in existing workflows.

**Files to modify with telemetry emit calls**:

| File | Event Type | Insertion Point |
|------|-----------|----------------|
| `hive/workflows/execute-plan.md` | `deviation` | After deviation detection in executor agent |
| `hive/workflows/execute-phase.md` | `checkpoint` | After each checkpoint resolution |
| `hive/workflows/verify-work.md` | `verification_gap` | When verification finds a gap at any level |
| `hive/workflows/plan-phase.md` | `plan_revision` | When plan is revised after plan-checker feedback |
| Any workflow with a gate | `user_correction` | When user modifies output at a confirmation gate |

**Example integration** (in execute-phase.md, after checkpoint handling):

```markdown
After resolving a checkpoint, record it:

```bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit checkpoint \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"checkpoint_type\":\"user_decision\",\"outcome\":\"${OUTCOME}\"}"
```
```

**Each emit call is**:
- A single bash line
- Wrapped in the workflow's existing bash block (no new blocks needed)
- Using data already available in the workflow's variables
- Non-blocking (the emit command returns immediately)

**Estimated scope**: ~15-20 single-line insertions across 5 workflow files.

### Phase 4: Digest and Feedback Loop

**Goal**: Transform raw events into actionable insights, inject them into agent context.

**New files to create**:
| File | Purpose |
|------|---------|
| `commands/hive/insights.md` | Slash command: `/hive:insights` |
| `hive/workflows/insights.md` | Workflow: generate + display insights |

**New hive-tools.js init command**:
```
init insights    All context for insights workflow + recent telemetry
```

**Feedback injection** (modify existing `init` commands):

The key modification: every `init` compound command that spawns agents now includes a `recall_context` field in its JSON output:

```json
{
  "recall_context": {
    "relevant_patterns": ["Executor tends to over-engineer error handling", "CSS verification gaps common"],
    "agent_performance": {"hive-executor": {"avg_duration": "3.2min", "success_rate": 0.87}},
    "session_trend": "deviation_rate_decreasing"
  }
}
```

Workflows that spawn agents pass this to the agent prompt as a `<recall>` block:

```markdown
<recall>
Patterns from previous sessions relevant to this work:
- Executor tends to over-engineer error handling — keep changes minimal and scoped to the plan
- CSS verification gaps are common — pay extra attention to styling changes
</recall>
```

**Files to modify for injection**:
| File | Change |
|------|--------|
| `hive/bin/hive-tools.js` | Add `recall_context` to init commands (read INSIGHTS.md, extract top patterns) |
| `hive/workflows/execute-phase.md` | Pass `<recall>` block to executor agents |
| `hive/workflows/verify-work.md` | Pass `<recall>` block to verifier agent |
| `hive/workflows/plan-phase.md` | Pass `<recall>` block to planner agents |

**User experience**:
- `/hive:insights` — on-demand: shows current INSIGHTS.md, option to regenerate
- At session start: if INSIGHTS.md exists and has content, display a 2-3 line summary
- Agents receive relevant recall context automatically (no user action needed)

### Phase 5: Advanced (Future)

**Goal**: Deep analysis, cross-project learning, auto-suggestions.

**Features** (each independently implementable):

1. **Transcript analysis agent**: A new `hive-recall-analyst` agent that reads the session transcript and produces `session_summary` events. Spawned optionally at session end.

2. **Cross-project insights**: Global INSIGHTS.md at `~/.claude/hive/INSIGHTS.md` aggregating patterns across all projects. The `telemetry digest --global` flag merges per-project insights.

3. **Auto-suggestions**: When deviation rate exceeds a threshold, `telemetry digest` generates concrete suggestions (e.g., "Consider adding a plan-checker gate before phase 3 execution").

4. **Hive evolution input**: The INSIGHTS.md format is designed to be machine-readable. Hive developers can use `telemetry stats --global` to identify systemic issues and prioritize Hive improvements.

---

## 6. MVP Scope

**Minimum viable system: Phase 1 + Phase 2 only.**

This gives immediate value with minimal effort:

| What you get | How |
|---|---|
| Agent completion tracking | SubagentStop hook (automatic) |
| Tool error tracking | PostToolUseFailure hook (automatic) |
| Context pressure tracking | PreCompact hook (automatic) |
| Session boundary tracking | SessionStart/SessionEnd hooks (automatic) |
| Event querying | `hive-tools.js telemetry query` |
| Basic insights | `hive-tools.js telemetry digest` |
| Storage management | `hive-tools.js telemetry rotate` |

**What you do NOT get yet** (deferred to Phase 3+):
- Semantic events (deviations, checkpoints, verification gaps)
- Feedback injection into agent prompts
- `/hive:insights` command
- Transcript analysis
- Cross-project learning

**MVP estimated cost**:
- ~250 lines in hive-tools.js (telemetry commands)
- 4 hook files (~50 lines each, ~200 total)
- 1 config section addition
- 1 settings.json update
- 1 installer update
- **Total: ~500 lines of new code, 0 dependencies**

---

## 7. Complete Integration Point Map

### New Files to Create

| Phase | File | Lines (est.) | Purpose |
|-------|------|-------------|---------|
| 2 | `hooks/hive-recall-agent.js` | ~50 | SubagentStop observer |
| 2 | `hooks/hive-recall-error.js` | ~40 | PostToolUseFailure observer |
| 2 | `hooks/hive-recall-compact.js` | ~35 | PreCompact observer |
| 2 | `hooks/hive-recall-session.js` | ~45 | Session boundary observer |
| 4 | `commands/hive/insights.md` | ~20 | Slash command dispatcher |
| 4 | `hive/workflows/insights.md` | ~80 | Insights workflow |
| 5 | `agents/hive-recall-analyst.md` | ~200 | Transcript analysis agent |

### Existing Files to Modify

| Phase | File | Change Description |
|-------|------|--------------------|
| 1 | `hive/bin/hive-tools.js` | Add `telemetry` command group (~250 lines) |
| 1 | `hive/templates/config.json` | Add `telemetry` section (8 lines) |
| 1 | `.gitignore` | Add `events*.jsonl` pattern (1 line) |
| 2 | `.claude/settings.json` | Register 4 hooks (15 lines) |
| 2 | `bin/install.js` | Add hook file copying + settings registration |
| 3 | `hive/workflows/execute-plan.md` | Add deviation emit (1 line) |
| 3 | `hive/workflows/execute-phase.md` | Add checkpoint emit (1-2 lines) |
| 3 | `hive/workflows/verify-work.md` | Add verification_gap emit (1-2 lines) |
| 3 | `hive/workflows/plan-phase.md` | Add plan_revision emit (1 line) |
| 4 | `hive/bin/hive-tools.js` | Add `recall_context` to init commands (~50 lines) |
| 4 | `hive/workflows/execute-phase.md` | Pass `<recall>` to executor agents (~5 lines) |
| 4 | `hive/workflows/verify-work.md` | Pass `<recall>` to verifier (~5 lines) |
| 4 | `hive/workflows/plan-phase.md` | Pass `<recall>` to planner (~5 lines) |

### New hive-tools.js Commands

| Command | Phase | Description |
|---------|-------|-------------|
| `telemetry emit <type> --data '{json}'` | 1 | Append event to JSONL |
| `telemetry query [--type X] [--since Y] [--limit N]` | 1 | Filter and retrieve events |
| `telemetry digest [--global]` | 1 | Generate INSIGHTS.md |
| `telemetry rotate` | 1 | Archive oversized event files |
| `telemetry stats` | 1 | Quick summary (counts, sizes, top types) |
| `init insights` | 4 | Context for insights workflow |

---

## 8. Design Principles (Non-Negotiable)

### P1: Zero Dependencies
No new npm packages. No SQLite. No databases. Just `fs`, `path`, and JSON. The previous intel system (v1.9.2) was removed because it introduced a 21MB SQLite dependency. We learned that lesson.

### P2: Async and Fail-Silent
Every hook and every `telemetry emit` call is wrapped in try/catch with an empty catch block. If telemetry fails, execution continues exactly as it would without Recall. Observation NEVER breaks execution.

### P3: File-Based Storage
JSONL for machine events. Markdown for human insights. Both stored in `.planning/telemetry/`. This follows Hive's existing file-on-disk communication model — no new storage paradigms.

### P4: Opt-In and Configurable
The entire system is controlled by `config.json` flags. Each tier can be independently enabled/disabled:
```json
"telemetry": {
  "enabled": true,       // Master switch — false disables everything
  "hooks": true,          // Tier 1
  "workflow_events": true, // Tier 2
  "transcript_analysis": false // Tier 3 (default off)
}
```

### P5: Lightweight by Design
- Events are append-only JSONL (no parsing, no indexing, just `appendFileSync`)
- Rotation keeps files small (500KB threshold)
- Digest runs on-demand, not automatically (except optional session-end)
- No background processes, no watchers, no daemons

### P6: Privacy-Aware
- Events contain metadata, not content (no user code, no file contents, no secrets)
- `events.jsonl` is gitignored by default (local-only telemetry)
- `INSIGHTS.md` is committed (shareable project wisdom)
- Users can `telemetry rotate --purge` to delete all event data

### P7: Fits Existing Architecture
- Uses hive-tools.js command pattern (same as all other Hive tools)
- Uses init injection pattern (same as all other workflow initialization)
- Uses hooks registration pattern (same as existing update checker and statusline)
- Uses `.planning/` for storage (same as all other Hive state)
- Uses agent-prompt-block pattern (`<recall>` block, like existing `<objective>`, `<context>`)

---

## 9. User Experience

### What the user sees at session start

When INSIGHTS.md exists and the session starts:

```
Hive Recall: 342 events across 14 sessions
Top pattern: executor deviation rate declining (24% -> 18%)
Run /hive:insights for full analysis
```

This is a 2-3 line informational message. Non-intrusive. Dismissable. Only shown if there are meaningful insights.

### How the user reviews insights

**Option A: `/hive:insights`** (on-demand)
```
> /hive:insights

# Hive Recall — Project Insights

Sessions analyzed: 14 | Events: 342 | Last updated: 10 min ago

## Top Patterns
1. Executor over-engineers error handling (5 occurrences)
2. CSS verification gaps (3 occurrences)
3. Context compaction averaging 2.3x per session

## Agent Scoreboard
| Agent | Success | Avg Time | Trend |
|-------|---------|----------|-------|
| executor | 87% | 3.2min | improving |
| verifier | 95% | 1.1min | stable |

[Regenerate] [Show raw events] [Clear data]
```

**Option B: Read INSIGHTS.md directly**
The file is in `.planning/telemetry/INSIGHTS.md` — standard markdown, readable in any editor.

**Option C: CLI query**
```bash
node hive-tools.js telemetry query --type deviation --since 7d
node hive-tools.js telemetry stats
```

### How insights feed into agents (invisible to user)

The user does nothing. When agents are spawned, the init command automatically includes relevant recall context. Agents see:

```
<recall>
Patterns from previous sessions:
- Keep error handling minimal and scoped to plan
- Double-check CSS changes — visual regressions have been missed before
- This phase's success rate historically: 85%
</recall>
```

This appears alongside the agent's existing `<objective>`, `<context>`, and `<constraints>` blocks.

---

## 10. Feedback Loops

### Loop 1: Per-Project Learning

```
Session N events → digest → INSIGHTS.md → Session N+1 agents read INSIGHTS.md
```

Agents in session N+1 start with awareness of session N patterns. This is the primary loop and delivers the most immediate value. It means:
- Executors who repeatedly deviate get explicit guidance to stay on-spec
- Verifiers who miss certain gap types get extra scrutiny areas
- Planners who create overly granular tasks get concreteness guidance

### Loop 2: Cross-Project Learning

```
Project A INSIGHTS.md  ─┐
Project B INSIGHTS.md  ──┼──> telemetry digest --global ──> ~/.claude/hive/INSIGHTS.md
Project C INSIGHTS.md  ─┘
```

Global insights identify patterns that repeat across projects (not project-specific). For example:
- "hive-executor fails 30% on projects with monorepo structure"
- "Phase research consistently underestimates API integration complexity"

Global insights feed into the init injection alongside project-specific ones.

### Loop 3: Meta — Hive Improves Hive

```
Aggregated INSIGHTS.md across many users
           |
           v
Hive developers read patterns
           |
           v
Adjust agent prompts, workflow logic, templates
           |
           v
New Hive version ships with improvements
```

The INSIGHTS.md format is designed to be actionable by both humans and AI. A Hive developer (or Hive itself via `/hive:new-project`) can read the insights and:
- Identify which agent prompts need refinement
- Find which workflow gates are too loose or too strict
- Discover which templates produce inadequate artifacts
- Quantify the impact of changes (before/after comparison via telemetry stats)

This creates a virtuous cycle: Hive observes its own performance → identifies weaknesses → ships fixes → measures improvement.

---

## 11. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Performance impact from hooks | Hooks use sync `appendFileSync` — single syscall, <1ms. Measured against existing statusline hook (similar pattern). |
| Storage bloat | 500KB rotation threshold + 10 archive max = 5MB ceiling. `telemetry rotate --purge` for full cleanup. |
| Stale insights | INSIGHTS.md is regenerated on each `telemetry digest` call. Timestamp shows freshness. |
| Over-engineering (repeating intel system mistake) | MVP is Phase 1+2 only: 500 lines, 0 deps, 6 files. Ship, measure, then decide on Phase 3+. |
| Breaking existing workflows | Phase 1-2 require ZERO workflow changes. Phase 3 additions are single-line, additive, and guarded by config flag. |
| Privacy concerns | Events contain metadata only (no code, no secrets). JSONL is gitignored. Purge command available. |

---

## 12. Success Metrics

How do we know Recall is working?

| Metric | Measurement | Target |
|--------|------------|--------|
| Deviation rate | `telemetry query --type deviation \| wc -l` / total plans | Decrease over time |
| Verification gap rate | verification_gap events / total verifications | Decrease over time |
| Agent success rate | agent_completion with exit_code 0 / total | Increase over time |
| Context efficiency | Avg compaction events per session | Stable or decreasing |
| User corrections | user_correction events per session | Decrease over time |
| Recall adoption | Sessions with telemetry enabled / total sessions | >80% after Phase 2 |

---

## 13. Implementation Recommendation

**Start with MVP (Phase 1 + Phase 2).** This delivers:
- Automatic, zero-effort data collection via hooks
- CLI tools for querying and analyzing data
- Basic insight generation

**Then evaluate**: After 2-3 weeks of real usage, review the collected data. If patterns are visible and actionable, proceed to Phase 3 (workflow integration) and Phase 4 (feedback injection). If not, the MVP still provides useful debugging telemetry at near-zero cost.

**Do NOT attempt all 5 phases at once.** The previous intel system failed because it was overbuilt. Recall succeeds by starting small and growing only when data proves the next tier is needed.

---

*This proposal was synthesized from three parallel research tracks analyzing Hive's architecture (47 observation points), data patterns (10 event types, JSONL model), and hook mechanisms (hybrid capture approach). It respects Hive's core constraints: zero dependencies, file-based communication, markdown-first, and observation-never-breaks-execution.*
