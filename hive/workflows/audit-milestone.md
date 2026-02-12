<purpose>
Verify milestone achieved its definition of done by aggregating phase verifications, checking cross-phase integration, and assessing requirements coverage. Reads existing VERIFICATION.md files (phases already verified during execute-phase), aggregates tech debt and deferred gaps, then spawns integration checker for cross-phase wiring.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

## 0. Initialize Milestone Context

```bash
INIT=$(node ~/.claude/hive/bin/hive-tools.js init milestone-op)
```

Extract from init JSON: `milestone_version`, `milestone_name`, `phase_count`, `completed_phases`, `commit_docs`.

Extract recall context for agent prompts (milestone-op does not include recall_context, use phase-op as proxy):
```bash
RECALL=$(node ~/.claude/hive/bin/hive-tools.js init phase-op 1 2>/dev/null | jq -r '.recall_context // empty')
```

Resolve integration checker model:
```bash
CHECKER_MODEL=$(node ~/.claude/hive/bin/hive-tools.js resolve-model hive-integration-checker --raw)
```

## 1. Determine Milestone Scope

```bash
# Get phases in milestone (sorted numerically, handles decimals)
node ~/.claude/hive/bin/hive-tools.js phases list
```

- Parse version from arguments or detect current from ROADMAP.md
- Identify all phase directories in scope
- Extract milestone definition of done from ROADMAP.md
- Extract requirements mapped to this milestone from REQUIREMENTS.md

## 1.5. Audit Team Setup

<team_mode_setup>
Check config for audit team coordination:
```bash
AUDIT_TEAM=$(echo "$INIT" | jq -r '.teams.audit_team // false')
```

**If enabled AND phase_count >= 3:** `TeamCreate("hive-audit-{milestone}")`, set `audit_mode = "team"`.
**If fails or disabled:** set `audit_mode = "standalone"`.

```bash
AUDIT_MODE="standalone"
AUDIT_TEAM_NAME="hive-audit-${MILESTONE_VERSION}"

if [ "$AUDIT_TEAM" = "true" ] && [ "$PHASE_COUNT" -ge 3 ]; then
  # Attempt team creation — fall back to standalone if unavailable
  AUDIT_MODE="team"
fi
```

**Rationale for phase_count >= 3 threshold:** With fewer than 3 phases, the overhead of team coordination exceeds the benefit of incremental analysis. Sequential reading is fast enough.
</team_mode_setup>

## 2. Read All Phase Verifications

<team_mode>
## Team Mode Phase Reading (audit_mode = "team")

**Incremental audit** — phase readers send data to integration checker as they complete, enabling earlier cross-phase detection.

Spawn the integration checker FIRST (it will receive data incrementally):

```
Task(
  subagent_type="hive-integration-checker",
  model="{integration_checker_model}",
  team_name="{AUDIT_TEAM_NAME}",
  name="integration-checker",
  prompt="You are the integration checker on team {AUDIT_TEAM_NAME}.
You will receive PHASE DATA messages incrementally as phase readers complete.

<team_protocol>
You are integration-checker on team {AUDIT_TEAM_NAME}.
As you receive PHASE DATA messages, begin analyzing cross-phase issues.
Do NOT wait for all phases — start checking wiring as data arrives.
When you receive 'ALL PHASES LOADED', run full cross-phase analysis and report.
Send your final report as: SendMessage(type='message', recipient='team-lead', content='AUDIT COMPLETE: {report}', summary='Audit report ready')
</team_protocol>

<task>
Check cross-phase integration and E2E flows.
Phases: {phase_dirs}
Verify cross-phase wiring and E2E user flows.
</task>

{If RECALL is non-empty, include this block:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
"
)
```

Then spawn a phase-reader teammate per phase:

For each phase:
```
Task(
  subagent_type="general-purpose",
  model="{researcher_model}",
  team_name="{AUDIT_TEAM_NAME}",
  name="reader-{phase_slug}",
  prompt="You are reader-{phase_slug} on team {AUDIT_TEAM_NAME}.

<team_protocol>
Read VERIFICATION.md and SUMMARYs for phase {phase_number}-{phase_name}.
Extract: status, critical gaps, non-critical gaps, anti-patterns, requirements coverage.
When complete, send findings to team lead:
  SendMessage(type='message', recipient='team-lead',
    content='PHASE VERIFIED: {phase_slug} | status={status} | gaps={count} | debt={count}\n{details}',
    summary='Phase {phase_number} verified')
</team_protocol>

<files_to_read>
- {phase_dir}/*-VERIFICATION.md
- {phase_dir}/*/SUMMARY.md
</files_to_read>

<extract>
- Status: passed | gaps_found
- Critical gaps: (if any — these are blockers)
- Non-critical gaps: tech debt, deferred items, warnings
- Anti-patterns found: TODOs, stubs, placeholders
- Requirements coverage: which requirements satisfied/blocked
</extract>

If VERIFICATION.md is missing, send: PHASE VERIFIED: {phase_slug} | status=UNVERIFIED | gaps=BLOCKER

{If RECALL is non-empty, include this block:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>
"
)
```

**Incremental feed to integration checker:**

As each reader sends `PHASE VERIFIED:`, relay phase data to integration checker:
```
SendMessage(
  type="message",
  recipient="integration-checker",
  content="PHASE DATA: {phase_data}",
  summary="Phase {N} data for integration check"
)
```

The integration checker can start analyzing cross-phase issues as data arrives (e.g., after receiving phases 1 and 2, it can already check wiring between them without waiting for phases 3-5).

If a phase reader reports `status=UNVERIFIED`, flag it immediately — this is a blocker.
</team_mode>

<standalone_mode>
## Standalone Mode Phase Reading (audit_mode = "standalone")

For each phase directory, read the VERIFICATION.md:

```bash
cat .planning/phases/01-*/*-VERIFICATION.md
cat .planning/phases/02-*/*-VERIFICATION.md
# etc.
```

From each VERIFICATION.md, extract:
- **Status:** passed | gaps_found
- **Critical gaps:** (if any — these are blockers)
- **Non-critical gaps:** tech debt, deferred items, warnings
- **Anti-patterns found:** TODOs, stubs, placeholders
- **Requirements coverage:** which requirements satisfied/blocked

If a phase is missing VERIFICATION.md, flag it as "unverified phase" — this is a blocker.
</standalone_mode>

## 3. Spawn Integration Checker

<team_mode>
## Team Mode Integration Check (audit_mode = "team")

Integration checker was already spawned in Step 2 and has been receiving data incrementally.

After all phase readers complete, send the final trigger:
```
SendMessage(
  type="message",
  recipient="integration-checker",
  content="ALL PHASES LOADED. Run full cross-phase analysis now. Verify E2E user flows end-to-end. Report all wiring gaps, broken flows, and integration issues.",
  summary="All phases loaded — run full analysis"
)
```

Wait for integration checker's final report (`AUDIT COMPLETE:` message).
</team_mode>

<standalone_mode>
## Standalone Mode Integration Check (audit_mode = "standalone")

With phase context collected:

```
Task(
  prompt="Check cross-phase integration and E2E flows.

Phases: {phase_dirs}
Phase exports: {from SUMMARYs}
API routes: {routes created}

Verify cross-phase wiring and E2E user flows.

{If RECALL is non-empty, include this block:}

<recall>
Past project patterns from telemetry:
{RECALL}
Use these patterns to avoid known issues and follow proven approaches.
</recall>",
  subagent_type="hive-integration-checker",
  model="{integration_checker_model}"
)
```
</standalone_mode>

## 4. Collect Results

Combine:
- Phase-level gaps and tech debt (from step 2)
- Integration checker's report (wiring gaps, broken flows)

## 5. Check Requirements Coverage

For each requirement in REQUIREMENTS.md mapped to this milestone:
- Find owning phase
- Check phase verification status
- Determine: satisfied | partial | unsatisfied

## 6. Aggregate into v{version}-MILESTONE-AUDIT.md

Create `.planning/v{version}-v{version}-MILESTONE-AUDIT.md` with:

```yaml
---
milestone: {version}
audited: {timestamp}
status: passed | gaps_found | tech_debt
scores:
  requirements: N/M
  phases: N/M
  integration: N/M
  flows: N/M
gaps:  # Critical blockers
  requirements: [...]
  integration: [...]
  flows: [...]
tech_debt:  # Non-critical, deferred
  - phase: 01-auth
    items:
      - "TODO: add rate limiting"
      - "Warning: no password strength validation"
  - phase: 03-dashboard
    items:
      - "Deferred: mobile responsive layout"
---
```

Plus full markdown report with tables for requirements, phases, integration, tech debt.

**Status values:**
- `passed` — all requirements met, no critical gaps, minimal tech debt
- `gaps_found` — critical blockers exist
- `tech_debt` — no blockers but accumulated deferred items need review

## 6.5. Team Cleanup

<team_mode>
After audit report is aggregated, shut down the audit team:
```
# Send shutdown requests to all phase readers and integration checker
for reader in phase_readers:
  SendMessage(type="shutdown_request", recipient="{reader}", content="Audit complete. Shutting down.")
SendMessage(type="shutdown_request", recipient="integration-checker", content="Audit complete. Shutting down.")

# Wait for shutdown confirmations, then delete team
TeamDelete()
```
</team_mode>

## 7. Present Results

Route by status (see `<offer_next>`).

</process>

<offer_next>
Output this markdown directly (not as a code block). Route based on status:

---

**If passed:**

## ✓ Milestone {version} — Audit Passed

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

All requirements covered. Cross-phase integration verified. E2E flows complete.

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Complete milestone** — archive and tag

/hive:complete-milestone {version}

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

---

**If gaps_found:**

## ⚠ Milestone {version} — Gaps Found

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

### Unsatisfied Requirements

{For each unsatisfied requirement:}
- **{REQ-ID}: {description}** (Phase {X})
  - {reason}

### Cross-Phase Issues

{For each integration gap:}
- **{from} → {to}:** {issue}

### Broken Flows

{For each flow gap:}
- **{flow name}:** breaks at {step}

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Plan gap closure** — create phases to complete milestone

/hive:plan-milestone-gaps

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

**Also available:**
- cat .planning/v{version}-MILESTONE-AUDIT.md — see full report
- /hive:complete-milestone {version} — proceed anyway (accept tech debt)

───────────────────────────────────────────────────────────────

---

**If tech_debt (no blockers but accumulated debt):**

## ⚡ Milestone {version} — Tech Debt Review

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

All requirements met. No critical blockers. Accumulated tech debt needs review.

### Tech Debt by Phase

{For each phase with debt:}
**Phase {X}: {name}**
- {item 1}
- {item 2}

### Total: {N} items across {M} phases

───────────────────────────────────────────────────────────────

## ▶ Options

**A. Complete milestone** — accept debt, track in backlog

/hive:complete-milestone {version}

**B. Plan cleanup phase** — address debt before completing

/hive:plan-milestone-gaps

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────
</offer_next>

<success_criteria>
- [ ] Milestone scope identified
- [ ] All phase VERIFICATION.md files read
- [ ] Tech debt and deferred gaps aggregated
- [ ] Integration checker spawned for cross-phase wiring
- [ ] v{version}-MILESTONE-AUDIT.md created
- [ ] Results presented with actionable next steps

**Team mode additional (if audit_mode = "team"):**
- [ ] Audit team created: hive-audit-{milestone}
- [ ] Integration checker spawned first (receives data incrementally)
- [ ] Phase readers spawned as teammates (one per phase)
- [ ] Phase data relayed to integration checker as each reader completes
- [ ] Integration checker started cross-phase analysis before all phases loaded
- [ ] Final full analysis triggered after all phase readers complete
- [ ] Audit team shut down after report aggregated
</success_criteria>
