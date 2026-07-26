# NoteHub v2: Sync, Encryption, Feature Expansion, and Mobile (React Native)

Status: Approved (2026-07-26)

## Goal

NoteHub is a free, hackable alternative to InkDrop. This spec closes the
feature/UX gap with InkDrop and adds cross-platform support (iOS/Android),
while keeping today's Electron desktop app running throughout the transition.

## Phasing

- **Phase 0 — Foundation (platform-agnostic).** Sync backend, revised note
  data model (trash, versions, pins, links, attachments), client-side
  encryption. Ships in the existing Electron app first.
- **Phase 1 — Mobile.** React Native app (iOS + Android) against the Phase 0
  backend contract.
- **Phase 2 — Desktop migration.** React Native macOS/Windows targets;
  `main.js`/`preload.js`/`renderer.js` retired once RN desktop reaches parity.

Building the backend/data model platform-agnostically in Phase 0 means
Phase 1 and Phase 2 are new UI against an unchanged contract, not a redesign.

## Storage & data model

Move from a single `notebooks.json` blob to one record per note (file or DB
row), keyed by a stable UUID. Extend the existing
`{ id, title, content, tags, notebookId }` shape with:

```
deletedAt: timestamp | null       // trash / soft-delete
pinned: boolean                   // pin/star
history: [{ content, savedAt }]   // version history, capped/pruned
links: [noteId]                   // extracted from [[wiki-links]] at save time
attachments: [{ id, filename, mimeType, sizeBytes, storageRef }]
```

Backlinks are computed at read time (`all notes where links includes this
note.id`), not stored, to avoid a second source of truth to keep in sync.

## Sync backend

A small hosted service: auth, a database (Postgres or CouchDB) holding the
schema above, and a sync endpoint clients push/poll against. Conflict
resolution starts as last-write-wins per note; per-field merge is deferred
until real conflicts are observed.

## Encryption

Client-side, zero-knowledge. An Argon2id-derived key (from a user passphrase)
encrypts `content` and `attachments` before they leave the device. The server
stores ciphertext plus the metadata needed to sync (id, timestamps; tags stay
plaintext to allow future server-side tag features, unless the user later
wants tags encrypted too). Search remains client-side against decrypted local
data, unchanged from today's behavior.

## Editor & UX upgrades (Electron first, then RN)

- Replace the plain `<textarea>` editor with CodeMirror 6 (markdown mode,
  syntax highlighting).
- Toggleable outline/TOC sidebar, generated from heading nodes in
  `parseMarkdown`'s output.
- Attachment panel per note for arbitrary files (beyond today's inline image
  paste/drop), backed by `attachments[]`.
- Built-in theme presets (current Catppuccin Mocha-style dark, a light
  equivalent, Nord/Solarized) as one-click switches, in addition to the
  existing accent-color picker.

## Plugin tooling

- Local install flow: Preferences → Plugins gains "Install from
  folder/zip/git URL," validating `manifest.json` + `index.js` and writing
  into `plugins/<id>/` — no registry/marketplace.
- Plugin generator: scaffolds `manifest.json` + `index.js` from the
  `example-plugin` skeleton.
- A shared format/lint template used by both the generator and the installer,
  so hand-written and generated plugins share one validated shape.

**Mobile plugin risk:** the plugin system's `eval()` model conflicts with
Apple App Store Review Guideline 2.5.2 (no downloading/executing arbitrary
code). Decision: **the RN mobile app ships without third-party plugin support
in v1**; plugins remain desktop-only until/unless a non-`eval`, restricted
mechanism is designed.

## Mobile stack

React Native (JS/TS, not Flutter) for iOS/Android, chosen for code-sharing
with the existing JS codebase. `parseMarkdown()`'s parsing logic (pure
string/regex, no DOM calls) is reusable; its HTML-string output needs a
rendering bridge (`react-native-render-html` or a WebView) since RN has no
`innerHTML`.

## Testing approach

- Phase 0: integration tests against the sync API (create/edit/delete/version
  restore round-trips); a dedicated test asserting ciphertext-at-rest never
  contains plaintext.
- Phase 1/2: manual verification pass through a running app once each target
  builds, per the `verify` skill's flow.

## Out of scope (this spec)

- Hosted plugin marketplace (explicitly rejected in favor of local install).
- Real-time collaborative editing.
- Per-field/CRDT merge conflict resolution (deferred past last-write-wins).
