const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { NOTEBOOK_PALETTE } = require('../notebook-utils');

// renderer.js is a browser script, not a module. hexToRgb and shadeHex live
// above the NoteHubApp class, so evaluate just that prefix -- it touches no DOM
// and no Electron API.
function loadColourHelpers() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const head = src.slice(0, src.indexOf('// Main Application'));
  const exported = {};
  new Function('exports', `${head}\nexports.shadeHex = shadeHex; exports.hexToRgb = hexToRgb;`)(exported);
  return exported;
}

const { shadeHex, hexToRgb } = loadColourHelpers();

// WCAG relative luminance and contrast ratio.
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The darker end of the bright panel's gradient (--bright-panel-bg-to), i.e.
// the worst case for text sitting on it.
const BRIGHT_PANEL_BG = '#f0ece3';
const INK_AMOUNT = -0.55;   // the value renderEditor() passes

test('shadeHex darkens toward black for a negative amount', () => {
  assert.equal(shadeHex('#ffffff', -0.5), '#808080');
  assert.equal(shadeHex('#ffffff', -1), '#000000');
});

test('shadeHex lightens toward white for a positive amount', () => {
  assert.equal(shadeHex('#000000', 0.5), '#808080');
  assert.equal(shadeHex('#000000', 1), '#ffffff');
});

test('shadeHex is a no-op at zero', () => {
  assert.equal(shadeHex('#7c6df0', 0), '#7c6df0');
});

test('shadeHex clamps amounts beyond the -1..1 range', () => {
  assert.equal(shadeHex('#7c6df0', -5), '#000000');
  assert.equal(shadeHex('#7c6df0', 5), '#ffffff');
});

test('shadeHex returns null for malformed input, like hexToRgb', () => {
  // The caller relies on this to leave --nb-accent-ink unset so the CSS
  // fallback applies, rather than rendering a colour nobody chose.
  for (const bad of ['', 'not-a-colour', '#ff', '#gggggg', null, undefined, 42]) {
    assert.equal(shadeHex(bad, -0.55), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('shadeHex accepts hex with or without the leading #', () => {
  assert.equal(shadeHex('7c6df0', -0.55), shadeHex('#7c6df0', -0.55));
});

// The reason shadeHex exists. Notebook colours are chosen to read as solid
// swatches on the dark tab rail, which is exactly what makes them illegible as
// text on the cream panel. If someone retunes INK_AMOUNT or adds a palette
// colour, this is what should stop them.
test('every notebook colour is unreadable raw and legible once darkened', () => {
  for (const colour of NOTEBOOK_PALETTE) {
    const ink = shadeHex(colour, INK_AMOUNT);
    assert.ok(ink, `shadeHex returned null for palette colour ${colour}`);

    const after = contrast(ink, BRIGHT_PANEL_BG);
    assert.ok(after >= 4.5,
      `${colour} darkened to ${ink} has contrast ${after.toFixed(2)}:1 on the bright panel, below the 4.5:1 AA floor`);
  }
});

test('the darkened ink is genuinely darker than the raw colour', () => {
  for (const colour of NOTEBOOK_PALETTE) {
    const ink = shadeHex(colour, INK_AMOUNT);
    assert.ok(luminance(ink) < luminance(colour),
      `${colour} -> ${ink} did not get darker`);
  }
});

// renderEditor() interpolates the notebook colour straight into a style
// attribute, and notebook colours are stored data, not a fixed enum.
test('renderEditor only uses a notebook colour that parses as hex', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.match(src, /const accent = \(nb && hexToRgb\(nb\.color\)\) \? nb\.color : '#[0-9a-f]{6}';/,
    'the accent used in the style attribute must be validated before interpolation');
});

test('shadeHex is defined before the class that calls it', () => {
  // The bug this file was written for: shadeHex was called by renderEditor and
  // defined nowhere, so opening any note threw a ReferenceError and the editor
  // never rendered.
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const definition = src.indexOf('function shadeHex(');
  assert.notEqual(definition, -1, 'shadeHex is not defined in renderer.js');
  assert.ok(definition < src.indexOf('// Main Application'),
    'shadeHex must be defined above the class, with the other colour helpers');
});
