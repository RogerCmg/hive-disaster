<purpose>
Validate built features through conversational testing with persistent state. Creates UAT.md that tracks test progress, survives /clear, and feeds gaps into /hive:plan-phase --gaps.

User tests, Claude records. One test at a time. Plain text responses.
</purpose>

<philosophy>
**Show expected, ask if reality matches.**

Claude presents what SHOULD happen. User confirms or describes what's different.
- "yes" / "y" / "next" / empty → pass
- Anything else → logged as issue, severity inferred

No Pass/Fail buttons. No severity questions. Just: "Here's what should happen. Does it?"
</philosophy>

<template>
@~/.claude/hive/templates/UAT.md
</template>

<process>

<step name="initialize" priority="first">
If $ARGUMENTS contains a phase number, load context:

```bash
INIT=$(node ~/.claude/hive/bin/hive-tools.js init verify-work "${PHASE_ARG}")
```

Parse JSON for: `planner_model`, `checker_model`, `commit_docs`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `has_verification`.

Extract recall context for agent prompts:
```bash
RECALL=$(echo "$INIT" | jq -r '.recall_context // empty')
```
</step>

<step name="check_active_session">
**First: Check for active UAT sessions**

```bash
find .planning/phases -name "*-UAT.md" -type f 2>/dev/null | head -5
```

**If active sessions exist AND no $ARGUMENTS provided:**

Read each file's frontmatter (status, phase) and Current Test section.

Display inline:

```
## Active UAT Sessions

| # | Phase | Status | Current Test | Progress |
|---|-------|--------|--------------|----------|
| 1 | 04-comments | testing | 3. Reply to Comment | 2/6 |
| 2 | 05-auth | testing | 1. Login Form | 0/4 |

Reply with a number to resume, or provide a phase number to start new.
```

Wait for user response.

- If user replies with number (1, 2) → Load that file, go to `resume_from_file`
- If user replies with phase number → Treat as new session, go to `create_uat_file`

**If active sessions exist AND $ARGUMENTS provided:**

Check if session exists for that phase. If yes, offer to resume or restart.
If no, continue to `create_uat_file`.

**If no active sessions AND no $ARGUMENTS:**

```
No active UAT sessions.

Provide a phase number to start testing (e.g., /hive:verify-work 4)
```

**If no active sessions AND $ARGUMENTS provided:**

Continue to `create_uat_file`.
</step>

<step name="find_summaries">
**Find what to test:**

Use `phase_dir` from init (or run init if not already done).

```bash
ls "$phase_dir"/*-SUMMARY.md 2>/dev/null
```

Read each SUMMARY.md to extract testable deliverables.
</step>

<step name="extract_tests">
**Extract testable deliverables from SUMMARY.md:**

Parse for:
1. **Accomplishments** - Features/functionality added
2. **User-facing changes** - UI, workflows, interactions

Focus on USER-OBSERVABLE outcomes, not implementation details.

For each deliverable, create a test:
- name: Brief test name
- expected: What the user should see/experience (specific, observable)

Examples:
- Accomplishment: "Added comment threading with infinite nesting"
  → Test: "Reply to a Comment"
  → Expected: "Clicking Reply opens inline composer below comment. Submitting shows reply nested under parent with visual indentation."

Skip internal/non-observable items (refactors, type changes, etc.).
</step>

<step name="create_uat_file">
**Create UAT file with all tests:**

```bash
mkdir -p "$PHASE_DIR"
```

Build test list from extracted deliverables.

Create file:

```markdown
---
status: testing
phase: XX-name
source: [list of SUMMARY.md files]
started: [ISO timestamp]
updated: [ISO timestamp]
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: [first test name]
expected: |
  [what user should observe]
awaiting: user response

## Tests

### 1. [Test Name]
expected: [observable behavior]
result: [pending]

### 2. [Test Name]
expected: [observable behavior]
result: [pending]

...

## Summary

total: [N]
passed: 0
issues: 0
pending: [N]
skipped: 0

## Gaps

[none yet]
```

Write to `.planning/phases/XX-name/{phase}-UAT.md`

Proceed to `present_test`.
</step>

<step name="present_test">
**Present current test to user:**

Read Current Test section from UAT file.

Display using checkpoint box format:

```
╔══════════════════════════════════════════════════════════════╗
║  CHECKPOINT: Verification Required                           ║
╚══════════════════════════════════════════════════════════════╝

**Test {number}: {name}**

{expected}

──────────────────────────────────────────────────────────────
→ Type "pass" or describe what's wrong
──────────────────────────────────────────────────────────────
```

Wait for user response (plain text, no AskUserQuestion).
</step>

<step name="process_response">
**Process user response and update file:**

**If response indicates pass:**
- Empty response, "yes", "y", "ok", "pass", "next", "approved", "✓"

Update Tests section:
```
### {N}. {name}
expected: {expected}
result: pass
```

**If response indicates skip:**
- "skip", "can't test", "n/a"

Update Tests section:
```
### {N}. {name}
expected: {expected}
result: skipped
reason: [user's reason if provided]
```

**If response is anything else:**
- Treat as issue description

Infer severity from description:
- Contains: crash, error, exception, fails, broken, unusable → blocker
- Contains: doesn't work, wrong, missing, can't → major
- Contains: slow, weird, off, minor, small → minor
- Contains: color, font, spacing, alignment, visual → cosmetic
- Default if unclear: major

Update Tests section:
```
### {N}. {name}
expected: {expected}
result: issue
reported: "{verbatim user response}"
severity: {inferred}
```

Append to Gaps section (structured YAML for plan-phase --gaps):
```yaml
- truth: "{expected behavior from test}"
  status: failed
  reason: "User reported: {verbatim user response}"
  severity: {inferred}
  test: {N}
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
```

**After any response:**

Update Summary counts.
Update frontmatter.updated timestamp.

If more tests remain → Update Current Test, go to `present_test`
If no more tests → Go to `complete_session`
</step>

<step name="resume_from_file">
**Resume testing from UAT file:**

Read the full UAT file.

Find first test with `result: [pending]`.

Announce:
```
Resuming: Phase {phase} UAT
Progress: {passed + issues + skipped}/{total}
Issues found so far: {issues count}

Continuing from Test {N}...
```

Update Current Test section with the pending test.
Proceed to `present_test`.
</step>

<step name="complete_session">
**Complete testing and commit:**

Update frontmatter:
- status: complete
- updated: [now]

Clear Current Test section:
```
## Current Test

[testing complete]
```

Commit the UAT file:
```bash
node ~/.claude/hive/bin/hive-tools.js commit "test({phase}): complete UAT - {passed} passed, {issues} issues" --files ".planning/phases/XX-name/{phase}-UAT.md"
```

Present summary:
```
## UAT Complete: Phase {phase}

| Result | Count |
|--------|-------|
| Passed | {N}   |
| Issues | {N}   |
| Skipped| {N}   |

[If issues > 0:]
### Issues Found

[List from Issues section]
```

**If issues > 0:** Proceed to `create_qa_team`

**If issues == 0:**
```
All tests passed. Ready to continue.

- `/hive:plan-phase {next}` — Plan next phase
- `/hive:execute-phase {next}` — Execute next phase
```
</step>

<step name="create_qa_team">
<team_mode_setup>
Check config:
```bash
QA_TEAM=$(echo "$INIT" | jq -r '.teams.qa_team // false')
GAP_COUNT={number of gaps from UAT}
```

**Auto mode:** If `qa_team` is "auto", enable team mode when `GAP_COUNT >= 5`.
**If `qa_team` is true OR auto-triggered:** `TeamCreate("hive-qa-{phase}")`, set `qa_mode = "team"`.
**If TeamCreate fails or disabled:** set `qa_mode = "standalone"`.
</team_mode_setup>
</step>

<step name="diagnose_issues">
**Diagnose root causes before planning fixes:**

<team_mode>
**Streaming diagnosis with early planning:**

```
---

{N} issues found. Diagnosing root causes (streaming pipeline)...

Spawning QA team: debuggers + planner + checker
```

Spawn planner and checker as teammates in the QA team (they wait for work):

```
Task(subagent_type="general-purpose", team_name="hive-qa-{phase}", name="planner", ...)
Task(subagent_type="hive-plan-checker", team_name="hive-qa-{phase}", name="checker", ...)
```

For each gap, spawn a debugger teammate:

```
Task(subagent_type="general-purpose", team_name="hive-qa-{phase}", name="debugger-{N}", ...)
```

**Stream processing loop:**
Monitor messages. When a debugger sends `ROOT CAUSE FOUND:`:
1. Update UAT.md with the diagnosis
2. Immediately send to planner: `PLAN GAP: {gap_details_with_root_cause}`
3. Don't wait for other debuggers to finish

When planner sends `GAP PLAN READY: {plan_file}`:
1. Send to checker: `VERIFY: {plan_file}, focus on: [{plan_id}]`

When checker sends `VERIFICATION PASSED:` or `ISSUES FOUND:`:
1. If issues: send `REVISE:` to planner with targeted issues
2. If passed: mark gap as planned

Continue until all gaps are diagnosed + planned + verified.
</team_mode>

<standalone_mode>
```
---

{N} issues found. Diagnosing root causes...

Spawning parallel debug agents to investigate each issue.
```

- Load diagnose-issues workflow
- Follow @~/.claude/hive/workflows/diagnose-issues.md
- Spawn parallel debug agents for each issue
- Collect root causes
- Update UAT.md with root causes
- Proceed to `plan_gap_closure`

Diagnosis runs automatically - no user prompt. Parallel agents investigate simultaneously, so overhead is minimal and fixes are more accurate.
</standalone_mode>
</step>

<step name="plan_gap_closure">
<team_mode>
**Already handled in streaming loop above.** Planner receives individual gap diagnoses as they arrive from debuggers via `PLAN GAP:` messages.
Skip this step in team mode - planning is integrated into the streaming loop.
</team_mode>

<standalone_mode>
**Auto-plan fixes from diagnosed gaps:**

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Hive ► PLANNING FIXES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning planner for gap closure...
```

Spawn hive-planner in --gaps mode:

```
Task(
  prompt="""
<planning_context>

**Phase:** {phase_number}
**Mode:** gap_closure

**UAT with diagnoses:**
@.planning/phases/{phase_dir}/{phase}-UAT.md

**Project State:**
@.planning/STATE.md

**Roadmap:**
@.planning/ROADMAP.md

</planning_context>

<downstream_consumer>
Output consumed by /hive:execute-phase
Plans must be executable prompts.
</downstream_consumer>

{If RECALL is non-empty, include this block:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
""",
  subagent_type="hive-planner",
  model="{planner_model}",
  description="Plan gap fixes for Phase {phase}"
)
```

On return:
- **PLANNING COMPLETE:** Proceed to `verify_gap_plans`
- **PLANNING INCONCLUSIVE:** Report and offer manual intervention
</standalone_mode>
</step>

<step name="verify_gap_plans">
<team_mode>
**Already handled in streaming loop above.** Checker verifies each plan as it arrives from the planner via `VERIFY:` messages.
Skip this step in team mode - verification is integrated into the streaming loop.
</team_mode>

<standalone_mode>
**Verify fix plans with checker:**

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Hive ► VERIFYING FIX PLANS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning plan checker...
```

Initialize: `iteration_count = 1`

Spawn hive-plan-checker:

```
Task(
  prompt="""
<verification_context>

**Phase:** {phase_number}
**Phase Goal:** Close diagnosed gaps from UAT

**Plans to verify:**
@.planning/phases/{phase_dir}/*-PLAN.md

</verification_context>

<expected_output>
Return one of:
- ## VERIFICATION PASSED — all checks pass
- ## ISSUES FOUND — structured issue list
</expected_output>

{If RECALL is non-empty, include this block:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
""",
  subagent_type="hive-plan-checker",
  model="{checker_model}",
  description="Verify Phase {phase} fix plans"
)
```

On return:
- **VERIFICATION PASSED:** Proceed to `present_ready`
- **ISSUES FOUND:** Proceed to `revision_loop`
</standalone_mode>
</step>

<step name="revision_loop">
<team_mode>
**Handled inline in streaming loop.** When checker reports issues for a specific plan:
- Send `REVISE:` to planner with targeted issues for the specific gap
- Planner revises with full context of that gap's root cause and checker feedback
- Send `RE-VERIFY:` to checker with changed plans
- Max 3 iterations per plan (tracked independently per gap)

If a plan exceeds 3 revision iterations, mark it as needing manual intervention and continue processing other gaps. Report unresolved plans in `present_ready`.
</team_mode>

<standalone_mode>
**Iterate planner ↔ checker until plans pass (max 3):**

**If iteration_count < 3:**

Display: `Sending back to planner for revision... (iteration {N}/3)`

Spawn hive-planner with revision context:

```
Task(
  prompt="""
<revision_context>

**Phase:** {phase_number}
**Mode:** revision

**Existing plans:**
@.planning/phases/{phase_dir}/*-PLAN.md

**Checker issues:**
{structured_issues_from_checker}

</revision_context>

<instructions>
Read existing PLAN.md files. Make targeted updates to address checker issues.
Do NOT replan from scratch unless issues are fundamental.
</instructions>

{If RECALL is non-empty, include this block:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
""",
  subagent_type="hive-planner",
  model="{planner_model}",
  description="Revise Phase {phase} plans"
)
```

After planner returns → spawn checker again (verify_gap_plans logic)
Increment iteration_count

**If iteration_count >= 3:**

Display: `Max iterations reached. {N} issues remain.`

Offer options:
1. Force proceed (execute despite issues)
2. Provide guidance (user gives direction, retry)
3. Abandon (exit, user runs /hive:plan-phase manually)

Wait for user response.
</standalone_mode>
</step>

<step name="qa_team_cleanup">
<team_mode>
Send shutdown requests to all teammates (planner, checker, all debuggers):

```
SendMessage(type="shutdown_request", recipient="planner", content="All gaps resolved. Shutting down.")
SendMessage(type="shutdown_request", recipient="checker", content="All gaps resolved. Shutting down.")
# For each debugger:
SendMessage(type="shutdown_request", recipient="debugger-{N}", content="All gaps resolved. Shutting down.")
```

Wait for shutdown confirmations. Then clean up the team:

```
TeamDelete("hive-qa-{phase}")
```
</team_mode>
</step>

<step name="present_ready">
**Present completion and next steps:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Hive ► FIXES READY ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase {X}: {Name}** — {N} gap(s) diagnosed, {M} fix plan(s) created

| Gap | Root Cause | Fix Plan |
|-----|------------|----------|
| {truth 1} | {root_cause} | {phase}-04 |
| {truth 2} | {root_cause} | {phase}-04 |

Plans verified and ready for execution.

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Execute fixes** — run fix plans

`/clear` then `/hive:execute-phase {phase} --gaps-only`

───────────────────────────────────────────────────────────────
```
</step>

</process>

<update_rules>
**Batched writes for efficiency:**

Keep results in memory. Write to file only when:
1. **Issue found** — Preserve the problem immediately
2. **Session complete** — Final write before commit
3. **Checkpoint** — Every 5 passed tests (safety net)

| Section | Rule | When Written |
|---------|------|--------------|
| Frontmatter.status | OVERWRITE | Start, complete |
| Frontmatter.updated | OVERWRITE | On any file write |
| Current Test | OVERWRITE | On any file write |
| Tests.{N}.result | OVERWRITE | On any file write |
| Summary | OVERWRITE | On any file write |
| Gaps | APPEND | When issue found |

On context reset: File shows last checkpoint. Resume from there.
</update_rules>

<severity_inference>
**Infer severity from user's natural language:**

| User says | Infer |
|-----------|-------|
| "crashes", "error", "exception", "fails completely" | blocker |
| "doesn't work", "nothing happens", "wrong behavior" | major |
| "works but...", "slow", "weird", "minor issue" | minor |
| "color", "spacing", "alignment", "looks off" | cosmetic |

Default to **major** if unclear. User can correct if needed.

**Never ask "how severe is this?"** - just infer and move on.
</severity_inference>

<success_criteria>
- [ ] UAT file created with all tests from SUMMARY.md
- [ ] Tests presented one at a time with expected behavior
- [ ] User responses processed as pass/issue/skip
- [ ] Severity inferred from description (never asked)
- [ ] Batched writes: on issue, every 5 passes, or completion
- [ ] Committed on completion
- [ ] If issues: parallel debug agents diagnose root causes
- [ ] If issues: hive-planner creates fix plans (gap_closure mode)
- [ ] If issues: hive-plan-checker verifies fix plans
- [ ] If issues: revision loop until plans pass (max 3 iterations)
- [ ] Ready for `/hive:execute-phase --gaps-only` when complete
- [ ] Team mode: QA team created (if config enabled)
- [ ] Team mode: streaming pipeline - planner starts on first diagnosis
- [ ] Team mode: checker verifies each plan as it arrives
- [ ] Team mode: revision loop per plan (not batched)
- [ ] Team mode: team cleaned up after all gaps resolved
</success_criteria>
</output>
