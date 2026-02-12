#!/usr/bin/env node
// Hive Recall -- Context compaction observer
// Hook: PreCompact | Fail-silent

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

    // Build event envelope (matches Phase 1 createEventEnvelope format)
    const event = {
      ts: new Date().toISOString(),
      session: data.session_id || 'unknown',
      type: 'context_compaction',
      v: 1,
      data: {
        trigger: data.trigger || 'unknown',
        custom_instructions: data.custom_instructions || null
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
