#!/usr/bin/env node
// Hive Recall -- Session boundary observer
// Hook: SessionStart + SessionEnd | Fail-silent

const fs = require('fs');
const path = require('path');

const mode = process.argv[2]; // 'start' or 'end' (passed via settings.json command)

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // Defensive: mode must be 'start' or 'end'
    if (mode !== 'start' && mode !== 'end') return;

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

    // Build event data based on mode
    const eventData = { action: mode };

    if (mode === 'start') {
      eventData.session_type = data.source || 'unknown';
      eventData.model = data.model || null;
    } else if (mode === 'end') {
      eventData.reason = data.reason || 'unknown';

      // Count events and agents spawned in this session
      try {
        const eventsFile = path.join(data.cwd, '.planning', 'telemetry', 'events.jsonl');
        const content = fs.readFileSync(eventsFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const sessionEvents = [];
        for (const line of lines) {
          try {
            const e = JSON.parse(line);
            if (e.session === data.session_id) {
              sessionEvents.push(e);
            }
          } catch {
            // Skip malformed lines
          }
        }
        eventData.events_count = sessionEvents.length;
        eventData.agents_spawned = sessionEvents.filter(e => e.type === 'agent_completion').length;
      } catch {
        eventData.events_count = 0;
        eventData.agents_spawned = 0;
      }
    }

    // Build event envelope (matches Phase 1 createEventEnvelope format)
    const event = {
      ts: new Date().toISOString(),
      session: data.session_id || 'unknown',
      type: 'session_boundary',
      v: 1,
      data: eventData
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
