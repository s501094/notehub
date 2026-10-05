/* NoteHub — AI surfaces, and the renderer half of the note tools.
 *
 * Sessions live in the main process (see ai-providers.js); this file drives them
 * and answers the tool calls bounced back here.
 *
 * It answers them because the renderer owns the live note library. main holds no
 * authoritative copy: `app.data` is in memory here and flushed every two
 * seconds, so a write from main would race the autosave. Going through
 * app.saveData() also means every AI edit lands in the note's version history,
 * which is what makes anything the assistant does to a note undoable.
 *
 * Provider choice is remembered rather than defaulted, because which one is
 * right depends on the machine: Copilot only exists on the work device.
 */
(() => {
    'use strict';

    const IS_MAC = navigator.platform.toUpperCase().includes('MAC');
    const MOD = IS_MAC ? '⌘' : 'Ctrl+';
    const LAST_PROVIDER_KEY = 'notehub.ai.lastProvider';
    const FILE_TOOLS_KEY = 'notehub.ai.allowFileTools';

    const state = {
        providers: [],
        providerId: null,
        sessionId: null,
        busy: false,
        messages: [],        // { role: 'user' | 'assistant' | 'status', text, tools? }
        open: false,
    };

    const app = () => window.app;

    // localStorage, not config.json: this is per-machine UI preference, and
    // writing it to config would sync a work-device choice to the personal one.
    const remember = (key, value) => {
        try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
    };
    const recall = (key, fallback = null) => {
        try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
    };

    // ── The renderer half of the note tools ────────────────────────────────
    //
    // Every handler returns plain data. Errors are returned rather than thrown so
    // the agent sees a tool failure it can react to instead of the turn dying.
    const toolHandlers = {
        list_notebooks() {
            const a = app();
            return (a.data.notebooks || []).map(nb => ({
                id: nb.id,
                name: nb.name,
                notes: (a.data.notes || []).filter(n => n.notebookId === nb.id && !n.deletedAt).length,
            }));
        },

        search_notes({ query, limit = 20 }) {
            const a = app();
            const term = String(query || '').toLowerCase().trim();
            if (!term) return [];
            const byId = new Map((a.data.notebooks || []).map(nb => [nb.id, nb.name]));
            return filterActiveNotes(a.data.notes || [])
                .filter(n =>
                    (n.title || '').toLowerCase().includes(term) ||
                    (n.content || '').toLowerCase().includes(term))
                .slice(0, Math.min(Number(limit) || 20, 50))
                .map(n => ({
                    id: n.id,
                    title: n.title,
                    notebook: byId.get(n.notebookId) || null,
                    tags: n.tags || [],
                    snippet: snippetFromMarkdown(n.content || '', 200),
                }));
        },

        read_note({ id }) {
            const note = (app().data.notes || []).find(n => n.id === id && !n.deletedAt);
            if (!note) return { error: `no note with id ${id}` };
            return { id: note.id, title: note.title, content: note.content || '', tags: note.tags || [] };
        },

        async edit_note({ id, content }) {
            const a = app();
            const note = (a.data.notes || []).find(n => n.id === id && !n.deletedAt);
            if (!note) return { error: `no note with id ${id}` };
            if (typeof content !== 'string') return { error: 'content must be a string' };

            // Snapshot before overwriting, so the previous body is restorable from
            // the history UI exactly like a user edit.
            note.history = pushHistoryVersion(note, content, { force: true });
            note.content = content;
            note.updated = new Date().toISOString();
            note.tags = extractTags(content);

            // The open note is also live in CodeMirror, which would otherwise
            // overwrite this from its stale buffer on the next autosave.
            if (a.currentNote && a.currentNote.id === id && a.cm) {
                const cursor = a.cm.getCursor();
                a.cm.setValue(content);
                a.cm.setCursor(cursor);
                a.currentNote.content = content;
                a.updatePreview();
            }
            await a.saveData();
            a.renderNotesList();
            return { ok: true, id, bytes: content.length };
        },

        async append_to_note({ id, markdown }) {
            const note = (app().data.notes || []).find(n => n.id === id && !n.deletedAt);
            if (!note) return { error: `no note with id ${id}` };
            const base = note.content || '';
            const joiner = base && !base.endsWith('\n') ? '\n\n' : (base ? '\n' : '');
            return toolHandlers.edit_note({ id, content: base + joiner + String(markdown || '') });
        },

        async create_note({ title, content, notebookId }) {
            const a = app();
            const target = notebookId
                || (a.currentNotebook && a.currentNotebook.id)
                || (a.data.notebooks[0] || {}).id;
            if (!target) return { error: 'no notebook to create the note in' };

            const note = withNoteDefaults({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                title: String(title || 'Untitled'),
                content: String(content || ''),
                notebookId: target,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                tags: extractTags(String(content || '')),
            });
            a.data.notes.unshift(note);
            await a.saveData();
            a.render();
            return { ok: true, id: note.id, title: note.title };
        },
    };

    async function handleToolCall(_event, { requestId, name, args }) {
        try {
            const handler = toolHandlers[name];
            if (!handler) throw new Error(`unknown tool ${name}`);
            const result = await handler(args || {});
            await window.electron.aiToolResult({ requestId, result });
        } catch (err) {
            await window.electron.aiToolResult({ requestId, error: err.message });
        }
    }

    // ── Session plumbing ───────────────────────────────────────────────────
    async function providers() {
        if (state.providers.length) return state.providers;
        const res = await window.electron.aiListProviders();
        state.providers = (res && res.providers) || [];
        return state.providers;
    }

    async function pickProvider() {
        const list = await providers();
        const usable = list.filter(p => p.available);
        if (!usable.length) {
            const why = list.map(p => `${p.label}: ${p.reason}`).join(' · ');
            throw new Error(why || 'No AI provider is available');
        }
        if (state.providerId && usable.some(p => p.id === state.providerId)) return state.providerId;

        const remembered = recall(LAST_PROVIDER_KEY);
        if (remembered && usable.some(p => p.id === remembered)) {
            state.providerId = remembered;
            return remembered;
        }
        if (usable.length === 1) {
            state.providerId = usable[0].id;
            return state.providerId;
        }
        return null;   // caller asks
    }

    async function ensureSession() {
        if (state.sessionId) return state.sessionId;
        const providerId = state.providerId || await pickProvider();
        if (!providerId) throw new Error('No provider chosen');
        const res = await window.electron.aiStartSession({
            providerId,
            allowFileTools: recall(FILE_TOOLS_KEY) === 'true',
        });
        if (!res || !res.success) throw new Error((res && res.error) || 'could not start session');
        state.sessionId = res.sessionId;
        remember(LAST_PROVIDER_KEY, providerId);
        return state.sessionId;
    }

    function onAiEvent(_event, payload) {
        if (!payload || payload.sessionId !== state.sessionId) return;
        switch (payload.type) {
            case 'assistant':
                if (payload.text) appendMessage('assistant', payload.text);
                (payload.tools || []).forEach(t => appendMessage('status', `used ${t}`));
                break;
            case 'status':
                if (payload.text) appendMessage('status', payload.text);
                break;
            case 'tool-blocked':
                appendMessage('status', `blocked ${payload.tool} — file tools are off`);
                break;
            case 'error':
                appendMessage('status', `error: ${payload.text}`);
                state.busy = false;
                break;
            case 'done':
                state.busy = false;
                break;
            default:
                break;
        }
        renderPanel();
    }

    function appendMessage(role, text) {
        const last = state.messages[state.messages.length - 1];
        // Assistant text streams in fragments; appending to the open turn keeps
        // the transcript from becoming one bubble per token.
        if (role === 'assistant' && last && last.role === 'assistant' && state.busy) {
            last.text += text;
        } else {
            state.messages.push({ role, text });
        }
    }

    // ── Panel ──────────────────────────────────────────────────────────────
    function renderPanel() {
        const body = document.getElementById('aiPanelBody');
        if (!body) return;
        body.innerHTML = state.messages.map(m => {
            if (m.role === 'status') {
                return `<div class="ai-status">${escapeHtml(m.text)}</div>`;
            }
            const cls = m.role === 'user' ? 'ai-msg user' : 'ai-msg assistant';
            const html = m.role === 'assistant' ? parseMarkdown(m.text) : `<p>${escapeHtml(m.text)}</p>`;
            return `<div class="${cls}">${html}</div>`;
        }).join('') + (state.busy ? '<div class="ai-thinking">thinking…</div>' : '');

        // Assistant replies go through parseMarkdown, so a [[link]] in an answer
        // renders as one. Without wiring it here the anchor is dead and its
        // href="#" would jump the panel to the top instead.
        const a = app();
        if (a && a.wireWikiLinks) a.wireWikiLinks(body);

        body.scrollTop = body.scrollHeight;

        const label = document.getElementById('aiProviderLabel');
        if (label) {
            const p = state.providers.find(x => x.id === state.providerId);
            label.textContent = p ? p.label : 'No provider';
        }
        const stop = document.getElementById('aiStop');
        if (stop) stop.hidden = !state.busy;
    }

    async function openPanel() {
        let panel = document.getElementById('aiPanel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'aiPanel';
            panel.className = 'ai-panel';
            panel.innerHTML = `
                <div class="ai-panel-head">
                    <span class="ai-panel-title">Assistant</span>
                    <button type="button" class="ai-provider" id="aiProviderBtn" title="Change provider">
                        <span id="aiProviderLabel">…</span> ▾
                    </button>
                    <button type="button" class="ai-icon-btn" id="aiStop" title="Stop" hidden>■</button>
                    <button type="button" class="ai-icon-btn" id="aiClose" title="Close">×</button>
                </div>
                <div class="ai-panel-body" id="aiPanelBody"></div>
                <div class="ai-panel-foot">
                    <textarea id="aiInput" class="ai-input" rows="2"
                        placeholder="Ask about this note… (Enter to send, Shift+Enter for a newline)"></textarea>
                </div>`;
            document.querySelector('.main-content').appendChild(panel);
            wirePanel(panel);
        }
        document.documentElement.classList.add('ai-panel-open');
        state.open = true;

        await providers();
        if (!state.providerId) await pickProvider();
        if (!state.providerId) await chooseProvider();
        renderPanel();
        const input = document.getElementById('aiInput');
        if (input) input.focus();
    }

    function closePanel() {
        document.documentElement.classList.remove('ai-panel-open');
        state.open = false;
    }

    function wirePanel(panel) {
        panel.querySelector('#aiClose').addEventListener('click', closePanel);
        panel.querySelector('#aiStop').addEventListener('click', async () => {
            if (state.sessionId) await window.electron.aiAbort({ sessionId: state.sessionId });
            state.busy = false;
            renderPanel();
        });
        panel.querySelector('#aiProviderBtn').addEventListener('click', chooseProvider);

        const input = panel.querySelector('#aiInput');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const text = input.value.trim();
                if (!text) return;
                input.value = '';
                ask(text);
            }
            if (e.key === 'Escape') closePanel();
        });
    }

    async function chooseProvider() {
        const list = await providers();
        const a = app();
        const rows = list.map(p => `
            <label class="ai-provider-row ${p.available ? '' : 'disabled'}">
                <input type="radio" name="aiProvider" value="${escapeHtml(p.id)}"
                       ${p.id === state.providerId ? 'checked' : ''} ${p.available ? '' : 'disabled'}>
                <span class="ai-provider-name">${escapeHtml(p.label)}</span>
                <span class="ai-provider-why">${escapeHtml(p.reason || (p.available ? 'ready' : ''))}</span>
            </label>`).join('');

        a.showModal('Assistant', `
            <div class="form-group">${rows}</div>
            <div class="form-group">
                <label class="ai-provider-row">
                    <input type="checkbox" id="aiFileTools" ${recall(FILE_TOOLS_KEY) === 'true' ? 'checked' : ''}>
                    <span class="ai-provider-name">Allow filesystem and shell tools</span>
                </label>
                <p class="form-hint">Off by default. Note editing does not need this — note tools go
                through the app, so every change is undoable. Enable only for work outside your notes.</p>
            </div>
        `, [
            { label: 'Cancel', class: 'btn-secondary', onClick: () => a.closeModal() },
            { label: 'Use', class: 'btn-primary', onClick: async () => {
                const picked = document.querySelector('input[name="aiProvider"]:checked');
                const files = document.getElementById('aiFileTools');
                if (files) remember(FILE_TOOLS_KEY, files.checked);
                a.closeModal();
                if (picked && picked.value !== state.providerId) {
                    // A provider or tool-policy change needs a fresh session: both
                    // are fixed when the session is created.
                    if (state.sessionId) {
                        await window.electron.aiEndSession({ sessionId: state.sessionId });
                        state.sessionId = null;
                    }
                    state.providerId = picked.value;
                    remember(LAST_PROVIDER_KEY, picked.value);
                }
                renderPanel();
            } },
        ]);
    }

    // ── Asking ─────────────────────────────────────────────────────────────
    function noteContext() {
        const a = app();
        if (!a || !a.currentNote) return '';
        const selection = a.cm && a.cm.somethingSelected() ? a.cm.getSelection() : '';
        const lines = [
            `The user is editing a note titled "${a.currentNote.title}" (id: ${a.currentNote.id}).`,
            'Use the notehub note tools to read or change notes; do not use filesystem tools for notes.',
        ];
        if (selection) {
            lines.push('They have this text selected:', '---', selection, '---');
        }
        return lines.join('\n');
    }

    async function ask(prompt, { includeContext = true } = {}) {
        try {
            await openPanel();
            await ensureSession();
        } catch (err) {
            const a = app();
            if (a && a.showToast) a.showToast(`Assistant unavailable — ${err.message}`);
            return;
        }
        appendMessage('user', prompt);
        state.busy = true;
        renderPanel();

        const full = includeContext ? `${noteContext()}\n\n${prompt}` : prompt;
        const res = await window.electron.aiSend({ sessionId: state.sessionId, prompt: full });
        if (res && !res.success) {
            state.busy = false;
            appendMessage('status', `error: ${res.error}`);
            renderPanel();
        }
    }

    // Selection actions. Phrased as instructions rather than bare verbs so the
    // assistant edits through the note tools instead of replying with prose the
    // user then has to paste.
    const SELECTION_ACTIONS = [
        { id: 'summarise', label: 'Summarise', prompt: 'Summarise the selected text concisely.' },
        { id: 'rewrite', label: 'Rewrite for clarity', prompt: 'Rewrite the selected text to be clearer, keeping its meaning and markdown formatting. Replace it in the note using the note tools.' },
        { id: 'grammar', label: 'Fix spelling and grammar', prompt: 'Correct spelling and grammar in the selected text, changing nothing else. Replace it in the note using the note tools.' },
        { id: 'explain', label: 'Explain', prompt: 'Explain the selected text.' },
        { id: 'expand', label: 'Expand into detail', prompt: 'Expand the selected text into fuller prose, keeping the existing tone. Replace it in the note using the note tools.' },
        { id: 'todos', label: 'Extract action items', prompt: 'Extract the action items from the selected text as a markdown task list, and append them to the note using the note tools.' },
    ];

    function start() {
        if (window.electron.onAiToolCall) window.electron.onAiToolCall(handleToolCall);
        if (window.electron.onAiEvent) window.electron.onAiEvent(onAiEvent);

        document.addEventListener('keydown', (e) => {
            const mod = IS_MAC ? e.metaKey : e.ctrlKey;
            if (mod && e.shiftKey && e.code === 'KeyA') {
                e.preventDefault();
                if (state.open) closePanel(); else openPanel();
            }
        });
    }

    window.NHAi = {
        openPanel, closePanel, ask, chooseProvider,
        SELECTION_ACTIONS, MOD,
        providers, _state: state, _toolHandlers: toolHandlers,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
