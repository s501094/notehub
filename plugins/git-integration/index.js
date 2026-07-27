// NoteHub Git Integration Plugin
// Single consolidated panel: staging (all/current-file), commit, pull/push/sync,
// collapsible repo settings, and per-file inline diffs.
console.log('[Git] Loading...');

let gitConfig = {
    repoPath: null,     // Path to cloned repo
    remoteName: 'origin',
    branch: 'main',
    autoCommit: true,
    autoSync: false,
    userName: '',
    userEmail: ''
};

// ── Diff parsing (mirrors git-diff-utils.js — see tests/git-diff-utils.test.js) ──
// Inlined rather than <script>-loaded: the plugin loader eval's this file as a
// single string (see plugins/PLUGINS.md), so it has no module/import system.
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

// ── Styles ────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
.git-overlay {
  position:fixed; inset:0; background:rgba(0,0,0,.75); z-index:900;
  display:none; align-items:center; justify-content:center;
  backdrop-filter:blur(6px);
}
.git-overlay.open { display:flex; }
.git-modal {
  background:#1e1e2e; border:1px solid #313244; border-radius:12px;
  width:90vw; max-width:800px; max-height:85vh; display:flex; flex-direction:column;
  box-shadow:0 24px 64px rgba(0,0,0,.7); overflow:hidden;
}
.git-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:0 20px; height:48px; background:#181825; border-bottom:1px solid #313244; flex-shrink:0;
}
.git-title { font-size:15px; font-weight:600; color:#cdd6f4; display:flex; align-items:center; gap:10px; }
.git-actions { display:flex; gap:8px; }
.git-btn {
  padding:7px 16px; border-radius:6px; border:none; font-size:13px; font-weight:600;
  cursor:pointer; transition:all .12s;
}
.git-btn-primary { background:linear-gradient(135deg,#a6e3a1,#94e2d5); color:#1e1e2e; }
.git-btn-primary:hover { box-shadow:0 2px 8px rgba(166,227,161,.4); }
.git-btn-ghost { background:#313244; color:#cdd6f4; border:1px solid #45475a; }
.git-btn-ghost:hover { background:#45475a; }
.git-btn-danger { background:rgba(243,139,168,.15); color:#f38ba8; border:1px solid rgba(243,139,168,.3); }
.git-btn-danger:hover { background:rgba(243,139,168,.28); }

.git-body { flex:1; overflow-y:auto; padding:20px; }
.git-form-group { margin-bottom:18px; }
.git-label {
  display:block; margin-bottom:6px; font-size:13px; font-weight:600; color:#cdd6f4;
}
.git-input, .git-select {
  width:100%; padding:10px 12px; background:#313244; border:1px solid #45475a;
  border-radius:6px; color:#cdd6f4; font-size:13px; outline:none;
}
.git-input:focus, .git-select:focus { border-color:#a6e3a1; }
.git-input::placeholder { color:#6c7086; }

.git-status {
  padding:12px 16px; background:#181825; border:1px solid #313244;
  border-radius:6px; font-size:13px; font-family:monospace; color:#cdd6f4;
  margin-bottom:16px; white-space:pre-wrap; line-height:1.6;
}
.git-status.loading { color:#89b4fa; }
.git-status.success { color:#a6e3a1; border-color:#a6e3a1; background:rgba(166,227,161,.08); }
.git-status.error   { color:#f38ba8; border-color:#f38ba8; background:rgba(243,139,168,.08); }

.git-info { font-size:12px; color:#6c7086; margin-top:6px; }
.git-hint { font-size:12px; color:#89b4fa; background:rgba(137,180,250,.1);
  padding:10px 12px; border-radius:6px; margin-top:12px; line-height:1.5; }

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
`;
document.head.appendChild(style);

// ── Modal UI ──────────────────────────────────────────────────────────────
const overlay = document.createElement('div');
overlay.className = 'git-overlay';
overlay.id = 'gitOverlay';
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
document.body.appendChild(overlay);

// ── Panel state ───────────────────────────────────────────────────────────
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

// ── Rendering ─────────────────────────────────────────────────────────────
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
  <input class="git-input" id="gitCloneUrl" placeholder="https://github.com/user/repo.git or git@github.com:user/repo.git">
  <div class="git-info">Supports GitHub, GitLab, Bitbucket, Azure DevOps, and any Git server</div>
</div>
<div class="git-form-group">
  <label class="git-label">Clone to Directory</label>
  <input class="git-input" id="gitClonePath" placeholder="Leave blank to auto-generate in NoteHub data dir">
</div>
<div class="git-form-group">
  <label class="git-label">Branch (optional)</label>
  <input class="git-input" id="gitCloneBranch" placeholder="main">
</div>
<div class="git-status" id="gitCloneStatus" style="display:none"></div>
<button class="git-btn git-btn-primary" onclick="gitCloneRepo()" style="width:100%">Clone Repository</button>
<div class="git-hint">
  💡 <strong>Tip:</strong> After cloning, use the segmented control above to Add and Commit changes.
</div>`;
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

// ── Staging ───────────────────────────────────────────────────────────────
window.gitSetAddScope = function(scope) {
    gitAddScope = scope;
    renderGitPanel();
};

window.gitSyncCurrentNoteToRepoFile = async function() {
    const note = window.app && window.app.currentNote;
    if (!note) return null;
    const filePath = gitCurrentFilePath();
    await window.electronAPI.exportNoteToPath(note, `${gitConfig.repoPath}/${filePath}`);
    return filePath;
};

window.gitAddChanges = async function() {
    let filePath;
    if (gitAddScope === 'file') {
        filePath = await gitSyncCurrentNoteToRepoFile();
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

// ── Status & diff ─────────────────────────────────────────────────────────
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
      <div class="split" style="display:flex">
        <div class="git-diff-col" style="flex:1">${rows.map(r => gitDiffLineHtml(r.left)).join('')}</div>
        <div class="git-diff-col" style="flex:1">${rows.map(r => gitDiffLineHtml(r.right)).join('')}</div>
      </div>`;
};

function gitDiffLineHtml(line) {
    if (!line) return `<div class="git-diff-line blank">&nbsp;</div>`;
    const cls = line.type === 'context' ? '' : line.type;
    return `<div class="git-diff-line ${cls}">${line.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
}

// ── Commit / sync ─────────────────────────────────────────────────────────
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

// ── Clone ─────────────────────────────────────────────────────────────────
window.gitCloneRepo = async function() {
    const url    = document.getElementById('gitCloneUrl').value.trim();
    const target = document.getElementById('gitClonePath').value.trim();
    const branch = document.getElementById('gitCloneBranch').value.trim() || 'main';
    const status = document.getElementById('gitCloneStatus');

    if (!url) {
        status.className = 'git-status error';
        status.textContent = 'Error: Repository URL is required';
        status.style.display = 'block';
        return;
    }

    status.className = 'git-status loading';
    status.textContent = 'Cloning repository...';
    status.style.display = 'block';

    try {
        const result = await window.electronAPI.gitClone(url, target, branch);
        if (result.success) {
            gitConfig.repoPath = result.path;
            localStorage.setItem('notehub-git-config', JSON.stringify(gitConfig));
            await gitRefreshStatus();
        } else {
            status.className = 'git-status error';
            status.textContent = `Error: ${result.error}`;
        }
    } catch(e) {
        status.className = 'git-status error';
        status.textContent = `Error: ${e.message}`;
    }
};

// ── Settings ──────────────────────────────────────────────────────────────
window.gitSaveSettings = function() {
    gitConfig.userName    = document.getElementById('gitUserName').value.trim();
    gitConfig.userEmail   = document.getElementById('gitUserEmail').value.trim();
    gitConfig.remoteName  = document.getElementById('gitRemoteName').value.trim();
    gitConfig.branch      = document.getElementById('gitBranch').value.trim();

    localStorage.setItem('notehub-git-config', JSON.stringify(gitConfig));
    gitShowOpStatus('success', 'Settings saved.');
};

window.gitChooseRepoPath = async function() {
    const result = await window.electronAPI.chooseDirectory();
    if (result && result.path) {
        gitConfig.repoPath = result.path;
        localStorage.setItem('notehub-git-config', JSON.stringify(gitConfig));
        await gitRefreshStatus();
    }
};

// ── Open / close ──────────────────────────────────────────────────────────
window.gitClose = function() {
    overlay.classList.remove('open');
};

window.gitOpen = function() {
    const saved = localStorage.getItem('notehub-git-config');
    if (saved) {
        try { gitConfig = { ...gitConfig, ...JSON.parse(saved) }; }
        catch {}
    }
    overlay.classList.add('open');
    renderGitPanel();
    if (gitConfig.repoPath) gitRefreshStatus();
};

// Close on backdrop click
overlay.addEventListener('click', (e) => { if (e.target === overlay) gitClose(); });

// ── Keyboard shortcut: Cmd+Shift+G ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        gitOpen();
    }
});

// ── Plugin registration ───────────────────────────────────────────────────
app.registerPluginAction('git-integration', 'Git Integration', '🔀', () => gitOpen());
window.addEventListener('notehub:git-open', () => gitOpen());

console.log('[Git] Ready. Cmd+Shift+G to open.');
