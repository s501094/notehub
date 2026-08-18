# TODO / FIX

## Recently fixed

- Markdown syntax highlighting in the editor. CodeMirror's markdown mode
  was already loaded and tokenizing, but `main.css` had no `.cm-*` rules,
  so every token rendered flat. Added token styling (headings scaled per
  level, emphasis, links, quotes, list markers by depth, code, hr) behind
  a `--syn-*` layer defaulting to the `--ctp-*` vocabulary, so theme
  presets re-colour the editor with the rest of the app. `theme.syntax`
  in config takes optional per-token hex overrides.
  Note: the mode was being passed as the bare string `'markdown'`, whose
  `highlightFormatting`, `strikethrough` and `taskLists` options all
  default to false — the `.cm-formatting`/`.cm-strikethrough` rules would
  have been dead CSS. Now passed as an object config with those on.
- Task list items in preview are real checkboxes instead of static
  glyphs. Clicking one flips the marker in the CodeMirror source (not the
  DOM), so editor/preview/saved note stay one source of truth.
  Index mapping caveat worth remembering: `parseMarkdown` pulls fenced
  code blocks out before its task-list pass, so a `- [ ]` line inside a
  fence never becomes a checkbox. The source-side scan has to skip fences
  too or every index after the fence shifts and the wrong line toggles.
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

## Packaging gaps

`package.json`'s `files` list keeps missing entries as new renderer scripts
get added. Fixed so far: `fonts/**/*`, `preferences.html`, `note-utils.js`,
`node_modules/codemirror/**/*` (CodeMirror 5 editor migration). Swept once
for anything else referenced by index.html/preferences.html and found
nothing else missing. If a fresh `ReferenceError` for an undefined function
shows up after a rebuild, check this file first.

`package.json` used to be gitignored on `main` and had never been committed
there — a fresh clone would `npm install` fine, then fail every
`npm run build*` because there was no `scripts` block. Fixed: the ignore line
was dropped and the file committed on `feature/mockup-theme-system-and-fixes`
(01c47a6, e278bce), and that reached `main` in 080524c.

Watch the branch, not just the commit: the syntax-highlighting and task-checkbox
work sat on `feature/mockup-theme-system-and-fixes` with no open PR (its PR #13
had merged long before), so a Windows build off `main` came out with neither
feature and no obvious error. Check `git log --oneline -3` on the machine you
build from before assuming a feature shipped.

`package-lock.json` is gitignored too, so no machine reproduces another
machine's dependency tree — a fresh `npm install` re-resolves `electron ^43`
and `electron-builder ^26` every time.

`build/` was deleted wholesale in b8ea244 while `package.json` still pointed
at `build/icon.icns` / `icon.ico` / `icons` — electron-builder doesn't error
on a missing icon path, it silently falls back to the stock Electron icon,
so this would only have surfaced in the Dock after a packaged run. Restored
from b8ea244^ and `.DS_Store` untracked.

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
