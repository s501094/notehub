const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow;
let prefsWindow = null;
let configPath;
let dataPath;

// ── Default config ─────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  theme: {
    mode: 'dark',
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
    wordWrap: true
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
  }
};

// ── App directories ────────────────────────────────────────────────────────
function initAppDirectories() {
  const userDataPath = app.getPath('userData');
  configPath = path.join(userDataPath, 'config.json');
  dataPath   = path.join(userDataPath, 'data');

  if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });

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
  }
  if (c.ui) {
    if (typeof c.ui.sidebarWidth === 'number') {
      c.ui.sidebarWidth = Math.max(160, Math.min(600, c.ui.sidebarWidth));
    }
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

// ── Main window ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#1e1e2e',
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
ipcMain.handle('exec-shell', async (event, cmd, cwd) => {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const opts = {
      cwd: cwd || require('os').homedir(),
      timeout: 15000,
      maxBuffer: 1024 * 512,  // 512KB max output
      env: { ...process.env }
    };
    exec(cmd, opts, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code:   err ? (err.code || 1) : 0,
        error:  err ? err.message : null
      });
    });
  });
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
