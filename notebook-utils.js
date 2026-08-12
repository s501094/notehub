const NOTEBOOK_PALETTE = ['#7c6df0', '#2dc4b6', '#f07c5e', '#ffc466'];

function nextNotebookColor(existingNotebooks) {
    return NOTEBOOK_PALETTE[existingNotebooks.length % NOTEBOOK_PALETTE.length];
}

function withNotebookDefaults(notebook, index) {
    return {
        ...notebook,
        color: notebook.color || NOTEBOOK_PALETTE[index % NOTEBOOK_PALETTE.length],
    };
}

// At least one notebook must always exist (note creation falls back to notebooks[0]).
function canDeleteNotebook(notebooks) {
    return notebooks.length > 1;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NOTEBOOK_PALETTE, nextNotebookColor, withNotebookDefaults, canDeleteNotebook };
}
