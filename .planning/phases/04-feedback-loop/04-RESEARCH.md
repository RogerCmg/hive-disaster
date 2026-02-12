# Phase 4: Feedback Loop - Research

**Researched:** 2026-02-11
**Domain:** Digest enhancement, recall context injection into agent prompts, slash command creation in Node.js monolith + markdown
**Confidence:** HIGH

## Summary

Phase 4 closes the observe-to-improve loop by (1) enhancing the existing Phase 1 digest command with pattern detection and trend analysis, (2) injecting a `recall_context` field into init command JSON output so workflows can pass `<recall>` blocks to spawned agents, and (3) creating a `/hive:insights` slash command for user-facing insight display. Two of the six requirements (FEED-05, FEED-06) are already satisfied by existing .gitignore rules.

The existing `cmdTelemetryDigest` function (hive-tools.js lines 4437-4576 in source) generates a basic INSIGHTS.md with event summary tables, agent performance, recent deviations, and tool errors. It is explicitly annotated with `*Phase 1 digest -- enhanced analysis available in Phase 4*`. The Phase 4 enhancement adds: recurring pattern detection (repeated deviation types, common tool errors), deviation trend analysis (improving/worsening over time), concrete recommendations derived from patterns, and a structured "Top Patterns" section that the init commands can parse and extract.

For recall injection, the init commands (`cmdInitExecutePhase`, `cmdInitPlanPhase`, `cmdInitQuick`, etc.) already return JSON objects that workflows parse. Adding a `recall_context` field to these JSON outputs is a straightforward extension. Workflows that spawn agents (execute-phase.md, plan-phase.md, quick.md, new-project.md, new-milestone.md, research-phase.md, verify-work.md, diagnose-issues.md, map-codebase.md, audit-milestone.md) then include this field as a `<recall>` block in the agent prompt. The injection point in execute-phase.md is between `</files_to_read>` and `<success_criteria>` in the Task() prompt (around line 448).

**Primary recommendation:** Enhance `cmdTelemetryDigest` with pattern detection, add a `recall_context` extraction helper that parses INSIGHTS.md for top patterns, inject this into all init commands, then modify 5-6 key workflows to pass `<recall>` blocks. Create `/hive:insights` as a lightweight command+workflow pair following the existing progress/check-todos pattern.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hive-tools.js` (source: `hive/bin/hive-tools.js`) | Current monolith | All digest, init, and telemetry logic lives here | Established pattern -- all CLI logic is in this single file |
| Node.js `fs` | stdlib | Read events.jsonl, write INSIGHTS.md, read INSIGHTS.md for recall | Zero-dep requirement; already used throughout |
| Node.js `path` | stdlib | Path construction | Already used for all path operations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Markdown workflow files (`hive/workflows/*.md`) | Current | Agent prompt templates where `<recall>` blocks are injected | Every workflow that spawns agents |
| Command files (`commands/hive/*.md`) | Current | Slash command definition for `/hive:insights` | New command creation |
| `JSON.parse()` / `JSON.stringify()` | native | Parse events.jsonl lines, format JSON output | Every digest and init operation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Parse INSIGHTS.md for recall context | Store patterns in separate JSON file | Simpler to parse JSON, but adds another file to manage. Better to use a structured section in INSIGHTS.md that can be parsed with a simple regex, keeping the single-file-of-truth pattern. |
| Inject recall in every init command | Create a dedicated `init recall` command | Separate command means workflows need two init calls. Adding recall_context to existing init JSON is one call, one parse. Use existing init pattern. |
| Complex NLP pattern detection | Simple frequency/counting heuristics | Claude agents reading the recall block will do the "intelligence". The digest just needs to surface top-frequency patterns, trends, and recent data. Simple counting is sufficient and reliable. |

**Installation:**
```bash
# No installation needed -- modifications to existing files only
# hive-tools.js telemetry and init infrastructure already exists from Phase 1
```

## Architecture Patterns

### Recommended Modification Structure
```
hive/
  bin/hive-tools.js              # MODIFIED: Enhanced digest, recall context helper, init commands
  workflows/
    execute-phase.md             # MODIFIED: Add <recall> block to executor Task() prompts
    plan-phase.md                # MODIFIED: Add <recall> block to researcher/planner prompts
    quick.md                     # MODIFIED: Add <recall> to planner/executor prompts
    new-project.md               # MODIFIED: Add <recall> to researcher prompts
    new-milestone.md             # MODIFIED: Add <recall> to researcher prompts
    research-phase.md            # MODIFIED: Add <recall> to researcher prompt
    verify-work.md               # MODIFIED: Add <recall> to verifier/planner prompts
    diagnose-issues.md           # MODIFIED: Add <recall> to debugger prompts
    audit-milestone.md           # MODIFIED: Add <recall> to checker prompts
    map-codebase.md              # MODIFIED: Add <recall> to mapper prompts
commands/hive/
  insights.md                    # NEW: /hive:insights slash command
hive/workflows/
  insights.md                    # NEW: Insights workflow logic
.claude/hive/workflows/          # MUST MIRROR: Installed copies must match source
.claude/commands/hive/           # MUST MIRROR: Installed copies must match source
```

### Pattern 1: Enhanced Digest with Structured Top Patterns Section
**What:** The digest command produces INSIGHTS.md with a machine-parseable `## Top Patterns` section that the recall helper can extract
**When to use:** In `cmdTelemetryDigest` (replacing the Phase 1 implementation)
**Example:**
```markdown
## Top Patterns

<!-- recall-start -->
- PATTERN: Deviation type "missing-import" recurs 5 times across phases 2-3. Auto-check imports after file creation.
- PATTERN: Tool "Write" fails 3 times with "file not found". Verify parent directory exists before writing.
- PATTERN: Agent hive-executor averages 45s. Plans with >5 tasks take 2x longer.
- TREND: Deviations decreasing: 8 in phase 1, 3 in phase 2, 1 in phase 3.
- REC: Run verification after each task, not just at plan end.
<!-- recall-end -->
```

**Key design:** The `<!-- recall-start -->` and `<!-- recall-end -->` markers make it trivial to extract the patterns section with a regex, without parsing the full markdown structure. Each pattern is a single line prefixed with a category tag (PATTERN, TREND, REC).

### Pattern 2: Recall Context Extraction Helper
**What:** A function `getRecallContext(cwd)` that reads INSIGHTS.md, extracts the recall-start/recall-end block, and returns it as a string
**When to use:** Called by every init command that feeds agent-spawning workflows
**Example:**
```javascript
function getRecallContext(cwd) {
  const insightsPath = path.join(cwd, '.planning', 'telemetry', 'INSIGHTS.md');
  const content = safeReadFile(insightsPath);
  if (!content) return null;

  const match = content.match(/<!-- recall-start -->\n([\s\S]*?)<!-- recall-end -->/);
  if (!match) return null;

  const patterns = match[1].trim();
  if (!patterns || patterns === '') return null;

  return patterns;
}
```

### Pattern 3: Init Command Recall Injection
**What:** Every init command that serves agent-spawning workflows includes `recall_context` in its JSON output
**When to use:** `cmdInitExecutePhase`, `cmdInitPlanPhase`, `cmdInitQuick`, `cmdInitNewProject`, `cmdInitNewMilestone`, `cmdInitResume`, `cmdInitVerifyWork`, `cmdInitPhaseOp`, `cmdInitMapCodebase`
**Example:**
```javascript
// In each init command, after building the result object:
result.recall_context = getRecallContext(cwd);
```

Workflows then use it:
```bash
RECALL=$(echo "$INIT" | jq -r '.recall_context // empty')
```

### Pattern 4: Recall Block in Agent Prompts
**What:** Workflows pass a `<recall>` block in Task() prompts when recall_context is non-empty
**When to use:** Every Task() spawn in every workflow
**Example:**
```markdown
# In workflow markdown, after extracting RECALL from INIT JSON:

If RECALL is non-empty, include in the Task() prompt:

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
```

**Placement:** After `</files_to_read>` and before `<success_criteria>` in executor prompts. After `</additional_context>` in researcher/planner prompts. The exact position varies by workflow but should be near the end of the prompt so it acts as supplementary context, not primary instruction.

### Pattern 5: Slash Command + Workflow Pair
**What:** `/hive:insights` = command file (thin dispatcher) + workflow file (logic)
**When to use:** New command creation
**Example command file:**
```markdown
---
name: hive:insights
description: Display current project insights and optionally regenerate the digest
allowed-tools:
  - Read
  - Bash
  - Write
---
<objective>
Display current telemetry insights and offer to regenerate the digest.
</objective>

<execution_context>
@./.claude/hive/workflows/insights.md
</execution_context>

<process>
Execute the insights workflow from @./.claude/hive/workflows/insights.md end-to-end.
</process>
```

### Anti-Patterns to Avoid
- **Stuffing entire INSIGHTS.md into agent prompts:** Too much context. Extract only the Top Patterns section (5-10 lines max). Agents need actionable signals, not full reports.
- **Making recall injection conditional on telemetry config:** The recall block is read-only (reading INSIGHTS.md). Even if telemetry emission is disabled, previously generated insights should still be used. Only skip if INSIGHTS.md doesn't exist.
- **Generating digest on every init call:** The digest is computationally non-trivial (parses all events). Generate it only when explicitly requested (via `telemetry digest` or `/hive:insights`). Init commands just read the already-generated INSIGHTS.md.
- **Hard-coding pattern detection rules:** Use frequency-based detection (count occurrences, rank by frequency) rather than hard-coded rules. The event types and patterns will evolve as more phases add events.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown parsing | Custom full markdown parser | Regex with comment markers (`<!-- recall-start -->`) | INSIGHTS.md is generated by us. We control the format. Simple markers are reliable and fast. |
| Pattern detection | ML/NLP text analysis | Frequency counting + time-window comparison | The patterns are structured events with known fields. Counting deviation_type frequencies and comparing time windows is sufficient. |
| Agent prompt templating | Dynamic template engine | String concatenation in markdown | Workflows already use simple string interpolation (`{RECALL}`, `{phase_dir}`). No need for a templating library. |
| INSIGHTS.md format | Custom binary format | Markdown with structured sections | Human-readable, git-committable, diffable. The project already uses markdown for all planning artifacts. |

**Key insight:** The "intelligence" in the feedback loop comes from Claude agents interpreting the patterns, not from complex analysis code. The digest just needs to surface frequency data, trends, and recent events in a clear format. Keep the code simple; let the AI do the reasoning.

## Common Pitfalls

### Pitfall 1: Recall Block Bloat
**What goes wrong:** Too much context in the recall block overwhelms the agent prompt, diluting important instructions
**Why it happens:** Tempting to include all insights, all patterns, all recommendations
**How to avoid:** Cap recall block at 10 lines / ~500 characters. Extract only top 5 patterns ranked by frequency and recency. Use the `<!-- recall-start/end -->` markers to bound exactly what gets extracted.
**Warning signs:** Agent prompts exceeding 2000 tokens just from recall context; agents ignoring recall patterns because they're buried in noise

### Pitfall 2: Stale INSIGHTS.md
**What goes wrong:** INSIGHTS.md was generated weeks ago, events.jsonl has thousands of new events, but agents keep getting outdated patterns
**Why it happens:** Digest is only regenerated on explicit request, not automatically
**How to avoid:** In the `/hive:insights` workflow, show the INSIGHTS.md generation timestamp. If older than the latest event in events.jsonl, suggest regeneration. Don't auto-regenerate (expensive), but surface staleness visually. Include generation timestamp in init JSON output as `recall_generated_at`.
**Warning signs:** INSIGHTS.md date is weeks before current date; events.jsonl has grown significantly since last digest

### Pitfall 3: Dual-File Synchronization
**What goes wrong:** Source files (`hive/workflows/*.md`) and installed files (`.claude/hive/workflows/*.md`) diverge
**Why it happens:** Developer modifies source but forgets to copy to .claude/, or vice versa
**How to avoid:** The plan should explicitly list BOTH paths for every modified workflow file. Use the same pattern as Phase 3 plans where `files_modified` includes both `hive/workflows/X.md` and `.claude/hive/workflows/X.md`. For new files (insights command/workflow), create in both locations.
**Warning signs:** Tests pass on source but `/hive:insights` command doesn't work because .claude/ copy is missing

### Pitfall 4: Init Command Omission
**What goes wrong:** Some init commands get `recall_context` but others are missed, causing inconsistent agent experience
**Why it happens:** There are 12 init commands and it's easy to forget one
**How to avoid:** The enhanced `getRecallContext(cwd)` function is called in every init command. Enumerate all: `cmdInitExecutePhase`, `cmdInitPlanPhase`, `cmdInitQuick`, `cmdInitNewProject`, `cmdInitNewMilestone`, `cmdInitResume`, `cmdInitVerifyWork`, `cmdInitPhaseOp`, `cmdInitMapCodebase`, `cmdInitMilestoneOp`, `cmdInitProgress`, `cmdInitTodos`. Some (like progress and todos) don't spawn agents and may not need recall, but including it is harmless and future-proof.
**Warning signs:** One workflow's agents get recall, another's don't

### Pitfall 5: JSON Escaping in Recall Block
**What goes wrong:** Recall context contains quotes or special characters that break JSON when embedded in Task() prompts
**Why it happens:** INSIGHTS.md patterns may contain quotes, backticks, or special chars from event data
**How to avoid:** The recall block is extracted and passed as a markdown block in the prompt, not as JSON data. Workflows already handle multi-line strings in Task() prompts. The recall section uses simple dash-prefixed lines without JSON embedding. The init command returns it as a plain string field in JSON (properly escaped by JSON.stringify).
**Warning signs:** Task() prompts failing to parse; agent receiving corrupted recall context

### Pitfall 6: Empty/Missing Events
**What goes wrong:** Digest generates a file with empty tables and "None recorded" everywhere, then agents get a useless recall block
**Why it happens:** New project with no events yet, or all events were rotated
**How to avoid:** Return `recall_context: null` when INSIGHTS.md doesn't exist OR when it contains no patterns (the recall-start/recall-end section is empty). Workflows check for non-empty recall before including the `<recall>` block. The existing "No events recorded yet" stub in digest already handles the empty case.
**Warning signs:** Agents receiving `<recall>` blocks that say "No events recorded"

## Code Examples

Verified patterns from the existing codebase:

### Enhanced Digest: Pattern Detection Logic
```javascript
// Recurring pattern detection (deviation types)
const deviationTypes = {};
events.filter(e => e.type === 'deviation' && e.data).forEach(e => {
  const dtype = e.data.deviation_type || e.data.description || 'unknown';
  if (!deviationTypes[dtype]) deviationTypes[dtype] = { count: 0, phases: new Set() };
  deviationTypes[dtype].count++;
  if (e.data.phase) deviationTypes[dtype].phases.add(e.data.phase);
});

// Tool error frequency
const toolErrorFreq = {};
events.filter(e => e.type === 'tool_error' && e.data).forEach(e => {
  const key = (e.data.tool || 'unknown') + ':' + (e.data.error_type || 'error');
  toolErrorFreq[key] = (toolErrorFreq[key] || 0) + 1;
});

// Deviation trend (compare first half vs second half of events)
const deviationEvents = events.filter(e => e.type === 'deviation');
const mid = Math.floor(deviationEvents.length / 2);
const firstHalf = deviationEvents.slice(0, mid).length;
const secondHalf = deviationEvents.slice(mid).length;
const trend = secondHalf < firstHalf ? 'decreasing' : secondHalf > firstHalf ? 'increasing' : 'stable';
```

### Recall Context in Init Command (follows existing loadConfig pattern)
```javascript
// In cmdInitExecutePhase, after building result object:
result.recall_context = getRecallContext(cwd);
result.recall_generated_at = getRecallTimestamp(cwd); // optional: for staleness detection
```

### Workflow Recall Injection (follows existing prompt construction)
```markdown
# In execute-phase.md Task() prompt, after </files_to_read>:

{If RECALL is non-empty:}
       <recall>
       Past project patterns from telemetry:
       {RECALL}
       Use these patterns to avoid known issues and follow proven approaches.
       </recall>
```

### Slash Command Pattern (follows progress.md exactly)
```markdown
---
name: hive:insights
description: Display current telemetry insights and offer to regenerate digest
allowed-tools:
  - Read
  - Bash
  - Write
---
<objective>
Display current project insights, show pattern summary, offer to regenerate.
</objective>

<execution_context>
@./.claude/hive/workflows/insights.md
</execution_context>

<process>
Execute the insights workflow from @./.claude/hive/workflows/insights.md end-to-end.
</process>
```

### Insights Workflow Pattern (follows progress.md structure)
```markdown
<purpose>
Display current telemetry insights, show staleness, offer to regenerate digest.
</purpose>

<process>
<step name="load_insights">
Read .planning/telemetry/INSIGHTS.md if it exists.
If not: "No insights generated yet. Run `hive-tools.js telemetry digest` to generate."
</step>

<step name="display">
Show: generation date, event count, top patterns, agent performance table,
deviation trends, recommendations. Use branded Hive formatting.
</step>

<step name="staleness_check">
Compare INSIGHTS.md generation timestamp with latest event in events.jsonl.
If stale (>24h newer events exist): "Insights may be outdated. Regenerate?"
</step>

<step name="offer_regenerate">
If user says yes: run `node ./.claude/hive/bin/hive-tools.js telemetry digest`
Display updated insights.
</step>
</process>
```

## State of the Art

| Old Approach (Phase 1) | Current Approach (Phase 4) | What Changed | Impact |
|------------------------|---------------------------|--------------|--------|
| Basic count tables only | Pattern detection + trends + recommendations | Phase 4 enhancement | Agents get actionable patterns instead of raw counts |
| No recall injection | `recall_context` in all init commands | New capability | Every spawned agent gets past project patterns |
| No user-facing insights command | `/hive:insights` slash command | New command | Users can view and regenerate insights interactively |
| `*Phase 1 digest*` footer | Full enhanced digest | Footer removed | Digest is complete, not a placeholder |

**Completed in prior phases:**
- JSONL storage engine, event envelope, emit/query/stats/rotate (Phase 1)
- Hook observers for agent_completion, tool_error, context_compaction, session_boundary (Phase 2)
- Workflow event emits for deviation, checkpoint, user_correction, verification_gap, plan_revision (Phase 3)
- .gitignore rules for events.jsonl (FEED-05 already satisfied)
- INSIGHTS.md not gitignored (FEED-06 already satisfied, will be committed when generated)

## Requirement-to-Implementation Mapping

| Requirement | Implementation | Files Modified |
|-------------|----------------|----------------|
| FEED-01: Enhanced digest | Replace `cmdTelemetryDigest` with pattern detection, trend analysis, Top Patterns section, recommendations | `hive/bin/hive-tools.js` |
| FEED-02: `recall_context` in init JSON | Add `getRecallContext()` helper, call in all init commands | `hive/bin/hive-tools.js` |
| FEED-03: `<recall>` block in agent prompts | Modify 10 workflow files to conditionally include `<recall>` block in Task() prompts | `hive/workflows/*.md` + `.claude/hive/workflows/*.md` |
| FEED-04: `/hive:insights` command | New command file + workflow file pair | `commands/hive/insights.md` + `hive/workflows/insights.md` |
| FEED-05: events.jsonl gitignored | Already done in Phase 1 | `.gitignore` (no change needed) |
| FEED-06: INSIGHTS.md committed to git | Already not gitignored; digest writes to `.planning/telemetry/INSIGHTS.md` | No change needed |

## Plan Split Recommendation

The three-plan split from the roadmap is sound:

### Plan 04-01: Enhanced Digest (FEED-01, FEED-05, FEED-06)
**Scope:** Replace `cmdTelemetryDigest` in `hive/bin/hive-tools.js` with enhanced pattern detection. Add recurring patterns, deviation trends, agent performance analysis, concrete recommendations, and the `<!-- recall-start/end -->` markers to INSIGHTS.md. FEED-05 and FEED-06 are already satisfied; verify they remain so.
**Files:** `hive/bin/hive-tools.js`, `hive/bin/hive-tools.test.js` (new tests)
**Wave:** 1 (no dependencies within Phase 4)

### Plan 04-02: Recall Injection (FEED-02, FEED-03)
**Scope:** Add `getRecallContext()` helper to hive-tools.js. Add `recall_context` to all init commands (FEED-02). Modify 10 workflow files to pass `<recall>` blocks to agents (FEED-03).
**Files:** `hive/bin/hive-tools.js`, 10x `hive/workflows/*.md` + their `.claude/hive/workflows/*.md` mirrors
**Wave:** 2 (depends on 04-01 for the recall-start/end markers in INSIGHTS.md)

### Plan 04-03: /hive:insights Command (FEED-04)
**Scope:** Create command file and workflow file. Display current insights, check staleness, offer regeneration.
**Files:** `commands/hive/insights.md` + `hive/workflows/insights.md` + `.claude/` mirrors
**Wave:** 2 (depends on 04-01 for the enhanced INSIGHTS.md format, parallel with 04-02)

**Alternative:** Plans 04-02 and 04-03 could be wave 1 alongside 04-01 since they only need INSIGHTS.md to exist (which it may or may not). However, making them wave 2 ensures the enhanced format is in place when recall extraction is tested.

## Open Questions

1. **How many patterns to include in recall block?**
   - What we know: Too many = noise. Too few = might miss important ones.
   - Recommendation: Default to 5 patterns max, sorted by frequency * recency. Configurable later if needed. Start with 5.

2. **Should recall injection be gated by a config toggle?**
   - What we know: Telemetry has `enabled`, `hooks`, `workflow_events` toggles already.
   - Recommendation: No separate toggle. Recall is reading already-generated data, not emitting new events. If INSIGHTS.md exists with patterns, use them. If the user doesn't want recall, they simply don't generate a digest. Adding another toggle increases complexity for minimal benefit.

3. **Which init commands truly need recall_context?**
   - What we know: 12 init commands exist. Some serve agent-spawning workflows, some serve display-only workflows.
   - Recommendation: Add to all init commands that serve workflows which spawn Task() agents: `execute-phase`, `plan-phase`, `quick`, `new-project`, `new-milestone`, `verify-work`, `map-codebase`. Skip display-only commands: `progress`, `todos`, `resume` (resume itself doesn't spawn agents -- it routes to other workflows). Including in `phase-op` and `milestone-op` is optional but harmless.

## Sources

### Primary (HIGH confidence)
- `hive/bin/hive-tools.js` (source file) -- Examined: cmdTelemetryDigest (lines 4437-4576), all init commands (3565-4052), telemetry helpers (483-565), CLI router (4999-5025), VALID_EVENT_TYPES, loadConfig
- `hive/workflows/execute-phase.md` -- Examined: Task() prompt structure (lines 427-457), standalone mode, team mode
- `hive/workflows/plan-phase.md` -- Examined: researcher Task() spawn (lines 112-117), planner Task() spawns
- `hive/workflows/execute-plan.md` -- Examined: Pattern A/B/C routing, deviation emit pattern (Phase 3 additions)
- `.gitignore` -- Verified: events.jsonl and events-*.jsonl are gitignored; INSIGHTS.md is NOT gitignored
- `commands/hive/progress.md` -- Examined: Slash command file structure pattern
- `hive/workflows/progress.md` -- Examined: Workflow structure pattern, init command usage

### Secondary (MEDIUM confidence)
- Build process (`scripts/build-hooks.js`, `bin/install.js`) -- Verified: source `hive/` is copied to `.claude/hive/` during installation; `commands/hive/` is copied to `.claude/commands/hive/`

### Tertiary (LOW confidence)
- None. All findings are verified against source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All modifications use existing patterns in a codebase we fully examined
- Architecture: HIGH -- Every file touched, every insertion point, every pattern follows established conventions
- Pitfalls: HIGH -- Identified from direct codebase analysis (dual-file sync, init omission, bloat) not speculation

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable -- no external dependencies, all internal codebase)
