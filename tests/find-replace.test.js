const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// find-replace.js is an IIFE that publishes window.NHFind. Only navigator and
// document/window listeners are touched at load time, so a small stub is enough
// to get at findMatches, which is the part with real edge cases.
function loadFind() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'find-replace.js'), 'utf8');
  const win = { app: null, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const doc = { addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null };
  new Function('window', 'navigator', 'document', 'CSS', src)(
    win, { platform: 'Linux x86_64' }, doc, undefined,
  );
  return win.NHFind;
}

const { findMatches } = loadFind();
const plain = { caseSensitive: false, wholeWord: false, regex: false };
const at = (text, query, opts = {}) =>
  findMatches(text, query, { ...plain, ...opts }).matches.map(m => [m.start, m.end]);

test('an empty query matches nothing', () => {
  assert.deepEqual(at('hello', ''), []);
});

test('plain search is case-insensitive by default', () => {
  assert.deepEqual(at('Hello hello HELLO', 'hello'), [[0, 5], [6, 11], [12, 17]]);
});

test('case sensitivity can be turned on', () => {
  assert.deepEqual(at('Hello hello', 'hello', { caseSensitive: true }), [[6, 11]]);
});

test('regex metacharacters are literal unless regex mode is on', () => {
  // Without escaping, "a.c" would match "abc" too.
  assert.deepEqual(at('a.c abc', 'a.c'), [[0, 3]]);
  assert.deepEqual(at('a.c abc', 'a.c', { regex: true }), [[0, 3], [4, 7]]);
});

test('whole word does not match inside a longer word', () => {
  assert.deepEqual(at('cat concatenate cat', 'cat', { wholeWord: true }), [[0, 3], [16, 19]]);
});

test('whole word combines with regex', () => {
  assert.deepEqual(at('log logs logging', 'log(s)?', { wholeWord: true, regex: true }),
    [[0, 3], [4, 8]]);
});

test('matches span lines', () => {
  assert.deepEqual(at('one\ntwo\nthree', 'two'), [[4, 7]]);
});

test('an invalid regex reports an error instead of throwing', () => {
  const result = findMatches('text', '(unclosed', { ...plain, regex: true });
  assert.deepEqual(result.matches, []);
  assert.ok(result.error, 'expected an error message for the bad pattern');
});

// A pattern able to match the empty string advances lastIndex by zero, so the
// scan loop would never terminate without an explicit bump.
test('a zero-width pattern terminates instead of hanging', () => {
  const result = findMatches('abc', 'x*', { ...plain, regex: true });
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches.length <= 10001, 'scan did not terminate');
});

test('a lookahead pattern also terminates', () => {
  const result = findMatches('aaa', '(?=a)', { ...plain, regex: true });
  assert.ok(result.matches.length > 0 && result.matches.length <= 10001);
});

test('the match cap bounds a pathological pattern', () => {
  const result = findMatches('a'.repeat(50000), 'a', { ...plain });
  assert.ok(result.matches.length <= 10001, `got ${result.matches.length}`);
});

test('capture groups are exposed for regex replacement', () => {
  const [match] = findMatches('2026-10-02', '(\\d{4})-(\\d{2})', { ...plain, regex: true }).matches;
  assert.equal(match.groups[1], '2026');
  assert.equal(match.groups[2], '10');
  assert.equal(match.groups[0], '2026-10');
});

test('matches are returned in document order', () => {
  const offsets = at('x a x b x', 'x');
  const starts = offsets.map(([s]) => s);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test('overlapping candidates advance past each match', () => {
  // "aa" in "aaaa" yields two non-overlapping matches, not three.
  assert.deepEqual(at('aaaa', 'aa'), [[0, 2], [2, 4]]);
});

test('the public surface is what the renderer and menus call', () => {
  const api = loadFind();
  for (const name of ['open', 'close', 'toggle', 'findMatches']) {
    assert.equal(typeof api[name], 'function', `NHFind.${name} must be a function`);
  }
});
