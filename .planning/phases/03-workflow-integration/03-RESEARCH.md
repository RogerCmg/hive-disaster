# Phase 3: Workflow Integration - Research

**Researched:** 2026-02-11
**Domain:** Markdown workflow modifications, hive-tools.js telemetry emit CLI, semantic event capture at workflow decision points
**Confidence:** HIGH

## Summary

Phase 3 adds semantic telemetry to Hive's existing markdown workflow files. Unlike Phase 2 (which created standalone hook scripts), Phase 3 modifies 4-5 existing workflow markdown files (`execute-plan.md`, `execute-phase.md`, `verify-work.md`/`verify-phase.md`, `plan-phase.md`) by inserting `telemetry emit` instructions at specific decision points. These instructions direct the executing agent to call `node ~/.claude/hive/bin/hive-tools.js telemetry emit <type> --data '{json}'` when deviations occur, checkpoints resolve, verification finds gaps, plans get revised, or users modify agent output.

The critical design insight: these are NOT code changes to JavaScript files. They are markdown instruction changes that tell AI agents to emit telemetry at the right moments. Each emit is a single bash command using the existing Phase 1 CLI infrastructure. The workflow files are meta-prompts -- they instruct Claude Code agents on what to do. Adding telemetry means adding a markdown instruction line like "After resolving deviation, emit telemetry:" followed by a bash block. The agent executing the workflow will run the bash command.

There is one code change needed: `cmdTelemetryEmit` in `hive-tools.js` currently checks `telConfig.enabled` (master toggle) but does NOT check `telConfig.workflow_events`. This means the `workflow_events: false` toggle in config.json has no effect on workflow emit calls. Phase 3 should add this check to properly honor the config flag, ensuring workflows respect the toggle just as hooks respect `telConfig.hooks`.

**Primary recommendation:** Add 10-15 single-line telemetry emit instructions across 4-5 workflow markdown files at identified decision points. Each insertion uses the existing `hive-tools.js telemetry emit` CLI. Add `workflow_events` enforcement to `cmdTelemetryEmit`. All changes are additive and guarded by the config flag. The two source files (`hive/workflows/*.md`) and their installed counterparts (`.claude/hive/workflows/*.md`) must both be updated, or alternatively the build/install process handles copying.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hive-tools.js telemetry emit` | Phase 1 CLI | Append structured events to events.jsonl | Already implemented, validates types, creates envelope, handles rotation |
| Node.js `process.env.CLAUDE_SESSION_ID` | stdlib | Session ID for event envelope | Used by createEventEnvelope as fallback when no session param provided |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `hive-tools.js init` | Phase 1 CLI | Load telemetry config for config checks | Workflows already call init at start |
| `jq` | system utility | Extract JSON fields in bash blocks | Already used extensively in all workflow bash blocks |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CLI `telemetry emit` in workflows | Direct file append (like hooks) | Hooks use direct append for speed (<1ms). Workflows already run multi-minute operations -- 100ms CLI overhead is negligible. CLI provides type validation, config checking, and rotation. Use CLI. |
| Per-workflow config checks | Single check in `cmdTelemetryEmit` | Better to fix the CLI once (add workflow_events check) than scatter config checks in every workflow markdown. DRY. |
| Emit from orchestrator (execute-phase.md) | Emit from executor (execute-plan.md) | Deviation and checkpoint events occur IN the executor agent context where the data exists. Emit there, not in the orchestrator which only sees secondhand summaries. |

**Installation:**
```bash
# No installation needed -- modifications to existing workflow files
# hive-tools.js telemetry emit already available from Phase 1
```

## Architecture Patterns

### Recommended Modification Structure
```
hive/
  bin/hive-tools.js              # MODIFIED: Add workflow_events check to cmdTelemetryEmit
  workflows/
    execute-plan.md              # MODIFIED: Add deviation emit (WFLOW-01), checkpoint emit via orchestrator relay (WFLOW-02)
    execute-phase.md             # MODIFIED: Add checkpoint emit after resolution (WFLOW-02)
    verify-phase.md              # MODIFIED: Add verification_gap emit (WFLOW-03)
    plan-phase.md                # MODIFIED: Add plan_revision emit in revision loop (WFLOW-04)
    [multiple with gates]        # MODIFIED: Add user_correction emit at confirmation gates (WFLOW-05)
.claude/hive/workflows/          # MUST MIRROR: Installed copies must match source
```

### Pattern 1: Workflow Telemetry Emit (the universal insertion pattern)
**What:** A markdown instruction block that tells the executing agent to call the telemetry CLI
**When to use:** Every workflow insertion point identified by WFLOW-01 through WFLOW-05
**Example:**
```markdown
After resolving the deviation, record it for Recall:

\`\`\`bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit deviation \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"deviation_type\":\"rule-${RULE_NUM}\",\"severity\":\"${SEVERITY}\",\"description\":\"${DESCRIPTION}\",\"resolution\":\"${RESOLUTION}\"}"
\`\`\`
```

**Key characteristics:**
- Single bash command (one line, may wrap with `\` for readability)
- Uses shell variables already available in the workflow context
- Non-blocking -- the emit command returns immediately
- Protected by `workflow_events` config toggle (enforced in cmdTelemetryEmit)
- Failure does not affect workflow execution (CLI exits cleanly even on errors)

### Pattern 2: Config-Gated Emit at CLI Level
**What:** The `cmdTelemetryEmit` function checks `workflow_events` toggle before writing
**When to use:** Applied once in hive-tools.js, gates ALL workflow emit calls
**Example:**
```javascript
// In cmdTelemetryEmit, after checking telConfig.enabled:
const WORKFLOW_EVENT_TYPES = [
  'deviation', 'checkpoint', 'verification_gap', 'plan_revision', 'user_correction'
];
if (WORKFLOW_EVENT_TYPES.includes(type) && !telConfig.workflow_events) {
  output({ emitted: false, reason: 'workflow_events disabled' }, raw, 'disabled');
  return;
}
```

### Pattern 3: Emit Location Strategy
**What:** Where exactly to insert emit calls within each workflow's process flow
**When to use:** Determining insertion points

| Event Type | Workflow File | Insertion Point | Data Source |
|------------|--------------|----------------|-------------|
| `deviation` | execute-plan.md | Inside `<deviation_rules>`, after Rule 1-3 auto-fix and after Rule 4 user decision | Rule number, description, fix applied, files modified |
| `checkpoint` | execute-phase.md | After checkpoint resolution in both team_mode and standalone_mode sections | Checkpoint type, plan ID, user response, outcome |
| `verification_gap` | verify-phase.md | In `verify_truths` and `verify_artifacts` steps when status is FAILED/STUB/MISSING | Level (truth/artifact/wiring), what failed, expected vs actual |
| `plan_revision` | plan-phase.md | In revision loop (step 12) after planner returns revised plans | Iteration number, changes summary from checker issues |
| `user_correction` | execute-plan.md, plan-phase.md | At confirmation gates where user modifies/rejects output | What changed, user intent |

### Pattern 4: Dual-File Sync
**What:** Source files in `hive/workflows/` and installed copies in `.claude/hive/workflows/` must stay in sync
**When to use:** Every workflow modification
**How:** Either (a) modify both files, or (b) modify source only and re-run `scripts/build-hooks.js` or equivalent copy mechanism.

**Evidence from codebase:** Both directories contain identical workflow files. Phase 2 modified source hooks + build script. For workflow .md files, there is no build step -- they appear to be direct copies. The safest approach is to modify both files simultaneously, or establish a workflow copy mechanism.

### Anti-Patterns to Avoid
- **Emitting from the wrong context:** Don't emit deviation events from execute-phase.md (the orchestrator). Deviations are detected IN the executor agent running execute-plan.md. The executor has the deviation details; the orchestrator only sees summary messages.
- **Complex conditional emit logic in markdown:** Keep it simple. The workflow says "emit this". The CLI handles config checks. Don't add `if telemetry enabled` checks in the markdown -- that's the CLI's job.
- **Emitting before the event resolves:** Always emit AFTER the deviation is fixed, the checkpoint is resolved, the gap is identified. Never emit "about to check" -- emit "found this".
- **Including code content in events:** Events contain metadata only. `description` should be "Added missing null check for user input" not the actual code diff. Privacy principle from proposal section 8 (P6).
- **Modifying source files only without updating installed copies:** Both `hive/workflows/` and `.claude/hive/workflows/` must be updated. If they diverge, the installed project uses stale workflows.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event envelope creation | Custom JSON construction in bash | `hive-tools.js telemetry emit` CLI | CLI handles envelope format, type validation, session ID, rotation, config checks |
| Config toggle checking | Inline config reads in workflow markdown | `workflow_events` check in cmdTelemetryEmit | Single enforcement point, DRY, workflows stay clean |
| Session ID resolution | Manual `echo $CLAUDE_SESSION_ID` | Let CLI handle via createEventEnvelope | CLI already reads env var as fallback |
| Event type validation | Hope that workflows emit correct types | VALID_EVENT_TYPES check in cmdTelemetryEmit | CLI rejects invalid types immediately |
| File rotation after emit | Manual rotation calls | `rotateIfNeeded()` already called in cmdTelemetryEmit | Automatic, transparent to workflows |

**Key insight:** Phase 1 built all the infrastructure. Phase 3 just needs to call it at the right moments. The complexity is in identifying the correct insertion points and crafting the right data payloads -- not in building new infrastructure.

## Common Pitfalls

### Pitfall 1: Shell variable escaping in JSON data strings
**What goes wrong:** The `--data` parameter requires valid JSON as a string argument in bash. Shell variables containing quotes, newlines, or special characters break the JSON.
**Why it happens:** Workflow variables like `DESCRIPTION` or `RESOLUTION` may contain user-provided text with quotes or special characters.
**How to avoid:** Use single-line descriptions with no user-provided free text. Stick to structured data: rule numbers, type enums, file paths, boolean outcomes. If free text is needed, sanitize: `SAFE_DESC=$(echo "$DESC" | tr '"' "'" | tr '\n' ' ')`.
**Warning signs:** `telemetry emit` reports "Invalid JSON in --data".

### Pitfall 2: Emitting from orchestrator instead of executor for deviations
**What goes wrong:** execute-phase.md (orchestrator) tries to emit deviation events. But the orchestrator never has deviation details -- it only receives secondhand summary messages from executors.
**Why it happens:** The orchestrator coordinates; the executor discovers deviations. Temptation to centralize all telemetry in the orchestrator.
**How to avoid:** Deviation emits go in execute-plan.md (the executor workflow). Checkpoint emits can go in execute-phase.md (the orchestrator) because the orchestrator is the one resolving checkpoints with the user.
**Warning signs:** Deviation events have empty or generic descriptions because the orchestrator lacks context.

### Pitfall 3: Forgetting team mode vs standalone mode for checkpoints
**What goes wrong:** Checkpoint emit is added to standalone mode flow but not team mode flow (or vice versa). Events are only captured in one execution mode.
**Why it happens:** execute-phase.md has parallel code paths: `<team_mode>` and `<standalone_mode>`. Both need the emit instruction.
**How to avoid:** When adding any emit to a workflow with dual mode sections, add it to BOTH sections. Search for matching patterns in team_mode and standalone_mode blocks.
**Warning signs:** Checkpoint events only appear when running in one mode.

### Pitfall 4: workflow_events toggle not enforced
**What goes wrong:** User sets `workflow_events: false` in config.json, but deviation/checkpoint/etc events still appear in events.jsonl.
**Why it happens:** The current `cmdTelemetryEmit` only checks `telConfig.enabled` (master toggle), not `telConfig.workflow_events`. This was fine for Phase 1-2 (hooks check their own toggle), but Phase 3 workflow events need this check.
**How to avoid:** Add `workflow_events` check to `cmdTelemetryEmit` for the 5 workflow event types: deviation, checkpoint, verification_gap, plan_revision, user_correction.
**Warning signs:** `telemetry stats` shows workflow events even when `workflow_events: false`.

### Pitfall 5: verify-work.md vs verify-phase.md confusion
**What goes wrong:** WFLOW-03 says "verify-work workflow emits verification_gap". But verify-work.md is the UAT/user testing workflow. The actual verification logic (truths, artifacts, wiring) is in verify-phase.md.
**Why it happens:** The requirement uses "verify-work" loosely. There are two verification workflows: verify-work.md (user acceptance testing) and verify-phase.md (automated goal verification).
**How to avoid:** verification_gap events should be emitted from verify-phase.md (which runs automated 3-level verification: truths, artifacts, wiring). verify-work.md could also emit user_correction events when users report issues during UAT, but the primary WFLOW-03 target is verify-phase.md.
**Warning signs:** Verification gap events missing because they were added to the wrong file.

### Pitfall 6: Duplicate emit in both source and installed workflow
**What goes wrong:** If the workflow emit fires from both `hive/workflows/X.md` and `.claude/hive/workflows/X.md`, events could be double-counted.
**Why it happens:** Misunderstanding that both copies are active simultaneously.
**How to avoid:** Only `.claude/hive/workflows/` copies are active at runtime (they are what agents read via `@~/.claude/hive/workflows/`). The `hive/workflows/` copies are the source of truth for development and installation. Modify the source, then sync to installed. They are never both executed.
**Warning signs:** N/A -- this is a development-time confusion, not a runtime issue.

## Code Examples

Verified patterns from existing codebase and Phase 1 infrastructure:

### WFLOW-01: Deviation Emit in execute-plan.md
```markdown
<!-- Insert inside <deviation_rules> after each rule's action -->

After applying the auto-fix (Rules 1-3) or receiving user decision (Rule 4), emit the deviation event:

\`\`\`bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit deviation \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"deviation_type\":\"rule-${RULE_NUM}\",\"severity\":\"auto\",\"description\":\"${DEVIATION_TITLE}\",\"resolution\":\"${RESOLUTION}\"}"
\`\`\`

For Rule 4 (architectural), use `"severity":"architectural"` and include the user's decision in resolution.
```

### WFLOW-02: Checkpoint Emit in execute-phase.md
```markdown
<!-- Insert after checkpoint resolution in team_mode monitoring loop -->
<!-- and after checkpoint resolution in standalone_mode checkpoint_handling -->

After checkpoint resolved, emit the event:

\`\`\`bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit checkpoint \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"checkpoint_type\":\"${CHECKPOINT_TYPE}\",\"user_response\":\"${USER_RESPONSE}\",\"outcome\":\"${OUTCOME}\"}"
\`\`\`
```

### WFLOW-03: Verification Gap Emit in verify-phase.md
```markdown
<!-- Insert in verify_truths and verify_artifacts steps when status is FAILED -->

When a truth or artifact fails verification, emit:

\`\`\`bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit verification_gap \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"level\":\"${LEVEL}\",\"what_failed\":\"${ITEM_NAME}\",\"expected\":\"${EXPECTED}\",\"actual\":\"${ACTUAL_STATUS}\"}"
\`\`\`
```

### WFLOW-04: Plan Revision Emit in plan-phase.md
```markdown
<!-- Insert in revision loop (step 12) after planner returns revised plans -->

After revision completes, emit:

\`\`\`bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit plan_revision \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"round\":${ITERATION_COUNT},\"changes_summary\":\"${CHANGES_SUMMARY}\"}"
\`\`\`
```

### WFLOW-05: User Correction Emit at Confirmation Gates
```markdown
<!-- Insert at any confirmation gate where user modifies/rejects output -->
<!-- Examples: execute-plan.md identify_plan gate, plan-phase.md checker override, -->
<!-- execute-plan.md verification_failure_gate skip action -->

If user modifies or rejects the presented output, emit:

\`\`\`bash
node ~/.claude/hive/bin/hive-tools.js telemetry emit user_correction \
  --data "{\"phase\":\"${PHASE_NUMBER}\",\"plan\":\"${PLAN_ID}\",\"what_changed\":\"${CORRECTION_TYPE}\",\"user_intent\":\"${USER_RESPONSE}\"}"
\`\`\`
```

### workflow_events Config Enforcement in hive-tools.js
```javascript
// Source: hive-tools.js cmdTelemetryEmit function (line ~4586)
// Add after the telConfig.enabled check:

const WORKFLOW_EVENT_TYPES = [
  'deviation', 'checkpoint', 'verification_gap', 'plan_revision', 'user_correction'
];
if (WORKFLOW_EVENT_TYPES.includes(type) && !telConfig.workflow_events) {
  output({ emitted: false, reason: 'workflow_events disabled' }, raw, 'disabled');
  return;
}
```

## Identified Insertion Points (Detailed)

### execute-plan.md Insertion Points

**1. Deviation auto-fix (Rules 1-3) -- WFLOW-01**
- **Location:** Inside `<deviation_rules>`, after each auto-fix rule's action
- **Data available:** Rule number (1/2/3), task name, issue description, fix applied, files modified
- **Insert point:** After "Fix -> test -> verify -> track" instruction, before next step
- **Both modes:** Yes, deviation_rules is shared between team and standalone

**2. Deviation escalation (Rule 4) -- WFLOW-01**
- **Location:** Inside `<deviation_rules>`, after user responds to Rule 4 decision
- **Data available:** Rule number (4), proposed change, user decision, alternatives
- **Insert point:** After "Wait for response. Implement based on decision. Continue execution." in team mode, and after "Proceed with proposed change? (yes / different approach / defer)" response in classic mode

**3. User correction at identify_plan gate -- WFLOW-05**
- **Location:** `<step name="identify_plan">`, interactive mode confirmation
- **Data available:** Plan ID, user's modification
- **Insert point:** If user modifies the plan selection or provides different instructions

**4. User correction at verification_failure_gate -- WFLOW-05**
- **Location:** `<step name="verification_failure_gate">`, when user chooses "skip"
- **Data available:** Task name, expected criteria, actual result, user choice (skip)
- **Insert point:** After user selects "skip" option

**5. User correction at issues_review_gate -- WFLOW-05**
- **Location:** `<step name="issues_review_gate">`, when user acknowledges issues
- **Data available:** Issues list, user acknowledgment/correction
- **Insert point:** If user provides corrective guidance beyond acknowledgment

### execute-phase.md Insertion Points

**6. Checkpoint resolution (team mode) -- WFLOW-02**
- **Location:** `<team_mode>` execute_waves step 3, after sending CHECKPOINT_RESPONSE back to executor
- **Data available:** Checkpoint type, plan ID, user response, outcome
- **Insert point:** After `SendMessage(type="message", recipient="executor-{plan_id}", content="CHECKPOINT_RESPONSE: {user_response}")`

**7. Checkpoint resolution (standalone mode) -- WFLOW-02**
- **Location:** `<standalone_checkpoints>`, after user responds and before spawning continuation agent
- **Data available:** Checkpoint type, plan ID, user response, outcome
- **Insert point:** After step 5 "User responds" and before step 6 "Spawn continuation agent"

**8. Deviation Rule 4 resolution (team mode) -- WFLOW-01 relay**
- **Location:** `<team_mode>` execute_waves, Deviation Rule 4 handling, after sending DEVIATION_RESPONSE
- **Data available:** Plan ID, task, deviation details, user decision
- **Insert point:** After `SendMessage(type="message", recipient="executor-{plan_id}", content="DEVIATION_RESPONSE: {user_decision}")`
- **Note:** The actual deviation event should be emitted by the executor (in execute-plan.md). The orchestrator emit here is optional/supplementary for visibility.

### verify-phase.md Insertion Points

**9. Truth verification failure -- WFLOW-03**
- **Location:** `<step name="verify_truths">`, when a truth's status is FAILED
- **Data available:** Truth description, status, supporting artifact details
- **Insert point:** After determining truth status, before moving to next truth

**10. Artifact verification failure -- WFLOW-03**
- **Location:** `<step name="verify_artifacts">`, when artifact is MISSING/STUB/ORPHANED
- **Data available:** Artifact path, level (exists/substantive/wired), expected vs actual
- **Insert point:** After artifact verification result is determined

**11. Wiring verification failure -- WFLOW-03**
- **Location:** `<step name="verify_wiring">`, when key link is NOT_WIRED or PARTIAL
- **Data available:** From-to link, verification pattern, status
- **Insert point:** After link verification result is determined

### plan-phase.md Insertion Points

**12. Plan revision after checker feedback -- WFLOW-04**
- **Location:** Step 12 (Revision Loop), after planner returns revised plans
- **Data available:** Iteration number, checker issues, planner changes
- **Insert point (team mode):** After receiving `REVISION COMPLETE:` message from planner
- **Insert point (standalone):** After planner Task returns with revised plans

**13. User correction at max iterations -- WFLOW-05**
- **Location:** Step 12, when iteration_count >= 3 and user provides guidance
- **Data available:** Remaining issues, user guidance, chosen option (force/guidance/abandon)
- **Insert point:** After user responds to the 3 options

### verify-work.md Insertion Points

**14. User reports issue during UAT -- WFLOW-05 (bonus)**
- **Location:** `<step name="process_response">`, when user response indicates an issue
- **Data available:** Test name, expected behavior, user-reported issue, inferred severity
- **Insert point:** After severity inference, before writing to UAT file
- **Note:** This captures user corrections at the UAT level. The UAT file itself serves as a record, but a telemetry event enables cross-session pattern tracking.

## Event Payload Schemas

Based on the proposal's data model (Section 3.2) and verified against VALID_EVENT_TYPES:

### deviation (WFLOW-01)
```json
{
  "phase": "03",
  "plan": "03-01",
  "deviation_type": "rule-1|rule-2|rule-3|rule-4",
  "severity": "auto|architectural",
  "description": "Brief description of what deviated",
  "resolution": "auto-fixed|user-approved|user-rejected|deferred"
}
```

### checkpoint (WFLOW-02)
```json
{
  "phase": "03",
  "plan": "03-02",
  "checkpoint_type": "human-verify|decision|human-action",
  "user_response": "approved|option-id|done|issue-description",
  "outcome": "passed|selected|completed|issues-reported"
}
```

### verification_gap (WFLOW-03)
```json
{
  "phase": "03",
  "level": "truth|artifact|wiring|requirement",
  "what_failed": "Name or path of the item that failed",
  "expected": "What was expected",
  "actual": "FAILED|MISSING|STUB|ORPHANED|NOT_WIRED|PARTIAL"
}
```

### plan_revision (WFLOW-04)
```json
{
  "phase": "03",
  "plan": "03-01",
  "round": 1,
  "changes_summary": "Brief description of what changed",
  "reason": "Checker found N issues: description"
}
```

### user_correction (WFLOW-05)
```json
{
  "phase": "03",
  "plan": "03-01",
  "what_changed": "plan-selection|verification-skip|plan-override|uat-issue|max-iteration-guidance",
  "user_intent": "Brief capture of what user communicated"
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No workflow telemetry | Phase 1 CLI provides `telemetry emit` | Phase 1 (2026-02-12) | Infrastructure ready, just needs workflow insertions |
| workflow_events toggle unused | Toggle exists but not enforced in cmdTelemetryEmit | Phase 1 design gap | Must be fixed in Phase 3 |
| Hooks capture lifecycle only | Hooks (Phase 2) + Workflows (Phase 3) capture semantic events | Phase 2 complete (2026-02-12) | Phase 3 adds the semantic layer |

**Already working (from Phase 1-2):**
- `hive-tools.js telemetry emit <type> --data '{json}'` appends to events.jsonl with envelope
- VALID_EVENT_TYPES includes all 11 types (including deviation, checkpoint, etc.)
- `createEventEnvelope` handles ts, session, type, v, data
- `rotateIfNeeded` handles automatic file rotation
- `getTelemetryConfig` reads config with defaults

**Gap found:**
- `cmdTelemetryEmit` checks `telConfig.enabled` but NOT `telConfig.workflow_events` -- must be fixed

## Open Questions

1. **Should the executor (execute-plan.md) or orchestrator (execute-phase.md) emit deviation events?**
   - What we know: Deviations are detected and resolved by the executor running execute-plan.md. The orchestrator (execute-phase.md) only receives secondhand summary messages.
   - Recommendation: Emit from execute-plan.md where the deviation data is first-hand. The executor has rule number, description, fix details, and resolution. The orchestrator only sees a `DEVIATION:` message summary. **Emit at the source.**

2. **How to handle the dual file paths (hive/workflows/ and .claude/hive/workflows/)?**
   - What we know: Both directories contain identical copies of all workflow files. Runtime reads from `.claude/hive/workflows/`. Development edits go in `hive/workflows/`.
   - What's unclear: Whether there's a copy mechanism for workflows like `scripts/build-hooks.js` is for hooks.
   - Recommendation: Modify both files in each plan task. The plan should explicitly list both paths in `files_modified`. This is the pattern Phase 2 used for settings.json.

3. **Should verify-work.md also emit verification_gap events for UAT failures?**
   - What we know: WFLOW-03 targets "verify-work workflow". verify-work.md is the UAT flow. verify-phase.md is the automated verification flow. Both find "gaps" but at different levels.
   - Recommendation: WFLOW-03 targets verify-phase.md (automated gaps). verify-work.md can optionally emit user_correction events (WFLOW-05) when users report issues during UAT, since this is a form of user correction. Keep WFLOW-03 focused on automated verification.

4. **How many user_correction insertion points are needed for WFLOW-05?**
   - What we know: "Any workflow with confirmation gate" is broad. The gates in config.json are: confirm_project, confirm_phases, confirm_roadmap, confirm_breakdown, confirm_plan, execute_next_plan, issues_review, confirm_transition.
   - Recommendation: Focus on the high-value gates that occur during the execute/plan/verify cycle (execute_next_plan, issues_review, confirm_plan). Skip new-project/milestone gates (too infrequent to be useful for learning). The 3-4 most impactful points: (a) user modifies plan selection in execute-plan.md, (b) user overrides at max iterations in plan-phase.md, (c) user skips verification failure in execute-plan.md, (d) user reports UAT issue in verify-work.md.

## Sources

### Primary (HIGH confidence)
- `hive/bin/hive-tools.js` (lines 149-154, 486-508, 517-525, 4578-4609) -- Phase 1 telemetry infrastructure: VALID_EVENT_TYPES (11 types including all 5 workflow types), getTelemetryConfig (workflow_events toggle), createEventEnvelope, cmdTelemetryEmit
- `hive/workflows/execute-plan.md` -- Executor workflow with deviation_rules, checkpoint_protocol, verification_failure_gate, issues_review_gate
- `hive/workflows/execute-phase.md` -- Orchestrator workflow with team_mode/standalone_mode checkpoint handling, deviation Rule 4 relay
- `hive/workflows/verify-phase.md` -- Automated verification workflow with verify_truths, verify_artifacts, verify_wiring steps
- `hive/workflows/verify-work.md` -- UAT workflow with process_response step for user issue reporting
- `hive/workflows/plan-phase.md` -- Planning workflow with revision loop (step 12), team_mode/standalone_mode revision flow
- `hive/templates/config.json` -- Config template with `telemetry.workflow_events: true` default
- `.planning/SELF-IMPROVEMENT-PROPOSAL.md` (Section 5, Phase 3) -- Original design: single-line emit calls at strategic points
- `.planning/REQUIREMENTS.md` -- WFLOW-01 through WFLOW-05 definitions
- `.planning/ROADMAP.md` -- Phase 3 success criteria

### Secondary (MEDIUM confidence)
- `.planning/phases/02-hook-observers/02-RESEARCH.md` -- Phase 2 research establishing patterns (direct write vs CLI, config checks)
- `.planning/phases/02-hook-observers/02-VERIFICATION.md` -- Phase 2 verification confirming all hook infrastructure works

### Tertiary (LOW confidence)
- None. All findings verified against existing codebase files.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Uses only existing Phase 1 CLI infrastructure, no new libraries or tools
- Architecture: HIGH -- Insertion points identified from reading actual workflow files, dual mode paths verified
- Pitfalls: HIGH -- Config enforcement gap verified by reading cmdTelemetryEmit source code, shell escaping is a known bash pattern challenge
- Code examples: HIGH -- Based on existing emit CLI interface and workflow variable patterns

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (workflow files are stable; telemetry CLI is Phase 1-complete)
