const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getConfig:        ()       => ipcRenderer.invoke('get-config'),
  saveConfig:       (config) => ipcRenderer.invoke('save-config', config),
  applyConfig:      (config) => ipcRenderer.invoke('apply-config', config),
  getConfigPath:    ()       => ipcRenderer.invoke('get-config-path'),
  openConfigEditor: ()       => ipcRenderer.invoke('open-config-editor'),
  openPreferences:  ()       => ipcRenderer.invoke('open-preferences'),
  getSystemFonts:   ()       => ipcRenderer.invoke('get-system-fonts'),

  getData:  ()     => ipcRenderer.invoke('get-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),

  exportNote:     (note) => ipcRenderer.invoke('export-note', note),
  importMarkdown: ()     => ipcRenderer.invoke('import-markdown'),

  getPlugins:    ()         => ipcRenderer.invoke('get-plugins'),
  getPluginsDir: ()         => ipcRenderer.invoke('get-plugins-dir'),
  loadPlugin:  (pluginId) => ipcRenderer.invoke('load-plugin', pluginId),

  onMenuNewNote:        (cb) => ipcRenderer.on('menu-new-note',        cb),
  onMenuNewNotebook:    (cb) => ipcRenderer.on('menu-new-notebook',    cb),
  onMenuExportNote:     (cb) => ipcRenderer.on('menu-export-note',     cb),
  onMenuImportMarkdown: (cb) => ipcRenderer.on('menu-import-markdown', cb),
  onMenuImportPdf:      (cb) => ipcRenderer.on('menu-import-pdf',      cb),
  onMenuOnenote:        (cb) => ipcRenderer.on('menu-import-onenote',  cb),
  onMenuViewMode:       (cb) => ipcRenderer.on('menu-view-mode',       cb),
  onReloadConfig:       (cb) => ipcRenderer.on('reload-config',        cb),
  onApplyConfigLive:    (cb) => ipcRenderer.on('apply-config-live',    cb),
  onShowHelp:           (cb) => ipcRenderer.on('show-help',           cb),
  execShell:    (cmd, cwd) => ipcRenderer.invoke('exec-shell', cmd, cwd),
  openPreferences: () => ipcRenderer.invoke('open-preferences'),
  importImage:  ()         => ipcRenderer.invoke('import-image'),
  importPdf:    ()         => ipcRenderer.invoke('import-pdf'),
  importOnenote:()         => ipcRenderer.invoke('import-onenote'),

  chooseDirectory:  ()      => ipcRenderer.invoke('choose-directory'),
  gitClone:         (url, target, branch) => ipcRenderer.invoke('git-clone', url, target, branch),
  gitStatus:        (repoPath) => ipcRenderer.invoke('git-status', repoPath),
  gitCommit:        (repoPath, msg, userName, userEmail) => ipcRenderer.invoke('git-commit', repoPath, msg, userName, userEmail),
  gitPull:          (repoPath, remote, branch) => ipcRenderer.invoke('git-pull', repoPath, remote, branch),
  gitPush:          (repoPath, remote, branch) => ipcRenderer.invoke('git-push', repoPath, remote, branch),
  gitAdd:           (repoPath, scope, filePath) => ipcRenderer.invoke('git-add', repoPath, scope, filePath),
  gitUnstage:       (repoPath, scope, filePath) => ipcRenderer.invoke('git-unstage', repoPath, scope, filePath),
  gitDiffFile:      (repoPath, filePath) => ipcRenderer.invoke('git-diff-file', repoPath, filePath),
  exportNoteToPath: (note, targetPath) => ipcRenderer.invoke('export-note-to-path', note, targetPath),
};

contextBridge.exposeInMainWorld('electron',    api);
contextBridge.exposeInMainWorld('electronAPI', api);
