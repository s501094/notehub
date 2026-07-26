# Git Panel Consolidation

Status: Approved (2026-07-26)

## Goal

The `git-integration` plugin currently splits Clone/Status/Commit/Sync/Settings
across 5 separate tabs inside its modal (`plugins/git-integration/index.js`).
Replace this with a single consolidated view, plus a proper staging workflow
(explicit add/unstage) and a side-by-side diff view — locked in via the
visual brainstorming companion (mockup screens: `git-panel-layout.html` →
`git-panel-combined.html` → `git-diff-view.html` → `git-panel-v3.html`).

This spec covers the git panel only. The separate "overall look" revamp
(Catppuccin-on-Windows-7 complaint) is a distinct sub-project, brainstormed
next.

## Locked visual design

One view, no tab-switching:

1. **Status line**: `<branch> · ↑<ahead> ↓<behind> · <N> changed`
2. **Staging row**: a 2-way segmented control (`All changes` / `Current file`)
   next to **Add** and **Clear Staged** buttons
3. **Commit row**: message input + **Commit** / **Pull** / **Push** /
   **Full Sync** buttons
4. **Repository section**: collapsed by default (repo path, remote name,
   branch, git user name/email — the old "Settings" tab's fields)
5. **Status list**: one row per changed file, tagged `(staged)` when
   applicable. Clicking a row expands an inline diff directly beneath that
   row (not a separate box below the whole list) — HEAD content on the left,
   pending content on the right, with real added/removed line highlighting
   parsed from git's own diff output.

After a successful push, the panel re-fetches status so the ahead/behind
count and HEAD-side diff content reflect what was just pushed.

## Pre-existing issues this work must fix

Discovered while reviewing `main.js:553-679`; each blocks a part of the
locked design above, so fixing them is in scope, not a separate cleanup:

1. **`git-commit` force-stages everything.** It runs `git add -A` internally
   (`main.js:645`) before committing. This must be removed — commit should
   only commit whatever is currently staged, and report "nothing staged"
   distinctly from "nothing to commit" if the index is empty. Otherwise the
   new Add/Clear Staged controls have no effect.
2. **`git-status` collapses staged vs. unstaged into one status string.**
   `git status --porcelain`'s first column is index (staged) status, the
   second is worktree (unstaged) status; the current code does
   `line.substring(0,2).trim()`, discarding the distinction. Needs to parse
   both columns separately so a file can be flagged `staged: true/false`.
3. **No ahead/behind tracking exists.** Needed for the `↑1 ↓0` indicator.
4. **The clone-import flow is a stub.** `git-clone`'s walk over cloned
   `.md` files (`main.js:580-595`) counts files but never imports them into
   `notebooks.json` notes, and there is no persistent note↔file-path
   mapping anywhere in the app. This means "Current file" mode has no
   existing anchor to resolve which repo file corresponds to the open note.
   **Resolution for this spec:** "Current file" mode writes the currently
   open note's content to a deterministic path in the repo
   (`<repoPath>/<slugified-note-title>.md`) immediately before staging or
   diffing — no new persistent mapping field, no change to the clone-import
   stub (that stub is a separate, pre-existing gap, left as-is here since
   fixing note-import-on-clone is unrelated to consolidating the panel).

## IPC changes (`main.js`, `preload.js`)

All new/modified handlers use `execFile`/`execFileSync` with argument
arrays (per this project's CLAUDE.md: "Prefer `execFile` with argument
arrays" for git handlers) — no shell string interpolation.

- **Modify `git-status(repoPath)`**: parse porcelain output's index and
  worktree columns separately per file
  (`{ path, indexStatus, worktreeStatus, staged }`). Add ahead/behind via
  `git rev-list --left-right --count @{upstream}...HEAD` (if no upstream is
  configured, return `{ ahead: null, behind: null }` rather than erroring).
- **Modify `git-commit(repoPath, message, userName, userEmail)`**: remove
  the internal `git add -A`. If `git status --porcelain` shows no staged
  entries, return `{ success: false, staged: false, error: 'Nothing staged to commit' }`
  without attempting the commit.
- **New `git-add(repoPath, scope, filePath)`**: `scope === 'all'` runs
  `git add -A`; `scope === 'file'` runs `git add -- <filePath>` (`filePath`
  required in that case).
- **New `git-unstage(repoPath, scope, filePath)`**: same scope contract,
  using `git reset` / `git reset -- <filePath>`.
- **New `git-diff-file(repoPath, filePath)`**: returns HEAD content (via
  `git show HEAD:<filePath>`, or `null` if the file is new/untracked) and
  working-tree content (`fs.readFileSync`), plus a parsed line-level diff
  (added/removed/context) derived from `git diff --no-color -- <filePath>`
  so the renderer can align two columns without re-implementing a diff
  algorithm client-side.
- **`preload.js`**: expose `gitAdd`, `gitUnstage`, `gitDiffFile` alongside
  the existing `gitClone`/`gitStatus`/`gitCommit`/`gitPull`/`gitPush`.

## Plugin rewrite (`plugins/git-integration/index.js`)

Replace the 5-tab modal body with the single view above. State moves from
`gitConfig` (already `localStorage`-backed, left as-is — out of scope to
migrate this into the app's `config.json`) plus new local state:
`addScope: 'all' | 'file'`, `expandedDiffPath: string | null`. The existing
`gitConfig`/localStorage persistence, keyboard shortcut (Cmd+Shift+G), and
`registerPluginAction` hook are unchanged.

## Error handling

- No repo configured yet: status line and staging controls show a single
  "Clone a repository to get started" prompt instead of the full panel
  (matches today's "No repository configured" messaging, just centralized).
  Reuse the Clone form as the empty state's content.
- `git` binary missing / any `execFile` failure: surface `stderr`/`err.message`
  in the relevant section's status area, same pattern the existing handlers
  already use (`{ success: false, error }`) — no new error-handling
  mechanism needed, just apply it to the new handlers too.
- Diffing a binary or deleted file: `git show`/`git diff` on a binary file
  return non-UTF8 or empty content; detect via `git diff --no-color --numstat`
  reporting `-` for binary files and show "Binary file — diff not shown"
  instead of attempting to render it as text.

## Testing approach

The diff-parsing logic (unified diff → structured added/removed/context
lines) is pure string processing and belongs in `note-utils.js`'s sibling
testable module, not inline in the plugin — extract as `git-diff-utils.js`
following the same Node-test-runner pattern established in
`docs/superpowers/plans/2026-07-26-trash-and-pins.md` (plain functions,
CommonJS-exported, `<script>`-loadable). Unit tests cover: a simple
modified-line hunk, an added-lines-only hunk, a removed-lines-only hunk, and
a file with no diff (identical content). IPC handler changes are verified
manually via `npm start` against a real cloned repo, since they shell out to
the actual `git` binary.

## Out of scope (this spec)

- Per-file staging (confirmed: all-at-once + current-file-only covers the
  need; no per-file checkboxes).
- Fixing the clone-import stub to actually import `.md` files as notes —
  pre-existing gap, unrelated to this consolidation.
- Migrating git plugin config out of `localStorage` into the app's
  `config.json` — unrelated to the tab consolidation.
- The overall visual/theme redesign — separate sub-project, next.
