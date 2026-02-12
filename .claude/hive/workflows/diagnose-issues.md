<purpose>
Orchestrate parallel debug agents to investigate UAT gaps and find root causes.

After UAT finds gaps, spawn one debug agent per gap. Each agent investigates autonomously with symptoms pre-filled from UAT. Collect root causes, update UAT.md gaps with diagnosis, then hand off to plan-phase --gaps with actual diagnoses.

Orchestrator stays lean: parse gaps, spawn agents, collect results, update UAT.
</purpose>

<paths>
DEBUG_DIR=.planning/debug

Debug files use the `.planning/debug/` path (hidden directory with leading dot).
</paths>

<core_principle>
**Diagnose before planning fixes.**

UAT tells us WHAT is broken (symptoms). Debug agents find WHY (root cause). plan-phase --gaps then creates targeted fixes based on actual causes, not guesses.

Without diagnosis: "Comment doesn't refresh" → guess at fix → maybe wrong
With diagnosis: "Comment doesn't refresh" → "useEffect missing dependency" → precise fix
</core_principle>

<process>

<step name="parse_gaps">
**Extract gaps from UAT.md:**

Read the "Gaps" section (YAML format):
```yaml
- truth: "Comment appears immediately after submission"
  status: failed
  reason: "User reported: works but doesn't show until I refresh the page"
  severity: major
  test: 2
  artifacts: []
  missing: []
```

For each gap, also read the corresponding test from "Tests" section to get full context.

Build gap list:
```
gaps = [
  {truth: "Comment appears immediately...", severity: "major", test_num: 2, reason: "..."},
  {truth: "Reply button positioned correctly...", severity: "minor", test_num: 5, reason: "..."},
  ...
]
```
</step>

<step name="report_plan">
**Report diagnosis plan to user:**

```
## Diagnosing {N} Gaps

Spawning parallel debug agents to investigate root causes:

| Gap (Truth) | Severity |
|-------------|----------|
| Comment appears immediately after submission | major |
| Reply button positioned correctly | minor |
| Delete removes comment | blocker |

Each agent will:
1. Create DEBUG-{slug}.md with symptoms pre-filled
2. Investigate autonomously (read code, form hypotheses, test)
3. Return root cause

This runs in parallel - all gaps investigated simultaneously.
```
</step>

<step name="create_debug_team">
<team_mode_setup>
Check config:
```bash
DIAGNOSIS_TEAM=$(echo "$INIT" | jq -r '.teams.diagnosis_team // false')
```

**If enabled:** `TeamCreate("hive-debug-{phase}")`, set `diagnosis_mode = "team"`.
**If fails or disabled:** set `diagnosis_mode = "standalone"`.
</team_mode_setup>
</step>

<step name="spawn_agents">
**Spawn debug agents in parallel:**

<team_mode>
Spawn debuggers as teammates:
```
For each gap:
  Task(
    prompt=filled_debug_subagent_prompt,
    subagent_type="general-purpose",
    description="Debug: {truth_short}",
    team_name="hive-debug-{phase}",
    name="debugger-{N}"
  )
```
</team_mode>

<standalone_mode>
For each gap, fill the debug-subagent-prompt template and spawn:

```
Task(
  prompt=filled_debug_subagent_prompt,
  subagent_type="general-purpose",
  description="Debug: {truth_short}"
)
```

**All agents spawn in single message** (parallel execution).
</standalone_mode>

Template placeholders:
- `{truth}`: The expected behavior that failed
- `{expected}`: From UAT test
- `{actual}`: Verbatim user description from reason field
- `{errors}`: Any error messages from UAT (or "None reported")
- `{reproduction}`: "Test {test_num} in UAT"
- `{timeline}`: "Discovered during UAT"
- `{goal}`: `find_root_cause_only` (UAT flow - plan-phase --gaps handles fixes)
- `{slug}`: Generated from truth

Extract recall context (from parent INIT or direct call):
```bash
RECALL=$(echo "$INIT" | jq -r '.recall_context // empty')
```

{If RECALL is non-empty, append this block to each filled_debug_subagent_prompt:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
</step>

<step name="collect_results">
**Collect root causes from agents:**

<team_mode>
**Message monitoring loop:**

Monitor for messages from debugger teammates. Parse by prefix:

| Prefix | Meaning | Action |
|--------|---------|--------|
| `ROOT CAUSE FOUND:` | Debugger found cause | Record root cause, check if it explains other gaps |
| `FINDING:` | Intermediate discovery | Broadcast to all debuggers (they check against their gap) |
| `INVESTIGATION INCONCLUSIVE:` | Couldn't determine cause | Mark gap as needs-manual-review |
| `CHECKPOINT:` | Debugger needs user input | Relay checkpoint to user, send `CHECKPOINT RESPONSE:` back to debugger |

**Shared root cause detection:** When debugger-1 broadcasts `FINDING: useEffect missing dependency in CommentList.tsx`, orchestrator sends to other active debuggers:
```
SendMessage(
  type="broadcast",
  content="SHARED FINDING from debugger-1: {finding}\nCheck if this explains your gap too.",
  summary="Shared finding from debugger-1"
)
```

If a debugger confirms the shared cause applies, it reports:
`ROOT CAUSE FOUND: Same as debugger-1 - {cause}`

This eliminates redundant investigation.
</team_mode>

<standalone_mode>
Each agent returns with:
```
## ROOT CAUSE FOUND

**Debug Session:** ${DEBUG_DIR}/{slug}.md

**Root Cause:** {specific cause with evidence}

**Evidence Summary:**
- {key finding 1}
- {key finding 2}
- {key finding 3}

**Files Involved:**
- {file1}: {what's wrong}
- {file2}: {related issue}

**Suggested Fix Direction:** {brief hint for plan-phase --gaps}
```

Parse each return to extract:
- root_cause: The diagnosed cause
- files: Files involved
- debug_path: Path to debug session file
- suggested_fix: Hint for gap closure plan

If agent returns `## INVESTIGATION INCONCLUSIVE`:
- root_cause: "Investigation inconclusive - manual review needed"
- Note which issue needs manual attention
- Include remaining possibilities from agent return
</standalone_mode>
</step>

<step name="update_uat">
**Update UAT.md gaps with diagnosis:**

For each gap in the Gaps section, add artifacts and missing fields:

```yaml
- truth: "Comment appears immediately after submission"
  status: failed
  reason: "User reported: works but doesn't show until I refresh the page"
  severity: major
  test: 2
  root_cause: "useEffect in CommentList.tsx missing commentCount dependency"
  artifacts:
    - path: "src/components/CommentList.tsx"
      issue: "useEffect missing dependency"
  missing:
    - "Add commentCount to useEffect dependency array"
    - "Trigger re-render when new comment added"
  debug_session: .planning/debug/comment-not-refreshing.md
```

Update status in frontmatter to "diagnosed".

Commit the updated UAT.md:
```bash
node ./.claude/hive/bin/hive-tools.js commit "docs({phase}): add root causes from diagnosis" --files ".planning/phases/XX-name/{phase}-UAT.md"
```
</step>

<step name="cleanup_debug_team">
<team_mode>
After all gaps are diagnosed (or marked inconclusive):

1. Send shutdown requests to all debugger teammates
2. Wait for shutdown confirmations
3. `TeamDelete("hive-debug-{phase}")`

If any debugger rejects shutdown (still investigating), allow a grace period before forcing cleanup.
</team_mode>

<standalone_mode>
No cleanup needed — Task() agents terminate on return.
</standalone_mode>
</step>

<step name="report_results">
**Report diagnosis results and hand off:**

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Hive ► DIAGNOSIS COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Gap (Truth) | Root Cause | Files |
|-------------|------------|-------|
| Comment appears immediately | useEffect missing dependency | CommentList.tsx |
| Reply button positioned correctly | CSS flex order incorrect | ReplyButton.tsx |
| Delete removes comment | API missing auth header | api/comments.ts |

Debug sessions: ${DEBUG_DIR}/

Proceeding to plan fixes...
```

Return to verify-work orchestrator for automatic planning.
Do NOT offer manual next steps - verify-work handles the rest.
</step>

</process>

<context_efficiency>
Agents start with symptoms pre-filled from UAT (no symptom gathering).
Agents only diagnose—plan-phase --gaps handles fixes (no fix application).
</context_efficiency>

<failure_handling>
**Agent fails to find root cause:**
- Mark gap as "needs manual review"
- Continue with other gaps
- Report incomplete diagnosis

**Agent times out:**
- Check DEBUG-{slug}.md for partial progress
- Can resume with /hive:debug

**All agents fail:**
- Something systemic (permissions, git, etc.)
- Report for manual investigation
- Fall back to plan-phase --gaps without root causes (less precise)
</failure_handling>

<success_criteria>
- [ ] Gaps parsed from UAT.md
- [ ] Debug agents spawned in parallel
- [ ] Root causes collected from all agents
- [ ] UAT.md gaps updated with artifacts and missing
- [ ] Debug sessions saved to ${DEBUG_DIR}/
- [ ] Hand off to verify-work for automatic planning

**Team mode additional criteria:**
- [ ] Debug team created successfully (or graceful fallback to standalone)
- [ ] Debuggers spawned as teammates with proper names
- [ ] Shared findings broadcast to all active debuggers
- [ ] Shared root causes detected and redundant investigation eliminated
- [ ] Results collected via message monitoring (not return values)
- [ ] Debug team cleaned up after all gaps diagnosed
</success_criteria>
