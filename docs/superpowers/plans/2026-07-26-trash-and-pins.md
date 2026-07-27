# Trash (Soft-Delete) + Pin/Star Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deleting a note moves it to a recoverable Trash instead of destroying it immediately, and notes can be pinned to the top of their list.

**Architecture:** Both features are additive fields (`deletedAt`, `pinned`) on the existing note object stored in `notebooks.json` via the existing `get-data`/`save-data` IPC handlers — no new IPC, no storage rewrite. Filtering/sorting logic is extracted into a small pure-function module (`note-utils.js`) shared between the browser (`<script>` tag, global functions) and Node's built-in test runner (CommonJS export), since `renderer.js` itself is DOM-coupled and not unit-testable without a browser.

**Tech Stack:** Vanilla JS, Node's built-in `node --test` (Node v26 already installed, no new dependency).

## Global Constraints

- No new npm dependencies (per this plan's scope — matches the project's existing "no bundler" approach).
- `contextIsolation: true` / `nodeIntegration: false` must remain unchanged (per project CLAUDE.md) — this plan adds zero new IPC surface, so this is automatically satisfied.
- Existing note shape `{ id, title, content, notebookId, created, updated, tags }` must remain backward compatible — old `notebooks.json` files without `deletedAt`/`pinned` must load correctly (default them on read).

---

### Task 1: `note-utils.js` pure filtering/sorting module

**Files:**
- Create: `note-utils.js` (project root, alongside `renderer.js`)
- Create: `tests/note-utils.test.js`
- Modify: `package.json:6-12` (add `"test": "node --test tests/"` to `scripts`)

**Interfaces:**
- Produces: `filterActiveNotes(notes)` → `Note[]` (excludes notes with a truthy `deletedAt`)
- Produces: `filterTrashedNotes(notes)` → `Note[]` (only notes with a truthy `deletedAt`)
- Produces: `sortPinnedFirst(notes)` → `Note[]` (new array, pinned notes first, otherwise stable order preserved)
- Produces: `withNoteDefaults(note)` → `Note` (returns a shallow copy with `deletedAt: note.deletedAt ?? null` and `pinned: note.pinned ?? false` filled in)

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/note-utils.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterActiveNotes,
  filterTrashedNotes,
  sortPinnedFirst,
  withNoteDefaults,
} = require('../note-utils');

test('filterActiveNotes excludes trashed notes', () => {
  const notes = [
    { id: '1', deletedAt: null },
    { id: '2', deletedAt: '2026-07-26T00:00:00.000Z' },
  ];
  assert.deepEqual(filterActiveNotes(notes).map(n => n.id), ['1']);
});

test('filterTrashedNotes returns only trashed notes', () => {
  const notes = [
    { id: '1', deletedAt: null },
    { id: '2', deletedAt: '2026-07-26T00:00:00.000Z' },
  ];
  assert.deepEqual(filterTrashedNotes(notes).map(n => n.id), ['2']);
});

test('sortPinnedFirst moves pinned notes to the front, preserving relative order', () => {
  const notes = [
    { id: '1', pinned: false },
    { id: '2', pinned: true },
    { id: '3', pinned: false },
    { id: '4', pinned: true },
  ];
  assert.deepEqual(sortPinnedFirst(notes).map(n => n.id), ['2', '4', '1', '3']);
});

test('sortPinnedFirst does not mutate the input array', () => {
  const notes = [{ id: '1', pinned: false }, { id: '2', pinned: true }];
  const original = [...notes];
  sortPinnedFirst(notes);
  assert.deepEqual(notes, original);
});

test('withNoteDefaults fills in missing deletedAt and pinned', () => {
  const note = { id: '1', title: 'x' };
  assert.deepEqual(withNoteDefaults(note), { id: '1', title: 'x', deletedAt: null, pinned: false });
});

test('withNoteDefaults preserves existing deletedAt and pinned', () => {
  const note = { id: '1', deletedAt: '2026-07-26T00:00:00.000Z', pinned: true };
  assert.deepEqual(withNoteDefaults(note), note);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/note-utils.test.js`
Expected: FAIL — `Cannot find module '../note-utils'`

- [ ] **Step 3: Write the minimal implementation**

```javascript
// note-utils.js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/note-utils.test.js`
Expected: PASS — all 6 tests green

- [ ] **Step 5: Add the npm test script**

In `package.json`, inside `"scripts"` (currently lines 6-12), add:
```json
    "test": "node --test tests/",
```

- [ ] **Step 6: Commit**

```bash
git add note-utils.js tests/note-utils.test.js package.json
git commit -m "feat: add note-utils pure functions for trash/pin filtering and sorting"
```

---

### Task 2: Soft-delete + Trash view

**Files:**
- Modify: `index.html:39-49` (notebooks-container — add a "Trash" nav row)
- Modify: `renderer.js:475-485` (`deleteCurrentNote`) and surrounding note-management methods
- Modify: `renderer.js:183-201` region (`loadData`) to apply `withNoteDefaults`
- Modify: `renderer.js:570-575` (`getFilteredNotes`)
- Modify: `renderer.js:612-649` (`render`, `renderNotebooksList`, `renderNotesList`)
- Modify: `main.css` (add `.trash-nav-item`, `.note-item-trashed` styles near the existing `.notebook-item`/`.note-item` rules)

**Interfaces:**
- Consumes: `filterActiveNotes`, `filterTrashedNotes`, `withNoteDefaults` from Task 1 (`note-utils.js`)
- Produces: `this.viewingTrash: boolean` (new instance flag on the `app`/`NoteHub` class)
- Produces: `restoreNote(noteId)`, `permanentlyDeleteNote(noteId)`, `selectTrash()` (new methods, called from markup via `onclick="app.<method>(...)"`, matching the existing pattern used by `selectNotebook`/`selectNote`)

- [ ] **Step 1: Load `note-utils.js` in the browser**

In `index.html`, add before the existing `<script src="renderer.js"></script>` (line 126):
```html
    <script src="note-utils.js"></script>
    <script src="renderer.js"></script>
```

- [ ] **Step 2: Apply defaults on load**

Find `loadData()` in `renderer.js` (around line 183) and normalize every note on load:
```javascript
    async loadData() {
        this.data = await window.electron.getData();
        this.data.notes = this.data.notes.map(withNoteDefaults);
    }
```

- [ ] **Step 3: Add the Trash nav row to the sidebar**

In `index.html`, inside `.notebooks-container` (after the `.notebooks-list` div, line 48), add:
```html
                    <div class="trash-nav-item" id="trashNavItem" onclick="app.selectTrash()">
                        <span class="notebook-icon">🗑</span>
                        <span class="notebook-name">Trash</span>
                        <span class="notebook-count" id="trashCount">0</span>
                    </div>
```

- [ ] **Step 4: Add matching styles in `main.css`**

Near the existing `.notebook-item` rule, add:
```css
.trash-nav-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; margin-top: 4px; cursor: pointer;
    border-radius: 6px; color: var(--overlay1);
}
.trash-nav-item:hover { background: var(--surface0); }
.trash-nav-item.active { background: var(--surface1); color: var(--mauve); }
```

- [ ] **Step 5: Change delete to soft-delete, add restore/permanent-delete**

Replace `deleteCurrentNote()` (renderer.js:475-485):
```javascript
    async deleteCurrentNote() {
        if (!this.currentNote) return;

        const confirmed = confirm(`Move "${this.currentNote.title}" to Trash?`);
        if (!confirmed) return;

        this.currentNote.deletedAt = new Date().toISOString();
        this.currentNote = null;
        await this.saveData();
        this.render();
    }

    async restoreNote(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;
        note.deletedAt = null;
        await this.saveData();
        this.render();
    }

    async permanentlyDeleteNote(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;
        const confirmed = confirm(`Permanently delete "${note.title}"? This cannot be undone.`);
        if (!confirmed) return;
        this.data.notes = this.data.notes.filter(n => n.id !== noteId);
        if (this.currentNote && this.currentNote.id === noteId) this.currentNote = null;
        await this.saveData();
        this.render();
    }

    selectTrash() {
        this.viewingTrash = true;
        this.currentNotebook = null;
        this.currentNote = null;
        this.render();
    }
```

- [ ] **Step 6: Exclude trashed notes from normal views, and clear `viewingTrash` when picking a notebook/note**

In `getFilteredNotes()` (renderer.js:570-575):
```javascript
    getFilteredNotes() {
        const active = filterActiveNotes(this.data.notes);
        if (this.currentNotebook) {
            return active.filter(n => n.notebookId === this.currentNotebook.id);
        }
        return active;
    }
```

In `selectNotebook(notebookId)` and `selectNote(noteId)`, add `this.viewingTrash = false;` as the first line of each method.

- [ ] **Step 7: Render the Trash view**

Modify `renderNotesList()` (renderer.js:636-649) to branch on `this.viewingTrash`:
```javascript
    renderNotesList() {
        const notes = this.viewingTrash ? filterTrashedNotes(this.data.notes) : this.getFilteredNotes();
        this.renderNotesListWithData(notes);

        const headerTitle = document.getElementById('notesHeaderTitle');
        const notesCount = document.getElementById('notesCount');

        if (headerTitle) {
            headerTitle.textContent = this.viewingTrash ? 'Trash' : (this.currentNotebook ? this.currentNotebook.name : 'All Notes');
        }
        if (notesCount) {
            notesCount.textContent = notes.length.toString();
        }

        const trashCount = document.getElementById('trashCount');
        if (trashCount) trashCount.textContent = filterTrashedNotes(this.data.notes).length.toString();

        const trashNavItem = document.getElementById('trashNavItem');
        if (trashNavItem) trashNavItem.classList.toggle('active', this.viewingTrash);
    }
```

Modify `renderNotesListWithData(notes)` (renderer.js:651-689) so trashed items show Restore/Delete Forever instead of the normal click-to-open behavior — add this branch right after the `if (notes.length === 0)` empty-state block:
```javascript
        if (this.viewingTrash) {
            container.innerHTML = notes.map(note => `
                <div class="note-item note-item-trashed">
                    <div class="note-item-header">
                        <div class="note-item-title">${note.title}</div>
                    </div>
                    <div class="note-item-footer">
                        <button class="btn-icon" onclick="app.restoreNote('${note.id}')" title="Restore">↩ Restore</button>
                        <button class="btn-icon" onclick="app.permanentlyDeleteNote('${note.id}')" title="Delete Forever">🗑 Delete Forever</button>
                    </div>
                </div>
            `).join('');
            return;
        }
```

- [ ] **Step 8: Manual verification**

Run: `npm start`
1. Create a note, delete it — confirm it disappears from "All Notes" and the sidebar note count drops.
2. Click "Trash" in the sidebar — confirm the deleted note appears with Restore/Delete Forever buttons, and the trash count badge matches.
3. Click Restore — confirm the note reappears in "All Notes".
4. Delete it again, click "Delete Forever" — confirm it's gone from Trash permanently.
5. Quit and relaunch the app — confirm trash state persisted (still backed by `notebooks.json`).

- [ ] **Step 9: Commit**

```bash
git add index.html renderer.js main.css
git commit -m "feat: soft-delete notes to a recoverable Trash instead of destroying them"
```

---

### Task 3: Pin/star notes

**Files:**
- Modify: `renderer.js:651-689` (`renderNotesListWithData`) to add a pin toggle button and use `sortPinnedFirst`
- Modify: `main.css` (pin icon styling)

**Interfaces:**
- Consumes: `sortPinnedFirst` from Task 1 (`note-utils.js`)
- Produces: `togglePinNote(noteId)` (new method, called via `onclick="app.togglePinNote(...)"`)

- [ ] **Step 1: Add the toggle method**

In `renderer.js`, near `restoreNote`/`permanentlyDeleteNote` (added in Task 2), add:
```javascript
    async togglePinNote(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;
        note.pinned = !note.pinned;
        await this.saveData();
        this.renderNotesList();
    }
```

- [ ] **Step 2: Sort pinned notes first and add the pin button**

In `renderNotesList()` (modified in Task 2, Step 7), wrap the non-trash branch with sorting:
```javascript
        const notes = this.viewingTrash ? filterTrashedNotes(this.data.notes) : sortPinnedFirst(this.getFilteredNotes());
```

In `renderNotesListWithData(notes)`, inside the normal (non-trash) note item template, add a pin button next to the title (in `.note-item-header`, renderer.js around line 671-673):
```javascript
                    <div class="note-item-header">
                        <div class="note-item-title">${note.title}</div>
                        <button class="btn-icon note-pin-btn ${note.pinned ? 'pinned' : ''}"
                                onclick="event.stopPropagation(); app.togglePinNote('${note.id}')"
                                title="${note.pinned ? 'Unpin' : 'Pin'}">📌</button>
                    </div>
```
(`event.stopPropagation()` is required because `.note-item`'s own `onclick="app.selectNote(...)"` would otherwise also fire and open the note every time the pin button is clicked.)

- [ ] **Step 3: Add pin button styling**

In `main.css`, near `.note-item-header`:
```css
.note-pin-btn { opacity: 0.35; margin-left: auto; }
.note-pin-btn:hover, .note-pin-btn.pinned { opacity: 1; }
```

- [ ] **Step 4: Manual verification**

Run: `npm start`
1. Create three notes. Pin the second one — confirm it jumps to the top of the list.
2. Pin the third one too — confirm order is [pinned #3, pinned #2, unpinned #1] (most-recently-pinned first, since `sortPinnedFirst` preserves relative order and new pins are appended... verify actual order matches `sortPinnedFirst`'s stable-order guarantee from Task 1's test).
3. Unpin one — confirm it drops back to its place among unpinned notes.
4. Confirm clicking the pin icon does not also open/select the note (stopPropagation works).

- [ ] **Step 5: Commit**

```bash
git add renderer.js main.css
git commit -m "feat: pin/star notes to keep them at the top of the list"
```

## Out of scope (this plan)

- Note version history, backlinks/note-linking, attachments, encryption, sync backend, editor upgrade, theme presets, plugin tooling, mobile apps — each is its own follow-up plan per `docs/superpowers/specs/2026-07-26-notehub-v2-design.md`.
- Bulk operations (multi-select delete/restore) — not requested, YAGNI.
- Auto-purging Trash after N days — not requested; Trash is manual-only for now.
