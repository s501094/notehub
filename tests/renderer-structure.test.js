const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A class body that defines the same method twice is legal JavaScript: the
// later definition silently wins and the earlier one becomes dead code. No
// error, no warning, nothing at runtime to notice.
//
// This happened: a merge left wireListKeyboardNav, _noteIdFromElement and
// wireScrollSync each defined twice, and the copy that won was the older
// pre-line-anchor one. parseMarkdown went on emitting data-src-line anchors
// for a scroll-sync implementation that was no longer reachable, so split view
// quietly reverted to proportional scrolling while looking fully wired up.

const RENDERER = path.join(__dirname, '..', 'renderer.js');

// Strips comments and string/template literals so prose and embedded HTML
// cannot be mistaken for code.
function stripNoise(s) {
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      let j = s.indexOf('\n', i);
      if (j < 0) j = n;
      out.push('\n'.repeat(countNewlines(s, i, j)));
      i = j;
    } else if (c === '/' && s[i + 1] === '*') {
      let j = s.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      out.push('\n'.repeat(countNewlines(s, i, j)));
      i = j;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === quote) { j += 1; break; }
        j += 1;
      }
      out.push('\n'.repeat(countNewlines(s, i, j)));
      i = j;
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

function countNewlines(s, from, to) {
  let n = 0;
  for (let i = from; i < to; i++) if (s[i] === '\n') n++;
  return n;
}

// Methods of the top-level class: exactly four spaces of indent, a name, an
// argument list and an opening brace.
function methodDefinitions(source) {
  const found = [];
  const re = /^ {4}(?:async\s+|\*\s*|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
  let m;
  while ((m = re.exec(source))) {
    found.push({ name: m[1], line: countNewlines(source, 0, m.index) + 1 });
  }
  return found;
}

function duplicatesIn(source) {
  const seen = new Map();
  const dupes = new Map();
  for (const { name, line } of methodDefinitions(source)) {
    if (seen.has(name)) {
      if (!dupes.has(name)) dupes.set(name, [seen.get(name)]);
      dupes.get(name).push(line);
    } else {
      seen.set(name, line);
    }
  }
  return dupes;
}

test('no method is defined twice in renderer.js', () => {
  const source = stripNoise(fs.readFileSync(RENDERER, 'utf8'));
  const dupes = duplicatesIn(source);
  const report = [...dupes.entries()]
    .map(([name, lines]) => `${name} at lines ${lines.join(', ')}`)
    .join('; ');
  assert.equal(dupes.size, 0,
    `the later definition silently wins, making the earlier one dead code: ${report}`);
});

test('the duplicate scan actually detects a duplicate', () => {
  // Guards the guard: if stripNoise or the method regex drifts, the test above
  // would pass vacuously on any input.
  const fixture = [
    'class Thing {',
    '    alpha() {',
    '        return 1;',
    '    }',
    '',
    '    beta() {',
    '        return 2;',
    '    }',
    '',
    '    alpha() {',
    '        return 3;',
    '    }',
    '}',
  ].join('\n');
  const dupes = duplicatesIn(stripNoise(fixture));
  assert.deepEqual([...dupes.keys()], ['alpha']);
  assert.deepEqual(dupes.get('alpha'), [2, 10]);
});

test('prose and template literals are not mistaken for method definitions', () => {
  const fixture = [
    'class Thing {',
    '    real() {',
    '        const html = `',
    '    fake() {',
    '        still inside a template literal',
    '    }`;',
    '        // fake() { this is a comment }',
    '        return html;',
    '    }',
    '}',
  ].join('\n');
  assert.deepEqual([...duplicatesIn(stripNoise(fixture)).keys()], []);
  assert.deepEqual(methodDefinitions(stripNoise(fixture)).map(d => d.name), ['real']);
});

// The scroll sync that survived must be the line-anchored one, since
// markdown-utils.js pays for it on every render by emitting the anchors.
test('the surviving scroll sync is the line-anchored implementation', () => {
  const raw = fs.readFileSync(RENDERER, 'utf8');
  assert.ok(raw.includes('data-src-line'),
    'renderer.js no longer reads the data-src-line anchors parseMarkdown emits');
  assert.ok(!raw.includes('Proportional rather than line-anchored'),
    'the stale proportional scroll sync is back in renderer.js');
});
