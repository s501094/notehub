# TODO / FIX

Tracked at the project root, kept current at the end of every iteration. See
`SUMMARY.md` for the running narrative log of requests and stages.

## 🔴 Flagged as broken / actively being debugged

- **Editor cursor/newline bug (STATUS UNCLEAR — likely a stale-build artifact,
  needs retest)**: typing in the note editor and pressing Enter doesn't
  reliably advance the cursor — previously-typed lines get pushed up/out of
  view, sometimes requiring two Enter presses to register a line break.
  Confirmed NOT caused by the neovim-editor plugin (reproduces with it
  disabled). Full `renderEditor()`/event-handler code path was read with no
  obvious culprit identified in source. Diagnostic logging was added
  (`[DEBUG renderEditor]`, `[DEBUG keydown]`, `[DEBUG input]`,
  `[DEBUG updateLineNumbers]` console.log lines in `renderer.js`), but the
  user reported seeing NONE of that logging fire at all when reproducing —
  turned out they were testing an installed/packaged build, not live source.
  Two confirmed packaging gaps were found (see below) that would make a
  packaged build behave like much-older code. **Next step: merge PR #6,
  rebuild the packaged app fresh, and retest before assuming this bug still
  exists in current source** — it may already be fixed and this was stale
  build artifacts the whole time.
- **Packaging gaps in electron-builder's `files` list (FIXED locally in
  `package.json`, not committed — package.json is gitignored per this repo's
  existing setup)**: `fonts/**/*` and `preferences.html` were both missing,
  so a packaged build would silently ship without the Atmosphere fonts
  (matches the `net::ERR_FILE_NOT_FOUND` on `inter-variable.woff2` /
  `space-grotesk-variable.woff2` the user saw) and without a working
  Preferences window at all. Confirmed fixed in the local `package.json`;
  since that file isn't tracked in git, **whoever rebuilds needs this fix
  present locally** — it is not something `git pull` will bring in.
- **`exec-command` security migration incomplete**: a prior session had
  started migrating `main.js`'s `exec-shell` handler (raw shell string, known
  injection risk) to a safer `exec-command` handler (execFile + argv array),
  but that work-in-progress main.js code was lost to an accidental
  `git reset --hard` and was never fully recovered — `preload.js`'s
  `execShell` binding currently still points at the original unsafe
  `exec-shell` channel (see the FIXME comment right above it). Needs a
  deliberate redo, not a quick patch.
- **Clone-import stub**: `git-clone`'s handler in `main.js` walks a cloned
  repo's `.md` files and counts them but never actually imports them as
  notes (`// Would need to import into data.json here`). Pre-existing gap,
  not yet scheduled.

## 🟡 In-flight design decisions (need your input to proceed)

- **Plugin system rebuild** (`notehub-plugins` repo, install-from-git-URL
  distribution): confirmed direction is "soft" capability enforcement (a
  scoped API object per declared capability, not full iframe sandboxing) —
  but this was explained, not yet explicitly re-confirmed as final after the
  explanation. Migrating `git-integration` + `terminal` first; other plugins
  (`advanced-search`, `docx-converter`, `excel-integration`, `math-renderer`,
  `neovim-editor`) stay in the old system for now. No spec written yet.
- **Right-click context menus**: design approved in conversation (note items,
  notebook items/bento cards, empty space, editor text area, plus an "Open
  Terminal Here" action on notebooks). Not yet written into a spec doc or
  implementation plan.

## 🟢 Approved, not yet built

- Editor bright-panel treatment + note info card + command-palette glass
  restyle — the second slice of the "Atmosphere" visual redesign (first
  slice — fonts/tokens, bento home, tab rail — already merged). Spec exists:
  `docs/superpowers/specs/2026-07-26-visual-redesign-atmosphere.md`.
- Light-mode exact token values for the Atmosphere redesign (only dark mode
  implemented so far).
- Notebook color *picker* UI (colors currently auto-assigned from a fixed
  4-color palette by creation order; letting users override is a small
  later addition).
- `docs/superpowers/specs/2026-07-26-notehub-v2-design.md`'s broader roadmap:
  note version history, note linking/backlinks, attachments, client-side
  encryption, hosted sync backend, and the eventual React Native mobile
  rewrite. None of this has a plan or implementation yet.

## Known-safe to ignore

- The `files/notehub/*` duplicate directory tree, `notehub.zip`, and
  `plugins/neovim-editor/*` deletions from PR #2 (closed, not merged) — if
  these reappear in your working tree, they're stale duplicates safe to
  delete, not real content.
