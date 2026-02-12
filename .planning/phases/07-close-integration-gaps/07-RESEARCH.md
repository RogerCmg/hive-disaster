# Phase 7: Close Integration Gaps - Research

**Researched:** 2026-02-12
**Domain:** Internal codebase integration (no external dependencies)
**Confidence:** HIGH

## Summary

Phase 7 closes three integration gaps identified by the v1.0 milestone audit. All three are localized fixes to existing files with no new dependencies, no new architecture, and no external library research needed. The scope is entirely internal: one function enhancement in `hive-tools.js`, one recall injection in `execute-plan.md`, and one checkbox update in `REQUIREMENTS.md`.

The primary risk is not the fixes themselves (all are straightforward) but maintaining synchronization between source files (`hive/`) and installed copies (`.claude/hive/`). Every modification to `hive-tools.js` and `execute-plan.md` must be mirrored to the installed copy, and the Phase 4 verification report confirms this dual-file pattern is already established across the codebase.

**Primary recommendation:** Treat all three items as a single plan with three tasks, since they are independent but share a verification scope (the E2E Flow 2 pipeline).

## Standard Stack

### Core

No new libraries. All changes are to existing files using existing patterns.

| File | Purpose | Change Scope |
|------|---------|--------------|
| `hive/bin/hive-tools.js` | CLI utility (monolithic, ~5400 lines) | ~15 lines added to `cmdTelemetryDigest` function |
| `hive/workflows/execute-plan.md` | Plan execution workflow (markdown) | ~8 lines added for recall extraction + injection |
| `.planning/REQUIREMENTS.md` | Requirements tracking (markdown) | 24 checkbox flips `[ ]` to `[x]` |

### Supporting

| File | Purpose | Change Required |
|------|---------|-----------------|
| `.claude/hive/bin/hive-tools.js` | Installed copy of hive-tools.js | Must be synced after source changes |
| `.claude/hive/workflows/execute-plan.md` | Installed copy of execute-plan.md | Must be synced after source changes |

### Alternatives Considered

None. These are gap-closure fixes to existing code, not design decisions.

## Architecture Patterns

### Pattern 1: Event Type Processing in cmdTelemetryDigest

**What:** The digest function at line 4678 of `hive-tools.js` processes events by type using filter-then-aggregate. Each event type has its own processing block.
**Confidence:** HIGH (verified by reading source code directly)

**Current processing blocks (lines 4750-4808):**
1. **Deviation types** (line 4752-4759): `events.filter(e => e.type === 'deviation')` -- aggregates by deviation_type, counts per phase
2. **Tool error frequency** (line 4761-4766): `events.filter(e => e.type === 'tool_error')` -- aggregates by tool:error_type key
3. **Verification gaps** (line 4768-4773): `events.filter(e => e.type === 'verification_gap')` -- counts by level
4. **Checkpoint outcomes** (line 4775-4780): `events.filter(e => e.type === 'checkpoint')` -- counts by outcome
5. **Deviation trend** (line 4782-4790): first-half vs second-half comparison

**Missing:** `session_summary` events are never filtered or processed in this section.

**session_summary event data structure** (from `analyze-session.md` lines 99-116):
```json
{
  "quality_score": 0-100,
  "waste_pct": 0-100,
  "patterns": ["string array, max 5"],
  "recommendations": ["string array, max 3"],
  "user_preferences": ["string array, max 3"],
  "metrics": {
    "user_turns": number,
    "assistant_turns": number,
    "total_input_tokens": number,
    "total_output_tokens": number,
    "tool_uses": { "tool_name": count }
  }
}
```

**What the fix needs to do:**
1. Extract session analysis patterns from `session_summary` events (recurring `patterns` and `recommendations` fields)
2. Feed those into the `allPatternItems` array (line 4814) so they compete with deviations/tool errors for the Top Patterns recall slots
3. Optionally add a `## Session Analysis` markdown section (for human readability in INSIGHTS.md)
4. Optionally feed session recommendations into the `recommendations` array (line 4793) for recall

**Key constraint:** Top Patterns is capped at 5 lines (line 4837). Session analysis items must compete with deviations/tool errors on frequency, not get their own reserved slots.

### Pattern 2: Recall Injection in Workflows

**What:** All 10 agent-spawning workflows follow an identical 3-step pattern for recall injection.
**Confidence:** HIGH (verified across 10 workflow files)

**Step 1 - Extract** (in `init_context` or equivalent step):
```bash
RECALL=$(echo "$INIT" | jq -r '.recall_context // empty')
```

**Step 2 - Conditional include** (in Task() prompt):
```
{If RECALL is non-empty, include this block:}
```

**Step 3 - Inject** (inside Task() prompt):
```markdown
<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
```

**execute-plan.md's current state:**
- Uses `init execute-phase` which DOES return `recall_context` (verified at line 3970 of hive-tools.js)
- Does NOT extract RECALL from init JSON (line 18 shows init call, no RECALL extraction follows)
- Spawns agents in Pattern A (line 84), Pattern B (line 132), and team modes (lines 96-103)
- All spawn points need recall blocks

**Where to add recall extraction:** After line 21 (Extract from init JSON), before the `identify_plan` step.

**Where to add recall blocks:** In Pattern A's Task() prompt description, Pattern B's subagent prompt, and both team mode patterns. Note: execute-plan.md describes patterns in prose, not as full code blocks. The recall injection must match the existing prose style.

### Pattern 3: REQUIREMENTS.md Checkbox Updates

**What:** The requirements file has two sections with checkbox state: the requirement list (lines 12-60) and the traceability table (lines 89-124).
**Confidence:** HIGH (verified by reading REQUIREMENTS.md directly)

**Current state:**
- Lines 12-21 (INFRA section): All `[x]` -- correct
- Lines 25-31 (HOOK section): All `[ ]` -- should be `[x]` (Phase 2 verified PASSED)
- Lines 35-39 (WFLOW section): All `[ ]` -- should be `[x]` (Phase 3 verified PASSED)
- Lines 43-48 (FEED section): All `[ ]` -- should be `[x]` (Phase 4 verified PASSED)
- Lines 52-54 (INST section): All `[ ]` -- should be `[x]` (Phase 5 verified PASSED)
- Lines 58-60 (TRANS section): All `[ ]` -- should be `[x]` (Phase 6 verified PASSED)
- Lines 89-124 (Traceability table): Phases 2-6 show "Pending" -- should show "Done" with checkmark

**Source of truth for status:** 6 verification reports, all with `status: passed`:
- `.planning/phases/01-core-infrastructure/01-VERIFICATION.md` -- passed
- `.planning/phases/02-hook-observers/02-VERIFICATION.md` -- passed
- `.planning/phases/03-workflow-integration/03-VERIFICATION.md` -- passed
- `.planning/phases/04-feedback-loop/04-VERIFICATION.md` -- passed
- `.planning/phases/05-installation-integration/05-VERIFICATION.md` -- passed
- `.planning/phases/06-transcript-analysis/06-VERIFICATION.md` -- passed

The audit report confirms "34/34 requirements satisfied" and the traceability table itself says "Done" for INFRA but "Pending" for all others despite verified completion.

### Anti-Patterns to Avoid

- **Breaking the 5-line recall cap:** Do not give session_summary its own reserved recall slots. It must compete on frequency like all other pattern types.
- **Modifying source but forgetting installed copy:** Both `hive-tools.js` and `execute-plan.md` have installed copies under `.claude/hive/` that must be kept in sync.
- **Changing digest version number without reason:** The current digest is v2. Adding session_summary processing is an enhancement, not a schema change. Keep v2 unless the output structure changes incompatibly.
- **Over-engineering the session_summary processing:** The audit estimates ~15 lines. Aim for that. Extract recurring patterns/recommendations, feed them into the existing `allPatternItems` and `recommendations` arrays.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pattern frequency counting | New data structure | Existing `allPatternItems` array pattern (line 4814) | Consistency with deviation/tool error processing |
| Recall extraction logic | New extraction method | Existing `RECALL=$(echo "$INIT" \| jq -r '.recall_context // empty')` pattern | 10 workflows already use this exact pattern |
| Checkbox status determination | Manual audit | Read from 6 VERIFICATION.md files (all `status: passed`) | Verification reports are the authoritative source |

**Key insight:** Every solution for this phase already has an existing pattern in the codebase. The entire phase is "follow the existing pattern in the one place it was missed."

## Common Pitfalls

### Pitfall 1: Source/Installed Copy Desync

**What goes wrong:** Modifying `hive/bin/hive-tools.js` but not `.claude/hive/bin/hive-tools.js` (or vice versa for workflows).
**Why it happens:** The project has a dual-file architecture where source files under `hive/` are the authoring copies and files under `.claude/hive/` are the runtime copies read by Claude Code.
**How to avoid:** After every modification to a source file, copy it to the installed location. The Phase 4 verification report (line 51) explicitly verified "All 10 installed copies have identical line counts and recall patterns as source files."
**Warning signs:** `wc -l` mismatch between source and installed copy.

### Pitfall 2: Recall Block in Wrong Location

**What goes wrong:** Putting the recall block inside `<execution_context>` or other structural tags instead of at the top level of the Task() prompt.
**Why it happens:** execute-plan.md has complex nested prompt structures with multiple XML tags.
**How to avoid:** Follow the exact pattern from other workflows (e.g., `quick.md` lines 104-110, `execute-phase.md` lines 190-196): the `<recall>` block goes at the Task() prompt level, after other context blocks, before `</success_criteria>` or the closing quote.
**Warning signs:** Recall patterns not appearing in spawned agents' context.

### Pitfall 3: Overcomplicating session_summary Processing

**What goes wrong:** Adding an entirely new markdown section, new recall markers, or new processing pipeline instead of feeding into existing structures.
**Why it happens:** session_summary has rich data (quality_score, waste_pct, patterns, recommendations, user_preferences, metrics). The temptation is to surface all of it.
**How to avoid:** The goal is simple: session analysis patterns should reach the Top Patterns recall markers. That means feeding into `allPatternItems` and `recommendations`. A separate `## Session Analysis` markdown section is acceptable for human readability but the recall pipeline works through Top Patterns only.
**Warning signs:** More than ~20 lines of new code.

### Pitfall 4: REQUIREMENTS.md Last-Updated Date

**What goes wrong:** Updating checkboxes but leaving the "Last updated" line (line 133) stale at "2026-02-12 after Phase 1 completion."
**Why it happens:** It is at the bottom of the file and easy to miss.
**How to avoid:** Update the last-updated line to reflect Phase 7 gap closure.

## Code Examples

### Example 1: session_summary Processing Block (to add after line 4780)

Based on the existing deviation/tool error processing pattern:

```javascript
// Session analysis patterns (from session_summary events)
const sessionPatterns = {};
const sessionRecs = {};
events.filter(e => e.type === 'session_summary' && e.data).forEach(e => {
  const patterns = e.data.patterns || [];
  patterns.forEach(p => { sessionPatterns[p] = (sessionPatterns[p] || 0) + 1; });
  const recs = e.data.recommendations || [];
  recs.forEach(r => { sessionRecs[r] = (sessionRecs[r] || 0) + 1; });
});
```

Then feed into existing `allPatternItems` (after line 4820):
```javascript
Object.entries(sessionPatterns).forEach(([pattern, count]) => {
  allPatternItems.push({ type: 'SESSION', label: pattern + ' (seen in ' + count + ' sessions)', freq: count });
});
```

And feed into recommendations (after line 4808):
```javascript
Object.entries(sessionRecs).forEach(([rec, count]) => {
  if (count >= 2) {
    recommendations.push('Session analysis: "' + rec + '" (' + count + ' sessions)');
  }
});
```

**Source:** Pattern follows existing deviation processing at lines 4752-4759 and allPatternItems push at lines 4815-4820.

### Example 2: Recall Extraction in execute-plan.md (to add after line 21)

```markdown
Extract recall context for agent prompts:
```bash
RECALL=$(echo "$INIT" | jq -r '.recall_context // empty')
```
```

**Source:** Identical pattern used in 10 other workflows. Verified in `execute-phase.md` lines 24-26, `quick.md` lines 36-38, `plan-phase.md` lines 23-25.

### Example 3: Recall Block in Pattern A Description (to add in Task() prompt)

```markdown
{If RECALL is non-empty, include this block:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
```

**Source:** Identical block used in `execute-phase.md` lines 190-196, `quick.md` lines 104-110.

### Example 4: REQUIREMENTS.md Checkbox Fix

Change pattern (repeated 24 times):
```markdown
# Before
- [ ] **HOOK-01**: SubagentStop hook logs agent completions...

# After
- [x] **HOOK-01**: SubagentStop hook logs agent completions...
```

And traceability table (repeated 24 times):
```markdown
# Before
| HOOK-01 | Phase 2 | Pending |

# After
| HOOK-01 | Phase 2 | Done |
```

## State of the Art

Not applicable. This phase involves no external libraries, frameworks, or evolving standards. All changes are to internal files using patterns already established in the codebase.

## Open Questions

1. **Should the digest add a `## Session Analysis` markdown section?**
   - What we know: The digest currently has sections for Event Summary, Agent Performance, Recent Deviations, Tool Errors, Recommendations, Top Patterns. Session summary data could get its own section for human readability.
   - What's unclear: Whether the extra section adds value or is noise. The critical path is Top Patterns (recall markers), not a display section.
   - Recommendation: Add a minimal section (quality trend, session count) between Tool Errors and Recommendations. This provides human visibility without affecting the recall pipeline. If the planner judges this unnecessary, skip it -- the recall integration via `allPatternItems` is the only hard requirement.

2. **Should execute-plan.md recall injection cover all spawn patterns or just Pattern A?**
   - What we know: execute-plan.md describes Pattern A (autonomous), Pattern B (segmented), Pattern C (main context), A-team, and B-team. Pattern C executes in main context (no spawn). Patterns A and B spawn subagents. Team patterns send to executor teammates.
   - What's unclear: Whether team mode executors inherit recall from execute-phase (their parent workflow), making injection in execute-plan redundant.
   - Recommendation: Add recall to all spawn points (A, B, A-team, B-team) for consistency. Skip Pattern C (no spawn). Even if some receive recall from the parent, the conditional guard (`{If RECALL is non-empty}`) prevents double-injection -- the worst case is a slight context overlap, which is safer than a recall gap.

## Sources

### Primary (HIGH confidence)

All findings are based on direct source code reading within the project codebase:

- `hive/bin/hive-tools.js` lines 4678-4938: cmdTelemetryDigest function (complete digest logic)
- `hive/bin/hive-tools.js` lines 541-549: getRecallContext function
- `hive/bin/hive-tools.js` lines 149-153: VALID_EVENT_TYPES array
- `hive/bin/hive-tools.js` lines 707-760: detectCrossSessionPatterns function (shows session_summary data structure usage)
- `hive/bin/hive-tools.js` line 3970: recall_context in init execute-phase
- `hive/workflows/execute-plan.md`: Full file (no recall extraction or injection present)
- `hive/workflows/execute-phase.md` lines 24-26, 190-196: Recall pattern reference implementation
- `hive/workflows/quick.md` lines 36-38, 104-110: Another recall pattern reference
- `hive/workflows/analyze-session.md` lines 99-121: session_summary event data structure
- `.planning/REQUIREMENTS.md`: Full file (checkboxes audit)
- `.planning/v1.0-MILESTONE-AUDIT.md`: Full audit report (source of truth for gaps)
- `.planning/phases/04-feedback-loop/04-VERIFICATION.md`: Phase 4 verification (confirms recall wiring)
- All 6 phase verification reports (01-06): All `status: passed`

### Secondary (MEDIUM confidence)

None needed. All research is internal codebase analysis.

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No external dependencies; all changes to known files
- Architecture: HIGH - All patterns already exist in 10+ files; this phase adds the same pattern to the 1 missing file and adds 1 event type to an existing processing pipeline
- Pitfalls: HIGH - Source/installed copy sync is the only real risk, and it is well-documented in prior verification reports

**Research date:** 2026-02-12
**Valid until:** Indefinite (internal codebase patterns, not external libraries)
