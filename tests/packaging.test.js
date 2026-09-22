const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// electron-builder ships only what package.json's build.files lists. A script
// that index.html loads but the manifest omits is invisible in development --
// `npm start` runs from the source tree, where every file is present -- and
// only breaks in the packaged app, silently, as a feature that "does nothing".
//
// This has happened twice: note-utils.js (c0dbb53) and context-menu.js. The
// cost of catching it here is a few milliseconds; the cost of catching it in
// a release is a build that has to be redone.

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const manifest = pkg.build.files;

// Does build.files cover this path, either literally or via a glob prefix?
function isPackaged(file) {
  return manifest.some(entry => {
    if (entry === file) return true;
    if (!entry.includes('*')) return false;
    return file.startsWith(entry.split('*')[0]);
  });
}

function scriptsIn(html) {
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map(m => m[1])
    .map(src => src.replace(/^\.\//, ''));
}

test('every script index.html loads is in build.files', () => {
  const missing = scriptsIn(indexHtml).filter(src => !isPackaged(src));
  assert.deepEqual(missing, [],
    `these load in dev but would be absent from a packaged build: ${missing.join(', ')}`);
});

// Only project files: vendored scripts under node_modules are npm install's
// job, and this suite must pass on a clean checkout before dependencies exist.
test('every project script index.html loads exists on disk', () => {
  const missing = scriptsIn(indexHtml)
    .filter(src => !src.startsWith('node_modules/'))
    .filter(src => !fs.existsSync(path.join(root, src)));
  assert.deepEqual(missing, [], `index.html references files that do not exist: ${missing.join(', ')}`);
});

// The CodeMirror modes and addons index.html pulls in are covered by the
// node_modules/codemirror glob, but only if they are actually the paths the
// glob matches -- check them when dependencies are installed.
test('vendored scripts resolve once dependencies are installed', (t) => {
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    return t.skip('node_modules not installed');
  }
  const missing = scriptsIn(indexHtml)
    .filter(src => src.startsWith('node_modules/'))
    .filter(src => !fs.existsSync(path.join(root, src)));
  assert.deepEqual(missing, [], `index.html references missing vendored files: ${missing.join(', ')}`);
});

test('build.files lists no file that has since been deleted', () => {
  const stale = manifest
    .filter(entry => !entry.includes('*'))
    .filter(entry => !fs.existsSync(path.join(root, entry)));
  assert.deepEqual(stale, [], `build.files references missing files: ${stale.join(', ')}`);
});

test('the entry point named in package.json exists and is packaged', () => {
  assert.ok(fs.existsSync(path.join(root, pkg.main)), `main "${pkg.main}" does not exist`);
  assert.ok(isPackaged(pkg.main), `main "${pkg.main}" is not in build.files`);
});

test('preload is packaged', () => {
  // main.js resolves it relative to __dirname, so it must ship alongside.
  assert.ok(isPackaged('preload.js'), 'preload.js is not in build.files');
});

test('each platform icon referenced by the build config exists', () => {
  const icons = [
    pkg.build.win && pkg.build.win.icon,
    pkg.build.mac && pkg.build.mac.icon,
    pkg.build.linux && pkg.build.linux.icon,
  ].filter(Boolean);

  const missing = icons.filter(icon => !fs.existsSync(path.join(root, icon)));
  assert.deepEqual(missing, [], `build config points at missing icons: ${missing.join(', ')}`);
});

test('every enabled-by-default plugin directory has a manifest', () => {
  const pluginsDir = path.join(root, 'plugins');
  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const broken = dirs.filter(d => !fs.existsSync(path.join(pluginsDir, d, 'manifest.json')));
  assert.deepEqual(broken, [], `plugin directories without a manifest.json: ${broken.join(', ')}`);
});
