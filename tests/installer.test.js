const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

// electron-builder derives the NSIS GUID from appId (UUIDv5 against its own
// namespace, NsisTarget.js: `options.guid || UUID.v5(appInfo.id, ...)`), and
// that GUID is what Windows uses to recognise an existing install.
//
// Change appId and the next installer looks like a different product: it lands
// beside the old one instead of over it, and the stale entry sits in Add/Remove
// Programs forever. appId lived in package.json while package.json was
// gitignored, so it was free to drift between builds without leaving a trace.
//
// Pinning the GUID decouples installer identity from appId. The pinned value is
// exactly what "com.notehub.app" derives, so it stays continuous with installs
// already in the wild.

test('the installer GUID is pinned, not derived from appId', () => {
  const nsis = pkg.build.nsis || {};
  assert.match(nsis.guid || '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'build.nsis.guid must be an explicit UUID so installer identity cannot drift with appId');
});

test('the pinned GUID is the one appId currently derives', () => {
  // If these ever disagree, the next installer stops recognising existing
  // installs. Skipped when dependencies are not installed.
  let UUID;
  try {
    ({ UUID } = require('builder-util-runtime'));
  } catch {
    return;   // builder-util-runtime is a transitive dev dependency
  }
  const NAMESPACE = UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3');
  const derived = UUID.v5(pkg.build.appId, NAMESPACE);
  assert.equal(pkg.build.nsis.guid, derived,
    `pinned GUID does not match what appId "${pkg.build.appId}" derives (${derived}); ` +
    'changing it strands every existing install');
});

test('the uninstall entry is not version-stamped', () => {
  // Defaults to "${productName} ${version}", which gives every version ever
  // installed its own row in Add/Remove Programs.
  const nsis = pkg.build.nsis || {};
  assert.ok(nsis.uninstallDisplayName, 'build.nsis.uninstallDisplayName should be set');
  assert.ok(!/\$\{?version/i.test(nsis.uninstallDisplayName),
    'uninstallDisplayName must not include the version, or each install adds an entry');
});

test('appId is an explicit reverse-DNS id', () => {
  assert.match(pkg.build.appId || '', /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
    'build.appId must be set explicitly; the GUID and registry keys hang off it');
});

test('install scope is stated rather than left to the default', () => {
  // perMachine decides whether the previous install is found under HKCU or
  // HKLM. Leaving it implicit means a later default change silently moves
  // where upgrades look.
  assert.equal(typeof (pkg.build.nsis || {}).perMachine, 'boolean',
    'build.nsis.perMachine should be set explicitly');
});
