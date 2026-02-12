# Roadmap: Hive Recall

## Overview

Hive Recall gives agents persistent memory across sessions by observing execution, recording structured events, and feeding distilled insights back into future sessions. The roadmap progresses from storage infrastructure through passive observation, active semantic capture, feedback injection, installer integration, and finally deep transcript analysis -- each tier building on the previous to close the observe-record-digest-feedback loop.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Core Infrastructure** - Event storage backbone, CLI commands, config, and rotation
- [ ] **Phase 2: Hook Observers** - Passive automatic capture of agent lifecycle events
- [ ] **Phase 3: Workflow Integration** - Semantic event capture at workflow decision points
- [ ] **Phase 4: Feedback Loop** - Digest generation, insight injection into agent context, /hive:insights command
- [ ] **Phase 5: Installation Integration** - Hook registration and config setup during npx hive-cc install
- [ ] **Phase 6: Transcript Analysis** - Deep post-hoc session analysis agent and cross-session pattern detection

## Phase Details

### Phase 1: Core Infrastructure
**Goal**: Users can store, query, and manage telemetry events through the CLI with automatic rotation and configurable toggles
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, INFRA-09, INFRA-10
**Success Criteria** (what must be TRUE):
  1. Running `hive-tools.js telemetry emit agent_completion --data '{...}'` appends a valid JSONL line to `.planning/telemetry/events.jsonl` with ts, session, type, v, and data fields
  2. Running `hive-tools.js telemetry query --type deviation --since 7d --limit 5` returns only matching events from the JSONL file
  3. Running `hive-tools.js telemetry digest` produces a readable `.planning/telemetry/INSIGHTS.md` with agent performance tables and pattern summaries
  4. Running `hive-tools.js telemetry rotate` archives events.jsonl when over 500KB and keeps at most 10 archive files
  5. The `telemetry` section in config.json controls whether emit calls write events (when `enabled: false`, no events are recorded)
**Plans**: TBD

Plans:
- [ ] 01-01: JSONL storage engine and event envelope (INFRA-01, INFRA-02, INFRA-03)
- [ ] 01-02: CLI commands -- emit, query, stats, rotate (INFRA-04, INFRA-05, INFRA-07, INFRA-08, INFRA-09)
- [ ] 01-03: Digest command and config section (INFRA-06, INFRA-10)

### Phase 2: Hook Observers
**Goal**: Agent completions, tool errors, context compaction, and session boundaries are automatically captured without any workflow changes
**Depends on**: Phase 1 (needs event storage and emit infrastructure)
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, HOOK-06, HOOK-07
**Success Criteria** (what must be TRUE):
  1. After a Hive agent completes, an `agent_completion` event appears in events.jsonl with agent name, duration, and exit code
  2. After a tool fails during a Hive session, a `tool_error` event appears in events.jsonl with tool name and error message
  3. When context compaction fires, a `context_compaction` event is recorded; when a session starts or ends, `session_boundary` events are recorded
  4. A hook failure (malformed input, disk error) is silently swallowed and does not interrupt the running workflow or agent
  5. Non-Hive agents and tools are ignored -- only events from Hive-prefixed agents generate telemetry
**Plans**: TBD

Plans:
- [ ] 02-01: Hook scaffolding and SubagentStop observer (HOOK-01, HOOK-06, HOOK-07)
- [ ] 02-02: Error, compaction, and session hooks (HOOK-02, HOOK-03, HOOK-04, HOOK-05)

### Phase 3: Workflow Integration
**Goal**: Semantic events that hooks cannot see -- deviations, checkpoints, verification gaps, plan revisions, and user corrections -- are captured at workflow decision points
**Depends on**: Phase 2 (hooks provide baseline; workflows add semantic layer)
**Requirements**: WFLOW-01, WFLOW-02, WFLOW-03, WFLOW-04, WFLOW-05
**Success Criteria** (what must be TRUE):
  1. When an executor auto-fixes or escalates a deviation, a `deviation` event appears in events.jsonl with phase, plan, severity, and resolution
  2. When a checkpoint resolves during phase execution, a `checkpoint` event records the checkpoint type, user response, and outcome
  3. When verification finds a gap, a `verification_gap` event records what failed and at which verification level
  4. When a user modifies or rejects agent output at a confirmation gate, a `user_correction` event captures what changed
**Plans**: TBD

Plans:
- [ ] 03-01: Deviation and checkpoint emit integration (WFLOW-01, WFLOW-02)
- [ ] 03-02: Verification, revision, and correction emit integration (WFLOW-03, WFLOW-04, WFLOW-05)

### Phase 4: Feedback Loop
**Goal**: Accumulated events are transformed into actionable insights that agents automatically receive at spawn, closing the observe-to-improve loop
**Depends on**: Phase 3 (needs semantic events to produce meaningful insights)
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-04, FEED-05, FEED-06
**Success Criteria** (what must be TRUE):
  1. Running `hive-tools.js telemetry digest` produces INSIGHTS.md with recurring patterns, agent performance tables, deviation trends, and concrete recommendations
  2. Init commands return a `recall_context` field containing top patterns extracted from INSIGHTS.md, which agents receive as a `<recall>` block in their prompts
  3. Running `/hive:insights` displays current project insights and offers to regenerate the digest
  4. `events.jsonl` is gitignored (raw data stays local) while `INSIGHTS.md` is committed to git (shareable project wisdom)
**Plans**: TBD

Plans:
- [ ] 04-01: Enhanced digest generation and INSIGHTS.md format (FEED-01, FEED-05, FEED-06)
- [ ] 04-02: Recall injection into init commands and agent prompts (FEED-02, FEED-03)
- [ ] 04-03: /hive:insights command and workflow (FEED-04)

### Phase 5: Installation Integration
**Goal**: Running `npx hive-cc` installs all Recall hooks and config automatically so users get telemetry out of the box
**Depends on**: Phase 2 (hooks must exist before installer can copy them)
**Requirements**: INST-01, INST-02, INST-03
**Success Criteria** (what must be TRUE):
  1. After running `npx hive-cc`, the 4 hook observer files are present in the project's hooks directory
  2. After installation, `.claude/settings.json` contains registrations for SubagentStop, PostToolUseFailure, PreCompact, SessionStart, and SessionEnd hooks pointing to the Recall observer scripts
  3. After installation, the project's config.json includes the `telemetry` section with default toggle values
**Plans**: TBD

Plans:
- [ ] 05-01: Installer hook copying, settings registration, and config setup (INST-01, INST-02, INST-03)

### Phase 6: Transcript Analysis
**Goal**: A dedicated analysis agent can examine session transcripts for deep patterns that neither hooks nor workflow events capture
**Depends on**: Phase 4 (needs feedback loop infrastructure to deliver analysis results)
**Requirements**: TRANS-01, TRANS-02, TRANS-03
**Success Criteria** (what must be TRUE):
  1. The `hive-recall-analyst` agent can parse a session transcript and produce a `session_summary` event with quality score, waste percentage, and concrete recommendations
  2. The analyst detects cross-session patterns: recurring failures, implicit user preferences, and agent behavior drift across multiple session summaries
  3. Transcript analysis is off by default (`transcript_analysis: false` in config) and runs only when explicitly invoked
**Plans**: TBD

Plans:
- [ ] 06-01: Recall analyst agent definition and session summary event (TRANS-01, TRANS-02)
- [ ] 06-02: Cross-session pattern detection (TRANS-03)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Infrastructure | 0/3 | Not started | - |
| 2. Hook Observers | 0/2 | Not started | - |
| 3. Workflow Integration | 0/2 | Not started | - |
| 4. Feedback Loop | 0/3 | Not started | - |
| 5. Installation Integration | 0/1 | Not started | - |
| 6. Transcript Analysis | 0/2 | Not started | - |

---
*Roadmap created: 2026-02-11*
*Last updated: 2026-02-11*
