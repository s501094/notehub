# Project Summary Log

NoteHub: free, hackable Electron note-taking app (notebooks, notes,
markdown editor, plugins). Read cold by fresh sessions; see TODO_FIX.md
for the current punch list.

## Stages

1. DocIt -> Notehub rename cleanup.
2. Trash/soft-delete + pin/star notes (PR #1).
3. Sync/mobile roadmap spec'd, not built (`docs/superpowers/specs/2026-07-26-notehub-v2-design.md`).
4. Git plugin consolidated into one view; fixed staged/unstaged parsing,
   force-stage-on-commit, and argument-injection bugs in the git handlers
   (PR #3).
5. Visual redesign "Atmosphere": per-notebook gradient/grain atmospheres,
   glass panels, tab rail, bento-grid home screen with real activity
   graphs, bright-panel editor contrast (PRs #4-7).
6. App icon generated from scratch (Pillow/numpy — no rasterizer or
   working local Electron available).
7. Live bugs found/fixed: line-number gutter scroll-sync, phantom
   line-count, note-click-from-All-Notes bouncing to home screen, two
   XSS-to-command-execution risks (unescaped note text into innerHTML and
   into a value attribute).
8. Process mistakes this session: an accidental `git reset --hard` lost
   some uncommitted pre-session work (partially recovered); pushed
   follow-up commits to branches after their PRs were already merged,
   twice, before catching it — always check `gh pr list --state all`
   before assuming a branch's work landed.
9. TODO_FIX.md / SUMMARY.md convention adopted (documented in
   `~/.claude/CLAUDE.md`), plus a standing "don't sound like AI slop"
   style rule for commits/PRs/docs.
10. PRs #1-3 had been closed without merging (each forked independently
    from the same early commit, so none built on each other). Recovered
    and reconciled all three against current main in one branch
    (`feature/recover-1-2-3`): trash/pin, the consolidated git panel +
    hardened git handlers, and the setup.sh/duplicate-tree cleanup. Found
    and restored a real lost feature along the way (vim-style relative
    line numbers, also a `git reset --hard` casualty) and fixed two new
    interaction bugs between Trash and the bento home-view guard. 16/16
    tests passing; couldn't smoke-test locally (this machine's Electron
    install is missing its framework binary, no network access to fix it
    from here) — verified via syntax checks and manual conflict review
    instead.

11. Editor migrated from a plain `<textarea>` + hand-rolled line-number
    gutter to a real CodeMirror 5 instance (pinned `^5.65.18`, loaded via
    local UMD script/CSS — no CDN). Removed `updateLineNumbers()` and all
    manual scroll/wheel-sync code. Relative line numbers now use CM's
    `lineNumberFormatter` + a guarded `cursorActivity` → `cm.refresh()`
    (setOption to its own value silently no-ops in CM5, contrary to the
    common trick). Word wrap/spellcheck/line-numbers config now map to CM
    options directly. `excel-integration`'s insert-to-note now goes through
    `app.cm.replaceSelection()` instead of reaching for the now-gone
    `#editorContent` textarea. Verified end-to-end via a Playwright
    `_electron` driver (typing, preview, word-wrap, relative numbers,
    save roundtrip, packaged `--dir` build contains
    `node_modules/codemirror`). Along the way: local Electron install was
    missing its Frameworks bundle again (npm's install-scripts allowlist
    blocked the postinstall, and even after approving it, `@electron/get`'s
    own extraction was silently dropping symlinks — fixed by unzipping the
    cached archive with the system `unzip` instead).

12. Added Vim mode: CodeMirror's `keymap/vim.js` + `addon/dialog/dialog.js`
    loaded locally alongside the editor, toggled via `editor.vimMode` in
    Preferences (`keyMap: 'vim'|'default'`). Custom keybindings
    (`editor.vimKeybindings`, each `{action, keys, mode}`) reuse the
    existing command-palette action registry — a Vim key sequence maps to
    an app action via `CodeMirror.Vim.defineEx()` + `.map()`. Found and
    documented (not worked around) a real CodeMirror 5 vim-addon quirk:
    multi-key sequences mapped to an ex-command in Insert mode leak their
    last trigger character into the note; Normal mode has no such issue at
    any length, and the built-in key-to-key `jj`->Escape idiom is
    unaffected. Verified via the same Playwright `_electron` driver
    approach as the CodeMirror migration itself.

13. Fixed two live bugs reported after the CodeMirror/Vim-mode work (item
    12), both root-caused via a real running instance over CDP rather than
    static reading:
    - Terminal Enter key did nothing: `applyConfigLive`'s plugin-reload
      check compared `plugins.enabled` order-sensitively, but Preferences
      rebuilds that array from the full plugin list every save — so almost
      any save looked like "the plugin list changed" and re-ran
      `loadPlugins()`. The terminal plugin has no reload guard, so it
      injected a second `#nhTerm`/`#nhTermIn`; duplicate ids always resolve
      to the first (stale, invisible) element via `getElementById`, so the
      visible instance's input had no listener at all. Fixed the compare to
      be order-independent and made the terminal plugin idempotent on
      reload (tears down its own prior DOM first) as a second line of
      defense.
    - Relative line numbers did nothing: Preferences' leftover "Neovim
      Editor" tab (pre-CodeMirror-migration UI, `config.nvim` namespace)
      was the only place the toggle existed, and nothing reads
      `config.nvim` anymore. Added a real toggle to the Editor panel wired
      to `editor.relativeLineNumbers`, which `renderer.js`'s
      `lineNumberFormatter` actually reads. Rest of that dead panel is
      still there — see TODO_FIX.md.

14. Added a hackable appearance/glass system (`config.appearance`):
    background opacity, blur, saturation, corner radius, and shadow
    intensity, either unified (one `--nh-glass-*` set on `:root`, cascades
    everywhere) or per-section (Sidebar/Editor/Preview/Panels each get
    their own inline-scoped override — CSS custom properties resolve to
    the nearest declaring element, so no per-component JS is needed; new
    plugin panels inherit the "Panels" scope for free just by living under
    `<body>`). Plus a full-window background image
    (`choose-background-image` IPC copies the picked file into
    `userData/backgrounds/`) and a raw custom-CSS textarea injected last.
    All wired through the existing Apply/Save flow — no new live-preview
    plumbing needed. Verified end-to-end over CDP: unified mode, per-section
    independence, background image + app-container transparency, custom
    CSS, and the terminal panel auto-inheriting "Panels" glass on reload
    with zero extra code.

15. Cleared the three "Broken / needs attention" items from TODO_FIX.md,
    all root-caused against a live instance over CDP:
    - `exec-shell`: the terminal is its only caller and arbitrary shell IS
      the feature, so the "injection" framing didn't apply — an execFile+argv
      migration would break pipes/&&/globs the terminal needs. Hardened
      instead (validate cmd, verify cwd, explicit shell binary via
      `execFile(shell, ['-c', cmd])`, kept timeout/maxBuffer).
    - Git clone markdown import: added `read-repo-markdown` IPC (bounded
      walk, skips VCS/dep dirs, 500-file/512KB caps) + `app.importRepoNotes`
      creating a repo-named notebook with path-relative note titles; wired
      into the git plugin's clone success path (best-effort, won't fail the
      clone). Verified: 13 .md files from this repo imported correctly.
    - Vim insert-mode multi-key "leak" turned out NOT to be the vendored
      addon. Reproduced the leak with real key events over CDP ("helloj"),
      then isolated it: with a non-re-rendering action the addon cleans up
      fine — the stray char only survived when the bound action re-rendered
      the editor, because the editor's `change` handler had already synced
      the mid-sequence text into `currentNote.content` and renderEditor
      reloaded it before the addon's cleanup deletion settled. Fixed by
      deferring the action one microtask (`Promise.resolve().then(cmd.run)`)
      so cleanup wins the race. Confirmed: command fires, no leak, stays in
      insert mode, any sequence length. (A first attempt — routing insert
      bindings through a `<Esc>:cmd<CR>` keyToKey chain — was reverted after
      CDP showed it stopped the leak but silently failed to run the command,
      since the ex-dialog replay never executes.)

16. Fixed editor pane mouse-wheel scroll (`.editor-pane` wasn't a flex
    container, so CodeMirror never got a bounded height to scroll within —
    see TODO_FIX.md). Proposed and logged a 20-item feature/addon backlog
    (search, quick-switcher, tags, daily notes, templates, TOC, math/mermaid
    rendering, focus mode, stats, exports, split-pane, importers, quick-
    capture, kanban-from-checkboxes, plugin marketplace, multi-window,
    flashcards, note-level lock, LLM-assisted actions) — tracked in
    TODO_FIX.md, nothing built yet.

17. Cleared the two remaining known bugs from TODO_FIX.md:
    - Neovim-tab's 5 dead toggles (+ a 6th, Indent With Tabs, found dead but
      previously unreported) wired into the real CodeMirror instance —
      syntax highlighting (markdown mode), active-line highlight, matching
      brackets, auto-close brackets, tab size/indent-with-tabs, all reading
      `config.nvim.*`. Loaded the needed CM addon/mode scripts
      (`index.html`), added theme-aware CSS for the two new highlight
      states (`main.css`), and gave `config.nvim` real validation in
      `sanitizeConfig()` (`main.js`) — it had been silently orphaned since
      the CodeMirror migration.
    - Git shell-injection risk noted in CLAUDE.md's Key Design Constraints
      turned out to be stale — every `git-*` handler already uses
      `execFile`/`execFileSync` with argv arrays and `--`-guards. No code
      change; corrected the doc.
    Next up: start building from the feature backlog above.

18. Implemented right-click context menus for notes/notebooks (rename,
    duplicate, pin, move-to-notebook, trash/delete-forever) — in-page DOM
    menu (`openContextMenu`) rather than a native Electron `Menu.popup`, so
    it's themeable and consistent cross-platform. Reported as breaking Mac
    keyboard input afterward (typing behaved as if Cmd was stuck down,
    needed an OS restart). Root cause: the trash/delete actions called
    blocking `window.confirm()`/`alert()` synchronously from a context-menu
    click handler — a known Electron/Chromium trigger for macOS
    modifier-key desync. Replaced with the existing non-blocking
    `showModal()` pattern (new `confirmModal()`/`alertModal()` helpers).

## Current state

Check `gh pr list --state all` for ground truth. As of this entry: PRs
#1-7 exist, only #4-7 are merged into main. A new PR for
`feature/recover-1-2-3` is about to be opened.
