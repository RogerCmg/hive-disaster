# Model Profiles

Model profiles control which Claude model each Hive agent uses. This allows balancing quality vs token spend.

## Profile Definitions

| Agent | `quality` | `balanced` | `budget` |
|-------|-----------|------------|----------|
| hive-planner | opus | opus | sonnet |
| hive-roadmapper | opus | sonnet | sonnet |
| hive-executor | opus | sonnet | sonnet |
| hive-phase-researcher | opus | sonnet | haiku |
| hive-project-researcher | opus | sonnet | haiku |
| hive-research-synthesizer | sonnet | sonnet | haiku |
| hive-debugger | opus | sonnet | sonnet |
| hive-codebase-mapper | sonnet | haiku | haiku |
| hive-verifier | sonnet | sonnet | haiku |
| hive-plan-checker | sonnet | sonnet | haiku |
| hive-integration-checker | sonnet | sonnet | haiku |

## Profile Philosophy

**quality** - Maximum reasoning power
- Opus for all decision-making agents
- Sonnet for read-only verification
- Use when: quota available, critical architecture work

**balanced** (default) - Smart allocation
- Opus only for planning (where architecture decisions happen)
- Sonnet for execution and research (follows explicit instructions)
- Sonnet for verification (needs reasoning, not just pattern matching)
- Use when: normal development, good balance of quality and cost

**budget** - Minimal Opus usage
- Sonnet for anything that writes code
- Haiku for research and verification
- Use when: conserving quota, high-volume work, less critical phases

## Resolution Logic

Orchestrators resolve model before spawning:

```
1. Read .planning/config.json
2. Get model_profile (default: "balanced")
3. Look up agent in table above
4. Pass model parameter to Task call
```

## Switching Profiles

Runtime: `/hive:set-profile <profile>`

Per-project default: Set in `.planning/config.json`:
```json
{
  "model_profile": "balanced"
}
```

## Design Rationale

**Why Opus for hive-planner?**
Planning involves architecture decisions, goal decomposition, and task design. This is where model quality has the highest impact.

**Why Sonnet for hive-executor?**
Executors follow explicit PLAN.md instructions. The plan already contains the reasoning; execution is implementation.

**Why Sonnet (not Haiku) for verifiers in balanced?**
Verification requires goal-backward reasoning - checking if code *delivers* what the phase promised, not just pattern matching. Sonnet handles this well; Haiku may miss subtle gaps.

**Why Haiku for hive-codebase-mapper?**
Read-only exploration and pattern extraction. No reasoning required, just structured output from file contents.
