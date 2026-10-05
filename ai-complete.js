/* NoteHub — inline ghost completions.
 *
 * Manual by default, and that is a deliberate consequence of how this is
 * powered. Both providers run an agent loop behind a spawned process, so a
 * completion arrives in seconds, not the sub-200ms that makes Copilot-style
 * ghost text feel like part of typing. Automatic-on-idle at that latency does
 * not read as a suggestion, it reads as the editor glitching: the ghost appears
 * long after you have moved on. So the default is a key you press when you want
 * one (Alt+\, Copilot's own binding), and `editor.inlineCompletions: "auto"`
 * opts into idle triggering for anyone who prefers it.
 *
 * CodeMirror 5 has no inline-suggestion widget. The ghost is a bookmark -- a DOM
 * node anchored at a position without touching the document -- so the text is
 * never in the note until accepted, and nothing needs undoing if it is not.
 * That also means the ghost cannot desynchronise from the document: a bookmark
 * moves with its position, and any edit clears it anyway.
 */
(() => {
    'use strict';

    const IDLE_MS = 900;
    const MIN_CONTEXT = 12;         // characters before the cursor
    const MAX_CONTEXT = 4000;       // characters of lead-in sent
    const PROMPT = [
        'Continue the following markdown note from exactly where it stops.',
        'Reply with the continuation only: no preamble, no explanation, no code fence,',
        'and do not repeat any of the text you were given.',
        'Write at most two sentences, matching the existing voice and formatting.',
    ].join(' ');

    const state = {
        sessionId: null,
        bookmark: null,
        suggestion: '',
        anchor: null,     // {line, ch} the suggestion belongs to
        inFlight: 0,      // generation counter; a stale reply is dropped
        idleTimer: null,
        starting: null,
    };

    const cmOf = () => (window.app && window.app.cm) || null;
    const mode = () => {
        const cfg = window.app && window.app.config;
        return (cfg && cfg.editor && cfg.editor.inlineCompletions) || 'manual';
    };

    // ── Ghost rendering ────────────────────────────────────────────────────
    function clearGhost() {
        if (state.bookmark) {
            try { state.bookmark.clear(); } catch { /* document replaced */ }
        }
        state.bookmark = null;
        state.suggestion = '';
        state.anchor = null;
    }

    function showGhost(text, at) {
        const cm = cmOf();
        if (!cm || !text) return;
        clearGhost();

        const widget = document.createElement('span');
        widget.className = 'nh-ghost';
        // First line inline; the rest as separate lines so a multi-line
        // suggestion does not run off the right edge.
        const [first, ...rest] = text.split('\n');
        widget.appendChild(document.createTextNode(first));
        for (const line of rest) {
            widget.appendChild(document.createElement('br'));
            widget.appendChild(document.createTextNode(line));
        }
        // insertLeft false: the ghost sits after the cursor, so typing continues
        // to the left of it rather than pushing it along.
        state.bookmark = cm.setBookmark(at, { widget, insertLeft: false });
        state.suggestion = text;
        state.anchor = at;
    }

    function accept() {
        const cm = cmOf();
        if (!cm || !state.suggestion) return false;
        const text = state.suggestion;
        const at = state.anchor;
        clearGhost();
        // One operation, so accepting is a single undo step.
        cm.operation(() => {
            cm.replaceRange(text, at, at);
            cm.setCursor(cm.posFromIndex(cm.indexFromPos(at) + text.length));
        });
        const app = window.app;
        if (app && app.currentNote) {
            app.currentNote.content = cm.getValue();
            if (app.updatePreview) app.updatePreview();
        }
        return true;
    }

    // ── Requesting ─────────────────────────────────────────────────────────
    //
    // A session of its own, created once and reused: it carries no tools (see
    // ai-start-session's `purpose`) so the model cannot wander into a multi-step
    // turn when all we want is one string, and it keeps completions out of the
    // chat panel's transcript.
    async function ensureSession() {
        if (state.sessionId) return state.sessionId;
        if (state.starting) return state.starting;

        state.starting = (async () => {
            const ai = window.NHAi;
            if (!ai) throw new Error('assistant not loaded');
            const list = await ai.providers();
            const usable = list.filter(p => p.available);
            if (!usable.length) throw new Error('no provider available');
            const providerId = (ai._state && ai._state.providerId) || usable[0].id;

            const res = await window.electron.aiStartSession({ providerId, purpose: 'completion' });
            if (!res || !res.success) throw new Error((res && res.error) || 'session failed');
            state.sessionId = res.sessionId;
            return state.sessionId;
        })().finally(() => { state.starting = null; });

        return state.starting;
    }

    // Replies arrive as ai-event, so the response is collected by listening for
    // this session's events rather than awaiting aiSend -- which resolves when
    // the prompt was accepted, not when the answer is complete.
    //
    // One slot, not a map. Only one completion is ever outstanding, and keying by
    // generation was actively harmful: the handler could only look up the
    // *current* generation, so once a second request bumped the counter the first
    // request's still-streaming text appended into the second request's buffer and
    // the new suggestion arrived with the old one's words glued to the front.
    // Superseding a request now closes its slot explicitly.
    let pending = null;    // { generation, resolve, text, timer }

    function settle(value) {
        if (!pending) return;
        clearTimeout(pending.timer);
        const { resolve } = pending;
        pending = null;
        resolve(value);
    }

    function onEvent(_e, payload) {
        if (!payload || payload.sessionId !== state.sessionId) return;
        if (!pending || pending.generation !== state.inFlight) return;
        if (payload.type === 'assistant' && payload.text) pending.text += payload.text;
        if (payload.type === 'done') settle(pending.text);
        if (payload.type === 'error') settle('');
    }

    function awaitReply(generation) {
        // Anything still waiting belongs to a superseded request.
        settle('');
        return new Promise((resolve) => {
            const timer = setTimeout(() => settle(''), 20000);
            pending = { generation, resolve, text: '', timer };
        });
    }

    // Models add preamble, fences and quotes however firmly you ask them not to.
    function tidy(raw, lead) {
        let text = String(raw || '').trim();
        text = text.replace(/^```[\w-]*\s*/i, '').replace(/```$/i, '').trim();
        text = text.replace(/^(?:here(?:'s| is)[^:]*:|continuation:)\s*/i, '');
        // Models frequently echo the tail of the lead-in; dropping the overlap is
        // what stops an accepted suggestion duplicating the words above it.
        const tail = lead.slice(-80);
        for (let n = Math.min(tail.length, text.length); n >= 8; n--) {
            if (text.slice(0, n) === tail.slice(-n)) { text = text.slice(n); break; }
        }
        return text.replace(/^\s+/, ' ').replace(/\s+$/, '');
    }

    async function request({ manual = false } = {}) {
        const cm = cmOf();
        if (!cm || mode() === 'off') return;
        if (cm.somethingSelected()) return;

        const cursor = cm.getCursor();
        const lead = cm.getRange({ line: 0, ch: 0 }, cursor).slice(-MAX_CONTEXT);
        if (lead.trim().length < MIN_CONTEXT) return;

        // Only at the end of a line: a ghost in the middle of existing text has
        // nowhere to go that is not confusing.
        if (cm.getLine(cursor.line).length !== cursor.ch) return;

        const superseded = state.sessionId && pending;
        const generation = ++state.inFlight;
        clearGhost();
        if (manual) setStatus('thinking…');

        // Stop the previous turn rather than letting it run to completion for a
        // cursor position that has moved on.
        if (superseded) {
            try { await window.electron.aiAbort({ sessionId: state.sessionId }); } catch { /* already done */ }
        }

        try {
            await ensureSession();
            const reply = awaitReply(generation);
            await window.electron.aiSend({
                sessionId: state.sessionId,
                prompt: `${PROMPT}\n\n---\n${lead}`,
            });
            const text = tidy(await reply, lead);

            // Dropped if anything moved: the suggestion was for a cursor
            // position that no longer exists.
            if (generation !== state.inFlight) return;
            const now = cm.getCursor();
            if (now.line !== cursor.line || now.ch !== cursor.ch) return;
            if (!text) { if (manual) setStatus('no suggestion'); return; }

            setStatus('');
            showGhost(text, cursor);
        } catch (err) {
            if (manual) setStatus(err.message);
        }
    }

    function setStatus(text) {
        const el = document.getElementById('statusLastSaved');
        if (!el) return;
        if (!text) { el.removeAttribute('data-ghost-status'); return; }
        el.setAttribute('data-ghost-status', text);
        // Transient: the status bar's own updates will overwrite it anyway, so
        // this only needs to survive long enough to be read.
        setTimeout(() => {
            if (el.getAttribute('data-ghost-status') === text) el.removeAttribute('data-ghost-status');
        }, 4000);
    }

    // ── Wiring ─────────────────────────────────────────────────────────────
    function scheduleIdle() {
        clearTimeout(state.idleTimer);
        if (mode() !== 'auto') return;
        state.idleTimer = setTimeout(() => request(), IDLE_MS);
    }

    function attach(cm) {
        if (!cm || cm.__ghostWired) return;
        cm.__ghostWired = true;

        // Tab accepts, and only when a ghost is showing -- otherwise Tab must
        // keep indenting, which is what it is for the rest of the time.
        cm.addKeyMap({
            Tab: () => {
                if (state.suggestion) { accept(); return; }
                return window.CodeMirror.Pass;
            },
            // Always passes through. Swallowing Esc would clear the ghost and
            // leave vim mode stuck in insert, since Esc is how you leave it --
            // dismissing a suggestion must not cost the user their mode.
            Esc: () => {
                clearGhost();
                return window.CodeMirror.Pass;
            },
            'Alt-\\': () => { request({ manual: true }); },
        });

        // Any edit or cursor move invalidates the suggestion. Cheaper and more
        // reliable than trying to decide which edits keep it valid.
        cm.on('changes', () => { clearGhost(); scheduleIdle(); });
        cm.on('cursorActivity', () => {
            if (!state.suggestion) return;
            const c = cm.getCursor();
            if (!state.anchor || c.line !== state.anchor.line || c.ch !== state.anchor.ch) clearGhost();
        });
        cm.on('blur', clearGhost);
    }

    // The editor is rebuilt whenever renderEditor runs, so the keymap has to be
    // reattached to the new instance. Driven by the event renderEditor emits
    // rather than by polling: a 1s interval left a window in which Tab and Alt+\\
    // silently did nothing after every note switch, and it ran forever even with
    // completions turned off.
    window.addEventListener('notehub:editor-ready', (e) => {
        clearGhost();
        const cm = (e.detail && e.detail.cm) || cmOf();
        if (cm) attach(cm);
    });

    if (window.electron && window.electron.onAiEvent) window.electron.onAiEvent(onEvent);
    // Covers the editor that already exists when this script loads.
    if (cmOf()) attach(cmOf());

    window.NHComplete = {
        request, accept, clearGhost, tidy,
        _state: state,
    };
})();
