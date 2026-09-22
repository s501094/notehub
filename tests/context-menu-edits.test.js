const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A stand-in for the bits of CodeMirror 5's API that the markdown helpers in
// context-menu.js use. Enough to exercise selection wrapping, line prefixing
// and block insertion without a browser.
class FakeCM {
  constructor(text = '', selection = null) {
    this.lines = text.split('\n');
    // selection: { from: {line, ch}, to: {line, ch} } or null (cursor only)
    this.sel = selection || { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } };
    this.focused = false;
  }

  getValue() { return this.lines.join('\n'); }
  getLine(n) { return this.lines[n]; }
  lineCount() { return this.lines.length; }
  operation(fn) { return fn(); }
  focus() { this.focused = true; }

  getCursor(which) {
    if (which === 'from') return { ...this.sel.from };
    if (which === 'to') return { ...this.sel.to };
    return { ...this.sel.to };
  }

  setCursor(pos) { this.sel = { from: { ...pos }, to: { ...pos } }; }

  somethingSelected() {
    return this.sel.from.line !== this.sel.to.line || this.sel.from.ch !== this.sel.to.ch;
  }

  getSelection() {
    if (!this.somethingSelected()) return '';
    return this._slice(this.sel.from, this.sel.to);
  }

  replaceSelection(text) { this.replaceRange(text, this.sel.from, this.sel.to); }

  replaceRange(text, from, to) {
    const before = this._slice({ line: 0, ch: 0 }, from);
    const after = this._slice(to, { line: this.lines.length - 1, ch: this.lines[this.lines.length - 1].length });
    this.lines = (before + text + after).split('\n');
    const inserted = text.split('\n');
    const endLine = from.line + inserted.length - 1;
    const endCh = inserted.length === 1 ? from.ch + text.length : inserted[inserted.length - 1].length;
    this.sel = { from: { ...from }, to: { line: endLine, ch: endCh } };
  }

  _slice(from, to) {
    if (from.line === to.line) return this.lines[from.line].slice(from.ch, to.ch);
    const parts = [this.lines[from.line].slice(from.ch)];
    for (let i = from.line + 1; i < to.line; i++) parts.push(this.lines[i]);
    parts.push(this.lines[to.line].slice(0, to.ch));
    return parts.join('\n');
  }
}

// context-menu.js is an IIFE that publishes window.NHEdit. It only touches
// navigator and window at load time; document is used lazily inside handlers.
function loadEditHelpers(cm) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'context-menu.js'), 'utf8');
  const win = { app: { cm, config: { plugins: { enabled: [] } } }, addEventListener() {}, removeEventListener() {} };
  const sandbox = {
    window: win,
    navigator: { platform: 'Linux x86_64' },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {}, addEventListener() {} }) },
  };
  new Function('window', 'navigator', 'document', src)(sandbox.window, sandbox.navigator, sandbox.document);
  return win.NHEdit;
}

function withSelection(text, from, to) {
  const cm = new FakeCM(text, { from, to });
  return { cm, edit: loadEditHelpers(cm) };
}

// ── wrapSelection ──────────────────────────────────────────────────────────
test('wrapSelection wraps a selection', () => {
  const { cm, edit } = withSelection('hello world', { line: 0, ch: 0 }, { line: 0, ch: 5 });
  edit.wrapSelection('**', '**');
  assert.equal(cm.getValue(), '**hello** world');
});

test('wrapSelection unwraps an already-wrapped selection', () => {
  const { cm, edit } = withSelection('**hello** world', { line: 0, ch: 0 }, { line: 0, ch: 9 });
  edit.wrapSelection('**', '**');
  assert.equal(cm.getValue(), 'hello world');
});

test('wrapSelection inserts a placeholder when nothing is selected', () => {
  const { cm, edit } = withSelection('', { line: 0, ch: 0 }, { line: 0, ch: 0 });
  edit.wrapSelection('**', '**', 'bold');
  assert.equal(cm.getValue(), '**bold**');
});

test('wrapSelection writes the colour span the Format menu uses', () => {
  const { cm, edit } = withSelection('critical step', { line: 0, ch: 0 }, { line: 0, ch: 8 });
  edit.wrapSelection('<span style="color:#f38ba8">', '</span>', 'text');
  assert.equal(cm.getValue(), '<span style="color:#f38ba8">critical</span> step');
});

// ── prefixLines ────────────────────────────────────────────────────────────
test('prefixLines bullets every selected line', () => {
  const { cm, edit } = withSelection('one\ntwo\nthree', { line: 0, ch: 0 }, { line: 2, ch: 5 });
  edit.prefixLines('- ');
  assert.equal(cm.getValue(), '- one\n- two\n- three');
});

test('prefixLines toggles the prefix back off', () => {
  const { cm, edit } = withSelection('- one\n- two', { line: 0, ch: 0 }, { line: 1, ch: 5 });
  edit.prefixLines('- ');
  assert.equal(cm.getValue(), 'one\ntwo');
});

test('prefixLines renumbers an ordered list', () => {
  const { cm, edit } = withSelection('a\nb\nc', { line: 0, ch: 0 }, { line: 2, ch: 1 });
  edit.prefixLines('1. ', { numbered: true });
  assert.equal(cm.getValue(), '1. a\n2. b\n3. c');
});

test('prefixLines skips blank lines', () => {
  const { cm, edit } = withSelection('a\n\nb', { line: 0, ch: 0 }, { line: 2, ch: 1 });
  edit.prefixLines('> ');
  assert.equal(cm.getValue(), '> a\n\n> b');
});

test('prefixLines applies a heading level', () => {
  const { cm, edit } = withSelection('Title', { line: 0, ch: 0 }, { line: 0, ch: 5 });
  edit.prefixLines('## ');
  assert.equal(cm.getValue(), '## Title');
});

// ── insertTable / insertBlock ──────────────────────────────────────────────
test('insertTable emits a well-formed table with a trailing newline', () => {
  const { cm, edit } = withSelection('', { line: 0, ch: 0 }, { line: 0, ch: 0 });
  edit.insertTable(2, 3);
  const out = cm.getValue();
  assert.match(out, /\| Column 1 \| Column 2 \| Column 3 \|/);
  assert.match(out, /\| --- \| --- \| --- \|/);
  assert.equal(out.split('\n').filter(l => l.startsWith('|')).length, 4); // header + sep + 2 rows
  // parseMarkdown only closes a table on a trailing newline.
  assert.ok(out.endsWith('\n'), 'table must end with a newline to render');
});

test('insertBlock pads away from existing text', () => {
  const { cm, edit } = withSelection('some text', { line: 0, ch: 4 }, { line: 0, ch: 4 });
  edit.insertBlock('---');
  assert.equal(cm.getValue(), 'some text\n\n---\n');
});

// ── clearFormatting ────────────────────────────────────────────────────────
test('clearFormatting strips inline HTML and emphasis', () => {
  const text = '<span style="color:red">**bold**</span> and <mark>hl</mark>';
  const { cm, edit } = withSelection(text, { line: 0, ch: 0 }, { line: 0, ch: text.length });
  edit.clearFormatting();
  assert.equal(cm.getValue(), 'bold and hl');
});

test('clearFormatting is a no-op without a selection', () => {
  const { cm, edit } = withSelection('**bold**', { line: 0, ch: 0 }, { line: 0, ch: 0 });
  edit.clearFormatting();
  assert.equal(cm.getValue(), '**bold**');
});

// ── insertLink ─────────────────────────────────────────────────────────────
test('insertLink puts a selected URL in the target slot', () => {
  const { cm, edit } = withSelection('https://x.com', { line: 0, ch: 0 }, { line: 0, ch: 13 });
  edit.insertLink();
  assert.equal(cm.getValue(), '[](https://x.com)');
});

test('insertLink puts selected prose in the label slot', () => {
  const { cm, edit } = withSelection('click me', { line: 0, ch: 0 }, { line: 0, ch: 8 });
  edit.insertLink();
  assert.equal(cm.getValue(), '[click me](url)');
});

// ── The two halves agree ───────────────────────────────────────────────────
test('what the Format menu writes is what the parser renders', () => {
  const { parseMarkdown } = require('../markdown-utils');

  const written = [
    ['<span style="color:#f38ba8">', '</span>'],
    ['<mark style="background-color:#f9e2af">', '</mark>'],
    ['<span style="font-size:0.85em">', '</span>'],
    ['<span style="font-size:1.25em">', '</span>'],
    ['<span style="font-size:1.6em">', '</span>'],
    ['<mark>', '</mark>'],
    ['<u>', '</u>'],
  ];
  for (const [open, close] of written) {
    const { cm, edit } = withSelection('sample', { line: 0, ch: 0 }, { line: 0, ch: 6 });
    edit.wrapSelection(open, close, 'text');
    const html = parseMarkdown(cm.getValue());
    assert.ok(!html.includes('&lt;'), `parser rejected what the menu writes: ${cm.getValue()} -> ${html}`);
    assert.ok(html.includes('sample'), `content lost: ${html}`);
  }
});
