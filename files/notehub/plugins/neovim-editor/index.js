// =============================================================================
// NoteHub Neovim Editor Plugin
// Uses CodeMirror 6 with @replit/codemirror-vim for full Vim/Neovim emulation
// =============================================================================

console.log('[NvimEditor] Loading...');

// ── Config defaults ────────────────────────────────────────────────────────
const nvimConfig = Object.assign({
  relativeLineNumbers: true,
  lineNumbers:         true,
  syntaxHighlight:     true,
  theme:               'catppuccin',   // 'catppuccin' | 'dark' | 'light'
  tabSize:             2,
  indentWithTabs:      false,
  showModeIndicator:   true,
  cursorBlinkRate:     530,
  scrollPastEnd:       0.3,
  highlightActiveLine: true,
  showMatchingBrackets:true,
  autoCloseBrackets:   true,
  extraConfig:         {}
}, (window.notehubConfig && window.notehubConfig.nvim) || {});

// ── Inject styles ──────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
/* ── CodeMirror Host ─────────────────────────────────── */
.nvim-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #1e1e2e;
  position: relative;
}

.nvim-host .cm-editor {
  flex: 1;
  min-height: 0;
  height: 100%;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.7;
}

.nvim-host .cm-editor.cm-focused { outline: none; }

.nvim-host .cm-scroller {
  overflow-y: auto !important;
  overflow-x: auto !important;
  min-height: 0;
  flex: 1;
}

/* ── Catppuccin Mocha Palette ────────────────────────── */
.nvim-host .cm-editor { background: #1e1e2e; color: #cdd6f4; }
.nvim-host .cm-gutters {
  background: #181825;
  color: #45475a;
  border-right: 1px solid #313244;
}
.nvim-host .cm-activeLineGutter { background: #313244; color: #cba6f7; }
.nvim-host .cm-activeLine       { background: rgba(49,50,68,0.5); }
.nvim-host .cm-cursor           { border-left: 2px solid #cba6f7; }
.nvim-host .cm-selectionBackground,
.nvim-host .cm-content ::selection { background: rgba(88,91,112,0.6) !important; }
.nvim-host .cm-matchingBracket  { outline: 1px solid #cba6f7; color: #f5c2e7 !important; }
.nvim-host .cm-lineNumbers      { min-width: 42px; padding: 0 6px; }

/* relative line numbers */
.nvim-host .cm-lineNumbers .cm-gutterElement { text-align: right; }

/* ── Syntax – Catppuccin Mocha ───────────────────────── */
.nvim-host .tok-keyword        { color: #cba6f7; font-style: italic; }
.nvim-host .tok-operator       { color: #89dceb; }
.nvim-host .tok-variable       { color: #cdd6f4; }
.nvim-host .tok-variableName   { color: #cdd6f4; }
.nvim-host .tok-number         { color: #fab387; }
.nvim-host .tok-string         { color: #a6e3a1; }
.nvim-host .tok-string2        { color: #a6e3a1; }
.nvim-host .tok-comment        { color: #6c7086; font-style: italic; }
.nvim-host .tok-def            { color: #89b4fa; }
.nvim-host .tok-propertyName   { color: #89dceb; }
.nvim-host .tok-typeName       { color: #f9e2af; }
.nvim-host .tok-className      { color: #f9e2af; }
.nvim-host .tok-special        { color: #f5c2e7; }
.nvim-host .tok-meta           { color: #f5c2e7; }
.nvim-host .tok-tag            { color: #f38ba8; }
.nvim-host .tok-attribute      { color: #fab387; }
.nvim-host .tok-atom           { color: #fab387; }
.nvim-host .tok-bool           { color: #fab387; }
.nvim-host .tok-punctuation    { color: #cdd6f4; }
.nvim-host .tok-link           { color: #74c7ec; text-decoration: underline; }
.nvim-host .tok-heading        { color: #cba6f7; font-weight: bold; }
.nvim-host .tok-heading1       { color: #f38ba8; font-weight: bold; font-size: 1.4em; }
.nvim-host .tok-heading2       { color: #fab387; font-weight: bold; font-size: 1.25em; }
.nvim-host .tok-heading3       { color: #f9e2af; font-weight: bold; font-size: 1.1em; }
.nvim-host .tok-emphasis       { color: #f5c2e7; font-style: italic; }
.nvim-host .tok-strong         { color: #cba6f7; font-weight: bold; }
.nvim-host .tok-strikethrough  { color: #6c7086; text-decoration: line-through; }
.nvim-host .tok-monospace,
.nvim-host .tok-code           { color: #a6e3a1; background: rgba(49,50,68,0.8); padding: 1px 3px; border-radius: 3px; }
.nvim-host .tok-invalid        { color: #f38ba8; text-decoration: underline wavy; }

/* ── Mode Indicator ──────────────────────────────────── */
.nvim-mode-bar {
  height: 24px;
  background: #11111b;
  border-top: 1px solid #313244;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  flex-shrink: 0;
}

.nvim-mode-badge {
  padding: 2px 8px;
  border-radius: 3px;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  transition: all 0.08s;
}

.nvim-mode-badge.normal  { background: #cba6f7; color: #1e1e2e; }
.nvim-mode-badge.insert  { background: #a6e3a1; color: #1e1e2e; }
.nvim-mode-badge.visual  { background: #89dceb; color: #1e1e2e; }
.nvim-mode-badge.replace { background: #f38ba8; color: #1e1e2e; }
.nvim-mode-badge.command { background: #f9e2af; color: #1e1e2e; }

.nvim-cursor-pos { color: #585b70; font-size: 11px; }
.nvim-file-info  { color: #45475a; font-size: 11px; margin-left: auto; }

/* ── Command Line ────────────────────────────────────── */
.nvim-cmdline {
  display: none;
  height: 28px;
  background: #11111b;
  border-top: 1px solid #313244;
  padding: 0 8px;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.nvim-cmdline.visible { display: flex; }
.nvim-cmdline-prompt  { color: #cba6f7; font-family: monospace; font-size: 13px; }
.nvim-cmdline-input   {
  flex: 1; background: transparent; border: none; outline: none;
  color: #cdd6f4; font-family: 'JetBrains Mono', monospace; font-size: 13px;
}

/* ── Search highlight ────────────────────────────────── */
.nvim-host .cm-searchMatch         { background: rgba(249,226,175,0.3); border: 1px solid #f9e2af; border-radius: 2px; }
.nvim-host .cm-searchMatch-selected{ background: rgba(203,166,247,0.5); }

/* ── Keybinding popup ────────────────────────────────── */
.nvim-keybinds {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
  background: #181825; border: 1px solid #313244; border-radius: 10px;
  padding: 24px; z-index: 9999; min-width: 520px; max-height: 80vh;
  overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  display: none;
}
.nvim-keybinds.visible { display: block; }
.nvim-keybinds h2 { color: #cba6f7; margin-bottom: 16px; font-size: 16px; }
.nvim-keybinds h3 { color: #89b4fa; font-size: 13px; margin: 14px 0 6px; }
.nvim-keybinds table { width: 100%; border-collapse: collapse; font-size: 12px; }
.nvim-keybinds td { padding: 4px 8px; color: #cdd6f4; }
.nvim-keybinds td:first-child {
  font-family: monospace; color: #a6e3a1; white-space: nowrap; width: 140px;
}
.nvim-keybinds tr:hover td { background: rgba(49,50,68,0.5); }
.nvim-keybinds-backdrop {
  position: fixed; inset: 0; z-index: 9998; background: rgba(0,0,0,0.5);
  display: none; backdrop-filter: blur(4px);
}
.nvim-keybinds-backdrop.visible { display: block; }
`;
document.head.appendChild(style);

// ── CDN loader helper ──────────────────────────────────────────────────────
// Use esm.sh which properly resolves transitive ESM dependencies (unlike bare
// jsdelivr/unpkg paths which fail on inter-package imports).
const ESM = 'https://esm.sh';

async function loadDeps() {
  const bundle = document.createElement('script');
  bundle.type = 'module';
  bundle.textContent = `
    import { EditorView, keymap, lineNumbers, highlightActiveLine,
             highlightActiveLineGutter, drawSelection, dropCursor,
             rectangularSelection, crosshairCursor, highlightSpecialChars,
             ViewPlugin, gutter, GutterMarker }
      from '${ESM}/@codemirror/view@6.34.3';
    import { EditorState, Compartment, StateField, StateEffect, RangeSet }
      from '${ESM}/@codemirror/state@6.5.0';
    import { markdown }
      from '${ESM}/@codemirror/lang-markdown@6.3.2';
    import { javascript }
      from '${ESM}/@codemirror/lang-javascript@6.2.2';
    import { python }
      from '${ESM}/@codemirror/lang-python@6.1.6';
    import { json }
      from '${ESM}/@codemirror/lang-json@6.0.1';
    import { html }
      from '${ESM}/@codemirror/lang-html@6.4.9';
    import { css }
      from '${ESM}/@codemirror/lang-css@6.3.1';
    import { vim, Vim, getCM }
      from '${ESM}/@replit/codemirror-vim@6.2.1';
    import { defaultKeymap, history, historyKeymap, indentWithTab }
      from '${ESM}/@codemirror/commands@6.7.1';
    import { searchKeymap, highlightSelectionMatches }
      from '${ESM}/@codemirror/search@6.5.8';
    import { autocompletion, completionKeymap, closeBrackets,
             closeBracketsKeymap }
      from '${ESM}/@codemirror/autocomplete@6.18.4';
    import { bracketMatching, foldGutter, indentOnInput }
      from '${ESM}/@codemirror/language@6.10.8';

    window.__CM = {
      EditorView, EditorState, Compartment, StateField, StateEffect, RangeSet,
      ViewPlugin, gutter, GutterMarker,
      keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
      drawSelection, dropCursor, rectangularSelection, crosshairCursor,
      highlightSpecialChars, highlightSelectionMatches,
      history, historyKeymap, defaultKeymap, indentWithTab,
      searchKeymap, autocompletion, completionKeymap,
      closeBrackets, closeBracketsKeymap,
      bracketMatching, foldGutter, indentOnInput,
      markdown, javascript, python, json, html, css,
      vim, Vim, getCM
    };

    console.log('[NvimEditor] All ESM modules loaded via esm.sh');
    window.dispatchEvent(new Event('cm-ready'));
  `;
  document.head.appendChild(bundle);

  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CodeMirror load timeout')), 30000);
    window.addEventListener('cm-ready', () => { clearTimeout(t); res(); }, { once: true });
  });
}

// ── Build editor ───────────────────────────────────────────────────────────
function buildEditor(host, initialContent, onChange) {
  const CM = window.__CM;
  const {
    EditorView, EditorState, Compartment, StateField, StateEffect,
    ViewPlugin,
    keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    drawSelection, highlightSpecialChars, highlightSelectionMatches,
    history, historyKeymap, defaultKeymap, indentWithTab,
    searchKeymap, autocompletion, completionKeymap,
    closeBrackets, closeBracketsKeymap,
    bracketMatching, indentOnInput,
    markdown, javascript, python, json, html, css,
    vim, Vim, getCM
  } = CM;

  // Detect language from note title
  const title = (app.currentNote && app.currentNote.title) || '';
  const ext   = title.split('.').pop().toLowerCase();
  const langMap = {
    js: javascript(), ts: javascript({ typescript: true }),
    py: python(), json: json(), html: html(), css: css(),
    md: markdown(), markdown: markdown()
  };
  const lang = langMap[ext] || markdown();

  // ── Relative line numbers with forced gutter refresh on cursor move ──
  // We use a Compartment so we can reconfigure the gutter dynamically,
  // plus a ViewPlugin that detects when the cursor line changes and
  // forces the gutter to re-render via compartment reconfiguration.
  const lineNumCompartment = new Compartment();

  function makeLineNumbersExt() {
    if (!nvimConfig.lineNumbers) return [];
    return lineNumbers({
      formatNumber: (n, state) => {
        if (!nvimConfig.relativeLineNumbers) return String(n);
        const sel  = state.selection.main.head;
        const cur  = state.doc.lineAt(sel).number;
        if (n === cur) return String(n);
        return String(Math.abs(n - cur));
      }
    });
  }

  // This plugin watches for cursor line changes and forces a gutter
  // reconfiguration so relative numbers update in real time.
  let lastCursorLine = -1;
  const relNumRefresher = ViewPlugin.fromClass(class {
    update(update) {
      if (!nvimConfig.relativeLineNumbers) return;
      const sel  = update.state.selection.main.head;
      const line = update.state.doc.lineAt(sel).number;
      if (line !== lastCursorLine) {
        lastCursorLine = line;
        // Schedule a compartment reconfiguration to force gutter redraw
        queueMicrotask(() => {
          if (update.view && !update.view.destroyed) {
            update.view.dispatch({
              effects: lineNumCompartment.reconfigure(makeLineNumbersExt())
            });
          }
        });
      }
    }
  });

  // Mode indicator refs
  const modeBadge = host.querySelector('.nvim-mode-badge');
  const cursorPos = host.querySelector('.nvim-cursor-pos');
  const cmdLine   = host.querySelector('.nvim-cmdline');
  const cmdInput  = host.querySelector('.nvim-cmdline-input');

  // Register custom Vim ex-commands
  Vim.defineEx('w',  '', () => { app.saveCurrentNote(); flashSaved(); });
  Vim.defineEx('wq', '', () => { app.saveCurrentNote(); });
  Vim.defineEx('q',  '', () => { app.saveCurrentNote(); });
  Vim.defineEx('wqa','', () => { app.saveCurrentNote(); });
  Vim.defineEx('set','', (cm, params) => {
    const arg = (params.args || []).join(' ');
    if (arg === 'nu'   || arg === 'number')         nvimConfig.lineNumbers = true;
    if (arg === 'nonu' || arg === 'nonumber')       nvimConfig.lineNumbers = false;
    if (arg === 'rnu'  || arg === 'relativenumber') nvimConfig.relativeLineNumbers = true;
    if (arg === 'nornu')                             nvimConfig.relativeLineNumbers = false;
    // Force gutter reconfiguration after :set commands
    if (cmView) {
      cmView.dispatch({
        effects: lineNumCompartment.reconfigure(makeLineNumbersExt())
      });
    }
  });

  // Listener to update mode bar + cursor position
  const modeNames = { normal: 'NORMAL', insert: 'INSERT', visual: 'VISUAL',
                      replace: 'REPLACE', 'visual-line': 'V-LINE',
                      'visual-block': 'V-BLOCK' };

  const updateModeBar = EditorView.updateListener.of(update => {
    // Cursor position
    const sel  = update.state.selection.main.head;
    const line = update.state.doc.lineAt(sel);
    const col  = sel - line.from + 1;
    if (cursorPos) cursorPos.textContent = `Ln ${line.number}, Col ${col}`;

    // Content change → sync back to app
    if (update.docChanged) {
      const content = update.state.doc.toString();
      if (app.currentNote) {
        app.currentNote.content = content;
        if (typeof onChange === 'function') onChange(content);
      }
    }
  });

  // ── Robust Vim mode detection ──
  // Poll the vim state directly from the CodeMirror vim adapter rather
  // than relying solely on MutationObserver on a panel element.
  let modePoller = null;

  function detectVimMode(view) {
    try {
      // Try to get mode from the vim panel text that codemirror-vim creates
      const vimBar = host.querySelector('.cm-vim-panel');
      if (vimBar) {
        const text = (vimBar.textContent || '').trim().toLowerCase();
        if (text.includes('insert'))       return 'insert';
        if (text.includes('visual line'))  return 'visual-line';
        if (text.includes('visual block')) return 'visual-block';
        if (text.includes('visual'))       return 'visual';
        if (text.includes('replace'))      return 'replace';
        if (text.startsWith(':'))          return 'command';
        return 'normal';
      }
      // Fallback: check if getCM is available (exported from @replit/codemirror-vim)
      if (getCM && view) {
        const cmAdapter = getCM(view);
        if (cmAdapter && cmAdapter.state) {
          const vimState = cmAdapter.state.vim;
          if (vimState) {
            if (vimState.insertMode)  return 'insert';
            if (vimState.visualMode)  return vimState.visualLine ? 'visual-line' :
                                              vimState.visualBlock ? 'visual-block' : 'visual';
          }
        }
      }
    } catch (e) { /* ignore */ }
    return 'normal';
  }

  const extensions = [
    vim({ status: true }),
    lineNumCompartment.of(makeLineNumbersExt()),
    relNumRefresher,
    nvimConfig.highlightActiveLine ? highlightActiveLine() : [],
    nvimConfig.highlightActiveLine ? highlightActiveLineGutter() : [],
    nvimConfig.showMatchingBrackets ? bracketMatching() : [],
    nvimConfig.autoCloseBrackets   ? closeBrackets() : [],
    nvimConfig.syntaxHighlight     ? lang : [],
    history(),
    drawSelection(),
    indentOnInput(),
    highlightSpecialChars(),
    highlightSelectionMatches(),
    autocompletion(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab
    ]),
    EditorView.lineWrapping,
    updateModeBar,
    EditorView.theme({
      '&': { height: '100%', background: '#1e1e2e', color: '#cdd6f4' },
      '.cm-content': { caretColor: '#cba6f7', padding: '16px 0' },
      '.cm-line': { padding: '0 16px' },
      '.cm-gutters': { background: '#181825', color: '#45475a', border: 'none',
                       borderRight: '1px solid #313244', paddingRight: '8px' },
      '.cm-activeLineGutter': { background: '#313244', color: '#cba6f7' },
      '.cm-activeLine': { background: 'rgba(49,50,68,0.5)' },
      '.cm-cursor': { borderLeftColor: '#cba6f7', borderLeftWidth: '2px' },
      '.cm-selectionBackground': { background: 'rgba(88,91,112,0.6)' },
      '.cm-focused .cm-selectionBackground': { background: 'rgba(88,91,112,0.6)' },
      '.cm-panels': { background: '#181825', color: '#cdd6f4' },
      '.cm-panel input': { background: '#313244', border: '1px solid #45475a',
                           color: '#cdd6f4', borderRadius: '4px', padding: '2px 6px' },
      // Hide the default vim status panel since we have our own mode bar
      '.cm-vim-panel': { display: 'none' },
    })
  ];

  const state = EditorState.create({
    doc: initialContent,
    extensions
  });

  const view = new EditorView({ state, parent: host.querySelector('.nvim-cm-wrap') });

  // ── Vim mode polling (more reliable than MutationObserver alone) ──
  if (modeBadge) {
    modePoller = setInterval(() => {
      const mode = detectVimMode(view);
      const label = modeNames[mode] || mode.toUpperCase();
      if (modeBadge.textContent !== label) {
        modeBadge.textContent = label;
        modeBadge.className   = `nvim-mode-badge ${mode.split('-')[0]}`;
      }
    }, 80);

    // Clean up poller when view is destroyed
    const origDestroy = view.destroy.bind(view);
    view.destroy = () => {
      clearInterval(modePoller);
      origDestroy();
    };
  }

  // Also keep the MutationObserver as a backup for instant mode switches
  const observer = new MutationObserver(() => {
    const mode = detectVimMode(view);
    const label = modeNames[mode] || mode.toUpperCase();
    if (modeBadge && modeBadge.textContent !== label) {
      modeBadge.textContent = label;
      modeBadge.className   = `nvim-mode-badge ${mode.split('-')[0]}`;
    }
  });
  observer.observe(host, { childList: true, subtree: true, characterData: true });

  console.log('[NvimEditor] Editor built with vim mode + relative line numbers ✓');
  return view;
}

// ── Flash "saved" in mode bar ──────────────────────────────────────────────
function flashSaved() {
  const el = document.querySelector('.nvim-file-info');
  if (!el) return;
  const orig = el.textContent;
  el.textContent = '✓ saved';
  el.style.color = '#a6e3a1';
  setTimeout(() => { el.textContent = orig; el.style.color = ''; }, 1500);
}

// ── Keybindings popup ──────────────────────────────────────────────────────
const keybindHTML = `
<div class="nvim-keybinds-backdrop" id="nvimBackdrop"></div>
<div class="nvim-keybinds" id="nvimKeybinds">
  <h2>⌨️  Vim / Neovim Keybindings</h2>
  <p style="color:#6c7086;font-size:12px;margin-bottom:12px;">
    Press <kbd style="background:#313244;padding:2px 6px;border-radius:3px;color:#cba6f7">Space ?</kbd>
    or click the <strong style="color:#cba6f7">?</strong> button to toggle this.
  </p>

  <h3>Modes</h3>
  <table>
    <tr><td>i / a / o</td><td>Enter Insert mode (before / after / new line)</td></tr>
    <tr><td>I / A / O</td><td>Insert at line start / end / above</td></tr>
    <tr><td>v / V</td><td>Visual / Visual Line mode</td></tr>
    <tr><td>Ctrl+v</td><td>Visual Block mode</td></tr>
    <tr><td>R</td><td>Replace mode</td></tr>
    <tr><td>Esc / Ctrl+[</td><td>Return to Normal mode</td></tr>
  </table>

  <h3>Navigation</h3>
  <table>
    <tr><td>h j k l</td><td>Move left / down / up / right</td></tr>
    <tr><td>w / b / e</td><td>Next word / prev word / end of word</td></tr>
    <tr><td>W / B / E</td><td>Same but WORD (by whitespace)</td></tr>
    <tr><td>0 / ^ / $</td><td>Line start / first char / line end</td></tr>
    <tr><td>gg / G</td><td>First / last line</td></tr>
    <tr><td>{ / }</td><td>Prev / next paragraph</td></tr>
    <tr><td>Ctrl+d / Ctrl+u</td><td>Half-page down / up</td></tr>
    <tr><td>Ctrl+f / Ctrl+b</td><td>Page down / up</td></tr>
    <tr><td>zz / zt / zb</td><td>Center / top / bottom cursor line</td></tr>
    <tr><td>% </td><td>Jump to matching bracket</td></tr>
    <tr><td>nG / :n</td><td>Go to line n</td></tr>
  </table>

  <h3>Editing</h3>
  <table>
    <tr><td>x / X</td><td>Delete char under / before cursor</td></tr>
    <tr><td>dd / D</td><td>Delete line / to end of line</td></tr>
    <tr><td>cc / C</td><td>Change line / to end of line</td></tr>
    <tr><td>yy / Y</td><td>Yank (copy) line</td></tr>
    <tr><td>p / P</td><td>Paste after / before cursor</td></tr>
    <tr><td>u / Ctrl+r</td><td>Undo / Redo</td></tr>
    <tr><td>. </td><td>Repeat last change</td></tr>
    <tr><td>~ </td><td>Toggle case</td></tr>
    <tr><td>&gt;&gt; / &lt;&lt;</td><td>Indent / dedent line</td></tr>
    <tr><td>J</td><td>Join lines</td></tr>
    <tr><td>r{c}</td><td>Replace char with c</td></tr>
    <tr><td>ciw / caw</td><td>Change inner / around word</td></tr>
    <tr><td>di" / da"</td><td>Delete inside / around quotes</td></tr>
    <tr><td>ci( / ca(</td><td>Change inside / around parens</td></tr>
  </table>

  <h3>Search</h3>
  <table>
    <tr><td>/{pattern}</td><td>Search forward</td></tr>
    <tr><td>?{pattern}</td><td>Search backward</td></tr>
    <tr><td>n / N</td><td>Next / prev match</td></tr>
    <tr><td>* / #</td><td>Search word under cursor forward / back</td></tr>
    <tr><td>:%s/old/new/g</td><td>Replace all in file</td></tr>
  </table>

  <h3>Visual Mode</h3>
  <table>
    <tr><td>d / x</td><td>Delete selection</td></tr>
    <tr><td>y</td><td>Yank selection</td></tr>
    <tr><td>c</td><td>Change selection</td></tr>
    <tr><td>&gt; / &lt;</td><td>Indent / dedent selection</td></tr>
    <tr><td>~</td><td>Toggle case of selection</td></tr>
    <tr><td>u / U</td><td>Lowercase / uppercase selection</td></tr>
  </table>

  <h3>NoteHub Commands (:)</h3>
  <table>
    <tr><td>:w</td><td>Save current note</td></tr>
    <tr><td>:wq</td><td>Save note</td></tr>
    <tr><td>:q</td><td>Save and close editor focus</td></tr>
    <tr><td>:set nu</td><td>Show line numbers</td></tr>
    <tr><td>:set nonu</td><td>Hide line numbers</td></tr>
    <tr><td>:set rnu</td><td>Relative line numbers</td></tr>
    <tr><td>:set nornu</td><td>Absolute line numbers</td></tr>
    <tr><td>:%s/foo/bar/g</td><td>Replace all foo with bar</td></tr>
    <tr><td>:noh</td><td>Clear search highlight</td></tr>
  </table>

  <div style="margin-top:20px;text-align:right;">
    <button class="btn-primary" onclick="window.__nvimToggleHelp()">Close</button>
  </div>
</div>
`;
document.body.insertAdjacentHTML('beforeend', keybindHTML);

window.__nvimToggleHelp = function() {
  document.getElementById('nvimKeybinds').classList.toggle('visible');
  document.getElementById('nvimBackdrop').classList.toggle('visible');
};
document.getElementById('nvimBackdrop').addEventListener('click', window.__nvimToggleHelp);

// ── Main render hook ───────────────────────────────────────────────────────
let cmView = null;

function injectNvimEditor() {
  const editorPane = document.querySelector('.editor-pane:not(.hidden)');
  if (!editorPane) return;
  const textarea = editorPane.querySelector('.markdown-textarea');
  if (!textarea) return;

  // Already injected?
  if (editorPane.querySelector('.nvim-host')) return;

  const content = textarea.value;

  // Hide the textarea and the default line-numbers gutter
  textarea.style.display = 'none';
  const defaultLineNums = editorPane.querySelector('.line-numbers');
  if (defaultLineNums) defaultLineNums.style.display = 'none';

  // Build the host container
  const host = document.createElement('div');
  host.className = 'nvim-host';
  host.innerHTML = `
    <div class="nvim-cm-wrap" style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;"></div>
    <div class="nvim-cmdline" id="nvimCmdline">
      <span class="nvim-cmdline-prompt">:</span>
      <input class="nvim-cmdline-input" id="nvimCmdInput" />
    </div>
    <div class="nvim-mode-bar">
      <span class="nvim-mode-badge normal">NORMAL</span>
      <span class="nvim-cursor-pos">Ln 1, Col 1</span>
      <span class="nvim-file-info">${(app.currentNote && app.currentNote.title) || 'untitled'}</span>
      <button
        title="Keybinding reference"
        onclick="window.__nvimToggleHelp()"
        style="background:none;border:none;color:#585b70;cursor:pointer;padding:2px 4px;font-size:13px;margin-left:8px;">
        ?
      </button>
    </div>
  `;
  editorPane.appendChild(host);

  const wrap = host.querySelector('.nvim-cm-wrap');
  wrap.style.flex      = '1';
  wrap.style.minHeight = '0';
  wrap.style.overflow  = 'hidden';

  if (!window.__CM) {
    host.querySelector('.nvim-cm-wrap').innerHTML =
      '<div style="padding:20px;color:#f38ba8;">Loading Vim engine…</div>';
    return;
  }

  cmView = buildEditor(host, content, (newContent) => {
    textarea.value = newContent;
    if (app.currentNote) app.currentNote.content = newContent;
    app.updatePreview && app.updatePreview();
  });

  // Space+? shortcut for help
  cmView.dom.addEventListener('keydown', (e) => {
    if (e.key === '?' && e.target === cmView.contentDOM) {
      // only in normal mode — codemirror-vim handles it, we just watch
    }
  });
}

// ── Patch renderEditor ─────────────────────────────────────────────────────
const _origRender = app.renderEditor.bind(app);
app.renderEditor = function() {
  cmView = null;
  _origRender();
  if (!app.currentNote) return;

  if (!window.__CM) {
    // Deps still loading — try again when ready
    window.addEventListener('cm-ready', () => {
      setTimeout(injectNvimEditor, 50);
    }, { once: true });
  } else {
    setTimeout(injectNvimEditor, 50);
  }
};

// ── Patch saveCurrentNote to read from CodeMirror ─────────────────────────
const _origSave = app.saveCurrentNote.bind(app);
app.saveCurrentNote = async function() {
  if (cmView && app.currentNote) {
    app.currentNote.content = cmView.state.doc.toString();
    const ta = document.querySelector('.markdown-textarea');
    if (ta) ta.value = app.currentNote.content;
  }
  await _origSave();
};

// ── Boot ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    await loadDeps();
    console.log('[NvimEditor] CodeMirror + Vim loaded ✓');
    // Re-render if a note is already open
    if (app.currentNote) {
      app.renderEditor();
    }
  } catch (err) {
    console.error('[NvimEditor] Failed to load dependencies:', err);
  }
})();

console.log('[NvimEditor] Plugin installed ✓');
