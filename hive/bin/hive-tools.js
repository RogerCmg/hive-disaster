#!/usr/bin/env node

/**
 * Hive Tools — CLI utility for Hive workflow operations
 *
 * Replaces repetitive inline bash patterns across ~50 Hive command/workflow/agent files.
 * Centralizes: config parsing, model resolution, phase lookup, git commits, summary verification.
 *
 * Usage: node hive-tools.js <command> [args] [--raw]
 *
 * Atomic Commands:
 *   state load                         Load project config + state
 *   state update <field> <value>       Update a STATE.md field
 *   state get [section]                Get STATE.md content or section
 *   state patch --field val ...        Batch update STATE.md fields
 *   resolve-model <agent-type>         Get model for agent based on profile
 *   find-phase <phase>                 Find phase directory by number
 *   commit <message> [--files f1 f2]   Commit planning docs
 *   verify-summary <path>              Verify a SUMMARY.md file
 *   generate-slug <text>               Convert text to URL-safe slug
 *   current-timestamp [format]         Get timestamp (full|date|filename)
 *   list-todos [area]                  Count and enumerate pending todos
 *   verify-path-exists <path>          Check file/directory existence
 *   config-ensure-section              Initialize .planning/config.json
 *   history-digest                     Aggregate all SUMMARY.md data
 *   summary-extract <path> [--fields]  Extract structured data from SUMMARY.md
 *   state-snapshot                     Structured parse of STATE.md
 *   phase-plan-index <phase>           Index plans with waves and status
 *   websearch <query>                  Search web via Brave API (if configured)
 *     [--limit N] [--freshness day|week|month]
 *
 * Telemetry:
 *   telemetry emit <type> --data '{json}'  Emit telemetry event
 *   telemetry query [--type X] [--since Y]  Query filtered events
 *     [--limit N]
 *   telemetry digest                        Generate INSIGHTS.md
 *   telemetry stats                         Show event summary
 *   telemetry rotate [--force]              Rotate events file
 *
 * Phase Operations:
 *   phase next-decimal <phase>         Calculate next decimal phase number
 *   phase add <description>            Append new phase to roadmap + create dir
 *   phase insert <after> <description> Insert decimal phase after existing
 *   phase remove <phase> [--force]     Remove phase, renumber all subsequent
 *   phase complete <phase>             Mark phase done, update state + roadmap
 *
 * Roadmap Operations:
 *   roadmap get-phase <phase>          Extract phase section from ROADMAP.md
 *   roadmap analyze                    Full roadmap parse with disk status
 *
 * Milestone Operations:
 *   milestone complete <version>       Archive milestone, create MILESTONES.md
 *     [--name <name>]
 *
 * Validation:
 *   validate consistency               Check phase numbering, disk/roadmap sync
 *
 * Progress:
 *   progress [json|table|bar]          Render progress in various formats
 *
 * Todos:
 *   todo complete <filename>           Move todo from pending to completed
 *
 * Scaffolding:
 *   scaffold context --phase <N>       Create CONTEXT.md template
 *   scaffold uat --phase <N>           Create UAT.md template
 *   scaffold verification --phase <N>  Create VERIFICATION.md template
 *   scaffold phase-dir --phase <N>     Create phase directory
 *     --name <name>
 *
 * Frontmatter CRUD:
 *   frontmatter get <file> [--field k] Extract frontmatter as JSON
 *   frontmatter set <file> --field k   Update single frontmatter field
 *     --value jsonVal
 *   frontmatter merge <file>           Merge JSON into frontmatter
 *     --data '{json}'
 *   frontmatter validate <file>        Validate required fields
 *     --schema plan|summary|verification
 *
 * Verification Suite:
 *   verify plan-structure <file>       Check PLAN.md structure + tasks
 *   verify phase-completeness <phase>  Check all plans have summaries
 *   verify references <file>           Check @-refs + paths resolve
 *   verify commits <h1> [h2] ...      Batch verify commit hashes
 *   verify artifacts <plan-file>       Check must_haves.artifacts
 *   verify key-links <plan-file>       Check must_haves.key_links
 *
 * Template Fill:
 *   template fill summary --phase N    Create pre-filled SUMMARY.md
 *     [--plan M] [--name "..."]
 *     [--fields '{json}']
 *   template fill plan --phase N       Create pre-filled PLAN.md
 *     [--plan M] [--type execute|tdd]
 *     [--wave N] [--fields '{json}']
 *   template fill verification         Create pre-filled VERIFICATION.md
 *     --phase N [--fields '{json}']
 *
 * State Progression:
 *   state advance-plan                 Increment plan counter
 *   state record-metric --phase N      Record execution metrics
 *     --plan M --duration Xmin
 *     [--tasks N] [--files N]
 *   state update-progress              Recalculate progress bar
 *   state add-decision --summary "..."  Add decision to STATE.md
 *     [--phase N] [--rationale "..."]
 *   state add-blocker --text "..."     Add blocker
 *   state resolve-blocker --text "..." Remove blocker
 *   state record-session               Update session continuity
 *     --stopped-at "..."
 *     [--resume-file path]
 *
 * Compound Commands (workflow-specific initialization):
 *   init execute-phase <phase>         All context for execute-phase workflow
 *   init plan-phase <phase>            All context for plan-phase workflow
 *   init new-project                   All context for new-project workflow
 *   init new-milestone                 All context for new-milestone workflow
 *   init quick <description>           All context for quick workflow
 *   init resume                        All context for resume-project workflow
 *   init verify-work <phase>           All context for verify-work workflow
 *   init phase-op <phase>              Generic phase operation context
 *   init todos [area]                  All context for todo workflows
 *   init milestone-op                  All context for milestone operations
 *   init map-codebase                  All context for map-codebase workflow
 *   init progress                      All context for progress workflow
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

// ─── Model Profile Table ─────────────────────────────────────────────────────

const MODEL_PROFILES = {
  'hive-planner':              { quality: 'opus', balanced: 'opus',   budget: 'sonnet' },
  'hive-roadmapper':           { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'hive-executor':             { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'hive-phase-researcher':     { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
  'hive-project-researcher':   { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
  'hive-research-synthesizer': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'hive-debugger':             { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'hive-codebase-mapper':      { quality: 'sonnet', balanced: 'haiku', budget: 'haiku' },
  'hive-verifier':             { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'hive-plan-checker':         { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'hive-integration-checker':  { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
};

// ─── Telemetry Event Types ───────────────────────────────────────────────────

const VALID_EVENT_TYPES = [
  'agent_completion', 'tool_error', 'deviation', 'checkpoint',
  'verification_gap', 'plan_revision', 'user_correction',
  'fallback', 'context_compaction', 'session_summary',
  'session_boundary'
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseIncludeFlag(args) {
  const includeIndex = args.indexOf('--include');
  if (includeIndex === -1) return new Set();
  const includeValue = args[includeIndex + 1];
  if (!includeValue) return new Set();
  return new Set(includeValue.split(',').map(s => s.trim()));
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function loadConfig(cwd) {
  const configPath = path.join(cwd, '.planning', 'config.json');
  const defaults = {
    model_profile: 'balanced',
    commit_docs: true,
    search_gitignored: false,
    branching_strategy: 'none',
    phase_branch_template: 'hive/phase-{phase}-{slug}',
    milestone_branch_template: 'hive/{milestone}-{slug}',
    research: true,
    plan_checker: true,
    verifier: true,
    parallelization: true,
    brave_search: false,
    git_flow: 'github',
    git_dev_branch: 'dev',
    git_build_gates_pre_pr: true,
    git_build_gates_pre_merge: true,
    git_build_gates_pre_main: true,
    git_build_command: null,
    git_pre_main_command: null,
    git_build_timeout: 300,
    git_merge_strategy: 'merge',
    git_require_build: false,
    git_main_branch: 'main',
    git_protected_branches: [],
  };

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    const get = (key, nested) => {
      if (parsed[key] !== undefined) return parsed[key];
      if (nested && parsed[nested.section] && parsed[nested.section][nested.field] !== undefined) {
        return parsed[nested.section][nested.field];
      }
      return undefined;
    };

    const parallelization = (() => {
      const val = get('parallelization');
      if (typeof val === 'boolean') return val;
      if (typeof val === 'object' && val !== null && 'enabled' in val) return val.enabled;
      return defaults.parallelization;
    })();

    const gitSection = parsed.git || {};
    const buildGates = gitSection.build_gates || {};

    return {
      model_profile: get('model_profile') ?? defaults.model_profile,
      commit_docs: get('commit_docs', { section: 'planning', field: 'commit_docs' }) ?? defaults.commit_docs,
      search_gitignored: get('search_gitignored', { section: 'planning', field: 'search_gitignored' }) ?? defaults.search_gitignored,
      branching_strategy: get('branching_strategy', { section: 'git', field: 'branching_strategy' }) ?? defaults.branching_strategy,
      phase_branch_template: get('phase_branch_template', { section: 'git', field: 'phase_branch_template' }) ?? defaults.phase_branch_template,
      milestone_branch_template: get('milestone_branch_template', { section: 'git', field: 'milestone_branch_template' }) ?? defaults.milestone_branch_template,
      research: get('research', { section: 'workflow', field: 'research' }) ?? defaults.research,
      plan_checker: get('plan_checker', { section: 'workflow', field: 'plan_check' }) ?? defaults.plan_checker,
      verifier: get('verifier', { section: 'workflow', field: 'verifier' }) ?? defaults.verifier,
      parallelization,
      brave_search: get('brave_search') ?? defaults.brave_search,
      git_flow: gitSection.flow ?? defaults.git_flow,
      git_dev_branch: gitSection.dev_branch ?? defaults.git_dev_branch,
      git_build_gates_pre_pr: buildGates.pre_pr ?? defaults.git_build_gates_pre_pr,
      git_build_gates_pre_merge: buildGates.pre_merge ?? defaults.git_build_gates_pre_merge,
      git_build_gates_pre_main: buildGates.pre_main ?? defaults.git_build_gates_pre_main,
      git_build_command: gitSection.build_command ?? defaults.git_build_command,
      git_pre_main_command: gitSection.pre_main_command ?? defaults.git_pre_main_command,
      git_build_timeout: gitSection.build_timeout ?? defaults.git_build_timeout,
      git_merge_strategy: gitSection.merge_strategy ?? defaults.git_merge_strategy,
      git_require_build: buildGates.require_build ?? defaults.git_require_build,
      git_main_branch: gitSection.main_branch ?? defaults.git_main_branch,
      git_protected_branches: gitSection.protected_branches ?? defaults.git_protected_branches,
    };
  } catch {
    return defaults;
  }
}

function isGitIgnored(cwd, targetPath) {
  try {
    execSync('git check-ignore -q -- ' + targetPath.replace(/[^a-zA-Z0-9._\-/]/g, ''), {
      cwd,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function execGit(cwd, args) {
  try {
    const escaped = args.map(a => {
      if (/^[a-zA-Z0-9._\-/=:@]+$/.test(a)) return a;
      return "'" + a.replace(/'/g, "'\\''") + "'";
    });
    const stdout = execSync('git ' + escaped.join(' '), {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      stdout: (err.stdout ?? '').toString().trim(),
      stderr: (err.stderr ?? '').toString().trim(),
    };
  }
}

// ─── File Safety Primitives ────────────────────────────────────────────────────

function acquireLock(filePath, options) {
  const opts = Object.assign({ retries: 50, retryDelay: 100, staleMs: 10000 }, options);
  const lockDir = filePath + '.lock';

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      // Lock acquired — write info file
      try {
        fs.writeFileSync(path.join(lockDir, 'info.json'), JSON.stringify({ pid: process.pid, ts: Date.now() }));
      } catch {
        // info write failure is non-fatal — lock is still held
      }
      return lockDir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      // Lock already held — check staleness
      try {
        const infoPath = path.join(lockDir, 'info.json');
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));

        // Check if lock is stale by timestamp
        if (Date.now() - info.ts > opts.staleMs) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }

        // Check if holding process is dead
        try {
          process.kill(info.pid, 0);
        } catch {
          // PID not running — stale lock
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Can't read info file — treat as stale if this is not the first attempt
        if (attempt > 0) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      }

      // Wait before retry (polling loop)
      if (attempt < opts.retries) {
        const deadline = Date.now() + opts.retryDelay;
        while (Date.now() < deadline) {
          // busy wait
        }
      }
    }
  }

  throw new Error(`Failed to acquire lock on ${filePath} after ${opts.retries} retries`);
}

function releaseLock(lockDir) {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // best-effort, never throws
  }
}

function atomicWriteFileSync(filePath, content, encoding) {
  const tmpPath = path.join(path.dirname(filePath), '.tmp-' + path.basename(filePath) + '.' + process.pid + '.' + Date.now());
  try {
    fs.writeFileSync(tmpPath, content, encoding || 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // cleanup orphan — best-effort
    }
    throw err;
  }
}

function withFileLock(filePath, fn) {
  const lockDir = acquireLock(filePath);
  try {
    return fn();
  } finally {
    releaseLock(lockDir);
  }
}

// ─── Git/CLI Detection ─────────────────────────────────────────────────────────

function execCommand(command, args, options) {
  const opts = options || {};
  const spawnOpts = {
    cwd: opts.cwd || process.cwd(),
    encoding: 'utf-8',
    timeout: opts.timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  // On non-Windows: create process group so we can kill the entire tree on timeout
  if (process.platform !== 'win32') {
    spawnOpts.detached = true;
  }

  const result = spawnSync(command, args, spawnOpts);

  // If timed out, kill the entire process group (not just the parent)
  const timedOut = (result.error && result.error.code === 'ETIMEDOUT') || false;
  if (timedOut && result.pid && process.platform !== 'win32') {
    try {
      process.kill(-result.pid, 'SIGKILL');
    } catch (_) {
      // Process group may already be dead — safe to ignore
    }
  }

  return {
    success: result.status === 0,
    exitCode: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    signal: result.signal || null,
    timedOut: timedOut,
  };
}

function detectBuildCommand(cwd) {
  // 1. package.json
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const raw = safeReadFile(pkgPath);
    if (raw) {
      try {
        const pkg = JSON.parse(raw);
        if (pkg.scripts && pkg.scripts.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
          return { detected: true, command: 'npm test', source: 'package.json' };
        }
      } catch {
        // malformed JSON — skip
      }
    }
  }

  // 2. Cargo.toml
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    return { detected: true, command: 'cargo test', source: 'Cargo.toml' };
  }

  // 3. go.mod
  if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    return { detected: true, command: 'go test ./...', source: 'go.mod' };
  }

  // 4. pyproject.toml
  if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    return { detected: true, command: 'pytest', source: 'pyproject.toml' };
  }

  // 5. setup.py
  if (fs.existsSync(path.join(cwd, 'setup.py'))) {
    return { detected: true, command: 'pytest', source: 'setup.py' };
  }

  // 6. Makefile with test target
  const makefilePath = path.join(cwd, 'Makefile');
  if (fs.existsSync(makefilePath)) {
    const makeContent = safeReadFile(makefilePath);
    if (makeContent && /^test\s*:/m.test(makeContent)) {
      return { detected: true, command: 'make test', source: 'Makefile' };
    }
  }

  // 7. build.gradle or build.gradle.kts
  if (fs.existsSync(path.join(cwd, 'build.gradle')) || fs.existsSync(path.join(cwd, 'build.gradle.kts'))) {
    return { detected: true, command: './gradlew test', source: 'build.gradle' };
  }

  // 8. pom.xml
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
    return { detected: true, command: 'mvn test', source: 'pom.xml' };
  }

  return { detected: false, command: null, source: null };
}

function normalizePhaseName(phase) {
  const match = phase.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return phase;
  const num = match[1];
  const parts = num.split('.');
  const padded = parts[0].padStart(2, '0');
  return parts.length > 1 ? `${padded}.${parts[1]}` : padded;
}

function extractFrontmatter(content) {
  const frontmatter = {};
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (!match) return frontmatter;

  const yaml = match[1];
  const lines = yaml.split('\n');

  // Stack to track nested objects: [{obj, key, indent}]
  // obj = object to write to, key = current key collecting array items, indent = indentation level
  let stack = [{ obj: frontmatter, key: null, indent: -1 }];

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') continue;

    // Calculate indentation (number of leading spaces)
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    // Pop stack back to appropriate level
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];

    // Check for key: value pattern
    const keyMatch = line.match(/^(\s*)([a-zA-Z0-9_-]+):\s*(.*)/);
    if (keyMatch) {
      const key = keyMatch[2];
      const value = keyMatch[3].trim();

      if (value === '' || value === '[') {
        // Key with no value or opening bracket — could be nested object or array
        // We'll determine based on next lines, for now create placeholder
        current.obj[key] = value === '[' ? [] : {};
        current.key = null;
        // Push new context for potential nested content
        stack.push({ obj: current.obj[key], key: null, indent });
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array: key: [a, b, c]
        current.obj[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        current.key = null;
      } else {
        // Simple key: value
        current.obj[key] = value.replace(/^["']|["']$/g, '');
        current.key = null;
      }
    } else if (line.trim().startsWith('- ')) {
      // Array item
      const itemValue = line.trim().slice(2).replace(/^["']|["']$/g, '');

      // If current context is an empty object, convert to array
      if (typeof current.obj === 'object' && !Array.isArray(current.obj) && Object.keys(current.obj).length === 0) {
        // Find the key in parent that points to this object and convert it
        const parent = stack.length > 1 ? stack[stack.length - 2] : null;
        if (parent) {
          for (const k of Object.keys(parent.obj)) {
            if (parent.obj[k] === current.obj) {
              parent.obj[k] = [itemValue];
              current.obj = parent.obj[k];
              break;
            }
          }
        }
      } else if (Array.isArray(current.obj)) {
        current.obj.push(itemValue);
      }
    }
  }

  return frontmatter;
}

function reconstructFrontmatter(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (value.every(v => typeof v === 'string') && value.length <= 3 && value.join(', ').length < 60) {
        lines.push(`${key}: [${value.join(', ')}]`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${typeof item === 'string' && (item.includes(':') || item.includes('#')) ? `"${item}"` : item}`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [subkey, subval] of Object.entries(value)) {
        if (subval === null || subval === undefined) continue;
        if (Array.isArray(subval)) {
          if (subval.length === 0) {
            lines.push(`  ${subkey}: []`);
          } else if (subval.every(v => typeof v === 'string') && subval.length <= 3 && subval.join(', ').length < 60) {
            lines.push(`  ${subkey}: [${subval.join(', ')}]`);
          } else {
            lines.push(`  ${subkey}:`);
            for (const item of subval) {
              lines.push(`    - ${typeof item === 'string' && (item.includes(':') || item.includes('#')) ? `"${item}"` : item}`);
            }
          }
        } else if (typeof subval === 'object') {
          lines.push(`  ${subkey}:`);
          for (const [subsubkey, subsubval] of Object.entries(subval)) {
            if (subsubval === null || subsubval === undefined) continue;
            if (Array.isArray(subsubval)) {
              if (subsubval.length === 0) {
                lines.push(`    ${subsubkey}: []`);
              } else {
                lines.push(`    ${subsubkey}:`);
                for (const item of subsubval) {
                  lines.push(`      - ${item}`);
                }
              }
            } else {
              lines.push(`    ${subsubkey}: ${subsubval}`);
            }
          }
        } else {
          const sv = String(subval);
          lines.push(`  ${subkey}: ${sv.includes(':') || sv.includes('#') ? `"${sv}"` : sv}`);
        }
      }
    } else {
      const sv = String(value);
      if (sv.includes(':') || sv.includes('#') || sv.startsWith('[') || sv.startsWith('{')) {
        lines.push(`${key}: "${sv}"`);
      } else {
        lines.push(`${key}: ${sv}`);
      }
    }
  }
  return lines.join('\n');
}

function spliceFrontmatter(content, newObj) {
  const yamlStr = reconstructFrontmatter(newObj);
  const match = content.match(/^---\n[\s\S]+?\n---/);
  if (match) {
    return `---\n${yamlStr}\n---` + content.slice(match[0].length);
  }
  return `---\n${yamlStr}\n---\n\n` + content;
}

function parseMustHavesBlock(content, blockName) {
  // Extract a specific block from must_haves in raw frontmatter YAML
  // Handles 3-level nesting: must_haves > artifacts/key_links > [{path, provides, ...}]
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!fmMatch) return [];

  const yaml = fmMatch[1];
  // Find the block (e.g., "truths:", "artifacts:", "key_links:")
  const blockPattern = new RegExp(`^\\s{4}${blockName}:\\s*$`, 'm');
  const blockStart = yaml.search(blockPattern);
  if (blockStart === -1) return [];

  const afterBlock = yaml.slice(blockStart);
  const blockLines = afterBlock.split('\n').slice(1); // skip the header line

  const items = [];
  let current = null;

  for (const line of blockLines) {
    // Stop at same or lower indent level (non-continuation)
    if (line.trim() === '') continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= 4 && line.trim() !== '') break; // back to must_haves level or higher

    if (line.match(/^\s{6}-\s+/)) {
      // New list item at 6-space indent
      if (current) items.push(current);
      current = {};
      // Check if it's a simple string item
      const simpleMatch = line.match(/^\s{6}-\s+"?([^"]+)"?\s*$/);
      if (simpleMatch && !line.includes(':')) {
        current = simpleMatch[1];
      } else {
        // Key-value on same line as dash: "- path: value"
        const kvMatch = line.match(/^\s{6}-\s+(\w+):\s*"?([^"]*)"?\s*$/);
        if (kvMatch) {
          current = {};
          current[kvMatch[1]] = kvMatch[2];
        }
      }
    } else if (current && typeof current === 'object') {
      // Continuation key-value at 8+ space indent
      const kvMatch = line.match(/^\s{8,}(\w+):\s*"?([^"]*)"?\s*$/);
      if (kvMatch) {
        const val = kvMatch[2];
        // Try to parse as number
        current[kvMatch[1]] = /^\d+$/.test(val) ? parseInt(val, 10) : val;
      }
      // Array items under a key
      const arrMatch = line.match(/^\s{10,}-\s+"?([^"]+)"?\s*$/);
      if (arrMatch) {
        // Find the last key added and convert to array
        const keys = Object.keys(current);
        const lastKey = keys[keys.length - 1];
        if (lastKey && !Array.isArray(current[lastKey])) {
          current[lastKey] = current[lastKey] ? [current[lastKey]] : [];
        }
        if (lastKey) current[lastKey].push(arrMatch[1]);
      }
    }
  }
  if (current) items.push(current);

  return items;
}

// ─── Telemetry Helpers ───────────────────────────────────────────────────────

function getTelemetryConfig(cwd) {
  try {
    const configPath = path.join(cwd, '.planning', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const tel = parsed.telemetry || {};
    return {
      enabled: tel.enabled !== false,
      hooks: tel.hooks !== false,
      workflow_events: tel.workflow_events !== false,
      transcript_analysis: tel.transcript_analysis === true,
      rotation_threshold_kb: tel.rotation_threshold_kb || 500,
      max_archives: tel.max_archives || 10,
    };
  } catch {
    return {
      enabled: true,
      hooks: true,
      workflow_events: true,
      transcript_analysis: false,
      rotation_threshold_kb: 500,
      max_archives: 10,
    };
  }
}

function ensureTelemetryDir(cwd) {
  const dir = path.join(cwd, '.planning', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createEventEnvelope(type, data, session) {
  return {
    ts: new Date().toISOString(),
    session: session || process.env.CLAUDE_SESSION_ID || 'unknown',
    type,
    v: 1,
    data: data || {},
  };
}

function parseSinceDuration(sinceStr) {
  if (!sinceStr) return null;
  const match = sinceStr.match(/^(\d+)([dhm])$/);
  if (match) {
    const multipliers = { d: 86400000, h: 3600000, m: 60000 };
    const ms = parseInt(match[1], 10) * multipliers[match[2]];
    return new Date(Date.now() - ms);
  }
  // Try ISO date string
  const date = new Date(sinceStr);
  if (!isNaN(date.getTime())) return date;
  return null;
}

function getRecallContext(cwd) {
  const insightsPath = path.join(cwd, '.planning', 'telemetry', 'INSIGHTS.md');
  const content = safeReadFile(insightsPath);
  if (!content) return null;
  const match = content.match(/<!-- recall-start -->\n([\s\S]*?)<!-- recall-end -->/);
  if (!match) return null;
  const patterns = match[1].trim();
  if (!patterns || patterns === '- No actionable patterns detected yet.') return null;
  return patterns;
}

function rotateIfNeeded(telemetryDir, config) {
  try {
    const eventsFile = path.join(telemetryDir, 'events.jsonl');
    const stats = fs.statSync(eventsFile);
    const thresholdBytes = (config.rotation_threshold_kb || 500) * 1024;
    if (stats.size < thresholdBytes) return false;

    const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
    const archiveName = 'events-' + ts + '.jsonl';
    fs.renameSync(eventsFile, path.join(telemetryDir, archiveName));

    // Prune old archives
    const maxArchives = config.max_archives || 10;
    const archives = fs.readdirSync(telemetryDir)
      .filter(f => f.startsWith('events-') && f.endsWith('.jsonl'))
      .sort();
    while (archives.length > maxArchives) {
      const oldest = archives.shift();
      fs.unlinkSync(path.join(telemetryDir, oldest));
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Transcript Helpers ─────────────────────────────────────────────────────

function resolveClaudeProjectDir(cwd) {
  const homedir = require('os').homedir();
  const encoded = cwd.replace(/\//g, '-');
  return path.join(homedir, '.claude', 'projects', encoded);
}

function findLatestTranscript(projectDir) {
  try {
    const files = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(projectDir, f),
        mtime: fs.statSync(path.join(projectDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].path : null;
  } catch {
    return null;
  }
}

function cmdTelemetryTranscript(cwd, sessionId, raw, crossSession) {
  const telConfig = getTelemetryConfig(cwd);
  if (!telConfig.transcript_analysis) {
    error('Transcript analysis is disabled. Set transcript_analysis: true in config.json telemetry section');
  }

  if (crossSession) {
    const result = detectCrossSessionPatterns(cwd);
    if (!result) {
      error('Not enough session summaries for cross-session analysis (need at least 2)');
    }
    output(result, raw);
    return;
  }

  const projectDir = resolveClaudeProjectDir(cwd);
  const transcriptPath = sessionId
    ? path.join(projectDir, sessionId + '.jsonl')
    : findLatestTranscript(projectDir);

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    error('No transcript found' + (sessionId ? ' for session ' + sessionId : ''));
  }

  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  const messages = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const toolUses = {};
  let toolErrors = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' || entry.type === 'assistant') {
        messages.push(entry);
      }
      if (entry.type === 'assistant') {
        const usage = (entry.message && entry.message.usage) || {};
        totalInputTokens += (usage.input_tokens || 0)
          + (usage.cache_read_input_tokens || 0)
          + (usage.cache_creation_input_tokens || 0);
        totalOutputTokens += usage.output_tokens || 0;
        const blocks = (entry.message && entry.message.content) || [];
        for (const block of blocks) {
          if (block && block.type === 'tool_use') {
            const name = block.name || 'unknown';
            toolUses[name] = (toolUses[name] || 0) + 1;
          }
          if (block && block.type === 'tool_result' && block.is_error) {
            toolErrors++;
          }
        }
      }
    } catch { /* skip malformed lines */ }
  }

  if (messages.length < 5) {
    error('Session too short for meaningful analysis (found ' + messages.length + ' messages, minimum 5)');
  }

  const condensed = messages.map(m => {
    if (m.type === 'user') {
      const c = m.message && m.message.content;
      const text = typeof c === 'string' ? c
        : Array.isArray(c) ? c
            .filter(b => b && b.type === 'text')
            .map(b => b.text).join('\n')
        : '';
      return { role: 'user', text: text.substring(0, 2000), ts: m.timestamp };
    } else {
      const blocks = (m.message && m.message.content) || [];
      const textParts = blocks
        .filter(b => b && b.type === 'text')
        .map(b => b.text);
      const tools = blocks
        .filter(b => b && b.type === 'tool_use')
        .map(b => b.name + '(' + Object.keys(b.input || {}).join(',') + ')');
      return {
        role: 'assistant',
        text: textParts.join('\n').substring(0, 2000),
        tools: tools,
        ts: m.timestamp,
      };
    }
  });

  const result = {
    session_id: (messages[0] && messages[0].sessionId) || sessionId || 'unknown',
    transcript_path: transcriptPath,
    message_count: messages.length,
    user_turns: messages.filter(m => m.type === 'user').length,
    assistant_turns: messages.filter(m => m.type === 'assistant').length,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    tool_uses: toolUses,
    tool_errors: toolErrors,
    condensed_transcript: condensed,
  };

  output(result, raw);
}

function detectCrossSessionPatterns(cwd) {
  const telemetryDir = path.join(cwd, '.planning', 'telemetry');
  const eventsFile = path.join(telemetryDir, 'events.jsonl');
  const content = safeReadFile(eventsFile);
  if (!content) return null;

  const allEvents = content.split('\n').filter(Boolean).reduce((acc, line) => {
    try {
      const e = JSON.parse(line);
      if (e.type === 'session_summary') acc.push(e);
    } catch { /* skip */ }
    return acc;
  }, []);

  if (allEvents.length < 2) return null;

  const events = allEvents.slice(-10);

  // Quality trend
  const scores = events.map(e => e.data && e.data.quality_score).filter(v => v != null);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const recentScores = scores.slice(-3);
  const recentAvg = recentScores.length > 0 ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : 0;
  const trend = recentAvg > avgScore + 5 ? 'improving' : recentAvg < avgScore - 5 ? 'declining' : 'stable';

  // Waste trend
  const wastes = events.map(e => e.data && e.data.waste_pct).filter(v => v != null);
  const avgWaste = wastes.length > 0 ? wastes.reduce((a, b) => a + b, 0) / wastes.length : 0;
  const recentWastes = wastes.slice(-3);
  const recentWasteAvg = recentWastes.length > 0 ? recentWastes.reduce((a, b) => a + b, 0) / recentWastes.length : 0;
  const wasteTrend = recentWasteAvg > avgWaste + 5 ? 'increasing' : recentWasteAvg < avgWaste - 5 ? 'decreasing' : 'stable';

  // Recurring patterns
  const patternFreq = {};
  for (const e of events) {
    const patterns = (e.data && e.data.patterns) || [];
    for (const p of patterns) {
      patternFreq[p] = (patternFreq[p] || 0) + 1;
    }
  }
  const recurringPatterns = Object.entries(patternFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern, count]) => ({ pattern, count }));

  // Recurring recommendations
  const recFreq = {};
  for (const e of events) {
    const recs = (e.data && e.data.recommendations) || [];
    for (const r of recs) {
      recFreq[r] = (recFreq[r] || 0) + 1;
    }
  }
  const recurringRecommendations = Object.entries(recFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([recommendation, count]) => ({ recommendation, count }));

  // Recurring user preferences
  const prefFreq = {};
  for (const e of events) {
    const prefs = (e.data && e.data.user_preferences) || [];
    for (const p of prefs) {
      prefFreq[p] = (prefFreq[p] || 0) + 1;
    }
  }
  const recurringPreferences = Object.entries(prefFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([preference, count]) => ({ preference, count }));

  return {
    sessions_analyzed: allEvents.length,
    window_size: events.length,
    avg_quality: Math.round(avgScore),
    quality_trend: trend,
    avg_waste: Math.round(avgWaste),
    waste_trend: wasteTrend,
    recurring_patterns: recurringPatterns,
    recurring_recommendations: recurringRecommendations,
    recurring_preferences: recurringPreferences,
  };
}

// ─── Output / Error ──────────────────────────────────────────────────────────

function output(result, raw, rawValue) {
  if (raw && rawValue !== undefined) {
    process.stdout.write(String(rawValue));
  } else {
    process.stdout.write(JSON.stringify(result, null, 2));
  }
  process.exit(0);
}

function error(message) {
  process.stderr.write('Error: ' + message + '\n');
  process.exit(1);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdGenerateSlug(text, raw) {
  if (!text) {
    error('text required for slug generation');
  }

  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const result = { slug };
  output(result, raw, slug);
}

function cmdCurrentTimestamp(format, raw) {
  const now = new Date();
  let result;

  switch (format) {
    case 'date':
      result = now.toISOString().split('T')[0];
      break;
    case 'filename':
      result = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
      break;
    case 'full':
    default:
      result = now.toISOString();
      break;
  }

  output({ timestamp: result }, raw, result);
}

function cmdListTodos(cwd, area, raw) {
  const pendingDir = path.join(cwd, '.planning', 'todos', 'pending');

  let count = 0;
  const todos = [];

  try {
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
        const createdMatch = content.match(/^created:\s*(.+)$/m);
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        const areaMatch = content.match(/^area:\s*(.+)$/m);

        const todoArea = areaMatch ? areaMatch[1].trim() : 'general';

        // Apply area filter if specified
        if (area && todoArea !== area) continue;

        count++;
        todos.push({
          file,
          created: createdMatch ? createdMatch[1].trim() : 'unknown',
          title: titleMatch ? titleMatch[1].trim() : 'Untitled',
          area: todoArea,
          path: path.join('.planning', 'todos', 'pending', file),
        });
      } catch {}
    }
  } catch {}

  const result = { count, todos };
  output(result, raw, count.toString());
}

function cmdVerifyPathExists(cwd, targetPath, raw) {
  if (!targetPath) {
    error('path required for verification');
  }

  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);

  try {
    const stats = fs.statSync(fullPath);
    const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
    const result = { exists: true, type };
    output(result, raw, 'true');
  } catch {
    const result = { exists: false, type: null };
    output(result, raw, 'false');
  }
}

function cmdConfigEnsureSection(cwd, raw) {
  const configPath = path.join(cwd, '.planning', 'config.json');
  const planningDir = path.join(cwd, '.planning');

  // Ensure .planning directory exists
  try {
    if (!fs.existsSync(planningDir)) {
      fs.mkdirSync(planningDir, { recursive: true });
    }
  } catch (err) {
    error('Failed to create .planning directory: ' + err.message);
  }

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    const result = { created: false, reason: 'already_exists' };
    output(result, raw, 'exists');
    return;
  }

  // Detect Brave Search API key availability
  const homedir = require('os').homedir();
  const braveKeyFile = path.join(homedir, '.hive', 'brave_api_key');
  const hasBraveSearch = !!(process.env.BRAVE_API_KEY || fs.existsSync(braveKeyFile));

  // Create default config
  const defaults = {
    model_profile: 'balanced',
    commit_docs: true,
    search_gitignored: false,
    branching_strategy: 'none',
    phase_branch_template: 'hive/phase-{phase}-{slug}',
    milestone_branch_template: 'hive/{milestone}-{slug}',
    workflow: {
      research: true,
      plan_check: true,
      verifier: true,
    },
    parallelization: true,
    brave_search: hasBraveSearch,
    telemetry: {
      enabled: true,
      hooks: true,
      workflow_events: true,
      transcript_analysis: false,
    },
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8');
    const result = { created: true, path: '.planning/config.json' };
    output(result, raw, 'created');
  } catch (err) {
    error('Failed to create config.json: ' + err.message);
  }
}

function cmdConfigSet(cwd, keyPath, value, raw) {
  const configPath = path.join(cwd, '.planning', 'config.json');

  if (!keyPath) {
    error('Usage: config-set <key.path> <value>');
  }

  // Parse value (handle booleans and numbers)
  let parsedValue = value;
  if (value === 'true') parsedValue = true;
  else if (value === 'false') parsedValue = false;
  else if (!isNaN(value) && value !== '') parsedValue = Number(value);

  // Load existing config or start with empty object
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    error('Failed to read config.json: ' + err.message);
  }

  // Set nested value using dot notation (e.g., "workflow.research")
  const keys = keyPath.split('.');
  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = parsedValue;

  // Write back
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    const result = { updated: true, key: keyPath, value: parsedValue };
    output(result, raw, `${keyPath}=${parsedValue}`);
  } catch (err) {
    error('Failed to write config.json: ' + err.message);
  }
}

function cmdHistoryDigest(cwd, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const digest = { phases: {}, decisions: [], tech_stack: new Set() };

  if (!fs.existsSync(phasesDir)) {
    digest.tech_stack = [];
    output(digest, raw);
    return;
  }

  try {
    const phaseDirs = fs.readdirSync(phasesDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();

    for (const dir of phaseDirs) {
      const dirPath = path.join(phasesDir, dir);
      const summaries = fs.readdirSync(dirPath).filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');

      for (const summary of summaries) {
        try {
          const content = fs.readFileSync(path.join(dirPath, summary), 'utf-8');
          const fm = extractFrontmatter(content);
          
          const phaseNum = fm.phase || dir.split('-')[0];
          
          if (!digest.phases[phaseNum]) {
            digest.phases[phaseNum] = {
              name: fm.name || dir.split('-').slice(1).join(' ') || 'Unknown',
              provides: new Set(),
              affects: new Set(),
              patterns: new Set(),
            };
          }

          // Merge provides
          if (fm['dependency-graph'] && fm['dependency-graph'].provides) {
            fm['dependency-graph'].provides.forEach(p => digest.phases[phaseNum].provides.add(p));
          } else if (fm.provides) {
            fm.provides.forEach(p => digest.phases[phaseNum].provides.add(p));
          }

          // Merge affects
          if (fm['dependency-graph'] && fm['dependency-graph'].affects) {
            fm['dependency-graph'].affects.forEach(a => digest.phases[phaseNum].affects.add(a));
          }

          // Merge patterns
          if (fm['patterns-established']) {
            fm['patterns-established'].forEach(p => digest.phases[phaseNum].patterns.add(p));
          }

          // Merge decisions
          if (fm['key-decisions']) {
            fm['key-decisions'].forEach(d => {
              digest.decisions.push({ phase: phaseNum, decision: d });
            });
          }

          // Merge tech stack
          if (fm['tech-stack'] && fm['tech-stack'].added) {
            fm['tech-stack'].added.forEach(t => digest.tech_stack.add(typeof t === 'string' ? t : t.name));
          }

        } catch (e) {
          // Skip malformed summaries
        }
      }
    }

    // Convert Sets to Arrays for JSON output
    Object.keys(digest.phases).forEach(p => {
      digest.phases[p].provides = [...digest.phases[p].provides];
      digest.phases[p].affects = [...digest.phases[p].affects];
      digest.phases[p].patterns = [...digest.phases[p].patterns];
    });
    digest.tech_stack = [...digest.tech_stack];

    output(digest, raw);
  } catch (e) {
    error('Failed to generate history digest: ' + e.message);
  }
}

function cmdPhasesList(cwd, options, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const { type, phase } = options;

  // If no phases directory, return empty
  if (!fs.existsSync(phasesDir)) {
    if (type) {
      output({ files: [], count: 0 }, raw, '');
    } else {
      output({ directories: [], count: 0 }, raw, '');
    }
    return;
  }

  try {
    // Get all phase directories
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    let dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    // Sort numerically (handles decimals: 01, 02, 02.1, 02.2, 03)
    dirs.sort((a, b) => {
      const aNum = parseFloat(a.match(/^(\d+(?:\.\d+)?)/)?.[1] || '0');
      const bNum = parseFloat(b.match(/^(\d+(?:\.\d+)?)/)?.[1] || '0');
      return aNum - bNum;
    });

    // If filtering by phase number
    if (phase) {
      const normalized = normalizePhaseName(phase);
      const match = dirs.find(d => d.startsWith(normalized));
      if (!match) {
        output({ files: [], count: 0, phase_dir: null, error: 'Phase not found' }, raw, '');
        return;
      }
      dirs = [match];
    }

    // If listing files of a specific type
    if (type) {
      const files = [];
      for (const dir of dirs) {
        const dirPath = path.join(phasesDir, dir);
        const dirFiles = fs.readdirSync(dirPath);

        let filtered;
        if (type === 'plans') {
          filtered = dirFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md');
        } else if (type === 'summaries') {
          filtered = dirFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
        } else {
          filtered = dirFiles;
        }

        files.push(...filtered.sort());
      }

      const result = {
        files,
        count: files.length,
        phase_dir: phase ? dirs[0].replace(/^\d+(?:\.\d+)?-?/, '') : null,
      };
      output(result, raw, files.join('\n'));
      return;
    }

    // Default: list directories
    output({ directories: dirs, count: dirs.length }, raw, dirs.join('\n'));
  } catch (e) {
    error('Failed to list phases: ' + e.message);
  }
}

function cmdRoadmapGetPhase(cwd, phaseNum, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');

  if (!fs.existsSync(roadmapPath)) {
    output({ found: false, error: 'ROADMAP.md not found' }, raw, '');
    return;
  }

  try {
    const content = fs.readFileSync(roadmapPath, 'utf-8');

    // Escape special regex chars in phase number, handle decimal
    const escapedPhase = phaseNum.replace(/\./g, '\\.');

    // Match "### Phase X:" or "### Phase X.Y:" with optional name
    const phasePattern = new RegExp(
      `###\\s*Phase\\s+${escapedPhase}:\\s*([^\\n]+)`,
      'i'
    );
    const headerMatch = content.match(phasePattern);

    if (!headerMatch) {
      output({ found: false, phase_number: phaseNum }, raw, '');
      return;
    }

    const phaseName = headerMatch[1].trim();
    const headerIndex = headerMatch.index;

    // Find the end of this section (next ### or end of file)
    const restOfContent = content.slice(headerIndex);
    const nextHeaderMatch = restOfContent.match(/\n###\s+Phase\s+\d/i);
    const sectionEnd = nextHeaderMatch
      ? headerIndex + nextHeaderMatch.index
      : content.length;

    const section = content.slice(headerIndex, sectionEnd).trim();

    // Extract goal if present
    const goalMatch = section.match(/\*\*Goal:\*\*\s*([^\n]+)/i);
    const goal = goalMatch ? goalMatch[1].trim() : null;

    output(
      {
        found: true,
        phase_number: phaseNum,
        phase_name: phaseName,
        goal,
        section,
      },
      raw,
      section
    );
  } catch (e) {
    error('Failed to read ROADMAP.md: ' + e.message);
  }
}

function cmdPhaseNextDecimal(cwd, basePhase, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(basePhase);

  // Check if phases directory exists
  if (!fs.existsSync(phasesDir)) {
    output(
      {
        found: false,
        base_phase: normalized,
        next: `${normalized}.1`,
        existing: [],
      },
      raw,
      `${normalized}.1`
    );
    return;
  }

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    // Check if base phase exists
    const baseExists = dirs.some(d => d.startsWith(normalized + '-') || d === normalized);

    // Find existing decimal phases for this base
    const decimalPattern = new RegExp(`^${normalized}\\.(\\d+)`);
    const existingDecimals = [];

    for (const dir of dirs) {
      const match = dir.match(decimalPattern);
      if (match) {
        existingDecimals.push(`${normalized}.${match[1]}`);
      }
    }

    // Sort numerically
    existingDecimals.sort((a, b) => {
      const aNum = parseFloat(a);
      const bNum = parseFloat(b);
      return aNum - bNum;
    });

    // Calculate next decimal
    let nextDecimal;
    if (existingDecimals.length === 0) {
      nextDecimal = `${normalized}.1`;
    } else {
      const lastDecimal = existingDecimals[existingDecimals.length - 1];
      const lastNum = parseInt(lastDecimal.split('.')[1], 10);
      nextDecimal = `${normalized}.${lastNum + 1}`;
    }

    output(
      {
        found: baseExists,
        base_phase: normalized,
        next: nextDecimal,
        existing: existingDecimals,
      },
      raw,
      nextDecimal
    );
  } catch (e) {
    error('Failed to calculate next decimal phase: ' + e.message);
  }
}

function cmdStateLoad(cwd, raw) {
  const config = loadConfig(cwd);
  const planningDir = path.join(cwd, '.planning');

  let stateRaw = '';
  try {
    stateRaw = fs.readFileSync(path.join(planningDir, 'STATE.md'), 'utf-8');
  } catch {}

  const configExists = fs.existsSync(path.join(planningDir, 'config.json'));
  const roadmapExists = fs.existsSync(path.join(planningDir, 'ROADMAP.md'));
  const stateExists = stateRaw.length > 0;

  const result = {
    config,
    state_raw: stateRaw,
    state_exists: stateExists,
    roadmap_exists: roadmapExists,
    config_exists: configExists,
  };

  // For --raw, output a condensed key=value format
  if (raw) {
    const c = config;
    const lines = [
      `model_profile=${c.model_profile}`,
      `commit_docs=${c.commit_docs}`,
      `branching_strategy=${c.branching_strategy}`,
      `phase_branch_template=${c.phase_branch_template}`,
      `milestone_branch_template=${c.milestone_branch_template}`,
      `parallelization=${c.parallelization}`,
      `research=${c.research}`,
      `plan_checker=${c.plan_checker}`,
      `verifier=${c.verifier}`,
      `config_exists=${configExists}`,
      `roadmap_exists=${roadmapExists}`,
      `state_exists=${stateExists}`,
    ];
    process.stdout.write(lines.join('\n'));
    process.exit(0);
  }

  output(result);
}

function cmdStateGet(cwd, section, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    
    if (!section) {
      output({ content }, raw, content);
      return;
    }

    // Try to find markdown section or field
    const fieldEscaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Check for **field:** value
    const fieldPattern = new RegExp(`\\*\\*${fieldEscaped}:\\*\\*\\s*(.*)`, 'i');
    const fieldMatch = content.match(fieldPattern);
    if (fieldMatch) {
      output({ [section]: fieldMatch[1].trim() }, raw, fieldMatch[1].trim());
      return;
    }

    // Check for ## Section
    const sectionPattern = new RegExp(`##\\s*${fieldEscaped}\\s*\n([\\s\\S]*?)(?=\\n##|$)`, 'i');
    const sectionMatch = content.match(sectionPattern);
    if (sectionMatch) {
      output({ [section]: sectionMatch[1].trim() }, raw, sectionMatch[1].trim());
      return;
    }

    output({ error: `Section or field "${section}" not found` }, raw, '');
  } catch {
    error('STATE.md not found');
  }
}

function cmdStatePatch(cwd, patches, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  try {
    let content = fs.readFileSync(statePath, 'utf-8');
    const results = { updated: [], failed: [] };

    for (const [field, value] of Object.entries(patches)) {
      const fieldEscaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(\\*\\*${fieldEscaped}:\\*\\*\\s*)(.*)`, 'i');
      
      if (pattern.test(content)) {
        content = content.replace(pattern, `$1${value}`);
        results.updated.push(field);
      } else {
        results.failed.push(field);
      }
    }

    if (results.updated.length > 0) {
      fs.writeFileSync(statePath, content, 'utf-8');
    }

    output(results, raw, results.updated.length > 0 ? 'true' : 'false');
  } catch {
    error('STATE.md not found');
  }
}

function cmdStateUpdate(cwd, field, value) {
  if (!field || value === undefined) {
    error('field and value required for state update');
  }

  const statePath = path.join(cwd, '.planning', 'STATE.md');
  try {
    let content = fs.readFileSync(statePath, 'utf-8');
    const fieldEscaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(\\*\\*${fieldEscaped}:\\*\\*\\s*)(.*)`, 'i');
    if (pattern.test(content)) {
      content = content.replace(pattern, `$1${value}`);
      fs.writeFileSync(statePath, content, 'utf-8');
      output({ updated: true });
    } else {
      output({ updated: false, reason: `Field "${field}" not found in STATE.md` });
    }
  } catch {
    output({ updated: false, reason: 'STATE.md not found' });
  }
}

// ─── State Progression Engine ────────────────────────────────────────────────

function stateExtractField(content, fieldName) {
  const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function stateReplaceField(content, fieldName, newValue) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(\\*\\*${escaped}:\\*\\*\\s*)(.*)`, 'i');
  if (pattern.test(content)) {
    return content.replace(pattern, `$1${newValue}`);
  }
  return null;
}

function cmdStateAdvancePlan(cwd, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const currentPlan = parseInt(stateExtractField(content, 'Current Plan'), 10);
  const totalPlans = parseInt(stateExtractField(content, 'Total Plans in Phase'), 10);
  const today = new Date().toISOString().split('T')[0];

  if (isNaN(currentPlan) || isNaN(totalPlans)) {
    output({ error: 'Cannot parse Current Plan or Total Plans in Phase from STATE.md' }, raw);
    return;
  }

  if (currentPlan >= totalPlans) {
    content = stateReplaceField(content, 'Status', 'Phase complete — ready for verification') || content;
    content = stateReplaceField(content, 'Last Activity', today) || content;
    fs.writeFileSync(statePath, content, 'utf-8');
    output({ advanced: false, reason: 'last_plan', current_plan: currentPlan, total_plans: totalPlans, status: 'ready_for_verification' }, raw, 'false');
  } else {
    const newPlan = currentPlan + 1;
    content = stateReplaceField(content, 'Current Plan', String(newPlan)) || content;
    content = stateReplaceField(content, 'Status', 'Ready to execute') || content;
    content = stateReplaceField(content, 'Last Activity', today) || content;
    fs.writeFileSync(statePath, content, 'utf-8');
    output({ advanced: true, previous_plan: currentPlan, current_plan: newPlan, total_plans: totalPlans }, raw, 'true');
  }
}

function cmdStateRecordMetric(cwd, options, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const { phase, plan, duration, tasks, files } = options;

  if (!phase || !plan || !duration) {
    output({ error: 'phase, plan, and duration required' }, raw);
    return;
  }

  // Find Performance Metrics section and its table
  const metricsPattern = /(##\s*Performance Metrics[\s\S]*?\n\|[^\n]+\n\|[-|\s]+\n)([\s\S]*?)(?=\n##|\n$|$)/i;
  const metricsMatch = content.match(metricsPattern);

  if (metricsMatch) {
    const tableHeader = metricsMatch[1];
    let tableBody = metricsMatch[2].trimEnd();
    const newRow = `| Phase ${phase} P${plan} | ${duration} | ${tasks || '-'} tasks | ${files || '-'} files |`;

    if (tableBody.trim() === '' || tableBody.includes('None yet')) {
      tableBody = newRow;
    } else {
      tableBody = tableBody + '\n' + newRow;
    }

    content = content.replace(metricsPattern, `${tableHeader}${tableBody}\n`);
    fs.writeFileSync(statePath, content, 'utf-8');
    output({ recorded: true, phase, plan, duration }, raw, 'true');
  } else {
    output({ recorded: false, reason: 'Performance Metrics section not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateUpdateProgress(cwd, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');

  // Count summaries across all phases
  const phasesDir = path.join(cwd, '.planning', 'phases');
  let totalPlans = 0;
  let totalSummaries = 0;

  if (fs.existsSync(phasesDir)) {
    const phaseDirs = fs.readdirSync(phasesDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
    for (const dir of phaseDirs) {
      const files = fs.readdirSync(path.join(phasesDir, dir));
      totalPlans += files.filter(f => f.match(/-PLAN\.md$/i)).length;
      totalSummaries += files.filter(f => f.match(/-SUMMARY\.md$/i)).length;
    }
  }

  const percent = totalPlans > 0 ? Math.round(totalSummaries / totalPlans * 100) : 0;
  const barWidth = 10;
  const filled = Math.round(percent / 100 * barWidth);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
  const progressStr = `[${bar}] ${percent}%`;

  const progressPattern = /(\*\*Progress:\*\*\s*).*/i;
  if (progressPattern.test(content)) {
    content = content.replace(progressPattern, `$1${progressStr}`);
    fs.writeFileSync(statePath, content, 'utf-8');
    output({ updated: true, percent, completed: totalSummaries, total: totalPlans, bar: progressStr }, raw, progressStr);
  } else {
    output({ updated: false, reason: 'Progress field not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateAddDecision(cwd, options, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  const { phase, summary, rationale } = options;
  if (!summary) { output({ error: 'summary required' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const entry = `- [Phase ${phase || '?'}]: ${summary}${rationale ? ` — ${rationale}` : ''}`;

  // Find Decisions section (various heading patterns)
  const sectionPattern = /(###?\s*(?:Decisions|Decisions Made|Accumulated.*Decisions)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    let sectionBody = match[2];
    // Remove placeholders
    sectionBody = sectionBody.replace(/None yet\.?\s*\n?/gi, '').replace(/No decisions yet\.?\s*\n?/gi, '');
    sectionBody = sectionBody.trimEnd() + '\n' + entry + '\n';
    content = content.replace(sectionPattern, `${match[1]}${sectionBody}`);
    fs.writeFileSync(statePath, content, 'utf-8');
    output({ added: true, decision: entry }, raw, 'true');
  } else {
    output({ added: false, reason: 'Decisions section not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateAddBlocker(cwd, text, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }
  if (!text) { output({ error: 'text required' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const entry = `- ${text}`;

  const sectionPattern = /(###?\s*(?:Blockers|Blockers\/Concerns|Concerns)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    let sectionBody = match[2];
    sectionBody = sectionBody.replace(/None\.?\s*\n?/gi, '').replace(/None yet\.?\s*\n?/gi, '');
    sectionBody = sectionBody.trimEnd() + '\n' + entry + '\n';
    content = content.replace(sectionPattern, `${match[1]}${sectionBody}`);
    fs.writeFileSync(statePath, content, 'utf-8');
    output({ added: true, blocker: text }, raw, 'true');
  } else {
    output({ added: false, reason: 'Blockers section not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateResolveBlocker(cwd, text, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }
  if (!text) { output({ error: 'text required' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');

  const sectionPattern = /(###?\s*(?:Blockers|Blockers\/Concerns|Concerns)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    const sectionBody = match[2];
    const lines = sectionBody.split('\n');
    const filtered = lines.filter(line => {
      if (!line.startsWith('- ')) return true;
      return !line.toLowerCase().includes(text.toLowerCase());
    });

    let newBody = filtered.join('\n');
    // If section is now empty, add placeholder
    if (!newBody.trim() || !newBody.includes('- ')) {
      newBody = 'None\n';
    }

    content = content.replace(sectionPattern, `${match[1]}${newBody}`);
    fs.writeFileSync(statePath, content, 'utf-8');
    output({ resolved: true, blocker: text }, raw, 'true');
  } else {
    output({ resolved: false, reason: 'Blockers section not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateRecordSession(cwd, options, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const now = new Date().toISOString();
  const updated = [];

  // Update Last session / Last Date
  let result = stateReplaceField(content, 'Last session', now);
  if (result) { content = result; updated.push('Last session'); }
  result = stateReplaceField(content, 'Last Date', now);
  if (result) { content = result; updated.push('Last Date'); }

  // Update Stopped at
  if (options.stopped_at) {
    result = stateReplaceField(content, 'Stopped At', options.stopped_at);
    if (!result) result = stateReplaceField(content, 'Stopped at', options.stopped_at);
    if (result) { content = result; updated.push('Stopped At'); }
  }

  // Update Resume file
  const resumeFile = options.resume_file || 'None';
  result = stateReplaceField(content, 'Resume File', resumeFile);
  if (!result) result = stateReplaceField(content, 'Resume file', resumeFile);
  if (result) { content = result; updated.push('Resume File'); }

  if (updated.length > 0) {
    fs.writeFileSync(statePath, content, 'utf-8');
    output({ recorded: true, updated }, raw, 'true');
  } else {
    output({ recorded: false, reason: 'No session fields found in STATE.md' }, raw, 'false');
  }
}

function cmdResolveModel(cwd, agentType, raw) {
  if (!agentType) {
    error('agent-type required');
  }

  const config = loadConfig(cwd);
  const profile = config.model_profile || 'balanced';

  const agentModels = MODEL_PROFILES[agentType];
  if (!agentModels) {
    const result = { model: 'sonnet', profile, unknown_agent: true };
    output(result, raw, 'sonnet');
    return;
  }

  const model = agentModels[profile] || agentModels['balanced'] || 'sonnet';
  const result = { model, profile };
  output(result, raw, model);
}

function cmdFindPhase(cwd, phase, raw) {
  if (!phase) {
    error('phase identifier required');
  }

  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(phase);

  const notFound = { found: false, directory: null, phase_number: null, phase_name: null, plans: [], summaries: [] };

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    const match = dirs.find(d => d.startsWith(normalized));
    if (!match) {
      output(notFound, raw, '');
      return;
    }

    const dirMatch = match.match(/^(\d+(?:\.\d+)?)-?(.*)/);
    const phaseNumber = dirMatch ? dirMatch[1] : normalized;
    const phaseName = dirMatch && dirMatch[2] ? dirMatch[2] : null;

    const phaseDir = path.join(phasesDir, match);
    const phaseFiles = fs.readdirSync(phaseDir);
    const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').sort();
    const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').sort();

    const result = {
      found: true,
      directory: path.join('.planning', 'phases', match),
      phase_number: phaseNumber,
      phase_name: phaseName,
      plans,
      summaries,
    };

    output(result, raw, result.directory);
  } catch {
    output(notFound, raw, '');
  }
}

function cmdCommit(cwd, message, files, raw, amend) {
  if (!message && !amend) {
    error('commit message required');
  }

  const config = loadConfig(cwd);

  // Check commit_docs config
  if (!config.commit_docs) {
    const result = { committed: false, hash: null, reason: 'skipped_commit_docs_false' };
    output(result, raw, 'skipped');
    return;
  }

  // Check if .planning is gitignored
  if (isGitIgnored(cwd, '.planning')) {
    const result = { committed: false, hash: null, reason: 'skipped_gitignored' };
    output(result, raw, 'skipped');
    return;
  }

  // Stage files
  const filesToStage = files && files.length > 0 ? files : ['.planning/'];
  for (const file of filesToStage) {
    execGit(cwd, ['add', file]);
  }

  // Commit
  const commitArgs = amend ? ['commit', '--amend', '--no-edit'] : ['commit', '-m', message];
  const commitResult = execGit(cwd, commitArgs);
  if (commitResult.exitCode !== 0) {
    if (commitResult.stdout.includes('nothing to commit') || commitResult.stderr.includes('nothing to commit')) {
      const result = { committed: false, hash: null, reason: 'nothing_to_commit' };
      output(result, raw, 'nothing');
      return;
    }
    const result = { committed: false, hash: null, reason: 'nothing_to_commit', error: commitResult.stderr };
    output(result, raw, 'nothing');
    return;
  }

  // Get short hash
  const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
  const hash = hashResult.exitCode === 0 ? hashResult.stdout : null;
  const result = { committed: true, hash, reason: 'committed' };
  output(result, raw, hash || 'committed');
}

function cmdVerifySummary(cwd, summaryPath, checkFileCount, raw) {
  if (!summaryPath) {
    error('summary-path required');
  }

  const fullPath = path.join(cwd, summaryPath);
  const checkCount = checkFileCount || 2;

  // Check 1: Summary exists
  if (!fs.existsSync(fullPath)) {
    const result = {
      passed: false,
      checks: {
        summary_exists: false,
        files_created: { checked: 0, found: 0, missing: [] },
        commits_exist: false,
        self_check: 'not_found',
      },
      errors: ['SUMMARY.md not found'],
    };
    output(result, raw, 'failed');
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const errors = [];

  // Check 2: Spot-check files mentioned in summary
  const mentionedFiles = new Set();
  const patterns = [
    /`([^`]+\.[a-zA-Z]+)`/g,
    /(?:Created|Modified|Added|Updated|Edited):\s*`?([^\s`]+\.[a-zA-Z]+)`?/gi,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const filePath = m[1];
      if (filePath && !filePath.startsWith('http') && filePath.includes('/')) {
        mentionedFiles.add(filePath);
      }
    }
  }

  const filesToCheck = Array.from(mentionedFiles).slice(0, checkCount);
  const missing = [];
  for (const file of filesToCheck) {
    if (!fs.existsSync(path.join(cwd, file))) {
      missing.push(file);
    }
  }

  // Check 3: Commits exist
  const commitHashPattern = /\b[0-9a-f]{7,40}\b/g;
  const hashes = content.match(commitHashPattern) || [];
  let commitsExist = false;
  if (hashes.length > 0) {
    for (const hash of hashes.slice(0, 3)) {
      const result = execGit(cwd, ['cat-file', '-t', hash]);
      if (result.exitCode === 0 && result.stdout === 'commit') {
        commitsExist = true;
        break;
      }
    }
  }

  // Check 4: Self-check section
  let selfCheck = 'not_found';
  const selfCheckPattern = /##\s*(?:Self[- ]?Check|Verification|Quality Check)/i;
  if (selfCheckPattern.test(content)) {
    const passPattern = /(?:all\s+)?(?:pass|✓|✅|complete|succeeded)/i;
    const failPattern = /(?:fail|✗|❌|incomplete|blocked)/i;
    const checkSection = content.slice(content.search(selfCheckPattern));
    if (failPattern.test(checkSection)) {
      selfCheck = 'failed';
    } else if (passPattern.test(checkSection)) {
      selfCheck = 'passed';
    }
  }

  if (missing.length > 0) errors.push('Missing files: ' + missing.join(', '));
  if (!commitsExist && hashes.length > 0) errors.push('Referenced commit hashes not found in git history');
  if (selfCheck === 'failed') errors.push('Self-check section indicates failure');

  const checks = {
    summary_exists: true,
    files_created: { checked: filesToCheck.length, found: filesToCheck.length - missing.length, missing },
    commits_exist: commitsExist,
    self_check: selfCheck,
  };

  const passed = missing.length === 0 && selfCheck !== 'failed';
  const result = { passed, checks, errors };
  output(result, raw, passed ? 'passed' : 'failed');
}

function cmdTemplateSelect(cwd, planPath, raw) {
  if (!planPath) {
    error('plan-path required');
  }

  try {
    const fullPath = path.join(cwd, planPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    
    // Simple heuristics
    const taskMatch = content.match(/###\s*Task\s*\d+/g) || [];
    const taskCount = taskMatch.length;
    
    const decisionMatch = content.match(/decision/gi) || [];
    const hasDecisions = decisionMatch.length > 0;
    
    // Count file mentions
    const fileMentions = new Set();
    const filePattern = /`([^`]+\.[a-zA-Z]+)`/g;
    let m;
    while ((m = filePattern.exec(content)) !== null) {
      if (m[1].includes('/') && !m[1].startsWith('http')) {
        fileMentions.add(m[1]);
      }
    }
    const fileCount = fileMentions.size;

    let template = 'templates/summary-standard.md';
    let type = 'standard';

    if (taskCount <= 2 && fileCount <= 3 && !hasDecisions) {
      template = 'templates/summary-minimal.md';
      type = 'minimal';
    } else if (hasDecisions || fileCount > 6 || taskCount > 5) {
      template = 'templates/summary-complex.md';
      type = 'complex';
    }

    const result = { template, type, taskCount, fileCount, hasDecisions };
    output(result, raw, template);
  } catch (e) {
    // Fallback to standard
    output({ template: 'templates/summary-standard.md', type: 'standard', error: e.message }, raw, 'templates/summary-standard.md');
  }
}

function cmdTemplateFill(cwd, templateType, options, raw) {
  if (!templateType) { error('template type required: summary, plan, or verification'); }
  if (!options.phase) { error('--phase required'); }

  const phaseInfo = findPhaseInternal(cwd, options.phase);
  if (!phaseInfo || !phaseInfo.found) { output({ error: 'Phase not found', phase: options.phase }, raw); return; }

  const padded = normalizePhaseName(options.phase);
  const today = new Date().toISOString().split('T')[0];
  const phaseName = options.name || phaseInfo.phase_name || 'Unnamed';
  const phaseSlug = phaseInfo.phase_slug || generateSlugInternal(phaseName);
  const phaseId = `${padded}-${phaseSlug}`;
  const planNum = (options.plan || '01').padStart(2, '0');
  const fields = options.fields || {};

  let frontmatter, body, fileName;

  switch (templateType) {
    case 'summary': {
      frontmatter = {
        phase: phaseId,
        plan: planNum,
        subsystem: '[primary category]',
        tags: [],
        provides: [],
        affects: [],
        'tech-stack': { added: [], patterns: [] },
        'key-files': { created: [], modified: [] },
        'key-decisions': [],
        'patterns-established': [],
        duration: '[X]min',
        completed: today,
        ...fields,
      };
      body = [
        `# Phase ${options.phase}: ${phaseName} Summary`,
        '',
        '**[Substantive one-liner describing outcome]**',
        '',
        '## Performance',
        '- **Duration:** [time]',
        '- **Tasks:** [count completed]',
        '- **Files modified:** [count]',
        '',
        '## Accomplishments',
        '- [Key outcome 1]',
        '- [Key outcome 2]',
        '',
        '## Task Commits',
        '1. **Task 1: [task name]** - `hash`',
        '',
        '## Files Created/Modified',
        '- `path/to/file.ts` - What it does',
        '',
        '## Decisions & Deviations',
        '[Key decisions or "None - followed plan as specified"]',
        '',
        '## Next Phase Readiness',
        '[What\'s ready for next phase]',
      ].join('\n');
      fileName = `${padded}-${planNum}-SUMMARY.md`;
      break;
    }
    case 'plan': {
      const planType = options.type || 'execute';
      const wave = parseInt(options.wave) || 1;
      frontmatter = {
        phase: phaseId,
        plan: planNum,
        type: planType,
        wave,
        depends_on: [],
        files_modified: [],
        autonomous: true,
        user_setup: [],
        must_haves: { truths: [], artifacts: [], key_links: [] },
        ...fields,
      };
      body = [
        `# Phase ${options.phase} Plan ${planNum}: [Title]`,
        '',
        '## Objective',
        '- **What:** [What this plan builds]',
        '- **Why:** [Why it matters for the phase goal]',
        '- **Output:** [Concrete deliverable]',
        '',
        '## Context',
        '@.planning/PROJECT.md',
        '@.planning/ROADMAP.md',
        '@.planning/STATE.md',
        '',
        '## Tasks',
        '',
        '<task type="code">',
        '  <name>[Task name]</name>',
        '  <files>[file paths]</files>',
        '  <action>[What to do]</action>',
        '  <verify>[How to verify]</verify>',
        '  <done>[Definition of done]</done>',
        '</task>',
        '',
        '## Verification',
        '[How to verify this plan achieved its objective]',
        '',
        '## Success Criteria',
        '- [ ] [Criterion 1]',
        '- [ ] [Criterion 2]',
      ].join('\n');
      fileName = `${padded}-${planNum}-PLAN.md`;
      break;
    }
    case 'verification': {
      frontmatter = {
        phase: phaseId,
        verified: new Date().toISOString(),
        status: 'pending',
        score: '0/0 must-haves verified',
        ...fields,
      };
      body = [
        `# Phase ${options.phase}: ${phaseName} — Verification`,
        '',
        '## Observable Truths',
        '| # | Truth | Status | Evidence |',
        '|---|-------|--------|----------|',
        '| 1 | [Truth] | pending | |',
        '',
        '## Required Artifacts',
        '| Artifact | Expected | Status | Details |',
        '|----------|----------|--------|---------|',
        '| [path] | [what] | pending | |',
        '',
        '## Key Link Verification',
        '| From | To | Via | Status | Details |',
        '|------|----|----|--------|---------|',
        '| [source] | [target] | [connection] | pending | |',
        '',
        '## Requirements Coverage',
        '| Requirement | Status | Blocking Issue |',
        '|-------------|--------|----------------|',
        '| [req] | pending | |',
        '',
        '## Result',
        '[Pending verification]',
      ].join('\n');
      fileName = `${padded}-VERIFICATION.md`;
      break;
    }
    default:
      error(`Unknown template type: ${templateType}. Available: summary, plan, verification`);
      return;
  }

  const fullContent = `---\n${reconstructFrontmatter(frontmatter)}\n---\n\n${body}\n`;
  const outPath = path.join(cwd, phaseInfo.directory, fileName);

  if (fs.existsSync(outPath)) {
    output({ error: 'File already exists', path: path.relative(cwd, outPath) }, raw);
    return;
  }

  fs.writeFileSync(outPath, fullContent, 'utf-8');
  const relPath = path.relative(cwd, outPath);
  output({ created: true, path: relPath, template: templateType }, raw, relPath);
}

function cmdPhasePlanIndex(cwd, phase, raw) {
  if (!phase) {
    error('phase required for phase-plan-index');
  }

  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(phase);

  // Find phase directory
  let phaseDir = null;
  let phaseDirName = null;
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    const match = dirs.find(d => d.startsWith(normalized));
    if (match) {
      phaseDir = path.join(phasesDir, match);
      phaseDirName = match;
    }
  } catch {
    // phases dir doesn't exist
  }

  if (!phaseDir) {
    output({ phase: normalized, error: 'Phase not found', plans: [], waves: {}, incomplete: [], has_checkpoints: false }, raw);
    return;
  }

  // Get all files in phase directory
  const phaseFiles = fs.readdirSync(phaseDir);
  const planFiles = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').sort();
  const summaryFiles = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');

  // Build set of plan IDs with summaries
  const completedPlanIds = new Set(
    summaryFiles.map(s => s.replace('-SUMMARY.md', '').replace('SUMMARY.md', ''))
  );

  const plans = [];
  const waves = {};
  const incomplete = [];
  let hasCheckpoints = false;

  for (const planFile of planFiles) {
    const planId = planFile.replace('-PLAN.md', '').replace('PLAN.md', '');
    const planPath = path.join(phaseDir, planFile);
    const content = fs.readFileSync(planPath, 'utf-8');
    const fm = extractFrontmatter(content);

    // Count tasks (## Task N patterns)
    const taskMatches = content.match(/##\s*Task\s*\d+/gi) || [];
    const taskCount = taskMatches.length;

    // Parse wave as integer
    const wave = parseInt(fm.wave, 10) || 1;

    // Parse autonomous (default true if not specified)
    let autonomous = true;
    if (fm.autonomous !== undefined) {
      autonomous = fm.autonomous === 'true' || fm.autonomous === true;
    }

    if (!autonomous) {
      hasCheckpoints = true;
    }

    // Parse files-modified
    let filesModified = [];
    if (fm['files-modified']) {
      filesModified = Array.isArray(fm['files-modified']) ? fm['files-modified'] : [fm['files-modified']];
    }

    const hasSummary = completedPlanIds.has(planId);
    if (!hasSummary) {
      incomplete.push(planId);
    }

    const plan = {
      id: planId,
      wave,
      autonomous,
      objective: fm.objective || null,
      files_modified: filesModified,
      task_count: taskCount,
      has_summary: hasSummary,
    };

    plans.push(plan);

    // Group by wave
    const waveKey = String(wave);
    if (!waves[waveKey]) {
      waves[waveKey] = [];
    }
    waves[waveKey].push(planId);
  }

  const result = {
    phase: normalized,
    plans,
    waves,
    incomplete,
    has_checkpoints: hasCheckpoints,
  };

  output(result, raw);
}

function cmdStateSnapshot(cwd, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');

  if (!fs.existsSync(statePath)) {
    output({ error: 'STATE.md not found' }, raw);
    return;
  }

  const content = fs.readFileSync(statePath, 'utf-8');

  // Helper to extract **Field:** value patterns
  const extractField = (fieldName) => {
    const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
    const match = content.match(pattern);
    return match ? match[1].trim() : null;
  };

  // Extract basic fields
  const currentPhase = extractField('Current Phase');
  const currentPhaseName = extractField('Current Phase Name');
  const totalPhasesRaw = extractField('Total Phases');
  const currentPlan = extractField('Current Plan');
  const totalPlansRaw = extractField('Total Plans in Phase');
  const status = extractField('Status');
  const progressRaw = extractField('Progress');
  const lastActivity = extractField('Last Activity');
  const lastActivityDesc = extractField('Last Activity Description');
  const pausedAt = extractField('Paused At');

  // Parse numeric fields
  const totalPhases = totalPhasesRaw ? parseInt(totalPhasesRaw, 10) : null;
  const totalPlansInPhase = totalPlansRaw ? parseInt(totalPlansRaw, 10) : null;
  const progressPercent = progressRaw ? parseInt(progressRaw.replace('%', ''), 10) : null;

  // Extract decisions table
  const decisions = [];
  const decisionsMatch = content.match(/##\s*Decisions Made[\s\S]*?\n\|[^\n]+\n\|[-|\s]+\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (decisionsMatch) {
    const tableBody = decisionsMatch[1];
    const rows = tableBody.trim().split('\n').filter(r => r.includes('|'));
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 3) {
        decisions.push({
          phase: cells[0],
          summary: cells[1],
          rationale: cells[2],
        });
      }
    }
  }

  // Extract blockers list
  const blockers = [];
  const blockersMatch = content.match(/##\s*Blockers\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (blockersMatch) {
    const blockersSection = blockersMatch[1];
    const items = blockersSection.match(/^-\s+(.+)$/gm) || [];
    for (const item of items) {
      blockers.push(item.replace(/^-\s+/, '').trim());
    }
  }

  // Extract session info
  const session = {
    last_date: null,
    stopped_at: null,
    resume_file: null,
  };

  const sessionMatch = content.match(/##\s*Session\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (sessionMatch) {
    const sessionSection = sessionMatch[1];
    const lastDateMatch = sessionSection.match(/\*\*Last Date:\*\*\s*(.+)/i);
    const stoppedAtMatch = sessionSection.match(/\*\*Stopped At:\*\*\s*(.+)/i);
    const resumeFileMatch = sessionSection.match(/\*\*Resume File:\*\*\s*(.+)/i);

    if (lastDateMatch) session.last_date = lastDateMatch[1].trim();
    if (stoppedAtMatch) session.stopped_at = stoppedAtMatch[1].trim();
    if (resumeFileMatch) session.resume_file = resumeFileMatch[1].trim();
  }

  const result = {
    current_phase: currentPhase,
    current_phase_name: currentPhaseName,
    total_phases: totalPhases,
    current_plan: currentPlan,
    total_plans_in_phase: totalPlansInPhase,
    status,
    progress_percent: progressPercent,
    last_activity: lastActivity,
    last_activity_desc: lastActivityDesc,
    decisions,
    blockers,
    paused_at: pausedAt,
    session,
  };

  output(result, raw);
}

function cmdSummaryExtract(cwd, summaryPath, fields, raw) {
  if (!summaryPath) {
    error('summary-path required for summary-extract');
  }

  const fullPath = path.join(cwd, summaryPath);

  if (!fs.existsSync(fullPath)) {
    output({ error: 'File not found', path: summaryPath }, raw);
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const fm = extractFrontmatter(content);

  // Parse key-decisions into structured format
  const parseDecisions = (decisionsList) => {
    if (!decisionsList || !Array.isArray(decisionsList)) return [];
    return decisionsList.map(d => {
      const colonIdx = d.indexOf(':');
      if (colonIdx > 0) {
        return {
          summary: d.substring(0, colonIdx).trim(),
          rationale: d.substring(colonIdx + 1).trim(),
        };
      }
      return { summary: d, rationale: null };
    });
  };

  // Build full result
  const fullResult = {
    path: summaryPath,
    one_liner: fm['one-liner'] || null,
    key_files: fm['key-files'] || [],
    tech_added: (fm['tech-stack'] && fm['tech-stack'].added) || [],
    patterns: fm['patterns-established'] || [],
    decisions: parseDecisions(fm['key-decisions']),
  };

  // If fields specified, filter to only those fields
  if (fields && fields.length > 0) {
    const filtered = { path: summaryPath };
    for (const field of fields) {
      if (fullResult[field] !== undefined) {
        filtered[field] = fullResult[field];
      }
    }
    output(filtered, raw);
    return;
  }

  output(fullResult, raw);
}

// ─── Web Search (Brave API) ──────────────────────────────────────────────────

async function cmdWebsearch(query, options, raw) {
  const apiKey = process.env.BRAVE_API_KEY;

  if (!apiKey) {
    // No key = silent skip, agent falls back to built-in WebSearch
    output({ available: false, reason: 'BRAVE_API_KEY not set' }, raw, '');
    return;
  }

  if (!query) {
    output({ available: false, error: 'Query required' }, raw, '');
    return;
  }

  const params = new URLSearchParams({
    q: query,
    count: String(options.limit || 10),
    country: 'us',
    search_lang: 'en',
    text_decorations: 'false'
  });

  if (options.freshness) {
    params.set('freshness', options.freshness);
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey
        }
      }
    );

    if (!response.ok) {
      output({ available: false, error: `API error: ${response.status}` }, raw, '');
      return;
    }

    const data = await response.json();

    const results = (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      age: r.age || null
    }));

    output({
      available: true,
      query,
      count: results.length,
      results
    }, raw, results.map(r => `${r.title}\n${r.url}\n${r.description}`).join('\n\n'));
  } catch (err) {
    output({ available: false, error: err.message }, raw, '');
  }
}

// ─── Frontmatter CRUD ────────────────────────────────────────────────────────

function cmdFrontmatterGet(cwd, filePath, field, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }
  const fm = extractFrontmatter(content);
  if (field) {
    const value = fm[field];
    if (value === undefined) { output({ error: 'Field not found', field }, raw); return; }
    output({ [field]: value }, raw, JSON.stringify(value));
  } else {
    output(fm, raw);
  }
}

function cmdFrontmatterSet(cwd, filePath, field, value, raw) {
  if (!filePath || !field || value === undefined) { error('file, field, and value required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(fullPath)) { output({ error: 'File not found', path: filePath }, raw); return; }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const fm = extractFrontmatter(content);
  let parsedValue;
  try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
  fm[field] = parsedValue;
  const newContent = spliceFrontmatter(content, fm);
  fs.writeFileSync(fullPath, newContent, 'utf-8');
  output({ updated: true, field, value: parsedValue }, raw, 'true');
}

function cmdFrontmatterMerge(cwd, filePath, data, raw) {
  if (!filePath || !data) { error('file and data required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(fullPath)) { output({ error: 'File not found', path: filePath }, raw); return; }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const fm = extractFrontmatter(content);
  let mergeData;
  try { mergeData = JSON.parse(data); } catch { error('Invalid JSON for --data'); return; }
  Object.assign(fm, mergeData);
  const newContent = spliceFrontmatter(content, fm);
  fs.writeFileSync(fullPath, newContent, 'utf-8');
  output({ merged: true, fields: Object.keys(mergeData) }, raw, 'true');
}

const FRONTMATTER_SCHEMAS = {
  plan: { required: ['phase', 'plan', 'type', 'wave', 'depends_on', 'files_modified', 'autonomous', 'must_haves'] },
  summary: { required: ['phase', 'plan', 'subsystem', 'tags', 'duration', 'completed'] },
  verification: { required: ['phase', 'verified', 'status', 'score'] },
};

function cmdFrontmatterValidate(cwd, filePath, schemaName, raw) {
  if (!filePath || !schemaName) { error('file and schema required'); }
  const schema = FRONTMATTER_SCHEMAS[schemaName];
  if (!schema) { error(`Unknown schema: ${schemaName}. Available: ${Object.keys(FRONTMATTER_SCHEMAS).join(', ')}`); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }
  const fm = extractFrontmatter(content);
  const missing = schema.required.filter(f => fm[f] === undefined);
  const present = schema.required.filter(f => fm[f] !== undefined);
  output({ valid: missing.length === 0, missing, present, schema: schemaName }, raw, missing.length === 0 ? 'valid' : 'invalid');
}

// ─── Verification Suite ──────────────────────────────────────────────────────

function cmdVerifyPlanStructure(cwd, filePath, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }

  const fm = extractFrontmatter(content);
  const errors = [];
  const warnings = [];

  // Check required frontmatter fields
  const required = ['phase', 'plan', 'type', 'wave', 'depends_on', 'files_modified', 'autonomous', 'must_haves'];
  for (const field of required) {
    if (fm[field] === undefined) errors.push(`Missing required frontmatter field: ${field}`);
  }

  // Parse and check task elements
  const taskPattern = /<task[^>]*>([\s\S]*?)<\/task>/g;
  const tasks = [];
  let taskMatch;
  while ((taskMatch = taskPattern.exec(content)) !== null) {
    const taskContent = taskMatch[1];
    const nameMatch = taskContent.match(/<name>([\s\S]*?)<\/name>/);
    const taskName = nameMatch ? nameMatch[1].trim() : 'unnamed';
    const hasFiles = /<files>/.test(taskContent);
    const hasAction = /<action>/.test(taskContent);
    const hasVerify = /<verify>/.test(taskContent);
    const hasDone = /<done>/.test(taskContent);

    if (!nameMatch) errors.push('Task missing <name> element');
    if (!hasAction) errors.push(`Task '${taskName}' missing <action>`);
    if (!hasVerify) warnings.push(`Task '${taskName}' missing <verify>`);
    if (!hasDone) warnings.push(`Task '${taskName}' missing <done>`);
    if (!hasFiles) warnings.push(`Task '${taskName}' missing <files>`);

    tasks.push({ name: taskName, hasFiles, hasAction, hasVerify, hasDone });
  }

  if (tasks.length === 0) warnings.push('No <task> elements found');

  // Wave/depends_on consistency
  if (fm.wave && parseInt(fm.wave) > 1 && (!fm.depends_on || (Array.isArray(fm.depends_on) && fm.depends_on.length === 0))) {
    warnings.push('Wave > 1 but depends_on is empty');
  }

  // Autonomous/checkpoint consistency
  const hasCheckpoints = /<task\s+type=["']?checkpoint/.test(content);
  if (hasCheckpoints && fm.autonomous !== 'false' && fm.autonomous !== false) {
    errors.push('Has checkpoint tasks but autonomous is not false');
  }

  output({
    valid: errors.length === 0,
    errors,
    warnings,
    task_count: tasks.length,
    tasks,
    frontmatter_fields: Object.keys(fm),
  }, raw, errors.length === 0 ? 'valid' : 'invalid');
}

function cmdVerifyPhaseCompleteness(cwd, phase, raw) {
  if (!phase) { error('phase required'); }
  const phaseInfo = findPhaseInternal(cwd, phase);
  if (!phaseInfo || !phaseInfo.found) {
    output({ error: 'Phase not found', phase }, raw);
    return;
  }

  const errors = [];
  const warnings = [];
  const phaseDir = path.join(cwd, phaseInfo.directory);

  // List plans and summaries
  let files;
  try { files = fs.readdirSync(phaseDir); } catch { output({ error: 'Cannot read phase directory' }, raw); return; }

  const plans = files.filter(f => f.match(/-PLAN\.md$/i));
  const summaries = files.filter(f => f.match(/-SUMMARY\.md$/i));

  // Extract plan IDs (everything before -PLAN.md)
  const planIds = new Set(plans.map(p => p.replace(/-PLAN\.md$/i, '')));
  const summaryIds = new Set(summaries.map(s => s.replace(/-SUMMARY\.md$/i, '')));

  // Plans without summaries
  const incompletePlans = [...planIds].filter(id => !summaryIds.has(id));
  if (incompletePlans.length > 0) {
    errors.push(`Plans without summaries: ${incompletePlans.join(', ')}`);
  }

  // Summaries without plans (orphans)
  const orphanSummaries = [...summaryIds].filter(id => !planIds.has(id));
  if (orphanSummaries.length > 0) {
    warnings.push(`Summaries without plans: ${orphanSummaries.join(', ')}`);
  }

  output({
    complete: errors.length === 0,
    phase: phaseInfo.phase_number,
    plan_count: plans.length,
    summary_count: summaries.length,
    incomplete_plans: incompletePlans,
    orphan_summaries: orphanSummaries,
    errors,
    warnings,
  }, raw, errors.length === 0 ? 'complete' : 'incomplete');
}

function cmdVerifyReferences(cwd, filePath, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }

  const found = [];
  const missing = [];

  // Find @-references: @path/to/file (must contain / to be a file path)
  const atRefs = content.match(/@([^\s\n,)]+\/[^\s\n,)]+)/g) || [];
  for (const ref of atRefs) {
    const cleanRef = ref.slice(1); // remove @
    const resolved = cleanRef.startsWith('~/')
      ? path.join(process.env.HOME || '', cleanRef.slice(2))
      : path.join(cwd, cleanRef);
    if (fs.existsSync(resolved)) {
      found.push(cleanRef);
    } else {
      missing.push(cleanRef);
    }
  }

  // Find backtick file paths that look like real paths (contain / and have extension)
  const backtickRefs = content.match(/`([^`]+\/[^`]+\.[a-zA-Z]{1,10})`/g) || [];
  for (const ref of backtickRefs) {
    const cleanRef = ref.slice(1, -1); // remove backticks
    if (cleanRef.startsWith('http') || cleanRef.includes('${') || cleanRef.includes('{{')) continue;
    if (found.includes(cleanRef) || missing.includes(cleanRef)) continue; // dedup
    const resolved = path.join(cwd, cleanRef);
    if (fs.existsSync(resolved)) {
      found.push(cleanRef);
    } else {
      missing.push(cleanRef);
    }
  }

  output({
    valid: missing.length === 0,
    found: found.length,
    missing,
    total: found.length + missing.length,
  }, raw, missing.length === 0 ? 'valid' : 'invalid');
}

function cmdVerifyCommits(cwd, hashes, raw) {
  if (!hashes || hashes.length === 0) { error('At least one commit hash required'); }

  const valid = [];
  const invalid = [];
  for (const hash of hashes) {
    const result = execGit(cwd, ['cat-file', '-t', hash]);
    if (result.exitCode === 0 && result.stdout.trim() === 'commit') {
      valid.push(hash);
    } else {
      invalid.push(hash);
    }
  }

  output({
    all_valid: invalid.length === 0,
    valid,
    invalid,
    total: hashes.length,
  }, raw, invalid.length === 0 ? 'valid' : 'invalid');
}

function cmdVerifyArtifacts(cwd, planFilePath, raw) {
  if (!planFilePath) { error('plan file path required'); }
  const fullPath = path.isAbsolute(planFilePath) ? planFilePath : path.join(cwd, planFilePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: planFilePath }, raw); return; }

  const artifacts = parseMustHavesBlock(content, 'artifacts');
  if (artifacts.length === 0) {
    output({ error: 'No must_haves.artifacts found in frontmatter', path: planFilePath }, raw);
    return;
  }

  const results = [];
  for (const artifact of artifacts) {
    if (typeof artifact === 'string') continue; // skip simple string items
    const artPath = artifact.path;
    if (!artPath) continue;

    const artFullPath = path.join(cwd, artPath);
    const exists = fs.existsSync(artFullPath);
    const check = { path: artPath, exists, issues: [], passed: false };

    if (exists) {
      const fileContent = safeReadFile(artFullPath) || '';
      const lineCount = fileContent.split('\n').length;

      if (artifact.min_lines && lineCount < artifact.min_lines) {
        check.issues.push(`Only ${lineCount} lines, need ${artifact.min_lines}`);
      }
      if (artifact.contains && !fileContent.includes(artifact.contains)) {
        check.issues.push(`Missing pattern: ${artifact.contains}`);
      }
      if (artifact.exports) {
        const exports = Array.isArray(artifact.exports) ? artifact.exports : [artifact.exports];
        for (const exp of exports) {
          if (!fileContent.includes(exp)) check.issues.push(`Missing export: ${exp}`);
        }
      }
      check.passed = check.issues.length === 0;
    } else {
      check.issues.push('File not found');
    }

    results.push(check);
  }

  const passed = results.filter(r => r.passed).length;
  output({
    all_passed: passed === results.length,
    passed,
    total: results.length,
    artifacts: results,
  }, raw, passed === results.length ? 'valid' : 'invalid');
}

function cmdVerifyKeyLinks(cwd, planFilePath, raw) {
  if (!planFilePath) { error('plan file path required'); }
  const fullPath = path.isAbsolute(planFilePath) ? planFilePath : path.join(cwd, planFilePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: planFilePath }, raw); return; }

  const keyLinks = parseMustHavesBlock(content, 'key_links');
  if (keyLinks.length === 0) {
    output({ error: 'No must_haves.key_links found in frontmatter', path: planFilePath }, raw);
    return;
  }

  const results = [];
  for (const link of keyLinks) {
    if (typeof link === 'string') continue;
    const check = { from: link.from, to: link.to, via: link.via || '', verified: false, detail: '' };

    const sourceContent = safeReadFile(path.join(cwd, link.from || ''));
    if (!sourceContent) {
      check.detail = 'Source file not found';
    } else if (link.pattern) {
      try {
        const regex = new RegExp(link.pattern);
        if (regex.test(sourceContent)) {
          check.verified = true;
          check.detail = 'Pattern found in source';
        } else {
          const targetContent = safeReadFile(path.join(cwd, link.to || ''));
          if (targetContent && regex.test(targetContent)) {
            check.verified = true;
            check.detail = 'Pattern found in target';
          } else {
            check.detail = `Pattern "${link.pattern}" not found in source or target`;
          }
        }
      } catch {
        check.detail = `Invalid regex pattern: ${link.pattern}`;
      }
    } else {
      // No pattern: just check source references target
      if (sourceContent.includes(link.to || '')) {
        check.verified = true;
        check.detail = 'Target referenced in source';
      } else {
        check.detail = 'Target not referenced in source';
      }
    }

    results.push(check);
  }

  const verified = results.filter(r => r.verified).length;
  output({
    all_verified: verified === results.length,
    verified,
    total: results.length,
    links: results,
  }, raw, verified === results.length ? 'valid' : 'invalid');
}

// ─── Roadmap Analysis ─────────────────────────────────────────────────────────

function cmdRoadmapAnalyze(cwd, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');

  if (!fs.existsSync(roadmapPath)) {
    output({ error: 'ROADMAP.md not found', milestones: [], phases: [], current_phase: null }, raw);
    return;
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const phasesDir = path.join(cwd, '.planning', 'phases');

  // Extract all phase headings: ### Phase N: Name
  const phasePattern = /###\s*Phase\s+(\d+(?:\.\d+)?)\s*:\s*([^\n]+)/gi;
  const phases = [];
  let match;

  while ((match = phasePattern.exec(content)) !== null) {
    const phaseNum = match[1];
    const phaseName = match[2].replace(/\(INSERTED\)/i, '').trim();

    // Extract goal from the section
    const sectionStart = match.index;
    const restOfContent = content.slice(sectionStart);
    const nextHeader = restOfContent.match(/\n###\s+Phase\s+\d/i);
    const sectionEnd = nextHeader ? sectionStart + nextHeader.index : content.length;
    const section = content.slice(sectionStart, sectionEnd);

    const goalMatch = section.match(/\*\*Goal:\*\*\s*([^\n]+)/i);
    const goal = goalMatch ? goalMatch[1].trim() : null;

    const dependsMatch = section.match(/\*\*Depends on:\*\*\s*([^\n]+)/i);
    const depends_on = dependsMatch ? dependsMatch[1].trim() : null;

    // Check completion on disk
    const normalized = normalizePhaseName(phaseNum);
    let diskStatus = 'no_directory';
    let planCount = 0;
    let summaryCount = 0;
    let hasContext = false;
    let hasResearch = false;

    try {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      const dirMatch = dirs.find(d => d.startsWith(normalized + '-') || d === normalized);

      if (dirMatch) {
        const phaseFiles = fs.readdirSync(path.join(phasesDir, dirMatch));
        planCount = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').length;
        summaryCount = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').length;
        hasContext = phaseFiles.some(f => f.endsWith('-CONTEXT.md') || f === 'CONTEXT.md');
        hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');

        if (summaryCount >= planCount && planCount > 0) diskStatus = 'complete';
        else if (summaryCount > 0) diskStatus = 'partial';
        else if (planCount > 0) diskStatus = 'planned';
        else if (hasResearch) diskStatus = 'researched';
        else if (hasContext) diskStatus = 'discussed';
        else diskStatus = 'empty';
      }
    } catch {}

    // Check ROADMAP checkbox status
    const checkboxPattern = new RegExp(`-\\s*\\[(x| )\\]\\s*.*Phase\\s+${phaseNum.replace('.', '\\.')}`, 'i');
    const checkboxMatch = content.match(checkboxPattern);
    const roadmapComplete = checkboxMatch ? checkboxMatch[1] === 'x' : false;

    phases.push({
      number: phaseNum,
      name: phaseName,
      goal,
      depends_on,
      plan_count: planCount,
      summary_count: summaryCount,
      has_context: hasContext,
      has_research: hasResearch,
      disk_status: diskStatus,
      roadmap_complete: roadmapComplete,
    });
  }

  // Extract milestone info
  const milestones = [];
  const milestonePattern = /##\s*(.*v(\d+\.\d+)[^(\n]*)/gi;
  let mMatch;
  while ((mMatch = milestonePattern.exec(content)) !== null) {
    milestones.push({
      heading: mMatch[1].trim(),
      version: 'v' + mMatch[2],
    });
  }

  // Find current and next phase
  const currentPhase = phases.find(p => p.disk_status === 'planned' || p.disk_status === 'partial') || null;
  const nextPhase = phases.find(p => p.disk_status === 'empty' || p.disk_status === 'no_directory' || p.disk_status === 'discussed' || p.disk_status === 'researched') || null;

  // Aggregated stats
  const totalPlans = phases.reduce((sum, p) => sum + p.plan_count, 0);
  const totalSummaries = phases.reduce((sum, p) => sum + p.summary_count, 0);
  const completedPhases = phases.filter(p => p.disk_status === 'complete').length;

  const result = {
    milestones,
    phases,
    phase_count: phases.length,
    completed_phases: completedPhases,
    total_plans: totalPlans,
    total_summaries: totalSummaries,
    progress_percent: totalPlans > 0 ? Math.round((totalSummaries / totalPlans) * 100) : 0,
    current_phase: currentPhase ? currentPhase.number : null,
    next_phase: nextPhase ? nextPhase.number : null,
  };

  output(result, raw);
}

// ─── Phase Add ────────────────────────────────────────────────────────────────

function cmdPhaseAdd(cwd, description, raw) {
  if (!description) {
    error('description required for phase add');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  if (!fs.existsSync(roadmapPath)) {
    error('ROADMAP.md not found');
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const slug = generateSlugInternal(description);

  // Find highest integer phase number
  const phasePattern = /###\s*Phase\s+(\d+)(?:\.\d+)?:/gi;
  let maxPhase = 0;
  let m;
  while ((m = phasePattern.exec(content)) !== null) {
    const num = parseInt(m[1], 10);
    if (num > maxPhase) maxPhase = num;
  }

  const newPhaseNum = maxPhase + 1;
  const paddedNum = String(newPhaseNum).padStart(2, '0');
  const dirName = `${paddedNum}-${slug}`;
  const dirPath = path.join(cwd, '.planning', 'phases', dirName);

  // Create directory
  fs.mkdirSync(dirPath, { recursive: true });

  // Build phase entry
  const phaseEntry = `\n### Phase ${newPhaseNum}: ${description}\n\n**Goal:** [To be planned]\n**Depends on:** Phase ${maxPhase}\n**Plans:** 0 plans\n\nPlans:\n- [ ] TBD (run /hive:plan-phase ${newPhaseNum} to break down)\n`;

  // Find insertion point: before last "---" or at end
  let updatedContent;
  const lastSeparator = content.lastIndexOf('\n---');
  if (lastSeparator > 0) {
    updatedContent = content.slice(0, lastSeparator) + phaseEntry + content.slice(lastSeparator);
  } else {
    updatedContent = content + phaseEntry;
  }

  fs.writeFileSync(roadmapPath, updatedContent, 'utf-8');

  const result = {
    phase_number: newPhaseNum,
    padded: paddedNum,
    name: description,
    slug,
    directory: `.planning/phases/${dirName}`,
  };

  output(result, raw, paddedNum);
}

// ─── Phase Insert (Decimal) ──────────────────────────────────────────────────

function cmdPhaseInsert(cwd, afterPhase, description, raw) {
  if (!afterPhase || !description) {
    error('after-phase and description required for phase insert');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  if (!fs.existsSync(roadmapPath)) {
    error('ROADMAP.md not found');
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const slug = generateSlugInternal(description);

  // Verify target phase exists
  const afterPhaseEscaped = afterPhase.replace(/\./g, '\\.');
  const targetPattern = new RegExp(`###\\s*Phase\\s+${afterPhaseEscaped}:`, 'i');
  if (!targetPattern.test(content)) {
    error(`Phase ${afterPhase} not found in ROADMAP.md`);
  }

  // Calculate next decimal using existing logic
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalizedBase = normalizePhaseName(afterPhase);
  let existingDecimals = [];

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    const decimalPattern = new RegExp(`^${normalizedBase}\\.(\\d+)`);
    for (const dir of dirs) {
      const dm = dir.match(decimalPattern);
      if (dm) existingDecimals.push(parseInt(dm[1], 10));
    }
  } catch {}

  const nextDecimal = existingDecimals.length === 0 ? 1 : Math.max(...existingDecimals) + 1;
  const decimalPhase = `${normalizedBase}.${nextDecimal}`;
  const dirName = `${decimalPhase}-${slug}`;
  const dirPath = path.join(cwd, '.planning', 'phases', dirName);

  // Create directory
  fs.mkdirSync(dirPath, { recursive: true });

  // Build phase entry
  const phaseEntry = `\n### Phase ${decimalPhase}: ${description} (INSERTED)\n\n**Goal:** [Urgent work - to be planned]\n**Depends on:** Phase ${afterPhase}\n**Plans:** 0 plans\n\nPlans:\n- [ ] TBD (run /hive:plan-phase ${decimalPhase} to break down)\n`;

  // Insert after the target phase section
  const headerPattern = new RegExp(`(###\\s*Phase\\s+${afterPhaseEscaped}:[^\\n]*\\n)`, 'i');
  const headerMatch = content.match(headerPattern);
  if (!headerMatch) {
    error(`Could not find Phase ${afterPhase} header`);
  }

  const headerIdx = content.indexOf(headerMatch[0]);
  const afterHeader = content.slice(headerIdx + headerMatch[0].length);
  const nextPhaseMatch = afterHeader.match(/\n###\s+Phase\s+\d/i);

  let insertIdx;
  if (nextPhaseMatch) {
    insertIdx = headerIdx + headerMatch[0].length + nextPhaseMatch.index;
  } else {
    insertIdx = content.length;
  }

  const updatedContent = content.slice(0, insertIdx) + phaseEntry + content.slice(insertIdx);
  fs.writeFileSync(roadmapPath, updatedContent, 'utf-8');

  const result = {
    phase_number: decimalPhase,
    after_phase: afterPhase,
    name: description,
    slug,
    directory: `.planning/phases/${dirName}`,
  };

  output(result, raw, decimalPhase);
}

// ─── Phase Remove ─────────────────────────────────────────────────────────────

function cmdPhaseRemove(cwd, targetPhase, options, raw) {
  if (!targetPhase) {
    error('phase number required for phase remove');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const force = options.force || false;

  if (!fs.existsSync(roadmapPath)) {
    error('ROADMAP.md not found');
  }

  // Normalize the target
  const normalized = normalizePhaseName(targetPhase);
  const isDecimal = targetPhase.includes('.');

  // Find and validate target directory
  let targetDir = null;
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    targetDir = dirs.find(d => d.startsWith(normalized + '-') || d === normalized);
  } catch {}

  // Check for executed work (SUMMARY.md files)
  if (targetDir && !force) {
    const targetPath = path.join(phasesDir, targetDir);
    const files = fs.readdirSync(targetPath);
    const summaries = files.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
    if (summaries.length > 0) {
      error(`Phase ${targetPhase} has ${summaries.length} executed plan(s). Use --force to remove anyway.`);
    }
  }

  // Delete target directory
  if (targetDir) {
    fs.rmSync(path.join(phasesDir, targetDir), { recursive: true, force: true });
  }

  // Renumber subsequent phases
  const renamedDirs = [];
  const renamedFiles = [];

  if (isDecimal) {
    // Decimal removal: renumber sibling decimals (e.g., removing 06.2 → 06.3 becomes 06.2)
    const baseParts = normalized.split('.');
    const baseInt = baseParts[0];
    const removedDecimal = parseInt(baseParts[1], 10);

    try {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

      // Find sibling decimals with higher numbers
      const decPattern = new RegExp(`^${baseInt}\\.(\\d+)-(.+)$`);
      const toRename = [];
      for (const dir of dirs) {
        const dm = dir.match(decPattern);
        if (dm && parseInt(dm[1], 10) > removedDecimal) {
          toRename.push({ dir, oldDecimal: parseInt(dm[1], 10), slug: dm[2] });
        }
      }

      // Sort descending to avoid conflicts
      toRename.sort((a, b) => b.oldDecimal - a.oldDecimal);

      for (const item of toRename) {
        const newDecimal = item.oldDecimal - 1;
        const oldPhaseId = `${baseInt}.${item.oldDecimal}`;
        const newPhaseId = `${baseInt}.${newDecimal}`;
        const newDirName = `${baseInt}.${newDecimal}-${item.slug}`;

        // Rename directory
        fs.renameSync(path.join(phasesDir, item.dir), path.join(phasesDir, newDirName));
        renamedDirs.push({ from: item.dir, to: newDirName });

        // Rename files inside
        const dirFiles = fs.readdirSync(path.join(phasesDir, newDirName));
        for (const f of dirFiles) {
          // Files may have phase prefix like "06.2-01-PLAN.md"
          if (f.includes(oldPhaseId)) {
            const newFileName = f.replace(oldPhaseId, newPhaseId);
            fs.renameSync(
              path.join(phasesDir, newDirName, f),
              path.join(phasesDir, newDirName, newFileName)
            );
            renamedFiles.push({ from: f, to: newFileName });
          }
        }
      }
    } catch {}

  } else {
    // Integer removal: renumber all subsequent integer phases
    const removedInt = parseInt(normalized, 10);

    try {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

      // Collect directories that need renumbering (integer phases > removed, and their decimals)
      const toRename = [];
      for (const dir of dirs) {
        const dm = dir.match(/^(\d+)(?:\.(\d+))?-(.+)$/);
        if (!dm) continue;
        const dirInt = parseInt(dm[1], 10);
        if (dirInt > removedInt) {
          toRename.push({
            dir,
            oldInt: dirInt,
            decimal: dm[2] ? parseInt(dm[2], 10) : null,
            slug: dm[3],
          });
        }
      }

      // Sort descending to avoid conflicts
      toRename.sort((a, b) => {
        if (a.oldInt !== b.oldInt) return b.oldInt - a.oldInt;
        return (b.decimal || 0) - (a.decimal || 0);
      });

      for (const item of toRename) {
        const newInt = item.oldInt - 1;
        const newPadded = String(newInt).padStart(2, '0');
        const oldPadded = String(item.oldInt).padStart(2, '0');
        const decimalSuffix = item.decimal !== null ? `.${item.decimal}` : '';
        const oldPrefix = `${oldPadded}${decimalSuffix}`;
        const newPrefix = `${newPadded}${decimalSuffix}`;
        const newDirName = `${newPrefix}-${item.slug}`;

        // Rename directory
        fs.renameSync(path.join(phasesDir, item.dir), path.join(phasesDir, newDirName));
        renamedDirs.push({ from: item.dir, to: newDirName });

        // Rename files inside
        const dirFiles = fs.readdirSync(path.join(phasesDir, newDirName));
        for (const f of dirFiles) {
          if (f.startsWith(oldPrefix)) {
            const newFileName = newPrefix + f.slice(oldPrefix.length);
            fs.renameSync(
              path.join(phasesDir, newDirName, f),
              path.join(phasesDir, newDirName, newFileName)
            );
            renamedFiles.push({ from: f, to: newFileName });
          }
        }
      }
    } catch {}
  }

  // Update ROADMAP.md
  let roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');

  // Remove the target phase section
  const targetEscaped = targetPhase.replace(/\./g, '\\.');
  const sectionPattern = new RegExp(
    `\\n?###\\s*Phase\\s+${targetEscaped}\\s*:[\\s\\S]*?(?=\\n###\\s+Phase\\s+\\d|$)`,
    'i'
  );
  roadmapContent = roadmapContent.replace(sectionPattern, '');

  // Remove from phase list (checkbox)
  const checkboxPattern = new RegExp(`\\n?-\\s*\\[[ x]\\]\\s*.*Phase\\s+${targetEscaped}[:\\s][^\\n]*`, 'gi');
  roadmapContent = roadmapContent.replace(checkboxPattern, '');

  // Remove from progress table
  const tableRowPattern = new RegExp(`\\n?\\|\\s*${targetEscaped}\\.?\\s[^|]*\\|[^\\n]*`, 'gi');
  roadmapContent = roadmapContent.replace(tableRowPattern, '');

  // Renumber references in ROADMAP for subsequent phases
  if (!isDecimal) {
    const removedInt = parseInt(normalized, 10);

    // Collect all integer phases > removedInt
    const maxPhase = 99; // reasonable upper bound
    for (let oldNum = maxPhase; oldNum > removedInt; oldNum--) {
      const newNum = oldNum - 1;
      const oldStr = String(oldNum);
      const newStr = String(newNum);
      const oldPad = oldStr.padStart(2, '0');
      const newPad = newStr.padStart(2, '0');

      // Phase headings: ### Phase 18: → ### Phase 17:
      roadmapContent = roadmapContent.replace(
        new RegExp(`(###\\s*Phase\\s+)${oldStr}(\\s*:)`, 'gi'),
        `$1${newStr}$2`
      );

      // Checkbox items: - [ ] **Phase 18:** → - [ ] **Phase 17:**
      roadmapContent = roadmapContent.replace(
        new RegExp(`(Phase\\s+)${oldStr}([:\\s])`, 'g'),
        `$1${newStr}$2`
      );

      // Plan references: 18-01 → 17-01
      roadmapContent = roadmapContent.replace(
        new RegExp(`${oldPad}-(\\d{2})`, 'g'),
        `${newPad}-$1`
      );

      // Table rows: | 18. → | 17.
      roadmapContent = roadmapContent.replace(
        new RegExp(`(\\|\\s*)${oldStr}\\.\\s`, 'g'),
        `$1${newStr}. `
      );

      // Depends on references
      roadmapContent = roadmapContent.replace(
        new RegExp(`(Depends on:\\*\\*\\s*Phase\\s+)${oldStr}\\b`, 'gi'),
        `$1${newStr}`
      );
    }
  }

  fs.writeFileSync(roadmapPath, roadmapContent, 'utf-8');

  // Update STATE.md phase count
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (fs.existsSync(statePath)) {
    let stateContent = fs.readFileSync(statePath, 'utf-8');
    // Update "Total Phases" field
    const totalPattern = /(\*\*Total Phases:\*\*\s*)(\d+)/;
    const totalMatch = stateContent.match(totalPattern);
    if (totalMatch) {
      const oldTotal = parseInt(totalMatch[2], 10);
      stateContent = stateContent.replace(totalPattern, `$1${oldTotal - 1}`);
    }
    // Update "Phase: X of Y" pattern
    const ofPattern = /(\bof\s+)(\d+)(\s*(?:\(|phases?))/i;
    const ofMatch = stateContent.match(ofPattern);
    if (ofMatch) {
      const oldTotal = parseInt(ofMatch[2], 10);
      stateContent = stateContent.replace(ofPattern, `$1${oldTotal - 1}$3`);
    }
    fs.writeFileSync(statePath, stateContent, 'utf-8');
  }

  const result = {
    removed: targetPhase,
    directory_deleted: targetDir || null,
    renamed_directories: renamedDirs,
    renamed_files: renamedFiles,
    roadmap_updated: true,
    state_updated: fs.existsSync(statePath),
  };

  output(result, raw);
}

// ─── Phase Complete (Transition) ──────────────────────────────────────────────

function cmdPhaseComplete(cwd, phaseNum, raw) {
  if (!phaseNum) {
    error('phase number required for phase complete');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(phaseNum);
  const today = new Date().toISOString().split('T')[0];

  // Verify phase info
  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo) {
    error(`Phase ${phaseNum} not found`);
  }

  const planCount = phaseInfo.plans.length;
  const summaryCount = phaseInfo.summaries.length;

  // Update ROADMAP.md: mark phase complete
  if (fs.existsSync(roadmapPath)) {
    let roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');

    // Checkbox: - [ ] Phase N: → - [x] Phase N: (...completed DATE)
    const checkboxPattern = new RegExp(
      `(-\\s*\\[)[ ](\\]\\s*.*Phase\\s+${phaseNum.replace('.', '\\.')}[:\\s][^\\n]*)`,
      'i'
    );
    roadmapContent = roadmapContent.replace(checkboxPattern, `$1x$2 (completed ${today})`);

    // Progress table: update Status to Complete, add date
    const phaseEscaped = phaseNum.replace('.', '\\.');
    const tablePattern = new RegExp(
      `(\\|\\s*${phaseEscaped}\\.?\\s[^|]*\\|[^|]*\\|)\\s*[^|]*(\\|)\\s*[^|]*(\\|)`,
      'i'
    );
    roadmapContent = roadmapContent.replace(
      tablePattern,
      `$1 Complete    $2 ${today} $3`
    );

    // Update plan count in phase section
    const planCountPattern = new RegExp(
      `(###\\s*Phase\\s+${phaseEscaped}[\\s\\S]*?\\*\\*Plans:\\*\\*\\s*)[^\\n]+`,
      'i'
    );
    roadmapContent = roadmapContent.replace(
      planCountPattern,
      `$1${summaryCount}/${planCount} plans complete`
    );

    fs.writeFileSync(roadmapPath, roadmapContent, 'utf-8');
  }

  // Find next phase
  let nextPhaseNum = null;
  let nextPhaseName = null;
  let isLastPhase = true;

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    const currentFloat = parseFloat(phaseNum);

    // Find the next phase directory after current
    for (const dir of dirs) {
      const dm = dir.match(/^(\d+(?:\.\d+)?)-?(.*)/);
      if (dm) {
        const dirFloat = parseFloat(dm[1]);
        if (dirFloat > currentFloat) {
          nextPhaseNum = dm[1];
          nextPhaseName = dm[2] || null;
          isLastPhase = false;
          break;
        }
      }
    }
  } catch {}

  // Update STATE.md
  if (fs.existsSync(statePath)) {
    let stateContent = fs.readFileSync(statePath, 'utf-8');

    // Update Current Phase
    stateContent = stateContent.replace(
      /(\*\*Current Phase:\*\*\s*).*/,
      `$1${nextPhaseNum || phaseNum}`
    );

    // Update Current Phase Name
    if (nextPhaseName) {
      stateContent = stateContent.replace(
        /(\*\*Current Phase Name:\*\*\s*).*/,
        `$1${nextPhaseName.replace(/-/g, ' ')}`
      );
    }

    // Update Status
    stateContent = stateContent.replace(
      /(\*\*Status:\*\*\s*).*/,
      `$1${isLastPhase ? 'Milestone complete' : 'Ready to plan'}`
    );

    // Update Current Plan
    stateContent = stateContent.replace(
      /(\*\*Current Plan:\*\*\s*).*/,
      `$1Not started`
    );

    // Update Last Activity
    stateContent = stateContent.replace(
      /(\*\*Last Activity:\*\*\s*).*/,
      `$1${today}`
    );

    // Update Last Activity Description
    stateContent = stateContent.replace(
      /(\*\*Last Activity Description:\*\*\s*).*/,
      `$1Phase ${phaseNum} complete${nextPhaseNum ? `, transitioned to Phase ${nextPhaseNum}` : ''}`
    );

    fs.writeFileSync(statePath, stateContent, 'utf-8');
  }

  const result = {
    completed_phase: phaseNum,
    phase_name: phaseInfo.phase_name,
    plans_executed: `${summaryCount}/${planCount}`,
    next_phase: nextPhaseNum,
    next_phase_name: nextPhaseName,
    is_last_phase: isLastPhase,
    date: today,
    roadmap_updated: fs.existsSync(roadmapPath),
    state_updated: fs.existsSync(statePath),
  };

  output(result, raw);
}

// ─── Milestone Complete ───────────────────────────────────────────────────────

function cmdMilestoneComplete(cwd, version, options, raw) {
  if (!version) {
    error('version required for milestone complete (e.g., v1.0)');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const reqPath = path.join(cwd, '.planning', 'REQUIREMENTS.md');
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  const milestonesPath = path.join(cwd, '.planning', 'MILESTONES.md');
  const archiveDir = path.join(cwd, '.planning', 'milestones');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const today = new Date().toISOString().split('T')[0];
  const milestoneName = options.name || version;

  // Ensure archive directory exists
  fs.mkdirSync(archiveDir, { recursive: true });

  // Gather stats from phases
  let phaseCount = 0;
  let totalPlans = 0;
  let totalTasks = 0;
  const accomplishments = [];

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    for (const dir of dirs) {
      phaseCount++;
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md');
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
      totalPlans += plans.length;

      // Extract one-liners from summaries
      for (const s of summaries) {
        try {
          const content = fs.readFileSync(path.join(phasesDir, dir, s), 'utf-8');
          const fm = extractFrontmatter(content);
          if (fm['one-liner']) {
            accomplishments.push(fm['one-liner']);
          }
          // Count tasks
          const taskMatches = content.match(/##\s*Task\s*\d+/gi) || [];
          totalTasks += taskMatches.length;
        } catch {}
      }
    }
  } catch {}

  // Archive ROADMAP.md
  if (fs.existsSync(roadmapPath)) {
    const roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
    fs.writeFileSync(path.join(archiveDir, `${version}-ROADMAP.md`), roadmapContent, 'utf-8');
  }

  // Archive REQUIREMENTS.md
  if (fs.existsSync(reqPath)) {
    const reqContent = fs.readFileSync(reqPath, 'utf-8');
    const archiveHeader = `# Requirements Archive: ${version} ${milestoneName}\n\n**Archived:** ${today}\n**Status:** SHIPPED\n\nFor current requirements, see \`.planning/REQUIREMENTS.md\`.\n\n---\n\n`;
    fs.writeFileSync(path.join(archiveDir, `${version}-REQUIREMENTS.md`), archiveHeader + reqContent, 'utf-8');
  }

  // Archive audit file if exists
  const auditFile = path.join(cwd, '.planning', `${version}-MILESTONE-AUDIT.md`);
  if (fs.existsSync(auditFile)) {
    fs.renameSync(auditFile, path.join(archiveDir, `${version}-MILESTONE-AUDIT.md`));
  }

  // Create/append MILESTONES.md entry
  const accomplishmentsList = accomplishments.map(a => `- ${a}`).join('\n');
  const milestoneEntry = `## ${version} ${milestoneName} (Shipped: ${today})\n\n**Phases completed:** ${phaseCount} phases, ${totalPlans} plans, ${totalTasks} tasks\n\n**Key accomplishments:**\n${accomplishmentsList || '- (none recorded)'}\n\n---\n\n`;

  if (fs.existsSync(milestonesPath)) {
    const existing = fs.readFileSync(milestonesPath, 'utf-8');
    fs.writeFileSync(milestonesPath, existing + '\n' + milestoneEntry, 'utf-8');
  } else {
    fs.writeFileSync(milestonesPath, `# Milestones\n\n${milestoneEntry}`, 'utf-8');
  }

  // Update STATE.md
  if (fs.existsSync(statePath)) {
    let stateContent = fs.readFileSync(statePath, 'utf-8');
    stateContent = stateContent.replace(
      /(\*\*Status:\*\*\s*).*/,
      `$1${version} milestone complete`
    );
    stateContent = stateContent.replace(
      /(\*\*Last Activity:\*\*\s*).*/,
      `$1${today}`
    );
    stateContent = stateContent.replace(
      /(\*\*Last Activity Description:\*\*\s*).*/,
      `$1${version} milestone completed and archived`
    );
    fs.writeFileSync(statePath, stateContent, 'utf-8');
  }

  const result = {
    version,
    name: milestoneName,
    date: today,
    phases: phaseCount,
    plans: totalPlans,
    tasks: totalTasks,
    accomplishments,
    archived: {
      roadmap: fs.existsSync(path.join(archiveDir, `${version}-ROADMAP.md`)),
      requirements: fs.existsSync(path.join(archiveDir, `${version}-REQUIREMENTS.md`)),
      audit: fs.existsSync(path.join(archiveDir, `${version}-MILESTONE-AUDIT.md`)),
    },
    milestones_updated: true,
    state_updated: fs.existsSync(statePath),
  };

  output(result, raw);
}

// ─── Validate Consistency ─────────────────────────────────────────────────────

function cmdValidateConsistency(cwd, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const errors = [];
  const warnings = [];

  // Check for ROADMAP
  if (!fs.existsSync(roadmapPath)) {
    errors.push('ROADMAP.md not found');
    output({ passed: false, errors, warnings }, raw, 'failed');
    return;
  }

  const roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');

  // Extract phases from ROADMAP
  const roadmapPhases = new Set();
  const phasePattern = /###\s*Phase\s+(\d+(?:\.\d+)?)\s*:/gi;
  let m;
  while ((m = phasePattern.exec(roadmapContent)) !== null) {
    roadmapPhases.add(m[1]);
  }

  // Get phases on disk
  const diskPhases = new Set();
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    for (const dir of dirs) {
      const dm = dir.match(/^(\d+(?:\.\d+)?)/);
      if (dm) diskPhases.add(dm[1]);
    }
  } catch {}

  // Check: phases in ROADMAP but not on disk
  for (const p of roadmapPhases) {
    if (!diskPhases.has(p) && !diskPhases.has(normalizePhaseName(p))) {
      warnings.push(`Phase ${p} in ROADMAP.md but no directory on disk`);
    }
  }

  // Check: phases on disk but not in ROADMAP
  for (const p of diskPhases) {
    const unpadded = String(parseInt(p, 10));
    if (!roadmapPhases.has(p) && !roadmapPhases.has(unpadded)) {
      warnings.push(`Phase ${p} exists on disk but not in ROADMAP.md`);
    }
  }

  // Check: sequential phase numbers (integers only)
  const integerPhases = [...diskPhases]
    .filter(p => !p.includes('.'))
    .map(p => parseInt(p, 10))
    .sort((a, b) => a - b);

  for (let i = 1; i < integerPhases.length; i++) {
    if (integerPhases[i] !== integerPhases[i - 1] + 1) {
      warnings.push(`Gap in phase numbering: ${integerPhases[i - 1]} → ${integerPhases[i]}`);
    }
  }

  // Check: plan numbering within phases
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    for (const dir of dirs) {
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md')).sort();

      // Extract plan numbers
      const planNums = plans.map(p => {
        const pm = p.match(/-(\d{2})-PLAN\.md$/);
        return pm ? parseInt(pm[1], 10) : null;
      }).filter(n => n !== null);

      for (let i = 1; i < planNums.length; i++) {
        if (planNums[i] !== planNums[i - 1] + 1) {
          warnings.push(`Gap in plan numbering in ${dir}: plan ${planNums[i - 1]} → ${planNums[i]}`);
        }
      }

      // Check: plans without summaries (completed plans)
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md'));
      const planIds = new Set(plans.map(p => p.replace('-PLAN.md', '')));
      const summaryIds = new Set(summaries.map(s => s.replace('-SUMMARY.md', '')));

      // Summary without matching plan is suspicious
      for (const sid of summaryIds) {
        if (!planIds.has(sid)) {
          warnings.push(`Summary ${sid}-SUMMARY.md in ${dir} has no matching PLAN.md`);
        }
      }
    }
  } catch {}

  // Check: frontmatter in plans has required fields
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    for (const dir of dirs) {
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md'));

      for (const plan of plans) {
        const content = fs.readFileSync(path.join(phasesDir, dir, plan), 'utf-8');
        const fm = extractFrontmatter(content);

        if (!fm.wave) {
          warnings.push(`${dir}/${plan}: missing 'wave' in frontmatter`);
        }
      }
    }
  } catch {}

  const passed = errors.length === 0;
  output({ passed, errors, warnings, warning_count: warnings.length }, raw, passed ? 'passed' : 'failed');
}

// ─── Progress Render ──────────────────────────────────────────────────────────

function cmdProgressRender(cwd, format, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const milestone = getMilestoneInfo(cwd);

  const phases = [];
  let totalPlans = 0;
  let totalSummaries = 0;

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => {
      const aNum = parseFloat(a.match(/^(\d+(?:\.\d+)?)/)?.[1] || '0');
      const bNum = parseFloat(b.match(/^(\d+(?:\.\d+)?)/)?.[1] || '0');
      return aNum - bNum;
    });

    for (const dir of dirs) {
      const dm = dir.match(/^(\d+(?:\.\d+)?)-?(.*)/);
      const phaseNum = dm ? dm[1] : dir;
      const phaseName = dm && dm[2] ? dm[2].replace(/-/g, ' ') : '';
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').length;
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').length;

      totalPlans += plans;
      totalSummaries += summaries;

      let status;
      if (plans === 0) status = 'Pending';
      else if (summaries >= plans) status = 'Complete';
      else if (summaries > 0) status = 'In Progress';
      else status = 'Planned';

      phases.push({ number: phaseNum, name: phaseName, plans, summaries, status });
    }
  } catch {}

  const percent = totalPlans > 0 ? Math.round((totalSummaries / totalPlans) * 100) : 0;

  if (format === 'table') {
    // Render markdown table
    const barWidth = 10;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
    let out = `# ${milestone.version} ${milestone.name}\n\n`;
    out += `**Progress:** [${bar}] ${totalSummaries}/${totalPlans} plans (${percent}%)\n\n`;
    out += `| Phase | Name | Plans | Status |\n`;
    out += `|-------|------|-------|--------|\n`;
    for (const p of phases) {
      out += `| ${p.number} | ${p.name} | ${p.summaries}/${p.plans} | ${p.status} |\n`;
    }
    output({ rendered: out }, raw, out);
  } else if (format === 'bar') {
    const barWidth = 20;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
    const text = `[${bar}] ${totalSummaries}/${totalPlans} plans (${percent}%)`;
    output({ bar: text, percent, completed: totalSummaries, total: totalPlans }, raw, text);
  } else {
    // JSON format
    output({
      milestone_version: milestone.version,
      milestone_name: milestone.name,
      phases,
      total_plans: totalPlans,
      total_summaries: totalSummaries,
      percent,
    }, raw);
  }
}

// ─── Todo Complete ────────────────────────────────────────────────────────────

function cmdTodoComplete(cwd, filename, raw) {
  if (!filename) {
    error('filename required for todo complete');
  }

  const pendingDir = path.join(cwd, '.planning', 'todos', 'pending');
  const completedDir = path.join(cwd, '.planning', 'todos', 'completed');
  const sourcePath = path.join(pendingDir, filename);

  if (!fs.existsSync(sourcePath)) {
    error(`Todo not found: ${filename}`);
  }

  // Ensure completed directory exists
  fs.mkdirSync(completedDir, { recursive: true });

  // Read, add completion timestamp, move
  let content = fs.readFileSync(sourcePath, 'utf-8');
  const today = new Date().toISOString().split('T')[0];
  content = `completed: ${today}\n` + content;

  fs.writeFileSync(path.join(completedDir, filename), content, 'utf-8');
  fs.unlinkSync(sourcePath);

  output({ completed: true, file: filename, date: today }, raw, 'completed');
}

// ─── Scaffold ─────────────────────────────────────────────────────────────────

function cmdScaffold(cwd, type, options, raw) {
  const { phase, name } = options;
  const padded = phase ? normalizePhaseName(phase) : '00';
  const today = new Date().toISOString().split('T')[0];

  // Find phase directory
  const phaseInfo = phase ? findPhaseInternal(cwd, phase) : null;
  const phaseDir = phaseInfo ? path.join(cwd, phaseInfo.directory) : null;

  if (phase && !phaseDir && type !== 'phase-dir') {
    error(`Phase ${phase} directory not found`);
  }

  let filePath, content;

  switch (type) {
    case 'context': {
      filePath = path.join(phaseDir, `${padded}-CONTEXT.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — Context\n\n## Decisions\n\n_Decisions will be captured during /hive:discuss-phase ${phase}_\n\n## Discretion Areas\n\n_Areas where the executor can use judgment_\n\n## Deferred Ideas\n\n_Ideas to consider later_\n`;
      break;
    }
    case 'uat': {
      filePath = path.join(phaseDir, `${padded}-UAT.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\nstatus: pending\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — User Acceptance Testing\n\n## Test Results\n\n| # | Test | Status | Notes |\n|---|------|--------|-------|\n\n## Summary\n\n_Pending UAT_\n`;
      break;
    }
    case 'verification': {
      filePath = path.join(phaseDir, `${padded}-VERIFICATION.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\nstatus: pending\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — Verification\n\n## Goal-Backward Verification\n\n**Phase Goal:** [From ROADMAP.md]\n\n## Checks\n\n| # | Requirement | Status | Evidence |\n|---|------------|--------|----------|\n\n## Result\n\n_Pending verification_\n`;
      break;
    }
    case 'phase-dir': {
      if (!phase || !name) {
        error('phase and name required for phase-dir scaffold');
      }
      const slug = generateSlugInternal(name);
      const dirName = `${padded}-${slug}`;
      const phasesParent = path.join(cwd, '.planning', 'phases');
      fs.mkdirSync(phasesParent, { recursive: true });
      const dirPath = path.join(phasesParent, dirName);
      fs.mkdirSync(dirPath, { recursive: true });
      output({ created: true, directory: `.planning/phases/${dirName}`, path: dirPath }, raw, dirPath);
      return;
    }
    default:
      error(`Unknown scaffold type: ${type}. Available: context, uat, verification, phase-dir`);
  }

  if (fs.existsSync(filePath)) {
    output({ created: false, reason: 'already_exists', path: filePath }, raw, 'exists');
    return;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  const relPath = path.relative(cwd, filePath);
  output({ created: true, path: relPath }, raw, relPath);
}

// ─── Compound Commands ────────────────────────────────────────────────────────

function resolveModelInternal(cwd, agentType) {
  const config = loadConfig(cwd);
  const profile = config.model_profile || 'balanced';
  const agentModels = MODEL_PROFILES[agentType];
  if (!agentModels) return 'sonnet';
  return agentModels[profile] || agentModels['balanced'] || 'sonnet';
}

function findPhaseInternal(cwd, phase) {
  if (!phase) return null;

  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(phase);

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    const match = dirs.find(d => d.startsWith(normalized));
    if (!match) return null;

    const dirMatch = match.match(/^(\d+(?:\.\d+)?)-?(.*)/);
    const phaseNumber = dirMatch ? dirMatch[1] : normalized;
    const phaseName = dirMatch && dirMatch[2] ? dirMatch[2] : null;
    const phaseDir = path.join(phasesDir, match);
    const phaseFiles = fs.readdirSync(phaseDir);

    const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').sort();
    const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').sort();
    const hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');
    const hasContext = phaseFiles.some(f => f.endsWith('-CONTEXT.md') || f === 'CONTEXT.md');
    const hasVerification = phaseFiles.some(f => f.endsWith('-VERIFICATION.md') || f === 'VERIFICATION.md');

    // Determine incomplete plans (plans without matching summaries)
    const completedPlanIds = new Set(
      summaries.map(s => s.replace('-SUMMARY.md', '').replace('SUMMARY.md', ''))
    );
    const incompletePlans = plans.filter(p => {
      const planId = p.replace('-PLAN.md', '').replace('PLAN.md', '');
      return !completedPlanIds.has(planId);
    });

    return {
      found: true,
      directory: path.join('.planning', 'phases', match),
      phase_number: phaseNumber,
      phase_name: phaseName,
      phase_slug: phaseName ? phaseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : null,
      plans,
      summaries,
      incomplete_plans: incompletePlans,
      has_research: hasResearch,
      has_context: hasContext,
      has_verification: hasVerification,
    };
  } catch {
    return null;
  }
}

function pathExistsInternal(cwd, targetPath) {
  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);
  try {
    fs.statSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

function generateSlugInternal(text) {
  if (!text) return null;
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function getMilestoneInfo(cwd) {
  try {
    const roadmap = fs.readFileSync(path.join(cwd, '.planning', 'ROADMAP.md'), 'utf-8');
    const versionMatch = roadmap.match(/v(\d+\.\d+)/);
    const nameMatch = roadmap.match(/## .*v\d+\.\d+[:\s]+([^\n(]+)/);
    return {
      version: versionMatch ? versionMatch[0] : 'v1.0',
      name: nameMatch ? nameMatch[1].trim() : 'milestone',
    };
  } catch {
    return { version: 'v1.0', name: 'milestone' };
  }
}

function cmdInitExecutePhase(cwd, phase, includes, raw) {
  if (!phase) {
    error('phase required for init execute-phase');
  }

  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);
  const milestone = getMilestoneInfo(cwd);

  const result = {
    // Models
    executor_model: resolveModelInternal(cwd, 'hive-executor'),
    verifier_model: resolveModelInternal(cwd, 'hive-verifier'),

    // Config flags
    commit_docs: config.commit_docs,
    parallelization: config.parallelization,
    branching_strategy: config.branching_strategy,
    phase_branch_template: config.phase_branch_template,
    milestone_branch_template: config.milestone_branch_template,
    verifier_enabled: config.verifier,

    // Git flow config (Phase 9)
    git_flow: config.git_flow,
    git_dev_branch: config.git_dev_branch,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || null,

    // Plan inventory
    plans: phaseInfo?.plans || [],
    summaries: phaseInfo?.summaries || [],
    incomplete_plans: phaseInfo?.incomplete_plans || [],
    plan_count: phaseInfo?.plans?.length || 0,
    incomplete_count: phaseInfo?.incomplete_plans?.length || 0,

    // Branch name (pre-computed)
    branch_name: config.branching_strategy === 'phase' && phaseInfo
      ? config.phase_branch_template
          .replace('{phase}', phaseInfo.phase_number)
          .replace('{slug}', phaseInfo.phase_slug || 'phase')
      : config.branching_strategy === 'milestone'
        ? config.milestone_branch_template
            .replace('{milestone}', milestone.version)
            .replace('{slug}', generateSlugInternal(milestone.name) || 'milestone')
        : null,

    // Milestone info
    milestone_version: milestone.version,
    milestone_name: milestone.name,
    milestone_slug: generateSlugInternal(milestone.name),

    // File existence
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    config_exists: pathExistsInternal(cwd, '.planning/config.json'),
  };

  // Include file contents if requested via --include
  if (includes.has('state')) {
    result.state_content = safeReadFile(path.join(cwd, '.planning', 'STATE.md'));
  }
  if (includes.has('config')) {
    result.config_content = safeReadFile(path.join(cwd, '.planning', 'config.json'));
  }
  if (includes.has('roadmap')) {
    result.roadmap_content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  }

  result.recall_context = getRecallContext(cwd);
  output(result, raw);
}

function cmdInitPlanPhase(cwd, phase, includes, raw) {
  if (!phase) {
    error('phase required for init plan-phase');
  }

  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);

  const result = {
    // Models
    researcher_model: resolveModelInternal(cwd, 'hive-phase-researcher'),
    planner_model: resolveModelInternal(cwd, 'hive-planner'),
    checker_model: resolveModelInternal(cwd, 'hive-plan-checker'),

    // Workflow flags
    research_enabled: config.research,
    plan_checker_enabled: config.plan_checker,
    commit_docs: config.commit_docs,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || null,
    padded_phase: phaseInfo?.phase_number?.padStart(2, '0') || null,

    // Existing artifacts
    has_research: phaseInfo?.has_research || false,
    has_context: phaseInfo?.has_context || false,
    has_plans: (phaseInfo?.plans?.length || 0) > 0,
    plan_count: phaseInfo?.plans?.length || 0,

    // Environment
    planning_exists: pathExistsInternal(cwd, '.planning'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
  };

  // Include file contents if requested via --include
  if (includes.has('state')) {
    result.state_content = safeReadFile(path.join(cwd, '.planning', 'STATE.md'));
  }
  if (includes.has('roadmap')) {
    result.roadmap_content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  }
  if (includes.has('requirements')) {
    result.requirements_content = safeReadFile(path.join(cwd, '.planning', 'REQUIREMENTS.md'));
  }
  if (includes.has('context') && phaseInfo?.directory) {
    // Find *-CONTEXT.md in phase directory
    const phaseDirFull = path.join(cwd, phaseInfo.directory);
    try {
      const files = fs.readdirSync(phaseDirFull);
      const contextFile = files.find(f => f.endsWith('-CONTEXT.md') || f === 'CONTEXT.md');
      if (contextFile) {
        result.context_content = safeReadFile(path.join(phaseDirFull, contextFile));
      }
    } catch {}
  }
  if (includes.has('research') && phaseInfo?.directory) {
    // Find *-RESEARCH.md in phase directory
    const phaseDirFull = path.join(cwd, phaseInfo.directory);
    try {
      const files = fs.readdirSync(phaseDirFull);
      const researchFile = files.find(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');
      if (researchFile) {
        result.research_content = safeReadFile(path.join(phaseDirFull, researchFile));
      }
    } catch {}
  }
  if (includes.has('verification') && phaseInfo?.directory) {
    // Find *-VERIFICATION.md in phase directory
    const phaseDirFull = path.join(cwd, phaseInfo.directory);
    try {
      const files = fs.readdirSync(phaseDirFull);
      const verificationFile = files.find(f => f.endsWith('-VERIFICATION.md') || f === 'VERIFICATION.md');
      if (verificationFile) {
        result.verification_content = safeReadFile(path.join(phaseDirFull, verificationFile));
      }
    } catch {}
  }
  if (includes.has('uat') && phaseInfo?.directory) {
    // Find *-UAT.md in phase directory
    const phaseDirFull = path.join(cwd, phaseInfo.directory);
    try {
      const files = fs.readdirSync(phaseDirFull);
      const uatFile = files.find(f => f.endsWith('-UAT.md') || f === 'UAT.md');
      if (uatFile) {
        result.uat_content = safeReadFile(path.join(phaseDirFull, uatFile));
      }
    } catch {}
  }

  result.recall_context = getRecallContext(cwd);
  output(result, raw);
}

function cmdInitNewProject(cwd, raw) {
  const config = loadConfig(cwd);

  // Detect Brave Search API key availability
  const homedir = require('os').homedir();
  const braveKeyFile = path.join(homedir, '.hive', 'brave_api_key');
  const hasBraveSearch = !!(process.env.BRAVE_API_KEY || fs.existsSync(braveKeyFile));

  // Detect existing code
  let hasCode = false;
  let hasPackageFile = false;
  try {
    const files = execSync('find . -maxdepth 3 \\( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.swift" -o -name "*.java" \\) 2>/dev/null | grep -v node_modules | grep -v .git | head -5', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    hasCode = files.trim().length > 0;
  } catch {}

  hasPackageFile = pathExistsInternal(cwd, 'package.json') ||
                   pathExistsInternal(cwd, 'requirements.txt') ||
                   pathExistsInternal(cwd, 'Cargo.toml') ||
                   pathExistsInternal(cwd, 'go.mod') ||
                   pathExistsInternal(cwd, 'Package.swift');

  const result = {
    // Models
    researcher_model: resolveModelInternal(cwd, 'hive-project-researcher'),
    synthesizer_model: resolveModelInternal(cwd, 'hive-research-synthesizer'),
    roadmapper_model: resolveModelInternal(cwd, 'hive-roadmapper'),

    // Config
    commit_docs: config.commit_docs,

    // Existing state
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    has_codebase_map: pathExistsInternal(cwd, '.planning/codebase'),
    planning_exists: pathExistsInternal(cwd, '.planning'),

    // Brownfield detection
    has_existing_code: hasCode,
    has_package_file: hasPackageFile,
    is_brownfield: hasCode || hasPackageFile,
    needs_codebase_map: (hasCode || hasPackageFile) && !pathExistsInternal(cwd, '.planning/codebase'),

    // Git state
    has_git: pathExistsInternal(cwd, '.git'),

    // Git flow config (Phase 9)
    git_flow: config.git_flow,
    git_dev_branch: config.git_dev_branch,

    // Enhanced search
    brave_search_available: hasBraveSearch,
  };

  result.recall_context = getRecallContext(cwd);
  output(result, raw);
}

function cmdInitNewMilestone(cwd, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  const result = {
    // Models
    researcher_model: resolveModelInternal(cwd, 'hive-project-researcher'),
    synthesizer_model: resolveModelInternal(cwd, 'hive-research-synthesizer'),
    roadmapper_model: resolveModelInternal(cwd, 'hive-roadmapper'),

    // Config
    commit_docs: config.commit_docs,
    research_enabled: config.research,

    // Current milestone
    current_milestone: milestone.version,
    current_milestone_name: milestone.name,

    // Git flow config (Phase 9)
    git_flow: config.git_flow,
    git_dev_branch: config.git_dev_branch,

    // File existence
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
  };

  result.recall_context = getRecallContext(cwd);
  output(result, raw);
}

function cmdInitQuick(cwd, description, raw) {
  const config = loadConfig(cwd);
  const now = new Date();
  const slug = description ? generateSlugInternal(description)?.substring(0, 40) : null;

  // Find next quick task number
  const quickDir = path.join(cwd, '.planning', 'quick');
  let nextNum = 1;
  try {
    const existing = fs.readdirSync(quickDir)
      .filter(f => /^\d+-/.test(f))
      .map(f => parseInt(f.split('-')[0], 10))
      .filter(n => !isNaN(n));
    if (existing.length > 0) {
      nextNum = Math.max(...existing) + 1;
    }
  } catch {}

  const result = {
    // Models
    planner_model: resolveModelInternal(cwd, 'hive-planner'),
    executor_model: resolveModelInternal(cwd, 'hive-executor'),

    // Config
    commit_docs: config.commit_docs,

    // Quick task info
    next_num: nextNum,
    slug: slug,
    description: description || null,

    // Timestamps
    date: now.toISOString().split('T')[0],
    timestamp: now.toISOString(),

    // Paths
    quick_dir: '.planning/quick',
    task_dir: slug ? `.planning/quick/${nextNum}-${slug}` : null,

    // File existence
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    planning_exists: pathExistsInternal(cwd, '.planning'),
  };

  result.recall_context = getRecallContext(cwd);
  output(result, raw);
}

function cmdInitResume(cwd, raw) {
  const config = loadConfig(cwd);

  // Check for interrupted agent
  let interruptedAgentId = null;
  try {
    interruptedAgentId = fs.readFileSync(path.join(cwd, '.planning', 'current-agent-id.txt'), 'utf-8').trim();
  } catch {}

  const result = {
    // File existence
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    planning_exists: pathExistsInternal(cwd, '.planning'),

    // Agent state
    has_interrupted_agent: !!interruptedAgentId,
    interrupted_agent_id: interruptedAgentId,

    // Config
    commit_docs: config.commit_docs,
  };

  output(result, raw);
}

function cmdInitVerifyWork(cwd, phase, raw) {
  if (!phase) {
    error('phase required for init verify-work');
  }

  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);

  const result = {
    // Models
    planner_model: resolveModelInternal(cwd, 'hive-planner'),
    checker_model: resolveModelInternal(cwd, 'hive-plan-checker'),

    // Config
    commit_docs: config.commit_docs,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,

    // Existing artifacts
    has_verification: phaseInfo?.has_verification || false,
  };

  result.recall_context = getRecallContext(cwd);
  output(result, raw);
}

function cmdInitPhaseOp(cwd, phase, raw) {
  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);

  const result = {
    // Config
    commit_docs: config.commit_docs,
    brave_search: config.brave_search,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || null,
    padded_phase: phaseInfo?.phase_number?.padStart(2, '0') || null,

    // Existing artifacts
    has_research: phaseInfo?.has_research || false,
    has_context: phaseInfo?.has_context || false,
    has_plans: (phaseInfo?.plans?.length || 0) > 0,
    has_verification: phaseInfo?.has_verification || false,
    plan_count: phaseInfo?.plans?.length || 0,

    // File existence
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    planning_exists: pathExistsInternal(cwd, '.planning'),
  };

  result.recall_context = getRecallContext(cwd);
  output(result, raw);
}

function cmdInitTodos(cwd, area, raw) {
  const config = loadConfig(cwd);
  const now = new Date();

  // List todos (reuse existing logic)
  const pendingDir = path.join(cwd, '.planning', 'todos', 'pending');
  let count = 0;
  const todos = [];

  try {
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
        const createdMatch = content.match(/^created:\s*(.+)$/m);
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        const areaMatch = content.match(/^area:\s*(.+)$/m);
        const todoArea = areaMatch ? areaMatch[1].trim() : 'general';

        if (area && todoArea !== area) continue;

        count++;
        todos.push({
          file,
          created: createdMatch ? createdMatch[1].trim() : 'unknown',
          title: titleMatch ? titleMatch[1].trim() : 'Untitled',
          area: todoArea,
          path: path.join('.planning', 'todos', 'pending', file),
        });
      } catch {}
    }
  } catch {}

  const result = {
    // Config
    commit_docs: config.commit_docs,

    // Timestamps
    date: now.toISOString().split('T')[0],
    timestamp: now.toISOString(),

    // Todo inventory
    todo_count: count,
    todos,
    area_filter: area || null,

    // Paths
    pending_dir: '.planning/todos/pending',
    completed_dir: '.planning/todos/completed',

    // File existence
    planning_exists: pathExistsInternal(cwd, '.planning'),
    todos_dir_exists: pathExistsInternal(cwd, '.planning/todos'),
    pending_dir_exists: pathExistsInternal(cwd, '.planning/todos/pending'),
  };

  output(result, raw);
}

function cmdInitMilestoneOp(cwd, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  // Count phases
  let phaseCount = 0;
  let completedPhases = 0;
  const phasesDir = path.join(cwd, '.planning', 'phases');
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    phaseCount = dirs.length;

    // Count phases with summaries (completed)
    for (const dir of dirs) {
      try {
        const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
        const hasSummary = phaseFiles.some(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
        if (hasSummary) completedPhases++;
      } catch {}
    }
  } catch {}

  // Check archive
  const archiveDir = path.join(cwd, '.planning', 'archive');
  let archivedMilestones = [];
  try {
    archivedMilestones = fs.readdirSync(archiveDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {}

  const result = {
    // Config
    commit_docs: config.commit_docs,

    // Current milestone
    milestone_version: milestone.version,
    milestone_name: milestone.name,
    milestone_slug: generateSlugInternal(milestone.name),

    // Phase counts
    phase_count: phaseCount,
    completed_phases: completedPhases,
    all_phases_complete: phaseCount > 0 && phaseCount === completedPhases,

    // Archive
    archived_milestones: archivedMilestones,
    archive_count: archivedMilestones.length,

    // File existence
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
    archive_exists: pathExistsInternal(cwd, '.planning/archive'),
    phases_dir_exists: pathExistsInternal(cwd, '.planning/phases'),
  };

  output(result, raw);
}

function cmdInitMapCodebase(cwd, raw) {
  const config = loadConfig(cwd);

  // Check for existing codebase maps
  const codebaseDir = path.join(cwd, '.planning', 'codebase');
  let existingMaps = [];
  try {
    existingMaps = fs.readdirSync(codebaseDir).filter(f => f.endsWith('.md'));
  } catch {}

  const result = {
    // Models
    mapper_model: resolveModelInternal(cwd, 'hive-codebase-mapper'),

    // Config
    commit_docs: config.commit_docs,
    search_gitignored: config.search_gitignored,
    parallelization: config.parallelization,

    // Paths
    codebase_dir: '.planning/codebase',

    // Existing maps
    existing_maps: existingMaps,
    has_maps: existingMaps.length > 0,

    // File existence
    planning_exists: pathExistsInternal(cwd, '.planning'),
    codebase_dir_exists: pathExistsInternal(cwd, '.planning/codebase'),
  };

  result.recall_context = getRecallContext(cwd);
  output(result, raw);
}

function cmdInitProgress(cwd, includes, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  // Analyze phases
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const phases = [];
  let currentPhase = null;
  let nextPhase = null;

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    for (const dir of dirs) {
      const match = dir.match(/^(\d+(?:\.\d+)?)-?(.*)/);
      const phaseNumber = match ? match[1] : dir;
      const phaseName = match && match[2] ? match[2] : null;

      const phasePath = path.join(phasesDir, dir);
      const phaseFiles = fs.readdirSync(phasePath);

      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md');
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
      const hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');

      const status = summaries.length >= plans.length && plans.length > 0 ? 'complete' :
                     plans.length > 0 ? 'in_progress' :
                     hasResearch ? 'researched' : 'pending';

      const phaseInfo = {
        number: phaseNumber,
        name: phaseName,
        directory: path.join('.planning', 'phases', dir),
        status,
        plan_count: plans.length,
        summary_count: summaries.length,
        has_research: hasResearch,
      };

      phases.push(phaseInfo);

      // Find current (first incomplete with plans) and next (first pending)
      if (!currentPhase && (status === 'in_progress' || status === 'researched')) {
        currentPhase = phaseInfo;
      }
      if (!nextPhase && status === 'pending') {
        nextPhase = phaseInfo;
      }
    }
  } catch {}

  // Check for paused work
  let pausedAt = null;
  try {
    const state = fs.readFileSync(path.join(cwd, '.planning', 'STATE.md'), 'utf-8');
    const pauseMatch = state.match(/\*\*Paused At:\*\*\s*(.+)/);
    if (pauseMatch) pausedAt = pauseMatch[1].trim();
  } catch {}

  const result = {
    // Models
    executor_model: resolveModelInternal(cwd, 'hive-executor'),
    planner_model: resolveModelInternal(cwd, 'hive-planner'),

    // Config
    commit_docs: config.commit_docs,

    // Milestone
    milestone_version: milestone.version,
    milestone_name: milestone.name,

    // Phase overview
    phases,
    phase_count: phases.length,
    completed_count: phases.filter(p => p.status === 'complete').length,
    in_progress_count: phases.filter(p => p.status === 'in_progress').length,

    // Current state
    current_phase: currentPhase,
    next_phase: nextPhase,
    paused_at: pausedAt,
    has_work_in_progress: !!currentPhase,

    // File existence
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
  };

  // Include file contents if requested via --include
  if (includes.has('state')) {
    result.state_content = safeReadFile(path.join(cwd, '.planning', 'STATE.md'));
  }
  if (includes.has('roadmap')) {
    result.roadmap_content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  }
  if (includes.has('project')) {
    result.project_content = safeReadFile(path.join(cwd, '.planning', 'PROJECT.md'));
  }
  if (includes.has('config')) {
    result.config_content = safeReadFile(path.join(cwd, '.planning', 'config.json'));
  }

  output(result, raw);
}

// ─── Telemetry Commands ──────────────────────────────────────────────────────

function cmdTelemetryQuery(cwd, options, raw) {
  const eventsFile = path.join(cwd, '.planning', 'telemetry', 'events.jsonl');
  const content = safeReadFile(eventsFile);
  if (!content || !content.trim()) {
    output({ events: [], total: 0 }, raw, 'No events');
    return;
  }

  let events = content.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  if (options.type) {
    events = events.filter(e => e.type === options.type);
  }

  if (options.since) {
    const sinceDate = parseSinceDuration(options.since);
    if (!sinceDate) {
      error('Invalid --since value: ' + options.since + '. Use: 7d, 24h, 30m, or ISO date');
    }
    events = events.filter(e => new Date(e.ts) >= sinceDate);
  }

  const limit = options.limit || 50;
  events = events.slice(-limit);

  output({ events, total: events.length }, raw, events.map(e => JSON.stringify(e)).join('\n'));
}

function cmdTelemetryStats(cwd, raw) {
  const telemetryDir = path.join(cwd, '.planning', 'telemetry');
  const eventsFile = path.join(telemetryDir, 'events.jsonl');

  let fileSize = 0;
  try {
    fileSize = fs.statSync(eventsFile).size;
  } catch {
    // file doesn't exist
  }

  let archiveCount = 0;
  try {
    archiveCount = fs.readdirSync(telemetryDir)
      .filter(f => f.startsWith('events-') && f.endsWith('.jsonl')).length;
  } catch {
    // dir doesn't exist
  }

  const content = safeReadFile(eventsFile);
  const typeCounts = {};
  let totalEvents = 0;
  if (content && content.trim()) {
    content.split('\n').filter(Boolean).forEach(line => {
      try {
        const evt = JSON.parse(line);
        typeCounts[evt.type] = (typeCounts[evt.type] || 0) + 1;
        totalEvents++;
      } catch {
        // skip malformed lines
      }
    });
  }

  output({
    total_events: totalEvents,
    file_size_bytes: fileSize,
    file_size_kb: Math.round(fileSize / 1024 * 10) / 10,
    archive_count: archiveCount,
    types: typeCounts,
  }, raw, `Events: ${totalEvents} | Size: ${Math.round(fileSize / 1024)}KB | Archives: ${archiveCount}`);
}

function cmdTelemetryRotate(cwd, force, raw) {
  const config = getTelemetryConfig(cwd);
  const telemetryDir = path.join(cwd, '.planning', 'telemetry');
  const eventsFile = path.join(telemetryDir, 'events.jsonl');

  let size = 0;
  try {
    size = fs.statSync(eventsFile).size;
  } catch {
    output({ rotated: false, reason: 'no events file' }, raw, 'nothing to rotate');
    return;
  }

  if (size === 0) {
    output({ rotated: false, reason: 'events file empty' }, raw, 'nothing to rotate');
    return;
  }

  const thresholdBytes = config.rotation_threshold_kb * 1024;
  if (!force && size < thresholdBytes) {
    output({
      rotated: false,
      reason: 'under threshold',
      size_kb: Math.round(size / 1024 * 10) / 10,
      threshold_kb: config.rotation_threshold_kb,
    }, raw, 'under threshold');
    return;
  }

  // Force rotation or over threshold: archive the file
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
  const archiveName = 'events-' + ts + '.jsonl';
  fs.renameSync(eventsFile, path.join(telemetryDir, archiveName));

  // Prune old archives
  const maxArchives = config.max_archives || 10;
  const archives = fs.readdirSync(telemetryDir)
    .filter(f => f.startsWith('events-') && f.endsWith('.jsonl'))
    .sort();
  while (archives.length > maxArchives) {
    const oldest = archives.shift();
    fs.unlinkSync(path.join(telemetryDir, oldest));
  }

  output({ rotated: true, archived_size_kb: Math.round(size / 1024 * 10) / 10 }, raw, 'rotated');
}

function cmdTelemetryDigest(cwd, raw) {
  const telemetryDir = path.join(cwd, '.planning', 'telemetry');
  const eventsFile = path.join(telemetryDir, 'events.jsonl');
  const insightsPath = path.join(telemetryDir, 'INSIGHTS.md');
  const content = safeReadFile(eventsFile);

  // Ensure telemetry dir exists for writing INSIGHTS.md
  fs.mkdirSync(telemetryDir, { recursive: true });

  if (!content || !content.trim()) {
    const stub = [
      '# Telemetry Insights',
      '',
      '*Generated: ' + new Date().toISOString() + '*',
      '*Digest version: 2*',
      '',
      'No events recorded yet.',
      '',
      '## Top Patterns',
      '',
      '<!-- recall-start -->',
      '- No actionable patterns detected yet.',
      '<!-- recall-end -->',
      '',
      '---',
      '*Recall digest v2 — generated by hive-tools.js telemetry digest*',
    ].join('\n');
    fs.writeFileSync(insightsPath, stub);
    output({ generated: true, path: insightsPath, total_events: 0 }, raw, insightsPath);
    return;
  }

  // Parse all events
  const events = content.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  const totalEvents = events.length;

  // Aggregate by type
  const typeCounts = {};
  events.forEach(e => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  });

  // Time range
  const timestamps = events.map(e => e.ts).filter(Boolean).sort();
  const earliest = timestamps[0] || 'unknown';
  const latest = timestamps[timestamps.length - 1] || 'unknown';

  // Agent performance (from agent_completion events)
  const agentStats = {};
  events.filter(e => e.type === 'agent_completion' && e.data && e.data.agent).forEach(e => {
    const agent = e.data.agent;
    if (!agentStats[agent]) agentStats[agent] = { completions: 0, totalDuration: 0, hasDuration: false };
    agentStats[agent].completions++;
    if (typeof e.data.duration_ms === 'number') {
      agentStats[agent].totalDuration += e.data.duration_ms;
      agentStats[agent].hasDuration = true;
    }
  });

  // Recent deviations (last 5)
  const deviations = events.filter(e => e.type === 'deviation').slice(-5);

  // Tool errors (by tool name)
  const toolErrors = {};
  events.filter(e => e.type === 'tool_error').forEach(e => {
    const tool = (e.data && e.data.tool) || 'unknown';
    toolErrors[tool] = (toolErrors[tool] || 0) + 1;
  });

  // ─── Pattern Detection (Phase 4 Enhancement) ──────────────────────────────

  // Recurring deviation types
  const deviationTypes = {};
  events.filter(e => e.type === 'deviation' && e.data).forEach(e => {
    const dtype = e.data.deviation_type || e.data.description || 'unknown';
    if (!deviationTypes[dtype]) deviationTypes[dtype] = { count: 0, phases: new Set() };
    deviationTypes[dtype].count++;
    if (e.data.phase) deviationTypes[dtype].phases.add(e.data.phase);
  });

  // Tool error frequency (by tool:error_type combination)
  const toolErrorFreq = {};
  events.filter(e => e.type === 'tool_error' && e.data).forEach(e => {
    const key = (e.data.tool || 'unknown') + ':' + (e.data.error_type || 'error');
    toolErrorFreq[key] = (toolErrorFreq[key] || 0) + 1;
  });

  // Verification gap levels
  const verificationGaps = {};
  events.filter(e => e.type === 'verification_gap' && e.data).forEach(e => {
    const level = e.data.level || 'unknown';
    verificationGaps[level] = (verificationGaps[level] || 0) + 1;
  });

  // Checkpoint outcomes
  const checkpointOutcomes = {};
  events.filter(e => e.type === 'checkpoint' && e.data).forEach(e => {
    const outcome = e.data.outcome || 'unknown';
    checkpointOutcomes[outcome] = (checkpointOutcomes[outcome] || 0) + 1;
  });

  // Session analysis patterns (from session_summary events)
  const sessionPatterns = {};
  const sessionRecs = {};
  events.filter(e => e.type === 'session_summary' && e.data).forEach(e => {
    const patterns = e.data.patterns || [];
    patterns.forEach(p => { sessionPatterns[p] = (sessionPatterns[p] || 0) + 1; });
    const recs = e.data.recommendations || [];
    recs.forEach(r => { sessionRecs[r] = (sessionRecs[r] || 0) + 1; });
  });

  // Deviation trend analysis (first half vs second half)
  const deviationEvents = events.filter(e => e.type === 'deviation');
  const mid = Math.floor(deviationEvents.length / 2);
  const firstHalf = deviationEvents.slice(0, mid).length;
  const secondHalf = deviationEvents.slice(mid).length;
  const trend = deviationEvents.length < 2 ? 'stable'
    : secondHalf < firstHalf ? 'decreasing'
    : secondHalf > firstHalf ? 'increasing'
    : 'stable';

  // Build recommendations
  const recommendations = [];
  Object.entries(deviationTypes).forEach(([dtype, info]) => {
    if (info.count >= 3) {
      recommendations.push('Auto-check recommended for deviation type "' + dtype + '" (' + info.count + ' occurrences across phases ' + Array.from(info.phases).join(', ') + ')');
    }
  });
  Object.entries(toolErrorFreq).forEach(([key, count]) => {
    if (count >= 3) {
      recommendations.push('Guard recommended for ' + key + ' (' + count + ' occurrences)');
    }
  });
  if (trend === 'increasing') {
    recommendations.push('Warning: deviation trend is increasing — quality may be regressing');
  } else if (trend === 'decreasing') {
    recommendations.push('Positive: deviation trend is decreasing — quality is improving');
  }
  Object.entries(sessionRecs).forEach(([rec, count]) => {
    if (count >= 2) {
      recommendations.push('Session analysis: "' + rec + '" (' + count + ' sessions)');
    }
  });

  // Build Top Patterns (max 5 lines, for recall extraction)
  const topPatterns = [];

  // Add top 3 recurring issues by frequency (from deviations and tool errors combined)
  const allPatternItems = [];
  Object.entries(deviationTypes).forEach(([dtype, info]) => {
    allPatternItems.push({ type: 'PATTERN', label: 'Deviation "' + dtype + '" recurs ' + info.count + ' times across phases ' + Array.from(info.phases).join(', '), freq: info.count });
  });
  Object.entries(toolErrorFreq).forEach(([key, count]) => {
    allPatternItems.push({ type: 'PATTERN', label: 'Tool error ' + key + ' occurs ' + count + ' times', freq: count });
  });
  Object.entries(sessionPatterns).forEach(([pattern, count]) => {
    allPatternItems.push({ type: 'SESSION', label: pattern + ' (seen in ' + count + ' sessions)', freq: count });
  });
  allPatternItems.sort((a, b) => b.freq - a.freq);
  allPatternItems.slice(0, 3).forEach(item => {
    topPatterns.push('- ' + item.type + ': ' + item.label);
  });

  // Add trend line
  if (deviationEvents.length >= 2) {
    topPatterns.push('- TREND: Deviations ' + trend + ' (first half: ' + firstHalf + ', second half: ' + secondHalf + ')');
  }

  // Add top 2 recommendations
  recommendations.slice(0, 2).forEach(rec => {
    topPatterns.push('- REC: ' + rec);
  });

  // Cap at 5 total lines
  while (topPatterns.length > 5) topPatterns.pop();

  // If no meaningful patterns, use placeholder
  if (topPatterns.length === 0) {
    topPatterns.push('- No actionable patterns detected yet.');
  }

  // ─── Build Markdown ────────────────────────────────────────────────────────

  const lines = [];
  lines.push('# Telemetry Insights');
  lines.push('');
  lines.push('*Generated: ' + new Date().toISOString() + '*');
  lines.push('*Digest version: 2*');
  lines.push('*Period: ' + earliest + ' to ' + latest + '*');
  lines.push('*Total events: ' + totalEvents + '*');
  lines.push('');

  // Event Summary table
  lines.push('## Event Summary');
  lines.push('');
  lines.push('| Type | Count | % |');
  lines.push('|------|-------|---|');
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  sortedTypes.forEach(([type, count]) => {
    const pct = Math.round(count / totalEvents * 100);
    lines.push('| ' + type + ' | ' + count + ' | ' + pct + '% |');
  });
  lines.push('');

  // Agent Performance table
  lines.push('## Agent Performance');
  lines.push('');
  const agentEntries = Object.entries(agentStats);
  if (agentEntries.length === 0) {
    lines.push('None recorded');
  } else {
    lines.push('| Agent | Completions | Avg Duration |');
    lines.push('|-------|-------------|--------------|');
    agentEntries.forEach(([agent, stats]) => {
      const avgDuration = stats.hasDuration
        ? Math.round(stats.totalDuration / stats.completions) + 'ms'
        : 'N/A';
      lines.push('| ' + agent + ' | ' + stats.completions + ' | ' + avgDuration + ' |');
    });
  }
  lines.push('');

  // Recent Deviations
  lines.push('## Recent Deviations');
  lines.push('');
  if (deviations.length === 0) {
    lines.push('None recorded');
  } else {
    deviations.forEach(e => {
      const severity = (e.data && e.data.severity) || 'unknown';
      const resolution = (e.data && e.data.resolution) || 'unknown';
      const phase = (e.data && e.data.phase) || 'unknown';
      lines.push('- ' + e.ts + ': ' + severity + ' - ' + resolution + ' (phase: ' + phase + ')');
    });
  }
  lines.push('');

  // Tool Errors
  lines.push('## Tool Errors');
  lines.push('');
  const errorEntries = Object.entries(toolErrors);
  if (errorEntries.length === 0) {
    lines.push('None recorded');
  } else {
    lines.push('| Tool | Errors |');
    lines.push('|------|--------|');
    errorEntries.sort((a, b) => b[1] - a[1]).forEach(([tool, count]) => {
      lines.push('| ' + tool + ' | ' + count + ' |');
    });
  }
  lines.push('');

  // Session Analysis (from session_summary events)
  const sessionSummaries = events.filter(e => e.type === 'session_summary' && e.data);
  if (sessionSummaries.length > 0) {
    lines.push('## Session Analysis');
    lines.push('');
    lines.push('*Sessions analyzed: ' + sessionSummaries.length + '*');
    const avgQuality = Math.round(sessionSummaries.reduce((sum, e) => sum + (e.data.quality_score || 0), 0) / sessionSummaries.length);
    lines.push('*Average quality score: ' + avgQuality + '/100*');
    lines.push('');
    if (Object.keys(sessionPatterns).length > 0) {
      lines.push('**Recurring patterns:**');
      Object.entries(sessionPatterns).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([p, count]) => {
        lines.push('- ' + p + ' (' + count + ' sessions)');
      });
      lines.push('');
    }
  }

  // Recommendations (new in v2)
  if (recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    recommendations.forEach(rec => {
      lines.push('- ' + rec);
    });
    lines.push('');
  }

  // Top Patterns with recall markers (new in v2)
  lines.push('## Top Patterns');
  lines.push('');
  lines.push('<!-- recall-start -->');
  topPatterns.forEach(p => lines.push(p));
  lines.push('<!-- recall-end -->');
  lines.push('');

  lines.push('---');
  lines.push('*Recall digest v2 — generated by hive-tools.js telemetry digest*');

  fs.writeFileSync(insightsPath, lines.join('\n'));
  output({ generated: true, path: insightsPath, total_events: totalEvents }, raw, insightsPath);
}

function cmdTelemetryEmit(cwd, type, dataStr, raw) {
  if (!type) {
    error('Event type required. Valid types: ' + VALID_EVENT_TYPES.join(', '));
  }
  if (!VALID_EVENT_TYPES.includes(type)) {
    error('Invalid event type: ' + type + '. Valid types: ' + VALID_EVENT_TYPES.join(', '));
  }

  const telConfig = getTelemetryConfig(cwd);
  if (!telConfig.enabled) {
    output({ emitted: false, reason: 'telemetry disabled' }, raw, 'disabled');
    return;
  }

  const WORKFLOW_EVENT_TYPES = [
    'deviation', 'checkpoint', 'verification_gap', 'plan_revision', 'user_correction'
  ];
  if (WORKFLOW_EVENT_TYPES.includes(type) && !telConfig.workflow_events) {
    output({ emitted: false, reason: 'workflow_events disabled' }, raw, 'disabled');
    return;
  }

  let data = {};
  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch (e) {
      error('Invalid JSON in --data: ' + e.message);
    }
  }

  const telemetryDir = ensureTelemetryDir(cwd);
  const event = createEventEnvelope(type, data);
  const eventsFile = path.join(telemetryDir, 'events.jsonl');
  fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');

  rotateIfNeeded(telemetryDir, telConfig);

  output({ emitted: true, type, ts: event.ts }, raw, 'ok');
}

// ─── Git Detection Commands ───────────────────────────────────────────────────

function cmdGitDetect(cwd, raw) {
  const gitResult = execCommand('git', ['--version'], { cwd });
  let gitVersion = null;
  let mergeTreeAvailable = false;
  if (gitResult.success) {
    const vMatch = gitResult.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (vMatch) {
      gitVersion = vMatch[1];
      const parts = gitVersion.split('.').map(Number);
      const major = parts[0];
      const minor = parts[1] || 0;
      mergeTreeAvailable = major > 2 || (major === 2 && minor >= 38);
    }
  }

  const ghResult = execCommand('gh', ['--version'], { cwd });
  let ghVersion = null;
  let ghAvailable = false;
  if (ghResult.success) {
    const ghMatch = ghResult.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (ghMatch) {
      ghVersion = ghMatch[1];
      ghAvailable = true;
    }
  }

  const result = {
    git: { version: gitVersion, merge_tree: mergeTreeAvailable },
    gh: { available: ghAvailable, version: ghVersion },
  };

  output(result, raw, JSON.stringify(result));
}

function cmdGitDetectBuildCmd(cwd, raw) {
  const config = loadConfig(cwd);

  if (config.git_build_command) {
    const result = { detected: true, command: config.git_build_command, source: 'config', override: true };
    output(result, raw, result.command);
    return;
  }

  const detected = detectBuildCommand(cwd);
  if (detected.detected) {
    output(detected, raw, detected.command);
  } else {
    const result = { detected: false, command: null, source: null, message: 'none detected' };
    output(result, raw, '');
  }
}

// ─── Git Subcommands ──────────────────────────────────────────────────────────

function cmdGitCurrentBranch(cwd, raw) {
  const result = execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (result.success) {
    output({ success: true, branch: result.stdout }, raw, result.stdout);
  } else {
    output({ success: false, error: result.stderr }, raw, '');
  }
}

function cmdGitStatus(cwd, raw) {
  const config = loadConfig(cwd);

  // Current branch
  const branchResult = execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  const branch = branchResult.success ? branchResult.stdout.trim() : 'unknown';

  // Ahead/behind (only if tracking branch exists)
  let ahead = 0, behind = 0, hasRemote = false;
  const trackResult = execCommand('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd });
  if (trackResult.success) {
    hasRemote = true;
    const aheadResult = execCommand('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd });
    const behindResult = execCommand('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd });
    ahead = aheadResult.success ? parseInt(aheadResult.stdout.trim(), 10) || 0 : 0;
    behind = behindResult.success ? parseInt(behindResult.stdout.trim(), 10) || 0 : 0;
  }

  // Open PR count (only if gh available)
  let openPRs = 0, ghAvailable = false;
  const ghResult = execCommand('gh', ['pr', 'list', '--state', 'open', '--json', 'number', '--jq', 'length'], { cwd });
  if (ghResult.success) {
    ghAvailable = true;
    openPRs = parseInt(ghResult.stdout.trim(), 10) || 0;
  }

  output({
    success: true,
    branch,
    ahead,
    behind,
    has_remote: hasRemote,
    open_prs: openPRs,
    gh_available: ghAvailable,
    git_flow: config.git_flow,
    dev_branch: config.git_dev_branch
  }, raw, branch);
}

function cmdGitCreateDevBranch(cwd, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const devBranch = config.git_dev_branch || 'dev';
  const check = execCommand('git', ['rev-parse', '--verify', devBranch], { cwd });
  if (check.success) {
    output({ success: true, branch: devBranch, created: false, reason: 'already_exists' }, raw, devBranch);
    return;
  }

  const result = execCommand('git', ['checkout', '-b', devBranch], { cwd });
  if (result.success) {
    output({ success: true, branch: devBranch, created: true }, raw, devBranch);
  } else {
    output({ success: false, error: result.stderr }, raw, '');
  }
}

function cmdGitCreatePlanBranch(cwd, branchName, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  if (!branchName) {
    output({ success: false, error: 'branch name required (--name <branch>)' }, raw, '');
    return;
  }

  const devBranch = config.git_dev_branch || 'dev';
  const devCheck = execCommand('git', ['rev-parse', '--verify', devBranch], { cwd });
  if (!devCheck.success) {
    output({ success: false, error: 'dev branch "' + devBranch + '" does not exist. Run git create-dev-branch first.' }, raw, '');
    return;
  }

  const result = execCommand('git', ['checkout', '-b', branchName, devBranch], { cwd });
  if (result.success) {
    output({ success: true, branch: branchName, base: devBranch, created: true }, raw, branchName);
  } else {
    output({ success: false, error: result.stderr }, raw, '');
  }
}

function cmdGitRunBuildGate(cwd, gate, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  // Gate-specific command selection: pre_main_command for Gate 3, build_command for others
  let buildCmd;
  if (gate === 'pre_main' && config.git_pre_main_command) {
    buildCmd = config.git_pre_main_command;
  } else {
    buildCmd = config.git_build_command || detectBuildCommand(cwd).command;
  }
  if (!buildCmd) {
    if (config.git_require_build) {
      output({ success: false, error: 'require_build is true but no build command detected. Set git.build_command in config.json or add a test script to package.json.', required: true }, raw, 'fail');
      return;
    }
    output({ success: true, skipped: true, reason: 'no build command detected' }, raw, 'skipped');
    return;
  }

  const timeoutMs = (config.git_build_timeout || 300) * 1000;

  // Support array of commands (pipeline) or single string
  const commands = Array.isArray(buildCmd) ? buildCmd : [buildCmd];
  let lastResult = null;

  for (const cmd of commands) {
    const parts = cmd.split(/\s+/);
    lastResult = execCommand(parts[0], parts.slice(1), { cwd, timeout: timeoutMs });
    if (!lastResult.success) {
      output({
        success: false,
        command: cmd,
        pipeline: commands.length > 1 ? commands : undefined,
        failed_at: commands.indexOf(cmd) + 1,
        exitCode: lastResult.exitCode,
        timedOut: lastResult.timedOut || false,
        stdout: lastResult.stdout.slice(0, 2000),
        stderr: lastResult.stderr.slice(0, 2000),
      }, raw, 'fail');
      return;
    }
  }

  // All commands passed
  output({
    success: true,
    command: commands.length === 1 ? commands[0] : commands.join(' && '),
    pipeline: commands.length > 1 ? commands : undefined,
    exitCode: 0,
    timedOut: false,
    stdout: (lastResult ? lastResult.stdout : '').slice(0, 2000),
    stderr: (lastResult ? lastResult.stderr : '').slice(0, 2000),
  }, raw, 'pass');
}

function cmdGitCreatePr(cwd, options, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const base = options.base;
  const title = options.title;
  const body = options.body || '';

  if (!base || !title) {
    output({ success: false, error: 'base and title required (--base <branch> --title <title>)' }, raw, '');
    return;
  }

  const ghArgs = ['pr', 'create', '--base', base, '--title', title, '--body', body];
  const result = execCommand('gh', ghArgs, { cwd });

  if (result.success) {
    output({ success: true, pr_url: result.stdout.trim(), base, title }, raw, result.stdout.trim());
  } else {
    output({ success: false, error: result.stderr }, raw, '');
  }
}

function cmdGitSelfMergePr(cwd, prNumber, strategyOverride, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  if (!prNumber) {
    output({ success: false, error: 'PR number required' }, raw, '');
    return;
  }

  // Validate strategy override if provided
  const validStrategies = ['merge', 'squash', 'rebase'];
  if (strategyOverride && !validStrategies.includes(strategyOverride)) {
    output({ success: false, error: 'Invalid merge strategy: ' + strategyOverride + '. Must be one of: ' + validStrategies.join(', ') }, raw, '');
    return;
  }

  const mergeStrategy = strategyOverride || config.git_merge_strategy || 'merge';
  const ghArgs = ['pr', 'merge', prNumber, '--' + mergeStrategy, '--delete-branch'];
  const result = execCommand('gh', ghArgs, { cwd });

  if (result.success) {
    output({ success: true, pr: prNumber, strategy: mergeStrategy, merged: true }, raw, 'merged');
  } else {
    output({ success: false, error: result.stderr }, raw, '');
  }
}

function cmdGitMergeDevToMain(cwd, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const devBranch = config.git_dev_branch || 'dev';
  const mainBranch = config.git_main_branch || 'main';

  let checkoutResult = execCommand('git', ['checkout', mainBranch], { cwd });
  if (!checkoutResult.success) {
    output({ success: false, error: 'Could not checkout main branch: ' + mainBranch }, raw, '');
    return;
  }

  const mergeResult = execCommand('git', ['merge', '--no-ff', devBranch, '-m', 'Merge ' + devBranch + ' into ' + mainBranch], { cwd });
  if (mergeResult.success) {
    output({ success: true, from: devBranch, to: mainBranch, strategy: 'no-ff' }, raw, 'merged');
  } else {
    // Abort the failed merge
    execCommand('git', ['merge', '--abort'], { cwd });
    output({ success: false, error: mergeResult.stderr }, raw, '');
  }
}

function cmdGitCheckConflicts(cwd, branchName, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  if (!branchName) {
    output({ success: false, error: 'branch name required (--branch <branch>)' }, raw, '');
    return;
  }

  const devBranch = config.git_dev_branch || 'dev';

  // Check git version for merge-tree availability
  const versionResult = execCommand('git', ['--version'], { cwd });
  let mergeTreeAvailable = false;
  if (versionResult.success) {
    const vMatch = versionResult.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (vMatch) {
      const parts = vMatch[1].split('.').map(Number);
      mergeTreeAvailable = parts[0] > 2 || (parts[0] === 2 && (parts[1] || 0) >= 38);
    }
  }

  if (mergeTreeAvailable) {
    const result = execCommand('git', ['merge-tree', '--write-tree', '--no-messages', devBranch, branchName], { cwd });
    if (result.exitCode === 0) {
      output({ success: true, has_conflicts: false, method: 'merge-tree' }, raw, 'no-conflicts');
    } else {
      output({ success: true, has_conflicts: true, method: 'merge-tree' }, raw, 'conflicts');
    }
  } else {
    // Fallback: dry-run merge approach
    const result = execCommand('git', ['merge', '--no-commit', '--no-ff', branchName], { cwd });
    // Abort regardless
    execCommand('git', ['merge', '--abort'], { cwd });
    output({ success: true, has_conflicts: !result.success, method: 'merge-dry-run' }, raw, result.success ? 'no-conflicts' : 'conflicts');
  }
}

function cmdGitDeletePlanBranch(cwd, branchName, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  if (!branchName) {
    output({ success: false, error: 'branch name required' }, raw, '');
    return;
  }

  // Safety: refuse to delete protected branches
  const devBranch = config.git_dev_branch || 'dev';
  const configProtected = config.git_protected_branches || [];
  const protectedBranches = configProtected.length > 0
    ? [...new Set([...configProtected, devBranch])]
    : [config.git_main_branch || 'main', devBranch];
  if (protectedBranches.includes(branchName)) {
    output({ success: false, error: 'Cannot delete protected branch: ' + branchName }, raw, '');
    return;
  }

  const result = execCommand('git', ['branch', '-d', branchName], { cwd });
  if (result.success) {
    output({ success: true, branch: branchName, deleted: true }, raw, branchName);
  } else {
    output({ success: false, error: 'Branch not fully merged. Use git branch -D manually if intended.', branch: branchName }, raw, '');
  }
}

// ─── Merge Queue & Signal Helpers ─────────────────────────────────────────────

function writeMergeSignal(cwd, planId, status, details) {
  const signalsDir = path.join(cwd, '.hive-workers', 'signals');
  fs.mkdirSync(signalsDir, { recursive: true });
  const signalPath = path.join(signalsDir, 'merge-' + planId + '.result.json');
  const data = Object.assign({ plan_id: planId, status: status }, details || {}, { timestamp: new Date().toISOString() });
  atomicWriteFileSync(signalPath, JSON.stringify(data, null, 2));
}

function writeDevHeadSignal(cwd, sha, lastMerged) {
  const signalsDir = path.join(cwd, '.hive-workers', 'signals');
  fs.mkdirSync(signalsDir, { recursive: true });
  const signalPath = path.join(signalsDir, 'dev-head.json');
  const data = { sha: sha, updated_at: new Date().toISOString(), last_merged: lastMerged };
  atomicWriteFileSync(signalPath, JSON.stringify(data, null, 2));
}

function ensureGitignoreHiveWorkers(cwd) {
  const gitignorePath = path.join(cwd, '.gitignore');
  let content = '';
  try {
    content = fs.readFileSync(gitignorePath, 'utf-8');
  } catch {
    // .gitignore doesn't exist yet
  }
  if (content.includes('.hive-workers/')) return;
  const addition = '\n# Hive worker state (runtime, not committed)\n.hive-workers/\n';
  fs.appendFileSync(gitignorePath, addition, 'utf-8');
}

function cmdGitQueueSubmit(cwd, options, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const planId = options.plan_id;
  const branch = options.branch;
  if (!planId || !branch) {
    output({ success: false, error: 'plan_id and branch required (--plan-id <id> --branch <name>)' }, raw, '');
    return;
  }

  const queueDir = path.join(cwd, '.hive-workers');
  fs.mkdirSync(queueDir, { recursive: true });
  const queuePath = path.join(queueDir, 'merge-queue.json');

  ensureGitignoreHiveWorkers(cwd);

  const result = withFileLock(queuePath, () => {
    let data = { queue: [], merged: [], dev_head: null, last_updated: null };
    try {
      const raw = safeReadFile(queuePath);
      if (raw) data = JSON.parse(raw);
    } catch {
      // corrupt or missing — use defaults
    }

    const allCount = (data.queue || []).length + (data.merged || []).length;
    const id = 'mr-' + String(allCount + 1).padStart(3, '0');

    const planParts = planId.split('-');
    const phase = planParts[0] || planId;
    const plan = planParts[1] || planId;

    const entry = {
      id: id,
      plan_id: planId,
      phase: phase,
      plan: plan,
      branch: branch,
      wave: parseInt(options.wave, 10) || 1,
      status: 'pending',
      submitted_at: new Date().toISOString(),
      pr_number: options.pr_number ? parseInt(options.pr_number, 10) : null,
      pr_url: options.pr_url || null,
      checks: { conflicts: null, build: null },
      error: null,
      lease_owner: null,
      lease_expires_at: null,
      merge_strategy: options.merge_strategy || null,
      merged_at: null,
    };

    if (!data.queue) data.queue = [];
    data.queue.push(entry);
    data.last_updated = new Date().toISOString();
    atomicWriteFileSync(queuePath, JSON.stringify(data, null, 2));

    return { success: true, id: id, plan_id: planId };
  });

  output(result, raw, result.id);
}

function cmdGitQueueStatus(cwd, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const queuePath = path.join(cwd, '.hive-workers', 'merge-queue.json');
  let data;
  try {
    const content = safeReadFile(queuePath);
    if (!content) throw new Error('missing');
    data = JSON.parse(content);
  } catch {
    output({ success: true, empty: true, queue: [], merged: [], dev_head: null }, raw, 'empty');
    return;
  }

  const queue = data.queue || [];
  const merged = data.merged || [];
  const now = new Date().toISOString();
  const pending = queue.filter(e => e.status === 'pending');
  const inProgress = queue.filter(e => ['checking', 'building', 'merging'].includes(e.status));
  const failed = queue.filter(e => ['conflict', 'build_failed', 'merge_failed'].includes(e.status));
  const leased = queue.filter(e => e.lease_owner && e.lease_expires_at && e.lease_expires_at > now);
  const staleLeases = queue.filter(e => e.lease_owner && e.lease_expires_at && e.lease_expires_at <= now);

  output({
    success: true,
    pending_count: pending.length,
    in_progress_count: inProgress.length,
    failed_count: failed.length,
    merged_count: merged.length,
    leased_count: leased.length,
    stale_lease_count: staleLeases.length,
    dev_head: data.dev_head || null,
    last_updated: data.last_updated || null,
    pending: pending,
    failed: failed,
    leased: leased,
    stale_leases: staleLeases,
  }, raw, JSON.stringify({ pending_count: pending.length, failed_count: failed.length, merged_count: merged.length, leased_count: leased.length, stale_lease_count: staleLeases.length }));
}

function cmdGitQueueUpdate(cwd, options, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const entryId = options.id;
  const newStatus = options.status;
  if (!entryId) {
    output({ success: false, error: 'id required (--id <entry-id>)' }, raw, '');
    return;
  }

  const queueDir = path.join(cwd, '.hive-workers');
  fs.mkdirSync(queueDir, { recursive: true });
  const queuePath = path.join(queueDir, 'merge-queue.json');

  const result = withFileLock(queuePath, () => {
    let data = { queue: [], merged: [], dev_head: null, last_updated: null };
    try {
      const raw = safeReadFile(queuePath);
      if (raw) data = JSON.parse(raw);
    } catch {
      // corrupt — use defaults
    }

    const queue = data.queue || [];
    const idx = queue.findIndex(e => e.id === entryId);
    if (idx === -1) {
      return { success: false, error: 'entry not found: ' + entryId };
    }

    const entry = queue[idx];
    if (newStatus) entry.status = newStatus;
    if (options.error) entry.error = options.error;
    if (options.merge_sha) entry.merge_sha = options.merge_sha;
    if (options.pr_number) entry.pr_number = parseInt(options.pr_number, 10);
    if (options.pr_url) entry.pr_url = options.pr_url;

    // Lease management
    if (options.lease_owner) {
      entry.lease_owner = options.lease_owner;
      entry.lease_expires_at = new Date(Date.now() + (parseInt(options.lease_ttl, 10) || 300) * 1000).toISOString();
    }

    const terminalStatuses = ['merged', 'conflict', 'build_failed', 'merge_failed'];

    // Clear lease on terminal status
    if (newStatus && terminalStatuses.includes(newStatus)) {
      entry.lease_owner = null;
      entry.lease_expires_at = null;
    }

    if (newStatus === 'merged') {
      entry.merged_at = new Date().toISOString();
      const mergedEntry = {
        id: entry.id,
        plan_id: entry.plan_id,
        branch: entry.branch,
        merged_at: entry.merged_at,
        merge_sha: options.merge_sha || null,
      };
      if (!data.merged) data.merged = [];
      data.merged.push(mergedEntry);
      // Cap merged array at 50 entries (remove oldest)
      if (data.merged.length > 50) {
        data.merged = data.merged.slice(data.merged.length - 50);
      }
      // Remove from queue
      queue.splice(idx, 1);
      // Update dev_head
      if (options.merge_sha) {
        data.dev_head = options.merge_sha;
      }
    }

    data.queue = queue;
    data.last_updated = new Date().toISOString();
    atomicWriteFileSync(queuePath, JSON.stringify(data, null, 2));

    // Write signal files for terminal status changes
    if (newStatus && terminalStatuses.includes(newStatus)) {
      writeMergeSignal(cwd, entry.plan_id, newStatus, {
        error: options.error || null,
        merge_sha: options.merge_sha || null,
        pr_number: entry.pr_number || null,
      });
    }
    if (newStatus === 'merged' && options.merge_sha) {
      writeDevHeadSignal(cwd, options.merge_sha, entry.plan_id);
    }

    return { success: true, id: entryId, status: newStatus || entry.status };
  });

  output(result, raw, result.success ? result.id : '');
}

function cmdGitQueueDrain(cwd, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  const queueDir = path.join(cwd, '.hive-workers');
  fs.mkdirSync(queueDir, { recursive: true });
  const queuePath = path.join(queueDir, 'merge-queue.json');

  const result = withFileLock(queuePath, () => {
    let data = { queue: [], merged: [], dev_head: null, last_updated: null };
    try {
      const content = safeReadFile(queuePath);
      if (content) data = JSON.parse(content);
    } catch {
      // corrupt — use defaults
    }

    const queue = data.queue || [];
    const terminalStatuses = ['merged', 'conflict', 'build_failed', 'merge_failed'];
    const toDrain = queue.filter(e => terminalStatuses.includes(e.status));
    const remaining = queue.filter(e => !terminalStatuses.includes(e.status));

    // Clean up signal files for drained entries
    const signalsDir = path.join(cwd, '.hive-workers', 'signals');
    for (const entry of toDrain) {
      const signalPath = path.join(signalsDir, 'merge-' + entry.plan_id + '.result.json');
      try {
        fs.unlinkSync(signalPath);
      } catch {
        // signal file may not exist — best-effort
      }
    }

    data.queue = remaining;
    data.last_updated = new Date().toISOString();
    atomicWriteFileSync(queuePath, JSON.stringify(data, null, 2));

    return { success: true, drained_count: toDrain.length, remaining_count: remaining.length };
  });

  output(result, raw, String(result.drained_count));
}

// ─── Gate 2: Pre-merge Build Validation ───────────────────────────────────────

function cmdGitRunGate2(cwd, branchName, raw) {
  const config = loadConfig(cwd);
  if (config.git_flow === 'none') {
    output({ success: true, skipped: true, reason: 'git.flow is none' }, raw, 'skipped');
    return;
  }

  if (!branchName) {
    output({ success: false, error: 'branch name required (--branch <name>)' }, raw, '');
    return;
  }

  if (!config.git_build_gates_pre_merge) {
    output({ success: true, skipped: true, reason: 'pre_merge gate disabled' }, raw, 'skipped');
    return;
  }

  const devBranch = config.git_dev_branch || 'dev';

  // Checkout dev branch
  const checkoutResult = execCommand('git', ['checkout', devBranch], { cwd });
  if (!checkoutResult.success) {
    output({ success: false, gate: 'pre_merge', error: 'checkout_failed', branch: devBranch, stderr: checkoutResult.stderr.slice(0, 2000) }, raw, '');
    return;
  }

  // Crash recovery: abort any leftover merge state
  execCommand('git', ['merge', '--abort'], { cwd });

  // Attempt no-commit merge
  const mergeResult = execCommand('git', ['merge', '--no-commit', '--no-ff', branchName], { cwd });
  if (!mergeResult.success) {
    execCommand('git', ['merge', '--abort'], { cwd });
    output({ success: false, gate: 'pre_merge', error: 'merge_conflict', branch: branchName, stderr: mergeResult.stderr.slice(0, 2000) }, raw, '');
    return;
  }

  // Detect build command
  const buildCmd = config.git_build_command || detectBuildCommand(cwd).command;
  if (!buildCmd) {
    execCommand('git', ['merge', '--abort'], { cwd });
    if (config.git_require_build) {
      output({ success: false, gate: 'pre_merge', error: 'require_build is true but no build command detected', required: true }, raw, 'fail');
      return;
    }
    output({ success: true, gate: 'pre_merge', skipped: true, reason: 'no build command' }, raw, 'skipped');
    return;
  }

  // Run build inside try/finally — ALWAYS abort merge after
  const timeoutMs = (config.git_build_timeout || 300) * 1000;
  let buildResult;
  try {
    const commands = Array.isArray(buildCmd) ? buildCmd : [buildCmd];
    for (const cmd of commands) {
      const parts = cmd.split(/\s+/);
      buildResult = execCommand(parts[0], parts.slice(1), { cwd, timeout: timeoutMs });
      if (!buildResult.success) break;
    }
  } finally {
    execCommand('git', ['merge', '--abort'], { cwd });
  }

  const commands = Array.isArray(buildCmd) ? buildCmd : [buildCmd];
  output({
    success: buildResult.success,
    gate: 'pre_merge',
    branch: branchName,
    command: commands.length === 1 ? commands[0] : commands.join(' && '),
    pipeline: commands.length > 1 ? commands : undefined,
    exitCode: buildResult.exitCode,
    timedOut: buildResult.timedOut || false,
    stdout: buildResult.stdout.slice(0, 2000),
    stderr: buildResult.stderr.slice(0, 2000),
  }, raw, buildResult.success ? 'pass' : 'fail');
}

// ─── CLI Router ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const rawIndex = args.indexOf('--raw');
  const raw = rawIndex !== -1;
  if (rawIndex !== -1) args.splice(rawIndex, 1);

  const command = args[0];
  const cwd = process.cwd();

  if (!command) {
    error('Usage: hive-tools <command> [args] [--raw]\nCommands: state, resolve-model, find-phase, commit, verify-summary, verify, frontmatter, template, generate-slug, current-timestamp, list-todos, verify-path-exists, config-ensure-section, init, git');
  }

  switch (command) {
    case 'state': {
      const subcommand = args[1];
      if (subcommand === 'update') {
        cmdStateUpdate(cwd, args[2], args[3]);
      } else if (subcommand === 'get') {
        cmdStateGet(cwd, args[2], raw);
      } else if (subcommand === 'patch') {
        const patches = {};
        for (let i = 2; i < args.length; i += 2) {
          const key = args[i].replace(/^--/, '');
          const value = args[i + 1];
          if (key && value !== undefined) {
            patches[key] = value;
          }
        }
        cmdStatePatch(cwd, patches, raw);
      } else if (subcommand === 'advance-plan') {
        cmdStateAdvancePlan(cwd, raw);
      } else if (subcommand === 'record-metric') {
        const phaseIdx = args.indexOf('--phase');
        const planIdx = args.indexOf('--plan');
        const durationIdx = args.indexOf('--duration');
        const tasksIdx = args.indexOf('--tasks');
        const filesIdx = args.indexOf('--files');
        cmdStateRecordMetric(cwd, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          plan: planIdx !== -1 ? args[planIdx + 1] : null,
          duration: durationIdx !== -1 ? args[durationIdx + 1] : null,
          tasks: tasksIdx !== -1 ? args[tasksIdx + 1] : null,
          files: filesIdx !== -1 ? args[filesIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'update-progress') {
        cmdStateUpdateProgress(cwd, raw);
      } else if (subcommand === 'add-decision') {
        const phaseIdx = args.indexOf('--phase');
        const summaryIdx = args.indexOf('--summary');
        const rationaleIdx = args.indexOf('--rationale');
        cmdStateAddDecision(cwd, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          summary: summaryIdx !== -1 ? args[summaryIdx + 1] : null,
          rationale: rationaleIdx !== -1 ? args[rationaleIdx + 1] : '',
        }, raw);
      } else if (subcommand === 'add-blocker') {
        const textIdx = args.indexOf('--text');
        cmdStateAddBlocker(cwd, textIdx !== -1 ? args[textIdx + 1] : null, raw);
      } else if (subcommand === 'resolve-blocker') {
        const textIdx = args.indexOf('--text');
        cmdStateResolveBlocker(cwd, textIdx !== -1 ? args[textIdx + 1] : null, raw);
      } else if (subcommand === 'record-session') {
        const stoppedIdx = args.indexOf('--stopped-at');
        const resumeIdx = args.indexOf('--resume-file');
        cmdStateRecordSession(cwd, {
          stopped_at: stoppedIdx !== -1 ? args[stoppedIdx + 1] : null,
          resume_file: resumeIdx !== -1 ? args[resumeIdx + 1] : 'None',
        }, raw);
      } else {
        cmdStateLoad(cwd, raw);
      }
      break;
    }

    case 'resolve-model': {
      cmdResolveModel(cwd, args[1], raw);
      break;
    }

    case 'find-phase': {
      cmdFindPhase(cwd, args[1], raw);
      break;
    }

    case 'commit': {
      const amend = args.includes('--amend');
      const message = args[1];
      // Parse --files flag (collect args after --files, stopping at other flags)
      const filesIndex = args.indexOf('--files');
      const files = filesIndex !== -1 ? args.slice(filesIndex + 1).filter(a => !a.startsWith('--')) : [];
      cmdCommit(cwd, message, files, raw, amend);
      break;
    }

    case 'verify-summary': {
      const summaryPath = args[1];
      const countIndex = args.indexOf('--check-count');
      const checkCount = countIndex !== -1 ? parseInt(args[countIndex + 1], 10) : 2;
      cmdVerifySummary(cwd, summaryPath, checkCount, raw);
      break;
    }

    case 'template': {
      const subcommand = args[1];
      if (subcommand === 'select') {
        cmdTemplateSelect(cwd, args[2], raw);
      } else if (subcommand === 'fill') {
        const templateType = args[2];
        const phaseIdx = args.indexOf('--phase');
        const planIdx = args.indexOf('--plan');
        const nameIdx = args.indexOf('--name');
        const typeIdx = args.indexOf('--type');
        const waveIdx = args.indexOf('--wave');
        const fieldsIdx = args.indexOf('--fields');
        cmdTemplateFill(cwd, templateType, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          plan: planIdx !== -1 ? args[planIdx + 1] : null,
          name: nameIdx !== -1 ? args[nameIdx + 1] : null,
          type: typeIdx !== -1 ? args[typeIdx + 1] : 'execute',
          wave: waveIdx !== -1 ? args[waveIdx + 1] : '1',
          fields: fieldsIdx !== -1 ? JSON.parse(args[fieldsIdx + 1]) : {},
        }, raw);
      } else {
        error('Unknown template subcommand. Available: select, fill');
      }
      break;
    }

    case 'frontmatter': {
      const subcommand = args[1];
      const file = args[2];
      if (subcommand === 'get') {
        const fieldIdx = args.indexOf('--field');
        cmdFrontmatterGet(cwd, file, fieldIdx !== -1 ? args[fieldIdx + 1] : null, raw);
      } else if (subcommand === 'set') {
        const fieldIdx = args.indexOf('--field');
        const valueIdx = args.indexOf('--value');
        cmdFrontmatterSet(cwd, file, fieldIdx !== -1 ? args[fieldIdx + 1] : null, valueIdx !== -1 ? args[valueIdx + 1] : undefined, raw);
      } else if (subcommand === 'merge') {
        const dataIdx = args.indexOf('--data');
        cmdFrontmatterMerge(cwd, file, dataIdx !== -1 ? args[dataIdx + 1] : null, raw);
      } else if (subcommand === 'validate') {
        const schemaIdx = args.indexOf('--schema');
        cmdFrontmatterValidate(cwd, file, schemaIdx !== -1 ? args[schemaIdx + 1] : null, raw);
      } else {
        error('Unknown frontmatter subcommand. Available: get, set, merge, validate');
      }
      break;
    }

    case 'verify': {
      const subcommand = args[1];
      if (subcommand === 'plan-structure') {
        cmdVerifyPlanStructure(cwd, args[2], raw);
      } else if (subcommand === 'phase-completeness') {
        cmdVerifyPhaseCompleteness(cwd, args[2], raw);
      } else if (subcommand === 'references') {
        cmdVerifyReferences(cwd, args[2], raw);
      } else if (subcommand === 'commits') {
        cmdVerifyCommits(cwd, args.slice(2), raw);
      } else if (subcommand === 'artifacts') {
        cmdVerifyArtifacts(cwd, args[2], raw);
      } else if (subcommand === 'key-links') {
        cmdVerifyKeyLinks(cwd, args[2], raw);
      } else {
        error('Unknown verify subcommand. Available: plan-structure, phase-completeness, references, commits, artifacts, key-links');
      }
      break;
    }

    case 'generate-slug': {
      cmdGenerateSlug(args[1], raw);
      break;
    }

    case 'current-timestamp': {
      cmdCurrentTimestamp(args[1] || 'full', raw);
      break;
    }

    case 'list-todos': {
      cmdListTodos(cwd, args[1], raw);
      break;
    }

    case 'verify-path-exists': {
      cmdVerifyPathExists(cwd, args[1], raw);
      break;
    }

    case 'config-ensure-section': {
      cmdConfigEnsureSection(cwd, raw);
      break;
    }

    case 'config-set': {
      cmdConfigSet(cwd, args[1], args[2], raw);
      break;
    }

    case 'history-digest': {
      cmdHistoryDigest(cwd, raw);
      break;
    }

    case 'phases': {
      const subcommand = args[1];
      if (subcommand === 'list') {
        const typeIndex = args.indexOf('--type');
        const phaseIndex = args.indexOf('--phase');
        const options = {
          type: typeIndex !== -1 ? args[typeIndex + 1] : null,
          phase: phaseIndex !== -1 ? args[phaseIndex + 1] : null,
        };
        cmdPhasesList(cwd, options, raw);
      } else {
        error('Unknown phases subcommand. Available: list');
      }
      break;
    }

    case 'roadmap': {
      const subcommand = args[1];
      if (subcommand === 'get-phase') {
        cmdRoadmapGetPhase(cwd, args[2], raw);
      } else if (subcommand === 'analyze') {
        cmdRoadmapAnalyze(cwd, raw);
      } else {
        error('Unknown roadmap subcommand. Available: get-phase, analyze');
      }
      break;
    }

    case 'phase': {
      const subcommand = args[1];
      if (subcommand === 'next-decimal') {
        cmdPhaseNextDecimal(cwd, args[2], raw);
      } else if (subcommand === 'add') {
        cmdPhaseAdd(cwd, args.slice(2).join(' '), raw);
      } else if (subcommand === 'insert') {
        cmdPhaseInsert(cwd, args[2], args.slice(3).join(' '), raw);
      } else if (subcommand === 'remove') {
        const forceFlag = args.includes('--force');
        cmdPhaseRemove(cwd, args[2], { force: forceFlag }, raw);
      } else if (subcommand === 'complete') {
        cmdPhaseComplete(cwd, args[2], raw);
      } else {
        error('Unknown phase subcommand. Available: next-decimal, add, insert, remove, complete');
      }
      break;
    }

    case 'milestone': {
      const subcommand = args[1];
      if (subcommand === 'complete') {
        const nameIndex = args.indexOf('--name');
        const milestoneName = nameIndex !== -1 ? args.slice(nameIndex + 1).join(' ') : null;
        cmdMilestoneComplete(cwd, args[2], { name: milestoneName }, raw);
      } else {
        error('Unknown milestone subcommand. Available: complete');
      }
      break;
    }

    case 'validate': {
      const subcommand = args[1];
      if (subcommand === 'consistency') {
        cmdValidateConsistency(cwd, raw);
      } else {
        error('Unknown validate subcommand. Available: consistency');
      }
      break;
    }

    case 'progress': {
      const subcommand = args[1] || 'json';
      cmdProgressRender(cwd, subcommand, raw);
      break;
    }

    case 'todo': {
      const subcommand = args[1];
      if (subcommand === 'complete') {
        cmdTodoComplete(cwd, args[2], raw);
      } else {
        error('Unknown todo subcommand. Available: complete');
      }
      break;
    }

    case 'scaffold': {
      const scaffoldType = args[1];
      const phaseIndex = args.indexOf('--phase');
      const nameIndex = args.indexOf('--name');
      const scaffoldOptions = {
        phase: phaseIndex !== -1 ? args[phaseIndex + 1] : null,
        name: nameIndex !== -1 ? args.slice(nameIndex + 1).join(' ') : null,
      };
      cmdScaffold(cwd, scaffoldType, scaffoldOptions, raw);
      break;
    }

    case 'init': {
      const workflow = args[1];
      const includes = parseIncludeFlag(args);
      switch (workflow) {
        case 'execute-phase':
          cmdInitExecutePhase(cwd, args[2], includes, raw);
          break;
        case 'plan-phase':
          cmdInitPlanPhase(cwd, args[2], includes, raw);
          break;
        case 'new-project':
          cmdInitNewProject(cwd, raw);
          break;
        case 'new-milestone':
          cmdInitNewMilestone(cwd, raw);
          break;
        case 'quick':
          cmdInitQuick(cwd, args.slice(2).join(' '), raw);
          break;
        case 'resume':
          cmdInitResume(cwd, raw);
          break;
        case 'verify-work':
          cmdInitVerifyWork(cwd, args[2], raw);
          break;
        case 'phase-op':
          cmdInitPhaseOp(cwd, args[2], raw);
          break;
        case 'todos':
          cmdInitTodos(cwd, args[2], raw);
          break;
        case 'milestone-op':
          cmdInitMilestoneOp(cwd, raw);
          break;
        case 'map-codebase':
          cmdInitMapCodebase(cwd, raw);
          break;
        case 'progress':
          cmdInitProgress(cwd, includes, raw);
          break;
        default:
          error(`Unknown init workflow: ${workflow}\nAvailable: execute-phase, plan-phase, new-project, new-milestone, quick, resume, verify-work, phase-op, todos, milestone-op, map-codebase, progress`);
      }
      break;
    }

    case 'phase-plan-index': {
      cmdPhasePlanIndex(cwd, args[1], raw);
      break;
    }

    case 'state-snapshot': {
      cmdStateSnapshot(cwd, raw);
      break;
    }

    case 'summary-extract': {
      const summaryPath = args[1];
      const fieldsIndex = args.indexOf('--fields');
      const fields = fieldsIndex !== -1 ? args[fieldsIndex + 1].split(',') : null;
      cmdSummaryExtract(cwd, summaryPath, fields, raw);
      break;
    }

    case 'websearch': {
      const query = args[1];
      const limitIdx = args.indexOf('--limit');
      const freshnessIdx = args.indexOf('--freshness');
      await cmdWebsearch(query, {
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 10,
        freshness: freshnessIdx !== -1 ? args[freshnessIdx + 1] : null,
      }, raw);
      break;
    }

    case 'telemetry': {
      const subcommand = args[1];
      if (subcommand === 'emit') {
        const type = args[2];
        const dataIdx = args.indexOf('--data');
        const data = dataIdx !== -1 ? args[dataIdx + 1] : null;
        cmdTelemetryEmit(cwd, type, data, raw);
      } else if (subcommand === 'query') {
        const typeIdx = args.indexOf('--type');
        const sinceIdx = args.indexOf('--since');
        const limitIdx = args.indexOf('--limit');
        cmdTelemetryQuery(cwd, {
          type: typeIdx !== -1 ? args[typeIdx + 1] : null,
          since: sinceIdx !== -1 ? args[sinceIdx + 1] : null,
          limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 50,
        }, raw);
      } else if (subcommand === 'stats') {
        cmdTelemetryStats(cwd, raw);
      } else if (subcommand === 'digest') {
        cmdTelemetryDigest(cwd, raw);
      } else if (subcommand === 'rotate') {
        const force = args.indexOf('--force') !== -1;
        cmdTelemetryRotate(cwd, force, raw);
      } else if (subcommand === 'transcript') {
        const crossSession = args.indexOf('--cross-session') !== -1;
        if (crossSession) {
          cmdTelemetryTranscript(cwd, null, raw, true);
        } else {
          const sessionId = args[2] && !args[2].startsWith('--') ? args[2] : null;
          cmdTelemetryTranscript(cwd, sessionId, raw, false);
        }
      } else {
        error('Unknown telemetry subcommand: ' + (subcommand || '(none)') + '. Available: emit, query, digest, rotate, stats, transcript');
      }
      break;
    }

    case 'git': {
      const subcommand = args[1];
      if (subcommand === 'detect') {
        cmdGitDetect(cwd, raw);
      } else if (subcommand === 'detect-build-cmd') {
        cmdGitDetectBuildCmd(cwd, raw);
      } else if (subcommand === 'current-branch') {
        cmdGitCurrentBranch(cwd, raw);
      } else if (subcommand === 'git-status') {
        cmdGitStatus(cwd, raw);
      } else if (subcommand === 'create-dev-branch') {
        cmdGitCreateDevBranch(cwd, raw);
      } else if (subcommand === 'create-plan-branch') {
        const nameIdx = args.indexOf('--name');
        const branchName = nameIdx !== -1 ? args[nameIdx + 1] : null;
        cmdGitCreatePlanBranch(cwd, branchName, raw);
      } else if (subcommand === 'run-build-gate') {
        const gateIndex = args.indexOf('--gate');
        const gate = gateIndex !== -1 && args[gateIndex + 1] ? args[gateIndex + 1] : null;
        cmdGitRunBuildGate(cwd, gate, raw);
      } else if (subcommand === 'create-pr') {
        const baseIdx = args.indexOf('--base');
        const titleIdx = args.indexOf('--title');
        const bodyIdx = args.indexOf('--body');
        cmdGitCreatePr(cwd, {
          base: baseIdx !== -1 ? args[baseIdx + 1] : null,
          title: titleIdx !== -1 ? args[titleIdx + 1] : null,
          body: bodyIdx !== -1 ? args[bodyIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'self-merge-pr') {
        const strategyIdx = args.indexOf('--strategy');
        const strategy = strategyIdx !== -1 ? args[strategyIdx + 1] : null;
        cmdGitSelfMergePr(cwd, args[2], strategy, raw);
      } else if (subcommand === 'merge-dev-to-main') {
        cmdGitMergeDevToMain(cwd, raw);
      } else if (subcommand === 'check-conflicts') {
        const branchIdx = args.indexOf('--branch');
        const conflictBranch = branchIdx !== -1 ? args[branchIdx + 1] : null;
        cmdGitCheckConflicts(cwd, conflictBranch, raw);
      } else if (subcommand === 'delete-plan-branch') {
        cmdGitDeletePlanBranch(cwd, args[2], raw);
      } else if (subcommand === 'queue-submit') {
        const planIdIdx = args.indexOf('--plan-id');
        const branchIdx = args.indexOf('--branch');
        const waveIdx = args.indexOf('--wave');
        const prNumIdx = args.indexOf('--pr-number');
        const prUrlIdx = args.indexOf('--pr-url');
        const mergeStratIdx = args.indexOf('--merge-strategy');
        cmdGitQueueSubmit(cwd, {
          plan_id: planIdIdx !== -1 ? args[planIdIdx + 1] : null,
          branch: branchIdx !== -1 ? args[branchIdx + 1] : null,
          wave: waveIdx !== -1 ? args[waveIdx + 1] : null,
          pr_number: prNumIdx !== -1 ? args[prNumIdx + 1] : null,
          pr_url: prUrlIdx !== -1 ? args[prUrlIdx + 1] : null,
          merge_strategy: mergeStratIdx !== -1 ? args[mergeStratIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'queue-status') {
        cmdGitQueueStatus(cwd, raw);
      } else if (subcommand === 'queue-update') {
        const idIdx = args.indexOf('--id');
        const statusIdx = args.indexOf('--status');
        const errorIdx = args.indexOf('--error');
        const mergeShaIdx = args.indexOf('--merge-sha');
        const prNumIdx = args.indexOf('--pr-number');
        const prUrlIdx = args.indexOf('--pr-url');
        const leaseOwnerIdx = args.indexOf('--lease-owner');
        const leaseTtlIdx = args.indexOf('--lease-ttl');
        cmdGitQueueUpdate(cwd, {
          id: idIdx !== -1 ? args[idIdx + 1] : null,
          status: statusIdx !== -1 ? args[statusIdx + 1] : null,
          error: errorIdx !== -1 ? args[errorIdx + 1] : null,
          merge_sha: mergeShaIdx !== -1 ? args[mergeShaIdx + 1] : null,
          pr_number: prNumIdx !== -1 ? args[prNumIdx + 1] : null,
          pr_url: prUrlIdx !== -1 ? args[prUrlIdx + 1] : null,
          lease_owner: leaseOwnerIdx !== -1 ? args[leaseOwnerIdx + 1] : null,
          lease_ttl: leaseTtlIdx !== -1 ? args[leaseTtlIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'queue-drain') {
        cmdGitQueueDrain(cwd, raw);
      } else if (subcommand === 'run-gate-2') {
        const branchIdx = args.indexOf('--branch');
        const g2Branch = branchIdx !== -1 ? args[branchIdx + 1] : null;
        cmdGitRunGate2(cwd, g2Branch, raw);
      } else {
        error('Unknown git subcommand: ' + (subcommand || '(none)') + '. Available: detect, detect-build-cmd, current-branch, git-status, create-dev-branch, create-plan-branch, run-build-gate, create-pr, self-merge-pr, merge-dev-to-main, check-conflicts, delete-plan-branch, queue-submit, queue-status, queue-update, queue-drain, run-gate-2');
      }
      break;
    }

    default:
      error(`Unknown command: ${command}`);
  }
}

main();
