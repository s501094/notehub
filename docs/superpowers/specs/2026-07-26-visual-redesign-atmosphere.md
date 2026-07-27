# Visual Redesign: "Atmosphere"

Status: Approved (2026-07-26)

## Goal

Replace NoteHub's current look — flat Catppuccin/Tokyo-Night-style colors on
boxy, hard-bordered chrome (the "old Windows 7 app" complaint) — with a
distinctive visual identity, locked in through iterative mockups in the
brainstorming visual companion (`.superpowers/brainstorm/59874-1785114666/content/`,
final: `theme-final-combined.html`).

This spec covers the design system only (tokens, layout concepts, signature
elements). Implementation is a separate plan.

## What this is not

Not a color-scheme swap on the existing layout. Two structural changes are
part of this: notebooks gain a bento-grid "Notebooks" home screen (replacing
the always-visible flat notebook list as the app's landing view), and
notebooks gain a persistent tab-rail for quick switching without leaving a
note. Existing functionality (notes, notebooks, markdown editing, command
palette, plugins) is unchanged — this is a visual and navigational layer, not
a feature or data-model rewrite, except for the one addition below.

## Data model addition

Notebook objects (`this.data.notebooks[]` in `renderer.js`, currently
`{ id, name, icon, created }`) gain a `color: string` (hex) field — assigned
from the curated palette below when a notebook is created, user-changeable
later. This is what drives the tab rail's color, the bento card's tint, and
the editor's accent-rule/code-block color when that notebook is open.

## Token system

**Color** (dark-mode base; see "Light mode" below for the inverse):
- `--bg-void: #08080b` — the base shell background, near-black but not flat
- `--bg-glass: rgba(255,255,255,.045)` — glass panel fill, used with `backdrop-filter: blur(24px)`
- `--border-glass: rgba(255,255,255,.08)`, top edge `rgba(255,255,255,.18)` — the rim-light effect (a lighter top border than the rest, simulating light catching the upper edge of glass)
- `--surface-bright: radial-gradient(140% 100% at 50% 0%, #faf8f4, #f0ece3)` — the editor's bright contrast panel (warm off-white, not flat cream, with a subtle top-lit radial tint)
- Curated notebook palette (4 defaults, more can be added by the user):
  `#7c6df0` (violet), `#2dc4b6` (teal), `#f07c5e` (coral), `#ffc466` (amber)
- Text: `#f1f1f4` primary (on dark), `#221f1a` primary (on the bright panel), `rgba(255,255,255,.55)` muted

**Type:**
- Display (note titles, notebook names, wordmark): Space Grotesk, 600–700 weight
- Body/UI (chrome, labels, paragraphs): Inter, 400–500 weight
- Mono (code blocks, markdown source, technical metadata): JetBrains Mono (already the app's configured editor font — kept, not replaced)
- A recurring micro-label device: small-caps-style uppercase text at 10px with 2.5px letter-spacing (`── N O T E B O O K S ──` style eyebrows) for section labels — used sparingly, only for actual section headers, not as generic decoration

**Layout concepts:**
- **Atmosphere**: each notebook has an abstract gradient "atmosphere" — 2–3 blurred radial gradients in the notebook's color, layered with a subtle SVG `feTurbulence` grain overlay (`mix-blend-mode: overlay`, ~30% opacity) so it reads as textured/painterly rather than a flat smooth gradient. Foreground blobs are sharper (less blur), background wash is softer (more blur) — real depth of field, not uniform blur.
- **Tab rail**: a 34px persistent left rail with a physical punch-hole texture (`radial-gradient` dot pattern) and glossy, rounded-right tab shapes per notebook (using its color), the active tab wider with an ambient glow (`box-shadow` in the notebook's color). Present in both the home and editor views for quick-switching.
- **Bento grid home**: the Notebooks view (new app landing screen) is a `grid-template-columns: 1.3fr 1fr 1fr` / `grid-template-rows: 1fr 1fr` bento layout, not a flat list. The first (most-recent or pinned) notebook gets the large `grid-row: span 2` card. Each card is a glass panel tinted with its notebook's color and shows note count, last-updated, and a small **activity graph** (bar chart of edits per day — real data, replacing what would otherwise be decorative flourish).
- **Bright-panel contrast**: the note editor itself sits in the warm off-white `--surface-bright` panel, a deliberate strong light/dark contrast against the dark atmosphere and glass chrome around it — the session's single boldest move, used only here (not diluted elsewhere).
- **Note info card**: a small dark glass card floats in the top-right of the bright editor panel showing word count and last-edited time — compact metadata, not decoration.
- **Command palette**: rendered as a glass panel (same `--bg-glass`/blur/rim-light system) centered over a darkened, blurred scrim — the existing Cmd+Shift+P command palette gets this treatment as the system's clearest showcase, no new palette functionality.

**Signature element:** the combination of the per-notebook atmosphere (grain-textured, depth-of-graded gradient) bleeding through the glass tab rail and bento cards, cutting against the stark bright-panel editor — one continuous color language from navigation through to the page itself, breaking hard where you're actually writing.

## Light mode

Config already has `theme.mode: 'light' | 'dark'`. Light mode inverts the
relationship: the shell background becomes a soft warm-white
(`radial-gradient` still present but much lower opacity/more washed out),
glass panels become `rgba(0,0,0,.04)` on white rather than `rgba(255,255,255,...)`
on black, and the "bright panel" contrast trick flips — the editor becomes a
close-to-black panel floating on the light atmosphere instead of the reverse.
Exact light-mode values are an implementation-time task, not re-litigated
here; the token *relationships* (glass-on-atmosphere, bright-panel contrast)
carry over, just inverted.

## Fonts: bundle, don't depend on network

Mockups used Google Fonts CDN `@import` for iteration speed. The shipped app
must not depend on network access to render correctly — Space Grotesk, Inter,
and JetBrains Mono ship as local `.woff2` files (each has an OFL license
permitting bundling) referenced via local `@font-face` rules, matching this
desktop app's offline-first expectation. `preferences.html`'s existing font
picker (which lists installed system fonts) is unaffected — this only changes
the app's own default UI/display fonts, not the user-selectable note/editor
font.

## Technical notes for implementation

- `backdrop-filter` is well-supported in the Chromium version Electron ships;
  no fallback needed for a desktop-only app.
- The grain texture is a single reusable inline SVG filter
  (`feTurbulence` + `feColorMatrix` desaturate), not a bundled image asset.
- This is a `main.css`/`index.html`/`renderer.js` rewrite of styling and the
  addition of one new view (bento-grid Notebooks home) and one new
  navigation element (tab rail) — not a rewrite of note/notebook data
  handling, markdown parsing, or plugin loading.
- Existing plugins (git-integration, terminal, neovim-editor, etc.) render
  inside their own modals with their own hardcoded styles (per
  `docs/superpowers/specs/2026-07-26-git-panel-consolidation-design.md`'s
  findings on git-integration specifically) — out of scope to reskin every
  plugin in this pass; only the core app shell (sidebar/rail, home, editor,
  command palette) is covered here.

## Out of scope (this spec)

- Reskinning individual plugins' own UI (git-integration, terminal,
  neovim-editor, math-renderer, etc.) — each has its own hardcoded styles;
  a follow-up concern, not blocking this spec.
- Notebook color picker UI polish (the field exists per-notebook; whatever
  minimal color-swatch picker is needed to set it is an implementation
  detail, not a design decision requiring further brainstorming).
- Any change to note-taking functionality, markdown rendering, sync,
  encryption, or the mobile/React Native work tracked in
  `docs/superpowers/specs/2026-07-26-notehub-v2-design.md`.
