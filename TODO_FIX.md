# TODO / FIX

## Broken / needs attention

- Editor cursor/newline bug: CONFIRMED real via screen recording
  (2026-07-27), not a stale-build artifact. Root cause found in
  renderer.js's editor setup: (1) `updateLineNumbers()` does a full
  `ln.innerHTML` rebuild of every gutter `<div>` synchronously on every
  `input` event, including Enter — under typing load this can stack
  faster than the browser repaints, causing the "needs two Enter presses"
  / lines-pushed-out-of-view stutter. Fix: diff against the gutter's
  current child count before rebuilding, or wrap the rebuild in
  requestAnimationFrame. (2) Dead listener at
  `contentInput.addEventListener('selectionchange', updateLineNumbers)`
  (~line 1056) — `selectionchange` only ever fires on `document`, never
  on an individual element, so this line silently never runs. Either
  remove it, or move it to `document.addEventListener('selectionchange',
  ...)` with a `document.activeElement === contentInput` guard if the
  relative-line-number-on-selection-change behavior was actually
  intended.
- `exec-shell` in main.js still uses raw shell string exec (injection risk).
  A prior migration to `exec-command` (execFile + argv array) got lost to a
  `git reset --hard` mistake and was never finished. Needs a redo.
- `git-clone`'s cloned-repo `.md` walk counts files but never imports them
  as notes.

## Packaging gaps (fixed, but package.json is gitignored — see note)

`package.json`'s `files` list keeps missing entries as new renderer scripts
get added. Fixed so far: `fonts/**/*`, `preferences.html`, `note-utils.js`.
Swept once for anything else referenced by index.html/preferences.html and
found nothing else missing. Since `package.json` is gitignored in this
repo, none of this travels via `git pull` — it only exists in whichever
local copy already has the fix. If a fresh `ReferenceError` for an
undefined function shows up after a rebuild, check this file first.

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
