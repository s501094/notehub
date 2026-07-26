function filterActiveNotes(notes) {
    return notes.filter(n => !n.deletedAt);
}

function filterTrashedNotes(notes) {
    return notes.filter(n => !!n.deletedAt);
}

function sortPinnedFirst(notes) {
    const pinned = notes.filter(n => n.pinned);
    const rest = notes.filter(n => !n.pinned);
    return [...pinned, ...rest];
}

function withNoteDefaults(note) {
    return {
        ...note,
        deletedAt: note.deletedAt ?? null,
        pinned: note.pinned ?? false,
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { filterActiveNotes, filterTrashedNotes, sortPinnedFirst, withNoteDefaults };
}
