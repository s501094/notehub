const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterActiveNotes,
  filterTrashedNotes,
  sortPinnedFirst,
  withNoteDefaults,
  pushHistoryVersion,
  historyEntryStats,
  moveItem,
  samePinGroup,
  HISTORY_LIMIT,
  MIN_SNAPSHOT_GAP_MS,
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
  assert.deepEqual(withNoteDefaults(note), { id: '1', title: 'x', deletedAt: null, pinned: false, history: [] });
});

test('withNoteDefaults preserves existing deletedAt and pinned', () => {
  const note = { id: '1', deletedAt: '2026-07-26T00:00:00.000Z', pinned: true, history: [] };
  assert.deepEqual(withNoteDefaults(note), note);
});

// ── Version history ────────────────────────────────────────────────────────

test('withNoteDefaults gives notes an empty history array', () => {
  assert.deepEqual(withNoteDefaults({ id: '1' }).history, []);
  assert.deepEqual(withNoteDefaults({ id: '1', history: null }).history, []);
  const existing = [{ content: 'old', savedAt: '2026-08-01T00:00:00.000Z' }];
  assert.deepEqual(withNoteDefaults({ id: '1', history: existing }).history, existing);
});

test('pushHistoryVersion snapshots the previous content, newest first', () => {
  const note = { content: 'v1', updated: '2026-08-19T10:00:00.000Z', history: [] };
  const history = pushHistoryVersion(note, 'v2', { now: Date.parse('2026-08-19T10:00:05.000Z') });
  assert.deepEqual(history, [{ content: 'v1', savedAt: '2026-08-19T10:00:00.000Z' }]);
});

test('pushHistoryVersion is a no-op when the content is unchanged', () => {
  const note = { content: 'same', updated: '2026-08-19T10:00:00.000Z', history: [] };
  assert.deepEqual(pushHistoryVersion(note, 'same', { now: Date.now() }), []);
});

test('pushHistoryVersion throttles snapshots within the minimum gap', () => {
  const prior = [{ content: 'v1', savedAt: '2026-08-19T10:00:00.000Z' }];
  const note = { content: 'v2', updated: '2026-08-19T10:00:30.000Z', history: prior };
  const tooSoon = Date.parse('2026-08-19T10:00:30.000Z');
  assert.deepEqual(pushHistoryVersion(note, 'v3', { now: tooSoon }), prior);

  const later = Date.parse('2026-08-19T10:00:00.000Z') + MIN_SNAPSHOT_GAP_MS + 1;
  assert.equal(pushHistoryVersion(note, 'v3', { now: later }).length, 2);
});

test('pushHistoryVersion force bypasses the throttle (restore must not lose content)', () => {
  const prior = [{ content: 'v1', savedAt: '2026-08-19T10:00:00.000Z' }];
  const note = { content: 'v2', updated: '2026-08-19T10:00:30.000Z', history: prior };
  const tooSoon = Date.parse('2026-08-19T10:00:30.000Z');
  const history = pushHistoryVersion(note, 'v3', { now: tooSoon, force: true });
  assert.equal(history.length, 2);
  assert.equal(history[0].content, 'v2');
});

test('pushHistoryVersion caps history at HISTORY_LIMIT, dropping the oldest', () => {
  const prior = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({
    content: `old-${i}`,
    savedAt: '2026-08-01T00:00:00.000Z',
  }));
  const note = { content: 'newest', updated: '2026-08-19T10:00:00.000Z', history: prior };
  const history = pushHistoryVersion(note, 'newer', { now: Date.parse('2026-08-19T10:00:00.000Z') });
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0].content, 'newest');
  assert.equal(history[HISTORY_LIMIT - 1].content, `old-${HISTORY_LIMIT - 2}`);
});

test('pushHistoryVersion tolerates a missing history array', () => {
  const note = { content: 'v1', updated: '2026-08-19T10:00:00.000Z' };
  assert.equal(pushHistoryVersion(note, 'v2', { now: Date.now() }).length, 1);
});

test('historyEntryStats counts words, chars and lines', () => {
  assert.deepEqual(historyEntryStats({ content: 'hello world\nsecond line' }),
    { words: 4, chars: 23, lines: 2 });
  assert.deepEqual(historyEntryStats({ content: '' }), { words: 0, chars: 0, lines: 0 });
  assert.deepEqual(historyEntryStats(null), { words: 0, chars: 0, lines: 0 });
});

// ── Drag reorder ───────────────────────────────────────────────────────────

test('moveItem moves an item forward to the target position', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(moveItem(list, 'a', 'c').map(x => x.id), ['b', 'c', 'a', 'd']);
});

test('moveItem moves an item backward to the target position', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(moveItem(list, 'd', 'b').map(x => x.id), ['a', 'd', 'b', 'c']);
});

test('moveItem does not mutate the input', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  const before = list.map(x => x.id);
  moveItem(list, 'b', 'a');
  assert.deepEqual(list.map(x => x.id), before);
});

test('moveItem is a no-op for unknown or identical ids', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  assert.equal(moveItem(list, 'a', 'a'), list);
  assert.equal(moveItem(list, 'a', 'zzz'), list);
  assert.equal(moveItem(list, 'zzz', 'a'), list);
});

test('moveItem tolerates a non-array', () => {
  assert.equal(moveItem(null, 'a', 'b'), null);
});

test('samePinGroup only pairs notes displayed in the same group', () => {
  assert.equal(samePinGroup({ pinned: true }, { pinned: true }), true);
  assert.equal(samePinGroup({ pinned: false }, {}), true);        // undefined === unpinned
  assert.equal(samePinGroup({ pinned: true }, { pinned: false }), false);
  assert.equal(samePinGroup(null, { pinned: true }), false);
});
