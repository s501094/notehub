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

## Current state

Check `gh pr list --state all` for ground truth. As of this entry: PRs
#1-7 exist, only #4-7 are merged into main. A new PR for
`feature/recover-1-2-3` is about to be opened.
