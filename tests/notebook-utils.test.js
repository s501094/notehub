const test = require('node:test');
const assert = require('node:assert/strict');
const { NOTEBOOK_PALETTE, nextNotebookColor, withNotebookDefaults } = require('../notebook-utils');

test('NOTEBOOK_PALETTE has 4 curated colors', () => {
  assert.equal(NOTEBOOK_PALETTE.length, 4);
  NOTEBOOK_PALETTE.forEach(c => assert.match(c, /^#[0-9a-f]{6}$/i));
});

test('nextNotebookColor cycles through the palette', () => {
  assert.equal(nextNotebookColor([]), NOTEBOOK_PALETTE[0]);
  assert.equal(nextNotebookColor([{}, {}]), NOTEBOOK_PALETTE[2]);
  assert.equal(nextNotebookColor([{}, {}, {}, {}]), NOTEBOOK_PALETTE[0]); // wraps around
});

test('withNotebookDefaults fills in missing color', () => {
  const notebook = { id: '1', name: 'Research' };
  const result = withNotebookDefaults(notebook, 0);
  assert.equal(result.color, NOTEBOOK_PALETTE[0]);
});

test('withNotebookDefaults preserves an existing color', () => {
  const notebook = { id: '1', name: 'Research', color: '#123456' };
  const result = withNotebookDefaults(notebook, 0);
  assert.equal(result.color, '#123456');
});
