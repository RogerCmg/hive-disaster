#!/usr/bin/env node
// Hive Recall -- Tool error observer
// Hook: PostToolUseFailure | Fail-silent

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // HOOK-07: Only log in Hive projects (check .planning/ exists)
    const planningDir = path.join(data.cwd, '.planning');
    if (!fs.existsSync(planningDir)) return;

    // Config check: telemetry enabled and hooks enabled?
    const configPath = path.join(data.cwd, '.planning', 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.telemetry?.enabled === false) return;
      if (config.telemetry?.hooks === false) return;
    } catch {
      // Missing config = enabled by default
    }

    // Skip user interrupts (not real errors)
    if (data.is_interrupt) return;

    // Build event envelope (matches Phase 1 createEventEnvelope format)
    const event = {
      ts: new Date().toISOString(),
      session: data.session_id || 'unknown',
      type: 'tool_error',
      v: 1,
      data: {
        tool: data.tool_name || 'unknown',
        command: data.tool_input?.command || null,
        error: data.error || 'unknown error'
      }
    };

    // Write to events.jsonl
    const telemetryDir = path.join(data.cwd, '.planning', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.appendFileSync(
      path.join(telemetryDir, 'events.jsonl'),
      JSON.stringify(event) + '\n'
    );
  } catch (e) {
    // HOOK-06: Fail silent -- observation never breaks execution
  }
});
