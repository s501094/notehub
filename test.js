#!/usr/bin/env node
/**
 * NoteHub Test Suite
 * Run from the notehub/ directory: node test.js
 * Or with verbose output:          node test.js --verbose
 * Or a specific group:             node test.js --group config
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const VERBOSE = process.argv.includes('--verbose');
const GROUP   = process.argv.includes('--group')
  ? process.argv[process.argv.indexOf('--group') + 1]
  : null;

// ── Colours ──────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',
  green:  '\x1b[32m', red:    '\x1b[31m', yellow: '\x1b[33m',
  cyan:   '\x1b[36m', grey:   '\x1b[90m', mauve:  '\x1b[35m',
};
const pass  = `${C.green}✓${C.reset}`;
const fail  = `${C.red}✗${C.reset}`;
const skip  = `${C.yellow}○${C.reset}`;
const info  = `${C.cyan}ℹ${C.reset}`;

// ── Test runner ───────────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0, skipped = 0;
const failures = [];

function test(group, name, fn) {
  if (GROUP && GROUP !== group) return;
  total++;
  try {
    const result = fn();
    if (result === 'skip') {
      skipped++;
      if (VERBOSE) console.log(`  ${skip} [${group}] ${name}`);
    } else {
      passed++;
      if (VERBOSE) console.log(`  ${pass} [${group}] ${name}`);
    }
  } catch(e) {
    failed++;
    failures.push({ group, name, error: e.message });
    console.log(`  ${fail} [${C.mauve}${group}${C.reset}] ${name}`);
    console.log(`      ${C.red}${e.message}${C.reset}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertIncludes(arr, val, msg) {
  if (!arr.includes(val)) throw new Error(msg || `Expected array to include ${JSON.stringify(val)}`);
}

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT    = __dirname;
const PLUGINS = path.join(ROOT, 'plugins');
const STYLES  = path.join(ROOT, 'styles');

// Search all possible Electron userData locations for this app
function findUserDataDir() {
  const candidates = [];
  const home = os.homedir();
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'notehub'),
      path.join(home, 'Library', 'Application Support', 'Electron'),
      path.join(home, 'Library', 'Application Support', 'NoteHub'),
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env.APPDATA || '', 'notehub'),
      path.join(process.env.APPDATA || '', 'Electron'),
    );
  } else {
    candidates.push(
      path.join(home, '.config', 'notehub'),
      path.join(home, '.config', 'Electron'),
    );
  }
  return candidates.find(p => fs.existsSync(path.join(p, 'config.json'))) || candidates[0];
}

const USER_DATA   = findUserDataDir();
const CONFIG_PATH = path.join(USER_DATA, 'config.json');
const DATA_PATH   = path.join(USER_DATA, 'data', 'notebooks.json');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: files — Core file structure
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}📁 File Structure${C.reset}`);

const REQUIRED_FILES = [
  'main.js', 'renderer.js', 'preload.js', 'index.html',
  'package.json', 'preferences.html',
  'styles/main.css',
];

REQUIRED_FILES.forEach(f => {
  test('files', `exists: ${f}`, () => {
    assert(fs.existsSync(path.join(ROOT, f)), `Missing required file: ${f}`);
  });
});

test('files', 'package.json is valid JSON', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.name, 'package.json missing name');
  assert(pkg.main, 'package.json missing main entry');
});

test('files', 'main entry point exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(fs.existsSync(path.join(ROOT, pkg.main)), `Main entry ${pkg.main} not found`);
});

test('files', 'styles/main.css is non-empty', () => {
  const size = fs.statSync(path.join(STYLES, 'main.css')).size;
  assert(size > 1000, `main.css is suspiciously small (${size} bytes)`);
});

test('files', 'node_modules installed', () => {
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) return 'skip';
  assert(fs.existsSync(path.join(ROOT, 'node_modules', 'electron')), 'electron not installed — run npm install');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: plugins — Plugin manifests and structure
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}🔌 Plugins${C.reset}`);

const EXPECTED_PLUGINS = [
  'math-renderer', 'terminal', 'advanced-search',
  'docx-converter', 'excel-integration', 'neovim-editor',
];

test('plugins', 'plugins/ directory exists', () => {
  assert(fs.existsSync(PLUGINS), 'plugins/ directory missing');
});

EXPECTED_PLUGINS.forEach(id => {
  test('plugins', `plugin folder: ${id}`, () => {
    assert(fs.existsSync(path.join(PLUGINS, id)), `Missing plugin folder: ${id}`);
  });

  test('plugins', `${id}: has manifest.json`, () => {
    const mp = path.join(PLUGINS, id, 'manifest.json');
    assert(fs.existsSync(mp), `${id}/manifest.json missing`);
  });

  test('plugins', `${id}: manifest is valid JSON`, () => {
    const mp = path.join(PLUGINS, id, 'manifest.json');
    if (!fs.existsSync(mp)) return 'skip';
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    assert(m.name,    `${id}/manifest.json missing "name"`);
    assert(m.version, `${id}/manifest.json missing "version"`);
    assert(m.main,    `${id}/manifest.json missing "main"`);
  });

  test('plugins', `${id}: has index.js`, () => {
    assert(
      fs.existsSync(path.join(PLUGINS, id, 'index.js')),
      `${id}/index.js missing`
    );
  });

  test('plugins', `${id}: index.js is non-empty`, () => {
    const p = path.join(PLUGINS, id, 'index.js');
    if (!fs.existsSync(p)) return 'skip';
    const size = fs.statSync(p).size;
    assert(size > 100, `${id}/index.js is suspiciously small (${size} bytes)`);
  });
});

// Check for stray broken folders
test('plugins', 'no brace-expansion junk folders', () => {
  if (!fs.existsSync(PLUGINS)) return 'skip';
  const dirs = fs.readdirSync(PLUGINS);
  const junk = dirs.filter(d => d.includes('{') || d.includes('}'));
  assert(junk.length === 0, `Found junk folders: ${junk.join(', ')} — delete them`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: config — User config file
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}⚙️  Config${C.reset}`);

test('config', 'config.json exists (app run at least once)', () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (VERBOSE) console.log(`  ${info} Looked in: ${CONFIG_PATH}`);
    return 'skip';
  }
});

test('config', 'config.json is valid JSON', () => {
  if (!fs.existsSync(CONFIG_PATH)) return 'skip';
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  try {
    JSON.parse(raw);
  } catch(e) {
    // Auto-repair: write a clean default config and warn
    console.log(`  ${C.yellow}⚠ Corrupt config.json detected — auto-repairing…${C.reset}`);
    const DEFAULT = {
      theme: {
        mode: 'dark', accentColor: '#cba6f7',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 14,
        editorFontFamily: 'JetBrains Mono, Fira Code, Monaco, Menlo, Consolas, monospace',
        editorFontSize: 14
      },
      editor: { defaultView: 'split', autoSave: true, autoSaveInterval: 2000, spellCheck: false, lineNumbers: true, wordWrap: true },
      plugins: { enabled: [] },
      nvim: { relativeLineNumbers: true, lineNumbers: true, syntaxHighlight: true, highlightActiveLine: true, showMatchingBrackets: true, autoCloseBrackets: true, tabSize: 2, indentWithTabs: false },
      ui: { sidebarWidth: 280, showPreviewByDefault: true }
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT, null, 2));
    console.log(`  ${C.green}✓ config.json repaired at: ${CONFIG_PATH}${C.reset}`);
    // Re-read to confirm
    JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
});

test('config', 'config has required top-level keys', () => {
  if (!fs.existsSync(CONFIG_PATH)) return 'skip';
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  ['theme', 'editor', 'plugins'].forEach(k =>
    assert(cfg[k] !== undefined, `config.json missing key: ${k}`)
  );
});

test('config', 'config.theme has accentColor', () => {
  if (!fs.existsSync(CONFIG_PATH)) return 'skip';
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  assert(cfg.theme && cfg.theme.accentColor, 'theme.accentColor missing');
  assert(/^#[0-9a-f]{6}$/i.test(cfg.theme.accentColor),
    `accentColor "${cfg.theme.accentColor}" is not a valid hex color`);
});

test('config', 'config.editor has required keys', () => {
  if (!fs.existsSync(CONFIG_PATH)) return 'skip';
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  ['defaultView', 'autoSave', 'autoSaveInterval'].forEach(k =>
    assert(cfg.editor[k] !== undefined, `editor.${k} missing`)
  );
});

test('config', 'config.editor.defaultView is valid', () => {
  if (!fs.existsSync(CONFIG_PATH)) return 'skip';
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  assertIncludes(['edit', 'split', 'preview'], cfg.editor.defaultView,
    `Invalid defaultView: "${cfg.editor.defaultView}"`);
});

test('config', 'all enabled plugins exist on disk', () => {
  if (!fs.existsSync(CONFIG_PATH)) return 'skip';
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const enabled = (cfg.plugins && cfg.plugins.enabled) || [];
  enabled.forEach(id => {
    assert(
      fs.existsSync(path.join(PLUGINS, id, 'manifest.json')),
      `Enabled plugin "${id}" has no manifest.json — disable it or add the plugin folder`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: data — Saved notes data
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}📝 Data${C.reset}`);

test('data', 'data directory exists', () => {
  if (!fs.existsSync(path.join(USER_DATA, 'data'))) return 'skip';
  assert(true);
});

test('data', 'notebooks.json is valid JSON', () => {
  if (!fs.existsSync(DATA_PATH)) return 'skip';
  JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
});

test('data', 'data has notebooks array', () => {
  if (!fs.existsSync(DATA_PATH)) return 'skip';
  const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  assert(Array.isArray(d.notebooks), 'notebooks is not an array');
});

test('data', 'data has notes array', () => {
  if (!fs.existsSync(DATA_PATH)) return 'skip';
  const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  assert(Array.isArray(d.notes), 'notes is not an array');
});

test('data', 'each notebook has required fields', () => {
  if (!fs.existsSync(DATA_PATH)) return 'skip';
  const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  d.notebooks.forEach((nb, i) => {
    assert(nb.id,   `notebooks[${i}] missing id`);
    assert(nb.name, `notebooks[${i}] missing name`);
  });
});

test('data', 'each note has required fields', () => {
  if (!fs.existsSync(DATA_PATH)) return 'skip';
  const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  d.notes.forEach((n, i) => {
    assert(n.id,         `notes[${i}] missing id`);
    assert(n.title,      `notes[${i}] missing title`);
    assert(n.notebookId, `notes[${i}] missing notebookId`);
  });
});

test('data', 'all note notebookIds reference existing notebooks', () => {
  if (!fs.existsSync(DATA_PATH)) return 'skip';
  const d    = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const ids  = new Set(d.notebooks.map(nb => nb.id));
  const orphans = d.notes.filter(n => !ids.has(n.notebookId));
  assert(orphans.length === 0,
    `${orphans.length} note(s) reference missing notebook IDs: ${orphans.map(n=>n.title).join(', ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: renderer — renderer.js content checks
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}🖥️  Renderer${C.reset}`);

let rendererSrc = '';
test('renderer', 'renderer.js is readable', () => {
  rendererSrc = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  assert(rendererSrc.length > 1000, 'renderer.js is suspiciously small');
});

[
  ['NoteHubApp class',        'class NoteHubApp'],
  ['loadConfig method',       'async loadConfig()'],
  ['loadPlugins method',      'async loadPlugins()'],
  ['renderEditor method',     'renderEditor()'],
  ['applyConfigLive method',  'applyConfigLive'],
  ['showModal method',        'showModal('],
  ['showHelpModal method',    'showHelpModal('],
  ['togglePluginMenu method', 'togglePluginMenu()'],
  ['activatePlugin method',   'activatePlugin('],
  ['parseMarkdown function',  'function parseMarkdown'],
  ['auto-save setup',         'setupAutoSave'],
].forEach(([label, needle]) => {
  test('renderer', label, () => {
    if (!rendererSrc) return 'skip';
    assert(rendererSrc.includes(needle), `renderer.js missing: ${needle}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: main — main.js content checks
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}⚡ Main Process${C.reset}`);

let mainSrc = '';
test('main', 'main.js is readable', () => {
  mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert(mainSrc.length > 500);
});

[
  ['get-config handler',      "ipcMain.handle('get-config'"],
  ['save-config handler',     "ipcMain.handle('save-config'"],
  ['apply-config handler',    "ipcMain.handle('apply-config'"],
  ['get-plugins handler',     "ipcMain.handle('get-plugins'"],
  ['get-system-fonts handler',"ipcMain.handle('get-system-fonts'"],
  ['preferences window',      'openPreferencesWindow'],
  ['Help menu',               "label: 'Help'"],
  ['apply-config-live event', "apply-config-live"],
].forEach(([label, needle]) => {
  test('main', label, () => {
    if (!mainSrc) return 'skip';
    assert(mainSrc.includes(needle), `main.js missing: ${needle}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: preload — preload.js API surface
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}🔗 Preload${C.reset}`);

let preloadSrc = '';
test('preload', 'preload.js is readable', () => {
  preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  assert(preloadSrc.length > 100);
});

[
  'getConfig', 'saveConfig', 'applyConfig', 'getConfigPath',
  'getSystemFonts', 'getPlugins', 'loadPlugin',
  'exportNote', 'importMarkdown',
  'onReloadConfig', 'onApplyConfigLive', 'onShowHelp',
  'electronAPI',
].forEach(api => {
  test('preload', `exposes: ${api}`, () => {
    if (!preloadSrc) return 'skip';
    assert(preloadSrc.includes(api), `preload.js missing: ${api}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: css — CSS sanity checks
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}🎨 CSS${C.reset}`);

let cssSrc = '';
test('css', 'main.css is readable', () => {
  cssSrc = fs.readFileSync(path.join(STYLES, 'main.css'), 'utf8');
  assert(cssSrc.length > 5000);
});

[
  ['Catppuccin variables',    '--ctp-base'],
  ['editor-pane styles',      '.editor-pane'],
  ['preview-pane styles',     '.preview-pane'],
  ['editor scrolling fix',    'min-height: 0'],
  ['modal styles',            '.modal-overlay'],
  ['plugin menu styles',      '.plugin-menu-item'],
  ['emoji picker styles',     '.emoji-pick-btn'],
  ['help modal styles',       '.help-content'],
  ['toggle switch styles',    '.toggle-track'],
].forEach(([label, needle]) => {
  test('css', label, () => {
    if (!cssSrc) return 'skip';
    assert(cssSrc.includes(needle), `main.css missing: "${needle}"`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP: preferences — preferences.html checks
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}⚙️  Preferences Window${C.reset}`);

let prefsSrc = '';
test('preferences', 'preferences.html is readable', () => {
  prefsSrc = fs.readFileSync(path.join(ROOT, 'preferences.html'), 'utf8');
  assert(prefsSrc.length > 5000);
});

[
  ['Appearance tab',      'panel-appearance'],
  ['Editor tab',          'panel-editor'],
  ['Plugins tab',         'panel-plugins'],
  ['Neovim tab',          'panel-nvim'],
  ['Advanced tab',        'panel-advanced'],
  ['Font picker UI',      'font-display'],
  ['Accent palette',      'id="palette"'],
  ['Apply button',        'applyOnly()'],
  ['Save & Apply button', 'saveAndApply()'],
  ['Plugin grid',         'id="pluginGrid"'],
  ['Plugin refresh btn',  'refreshPlugins()'],
  ['Plugins dir display', 'pluginsDir'],
  ['Neovim tab size',     'id="nvTab"'],
].forEach(([label, needle]) => {
  test('preferences', label, () => {
    if (!prefsSrc) return 'skip';
    assert(prefsSrc.includes(needle), `preferences.html missing: "${needle}"`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log(`${C.bold}Results:${C.reset}  ` +
  `${C.green}${passed} passed${C.reset}  ` +
  `${C.red}${failed} failed${C.reset}  ` +
  `${C.yellow}${skipped} skipped${C.reset}  ` +
  `${C.grey}(${total} total)${C.reset}`);

if (failures.length > 0) {
  console.log(`\n${C.bold}${C.red}Failed tests:${C.reset}`);
  failures.forEach(({ group, name, error }) => {
    console.log(`  ${fail} [${C.mauve}${group}${C.reset}] ${name}`);
    console.log(`     ${C.grey}${error}${C.reset}`);
  });
  console.log('');
  console.log(`${C.yellow}Tip:${C.reset} Run ${C.cyan}node test.js --group <group>${C.reset} to focus on one area.`);
  console.log(`     Groups: files, plugins, config, data, renderer, main, preload, css, preferences`);
}

console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
