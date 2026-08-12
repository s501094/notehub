# TODO / FIX

## Recently fixed

- Right-click context menus (notes/notebooks: rename/duplicate/pin/move/
  trash/delete-forever) shipped, then reported as breaking keyboard input
  on Mac (typing acted as if Cmd was held down, needed a full OS restart
  to clear). Root cause: `trashNoteById`/`deleteNotebook`/
  `permanentlyDeleteNote` called blocking `window.confirm()`/`alert()`
  synchronously from inside a context-menu item's click handler —
  triggering a native dialog off the tail of a right-click gesture is a
  known Electron/Chromium trigger for desyncing macOS's modifier-key
  state. Replaced all three with the existing non-blocking `showModal()`
  pattern (new `confirmModal()`/`alertModal()` helpers in `renderer.js`,
  `.btn-danger` added to `main.css`). No more blocking dialogs reachable
  from the context menu.
- Preferences' "Neovim Editor" tab: the 5 dead toggles (Syntax Highlight,
  Highlight Active Line, Matching Brackets, Auto-Close Brackets, Tab Size)
  plus a 6th that was also dead but unreported (Indent With Tabs) are now
  wired into the real CodeMirror instance (`renderer.js`), reading
  `config.nvim.*`. Added the addon/mode scripts CM needed
  (`markdown.js`+`xml.js`+`meta.js` for syntax highlighting,
  `matchbrackets.js`, `closebrackets.js`, `active-line.js`) to `index.html`,
  theme-aware CSS for active-line/matching-bracket highlighting to
  `main.css`, and `c.nvim` clamping/coercion to `sanitizeConfig()` in
  `main.js` (previously orphaned — passed through untouched). `nvLN`/`nvRLN`
  on that tab remain inert duplicates of the real toggles under the Editor
  tab (`config.editor.lineNumbers`/`relativeLineNumbers`) — left alone,
  cosmetic-only overlap, not a functional bug.
- Git shell-injection claim in CLAUDE.md was stale: all `git-*` handlers in
  `main.js` already use `execFile`/`execFileSync` with argv arrays (not
  shell string interpolation) and `--`-guard user-controlled args. No code
  change needed; corrected the doc.
- Editor pane wouldn't mouse-wheel scroll (preview pane did). `.editor-pane`
  wasn't a flex container, so the `flex:1`/`min-height:0` chain down to
  `.lined-editor-wrap` → `.CodeMirror` never got a bounded height —
  `height: 100%` resolved to `auto`, CodeMirror sized itself to its full
  content instead of creating a scrollable viewport, and `.editor-pane`'s
  `overflow: hidden` clipped the rest. Added `display: flex; flex-direction:
  column;` to `.editor-pane` (main.css) to restore the height chain.
- `exec-shell` (terminal): arbitrary shell is the feature, not a vuln — the
  terminal is the only caller. Hardened instead: input validation, cwd
  existence check, and routed through an explicit shell binary via
  `execFile('/bin/bash', ['-c', cmd])` (Windows: `cmd.exe /c`) instead of
  `exec()`'s implicit shell.
- Git clone now imports the repo's `.md` files as notes. New
  `read-repo-markdown` IPC walks the clone (skips `.git`/`node_modules`/etc,
  caps 500 files / 512KB each), `app.importRepoNotes()` drops them into a
  notebook named after the repo, path-relative titles.
- Vim insert-mode multi-key leak: was NOT a vim-addon bug. The addon cleans
  up the trigger correctly; the leak came from the editor's `change` handler
  syncing `currentNote.content` mid-sequence, so a re-rendering action
  reloaded pre-cleanup text. Fixed by deferring the bound action one
  microtask (`Promise.resolve().then`) so cleanup syncs first. Stays in
  insert mode, works for any sequence length.

## Packaging gaps (fixed, but package.json is gitignored — see note)

`package.json`'s `files` list keeps missing entries as new renderer scripts
get added. Fixed so far: `fonts/**/*`, `preferences.html`, `note-utils.js`,
`node_modules/codemirror/**/*` (CodeMirror 5 editor migration). Swept once
for anything else referenced by index.html/preferences.html and found
nothing else missing. Since `package.json` is gitignored in this repo,
none of this travels via `git pull` — it only exists in whichever local
copy already has the fix. If a fresh `ReferenceError` for an undefined
function shows up after a rebuild, check this file first.

## Design decisions pending

- Plugin system rebuild (new `notehub-plugins` repo, install-from-git-URL):
  soft capability-scoped API, not iframe sandboxing. Migrating
  git-integration + terminal first. No spec written yet.
- Right-click context menu for empty space / editor / "Open Terminal Here"
  still not built (notes + notebooks context menus shipped — see Recently
  fixed).

## Approved, not built

- Editor bright-panel + note info card + command-palette restyle (2nd slice
  of Atmosphere redesign). Spec:
  `docs/superpowers/specs/2026-07-26-visual-redesign-atmosphere.md`.
- Light-mode token values (dark mode only so far).
- Notebook color picker UI (auto-assigned from a fixed palette right now).
- Broader roadmap in `docs/superpowers/specs/2026-07-26-notehub-v2-design.md`:
  note history, backlinks, attachments, encryption, sync backend, mobile.

## Feature backlog (proposed 2026-08-10, no specs yet)

Overlaps with items above (note history, backlinks, attachments, encryption,
sync, mobile, context menus, notebook color picker, light mode) are tracked
there, not duplicated here.

- Full-text fuzzy search across all notebooks
- Quick-switcher (Cmd+K fuzzy jump between notes, VSCode-style)
- Tags/labels + tag browser sidebar
- Daily notes / journal mode (auto-dated note on open)
- Note templates on creation
- Table-of-contents sidebar generated from headings
- KaTeX math rendering in preview
- Mermaid diagram rendering in preview
- Focus/Zen mode (hide chrome, distraction-free)
- Word count / reading-time stats per note & notebook
- Export to PDF/DOCX/HTML (beyond current `.md` import)
- Split-pane multi-note editing
- Import from Obsidian/Notion/Apple Notes/Evernote
- Global hotkey quick-capture (tray icon, capture-to-inbox from anywhere)
- Kanban/task board auto-generated from checkbox lists across notes
- Plugin marketplace/registry UI (pairs with the `notehub-plugins` rebuild)
- Multi-window support (pop a note into its own window)
- Spaced-repetition flashcards from Q/A-formatted notes
- Note-level password lock (separate from full-notebook encryption)
- LLM-assisted note actions (summarize/rewrite/ask, via Claude API — fits
  `preload.js` IPC pattern)
