/* NoteHub — Mermaid diagrams in the preview.
 *
 * No parser change was needed: parseMarkdown already stamps every fence with
 * data-lang, so a ```mermaid block is identifiable in the rendered output.
 *
 * Three things make this more than "call mermaid.render":
 *
 *  1. The bundle is 5.2 MB. Loading it at startup would cost every launch for a
 *     feature most notes never use, so it is injected on first sight of a
 *     diagram and never again.
 *
 *  2. The preview is rebuilt from markdown on every keystroke. Re-rendering each
 *     diagram per frame would make typing in a note with diagrams unusable, so
 *     rendered SVG is cached by (source + theme) and reused. Typing next to a
 *     diagram re-renders the markdown but not the diagram.
 *
 *  3. mermaid.render is async, and the preview can be rebuilt again before it
 *     resolves. A generation counter means a late result is dropped instead of
 *     being injected into markup that has already been replaced.
 *
 * securityLevel is 'strict': mermaid can put HTML in diagram labels, and note
 * content arrives from imports and the clipboard as well as from typing.
 */
(() => {
    'use strict';

    const SRC = './node_modules/mermaid/dist/mermaid.min.js';
    const svgCache = new Map();          // `${theme}\u0000${source}` -> svg string
    const CACHE_LIMIT = 120;

    let loadPromise = null;
    let generation = 0;
    let seq = 0;

    function loadMermaid() {
        if (window.mermaid) return Promise.resolve(window.mermaid);
        if (loadPromise) return loadPromise;

        loadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = SRC;
            script.onload = () => {
                if (!window.mermaid) return reject(new Error('mermaid loaded but exposed no global'));
                resolve(window.mermaid);
            };
            script.onerror = () => reject(new Error(`could not load ${SRC}`));
            document.head.appendChild(script);
        }).catch((err) => {
            // Allow a later attempt: a transient failure should not disable
            // diagrams for the rest of the session.
            loadPromise = null;
            throw err;
        });
        return loadPromise;
    }

    // The preview renders code with a per-line gutter span. Reading textContent
    // off the <pre> would fold those line numbers into the diagram source, so the
    // numbers are dropped the same way "Copy Code Block" drops them.
    function sourceOf(pre) {
        const lines = [...pre.querySelectorAll('.code-line')];
        if (!lines.length) return pre.textContent.trim();
        return lines.map((line) => {
            const clone = line.cloneNode(true);
            const gutter = clone.querySelector('.code-ln');
            if (gutter) gutter.remove();
            return clone.textContent;
        }).join('\n').trim();
    }

    // Diagram colours have to follow the pane, not the app: the preview can be a
    // bright panel inside the dark shell, and a dark-themed diagram on cream is
    // unreadable.
    function currentTheme() {
        const wrapper = document.querySelector('.editor-wrapper');
        return wrapper && wrapper.classList.contains('bright') ? 'default' : 'dark';
    }

    function remember(key, svg) {
        if (svgCache.size >= CACHE_LIMIT) {
            // Oldest first; Map preserves insertion order.
            svgCache.delete(svgCache.keys().next().value);
        }
        svgCache.set(key, svg);
    }

    function mount(pre, svg) {
        const host = document.createElement('div');
        host.className = 'nh-mermaid';
        host.innerHTML = svg;
        pre.replaceWith(host);
    }

    function showError(pre, message) {
        // The source stays visible: a diagram that will not parse is something
        // the user needs to read and fix, not something to hide.
        const note = document.createElement('div');
        note.className = 'nh-mermaid-error';
        note.textContent = `Mermaid: ${message}`;
        pre.classList.add('nh-mermaid-failed');
        pre.parentNode.insertBefore(note, pre);
    }

    async function renderAll(root) {
        const target = root || document.getElementById('preview');
        if (!target) return;

        const blocks = [...target.querySelectorAll('pre.md-pre[data-lang="mermaid"]')];
        if (!blocks.length) return;

        const theme = currentTheme();
        const mine = ++generation;

        // Anything already rendered goes up synchronously, before the await, so a
        // note full of known diagrams never flashes its source.
        const pending = [];
        for (const pre of blocks) {
            const source = sourceOf(pre);
            const key = `${theme}\u0000${source}`;
            const cached = svgCache.get(key);
            if (cached) mount(pre, cached);
            else pending.push({ pre, source, key });
        }
        if (!pending.length) return;

        let mermaid;
        try {
            mermaid = await loadMermaid();
        } catch (err) {
            pending.forEach(({ pre }) => showError(pre, err.message));
            return;
        }
        if (mine !== generation) return;   // preview replaced while loading

        mermaid.initialize({
            startOnLoad: false,
            theme,
            securityLevel: 'strict',
            fontFamily: getComputedStyle(document.documentElement)
                .getPropertyValue('--font-body').trim() || 'sans-serif',
        });

        for (const { pre, source, key } of pending) {
            try {
                const { svg } = await mermaid.render(`nh-mmd-${++seq}`, source);
                if (mine !== generation) return;   // a newer render supersedes this
                remember(key, svg);
                mount(pre, svg);
            } catch (err) {
                if (mine !== generation) return;
                showError(pre, (err && err.message ? err.message : String(err)).split('\n')[0]);
            }
        }
    }

    // Debounced: preview-updated fires once per frame while typing, and even a
    // fully cached pass walks every diagram's line spans to recompute its source
    // key. Typing beside a diagram should not pay for that on every keystroke.
    let debounce = null;
    window.addEventListener('notehub:preview-updated', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => renderAll(), 180);
    });
    // Theme changes alter the cache key, so a re-render picks new colours up.
    window.addEventListener('notehub:config-applied', () => renderAll());

    window.NHMermaid = { renderAll, _cache: svgCache };
})();
