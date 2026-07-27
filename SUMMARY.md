# Project Summary Log

Running log of requests and stages, updated at the end of every iteration.
Meant to be read cold by a fresh session (Claude Code or the Claude.ai app)
picking up this project with no prior context. See `TODO_FIX.md` for the
current actionable punch list.

## What NoteHub is

A free, hackable, "own your own InkDrop" Electron desktop note-taking app.
Notebooks + notes, markdown editor with live preview, a plugin system, and
(as of this session) a from-scratch visual identity called "Atmosphere."

## Stages so far

**1. DocIt → Notehub rename cleanup.** Fixed stray "DocIt" branding left in
`setup.sh` from before the app was renamed.

**2. Feature brainstorm vs. InkDrop.** Identified and built the first round
of gaps: trash/soft-delete for notes, pin/star notes. (PR #1, merged.)

**3. Mobile/sync roadmap spec'd, not built.** A large spec
(`docs/superpowers/specs/2026-07-26-notehub-v2-design.md`) covering sync
backend, encryption, note history/backlinks/attachments, and an eventual
React Native mobile+desktop rewrite. Purely a spec — none of it has an
implementation plan yet, deliberately deferred in favor of smaller, shippable
slices first.

**4. Git plugin consolidated.** The git-integration plugin's 5-tab modal
(Clone/Status/Commit/Sync/Settings) was replaced with one view: staging
(All/Current-file), ahead/behind status, commit/pull/push/full-sync, and
per-file inline diffs. Along the way, fixed real bugs in the pre-existing git
IPC handlers: `git-status`'s porcelain parser mis-attributed staged/unstaged
files, `git-commit` force-staged everything (defeating the new staging UI),
and several handlers were vulnerable to git's argument-injection class of bug
(fixed with `--` end-of-options markers). (PR #3, closed without merging —
this work did not make it into `main`; revisit if the consolidated git panel
is still wanted.)

**5. Visual redesign: "Atmosphere."** Replaced the flat Catppuccin/boxy-border
look with a from-scratch identity — iterated live via a visual mockup tool
based on user-supplied reference images (a Hyprland desktop rice and an
illustrated analytics dashboard), landing on: per-notebook abstract gradient
"atmospheres" with real grain texture (not flat gradients) bleeding through
frosted glass panels, a physical tab rail (punch-hole texture, glossy
per-notebook-color tabs), a bento-grid Notebooks home screen with a real
per-notebook 7-day activity graph, and a stark bright-panel/dark-atmosphere
contrast in the editor. First slice shipped: fonts/tokens, bento home, tab
rail (PRs #4 and #5, merged). Second slice (editor bright panel, note info
card, command-palette restyle) is speced but not built.

**6. App icon.** Generated from scratch (Pillow/numpy, since the project's
own Electron install and no SVG rasterizer were available) — a notebook page
with a violet spine/bookmark accent on the Atmosphere gradient background.
Wired into electron-builder for mac/win/linux. (Included in PR #5.)

**7. Live bug reports from the user, mid-session.**
- Line-number gutter not scrolling in sync with the textarea (`overflow:
  hidden` blocking the JS scrollTop sync) — fixed.
- Line-number gutter counting one phantom extra line (double-counting a
  trailing newline) — fixed.
- Clicking a note from "All Notes" (no notebook selected) incorrectly
  bounced back to the bento home screen instead of opening the note — fixed.
- **A deeper, still-unresolved editor bug**: typing and pressing Enter
  doesn't reliably create a visible new line; previously-typed content gets
  pushed out of view; sometimes needs two Enter presses. Initially suspected
  the neovim-editor plugin (which does depend on an unreliable CDN load) and
  disabled it, but the bug reproduced again with it confirmed disabled —
  so it's a core bug, not the plugin. Diagnostic logging added; waiting on
  the user to reproduce with DevTools open and share console output.
- Along the way, found and fixed two real XSS-to-command-execution risks
  (unescaped note/notebook text into `innerHTML` and into an editor `value`
  attribute) — meaningful because `window.electron`/`window.electronAPI`
  exposes privileged operations (`execShell`, git commands) to the renderer,
  so this isn't just cosmetic markup injection.

**8. Process fix: a self-inflicted git mistake, twice.** An accidental
`git reset --hard` mid-session destroyed uncommitted pre-session work
(restored what could be recovered from earlier tool-call context; some of it
— `manifest.json`/`preferences.html`/`test.js` changes and a partial
`exec-shell`→`exec-command` security migration — could not be recovered).
Separately, twice pushed follow-up commits to a branch after its PR had
already been merged by the user on GitHub, meaning those commits silently
never reached `main` until caught and re-PR'd. **Lesson applied going
forward:** check `gh pr list --state all` (not just local branch state)
before assuming a branch's work has landed.

**9. New standing process, this session.** The user requested `TODO_FIX.md` +
`SUMMARY.md` (this file) in every project, read at the start of every
session and updated at the end of every iteration (bundled into whichever PR
is already being opened), specifically so Claude Code and the separate
Claude.ai app can hand off work to each other with no shared conversation
memory. Documented in the user's global `~/.claude/CLAUDE.md`.

**10. In progress when this file was created:** a custom plugin system
(new public `notehub-plugins` repo, install-from-git-URL distribution,
soft capability-scoped API instead of full sandboxing) and right-click
context menus (notes, notebooks/bento cards, empty space, editor, plus
"Open Terminal Here"). Both designed in conversation; neither has a written
spec file yet. See `TODO_FIX.md` for exact status.

## Open pull requests / branch state

Run `gh pr list --state all` for ground truth — this log can go stale.
As of this entry: PR #5 (icon + attribute-breakout fix) just merged; 4 more
commits (line-count fix, note-click fix, debug logging + its sanitization)
are pushed to `feature/visual-redesign` but not yet in a PR.
