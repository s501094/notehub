// NoteHub Excel Integration Plugin
// Full interactive spreadsheet editor — import .xlsx/.csv, edit cells, export
console.log('[Excel] Loading...');

// ── Styles ────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
.xl-overlay {
  position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:800;
  display:none; align-items:center; justify-content:center;
  backdrop-filter:blur(6px);
}
.xl-overlay.open { display:flex; }
.xl-modal {
  background:#1e1e2e; border:1px solid #313244; border-radius:12px;
  width:92vw; max-width:1100px; height:80vh; display:flex; flex-direction:column;
  box-shadow:0 24px 64px rgba(0,0,0,.7); overflow:hidden;
}
.xl-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:0 20px; height:46px; background:#181825; border-bottom:1px solid #313244; flex-shrink:0;
}
.xl-title { font-size:14px; font-weight:600; color:#cdd6f4; display:flex; align-items:center; gap:10px; }
.xl-actions { display:flex; gap:8px; align-items:center; }
.xl-btn {
  padding:6px 14px; border-radius:5px; border:none; font-size:12px; font-weight:600;
  cursor:pointer; transition:all .12s;
}
.xl-btn-primary { background:linear-gradient(135deg,#cba6f7,#b4befe); color:#1e1e2e; }
.xl-btn-primary:hover { box-shadow:0 2px 8px rgba(203,166,247,.4); }
.xl-btn-ghost { background:#313244; color:#cdd6f4; border:1px solid #45475a; }
.xl-btn-ghost:hover { background:#45475a; }
.xl-btn-danger { background:rgba(243,139,168,.15); color:#f38ba8; border:1px solid rgba(243,139,168,.3); }
.xl-btn-danger:hover { background:rgba(243,139,168,.28); }
.xl-toolbar {
  display:flex; align-items:center; gap:6px; padding:8px 14px;
  background:#181825; border-bottom:1px solid #313244; flex-shrink:0; flex-wrap:wrap;
}
.xl-toolbar-sep { width:1px; height:20px; background:#313244; margin:0 2px; }
.xl-formula-bar {
  display:flex; align-items:center; gap:10px; padding:6px 14px;
  background:#11111b; border-bottom:1px solid #313244; flex-shrink:0;
}
.xl-cell-ref {
  width:60px; padding:4px 8px; background:#313244; border:1px solid #45475a;
  border-radius:4px; color:#cba6f7; font-family:monospace; font-size:12px;
  font-weight:700; text-align:center; flex-shrink:0;
}
.xl-formula-input {
  flex:1; padding:4px 10px; background:#313244; border:1px solid #45475a;
  border-radius:4px; color:#cdd6f4; font-family:monospace; font-size:13px; outline:none;
}
.xl-formula-input:focus { border-color:#cba6f7; }
.xl-sheet-tabs {
  display:flex; gap:2px; padding:6px 14px 0; background:#11111b;
  border-bottom:1px solid #313244; flex-shrink:0; overflow-x:auto;
}
.xl-tab {
  padding:5px 14px; background:#1e1e2e; border:1px solid #313244; border-bottom:none;
  border-radius:5px 5px 0 0; cursor:pointer; font-size:12px; color:#7f849c;
  transition:all .12s; white-space:nowrap;
}
.xl-tab.active { background:#313244; color:#cdd6f4; font-weight:600; }
.xl-tab:hover:not(.active) { background:#181825; color:#cdd6f4; }
.xl-tab-add {
  padding:5px 10px; background:transparent; border:1px dashed #45475a; border-bottom:none;
  border-radius:5px 5px 0 0; cursor:pointer; font-size:14px; color:#6c7086;
}
.xl-tab-add:hover { color:#cba6f7; border-color:#cba6f7; }
.xl-grid-wrap { flex:1; overflow:auto; position:relative; }
.xl-grid {
  border-collapse:collapse; table-layout:fixed; font-size:13px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
.xl-grid th, .xl-grid td { border:1px solid #313244; white-space:nowrap; }
.xl-grid th.col-header {
  background:#181825; color:#7f849c; font-size:11px; font-weight:600;
  text-align:center; padding:4px 6px; position:sticky; top:0; z-index:10;
  min-width:80px; user-select:none; cursor:pointer;
}
.xl-grid th.col-header:hover { background:#313244; color:#cdd6f4; }
.xl-grid th.row-header {
  background:#181825; color:#7f849c; font-size:11px; font-weight:600;
  text-align:center; padding:4px 8px; position:sticky; left:0; z-index:9;
  width:40px; min-width:40px; user-select:none; cursor:pointer;
}
.xl-grid th.row-header:hover { background:#313244; }
.xl-grid td.xl-cell {
  padding:0; height:24px; min-width:80px; max-width:200px;
  background:#1e1e2e; color:#cdd6f4; cursor:cell; position:relative;
}
.xl-grid td.xl-cell.selected { background:rgba(203,166,247,.12) !important; outline:2px solid #cba6f7; outline-offset:-2px; z-index:2; }
.xl-grid td.xl-cell.in-range { background:rgba(203,166,247,.06); }
.xl-cell-inner {
  display:block; width:100%; height:100%; padding:3px 6px;
  overflow:hidden; text-overflow:ellipsis; line-height:18px;
}
.xl-cell input.xl-edit-input {
  position:absolute; inset:-1px; border:2px solid #cba6f7; outline:none;
  background:#313244; color:#cdd6f4; font-family:inherit; font-size:13px;
  padding:2px 6px; z-index:5; width:calc(100% + 2px);
}
.xl-status { 
  display:flex; gap:20px; padding:5px 14px; background:#11111b; flex-shrink:0;
  border-top:1px solid #313244; font-size:11px; color:#6c7086;
}
.xl-status span b { color:#cdd6f4; }
`;
document.head.appendChild(style);

// ── State ─────────────────────────────────────────────────────────────────
let sheets    = [{ name: 'Sheet1', data: createBlankData(30, 20) }];
let sheetIdx  = 0;
let selRow    = 0, selCol = 0;
let editMode  = false;
let undoStack = [];
let fileName  = 'Spreadsheet';

function createBlankData(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(''));
}

function currentSheet() { return sheets[sheetIdx]; }
function currentData()  { return currentSheet().data; }

// ── Column letter helper ──────────────────────────────────────────────────
function colLetter(n) {
  let s = '';
  n++;
  while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function cellRef(r, c) { return colLetter(c) + (r + 1); }

// ── Overlay / modal ───────────────────────────────────────────────────────
const overlay = document.createElement('div');
overlay.className = 'xl-overlay';
overlay.id = 'xlOverlay';
overlay.innerHTML = `
<div class="xl-modal" id="xlModal">
  <div class="xl-header">
    <div class="xl-title">📊 <span id="xlFileName">Spreadsheet</span></div>
    <div class="xl-actions">
      <button class="xl-btn xl-btn-ghost" onclick="xlAddRow()">+ Row</button>
      <button class="xl-btn xl-btn-ghost" onclick="xlAddCol()">+ Col</button>
      <div style="width:1px;height:20px;background:#313244"></div>
      <button class="xl-btn xl-btn-ghost" onclick="xlImportFile()">📂 Import</button>
      <button class="xl-btn xl-btn-ghost" onclick="xlExportCsv()">⬇ CSV</button>
      <button class="xl-btn xl-btn-primary" onclick="xlInsertToNote()">Insert to Note</button>
      <button class="xl-btn xl-btn-danger" onclick="xlClose()">✕ Close</button>
    </div>
  </div>
  <div class="xl-toolbar" id="xlToolbar">
    <button class="xl-btn xl-btn-ghost" onclick="xlFmt('bold')" title="Bold"><b>B</b></button>
    <button class="xl-btn xl-btn-ghost" onclick="xlFmt('italic')" title="Italic"><i>I</i></button>
    <div class="xl-toolbar-sep"></div>
    <button class="xl-btn xl-btn-ghost" onclick="xlAlign('left')" title="Align left">⬅</button>
    <button class="xl-btn xl-btn-ghost" onclick="xlAlign('center')" title="Center">↔</button>
    <button class="xl-btn xl-btn-ghost" onclick="xlAlign('right')" title="Align right">➡</button>
    <div class="xl-toolbar-sep"></div>
    <button class="xl-btn xl-btn-ghost" onclick="xlUndo()" title="Undo (Ctrl+Z)">↩ Undo</button>
    <button class="xl-btn xl-btn-ghost" onclick="xlClearCell()" title="Clear cell">⌫ Clear</button>
    <div class="xl-toolbar-sep"></div>
    <select id="xlFontSize" onchange="xlFontSz(this.value)" style="background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;padding:4px 8px;font-size:12px;cursor:pointer">
      <option>11</option><option selected>13</option><option>15</option><option>18</option><option>22</option>
    </select>
    <select id="xlBgColor" onchange="xlBg(this.value)" style="background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;padding:4px 8px;font-size:12px;cursor:pointer">
      <option value="">No fill</option>
      <option value="rgba(203,166,247,.25)">💜 Purple</option>
      <option value="rgba(166,227,161,.25)">💚 Green</option>
      <option value="rgba(137,180,250,.25)">💙 Blue</option>
      <option value="rgba(249,226,175,.25)">💛 Yellow</option>
      <option value="rgba(243,139,168,.25)">❤️ Red</option>
      <option value="rgba(250,179,135,.25)">🧡 Orange</option>
    </select>
  </div>
  <div class="xl-formula-bar">
    <input class="xl-cell-ref" id="xlCellRef" readonly value="A1">
    <span style="color:#6c7086;font-size:13px;font-family:monospace">ƒx</span>
    <input class="xl-formula-input" id="xlFormulaIn" placeholder="Cell value or =formula"
      oninput="xlFormulaChange(this.value)"
      onkeydown="if(event.key==='Enter'){xlCommitFormula();event.preventDefault()}">
  </div>
  <div class="xl-sheet-tabs" id="xlSheetTabs"></div>
  <div class="xl-grid-wrap" id="xlGridWrap">
    <table class="xl-grid" id="xlGrid"></table>
  </div>
  <div class="xl-status" id="xlStatus">
    <span>Ready</span>
  </div>
</div>`;
document.body.appendChild(overlay);

// Cell formatting metadata
let fmtMap = {}; // key: "sheetIdx:r:c" => { bold, italic, align, bg, fontSize }

function fmtKey(si, r, c) { return `${si}:${r}:${c}`; }
function getFmt(r, c) { return fmtMap[fmtKey(sheetIdx, r, c)] || {}; }
function setFmt(r, c, key, val) {
  const k = fmtKey(sheetIdx, r, c);
  fmtMap[k] = { ...getFmt(r, c), [key]: val };
  renderGrid();
}

// ── Grid rendering ────────────────────────────────────────────────────────
function renderGrid() {
  const data  = currentData();
  const rows  = data.length;
  const cols  = data[0] ? data[0].length : 10;
  const grid  = document.getElementById('xlGrid');

  // Header row
  let html = '<thead><tr><th class="row-header" style="background:#11111b"></th>';
  for (let c = 0; c < cols; c++) {
    html += `<th class="col-header" onclick="xlSelectCol(${c})">${colLetter(c)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let r = 0; r < rows; r++) {
    html += `<tr><th class="row-header" onclick="xlSelectRow(${r})">${r + 1}</th>`;
    for (let c = 0; c < cols; c++) {
      const val  = data[r][c] || '';
      const fmt  = getFmt(r, c);
      const sel  = (r === selRow && c === selCol) ? ' selected' : '';
      let style  = '';
      if (fmt.bold)     style += 'font-weight:700;';
      if (fmt.italic)   style += 'font-style:italic;';
      if (fmt.align)    style += `text-align:${fmt.align};`;
      if (fmt.bg)       style += `background:${fmt.bg};`;
      if (fmt.fontSize) style += `font-size:${fmt.fontSize}px;`;
      html += `<td class="xl-cell${sel}" data-r="${r}" data-c="${c}" style="${style}"
               onclick="xlSelectCell(${r},${c})"
               ondblclick="xlStartEdit(${r},${c})">
               <span class="xl-cell-inner">${escXl(displayVal(val, r, c))}</span>
             </td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  grid.innerHTML = html;

  // Update formula bar
  const ref = document.getElementById('xlCellRef');
  const fin = document.getElementById('xlFormulaIn');
  if (ref) ref.value = cellRef(selRow, selCol);
  if (fin) fin.value = currentData()[selRow] ? (currentData()[selRow][selCol] || '') : '';

  renderTabs();
  updateStatus();
}

function escXl(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Formula evaluation ────────────────────────────────────────────────────
function displayVal(raw, r, c) {
  if (typeof raw === 'string' && raw.startsWith('=')) {
    try { return evalFormula(raw.slice(1), r, c); }
    catch(e) { return '#ERR'; }
  }
  return raw;
}

function evalFormula(expr, curR, curC) {
  const data = currentData();
  // Replace cell references like A1, B2, etc.
  expr = expr.replace(/([A-Z]+)(\d+)/g, (_, col, row) => {
    const c = col.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const r = parseInt(row) - 1;
    const v = data[r] && data[r][c] !== undefined ? data[r][c] : 0;
    return isNaN(Number(v)) ? `"${v}"` : Number(v);
  });

  // Handle SUM(A1:B3) range
  expr = expr.replace(/SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/gi, (_, c1, r1, c2, r2) => {
    let sum = 0;
    const sc = c1.split('').reduce((n,ch) => n*26+(ch.charCodeAt(0)-64),0)-1;
    const ec = c2.split('').reduce((n,ch) => n*26+(ch.charCodeAt(0)-64),0)-1;
    for (let r = parseInt(r1)-1; r <= parseInt(r2)-1; r++)
      for (let c = sc; c <= ec; c++)
        sum += parseFloat(data[r] && data[r][c] || 0) || 0;
    return sum;
  });

  // Handle AVG / AVERAGE
  expr = expr.replace(/AVG\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/gi, (_, c1, r1, c2, r2) => {
    let sum = 0, count = 0;
    const sc = c1.split('').reduce((n,ch)=>n*26+(ch.charCodeAt(0)-64),0)-1;
    const ec = c2.split('').reduce((n,ch)=>n*26+(ch.charCodeAt(0)-64),0)-1;
    for (let r=parseInt(r1)-1;r<=parseInt(r2)-1;r++)
      for (let c=sc;c<=ec;c++) { sum+=parseFloat(data[r]&&data[r][c]||0)||0; count++; }
    return count ? sum/count : 0;
  });

  // Safe eval
  return Function('"use strict"; return (' + expr + ')')();
}

// ── Cell interaction ──────────────────────────────────────────────────────
window.xlSelectCell = function(r, c) {
  selRow = r; selCol = c;
  editMode = false;
  renderGrid();
};

window.xlSelectRow = function(r) {
  selRow = r; renderGrid();
};

window.xlSelectCol = function(c) {
  selCol = c; renderGrid();
};

window.xlStartEdit = function(r, c) {
  selRow = r; selCol = c; editMode = true;
  renderGrid();
  const cell = document.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  if (!cell) return;
  const inp = document.createElement('input');
  inp.className = 'xl-edit-input';
  inp.value = currentData()[r][c] || '';
  cell.appendChild(inp);
  inp.focus();
  inp.select();
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      saveEdit(inp.value, r, c);
      if (e.key === 'Enter' && r < currentData().length - 1) { selRow = r+1; xlStartEdit(r+1, c); }
      else if (e.key === 'Tab' && c < currentData()[0].length - 1) { selCol = c+1; xlStartEdit(r, c+1); }
      else renderGrid();
    } else if (e.key === 'Escape') { editMode = false; renderGrid(); }
  });
  inp.addEventListener('blur', () => { saveEdit(inp.value, r, c); editMode = false; });
};

function saveEdit(val, r, c) {
  undoStack.push({ r, c, old: currentData()[r][c], si: sheetIdx });
  if (undoStack.length > 100) undoStack.shift();
  currentData()[r][c] = val;
  document.getElementById('xlFormulaIn').value = val;
}

// ── Keyboard navigation ───────────────────────────────────────────────────
document.getElementById('xlGridWrap').addEventListener('keydown', (e) => {
  if (editMode) return;
  const moves = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
  if (moves[e.key]) {
    e.preventDefault();
    const [dr, dc] = moves[e.key];
    selRow = Math.max(0, Math.min(currentData().length-1, selRow+dr));
    selCol = Math.max(0, Math.min(currentData()[0].length-1, selCol+dc));
    renderGrid();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    xlClearCell();
  } else if (e.key === 'Enter') {
    xlStartEdit(selRow, selCol);
  } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    xlUndo();
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    xlStartEdit(selRow, selCol);
  }
});

document.getElementById('xlGridWrap').setAttribute('tabindex', '0');

// ── Toolbar actions ───────────────────────────────────────────────────────
window.xlFmt     = (k) => setFmt(selRow, selCol, k, !getFmt(selRow, selCol)[k]);
window.xlAlign   = (v) => setFmt(selRow, selCol, 'align', v);
window.xlBg      = (v) => setFmt(selRow, selCol, 'bg', v);
window.xlFontSz  = (v) => setFmt(selRow, selCol, 'fontSize', parseInt(v));
window.xlClearCell = () => { saveEdit('', selRow, selCol); renderGrid(); };
window.xlUndo    = () => {
  if (!undoStack.length) return;
  const { r, c, old, si } = undoStack.pop();
  sheets[si].data[r][c] = old; renderGrid();
};

window.xlAddRow  = () => { currentData().push(Array(currentData()[0].length).fill('')); renderGrid(); };
window.xlAddCol  = () => { currentData().forEach(row => row.push('')); renderGrid(); };

// ── Formula bar ───────────────────────────────────────────────────────────
window.xlFormulaChange = (val) => {
  if (currentData()[selRow]) currentData()[selRow][selCol] = val;
};
window.xlCommitFormula = () => {
  saveEdit(document.getElementById('xlFormulaIn').value, selRow, selCol);
  renderGrid();
};

// ── Status bar ────────────────────────────────────────────────────────────
function updateStatus() {
  const val = currentData()[selRow] && currentData()[selRow][selCol] || '';
  const nums = currentData().flat().map(v => parseFloat(v)).filter(v => !isNaN(v));
  const sum  = nums.reduce((a,b)=>a+b,0);
  document.getElementById('xlStatus').innerHTML = `
    <span>Cell: <b>${cellRef(selRow, selCol)}</b></span>
    <span>Sheet rows: <b>${currentData().length}</b> × cols: <b>${currentData()[0].length}</b></span>
    ${nums.length ? `<span>SUM: <b>${sum.toFixed(2)}</b>  AVG: <b>${(sum/nums.length).toFixed(2)}</b>  COUNT: <b>${nums.length}</b></span>` : ''}
  `;
}

// ── Sheet tabs ────────────────────────────────────────────────────────────
function renderTabs() {
  const tabs = document.getElementById('xlSheetTabs');
  tabs.innerHTML = sheets.map((s, i) =>
    `<div class="xl-tab ${i===sheetIdx?'active':''}" onclick="xlSwitchSheet(${i})" ondblclick="xlRenameSheet(${i})">${s.name}</div>`
  ).join('') + `<div class="xl-tab-add" onclick="xlAddSheet()">+</div>`;
}

window.xlSwitchSheet = (i) => { sheetIdx = i; selRow = 0; selCol = 0; renderGrid(); };
window.xlAddSheet    = () => {
  sheets.push({ name: `Sheet${sheets.length+1}`, data: createBlankData(30, 20) });
  sheetIdx = sheets.length - 1; renderGrid();
};
window.xlRenameSheet = (i) => {
  const name = prompt('Sheet name:', sheets[i].name);
  if (name) { sheets[i].name = name; renderGrid(); }
};

// ── Import from file ──────────────────────────────────────────────────────
window.xlImportFile = async () => {
  // We use the Electron file dialog + read file, then parse CSV/TSV or simple XLSX
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.tsv,.txt,.xlsx,.xls';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileName = file.name.replace(/\.[^.]+$/, '');
    document.getElementById('xlFileName').textContent = fileName;

    const text = await file.text();
    const ext  = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv' || ext === 'txt') {
      parseCsv(text, ',');
    } else if (ext === 'tsv') {
      parseCsv(text, '\t');
    } else if (ext === 'xlsx' || ext === 'xls') {
      // Use SheetJS if available
      if (window.XLSX) {
        const ab   = await file.arrayBuffer();
        const wb   = XLSX.read(ab, { type: 'array' });
        sheets = wb.SheetNames.map(name => {
          const ws  = wb.Sheets[name];
          const arr = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
          return { name, data: arr.length ? arr.map(r => r.map(String)) : createBlankData(30,20) };
        });
        sheetIdx = 0;
      } else {
        // Fallback: load SheetJS dynamically
        const script = document.createElement('script');
        script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
        script.onload = () => xlImportFile();
        document.head.appendChild(script);
        return;
      }
    }
    renderGrid();
  };
  input.click();
};

function parseCsv(text, sep) {
  const rows = text.split('\n').filter(r => r.trim()).map(r =>
    r.split(sep).map(c => c.replace(/^"|"$/g,'').replace(/""/g,'"'))
  );
  const maxCols = Math.max(...rows.map(r => r.length), 10);
  sheets = [{ name: 'Sheet1', data: rows.map(r => { while(r.length<maxCols) r.push(''); return r; }) }];
  sheetIdx = 0;
}

// ── Export to CSV ─────────────────────────────────────────────────────────
window.xlExportCsv = () => {
  const csv = currentData().map(row =>
    row.map(c => `"${(c||'').replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: `${fileName}.csv`
  });
  a.click(); URL.revokeObjectURL(a.href);
};

// ── Insert table into note ────────────────────────────────────────────────
window.xlInsertToNote = () => {
  const data = currentData();
  // Find bounds (non-empty)
  let maxR = 0, maxC = 0;
  data.forEach((row, r) => row.forEach((c, ci) => { if (c) { maxR = Math.max(maxR,r); maxC = Math.max(maxC,ci); } }));

  const slice = data.slice(0, maxR+1).map(r => r.slice(0, maxC+1));
  if (!slice.length) return;

  let md = '';
  md += '| ' + slice[0].map(c => c || ' ').join(' | ') + ' |\n';
  md += '| ' + slice[0].map(() => '---').join(' | ') + ' |\n';
  for (let r = 1; r < slice.length; r++) {
    md += '| ' + slice[r].map(c => displayVal(c||'', r, 0) || ' ').join(' | ') + ' |\n';
  }

  const ta = document.getElementById('editorContent');
  if (ta) {
    const pos = ta.selectionStart || ta.value.length;
    ta.value  = ta.value.slice(0, pos) + '\n\n' + md + '\n' + ta.value.slice(pos);
    app.currentNote.content = ta.value;
    app.updatePreview();
  }
  xlClose();
};

// ── Open / Close ──────────────────────────────────────────────────────────
window.xlClose = () => { overlay.classList.remove('open'); };
window.xlOpen  = () => {
  sheets   = [{ name: 'Sheet1', data: createBlankData(30, 20) }];
  sheetIdx = 0; selRow = 0; selCol = 0; fmtMap = {};
  document.getElementById('xlFileName').textContent = 'New Spreadsheet';
  overlay.classList.add('open');
  renderGrid();
  setTimeout(() => document.getElementById('xlGridWrap').focus(), 100);
};

// Close on backdrop click
overlay.addEventListener('click', (e) => { if (e.target === overlay) xlClose(); });

// ── Keyboard shortcut Ctrl+Shift+X ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key === 'X') { e.preventDefault(); xlOpen(); }
});

// ── Plugin registration ───────────────────────────────────────────────────
app.registerPluginAction('excel-integration', 'Spreadsheet Editor', '📊', () => xlOpen());
window.addEventListener('notehub:import-excel', () => xlOpen());

console.log('[Excel] Ready. Ctrl+Shift+X to open.');
