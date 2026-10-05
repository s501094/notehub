/* NoteHub — find and replace inside the open note.
 *
 * Distinct from the two searches that already existed: the sidebar input and the
 * advanced-search plugin both filter *which notes* are listed. Neither looks
 * inside the note you are reading.
 *
 * One search, two panes. Matching runs once over the CodeMirror document, which
 * is the source of truth, and drives both panes:
 *
 *   editor   cm.markText() per match, plus one 'active' mark. No search addon
 *            needed -- cm.posFromIndex() turns a string offset into a position,
 *            which is all the addon would have given us.
 *
 *   preview  the CSS Custom Highlight API, not <mark> wrappers. The preview is
 *            rebuilt from markdown on every keystroke, so DOM-mutating
 *            highlights would be destroyed on the next frame and would collide
 *            with the task-checkbox and tag markup that pass already emits.
 *            Highlights are painted from Ranges and mutate nothing.
 *
 * Replace always edits the source. The preview is derived output -- there is
 * nothing in it to edit -- so "replace in the preview" means replace in the
 * markdown behind it, which then re-renders. Every replacement goes through
 * cm.operation() so a Replace All is a single undo step.
 *
 * The counts the bar reports are source counts, because those are what Replace
 * acts on. The preview can legitimately show a different number of visible
 * highlights: `**bold**` carries two asterisks in the source that the rendered
 * text does not have, so a query for `*` matches in one pane and not the other.
 */
(() => {
    'use strict';

    const IS_MAC = navigator.platform.toUpperCase().includes('MAC');
    const HIGHLIGHT_NAME = 'nh-find';
    const PREVIEW_HIGHLIGHT_CAP = 2000;   // ranges, not matches -- see paintPreview
    const MAX_MARKS = 500;                // markText objects, windowed around the active match
    const REPAINT_DEBOUNCE_MS = 150;

    const state = {
        query: '',
        replacement: '',
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        showReplace: false,
        matches: [],
        active: -1,
        marks: [],
        error: null,
    };

    const cmOf = () => (window.app && window.app.cm) || null;
    const previewEl = () => document.getElementById('preview');

    // Derived, never stored. renderEditor() rebuilds .editor-wrapper on a note
    // switch or a view-mode change, which silently removes the bar from the DOM;
    // a boolean would then claim it was open and the next Ctrl+F would "close"
    // an already-gone bar, doing nothing visible.
    const barEl = () => document.getElementById('nhFindBar');
    const isOpen = () => !!barEl();

    // ── Matching ───────────────────────────────────────────────────────────
    //
    // Returns [{start, end}] as string offsets into `text`. Offsets rather than
    // positions so the same function can serve the editor (via posFromIndex)
    // and any plain-text consumer.
    function findMatches(text, query, opts) {
        if (!query) return { matches: [], error: null };

        let re;
        try {
            const flags = opts.caseSensitive ? 'g' : 'gi';
            const body = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            re = new RegExp(opts.wholeWord ? `\\b(?:${body})\\b` : body, flags);
        } catch (err) {
            // Only reachable in regex mode; an invalid pattern is a user typo,
            // so report it in the bar rather than throwing on every keystroke.
            return { matches: [], error: err.message };
        }

        const matches = [];
        let m;
        while ((m = re.exec(text))) {
            matches.push({ start: m.index, end: m.index + m[0].length, groups: m });
            // A pattern able to match the empty string (`a*`, `(?=x)`) would
            // otherwise spin here forever.
            if (m[0].length === 0) re.lastIndex += 1;
            if (matches.length > 10000) break;
        }
        return { matches, error: null };
    }

    // ── Editor highlighting ────────────────────────────────────────────────
    function clearEditorMarks() {
        state.marks.forEach(mark => {
            try { mark.clear(); } catch { /* document already replaced */ }
        });
        state.marks = [];
    }

    function paintEditor() {
        const cm = cmOf();
        clearEditorMarks();
        if (!cm || !state.matches.length) return;

        // Windowed, not capped from the start: slicing the first N would leave
        // every match below it unhighlighted while you navigate into them. A
        // window centred on the active match always includes where you are and
        // where you are going next.
        const total = state.matches.length;
        let first = 0;
        let last = total;
        if (total > MAX_MARKS) {
            const centre = state.active >= 0 ? state.active : 0;
            first = Math.max(0, centre - Math.floor(MAX_MARKS / 2));
            last = Math.min(total, first + MAX_MARKS);
            first = Math.max(0, last - MAX_MARKS);
        }

        cm.operation(() => {
            for (let i = first; i < last; i++) {
                const match = state.matches[i];
                const from = cm.posFromIndex(match.start);
                const to = cm.posFromIndex(match.end);
                state.marks.push(cm.markText(from, to, {
                    className: i === state.active ? 'nh-find-hit active' : 'nh-find-hit',
                }));
            }
        });
    }

    // ── Preview highlighting ───────────────────────────────────────────────
    //
    // Searches the rendered text independently of the source, because the two
    // differ: markdown syntax is gone and chips have been added. Walking text
    // nodes keeps matches from spanning element boundaries, which is also why a
    // query straddling e.g. a bold run will not highlight here even though it
    // matches in the source.
    function paintPreview() {
        if (typeof CSS === 'undefined' || !CSS.highlights) return;   // older Chromium
        CSS.highlights.delete(HIGHLIGHT_NAME);

        const root = previewEl();
        if (!root || !state.query || state.error) return;

        let re;
        try {
            const flags = state.caseSensitive ? 'g' : 'gi';
            const body = state.regex ? state.query : state.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            re = new RegExp(state.wholeWord ? `\\b(?:${body})\\b` : body, flags);
        } catch { return; }

        const ranges = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const text = node.nodeValue;
            if (!text) continue;
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text))) {
                const range = document.createRange();
                range.setStart(node, m.index);
                range.setEnd(node, m.index + m[0].length);
                ranges.push(range);
                if (m[0].length === 0) re.lastIndex += 1;
                if (ranges.length >= PREVIEW_HIGHLIGHT_CAP) break;
            }
            if (ranges.length >= PREVIEW_HIGHLIGHT_CAP) break;
        }

        if (ranges.length) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    }

    // Scrolls the preview to wherever the active match lives, using the
    // data-src-line anchors parseMarkdown already emits -- the same mapping the
    // split-view scroll sync uses, so the two agree instead of competing.
    function revealInPreview() {
        const cm = cmOf();
        const root = previewEl();
        if (!cm || !root || state.active < 0) return;

        const line = cm.posFromIndex(state.matches[state.active].start).line;
        const anchors = [...root.querySelectorAll('[data-src-line]')];
        if (!anchors.length) return;

        let best = anchors[0];
        for (const el of anchors) {
            if (Number(el.getAttribute('data-src-line')) <= line) best = el;
            else break;
        }
        best.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    // ── Navigation ─────────────────────────────────────────────────────────
    function recompute({ keepActive = false } = {}) {
        const cm = cmOf();
        const text = cm ? cm.getValue() : '';
        const { matches, error } = findMatches(text, state.query, state);
        const previous = keepActive ? state.active : -1;

        state.matches = matches;
        state.error = error;
        state.active = matches.length
            ? Math.min(Math.max(previous, 0), matches.length - 1)
            : -1;

        paintEditor();
        paintPreview();
        renderBar();
    }

    function go(delta) {
        if (!state.matches.length) return;
        // Wraps, unlike the sidebar list navigation: in a find bar the match
        // count is visible, so wrapping cannot leave you wondering where you are.
        state.active = (state.active + delta + state.matches.length) % state.matches.length;
        const cm = cmOf();
        if (cm) {
            const match = state.matches[state.active];
            const from = cm.posFromIndex(match.start);
            const to = cm.posFromIndex(match.end);
            cm.setSelection(from, to);
            cm.scrollIntoView({ from, to }, 80);
        }
        paintEditor();
        revealInPreview();
        renderBar();
    }

    // ── Replace ────────────────────────────────────────────────────────────
    function expandReplacement(match) {
        if (!state.regex) return state.replacement;
        // $1..$9 and $& from the regex groups, so regex replace behaves the way
        // it does everywhere else.
        return state.replacement.replace(/\$(\d|&)/g, (whole, token) => {
            if (token === '&') return match.groups[0];
            const idx = Number(token);
            return match.groups[idx] !== undefined ? match.groups[idx] : whole;
        });
    }

    function replaceCurrent() {
        const cm = cmOf();
        if (!cm || state.active < 0) return;
        const match = state.matches[state.active];
        const at = state.active;
        cm.operation(() => {
            cm.replaceRange(
                expandReplacement(match),
                cm.posFromIndex(match.start),
                cm.posFromIndex(match.end),
            );
        });
        syncNote();
        recompute({ keepActive: true });
        // Stay on the same ordinal: the match there is now the *next* one, which
        // is what "Replace" then "Replace" again should walk through.
        state.active = state.matches.length ? Math.min(at, state.matches.length - 1) : -1;
        paintEditor();
        renderBar();
    }

    function replaceAll() {
        const cm = cmOf();
        if (!cm || !state.matches.length) return;
        const count = state.matches.length;
        cm.operation(() => {
            // Back to front, so each replacement cannot shift the offsets of the
            // ones not yet applied.
            for (let i = state.matches.length - 1; i >= 0; i--) {
                const match = state.matches[i];
                cm.replaceRange(
                    expandReplacement(match),
                    cm.posFromIndex(match.start),
                    cm.posFromIndex(match.end),
                );
            }
        });
        syncNote();
        recompute();
        if (window.app && window.app.showToast) {
            window.app.showToast(`Replaced ${count} ${count === 1 ? 'match' : 'matches'}`);
        }
    }

    // CodeMirror's change event already writes currentNote.content and schedules
    // the preview, but updatePreview is called directly so the highlights are
    // repainted against markup that reflects the edit rather than the frame
    // before it.
    function syncNote() {
        const app = window.app;
        const cm = cmOf();
        if (!app || !cm || !app.currentNote) return;
        app.currentNote.content = cm.getValue();
        if (app.updatePreview) app.updatePreview();
    }

    // ── The bar ────────────────────────────────────────────────────────────
    function renderBar() {
        const bar = document.getElementById('nhFindBar');
        if (!bar) return;

        const count = bar.querySelector('.nh-find-count');
        if (count) {
            if (state.error) count.textContent = 'bad pattern';
            else if (!state.query) count.textContent = '';
            else if (!state.matches.length) count.textContent = 'no results';
            else count.textContent = `${state.active + 1} of ${state.matches.length}`;
        }
        bar.classList.toggle('has-error', !!state.error);
        bar.classList.toggle('show-replace', state.showReplace);

        bar.querySelectorAll('[data-opt]').forEach(btn => {
            btn.classList.toggle('on', !!state[btn.getAttribute('data-opt')]);
        });
    }

    function buildBar() {
        const bar = document.createElement('div');
        bar.id = 'nhFindBar';
        bar.className = 'nh-find-bar';
        bar.innerHTML = `
            <div class="nh-find-row">
                <input type="text" class="nh-find-input" id="nhFindInput"
                       placeholder="Find in note" autocomplete="off" spellcheck="false">
                <span class="nh-find-count"></span>
                <button type="button" class="nh-find-opt" data-opt="caseSensitive" title="Match case">Aa</button>
                <button type="button" class="nh-find-opt" data-opt="wholeWord" title="Whole word">ab</button>
                <button type="button" class="nh-find-opt" data-opt="regex" title="Regular expression">.*</button>
                <button type="button" class="nh-find-nav" id="nhFindPrev" title="Previous (Shift+Enter)">↑</button>
                <button type="button" class="nh-find-nav" id="nhFindNext" title="Next (Enter)">↓</button>
                <button type="button" class="nh-find-toggle" id="nhFindToggleReplace"
                        title="Toggle replace (${IS_MAC ? '⌥⌘F' : 'Ctrl+H'})">⇄</button>
                <button type="button" class="nh-find-close" id="nhFindClose" title="Close (Esc)">×</button>
            </div>
            <div class="nh-find-row nh-find-replace-row">
                <input type="text" class="nh-find-input" id="nhReplaceInput"
                       placeholder="Replace with" autocomplete="off" spellcheck="false">
                <button type="button" class="nh-find-btn" id="nhReplaceOne">Replace</button>
                <button type="button" class="nh-find-btn" id="nhReplaceAll">All</button>
            </div>`;
        return bar;
    }

    function wireBar(bar) {
        const input = bar.querySelector('#nhFindInput');
        const replaceInput = bar.querySelector('#nhReplaceInput');

        input.addEventListener('input', () => {
            state.query = input.value;
            recompute();
            // Jump to the first hit as you type, the way every other find bar
            // behaves -- but only forward from nothing, never re-seeking while
            // you are mid-navigation.
            if (state.matches.length && state.active <= 0) go(0);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        });

        replaceInput.addEventListener('input', () => { state.replacement = replaceInput.value; });
        replaceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        });

        bar.querySelectorAll('[data-opt]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-opt');
                state[key] = !state[key];
                recompute();
                input.focus();
            });
        });

        bar.querySelector('#nhFindNext').addEventListener('click', () => go(1));
        bar.querySelector('#nhFindPrev').addEventListener('click', () => go(-1));
        bar.querySelector('#nhFindClose').addEventListener('click', close);
        bar.querySelector('#nhFindToggleReplace').addEventListener('click', () => {
            state.showReplace = !state.showReplace;
            renderBar();
            (state.showReplace ? replaceInput : input).focus();
        });
        bar.querySelector('#nhReplaceOne').addEventListener('click', replaceCurrent);
        bar.querySelector('#nhReplaceAll').addEventListener('click', replaceAll);
    }

    function open({ replace = false } = {}) {
        const host = document.querySelector('.editor-body');
        if (!host) return;   // no note open

        let bar = document.getElementById('nhFindBar');
        if (!bar) {
            bar = buildBar();
            host.appendChild(bar);
            wireBar(bar);
        }
        state.showReplace = replace || state.showReplace;

        // Seed from the selection, as every editor does -- but not a multi-line
        // one, which is a block the user is acting on, not a search term.
        const cm = cmOf();
        const selection = cm && cm.somethingSelected() ? cm.getSelection() : '';
        if (selection && !selection.includes('\n')) state.query = selection;

        const input = document.getElementById('nhFindInput');
        input.value = state.query;
        document.getElementById('nhReplaceInput').value = state.replacement;

        recompute();
        if (state.matches.length) go(0);
        renderBar();
        input.focus();
        input.select();
    }

    function close() {
        clearEditorMarks();
        if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(HIGHLIGHT_NAME);
        const bar = document.getElementById('nhFindBar');
        if (bar) bar.remove();
        const cm = cmOf();
        if (cm) cm.focus();
    }

    function toggle(opts) {
        if (isOpen()) close(); else open(opts);
    }

    // ── Wiring ─────────────────────────────────────────────────────────────
    //
    // Capture phase: CodeMirror binds Ctrl-F to goCharRight in its default
    // keymap and vim mode binds it to page-forward, so the editor would eat the
    // keystroke before it bubbled.
    document.addEventListener('keydown', (e) => {
        const mod = IS_MAC ? e.metaKey : e.ctrlKey;
        if (!mod || e.altKey) {
            // ⌥⌘F is the macOS convention for replace; handled below.
            if (!(IS_MAC && e.metaKey && e.altKey && e.code === 'KeyF')) return;
        }

        // Shift+Ctrl+F belongs to the advanced-search plugin (across all notes).
        if (e.shiftKey && e.code === 'KeyF') return;

        if (e.code === 'KeyF' && IS_MAC && e.altKey && e.metaKey) {
            e.preventDefault(); e.stopPropagation();
            open({ replace: true });
            return;
        }
        if (e.code === 'KeyF' && !e.shiftKey) {
            e.preventDefault(); e.stopPropagation();
            open();
            return;
        }
        if (e.code === 'KeyH' && !IS_MAC && !e.shiftKey) {
            e.preventDefault(); e.stopPropagation();
            open({ replace: true });
        }
    }, true);

    document.addEventListener('keydown', (e) => {
        if (!isOpen()) return;
        if (e.key === 'F3') {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
        }
    });

    // The preview is rebuilt from markdown on every keystroke, which discards
    // nothing of ours (highlights are not DOM) but does invalidate the Ranges
    // pointing into the old text nodes. Repaint after the app re-renders.
    let repaintTimer = null;
    const repaint = () => {
        if (!isOpen()) return;
        clearTimeout(repaintTimer);
        repaintTimer = setTimeout(() => recompute({ keepActive: true }), REPAINT_DEBOUNCE_MS);
    };
    window.addEventListener('notehub:preview-updated', repaint);

    // The editor was rebuilt, so the bar went with it and the marks belong to a
    // CodeMirror instance that no longer exists. Drop the stale state rather than
    // leaving it to be cleared against a dead document.
    window.addEventListener('notehub:editor-ready', () => {
        clearTimeout(repaintTimer);
        state.marks = [];
        state.matches = [];
        state.active = -1;
        if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(HIGHLIGHT_NAME);
    });

    window.NHFind = { open, close, toggle, isOpen, findMatches, _state: state };
})();
