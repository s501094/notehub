const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ai-complete.js is a browser IIFE. tidy() is the part with real failure modes:
// models add preamble and fences however firmly the prompt forbids them, and they
// frequently echo the tail of the lead-in -- which, accepted verbatim, duplicates
// the words already in the note.
function loadComplete() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ai-complete.js'), 'utf8');
  const win = { app: null, electron: {}, addEventListener() {}, removeEventListener() {} };
  const doc = {
    getElementById: () => null,
    createElement: () => ({ className: '', appendChild() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null }),
    createTextNode: () => ({}),
    addEventListener() {},
  };
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearTimeout', src)(
    win, doc, () => 0, () => 0, () => {},
  );
  return win.NHComplete;
}

const { tidy } = loadComplete();

test('plain text passes through, trimmed', () => {
  assert.equal(tidy('  and then it finished.  ', 'The task started'), 'and then it finished.');
});

test('a wrapping code fence is removed', () => {
  assert.equal(tidy('```\ncontinued text\n```', 'lead in here'), 'continued text');
  assert.equal(tidy('```markdown\ncontinued text\n```', 'lead in here'), 'continued text');
});

test('conversational preamble is removed', () => {
  assert.equal(tidy("Here's the continuation: more words", 'lead in here'), 'more words');
  assert.equal(tidy('Here is how it continues: more words', 'lead in here'), 'more words');
  assert.equal(tidy('Continuation: more words', 'lead in here'), 'more words');
});

// The one that matters: an echoed lead-in would duplicate text already on screen.
test('an echoed tail of the lead-in is dropped', () => {
  const lead = 'The deployment process begins with';
  assert.equal(tidy('The deployment process begins with a health check.', lead), ' a health check.');
});

test('a partial echo is dropped at the overlap', () => {
  const lead = 'We agreed that the migration should';
  assert.equal(tidy('the migration should happen on Friday.', lead), ' happen on Friday.');
});

// The surviving leading space is deliberate, not sloppiness: the continuation is
// inserted at the cursor, which sits immediately after the lead-in, so a
// mid-sentence suggestion needs the separator. Trimming it would run words
// together on accept.
test('a single leading space is kept after stripping an echo', () => {
  const out = tidy('The quick brown fox jumps over', 'The quick brown fox');
  assert.match(out, /^ \S/, `expected one leading space, got ${JSON.stringify(out)}`);
  assert.ok(!/^\s\s/.test(out), 'expected exactly one leading space');
});

test('a coincidental short overlap is not stripped', () => {
  // Below the 8-character floor, so "the" surviving at the start is correct --
  // stripping it would mangle a legitimate continuation.
  const out = tidy('the next step is review.', 'Finish the');
  assert.match(out, /next step is review\./);
});

test('tidy tolerates empty and missing input', () => {
  for (const v of ['', null, undefined]) assert.equal(tidy(v, 'lead'), '');
});

test('internal newlines survive, so a multi-line suggestion stays multi-line', () => {
  assert.equal(tidy('first line\nsecond line', 'lead in here'), 'first line\nsecond line');
});

test('the public surface is what the keymap and palette call', () => {
  const api = loadComplete();
  for (const name of ['request', 'accept', 'clearGhost', 'tidy']) {
    assert.equal(typeof api[name], 'function', `NHComplete.${name} must be a function`);
  }
});
