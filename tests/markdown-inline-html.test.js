const test = require('node:test');
const assert = require('node:assert/strict');

// markdown-utils.js is a plain CommonJS module, so the parser can be required
// directly -- no DOM and no Electron bridge needed.
const { parseMarkdown } = require('../markdown-utils');

// Tags parseMarkdown is allowed to emit: its own block markup plus the inline
// allowlist. Escaped text contains no '<', so every match here is a tag that
// will really reach the DOM.
const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'code',
  'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong',
  'em', 'del', 'a', 'img', 'div', 'span', 'mark', 'u', 'sub', 'sup', 'kbd', 'small',
  'br', 'wbr',
]);

function auditTags(html) {
  const problems = [];
  const re = /<(\/?[a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[1].replace(/^\//, '').toLowerCase();
    const attrs = m[2] || '';
    if (!ALLOWED_TAGS.has(name)) problems.push(`disallowed tag <${m[1]}>`);
    if (/\son[a-z]+\s*=/i.test(attrs)) problems.push(`event handler on <${name}>`);
    if (/javascript\s*:/i.test(attrs)) problems.push(`javascript: URI on <${name}>`);
    if (/expression\s*\(|behavior\s*:|url\s*\(/i.test(attrs)) problems.push(`css escape on <${name}>`);
  }
  return problems;
}

// ── Inline HTML that the Format context menu writes ────────────────────────
const ACCEPTED = [
  ['hex colour',        'A <span style="color:#f38ba8">red</span> word', 'color:#f38ba8'],
  ['rgb() colour',      '<span style="color:rgb(243, 139, 168)">x</span>', 'rgb(243, 139, 168)'],
  ['named colour',      '<span style="color:rebeccapurple">x</span>', 'rebeccapurple'],
  ['relative size',     '<span style="font-size:1.6em">x</span>', 'font-size:1.6em'],
  ['two declarations',  '<span style="color:#a6e3a1;font-size:0.85em">x</span>', 'font-size:0.85em'],
  ['bare mark',         'a <mark>hl</mark> b', '<mark>'],
  ['coloured mark',     '<mark style="background-color:#f9e2af">x</mark>', 'background-color:#f9e2af'],
  ['underline',         '<u>x</u>', '<u>'],
  ['line break',        'a<br>b', '<br>'],
  ['self-closing span', 'a<span style="color:red"/>b', '<span style="color:red">'],
  ['nested inline',     '<span style="color:red">a <mark>b</mark> c</span>', '<mark>'],
  ['inside a heading',  '## A <span style="color:#f38ba8">red</span> head', /<h2[^>]*>/],
  ['inside a table',    '| a |\n| --- |\n| <span style="color:#89b4fa">x</span> |\n', '<td'],
  ['inside a list',     '- i <span style="color:#a6e3a1">g</span>', /<li[^>]*>/],
  ['combined with **',  '**<span style="color:#f38ba8">br</span>**', '<strong>'],
];

for (const [name, input, expected] of ACCEPTED) {
  test(`allowlist renders ${name}`, () => {
    const out = parseMarkdown(input);
    assert.deepEqual(auditTags(out), [], `unexpected markup in: ${out}`);
    const found = expected instanceof RegExp ? expected.test(out) : out.includes(expected);
    assert.ok(found, `expected ${expected} in: ${out}`);
  });
}

// Anything outside the allowlist stays escaped and shows up literally -- the
// right feedback for a typo, and the reason no sanitizer is needed downstream.
const REJECTED = [
  ['an event handler',        '<span onerror="alert(1)">x</span>'],
  ['a handler beside style',  '<span style="color:red" onmouseover="alert(1)">x</span>'],
  ['a script tag',            '<script>alert(1)</script>'],
  ['img onerror',             '<img src=x onerror="alert(1)">'],
  ['svg onload',              '<svg onload="alert(1)"></svg>'],
  ['a javascript: iframe',    '<iframe src="javascript:alert(1)"></iframe>'],
  ['css url()',               '<span style="background:url(javascript:alert(1))">x</span>'],
  ['css expression()',        '<span style="width:expression(alert(1))">x</span>'],
  ['css behavior',            '<span style="behavior:url(#x)">x</span>'],
  ['an unquoted style',       '<span style=color:red>x</span>'],
  ['an out-of-range size',    '<span style="font-size:9000px">x</span>'],
  ['a block-level tag',       '<div style="color:red">x</div>'],
  ['any other attribute',     '<span class="evil">x</span>'],
  ['an orphan close tag',     'plain </span> text'],
  ['an unterminated quote',   '<span style="color:red>x'],
];

for (const [name, input] of REJECTED) {
  test(`allowlist rejects ${name}`, () => {
    const out = parseMarkdown(input);
    assert.deepEqual(auditTags(out), [], `leaked markup: ${out}`);
    assert.ok(out.includes('&lt;') || out.includes('&gt;'), `expected escaped output, got: ${out}`);
  });
}

test('allowlist does not apply inside code blocks', () => {
  const fenced = parseMarkdown('```\n<span style="color:red">lit</span>\n```');
  assert.ok(fenced.includes('&lt;span'), `fenced code lost its escaping: ${fenced}`);

  const inline = parseMarkdown('Use `<span style="color:red">` here');
  assert.ok(inline.includes('&lt;span'), `inline code lost its escaping: ${inline}`);
});

test('a rejected opening tag does not leave an orphan closing tag', () => {
  const out = parseMarkdown('<span onclick="x()">a</span>');
  assert.ok(!/<\/span>/.test(out), `orphan </span> emitted: ${out}`);
});

// ── The rest of the parser is unaffected ───────────────────────────────────
test('plain markdown still renders', () => {
  const out = parseMarkdown(
    '# H1\n\n- a\n- b\n\n1. one\n2. two\n\n**b** *i* ~~s~~ `c`\n\n> q\n\n' +
    '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1 < 2;\n```\n\n[l](https://x.com)\n'
  );
  assert.deepEqual(auditTags(out), []);
  for (const fragment of [
    /<h1[^>]*>H1<\/h1>/, /<li[^>]*>a/, /<ol[^>]*>/, '<strong>b</strong>', '<em>i</em>',
    '<del>s</del>', /<blockquote[^>]*>\s*<p>q<\/p>/, '<td style="text-align:left">1</td>',
    'language-js', 'const x = 1 &lt; 2;', 'href="https://x.com"',
  ]) {
    const found = fragment instanceof RegExp ? fragment.test(out) : out.includes(fragment);
    assert.ok(found, `missing ${fragment}`);
  }
});

// Upstream's step 12b stamps each block with the source line it came from, so
// clicking the preview can scroll the editor. The allowlist stashes tags as
// inline placeholders that consume no newlines, which is precisely why the two
// can coexist -- if a future placeholder ever spans a line, these break.
test('inline HTML does not shift source-line anchors', () => {
  const withColour = parseMarkdown(
    '# one\n\nplain two\n\n<span style="color:#f38ba8">three</span>\n\n# four\n'
  );
  const withoutColour = parseMarkdown(
    '# one\n\nplain two\n\nthree\n\n# four\n'
  );
  const lines = (html) => [...html.matchAll(/data-src-line="(\d+)"/g)].map(m => m[1]);
  assert.deepEqual(lines(withColour), lines(withoutColour),
    'colouring a line changed the anchors of the blocks around it');
});

test('a colour span survives on the line it was written on', () => {
  const html = parseMarkdown('# head\n\nbefore\n\n<mark>marked</mark>\n');
  assert.ok(html.includes('<mark>marked</mark>'), html);
  assert.ok(!html.includes('&lt;mark&gt;'), html);
});
