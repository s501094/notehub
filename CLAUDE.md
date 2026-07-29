# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies (Electron + electron-builder + marked/pdf-parse/mammoth)
npm start         # Run the app in development
npm run build     # Build distributable for current platform
npm run build:mac # macOS .dmg + .zip
npm run build:win # Windows NSIS installer + portable
npm run build:linux # AppImage + .deb + .rpm
```

No test runner or lint tool is configured. `test.js` exists in the root but is not wired to a script.

## Architecture

NoteHub is an Electron desktop app (no frontend framework) organized around three processes:

**Main process (`main.js`)**
- Creates BrowserWindows (`mainWindow`, `prefsWindow`)
- Handles all file I/O: config, notebooks data, plugin loading, imports/exports
- Exposes functionality to the renderer exclusively via `ipcMain.handle(...)` — never direct Node.js access from the renderer
- Config lives at the platform-specific `userData` path (macOS: `~/Library/Application Support/notehub/`); data at `userData/data/notebooks.json`

**Preload bridge (`preload.js`)**
- The security boundary. Uses `contextBridge.exposeInMainWorld` to expose `window.electron` (aliased as `window.electronAPI`) to the renderer
- Adding a new IPC channel requires changes in all three: `ipcMain.handle` in `main.js`, exposed method in `preload.js`, and called via `window.electron.*` in `renderer.js`

**Renderer process (`renderer.js` + `index.html` + `main.css`)**
- Plain vanilla JS — no bundler, no React. All UI state is managed in module-level variables
- Contains a custom markdown parser (`parseMarkdown`) that processes in strict order: fenced code blocks → inline code → HTML escape → headings → tables → blockquotes → inline formatting → links → paragraphs. Order matters to avoid double-processing
- Config is read on startup via `window.electron.getConfig()` and applied as CSS variables on `document.documentElement`

**Preferences window (`preferences.html`)**
- Separate BrowserWindow, shares the same `preload.js`
- Saves config via `window.electron.saveConfig()`, which triggers a live `apply-config-live` IPC event back to the main window so themes apply without restart

## Plugin System

Plugins live in `plugins/<plugin-id>/` with two required files:
- `manifest.json` — `{ name, version, description, author }`
- `index.js` — loaded as a string via `ipcMain.handle('load-plugin')` and eval'd in the renderer

Plugins are enabled by listing their directory name in `config.json → plugins.enabled`. The plugin receives a `NoteHub` API object injected by the renderer before eval. See `plugins/example-plugin/` as a reference skeleton.

## Config Schema

```json
{
  "theme": { "mode", "accentColor", "fontFamily", "fontSize", "editorFontFamily", "editorFontSize" },
  "editor": { "defaultView", "autoSave", "autoSaveInterval", "spellCheck", "lineNumbers", "wordWrap" },
  "plugins": { "enabled": [] },
  "ui": { "sidebarWidth", "showPreviewByDefault" }
}
```

`sanitizeConfig()` in `main.js` validates and clamps all values before any write — including strict hex validation for `accentColor` and allowed enum for `defaultView` (`edit` | `split` | `preview`).

## Key Design Constraints

- `contextIsolation: true`, `nodeIntegration: false` — enforced on all windows. Never weaken these
- The markdown parser is custom (not using the bundled `marked` package). Changes to rendering touch `parseMarkdown()` in `renderer.js`
- Git operations (clone/status/commit/pull/push) run via `child_process` in the main process. The existing `git-clone` and `git-commit` handlers interpolate user-provided values into shell command strings — a known injection risk. Prefer `execFile` with argument arrays when modifying or extending these handlers
