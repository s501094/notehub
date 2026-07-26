# Git Panel Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the git-integration plugin's 5-tab modal (Clone/Status/Commit/Sync/Settings) with a single consolidated view: staging controls (Add All / Add Current File / Clear Staged), a commit/pull/push/sync command row, a collapsed-by-default Repository settings section, and a per-file click-to-expand side-by-side diff.

**Architecture:** Diff-parsing (unified diff → side-by-side rows) is pure string logic, extracted into `plugins/git-integration/git-diff-utils.js` and unit tested via Node's built-in test runner, following the same pattern as `note-utils.js`. `main.js` gains/fixes IPC handlers for staging and diffing (all via `execFile`/`execFileSync` with argument arrays, per this project's CLAUDE.md). The plugin's UI (`plugins/git-integration/index.js`) is rewritten to render one view instead of switching between 5 tab renderers.

**Tech Stack:** Vanilla JS, Node's built-in `node --test`, Electron `child_process.execFile`/`execFileSync`.

## Global Constraints

- Every new/modified git IPC handler uses `execFile`/`execFileSync` with argument arrays — no shell string interpolation (per this project's CLAUDE.md: "Prefer `execFile` with argument arrays when modifying or extending these handlers").
- `contextIsolation: true` / `nodeIntegration: false` unchanged — new handlers are exposed only through `preload.js`'s existing `contextBridge` pattern.
- The plugin's existing `gitConfig`/`localStorage` persistence, Cmd+Shift+G shortcut, and `app.registerPluginAction` hook stay as-is (out of scope per the spec).
- All-at-once staging only (`all` | `file` scope) — no per-file checkboxes (confirmed during brainstorming).

---

### Task 1: `git-diff-utils.js` — unified diff → side-by-side rows

**Files:**
- Create: `plugins/git-integration/git-diff-utils.js`
- Create: `tests/git-diff-utils.test.js`

**Interfaces:**
- Produces: `parseUnifiedDiff(diffText)` → `Hunk[]`, where `Hunk = { oldStart, oldLines, newStart, newLines, lines: Line[] }` and `Line = { type: 'context'|'added'|'removed', text: string }`
- Produces: `hunksToSideBySide(hunks)` → `Row[]`, where `Row = { left: Line|null, right: Line|null }` (a `Line` here omits nothing — same `{type, text}` shape; `null` means "blank on this side")

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/git-diff-utils.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUnifiedDiff, hunksToSideBySide } = require('../plugins/git-integration/git-diff-utils');

test('parseUnifiedDiff extracts hunk header fields and classifies lines', () => {
  const diff = [
    'diff --git a/renderer.js b/renderer.js',
    'index abc123..def456 100644',
    '--- a/renderer.js',
    '+++ b/renderer.js',
    '@@ -1,3 +1,3 @@',
    ' function old() {',
    '-  return 1;',
    '+  return 2;',
    ' }',
    '',
  ].join('\n');

  const hunks = parseUnifiedDiff(diff);
  assert.equal(hunks.length, 1);
  assert.deepEqual(
    { oldStart: hunks[0].oldStart, oldLines: hunks[0].oldLines, newStart: hunks[0].newStart, newLines: hunks[0].newLines },
    { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 }
  );
  assert.deepEqual(hunks[0].lines, [
    { type: 'context', text: 'function old() {' },
    { type: 'removed', text: '  return 1;' },
    { type: 'added',   text: '  return 2;' },
    { type: 'context', text: '}' },
  ]);
});

test('parseUnifiedDiff returns empty array for empty input', () => {
  assert.deepEqual(parseUnifiedDiff(''), []);
  assert.deepEqual(parseUnifiedDiff(null), []);
});

test('hunksToSideBySide pairs a removed line with its replacement', () => {
  const hunks = [{
    oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
    lines: [
      { type: 'context', text: 'function old() {' },
      { type: 'removed', text: '  return 1;' },
      { type: 'added',   text: '  return 2;' },
      { type: 'context', text: '}' },
    ],
  }];

  assert.deepEqual(hunksToSideBySide(hunks), [
    { left: { type: 'context', text: 'function old() {' }, right: { type: 'context', text: 'function old() {' } },
    { left: { type: 'removed', text: '  return 1;' },       right: { type: 'added',   text: '  return 2;' } },
    { left: { type: 'context', text: '}' },                 right: { type: 'context', text: '}' } },
  ]);
});

test('hunksToSideBySide leaves the left side blank for an added-only run', () => {
  const hunks = [{
    oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
    lines: [
      { type: 'context', text: 'function old() {' },
      { type: 'added',   text: "  console.log('new');" },
      { type: 'context', text: '}' },
    ],
  }];

  assert.deepEqual(hunksToSideBySide(hunks), [
    { left: { type: 'context', text: 'function old() {' }, right: { type: 'context', text: 'function old() {' } },
    { left: null, right: { type: 'added', text: "  console.log('new');" } },
    { left: { type: 'context', text: '}' }, right: { type: 'context', text: '}' } },
  ]);
});

test('hunksToSideBySide leaves the right side blank for a removed-only run', () => {
  const hunks = [{
    oldStart: 1, oldLines: 3, newStart: 1, newLines: 2,
    lines: [
      { type: 'context', text: 'function old() {' },
      { type: 'removed', text: "  console.log('old');" },
      { type: 'context', text: '}' },
    ],
  }];

  assert.deepEqual(hunksToSideBySide(hunks), [
    { left: { type: 'context', text: 'function old() {' }, right: { type: 'context', text: 'function old() {' } },
    { left: { type: 'removed', text: "  console.log('old');" }, right: null },
    { left: { type: 'context', text: '}' }, right: { type: 'context', text: '}' } },
  ]);
});

test('hunksToSideBySide pads the shorter side when run lengths differ', () => {
  const hunks = [{
    oldStart: 1, oldLines: 1, newStart: 1, newLines: 2,
    lines: [
      { type: 'removed', text: 'one line' },
      { type: 'added',   text: 'first new line' },
      { type: 'added',   text: 'second new line' },
    ],
  }];

  assert.deepEqual(hunksToSideBySide(hunks), [
    { left: { type: 'removed', text: 'one line' }, right: { type: 'added', text: 'first new line' } },
    { left: null, right: { type: 'added', text: 'second new line' } },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/git-diff-utils.test.js`
Expected: FAIL — `Cannot find module '../plugins/git-integration/git-diff-utils'`

- [ ] **Step 3: Write the minimal implementation**

```javascript
// plugins/git-integration/git-diff-utils.js
function parseUnifiedDiff(diffText) {
    if (!diffText) return [];
    const lines = diffText.split('\n');
    const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
    const hunks = [];
    let current = null;

    for (const line of lines) {
        const match = line.match(hunkHeaderRe);
        if (match) {
            current = {
                oldStart: parseInt(match[1], 10),
                oldLines: match[2] !== undefined ? parseInt(match[2], 10) : 1,
                newStart: parseInt(match[3], 10),
                newLines: match[4] !== undefined ? parseInt(match[4], 10) : 1,
                lines: [],
            };
            hunks.push(current);
            continue;
        }
        if (!current) continue;
        if (line.startsWith('+')) current.lines.push({ type: 'added', text: line.slice(1) });
        else if (line.startsWith('-')) current.lines.push({ type: 'removed', text: line.slice(1) });
        else if (line.startsWith(' ')) current.lines.push({ type: 'context', text: line.slice(1) });
    }
    return hunks;
}

function hunksToSideBySide(hunks) {
    const rows = [];
    for (const hunk of hunks) {
        const lines = hunk.lines;
        let i = 0;
        while (i < lines.length) {
            if (lines[i].type === 'context') {
                rows.push({ left: { ...lines[i] }, right: { ...lines[i] } });
                i++;
                continue;
            }
            const removedRun = [];
            while (i < lines.length && lines[i].type === 'removed') { removedRun.push(lines[i]); i++; }
            const addedRun = [];
            while (i < lines.length && lines[i].type === 'added') { addedRun.push(lines[i]); i++; }
            const maxLen = Math.max(removedRun.length, addedRun.length);
            for (let j = 0; j < maxLen; j++) {
                rows.push({
                    left: removedRun[j] ? { ...removedRun[j] } : null,
                    right: addedRun[j] ? { ...addedRun[j] } : null,
                });
            }
        }
    }
    return rows;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseUnifiedDiff, hunksToSideBySide };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/git-diff-utils.test.js`
Expected: PASS — all 6 tests green

- [ ] **Step 5: Commit**

```bash
git add plugins/git-integration/git-diff-utils.js tests/git-diff-utils.test.js
git commit -m "feat: add git-diff-utils to parse unified diffs into side-by-side rows"
```

---

### Task 2: IPC handlers — staging, fixed status/commit, diff

**Files:**
- Modify: `main.js:609-632` (`git-status`)
- Modify: `main.js:638-663` (`git-commit`)
- Modify: `main.js` (new handlers: `git-add`, `git-unstage`, `export-note-to-path`, `git-diff-file`, placed after `git-push`)
- Modify: `preload.js` (expose `gitAdd`, `gitUnstage`, `gitDiffFile`, `exportNoteToPath`)

**Interfaces:**
- Produces (renderer-facing, via preload): `window.electron.gitAdd(repoPath, scope, filePath?)`, `window.electron.gitUnstage(repoPath, scope, filePath?)`, `window.electron.gitDiffFile(repoPath, filePath)` where `scope` is `'all' | 'file'`, and `window.electron.exportNoteToPath(note, targetPath)` — writes `note.content` to `targetPath` (used by Task 3 to sync the open note into the repo before "Current file" staging/diffing)
- `git-status` now returns `files: [{ path, indexStatus, worktreeStatus, staged }]` and `ahead: number|null, behind: number|null` instead of the old flat `{ status, path }[]`

- [ ] **Step 1: Fix `git-status` to split staged/unstaged and add ahead/behind**

Replace the body of the `git-status` handler (`main.js:609-632`):
```javascript
ipcMain.handle('git-status', async (event, repoPath) => {
  try {
    const { execSync, execFileSync } = require('child_process');
    const cwd = repoPath;

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd }).toString().trim();
    const commit = execSync('git rev-parse HEAD', { cwd }).toString().trim();
    const statusOut = execSync('git status --porcelain', { cwd }).toString();
    const clean = !statusOut.trim();

    const files = statusOut.trim().split('\n').filter(Boolean).map(line => {
      const indexStatus    = line[0] === ' ' ? '' : line[0];
      const worktreeStatus = line[1] === ' ' ? '' : line[1];
      const fpath = line.substring(3);
      return { path: fpath, indexStatus, worktreeStatus, staged: !!indexStatus && indexStatus !== '?' };
    });

    let ahead = null, behind = null;
    try {
      const counts = execFileSync('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd })
        .toString().trim().split(/\s+/).map(Number);
      [behind, ahead] = counts;
    } catch {
      // No upstream configured — leave ahead/behind as null
    }

    return {
      success: true,
      branch,
      commit,
      clean,
      status: statusOut || 'Working tree clean',
      files,
      ahead,
      behind,
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
```

- [ ] **Step 2: Stop `git-commit` from force-staging everything**

Replace the body of the `git-commit` handler (`main.js:638-663`):
```javascript
ipcMain.handle('git-commit', async (event, repoPath, message, userName, userEmail) => {
  try {
    const { execFileSync } = require('child_process');
    const cwd = repoPath;

    if (userName) execFileSync('git', ['config', 'user.name', userName], { cwd });
    if (userEmail) execFileSync('git', ['config', 'user.email', userEmail], { cwd });

    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd }).toString().trim();
    if (!staged) {
      return { success: false, staged: false, error: 'Nothing staged to commit' };
    }

    const commitOut = execFileSync('git', ['commit', '-m', message], { cwd });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim();

    return { success: true, commit, message, output: commitOut.toString() };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
```

- [ ] **Step 3: Add `git-add` and `git-unstage` handlers**

Add after the `git-push` handler in `main.js`:
```javascript
ipcMain.handle('git-add', async (event, repoPath, scope, filePath) => {
  try {
    const { execFileSync } = require('child_process');
    const args = scope === 'file' ? ['add', '--', filePath] : ['add', '-A'];
    execFileSync('git', args, { cwd: repoPath });
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('git-unstage', async (event, repoPath, scope, filePath) => {
  try {
    const { execFileSync } = require('child_process');
    const args = scope === 'file' ? ['reset', '--', filePath] : ['reset'];
    execFileSync('git', args, { cwd: repoPath });
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
```

- [ ] **Step 4: Add `export-note-to-path` handler**

Task 3's "Current file" staging mode needs the open note's live content written to a file in the repo before git can see it as changed. Add after `git-unstage`:
```javascript
ipcMain.handle('export-note-to-path', (event, note, targetPath) => {
  try {
    fs.writeFileSync(targetPath, note.content);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
```

- [ ] **Step 5: Add `git-diff-file` handler**

Add after `export-note-to-path`:
```javascript
ipcMain.handle('git-diff-file', async (event, repoPath, filePath) => {
  try {
    const { execFileSync } = require('child_process');
    const cwd = repoPath;

    let headContent = null;
    try {
      headContent = execFileSync('git', ['show', `HEAD:${filePath}`], { cwd }).toString();
    } catch {
      // File is new/untracked — no HEAD version exists
    }

    let workingContent = null;
    const absPath = path.join(repoPath, filePath);
    if (fs.existsSync(absPath)) {
      workingContent = fs.readFileSync(absPath, 'utf8');
    }

    const numstat = execFileSync('git', ['diff', '--numstat', '--', filePath], { cwd }).toString().trim();
    if (numstat.startsWith('-\t-\t')) {
      return { success: true, binary: true, headContent: null, workingContent: null, diffText: '' };
    }

    let diffText = '';
    try {
      diffText = execFileSync('git', ['diff', '--no-color', '--', filePath], { cwd }).toString();
    } catch(e) {
      diffText = '';
    }

    return { success: true, binary: false, headContent, workingContent, diffText };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
```

- [ ] **Step 6: Expose the new handlers in `preload.js`**

Add alongside the existing `gitClone`/`gitStatus`/`gitCommit`/`gitPull`/`gitPush` bindings:
```javascript
  gitAdd:           (repoPath, scope, filePath) => ipcRenderer.invoke('git-add', repoPath, scope, filePath),
  gitUnstage:       (repoPath, scope, filePath) => ipcRenderer.invoke('git-unstage', repoPath, scope, filePath),
  gitDiffFile:      (repoPath, filePath) => ipcRenderer.invoke('git-diff-file', repoPath, filePath),
  exportNoteToPath: (note, targetPath) => ipcRenderer.invoke('export-note-to-path', note, targetPath),
```

- [ ] **Step 7: Manual verification against a real repo**

Run: `node --check main.js && node --check preload.js` (syntax sanity check first)

Then, in a scratch directory:
```bash
mkdir -p /tmp/git-panel-test && cd /tmp/git-panel-test && git init -q && \
  git config user.email "test@example.com" && git config user.name "Test" && \
  echo "line one" > a.md && git add -A && git commit -qm "initial" && \
  echo "line one changed" > a.md
```
Then `npm start` from the NoteHub repo, open the git panel (Cmd+Shift+G — Task 3 must be done first to have a UI; if testing Task 2 standalone, drive it via the DevTools console calling `window.electron.gitStatus('/tmp/git-panel-test')`, `window.electron.gitAdd(...)`, `window.electron.gitDiffFile(...)` directly):
1. `gitStatus` → confirm `a.md` shows `staged: false` before adding, `ahead`/`behind` are `null` (no upstream).
2. `gitAdd(path, 'all')` then `gitStatus` again → confirm `staged: true`.
3. `gitUnstage(path, 'all')` then `gitStatus` → confirm `staged: false` again.
4. `gitAdd(path, 'all')` then `gitCommit(path, 'test commit')` → confirm it succeeds and `git log` in the scratch repo shows the new commit.
5. `gitCommit(path, 'empty')` again with nothing staged → confirm `{ success: false, staged: false, error: 'Nothing staged to commit' }`.
6. `gitDiffFile(path, 'a.md')` before committing the second change → confirm `headContent` is `"line one\n"`, `workingContent` is `"line one changed\n"`, and `diffText` contains a `@@` hunk.
7. `exportNoteToPath({content: 'hello'}, '/tmp/git-panel-test/scratch.md')` → confirm the file is written with that content.

- [ ] **Step 8: Commit**

```bash
git add main.js preload.js
git commit -m "fix: stop git-commit from force-staging; add staged/unstaged status, ahead/behind, and add/unstage/diff handlers"
```

---

### Task 3: Consolidated git panel UI

**Files:**
- Modify: `plugins/git-integration/index.js` (replace the 5-tab modal body with one view)
- Modify: `plugins/git-integration/manifest.json` (version bump)

**Interfaces:**
- Consumes: `parseUnifiedDiff`, `hunksToSideBySide` from Task 1 (`git-diff-utils.js`) — inlined into `index.js` rather than `<script>`-loaded, since the plugin loader `eval`s a single JS string (see Step 1)
- Consumes: `window.electronAPI.gitAdd/gitUnstage/gitDiffFile/gitStatus/gitCommit/gitPull/gitPush/exportNoteToPath` from Task 2
- Consumes: `window.app.currentNote` (existing global, set by `renderer.js`) to resolve "current file" scope

- [ ] **Step 1: Load `git-diff-utils.js` for the plugin**

The plugin is loaded via `ipcMain.handle('load-plugin', ...)` as a single JS string and `eval`'d (per `plugins/PLUGINS.md`'s documented model) — it cannot use a separate `<script>` tag or `require()`. Inline `git-diff-utils.js`'s two functions directly at the top of `plugins/git-integration/index.js` (above the existing `let gitConfig = {...}` line), keeping the exact same function bodies as Task 1 so the tested logic and the shipped logic never diverge. Drop the `module.exports` guard block from the copy in `index.js` — the plugin runs in the renderer's `eval` context, not Node, so it's dead code there.

- [ ] **Step 2: Replace the modal body and tab bar with the single-view layout**

Replace the `overlay.innerHTML` template (currently the `.git-header` + `.git-tabs` + `.git-body` structure) with:
```javascript
overlay.innerHTML = `
<div class="git-modal" id="gitModal">
  <div class="git-header">
    <div class="git-title">🔀 <span id="gitModalTitle">Git</span></div>
    <div class="git-actions">
      <button class="git-btn git-btn-ghost" onclick="gitRefreshStatus()">🔄 Refresh</button>
      <button class="git-btn git-btn-danger" onclick="gitClose()">✕ Close</button>
    </div>
  </div>
  <div class="git-body" id="gitBody"></div>
</div>`;
```

- [ ] **Step 3: Add the segmented-control and staging-row styles**

Add to the plugin's `style.textContent` block, alongside the existing `.git-*` rules:
```css
.git-seg { display:inline-flex; border:1px solid #45475a; border-radius:6px; overflow:hidden; font-size:12px; }
.git-seg span { padding:5px 10px; cursor:pointer; white-space:nowrap; color:#7f849c; }
.git-seg span.active { background:#585b70; color:#cdd6f4; font-weight:600; }
.git-file-row { display:flex; justify-content:space-between; padding:6px 10px; border-radius:4px; font-size:13px; cursor:pointer; color:#cdd6f4; }
.git-file-row:hover { background:#313244; }
.git-diff-inline { margin:4px 0 10px; border-radius:6px; overflow:hidden; border:1px solid #313244; }
.git-diff-col { font-family:monospace; font-size:12px; white-space:pre; overflow-x:auto; }
.git-diff-line { padding:1px 8px; }
.git-diff-line.added { background:rgba(166,227,161,.18); }
.git-diff-line.removed { background:rgba(243,139,168,.18); }
.git-diff-line.blank { visibility:hidden; }
```

- [ ] **Step 4: Write the single-view render function, replacing the 5 tab renderers**

Replace `renderCloneTab`/`renderStatusTab`/`renderCommitTab`/`renderSyncTab`/`renderSettingsTab` and the `gitSwitchTab` function with one `renderGitPanel()`:
```javascript
let gitAddScope = 'all';      // 'all' | 'file'
let gitExpandedFile = null;   // path of the file whose diff is expanded, or null
let gitLastStatus = null;     // cached result of the last gitStatus() call

function gitSlugify(title) {
    return (title || 'untitled').toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

function gitCurrentFilePath() {
    const note = window.app && window.app.currentNote;
    if (!note) return null;
    return `${gitSlugify(note.title)}.md`;
}

function renderGitPanel() {
    const body = document.getElementById('gitBody');
    if (!gitConfig.repoPath) {
        body.innerHTML = renderCloneForm();
        return;
    }
    const s = gitLastStatus;
    const changedCount = s ? s.files.length : 0;
    const aheadBehind = s && s.ahead !== null ? ` · ↑${s.ahead} ↓${s.behind}` : '';

    body.innerHTML = `
<div class="git-form-group">
  <div class="git-info">${s ? s.branch : '…'}${aheadBehind} · ${changedCount} changed</div>
</div>
<div class="git-form-group" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
  <div class="git-seg">
    <span class="${gitAddScope === 'all' ? 'active' : ''}" onclick="gitSetAddScope('all')">All changes</span>
    <span class="${gitAddScope === 'file' ? 'active' : ''}" onclick="gitSetAddScope('file')">Current file</span>
  </div>
  <button class="git-btn git-btn-ghost" onclick="gitAddChanges()">+ Add</button>
  <button class="git-btn git-btn-ghost" onclick="gitClearStaged()">Clear Staged</button>
</div>
<div class="git-form-group">
  <input class="git-input" id="gitCommitMsg" placeholder="Commit message">
</div>
<div class="git-form-group" style="display:flex; gap:8px">
  <button class="git-btn git-btn-primary" onclick="gitCommit()" style="flex:1">Commit</button>
  <button class="git-btn git-btn-primary" onclick="gitPull()" style="flex:1">Pull</button>
  <button class="git-btn git-btn-primary" onclick="gitPush()" style="flex:1">Push</button>
  <button class="git-btn git-btn-ghost" onclick="gitFullSync()" style="flex:1">Full Sync</button>
</div>
<div class="git-status" id="gitOpStatus" style="display:none"></div>
<details class="git-form-group">
  <summary style="cursor:pointer; color:#a6e3a1; font-weight:600">Repository</summary>
  <div style="margin-top:10px">
    <label class="git-label">Repository Path</label>
    <input class="git-input" id="gitRepoPath" value="${gitConfig.repoPath || 'Not set'}" readonly>
    <button class="git-btn git-btn-ghost" onclick="gitChooseRepoPath()" style="margin-top:6px">Choose Folder</button>
    <label class="git-label" style="margin-top:12px">Git User Name</label>
    <input class="git-input" id="gitUserName" value="${gitConfig.userName}">
    <label class="git-label" style="margin-top:12px">Git User Email</label>
    <input class="git-input" id="gitUserEmail" value="${gitConfig.userEmail}">
    <label class="git-label" style="margin-top:12px">Remote Name</label>
    <input class="git-input" id="gitRemoteName" value="${gitConfig.remoteName}">
    <label class="git-label" style="margin-top:12px">Branch</label>
    <input class="git-input" id="gitBranch" value="${gitConfig.branch}">
    <button class="git-btn git-btn-primary" onclick="gitSaveSettings()" style="width:100%; margin-top:12px">💾 Save Settings</button>
  </div>
</details>
<div class="git-form-group">
  <label class="git-label">Status</label>
  <div id="gitFileList">${s ? gitRenderFileList(s.files) : ''}</div>
</div>`;
}

function renderCloneForm() {
    return `
<h3 style="margin:0 0 16px; font-size:16px; color:#a6e3a1">Clone Repository</h3>
<div class="git-form-group">
  <label class="git-label">Repository URL</label>
  <input class="git-input" id="gitCloneUrl" placeholder="https://github.com/user/repo.git">
</div>
<div class="git-form-group">
  <label class="git-label">Clone to Directory</label>
  <input class="git-input" id="gitClonePath" placeholder="Leave blank to auto-generate">
</div>
<div class="git-status" id="gitCloneStatus" style="display:none"></div>
<button class="git-btn git-btn-primary" onclick="gitCloneRepo()" style="width:100%">Clone Repository</button>`;
}

function gitRenderFileList(files) {
    if (!files.length) return '<div class="git-info">Working tree clean</div>';
    return files.map(f => `
        <div class="git-file-row" onclick="gitToggleDiff('${f.path}')">
          <span>${f.worktreeStatus || f.indexStatus} ${f.path}${f.staged ? ' <em style="opacity:.6">(staged)</em>' : ''}</span>
          <span>${gitExpandedFile === f.path ? '▾' : '▸'}</span>
        </div>
        ${gitExpandedFile === f.path ? `<div class="git-diff-inline" id="gitDiffFor-${f.path}">Loading…</div>` : ''}
    `).join('');
}
```

- [ ] **Step 5: Wire staging, commit/pull/push, diff toggling, and status refresh**

Replace `gitRefreshStatus`, `gitCommit`, `gitPull`, `gitPush`, `gitFullSync`, `gitOpen` with versions that populate `gitLastStatus` and call `renderGitPanel()`, and add the new staging/diff functions:
```javascript
window.gitSetAddScope = function(scope) {
    gitAddScope = scope;
    renderGitPanel();
};

window.gitAddChanges = async function() {
    let filePath;
    if (gitAddScope === 'file') {
        filePath = await gitSyncCurrentNoteToRepoFile(); // defined in Step 6; writes the open note into the repo first
        if (!filePath) { gitShowOpStatus('error', 'No note is currently open'); return; }
    }
    const result = await window.electronAPI.gitAdd(gitConfig.repoPath, gitAddScope, filePath);
    if (result.success) { gitShowOpStatus('success', 'Staged.'); await gitRefreshStatus(); }
    else gitShowOpStatus('error', result.error);
};

window.gitClearStaged = async function() {
    const filePath = gitAddScope === 'file' ? gitCurrentFilePath() : undefined;
    const result = await window.electronAPI.gitUnstage(gitConfig.repoPath, gitAddScope, filePath);
    if (result.success) { gitShowOpStatus('success', 'Unstaged.'); await gitRefreshStatus(); }
    else gitShowOpStatus('error', result.error);
};

function gitShowOpStatus(kind, text) {
    const box = document.getElementById('gitOpStatus');
    if (!box) return;
    box.className = `git-status ${kind}`;
    box.textContent = text;
    box.style.display = 'block';
}

window.gitRefreshStatus = async function() {
    if (!gitConfig.repoPath) return;
    const result = await window.electronAPI.gitStatus(gitConfig.repoPath);
    if (result.success) gitLastStatus = result;
    renderGitPanel();
};

window.gitToggleDiff = async function(filePath) {
    gitExpandedFile = gitExpandedFile === filePath ? null : filePath;
    renderGitPanel();
    if (!gitExpandedFile) return;

    if (filePath === gitCurrentFilePath()) {
        await gitSyncCurrentNoteToRepoFile(); // keep the diff current if this row is the open note
    }

    const container = document.getElementById(`gitDiffFor-${filePath}`);
    const result = await window.electronAPI.gitDiffFile(gitConfig.repoPath, filePath);
    if (!container) return;
    if (!result.success) { container.textContent = `Error: ${result.error}`; return; }
    if (result.binary) { container.textContent = 'Binary file — diff not shown'; return; }

    const hunks = parseUnifiedDiff(result.diffText);
    const rows = hunksToSideBySide(hunks);
    if (!rows.length) { container.textContent = 'No textual diff (file may be new or unchanged).'; return; }

    container.innerHTML = `
      <div class="split">
        <div class="git-diff-col">${rows.map(r => gitDiffLineHtml(r.left, 'removed')).join('')}</div>
        <div class="git-diff-col">${rows.map(r => gitDiffLineHtml(r.right, 'added')).join('')}</div>
      </div>`;
};

function gitDiffLineHtml(line, sideBlankType) {
    if (!line) return `<div class="git-diff-line blank">&nbsp;</div>`;
    const cls = line.type === 'context' ? '' : line.type;
    return `<div class="git-diff-line ${cls}">${line.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
}

window.gitCommit = async function() {
    const msg = document.getElementById('gitCommitMsg').value.trim();
    if (!msg) { gitShowOpStatus('error', 'Commit message is required'); return; }
    const result = await window.electronAPI.gitCommit(gitConfig.repoPath, msg, gitConfig.userName, gitConfig.userEmail);
    if (result.success) {
        gitShowOpStatus('success', `Committed: ${(result.commit || '').slice(0,8)}`);
        await gitRefreshStatus();
    } else {
        gitShowOpStatus('error', result.error);
    }
};

window.gitPull = async function() {
    const result = await window.electronAPI.gitPull(gitConfig.repoPath, gitConfig.remoteName, gitConfig.branch);
    gitShowOpStatus(result.success ? 'success' : 'error', result.success ? 'Pull complete' : result.error);
    if (result.success) await gitRefreshStatus();
};

window.gitPush = async function() {
    const result = await window.electronAPI.gitPush(gitConfig.repoPath, gitConfig.remoteName, gitConfig.branch);
    gitShowOpStatus(result.success ? 'success' : 'error', result.success ? 'Push complete' : result.error);
    if (result.success) await gitRefreshStatus(); // refreshes ahead/behind and HEAD-side diff content
};

window.gitFullSync = async function() {
    const pull = await window.electronAPI.gitPull(gitConfig.repoPath, gitConfig.remoteName, gitConfig.branch);
    if (!pull.success) { gitShowOpStatus('error', `Pull failed: ${pull.error}`); return; }
    const push = await window.electronAPI.gitPush(gitConfig.repoPath, gitConfig.remoteName, gitConfig.branch);
    gitShowOpStatus(push.success ? 'success' : 'error', push.success ? 'Full sync complete' : `Push failed: ${push.error}`);
    await gitRefreshStatus();
};

window.gitOpen = function() {
    const saved = localStorage.getItem('notehub-git-config');
    if (saved) { try { gitConfig = { ...gitConfig, ...JSON.parse(saved) }; } catch {} }
    overlay.classList.add('open');
    renderGitPanel();
    if (gitConfig.repoPath) gitRefreshStatus();
};
```
Delete the now-unused `gitCloneRepo`'s old status-tab wiring references (`renderStatusTab`/`renderCommitTab`/`renderSyncTab`/`renderSettingsTab`/`gitSwitchTab`) and update `gitCloneRepo`'s success branch to call `renderGitPanel()` instead of re-rendering a tab. `gitAddChanges`'s "current file" branch calls `gitSyncCurrentNoteToRepoFile()`, defined next in Step 6 — the forward reference is safe here since it's only invoked on a user click, well after the whole plugin script has finished evaluating.

- [ ] **Step 6: Write the current note to its repo-relative path before "Current file" add/diff**

`gitAddChanges` and `gitToggleDiff` (both Step 5) call this helper so the working-tree file actually reflects the open note's content before git can see it as changed. It uses the `exportNoteToPath` bridge added in Task 2, Steps 4 and 6:
```javascript
window.gitSyncCurrentNoteToRepoFile = async function() {
    const note = window.app && window.app.currentNote;
    if (!note) return null;
    const filePath = gitCurrentFilePath();
    await window.electronAPI.exportNoteToPath(note, `${gitConfig.repoPath}/${filePath}`);
    return filePath;
};
```

- [ ] **Step 7: Bump the plugin manifest version**

In `plugins/git-integration/manifest.json`, change `"version": "1.0.0"` to `"version": "2.0.0"` and update the description to mention the consolidated view:
```json
{
  "name": "Git Integration",
  "version": "2.0.0",
  "description": "Clone, stage, commit, and sync notes to Git repositories — single consolidated panel with inline diffs.",
  "author": "NoteHub",
  "main": "index.js",
  "icon": "🔀"
}
```

- [ ] **Step 8: Manual verification**

Run: `node --check plugins/git-integration/index.js` (syntax sanity check — note this file is `eval`'d, not `require`'d, so this only catches parse errors, not runtime issues)

Then `npm start`, enable the `git-integration` plugin if not already enabled (Preferences → Plugins), and using the `/tmp/git-panel-test` repo from Task 2:
1. Cmd+Shift+G opens the panel — confirm it's a single scrolling view, no tabs.
2. Set repo path to `/tmp/git-panel-test` (via Repository → Choose Folder), confirm status line shows branch + changed count.
3. Click a changed file → confirm the diff expands inline directly below that row, with removed lines tinted red on the left and added lines tinted green on the right.
4. Click "Add" (All changes scope) → confirm the file's row now shows `(staged)`.
5. Click "Clear Staged" → confirm `(staged)` disappears.
6. Open a note in NoteHub, switch the segmented control to "Current file", click "Add" → confirm a new `<slug>.md` file appears in `/tmp/git-panel-test` matching the note's content, and only that file is staged (check via `git status` in a terminal against the scratch repo).
7. Enter a commit message, click Commit → confirm success and that the status list clears/updates.
8. With a remote configured (or skip if none available), click Push → confirm the ahead/behind indicator updates afterward.

- [ ] **Step 9: Commit**

```bash
git add plugins/git-integration/index.js plugins/git-integration/manifest.json main.js preload.js
git commit -m "feat: consolidate git plugin into a single view with staging, ahead/behind, and inline diffs"
```

## Out of scope (this plan)

- Fixing the clone-import stub (cloned `.md` files still aren't auto-imported as notes) — pre-existing gap, unrelated to this consolidation, per the spec.
- Migrating `gitConfig` out of `localStorage` into the app's `config.json`.
- The overall visual/theme redesign — separate, not-yet-brainstormed sub-project.
