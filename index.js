// NoteHub Terminal Plugin — Real system shell integration
// Ctrl+` / Cmd+` to toggle

console.log('[Terminal] Loading...');

let termVisible = false;
let termHistory = [];
let histIdx     = -1;
let currentCwd  = null; // tracks working directory across commands

// ── Styles ────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
.nh-term {
  position:fixed; bottom:0; left:280px; right:0; height:300px;
  background:#11111b; border-top:2px solid #313244;
  display:none; flex-direction:column; z-index:500;
  box-shadow:0 -4px 24px rgba(0,0,0,.6); font-family:'JetBrains Mono',Menlo,Monaco,Consolas,monospace;
}
.nh-term.open { display:flex; }
.nh-term-bar {
  display:flex; align-items:center; justify-content:space-between;
  padding:0 14px; height:34px; background:#181825;
  border-bottom:1px solid #313244; flex-shrink:0;
}
.nh-term-title { font-size:12px; font-weight:600; color:#cdd6f4; display:flex; align-items:center; gap:8px; }
.nh-term-cwd { font-size:11px; color:#6c7086; font-weight:400; max-width:400px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nh-term-btns { display:flex; gap:6px; }
.nh-term-btn {
  background:none; border:1px solid #313244; border-radius:4px;
  color:#6c7086; cursor:pointer; padding:3px 8px; font-size:11px;
  transition:all .12s;
}
.nh-term-btn:hover { background:#313244; color:#cdd6f4; }
.nh-term-out {
  flex:1; overflow-y:auto; padding:10px 14px;
  font-size:13px; line-height:1.55; color:#cdd6f4;
}
.nh-term-row { display:flex; align-items:flex-start; gap:0; margin-bottom:2px; white-space:pre-wrap; word-break:break-all; }
.nh-term-row.cmd  .nh-pfx { color:#a6e3a1; }
.nh-term-row.err  .nh-txt { color:#f38ba8; }
.nh-term-row.info .nh-txt { color:#89b4fa; }
.nh-term-row.warn .nh-txt { color:#f9e2af; }
.nh-pfx { flex-shrink:0; }
.nh-txt { flex:1; }
.nh-term-input-row {
  display:flex; align-items:center; padding:0 14px;
  height:36px; background:#11111b; border-top:1px solid #1e1e2e; flex-shrink:0;
}
.nh-term-prompt { color:#a6e3a1; font-size:13px; font-weight:700; margin-right:8px; flex-shrink:0; }
.nh-term-cwd-prompt { color:#89b4fa; font-size:12px; margin-right:6px; flex-shrink:0; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nh-term-in {
  flex:1; background:none; border:none; outline:none;
  color:#cdd6f4; font-family:inherit; font-size:13px; caret-color:#cba6f7;
}
.nh-term-in::placeholder { color:#45475a; }
.nh-resize-handle {
  height:4px; background:#313244; cursor:ns-resize; flex-shrink:0;
  transition:background .12s;
}
.nh-resize-handle:hover { background:#cba6f7; }
::-webkit-scrollbar { width:5px; }
::-webkit-scrollbar-thumb { background:#313244; border-radius:3px; }
`;
document.head.appendChild(style);

// ── Build UI ──────────────────────────────────────────────────────────────
const container = document.createElement('div');
container.className = 'nh-term';
container.id = 'nhTerm';
container.innerHTML = `
  <div class="nh-resize-handle" id="nhTermResize"></div>
  <div class="nh-term-bar">
    <div class="nh-term-title">
      💻 Terminal
      <span class="nh-term-cwd" id="nhTermCwdBar">~</span>
    </div>
    <div class="nh-term-btns">
      <button class="nh-term-btn" onclick="nhTermClear()">Clear</button>
      <button class="nh-term-btn" onclick="nhTermCd('~')">~</button>
      <button class="nh-term-btn" onclick="nhTermToggle()">✕</button>
    </div>
  </div>
  <div class="nh-term-out" id="nhTermOut"></div>
  <div class="nh-term-input-row">
    <span class="nh-term-cwd-prompt" id="nhTermCwdPrompt">~</span>
    <span class="nh-term-prompt">$</span>
    <input class="nh-term-in" id="nhTermIn" placeholder="Type a command…" autocomplete="off" spellcheck="false">
  </div>
`;
document.body.appendChild(container);

const outEl  = document.getElementById('nhTermOut');
const input  = document.getElementById('nhTermIn');
const cwdBar = document.getElementById('nhTermCwdBar');
const cwdPrm = document.getElementById('nhTermCwdPrompt');

// ── Resize handle ─────────────────────────────────────────────────────────
let isResizing = false;
const resizeHandle = document.getElementById('nhTermResize');
resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const newH = window.innerHeight - e.clientY;
  if (newH > 80 && newH < window.innerHeight * 0.8) {
    container.style.height = newH + 'px';
  }
});
document.addEventListener('mouseup', () => { isResizing = false; });

// ── Helpers ───────────────────────────────────────────────────────────────
async function getInitialCwd() {
  if (currentCwd) return currentCwd;
  const res = await window.electronAPI.execShell('echo $HOME', null).catch(() => null);
  const home = res && res.stdout.trim();
  currentCwd = home || require && require('os') ? undefined : '~';
  // fallback: use pwd
  const pwd = await window.electronAPI.execShell('pwd', null).catch(() => null);
  if (pwd && pwd.stdout.trim()) currentCwd = pwd.stdout.trim();
  return currentCwd;
}

function shortCwd(cwd) {
  if (!cwd) return '~';
  const home = cwd.replace(/\/Users\/[^/]+/, '~').replace(/\/home\/[^/]+/, '~');
  return home;
}

function updateCwdDisplay(cwd) {
  currentCwd = cwd;
  const short = shortCwd(cwd);
  if (cwdBar) cwdBar.textContent = short;
  if (cwdPrm) cwdPrm.textContent = short;
}

function addLine(text, type = 'output') {
  const row = document.createElement('div');
  row.className = 'nh-term-row ' + type;
  if (type === 'cmd') {
    row.innerHTML = `<span class="nh-pfx">$ </span><span class="nh-txt">${escHtml(text)}</span>`;
  } else {
    row.innerHTML = `<span class="nh-txt">${escHtml(text)}</span>`;
  }
  outEl.appendChild(row);
  outEl.scrollTop = outEl.scrollHeight;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

window.nhTermClear = function() {
  outEl.innerHTML = '';
  addLine('Terminal cleared.', 'info');
};

window.nhTermToggle = function() {
  termVisible = !termVisible;
  container.classList.toggle('open', termVisible);
  if (termVisible) { setTimeout(() => input.focus(), 60); }
};

window.nhTermCd = async function(dir) {
  await runCommand('cd ' + dir);
};

// ── Command execution ─────────────────────────────────────────────────────
async function runCommand(raw) {
  raw = raw.trim();
  if (!raw) return;

  addLine(raw, 'cmd');

  // Handle 'cd' specially — we simulate cwd tracking
  const cdMatch = raw.match(/^cd\s*(.*)$/);
  if (cdMatch) {
    const target = (cdMatch[1] || '~').trim().replace(/^~/, currentCwd ? currentCwd.replace(/\/[^/]+$/, '') : process.env.HOME || '~');
    // Execute cd and get new pwd
    const res = await window.electronAPI.execShell(`cd ${cdMatch[1] || '~'} && pwd`, currentCwd).catch(() => null);
    if (res && res.code === 0 && res.stdout.trim()) {
      updateCwdDisplay(res.stdout.trim());
      addLine('→ ' + res.stdout.trim(), 'info');
    } else {
      addLine(`cd: ${cdMatch[1]}: No such file or directory`, 'err');
    }
    return;
  }

  // For all other commands, execute in currentCwd
  if (!currentCwd) await getInitialCwd();

  const res = await window.electronAPI.execShell(raw, currentCwd).catch(e => ({
    stdout: '', stderr: '', code: 1, error: e.message
  }));

  if (res.stdout) {
    const lines = res.stdout.split('\n');
    lines.forEach(l => { if (l !== '') addLine(l); });
  }
  if (res.stderr) {
    const lines = res.stderr.split('\n');
    lines.forEach(l => { if (l !== '') addLine(l, 'err'); });
  }
  if (res.error && !res.stderr) {
    addLine(res.error, 'err');
  }

  // If the command might change directory (e.g. sourced scripts), update cwd
  if (!cdMatch) {
    const pwdRes = await window.electronAPI.execShell('pwd', currentCwd).catch(() => null);
    if (pwdRes && pwdRes.code === 0 && pwdRes.stdout.trim() !== currentCwd) {
      updateCwdDisplay(pwdRes.stdout.trim());
    }
  }
}

// ── Input handling ────────────────────────────────────────────────────────
input.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const cmd = input.value;
    input.value = '';
    histIdx = -1;
    if (cmd.trim()) {
      termHistory.unshift(cmd);
      if (termHistory.length > 200) termHistory.pop();
    }
    await runCommand(cmd);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (histIdx < termHistory.length - 1) {
      histIdx++;
      input.value = termHistory[histIdx];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (histIdx > 0) {
      histIdx--;
      input.value = termHistory[histIdx];
    } else {
      histIdx = -1;
      input.value = '';
    }
  } else if (e.key === 'Tab') {
    e.preventDefault();
    // Basic tab completion: list files in cwd matching prefix
    const parts = input.value.split(' ');
    const prefix = parts[parts.length - 1];
    if (prefix) {
      const res = await window.electronAPI.execShell(
        `ls -1 "${currentCwd || '.'}" | grep -i "^${prefix}" 2>/dev/null | head -10`,
        currentCwd
      ).catch(() => null);
      if (res && res.stdout.trim()) {
        const matches = res.stdout.trim().split('\n');
        if (matches.length === 1) {
          parts[parts.length - 1] = matches[0];
          input.value = parts.join(' ');
        } else {
          addLine(matches.join('  '), 'info');
        }
      }
    }
  } else if (e.key === 'c' && e.ctrlKey) {
    addLine('^C', 'warn');
    input.value = '';
  } else if (e.key === 'l' && e.ctrlKey) {
    e.preventDefault();
    nhTermClear();
  }
});

// ── Toggle via Ctrl+` ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === '`' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    nhTermToggle();
  }
});

// Listen for plugin menu click
window.addEventListener('notehub:toggle-terminal', () => nhTermToggle());

// ── Add toolbar button ─────────────────────────────────────────────────────
app.registerPluginAction('terminal', 'Toggle Terminal', '💻', () => nhTermToggle());

// ── Toolbar toggle button in sidebar (legacy) ─────────────────────────────
const toggleBtn = document.createElement('button');
toggleBtn.className = 'terminal-toggle-btn btn-icon';
toggleBtn.title = 'Terminal (Ctrl+`)';
toggleBtn.innerHTML = '💻';
toggleBtn.onclick = nhTermToggle;

// ── Init ──────────────────────────────────────────────────────────────────
(async () => {
  await getInitialCwd();
  addLine('NoteHub Terminal — real shell connected', 'info');
  addLine(`cwd: ${currentCwd || '~'}`, 'info');
  addLine('Press Ctrl+` to toggle · Tab for completion · ↑↓ for history', 'info');
  addLine('');
})();

console.log('[Terminal] Ready.');
