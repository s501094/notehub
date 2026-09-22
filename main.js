const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const crypto = require('crypto');

let mainWindow;
let prefsWindow = null;
let configPath;
let dataPath;
let backgroundsPath;
let attachmentsPath;

// ── Default config ─────────────────────────────────────────────────────────
// Returned as a fresh object each time so the four per-section presets are
// never the same mutable reference.
const GLASS_DEFAULTS = () => ({
  bgAlpha: 72, blur: 18, saturate: 92, dim: 35, noise: 40, radius: 10, shadowAlpha: 22,
});

const DEFAULT_CONFIG = {
  theme: {
    mode: 'dark',
    preset: 'catppuccin-mocha',
    accentColor: '#cba6f7',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
    // Prose in the preview pane. Kept separate from fontFamily so a monospace
    // choice for the editor never turns rendered notes monospace as well.
    readingFontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    editorFontFamily: 'JetBrains Mono, Fira Code, Monaco, Menlo, Consolas, monospace',
    editorFontSize: 14,
    brightPanel: true
  },
  editor: {
    defaultView: 'split',
    autoSave: true,
    autoSaveInterval: 2000,
    spellCheck: false,
    lineNumbers: true,
    relativeLineNumbers: false,
    wordWrap: true,
    vimMode: false,
    vimKeybindings: []
  },
  plugins: { enabled: [] },
  nvim: {
    relativeLineNumbers: true,
    lineNumbers: true,
    syntaxHighlight: true,
    highlightActiveLine: true,
    showMatchingBrackets: true,
    autoCloseBrackets: true,
    tabSize: 2,
    indentWithTabs: false
  },
  ui: {
    sidebarWidth: 280,
    sidebarCollapsed: false,
    notebooksCollapsed: false,
    notesCollapsed: false,
    showPreviewByDefault: true
  },
  appearance: {
    glassMode: 'unified', // 'unified' | 'per-section'
    // Glass defaults describe the effect the feature is named after. The old
    // defaults (100% opaque, 0px blur) meant a fresh install showed no glass
    // at all until the user found the sliders.
    //
    //   bgAlpha     panel tint opacity, %      (lower = more wallpaper shows)
    //   blur        backdrop blur, px
    //   saturate    backdrop chroma, %         (<100 calms a busy wallpaper)
    //   dim         backdrop darkening, %      (protects text on bright images)
    //   noise       grain overlay strength, %  (kills the flat "CSS glass" look)
    //   radius      window corner radius, px
    //   shadowAlpha panel drop shadow, %
    glass:         GLASS_DEFAULTS(),
    glassSections: {
      sidebar: GLASS_DEFAULTS(),
      editor:  GLASS_DEFAULTS(),
      preview: GLASS_DEFAULTS(),
      panels:  GLASS_DEFAULTS(),
    },
    // `scrim` darkens the wallpaper itself, independently of panel opacity, so
    // a high-contrast photo can be tamed without making the panels opaque.
    background: { enabled: false, path: '', fit: 'cover', opacity: 100, blur: 0, scrim: 45 },
    // One switch back to legible: forces panels opaque and blur off for
    // rendering without overwriting the user's stored slider values.
    reduceTransparency: false,
    customCSS: '',
  }
};

// ── App directories ────────────────────────────────────────────────────────
function initAppDirectories() {
  const userDataPath = app.getPath('userData');
  configPath = path.join(userDataPath, 'config.json');
  dataPath   = path.join(userDataPath, 'data');
  backgroundsPath = path.join(userDataPath, 'backgrounds');
  attachmentsPath = path.join(userDataPath, 'attachments');

  if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
  if (!fs.existsSync(backgroundsPath)) fs.mkdirSync(backgroundsPath, { recursive: true });
  if (!fs.existsSync(attachmentsPath)) fs.mkdirSync(attachmentsPath, { recursive: true });

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

// Recursively fill in keys the stored config is missing from `base`.
// Plain objects merge; arrays and scalars are taken wholesale from the
// override, so a user's `plugins.enabled: []` is never re-populated from the
// defaults.
function mergeDefaults(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const out = Array.isArray(base) ? [] : { ...base };
  for (const key of Object.keys(override)) {
    const b = base ? base[key] : undefined;
    const o = override[key];
    out[key] = (b && typeof b === 'object' && !Array.isArray(b) &&
                o && typeof o === 'object' && !Array.isArray(o))
      ? mergeDefaults(b, o)
      : (o === undefined ? b : o);
  }
  return out;
}

// The stored config is merged *onto* DEFAULT_CONFIG rather than used directly.
//
// This is load-bearing. Without it, a config.json written before a setting
// existed is missing that key forever -- reading as `undefined`, which every
// boolean consumer then treats as false. That is how `editor.wordWrap` shipped
// off despite defaulting to true: nothing rewrites the file on upgrade, so the
// key simply never appeared. Any setting added after a user's first launch has
// the same failure mode, silently, with no error to trace.
function readConfig() {
  try {
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return mergeDefaults(DEFAULT_CONFIG, stored);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function sanitizeConfig(cfg) {
  // Deep clone to avoid mutating the input
  const c = JSON.parse(JSON.stringify(cfg));

  // Sanitize string fields that might contain problematic characters
  if (c.theme) {
    // Strip control characters and newlines from font strings
    ['fontFamily', 'editorFontFamily', 'readingFontFamily'].forEach(k => {
      if (typeof c.theme[k] === 'string') {
        c.theme[k] = c.theme[k].replace(/[\x00-\x1F\x7F]/g, '').trim();
      }
    });
    // Validate accentColor is a proper hex
    if (typeof c.theme.accentColor === 'string' &&
        !/^#[0-9a-f]{6}$/i.test(c.theme.accentColor)) {
      c.theme.accentColor = '#cba6f7';
    }
    // Validate theme preset
    const validPresets = ['catppuccin-mocha', 'tokyo-night', 'custom'];
    if (!validPresets.includes(c.theme.preset)) {
      c.theme.preset = 'catppuccin-mocha';
    }
    // Clamp font sizes
    if (typeof c.theme.fontSize === 'number') {
      c.theme.fontSize = Math.max(10, Math.min(32, c.theme.fontSize));
    }
    if (typeof c.theme.editorFontSize === 'number') {
      c.theme.editorFontSize = Math.max(10, Math.min(32, c.theme.editorFontSize));
    }
    // Atmosphere's bright editor panel. Default on (it's the spec'd look),
    // but stored explicitly so an unset config doesn't read as "off".
    c.theme.brightPanel = c.theme.brightPanel !== false;
    // Off by default: the markup characters keep their own token colour.
    c.theme.dimMarkup = c.theme.dimMarkup === true;
  }
  if (c.editor) {
    const valid = ['edit', 'split', 'preview'];
    if (!valid.includes(c.editor.defaultView)) c.editor.defaultView = 'split';
    if (typeof c.editor.autoSaveInterval !== 'number' ||
        c.editor.autoSaveInterval < 500) c.editor.autoSaveInterval = 2000;
    c.editor.vimMode = !!c.editor.vimMode;
    // Default-on booleans use `!== false` so a missing key reads as its
    // documented default instead of as false. readConfig's merge should have
    // supplied them already; this is the backstop for a config written by an
    // older build or edited by hand.
    c.editor.wordWrap   = c.editor.wordWrap   !== false;
    c.editor.spellCheck = c.editor.spellCheck === true;   // defaults off
    c.editor.lineNumbers = c.editor.lineNumbers !== false;
    c.editor.autoSave   = c.editor.autoSave   !== false;
    // Each entry maps a Vim-mode key sequence (e.g. "jj", "<Space>w") to an
    // existing command-palette action id -- both are free text but capped
    // in length so a malformed config can't bloat the file or feed CM's
    // Vim.map an absurd string.
    const validVimModes = ['normal', 'insert', 'visual'];
    c.editor.vimKeybindings = Array.isArray(c.editor.vimKeybindings)
      ? c.editor.vimKeybindings
          .filter(kb => kb && typeof kb.action === 'string' && typeof kb.keys === 'string')
          .map(kb => ({
            action: kb.action.slice(0, 60),
            keys: kb.keys.slice(0, 40),
            mode: validVimModes.includes(kb.mode) ? kb.mode : 'normal',
          }))
          .filter(kb => kb.action && kb.keys)
      : [];
  }
  if (c.ui) {
    if (typeof c.ui.sidebarWidth === 'number') {
      c.ui.sidebarWidth = Math.max(160, Math.min(600, c.ui.sidebarWidth));
    }
    c.ui.sidebarCollapsed = !!c.ui.sidebarCollapsed;
    c.ui.notebooksCollapsed = !!c.ui.notebooksCollapsed;
    c.ui.notesCollapsed = !!c.ui.notesCollapsed;
  }
  if (c.nvim) {
    c.nvim.lineNumbers = c.nvim.lineNumbers !== false;
    c.nvim.relativeLineNumbers = c.nvim.relativeLineNumbers !== false;
    c.nvim.syntaxHighlight = c.nvim.syntaxHighlight !== false;
    c.nvim.highlightActiveLine = c.nvim.highlightActiveLine !== false;
    c.nvim.showMatchingBrackets = c.nvim.showMatchingBrackets !== false;
    c.nvim.autoCloseBrackets = c.nvim.autoCloseBrackets !== false;
    c.nvim.indentWithTabs = !!c.nvim.indentWithTabs;
    c.nvim.tabSize = Math.max(1, Math.min(8, Number(c.nvim.tabSize) || 2));
  } else {
    c.nvim = JSON.parse(JSON.stringify(DEFAULT_CONFIG.nvim));
  }
  if (c.appearance) {
    const a = c.appearance;
    a.glassMode = a.glassMode === 'per-section' ? 'per-section' : 'unified';
    // `num` keeps a stored 0 as 0 -- `Number(x) || d` would silently promote a
    // deliberate zero back to the default, which is how a slider dragged to
    // the far left can appear to do nothing.
    const num = (v, d) => (v === undefined || v === null || Number.isNaN(Number(v)) ? d : Number(v));
    const clampGlass = (g) => {
      g = g && typeof g === 'object' ? g : {};
      const d = GLASS_DEFAULTS();
      return {
        bgAlpha:     Math.max(0,  Math.min(100, num(g.bgAlpha, d.bgAlpha))),
        blur:        Math.max(0,  Math.min(60,  num(g.blur, d.blur))),
        // Capped at 140, not 200. Saturation here sits in the *backdrop*
        // filter, so values above ~140 amplify the wallpaper's chroma -- the
        // exact colour energy that competes with the text in front of it.
        // Glass calms what is behind it; it does not amplify it.
        saturate:    Math.max(40, Math.min(140, num(g.saturate, d.saturate))),
        dim:         Math.max(0,  Math.min(80,  num(g.dim, d.dim))),
        noise:       Math.max(0,  Math.min(100, num(g.noise, d.noise))),
        radius:      Math.max(0,  Math.min(32,  num(g.radius, d.radius))),
        shadowAlpha: Math.max(0,  Math.min(100, num(g.shadowAlpha, d.shadowAlpha))),
      };
    };
    a.glass = clampGlass(a.glass);
    const sec = a.glassSections && typeof a.glassSections === 'object' ? a.glassSections : {};
    a.glassSections = {
      sidebar: clampGlass(sec.sidebar),
      editor:  clampGlass(sec.editor),
      preview: clampGlass(sec.preview),
      panels:  clampGlass(sec.panels),
    };
    const bg = a.background && typeof a.background === 'object' ? a.background : {};
    const validFit = ['cover', 'contain', 'repeat', 'center'];
    a.background = {
      enabled: !!bg.enabled,
      path:    typeof bg.path === 'string' ? bg.path.slice(0, 1000) : '',
      fit:     validFit.includes(bg.fit) ? bg.fit : 'cover',
      opacity: Math.max(0, Math.min(100, num(bg.opacity, 100))),
      blur:    Math.max(0, Math.min(40,  num(bg.blur, 0))),
      scrim:   Math.max(0, Math.min(90,  num(bg.scrim, 45))),
    };
    a.reduceTransparency = a.reduceTransparency === true;
    // Generous but bounded -- this is raw CSS applied verbatim to the
    // renderer, not sanitized for content, only capped so a runaway paste
    // can't bloat config.json.
    a.customCSS = typeof a.customCSS === 'string' ? a.customCSS.slice(0, 50000) : '';
  } else {
    c.appearance = JSON.parse(JSON.stringify(DEFAULT_CONFIG.appearance));
  }
  // Ensure plugins.enabled is a plain array of strings
  if (!c.plugins || !Array.isArray(c.plugins.enabled)) {
    c.plugins = { enabled: [] };
  }
  c.plugins.enabled = c.plugins.enabled.filter(x => typeof x === 'string');
  return c;
}

function writeConfig(cfg) {
  try {
    const clean = sanitizeConfig(cfg);
    const json  = JSON.stringify(clean, null, 2);
    // Validate before writing — never write bad JSON
    JSON.parse(json);
    // Same durable-replace path as the note data. A truncated config.json is
    // not catastrophic the way lost notes are, but it silently resets every
    // preference the user has ever set, which is its own kind of data loss.
    // Kept pretty-printed: this file is small and people do edit it by hand.
    writeFileDurable(configPath, json);
  } catch(e) {
    console.error('[NoteHub] writeConfig failed, skipping write:', e.message);
  }
}

// ── Preferences window ─────────────────────────────────────────────────────
function openPreferencesWindow() {
  if (prefsWindow && !prefsWindow.isDestroyed()) {
    prefsWindow.focus();
    return;
  }

  prefsWindow = new BrowserWindow({
    width: 780,
    height: 680,
    minWidth: 640,
    minHeight: 500,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#1e1e2e',
    parent: mainWindow,
    modal: false,
    resizable: true,
    title: 'NoteHub Preferences',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#11111b',
      symbolColor: '#cdd6f4',
      height: 36
    }
  });

  prefsWindow.loadFile('preferences.html');
  prefsWindow.on('closed', () => { prefsWindow = null; });
}

// ── Open config.json in default code editor ────────────────────────────────
function openConfigInEditor() {
  // On macOS shell.openPath will use the default app for .json
  // We force VS Code if available, otherwise fall back to default
  const editors = [
    '/usr/local/bin/code',
    '/usr/bin/code',
    '/opt/homebrew/bin/code',
    process.env.EDITOR
  ].filter(Boolean);

  let opened = false;
  for (const editor of editors) {
    if (fs.existsSync(editor)) {
      require('child_process').spawn(editor, [configPath], { detached: true });
      opened = true;
      break;
    }
  }
  if (!opened) shell.openPath(configPath);
}

// ── OS-level window translucency ───────────────────────────────────────────
// Only two platforms can actually blur what's *behind* the window: macOS via
// vibrancy, and Windows 11 22H2+ via backgroundMaterial. Everywhere else
// (Windows 10, Linux) the option is silently ignored and the window stays
// opaque -- so the renderer needs to know which case it's in to decide
// whether to paint its own gradient backdrop instead. See applyGlassAppearance().
function osTranslucency() {
  if (process.platform === 'darwin') return { supported: true, kind: 'vibrancy' };
  if (process.platform === 'win32') {
    // backgroundMaterial needs Windows 11 22H2, which is NT 10.0 build 22621.
    const build = Number((os.release().split('.')[2] || '0'));
    if (build >= 22621) return { supported: true, kind: 'acrylic' };
  }
  return { supported: false, kind: 'none' };
}

// ── Main window ────────────────────────────────────────────────────────────
function createWindow() {
  const translucency = osTranslucency();
  const glassOpts = {};
  if (translucency.kind === 'vibrancy') {
    glassOpts.vibrancy = 'under-window';
    glassOpts.visualEffectState = 'active';
  } else if (translucency.kind === 'acrylic') {
    glassOpts.backgroundMaterial = 'acrylic';
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.png'),
    // A material/vibrancy only shows through if the window itself isn't
    // painting an opaque colour over it.
    backgroundColor: translucency.supported ? '#00000000' : '#1e1e2e',
    ...glassOpts,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#11111b',
      symbolColor: '#cdd6f4',
      height: 40
    }
  });

  // Electron applies backgroundMaterial at construction inconsistently on
  // Windows 11 — the window ends up merely transparent (you see the desktop
  // crisply) instead of carrying DWM's blurred acrylic backdrop. Re-asserting
  // it once the window exists is the reliable path, so the blur the glass
  // sliders imply is actually produced by the OS rather than by CSS, which
  // cannot blur anything outside the page.
  if (translucency.kind === 'acrylic' && typeof mainWindow.setBackgroundMaterial === 'function') {
    mainWindow.once('ready-to-show', () => {
      try { mainWindow.setBackgroundMaterial('acrylic'); }
      catch (e) { console.warn('[glass] setBackgroundMaterial failed:', e.message); }
    });
  }

  mainWindow.loadFile('index.html');

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Note',     accelerator: 'CmdOrCtrl+N',       click: () => mainWindow.webContents.send('menu-new-note') },
        { label: 'New Notebook', accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow.webContents.send('menu-new-notebook') },
        { type: 'separator' },
        { label: 'Export Note',      accelerator: 'CmdOrCtrl+E', click: () => mainWindow.webContents.send('menu-export-note') },
        { label: 'Import Markdown',                               click: () => mainWindow.webContents.send('menu-import-markdown') },
        { label: 'Import PDF',                                    click: () => mainWindow.webContents.send('menu-import-pdf') },
        { label: 'Import OneNote',                                click: () => mainWindow.webContents.send('menu-import-onenote') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Edit Mode',    accelerator: 'CmdOrCtrl+1', click: () => mainWindow.webContents.send('menu-view-mode', 'edit') },
        { label: 'Split Mode',   accelerator: 'CmdOrCtrl+2', click: () => mainWindow.webContents.send('menu-view-mode', 'split') },
        { label: 'Preview Mode', accelerator: 'CmdOrCtrl+3', click: () => mainWindow.webContents.send('menu-view-mode', 'preview') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: '📖 Plugin Guide',
          click: () => mainWindow.webContents.send('show-help', 'plugins')
        },
        {
          label: '⌨️  Keyboard Shortcuts',
          click: () => mainWindow.webContents.send('show-help', 'shortcuts')
        },
        {
          label: '🖥️  Neovim / Vim Keybindings',
          click: () => mainWindow.webContents.send('show-help', 'nvim')
        },
        { type: 'separator' },
        {
          label: '🎨 Theming Guide',
          click: () => mainWindow.webContents.send('show-help', 'theming')
        },
        {
          label: '🔌 Plugin Development',
          click: () => mainWindow.webContents.send('show-help', 'devplugins')
        },
        { type: 'separator' },
        {
          label: '📋 About NoteHub',
          click: () => mainWindow.webContents.send('show-help', 'about')
        }
      ]
    },
    {
      label: 'Preferences',
      submenu: [
        {
          label: '⚙️  Open Preferences',
          accelerator: 'CmdOrCtrl+,',
          click: () => openPreferencesWindow()
        },
        { type: 'separator' },
        {
          label: '{ } Open config.json',
          click: () => openConfigInEditor()
        },
        {
          label: '📁 Open Data Folder',
          click: () => shell.openPath(dataPath)
        },
        { type: 'separator' },
        {
          label: 'Reload Config',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.send('reload-config')
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Electron lifecycle ─────────────────────────────────────────────────────
app.whenReady().then(() => {
  initAppDirectories();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Config ────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => readConfig());

// Tells the renderer whether the OS is blurring the desktop behind the window.
// If it isn't, the renderer paints its own gradient backdrop so the glass
// settings still do something visible.
ipcMain.handle('get-glass-capability', () => osTranslucency());

ipcMain.handle('save-config', (event, config) => {
  try {
    writeConfig(config);
    // Send live apply event so renderer updates without full reload
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('apply-config-live', config);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-config-path', () => configPath);

ipcMain.handle('open-config-editor', () => {
  openConfigInEditor();
  return { success: true };
});

ipcMain.handle('open-preferences', () => {
  openPreferencesWindow();
  return { success: true };
});

// ── Durable writes ─────────────────────────────────────────────────────────
// Every note in the app lives in one JSON file, so the write that persists it
// is the single most dangerous operation in the codebase. It used to be a bare
// writeFileSync straight over the live file: a crash, a power loss or a full
// disk between truncation and the last byte left a half-written file, and the
// half-written file WAS the database. Autosave fires every couple of seconds,
// so that window was open more or less continuously.
//
// The sequence below is the standard durable-replace pattern:
//
//   1. write the new content to a sibling temp file
//   2. fsync it, so the bytes are on the platter and not just in the page cache
//   3. rotate the current file into a numbered backup
//   4. rename the temp over the real path
//
// rename(2) is atomic on NTFS and on every POSIX filesystem, so a reader --
// including the next launch of this app -- sees either the entire old file or
// the entire new one. There is no state in which it sees a truncated one.
//
// Backups cover the failure mode atomicity cannot: a bug in this application
// writing well-formed but wrong data. An atomic write commits that corruption
// just as reliably as it commits a good save.
const BACKUP_COPIES = 3;

function rotateBackups(filePath, copies = BACKUP_COPIES) {
  // Walk downward so each slot is free before it is written into: .2 -> .3
  // happens before .1 -> .2. Ascending order would overwrite .2 with .1 and
  // then copy the already-overwritten .2 into .3, collapsing every generation
  // into the newest one.
  for (let i = copies - 1; i >= 1; i--) {
    const from = `${filePath}.${i}`;
    const to   = `${filePath}.${i + 1}`;
    try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch { /* non-fatal */ }
  }
  try { if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.1`); }
  catch { /* a failed backup must not block the save itself */ }
}

function writeFileDurable(filePath, contents) {
  const tmp = `${filePath}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, contents);
    // Without this the rename can land before the data does, and a power loss
    // between the two leaves an atomically-renamed file full of zeroes -- a
    // failure mode that looks exactly like the one atomicity was meant to fix.
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }

  rotateBackups(filePath);
  fs.renameSync(tmp, filePath);
}

// ── IPC: Data ──────────────────────────────────────────────────────────────
// Reading falls back through the backup chain. A corrupt primary file is
// recoverable in principle but only if something actually tries the backups --
// returning an empty library on a parse error looks, to the user, exactly like
// every note being deleted, and the next autosave would then make that real.
ipcMain.handle('get-data', () => {
  const dataFile = path.join(dataPath, 'notebooks.json');
  const candidates = [dataFile];
  for (let i = 1; i <= BACKUP_COPIES; i++) candidates.push(`${dataFile}.${i}`);

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (!parsed || typeof parsed !== 'object') continue;
      if (candidate !== dataFile) {
        console.warn(`[data] ${path.basename(dataFile)} unreadable; recovered from ${path.basename(candidate)}`);
        // Preserve the damaged file rather than letting the next save rotate
        // it out of the backup chain -- it is the only evidence of what broke.
        try { fs.copyFileSync(dataFile, `${dataFile}.corrupt`); } catch { /* best effort */ }
      }
      return parsed;
    } catch (e) {
      console.warn(`[data] ${path.basename(candidate)} failed to parse: ${e.message}`);
    }
  }
  return { notebooks: [], notes: [] };
});

ipcMain.handle('save-data', (event, data) => {
  try {
    // Not pretty-printed. Indenting a file no human edits by hand inflated it
    // by roughly a third, and every byte is re-serialized and re-written on
    // each autosave tick.
    writeFileDurable(path.join(dataPath, 'notebooks.json'), JSON.stringify(data));
    return { success: true };
  } catch (e) {
    console.error('[data] save failed:', e.message);
    return { success: false, error: e.message };
  }
});

// ── IPC: Export / Import ───────────────────────────────────────────────────
ipcMain.handle('export-note', async (event, note) => {
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Note',
      defaultPath: `${note.title.replace(/[^a-z0-9]/gi, '_')}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'All', extensions: ['*'] }]
    });
    if (filePath) { fs.writeFileSync(filePath, `# ${note.title}\n\n${note.content}`); return { success: true }; }
    return { success: false, cancelled: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('import-markdown', async () => {
  try {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Markdown',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }, { name: 'All', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (filePaths && filePaths.length > 0) {
      const files = filePaths.map(fp => ({
        fileName: path.basename(fp, path.extname(fp)),
        content:  fs.readFileSync(fp, 'utf8')
      }));
      return { success: true, files };
    }
    return { success: false, cancelled: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('import-pdf', async () => {
  try {
    const pdfParse = require('pdf-parse');
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true };

    const files = [];
    for (const fp of filePaths) {
      const data = await pdfParse(fs.readFileSync(fp));
      files.push({
        fileName: path.basename(fp, path.extname(fp)),
        content: data.text,
        pages: data.numpages
      });
    }
    return { success: true, files };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('import-onenote', async () => {
  return {
    success: false,
    error: 'Direct OneNote import isn\'t supported (OneNote\'s file format isn\'t publicly documented).\n\n' +
           'Workaround: in OneNote, export the notebook/section as Word (.docx), then use "Import Markdown" ' +
           'after converting it, or use OneNote\'s own "Send to Word" / PDF export and import that instead.'
  };
});

// ── IPC: Plugins ───────────────────────────────────────────────────────────
ipcMain.handle('get-plugins', () => {
  try {
    const pluginsDir = path.join(__dirname, 'plugins');
    console.log('[get-plugins] Scanning:', pluginsDir, 'exists:', fs.existsSync(pluginsDir));
    if (!fs.existsSync(pluginsDir)) return [];
    const folders = fs.readdirSync(pluginsDir).filter(f => {
      try { return fs.statSync(path.join(pluginsDir, f)).isDirectory(); } catch { return false; }
    });
    console.log('[get-plugins] Folders found:', folders);
    const plugins = folders.map(folder => {
      const mp = path.join(pluginsDir, folder, 'manifest.json');
      if (!fs.existsSync(mp)) { console.log('[get-plugins] No manifest:', folder); return null; }
      try {
        const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
        return { ...m, id: folder };
      } catch(e) { console.log('[get-plugins] Bad manifest:', folder, e.message); return null; }
    }).filter(Boolean);
    console.log('[get-plugins] Returning', plugins.length, 'plugins:', plugins.map(p=>p.id));
    return plugins;
  } catch(e) { console.error('[get-plugins] Error:', e); return []; }
});

ipcMain.handle('get-plugins-dir', () => path.join(__dirname, 'plugins'));

// ── IPC: Real shell command execution for terminal ─────────────────────────
// This backs the terminal plugin, whose whole purpose is running arbitrary
// shell input (pipes, &&, $VAR, globs) — so "command injection" isn't a
// vuln to remove here, it's the feature. The terminal is the only caller.
// What we can and do harden: validate inputs, verify the cwd exists, and
// route through an explicit shell binary with -c instead of exec()'s
// implicit /bin/sh, so the shell + argv are controlled rather than
// resolved by the platform. Runtime and output stay capped.
ipcMain.handle('exec-shell', async (event, cmd, cwd) => {
  return new Promise((resolve) => {
    if (typeof cmd !== 'string' || !cmd.trim()) {
      resolve({ stdout: '', stderr: '', code: 1, error: 'No command provided' });
      return;
    }

    let workdir = require('os').homedir();
    if (typeof cwd === 'string' && cwd) {
      try { if (fs.statSync(cwd).isDirectory()) workdir = cwd; } catch { /* fall back to home */ }
    }

    const isWin = process.platform === 'win32';
    const shell = isWin ? (process.env.COMSPEC || 'cmd.exe')
                        : (process.env.SHELL || '/bin/bash');
    const shellArgs = isWin ? ['/d', '/s', '/c', cmd] : ['-c', cmd];

    const { execFile } = require('child_process');
    execFile(shell, shellArgs, {
      cwd: workdir,
      timeout: 15000,
      maxBuffer: 1024 * 512,  // 512KB max output
      env: { ...process.env }
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code:   err ? (err.code || 1) : 0,
        error:  err ? err.message : null
      });
    });
  });
});

// ── IPC: Pick a background image for the appearance/glass system ──────────
ipcMain.handle('choose-background-image', async (event) => {
  try {
    const parent = BrowserWindow.fromWebContents(event.sender) || prefsWindow || mainWindow;
    const { filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Choose Background Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile']
    });
    if (!filePaths || !filePaths.length) return { success: false, cancelled: true };
    const src  = filePaths[0];
    const ext  = path.extname(src).toLowerCase() || '.png';
    const dest = path.join(backgroundsPath, `bg-${Date.now()}${ext}`);
    fs.copyFileSync(src, dest);
    return { success: true, path: dest };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: Import image file for notes ──────────────────────────────────────
// ── IPC: Attachments ───────────────────────────────────────────────────────
// Images used to be embedded in note content as base64 data URIs. Three costs,
// all of which compound:
//
//   - base64 inflates binary by ~33%, and the result lands inside a JSON string
//     where every byte is re-serialized on each autosave tick
//   - note history snapshots the full content, up to 50 revisions per note, so
//     one pasted screenshot could be stored fifty times over
//   - search matched against raw content, so image payloads produced hits
//
// Files now live in userData/attachments/ and notes reference them by name
// through the notehub-attachment: scheme, which the renderer resolves to a
// file URL. Content-addressed by SHA-256, so pasting the same screenshot into
// ten notes stores one file.
const ATTACHMENT_SCHEME = 'notehub-attachment:';
const ATTACHMENT_MAX_BYTES = 64 * 1024 * 1024;

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  'image/avif': 'avif', 'image/x-icon': 'ico',
};

// Only ever a bare `<64 hex>.<ext>` filename. Attachment ids reach here from
// note content, which is user-editable text, so a name is validated before it
// is ever joined to a path -- otherwise `../../config.json` would resolve to
// somewhere it has no business resolving to.
function isSafeAttachmentId(id) {
  return typeof id === 'string' && /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/.test(id);
}

function storeAttachment(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('empty attachment');
  if (buffer.length > ATTACHMENT_MAX_BYTES) throw new Error('attachment exceeds 64MB');
  const ext  = EXT_BY_MIME[mime] || 'bin';
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const id   = `${hash}.${ext}`;
  const dest = path.join(attachmentsPath, id);
  // Content-addressed, so an existing file with this name is byte-identical by
  // construction and rewriting it would be pure waste.
  if (!fs.existsSync(dest)) writeFileDurable(dest, buffer);
  return id;
}

ipcMain.handle('save-attachment', (event, { dataUrl } = {}) => {
  try {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!m) return { success: false, error: 'not a data URL' };
    const [, mime, isB64, payload] = m;
    const buf = isB64 ? Buffer.from(payload, 'base64')
                      : Buffer.from(decodeURIComponent(payload), 'utf8');
    const id = storeAttachment(buf, mime);
    return { success: true, id, ref: ATTACHMENT_SCHEME + id };
  } catch (e) { return { success: false, error: e.message }; }
});

// Resolves a reference to an absolute path the renderer can turn into a
// file:// URL. Returns null rather than throwing for a missing file so a note
// referencing a deleted attachment renders with a broken image instead of
// failing to render at all.
ipcMain.handle('resolve-attachment', (event, id) => {
  if (!isSafeAttachmentId(id)) return null;
  const full = path.join(attachmentsPath, id);
  return fs.existsSync(full) ? full : null;
});

// Deletes attachments no note references any more. Called explicitly rather
// than on a timer: the whole library has to be scanned to know a file is
// genuinely unreferenced, and doing that speculatively risks deleting an
// attachment belonging to a note that failed to load.
ipcMain.handle('prune-attachments', (event, referencedIds) => {
  try {
    const keep = new Set(Array.isArray(referencedIds) ? referencedIds : []);
    let removed = 0, bytes = 0;
    for (const name of fs.readdirSync(attachmentsPath)) {
      if (!isSafeAttachmentId(name) || keep.has(name)) continue;
      const full = path.join(attachmentsPath, name);
      try {
        bytes += fs.statSync(full).size;
        fs.unlinkSync(full);
        removed++;
      } catch { /* skip anything locked or already gone */ }
    }
    return { success: true, removed, bytes };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('import-image', async () => {
  try {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Insert Image',
      filters: [
        { name: 'Images', extensions: ['png','jpg','jpeg','gif','webp','svg','bmp'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (!filePaths || !filePaths.length) return { success: false, cancelled: true };
    const buf  = fs.readFileSync(filePaths[0]);
    const ext  = path.extname(filePaths[0]).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    // Stored on disk and referenced, rather than inlined as base64.
    const id = storeAttachment(buf, mime);
    return { success: true, id, ref: ATTACHMENT_SCHEME + id, name: path.basename(filePaths[0]) };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('load-plugin', (event, pluginId) => {
  try {
    const pluginPath = path.join(__dirname, 'plugins', pluginId, 'index.js');
    if (fs.existsSync(pluginPath)) return { success: true, code: fs.readFileSync(pluginPath, 'utf8') };
    return { success: false, error: 'Plugin not found' };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: System Fonts ──────────────────────────────────────────────────────
ipcMain.handle('get-system-fonts', async () => {
  try {
    // Use fc-list on Linux, system_profiler on macOS, or PowerShell on Windows
    const { execSync } = require('child_process');
    let fonts = new Set();

    if (process.platform === 'darwin') {
      // macOS: read from both system and user font dirs
      const fontDirs = [
        '/System/Library/Fonts',
        '/Library/Fonts',
        require('os').homedir() + '/Library/Fonts',
        '/System/Library/AssetsV2/com_apple_MobileAsset_Font7'
      ];
      fontDirs.forEach(dir => {
        try {
          if (!fs.existsSync(dir)) return;
          const walk = (d) => {
            fs.readdirSync(d, { withFileTypes: true }).forEach(f => {
              if (f.isDirectory()) { try { walk(path.join(d, f.name)); } catch {} }
              else if (/\.(ttf|otf|ttc|dfont)$/i.test(f.name)) {
                // Strip extension and common suffixes to get family name
                let name = f.name.replace(/\.(ttf|otf|ttc|dfont)$/i, '');
                name = name.replace(/[-_](Bold|Italic|Regular|Medium|Light|Heavy|Black|Thin|Semibold|ExtraBold|ExtraLight|Condensed|Expanded|Oblique|Narrow|BoldItalic|LightItalic|MediumItalic).*$/i, '');
                name = name.replace(/[-_]/g, ' ').trim();
                if (name.length > 1) fonts.add(name);
              }
            });
          };
          walk(dir);
        } catch {}
      });
      // Also use system_profiler for registered font families
      try {
        const out = execSync('system_profiler SPFontsDataType -json', { timeout: 8000 }).toString();
        const data = JSON.parse(out);
        const fontData = data.SPFontsDataType || [];
        fontData.forEach(f => { if (f._name) fonts.add(f._name); });
      } catch {}

    } else if (process.platform === 'linux') {
      try {
        const out = execSync('fc-list --format="%{family}\n"', { timeout: 5000 }).toString();
        out.split('\n').forEach(line => {
          line.split(',').forEach(name => {
            const trimmed = name.trim();
            if (trimmed.length > 1) fonts.add(trimmed);
          });
        });
      } catch {}

    } else if (process.platform === 'win32') {
      try {
        const out = execSync(
          'powershell -command "[System.Reflection.Assembly]::LoadWithPartialName(\'System.Drawing\'); [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }"',
          { timeout: 8000 }
        ).toString();
        out.split('\n').forEach(name => {
          const trimmed = name.trim();
          if (trimmed.length > 1) fonts.add(trimmed);
        });
      } catch {}
    }

    const sorted = Array.from(fonts).filter(Boolean).sort((a, b) => a.localeCompare(b));
    return sorted.length > 0 ? sorted : getFallbackFonts();
  } catch (e) {
    console.error('Font enumeration error:', e);
    return getFallbackFonts();
  }
});

function getFallbackFonts() {
  return [
    'Arial', 'Baskerville', 'Cascadia Code', 'Comic Sans MS',
    'Consolas', 'Courier New', 'Fira Code', 'Fira Sans',
    'Georgia', 'Helvetica', 'Helvetica Neue', 'IBM Plex Mono',
    'IBM Plex Sans', 'Impact', 'Inter', 'JetBrains Mono',
    'Menlo', 'Monaco', 'Noto Sans', 'Noto Serif',
    'Open Sans', 'Palatino', 'Roboto', 'Roboto Mono',
    'SF Mono', 'SF Pro', 'Source Code Pro', 'Source Sans Pro',
    'Times New Roman', 'Trebuchet MS', 'Ubuntu', 'Ubuntu Mono',
    'Verdana'
  ];
}

// ── IPC: Apply config live (no full restart) ───────────────────────────────
ipcMain.handle('apply-config', (event, config) => {
  try {
    writeConfig(config);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('apply-config-live', config);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── IPC: Git integration ────────────────────────────────────────────────────
// All user-controlled positional arguments (urls, paths, remote/branch names)
// are preceded by `--` to stop them being parsed as git flags — see the
// git-clone "--upload-pack=..." injection class this guards against.
ipcMain.handle('git-clone', async (event, url, targetDir, branch) => {
  try {
    const os = require('os');
    const crypto = require('crypto');

    const repoName = url.split('/').pop().replace(/\.git$/, '');
    const hash = crypto.createHash('md5').update(url).digest('hex').slice(0,8);
    const target = targetDir || path.join(os.homedir(), 'notehub-repos', `${repoName}-${hash}`);

    if (!fs.existsSync(path.dirname(target))) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    }

    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      const args = ['clone'];
      if (branch) args.push('--branch', branch);
      args.push('--', url, target);

      execFile('git', args, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ success: false, error: stderr || err.message });
          return;
        }
        resolve({ success: true, path: target, output: stdout });
      });
    });
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// Walk a cloned (or any) repo for markdown files so the renderer can import
// them as notes. Bounded: skips VCS/dependency dirs and hidden dirs, caps
// file count and per-file size so a huge repo can't lock up the import.
ipcMain.handle('read-repo-markdown', async (event, repoPath) => {
  try {
    if (typeof repoPath !== 'string' || !fs.existsSync(repoPath)) {
      return { success: false, error: 'Repository path not found' };
    }
    const IGNORE_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', 'vendor', 'dist', 'build']);
    const MAX_FILES = 500;
    const MAX_BYTES = 512 * 1024;
    const files = [];

    const walk = (dir, rel) => {
      if (files.length >= MAX_FILES) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (files.length >= MAX_FILES) break;
        if (e.isDirectory()) {
          if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
          walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
        } else if (/\.(md|markdown)$/i.test(e.name)) {
          const full = path.join(dir, e.name);
          try {
            if (fs.statSync(full).size > MAX_BYTES) continue;
            files.push({
              fileName: path.basename(e.name, path.extname(e.name)),
              relPath:  rel ? `${rel}/${e.name}` : e.name,
              content:  fs.readFileSync(full, 'utf8')
            });
          } catch { /* skip unreadable file */ }
        }
      }
    };
    walk(repoPath, '');
    return { success: true, files, repoName: path.basename(repoPath), truncated: files.length >= MAX_FILES };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('git-status', async (event, repoPath) => {
  try {
    const { execSync, execFileSync } = require('child_process');
    const cwd = repoPath;

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd }).toString().trim();
    const commit = execSync('git rev-parse HEAD', { cwd }).toString().trim();
    const statusOut = execSync('git status --porcelain', { cwd }).toString();
    const clean = !statusOut.trim();

    // NOT statusOut.trim() before splitting — an unstaged-only file's porcelain line
    // starts with a space (index status = clean), and .trim() on the whole blob
    // would eat that leading space, shifting every column of that line by one.
    const files = statusOut.split('\n').filter(line => line.length > 0).map(line => {
      const indexStatus    = line[0] === ' ' ? '' : line[0];
      const worktreeStatus = line[1] === ' ' ? '' : line[1];
      const fpath = line.substring(3);
      return { path: fpath, indexStatus, worktreeStatus, staged: !!indexStatus && indexStatus !== '?' };
    });

    let ahead = null, behind = null;
    try {
      const counts = execFileSync('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd })
        .toString().trim().split(/\s+/).map(Number);
      [behind, ahead] = counts;
    } catch {
      // No upstream configured — leave ahead/behind as null
    }

    return {
      success: true,
      branch,
      commit,
      clean,
      status: statusOut || 'Working tree clean',
      files,
      ahead,
      behind,
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('git-commit', async (event, repoPath, message, userName, userEmail) => {
  try {
    const { execFileSync } = require('child_process');
    const cwd = repoPath;

    if (userName) execFileSync('git', ['config', '--', 'user.name', userName], { cwd });
    if (userEmail) execFileSync('git', ['config', '--', 'user.email', userEmail], { cwd });

    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd }).toString().trim();
    if (!staged) {
      return { success: false, staged: false, error: 'Nothing staged to commit' };
    }

    const commitOut = execFileSync('git', ['commit', '-m', message], { cwd });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim();

    return { success: true, commit, message, output: commitOut.toString() };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('git-pull', async (event, repoPath, remote = 'origin', branch = 'main') => {
  try {
    const { execFileSync } = require('child_process');
    const output = execFileSync('git', ['pull', '--', remote, branch], { cwd: repoPath });
    return { success: true, output: output.toString() };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('git-push', async (event, repoPath, remote = 'origin', branch = 'main') => {
  try {
    const { execFileSync } = require('child_process');
    const output = execFileSync('git', ['push', '--', remote, branch], { cwd: repoPath });
    return { success: true, output: output.toString() };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('git-add', async (event, repoPath, scope, filePath) => {
  try {
    const { execFileSync } = require('child_process');
    const args = scope === 'file' ? ['add', '--', filePath] : ['add', '-A'];
    execFileSync('git', args, { cwd: repoPath });
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('git-unstage', async (event, repoPath, scope, filePath) => {
  try {
    const { execFileSync } = require('child_process');
    const args = scope === 'file' ? ['reset', '--', filePath] : ['reset'];
    execFileSync('git', args, { cwd: repoPath });
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-note-to-path', (event, note, targetPath) => {
  try {
    fs.writeFileSync(targetPath, note.content);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('git-diff-file', async (event, repoPath, filePath) => {
  try {
    const { execFileSync } = require('child_process');
    const cwd = repoPath;

    let headContent = null;
    try {
      headContent = execFileSync('git', ['show', `HEAD:${filePath}`], { cwd }).toString();
    } catch {
      // File is new/untracked — no HEAD version exists
    }

    let workingContent = null;
    const absPath = path.join(repoPath, filePath);
    if (fs.existsSync(absPath)) {
      workingContent = fs.readFileSync(absPath, 'utf8');
    }

    const numstat = execFileSync('git', ['diff', '--numstat', '--', filePath], { cwd }).toString().trim();
    if (numstat.startsWith('-\t-\t')) {
      return { success: true, binary: true, headContent: null, workingContent: null, diffText: '' };
    }

    let diffText = '';
    try {
      diffText = execFileSync('git', ['diff', '--no-color', '--', filePath], { cwd }).toString();
    } catch {
      diffText = '';
    }

    return { success: true, binary: false, headContent, workingContent, diffText };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('choose-directory', async () => {
  try {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (filePaths && filePaths.length > 0) return { success: true, path: filePaths[0] };
    return { success: false, cancelled: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
