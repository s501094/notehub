# TODO / FIX

## Broken / needs attention

- `exec-shell` in main.js still uses raw shell string exec (injection risk).
  A prior migration to `exec-command` (execFile + argv array) got lost to a
  `git reset --hard` mistake and was never finished. Needs a redo.
- `git-clone`'s cloned-repo `.md` walk counts files but never imports them
  as notes.
- Vim-mode custom keybindings: multi-key sequences mapped to an app action
  in Insert mode leave the last trigger key typed into the note (CodeMirror
  5 vim addon quirk — its key-to-key mappings like the built-in `jj`->Escape
  clean up properly, key-to-ex-command ones don't past 1 key). Normal mode
  is unaffected at any length. Documented as a caveat in Preferences rather
  than worked around — a fix would mean patching the vendored addon.

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
