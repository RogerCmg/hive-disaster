<purpose>
Display current telemetry insights, show staleness, and offer to regenerate the digest.
</purpose>

<process>

<step name="load_insights">
Read `.planning/telemetry/INSIGHTS.md` if it exists.

If the file does NOT exist:
- Display: "No insights generated yet. No telemetry events have been analyzed."
- Display: "To generate insights, run: `node ./.claude/hive/bin/hive-tools.js telemetry digest`"
- Ask user: "Would you like to generate insights now?"
- If yes: run `node ./.claude/hive/bin/hive-tools.js telemetry digest` and then re-read and display the generated file.
- If no: end workflow.
</step>

<step name="display_insights">
If INSIGHTS.md exists, display its contents using Hive-branded formatting:

1. Show the header with generation timestamp (from the `*Generated:*` line)
2. Show the Event Summary table
3. Show the Agent Performance table
4. Show Recent Deviations
5. Show Tool Errors
6. Show Recommendations (if present)
7. Show Top Patterns (the recall markers content, formatted for human reading)

Use markdown formatting. Present the data clearly without modification.
</step>

<step name="staleness_check">
Check if insights are stale:

1. Extract the generation timestamp from INSIGHTS.md (`*Generated: {ISO date}*`)
2. Check if `.planning/telemetry/events.jsonl` exists and get its modification time
3. If events.jsonl was modified AFTER the INSIGHTS.md generation timestamp:
   - Display: "Insights may be outdated. New events have been recorded since the last digest."
   - Ask: "Would you like to regenerate the digest?"
4. If events.jsonl does NOT exist or is older than INSIGHTS.md:
   - Display: "Insights are up to date."
</step>

<step name="regenerate">
If the user requested regeneration:

1. Run: `node ./.claude/hive/bin/hive-tools.js telemetry digest`
2. Re-read the updated `.planning/telemetry/INSIGHTS.md`
3. Display the updated insights using the same format as step display_insights
4. Display: "Digest regenerated successfully."
</step>

</process>
