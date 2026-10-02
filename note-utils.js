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


// ── Tag text transforms ────────────────────────────────────────────────────
//
// Tags live in the note body, so adding and removing one is a text edit. These
// are pure so they can be tested directly; the renderer just applies the result
// to CodeMirror.

const TAG_BODY = '[A-Za-z][\\w-]*(?:\\/[A-Za-z][\\w-]*)*';

function isValidTag(tag) {
    return new RegExp(`^${TAG_BODY}$`).test(String(tag || ''));
}

// A line that is nothing but tags, which is where UI-added tags are collected so
// they never land mid-sentence.
function isTagOnlyLine(line) {
    return new RegExp(`^\\s*(?:#${TAG_BODY}\\s*)+$`).test(String(line || ''));
}

// Appends `#tag` to the note's trailing tag-only line, creating one if the note
// does not end with it. Returns the text unchanged if the tag is invalid or
// already present.
function addTagToText(text, tag) {
    const clean = String(tag || '').trim().replace(/^#+/, '');
    if (!isValidTag(clean)) return String(text ?? '');

    const doc = String(text ?? '');
    if (textHasTag(doc, clean)) return doc;

    const lines = doc.split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    const last = lines.length - 1;
    if (last >= 0 && isTagOnlyLine(lines[last])) {
        lines[last] = `${lines[last].trimEnd()} #${clean}`;
    } else {
        if (lines.length) lines.push('');
        lines.push(`#${clean}`);
    }
    return lines.join('\n') + '\n';
}

// Removes every occurrence of `#tag`, then tidies the whitespace left behind.
//
// The trailing guard is `(?![\w/-])`, not `\b`: with a word boundary, removing
// `#work` would also match the `#work` prefix of `#work/clients` and leave
// `/clients` behind, and removing `#ops` would turn `#ops-2` into `-2`. Both
// silently damage the note.
function removeTagFromText(text, tag) {
    const clean = String(tag || '').trim().replace(/^#+/, '');
    if (!isValidTag(clean)) return String(text ?? '');
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return String(text ?? '')
        .replace(new RegExp(`(?<!\\S)#${escaped}(?![\\w/-])`, 'g'), '')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n');
}

function textHasTag(text, tag) {
    const clean = String(tag || '').replace(/^#+/, '');
    if (!isValidTag(clean)) return false;
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<!\\S)#${escaped}(?![\\w/-])`).test(String(text ?? ''));
}


// ── Wiki links and backlinks ───────────────────────────────────────────────
//
// Links are written by title, not by id, because that is what a person types.
// Titles are not unique and not stable, which has two consequences this code has
// to own rather than ignore:
//
//   - resolution is by normalised title, and when several notes share one the
//     most recently updated wins. Picking arbitrarily would make a link's
//     destination depend on array order.
//   - a link to a title nothing matches is not an error. It is the normal way to
//     write a note you have not created yet, so it resolves to null and the UI
//     offers to create it.
//
// `extractLinks` lives in markdown-utils with the pattern it shares with the
// renderer; it is passed in so this module stays dependency-free and testable.

function normaliseTitle(title) {
    return String(title ?? '').trim().toLowerCase();
}

function resolveLinkTarget(notes, target) {
    const wanted = normaliseTitle(target);
    if (!wanted) return null;
    const candidates = (notes || [])
        .filter(n => n && !n.deletedAt && normaliseTitle(n.title) === wanted);
    if (!candidates.length) return null;
    // Most recently updated wins, so a duplicate title resolves predictably
    // instead of depending on where the note sits in the array.
    return candidates.reduce((best, n) =>
        (Date.parse(n.updated || 0) || 0) > (Date.parse(best.updated || 0) || 0) ? n : best);
}

// { outbound: Map<noteId, noteId[]>, inbound: Map<noteId, noteId[]>,
//   unresolved: Map<noteId, string[]> }
//
// Built in one pass over the library rather than per note: a backlink panel needs
// the reverse direction, and computing that on demand would mean re-scanning
// every note's body each time the panel opened.
function buildBacklinkIndex(notes, extractLinks) {
    const active = (notes || []).filter(n => n && !n.deletedAt);
    const outbound = new Map();
    const inbound = new Map();
    const unresolved = new Map();

    for (const note of active) {
        const targets = extractLinks(note.content || '');
        const resolvedIds = [];
        const misses = [];
        for (const target of targets) {
            const hit = resolveLinkTarget(active, target);
            // A note linking to itself is dropped: it is never useful as a
            // backlink and reads as noise in the panel.
            if (hit && hit.id !== note.id) resolvedIds.push(hit.id);
            else if (!hit) misses.push(target);
        }
        outbound.set(note.id, [...new Set(resolvedIds)]);
        if (misses.length) unresolved.set(note.id, [...new Set(misses)]);
    }

    for (const [fromId, targets] of outbound) {
        for (const toId of targets) {
            if (!inbound.has(toId)) inbound.set(toId, []);
            inbound.get(toId).push(fromId);
        }
    }

    return { outbound, inbound, unresolved };
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
        isValidTag,
        isTagOnlyLine,
        addTagToText,
        removeTagFromText,
        textHasTag,
        normaliseTitle,
        resolveLinkTarget,
        buildBacklinkIndex,
    };
}
