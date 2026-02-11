<purpose>
Research how to implement a phase. Spawns hive-phase-researcher with phase context.

Standalone research command. For most workflows, use `/hive:plan-phase` which integrates research automatically.
</purpose>

<process>

## Step 0: Resolve Model Profile

@~/.claude/hive/references/model-profile-resolution.md

Resolve model for:
- `hive-phase-researcher`

## Step 1: Normalize and Validate Phase

@~/.claude/hive/references/phase-argument-parsing.md

```bash
PHASE_INFO=$(node ~/.claude/hive/bin/hive-tools.js roadmap get-phase "${PHASE}")
```

If `found` is false: Error and exit.

## Step 2: Check Existing Research

```bash
ls .planning/phases/${PHASE}-*/RESEARCH.md 2>/dev/null
```

If exists: Offer update/view/skip options.

## Step 3: Gather Phase Context

```bash
# Phase section from roadmap (already loaded in PHASE_INFO)
echo "$PHASE_INFO" | jq -r '.section'
cat .planning/REQUIREMENTS.md 2>/dev/null
cat .planning/phases/${PHASE}-*/*-CONTEXT.md 2>/dev/null
# Decisions from state-snapshot (structured JSON)
node ~/.claude/hive/bin/hive-tools.js state-snapshot | jq '.decisions'
```

## Step 4: Spawn Researcher

```
Task(
  prompt="<objective>
Research implementation approach for Phase {phase}: {name}
</objective>

<context>
Phase description: {description}
Requirements: {requirements}
Prior decisions: {decisions}
Phase context: {context_md}
</context>

<output>
Write to: .planning/phases/${PHASE}-{slug}/${PHASE}-RESEARCH.md
</output>",
  subagent_type="hive-phase-researcher",
  model="{researcher_model}"
)
```

## Step 5: Handle Return

- `## RESEARCH COMPLETE` — Display summary, offer: Plan/Dig deeper/Review/Done
- `## CHECKPOINT REACHED` — Present to user, spawn continuation
- `## RESEARCH INCONCLUSIVE` — Show attempts, offer: Add context/Try different mode/Manual

</process>
