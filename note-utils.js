// Version history keeps the last N snapshots of a note's content inline in
// the note record (v2 spec's `history: [{ content, savedAt }]`). Two guards
// keep notebooks.json from ballooning: snapshots are only taken when the
// content actually changed, and no more often than MIN_SNAPSHOT_GAP_MS —
// otherwise autoSave (every 2s by default) would push a version per keystroke
// burst and the cap would only ever hold the last ~2 minutes of typing.
const HISTORY_LIMIT = 50;
const MIN_SNAPSHOT_GAP_MS = 90 * 1000;

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
        history: Array.isArray(note.history) ? note.history : [],
    };
}

// Returns the new history array for `note` given the content it is about to
// be overwritten with. Newest snapshot first. Pure — the caller assigns the
// result, so this stays testable without a note object graph.
//   force: bypass the time gap (used by an explicit restore, which must not
//          silently lose the content it is replacing)
function pushHistoryVersion(note, nextContent, { now = Date.now(), force = false } = {}) {
    const history = Array.isArray(note.history) ? note.history : [];
    const prevContent = note.content ?? '';

    if (prevContent === (nextContent ?? '')) return history;

    if (!force && history.length > 0) {
        const lastAt = Date.parse(history[0].savedAt);
        if (Number.isFinite(lastAt) && now - lastAt < MIN_SNAPSHOT_GAP_MS) {
            return history;
        }
    }

    // savedAt records when this content was last the saved state of the note
    // (note.updated), not when the snapshot was taken — that's the timestamp
    // a user restoring "the version from 3pm" is actually looking for.
    const savedAt = note.updated || new Date(now).toISOString();
    return [{ content: prevContent, savedAt }, ...history].slice(0, HISTORY_LIMIT);
}

// Moves the item with `fromId` to sit where `toId` currently is. Returns a new
// array — callers assign it, so drag-reorder stays a pure transform that can be
// tested without a DOM.
//
// Notes are stored in one flat array across all notebooks and rendered through
// getFilteredNotes(), which preserves array order; reordering the global array
// is therefore what actually persists a drag. Pinned notes are grouped ahead of
// the rest by sortPinnedFirst() at render time, so a drag that crosses the
// pinned boundary can't be expressed as a position — callers should reject it
// rather than silently reordering into a group the item won't display in.
function moveItem(list, fromId, toId, idKey = 'id') {
    if (!Array.isArray(list)) return list;
    const from = list.findIndex(x => x && x[idKey] === fromId);
    const to = list.findIndex(x => x && x[idKey] === toId);
    if (from < 0 || to < 0 || from === to) return list;
    const copy = list.slice();
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
}

// True when two notes sit in the same pin group, i.e. a drag between them
// produces the order the user actually sees.
function samePinGroup(a, b) {
    return !!(a && b) && !!a.pinned === !!b.pinned;
}

function historyEntryStats(entry) {
    const content = (entry && entry.content) || '';
    return {
        words: content.split(/\s+/).filter(w => w.length > 0).length,
        chars: content.length,
        lines: content ? content.split('\n').length : 0,
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        HISTORY_LIMIT,
        MIN_SNAPSHOT_GAP_MS,
        filterActiveNotes,
        filterTrashedNotes,
        sortPinnedFirst,
        withNoteDefaults,
        pushHistoryVersion,
        historyEntryStats,
        moveItem,
        samePinGroup,
    };
}
