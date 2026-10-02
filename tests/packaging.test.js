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

// ── Lazily loaded vendored bundles ─────────────────────────────────────────
//
// mermaid-render.js injects its bundle with a <script> at runtime instead of
// having a tag in index.html, so the "every script in index.html is packaged"
// check above cannot see it. A 5.2 MB bundle missing from build.files fails the
// same invisible way note-utils.js did: fine in dev, diagrams silently never
// render in the installed app.
test('runtime-injected bundles are packaged', () => {
  const src = fs.readFileSync(path.join(root, 'mermaid-render.js'), 'utf8');
  const injected = [...src.matchAll(/['"`](\.\/node_modules\/[^'"`]+\.js)['"`]/g)]
    .map(m => m[1].replace(/^\.\//, ''));
  assert.ok(injected.length, 'expected mermaid-render.js to reference a vendored bundle');
  const missing = injected.filter(p => !isPackaged(p));
  assert.deepEqual(missing, [], `injected at runtime but absent from build.files: ${missing.join(', ')}`);
});

test('runtime-injected bundles exist once dependencies are installed', (t) => {
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    return t.skip('node_modules not installed');
  }
  const src = fs.readFileSync(path.join(root, 'mermaid-render.js'), 'utf8');
  const injected = [...src.matchAll(/['"`](\.\/node_modules\/[^'"`]+\.js)['"`]/g)]
    .map(m => m[1].replace(/^\.\//, ''));
  const missing = injected.filter(p => !fs.existsSync(path.join(root, p)));
  assert.deepEqual(missing, [], `referenced but not on disk: ${missing.join(', ')}`);
});

// Peer-dependency mismatches surface as an ERESOLVE failure on a clean install,
// which is the user's machine, not ours. zod ^3 was pinned here while
// @anthropic-ai/claude-agent-sdk requires ^4 as a peer, and npm install failed.
test('declared dependency versions satisfy installed peer requirements', (t) => {
  const modules = path.join(root, 'node_modules');
  if (!fs.existsSync(modules)) return t.skip('node_modules not installed');

  const agentSdk = path.join(modules, '@anthropic-ai', 'claude-agent-sdk', 'package.json');
  if (!fs.existsSync(agentSdk)) return t.skip('agent SDK not installed');

  const peers = JSON.parse(fs.readFileSync(agentSdk, 'utf8')).peerDependencies || {};
  const declared = pkg.dependencies || {};
  for (const [name, range] of Object.entries(peers)) {
    if (!declared[name]) continue;
    const peerMajor = (range.match(/\d+/) || [])[0];
    const ourMajor = (declared[name].match(/\d+/) || [])[0];
    assert.equal(ourMajor, peerMajor,
      `${name}: declared ${declared[name]} but ${path.basename(path.dirname(agentSdk))} peers ${range}`);
  }
});
