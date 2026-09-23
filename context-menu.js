/* NoteHub — right-click context menus.
 *
 * Electron ships no default context menu, so this file draws one. It is
 * rendered as HTML (rather than Electron's native Menu) for two reasons:
 * it follows the theme presets in styles/main.css, and two of the entries
 * -- the colour swatches and the hover-to-size table picker -- aren't
 * expressible in a native menu template.
 *
 * The menu is opened by the main process's 'context-menu' event, not by a
 * DOM 'contextmenu' listener, because only the main process sees the
 * spellchecker's suggestions and the clipboard-backed edit flags. Clipboard
 * actions are sent back to main and run through webContents, so cut/copy/
 * paste behave identically to the Edit menu and the OS accelerators -- in
 * particular a real paste event still reaches CodeMirror, preserving its
 * undo history and the existing image-paste handler.
 */
(() => {
    'use strict';

    const IS_MAC = navigator.platform.toUpperCase().includes('MAC');
    const MOD = IS_MAC ? '⌘' : 'Ctrl+';
    const ipc = (action, arg) => window.electron && window.electron.ctxAction(action, arg);

    // ── Menu widget ─────────────────────────────────────────────────────────
    // An item is one of:
    //   { type: 'separator' }
    //   { type: 'header', label }
    //   { type: 'custom', render: () => HTMLElement }
    //   { label, icon?, accel?, danger?, disabled?, run() }
    //   { label, icon?, submenu: [items] | () => [items] }

    let rootMenu = null;          // outermost open panel
    let openPanels = [];          // [root, submenu, sub-submenu…]
    let hoverTimer = null;

    // Opening the OS colour picker blurs the window, which would otherwise
    // tear the menu down (and detach the <input> driving the picker) before a
    // colour is chosen.
    let suppressBlurClose = false;

    function onWindowBlur() {
        if (suppressBlurClose) { suppressBlurClose = false; return; }
        closeMenu();
    }

    function closeMenu() {
        openPanels.forEach(p => p.remove());
        openPanels = [];
        rootMenu = null;
        clearTimeout(hoverTimer);
        document.removeEventListener('mousedown', onDocMouseDown, true);
        document.removeEventListener('keydown', onDocKeyDown, true);
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('resize', closeMenu);
        document.removeEventListener('wheel', closeMenu, true);
    }

    function onDocMouseDown(e) {
        if (!openPanels.some(p => p.contains(e.target))) closeMenu();
    }

    function onDocKeyDown(e) {
        if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    }

    function buildPanel(items) {
        const panel = document.createElement('div');
        panel.className = 'nh-ctx';
        // Keep focus (and therefore the editor selection) where it was --
        // webContents.cut/copy/paste act on the focused element.
        panel.addEventListener('mousedown', e => e.preventDefault());
        panel.addEventListener('contextmenu', e => e.preventDefault());

        for (const item of items) {
            if (!item) continue;

            // renderer.js's sidebar menus use { separator: true }; ours use
            // { type: 'separator' }. Accept both so neither call site had to
            // be rewritten when the two widgets merged.
            if (item.type === 'separator' || item.separator === true) {
                panel.appendChild(Object.assign(document.createElement('div'), { className: 'nh-ctx-sep' }));
                continue;
            }
            if (item.type === 'header') {
                const h = document.createElement('div');
                h.className = 'nh-ctx-header';
                h.textContent = item.label;
                panel.appendChild(h);
                continue;
            }
            if (item.type === 'custom') {
                panel.appendChild(item.render());
                continue;
            }

            const row = document.createElement('div');
            row.className = 'nh-ctx-item';
            if (item.disabled) row.classList.add('disabled');
            if (item.danger) row.classList.add('danger');

            const icon = document.createElement('span');
            icon.className = 'nh-ctx-icon';
            icon.textContent = item.icon || '';
            row.appendChild(icon);

            const label = document.createElement('span');
            label.className = 'nh-ctx-label';
            label.textContent = item.label;
            row.appendChild(label);

            if (item.submenu) {
                row.appendChild(Object.assign(document.createElement('span'),
                    { className: 'nh-ctx-arrow', textContent: '›' }));
            } else if (item.accel) {
                row.appendChild(Object.assign(document.createElement('span'),
                    { className: 'nh-ctx-accel', textContent: item.accel }));
            }

            if (!item.disabled) {
                if (item.submenu) {
                    row.addEventListener('mouseenter', () => {
                        clearTimeout(hoverTimer);
                        hoverTimer = setTimeout(() => openSubmenu(panel, row, item), 90);
                    });
                    row.addEventListener('click', () => {
                        clearTimeout(hoverTimer);
                        openSubmenu(panel, row, item);
                    });
                } else {
                    row.addEventListener('mouseenter', () => {
                        clearTimeout(hoverTimer);
                        hoverTimer = setTimeout(() => collapseTo(panel), 90);
                    });
                    row.addEventListener('click', () => {
                        closeMenu();
                        try { item.run(); } catch (err) { console.error('[NoteHub] context action failed:', err); }
                    });
                }
            }

            panel.appendChild(row);
        }
        return panel;
    }

    // Drop any panels stacked on top of `panel` (i.e. a sibling submenu the
    // pointer has moved away from).
    function collapseTo(panel) {
        const idx = openPanels.indexOf(panel);
        if (idx === -1) return;
        openPanels.slice(idx + 1).forEach(p => p.remove());
        openPanels = openPanels.slice(0, idx + 1);
        panel.querySelectorAll('.nh-ctx-item.open').forEach(r => r.classList.remove('open'));
    }

    function openSubmenu(parentPanel, row, item) {
        collapseTo(parentPanel);
        if (row.classList.contains('open')) return;
        row.classList.add('open');

        const items = typeof item.submenu === 'function' ? item.submenu() : item.submenu;
        const sub = buildPanel(items);
        document.body.appendChild(sub);
        openPanels.push(sub);

        const r = row.getBoundingClientRect();
        placePanel(sub, r.right - 4, r.top - 6, { flipAnchorLeft: r.left });
    }

    // Keep the panel inside the viewport: flip rather than clamp, so the
    // pointer never lands on top of the menu it just opened.
    function placePanel(panel, x, y, opts = {}) {
        panel.style.visibility = 'hidden';
        panel.style.left = '0px';
        panel.style.top = '0px';
        const { width, height } = panel.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const pad = 6;

        let left = x;
        if (left + width > vw - pad) {
            left = opts.flipAnchorLeft !== undefined
                ? Math.max(pad, opts.flipAnchorLeft - width + 4)
                : Math.max(pad, x - width);
        }

        let top = y;
        if (top + height > vh - pad) top = Math.max(pad, vh - pad - height);

        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
        panel.style.visibility = '';
    }

    function showMenu(items, x, y) {
        closeMenu();
        if (!items.length) return;
        rootMenu = buildPanel(items);
        document.body.appendChild(rootMenu);
        openPanels = [rootMenu];
        placePanel(rootMenu, x, y);

        document.addEventListener('mousedown', onDocMouseDown, true);
        document.addEventListener('keydown', onDocKeyDown, true);
        window.addEventListener('blur', onWindowBlur);
        window.addEventListener('resize', closeMenu);
        document.addEventListener('wheel', closeMenu, true);
    }

    // ── Markdown editing helpers ────────────────────────────────────────────
    // All of these go through cm.replaceSelection / cm.replaceRange, which
    // fire CodeMirror's 'change' event -- renderer.js already listens for
    // that to sync currentNote.content and refresh the preview, so nothing
    // here touches app state directly.

    const cmOf = () => (window.app && window.app.cm) || null;

    function edit(fn) {
        const cm = cmOf();
        if (!cm) return;
        cm.operation(() => fn(cm));
        cm.focus();
    }

    // Wrap the selection in `before`/`after`, or unwrap if it's already
    // wrapped. With no selection, drops the pair in and parks the cursor
    // between them so you can just start typing.
    function wrapSelection(before, after = before, placeholder = '') {
        edit(cm => {
            const sel = cm.getSelection();
            if (sel) {
                if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
                    cm.replaceSelection(sel.slice(before.length, sel.length - after.length), 'around');
                } else {
                    cm.replaceSelection(before + sel + after, 'around');
                }
                return;
            }
            const cursor = cm.getCursor();
            cm.replaceSelection(before + placeholder + after);
            cm.setCursor({ line: cursor.line, ch: cursor.ch + before.length + placeholder.length });
        });
    }

    // Add (or strip, if every line already has it) a line prefix across the
    // selected lines. `numbered` renumbers instead of repeating the prefix.
    function prefixLines(prefix, { numbered = false } = {}) {
        edit(cm => {
            const from = cm.getCursor('from'), to = cm.getCursor('to');
            const first = from.line, last = to.line;
            const lines = [];
            for (let i = first; i <= last; i++) lines.push(cm.getLine(i));

            const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const stripRe = numbered ? /^\s*\d+\.\s+/ : new RegExp(`^\\s*${esc}`);
            const allPrefixed = lines.every(l => !l.trim() || stripRe.test(l));

            const out = lines.map((l, i) => {
                if (!l.trim()) return l;
                if (allPrefixed) return l.replace(stripRe, '');
                return (numbered ? `${i + 1}. ` : prefix) + l;
            });

            cm.replaceRange(out.join('\n'),
                { line: first, ch: 0 },
                { line: last, ch: cm.getLine(last).length });
        });
    }

    // Insert a standalone block, padded with blank lines, starting on a
    // fresh line — what you want for tables, code fences and rules.
    function insertBlock(text) {
        edit(cm => {
            const cur = cm.getCursor();
            const line = cm.getLine(cur.line) || '';
            const lead = line.trim() ? '\n\n' : (cur.line > 0 && (cm.getLine(cur.line - 1) || '').trim() ? '\n' : '');
            cm.setCursor({ line: cur.line, ch: line.length });
            cm.replaceSelection(lead + text + '\n');
        });
    }

    function insertTable(rows, cols) {
        const header = '| ' + Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(' | ') + ' |';
        const sep    = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
        const body   = Array.from({ length: rows }, () =>
            '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |').join('\n');
        insertBlock([header, sep, body].join('\n'));
    }

    // Strip the inline HTML this menu writes (and the basic emphasis marks)
    // back out of the selection.
    function clearFormatting() {
        edit(cm => {
            const sel = cm.getSelection();
            if (!sel) return;
            const plain = sel
                .replace(/<\/?(?:span|mark|u|sub|sup|kbd|small)(?:\s[^>]*)?>/gi, '')
                .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
                .replace(/\*\*(.+?)\*\*/g, '$1')
                .replace(/~~(.+?)~~/g, '$1')
                .replace(/\*([^*\n]+)\*/g, '$1')
                .replace(/`([^`\n]+)`/g, '$1');
            cm.replaceSelection(plain, 'around');
        });
    }

    // ── Theme-aware colour palette ──────────────────────────────────────────
    // Swatches are read from the live --ctp-* tokens so they match whichever
    // preset is active, but the *emitted* value is the resolved colour, not
    // var(--ctp-red) -- that keeps the note readable in GitHub, Obsidian and
    // anything else that renders inline HTML.
    const PALETTE = [
        ['red', 'Red'], ['peach', 'Peach'], ['yellow', 'Yellow'], ['green', 'Green'],
        ['teal', 'Teal'], ['sky', 'Sky'], ['blue', 'Blue'], ['lavender', 'Lavender'],
        ['mauve', 'Mauve'], ['pink', 'Pink'], ['flamingo', 'Flamingo'], ['overlay1', 'Muted'],
    ];

    function themeColor(token, fallback) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(`--ctp-${token}`).trim();
        return v || fallback;
    }

    function swatchGrid(onPick) {
        const grid = document.createElement('div');
        grid.className = 'nh-ctx-swatches';
        PALETTE.forEach(([token, name]) => {
            const color = themeColor(token, '#cdd6f4');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'nh-ctx-swatch';
            b.style.background = color;
            b.title = `${name} — ${color}`;
            b.addEventListener('click', () => { closeMenu(); onPick(color); });
            grid.appendChild(b);
        });
        return grid;
    }

    // A native colour well, so "Custom…" doesn't need a modal.
    function customColorRow(onPick) {
        const row = document.createElement('label');
        row.className = 'nh-ctx-item nh-ctx-colorwell';
        row.innerHTML = '<span class="nh-ctx-icon">🎨</span><span class="nh-ctx-label">Custom…</span>';
        const input = document.createElement('input');
        input.type = 'color';
        input.value = themeColor('mauve', '#cba6f7');
        // The panel swallows mousedown to protect the editor selection; the
        // colour well is the one control that needs the click to land.
        input.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            suppressBlurClose = true;
        });
        input.addEventListener('input', () => { closeMenu(); onPick(input.value); });
        row.appendChild(input);
        return row;
    }

    function colorSubmenu(apply) {
        return [
            { type: 'custom', render: () => swatchGrid(apply) },
            { type: 'custom', render: () => customColorRow(apply) },
        ];
    }

    // ── Table size picker ───────────────────────────────────────────────────
    function tablePicker() {
        const MAX_R = 6, MAX_C = 8;
        const wrap = document.createElement('div');
        wrap.className = 'nh-ctx-tablepick';

        const grid = document.createElement('div');
        grid.className = 'nh-ctx-tablegrid';
        grid.style.gridTemplateColumns = `repeat(${MAX_C}, 14px)`;

        const label = document.createElement('div');
        label.className = 'nh-ctx-tablelabel';
        label.textContent = 'Drag to size';

        const cells = [];
        for (let r = 1; r <= MAX_R; r++) {
            for (let c = 1; c <= MAX_C; c++) {
                const cell = document.createElement('div');
                cell.className = 'nh-ctx-tablecell';
                cell.addEventListener('mouseenter', () => {
                    cells.forEach(({ el, r: cr, c: cc }) => el.classList.toggle('on', cr <= r && cc <= c));
                    label.textContent = `${r} × ${c}`;
                });
                cell.addEventListener('click', () => { closeMenu(); insertTable(r, c); });
                cells.push({ el: cell, r, c });
                grid.appendChild(cell);
            }
        }
        wrap.append(grid, label);
        return wrap;
    }

    // ── Menu contents ───────────────────────────────────────────────────────
    function headingSubmenu() {
        return [1, 2, 3, 4, 5, 6].map(n => ({
            icon: `H${n}`,
            label: `Heading ${n}`,
            run: () => prefixLines('#'.repeat(n) + ' '),
        }));
    }

    function insertSubmenu() {
        const enabled = (window.app && window.app.config && window.app.config.plugins &&
                         window.app.config.plugins.enabled) || [];
        const today = new Date();
        return [
            { icon: '▦', label: 'Table', submenu: [{ type: 'custom', render: tablePicker }] },
            { type: 'separator' },
            { icon: '•', label: 'Bullet List',  run: () => prefixLines('- ') },
            { icon: '1.', label: 'Numbered List', run: () => prefixLines('1. ', { numbered: true }) },
            { icon: '☐', label: 'Task List',    run: () => prefixLines('- [ ] ') },
            { type: 'separator' },
            { icon: 'H', label: 'Heading', submenu: headingSubmenu },
            { icon: '❝', label: 'Blockquote',   run: () => prefixLines('> ') },
            { icon: '—', label: 'Horizontal Rule', run: () => insertBlock('---') },
            { type: 'separator' },
            { icon: '{}', label: 'Code Block',  run: () => insertBlock('```\n\n```') },
            { icon: '`',  label: 'Inline Code', run: () => wrapSelection('`', '`', 'code') },
            enabled.includes('math-renderer')
                ? { icon: '∑', label: 'Math Block', run: () => insertBlock('$$\n\n$$') }
                : null,
            { type: 'separator' },
            { icon: '🔗', label: 'Link',  accel: `${MOD}K`, run: () => insertLink() },
            { icon: '🖼', label: 'Image…', run: () => window.app && window.app.insertImageFromFile() },
            { icon: '⁺',  label: 'Footnote', run: () => edit(cm => cm.replaceSelection('[^1]')) },
            { type: 'separator' },
            { icon: '📅', label: `Date (${today.toLocaleDateString()})`,
              run: () => edit(cm => cm.replaceSelection(today.toLocaleDateString())) },
            { icon: '🕒', label: 'Timestamp',
              run: () => edit(cm => cm.replaceSelection(new Date().toLocaleString())) },
        ].filter(Boolean);
    }

    function insertLink() {
        edit(cm => {
            const sel = cm.getSelection();
            const cur = cm.getCursor('from');
            if (sel) {
                // If the selection looks like a URL, it belongs in the target.
                if (/^(https?:\/\/|www\.|mailto:)/i.test(sel.trim())) {
                    cm.replaceSelection(`[](${sel.trim()})`);
                    cm.setCursor({ line: cur.line, ch: cur.ch + 1 });
                } else {
                    cm.replaceSelection(`[${sel}](url)`, 'around');
                }
            } else {
                cm.replaceSelection('[text](url)');
            }
        });
    }

    function formatSubmenu() {
        const applyColor = (color) =>
            wrapSelection(`<span style="color:${color}">`, '</span>', 'text');
        const applyHighlight = (color) =>
            wrapSelection(`<mark style="background-color:${color}">`, '</mark>', 'text');
        const applySize = (size) =>
            wrapSelection(`<span style="font-size:${size}">`, '</span>', 'text');

        return [
            { icon: 'B', label: 'Bold',          accel: `${MOD}B`, run: () => wrapSelection('**', '**', 'bold') },
            { icon: 'I', label: 'Italic',        accel: `${MOD}I`, run: () => wrapSelection('*', '*', 'italic') },
            { icon: 'S', label: 'Strikethrough', run: () => wrapSelection('~~', '~~', 'text') },
            { icon: '`', label: 'Inline Code',   run: () => wrapSelection('`', '`', 'code') },
            { icon: 'U', label: 'Underline',     run: () => wrapSelection('<u>', '</u>', 'text') },
            { type: 'separator' },
            { icon: 'H', label: 'Heading', submenu: headingSubmenu },
            { icon: '🎨', label: 'Text Color', submenu: () => colorSubmenu(applyColor) },
            { icon: '🖍', label: 'Highlight', submenu: () => [
                { icon: '▩', label: 'Default Highlight', run: () => wrapSelection('<mark>', '</mark>', 'text') },
                { type: 'separator' },
                ...colorSubmenu(applyHighlight),
            ] },
            { icon: 'A', label: 'Text Size', submenu: () => [
                { icon: 'ᴀ', label: 'Small',  run: () => applySize('0.85em') },
                { icon: 'A', label: 'Large',  run: () => applySize('1.25em') },
                { icon: 'A', label: 'Huge',   run: () => applySize('1.6em') },
                { type: 'separator' },
                { type: 'header', label: 'Sizes are relative (em), so they' },
                { type: 'header', label: 'still follow your theme font size' },
            ] },
            { type: 'separator' },
            { icon: '⌫', label: 'Clear Formatting', run: clearFormatting },
        ];
    }

    function clipboardItems(params, { paste = true } = {}) {
        const f = params.editFlags || {};
        return [
            paste ? { icon: '↶', label: 'Undo', accel: `${MOD}Z`, disabled: f.canUndo === false, run: () => ipc('undo') } : null,
            paste ? { icon: '↷', label: 'Redo', accel: IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z', disabled: f.canRedo === false, run: () => ipc('redo') } : null,
            paste ? { type: 'separator' } : null,
            paste ? { icon: '✂', label: 'Cut', accel: `${MOD}X`, disabled: f.canCut === false, run: () => ipc('cut') } : null,
            { icon: '⧉', label: 'Copy', accel: `${MOD}C`, disabled: f.canCopy === false, run: () => ipc('copy') },
            paste ? { icon: '📋', label: 'Paste', accel: `${MOD}V`, disabled: f.canPaste === false, run: () => ipc('paste') } : null,
            { type: 'separator' },
            { icon: '⬚', label: 'Select All', accel: `${MOD}A`, run: () => ipc('selectAll') },
        ].filter(Boolean);
    }

    function spellingItems(params) {
        if (!params.misspelledWord) return [];
        const suggestions = (params.dictionarySuggestions || []).slice(0, 5);
        const items = suggestions.length
            ? suggestions.map(s => ({ icon: '✓', label: s, run: () => ipc('replaceMisspelling', s) }))
            : [{ label: 'No suggestions', disabled: true }];
        return [
            { type: 'header', label: `Spelling: ${params.misspelledWord}` },
            ...items,
            { icon: '＋', label: 'Add to Dictionary', run: () => ipc('addToDictionary', params.misspelledWord) },
            { type: 'separator' },
        ];
    }

    // ── Target detection ────────────────────────────────────────────────────
    function contextAt(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el) return { kind: 'other', el: null };
        const at = (sel) => el.closest(sel);

        if (at('.CodeMirror'))      return { kind: 'editor',   el };
        if (at('.preview-content')) return { kind: 'preview',  el };
        if (at('.note-item'))       return { kind: 'note',     el, node: at('.note-item') };
        if (at('.notebook-item'))   return { kind: 'notebook', el, node: at('.notebook-item') };
        if (at('.tab-rail-item'))   return { kind: 'notebook', el, node: at('.tab-rail-item') };
        if (at('input, textarea'))  return { kind: 'input',    el };
        return { kind: 'other', el };
    }

    // Native apps move the caret to the click point on right-click; CodeMirror
    // does not. Without this, "Insert ▸ Table" would land wherever the cursor
    // happened to be, not where you right-clicked.
    function syncEditorCaret(x, y) {
        const cm = cmOf();
        if (!cm) return;
        const pos = cm.coordsChar({ left: x, top: y }, 'window');
        if (!pos) return;
        if (cm.somethingSelected()) {
            const from = cm.getCursor('from'), to = cm.getCursor('to');
            const inside =
                (pos.line > from.line || (pos.line === from.line && pos.ch >= from.ch)) &&
                (pos.line < to.line   || (pos.line === to.line   && pos.ch <= to.ch));
            if (inside) return;   // right-clicking inside a selection keeps it
        }
        cm.setCursor(pos);
    }

    // Sidebar menus are defined in renderer.js (openNoteContextMenu and
    // friends) -- it owns the note/notebook operations and the undo toast, and
    // its item list is richer than anything this file should duplicate. We only
    // supply the position, since the dispatch comes from the main process and
    // there is no DOM event to read clientX/clientY from.
    function synthEvent(x, y) {
        return { clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} };
    }

    // The preview renders code blocks with a per-line number span; a plain
    // copy would drag those numbers along, so pull the text off the source
    // lines instead.
    function codeBlockText(pre) {
        return [...pre.querySelectorAll('.code-line')]
            .map(l => {
                const clone = l.cloneNode(true);
                const ln = clone.querySelector('.code-ln');
                if (ln) ln.remove();
                return clone.textContent;
            })
            .join('\n')
            .trimEnd() || pre.textContent;
    }

    function previewMenu(params) {
        const items = [];
        const el = document.elementFromPoint(params.x, params.y);
        const link = el && el.closest('a[href]');
        const pre = el && el.closest('pre.md-pre');

        if (link) {
            items.push(
                { icon: '🌐', label: 'Open Link in Browser', run: () => ipc('openExternal', link.href) },
                { icon: '🔗', label: 'Copy Link Address', run: () => ipc('writeText', link.href) },
                { type: 'separator' },
            );
        }
        if (params.mediaType === 'image') {
            items.push(
                { icon: '🖼', label: 'Copy Image', run: () => ipc('copyImageAt', { x: params.x, y: params.y }) },
                { type: 'separator' },
            );
        }
        if (pre) {
            items.push(
                { icon: '⧉', label: 'Copy Code Block', run: () => ipc('writeText', codeBlockText(pre)) },
                { type: 'separator' },
            );
        }

        items.push(...clipboardItems(params, { paste: false }));

        if (window.app && window.app.currentNote) {
            items.push(
                { type: 'separator' },
                { icon: '📋', label: 'Copy Markdown Source',
                  run: () => ipc('writeText', window.app.currentNote.content || '') },
                { icon: '✏️', label: 'Edit Mode', accel: `${MOD}1`, run: () => window.app.setViewMode('edit') },
            );
        }
        return items;
    }

    function editorMenu(params) {
        return [
            ...spellingItems(params),
            ...clipboardItems(params),
            { type: 'separator' },
            { icon: '➕', label: 'Insert', submenu: insertSubmenu },
            { icon: '🅰', label: 'Format', submenu: formatSubmenu },
            { type: 'separator' },
            { icon: '👁', label: 'Preview Mode', accel: `${MOD}3`,
              run: () => window.app && window.app.setViewMode('preview') },
        ];
    }

    // ── Entry point ─────────────────────────────────────────────────────────
    function handleContextMenu(_event, params) {
        // Close first: a menu left open from the previous right-click would
        // sit under the pointer and win elementFromPoint().
        closeMenu();

        const ctx = contextAt(params.x, params.y);
        let items;

        switch (ctx.kind) {
            case 'editor':
                syncEditorCaret(params.x, params.y);
                items = editorMenu(params);
                break;
            case 'preview':
                items = previewMenu(params);
                break;
            case 'note': {
                const id = ctx.node.getAttribute('data-note-id');
                const open = ctx.node.hasAttribute('data-trashed')
                    ? 'openTrashedNoteContextMenu'
                    : 'openNoteContextMenu';
                if (window.app && window.app[open]) {
                    window.app[open](synthEvent(params.x, params.y), id);
                    return;   // renderer.js calls back into showMenu() for us
                }
                items = clipboardItems(params, { paste: false });
                break;
            }
            case 'notebook': {
                const id = ctx.node.getAttribute('data-notebook-id');
                if (window.app && window.app.openNotebookContextMenu) {
                    window.app.openNotebookContextMenu(synthEvent(params.x, params.y), id);
                    return;
                }
                items = clipboardItems(params, { paste: false });
                break;
            }
            case 'input':
                items = clipboardItems(params);
                break;
            default:
                // Anywhere else still gets the note-level basics rather than
                // nothing at all.
                items = [
                    { icon: '📝', label: 'New Note', accel: `${MOD}N`,
                      disabled: !(window.app && window.app.data.notebooks.length),
                      run: () => window.app.createNewNote() },
                    { icon: '📓', label: 'New Notebook', run: () => window.app.createNewNotebook() },
                    { type: 'separator' },
                    { icon: '⌘', label: 'Command Palette', accel: IS_MAC ? '⇧⌘P' : 'Ctrl+Shift+P',
                      run: () => window.app.toggleCommandPalette() },
                ];
        }

        showMenu(items, params.x, params.y);
    }

    if (window.electron && window.electron.onContextMenuParams) {
        window.electron.onContextMenuParams(handleContextMenu);
    }

    // Exposed so plugins and the command palette can reuse the menu and the
    // markdown helpers.
    window.NHContextMenu = { show: showMenu, close: closeMenu };
    window.NHEdit = { wrapSelection, prefixLines, insertBlock, insertTable, clearFormatting, insertLink };
})();
