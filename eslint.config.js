/* ESLint, scoped deliberately narrowly.
 *
 * This exists for one rule: no-undef. Three production bugs in this codebase
 * have been a function that was called and never defined --
 *
 *   shadeHex      renderEditor threw, so no note would open at all
 *   fileUrl       swallowed by a catch, so pasted images silently showed broken
 *   relativeTime  threw before the tag chips rendered, taking them down too
 *
 * -- and every one of them was invisible until the feature was used in a built
 * app. Nothing else catches this: node --check only parses, and the test suite
 * cannot reach code paths that need a DOM and an Electron bridge.
 *
 * Stylistic rules are off on purpose. A lint run that reports hundreds of
 * formatting opinions is a lint run nobody reads, and the point here is that a
 * non-empty report always means something is broken.
 */

const BROWSER_GLOBALS = {
    window: 'readonly', document: 'readonly', navigator: 'readonly',
    console: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
    clearInterval: 'readonly', requestAnimationFrame: 'readonly',
    cancelAnimationFrame: 'readonly', queueMicrotask: 'readonly',
    fetch: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
    CustomEvent: 'readonly', Event: 'readonly', MouseEvent: 'readonly',
    KeyboardEvent: 'readonly', Blob: 'readonly', File: 'readonly',
    FileReader: 'readonly', FormData: 'readonly', URL: 'readonly',
    URLSearchParams: 'readonly', Range: 'readonly', Highlight: 'readonly',
    NodeFilter: 'readonly', DOMParser: 'readonly', TextEncoder: 'readonly',
    TextDecoder: 'readonly', IntersectionObserver: 'readonly',
    MutationObserver: 'readonly', ResizeObserver: 'readonly',
    getComputedStyle: 'readonly', CSS: 'readonly', Image: 'readonly',
    HTMLElement: 'readonly', Node: 'readonly', AbortController: 'readonly',
};

// Loaded by <script> tags ahead of the files that use them, so they are genuine
// globals at runtime even though nothing imports them. index.html's script order
// is what makes this true; tests/packaging.test.js is what keeps that order from
// being broken silently.
const NOTEHUB_GLOBALS = {
    // markdown-utils.js
    parseMarkdown: 'readonly', escapeHtml: 'readonly', snippetFromMarkdown: 'readonly',
    isSafeColor: 'readonly', isSafeLength: 'readonly',
    TAG_RE: 'readonly', extractTags: 'readonly',
    WIKILINK_RE: 'readonly', extractLinks: 'readonly',
    // note-utils.js
    filterActiveNotes: 'readonly', filterTrashedNotes: 'readonly',
    sortPinnedFirst: 'readonly', withNoteDefaults: 'readonly',
    pushHistoryVersion: 'readonly', historyEntryStats: 'readonly',
    moveItem: 'readonly', samePinGroup: 'readonly',
    HISTORY_LIMIT: 'readonly', MIN_SNAPSHOT_GAP_MS: 'readonly',
    isValidTag: 'readonly', isTagOnlyLine: 'readonly', addTagToText: 'readonly',
    removeTagFromText: 'readonly', textHasTag: 'readonly',
    normaliseTitle: 'readonly', resolveLinkTarget: 'readonly', buildBacklinkIndex: 'readonly',
    // notebook-utils.js
    NOTEBOOK_PALETTE: 'readonly', nextNotebookColor: 'readonly',
    withNotebookDefaults: 'readonly', isValidNotebookColor: 'readonly',
    normalizeNotebookColor: 'readonly', canDeleteNotebook: 'readonly',
    // vendored
    CodeMirror: 'readonly', mermaid: 'writable',
    // renderer.js publishes these for the other renderer scripts
    app: 'writable', NHFind: 'writable', NHAi: 'writable', NHComplete: 'writable',
    NHContextMenu: 'writable', NHEdit: 'writable', NHMermaid: 'writable',
};

module.exports = [
    {
        // Renderer-side scripts: plain <script> files sharing one global scope.
        files: [
            'renderer.js', 'markdown-utils.js', 'note-utils.js', 'notebook-utils.js',
            'context-menu.js', 'find-replace.js', 'mermaid-render.js',
            'ai-panel.js', 'ai-complete.js',
        ],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'script',
            globals: { ...BROWSER_GLOBALS, ...NOTEHUB_GLOBALS },
        },
        rules: { 'no-undef': 'error' },
    },
    {
        // Dual-mode helpers: a <script> tag in the renderer and a CommonJS
        // module under node:test. The `typeof module !== 'undefined'` guard at
        // the foot of each is what makes referencing `module` safe there.
        files: ['markdown-utils.js', 'note-utils.js', 'notebook-utils.js'],
        languageOptions: { globals: { module: 'writable' } },
    },
    {
        // Main process and tests: CommonJS with Node globals.
        files: ['main.js', 'preload.js', 'ai-providers.js', 'tests/**/*.js', 'test.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly', module: 'writable', exports: 'writable',
                process: 'readonly', Buffer: 'readonly', console: 'readonly',
                __dirname: 'readonly', __filename: 'readonly',
                setTimeout: 'readonly', clearTimeout: 'readonly',
                setInterval: 'readonly', clearInterval: 'readonly',
                URL: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
                window: 'readonly', document: 'readonly', navigator: 'readonly',
                localStorage: 'readonly', CSS: 'readonly', Highlight: 'readonly',
                NodeFilter: 'readonly', CustomEvent: 'readonly',
            },
        },
        rules: { 'no-undef': 'error' },
    },
];
