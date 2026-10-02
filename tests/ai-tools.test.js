const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const noteUtils = require('../note-utils');
const { extractTags, snippetFromMarkdown, parseMarkdown } = require('../markdown-utils');

// ai-panel.js is a browser IIFE. The note tool handlers are the part worth
// testing without a UI: they are the only code path where the assistant can
// change a note, so a mistake here loses the user's writing.
function loadToolHandlers(data, { cm = null, currentNote = null, currentNotebook = null } = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ai-panel.js'), 'utf8');

  const saves = [];
  const app = {
    data,
    cm,
    currentNote,
    currentNotebook,
    async saveData() { saves.push(JSON.parse(JSON.stringify(data))); },
    render() {},
    renderNotesList() {},
    updatePreview() {},
    showToast() {},
    showModal() {},
    closeModal() {},
  };

  const win = {
    app,
    electron: { onAiToolCall() {}, onAiEvent() {}, aiToolResult: async () => ({}) },
    addEventListener() {},
    removeEventListener() {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  const doc = {
    readyState: 'complete',
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { classList: { add() {}, remove() {} } },
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }),
  };

  new Function(
    'window', 'navigator', 'document', 'localStorage', 'escapeHtml',
    'filterActiveNotes', 'snippetFromMarkdown', 'pushHistoryVersion',
    'extractTags', 'withNoteDefaults', 'parseMarkdown',
    src,
  )(
    win, { platform: 'Linux x86_64' }, doc, win.localStorage, (s) => String(s),
    noteUtils.filterActiveNotes, snippetFromMarkdown, noteUtils.pushHistoryVersion,
    extractTags, noteUtils.withNoteDefaults, parseMarkdown,
  );

  return { tools: win.NHAi._toolHandlers, app, saves };
}

const library = () => ({
  notebooks: [{ id: 'nb1', name: 'Work' }, { id: 'nb2', name: 'Personal' }],
  notes: [
    { id: 'n1', title: 'Runbook', content: 'Deploy steps #infra', notebookId: 'nb1', updated: '2026-01-01', tags: ['infra'], history: [] },
    { id: 'n2', title: 'Groceries', content: 'milk', notebookId: 'nb2', updated: '2026-01-02', tags: [], history: [] },
    { id: 'n3', title: 'Old', content: 'gone', notebookId: 'nb1', updated: '2026-01-03', deletedAt: '2026-02-01', history: [] },
  ],
});

test('list_notebooks counts only live notes', () => {
  const { tools } = loadToolHandlers(library());
  assert.deepEqual(tools.list_notebooks(), [
    { id: 'nb1', name: 'Work', notes: 1 },     // n3 is trashed
    { id: 'nb2', name: 'Personal', notes: 1 },
  ]);
});

test('search_notes matches title and body, and skips trashed notes', () => {
  const { tools } = loadToolHandlers(library());
  assert.deepEqual(tools.search_notes({ query: 'runbook' }).map(n => n.id), ['n1']);
  assert.deepEqual(tools.search_notes({ query: 'deploy' }).map(n => n.id), ['n1']);
  assert.deepEqual(tools.search_notes({ query: 'gone' }), []);
});

test('search_notes returns the shape the tool description promises', () => {
  const { tools } = loadToolHandlers(library());
  const [hit] = tools.search_notes({ query: 'milk' });
  assert.deepEqual(Object.keys(hit).sort(), ['id', 'notebook', 'snippet', 'tags', 'title'].sort());
  assert.equal(hit.notebook, 'Personal');
});

test('search_notes caps the result count', () => {
  const data = library();
  for (let i = 0; i < 80; i++) {
    data.notes.push({ id: `x${i}`, title: `match ${i}`, content: 'match', notebookId: 'nb1', updated: '2026-01-01', history: [] });
  }
  const { tools } = loadToolHandlers(data);
  assert.ok(tools.search_notes({ query: 'match', limit: 999 }).length <= 50);
});

test('search_notes ignores an empty query instead of returning everything', () => {
  const { tools } = loadToolHandlers(library());
  assert.deepEqual(tools.search_notes({ query: '  ' }), []);
});

test('read_note returns the body, and reports a bad id rather than throwing', () => {
  const { tools } = loadToolHandlers(library());
  assert.equal(tools.read_note({ id: 'n1' }).content, 'Deploy steps #infra');
  assert.ok(tools.read_note({ id: 'nope' }).error);
  assert.ok(tools.read_note({ id: 'n3' }).error, 'a trashed note is not readable');
});

// The important one: an AI edit must be recoverable.
test('edit_note snapshots the previous body into history', async () => {
  const data = library();
  const { tools } = loadToolHandlers(data);
  await tools.edit_note({ id: 'n1', content: 'replaced entirely' });

  const note = data.notes.find(n => n.id === 'n1');
  assert.equal(note.content, 'replaced entirely');
  assert.equal(note.history.length, 1, 'expected one restorable version');
  assert.equal(note.history[0].content, 'Deploy steps #infra');
});

test('edit_note snapshots even for rapid successive edits', async () => {
  // force: true on the snapshot bypasses the time gap that stops autosave
  // creating a version per keystroke -- without it, two AI edits in the same
  // minute would leave the first body unrecoverable.
  const data = library();
  const { tools } = loadToolHandlers(data);
  await tools.edit_note({ id: 'n1', content: 'first' });
  await tools.edit_note({ id: 'n1', content: 'second' });
  const note = data.notes.find(n => n.id === 'n1');
  assert.equal(note.history.length, 2);
  assert.deepEqual(note.history.map(h => h.content), ['first', 'Deploy steps #infra']);
});

test('edit_note refreshes the derived tag cache', async () => {
  const data = library();
  const { tools } = loadToolHandlers(data);
  await tools.edit_note({ id: 'n1', content: 'now about #ops and #q4' });
  assert.deepEqual(data.notes.find(n => n.id === 'n1').tags, ['ops', 'q4']);
});

test('edit_note rejects a non-string body instead of corrupting the note', async () => {
  const data = library();
  const { tools } = loadToolHandlers(data);
  const result = await tools.edit_note({ id: 'n1', content: { not: 'a string' } });
  assert.ok(result.error);
  assert.equal(data.notes.find(n => n.id === 'n1').content, 'Deploy steps #infra');
});

test('edit_note reports a bad id without touching anything', async () => {
  const data = library();
  const before = JSON.stringify(data);
  const { tools } = loadToolHandlers(data);
  assert.ok((await tools.edit_note({ id: 'nope', content: 'x' })).error);
  assert.equal(JSON.stringify(data), before);
});

// The open note is also live in CodeMirror, whose buffer would otherwise
// overwrite the edit on the next autosave.
test('edit_note pushes into the editor when the note is open', async () => {
  const data = library();
  const cmValue = { current: 'Deploy steps #infra' };
  const cm = {
    getValue: () => cmValue.current,
    setValue: (v) => { cmValue.current = v; },
    getCursor: () => ({ line: 0, ch: 0 }),
    setCursor() {},
  };
  const currentNote = data.notes[0];
  const { tools } = loadToolHandlers(data, { cm, currentNote });
  await tools.edit_note({ id: 'n1', content: 'from the assistant' });
  assert.equal(cmValue.current, 'from the assistant', 'CodeMirror still held the stale body');
  assert.equal(currentNote.content, 'from the assistant');
});

test('append_to_note keeps the existing body', async () => {
  const data = library();
  const { tools } = loadToolHandlers(data);
  await tools.append_to_note({ id: 'n2', markdown: '- eggs' });
  const note = data.notes.find(n => n.id === 'n2');
  assert.match(note.content, /^milk/);
  assert.match(note.content, /- eggs$/);
});

test('append_to_note does not double up newlines', async () => {
  const data = library();
  data.notes[1].content = 'milk\n';
  const { tools } = loadToolHandlers(data);
  await tools.append_to_note({ id: 'n2', markdown: 'eggs' });
  assert.ok(!/\n\n\n/.test(data.notes.find(n => n.id === 'n2').content));
});

test('create_note lands in the current notebook and returns its id', async () => {
  const data = library();
  const { tools } = loadToolHandlers(data, { currentNotebook: { id: 'nb2' } });
  const result = await tools.create_note({ title: 'New', content: 'body #tagged' });
  assert.ok(result.ok);
  const made = data.notes.find(n => n.id === result.id);
  assert.equal(made.notebookId, 'nb2');
  assert.deepEqual(made.tags, ['tagged']);
});

test('create_note reports when there is no notebook to put it in', async () => {
  const { tools } = loadToolHandlers({ notebooks: [], notes: [] });
  assert.ok((await tools.create_note({ title: 'x', content: 'y' })).error);
});

test('every write tool persists through saveData', async () => {
  const data = library();
  const { tools, saves } = loadToolHandlers(data, { currentNotebook: { id: 'nb1' } });
  await tools.edit_note({ id: 'n1', content: 'a' });
  await tools.append_to_note({ id: 'n2', markdown: 'b' });
  await tools.create_note({ title: 'c', content: 'd' });
  assert.equal(saves.length, 3, 'a write that does not save is lost on quit');
});
