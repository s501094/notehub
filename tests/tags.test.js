const test = require('node:test');
const assert = require('node:assert/strict');

const { parseMarkdown, extractTags, TAG_RE } = require('../markdown-utils');

// extractTags and parseMarkdown's step 3c share TAG_RE on purpose: if they ever
// used different patterns, a tag could render as a chip the search cannot find,
// or be indexed without ever appearing in the note.

test('TAG_RE is exported so the renderer and parser cannot disagree', () => {
  assert.ok(TAG_RE instanceof RegExp);
  assert.ok(TAG_RE.global, 'TAG_RE must be global; replace() and matchAll() both rely on it');
});

// ── What is a tag ──────────────────────────────────────────────────────────
const TAGGED = [
  ['simple',             'Met about #infra today',          ['infra']],
  ['hyphens and digits', 'ship #q4-planning now',           ['q4-planning']],
  ['nested with slash',  'filed under #work/clients',       ['work/clients']],
  ['at line start',      '#standup notes',                  ['standup']],
  ['several',            '#infra and #ops and #infra',      ['infra', 'ops']],
  ['inside a heading',   '## Sprint #q4 review',            ['q4']],
  ['before punctuation', 'both #infra, and #ops.',          ['infra', 'ops']],
];

for (const [name, input, expected] of TAGGED) {
  test(`extractTags finds ${name}`, () => {
    assert.deepEqual(extractTags(input), expected);
  });
}

const NOT_TAGGED = [
  ['a heading',              '# Real Heading'],
  ['a deeper heading',       '### Another Heading'],
  ['a URL fragment',         'see https://x.com/page#section'],
  ['a markdown link target', '[text](https://x.com/doc#frag)'],
  ['a bare hex colour',      'use #f38ba8 for errors'],
  ['a short hex colour',     'try #fff instead'],
  ['a # mid-word',           'the C# language and a#b.com'],
  ['a lone hash',            'item # 3'],
  ['a digit-leading token',  '#123 is an issue number'],
  ['fenced code',            '```\n#notatag\n```'],
  ['inline code',            'write `#notatag` for that'],
];

for (const [name, input] of NOT_TAGGED) {
  test(`extractTags ignores ${name}`, () => {
    assert.deepEqual(extractTags(input), [], `input: ${JSON.stringify(input)}`);
  });
}

test('extractTags deduplicates but keeps first-appearance order', () => {
  assert.deepEqual(extractTags('#b then #a then #b again'), ['b', 'a']);
});

test('extractTags tolerates empty and missing input', () => {
  for (const v of ['', null, undefined]) {
    assert.deepEqual(extractTags(v), []);
  }
});

// ── Rendering ──────────────────────────────────────────────────────────────
test('a tag renders as a chip carrying its name', () => {
  const html = parseMarkdown('Met about #infra today');
  assert.match(html, /<span class="nh-tag" data-tag="infra">#infra<\/span>/);
});

test('a heading is still a heading, not a tag', () => {
  const html = parseMarkdown('# Real Heading');
  assert.match(html, /<h1[^>]*>Real Heading<\/h1>/);
  assert.ok(!html.includes('nh-tag'), html);
});

test('tags inside code are left alone', () => {
  assert.ok(!parseMarkdown('```\n#notatag\n```').includes('nh-tag'));
  assert.ok(!parseMarkdown('`#notatag`').includes('nh-tag'));
});

test('a tag does not shift the source-line anchors', () => {
  // Same property the inline-HTML allowlist relies on: the tag is stashed as an
  // inline placeholder consuming no newlines, so step 12b stays correct.
  const lines = (html) => [...html.matchAll(/data-src-line="(\d+)"/g)].map(m => m[1]);
  assert.deepEqual(
    lines(parseMarkdown('# one\n\n#infra tagged\n\n# three\n')),
    lines(parseMarkdown('# one\n\nplain text\n\n# three\n')),
  );
});

// Regression: step 3b declared a local `const TAG_RE` for the inline-HTML
// allowlist, which shadowed the module-level #tag pattern for the rest of
// parseMarkdown. Tags silently stopped rendering while every existing test
// still passed, because the allowlist kept working and nothing covered tags.
test('tags and the inline-HTML allowlist both work in one document', () => {
  const html = parseMarkdown('A <span style="color:#f38ba8">red</span> note about #infra');
  assert.match(html, /<span style="color:#f38ba8">red<\/span>/, 'allowlist stopped working');
  assert.match(html, /<span class="nh-tag" data-tag="infra">/, 'tags stopped working');
});

test('a hex colour in a style attribute is not mistaken for a tag', () => {
  const html = parseMarkdown('<mark style="background-color:#f9e2af">x</mark> #ops');
  assert.match(html, /background-color:#f9e2af/);
  assert.match(html, /data-tag="ops"/);
  assert.ok(!html.includes('data-tag="f9e2af"'), html);
});

// ── Tag text transforms (note-utils.js) ────────────────────────────────────
//
// Tags live in the note body, so the chips and the context menu edit text. These
// run without a DOM, which is why the logic lives in note-utils rather than in
// the renderer method that calls it.

const {
  isValidTag, isTagOnlyLine, addTagToText, removeTagFromText, textHasTag,
} = require('../note-utils');

test('isValidTag accepts the documented shapes and rejects the rest', () => {
  for (const good of ['infra', 'q4-planning', 'work/clients', 'a', 'a1', 'a/b/c']) {
    assert.ok(isValidTag(good), `expected ${good} to be valid`);
  }
  for (const bad of ['', '1abc', '-abc', '/abc', 'a b', 'a!', '#infra', null, undefined]) {
    assert.ok(!isValidTag(bad), `expected ${JSON.stringify(bad)} to be invalid`);
  }
});

test('isTagOnlyLine distinguishes a tag line from prose containing tags', () => {
  assert.ok(isTagOnlyLine('#a #b'));
  assert.ok(isTagOnlyLine('  #work/clients  '));
  assert.ok(!isTagOnlyLine('prose #a'));
  assert.ok(!isTagOnlyLine('#a and #b'));
  assert.ok(!isTagOnlyLine('# Heading'));
  assert.ok(!isTagOnlyLine(''));
});

test('addTagToText starts a tag line when the note has none', () => {
  assert.equal(addTagToText('Some notes here.', 'infra'), 'Some notes here.\n\n#infra\n');
});

test('addTagToText joins an existing trailing tag line', () => {
  assert.equal(addTagToText('Prose.\n\n#infra\n', 'ops'), 'Prose.\n\n#infra #ops\n');
});

test('addTagToText handles an empty note', () => {
  assert.equal(addTagToText('', 'infra'), '#infra\n');
});

test('addTagToText is a no-op for a tag the note already carries', () => {
  const before = 'Prose.\n\n#infra\n';
  assert.equal(addTagToText(before, 'infra'), before);
  // Including when it appears inline rather than on the tag line.
  assert.equal(addTagToText('Talked about #infra today', 'infra'), 'Talked about #infra today');
});

test('addTagToText strips a leading # the user typed', () => {
  assert.equal(addTagToText('x', '#infra'), 'x\n\n#infra\n');
});

test('addTagToText refuses an invalid tag rather than writing junk', () => {
  for (const bad of ['', '1abc', 'a b', 'a!']) {
    assert.equal(addTagToText('x', bad), 'x');
  }
});

test('removeTagFromText removes the tag and tidies the gap', () => {
  assert.equal(removeTagFromText('a #infra b', 'infra'), 'a  b');
  assert.equal(removeTagFromText('#infra', 'infra'), '');
});

// The bug this guards: with a `\b` terminator, removing #work also matched the
// #work prefix of #work/clients and left `/clients` in the note, and removing
// #ops turned #ops-2 into `-2`. Both silently damaged the text.
test('removeTagFromText does not damage a nested tag sharing the prefix', () => {
  assert.equal(removeTagFromText('#work and #work/clients', 'work'), ' and #work/clients');
  assert.equal(removeTagFromText('#work/clients here', 'work'), '#work/clients here');
});

test('removeTagFromText does not damage a hyphenated tag sharing the prefix', () => {
  assert.equal(removeTagFromText('#ops-2 and #ops', 'ops'), '#ops-2 and');
});

test('removeTagFromText leaves a URL fragment alone', () => {
  const doc = 'see https://x.com/p#infra for detail';
  assert.equal(removeTagFromText(doc, 'infra'), doc);
});

test('removeTagFromText collapses the blank run a removed tag line leaves', () => {
  assert.ok(!/\n{3,}/.test(removeTagFromText('a\n\n#infra\n\nb', 'infra')));
});

test('textHasTag matches whole tags only', () => {
  assert.ok(textHasTag('a #infra b', 'infra'));
  assert.ok(!textHasTag('#infra-2 only', 'infra'));
  assert.ok(!textHasTag('#work/clients only', 'work'));
  assert.ok(!textHasTag('see x.com/p#infra', 'infra'));
});

test('the transforms agree with extractTags about what a tag is', () => {
  // addTagToText writing something extractTags cannot see would produce a chip
  // that vanishes on the next render.
  for (const tag of ['infra', 'q4-planning', 'work/clients']) {
    const text = addTagToText('Prose.', tag);
    assert.deepEqual(extractTags(text), [tag], `round trip failed for ${tag}`);
    assert.deepEqual(extractTags(removeTagFromText(text, tag)), []);
  }
});

// ── Wiki links and backlinks ───────────────────────────────────────────────
const { extractLinks, WIKILINK_RE } = require('../markdown-utils');
const { resolveLinkTarget, buildBacklinkIndex, normaliseTitle } = require('../note-utils');

test('WIKILINK_RE is exported and global', () => {
  assert.ok(WIKILINK_RE instanceof RegExp);
  assert.ok(WIKILINK_RE.global);
});

test('extractLinks finds plain and piped links', () => {
  assert.deepEqual(extractLinks('see [[Deploy Runbook]] now'), ['Deploy Runbook']);
  assert.deepEqual(extractLinks('[[Runbook|the docs]]'), ['Runbook']);
});

test('extractLinks deduplicates in first-appearance order', () => {
  assert.deepEqual(extractLinks('[[B]] [[A]] [[B]]'), ['B', 'A']);
});

test('extractLinks ignores code and empty targets', () => {
  assert.deepEqual(extractLinks('```\n[[NotALink]]\n```'), []);
  assert.deepEqual(extractLinks('`[[NotALink]]`'), []);
  assert.deepEqual(extractLinks('[[]]'), []);
  assert.deepEqual(extractLinks('[[   ]]'), []);
});

test('a markdown link is not a wiki link', () => {
  assert.deepEqual(extractLinks('[text](https://x.com)'), []);
});

test('a wiki link renders with its target and display text', () => {
  const html = parseMarkdown('see [[Deploy Runbook]]');
  assert.match(html, /<a class="nh-wikilink" data-target="Deploy Runbook"[^>]*>Deploy Runbook<\/a>/);
  const piped = parseMarkdown('[[Runbook|the docs]]');
  assert.match(piped, /data-target="Runbook"[^>]*>the docs</);
});

test('a wiki link does not shift source-line anchors', () => {
  const lines = (html) => [...html.matchAll(/data-src-line="(\d+)"/g)].map(m => m[1]);
  assert.deepEqual(
    lines(parseMarkdown('# one\n\nsee [[X]]\n\n# three\n')),
    lines(parseMarkdown('# one\n\nsee plain\n\n# three\n')),
  );
});

test('a link target is escaped into the attribute', () => {
  const html = parseMarkdown('[[a"b<c]]');
  assert.ok(!html.includes('data-target="a"b'), html);
  assert.ok(html.includes('&quot;') || html.includes('&lt;'), html);
});

const LIB = [
  { id: '1', title: 'Runbook', content: 'see [[Index]]', updated: '2026-01-01' },
  { id: '2', title: 'Index', content: '[[Runbook]] and [[Missing]]', updated: '2026-01-02' },
  { id: '3', title: 'Index', content: 'duplicate title', updated: '2026-05-01' },
  { id: '4', title: 'Self', content: '[[Self]]', updated: '2026-01-01' },
  { id: '5', title: 'Gone', content: '[[Runbook]]', updated: '2026-01-01', deletedAt: '2026-02-02' },
];

test('resolveLinkTarget matches on title, case- and space-insensitively', () => {
  assert.equal(resolveLinkTarget(LIB, 'runbook').id, '1');
  assert.equal(resolveLinkTarget(LIB, '  Runbook  ').id, '1');
});

test('a duplicate title resolves to the most recently updated note', () => {
  // Otherwise the destination would depend on array order.
  assert.equal(resolveLinkTarget(LIB, 'Index').id, '3');
});

test('resolveLinkTarget returns null rather than guessing', () => {
  assert.equal(resolveLinkTarget(LIB, 'Missing'), null);
  assert.equal(resolveLinkTarget(LIB, ''), null);
  assert.equal(resolveLinkTarget([], 'x'), null);
});

test('resolveLinkTarget ignores trashed notes', () => {
  assert.equal(resolveLinkTarget(LIB, 'Gone'), null);
});

test('buildBacklinkIndex inverts the link graph', () => {
  const idx = buildBacklinkIndex(LIB, extractLinks);
  assert.deepEqual(idx.inbound.get('1'), ['2']);   // Index -> Runbook
  assert.deepEqual(idx.outbound.get('2'), ['1']);
});

test('buildBacklinkIndex drops self-links', () => {
  const idx = buildBacklinkIndex(LIB, extractLinks);
  assert.deepEqual(idx.outbound.get('4'), []);
  assert.ok(!idx.inbound.has('4'));
});

test('buildBacklinkIndex excludes trashed notes as sources', () => {
  const idx = buildBacklinkIndex(LIB, extractLinks);
  assert.ok(!idx.outbound.has('5'));
  assert.ok(!(idx.inbound.get('1') || []).includes('5'));
});

test('buildBacklinkIndex records unresolved targets', () => {
  const idx = buildBacklinkIndex(LIB, extractLinks);
  assert.deepEqual(idx.unresolved.get('2'), ['Missing']);
});

test('normaliseTitle tolerates missing input', () => {
  for (const v of [null, undefined, '']) assert.equal(normaliseTitle(v), '');
});
