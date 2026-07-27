# Visual Redesign "Atmosphere" — Foundation, Bento Home, Tab Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first visible slice of the "Atmosphere" redesign: locally-bundled fonts and CSS design tokens, a per-notebook color field, a bento-grid Notebooks home screen (replacing the static welcome screen as the landing view), and a persistent tab rail for quick notebook switching.

**Architecture:** Additive CSS custom properties and a handful of reusable classes (`.glass`, `.atmosphere`, grain filter) layered into the existing `styles/main.css` rather than a full rewrite of its 1378 lines. `renderer.js` gains a `color` field on notebook objects, a new `renderHomeView()` render path (shown when no notebook is selected), and a rail render function — both driven by the same notebook data already in `this.data.notebooks`.

**Tech Stack:** Vanilla JS/CSS/HTML (no bundler, per this project's existing constraints), locally-hosted Google Fonts (Space Grotesk, Inter, JetBrains Mono — OFL licensed, bundling permitted).

## Global Constraints

- No network dependency at runtime — fonts are local `.woff2` files, not a Google Fonts CDN `@import` (per `docs/superpowers/specs/2026-07-26-visual-redesign-atmosphere.md`'s "Fonts: bundle, don't depend on network").
- Existing `theme.mode: 'light'|'dark'` config option must keep working; this plan implements dark mode fully and leaves light-mode token values as a follow-up (per spec's "Light mode" section — token *relationships* are documented, exact values are implementation-time).
- `contextIsolation`/`nodeIntegration` unchanged — this plan touches no IPC.
- Notebook color assignment must not break existing notebooks created before this change — `withNotebookDefaults`-style backward compatibility, same pattern as `note-utils.js`'s `withNoteDefaults`.

---

### Task 1: Local fonts + design tokens + notebook color field

**Files:**
- Create: `fonts/space-grotesk-600.woff2`, `fonts/space-grotesk-700.woff2`, `fonts/inter-400.woff2`, `fonts/inter-500.woff2` (binary font files, fetched — see Step 1)
- Create: `notebook-utils.js` (pure functions, tested — mirrors `note-utils.js`'s pattern)
- Create: `tests/notebook-utils.test.js`
- Modify: `styles/main.css` (add `@font-face` rules and new `:root` custom properties near the existing `--ctp-*` block)
- Modify: `index.html` (load `notebook-utils.js` before `renderer.js`)
- Modify: `renderer.js` (`loadData()`, `handleCreateNotebook()`, notebook creation modal)

**Interfaces:**
- Produces: `NOTEBOOK_PALETTE` — array of 4 curated hex strings: `['#7c6df0', '#2dc4b6', '#f07c5e', '#ffc466']`
- Produces: `nextNotebookColor(existingNotebooks)` → hex string (cycles through `NOTEBOOK_PALETTE` by existing-notebook count, so notebook 5 repeats notebook 1's color rather than erroring)
- Produces: `withNotebookDefaults(notebook)` → notebook object with `color` filled in if missing (same backfill pattern as `note-utils.js`'s `withNoteDefaults`)
- Produces (CSS custom properties, added to `:root`): `--void-bg`, `--glass-bg`, `--glass-border`, `--glass-border-top`, `--bright-panel-bg-from`, `--bright-panel-bg-to`, `--font-display` (Space Grotesk stack), `--font-body` (Inter stack) — `--font-mono` already exists as `JetBrains Mono` in the config-driven `--font-family`/editor font, left alone

- [ ] **Step 1: Fetch the font files**

Run (downloads the actual `.woff2` files Google Fonts serves, not just the CSS that references them):
```bash
mkdir -p fonts
curl -sL "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap" \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -o /tmp/gfonts.css
grep -oE "https://fonts.gstatic.com/[^)]+\.woff2" /tmp/gfonts.css
```
Download each URL the grep prints (there will be one per weight/family combination — pick the `latin` subset entries, they're listed first) with `curl -sL <url> -o fonts/<name>.woff2`, naming them `space-grotesk-600.woff2`, `space-grotesk-700.woff2`, `inter-400.woff2`, `inter-500.woff2` to match the `@font-face` rules in Step 3.

- [ ] **Step 2: Write the failing tests**

```javascript
// tests/notebook-utils.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { NOTEBOOK_PALETTE, nextNotebookColor, withNotebookDefaults } = require('../notebook-utils');

test('NOTEBOOK_PALETTE has 4 curated colors', () => {
  assert.equal(NOTEBOOK_PALETTE.length, 4);
  NOTEBOOK_PALETTE.forEach(c => assert.match(c, /^#[0-9a-f]{6}$/i));
});

test('nextNotebookColor cycles through the palette', () => {
  assert.equal(nextNotebookColor([]), NOTEBOOK_PALETTE[0]);
  assert.equal(nextNotebookColor([{}, {}]), NOTEBOOK_PALETTE[2]);
  assert.equal(nextNotebookColor([{}, {}, {}, {}]), NOTEBOOK_PALETTE[0]); // wraps around
});

test('withNotebookDefaults fills in missing color', () => {
  const notebook = { id: '1', name: 'Research' };
  const result = withNotebookDefaults(notebook, 0);
  assert.equal(result.color, NOTEBOOK_PALETTE[0]);
});

test('withNotebookDefaults preserves an existing color', () => {
  const notebook = { id: '1', name: 'Research', color: '#123456' };
  const result = withNotebookDefaults(notebook, 0);
  assert.equal(result.color, '#123456');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/notebook-utils.test.js`
Expected: FAIL — `Cannot find module '../notebook-utils'`

- [ ] **Step 4: Write the minimal implementation**

```javascript
// notebook-utils.js
const NOTEBOOK_PALETTE = ['#7c6df0', '#2dc4b6', '#f07c5e', '#ffc466'];

function nextNotebookColor(existingNotebooks) {
    return NOTEBOOK_PALETTE[existingNotebooks.length % NOTEBOOK_PALETTE.length];
}

function withNotebookDefaults(notebook, index) {
    return {
        ...notebook,
        color: notebook.color || NOTEBOOK_PALETTE[index % NOTEBOOK_PALETTE.length],
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NOTEBOOK_PALETTE, nextNotebookColor, withNotebookDefaults };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/notebook-utils.test.js`
Expected: PASS — all 4 tests green

- [ ] **Step 6: Add `@font-face` rules and design tokens to `styles/main.css`**

At the very top of `styles/main.css` (before the existing `:root` block at line 2), add:
```css
@font-face { font-family: 'Space Grotesk'; src: url('../fonts/space-grotesk-600.woff2') format('woff2'); font-weight: 600; font-display: swap; }
@font-face { font-family: 'Space Grotesk'; src: url('../fonts/space-grotesk-700.woff2') format('woff2'); font-weight: 700; font-display: swap; }
@font-face { font-family: 'Inter'; src: url('../fonts/inter-400.woff2') format('woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'Inter'; src: url('../fonts/inter-500.woff2') format('woff2'); font-weight: 500; font-display: swap; }
```
Inside the existing `:root { ... }` block (starts at line 2), add alongside the `--ctp-*` variables:
```css
    /* Atmosphere design tokens */
    --font-display: 'Space Grotesk', sans-serif;
    --font-body: 'Inter', -apple-system, sans-serif;
    --void-bg: #08080b;
    --glass-bg: rgba(255,255,255,.045);
    --glass-border: rgba(255,255,255,.08);
    --glass-border-top: rgba(255,255,255,.18);
    --bright-panel-bg-from: #faf8f4;
    --bright-panel-bg-to: #f0ece3;
```

- [ ] **Step 7: Load `notebook-utils.js` and apply defaults on data load**

In `index.html`, add before `<script src="renderer.js"></script>`:
```html
    <script src="notebook-utils.js"></script>
```
In `renderer.js`'s `loadData()` (apply the same pattern as `withNoteDefaults` for notes — find the notes-defaulting line added by the trash/pins work if present, otherwise add fresh):
```javascript
        this.data.notebooks = this.data.notebooks.map((nb, i) => withNotebookDefaults(nb, i));
```

- [ ] **Step 8: Assign a color when creating a notebook**

In `handleCreateNotebook()` (renderer.js, the notebook object literal), add:
```javascript
            color: nextNotebookColor(this.data.notebooks),
```
alongside the existing `id`, `name`, `icon`, `created` fields.

- [ ] **Step 9: Manual verification**

Run: `node --check renderer.js && echo OK`, then `npm start`:
1. Confirm the app still launches and looks unchanged (this task only adds tokens/data, nothing renders differently yet).
2. Open DevTools console, run `document.fonts.check('600 16px "Space Grotesk"')` — confirm `true` (font loaded locally, no network request needed — check the Network tab shows no `fonts.googleapis.com`/`fonts.gstatic.com` requests).
3. Create a new notebook — confirm in DevTools (`app.data.notebooks`) that it has a `color` field from `NOTEBOOK_PALETTE`.

- [ ] **Step 10: Commit**

```bash
git add fonts/ notebook-utils.js tests/notebook-utils.test.js styles/main.css index.html renderer.js
git commit -m "feat: add local Atmosphere design tokens, fonts, and per-notebook color field"
```

---

### Task 2: Bento-grid Notebooks home screen

**Files:**
- Modify: `index.html` (replace the static `#welcomeScreen` content with a new `#homeView` container, shown specifically when no notebook is selected)
- Modify: `renderer.js` (`renderEditor()`, add `renderHomeView()`)
- Modify: `styles/main.css` (add `.home-view`, `.bento-grid`, `.bento-card`, `.atmosphere`, grain filter classes)

**Interfaces:**
- Consumes: `NOTEBOOK_PALETTE`/`withNotebookDefaults` from Task 1
- Consumes: `this.data.notebooks[].color`, `this.data.notes[]` (for per-notebook note counts and activity)
- Produces: `renderHomeView()` (new method on `NoteHubApp`, called from `renderEditor()` when `!this.currentNotebook`)
- Produces: `notebookActivityBars(notebookId)` (new method, returns an array of 7 numbers — edit counts for the last 7 days — used by both this task and reused by Task 3 if the rail ever wants a mini indicator, though Task 3 doesn't use it)

- [ ] **Step 1: Add the bento-grid and glass CSS**

Add to `styles/main.css` (near the design tokens added in Task 1):
```css
.home-view {
    display: none; height: 100%; padding: 32px;
    background: var(--void-bg);
    position: relative; overflow: auto;
}
.home-view.visible { display: block; }
.home-eyebrow {
    font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase; font-weight: 600;
    color: rgba(255,255,255,.55); margin-bottom: 16px; font-family: var(--font-body);
}
.bento-grid {
    display: grid; grid-template-columns: 1.3fr 1fr 1fr; grid-auto-rows: 160px; gap: 14px;
}
.bento-card {
    border-radius: 16px; padding: 18px; cursor: pointer; position: relative; overflow: hidden;
    background: var(--glass-bg); backdrop-filter: blur(24px);
    border: 1px solid var(--glass-border); border-top-color: var(--glass-border-top);
    box-shadow: 0 14px 34px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.1);
    color: #f1f1f4; transition: transform .15s;
}
.bento-card:hover { transform: translateY(-2px); }
.bento-card.featured { grid-row: span 2; display: flex; flex-direction: column; justify-content: space-between; }
.bento-card-name { font-family: var(--font-display); font-weight: 700; font-size: 18px; margin-bottom: 4px; }
.bento-card-meta { font-size: 11px; color: rgba(255,255,255,.6); }
.bento-activity { display: flex; align-items: flex-end; gap: 3px; height: 24px; margin-top: 10px; }
.bento-activity div { width: 4px; border-radius: 2px 2px 0 0; background: rgba(255,255,255,.5); }
.bento-new-card {
    display: flex; align-items: center; justify-content: center;
    border-style: dashed; color: rgba(255,255,255,.5); font-size: 12.5px;
}
```

- [ ] **Step 2: Replace the welcome screen markup with a home-view container**

In `index.html`, replace the entire `<div class="welcome-screen" id="welcomeScreen">...</div>` block (the static "Welcome to NoteHub" content) with:
```html
                    <div class="welcome-screen" id="welcomeScreen">
                        <div class="welcome-icon">📓</div>
                        <h1 id="welcomeTitle">Select a note</h1>
                        <p id="welcomeSubtitle">Choose a note from this notebook, or create a new one.</p>
                        <div class="welcome-actions">
                            <button class="btn-primary" id="welcomeNewNoteBtn" onclick="app.createNewNote()">
                                Create Your First Note
                            </button>
                        </div>
                    </div>
                    <div class="home-view" id="homeView"></div>
```
(This keeps the per-notebook empty state simple per the spec's "not a rewrite" note — `welcomeScreen` now only shows when a notebook *is* selected but has no open note; `homeView` is the new bento grid shown when no notebook is selected at all.)

- [ ] **Step 3: Add `notebookActivityBars` and `renderHomeView`**

In `renderer.js`, add near `renderNotebooksList`:
```javascript
    notebookActivityBars(notebookId) {
        const days = 7;
        const counts = new Array(days).fill(0);
        const now = Date.now();
        this.data.notes
            .filter(n => n.notebookId === notebookId)
            .forEach(n => {
                const daysAgo = Math.floor((now - new Date(n.updated).getTime()) / 86400000);
                if (daysAgo >= 0 && daysAgo < days) counts[days - 1 - daysAgo]++;
            });
        return counts;
    }

    renderHomeView() {
        const container = document.getElementById('homeView');
        const cards = this.data.notebooks.map((nb, i) => {
            const noteCount = this.data.notes.filter(n => n.notebookId === nb.id).length;
            const bars = this.notebookActivityBars(nb.id);
            const maxBar = Math.max(1, ...bars);
            const barsHtml = bars.map(v => `<div style="height:${Math.max(8, (v / maxBar) * 100)}%"></div>`).join('');
            return `
                <div class="bento-card ${i === 0 ? 'featured' : ''}" onclick="app.selectNotebook('${nb.id}')"
                     style="background: linear-gradient(160deg, ${nb.color}33, rgba(255,255,255,.03));">
                    <div>
                        <div class="bento-card-name">${nb.name}</div>
                        <div class="bento-card-meta">${noteCount} note${noteCount === 1 ? '' : 's'}</div>
                    </div>
                    ${i === 0 ? `<div><div class="home-eyebrow" style="font-size:9px; margin-bottom:6px;">Activity</div><div class="bento-activity">${barsHtml}</div></div>` : ''}
                </div>`;
        }).join('');

        container.innerHTML = `
            <div class="home-eyebrow">◆ Notebooks</div>
            <div class="bento-grid">
                ${cards}
                <div class="bento-card bento-new-card" onclick="app.createNewNotebook()">+ New Notebook</div>
            </div>`;
    }
```

- [ ] **Step 4: Wire it into `renderEditor()`**

In `renderEditor()` (renderer.js), at the top of the method, add the home/welcome/editor branch:
```javascript
    renderEditor() {
        const container = document.getElementById('editorContainer');
        const welcomeScreen = document.getElementById('welcomeScreen');
        const homeView = document.getElementById('homeView');

        if (!this.currentNotebook) {
            homeView.classList.add('visible');
            welcomeScreen.style.display = 'none';
            const existingEditor = container.querySelector('.editor-wrapper');
            if (existingEditor) existingEditor.remove();
            this.renderHomeView();
            return;
        }
        homeView.classList.remove('visible');

        if (!this.currentNote) {
            welcomeScreen.style.display = 'flex';
            const existingEditor = container.querySelector('.editor-wrapper');
            if (existingEditor) existingEditor.remove();
            return;
        }

        welcomeScreen.style.display = 'none';
        // ...rest of the existing method (building/updating .editor-wrapper) is unchanged below this point
```
(This replaces just the top of the existing method — the `if (!this.currentNote) { ... }` branch and everything after it in the current code stays exactly as-is, just now reached only when `this.currentNotebook` is truthy.)

- [ ] **Step 5: Manual verification**

Run: `node --check renderer.js && echo OK`, then `npm start`:
1. On launch (no notebook selected), confirm the bento-grid home view appears instead of the old static welcome screen, with one card per notebook, the first one large with an activity graph.
2. Click a non-featured notebook card — confirm it navigates into that notebook's note list (existing `selectNotebook` behavior).
3. Click "+ New Notebook" — confirm the existing create-notebook modal opens.
4. Create a few notes across notebooks with different `updated` timestamps (or just create/edit notes now) and confirm the activity bars on the featured card reflect real edit counts, not placeholder data.
5. Click a notebook in the sidebar list, then click back to a state with no notebook selected (if there's no direct "go home" action yet, this is fine — Task 3's rail's a cleaner way to get there; confirmed via DevTools by calling `app.currentNotebook = null; app.render()`).

- [ ] **Step 6: Commit**

```bash
git add index.html renderer.js styles/main.css
git commit -m "feat: add bento-grid Notebooks home screen with real per-notebook activity graphs"
```

---

### Task 3: Persistent tab rail

**Files:**
- Modify: `index.html` (add the rail container to the sidebar)
- Modify: `renderer.js` (`renderNotebooksList` → also render the rail; a "go home" action)
- Modify: `styles/main.css` (`.tab-rail`, `.tab-rail-item` — punch-hole texture, glow)

**Interfaces:**
- Consumes: `this.data.notebooks[].color` from Task 1
- Produces: `renderTabRail()` (new method), `goHome()` (new method — sets `this.currentNotebook = null` and re-renders, giving a way back to the bento grid)

- [ ] **Step 1: Add the rail CSS**

Add to `styles/main.css`:
```css
.tab-rail {
    width: 34px; flex-shrink: 0; background: rgba(0,0,0,.35);
    display: flex; flex-direction: column; align-items: center; padding-top: 16px; gap: 12px;
    position: relative; border-right: 1px solid var(--glass-border);
}
.tab-rail::before {
    content: ''; position: absolute; left: 12px; top: 0; bottom: 0; width: 8px;
    background-image: radial-gradient(circle, rgba(255,255,255,.06) 2px, transparent 2.5px);
    background-size: 8px 24px; background-repeat: repeat-y; background-position: 0 12px;
}
.tab-rail-item {
    width: 22px; height: 32px; border-radius: 0 8px 8px 0; margin-left: -1px; cursor: pointer;
    box-shadow: 2px 3px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.3);
    opacity: .55; transition: all .15s;
}
.tab-rail-item.active { opacity: 1; height: 40px; }
.tab-rail-home {
    width: 20px; height: 20px; border-radius: 6px; margin-bottom: 4px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; font-size: 11px;
    background: rgba(255,255,255,.06); color: rgba(255,255,255,.6);
}
```

- [ ] **Step 2: Add the rail container to the sidebar**

In `index.html`, wrap the existing `<div class="sidebar" id="sidebar">...</div>` with a flex row containing the new rail, right before it:
```html
            <div class="tab-rail" id="tabRail"></div>
            <div class="sidebar" id="sidebar">
```
(The parent `.main-content` is already `display:flex` per the existing layout, so the rail simply becomes the first flex child, sidebar second, editor-area third — no other structural change needed.)

- [ ] **Step 3: Add `renderTabRail` and `goHome`**

In `renderer.js`, add near `renderNotebooksList`:
```javascript
    goHome() {
        this.currentNotebook = null;
        this.currentNote = null;
        this.render();
    }

    renderTabRail() {
        const container = document.getElementById('tabRail');
        const items = this.data.notebooks.map(nb => {
            const isActive = this.currentNotebook && this.currentNotebook.id === nb.id;
            const glow = isActive ? `, 0 0 18px ${nb.color}88` : '';
            return `<div class="tab-rail-item ${isActive ? 'active' : ''}"
                         style="background: linear-gradient(160deg, ${nb.color}, ${nb.color}cc); box-shadow: 2px 3px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.3)${glow};"
                         onclick="app.selectNotebook('${nb.id}')" title="${nb.name}"></div>`;
        }).join('');
        container.innerHTML = `<div class="tab-rail-home" onclick="app.goHome()" title="Home">⌂</div>${items}`;
    }
```

- [ ] **Step 4: Call it from `render()`**

In `render()` (renderer.js), add the call alongside the existing render calls:
```javascript
    render() {
        this.renderTabRail();
        this.renderNotebooksList();
        this.renderNotesList();
        this.renderEditor();
        this.updateStatusBar();
    }
```

- [ ] **Step 5: Manual verification**

Run: `node --check renderer.js && echo OK`, then `npm start`:
1. Confirm the rail appears on the far left, one tab per notebook, colored per `notebook.color`, with a punch-hole texture visible along its edge.
2. Confirm the active notebook's tab is wider/brighter with a glow matching its color.
3. Click a different notebook's rail tab — confirm it switches notebooks (same as clicking it in the sidebar list).
4. Click the ⌂ home icon — confirm it returns to the bento-grid home view from Task 2.

- [ ] **Step 6: Commit**

```bash
git add index.html renderer.js styles/main.css
git commit -m "feat: add persistent tab rail for quick notebook switching"
```

## Out of scope (this plan)

- Editor bright-panel treatment, note info card, and command palette glass restyle — a follow-up plan applying the same token system to the remaining screens (per the spec's phasing).
- Light mode's exact token values (dark mode only, this plan).
- Reskinning individual plugins' own UI (git-integration, terminal, etc.).
- A notebook color *picker* UI in the create-notebook modal — colors are auto-assigned from the palette by creation order; letting users override the assigned color is a small later addition, not blocking this plan.
