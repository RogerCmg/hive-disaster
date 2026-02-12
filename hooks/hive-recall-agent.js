#!/usr/bin/env node
// Hive Recall -- Agent completion observer
// Hook: SubagentStop | Fail-silent

try {
  const fs = require('fs');
  const path = require('path');

  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);

      // Filter: only Hive agents (agent_type starts with 'hive-')
      if (!data.agent_type || !data.agent_type.startsWith('hive-')) {
        return;
      }

      // Config check: read .planning/config.json, default to enabled
      try {
        const configPath = path.join(data.cwd, '.planning', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.telemetry?.enabled === false || config.telemetry?.hooks === false) {
          return;
        }
      } catch (e) {
        // Missing or corrupt config defaults to enabled
      }

      // Build event envelope (Phase 1 format)
      const event = {
        ts: new Date().toISOString(),
        session: data.session_id || 'unknown',
        type: 'agent_completion',
        v: 1,
        data: {
          agent: data.agent_type,
          agent_id: data.agent_id || null,
          duration_ms: null,
          exit_code: 0,
          error: null
        }
      };

      // Ensure telemetry directory exists
      const telemetryDir = path.join(data.cwd, '.planning', 'telemetry');
      fs.mkdirSync(telemetryDir, { recursive: true });

      // Append event as JSONL
      const eventsPath = path.join(telemetryDir, 'events.jsonl');
      fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
    } catch (e) {
      // Fail-silent: malformed JSON or any processing error
    }
  });
} catch (e) {
  // Fail-silent: outer catch for any unexpected errors
}
