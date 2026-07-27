// Escapes text rendered into innerHTML as plain content (note titles/previews,
// notebook names, tags). Note/notebook content can come from imported files
// (importMarkdown/importPdf/importOnenote), not just what the user typed
// directly, and window.electron/window.electronAPI exposes privileged
// operations (e.g. execShell) to the renderer — unescaped HTML here is a path
// to executing arbitrary commands, not just cosmetic markup injection.
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Markdown Parser — full featured with tables, code blocks, line numbers
function parseMarkdown(text) {
    if (!text) return '';

    // 1. Extract and protect fenced code blocks FIRST (before any escaping)
    const codeBlocks = [];
    text = text.replace(/```([\w-]*)[ \t]*\r?\n([\s\S]*?)```/g, (_, lang, code) => {
        const i   = codeBlocks.length;
        const esc = code.trimEnd()
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        // Add line numbers to code block
        const lines = esc.split('\n');
        const numbered = lines.map((l, n) =>
            `<span class="code-line"><span class="code-ln">${n+1}</span>${l}</span>`
        ).join('\n');
        codeBlocks.push(
            `<pre class="md-pre" data-lang="${lang||''}">`+
            `<div class="code-lang-badge">${lang||'text'}</div>`+
            `<code class="language-${lang||''}">${numbered}</code></pre>`
        );
        return `\x00CODE${i}\x00`;
    });

    // 2. Protect inline code (backtick)
    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
        const i = inlineCodes.length;
        inlineCodes.push(`<code class="md-code">${code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>`);
        return `\x00INLINE${i}\x00`;
    });

    // 3. Escape HTML in the rest of the text
    text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // 4. Headers
    text = text.replace(/^######[ \t](.*)$/gm, '<h6>$1</h6>');
    text = text.replace(/^#####[ \t](.*)$/gm,  '<h5>$1</h5>');
    text = text.replace(/^####[ \t](.*)$/gm,   '<h4>$1</h4>');
    text = text.replace(/^###[ \t](.*)$/gm,    '<h3>$1</h3>');
    text = text.replace(/^##[ \t](.*)$/gm,     '<h2>$1</h2>');
    text = text.replace(/^#[ \t](.*)$/gm,      '<h1>$1</h1>');

    // 5. Tables
    text = text.replace(/((?:^\|.+\|[ \t]*\r?\n)+)/gm, (block) => {
        const rawLines = block.trim().split('\n').filter(l => l.trim());
        if (rawLines.length < 2) return block;
        const isSep = l => /^[\|\s\-:]+$/.test(l.trim());
        const sepIdx = rawLines.findIndex(isSep);
        if (sepIdx < 1) return block;
        const parseRow = l =>
            l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c => c.trim());
        const headers = parseRow(rawLines[0]);
        const aligns  = parseRow(rawLines[sepIdx]).map(c =>
            /^:-+:$/.test(c) ? 'center' : /:-+$/.test(c) ? 'right' : 'left');
        const rows = rawLines.slice(sepIdx + 1).map(parseRow);
        let t = '<table class="md-table"><thead><tr>';
        headers.forEach((h,i) => t += `<th style="text-align:${aligns[i]||'left'}">${h}</th>`);
        t += '</tr></thead><tbody>';
        rows.forEach(row => {
            t += '<tr>';
            row.forEach((c,i) => t += `<td style="text-align:${aligns[i]||'left'}">${c}</td>`);
            t += '</tr>';
        });
        return t + '</tbody></table>';
    });

    // 6. Blockquotes
    text = text.replace(/^&gt;[ \t](.*)$/gm, '<blockquote>$1</blockquote>');

    // 7. Horizontal rules
    text = text.replace(/^[ \t]*(---+|\*\*\*+|___+)[ \t]*$/gm, '<hr>');

    // 8. Inline formatting
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g,          '<strong>$1</strong>');
    text = text.replace(/\*([^*\n]+)\*/g,      '<em>$1</em>');
    text = text.replace(/_([^_\n]+)_/g,        '<em>$1</em>');
    text = text.replace(/~~(.+?)~~/g,          '<del>$1</del>');

    // 9. Images (before links)
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        '<img src="$2" alt="$1" class="md-img">');

    // 10. Links
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 11. Task lists (before regular lists)
    text = text.replace(/^[ \t]*- \[x\][ \t](.*)$/gim,
        '<li class="task done"><span class="cb">☑</span> $1</li>');
    text = text.replace(/^[ \t]*- \[ \][ \t](.*)$/gim,
        '<li class="task open"><span class="cb">☐</span> $1</li>');

    // 12. Lists
    text = text.replace(/^[ \t]*[-*+][ \t](.*)$/gm, '<li>$1</li>');
    text = text.replace(/^[ \t]*\d+\.[ \t](.*)$/gm, '<li class="ol">$1</li>');
    text = text.replace(/(<li class="ol">[\s\S]*?<\/li>)\s*(?=<li class="ol">|$)/g, '$1');
    text = text.replace(/((?:<li class="ol">.*?<\/li>\s*)+)/gs, '<ol>$1</ol>');
    text = text.replace(/((?:<li(?! class="ol")[^>]*>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>');

    // 13. Paragraph wrapping (line-by-line state machine)
    const BLOCK_RE = /^(<h[1-6][\s>]|<ul|<ol|<li|<pre|<blockquote|<hr|<table|<tbody|<thead|<tr|<div|\x00CODE)/i;
    const lines = text.split('\n');
    const out   = [];
    let   buf   = [];
    const flush = () => { if (buf.length) { out.push('<p>' + buf.join(' ') + '</p>'); buf = []; } };
    for (const line of lines) {
        const t = line.trim();
        if (!t)              { flush(); }
        else if (BLOCK_RE.test(t)) { flush(); out.push(line); }
        else                 { buf.push(line); }
    }
    flush();
    text = out.join('\n');

    // 14. Restore inline codes first, then block codes
    inlineCodes.forEach((v, i) => { text = text.split(`\x00INLINE${i}\x00`).join(v); });
    codeBlocks.forEach((v,  i) => { text = text.split(`\x00CODE${i}\x00`).join(v); });

    return text;
}

function escHtmlMd(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


// Main Application
class NoteHubApp {
    constructor() {
        this.config = null;
        this.data = {
            notebooks: [],
            notes: []
        };
        this.currentNotebook = null;
        this.currentNote = null;
        this.viewMode = 'split';
        this.plugins = [];
        this.autoSaveTimer = null;
        
        this.init();
    }
    
    async init() {
        // Store original renderEditor so plugins can reset it on reload
        this._origRenderEditor = this.renderEditor.bind(this);

        // Load config and data
        await this.loadConfig();
        await this.loadData();
        // Expose globally before plugins load
        window.app = this;
        window.notehubConfig = this.config;
        await this.loadPlugins();
        
        // Apply theme from config
        this.applyTheme();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Initial render
        this.render();
        
        // Set up auto-save
        this.setupAutoSave();
        
        // Show welcome if no notes
        if (this.data.notes.length === 0) {
            this.showWelcome();
        }
    }
    
    async loadConfig() {
        this.config = await window.electron.getConfig();
        if (this.config) {
            this.viewMode = this.config.editor.defaultView || 'split';
        }
    }
    
    async loadData() {
        const data = await window.electron.getData();
        if (data) {
            this.data = data;
        }

        // Ensure we have default notebook
        if (this.data.notebooks.length === 0) {
            this.data.notebooks.push({
                id: 'default',
                name: 'General',
                icon: '📝',
                created: new Date().toISOString()
            });
            await this.saveData();
        }

        this.data.notebooks = this.data.notebooks.map((nb, i) => withNotebookDefaults(nb, i));
    }
    
    async loadPlugins() {
        const plugins = await window.electron.getPlugins();
        this.plugins = plugins;
        
        // Load enabled plugins
        if (this.config && this.config.plugins.enabled) {
            for (const pluginId of this.config.plugins.enabled) {
                await this.loadPlugin(pluginId);
            }
        }
    }
    
    async loadPlugin(pluginId) {
        const result = await window.electron.loadPlugin(pluginId);
        if (result.success) {
            try {
                // Expose config globally so plugins can access it
                window.notehubConfig = this.config;
                window.app = this;   // also expose as window.app for plugins
                const plugin = new Function('app', result.code);
                plugin(this);
            } catch (error) {
                console.error(`Error loading plugin ${pluginId}:`, error);
            }
        }
    }
    
    applyTheme() {
        if (!this.config || !this.config.theme) return;
        
        const root = document.documentElement;
        const theme = this.config.theme;
        
        if (theme.accentColor) {
            root.style.setProperty('--accent-primary', theme.accentColor);
        }
        if (theme.fontFamily) {
            root.style.setProperty('--font-family', theme.fontFamily);
        }
        if (theme.fontSize) {
            root.style.setProperty('--font-size', theme.fontSize + 'px');
        }
    }
    
    setupEventListeners() {
        // Sidebar buttons
        document.getElementById('btnNewNote').addEventListener('click', () => this.createNewNote());
        document.getElementById('btnNewNotebook').addEventListener('click', () => this.createNewNotebook());
        document.getElementById('searchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));
        document.getElementById('btnSettings').addEventListener('click', () => this.showSettings());
        
        // Menu listeners
        window.electron.onMenuNewNote(() => this.createNewNote());
        window.electron.onMenuNewNotebook(() => this.createNewNotebook());
        window.electron.onMenuExportNote(() => this.exportCurrentNote());
        window.electron.onMenuImportMarkdown(() => this.importMarkdown());
        window.electron.onMenuViewMode((event, mode) => this.setViewMode(mode));
        window.electron.onReloadConfig(() => this.reloadConfig());

        // Help menu
        if (window.electron.onShowHelp) {
            window.electron.onShowHelp((event, section) => this.showHelpModal(section));
        }

        // Command Palette — Cmd+Shift+P / Ctrl+Shift+P
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'P') {
                e.preventDefault();
                this.toggleCommandPalette();
            }
            // Close palette on Escape
            if (e.key === 'Escape') {
                const pal = document.getElementById('cmdPalette');
                if (pal && pal.classList.contains('open')) {
                    this.closeCommandPalette();
                }
            }
        });
        
        // Live apply from preferences window (no full restart)
        if (window.electron.onApplyConfigLive) {
            window.electron.onApplyConfigLive((event, newConfig) => {
                this.applyConfigLive(newConfig);
            });
        }
        
        // Click outside modal
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') {
                this.closeModal();
            }
        });
    }
    
    setupAutoSave() {
        if (this.config && this.config.editor.autoSave) {
            const interval = this.config.editor.autoSaveInterval || 2000;
            this.autoSaveTimer = setInterval(() => {
                this.saveCurrentNote();
            }, interval);
        }
    }
    
    async saveData() {
        await window.electron.saveData(this.data);
    }
    
    async saveConfig() {
        await window.electron.saveConfig(this.config);
    }
    
    async reloadConfig() {
        await this.loadConfig();
        this.applyTheme();
        this.render();
    }

    // Apply config changes live without restarting
    async applyConfigLive(newConfig) {
        const prevConfig = this.config;
        this.config = newConfig;

        // 1. Apply CSS theme vars immediately
        this.applyTheme();

        // 2. Apply font changes to document root
        const t = newConfig.theme || {};
        if (t.fontFamily)  document.body.style.fontFamily = t.fontFamily;
        if (t.fontSize)    document.body.style.fontSize   = t.fontSize + 'px';

        // 3. Apply sidebar width
        if (newConfig.ui && newConfig.ui.sidebarWidth) {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) sidebar.style.width = newConfig.ui.sidebarWidth + 'px';
        }

        // 4. Check if plugins changed — need full reload
        const prevEnabled = JSON.stringify(((prevConfig || {}).plugins || {}).enabled || []);
        const nextEnabled = JSON.stringify((newConfig.plugins || {}).enabled || []);
        if (prevEnabled !== nextEnabled) {
            console.log('[NoteHub] Plugin list changed, reloading plugins...');
            this.plugins = [];
            // Reset any patched methods before reloading
            if (this._origRenderEditor) this.renderEditor = this._origRenderEditor;
            await this.loadPlugins();
        }

        // 5. Re-render — use window.app.renderEditor() so patched versions (nvim) are called
        window.notehubConfig = newConfig;
        (window.app || this).renderEditor();

        // 6. Update auto-save interval if changed
        if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
        this.setupAutoSave();

        console.log('[NoteHub] Config applied live.');
    }
    
    // Notebook Management
    createNewNotebook() {
        const emojis = ['📓','📔','📒','📕','📗','📘','📙','🗒️','📁','🗂️',
                        '💼','🏠','🎓','💡','🔬','🎨','🎵','✈️','🌍','⭐',
                        '🔥','💎','🚀','🎯','📊','💻','🔐','📝','🌿','❤️'];
        const emojiGrid = emojis.map(e =>
            `<button type="button" class="emoji-pick-btn" onclick="
                document.querySelectorAll('.emoji-pick-btn').forEach(b=>b.classList.remove('sel'));
                this.classList.add('sel');
                document.getElementById('notebookIconVal').value=this.textContent;
            " title="${e}">${e}</button>`
        ).join('');

        this.showModal('Create New Notebook', `
            <div class="form-group">
                <label class="form-label">Notebook Name</label>
                <input type="text" class="form-input" id="notebookName"
                    placeholder="e.g. Work, Personal, Projects…"
                    autofocus
                    onkeydown="if(event.key==='Enter')app.handleCreateNotebook()">
            </div>
            <div class="form-group">
                <label class="form-label">Icon</label>
                <div class="emoji-grid">${emojiGrid}</div>
                <input type="hidden" id="notebookIconVal" value="📓">
            </div>
        `, [
            { label: 'Cancel', class: 'btn-secondary', onClick: () => this.closeModal() },
            { label: 'Create Notebook', class: 'btn-primary', onClick: () => this.handleCreateNotebook() }
        ]);

        // Select first emoji by default
        setTimeout(() => {
            const first = document.querySelector('.emoji-pick-btn');
            if (first) first.classList.add('sel');
            document.getElementById('notebookName').focus();
        }, 50);
    }
    
    async handleCreateNotebook() {
        const name = document.getElementById('notebookName').value.trim();
        const icon = (document.getElementById('notebookIconVal') || document.getElementById('notebookIcon') || {value:'📓'}).value || '📓';
        
        if (!name) return;
        
        const notebook = {
            id: Date.now().toString(),
            name,
            icon,
            color: nextNotebookColor(this.data.notebooks),
            created: new Date().toISOString()
        };
        
        this.data.notebooks.push(notebook);
        await this.saveData();
        this.closeModal();
        this.render();
    }
    
    selectNotebook(notebookId) {
        this.currentNotebook = this.data.notebooks.find(n => n.id === notebookId);
        this.currentNote = null;
        this.render();
    }
    
    // Note Management
    createNewNote() {
        const notebookId = this.currentNotebook ? this.currentNotebook.id : this.data.notebooks[0].id;
        
        const note = {
            id: Date.now().toString(),
            title: 'Untitled Note',
            content: '',
            notebookId,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            tags: []
        };
        
        this.data.notes.unshift(note);
        this.currentNote = note;
        this.saveData();
        this.render();
        
        // Focus on title input
        setTimeout(() => {
            const titleInput = document.getElementById('editorTitle');
            if (titleInput) {
                titleInput.select();
            }
        }, 100);
    }
    
    selectNote(noteId) {
        this.currentNote = this.data.notes.find(n => n.id === noteId);
        this.render();
    }
    
    async saveCurrentNote() {
        if (!this.currentNote) return;
        
        const titleInput = document.getElementById('editorTitle');
        const contentInput = document.getElementById('editorContent');
        
        if (titleInput && contentInput) {
            this.currentNote.title = titleInput.value || 'Untitled Note';
            this.currentNote.content = contentInput.value;
            this.currentNote.updated = new Date().toISOString();
            
            await this.saveData();
            this.updateStatusBar();
            this.renderNotesList();
        }
    }
    
    async deleteCurrentNote() {
        if (!this.currentNote) return;
        
        const confirmed = confirm(`Are you sure you want to delete "${this.currentNote.title}"?`);
        if (!confirmed) return;
        
        this.data.notes = this.data.notes.filter(n => n.id !== this.currentNote.id);
        this.currentNote = null;
        await this.saveData();
        this.render();
    }
    
    async exportCurrentNote() {
        if (!this.currentNote) return;
        await window.electron.exportNote(this.currentNote);
    }
    
    async importMarkdown() {
        const result = await window.electron.importMarkdown();
        if (result.success && result.files) {
            const notebookId = this.currentNotebook ? this.currentNotebook.id : this.data.notebooks[0].id;
            
            for (const file of result.files) {
                const note = {
                    id: Date.now().toString() + Math.random(),
                    title: file.fileName,
                    content: file.content,
                    notebookId,
                    created: new Date().toISOString(),
                    updated: new Date().toISOString(),
                    tags: []
                };
                this.data.notes.unshift(note);
            }
            
            await this.saveData();
            this.render();
        }
    }
    
    // View Management
    setViewMode(mode) {
        this.viewMode = mode;
        this.renderEditor();
    }
    
    handleSearch(query) {
        const searchTerm = query.toLowerCase().trim();
        const notesList = document.getElementById('notesList');
        
        const notes = this.getFilteredNotes();
        const filtered = searchTerm 
            ? notes.filter(note => 
                note.title.toLowerCase().includes(searchTerm) ||
                note.content.toLowerCase().includes(searchTerm)
            )
            : notes;
        
        this.renderNotesListWithData(filtered);
    }
    
    getFilteredNotes() {
        if (this.currentNotebook) {
            return this.data.notes.filter(n => n.notebookId === this.currentNotebook.id);
        }
        return this.data.notes;
    }
    
    updatePreview() {
        const preview = document.getElementById('preview');
        const content = document.getElementById('editorContent');
        
        if (preview && content) {
            preview.innerHTML = parseMarkdown(content.value);
        }
    }
    
    updateStatusBar() {
        const notebookElem = document.getElementById('statusNotebook');
        const wordCountElem = document.getElementById('statusWordCount');
        const lastSavedElem = document.getElementById('statusLastSaved');
        
        if (this.currentNote) {
            const notebook = this.data.notebooks.find(n => n.id === this.currentNote.notebookId);
            if (notebookElem && notebook) {
                notebookElem.textContent = `${notebook.icon} ${notebook.name}`;
            }
            
            if (wordCountElem) {
                const wordCount = this.currentNote.content.split(/\s+/).filter(w => w.length > 0).length;
                wordCountElem.textContent = `${wordCount} words`;
            }
            
            if (lastSavedElem) {
                lastSavedElem.textContent = 'Saved';
                setTimeout(() => {
                    lastSavedElem.textContent = '';
                }, 2000);
            }
        }
    }
    
    // Rendering
    render() {
        this.renderTabRail();
        this.renderNotebooksList();
        this.renderNotesList();
        this.renderEditor();
        this.updateStatusBar();
    }
    
    goHome() {
        this.currentNotebook = null;
        this.currentNote = null;
        this.render();
    }

    renderTabRail() {
        const container = document.getElementById('tabRail');
        const items = this.data.notebooks.map(nb => {
            const isActive = this.currentNotebook && this.currentNotebook.id === nb.id;
            const glow = isActive ? `, 0 0 18px ${nb.color}88` : '';
            return `<div class="tab-rail-item ${isActive ? 'active' : ''}"
                         style="background: linear-gradient(160deg, ${nb.color}, ${nb.color}cc); box-shadow: 2px 3px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.3)${glow};"
                         onclick="app.selectNotebook('${nb.id}')" title="${escapeHtml(nb.name)}"></div>`;
        }).join('');
        container.innerHTML = `<div class="tab-rail-home" onclick="app.goHome()" title="Home">⌂</div>${items}`;
    }

    notebookActivityBars(notebookId) {
        const days = 7;
        const counts = new Array(days).fill(0);
        const now = Date.now();
        this.data.notes
            .filter(n => n.notebookId === notebookId)
            .forEach(n => {
                const daysAgo = Math.floor((now - new Date(n.updated).getTime()) / 86400000);
                if (daysAgo >= 0 && daysAgo < days) counts[days - 1 - daysAgo]++;
            });
        return counts;
    }

    renderHomeView() {
        const container = document.getElementById('homeView');
        const cards = this.data.notebooks.map((nb, i) => {
            const noteCount = this.data.notes.filter(n => n.notebookId === nb.id).length;
            const bars = this.notebookActivityBars(nb.id);
            const maxBar = Math.max(1, ...bars);
            const barsHtml = bars.map(v => `<div style="height:${Math.max(8, (v / maxBar) * 100)}%"></div>`).join('');
            return `
                <div class="bento-card ${i === 0 ? 'featured' : ''}" onclick="app.selectNotebook('${nb.id}')"
                     style="background: linear-gradient(160deg, ${nb.color}33, rgba(255,255,255,.03));">
                    <div>
                        <div class="bento-card-name">${escapeHtml(nb.name)}</div>
                        <div class="bento-card-meta">${noteCount} note${noteCount === 1 ? '' : 's'}</div>
                    </div>
                    ${i === 0 ? `<div><div class="home-eyebrow" style="font-size:9px; margin-bottom:6px;">Activity</div><div class="bento-activity">${barsHtml}</div></div>` : ''}
                </div>`;
        }).join('');

        container.innerHTML = `
            <div class="home-eyebrow">◆ Notebooks</div>
            <div class="bento-grid">
                ${cards}
                <div class="bento-card bento-new-card" onclick="app.createNewNotebook()">+ New Notebook</div>
            </div>`;
    }

    renderNotebooksList() {
        const container = document.getElementById('notebooksList');
        
        container.innerHTML = this.data.notebooks.map(notebook => {
            const noteCount = this.data.notes.filter(n => n.notebookId === notebook.id).length;
            const isActive = this.currentNotebook && this.currentNotebook.id === notebook.id;
            
            return `
                <div class="notebook-item ${isActive ? 'active' : ''}" onclick="app.selectNotebook('${notebook.id}')">
                    <span class="notebook-icon">${escapeHtml(notebook.icon)}</span>
                    <span class="notebook-name">${escapeHtml(notebook.name)}</span>
                    <span class="notebook-count">${noteCount}</span>
                </div>
            `;
        }).join('');
    }
    
    renderNotesList() {
        const notes = this.getFilteredNotes();
        this.renderNotesListWithData(notes);
        
        const headerTitle = document.getElementById('notesHeaderTitle');
        const notesCount = document.getElementById('notesCount');
        
        if (headerTitle) {
            headerTitle.textContent = this.currentNotebook ? this.currentNotebook.name : 'All Notes';
        }
        if (notesCount) {
            notesCount.textContent = notes.length.toString();
        }
    }
    
    renderNotesListWithData(notes) {
        const container = document.getElementById('notesList');
        
        if (notes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <div class="empty-state-text">No notes yet</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = notes.map(note => {
            const preview = escapeHtml(note.content.substring(0, 150).replace(/[#*`[\]]/g, ''));
            const date = new Date(note.updated).toLocaleDateString();
            const isActive = this.currentNote && this.currentNote.id === note.id;

            return `
                <div class="note-item ${isActive ? 'active' : ''}" onclick="app.selectNote('${note.id}')">
                    <div class="note-item-header">
                        <div class="note-item-title">${escapeHtml(note.title)}</div>
                    </div>
                    <div class="note-item-preview">${preview || 'Empty note'}</div>
                    <div class="note-item-footer">
                        <div class="note-item-date">
                            <svg width="12" height="12" viewBox="0 0 16 16" style="opacity: 0.6;">
                                <path fill="currentColor" d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
                                <path fill="currentColor" d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
                            </svg>
                            ${date}
                        </div>
                        ${note.tags.length > 0 ? `
                            <div class="note-item-tags">
                                ${note.tags.map(tag => `<span class="note-tag">${escapeHtml(tag)}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    renderEditor() {
        const container = document.getElementById('editorContainer');
        const welcomeScreen = document.getElementById('welcomeScreen');
        const homeView = document.getElementById('homeView');

        if (!this.currentNotebook) {
            homeView.classList.add('visible');
            welcomeScreen.style.display = 'none';
            const existingEditor = container.querySelector('.editor-wrapper');
            if (existingEditor) existingEditor.remove();
            this.renderHomeView();
            return;
        }
        homeView.classList.remove('visible');

        if (!this.currentNote) {
            welcomeScreen.style.display = 'flex';
            const existingEditor = container.querySelector('.editor-wrapper');
            if (existingEditor) {
                existingEditor.remove();
            }
            return;
        }
        
        welcomeScreen.style.display = 'none';
        
        const existingEditor = container.querySelector('.editor-wrapper');
        if (existingEditor) {
            existingEditor.remove();
        }
        
        // Build plugin toolbar buttons from registered plugin actions
        const pluginToolbarBtns = (this._pluginToolbarActions || []).map(action => `
            <button class="btn-icon plugin-toolbar-btn" 
                onclick="app._pluginToolbarActions.find(a=>a.id==='${action.id}')?.onClick()"
                title="${action.label}">
                ${action.icon || '🔌'}
            </button>
        `).join('');

        // Build enabled plugins list for dropdown
        const enabledPlugins = (this.config && this.config.plugins && this.config.plugins.enabled) || [];
        const pluginMenuItems = enabledPlugins.length > 0
            ? enabledPlugins.map(id => {
                const meta = {
                    'math-renderer':    { icon: '📐', label: 'Math Renderer',   desc: 'Insert LaTeX math' },
                    'terminal':         { icon: '💻', label: 'Terminal',         desc: 'Toggle terminal (Ctrl+`)' },
                    'advanced-search':  { icon: '🔍', label: 'Advanced Search',  desc: 'Search all notes' },
                    'docx-converter':   { icon: '📄', label: 'DOCX Converter',   desc: 'Import Word document' },
                    'excel-integration':{ icon: '📊', label: 'Excel Integration',desc: 'Import spreadsheet' },
                    'neovim-editor':    { icon: '🖥️', label: 'Neovim Editor',    desc: 'Vim-powered editor' },
                }[id] || { icon: '🧩', label: id, desc: '' };
                return `
                    <div class="plugin-menu-item" onclick="app.activatePlugin('${id}'); document.getElementById('pluginMenuDropdown').style.display='none'">
                        <span class="plugin-menu-icon">${meta.icon}</span>
                        <div class="plugin-menu-text">
                            <span class="plugin-menu-label">${meta.label}</span>
                            <span class="plugin-menu-desc">${meta.desc}</span>
                        </div>
                    </div>`;
              }).join('')
            : '<div style="padding:12px 16px;color:#6c7086;font-size:12px">No plugins enabled.<br>Enable them in Preferences → Plugins.</div>';

        const editorHTML = `
            <div class="editor-wrapper" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
                <div class="editor-toolbar">
                    <input 
                        type="text" 
                        class="editor-title-input" 
                        id="editorTitle"
                        value="${this.currentNote.title}"
                        placeholder="Note title..."
                    >
                    <div class="editor-toolbar-actions">
                        ${pluginToolbarBtns}
                        <div class="plugin-menu-wrap" id="pluginMenuWrap">
                            <button class="btn-icon" id="pluginMenuBtn"
                                onclick="app.togglePluginMenu()"
                                title="Plugins (${enabledPlugins.length} enabled)"
                                style="position:relative">
                                🔌
                                ${enabledPlugins.length > 0 ? `<span style="position:absolute;top:-2px;right:-2px;background:var(--ctp-mauve);color:#1e1e2e;border-radius:50%;width:14px;height:14px;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center">${enabledPlugins.length}</span>` : ''}
                            </button>
                            <div id="pluginMenuDropdown" style="display:none;position:absolute;top:100%;right:0;background:#181825;border:1px solid #313244;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:220px;z-index:9999;overflow:hidden">
                                <div style="padding:8px 12px 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6c7086;border-bottom:1px solid #313244">
                                    Installed Plugins
                                </div>
                                ${pluginMenuItems}
                            </div>
                        </div>
                        <div style="width:1px;height:20px;background:#313244;margin:0 4px"></div>
                        <div class="view-mode-toggle">
                            <button class="view-mode-btn ${this.viewMode === 'edit' ? 'active' : ''}" onclick="app.setViewMode('edit')">Edit</button>
                            <button class="view-mode-btn ${this.viewMode === 'split' ? 'active' : ''}" onclick="app.setViewMode('split')">Split</button>
                            <button class="view-mode-btn ${this.viewMode === 'preview' ? 'active' : ''}" onclick="app.setViewMode('preview')">Preview</button>
                        </div>
                        <button class="btn-icon" onclick="app.insertImageFromFile()" title="Insert image (or paste/drag an image)">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <path fill="currentColor" d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                                <path fill="currentColor" d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="app.exportCurrentNote()" title="Export">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <path fill="currentColor" d="M8.5 1a.5.5 0 0 0-1 0v8.793L5.354 7.646a.5.5 0 1 0-.708.708l3 3a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 9.793V1z"/>
                                <path fill="currentColor" d="M3 12.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="app.deleteCurrentNote()" title="Delete">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <path fill="currentColor" d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                                <path fill="currentColor" fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="editor-body">
                    <div class="editor-pane ${this.viewMode === 'preview' ? 'hidden' : ''}">
                        <div class="lined-editor-wrap" id="linedEditorWrap">
                            <div class="line-numbers" id="lineNumbers"></div>
                            <textarea
                                class="markdown-textarea"
                                id="editorContent"
                                placeholder="Start writing in Markdown..."
                                spellcheck="${this.config && this.config.editor && this.config.editor.spellCheck ? 'true' : 'false'}"
                                wrap="${this.config && this.config.editor && this.config.editor.wordWrap ? 'soft' : 'off'}"
                            >${this.currentNote.content}</textarea>
                        </div>
                    </div>
                    <div class="preview-pane ${this.viewMode === 'edit' ? 'hidden' : ''}">
                        <div class="preview-content" id="preview">
                            ${parseMarkdown(this.currentNote.content)}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.insertAdjacentHTML('beforeend', editorHTML);
        
        // Add event listeners
        const titleInput = document.getElementById('editorTitle');
        const contentInput = document.getElementById('editorContent');
        
        if (titleInput) {
            titleInput.addEventListener('input', () => {
                this.currentNote.title = titleInput.value;
            });
        }
        
        // ── Line numbers ──
        const updateLineNumbers = () => {
            const ln = document.getElementById('lineNumbers');
            if (!ln) return;
            const showNums = !(this.config && this.config.editor && this.config.editor.lineNumbers === false);
            if (!showNums) { ln.style.display = 'none'; return; }
            ln.style.display = 'block';
            const lines = (contentInput.value + '\n').split('\n');
            ln.innerHTML = lines.map((_, i) => `<div class="ln">${i + 1}</div>`).join('');
            // Keep scroll in sync
            ln.scrollTop = contentInput.scrollTop;
        };
        setTimeout(updateLineNumbers, 0);

        if (contentInput) {
            contentInput.addEventListener('input', () => {
                this.currentNote.content = contentInput.value;
                this.updatePreview();
                updateLineNumbers();
            });
            contentInput.addEventListener('scroll', () => {
                const ln = document.getElementById('lineNumbers');
                if (ln) ln.scrollTop = contentInput.scrollTop;
            });

            // ── Image paste (Ctrl/Cmd+V with image in clipboard) ──
            contentInput.addEventListener('paste', async (e) => {
                const items = e.clipboardData && e.clipboardData.items;
                if (!items) return;
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        const blob   = item.getAsFile();
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const dataUrl  = ev.target.result;
                            const fileName = `image-${Date.now()}.png`;
                            const markdown = `![${fileName}](${dataUrl})`;
                            const start    = contentInput.selectionStart;
                            const end      = contentInput.selectionEnd;
                            contentInput.value =
                                contentInput.value.slice(0, start) + '\n' + markdown + '\n' +
                                contentInput.value.slice(end);
                            contentInput.selectionStart = contentInput.selectionEnd = start + markdown.length + 2;
                            this.currentNote.content = contentInput.value;
                            this.updatePreview();
                        };
                        reader.readAsDataURL(blob);
                        break;
                    }
                }
            });

            // ── Image drag & drop onto editor ──
            contentInput.addEventListener('dragover', (e) => { e.preventDefault(); contentInput.style.background = 'rgba(203,166,247,.08)'; });
            contentInput.addEventListener('dragleave', () => { contentInput.style.background = ''; });
            contentInput.addEventListener('drop', (e) => {
                e.preventDefault();
                contentInput.style.background = '';
                const files = e.dataTransfer.files;
                for (const file of files) {
                    if (!file.type.startsWith('image/')) continue;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const dataUrl  = ev.target.result;
                        const markdown = `![${file.name}](${dataUrl})`;
                        const pos      = contentInput.selectionStart || contentInput.value.length;
                        contentInput.value = contentInput.value.slice(0, pos) + '\n' + markdown + '\n' + contentInput.value.slice(pos);
                        this.currentNote.content = contentInput.value;
                        this.updatePreview();
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
    }
    
    showWelcome() {
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (!welcomeScreen) return;
        welcomeScreen.style.display = 'flex';

        // Update text based on whether user has existing notes
        const hasNotes = this.data.notes.length > 0;
        const titleEl  = document.getElementById('welcomeTitle');
        const subEl    = document.getElementById('welcomeSubtitle');
        const btnEl    = document.getElementById('welcomeNewNoteBtn');

        if (hasNotes) {
            if (titleEl) titleEl.textContent = 'NoteHub';
            if (subEl)   subEl.textContent = `You have ${this.data.notes.length} note${this.data.notes.length !== 1 ? 's' : ''}. Select one from the sidebar or create a new one.`;
            if (btnEl)   btnEl.textContent = '+ New Note';
        } else {
            if (titleEl) titleEl.textContent = 'Welcome to NoteHub';
            if (subEl)   subEl.textContent = 'Create a new note or select one from the sidebar to get started.';
            if (btnEl)   btnEl.textContent = 'Create Your First Note';
        }
    }

    async insertImageFromFile() {
        const result = await window.electron.importImage();
        if (!result || !result.success) return;
        const markdown = `![${result.name}](${result.dataUrl})`;
        const ta = document.getElementById('editorContent');
        if (ta) {
            const start = ta.selectionStart;
            ta.value = ta.value.slice(0, start) + '\n' + markdown + '\n' + ta.value.slice(ta.selectionEnd);
            ta.selectionStart = ta.selectionEnd = start + markdown.length + 2;
            this.currentNote.content = ta.value;
            this.updatePreview();
        }
    }

    togglePluginMenu() {
        const dd = document.getElementById('pluginMenuDropdown');
        if (!dd) return;
        const isOpen = dd.style.display !== 'none';
        dd.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) {
            // Close when clicking outside
            const close = (e) => {
                if (!e.target.closest('#pluginMenuWrap')) {
                    dd.style.display = 'none';
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
        }
    }

    // Called when user clicks a plugin in the dropdown
    activatePlugin(pluginId) {
        const triggers = {
            'terminal':          () => { const btn = document.querySelector('.terminal-toggle-btn'); if (btn) btn.click(); else window.dispatchEvent(new CustomEvent('notehub:toggle-terminal')); },
            'advanced-search':   () => { window.dispatchEvent(new CustomEvent('notehub:open-search')); const btn = document.querySelector('.advanced-search-btn'); if (btn) btn.click(); },
            'math-renderer':     () => { window.dispatchEvent(new CustomEvent('notehub:math-help')); const btn = document.querySelector('.math-help-btn'); if (btn) btn.click(); },
            'docx-converter':    () => { window.dispatchEvent(new CustomEvent('notehub:import-docx')); const btn = document.querySelector('.docx-import-btn'); if (btn) btn.click(); },
            'excel-integration': () => { window.dispatchEvent(new CustomEvent('notehub:import-excel')); const btn = document.querySelector('.excel-import-btn'); if (btn) btn.click(); },
            'neovim-editor':     () => { window.dispatchEvent(new CustomEvent('notehub:nvim-help')); if (window.__nvimToggleHelp) window.__nvimToggleHelp(); },
        };
        const trigger = triggers[pluginId];
        if (trigger) { trigger(); }
        else { this.showModal('Plugin', `<p style="color:#cdd6f4">The <strong>${pluginId}</strong> plugin is active. Use its toolbar button or keyboard shortcut to interact with it.</p>`, [{ label: 'OK', class: 'btn-primary', onClick: () => this.closeModal() }]); }
    }

    // ── Command Palette ─────────────────────────────────────────────────────
    _buildPaletteCommands() {
        const enabled = (this.config && this.config.plugins && this.config.plugins.enabled) || [];
        const nvimOn  = enabled.includes('neovim-editor');

        const cmds = [
            // ── Notes ──────────────────────────────────────────
            { id: 'new-note',      icon: '📝', label: 'New Note',             category: 'Notes',     kbd: '⌘N',       run: () => this.createNewNote() },
            { id: 'new-notebook',  icon: '📓', label: 'New Notebook',         category: 'Notes',     kbd: '⌘⇧N',      run: () => this.createNewNotebook() },
            { id: 'export-note',   icon: '⬇',  label: 'Export Current Note',  category: 'Notes',     kbd: '⌘E',       run: () => this.exportCurrentNote() },
            { id: 'delete-note',   icon: '🗑',  label: 'Delete Current Note',  category: 'Notes',                      run: () => this.deleteCurrentNote() },

            // ── View ───────────────────────────────────────────
            { id: 'view-edit',     icon: '✏️',  label: 'Editor: Edit Mode',    category: 'View',      kbd: '⌘1',       run: () => this.setViewMode('edit') },
            { id: 'view-split',    icon: '⬛',  label: 'Editor: Split Mode',   category: 'View',      kbd: '⌘2',       run: () => this.setViewMode('split') },
            { id: 'view-preview',  icon: '👁',  label: 'Editor: Preview Mode', category: 'View',      kbd: '⌘3',       run: () => this.setViewMode('preview') },

            // ── Editor mode toggle ─────────────────────────────
            { id: 'toggle-nvim',   icon: nvimOn ? '🔴' : '🟢',
              label: nvimOn ? 'Disable Neovim Mode' : 'Enable Neovim Mode',
              category: 'Editor',   kbd: '⌘⇧V',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                if (nvimOn) {
                    cfg.plugins.enabled = cfg.plugins.enabled.filter(p => p !== 'neovim-editor');
                } else {
                    if (!cfg.plugins.enabled.includes('neovim-editor')) cfg.plugins.enabled.push('neovim-editor');
                }
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },
            { id: 'toggle-wrap',   icon: '↩',  label: 'Toggle Word Wrap',     category: 'Editor',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                cfg.editor.wordWrap = !cfg.editor.wordWrap;
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },
            { id: 'toggle-lnum',   icon: '#',  label: 'Toggle Line Numbers',   category: 'Editor',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                cfg.editor.lineNumbers = !(cfg.editor.lineNumbers !== false);
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },
            { id: 'toggle-spell',  icon: '🔤', label: 'Toggle Spell Check',   category: 'Editor',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                cfg.editor.spellCheck = !cfg.editor.spellCheck;
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },

            // ── Plugins ────────────────────────────────────────
            { id: 'open-terminal',  icon: '💻', label: 'Open Terminal',         category: 'Plugins',   kbd: '⌃`',       run: () => { if (window.nhTermToggle) window.nhTermToggle(); } },
            { id: 'open-search',    icon: '🔍', label: 'Advanced Search',       category: 'Plugins',   kbd: '⌘⇧F',      run: () => window.dispatchEvent(new CustomEvent('notehub:open-search')) },
            { id: 'open-excel',     icon: '📊', label: 'Open Spreadsheet',      category: 'Plugins',   kbd: '⌘⇧X',      run: () => { if (window.xlOpen) window.xlOpen(); } },
            { id: 'insert-image',   icon: '🖼',  label: 'Insert Image',          category: 'Plugins',                     run: () => this.insertImageFromFile() },

            // ── Settings ───────────────────────────────────────
            { id: 'open-prefs',     icon: '⚙️',  label: 'Open Preferences',     category: 'Settings',  kbd: '⌘,',       run: () => window.electron.openPreferences && window.electron.openPreferences() },
            { id: 'help-plugins',   icon: '📖',  label: 'Plugin Guide',          category: 'Help',                        run: () => this.showHelpModal('plugins') },
            { id: 'help-shortcuts', icon: '⌨️',  label: 'Keyboard Shortcuts',   category: 'Help',                        run: () => this.showHelpModal('shortcuts') },
            { id: 'help-about',     icon: '📋',  label: 'About NoteHub',         category: 'Help',                        run: () => this.showHelpModal('about') },
        ];

        // Add registered plugin actions dynamically
        (this._pluginToolbarActions || []).forEach(a => {
            if (!cmds.find(c => c.id === a.id)) {
                cmds.push({ id: a.id, icon: a.icon || '🧩', label: a.label, category: 'Plugins', run: a.onClick });
            }
        });

        return cmds;
    }

    toggleCommandPalette() {
        const existing = document.getElementById('cmdPalette');
        if (existing && existing.classList.contains('open')) {
            this.closeCommandPalette();
        } else {
            this.openCommandPalette();
        }
    }

    openCommandPalette() {
        // Remove stale instance
        const old = document.getElementById('cmdPalette');
        if (old) old.remove();

        const cmds = this._buildPaletteCommands();
        let filtered = cmds;
        let selIdx   = 0;

        const renderList = (list) => {
            const ul = document.getElementById('cmdPaletteList');
            if (!ul) return;
            if (!list.length) {
                ul.innerHTML = '<div class="cmd-empty">No commands found</div>';
                return;
            }
            let lastCat = null;
            ul.innerHTML = list.map((c, i) => {
                let header = '';
                if (c.category !== lastCat) {
                    header = `<div class="cmd-cat">${c.category}</div>`;
                    lastCat = c.category;
                }
                return `${header}<div class="cmd-item ${i === selIdx ? 'sel' : ''}" data-idx="${i}"
                    onmouseenter="this.closest('#cmdPalette').__sel=${i};document.querySelectorAll('.cmd-item').forEach((el,j)=>el.classList.toggle('sel',j===${i}))"
                    onclick="app._runCmdPaletteItem(${i})">
                    <span class="cmd-icon">${c.icon}</span>
                    <span class="cmd-label">${c.label}</span>
                    ${c.kbd ? `<span class="cmd-kbd">${c.kbd}</span>` : ''}
                </div>`;
            }).join('');
            // Scroll selected item into view
            const selEl = ul.querySelector('.cmd-item.sel');
            if (selEl) selEl.scrollIntoView({ block: 'nearest' });
        };

        const pal = document.createElement('div');
        pal.id        = 'cmdPalette';
        pal.className = 'cmd-palette open';
        pal.__cmds    = cmds;
        pal.__sel     = 0;
        pal.innerHTML = `
            <div class="cmd-backdrop" onclick="app.closeCommandPalette()"></div>
            <div class="cmd-box">
                <div class="cmd-search-row">
                    <span class="cmd-search-icon">⌘</span>
                    <input class="cmd-input" id="cmdInput" placeholder="Type a command…" autocomplete="off" spellcheck="false">
                    <span class="cmd-hint">↑↓ navigate · Enter run · Esc close</span>
                </div>
                <div class="cmd-list" id="cmdPaletteList"></div>
            </div>`;
        document.body.appendChild(pal);

        // Store filtered list on element for key handlers
        pal.__filtered = filtered;

        renderList(filtered);

        const input = document.getElementById('cmdInput');
        if (input) {
            input.focus();
            input.addEventListener('input', () => {
                const q = input.value.toLowerCase().trim();
                filtered = q
                    ? cmds.filter(c => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
                    : cmds;
                selIdx = 0;
                pal.__filtered = filtered;
                pal.__sel      = 0;
                renderList(filtered);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selIdx = Math.min(selIdx + 1, filtered.length - 1);
                    pal.__sel = selIdx;
                    renderList(filtered);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selIdx = Math.max(selIdx - 1, 0);
                    pal.__sel = selIdx;
                    renderList(filtered);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this._runCmdPaletteItem(selIdx);
                } else if (e.key === 'Escape') {
                    this.closeCommandPalette();
                }
            });
        }
    }

    _runCmdPaletteItem(idx) {
        const pal = document.getElementById('cmdPalette');
        if (!pal) return;
        const list = pal.__filtered || pal.__cmds || [];
        const cmd  = list[idx || pal.__sel || 0];
        this.closeCommandPalette();
        if (cmd && cmd.run) {
            try { cmd.run(); } catch(e) { console.error('[Palette]', e); }
        }
    }

    closeCommandPalette() {
        const pal = document.getElementById('cmdPalette');
        if (pal) {
            pal.classList.remove('open');
            setTimeout(() => pal.remove(), 150);
        }
    }

    // ── Help Modal ──────────────────────────────────────────────────────────
    showHelpModal(section = 'plugins') {
        const sections = {
            plugins: {
                title: '🔌 Plugin Guide',
                body: `
<div class="help-content">
  <div class="help-tabs">
    <button class="help-tab active" onclick="switchHelpTab('math')">📐 Math</button>
    <button class="help-tab" onclick="switchHelpTab('terminal')">💻 Terminal</button>
    <button class="help-tab" onclick="switchHelpTab('search')">🔍 Search</button>
    <button class="help-tab" onclick="switchHelpTab('docx')">📄 DOCX</button>
    <button class="help-tab" onclick="switchHelpTab('excel')">📊 Excel</button>
    <button class="help-tab" onclick="switchHelpTab('nvim')">🖥️ Neovim</button>
  </div>
  <div id="help-math" class="help-section active">
    <h3>📐 Math Renderer</h3>
    <p>Renders LaTeX math equations using KaTeX directly in the preview pane.</p>
    <h4>How to use</h4>
    <p>Enable in Preferences → Plugins, then use the toolbar <strong>📐</strong> button or click <strong>🔌 Plugins → Math Renderer</strong>.</p>
    <h4>Syntax</h4>
    <table class="help-table"><tr><th>Type</th><th>Syntax</th><th>Example</th></tr>
    <tr><td>Inline math</td><td><code>$...$</code></td><td><code>$x^2 + y^2 = r^2$</code></td></tr>
    <tr><td>Block math</td><td><code>$$...$$</code></td><td><code>$$\int_0^\infty e^{-x}dx$$</code></td></tr>
    </table>
    <h4>Common operators</h4>
    <table class="help-table"><tr><th>LaTeX</th><th>Result</th></tr>
    <tr><td><code>x^{2}</code></td><td>Superscript</td></tr>
    <tr><td><code>x_{i}</code></td><td>Subscript</td></tr>
    <tr><td><code>\frac{a}{b}</code></td><td>Fraction</td></tr>
    <tr><td><code>\sqrt{x}</code></td><td>Square root</td></tr>
    <tr><td><code>\sum_{i=1}^{n}</code></td><td>Summation</td></tr>
    <tr><td><code>\alpha \beta \gamma</code></td><td>Greek letters</td></tr>
    </table>
  </div>
  <div id="help-terminal" class="help-section" style="display:none">
    <h3>💻 Terminal</h3>
    <p>An integrated command-line panel at the bottom of the editor for NoteHub commands.</p>
    <h4>How to open</h4>
    <p>Click <strong>🔌 Plugins → Terminal</strong> or press <kbd>Ctrl+\`</kbd> / <kbd>Cmd+\`</kbd></p>
    <h4>Available commands</h4>
    <table class="help-table"><tr><th>Command</th><th>Description</th></tr>
    <tr><td><code>help</code></td><td>List all commands</td></tr>
    <tr><td><code>notes</code></td><td>List all notes</td></tr>
    <tr><td><code>notebooks</code></td><td>List all notebooks</td></tr>
    <tr><td><code>search &lt;query&gt;</code></td><td>Search notes by text</td></tr>
    <tr><td><code>new &lt;title&gt;</code></td><td>Create a new note</td></tr>
    <tr><td><code>export</code></td><td>Export current note</td></tr>
    <tr><td><code>clear</code></td><td>Clear the terminal</td></tr>
    <tr><td><code>date</code></td><td>Show current date/time</td></tr>
    </table>
    <h4>Tips</h4>
    <p>Use ↑ / ↓ arrow keys to navigate command history.</p>
  </div>
  <div id="help-search" class="help-section" style="display:none">
    <h3>🔍 Advanced Search</h3>
    <p>Full-text search across all notes with filters and highlighted results.</p>
    <h4>How to open</h4>
    <p>Click <strong>🔌 Plugins → Advanced Search</strong> or press <kbd>Ctrl+Shift+F</kbd> / <kbd>Cmd+Shift+F</kbd></p>
    <h4>Filter options</h4>
    <table class="help-table"><tr><th>Filter</th><th>Description</th></tr>
    <tr><td>All Notes</td><td>Search across every notebook</td></tr>
    <tr><td>Current Notebook</td><td>Limit to the open notebook</td></tr>
    <tr><td>Title Only</td><td>Only match note titles</td></tr>
    </table>
    <h4>Tips</h4>
    <p>Click any result to open that note. Results show context around the match.</p>
  </div>
  <div id="help-docx" class="help-section" style="display:none">
    <h3>📄 DOCX Converter</h3>
    <p>Import Microsoft Word documents and convert them to Markdown automatically.</p>
    <h4>How to use</h4>
    <p>Click <strong>🔌 Plugins → DOCX Converter</strong> or the upload toolbar button, then select a .docx file.</p>
    <h4>What gets converted</h4>
    <table class="help-table"><tr><th>Word element</th><th>Markdown output</th></tr>
    <tr><td>Heading 1–6</td><td><code># H1</code> through <code>###### H6</code></td></tr>
    <tr><td>Bold text</td><td><code>**bold**</code></td></tr>
    <tr><td>Italic text</td><td><code>*italic*</code></td></tr>
    <tr><td>Bullet lists</td><td><code>- item</code></td></tr>
    <tr><td>Numbered lists</td><td><code>1. item</code></td></tr>
    <tr><td>Tables</td><td>Markdown table format</td></tr>
    <tr><td>Hyperlinks</td><td><code>[text](url)</code></td></tr>
    <tr><td>Code blocks</td><td>Fenced code blocks</td></tr>
    </table>
  </div>
  <div id="help-excel" class="help-section" style="display:none">
    <h3>📊 Excel Integration</h3>
    <p>Import Excel / CSV spreadsheets as Markdown tables, or create tables from scratch.</p>
    <h4>How to import</h4>
    <p>Click <strong>🔌 Plugins → Excel Integration</strong> or the toolbar button, then select an .xlsx, .xls, or .csv file.</p>
    <h4>Features</h4>
    <table class="help-table"><tr><th>Feature</th><th>Details</th></tr>
    <tr><td>Multi-sheet</td><td>Each sheet becomes an <code>## H2</code> section</td></tr>
    <tr><td>Preview</td><td>Preview table before inserting</td></tr>
    <tr><td>Table creator</td><td>Create blank table with custom rows/cols</td></tr>
    <tr><td>Auto-tags</td><td>Note is tagged with "excel" and "table"</td></tr>
    </table>
  </div>
  <div id="help-nvim" class="help-section" style="display:none">
    <h3>🖥️ Neovim Editor</h3>
    <p>Replaces the default textarea with a full CodeMirror 6 + Vim engine.</p>
    <h4>How to enable</h4>
    <p>Go to Preferences → Plugins, toggle <strong>Neovim Editor</strong> ON, then hit Apply.</p>
    <h4>Modes</h4>
    <table class="help-table"><tr><th>Key</th><th>Mode</th></tr>
    <tr><td><kbd>i</kbd> / <kbd>a</kbd> / <kbd>o</kbd></td><td>Insert (before / after / new line)</td></tr>
    <tr><td><kbd>v</kbd> / <kbd>V</kbd></td><td>Visual / Visual Line</td></tr>
    <tr><td><kbd>Ctrl+v</kbd></td><td>Visual Block</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Return to Normal</td></tr>
    </table>
    <h4>Essential motions</h4>
    <table class="help-table"><tr><th>Key</th><th>Action</th></tr>
    <tr><td><kbd>h j k l</kbd></td><td>Left / Down / Up / Right</td></tr>
    <tr><td><kbd>w</kbd> / <kbd>b</kbd></td><td>Next / prev word</td></tr>
    <tr><td><kbd>gg</kbd> / <kbd>G</kbd></td><td>First / last line</td></tr>
    <tr><td><kbd>dd</kbd> / <kbd>yy</kbd></td><td>Delete / yank line</td></tr>
    <tr><td><kbd>u</kbd> / <kbd>Ctrl+r</kbd></td><td>Undo / Redo</td></tr>
    <tr><td><kbd>ciw</kbd></td><td>Change inner word</td></tr>
    <tr><td><kbd>/pattern</kbd></td><td>Search forward</td></tr>
    <tr><td><kbd>:%s/old/new/g</kbd></td><td>Replace all</td></tr>
    </table>
    <h4>NoteHub Vim commands</h4>
    <table class="help-table"><tr><th>Command</th><th>Action</th></tr>
    <tr><td><code>:w</code></td><td>Save note</td></tr>
    <tr><td><code>:set rnu</code></td><td>Relative line numbers</td></tr>
    <tr><td><code>:set nornu</code></td><td>Absolute line numbers</td></tr>
    <tr><td><code>:noh</code></td><td>Clear search highlight</td></tr>
    </table>
    <p>Press <kbd>?</kbd> in the mode bar for the full keybinding reference.</p>
  </div>
</div>`
            },
            shortcuts: {
                title: '⌨️  Keyboard Shortcuts',
                body: `
<div class="help-content">
  <h3>Global</h3>
  <table class="help-table"><tr><th>Shortcut</th><th>Action</th></tr>
  <tr><td><kbd>Cmd/Ctrl + N</kbd></td><td>New note</td></tr>
  <tr><td><kbd>Cmd/Ctrl + Shift + N</kbd></td><td>New notebook</td></tr>
  <tr><td><kbd>Cmd/Ctrl + E</kbd></td><td>Export current note</td></tr>
  <tr><td><kbd>Cmd/Ctrl + ,</kbd></td><td>Open Preferences</td></tr>
  <tr><td><kbd>Cmd/Ctrl + R</kbd></td><td>Reload config</td></tr>
  </table>
  <h3>Editor View</h3>
  <table class="help-table"><tr><th>Shortcut</th><th>Action</th></tr>
  <tr><td><kbd>Cmd/Ctrl + 1</kbd></td><td>Edit mode</td></tr>
  <tr><td><kbd>Cmd/Ctrl + 2</kbd></td><td>Split mode</td></tr>
  <tr><td><kbd>Cmd/Ctrl + 3</kbd></td><td>Preview mode</td></tr>
  </table>
  <h3>Plugins</h3>
  <table class="help-table"><tr><th>Shortcut</th><th>Action</th></tr>
  <tr><td><kbd>Ctrl/Cmd + \`</kbd></td><td>Toggle Terminal</td></tr>
  <tr><td><kbd>Ctrl/Cmd + Shift + F</kbd></td><td>Advanced Search</td></tr>
  </table>
</div>`
            },
            nvim: {
                title: '🖥️  Neovim Keybindings',
                body: `<div class="help-content"><p>Open the <strong>🔌 Plugins → Neovim Editor</strong> help for the full reference, or press <strong>?</strong> in the Neovim mode bar while the editor is focused.</p></div>`
            },
            theming: {
                title: '🎨 Theming Guide',
                body: `
<div class="help-content">
  <h3>Changing the theme</h3>
  <p>Go to <strong>Preferences → Appearance</strong> to set accent color, UI font, and editor font. Hit ⚡ Apply to see changes live.</p>
  <h3>Catppuccin accent colors</h3>
  <table class="help-table"><tr><th>Name</th><th>Hex</th></tr>
  <tr><td>Mauve (default)</td><td><code>#cba6f7</code></td></tr>
  <tr><td>Blue</td><td><code>#89b4fa</code></td></tr>
  <tr><td>Green</td><td><code>#a6e3a1</code></td></tr>
  <tr><td>Pink</td><td><code>#f5c2e7</code></td></tr>
  <tr><td>Peach</td><td><code>#fab387</code></td></tr>
  </table>
  <h3>Config file location</h3>
  <p><strong>macOS:</strong> <code>~/Library/Application Support/notehub/config.json</code><br>
  <strong>Linux:</strong> <code>~/.config/notehub/config.json</code><br>
  <strong>Windows:</strong> <code>%APPDATA%\notehub\config.json</code></p>
</div>`
            },
            devplugins: {
                title: '🔌 Plugin Development',
                body: `
<div class="help-content">
  <h3>Creating a plugin</h3>
  <p>Create a folder in <code>notehub/plugins/your-plugin-name/</code> with two files:</p>
  <h4>manifest.json</h4>
  <pre class="help-pre">{"name":"My Plugin","version":"1.0.0","description":"What it does","author":"You","main":"index.js"}</pre>
  <h4>index.js</h4>
  <pre class="help-pre">// 'app' is the NoteHubApp instance
console.log('[MyPlugin] Loading...');

// Add a toolbar button
app.registerPluginAction('my-plugin', 'My Plugin', '🧩', () => {
  app.showModal('My Plugin', '&lt;p&gt;Hello from my plugin!&lt;/p&gt;', [
    { label: 'OK', class: 'btn-primary', onClick: () => app.closeModal() }
  ]);
});

// Listen for custom events
window.addEventListener('notehub:my-plugin', () => { /* handle */ });

console.log('[MyPlugin] Ready!');</pre>
  <h3>Available app methods</h3>
  <table class="help-table"><tr><th>Method</th><th>Description</th></tr>
  <tr><td><code>app.showModal(title, html, buttons)</code></td><td>Show a modal dialog</td></tr>
  <tr><td><code>app.closeModal()</code></td><td>Close the modal</td></tr>
  <tr><td><code>app.createNewNote()</code></td><td>Create a new note</td></tr>
  <tr><td><code>app.currentNote</code></td><td>Currently open note object</td></tr>
  <tr><td><code>app.data.notes</code></td><td>All notes array</td></tr>
  <tr><td><code>app.data.notebooks</code></td><td>All notebooks array</td></tr>
  <tr><td><code>app.saveData()</code></td><td>Persist data to disk</td></tr>
  <tr><td><code>app.render()</code></td><td>Re-render the entire UI</td></tr>
  <tr><td><code>app.renderEditor()</code></td><td>Re-render editor only</td></tr>
  <tr><td><code>app.registerPluginAction(id,label,icon,fn)</code></td><td>Add toolbar button</td></tr>
  </table>
  <p>See <code>PLUGIN_DEVELOPMENT.md</code> for the full guide.</p>
</div>`
            },
            about: {
                title: '📋 About NoteHub',
                body: `
<div class="help-content" style="text-align:center;padding:20px 0">
  <div style="font-size:64px;margin-bottom:16px">📓</div>
  <h2 style="font-size:24px;margin-bottom:8px;background:linear-gradient(90deg,#cba6f7,#f5c2e7);-webkit-background-clip:text;-webkit-text-fill-color:transparent">NoteHub</h2>
  <p style="color:#bac2de;margin-bottom:24px">A hackable, plugin-powered Markdown note-taking app</p>
  <table class="help-table" style="text-align:left">
    <tr><td>Theme</td><td>Catppuccin Mocha</td></tr>
    <tr><td>Editor</td><td>CodeMirror 6 + Vim</td></tr>
    <tr><td>Platform</td><td>Electron (cross-platform)</td></tr>
    <tr><td>Storage</td><td>Local JSON (no cloud)</td></tr>
    <tr><td>Plugins</td><td>JS-based, hot-reloadable</td></tr>
  </table>
  <p style="margin-top:20px;color:#6c7086;font-size:12px">Open source • Hackable • Yours</p>
</div>`
            }
        };

        const s = sections[section] || sections.plugins;
        this.showModal(s.title, s.body, [
            { label: 'Close', class: 'btn-secondary', onClick: () => this.closeModal() }
        ]);

        // Select first tab if plugins section
        if (section === 'plugins') {
            setTimeout(() => {
                const firstTab = document.querySelector('.help-tab');
                if (firstTab) firstTab.click();
            }, 50);
        }
    }

    // Plugins can call this to register a named toolbar action
    registerPluginAction(id, label, icon, onClick) {
        if (!this._pluginToolbarActions) this._pluginToolbarActions = [];
        // Remove existing with same id
        this._pluginToolbarActions = this._pluginToolbarActions.filter(a => a.id !== id);
        this._pluginToolbarActions.push({ id, label, icon, onClick });
    }
    
    // Modal Management
    showModal(title, body, buttons = []) {
        const overlay     = document.getElementById('modalOverlay');
        const modalTitle  = document.getElementById('modalTitle');
        const modalBody   = document.getElementById('modalBody');
        const modalFooter = document.getElementById('modalFooter');

        // Store callbacks in a registry so arrow functions keep correct 'this'
        window.__modalCallbacks = {};

        modalTitle.textContent = title;
        modalBody.innerHTML    = body;

        modalFooter.innerHTML = buttons.map((btn, i) => {
            window.__modalCallbacks['cb_' + i] = btn.onClick;
            const cls = (btn.class || 'btn-secondary').startsWith('btn-')
                ? btn.class : 'btn-' + btn.class;
            return `<button class="${cls}"
                onclick="window.__modalCallbacks['cb_${i}'] && window.__modalCallbacks['cb_${i}']()"
                >${btn.label}</button>`;
        }).join('');

        overlay.classList.add('active');

        // Focus first input in modal body after render
        setTimeout(() => {
            const first = modalBody.querySelector('input[type=text], input[type=number], textarea');
            if (first) first.focus();
        }, 60);
    }
    
    closeModal() {
        const overlay = document.getElementById('modalOverlay');
        overlay.classList.remove('active');
    }
    
    showSettings() {
        this.showModal('Settings', `
            <div class="form-group">
                <label class="form-label">Accent Color</label>
                <input type="color" class="form-input" id="settingAccentColor" value="${this.config.theme.accentColor}">
            </div>
            <div class="form-group">
                <label class="form-label">Default View Mode</label>
                <select class="form-input" id="settingViewMode">
                    <option value="edit" ${this.config.editor.defaultView === 'edit' ? 'selected' : ''}>Edit</option>
                    <option value="split" ${this.config.editor.defaultView === 'split' ? 'selected' : ''}>Split</option>
                    <option value="preview" ${this.config.editor.defaultView === 'preview' ? 'selected' : ''}>Preview</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Auto-save Interval (ms)</label>
                <input type="number" class="form-input" id="settingAutoSave" value="${this.config.editor.autoSaveInterval}" min="1000" step="1000">
            </div>
            <p style="font-size: 12px; color: var(--text-muted); margin-top: 20px;">
                For advanced settings, edit the config file directly from the Preferences menu.
            </p>
        `, [
            { label: 'Cancel', class: 'secondary', onClick: () => this.closeModal() },
            { label: 'Save', class: 'primary', onClick: () => this.saveSettings() }
        ]);
    }
    
    async saveSettings() {
        const accentColor = document.getElementById('settingAccentColor').value;
        const viewMode = document.getElementById('settingViewMode').value;
        const autoSave = parseInt(document.getElementById('settingAutoSave').value);
        
        this.config.theme.accentColor = accentColor;
        this.config.editor.defaultView = viewMode;
        this.config.editor.autoSaveInterval = autoSave;
        
        await this.saveConfig();
        this.applyTheme();
        this.closeModal();
        
        // Restart auto-save with new interval
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.setupAutoSave();
        }
    }
    
    showConfigHelp() {
        this.showModal('Configuration Guide', `
            <div style="line-height: 1.8;">
                <p style="margin-bottom: 16px;">
                    NoteHub is fully hackable! You can customize the app by editing the <code>config.json</code> file.
                </p>
                <h3 style="margin-top: 20px; margin-bottom: 12px;">Location</h3>
                <p style="margin-bottom: 16px;">
                    Go to <strong>Preferences → Open Config File</strong> to access your configuration.
                </p>
                <h3 style="margin-top: 20px; margin-bottom: 12px;">What you can customize</h3>
                <ul style="margin-left: 20px; margin-bottom: 16px;">
                    <li>Theme colors and fonts</li>
                    <li>Editor behavior and defaults</li>
                    <li>Enable/disable plugins</li>
                    <li>UI preferences</li>
                </ul>
                <h3 style="margin-top: 20px; margin-bottom: 12px;">Creating Plugins</h3>
                <p style="margin-bottom: 16px;">
                    Create a folder in <code>plugins/</code> with a <code>manifest.json</code> and <code>index.js</code> file.
                    Then enable it in the config!
                </p>
            </div>
        `, [
            { label: 'Close', class: 'primary', onClick: () => this.closeModal() }
        ]);
    }
}

// Initialize app
const app = new NoteHubApp();

// Make app globally available for onclick handlers
window.app = app;


// Global for help tab switching (called from modal innerHTML)
function switchHelpTab(id) {
    document.querySelectorAll('.help-section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
    const section = document.getElementById('help-' + id);
    if (section) section.style.display = 'block';
    event.currentTarget.classList.add('active');
}
