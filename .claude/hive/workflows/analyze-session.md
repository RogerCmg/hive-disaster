<purpose>
Analyze a Claude Code session transcript for deep quality patterns using the hive-recall-analyst agent. Extracts transcript data via CLI, spawns the analyst, parses results, and emits a session_summary event.
</purpose>

<process>

<step name="check_config">
Run `node ./.claude/hive/bin/hive-tools.js telemetry stats --raw` and check if transcript_analysis is enabled by examining config.

Also check the config directly:
```bash
node -e "const c = JSON.parse(require('fs').readFileSync('.planning/config.json','utf-8')); console.log(c.telemetry && c.telemetry.transcript_analysis === true ? 'enabled' : 'disabled')"
```

If disabled, inform the user:
"Transcript analysis is disabled. To enable, set `transcript_analysis: true` in your project's `.planning/config.json` telemetry section."

Ask if they want to continue anyway (they can enable it manually first). If they decline, end.

If they want to proceed, temporarily note that the CLI command will error due to config gating. They must enable config first.
</step>

<step name="extract_transcript">
Run the transcript extraction command:

```bash
node ./.claude/hive/bin/hive-tools.js telemetry transcript [SESSION_ID] --raw
```

Where `SESSION_ID` is optional -- if not provided, the CLI extracts the latest session transcript.

Parse the JSON output. It contains:
- `session_id`, `transcript_path`, `message_count`
- `user_turns`, `assistant_turns`
- `total_input_tokens`, `total_output_tokens`
- `tool_uses` (object: tool name -> count)
- `tool_errors` (count)
- `condensed_transcript` (array of {role, text, tools?, ts})

Display summary to user:
"Found session with {user_turns} user turns, {assistant_turns} assistant turns, {total_input_tokens} input tokens."

If the command errors (no transcript found, session too short, analysis disabled), display the error and end.
</step>

<step name="analyze">
Spawn the `hive-recall-analyst` agent via Task():

In the Task prompt, include:
1. The condensed transcript from step 2 (as a JSON code block)
2. The metrics: token counts, tool usage counts, tool error count
3. Telemetry stats context: run `node ./.claude/hive/bin/hive-tools.js telemetry stats --raw` and include the event counts so the analyst has quantitative context about the project's telemetry history

The agent will return a JSON code block with:
- `quality_score` (0-100)
- `waste_pct` (0-100)
- `patterns` (array, max 5)
- `recommendations` (array, max 3)
- `user_preference_signals` (array, max 3)
- `agent_behavior_notes` (array, max 3)

Parse the JSON from the agent's response. If parsing fails, display the raw response and ask the user if they want to retry.
</step>

<step name="emit_event">
Parse the analyst's JSON output. Construct a session_summary event data object:

```json
{
  "quality_score": <from analyst>,
  "waste_pct": <from analyst>,
  "patterns": <from analyst, max 5>,
  "recommendations": <from analyst, max 3>,
  "user_preferences": <from analyst user_preference_signals, max 3>,
  "metrics": {
    "user_turns": <from extraction>,
    "assistant_turns": <from extraction>,
    "total_input_tokens": <from extraction>,
    "total_output_tokens": <from extraction>,
    "tool_uses": <from extraction>
  }
}
```

Emit the event:
```bash
node ./.claude/hive/bin/hive-tools.js telemetry emit session_summary --data '<JSON>'
```

Verify the emit succeeds (output should be "ok" or `{ "emitted": true }`).
</step>

<step name="report">
Display the analysis results to the user in a readable format:

**Session Analysis Results**

- **Quality Score:** {quality_score}/100
- **Context Waste:** {waste_pct}%

**Patterns Observed:**
{numbered list of patterns}

**Recommendations:**
{numbered list of recommendations}

**User Preference Signals:**
{numbered list of user_preference_signals}

**Agent Behavior Notes:**
{numbered list of agent_behavior_notes}

---

Offer to regenerate the telemetry digest to incorporate the new session_summary:
"Would you like to regenerate the insights digest to include this analysis?"

If yes, run:
```bash
node ./.claude/hive/bin/hive-tools.js telemetry digest
```

Display confirmation: "Digest regenerated. Run `/hive:insights` to view updated insights."
</step>

</process>
