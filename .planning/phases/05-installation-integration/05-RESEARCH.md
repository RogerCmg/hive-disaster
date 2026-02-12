# Phase 5: Installation Integration - Research

**Researched:** 2026-02-12
**Domain:** npm installer integration, hook file distribution, settings.json registration, config template augmentation
**Confidence:** HIGH

## Summary

Phase 5 integrates the 4 Recall hook observer files (built in Phase 2) into the existing `bin/install.js` installer so that running `npx hive-cc` automatically deploys hooks, registers them in settings.json, and ensures the telemetry config section exists. This is a pure installer modification phase -- no new features, no new hook files, no new libraries. The work is entirely about wiring existing artifacts into an existing installation pipeline.

The installer (`bin/install.js`, 1740 lines) already handles hook file copying (lines 1408-1426), settings.json hook registration (lines 1455-1479), and uninstallation cleanup (lines 852-868, 884-915). The 4 Recall hooks already exist in `hooks/` and are already listed in `scripts/build-hooks.js` for the `npm run build:hooks` step that copies them to `hooks/dist/`. The config template at `hive/templates/config.json` already contains the `telemetry` section. The infrastructure is 90% in place -- Phase 5 fills three specific gaps.

**Primary recommendation:** Make 3 targeted modifications to `bin/install.js`: (1) Register Recall hooks in settings.json during install (SubagentStop, PostToolUseFailure, PreCompact, SessionStart session hook, SessionEnd), (2) Add Recall hook files to the uninstall cleanup list, and (3) Add Recall hook registrations to the uninstall settings.json cleanup. Additionally, update `hive/bin/hive-tools.js` `cmdConfigEnsureSection` to include the `telemetry` section in its defaults so new projects get telemetry config out of the box.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` | stdlib | File copying, reading/writing settings.json | Already used throughout install.js |
| Node.js `path` | stdlib | Cross-platform path construction | Already used throughout install.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `buildHookCommand()` | internal | Build cross-platform hook command paths | For global installs (uses absolute paths) |
| `readSettings()` / `writeSettings()` | internal | Read/write settings.json safely | For hook registration in settings.json |
| `cleanupOrphanedHooks()` | internal | Remove old hook registrations | Could be extended to clean orphaned recall hooks |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Modifying install.js directly | Separate post-install script | Adds complexity, another entry point to maintain. install.js is the single source of truth for installation |
| Hardcoded hook paths in installer | Dynamic discovery from hooks/dist/ | Over-engineering. The hook set is known and stable. Explicit > magic. |
| Inline hook registration in install() | Separate registerRecallHooks() function | A helper function adds clarity but the existing pattern (SessionStart registration at lines 1455-1479) is inline. Follow existing pattern for consistency. |

**Installation:**
```bash
# No new dependencies. Zero-dep philosophy maintained.
```

## Architecture Patterns

### Current Installer Architecture
```
bin/install.js
├── File Copying Pipeline
│   ├── Commands (copyWithPathReplacement / copyFlattenedCommands)
│   ├── Hive skill directory
│   ├── Agents (hive-*.md)
│   ├── CHANGELOG.md + VERSION
│   └── Hooks from hooks/dist/ → targetDir/hooks/        ← Already copies ALL hooks/dist/ files
├── Settings.json Configuration
│   ├── cleanupOrphanedHooks()                            ← Needs recall hook patterns added
│   ├── StatusLine registration
│   └── SessionStart hook registration (check-update)     ← Recall hooks go here (NEW)
├── Uninstall Cleanup
│   ├── Hook file deletion list                           ← Needs recall hooks added
│   └── settings.json hook cleanup                        ← Needs recall hooks added
└── Build Pipeline
    └── scripts/build-hooks.js → hooks/dist/              ← Already includes recall hooks
```

### Pattern 1: Hook File Distribution (ALREADY WORKING)
**What:** The build step (`npm run build:hooks` / `scripts/build-hooks.js`) copies hook source files to `hooks/dist/`. The installer copies ALL files from `hooks/dist/` to the target `hooks/` directory.
**Key insight:** The 4 Recall hook files are ALREADY in `scripts/build-hooks.js` HOOKS_TO_COPY (lines 13-19). After `npm run build:hooks`, they land in `hooks/dist/`. The installer already copies everything from `hooks/dist/` (lines 1408-1426). So INST-01 (hook file copying) is ALREADY SATISFIED by the existing pipeline.
**Verification:**
```javascript
// scripts/build-hooks.js already contains:
const HOOKS_TO_COPY = [
  'hive-check-update.js',
  'hive-statusline.js',
  'hive-recall-agent.js',    // ← Already here
  'hive-recall-error.js',    // ← Already here
  'hive-recall-compact.js',  // ← Already here
  'hive-recall-session.js'   // ← Already here
];

// install.js already copies all hooks/dist/ files:
// Lines 1408-1426: copies every file from hooks/dist/ to targetDir/hooks/
```

### Pattern 2: Hook Registration in settings.json (NEEDS IMPLEMENTATION)
**What:** After copying hook files, the installer must register them in settings.json so Claude Code/Gemini actually fires them.
**Current state:** Only the SessionStart `hive-check-update.js` hook is registered (lines 1455-1479). The 5 Recall hook registrations (SubagentStop, PostToolUseFailure, PreCompact, SessionStart session hook, SessionEnd) are NOT registered by the installer.
**Pattern to follow:** Exactly mirror the existing SessionStart registration pattern.
**Example:**
```javascript
// Existing pattern (lines 1464-1478):
const hasGsdUpdateHook = settings.hooks.SessionStart.some(entry =>
  entry.hooks && entry.hooks.some(h => h.command && h.command.includes('hive-check-update'))
);
if (!hasGsdUpdateHook) {
  settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: updateCheckCommand }] });
}

// New pattern for each recall hook:
// 1. Build command path (global vs local)
// 2. Check if already registered (idempotent)
// 3. Push registration entry if missing
```

### Pattern 3: Session Hook with Arguments
**What:** `hive-recall-session.js` uses a CLI argument (`start` or `end`) to determine mode. The hook command must include the argument.
**Example:**
```javascript
// For global install:
const sessionStartCommand = buildHookCommand(targetDir, 'hive-recall-session.js') + ' start';
const sessionEndCommand = buildHookCommand(targetDir, 'hive-recall-session.js') + ' end';
// Produces: node "/path/to/hooks/hive-recall-session.js" start

// For local install:
const sessionStartCommand = 'node ' + dirName + '/hooks/hive-recall-session.js start';
const sessionEndCommand = 'node ' + dirName + '/hooks/hive-recall-session.js end';
```

### Pattern 4: OpenCode Hook Exclusion
**What:** OpenCode does NOT support Claude Code hooks. The existing installer already skips hook registration for OpenCode (line 1456: `if (!isOpencode)`). Recall hooks must follow this same guard.
**Key insight:** The `if (!isOpencode)` block at line 1456 is where ALL hook registrations go. Adding Recall hook registrations inside this same block automatically excludes OpenCode.

### Pattern 5: Gemini Hook Sharing
**What:** Gemini shares the same hook system as Claude Code (line 1434: "Gemini shares same hook system as Claude Code for now"). Recall hooks should be registered for Gemini too.
**Key insight:** The existing code does NOT have a `!isGemini` guard on hook registration. It only guards with `!isOpencode`. This means recall hooks registered in the same block will automatically apply to both Claude and Gemini.

### Anti-Patterns to Avoid
- **Modifying hooks/dist/ directly:** The dist/ directory is a build artifact (gitignored). Only modify source files in `hooks/` and `scripts/build-hooks.js`.
- **Creating new hook command builder:** `buildHookCommand()` already exists. Use it for global installs. For local, use the existing `'node ' + dirName + '/hooks/...'` pattern.
- **Registering hooks outside the `!isOpencode` guard:** OpenCode has no hook system. All hook registrations must be inside the existing `if (!isOpencode)` block.
- **Forgetting to handle the session hook argument:** `hive-recall-session.js start` and `hive-recall-session.js end` are different commands that must be registered separately under SessionStart and SessionEnd.
- **Overwriting existing SessionStart entries:** The SessionStart array already has `hive-check-update.js`. APPEND to the array, never replace it.

## Gap Analysis

### Gap 1: Hook Registration in settings.json (INST-02) -- PRIMARY WORK

The installer does NOT register any of the 5 Recall hook events. This is the main work of Phase 5.

**What needs to be added after the existing SessionStart check-update registration (line 1479):**

| Hook Event | Hook File | Command Argument |
|------------|-----------|------------------|
| SubagentStop | hive-recall-agent.js | (none) |
| PostToolUseFailure | hive-recall-error.js | (none) |
| PreCompact | hive-recall-compact.js | (none) |
| SessionStart | hive-recall-session.js | `start` |
| SessionEnd | hive-recall-session.js | `end` |

**For each hook, the pattern is:**
1. Build command: `buildHookCommand(targetDir, hookFile)` (global) or `'node ' + dirName + '/hooks/' + hookFile` (local)
2. Ensure the event array exists: `if (!settings.hooks.EventName) settings.hooks.EventName = [];`
3. Check idempotency: `.some(entry => entry.hooks.some(h => h.command.includes(hookFile)))`
4. Push registration if missing

### Gap 2: Uninstall Hook File Cleanup -- REQUIRED

The `uninstall()` function (line 852-868) has a hardcoded list of hook files to remove:
```javascript
const gsdHooks = ['hive-statusline.js', 'hive-check-update.js', 'hive-check-update.sh'];
```
This list must be extended with the 4 Recall hooks:
```javascript
const gsdHooks = [
  'hive-statusline.js', 'hive-check-update.js', 'hive-check-update.sh',
  'hive-recall-agent.js', 'hive-recall-error.js',
  'hive-recall-compact.js', 'hive-recall-session.js'
];
```

### Gap 3: Uninstall settings.json Cleanup -- REQUIRED

The uninstall settings.json cleanup (lines 884-908) only removes hooks from `SessionStart`:
```javascript
if (settings.hooks && settings.hooks.SessionStart) {
  // ... filters by 'hive-check-update' or 'hive-statusline'
}
```
This must be extended to:
1. Clean up ALL Recall hook event types (SubagentStop, PostToolUseFailure, PreCompact, SessionEnd)
2. Also clean SessionStart recall entries (`hive-recall-session`)
3. Add `hive-recall` to the filter pattern alongside existing `hive-check-update` and `hive-statusline`

### Gap 4: Config Template Telemetry Section (INST-03) -- ALREADY DONE

The template at `hive/templates/config.json` already includes the telemetry section:
```json
"telemetry": {
  "enabled": true,
  "hooks": true,
  "workflow_events": true,
  "transcript_analysis": false
}
```
However, there are TWO additional places where config.json is created:
1. **`hive/bin/hive-tools.js` `cmdConfigEnsureSection` (line 711-725):** Creates a config with NO telemetry section. This means projects initialized via the `config-ensure-section` CLI command will NOT get telemetry config. This should be updated.
2. **`hive/workflows/new-project.md` (line 323-338):** Shows config creation inline in the workflow prompt. This workflow prompt does NOT include telemetry section. However, since this is a markdown prompt (not code), the workflow will read the template from the system -- the risk is that agents creating config.json from the workflow text might not include telemetry. This is a documentation gap, not a code gap.

**Recommended fix for INST-03:** Add `telemetry` section to the defaults object in `cmdConfigEnsureSection` in `hive-tools.js`.

### Gap 5: Orphaned Hook Cleanup List -- NICE-TO-HAVE

The `cleanupOrphanedHooks()` function (lines 715-767) maintains a list of orphaned hook patterns to remove during upgrades. The Recall hooks are new, so no orphaned patterns exist yet. But this function should be aware of the Recall hooks for future version handling. No action needed for Phase 5.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hook command paths | Custom path concatenation | `buildHookCommand()` (line 171) | Already handles cross-platform (forward slashes), quoting |
| Settings.json I/O | Direct fs.readFileSync/writeFileSync | `readSettings()` / `writeSettings()` (lines 180-196) | Handles parse errors, proper formatting |
| Idempotent registration | Simple overwrite | Check-before-push pattern (lines 1464-1478) | Prevents duplicate registrations on re-install |
| Runtime-specific guards | New conditional logic | Existing `!isOpencode` guard (line 1456) | Already handles Claude/Gemini vs OpenCode split |

**Key insight:** Every building block needed for Phase 5 already exists in install.js. The work is composition, not creation.

## Common Pitfalls

### Pitfall 1: Duplicate Hook Registrations on Re-install
**What goes wrong:** Running `npx hive-cc` twice registers the same hooks twice in settings.json, causing double-firing.
**Why it happens:** Not checking if a hook already exists before pushing to the array.
**How to avoid:** For each hook registration, check `.some(entry => entry.hooks.some(h => h.command && h.command.includes('hook-filename')))` before pushing. This is the exact pattern used for the existing check-update hook (lines 1464-1467).
**Warning signs:** events.jsonl gets duplicate entries for the same event.

### Pitfall 2: Breaking Existing SessionStart Hooks
**What goes wrong:** The SessionStart event already has `hive-check-update.js` registered. Adding `hive-recall-session.js start` must not disturb the existing entry.
**Why it happens:** Overwriting the SessionStart array instead of appending.
**How to avoid:** The existing code already uses `.push()` to append. Follow the same pattern. The SessionStart array will end up with 2 entries: check-update and recall-session.
**Warning signs:** Update checker stops working after installation.

### Pitfall 3: Missing Session Hook Argument
**What goes wrong:** Registering `hive-recall-session.js` without the `start` or `end` argument. The hook exits early when `mode !== 'start' && mode !== 'end'` (line 18 of the hook).
**Why it happens:** Forgetting that this hook uses `process.argv[2]` to determine behavior.
**How to avoid:** The hook command MUST include the argument: `"node path/to/hive-recall-session.js start"` and `"node path/to/hive-recall-session.js end"`.
**Warning signs:** Session hooks fire but produce no events (silent exit due to invalid mode).

### Pitfall 4: Incomplete Uninstall
**What goes wrong:** `npx hive-cc --uninstall` removes the old hooks but leaves Recall hooks behind.
**Why it happens:** The uninstall hook file list and settings.json cleanup don't know about Recall hooks.
**How to avoid:** Add all 4 Recall hook filenames to the `gsdHooks` array (line 855) and extend the settings.json cleanup to cover all Recall hook event types.
**Warning signs:** After uninstall, `.claude/hooks/` still contains `hive-recall-*.js` files.

### Pitfall 5: Global vs Local Path Construction
**What goes wrong:** Using `buildHookCommand()` for local installs or string concatenation for global installs.
**Why it happens:** The two patterns differ: global uses `buildHookCommand(targetDir, hookName)` which produces quoted absolute paths, local uses `'node ' + dirName + '/hooks/' + hookName` which produces relative paths.
**How to avoid:** Follow the exact pattern used for `updateCheckCommand` (lines 1440-1442):
```javascript
const command = isGlobal
  ? buildHookCommand(targetDir, hookName)
  : 'node ' + dirName + '/hooks/' + hookName;
```
**Warning signs:** Hooks fail with "file not found" on one install type but work on the other.

### Pitfall 6: cmdConfigEnsureSection Missing Telemetry
**What goes wrong:** New projects created via `config-ensure-section` don't get the telemetry config section, so `getTelemetryConfig()` falls back to all-enabled defaults. This works functionally but means users can't see/edit the telemetry settings in their config.json.
**Why it happens:** The defaults object in `cmdConfigEnsureSection` (lines 711-725) was written before Phase 1 added telemetry config and was never updated.
**How to avoid:** Add `telemetry: { enabled: true, hooks: true, workflow_events: true, transcript_analysis: false }` to the defaults object.
**Warning signs:** Fresh projects have no `telemetry` key in `.planning/config.json`.

## Code Examples

### Hook Registration Block (to add after line 1479)
```javascript
// Source: install.js existing pattern (lines 1455-1479) extended for Recall hooks

// ── Recall Hook Registration ──
// Build recall hook commands
const recallHooks = [
  { event: 'SubagentStop', file: 'hive-recall-agent.js', args: '' },
  { event: 'PostToolUseFailure', file: 'hive-recall-error.js', args: '' },
  { event: 'PreCompact', file: 'hive-recall-compact.js', args: '' },
  { event: 'SessionStart', file: 'hive-recall-session.js', args: ' start' },
  { event: 'SessionEnd', file: 'hive-recall-session.js', args: ' end' },
];

for (const { event, file, args } of recallHooks) {
  const command = isGlobal
    ? buildHookCommand(targetDir, file) + args
    : 'node ' + dirName + '/hooks/' + file + args;

  if (!settings.hooks[event]) {
    settings.hooks[event] = [];
  }

  const alreadyRegistered = settings.hooks[event].some(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes(file))
  );

  if (!alreadyRegistered) {
    settings.hooks[event].push({
      hooks: [{ type: 'command', command }]
    });
  }
}

console.log(`  ${green}✓${reset} Configured Recall hooks`);
```

### Uninstall Hook File Cleanup (modify line 855)
```javascript
// Source: install.js line 855, extended for Recall hooks
const gsdHooks = [
  'hive-statusline.js', 'hive-check-update.js', 'hive-check-update.sh',
  'hive-recall-agent.js', 'hive-recall-error.js',
  'hive-recall-compact.js', 'hive-recall-session.js'
];
```

### Uninstall settings.json Cleanup (modify lines 884-908)
```javascript
// Source: install.js lines 884-908, extended for all Recall hook events
// Remove Hive hooks from ALL event types (not just SessionStart)
if (settings.hooks) {
  const hiveHookPatterns = ['hive-check-update', 'hive-statusline', 'hive-recall'];
  let settingsModified = false;

  for (const eventType of Object.keys(settings.hooks)) {
    if (Array.isArray(settings.hooks[eventType])) {
      const before = settings.hooks[eventType].length;
      settings.hooks[eventType] = settings.hooks[eventType].filter(entry => {
        if (entry.hooks && Array.isArray(entry.hooks)) {
          return !entry.hooks.some(h =>
            h.command && hiveHookPatterns.some(pattern => h.command.includes(pattern))
          );
        }
        return true;
      });
      if (settings.hooks[eventType].length < before) {
        settingsModified = true;
      }
      // Clean up empty arrays
      if (settings.hooks[eventType].length === 0) {
        delete settings.hooks[eventType];
      }
    }
  }

  if (settingsModified) {
    console.log(`  ${green}✓${reset} Removed Hive hooks from settings`);
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
}
```

### Config Ensure Section Update (modify hive-tools.js lines 711-725)
```javascript
// Source: hive-tools.js cmdConfigEnsureSection, add telemetry section
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
```

## Exact Files to Modify

| File | Lines | Change | Requirement |
|------|-------|--------|-------------|
| `bin/install.js` | After 1479 | Add Recall hook registration block (5 events) | INST-02 |
| `bin/install.js` | 855 | Add 4 recall hooks to uninstall file list | INST-02 (cleanup) |
| `bin/install.js` | 884-908 | Extend uninstall settings cleanup to all event types | INST-02 (cleanup) |
| `hive/bin/hive-tools.js` | 711-725 | Add `telemetry` to cmdConfigEnsureSection defaults | INST-03 |

**Files that do NOT need modification:**
- `hooks/hive-recall-*.js` -- Already exist and verified (Phase 2)
- `scripts/build-hooks.js` -- Already includes all 4 Recall hooks in HOOKS_TO_COPY
- `hooks/dist/` -- Build artifact; built by `npm run build:hooks` (already configured)
- `hive/templates/config.json` -- Already has telemetry section
- `package.json` -- Already includes `hooks/dist` in `files` array, already has `build:hooks` script

## Verification Strategy

### Success Criteria Testing

**SC-1: Hook files present after install**
```bash
# After: npx hive-cc --claude --global
ls ~/.claude/hooks/hive-recall-*.js
# Expected: 4 files (agent, error, compact, session)
```
Already satisfied by existing pipeline (hooks/dist/ + installer copy). No new code needed.

**SC-2: settings.json hook registrations**
```bash
# After install, settings.json should contain:
cat ~/.claude/settings.json | node -e "
  const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('SubagentStop:', !!s.hooks?.SubagentStop);
  console.log('PostToolUseFailure:', !!s.hooks?.PostToolUseFailure);
  console.log('PreCompact:', !!s.hooks?.PreCompact);
  console.log('SessionStart entries:', s.hooks?.SessionStart?.length);  // Should be 2
  console.log('SessionEnd:', !!s.hooks?.SessionEnd);
"
```

**SC-3: Config telemetry section**
```bash
# After config-ensure-section, config.json should have telemetry:
cat .planning/config.json | node -e "
  const c = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('telemetry section:', !!c.telemetry);
  console.log('enabled:', c.telemetry?.enabled);
  console.log('hooks:', c.telemetry?.hooks);
"
```

### Re-install Idempotency Testing
```bash
# Run install twice -- should not create duplicate registrations
npx hive-cc --claude --global
npx hive-cc --claude --global
# Verify SessionStart has exactly 2 entries (check-update + recall-session), not 3 or 4
```

### Uninstall Completeness Testing
```bash
# After: npx hive-cc --claude --global --uninstall
ls ~/.claude/hooks/hive-recall-*.js 2>/dev/null  # Should be empty
cat ~/.claude/settings.json  # Should have no SubagentStop, PostToolUseFailure, etc.
```

## Open Questions

1. **Local install path for session hook argument**
   - What we know: For global installs, `buildHookCommand()` wraps the path in quotes: `node "/path/to/hooks/hive-recall-session.js"`. Appending ` start` after the closing quote works: `node "/path/to/hooks/hive-recall-session.js" start`.
   - What's unclear: Whether Claude Code correctly parses the command with the argument after the quoted path.
   - Recommendation: LOW risk -- the `.claude/settings.json` in the repo already uses this pattern (line 46: `"node .claude/hooks/hive-recall-session.js start"`). Verified working in Phase 2.

2. **Whether to log individual hook names or a single summary**
   - What we know: The existing installer logs `"Configured update check hook"` for one hook. Adding 5 separate log lines for recall hooks may be verbose.
   - Recommendation: Use a single log line: `"Configured Recall hooks"` (or `"Configured 5 Recall hooks"`). This matches the existing pattern where hook file copying is logged as one line (`"Installed hooks (bundled)"`), not per-file.

## Sources

### Primary (HIGH confidence)
- `bin/install.js` -- Full installer source, lines 1408-1489 (hook copy + registration), lines 852-915 (uninstall)
- `scripts/build-hooks.js` -- Build script already including all 4 recall hooks
- `hooks/hive-recall-*.js` -- The 4 hook source files (verified in Phase 2)
- `.claude/settings.json` -- Working hook registration format (verified in Phase 2)
- `hive/templates/config.json` -- Template already including telemetry section
- `hive/bin/hive-tools.js` -- `cmdConfigEnsureSection` function (lines 685-734)
- `package.json` -- `files` array includes `hooks/dist`, build script configured
- `.planning/phases/02-hook-observers/02-VERIFICATION.md` -- Phase 2 verification confirming all hooks work

### Secondary (MEDIUM confidence)
- `.planning/SELF-IMPROVEMENT-PROPOSAL.md` -- Original design showing `bin/install.js` as installer target
- `.planning/REQUIREMENTS.md` -- INST-01, INST-02, INST-03 requirement definitions
- `.planning/ROADMAP.md` -- Phase 5 success criteria

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Pure install.js modification, all patterns already established in existing code
- Architecture: HIGH -- Every building block exists; this is composition of existing patterns
- Pitfalls: HIGH -- Each pitfall identified from actual codebase inspection (line numbers verified)
- Code examples: HIGH -- All examples follow existing installer patterns with exact line references

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (installer is stable; hook system is stable)
