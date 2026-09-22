# TODO / FIX

## Done 2026-08-20 (second pass — the 20 improvements)

Data safety, parser correctness, keyboard access and the remaining glass work.
`npm test`: 102 static checks + 80 unit tests, 0 failures (the stale
`neovim-editor` plugin expectation is gone — Vim mode has been core since the
`editor.vimMode` work, so the test outlived the plugin).

**Verified against the real library, not just tests.** The image migration ran
on the actual notebooks.json: 14 embedded base64 images converted to
content-addressed attachment files, **665,785 -> 96,583 bytes, an 85%
reduction**, with the three pre-migration copies preserved in the backup chain.

1. **Atomic writes** (`writeFileDurable` in `main.js`). Every save went
   straight over the live file with `writeFileSync`; a crash, power loss or
   full disk between truncation and the final byte left a half-written file,
   and that file *was* the database. Now: write to a temp sibling, `fsync`,
   rotate backups, `rename`. rename(2) is atomic on NTFS and POSIX, so a reader
   sees the whole old file or the whole new one, never a truncated one. The
   `fsync` is not optional — without it the rename can land before the data
   does, and a power loss between them leaves an atomically-renamed file full
   of zeroes.
2. **Rotating backups**, three deep, plus recovery: `get-data` walks the backup
   chain when the primary will not parse, and preserves the damaged file as
   `.corrupt` rather than letting the next save rotate away the only evidence.
   Returning an empty library on a parse error looks identical to every note
   being deleted, and the next autosave would have made that real.
3. **Save coalescing** (`saveData` in `renderer.js`). Autosave fires on a timer,
   not on change, so an idle editor rewrote the whole library every two seconds.
   Identical payloads are now dropped and concurrent calls serialised. The
   subtle part: a second caller must NOT ride on the in-flight promise, because
   that write is of a snapshot taken before it — it would report success while
   discarding the newer data. It waits, then re-enters.
4. **Images moved out of note content** into `userData/attachments/`,
   content-addressed by SHA-256 so the same screenshot pasted into ten notes is
   stored once. Referenced as `notehub-attachment:<id>` and resolved after
   render (resolution is async IPC; the parser is synchronous). Attachment ids
   reach the resolver from note content, which is user-editable text, so they
   are validated against a strict pattern before being joined to a path.
   One-time migration converts existing embeds, including those in history —
   history was the biggest contributor, storing one image up to 50 times over.
   Orphans are pruned on idle, scanning history too so a revision that still
   references an image is a reason to keep it.
5. **Data file no longer pretty-printed.** Indenting a file no human reads
   inflated it by roughly a third, re-serialized on every autosave tick.
   config.json stays indented — that one is small and does get hand-edited.
6. **`tests/markdown.test.js`** — 47 tests. The parser moved to
   `markdown-utils.js` to make this possible: it needed a DOM and an Electron
   bridge to load before. Covers emphasis boundaries, nesting, the task-index
   contract against the source-side scan, fence isolation, and the source-line
   anchors. `test.js`'s substring check for `function parseMarkdown` was
   replaced rather than deleted — it now asserts the renderer still calls it.
7. **Blockquotes form blocks.** `> a\n> b` emitted two adjacent
   `<blockquote>` elements, each with its own border and margin. Now one, with
   `>>` nesting by marker depth.
8. **Autolinks.** Bare URLs, plus `<https://…>` — which never matched anything,
   because step 3 had already escaped the angle brackets. Trailing punctuation
   is excluded so a URL ending a sentence does not swallow the full stop, and
   the pattern will not re-wrap a URL already inside an `<a>`.
9. **Setext headings**, placed before the horizontal-rule pass — after it, a
   `---` underline is consumed as an `<hr>` and its title is orphaned. A
   freestanding `---` between paragraphs is still a rule (there is a test).
10. **`nvim.relativeLineNumbers` removed.** Two controls, two config keys, one
    of which nothing ever read — the Neovim tab's toggle silently did nothing
    while the identical one on the Editor tab worked.
11. **CSP for the preferences window**, deliberately far stricter than
    index.html's. index.html must allow `unsafe-eval` and CDN origins because
    plugins are eval'd there; Preferences loads none of that, so it gets
    `default-src 'none'`. The window that edits every security-relevant setting
    previously had no policy at all.
12. **Keyboard access.** A `:focus-visible` ring system (there was no focus
    styling anywhere in the stylesheet), plus arrow/Home/End/Enter/Delete
    navigation of the notes and notebooks lists. Bound on the containers, since
    the lists are re-rendered wholesale. Movement is clamped, not wrapped:
    wrapping from the last row to the first is disorienting when the list is
    longer than the viewport.
13. **Search is global and honest.** It filtered `getFilteredNotes()`, already
    scoped to the open notebook, so search only ever searched where you were
    already looking. It also matched raw content, so a query could hit
    megabytes of base64 image payload and return a note with no visible
    occurrence of the term. Now matches the same stripped text the snippets
    use, ranks title hits above body hits, and highlights matches.
14. **Quick switcher on Cmd/Ctrl+K**, as a mode of the existing palette rather
    than a second overlay — filtering, keyboard handling, scroll-into-view and
    focus restore are already solved there and would have drifted if duplicated.
15. **Zen mode** (Cmd/Ctrl+.), requested 2026-08-19. One class on `<html>` and
    one flag, not four independent toggles: with four, leaving zen means
    restoring four remembered values, any of which may have changed while zen
    was active. One reversible state has nothing to remember. Deliberately not
    persisted — launching into it after a restart, with no chrome and no
    obvious way out, is an alarming first impression.
16. **Table of contents** (Cmd/Ctrl+/), parsed from the note source rather than
    scraped from the preview, so it works in edit mode and can jump the editor
    cursor to a real line.
17. **Undo toast, replacing the delete confirmation.** A modal on every deletion
    interrupts the many intended ones to guard against the rare mistake, and
    still leaves no recourse after the click. Trashing is now immediate with an
    Undo action; since the note goes to trash rather than oblivion, that is the
    honest interaction. Also `prefers-reduced-motion` support.
18. **Glass presets** (Solid / Frosted / Clear) in front of the sliders. Seven
    sliders is a tuning surface, not a choosing surface. Presets write real
    slider values rather than being a stored mode, so adjusting one afterwards
    behaves as expected, and in per-section mode a preset only touches the
    section on screen.
19. **Live glass sample in Preferences**, over a deliberately busy backdrop —
    a sample over a flat colour is useless, since blur, saturation and dimming
    all return the same flat colour. That is the illusion that made the
    original sliders look broken.
20. **Line-anchored scroll sync.** `parseMarkdown` now stamps `data-src-line`
    on block elements and the renderer interpolates between anchors, replacing
    proportional mapping. Making the anchors trustworthy was the real work:
    every pass that collapsed or expanded lines had to be made
    line-count-preserving — fenced code and tables pad with blank lines, and
    the list builder was rewritten to emit exactly one output line per input
    line. Tests assert anchors do not drift across any of the three.

## Done 2026-08-20

All 48 items below were implemented in one pass. Kept as written rather than
deleted, because the reasoning for each change is the useful part -- several
are non-obvious enough that a future reader would otherwise be tempted to
revert them. `npm test`: 102 passing, 3 pre-existing failures (the absent
`plugins/neovim-editor` folder, unrelated to this work).

Config keys added: `theme.readingFontFamily`; `appearance.reduceTransparency`;
`appearance.glass.dim`, `.noise`; `appearance.background.scrim`. Glass defaults
changed from fully-opaque/no-blur to an actual glass look -- see item 30.

## Needs doing today (2026-08-20)

From a screenshot review of a real build (main window in split view + the
Preferences Appearance tab). Three root causes explain most of the list; the
rest are grouped by area. Ordered priority-first inside each group.

### Root causes — fix these first, several items below fall out of them

1. **The editor font controls are dead.** `.CodeMirror` hardcodes
   `'JetBrains Mono', …` / `13px` (`main.css:1521-1529`) and `renderer.js`
   never reads `theme.editorFontFamily` / `theme.editorFontSize` —
   `preferences.html:1318` saves them, nothing consumes them. The only lever
   that works is the global `--font-family` (`renderer.js:338`), which drives
   chrome *and* prose, so setting a mono font to fix the editor turns the
   whole UI — including the preview reading pane — monospace.
   Fix: publish `--editor-font-family` / `--editor-font-size` from
   `applyTheme()` and have `.CodeMirror` read them.
2. **`readConfig()` (`main.js:82`) does no merge with `DEFAULT_CONFIG`.** It
   parses the file and returns it. Any key added to the defaults after a
   user's `config.json` was first written reads `undefined` forever. That is
   why word wrap is off in the build despite `DEFAULT_CONFIG.editor.wordWrap
   = true` (`main.js:31`) — `lineWrapping: !!undefined` at `renderer.js:2023`.
   `sanitizeConfig` also never normalizes `wordWrap` / `spellCheck` /
   `lineNumbers`, so there is no second line of defence.
   Fix: deep-merge defaults in `readConfig()`, and add the missing
   `!== false` normalizers alongside the ones already there.
3. **Intraword underscores italicize.** `renderer.js:145`
   (`_([^_\n]+)_`) turns `USE1PRES1012_OsDisk_1_8d58…` into
   `USE1PRES1012<em>OsDisk</em>1_…`. Visible in every screenshot; hits any
   note containing hostnames, snake_case or file paths.
   Fix: require word boundaries — `(^|[^\w])_([^_\n]+)_(?!\w)`. Same hole
   exists for `*` at line 144.

### Typography

4. Add a `--font-reading` token separate from `--font-family`; apply it to
   `.preview-content` so prose stops inheriting the chrome font.
5. Headings need family contrast, not just size — `--font-display`
   (Space Grotesk, already loaded at `main.css:6`) on h1–h4.
6. `h4` is 16px (`main.css:1004`), identical to body — no hierarchy at the
   bottom of the scale. Ramp 30/24/19/16 with `letter-spacing: -0.01em` on
   h1/h2.
7. `.preview-content { max-width: 800px }` (`main.css:976`) is ~95 characters
   at the current mono face. Switch to `max-width: 68ch`.
8. Mono stacks have no true italic, so `<em>` renders as a synthesized slant.
   Falls out of #4; add `font-synthesis: none` so a missing face fails
   visibly rather than smearing.
9. Three competing mono stacks in one stylesheet: `--font-mono` (`SF Mono`
   first, never resolves on Windows — `main.css:101`), bare `monospace`
   (1393, 1397, 1404, 1462) and a JetBrains list (1457, 1521). Inline code
   and code blocks currently render in different fonts. Collapse to one
   token, Windows-first ordering.
10. Editor is 13px/1.65, preview 16px/1.8 — the same text at two scales side
    by side in split view. Derive the preview size from the editor size at a
    fixed ratio.
11. Line numbers are the same size as content (`main.css:1548`) and compete
    with it. `0.85em`, `tabular-nums`, dim to ~40% with full opacity only on
    the active line.
12. Emoji mixed into an SVG icon set — 🔌 and 🕘 (`renderer.js:1913, 1938`)
    beside 16px stroke icons, plus 📕 in the title bar and colour emoji in the
    Preferences nav. Different optical weight and baseline. Replace with the
    same SVG set.

### Markdown rendering

13. Checkbox items indent ~22px past bullet items: `li.task { list-style:
    none }` (`main.css:1474`) drops the marker but keeps the `ul`'s 24px
    padding, then the 15px box + 7px margin push the text right. Use
    `display: flex; gap: 8px; margin-left: -22px` so the box takes the
    marker slot.
14. All list nesting is destroyed — the list regexes strip `^[ \t]*`
    (`renderer.js:165, 172, 173`), so indented sub-items render top-level.
    Capture the indent, convert to a depth, emit real nested `<ul>`.
15. Task syntax matches `- [ ]` only. `* [ ]`, `+ [ ]` and `1. [ ]` fall
    through to plain bullets — and real notes mix `-` and `*` freely.
    `^([ \t]*)(?:[-*+]|\d+\.)[ \t]\[([ xX])\][ \t]`.
16. Completed tasks are near-illegible: `--ctp-overlay1` *plus* line-through
    (`main.css:1475`) over a photo backdrop. Keep full text colour at ~65%
    opacity and drop the strikethrough, or make it a 1px 50%-alpha rule.
17. `<ol>` grouping is fragile — `renderer.js:174` is a no-op replace and
    175's lazy `[\s\S]*?` can staple together ordered items separated by
    paragraphs. Build lists inside the existing line loop (`renderer.js:180`)
    instead of regexing the whole document.
18. No split-view scroll sync — nothing listens to editor scroll. Map
    CodeMirror's `getScrollInfo()` ratio onto the preview's `scrollTop`.

### Main window

19. The stats card covers content and repeats itself: `.note-info-card` is
    `position: absolute; top: 12px; right: 14px` (`main.css:1920`) over the
    preview, sitting on the first paragraph, and "235 words" is already in
    the status bar. Card keeps reading time + edited-time and fades on
    scroll; the count lives only in the status bar.
20. Notebook names are unreadable — "Gene…", "Work…", "test…", "Disa…".
    `.notebook-name` (`main.css:514`) ellipsises while an emoji and a count
    chip eat the row, with no `title` tooltip. Add `title`, shrink the icon
    column, hide the count chip until hover.
21. The note list shows raw markdown as its snippet
    (`!image-1787168284682…`). Strip markdown for `.note-item-preview`;
    render a thumbnail when the note leads with an image.
22. Delete sits flush against Export and Insert Image with nothing but
    `title="Delete"` (`renderer.js:1948`) — one mis-click from data loss.
    Separator, red on hover, and make it undoable rather than confirmed.
23. The toolbar is 11 unlabelled glyphs with 5 plugin buttons crammed in
    front (`renderer.js:1859`) and no overflow handling — it already runs
    into the window edge. Cap visible plugin buttons at 2, spill the rest
    into the 🔌 menu, group the remainder behind the existing separators.

### Preferences window

24. Section headers scroll away — "GLASS EFFECT" is sliced at the top of the
    pane in both screenshots, so a slider has no visible group.
    `position: sticky; top: 0` with a solid background.
25. The fixed footer cuts content in half: `.footer { position: fixed }`
    (`preferences.html:257`) overlays `.content`, severing the "Image" row
    mid-scroll with no cue. Make the window a two-row grid (scrolling
    content, static footer); add a top shadow.
26. Cancel / ⚡Apply / Save & Apply — three verbs, and nothing explains how
    Apply differs from Save & Apply. Two buttons: Cancel and Save.
    `apply-config-live` already exists, so preview live on change.
27. Sliders have no min/max labels, no default marker, no reset — and at 0%
    the thumb hangs off the left end of the track. Label both ends, tick the
    default, double-click to reset, inset the track by the thumb radius.
28. Preferences hardcodes its own palette (`--mantle`, `--surface0`) and
    ignores accent colour, font and glass — beside the main window it reads
    as a different application. Share the token block.

### Glass + readability pass (2026-08-20)

The 2026-08-19 pass made the glass system *work* — surfaces get out of the
way, the OS material engages, the sliders move something. This pass is about
whether the result reads as glass and whether text stays legible on it. Both
answers are currently no, for separable reasons.

#### How it looks

29. **At Background Opacity 4% + Blur 0 there is no glass, only a clear
    film.** `computeGlass` returns `filter: 'none'` whenever blur is 0 and
    saturate is 100 (`renderer.js:405`), so 96% of the wallpaper arrives
    undiffused. Opacity and blur are independent sliders describing one
    material; below ~85% opacity a floor should kick in
    (`blur = max(blur, (1 - alpha) * 24)`).
30. **Blur defaults to 0** (`preferences.html:1009`), so a panel labelled
    "Glass Effect" ships looking like tinted plastic. Defaults should be
    ~18px blur / 70% opacity — the state the feature is named after.
31. **Saturation drives the wrong way.** `saturate(200%)` sits in the
    *backdrop* filter, so it raises the wallpaper's chroma — amplifying
    exactly the colour energy competing with the text. Real glass
    desaturates what is behind it. Retarget the slider to 60–140% and label
    it "Backdrop saturation".
32. **No brightness or contrast term.** Dark-UI glass needs the backdrop
    knocked down (`brightness(.65) contrast(.95)`) or bright wallpaper
    regions punch straight through the tint. Add to the filter chain,
    optionally as a "Backdrop dimming" slider.
33. **Every tint is pure black.** `--nh-chrome-bg`, `--nh-code-bg` and
    `--nh-glass-rail-bg` are all `rgba(0,0,0,α)` (`renderer.js:423-434`).
    Black tint desaturates whatever is behind it and reads as smoke or
    grime. Tinting toward `--ctp-mantle` (a slight violet) is what makes
    glass read as a material with its own colour rather than as shade.
34. **No rim light.** Every convincing glass material — Acrylic, macOS
    vibrancy, visionOS — has a bright top edge and a dim bottom one. Panels
    currently get background + backdrop-filter + box-shadow and nothing
    else, so they melt into the wallpaper with no defined boundary. Add
    `border-top: 1px solid rgba(255,255,255,.22)` /
    `border-bottom: 1px solid rgba(0,0,0,.25)`, scaled by alpha.
35. **No specular falloff.** A `::before` overlay of
    `linear-gradient(180deg, rgba(255,255,255,.07), transparent 40%)` on
    each glass panel is what suggests a light source hitting a surface.
36. **No grain.** Zero noise textures in the stylesheet — a pure gaussian
    blur is the tell that says "CSS glass" rather than "frosted glass". A
    2–3% tiled noise data-URI over the panels is the largest realism gain
    per line of code in this list.
37. **The shadow scales backwards.** `shadow: shadowAlpha * bgAlpha`
    (`renderer.js:412`) means the more transparent — i.e. the more
    glass-like — a panel gets, the weaker the shadow separating it from the
    backdrop. The comment reasons about avoiding a halo around an absent
    object, but the practical result is that at 4% opacity the panels have
    no edge definition whatsoever. Scale spread with `(1 - bgAlpha)` while
    keeping alpha low, or decouple the two.
38. **Nested backdrop-filters stack.** `.editor-toolbar` (`main.css:585`)
    and the status bar apply `--nh-glass-filter` while sitting inside
    `.editor-pane` (`main.css:950`), which already has it — a child's
    backdrop-filter samples the already-blurred parent, so the chrome bars
    come out muddier and heavier than the panes they sit on. It also makes
    each one a containing block for fixed-position descendants. Blur once,
    at pane level; children tint only.
39. **Corner Radius has no `overflow: hidden`.** The radius lands on
    `.app-container` (`main.css:269`) but the inner panes stay square, so at
    radius 32 their corners poke past the rounded window edge.
40. **No depth hierarchy.** Sidebar, editor, preview and modal all resolve
    to the same `--nh-glass-bg` alpha, so nothing reads as being in front of
    anything else. Multiply the base alpha per layer (panes 1×, chrome 1.3×,
    modal 1.8× plus extra blur) so a modal actually floats.

#### Readability on glass

41. **No contrast floor.** `--text-primary` is a fixed light colour over an
    arbitrary user photo; in the review screenshot the sidebar sits across
    the bright orange region and body text falls well under 4.5:1. Panel
    opacity should control how much *wallpaper* shows, never how legible
    the text is — which means a solid scrim behind text-bearing regions,
    separate from the translucent decorative layer.
42. **No text halo.** `text-shadow: 0 1px 2px rgba(0,0,0,.55)` on
    `.sidebar`, `.preview-content` and `.CodeMirror` while glass is active
    is cheap and survives any wallpaper. Nothing currently protects text at
    all.
43. **The wallpaper is never dimmed independently.** `#nhBgImage` gets
    opacity and optional blur (`renderer.js:485-489`) but there is no scrim
    between it and the panels, so a high-contrast photo sits at full
    luminance behind everything. Add an always-on scrim layer (35–55%) with
    its own slider.
44. **Syntax colours were tuned against `#1e1e2e`.** `--ctp-mauve`/`pink`/
    `green` have no defined contrast against a photograph, so heading and
    list-marker colours become unpredictable per wallpaper region. Either
    boost `--syn-*` lightness when glass is on, or hold the editor pane at a
    higher opacity floor than the decorative surfaces.
45. **The pane divider is a dirt seam.** `--border-color` is
    `var(--ctp-surface0)` (`main.css:79`) — opaque dark grey — and
    `.preview-pane` draws it as a 1px `border-left` (`main.css:967`)
    straight across the glass. Hairline `rgba(255,255,255,.12)` when glass
    is on.
46. **Selection states are white washes.** `--nh-chrome-active-bg`
    (`rgba(255,255,255,.10–.20)`) and `--nh-activeline-bg`
    (`rgba(255,255,255,.05–.11)`) at `renderer.js:433-434`. Over a photo a
    white wash reads as fog and *lowers* the contrast of the text inside it
    — the selected note in the review screenshot is barely distinguishable
    from its neighbours. Use the accent colour at low alpha plus a left
    accent bar: a shape, not a wash.
47. **Scrollbars aren't glass-aware.** The editor's horizontal bar and the
    preview's vertical bar render as dark opaque tracks laid over
    translucent panes. Restyle `::-webkit-scrollbar` to a translucent thumb
    with no track while glass is on.
48. **No reduce-transparency escape hatch.** Glass tuned to look good and
    glass tuned to be readable are different configurations, and there is no
    single switch back to legible. Add a "Reduce transparency" toggle that
    forces opacity to 100% / blur to 0 *without* destroying the user's
    slider values, honoured automatically under
    `prefers-reduced-transparency`.


## Recently fixed

- Glass/appearance settings did nothing — reported as a Windows bug, but it
  was broken on every platform including the Mac it was authored on. The CSS
  and JS were fine (sidebar really did compute to `rgba(22,22,30,0.65)` with
  `backdrop-filter: blur(10px)`); the problem was that nothing sat behind the
  panels. `--nh-glass-app-bg: transparent` was only set inside the
  `if (bgCfg.enabled && bgCfg.path)` branch, so without a background image
  `.app-container`, `body` and `.home-view` all stayed opaque — and blurring a
  flat colour returns the same flat colour, so both Background Opacity and
  Blur were inert by construction.
  Fixed in three parts: transparency is now driven by whether glass is
  actually requested rather than by the background image; `body` and
  `.home-view` yield to `--nh-glass-app-bg` too (they were painting over
  everything); and real OS translucency is enabled where it exists — macOS
  `vibrancy: 'under-window'`, Windows 11 22H2+ `backgroundMaterial: 'acrylic'`.
  Where the OS won't do it (Windows 10, Linux) the renderer paints its own
  gradient backdrop so the sliders still do something visible. `main.js`
  reports which case it's in over `get-glass-capability`, because Electron
  ignores an unsupported `vibrancy`/`backgroundMaterial` silently rather than
  erroring — which is precisely how this shipped looking fine on one OS.

- Markdown syntax highlighting in the editor. CodeMirror's markdown mode
  was already loaded and tokenizing, but `main.css` had no `.cm-*` rules,
  so every token rendered flat. Added token styling (headings scaled per
  level, emphasis, links, quotes, list markers by depth, code, hr) behind
  a `--syn-*` layer defaulting to the `--ctp-*` vocabulary, so theme
  presets re-colour the editor with the rest of the app. `theme.syntax`
  in config takes optional per-token hex overrides.
  Note: the mode was being passed as the bare string `'markdown'`, whose
  `highlightFormatting`, `strikethrough` and `taskLists` options all
  default to false — the `.cm-formatting`/`.cm-strikethrough` rules would
  have been dead CSS. Now passed as an object config with those on.
- Task list items in preview are real checkboxes instead of static
  glyphs. Clicking one flips the marker in the CodeMirror source (not the
  DOM), so editor/preview/saved note stay one source of truth.
  Index mapping caveat worth remembering: `parseMarkdown` pulls fenced
  code blocks out before its task-list pass, so a `- [ ]` line inside a
  fence never becomes a checkbox. The source-side scan has to skip fences
  too or every index after the fence shifts and the wrong line toggles.
- Right-click context menus (notes/notebooks: rename/duplicate/pin/move/
  trash/delete-forever) shipped, then reported as breaking keyboard input
  on Mac (typing acted as if Cmd was held down, needed a full OS restart
  to clear). Root cause: `trashNoteById`/`deleteNotebook`/
  `permanentlyDeleteNote` called blocking `window.confirm()`/`alert()`
  synchronously from inside a context-menu item's click handler —
  triggering a native dialog off the tail of a right-click gesture is a
  known Electron/Chromium trigger for desyncing macOS's modifier-key
  state. Replaced all three with the existing non-blocking `showModal()`
  pattern (new `confirmModal()`/`alertModal()` helpers in `renderer.js`,
  `.btn-danger` added to `main.css`). No more blocking dialogs reachable
  from the context menu.
- Preferences' "Neovim Editor" tab: the 5 dead toggles (Syntax Highlight,
  Highlight Active Line, Matching Brackets, Auto-Close Brackets, Tab Size)
  plus a 6th that was also dead but unreported (Indent With Tabs) are now
  wired into the real CodeMirror instance (`renderer.js`), reading
  `config.nvim.*`. Added the addon/mode scripts CM needed
  (`markdown.js`+`xml.js`+`meta.js` for syntax highlighting,
  `matchbrackets.js`, `closebrackets.js`, `active-line.js`) to `index.html`,
  theme-aware CSS for active-line/matching-bracket highlighting to
  `main.css`, and `c.nvim` clamping/coercion to `sanitizeConfig()` in
  `main.js` (previously orphaned — passed through untouched). `nvLN`/`nvRLN`
  on that tab remain inert duplicates of the real toggles under the Editor
  tab (`config.editor.lineNumbers`/`relativeLineNumbers`) — left alone,
  cosmetic-only overlap, not a functional bug.
- Git shell-injection claim in CLAUDE.md was stale: all `git-*` handlers in
  `main.js` already use `execFile`/`execFileSync` with argv arrays (not
  shell string interpolation) and `--`-guard user-controlled args. No code
  change needed; corrected the doc.
- Editor pane wouldn't mouse-wheel scroll (preview pane did). `.editor-pane`
  wasn't a flex container, so the `flex:1`/`min-height:0` chain down to
  `.lined-editor-wrap` → `.CodeMirror` never got a bounded height —
  `height: 100%` resolved to `auto`, CodeMirror sized itself to its full
  content instead of creating a scrollable viewport, and `.editor-pane`'s
  `overflow: hidden` clipped the rest. Added `display: flex; flex-direction:
  column;` to `.editor-pane` (main.css) to restore the height chain.
- `exec-shell` (terminal): arbitrary shell is the feature, not a vuln — the
  terminal is the only caller. Hardened instead: input validation, cwd
  existence check, and routed through an explicit shell binary via
  `execFile('/bin/bash', ['-c', cmd])` (Windows: `cmd.exe /c`) instead of
  `exec()`'s implicit shell.
- Git clone now imports the repo's `.md` files as notes. New
  `read-repo-markdown` IPC walks the clone (skips `.git`/`node_modules`/etc,
  caps 500 files / 512KB each), `app.importRepoNotes()` drops them into a
  notebook named after the repo, path-relative titles.
- Vim insert-mode multi-key leak: was NOT a vim-addon bug. The addon cleans
  up the trigger correctly; the leak came from the editor's `change` handler
  syncing `currentNote.content` mid-sequence, so a re-rendering action
  reloaded pre-cleanup text. Fixed by deferring the bound action one
  microtask (`Promise.resolve().then`) so cleanup syncs first. Stays in
  insert mode, works for any sequence length.

## Built 2026-08-19 (this session's list)

- **Resizable + collapsible navigation sidebar.** Drag handle between the
  sidebar and the editor (`#sidebarResizer`), clamped 160–600px to match
  `sanitizeConfig`'s existing clamp on `ui.sidebarWidth`; double-click the
  handle, Ctrl/Cmd+B, the `‹` button at the bottom of the tab rail, or the
  new "Toggle Sidebar" palette command collapse it. State persists as
  `ui.sidebarWidth` + the new `ui.sidebarCollapsed`, and Preferences →
  Advanced → Layout exposes both.
  Two traps worth remembering. (1) `save-config` sends `apply-config-live`
  back to the *main* window as well as forward from Preferences, so the
  window that saved re-ran `applyConfigLive` → `renderEditor()` → a fresh
  CodeMirror on every sidebar drag, silently dropping cursor, selection and
  undo history mid-edit. `persistConfig()` now tags its own save and the
  listener skips the echo. (2) `preferences.html`'s `collect()` rebuilds each
  config section from the fields it renders, so anything it doesn't render
  was being dropped on every save — `ui.sidebarCollapsed` would have been
  reset by any unrelated preference change, and `theme.syntax` already was.
  It now spreads the on-disk section first (`collectFresh()` re-reads it, so
  the carried-over values aren't stale).
- **Atmosphere slice 2 — editor bright panel.** The note now sits on the
  warm `--surface-bright` panel with the open notebook's colour as its accent
  rule and heading colour. Implemented as a *scoped token override* on
  `.editor-wrapper.bright .editor-body` rather than a parallel rule set:
  every editor/preview rule already resolves through
  `--text-*`/`--border-color`/`--ctp-*`/`--syn-*`, so redefining those
  re-colours preview, tables, code blocks, checkboxes and CodeMirror tokens
  at once. Raw palette colours are unreadable as ink on cream (`#ffc466`
  especially), hence `shadeHex()` and the `--nb-accent-ink` variant.
  Known consequence: `theme.syntax` overrides land on `:root` as inline
  props, so they lose to the panel's own `--syn-*` and don't reach inside it.
  Toggle: `theme.brightPanel` (Preferences → Appearance, or the palette).
- **Atmosphere slice 2 — note info card.** Word count, reading time and
  last-edited, floating top-right of the panel as dark glass on the bright
  surface. Updates on the CodeMirror `change` event, not just on save, so it
  tracks typing.
- **Atmosphere slice 2 — command palette restyle.** Rim-lit glass box over a
  blurred scrim, with the spec's 2.5px-tracked eyebrow labels for categories
  and light-overlay hovers instead of opaque surface fills.
- **Notebook colour picker UI.** Curated palette swatches plus a native
  colour input, in the create-notebook modal and behind a new "Change
  Colour…" notebook context-menu item. Both write to one hidden field so the
  swatch and custom paths can't disagree; `normalizeNotebookColor()` validates.
- **Note version history** (first v2-roadmap Phase 0 item). `history:
  [{ content, savedAt }]` on each note, capped at 50 entries and throttled to
  one snapshot per 90s so autosave doesn't fill the cap with one typing
  session. Toolbar 🕘, or "Note History" in the palette: preview any version
  inline, restore with the current text kept as a new entry (so restore is
  itself reversible).
  The non-obvious part: the editor's `change` handler writes straight into
  `currentNote.content` on every keystroke, so the note object can't tell you
  what the last *saved* content was — comparing against it would never see a
  change and no version would ever be recorded. `_historyBaseline` holds the
  last-saved text instead.

### Glass, after seeing it run (2026-08-19, same session)

Reported as "in what world does this look anything glass like" against a real
build. Three separate defects, all found by running the app and reading
computed styles over the devtools protocol rather than by reading CSS:

- **Two containers painted over the whole window.** `.editor-area` and
  `.editor-wrapper` both hardcoded `background: var(--bg-primary)` and were
  never in the glass system, so an opaque slab covered the editor half no
  matter what the sliders did. `.editor-wrapper` is rebuilt by
  `renderEditor()` per note switch — it isn't in `index.html`, which is how a
  static sweep of the markup missed it. Both now yield to
  `--nh-glass-app-bg`, same as `body`/`.app-container`.
- **Acrylic never engaged.** `getGlassCapability()` correctly reported
  `{supported:true, kind:'acrylic'}` on Win11 24H2 and the window *was*
  transparent — but crisply, with no frost. Electron applies
  `backgroundMaterial` inconsistently at construction; re-asserting it on
  `ready-to-show` is what makes DWM produce the blurred backdrop. Worth
  keeping in mind: **CSS `backdrop-filter` cannot blur anything outside the
  page**, so the frosted look can only ever come from the OS material. On
  Windows 10/Linux the painted-gradient fallback is the ceiling.
- **Corner Radius rounded the inner panels.** In unified mode
  `--nh-glass-radius` lands on `:root`, and `.sidebar`, `.editor-pane`,
  `.preview-pane` and `.modal` each read it — so the slider rounded the
  internal split panes instead of the window. It now applies to
  `.app-container` only.

Then a second sweep for surfaces that still filled with solid paint while
everything around them was translucent — each one read as a dark slab laid
across the window: the CodeMirror gutter, preview code blocks, the editor
toolbar, the status bar, the sticky notes header, the selected-note card and
the active-line band. All tint now, scaled by the same alpha as the panels
(`--nh-chrome-bg`, `--nh-chrome-active-bg`, `--nh-activeline-bg`,
`--nh-code-bg`, `--nh-glass-rail-bg`).

Lesson worth keeping: "is it transparent" is not answerable by reading the
stylesheet. Enumerating every element with a near-opaque computed background
found all seven in one query; four sessions of reading CSS had not.

- **Markdown markup characters no longer dim.** `.cm-formatting` set its own
  colour at 55% opacity, and CodeMirror only tags a character as formatting
  once the construct completes — so `#` looked normal until you typed the
  space after it and then visibly died. The rule now sets no colour, letting
  the earlier `.cm-header`/`.cm-strong`/`.cm-quote` rule win at equal
  specificity, so the marker matches the text it belongs to. The old look is
  opt-in via `theme.dimMarkup: true`.

### Sidebar navigation + reordering (requested 2026-08-19)

- **Collapsible sidebar sections.** The Notebooks and notes headers are now
  toggles (`ui.notebooksCollapsed` / `ui.notesCollapsed`). The header is the
  button and the `+` keeps its own click, so creating a notebook can't
  collapse the list out from under you.
- **Drag to reorder** notebooks (both the tab rail and the sidebar list) and
  notes. One handler set covers all three lists; `kind` decides which array is
  rewritten. Drop indicator is a line on the leading edge, so it shows where
  the item lands rather than just what's under the cursor.
  Constraint worth remembering: `sortPinnedFirst()` groups pinned notes ahead
  of the rest at render time, so a drag across the pin boundary can't produce
  the order the user just drew. That drop is refused with an explanation
  rather than silently reordering into a group the note won't display in.
- **Selecting a notebook opens its first note.** Previously it always cleared
  `currentNote`, so you landed on the "Create Your First Note" screen even
  when the notebook had notes — offering to create a *first* note in a
  notebook holding several. Harmless with the sidebar open (the list was right
  there); a dead end with it collapsed, which is how it was found.
- **Keyboard navigation for the collapsed sidebar**: Ctrl+Tab cycles notes
  within the current notebook, Ctrl+Shift+Tab cycles notebooks (landing on
  each one's first note), Ctrl+T makes a new note alongside the existing
  Ctrl+N. All four are also palette commands, along with previous-note and
  previous-notebook, which have no binding yet — note that Ctrl+Shift+Tab
  conventionally means "previous", so these bindings deliberately diverge from
  browser semantics and there is no reverse binding for either cycle.

Not yet verified in a running app — built while the machine was in use.

Deliberately skipped: light-mode token values (user's call — not wanted yet).

## Packaging gaps

`package.json`'s `files` list keeps missing entries as new renderer scripts
get added. Fixed so far: `fonts/**/*`, `preferences.html`, `note-utils.js`,
`node_modules/codemirror/**/*` (CodeMirror 5 editor migration). Swept once
for anything else referenced by index.html/preferences.html and found
nothing else missing. If a fresh `ReferenceError` for an undefined function
shows up after a rebuild, check this file first.

`package.json` used to be gitignored on `main` and had never been committed
there — a fresh clone would `npm install` fine, then fail every
`npm run build*` because there was no `scripts` block. Fixed: the ignore line
was dropped and the file committed on `feature/mockup-theme-system-and-fixes`
(01c47a6, e278bce), and that reached `main` in 080524c.

Watch the branch, not just the commit: the syntax-highlighting and task-checkbox
work sat on `feature/mockup-theme-system-and-fixes` with no open PR (its PR #13
had merged long before), so a Windows build off `main` came out with neither
feature and no obvious error. Check `git log --oneline -3` on the machine you
build from before assuming a feature shipped.

`package-lock.json` is gitignored too, so no machine reproduces another
machine's dependency tree — a fresh `npm install` re-resolves `electron ^43`
and `electron-builder ^26` every time.

`build/` was deleted wholesale in b8ea244 while `package.json` still pointed
at `build/icon.icns` / `icon.ico` / `icons` — electron-builder doesn't error
on a missing icon path, it silently falls back to the stock Electron icon,
so this would only have surfaced in the Dock after a packaged run. Restored
from b8ea244^ and `.DS_Store` untracked.

## Design decisions pending

- Plugin system rebuild (new `notehub-plugins` repo, install-from-git-URL):
  soft capability-scoped API, not iframe sandboxing. Migrating
  git-integration + terminal first. No spec written yet.
- Right-click context menu for empty space / editor / "Open Terminal Here"
  still not built (notes + notebooks context menus shipped — see Recently
  fixed).

## Approved, not built

- Light-mode token values (dark mode only so far). Explicitly deferred — the
  bright editor panel is *not* light mode; it's a light panel inside the dark
  shell, and the two are independent.
- Broader roadmap in `docs/superpowers/specs/2026-07-26-notehub-v2-design.md`:
  backlinks, attachments, encryption, sync backend, mobile. (Note history —
  the first Phase 0 item — shipped 2026-08-19, see above.) Note that the
  spec's Phase 0 also calls for moving off the single `notebooks.json` blob
  to one record per note; history is stored inline on the note for now, which
  is fine at a 50-version cap but is the first thing that will push that blob
  toward being a real problem.

## Feature backlog (proposed 2026-08-10, no specs yet)

Overlaps with items above (backlinks, attachments, encryption, sync, mobile,
context menus, light mode) are tracked there, not duplicated here. Note
history and the notebook colour picker shipped 2026-08-19.

- Full-text fuzzy search across all notebooks
- Quick-switcher (Cmd+K fuzzy jump between notes, VSCode-style)
- Tags/labels + tag browser sidebar
- Daily notes / journal mode (auto-dated note on open)
- Note templates on creation
- Table-of-contents sidebar generated from headings
- KaTeX math rendering in preview
- Mermaid diagram rendering in preview
- Focus/Zen mode (hide chrome, distraction-free) — **requested 2026-08-19,
  wanted next.** Design notes from that conversation: hide the tab rail,
  sidebar, toolbar and status bar, centre the editor column at a readable
  measure, and keep the glass backdrop. The collapse plumbing built this
  session (`ui.sidebarCollapsed`, `applySidebarState()`) is the obvious
  foundation — zen is that plus the other three chrome elements, ideally one
  reversible state rather than four independent toggles, on its own shortcut
  and palette command. Not yet spec'd.
- Word count / reading-time stats per note & notebook
- Export to PDF/DOCX/HTML (beyond current `.md` import)
- Split-pane multi-note editing
- Import from Obsidian/Notion/Apple Notes/Evernote
- Global hotkey quick-capture (tray icon, capture-to-inbox from anywhere)
- Kanban/task board auto-generated from checkbox lists across notes
- Plugin marketplace/registry UI (pairs with the `notehub-plugins` rebuild)
- Multi-window support (pop a note into its own window)
- Spaced-repetition flashcards from Q/A-formatted notes
- Note-level password lock (separate from full-notebook encryption)
- LLM-assisted note actions (summarize/rewrite/ask, via Claude API — fits
  `preload.js` IPC pattern)
