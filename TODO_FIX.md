# TODO / FIX

## Broken / needs attention

- Editor cursor/newline bug: typing + Enter doesn't reliably advance the
  cursor, old lines get pushed off screen. Not caused by neovim-editor
  (reproduces with it disabled). User was testing a stale packaged build
  when this was reported — packaging gaps below likely explain a chunk of
  what they saw. Needs retest on a fresh build before assuming it's still
  real.
- `exec-shell` in main.js still uses raw shell string exec (injection risk).
  A prior migration to `exec-command` (execFile + argv array) got lost to a
  `git reset --hard` mistake and was never finished. Needs a redo.
- `git-clone`'s cloned-repo `.md` walk counts files but never imports them
  as notes.

## Packaging gaps (fixed in this PR)

- `package.json`'s `files` list was missing `fonts/**/*` and
  `preferences.html` — packaged builds shipped without the Atmosphere fonts
  and a broken Preferences window. Note: `package.json` is gitignored in
  this repo, so this fix lives only in whoever's local copy has it — not
  something `git pull` delivers.

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
