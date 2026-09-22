const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdown, escapeHtml, snippetFromMarkdown } = require('../markdown-utils');

// parseMarkdown is the highest-risk function in the app: it renders every note
// the user owns, it is order-dependent throughout, and it is built from a stack
// of regexes where a change in one step routinely breaks another several steps
// away. These tests exist so that stack can be modified at all.
//
// Assertions deliberately check for the presence of specific substrings rather
// than exact whole-document equality. Whitespace between block elements is an
// implementation detail of the line-walking passes and changes for reasons that
// do not matter; what a heading, a checkbox or an emphasis run turns into does.

// ── Emphasis ───────────────────────────────────────────────────────────────
// The bug these guard against: `_` and `*` matching inside a word, which
// mangles hostnames, snake_case identifiers and Windows paths -- the single
// most common content in the notes this app was built for.

test('intra-word underscores are literal, not emphasis', () => {
  const out = parseMarkdown('USE1PRES1012_OsDisk_1_8d58aea8245f45ab9c5f557c75a6bedd');
  assert.ok(!out.includes('<em>'), 'hostname was italicised');
  assert.ok(out.includes('USE1PRES1012_OsDisk_1_8d58aea8245f45ab9c5f557c75a6bedd'));
});

test('intra-word asterisks are literal', () => {
  const out = parseMarkdown('a*b*c stays intact');
  assert.ok(!out.includes('<em>'));
});

test('Windows paths survive intact', () => {
  const out = parseMarkdown('C:\\Users\\a_b_c\\my_file_name.txt');
  assert.ok(!out.includes('<em>'));
  assert.ok(out.includes('my_file_name.txt'));
});

test('emphasis still works at word boundaries', () => {
  assert.ok(parseMarkdown('this is *emphasis* here').includes('<em>emphasis</em>'));
  assert.ok(parseMarkdown('this is _emphasis_ here').includes('<em>emphasis</em>'));
  assert.ok(parseMarkdown('**bold** at line start').includes('<strong>bold</strong>'));
  assert.ok(parseMarkdown('__bold__ too').includes('<strong>bold</strong>'));
  assert.ok(parseMarkdown('***both*** at once').includes('<strong><em>both</em></strong>'));
});

test('strikethrough renders', () => {
  assert.ok(parseMarkdown('~~gone~~ kept').includes('<del>gone</del>'));
});

// ── Lists ──────────────────────────────────────────────────────────────────

test('indentation produces real nesting', () => {
  const out = parseMarkdown('- parent\n  - child\n    - grandchild');
  // Two nested lists open inside the outer one.
  assert.equal((out.match(/<ul\b/g) || []).length, 3);
  // The nested list opens inside its parent item, not as a sibling of it.
  assert.ok(/<li>parent\s*<ul\b/.test(out), 'child list is not inside the parent item');
});

test('a blank line between items does not split the list', () => {
  const out = parseMarkdown('- one\n\n- two');
  assert.equal((out.match(/<ul\b/g) || []).length, 1);
});

test('a paragraph between lists does split them', () => {
  const out = parseMarkdown('- one\n\ntext here\n\n- two');
  assert.equal((out.match(/<ul\b/g) || []).length, 2);
  assert.ok(out.includes('<p>text here</p>'));
});

test('ordered lists are not merged across a paragraph', () => {
  const out = parseMarkdown('1. one\n\nmiddle\n\n2. two');
  assert.equal((out.match(/<ol\b/g) || []).length, 2);
});

test('ordered list preserves a non-1 start', () => {
  assert.ok(parseMarkdown('5. five\n6. six').includes('start="5"'));
});

test('switching marker type at one depth starts a new list', () => {
  const out = parseMarkdown('- bullet\n1. numbered');
  assert.ok(/<ul\b/.test(out) && /<ol\b/.test(out));
});

test('tabs and spaces nest equivalently', () => {
  const spaces = parseMarkdown('- a\n    - b');
  const tabs   = parseMarkdown('- a\n\t- b');
  assert.equal((spaces.match(/<ul\b/g) || []).length, (tabs.match(/<ul\b/g) || []).length);
});

// ── Task lists ─────────────────────────────────────────────────────────────
// data-task-index is a contract with wireTaskCheckboxes() in renderer.js: it
// counts task markers in the SOURCE to find the line a checkbox maps to. If
// the two disagree about which markers count, or about their order, clicking
// one checkbox toggles a different task.

test('all bullet markers produce checkboxes', () => {
  for (const marker of ['-', '*', '+']) {
    const out = parseMarkdown(`${marker} [ ] task`);
    assert.ok(out.includes('type="checkbox"'), `${marker} [ ] did not become a checkbox`);
  }
  assert.ok(parseMarkdown('1. [ ] task').includes('type="checkbox"'));
});

test('checked state is recognised in either case', () => {
  assert.ok(parseMarkdown('- [x] done').includes('checked'));
  assert.ok(parseMarkdown('- [X] done').includes('checked'));
  assert.ok(!parseMarkdown('- [ ] open').includes('checked'));
});

test('task indices are sequential in document order regardless of state', () => {
  const out = parseMarkdown('- [x] a\n- [ ] b\n- [x] c\n- [ ] d');
  const indices = [...out.matchAll(/data-task-index="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(indices, [0, 1, 2, 3]);
});

test('nested tasks are numbered in document order too', () => {
  const out = parseMarkdown('- [ ] a\n  - [ ] b\n- [ ] c');
  const indices = [...out.matchAll(/data-task-index="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(indices, [0, 1, 2]);
});

test('a task inside a fenced block is not a checkbox', () => {
  // The source-side scan in renderer.js skips fences. If the parser counted
  // this one, every index after the fence would point at the wrong line.
  const out = parseMarkdown('- [ ] real\n\n```\n- [ ] not real\n```\n\n- [ ] also real');
  const indices = [...out.matchAll(/data-task-index="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(indices, [0, 1]);
});

test('the same marker regex matches on both sides of the checkbox contract', () => {
  // Mirrors TASK_RE in wireTaskCheckboxes(). Kept here so a change to the
  // accepted markers on one side fails loudly rather than silently mis-mapping.
  const SOURCE_SCAN = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/;
  const lines = ['- [ ] a', '* [x] b', '+ [ ] c', '1. [ ] d', '  - [x] e'];
  lines.forEach(line => {
    assert.ok(SOURCE_SCAN.test(line), `source scan missed: ${line}`);
    assert.ok(parseMarkdown(line).includes('type="checkbox"'), `parser missed: ${line}`);
  });
});

// ── Code ───────────────────────────────────────────────────────────────────

test('fenced code is not interpreted as markdown', () => {
  const out = parseMarkdown('```\n# not a heading\n*not emphasis*\n```');
  assert.ok(!out.includes('<h1>'));
  assert.ok(!out.includes('<em>'));
});

test('inline code is not interpreted as markdown', () => {
  const out = parseMarkdown('use `a_b_c` here');
  assert.ok(!out.includes('<em>'));
});

test('angle brackets inside code stay literal', () => {
  assert.ok(parseMarkdown('`<script>`').includes('&lt;script&gt;'));
});

// ── Headings ───────────────────────────────────────────────────────────────

test('ATX headings render at every level', () => {
  for (let n = 1; n <= 6; n++) {
    const out = parseMarkdown(`${'#'.repeat(n)} Title`);
    assert.ok(new RegExp(`<h${n}\\b[^>]*>Title</h${n}>`).test(out), `h${n} did not render`);
  }
});

test('setext headings are recognised', () => {
  assert.ok(/<h1\b[^>]*>Title<\/h1>/.test(parseMarkdown('Title\n=====')));
  assert.ok(/<h2\b[^>]*>Title<\/h2>/.test(parseMarkdown('Title\n-----')));
});

test('a standalone rule is still a rule, not a setext underline', () => {
  const out = parseMarkdown('para one\n\n---\n\npara two');
  assert.ok(/<hr\b/.test(out), 'freestanding --- was swallowed as a heading');
});

// ── Blockquotes ────────────────────────────────────────────────────────────

test('consecutive quote lines form one blockquote', () => {
  const out = parseMarkdown('> line one\n> line two');
  assert.equal((out.match(/<blockquote\b/g) || []).length, 1);
});

test('quotes nest by marker depth', () => {
  const out = parseMarkdown('> outer\n>> inner');
  assert.equal((out.match(/<blockquote\b/g) || []).length, 2);
});

test('a non-quote line closes the quote', () => {
  const out = parseMarkdown('> quoted\n\nplain');
  assert.equal((out.match(/<blockquote\b/g) || []).length, 1);
  assert.ok(out.includes('<p>plain</p>'));
});

// ── Links and images ───────────────────────────────────────────────────────

test('explicit links render once', () => {
  const out = parseMarkdown('[docs](https://example.com)');
  assert.equal((out.match(/<a /g) || []).length, 1, 'link was wrapped twice');
  assert.ok(out.includes('href="https://example.com"'));
});

test('bare URLs autolink', () => {
  const out = parseMarkdown('see https://example.com/a_b for detail');
  assert.ok(out.includes('href="https://example.com/a_b"'));
});

test('autolinking does not eat trailing sentence punctuation', () => {
  const out = parseMarkdown('go to https://example.com.');
  assert.ok(out.includes('href="https://example.com"'), 'trailing period was absorbed');
});

test('angle-bracket autolinks work despite HTML escaping', () => {
  assert.ok(parseMarkdown('<https://example.com>').includes('href="https://example.com"'));
});

test('images render before links and keep their reference', () => {
  const out = parseMarkdown('![alt](notehub-attachment:abc.png)');
  assert.ok(out.includes('<img'));
  assert.ok(out.includes('src="notehub-attachment:abc.png"'));
  assert.ok(!out.includes('<a '), 'image was also treated as a link');
});

test('links carry rel=noopener', () => {
  // window.opener access from a target=_blank link is a real escape hatch out
  // of the renderer's isolation guarantees.
  assert.ok(parseMarkdown('[x](https://e.com)').includes('rel="noopener noreferrer"'));
});

// ── Tables ─────────────────────────────────────────────────────────────────

test('pipe tables render with alignment', () => {
  const out = parseMarkdown('| a | b |\n|:--|--:|\n| 1 | 2 |');
  assert.ok(out.includes('<table'));
  assert.ok(out.includes('text-align:left'));
  assert.ok(out.includes('text-align:right'));
});

// ── Escaping ───────────────────────────────────────────────────────────────

test('raw HTML in note content is escaped', () => {
  const out = parseMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img src=x'), 'raw HTML survived into the preview');
  assert.ok(out.includes('&lt;img'));
});

test('escapeHtml covers the delimiters that matter', () => {
  assert.equal(escapeHtml('<&>'), '&lt;&amp;&gt;');
});

// ── Snippets ───────────────────────────────────────────────────────────────

test('snippet strips image embeds rather than showing the filename', () => {
  const out = snippetFromMarkdown('![image-1787168284682.png](data:image/png;base64,AAAA)\nreal text');
  assert.ok(!out.includes('image-1787168284682'));
  assert.ok(out.includes('real text'));
});

test('snippet strips structural markers', () => {
  const out = snippetFromMarkdown('# Title\n- [ ] a task\n> quoted\n**bold**');
  assert.equal(out, 'Title a task quoted bold');
});

test('snippet respects its length limit', () => {
  const out = snippetFromMarkdown('x'.repeat(500), 50);
  assert.ok(out.length <= 51, `snippet was ${out.length} chars`);
  assert.ok(out.endsWith('\u2026'));
});

// ── Regression guards ──────────────────────────────────────────────────────

test('an empty document does not throw', () => {
  assert.doesNotThrow(() => parseMarkdown(''));
  assert.doesNotThrow(() => parseMarkdown(null));
});

test('an unterminated fence does not hang or throw', () => {
  assert.doesNotThrow(() => parseMarkdown('```\nno closing fence'));
});

test('a realistic mixed note renders every construct', () => {
  const note = [
    '# Todo Tasks',
    '',
    '- [x] sql upgrade for frpapres912 reach out to frank doher DBA',
    '- [ ] check to see 13935 still need?',
    '* backup for 1014 is good, ASR appears to be good',
    '',
    'The data change rate for USE1PRES1012_OsDisk_1_8d58aea8245f45ab9c5f557c75a6bedd exceeded limits.',
    '',
    '- current disk storage is 2TB,',
    '  - [ ] nested follow-up',
    '',
    '1. USE1PRES1573 = Axis Gridlink',
  ].join('\n');
  const out = parseMarkdown(note);

  assert.ok(/<h1\b[^>]*>Todo Tasks<\/h1>/.test(out));
  assert.ok(out.includes('USE1PRES1012_OsDisk_1_8d58aea8245f45ab9c5f557c75a6bedd'));
  assert.ok(!out.includes('<em>'), 'the hostname was italicised again');
  assert.equal((out.match(/data-task-index/g) || []).length, 3);
  assert.ok(/<ol\b/.test(out), 'the ordered item did not become a list');
  assert.ok(/<li>current disk storage is 2TB,\s*<ul\b/.test(out), 'nesting was flattened');
});

// ── Source-line anchors ────────────────────────────────────────────────────
// Block elements carry the source line they came from, so split-view scroll
// sync can map editor position to preview position exactly rather than by
// proportion. Every pass that could change the line count is padded to keep
// these honest -- fenced code, tables and the list builder especially.

test('block elements carry a source line', () => {
  const out = parseMarkdown('# One\n\nsecond para');
  assert.ok(out.includes('data-src-line="0"'), 'heading has no anchor');
});

test('anchors survive a fenced code block without drifting', () => {
  const out = parseMarkdown('# H\n\n```\na\nb\nc\n```\n\n## After');
  // '## After' is the 9th line (index 8) of the source.
  assert.ok(/<h2\b[^>]*data-src-line="8"/.test(out),
    `heading after a fence drifted: ${out.match(/<h2[^>]*>/)}`);
});

test('anchors survive a table without drifting', () => {
  const src = '# H\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## After';
  const out = parseMarkdown(src);
  assert.ok(/<h2\b[^>]*data-src-line="6"/.test(out),
    `heading after a table drifted: ${out.match(/<h2[^>]*>/)}`);
});

test('anchors survive a list without drifting', () => {
  const src = '# H\n\n- a\n- b\n  - c\n\n## After';
  const out = parseMarkdown(src);
  assert.ok(/<h2\b[^>]*data-src-line="6"/.test(out),
    `heading after a list drifted: ${out.match(/<h2[^>]*>/)}`);
});

test('anchors are monotonically increasing', () => {
  const src = '# A\n\npara\n\n- x\n- y\n\n> quote\n\n## B\n\nlast';
  const out = parseMarkdown(src);
  const lines = [...out.matchAll(/data-src-line="(\d+)"/g)].map(m => Number(m[1]));
  const sorted = [...lines].sort((a, b) => a - b);
  assert.deepEqual(lines, sorted, `anchors out of order: ${lines}`);
  assert.ok(Math.max(...lines) < src.split('\n').length, 'an anchor points past the end');
});
