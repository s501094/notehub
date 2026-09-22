# NoteHub

A hackable, offline-first note-taking app for Markdown. Electron, no framework, no bundler — the renderer is plain JavaScript you can read top to bottom.

Notes live in notebooks, render live in a split preview, and stay on your disk as plain data. Everything visual is driven by CSS custom properties, so a theme preset re-skins the whole app without touching a component.

---

## Requirements

| | Version | Notes |
|---|---|---|
| Node.js | 18 or newer | Verified on 26.7.0 |
| npm | 9 or newer | Verified on 11.19.0 |
| OS | Windows 10+, macOS 11+, or Linux | Electron 43 |

Building for a platform requires being **on** that platform (macOS `.dmg` needs a Mac). Cross-compiling is not configured.

## Quick start

```bash
git clone https://github.com/s501094/notehub.git
cd notehub
npm install
npm start
```

`npm install` downloads the Electron binary for your OS (~100 MB), so the first run is the slow one.

---

## Building

Output lands in `dist/`.

```bash
npm run build         # current platform
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

### Windows

```powershell
npm install
npm run build:win
```

Produces two artifacts in `dist\`:

| Artifact | What it is |
|---|---|
| `NoteHub Setup 1.0.0.exe` | NSIS installer — lets the user pick an install directory |
| `NoteHub 1.0.0.exe` | Portable single executable, no install |

No extra tooling needed. Unsigned builds will show a SmartScreen warning on first launch (**More info → Run anyway**).

### macOS

```bash
npm install
npm run build:mac
```

Produces a `.dmg` and a `.zip`. Unsigned builds are quarantined by Gatekeeper — right-click the app and choose **Open**, or clear the flag:

```bash
xattr -cr "/Applications/NoteHub.app"
```

### Linux

```bash
npm install
npm run build:linux
```

Produces an `AppImage`, a `.deb` and an `.rpm`. The last two need packaging tools present:

```bash
sudo apt install fakeroot dpkg rpm      # Debian/Ubuntu
```

To build only the AppImage and skip that, run `npx electron-builder --linux AppImage`.

### Building from WSL

Two things to know if you keep a checkout in both WSL and Windows:

1. **`npm install` is per-platform.** The Electron binary is native, so a `node_modules` installed under WSL cannot run or package a Windows build. Run `npm install` separately in each checkout — don't share the folder across the boundary.
2. **Build Windows targets from Windows.** `npm run build:win` from WSL needs Wine and is fragile. Open PowerShell, `cd` to the Windows checkout, and build there.

Running the app itself from WSL also needs a working X/Wayland display (WSLg on Windows 11). If `npm start` exits immediately, that's usually what's missing.

---

## Testing

```bash
npm test
```

Runs two suites:

| Suite | Command | Covers |
|---|---|---|
| Structural | `node test.js` | Project layout, config schema, plugin manifests, IPC surface, CSS |
| Unit | `node --test tests/**/*.test.js` | Markdown parser, note/notebook utilities, git diff parsing, editor helpers, packaging |

Current state: **116 structural checks** (101 pass, 15 skipped) and **139 unit tests** (138 pass, 1 skipped when `node_modules` is absent). Both run without Electron and without a display, so they work over SSH and in CI.

Run one file while iterating:

```bash
node --test tests/markdown.test.js
```

---

## Using it

### Context menus

Right-click is wired up everywhere, and the menu changes with what's under the cursor.

| Right-click on | You get |
|---|---|
| **Editor** | Spelling suggestions, undo/redo, cut/copy/paste, **Insert ▸**, **Format ▸** |
| **Preview** | Open link in browser, copy link, copy image, copy code block, copy Markdown source |
| **Note** in sidebar | Rename, Pin, Duplicate, Move to Notebook, Export, Move to Trash |
| **Notebook** | Rename, Change Colour, New Note Here, Delete |
| **Trashed note** | Restore, Delete Forever |

**Insert ▸** has a hover-to-size table picker — drag across the grid and release at `3 × 4`. Also lists, task lists, headings, blockquotes, code blocks, links, footnotes and dates.

**Format ▸** is selection-aware: bold, italic, strikethrough, inline code, headings, plus **text colour**, **highlight** and **size** from a swatch grid that reads the active theme preset, so the swatches match whatever theme you're in.

Markdown has no syntax for colour, so Format writes portable inline HTML:

```markdown
The <span style="color:#f38ba8">critical</span> step
A <mark>highlighted</mark> phrase
```

That renders in NoteHub *and* in GitHub, Obsidian and VS Code's preview. The parser accepts a narrow allowlist (`span`, `mark`, `u`, `sub`, `sup`, `kbd`, `small`, `br`) with only `style` honoured, and only colour, size, weight, style and decoration within it. Anything else — event handlers, `url()`, extra attributes, block tags — stays escaped and shows up literally, which is the intended feedback for a typo.

### Keyboard shortcuts

`⌘` on macOS, `Ctrl` elsewhere.

| Shortcut | Action |
|---|---|
| `⌘⇧P` | Command palette |
| `⌘K` | Quick switch to note |
| `⌘N` / `⌘⇧N` | New note / new notebook |
| `⌘1` `⌘2` `⌘3` | Edit / Split / Preview mode |
| `⌘B` | Toggle sidebar |
| `⌘.` | Zen mode |
| `⌘/` | Table of contents |
| `⌃Tab` / `⌃⇧Tab` | Next note / next notebook |
| `⌘E` | Export current note |
| `⌘,` | Preferences |
| `⌘⇧F` | Advanced search |
| `⌃\`` | Terminal |
| `⌘⇧G` | Git panel |
| `⌘⇧X` | Spreadsheet |

Vim mode is available under **Preferences → Editor**, with custom key sequences bound to any command-palette action via `config.json → editor.vimKeybindings`.

### Plugins

Drop a folder in `plugins/` with a `manifest.json` and an `index.js`, then enable it by name in **Preferences → Plugins**.

| Plugin | What it does |
|---|---|
| `advanced-search` | Search across all notes with filters and tags |
| `git-integration` | Clone, stage, commit and sync notes to a Git repo |
| `terminal` | Integrated terminal panel |
| `math-renderer` | LaTeX math via KaTeX |
| `excel-integration` | Import Excel, edit spreadsheets, convert to Markdown tables |
| `docx-converter` | Import Word documents as Markdown |
| `example-plugin` | Reference skeleton to copy |

See `plugins/PLUGINS.md` for the API.

---

## Where your data lives

Both are plain files, outside the repo, and survive reinstalls.

| | Typical location |
|---|---|
| Windows | `%APPDATA%\NoteHub\` |
| macOS | `~/Library/Application Support/NoteHub/` |
| Linux | `~/.config/NoteHub/` |

```
config.json        settings (also editable via Preferences → { } Open config.json)
data/              notebooks.json — your notes
attachments/       pasted and imported images
backgrounds/       wallpaper images for the glass theme
```

The reliable way to find it on any platform is **Preferences → 📁 Open Data Folder**.

---

## Project layout

```
main.js              Main process: windows, menus, all file I/O, IPC handlers
preload.js           Security boundary — contextBridge surface (window.electron)
renderer.js          The app: UI, state, notebooks, editor, command palette
context-menu.js      Right-click menus and the Markdown editing helpers
markdown-utils.js    Markdown → HTML parser (order-sensitive; read its header first)
note-utils.js        Pure helpers: trash, pins, version history, reordering
notebook-utils.js    Pure helpers: notebook colours and defaults
index.html           Renderer entry point — script order matters
preferences.html     Preferences window (separate BrowserWindow, same preload)
styles/main.css      All styling, driven by --ctp-* theme tokens
plugins/             Bundled plugins
tests/               Unit tests (node:test, no Electron needed)
```

Adding an IPC channel means touching three files: `ipcMain.handle` in `main.js`, the exposed method in `preload.js`, and the call site in `renderer.js`. There is no fourth place.

**Adding a renderer script?** Add it to `index.html` *and* to `build.files` in `package.json`. A script missing from that list works in `npm start` and is silently absent from packaged builds. `tests/packaging.test.js` now fails if you forget.

---

## What's new

**Context menus for the editor and preview**
Right-click works everywhere now. Spelling suggestions and clipboard actions route through the main process so paste still reaches CodeMirror with undo history intact. Adds the Insert and Format menus described above, plus text colour and highlight via an allowlist in the Markdown parser. The sidebar's older menu widget was folded into the same one, which builds DOM nodes instead of HTML strings — the stored-XSS class fixed in `81581cd` can't recur there by construction.

**Markdown parser extracted** to `markdown-utils.js` with its own test suite, plus source-line anchors that keep the editor and preview panes in scroll sync -- the mapping is exact at every block boundary and interpolated in between, so a long code block or table no longer makes the two panes drift apart.

**Editor**: Markdown syntax highlighting, interactive task checkboxes in the preview, CodeMirror 5 with Vim mode and configurable key sequences.

**Notes**: version history with restorable snapshots, drag-to-reorder, pins, and a recoverable Trash with an undo toast instead of a confirmation dialog.

**Appearance**: glass panels with per-section blur, saturation and dimming, wallpaper backgrounds with a scrim, theme presets (Catppuccin Mocha, Tokyo Night, custom), and a `reduceTransparency` switch.

**Attachments** are stored as files under `attachments/` and referenced from note content, rather than inlined as base64.

---

## Docs

| File | What's in it |
|---|---|
| `QUICKSTART.md` | First-run walkthrough |
| `CONFIG_TEMPLATES.md` | Ready-made `config.json` themes and setups |
| `CLAUDE.md` | Architecture notes and conventions |
| `TODO_FIX.md` | Working log of known issues and root causes |
| `plugins/PLUGINS.md` | Plugin API |

## License

MIT © Ty Ellis
