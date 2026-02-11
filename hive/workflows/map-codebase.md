<purpose>
Orchestrate parallel codebase mapper agents to analyze codebase and produce structured documents in .planning/codebase/

Each agent has fresh context, explores a specific focus area, and **writes documents directly**. The orchestrator only receives confirmation + line counts, then writes a summary.

Output: .planning/codebase/ folder with 7 structured documents about the codebase state.
</purpose>

<philosophy>
**Why dedicated mapper agents:**
- Fresh context per domain (no token contamination)
- Agents write documents directly (no context transfer back to orchestrator)
- Orchestrator only summarizes what was created (minimal context usage)
- Faster execution (agents run simultaneously)

**Document quality over length:**
Include enough detail to be useful as reference. Prioritize practical examples (especially code patterns) over arbitrary brevity.

**Always include file paths:**
Documents are reference material for Claude when planning/executing. Always include actual file paths formatted with backticks: `src/services/user.ts`.
</philosophy>

<process>

<step name="init_context" priority="first">
Load codebase mapping context:

```bash
INIT=$(node ~/.claude/hive/bin/hive-tools.js init map-codebase)
```

Extract from init JSON: `mapper_model`, `commit_docs`, `codebase_dir`, `existing_maps`, `has_maps`, `codebase_dir_exists`.
</step>

<step name="check_existing">
Check if .planning/codebase/ already exists using `has_maps` from init context.

If `codebase_dir_exists` is true:
```bash
ls -la .planning/codebase/
```

**If exists:**

```
.planning/codebase/ already exists with these documents:
[List files found]

What's next?
1. Refresh - Delete existing and remap codebase
2. Update - Keep existing, only update specific documents
3. Skip - Use existing codebase map as-is
```

Wait for user response.

If "Refresh": Delete .planning/codebase/, continue to create_structure
If "Update": Ask which documents to update, continue to spawn_agents (filtered)
If "Skip": Exit workflow

**If doesn't exist:**
Continue to create_structure.
</step>

<step name="create_structure">
Create .planning/codebase/ directory:

```bash
mkdir -p .planning/codebase
```

**Expected output files:**
- STACK.md (from tech mapper)
- INTEGRATIONS.md (from tech mapper)
- ARCHITECTURE.md (from arch mapper)
- STRUCTURE.md (from arch mapper)
- CONVENTIONS.md (from quality mapper)
- TESTING.md (from quality mapper)
- CONCERNS.md (from concerns mapper)

Continue to spawn_agents.
</step>

<step name="create_mapper_team">
<team_mode_setup>
Check config:
```bash
MAPPER_TEAM=$(echo "$INIT" | jq -r '.teams.mapper_team // false')
```

**If enabled:** `TeamCreate("hive-map-codebase")`, set `mapper_mode = "team"`.
**If fails or disabled:** set `mapper_mode = "standalone"`.
</team_mode_setup>
</step>

<step name="spawn_agents">
Spawn 4 parallel hive-codebase-mapper agents.

**CRITICAL:** Use the dedicated `hive-codebase-mapper` agent, NOT `Explore`. The mapper agent writes documents directly.

**MODE SPLIT:** Team mode vs. standalone mode (fallback).

<team_mode>
## Team Mode (mapper_mode="team")

Spawn mappers as teammates:
```
Task(..., team_name="hive-map-codebase", name="tech-mapper")
Task(..., team_name="hive-map-codebase", name="arch-mapper")
Task(..., team_name="hive-map-codebase", name="quality-mapper")
Task(..., team_name="hive-map-codebase", name="concerns-mapper")
```

Each mapper gets the same prompt as standalone mode (see below) plus team protocol:
```
<team_protocol>
You are {name} on team hive-map-codebase.
When you discover something cross-cutting, broadcast with prefix FINDING: {description}.
When complete, send: MAPPING COMPLETE: {focus} | files: [{docs}] | lines: {counts}
</team_protocol>
```

**Cross-pollination loop:**
Monitor for mapper messages:

| Prefix | Action |
|--------|--------|
| `MAPPING COMPLETE:` | Mapper finished, documents written |
| `FINDING:` | Broadcast to all mappers for terminology/context alignment |

When a mapper discovers something cross-cutting (e.g., "This project uses camelCase everywhere"), broadcast to others so all documents use consistent terminology.
</team_mode>

<standalone_mode>
## Standalone Mode (mapper_mode="standalone" — fallback)

Use Task tool with `subagent_type="hive-codebase-mapper"`, `model="{mapper_model}"`, and `run_in_background=true` for parallel execution.

**Agent 1: Tech Focus**

Task tool parameters:
```
subagent_type: "hive-codebase-mapper"
model: "{mapper_model}"
run_in_background: true
description: "Map codebase tech stack"
```

Prompt:
```
Focus: tech

Analyze this codebase for technology stack and external integrations.

Write these documents to .planning/codebase/:
- STACK.md - Languages, runtime, frameworks, dependencies, configuration
- INTEGRATIONS.md - External APIs, databases, auth providers, webhooks

Explore thoroughly. Write documents directly using templates. Return confirmation only.
```

**Agent 2: Architecture Focus**

Task tool parameters:
```
subagent_type: "hive-codebase-mapper"
model: "{mapper_model}"
run_in_background: true
description: "Map codebase architecture"
```

Prompt:
```
Focus: arch

Analyze this codebase architecture and directory structure.

Write these documents to .planning/codebase/:
- ARCHITECTURE.md - Pattern, layers, data flow, abstractions, entry points
- STRUCTURE.md - Directory layout, key locations, naming conventions

Explore thoroughly. Write documents directly using templates. Return confirmation only.
```

**Agent 3: Quality Focus**

Task tool parameters:
```
subagent_type: "hive-codebase-mapper"
model: "{mapper_model}"
run_in_background: true
description: "Map codebase conventions"
```

Prompt:
```
Focus: quality

Analyze this codebase for coding conventions and testing patterns.

Write these documents to .planning/codebase/:
- CONVENTIONS.md - Code style, naming, patterns, error handling
- TESTING.md - Framework, structure, mocking, coverage

Explore thoroughly. Write documents directly using templates. Return confirmation only.
```

**Agent 4: Concerns Focus**

Task tool parameters:
```
subagent_type: "hive-codebase-mapper"
model: "{mapper_model}"
run_in_background: true
description: "Map codebase concerns"
```

Prompt:
```
Focus: concerns

Analyze this codebase for technical debt, known issues, and areas of concern.

Write this document to .planning/codebase/:
- CONCERNS.md - Tech debt, bugs, security, performance, fragile areas

Explore thoroughly. Write document directly using template. Return confirmation only.
```
</standalone_mode>

Continue to collect_confirmations.
</step>

<step name="collect_confirmations">
Wait for all 4 mappers to complete.

<team_mode>
## Team Mode Collection (mapper_mode="team")

Collect via messages instead of reading output files.
Each mapper sends `MAPPING COMPLETE: {focus} | files: [{docs}] | lines: {counts}`.

Wait for all 4 `MAPPING COMPLETE:` messages. Track which mappers have reported:

| Mapper | Status |
|--------|--------|
| tech-mapper | waiting / complete |
| arch-mapper | waiting / complete |
| quality-mapper | waiting / complete |
| concerns-mapper | waiting / complete |

If any mapper fails or goes unresponsive, note the failure and continue with successful documents.
</team_mode>

<standalone_mode>
## Standalone Mode Collection (mapper_mode="standalone" — fallback)

Read each agent's output file to collect confirmations.

**Expected confirmation format from each agent:**
```
## Mapping Complete

**Focus:** {focus}
**Documents written:**
- `.planning/codebase/{DOC1}.md` ({N} lines)
- `.planning/codebase/{DOC2}.md` ({N} lines)

Ready for orchestrator summary.
```

**What you receive:** Just file paths and line counts. NOT document contents.

If any agent failed, note the failure and continue with successful documents.
</standalone_mode>

Continue to verify_output.
</step>

<step name="verify_output">
Verify all documents created successfully:

```bash
ls -la .planning/codebase/
wc -l .planning/codebase/*.md
```

**Verification checklist:**
- All 7 documents exist
- No empty documents (each should have >20 lines)

If any documents missing or empty, note which agents may have failed.

Continue to scan_for_secrets.
</step>

<step name="scan_for_secrets">
**CRITICAL SECURITY CHECK:** Scan output files for accidentally leaked secrets before committing.

Run secret pattern detection:

```bash
# Check for common API key patterns in generated docs
grep -E '(sk-[a-zA-Z0-9]{20,}|sk_live_[a-zA-Z0-9]+|sk_test_[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]+|AKIA[A-Z0-9]{16}|xox[baprs]-[a-zA-Z0-9-]+|-----BEGIN.*PRIVATE KEY|eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.)' .planning/codebase/*.md 2>/dev/null && SECRETS_FOUND=true || SECRETS_FOUND=false
```

**If SECRETS_FOUND=true:**

```
⚠️  SECURITY ALERT: Potential secrets detected in codebase documents!

Found patterns that look like API keys or tokens in:
[show grep output]

This would expose credentials if committed.

**Action required:**
1. Review the flagged content above
2. If these are real secrets, they must be removed before committing
3. Consider adding sensitive files to Claude Code "Deny" permissions

Pausing before commit. Reply "safe to proceed" if the flagged content is not actually sensitive, or edit the files first.
```

Wait for user confirmation before continuing to commit_codebase_map.

**If SECRETS_FOUND=false:**

Continue to commit_codebase_map.
</step>

<step name="cleanup_mapper_team">
<team_mode>
## Team Cleanup (mapper_mode="team")

Shut down the mapper team after all documents are verified:
```
# Send shutdown requests to all mapper teammates
SendMessage(type="shutdown_request", recipient="tech-mapper", content="Mapping complete. Shutting down.")
SendMessage(type="shutdown_request", recipient="arch-mapper", content="Mapping complete. Shutting down.")
SendMessage(type="shutdown_request", recipient="quality-mapper", content="Mapping complete. Shutting down.")
SendMessage(type="shutdown_request", recipient="concerns-mapper", content="Mapping complete. Shutting down.")
```

Wait for shutdown confirmations. Then:
```
TeamDelete()
```
</team_mode>

<standalone_mode>
No cleanup needed — Task agents terminate on completion.
</standalone_mode>
</step>

<step name="commit_codebase_map">
Commit the codebase map:

```bash
node ~/.claude/hive/bin/hive-tools.js commit "docs: map existing codebase" --files .planning/codebase/*.md
```

Continue to offer_next.
</step>

<step name="offer_next">
Present completion summary and next steps.

**Get line counts:**
```bash
wc -l .planning/codebase/*.md
```

**Output format:**

```
Codebase mapping complete.

Created .planning/codebase/:
- STACK.md ([N] lines) - Technologies and dependencies
- ARCHITECTURE.md ([N] lines) - System design and patterns
- STRUCTURE.md ([N] lines) - Directory layout and organization
- CONVENTIONS.md ([N] lines) - Code style and patterns
- TESTING.md ([N] lines) - Test structure and practices
- INTEGRATIONS.md ([N] lines) - External services and APIs
- CONCERNS.md ([N] lines) - Technical debt and issues


---

## ▶ Next Up

**Initialize project** — use codebase context for planning

`/hive:new-project`

<sub>`/clear` first → fresh context window</sub>

---

**Also available:**
- Re-run mapping: `/hive:map-codebase`
- Review specific file: `cat .planning/codebase/STACK.md`
- Edit any document before proceeding

---
```

End workflow.
</step>

</process>

<success_criteria>
- .planning/codebase/ directory created
- Team mode detected and mapper team created (if enabled in config)
- 4 parallel hive-codebase-mapper agents spawned (as teammates in team mode, with run_in_background=true in standalone mode)
- Agents write documents directly (orchestrator doesn't receive document contents)
- Team mode: cross-pollination of FINDING: messages for consistent terminology
- Team mode: collect confirmations via MAPPING COMPLETE: messages
- Standalone mode: read agent output files to collect confirmations
- All 7 codebase documents exist
- Team mode: mapper team shut down after verification
- Clear completion summary with line counts
- User offered clear next steps in Hive style
</success_criteria>
