const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

let mainWindow;
let prefsWindow = null;
let configPath;
let dataPath;
let backgroundsPath;

// ── Default config ─────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  theme: {
    mode: 'dark',
    preset: 'catppuccin-mocha',
    accentColor: '#cba6f7',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
    editorFontFamily: 'JetBrains Mono, Fira Code, Monaco, Menlo, Consolas, monospace',
    editorFontSize: 14
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
    showPreviewByDefault: true
  },
  appearance: {
    glassMode: 'unified', // 'unified' | 'per-section'
    glass:         { bgAlpha: 100, blur: 0, saturate: 100, radius: 0, shadowAlpha: 0 },
    glassSections: {
      sidebar: { bgAlpha: 100, blur: 0, saturate: 100, radius: 0, shadowAlpha: 0 },
      editor:  { bgAlpha: 100, blur: 0, saturate: 100, radius: 0, shadowAlpha: 0 },
      preview: { bgAlpha: 100, blur: 0, saturate: 100, radius: 0, shadowAlpha: 0 },
      panels:  { bgAlpha: 100, blur: 0, saturate: 100, radius: 0, shadowAlpha: 0 },
    },
    background: { enabled: false, path: '', fit: 'cover', opacity: 100, blur: 0 },
    customCSS: '',
  }
};

// ── App directories ────────────────────────────────────────────────────────
function initAppDirectories() {
  const userDataPath = app.getPath('userData');
  configPath = path.join(userDataPath, 'config.json');
  dataPath   = path.join(userDataPath, 'data');
  backgroundsPath = path.join(userDataPath, 'backgrounds');

  if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
  if (!fs.existsSync(backgroundsPath)) fs.mkdirSync(backgroundsPath, { recursive: true });

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return DEFAULT_CONFIG;
  }
}

function sanitizeConfig(cfg) {
  // Deep clone to avoid mutating the input
  const c = JSON.parse(JSON.stringify(cfg));

  // Sanitize string fields that might contain problematic characters
  if (c.theme) {
    // Strip control characters and newlines from font strings
    ['fontFamily', 'editorFontFamily'].forEach(k => {
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
  }
  if (c.editor) {
    const valid = ['edit', 'split', 'preview'];
    if (!valid.includes(c.editor.defaultView)) c.editor.defaultView = 'split';
    if (typeof c.editor.autoSaveInterval !== 'number' ||
        c.editor.autoSaveInterval < 500) c.editor.autoSaveInterval = 2000;
    c.editor.vimMode = !!c.editor.vimMode;
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
    const clampGlass = (g) => {
      g = g && typeof g === 'object' ? g : {};
      return {
        bgAlpha:     Math.max(0, Math.min(100, Number(g.bgAlpha) || 0)),
        blur:        Math.max(0, Math.min(40,  Number(g.blur) || 0)),
        saturate:    Math.max(0, Math.min(200, g.saturate === undefined ? 100 : Number(g.saturate) || 0)),
        radius:      Math.max(0, Math.min(32,  Number(g.radius) || 0)),
        shadowAlpha: Math.max(0, Math.min(100, Number(g.shadowAlpha) || 0)),
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
      opacity: Math.max(0, Math.min(100, bg.opacity === undefined ? 100 : Number(bg.opacity) || 0)),
      blur:    Math.max(0, Math.min(40, Number(bg.blur) || 0)),
    };
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
    fs.writeFileSync(configPath, json);
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

// ── IPC: Data ──────────────────────────────────────────────────────────────
ipcMain.handle('get-data', () => {
  try {
    const dataFile = path.join(dataPath, 'notebooks.json');
    if (fs.existsSync(dataFile)) return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return { notebooks: [], notes: [] };
  } catch { return { notebooks: [], notes: [] }; }
});

ipcMain.handle('save-data', (event, data) => {
  try {
    fs.writeFileSync(path.join(dataPath, 'notebooks.json'), JSON.stringify(data, null, 2));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
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
    const buf     = fs.readFileSync(filePaths[0]);
    const ext     = path.extname(filePaths[0]).slice(1).toLowerCase();
    const mime    = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const b64     = buf.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;
    return { success: true, dataUrl, name: path.basename(filePaths[0]) };
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
