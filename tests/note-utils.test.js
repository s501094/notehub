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
