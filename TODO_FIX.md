# TODO / FIX

## Recently fixed

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

## Broken / needs attention

- Preferences' "Neovim Editor" tab (`panel-nvim`, `NEOVIM-EDITOR PLUGIN`
  badge) is leftover from before the CodeMirror migration — `config.nvim`
  is never read anywhere in renderer.js. Its Line Numbers + Relative Line
  Numbers toggles were fixed by adding real controls to the Editor panel
  instead (wired to `editor.lineNumbers`/`editor.relativeLineNumbers`,
  which the CM instance actually reads). The other 5 toggles in that tab
  (Syntax Highlight, Highlight Active Line, Matching Brackets, Auto-Close
  Brackets, Tab Size/indent) are still fully dead — left alone since fixing
  them means deciding whether to wire them into CM or delete the tab
  outright, out of scope for the bug that was actually reported.

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
- Right-click context menus (notes, notebooks/bento cards, empty space,
  editor, "Open Terminal Here"): design approved, no spec/plan yet.

## Approved, not built

- Editor bright-panel + note info card + command-palette restyle (2nd slice
  of Atmosphere redesign). Spec:
  `docs/superpowers/specs/2026-07-26-visual-redesign-atmosphere.md`.
- Light-mode token values (dark mode only so far).
- Notebook color picker UI (auto-assigned from a fixed palette right now).
- Broader roadmap in `docs/superpowers/specs/2026-07-26-notehub-v2-design.md`:
  note history, backlinks, attachments, encryption, sync backend, mobile.
