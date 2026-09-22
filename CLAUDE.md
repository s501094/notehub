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
  "theme": { "mode", "preset", "accentColor", "fontFamily", "fontSize",
             "readingFontFamily", "editorFontFamily", "editorFontSize",
             "brightPanel", "dimMarkup", "syntax" },
  "editor": { "defaultView", "autoSave", "autoSaveInterval", "spellCheck",
              "lineNumbers", "relativeLineNumbers", "wordWrap", "vimMode",
              "vimKeybindings" },
  "plugins": { "enabled": [] },
  "nvim": { "lineNumbers", "relativeLineNumbers", "syntaxHighlight",
            "highlightActiveLine", "showMatchingBrackets", "autoCloseBrackets",
            "tabSize", "indentWithTabs" },
  "ui": { "sidebarWidth", "sidebarCollapsed", "notebooksCollapsed",
          "notesCollapsed", "showPreviewByDefault" },
  "appearance": {
    "glassMode": "unified | per-section",
    "glass": { "bgAlpha", "blur", "saturate", "dim", "noise", "radius", "shadowAlpha" },
    "glassSections": { "sidebar": {}, "editor": {}, "preview": {}, "panels": {} },
    "background": { "enabled", "path", "fit", "opacity", "blur", "scrim" },
    "reduceTransparency": false,
    "customCSS": ""
  }
}
```

**Three font roles, three tokens.** `theme.fontFamily` is app chrome only,
`theme.readingFontFamily` is rendered prose in the preview, and
`theme.editorFontFamily`/`editorFontSize` drive CodeMirror via
`--editor-font-*`. They were once a single token, which meant picking a
monospace face for the editor set every rendered paragraph in it too. Don't
re-collapse them, and don't hardcode a family in `.CodeMirror` — it must read
the custom properties `applyTheme()` publishes.

`readConfig()` in `main.js` merges the stored config **onto** `DEFAULT_CONFIG`
before returning it. This is load-bearing: nothing rewrites `config.json` on
upgrade, so without the merge any key added after a user's first launch reads
`undefined` forever, and every boolean consumer treats that as `false`. Add new
defaults to `DEFAULT_CONFIG` and they reach existing installs; skip the merge
and they silently do not.

`sanitizeConfig()` validates and clamps all values before any write — strict
hex for `accentColor`, an allowed enum for `defaultView` (`edit` | `split` |
`preview`), and per-key clamps for every glass parameter. Default-on booleans
are normalized with `!== false` so a missing key reads as its documented
default. Glass `saturate` is deliberately capped at 140: the value lands in a
`backdrop-filter`, so anything higher amplifies the wallpaper's chroma and
fights the text in front of it.

## Data Storage

Notes live in `userData/data/notebooks.json`; images live as separate files in
`userData/attachments/`, content-addressed by SHA-256 and referenced from note
content as `notehub-attachment:<sha256>.<ext>`.

All writes go through `writeFileDurable()` in `main.js`: temp file → `fsync` →
rotate backups → `rename`. Never call `fs.writeFileSync` directly on a file that
holds user data. The `fsync` is load-bearing, not defensive — without it the
rename can be committed before the data is, and a power loss between the two
leaves an atomically-renamed file full of zeroes.

`get-data` falls back through `notebooks.json.1/.2/.3` when the primary will not
parse. Returning an empty library on a parse error is indistinguishable, to the
user, from every note being deleted — and the next autosave would make it real.

Attachment ids arrive from note content, which is user-editable text, so
`isSafeAttachmentId()` validates them before any path is built from one.

## Key Design Constraints

- `contextIsolation: true`, `nodeIntegration: false` — enforced on all windows. Never weaken these
- The markdown parser is custom (not using the bundled `marked` package) and lives in `markdown-utils.js`, separate from the renderer so it can be unit tested directly — see `tests/markdown.test.js`. Add a test before changing it. Three invariants:
  - **Emphasis delimiters need word-boundary guards.** Without them `_` and `*` match inside words, and every hostname, snake_case identifier and file path in a note gets mangled into `<em>`.
  - **Task checkbox indices must match on both sides.** `data-task-index` is the checkbox's ordinal in document order; `wireTaskCheckboxes()` finds the matching source line by counting task markers with a regex that must accept exactly the same markers `parseMarkdown` accepts (`-`, `*`, `+`, `1.`), and must skip fenced code identically. If the two disagree, clicking one checkbox toggles a different task.
  - **Every pass must preserve line counts.** Block elements carry a `data-src-line` anchor used by split-view scroll sync, recovered by counting newlines. Passes that collapse many lines into one element (fenced code, tables) pad with blank lines; the list builder emits exactly one output line per input line. A pass that changes the count shifts every anchor after it.
- Glass is a coupled system, not independent sliders. Panel opacity drives a blur floor, shadow spread, rim-light strength and the text halo — thinning a panel must never be the thing that decides whether text is legible. `computeGlass()` in `renderer.js` owns all of it
- Git operations (clone/status/commit/pull/push) run via `child_process` in the main process. All `git-*` handlers use `execFile`/`execFileSync` with argv arrays (never shell string interpolation), with user-controlled positional args preceded by `--` to stop them being parsed as flags. Keep new/modified handlers on this pattern — don't introduce `exec()`/shell-string interpolation
