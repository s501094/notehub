const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUnifiedDiff, hunksToSideBySide } = require('../plugins/git-integration/git-diff-utils');

test('parseUnifiedDiff extracts hunk header fields and classifies lines', () => {
  const diff = [
    'diff --git a/renderer.js b/renderer.js',
    'index abc123..def456 100644',
    '--- a/renderer.js',
    '+++ b/renderer.js',
    '@@ -1,3 +1,3 @@',
    ' function old() {',
    '-  return 1;',
    '+  return 2;',
    ' }',
    '',
  ].join('\n');

  const hunks = parseUnifiedDiff(diff);
  assert.equal(hunks.length, 1);
  assert.deepEqual(
    { oldStart: hunks[0].oldStart, oldLines: hunks[0].oldLines, newStart: hunks[0].newStart, newLines: hunks[0].newLines },
    { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 }
  );
  assert.deepEqual(hunks[0].lines, [
    { type: 'context', text: 'function old() {' },
    { type: 'removed', text: '  return 1;' },
    { type: 'added',   text: '  return 2;' },
    { type: 'context', text: '}' },
  ]);
});

test('parseUnifiedDiff returns empty array for empty input', () => {
  assert.deepEqual(parseUnifiedDiff(''), []);
  assert.deepEqual(parseUnifiedDiff(null), []);
});

test('hunksToSideBySide pairs a removed line with its replacement', () => {
  const hunks = [{
    oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
    lines: [
      { type: 'context', text: 'function old() {' },
      { type: 'removed', text: '  return 1;' },
      { type: 'added',   text: '  return 2;' },
      { type: 'context', text: '}' },
    ],
  }];

  assert.deepEqual(hunksToSideBySide(hunks), [
    { left: { type: 'context', text: 'function old() {' }, right: { type: 'context', text: 'function old() {' } },
    { left: { type: 'removed', text: '  return 1;' },       right: { type: 'added',   text: '  return 2;' } },
    { left: { type: 'context', text: '}' },                 right: { type: 'context', text: '}' } },
  ]);
});

test('hunksToSideBySide leaves the left side blank for an added-only run', () => {
  const hunks = [{
    oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
    lines: [
      { type: 'context', text: 'function old() {' },
      { type: 'added',   text: "  console.log('new');" },
      { type: 'context', text: '}' },
    ],
  }];

  assert.deepEqual(hunksToSideBySide(hunks), [
    { left: { type: 'context', text: 'function old() {' }, right: { type: 'context', text: 'function old() {' } },
    { left: null, right: { type: 'added', text: "  console.log('new');" } },
    { left: { type: 'context', text: '}' }, right: { type: 'context', text: '}' } },
  ]);
});

test('hunksToSideBySide leaves the right side blank for a removed-only run', () => {
  const hunks = [{
    oldStart: 1, oldLines: 3, newStart: 1, newLines: 2,
    lines: [
      { type: 'context', text: 'function old() {' },
      { type: 'removed', text: "  console.log('old');" },
      { type: 'context', text: '}' },
    ],
  }];

  assert.deepEqual(hunksToSideBySide(hunks), [
    { left: { type: 'context', text: 'function old() {' }, right: { type: 'context', text: 'function old() {' } },
    { left: { type: 'removed', text: "  console.log('old');" }, right: null },
    { left: { type: 'context', text: '}' }, right: { type: 'context', text: '}' } },
  ]);
});

test('hunksToSideBySide pads the shorter side when run lengths differ', () => {
  const hunks = [{
    oldStart: 1, oldLines: 1, newStart: 1, newLines: 2,
    lines: [
      { type: 'removed', text: 'one line' },
      { type: 'added',   text: 'first new line' },
      { type: 'added',   text: 'second new line' },
    ],
  }];

  assert.deepEqual(hunksToSideBySide(hunks), [
    { left: { type: 'removed', text: 'one line' }, right: { type: 'added', text: 'first new line' } },
    { left: null, right: { type: 'added', text: 'second new line' } },
  ]);
});
