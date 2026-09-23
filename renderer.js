// escapeHtml, parseMarkdown and snippetFromMarkdown live in markdown-utils.js,
// loaded by a <script> tag ahead of this file (the same pattern as
// note-utils.js and notebook-utils.js). They are referenced unqualified
// throughout this file because that script declares them as globals.
//
// escapeHtml matters beyond cosmetics: note and notebook content can arrive
// from imported files (importMarkdown/importPdf/importOnenote), not only from
// what the user typed, and window.electron exposes privileged operations such
// as execShell to this renderer. Unescaped HTML here is a path to executing
// arbitrary commands, not merely to broken markup.

// Hex colour -> {r,g,b}. Used throughout the glass and theme code, which
// composes rgba() strings from theme tokens at runtime rather than declaring
// every alpha variant as its own CSS custom property.
//
// Returns null rather than a default for malformed input, so callers choose
// their own fallback instead of silently rendering someone else's colour.
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// Hex colour shaded toward black (amount < 0) or white (amount > 0), where
// amount is a fraction of the distance to that end: -0.55 is 55% of the way
// to black.
//
// Exists for --nb-accent-ink. A notebook's colour is picked to look good as a
// solid swatch on the tab rail, which is exactly what makes it unusable as
// text on the bright panel -- raw #ffc466 on cream is invisible. Darkening it
// keeps one colour language from the rail through to the page while staying
// legible.
//
// Returns null for malformed input, like hexToRgb, so the caller can leave the
// custom property unset and let the CSS fallback apply rather than render a
// colour nobody chose.
function shadeHex(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const target = amount < 0 ? 0 : 255;
    const t = Math.min(Math.abs(amount), 1);
    const channel = (v) => Math.round(v + (target - v) * t)
        .toString(16)
        .padStart(2, '0');
    return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function escHtmlMd(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


// Main Application
class NoteHubApp {
    constructor() {
        this.config = null;
        this.data = {
            notebooks: [],
            notes: []
        };
        this.currentNotebook = null;
        this.currentNote = null;
        this.viewingTrash = false;
        this.viewMode = 'split';
        this.plugins = [];
        this.autoSaveTimer = null;
        
        this.init();
    }
    
    async init() {
        // Store original renderEditor so plugins can reset it on reload
        this._origRenderEditor = this.renderEditor.bind(this);

        // Load config and data
        await this.loadConfig();
        await this.loadData();
        // Before anything renders: converts base64 images already embedded in
        // note content into attachment files. No-ops after the first run.
        await this.migrateEmbeddedImages();
        // Expose globally before plugins load
        window.app = this;
        window.notehubConfig = this.config;
        await this.loadPlugins();
        
        // Apply theme from config
        this.applyTheme();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Initial render
        this.render();
        
        // Set up auto-save
        this.setupAutoSave();
        
        // Show welcome if no notes
        if (this.data.notes.length === 0) {
            this.showWelcome();
        }

        // Reclaim orphaned attachment files, deferred so it never competes with
        // first paint. Idle rather than a fixed delay so it yields on a slow
        // machine instead of adding load to one that is already struggling.
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 4000));
        idle(() => this.pruneUnusedAttachments().catch(() => { /* best effort */ }));
    }
    
    async loadConfig() {
        this.config = await window.electron.getConfig();
        if (this.config) {
            this.viewMode = this.config.editor.defaultView || 'split';
        }
        // Whether the OS blurs the desktop behind the window; decides if the
        // glass system needs to paint its own backdrop. Older builds of the
        // preload bridge won't have this, so treat missing as "no".
        try {
            const cap = window.electron.getGlassCapability
                ? await window.electron.getGlassCapability()
                : null;
            this.osTranslucency = !!(cap && cap.supported);
        } catch {
            this.osTranslucency = false;
        }
    }
    
    async loadData() {
        const data = await window.electron.getData();
        if (data) {
            this.data = data;
            this.data.notes = this.data.notes.map(withNoteDefaults);
        }

        // Ensure we have default notebook
        if (this.data.notebooks.length === 0) {
            this.data.notebooks.push({
                id: 'default',
                name: 'General',
                icon: '📝',
                created: new Date().toISOString()
            });
            await this.saveData();
        }

        this.data.notebooks = this.data.notebooks.map((nb, i) => withNotebookDefaults(nb, i));
    }
    
    async loadPlugins() {
        const plugins = await window.electron.getPlugins();
        this.plugins = plugins;
        
        // Load enabled plugins
        if (this.config && this.config.plugins.enabled) {
            for (const pluginId of this.config.plugins.enabled) {
                await this.loadPlugin(pluginId);
            }
        }
    }
    
    async loadPlugin(pluginId) {
        const result = await window.electron.loadPlugin(pluginId);
        if (result.success) {
            try {
                // Expose config globally so plugins can access it
                window.notehubConfig = this.config;
                window.app = this;   // also expose as window.app for plugins
                const plugin = new Function('app', result.code);
                plugin(this);
            } catch (error) {
                console.error(`Error loading plugin ${pluginId}:`, error);
            }
        }
    }
    
    applyTheme() {
        if (!this.config || !this.config.theme) return;

        const root = document.documentElement;
        const theme = this.config.theme;
        const preset = theme.preset || 'catppuccin-mocha';

        root.dataset.themePreset = preset;

        if (preset === 'custom' && theme.accentColor) {
            const rgb = hexToRgb(theme.accentColor);
            root.style.setProperty('--custom-accent', theme.accentColor);
            if (rgb) root.style.setProperty('--ctp-mauve-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
        } else {
            root.style.removeProperty('--custom-accent');
            root.style.removeProperty('--ctp-mauve-rgb');
        }

        // Three font roles, deliberately separate:
        //
        //   --font-family   app chrome: sidebar, toolbars, buttons, menus
        //   --font-reading  rendered prose in the preview pane
        //   --editor-font-* the CodeMirror source view
        //
        // They used to be one. `.CodeMirror` hardcoded its family and size and
        // nothing read theme.editorFontFamily/editorFontSize at all, so the
        // Preferences editor-font controls were dead and the only working lever
        // was --font-family -- which meant picking a monospace font to fix the
        // editor turned the entire UI, prose included, monospace. Prose set in
        // a code face is slower to read and has no real italic, so the preview
        // now gets its own family.
        if (theme.fontFamily) {
            root.style.setProperty('--font-family', theme.fontFamily);
        }
        if (theme.fontSize) {
            root.style.setProperty('--font-size', theme.fontSize + 'px');
        }
        if (theme.readingFontFamily) {
            root.style.setProperty('--font-reading', theme.readingFontFamily);
        } else {
            root.style.removeProperty('--font-reading');
        }
        if (theme.editorFontFamily) {
            root.style.setProperty('--editor-font-family', theme.editorFontFamily);
        } else {
            root.style.removeProperty('--editor-font-family');
        }
        if (theme.editorFontSize) {
            const px = Math.max(10, Math.min(32, Number(theme.editorFontSize) || 14));
            root.style.setProperty('--editor-font-size', px + 'px');
            // The preview is sized off the editor so split view does not show
            // the same text at two unrelated scales. Prose carries slightly
            // more size than code at the same perceived weight, hence 1.15.
            root.style.setProperty('--reading-font-size', (px * 1.15).toFixed(1) + 'px');
        } else {
            root.style.removeProperty('--editor-font-size');
            root.style.removeProperty('--reading-font-size');
        }

        // Per-token markdown syntax colour overrides. Lets a theme (or a
        // hand-written custom one) recolour just the editor without
        // touching app chrome. Keys map to the --syn-* vars in main.css:
        //   heading, bold, italic, strike, link-text, link-url,
        //   quote, list, code, hr, formatting
        // Anything not overridden falls back to the preset's own colours.
        // Markup characters keep their token colour unless explicitly dimmed.
        root.classList.toggle('dim-markup', theme.dimMarkup === true);

        const SYN_KEYS = ['heading','bold','italic','strike','link-text',
                          'link-url','quote','list','code','hr','formatting'];
        SYN_KEYS.forEach(k => root.style.removeProperty(`--syn-${k}`));
        if (theme.syntax && typeof theme.syntax === 'object') {
            SYN_KEYS.forEach(k => {
                const v = theme.syntax[k];
                if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) {
                    root.style.setProperty(`--syn-${k}`, v.trim());
                }
            });
        }

        this.applyGlassAppearance();
    }

    // Drives config.appearance: per-section glass (background alpha, blur,
    // saturation, corner radius, shadow), an optional full-window
    // background image, and a raw custom-CSS override. Unified vs
    // per-section is just *which* element owns the --nh-glass-* custom
    // properties -- :root for unified (cascades everywhere), or each
    // section's own container for per-section (a closer inline
    // declaration always wins over an inherited one, so per-section
    // overrides win locally without touching the CSS rules themselves).
    applyGlassAppearance() {
        const root = document.documentElement;
        const body = document.body;
        const sections = {
            sidebar: { el: document.querySelector('.sidebar'), baseVar: '--bg-secondary' },
            editor:  { el: document.querySelector('.editor-pane'), baseVar: '--bg-primary' },
            preview: { el: document.querySelector('.preview-pane'), baseVar: '--bg-secondary' },
        };
        const VARS = [
            '--nh-glass-bg', '--nh-glass-filter', '--nh-glass-radius',
            '--nh-glass-shadow', '--nh-glass-rim', '--nh-glass-rim-low',
            '--nh-glass-sheen', '--nh-glass-noise',
        ];
        const allScopes = [root, body, ...Object.values(sections).map(s => s.el)].filter(Boolean);
        allScopes.forEach(el => VARS.forEach(v => el.style.removeProperty(v)));

        const cfg = this.config && this.config.appearance;
        if (!cfg) { root.style.removeProperty('--nh-glass-app-bg'); return; }

        const pct = (v, def) => Math.max(0, Math.min(1, (v ?? def) / 100));

        // "Reduce transparency" is applied at render time only -- the stored
        // slider values are left untouched, so toggling it off restores the
        // user's look exactly. It also honours the OS-level accessibility
        // preference, which is the whole point of having it.
        const reduceMotionQuery = window.matchMedia('(prefers-reduced-transparency: reduce)');
        const reduced = cfg.reduceTransparency === true || reduceMotionQuery.matches;
        if (!this._reducedTransparencyHooked) {
            // Re-apply when the OS setting changes mid-session.
            reduceMotionQuery.addEventListener('change', () => this.applyGlassAppearance());
            this._reducedTransparencyHooked = true;
        }
        root.classList.toggle('nh-reduced-transparency', reduced);

        // A single tiled SVG grain tile, inlined so it costs no request and no
        // asset file. Pure gaussian blur is the tell that reads as "CSS glass"
        // rather than frosted glass; a few percent of noise is what makes the
        // surface look like a material. `baseFrequency` is high so the grain
        // stays sub-pixel-ish and never turns into visible mush.
        const NOISE_URI =
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E" +
            "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E" +
            "%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

        const computeGlass = (g, baseVar) => {
            g = g || {};
            const hex = getComputedStyle(root).getPropertyValue(baseVar).trim();
            const rgb = hexToRgb(hex) || { r: 30, g: 30, b: 46 };

            if (reduced) {
                // Fully opaque, no backdrop work at all. Anything that samples
                // the backdrop is pointless once nothing shows through, and
                // skipping the filter also drops the compositing cost.
                return {
                    bg: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                    filter: 'none',
                    radius: `${Math.max(0, Math.min(32, g.radius || 0))}px`,
                    shadow: 'none', rim: 'transparent', rimLow: 'transparent',
                    sheen: 'none', noise: 'none',
                };
            }

            const rawAlpha = pct(g.bgAlpha, 72);
            const saturate = Math.max(40, Math.min(140, g.saturate ?? 92));
            const dim      = pct(g.dim, 35);
            const noise    = pct(g.noise, 40);
            const radius   = Math.max(0, Math.min(32, g.radius || 0));

            // Opacity and blur describe ONE material, and the old UI let them
            // contradict each other: at 4% opacity with 0px blur the wallpaper
            // arrived undiffused and the result was a clear film, not glass.
            // Below ~85% opacity a blur floor scales in, so thinning the panel
            // always also diffuses what shows through it.
            const requested = Math.max(0, Math.min(60, g.blur || 0));
            const floor     = Math.max(0, (0.85 - rawAlpha)) * 32;
            const blur      = Math.max(requested, floor);

            // Backdrop filter order matters: dim and desaturate the sampled
            // pixels *before* blurring so the blur averages already-calmed
            // colour. saturate() above 100 is deliberately unreachable (see
            // the clamp in main.js) -- glass calms its backdrop.
            const brightness = (1 - dim * 0.55).toFixed(3);
            const filter = `saturate(${saturate}%) brightness(${brightness}) contrast(0.96) blur(${blur}px)`;

            // Panels tint toward their own surface colour, never toward pure
            // black. A black wash desaturates whatever is behind it and reads
            // as smoke or grime; a coloured tint reads as a material that has
            // its own colour, which is what sells the effect.
            const bg = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rawAlpha.toFixed(3)})`;

            // Shadow strength is driven by TRANSPARENCY, not by opacity. The
            // previous formula multiplied by bgAlpha, so the more glass-like a
            // panel became the less edge definition it had -- exactly backwards,
            // since a thin panel is the one that needs help separating from the
            // backdrop. Depth is carried by spread; alpha stays modest so it
            // never becomes a dark halo around an absent object.
            const shadowAlpha = pct(g.shadowAlpha, 22);
            const separation  = 0.35 + 0.65 * (1 - rawAlpha);
            const shadow = shadowAlpha > 0
                ? `0 ${(10 + blur * 0.4).toFixed(0)}px ${(30 + blur * 1.2).toFixed(0)}px ` +
                  `rgba(0, 0, 0, ${(shadowAlpha * separation).toFixed(3)})`
                : 'none';

            // Rim light. Every glass material that reads convincingly -- Acrylic,
            // macOS vibrancy, visionOS -- has a bright top edge and a darker
            // bottom one, because that is what a lit pane of glass does. Without
            // it the panels have no boundary and melt into the wallpaper.
            const rimStrength = 0.10 + 0.16 * (1 - rawAlpha);
            return {
                bg, filter, shadow,
                radius: `${radius}px`,
                rim:    `rgba(255, 255, 255, ${rimStrength.toFixed(3)})`,
                rimLow: `rgba(0, 0, 0, ${(0.16 + 0.14 * (1 - rawAlpha)).toFixed(3)})`,
                // Specular falloff: a light source implied by a soft highlight
                // running off the top edge.
                sheen: `linear-gradient(180deg, rgba(255,255,255,${(0.055 + 0.05 * (1 - rawAlpha)).toFixed(3)}) 0%, rgba(255,255,255,0) 42%)`,
                noise: noise > 0 ? NOISE_URI : 'none',
                noiseOpacity: (noise * 0.06).toFixed(3),
            };
        };

        // The tab rail sits inside the same shell as the panels; if it keeps
        // its hardcoded near-black while everything else goes transparent it
        // reads as a solid stripe down the side of an otherwise glass window.
        //
        // Every tint below is derived from --ctp-mantle rather than from black,
        // for the reason given in computeGlass: black washes read as grime.
        const applyRail = (glass) => {
            const g = glass || {};
            const alpha = reduced ? 1 : pct(g.bgAlpha, 72);
            const m = hexToRgb(getComputedStyle(root).getPropertyValue('--ctp-mantle').trim())
                   || { r: 24, g: 24, b: 37 };
            const tint = (a) => `rgba(${m.r}, ${m.g}, ${m.b}, ${a.toFixed(3)})`;

            root.style.setProperty('--nh-glass-rail-bg', tint(0.30 + 0.55 * alpha));
            // Code blocks keep contrast without becoming an opaque cut-out.
            root.style.setProperty('--nh-code-bg', tint(0.42 + 0.5 * alpha));

            // Chrome bars (toolbar, status bar, sticky notes header), the
            // selected-note card and the active-line band were the last
            // surfaces still filling with solid paint -- each one reads as a
            // dark slab laid across an otherwise translucent window. They
            // tint instead, scaled by the same alpha as the panels.
            root.style.setProperty('--nh-chrome-bg', tint(0.34 + 0.5 * alpha));

            // Selection used to be a flat white wash. Over a photograph that
            // reads as fog and *lowers* the contrast of the text inside it, so
            // the selected item became harder to read than its neighbours.
            // The accent colour at low alpha plus a left bar (see main.css)
            // marks selection as a shape instead of a brightness change.
            const accent = hexToRgb(
                getComputedStyle(root).getPropertyValue('--custom-accent').trim() ||
                getComputedStyle(root).getPropertyValue('--ctp-mauve').trim()
            ) || { r: 203, g: 166, b: 247 };
            root.style.setProperty('--nh-chrome-active-bg',
                `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${(0.14 + 0.10 * alpha).toFixed(3)})`);
            root.style.setProperty('--nh-activeline-bg',
                `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${(0.07 + 0.05 * alpha).toFixed(3)})`);

            // Borders: --border-color is an opaque dark grey, which drawn across
            // glass looks like a seam of dirt rather than a divider. On glass it
            // becomes a hairline highlight instead.
            root.style.setProperty('--nh-hairline',
                reduced ? 'var(--border-color)'
                        : `rgba(255, 255, 255, ${(0.16 - 0.06 * alpha).toFixed(3)})`);

            // Text protection. Panel opacity must never be the thing that
            // decides whether text is legible, so a halo scales in as the
            // panels thin out. At full opacity it is switched off entirely.
            root.style.setProperty('--nh-text-shadow',
                reduced || alpha > 0.92 ? 'none'
                    : `0 1px 2px rgba(0, 0, 0, ${(0.62 * (1 - alpha) + 0.18).toFixed(3)})`);
        };

        const applyTo = (el, glass, baseVar) => {
            if (!el) return;
            const v = computeGlass(glass, baseVar);
            el.style.setProperty('--nh-glass-bg', v.bg);
            el.style.setProperty('--nh-glass-filter', v.filter);
            el.style.setProperty('--nh-glass-radius', v.radius);
            el.style.setProperty('--nh-glass-shadow', v.shadow);
            el.style.setProperty('--nh-glass-rim', v.rim);
            el.style.setProperty('--nh-glass-rim-low', v.rimLow);
            el.style.setProperty('--nh-glass-sheen', v.sheen);
            el.style.setProperty('--nh-glass-noise', v.noise);
            el.style.setProperty('--nh-glass-noise-opacity', v.noiseOpacity || '0');
        };

        ['--nh-glass-rail-bg','--nh-code-bg','--nh-chrome-bg','--nh-chrome-active-bg',
         '--nh-activeline-bg','--nh-hairline','--nh-text-shadow',
         '--nh-glass-noise-opacity'].forEach(v => root.style.removeProperty(v));
        if (cfg.glassMode === 'per-section' && cfg.glassSections) {
            applyRail(cfg.glassSections.sidebar);
            applyTo(sections.sidebar.el, cfg.glassSections.sidebar, sections.sidebar.baseVar);
            applyTo(sections.editor.el,  cfg.glassSections.editor,  sections.editor.baseVar);
            applyTo(sections.preview.el, cfg.glassSections.preview, sections.preview.baseVar);
            applyTo(body, cfg.glassSections.panels, '--ctp-mantle');
        } else {
            applyRail(cfg.glass);
            applyTo(root, cfg.glass, '--bg-secondary');
        }

        // Is any glass actually asked for? Translucency and blur are only
        // visible if the surfaces behind the panels get out of the way, and
        // that's worth doing only when there's something to reveal.
        const wantsGlass = (g) => {
            g = g || {};
            return (g.bgAlpha ?? 100) < 100 || (g.blur || 0) > 0;
        };
        // Reduce-transparency forces every panel opaque, so there is nothing
        // for a transparent app shell to reveal and the fallback backdrop
        // would only burn compositing time.
        const glassOn = !reduced && (cfg.glassMode === 'per-section'
            ? Object.values(cfg.glassSections || {}).some(wantsGlass)
            : wantsGlass(cfg.glass));

        // Background image — a fixed layer behind the whole app; the
        // app-container/title-bar go transparent via --nh-glass-app-bg so
        // it's actually visible through them.
        let bgEl = document.getElementById('nhBgImage');
        const bgCfg = cfg.background || {};
        if (bgCfg.enabled && bgCfg.path) {
            if (!bgEl) {
                bgEl = document.createElement('div');
                bgEl.id = 'nhBgImage';
                Object.assign(bgEl.style, { position: 'fixed', inset: '0', zIndex: '-1', pointerEvents: 'none' });
                document.body.prepend(bgEl);
            }
            bgEl.style.backgroundImage = `url("${fileUrl(bgCfg.path)}")`;
            bgEl.style.backgroundSize = bgCfg.fit === 'contain' ? 'contain' : (bgCfg.fit === 'cover' ? 'cover' : 'auto');
            bgEl.style.backgroundRepeat = bgCfg.fit === 'repeat' ? 'repeat' : 'no-repeat';
            bgEl.style.backgroundPosition = 'center';
            bgEl.style.opacity = String(pct(bgCfg.opacity, 100));
            bgEl.style.filter = bgCfg.blur ? `blur(${bgCfg.blur}px)` : 'none';
            root.style.setProperty('--nh-glass-app-bg', 'transparent');

            // Scrim: a dark layer between the wallpaper and the panels, with
            // its own control. Panel opacity alone cannot tame a bright,
            // high-contrast photo -- turning the panels up to hide it defeats
            // the entire effect, so the image gets darkened at the source
            // instead. Sits above #nhBgImage and below everything else.
            let scrimEl = document.getElementById('nhBgScrim');
            const scrim = pct(bgCfg.scrim, 45);
            if (scrim > 0 && !reduced) {
                if (!scrimEl) {
                    scrimEl = document.createElement('div');
                    scrimEl.id = 'nhBgScrim';
                    Object.assign(scrimEl.style, {
                        position: 'fixed', inset: '0', zIndex: '-1', pointerEvents: 'none',
                    });
                    bgEl.insertAdjacentElement('afterend', scrimEl);
                }
                scrimEl.style.background = `rgba(0, 0, 0, ${scrim.toFixed(3)})`;
            } else if (scrimEl) {
                scrimEl.remove();
            }
        } else {
            if (bgEl) bgEl.remove();
            const scrimEl = document.getElementById('nhBgScrim');
            if (scrimEl) scrimEl.remove();
            if (glassOn) root.style.setProperty('--nh-glass-app-bg', 'transparent');
            else root.style.removeProperty('--nh-glass-app-bg');
        }

        // Fallback backdrop. With glass on and no background image, the app
        // surfaces are now transparent -- but on a platform where the OS
        // won't blur the desktop behind the window (Windows 10, Linux) that
        // just exposes more flat paint, and blurring a flat colour returns
        // the same flat colour. Painting a gradient here gives the glass
        // something to actually reveal, so the sliders do something visible
        // on every platform. Where the OS *does* provide translucency, skip
        // it and let the desktop show through instead.
        const needsFallback = glassOn && !(bgCfg.enabled && bgCfg.path) && !this.osTranslucency;
        let fbEl = document.getElementById('nhGlassBackdrop');
        if (needsFallback) {
            if (!fbEl) {
                fbEl = document.createElement('div');
                fbEl.id = 'nhGlassBackdrop';
                Object.assign(fbEl.style, {
                    position: 'fixed', inset: '0', zIndex: '-1', pointerEvents: 'none',
                });
                document.body.prepend(fbEl);
            }
            const a = getComputedStyle(root).getPropertyValue('--ctp-mauve').trim() || '#cba6f7';
            const b = getComputedStyle(root).getPropertyValue('--ctp-blue').trim()  || '#89b4fa';
            const c = getComputedStyle(root).getPropertyValue('--ctp-teal').trim()  || '#94e2d5';
            const base = getComputedStyle(root).getPropertyValue('--ctp-crust').trim() || '#11111b';
            fbEl.style.background =
                `radial-gradient(120% 90% at 12% 8%, ${a}55 0%, transparent 55%),` +
                `radial-gradient(110% 80% at 88% 22%, ${b}44 0%, transparent 58%),` +
                `radial-gradient(120% 95% at 55% 100%, ${c}3a 0%, transparent 60%),` +
                base;
        } else if (fbEl) {
            fbEl.remove();
        }

        // Custom CSS — applied last (appended after the app's own
        // stylesheet in <head>), so equal-specificity rules resolve in the
        // user's favor without needing !important.
        let styleEl = document.getElementById('nh-custom-css');
        if (cfg.customCSS) {
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'nh-custom-css';
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = cfg.customCSS;
        } else if (styleEl) {
            styleEl.remove();
        }
    }

    // ── Sidebar: resize + collapse ──────────────────────────────────────────
    // Width lives in config.ui.sidebarWidth (already clamped 160-600 by
    // sanitizeConfig); collapse in config.ui.sidebarCollapsed. Both are
    // applied here rather than in CSS so the preferences window and the
    // drag handle end up driving exactly the same state.
    applySidebarState() {
        const sidebar = document.getElementById('sidebar');
        const resizer = document.getElementById('sidebarResizer');
        if (!sidebar) return;

        const ui = (this.config && this.config.ui) || {};
        const width = Math.max(160, Math.min(600, ui.sidebarWidth || 280));
        const collapsed = !!ui.sidebarCollapsed;

        sidebar.style.width = width + 'px';
        sidebar.classList.toggle('collapsed', collapsed);
        if (resizer) resizer.classList.toggle('hidden', collapsed);

        const toggle = document.getElementById('tabRailToggle');
        if (toggle) {
            toggle.textContent = collapsed ? '›' : '‹';
            toggle.title = collapsed ? 'Show sidebar (Ctrl/Cmd+B)' : 'Hide sidebar (Ctrl/Cmd+B)';
        }
    }

    async toggleSidebar(force) {
        if (!this.config.ui) this.config.ui = {};
        const next = typeof force === 'boolean' ? force : !this.config.ui.sidebarCollapsed;
        this.config.ui.sidebarCollapsed = next;
        this.applySidebarState();
        // CodeMirror measures its own viewport on layout; the editor pane just
        // changed width, so it has to re-measure or the cursor lands at the
        // wrong x-offset until the next keystroke.
        setTimeout(() => { if (this.cm) this.cm.refresh(); }, 200);
        await this.persistConfig();
    }

    setupSidebarResize() {
        const sidebar = document.getElementById('sidebar');
        const resizer = document.getElementById('sidebarResizer');
        if (!sidebar || !resizer) return;

        const MIN = 160, MAX = 600;
        let dragging = false;

        // Pointer events (not mousedown/mousemove) so the capture below keeps
        // delivering moves even when the cursor crosses into the CodeMirror
        // iframe-like editor surface, which otherwise swallows them.
        const onMove = (e) => {
            if (!dragging) return;
            const width = Math.max(MIN, Math.min(MAX, e.clientX - sidebar.getBoundingClientRect().left));
            sidebar.style.width = width + 'px';
        };

        const onUp = async (e) => {
            if (!dragging) return;
            dragging = false;
            sidebar.classList.remove('resizing');
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            resizer.releasePointerCapture?.(e.pointerId);

            const width = Math.round(parseFloat(sidebar.style.width) || 280);
            if (!this.config.ui) this.config.ui = {};
            this.config.ui.sidebarWidth = width;
            if (this.cm) this.cm.refresh();
            await this.persistConfig();
        };

        resizer.addEventListener('pointerdown', (e) => {
            if (this.config && this.config.ui && this.config.ui.sidebarCollapsed) return;
            e.preventDefault();
            dragging = true;
            // Suppress the width transition mid-drag or the panel lags the
            // cursor by the animation duration.
            sidebar.classList.add('resizing');
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            resizer.setPointerCapture?.(e.pointerId);
        });
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', onUp);
        resizer.addEventListener('pointercancel', onUp);
        resizer.addEventListener('dblclick', () => this.toggleSidebar());
    }

    // ── Collapsible sidebar sections ────────────────────────────────────────
    applySidebarSections() {
        const ui = (this.config && this.config.ui) || {};
        const map = [
            ['notebooks', '.notebooks-container', ui.notebooksCollapsed],
            ['notes',     '.notes-container',     ui.notesCollapsed],
        ];
        map.forEach(([, sel, collapsed]) => {
            const el = document.querySelector(sel);
            if (el) el.classList.toggle('section-collapsed', !!collapsed);
        });
    }

    async toggleSidebarSection(name) {
        if (!this.config.ui) this.config.ui = {};
        const key = name === 'notebooks' ? 'notebooksCollapsed' : 'notesCollapsed';
        this.config.ui[key] = !this.config.ui[key];
        this.applySidebarSections();
        await this.persistConfig();
    }

    // ── Drag to reorder ─────────────────────────────────────────────────────
    // One handler set drives all three lists (rail, notebook list, note list);
    // `kind` decides which array gets rewritten on drop.
    _onDragStart(e, kind, id) {
        this._drag = { kind, id };
        e.dataTransfer.effectAllowed = 'move';
        // Firefox/Chromium won't start a drag without some payload set.
        try { e.dataTransfer.setData('text/plain', id); } catch {}
        e.currentTarget.classList.add('dragging');
    }

    _onDragOver(e, kind, id) {
        if (!this._drag || this._drag.kind !== kind || this._drag.id === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const el = e.currentTarget;
        const rect = el.getBoundingClientRect();
        // Rail is a column of small tiles, the lists are taller rows — both
        // split on the vertical midpoint, so the indicator follows the cursor.
        const after = (e.clientY - rect.top) > rect.height / 2;
        el.classList.toggle('drop-after', after);
        el.classList.toggle('drop-before', !after);
    }

    _clearDropMarkers() {
        document.querySelectorAll('.drop-before, .drop-after')
            .forEach(el => el.classList.remove('drop-before', 'drop-after'));
        document.querySelectorAll('.dragging')
            .forEach(el => el.classList.remove('dragging'));
    }

    async _onDrop(e, kind, targetId) {
        e.preventDefault();
        const drag = this._drag;
        this._clearDropMarkers();
        this._drag = null;
        if (!drag || drag.kind !== kind || drag.id === targetId) return;

        if (kind === 'notebook') {
            this.data.notebooks = moveItem(this.data.notebooks, drag.id, targetId);
        } else {
            const from = this.data.notes.find(n => n.id === drag.id);
            const to   = this.data.notes.find(n => n.id === targetId);
            // sortPinnedFirst() groups pinned notes ahead of the rest at render
            // time, so a drag across that boundary can't produce the order the
            // user just drew — pin/unpin is the way to move between groups.
            if (!samePinGroup(from, to)) {
                this.alertModal(
                    'Pinned notes always sort above unpinned ones. Unpin the note first to move it there.',
                    { title: 'Reorder' }
                );
                return;
            }
            this.data.notes = moveItem(this.data.notes, drag.id, targetId);
        }
        await this.saveData();
        this.render();
    }

    _dragAttrs(kind, id) {
        return `draggable="true" class="drag-item"
                ondragstart="app._onDragStart(event, '${kind}', '${id}')"
                ondragover="app._onDragOver(event, '${kind}', '${id}')"
                ondragleave="this.classList.remove('drop-before','drop-after')"
                ondrop="app._onDrop(event, '${kind}', '${id}')"
                ondragend="app._clearDropMarkers()"`;
    }

    // ── Cycling notes/notebooks from the keyboard ───────────────────────────
    // The point of these is a usable app with the sidebar collapsed, where
    // there is no list to click.
    notesInCurrentNotebook() {
        const notes = filterActiveNotes(this.data.notes)
            .filter(n => !this.currentNotebook || n.notebookId === this.currentNotebook.id);
        return sortPinnedFirst(notes);
    }

    cycleNote(dir = 1) {
        const notes = this.notesInCurrentNotebook();
        if (notes.length === 0) return;
        const idx = this.currentNote ? notes.findIndex(n => n.id === this.currentNote.id) : -1;
        const next = notes[((idx + dir) % notes.length + notes.length) % notes.length];
        if (next) this.selectNote(next.id);
    }

    cycleNotebook(dir = 1) {
        const books = this.data.notebooks;
        if (books.length === 0) return;
        const idx = this.currentNotebook ? books.findIndex(n => n.id === this.currentNotebook.id) : -1;
        const next = books[((idx + dir) % books.length + books.length) % books.length];
        if (next) this.selectNotebook(next.id);
    }

    setupEventListeners() {
        // Sidebar buttons
        document.getElementById('btnNewNote').addEventListener('click', () => this.createNewNote());
        document.getElementById('btnNewNotebook').addEventListener('click', () => this.createNewNotebook());
        document.getElementById('searchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));
        document.getElementById('btnSettings').addEventListener('click', () => this.showSettings());
        
        // Menu listeners
        window.electron.onMenuNewNote(() => this.createNewNote());
        window.electron.onMenuNewNotebook(() => this.createNewNotebook());
        window.electron.onMenuExportNote(() => this.exportCurrentNote());
        window.electron.onMenuImportMarkdown(() => this.importMarkdown());
        window.electron.onMenuImportPdf(() => this.importPdf());
        window.electron.onMenuOnenote(() => this.importOnenote());
        window.electron.onMenuViewMode((event, mode) => this.setViewMode(mode));
        window.electron.onReloadConfig(() => this.reloadConfig());

        // Help menu
        if (window.electron.onShowHelp) {
            window.electron.onShowHelp((event, section) => this.showHelpModal(section));
        }

        this.setupSidebarResize();
        this.applySidebarState();
        this.applySidebarSections();

        // Command Palette — Cmd+Shift+P / Ctrl+Shift+P
        // Quick switcher — Cmd+K / Ctrl+K (the same overlay, notes only)
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyP') {
                e.preventDefault();
                this.toggleCommandPalette();
            }
            // Zen mode — Cmd/Ctrl+. and Table of contents — Cmd/Ctrl+/
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'Period') {
                e.preventDefault();
                this.toggleZenMode();
            }
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'Slash') {
                e.preventDefault();
                this.toggleTableOfContents();
            }
            // Escape leaves zen. Checked before the palette's own Escape
            // handling would matter, but only when no palette is open, so it
            // never steals the key from a dialog the user is actually in.
            if (e.key === 'Escape' && this._zenMode) {
                const pal = document.getElementById('cmdPalette');
                const modalOpen = document.getElementById('modalOverlay');
                if (!(pal && pal.classList.contains('open')) &&
                    !(modalOpen && modalOpen.classList.contains('active'))) {
                    e.preventDefault();
                    this.toggleZenMode(false);
                }
            }
            // Not `e.key === 'k'`: on a non-US layout e.key is whatever the
            // layout produces, while e.code is the physical key. Shift is
            // excluded so Cmd+Shift+K stays free for a future binding.
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
                e.preventDefault();
                const pal = document.getElementById('cmdPalette');
                if (pal && pal.classList.contains('open')) this.closeCommandPalette();
                else this.openCommandPalette('notes');
            }
            // Sidebar collapse — Cmd/Ctrl+B. Vim mode binds Ctrl-B to page-up
            // inside the editor (and CodeMirror's default keymaps bind it to
            // goCharLeft), so when the editor has focus in vim mode the
            // keystroke belongs to the editor, not to us.
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyB') {
                const vimMode = !!(this.config && this.config.editor && this.config.editor.vimMode);
                const inEditor = !!(e.target && e.target.closest && e.target.closest('.CodeMirror'));
                if (!(vimMode && inEditor && !e.metaKey)) {
                    e.preventDefault();
                    this.toggleSidebar();
                }
            }
            // Ctrl+Tab / Ctrl+Shift+Tab cycle notes and notebooks, and Ctrl+T
            // makes a new note — the browser-ish bindings that make the app
            // navigable with the sidebar collapsed. Checked before the palette's
            // Escape handling so nothing else claims Tab first.
            if (e.ctrlKey && e.code === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) this.cycleNotebook(1);
                else this.cycleNote(1);
                return;
            }
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyT') {
                e.preventDefault();
                this.createNewNote();
                return;
            }

            // Close palette on Escape
            if (e.key === 'Escape') {
                const pal = document.getElementById('cmdPalette');
                if (pal && pal.classList.contains('open')) {
                    this.closeCommandPalette();
                }
            }
        });
        
        // Live apply from preferences window (no full restart)
        if (window.electron.onApplyConfigLive) {
            window.electron.onApplyConfigLive((event, newConfig) => {
                // save-config echoes 'apply-config-live' back to *this* window
                // as well as forward from the preferences window. Re-applying a
                // change we just made ourselves would run renderEditor() and
                // rebuild CodeMirror — dropping the cursor, selection and undo
                // history on every sidebar drag or Cmd+B.
                if (this._selfSavedConfig && JSON.stringify(newConfig) === this._selfSavedConfig) {
                    this._selfSavedConfig = null;
                    return;
                }
                this.applyConfigLive(newConfig);
            });
        }
        
        // Click outside modal
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') {
                this.closeModal();
            }
        });
    }
    
    setupAutoSave() {
        if (this.config && this.config.editor.autoSave) {
            const interval = this.config.editor.autoSaveInterval || 2000;
            this.autoSaveTimer = setInterval(() => {
                this.saveCurrentNote();
            }, interval);
        }
    }
    
    // Persists the whole library. Two guards, because this is called from
    // autosave on a timer as well as from every mutation:
    //
    //   - identical payloads are dropped. Autosave fires on an interval, not on
    //     change, so an idle editor was rewriting the entire database every
    //     couple of seconds for no reason.
    //   - concurrent calls collapse. An await in flight plus a second caller
    //     produced two overlapping writes of the same data; the later one now
    //     rides on the in-flight promise instead.
    //
    // The comparison is against the serialized form rather than a dirty flag
    // because mutations happen directly on `this.data` all over the renderer,
    // and any flag would have to be set in every one of those places to be
    // trustworthy.
    async saveData() {
        const payload = JSON.stringify(this.data);
        if (payload === this._lastSavedPayload) return;

        // A save is already running. Wait for it, then re-check rather than
        // returning its promise: the in-flight write is of a SNAPSHOT taken
        // before this call, so simply riding on it would report success while
        // silently discarding whatever changed in between. Re-entering after
        // it settles either finds the data already covered (the payload
        // comparison at the top short-circuits) or writes the newer state.
        if (this._saveInFlight) {
            await this._saveInFlight.catch(() => { /* handled by its own caller */ });
            return this.saveData();
        }

        this._saveInFlight = (async () => {
            try {
                const result = await window.electron.saveData(this.data);
                // Only record success. Marking a failed write as saved would
                // suppress every retry until the content changed again.
                if (!result || result.success !== false) this._lastSavedPayload = payload;
                else console.error('[NoteHub] save failed:', result.error);
                return result;
            } finally {
                this._saveInFlight = null;
            }
        })();
        return this._saveInFlight;
    }
    
    async saveConfig() {
        await window.electron.saveConfig(this.config);
    }

    // Writes this.config and marks the resulting live-apply echo as our own
    // (see the onApplyConfigLive guard) so UI state we already applied
    // locally isn't re-applied through a full editor rebuild.
    async persistConfig() {
        this._selfSavedConfig = JSON.stringify(this.config);
        await window.electron.saveConfig(this.config);
    }
    
    async reloadConfig() {
        await this.loadConfig();
        this.applyTheme();
        this.render();
    }

    // Apply config changes live without restarting
    async applyConfigLive(newConfig) {
        const prevConfig = this.config;
        this.config = newConfig;

        // 1. Apply CSS theme vars immediately
        this.applyTheme();

        // 2. Fonts are published entirely as :root custom properties by
        //    applyTheme() above. Writing them onto document.body as well would
        //    create a second, higher-priority source of truth that the theme
        //    layer cannot later clear -- an inline style on body outranks any
        //    stylesheet rule, so a font removed from the config would stay
        //    applied until reload.

        // 3. Apply sidebar width + collapsed/section state
        this.applySidebarState();
        this.applySidebarSections();

        // 4. Check if plugins changed — need full reload
        // Sorted before comparing: preferences.html rebuilds this array from
        // the full plugin list order on every save, not from the config's
        // original order, so an unsorted compare treated every save as a
        // "plugin list changed" reload — even with zero actual changes —
        // re-running each plugin's script and duplicating its injected DOM
        // (e.g. the terminal plugin's #nhTerm, whose newest copy ended up
        // with no event listeners since getElementById resolves to the
        // stale first copy still in the document).
        const prevEnabled = JSON.stringify((((prevConfig || {}).plugins || {}).enabled || []).slice().sort());
        const nextEnabled = JSON.stringify(((newConfig.plugins || {}).enabled || []).slice().sort());
        if (prevEnabled !== nextEnabled) {
            console.log('[NoteHub] Plugin list changed, reloading plugins...');
            this.plugins = [];
            // Reset any patched methods before reloading
            if (this._origRenderEditor) this.renderEditor = this._origRenderEditor;
            await this.loadPlugins();
        }

        // 5. Re-render — use window.app.renderEditor() so patched versions (nvim) are called
        window.notehubConfig = newConfig;
        (window.app || this).renderEditor();

        // 6. Update auto-save interval if changed
        if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
        this.setupAutoSave();

        console.log('[NoteHub] Config applied live.');
    }
    
    // Notebook Management
    // Swatch row for the curated palette plus a native colour input for
    // anything else. Both write into the hidden #notebookColorVal, which is
    // the single value the save handlers read — so "picked a swatch" and
    // "picked a custom colour" can't disagree.
    _colorPickerHTML(selected) {
        const swatches = NOTEBOOK_PALETTE.map(c =>
            `<button type="button" class="color-swatch ${c === selected ? 'sel' : ''}"
                     style="background: linear-gradient(160deg, ${c}, ${c}cc)"
                     title="${c}"
                     onclick="app._pickNotebookColor('${c}')"></button>`
        ).join('');

        return `
            <div class="color-swatch-row">
                ${swatches}
                <input type="color" class="color-swatch-custom" id="notebookColorCustom"
                       value="${escapeHtml(selected)}"
                       title="Custom colour"
                       oninput="app._pickNotebookColor(this.value)">
                <span class="color-swatch-label" id="notebookColorLabel">${escapeHtml(selected)}</span>
            </div>
            <input type="hidden" id="notebookColorVal" value="${escapeHtml(selected)}">`;
    }

    _pickNotebookColor(color) {
        const value = normalizeNotebookColor(color, NOTEBOOK_PALETTE[0]);
        const hidden = document.getElementById('notebookColorVal');
        const label  = document.getElementById('notebookColorLabel');
        const custom = document.getElementById('notebookColorCustom');
        if (hidden) hidden.value = value;
        if (label)  label.textContent = value;
        if (custom && custom.value.toLowerCase() !== value) custom.value = value;
        document.querySelectorAll('.color-swatch').forEach(btn => {
            btn.classList.toggle('sel', (btn.getAttribute('title') || '').toLowerCase() === value);
        });
    }

    changeNotebookColor(notebookId) {
        const notebook = this.data.notebooks.find(n => n.id === notebookId);
        if (!notebook) return;

        this.showModal(`Colour — ${notebook.name}`, `
            <div class="form-group">
                <label class="form-label">Notebook Colour</label>
                ${this._colorPickerHTML(notebook.color || NOTEBOOK_PALETTE[0])}
                <p style="font-size:12px;color:var(--text-muted);margin-top:12px">
                    Drives the tab rail, this notebook's card on the home screen,
                    and the editor's accent when it's open.
                </p>
            </div>
        `, [
            { label: 'Cancel', class: 'btn-secondary', onClick: () => this.closeModal() },
            { label: 'Save', class: 'btn-primary', onClick: () => this.handleChangeNotebookColor(notebookId) }
        ]);
    }

    async handleChangeNotebookColor(notebookId) {
        const notebook = this.data.notebooks.find(n => n.id === notebookId);
        const input = document.getElementById('notebookColorVal');
        if (!notebook || !input) return;

        notebook.color = normalizeNotebookColor(input.value, notebook.color || NOTEBOOK_PALETTE[0]);
        await this.saveData();
        this.closeModal();
        this.render();
    }

    createNewNotebook() {
        const emojis = ['📓','📔','📒','📕','📗','📘','📙','🗒️','📁','🗂️',
                        '💼','🏠','🎓','💡','🔬','🎨','🎵','✈️','🌍','⭐',
                        '🔥','💎','🚀','🎯','📊','💻','🔐','📝','🌿','❤️'];
        const emojiGrid = emojis.map(e =>
            `<button type="button" class="emoji-pick-btn" onclick="
                document.querySelectorAll('.emoji-pick-btn').forEach(b=>b.classList.remove('sel'));
                this.classList.add('sel');
                document.getElementById('notebookIconVal').value=this.textContent;
            " title="${e}">${e}</button>`
        ).join('');

        this.showModal('Create New Notebook', `
            <div class="form-group">
                <label class="form-label">Notebook Name</label>
                <input type="text" class="form-input" id="notebookName"
                    placeholder="e.g. Work, Personal, Projects…"
                    autofocus
                    onkeydown="if(event.key==='Enter')app.handleCreateNotebook()">
            </div>
            <div class="form-group">
                <label class="form-label">Icon</label>
                <div class="emoji-grid">${emojiGrid}</div>
                <input type="hidden" id="notebookIconVal" value="📓">
            </div>
            <div class="form-group">
                <label class="form-label">Colour</label>
                ${this._colorPickerHTML(nextNotebookColor(this.data.notebooks))}
            </div>
        `, [
            { label: 'Cancel', class: 'btn-secondary', onClick: () => this.closeModal() },
            { label: 'Create Notebook', class: 'btn-primary', onClick: () => this.handleCreateNotebook() }
        ]);

        // Select first emoji by default
        setTimeout(() => {
            const first = document.querySelector('.emoji-pick-btn');
            if (first) first.classList.add('sel');
            document.getElementById('notebookName').focus();
        }, 50);
    }
    
    async handleCreateNotebook() {
        const name = document.getElementById('notebookName').value.trim();
        const icon = (document.getElementById('notebookIconVal') || document.getElementById('notebookIcon') || {value:'📓'}).value || '📓';
        
        if (!name) return;
        
        const colorInput = document.getElementById('notebookColorVal');
        const notebook = {
            id: Date.now().toString(),
            name,
            icon,
            color: normalizeNotebookColor(colorInput && colorInput.value,
                                          nextNotebookColor(this.data.notebooks)),
            created: new Date().toISOString()
        };
        
        this.data.notebooks.push(notebook);
        await this.saveData();
        this.closeModal();
        this.render();
    }
    
    selectNotebook(notebookId) {
        this.viewingTrash = false;
        this.currentNotebook = this.data.notebooks.find(n => n.id === notebookId);
        // Open the notebook's first note rather than the empty "create your
        // first note" screen. That screen is correct only for a genuinely
        // empty notebook; with the sidebar collapsed it was a dead end, since
        // there was no note list to pick from and the button offered to make a
        // new note in a notebook that already had several.
        const first = this.notesInCurrentNotebook()[0];
        this.currentNote = first || null;
        this.render();
    }

    renameNotebook(notebookId) {
        const notebook = this.data.notebooks.find(n => n.id === notebookId);
        if (!notebook) return;

        const emojis = ['📓','📔','📒','📕','📗','📘','📙','🗒️','📁','🗂️',
                        '💼','🏠','🎓','💡','🔬','🎨','🎵','✈️','🌍','⭐',
                        '🔥','💎','🚀','🎯','📊','💻','🔐','📝','🌿','❤️'];
        const emojiGrid = emojis.map(e =>
            `<button type="button" class="emoji-pick-btn ${e === notebook.icon ? 'sel' : ''}" onclick="
                document.querySelectorAll('.emoji-pick-btn').forEach(b=>b.classList.remove('sel'));
                this.classList.add('sel');
                document.getElementById('notebookIconVal').value=this.textContent;
            " title="${e}">${e}</button>`
        ).join('');

        this.showModal('Rename Notebook', `
            <div class="form-group">
                <label class="form-label">Notebook Name</label>
                <input type="text" class="form-input" id="notebookName"
                    value="${escapeHtml(notebook.name)}"
                    autofocus
                    onkeydown="if(event.key==='Enter')app.handleRenameNotebook('${notebookId}')">
            </div>
            <div class="form-group">
                <label class="form-label">Icon</label>
                <div class="emoji-grid">${emojiGrid}</div>
                <input type="hidden" id="notebookIconVal" value="${escapeHtml(notebook.icon)}">
            </div>
        `, [
            { label: 'Cancel', class: 'btn-secondary', onClick: () => this.closeModal() },
            { label: 'Save', class: 'btn-primary', onClick: () => this.handleRenameNotebook(notebookId) }
        ]);

        setTimeout(() => {
            const input = document.getElementById('notebookName');
            if (input) { input.focus(); input.select(); }
        }, 50);
    }

    async handleRenameNotebook(notebookId) {
        const notebook = this.data.notebooks.find(n => n.id === notebookId);
        const nameInput = document.getElementById('notebookName');
        const iconInput = document.getElementById('notebookIconVal');
        if (!notebook || !nameInput) return;

        const name = nameInput.value.trim();
        if (!name) return;

        notebook.name = name;
        notebook.icon = (iconInput && iconInput.value) || notebook.icon;
        await this.saveData();
        this.closeModal();
        this.render();
    }

    async deleteNotebook(notebookId) {
        const notebook = this.data.notebooks.find(n => n.id === notebookId);
        if (!notebook) return;

        if (!canDeleteNotebook(this.data.notebooks)) {
            this.alertModal('You need at least one notebook — create another before deleting this one.');
            return;
        }

        const noteCount = this.data.notes.filter(n => n.notebookId === notebookId && !n.deletedAt).length;
        const warning = noteCount > 0
            ? `Delete "${notebook.name}"? Its ${noteCount} note${noteCount === 1 ? '' : 's'} will be moved to Trash.`
            : `Delete "${notebook.name}"?`;

        this.confirmModal(warning, async () => {
            const now = new Date().toISOString();
            this.data.notes.forEach(n => {
                if (n.notebookId === notebookId && !n.deletedAt) n.deletedAt = now;
            });
            this.data.notebooks = this.data.notebooks.filter(n => n.id !== notebookId);

            if (this.currentNotebook && this.currentNotebook.id === notebookId) {
                this.currentNotebook = null;
                this.currentNote = null;
            }

            await this.saveData();
            this.render();
        }, { title: 'Delete Notebook' });
    }
    
    // Note Management
    createNewNote() {
        const notebookId = this.currentNotebook ? this.currentNotebook.id : this.data.notebooks[0].id;
        
        const note = {
            id: Date.now().toString(),
            title: 'Untitled Note',
            content: '',
            notebookId,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            tags: []
        };
        
        this.data.notes.unshift(note);
        this.currentNote = note;
        this.saveData();
        this.render();
        
        // Focus on title input
        setTimeout(() => {
            const titleInput = document.getElementById('editorTitle');
            if (titleInput) {
                titleInput.select();
            }
        }, 100);
    }
    
    selectNote(noteId) {
        this.viewingTrash = false;
        this.currentNote = this.data.notes.find(n => n.id === noteId);
        this.render();
    }
    
    async saveCurrentNote() {
        if (!this.currentNote) return;
        
        const titleInput = document.getElementById('editorTitle');

        if (titleInput && this.cm) {
            const nextContent = this.cm.getValue();

            // Version history. pushHistoryVersion compares against the last
            // *saved* content, which lives in _historyBaseline rather than on
            // the note: the editor's change handler writes straight into
            // currentNote.content on every keystroke, so by the time we get
            // here the note already holds the new text and would never look
            // changed.
            const baseline = this._historyBaseline &&
                             this._historyBaseline.noteId === this.currentNote.id
                ? this._historyBaseline.content
                : this.currentNote.content;

            this.currentNote.history = pushHistoryVersion(
                { content: baseline, updated: this.currentNote.updated, history: this.currentNote.history },
                nextContent
            );

            this.currentNote.title = titleInput.value || 'Untitled Note';
            this.currentNote.content = nextContent;
            this.currentNote.updated = new Date().toISOString();
            this._historyBaseline = { noteId: this.currentNote.id, content: nextContent };

            await this.saveData();
            this.updateStatusBar();
            this.renderNotesList();
        }
    }

    // ── Version history (v2 spec, Phase 0) ──────────────────────────────────
    showNoteHistory() {
        if (!this.currentNote) {
            this.alertModal('Open a note first to see its history.', { title: 'Note History' });
            return;
        }

        const note = this.currentNote;
        const history = note.history || [];

        if (history.length === 0) {
            this.showModal('Note History', `
                <div class="history-empty">
                    No earlier versions yet.<br>
                    A version is kept each time this note is saved with changed
                    content, at most one every ${Math.round(MIN_SNAPSHOT_GAP_MS / 1000)}s,
                    keeping the most recent ${HISTORY_LIMIT}.
                </div>
            `, [{ label: 'Close', class: 'btn-primary', onClick: () => this.closeModal() }]);
            return;
        }

        const current = historyEntryStats({ content: this.cm ? this.cm.getValue() : note.content });
        const items = history.map((entry, i) => {
            const stats = historyEntryStats(entry);
            const when  = new Date(entry.savedAt);
            const whenLabel = Number.isNaN(when.getTime())
                ? 'Unknown date'
                : `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const delta = stats.words - current.words;
            const deltaLabel = delta === 0 ? 'same word count'
                : `${delta > 0 ? '+' : ''}${delta} words vs now`;

            return `
                <div class="history-item" id="historyItem${i}">
                    <div class="history-item-head">
                        <span class="history-when">${escapeHtml(whenLabel)}</span>
                        <span class="history-meta">${stats.words} words · ${stats.lines} lines · ${escapeHtml(deltaLabel)}</span>
                        <button class="history-btn" onclick="document.getElementById('historyItem${i}').classList.toggle('open')">Preview</button>
                        <button class="history-btn" onclick="app.restoreNoteVersion(${i})">Restore</button>
                    </div>
                    <div class="history-item-body">${escapeHtml(entry.content) || '<em>empty</em>'}</div>
                </div>`;
        }).join('');

        this.showModal(`History — ${note.title}`, `
            <div class="history-current">Current: ${current.words} words · ${current.lines} lines · edited ${escapeHtml(relativeTime(note.updated))}</div>
            <div class="history-list">${items}</div>
        `, [{ label: 'Close', class: 'btn-primary', onClick: () => this.closeModal() }]);
    }

    async restoreNoteVersion(index) {
        const note = this.currentNote;
        if (!note) return;
        const entry = (note.history || [])[index];
        if (!entry) return;

        const when = new Date(entry.savedAt);
        const whenLabel = Number.isNaN(when.getTime()) ? 'that version' : when.toLocaleString();

        this.confirmModal(
            `Restore the version from ${whenLabel}? The current text is kept as a new entry in the history, so this is reversible.`,
            async () => {
                const current = this.cm ? this.cm.getValue() : note.content;
                // force: the throttle exists to stop autosave spam, but an
                // explicit restore must never drop the content it replaces.
                note.history = pushHistoryVersion(
                    { content: current, updated: note.updated, history: note.history },
                    entry.content,
                    { force: true }
                );
                note.content = entry.content;
                note.updated = new Date().toISOString();
                this._historyBaseline = { noteId: note.id, content: entry.content };

                await this.saveData();
                this.render();   // rebuilds CodeMirror from note.content
            },
            { title: 'Restore Version', danger: false }
        );
    }
    
    async deleteCurrentNote() {
        if (!this.currentNote) return;
        await this.trashNoteById(this.currentNote.id);
    }

    // Trashing is immediate and undoable, rather than confirmed and permanent.
    //
    // It used to open a modal on every deletion. That interrupts the many
    // intentional deletions in order to guard against the rare accidental one,
    // and it still left the user with no recourse once they had clicked
    // through. Since the note goes to trash and not to oblivion, the honest
    // interaction is to just do it and offer the way back.
    //
    // The undo closure captures the note object itself, so restoring is a
    // single field reset -- no re-lookup that could miss if the library was
    // re-rendered in between.
    async trashNoteById(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;

        const wasCurrent = this.currentNote && this.currentNote.id === noteId;
        note.deletedAt = new Date().toISOString();
        if (wasCurrent) this.currentNote = null;
        await this.saveData();
        this.render();

        this.showToast(`Moved "${note.title}" to Trash`, {
            actionLabel: 'Undo',
            onAction: async () => {
                note.deletedAt = null;
                await this.saveData();
                // Reopening it only if it was open at the time keeps undo a
                // true inverse rather than a navigation the user did not ask for.
                if (wasCurrent) this.selectNote(note.id);
                else this.render();
            },
            // Longer than the default: this one is a decision, not a status,
            // and five seconds is not much time to notice a mistake.
            duration: 8000,
        });
    }

    renameNote(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;

        this.showModal('Rename Note', `
            <div class="form-group">
                <label class="form-label">Note Title</label>
                <input type="text" class="form-input" id="renameNoteInput"
                    value="${escapeHtml(note.title)}"
                    autofocus
                    onkeydown="if(event.key==='Enter')app.handleRenameNote('${noteId}')">
            </div>
        `, [
            { label: 'Cancel', class: 'btn-secondary', onClick: () => this.closeModal() },
            { label: 'Rename', class: 'btn-primary', onClick: () => this.handleRenameNote(noteId) }
        ]);

        setTimeout(() => {
            const input = document.getElementById('renameNoteInput');
            if (input) { input.focus(); input.select(); }
        }, 50);
    }

    async handleRenameNote(noteId) {
        const input = document.getElementById('renameNoteInput');
        const note = this.data.notes.find(n => n.id === noteId);
        if (!input || !note) return;

        const title = input.value.trim();
        if (!title) return;

        note.title = title;
        note.updated = new Date().toISOString();
        await this.saveData();
        this.closeModal();
        this.render();
    }

    async duplicateNote(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;

        const copy = {
            ...note,
            id: Date.now().toString(),
            title: `${note.title} (Copy)`,
            pinned: false,
            deletedAt: null,
            created: new Date().toISOString(),
            updated: new Date().toISOString()
        };

        this.data.notes.unshift(copy);
        this.currentNote = copy;
        await this.saveData();
        this.render();
    }

    async moveNoteToNotebook(noteId, notebookId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;

        note.notebookId = notebookId;
        await this.saveData();
        this.render();
    }

    async restoreNote(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;
        note.deletedAt = null;
        await this.saveData();
        this.render();
    }

    async permanentlyDeleteNote(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;
        this.confirmModal(`Permanently delete "${note.title}"? This cannot be undone.`, async () => {
            this.data.notes = this.data.notes.filter(n => n.id !== noteId);
            if (this.currentNote && this.currentNote.id === noteId) this.currentNote = null;
            await this.saveData();
            this.render();
        }, { title: 'Delete Forever' });
    }

    selectTrash() {
        this.viewingTrash = true;
        this.currentNotebook = null;
        this.currentNote = null;
        this.render();
    }

    async togglePinNote(noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;
        note.pinned = !note.pinned;
        await this.saveData();
        this.renderNotesList();
    }
    
    async exportCurrentNote() {
        if (!this.currentNote) return;
        await window.electron.exportNote(this.currentNote);
    }
    
    async importMarkdown() {
        const result = await window.electron.importMarkdown();
        if (result.success && result.files) {
            const notebookId = this.currentNotebook ? this.currentNotebook.id : this.data.notebooks[0].id;
            
            for (const file of result.files) {
                const note = {
                    id: Date.now().toString() + Math.random(),
                    title: file.fileName,
                    content: file.content,
                    notebookId,
                    created: new Date().toISOString(),
                    updated: new Date().toISOString(),
                    tags: []
                };
                this.data.notes.unshift(note);
            }
            
            await this.saveData();
            this.render();
        }
    }

    // Import every markdown file from a cloned repo as notes, grouped into a
    // notebook named after the repo (reused if it already exists). Returns
    // the number of notes created so the git plugin can report it.
    async importRepoNotes(repoName, files) {
        if (!files || !files.length) return 0;

        let notebook = this.data.notebooks.find(n => n.name === repoName);
        if (!notebook) {
            notebook = {
                id: Date.now().toString(),
                name: repoName,
                icon: '📦',
                color: nextNotebookColor(this.data.notebooks),
                created: new Date().toISOString()
            };
            this.data.notebooks.push(notebook);
        }

        let i = 0;
        for (const file of files) {
            // Prefer the path-relative title so files with the same basename in
            // different folders don't collapse into indistinguishable notes.
            const title = (file.relPath || file.fileName || 'Untitled').replace(/\.(md|markdown)$/i, '');
            this.data.notes.unshift({
                id: `${Date.now()}-${i++}-${Math.random().toString(36).slice(2, 7)}`,
                title,
                content: file.content || '',
                notebookId: notebook.id,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                tags: ['git', 'imported']
            });
        }

        await this.saveData();
        this.render();
        return files.length;
    }

    async importPdf() {
        const result = await window.electron.importPdf();
        if (result.success && result.files) {
            const notebookId = this.currentNotebook ? this.currentNotebook.id : this.data.notebooks[0].id;
            
            for (const file of result.files) {
                const note = {
                    id: Date.now().toString() + Math.random(),
                    title: file.fileName,
                    content: `# ${file.fileName}\n\n*Imported from PDF (${file.pages} pages)*\n\n---\n\n${file.content}`,
                    notebookId,
                    created: new Date().toISOString(),
                    updated: new Date().toISOString(),
                    tags: ['pdf', 'imported']
                };
                this.data.notes.unshift(note);
            }
            
            await this.saveData();
            this.render();
        } else if (result.error) {
            alert('PDF Import Error:\n\n' + result.error);
        }
    }

    async importOnenote() {
        const result = await window.electron.importOnenote();
        if (!result.success && result.error) {
            this.showModal('OneNote Import', `<div style="color:#cdd6f4;line-height:1.7">${result.error.replace(/\n/g, '<br>')}</div>`, [
                { label: 'OK', class: 'btn-primary', onClick: () => this.closeModal() }
            ]);
        }
    }
    
    // View Management
    setViewMode(mode) {
        this.viewMode = mode;
        this.renderEditor();
    }
    
    // Search across the whole library, not just the open notebook.
    //
    // Two things were wrong with the previous version. It filtered
    // getFilteredNotes(), which is already scoped to the current notebook, so
    // "search" only ever searched where you were already looking. And it
    // matched against raw note content, which since notes carried base64 image
    // embeds meant a query could match megabytes of image payload and return a
    // note with no visible occurrence of the term anywhere in it.
    //
    // Matching now runs over the same stripped text the note-list snippets use,
    // so a hit is always something the user can actually see.
    handleSearch(query) {
        const term = query.toLowerCase().trim();

        if (!term) {
            this._searchTerm = '';
            this.renderNotesListWithData(sortPinnedFirst(this.getFilteredNotes()));
            return;
        }

        this._searchTerm = term;

        // Cached per note and invalidated by content identity, because
        // stripping markdown on every keystroke across a large library is the
        // kind of cost that only shows up once someone has a thousand notes.
        this._searchIndex = this._searchIndex || new Map();
        const searchableText = (note) => {
            const cached = this._searchIndex.get(note.id);
            if (cached && cached.src === note.content) return cached.text;
            const text = (note.title + ' ' + snippetFromMarkdown(note.content, Infinity)).toLowerCase();
            this._searchIndex.set(note.id, { src: note.content, text });
            return text;
        };

        const scored = filterActiveNotes(this.data.notes)
            .map(note => ({ note, text: searchableText(note) }))
            .filter(({ text }) => text.includes(term))
            .map(({ note, text }) => ({
                note,
                // Title matches rank above body matches, and an earlier match
                // above a later one -- otherwise results come back in whatever
                // order the library happens to be stored in.
                rank: note.title.toLowerCase().includes(term) ? 0 : 1,
                at: text.indexOf(term),
            }))
            .sort((a, b) => a.rank - b.rank || a.at - b.at)
            .map(r => r.note);

        this.renderNotesListWithData(scored);
    }

    // Wraps occurrences of the active search term for display.
    //
    // Takes ALREADY-ESCAPED text and returns HTML. The term is escaped and
    // regex-quoted before use: a query of `<img onerror=...>` or `.*` must be
    // matched literally, not interpreted as markup or as a pattern.
    highlightMatch(escapedText) {
        const term = this._searchTerm;
        if (!term) return escapedText;
        const needle = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escapedText.replace(new RegExp(needle, 'gi'), '<mark class="search-hit">$&</mark>');
    }
    
    getFilteredNotes() {
        const active = filterActiveNotes(this.data.notes);
        if (this.currentNotebook) {
            return active.filter(n => n.notebookId === this.currentNotebook.id);
        }
        return active;
    }
    
    updatePreview() {
        const preview = document.getElementById('preview');

        if (preview && this.cm) {
            preview.innerHTML = parseMarkdown(this.cm.getValue());
            this.wireTaskCheckboxes(preview);
            this.resolveAttachmentImages(preview);
        }
    }

    // Turns `notehub-attachment:<id>` <img> sources into real file URLs.
    //
    // Runs after render rather than inside parseMarkdown because resolution is
    // an async IPC call and the parser is synchronous -- it is called from
    // template strings during element construction. Resolved paths are cached
    // for the session so re-rendering on every keystroke does not re-cross the
    // IPC boundary for images that have not changed.
    async resolveAttachmentImages(root) {
        if (!root) return;
        this._attachmentUrlCache = this._attachmentUrlCache || new Map();
        const pending = root.querySelectorAll('img[src^="notehub-attachment:"]');

        for (const img of pending) {
            const id = img.getAttribute('src').slice('notehub-attachment:'.length);
            if (this._attachmentUrlCache.has(id)) {
                img.src = this._attachmentUrlCache.get(id);
                continue;
            }
            try {
                const full = await window.electron.resolveAttachment(id);
                if (!full) {
                    // The file is gone. Say so in place rather than leaving a
                    // silently broken image the user cannot diagnose.
                    img.replaceWith(Object.assign(document.createElement('span'), {
                        className: 'md-img-missing',
                        textContent: `⚠ missing image (${id.slice(0, 8)}…)`,
                    }));
                    continue;
                }
                const url = fileUrl(full);
                this._attachmentUrlCache.set(id, url);
                img.src = url;
            } catch (e) {
                console.warn('[NoteHub] could not resolve attachment', id, e);
            }
        }
    }

    // One-time migration of base64 images already embedded in note content.
    //
    // Runs once per library, flagged by `data.attachmentsMigrated`, because it
    // rewrites every note and is pointless to repeat. Failures are per-image:
    // one unreadable embed leaves that single reference inline rather than
    // aborting the migration and leaving the library half-converted.
    async migrateEmbeddedImages() {
        if (!this.data || this.data.attachmentsMigrated) return;

        const EMBED_RE = /!\[([^\]]*)\]\((data:image\/[^;,)]+(?:;base64)?,[^)]+)\)/g;
        let converted = 0, failed = 0;

        for (const note of this.data.notes || []) {
            if (!note.content || !note.content.includes('](data:image/')) continue;

            const matches = [...note.content.matchAll(EMBED_RE)];
            let content = note.content;
            for (const [whole, alt, dataUrl] of matches) {
                try {
                    const stored = await window.electron.saveAttachment(dataUrl);
                    if (!stored || !stored.success) { failed++; continue; }
                    content = content.split(whole).join(`![${alt}](${stored.ref})`);
                    converted++;
                } catch { failed++; }
            }
            note.content = content;

            // History carries its own copies of the same payloads -- the single
            // biggest contributor to file size, since one pasted screenshot can
            // be stored once per revision.
            for (const entry of note.history || []) {
                if (!entry.content || !entry.content.includes('](data:image/')) continue;
                for (const [whole, alt, dataUrl] of entry.content.matchAll(EMBED_RE)) {
                    try {
                        const stored = await window.electron.saveAttachment(dataUrl);
                        if (stored && stored.success) {
                            entry.content = entry.content.split(whole).join(`![${alt}](${stored.ref})`);
                        }
                    } catch { /* a stale revision is not worth failing over */ }
                }
            }
        }

        this.data.attachmentsMigrated = true;
        await this.saveData();
        if (converted || failed) {
            console.log(`[NoteHub] migrated ${converted} embedded image(s) to attachments` +
                        (failed ? `, ${failed} could not be converted` : ''));
        }
    }

    // Collects every attachment id the library still references and asks the
    // main process to delete the rest. Scanning history too is essential: a
    // revision that still references an image is a reason to keep it.
    async pruneUnusedAttachments() {
        if (!this.data) return;
        const ids = new Set();
        const REF_RE = /notehub-attachment:([0-9a-f]{64}\.[a-z0-9]{1,8})/g;
        const scan = (text) => {
            if (!text) return;
            for (const m of text.matchAll(REF_RE)) ids.add(m[1]);
        };
        for (const note of this.data.notes || []) {
            scan(note.content);
            (note.history || []).forEach(h => scan(h.content));
        }
        const result = await window.electron.pruneAttachments([...ids]);
        if (result && result.success && result.removed) {
            console.log(`[NoteHub] pruned ${result.removed} unused attachment(s), ` +
                        `${(result.bytes / 1024).toFixed(0)} KB reclaimed`);
        }
        return result;
    }

    // ── Keyboard navigation for the sidebar lists ──────────────────────────
    //
    // Up/Down move a focus ring through the rows, Enter opens, Delete trashes.
    // Bound once on the container rather than per row: the lists are re-rendered
    // wholesale on every change, so per-row listeners would be re-attached
    // constantly and any row-held state would be destroyed with the row.
    //
    // The moved-to row is focused rather than merely marked, so the browser
    // scrolls it into view and screen readers announce it -- reimplementing
    // either of those by hand is how this kind of feature ends up half-working.
    wireListKeyboardNav() {
        const lists = [
            { id: 'notesList',     itemSel: '.note-item' },
            { id: 'notebooksList', itemSel: '.notebook-item' },
        ];

        lists.forEach(({ id, itemSel }) => {
            const container = document.getElementById(id);
            if (!container || container._kbNavWired) return;

            container.addEventListener('keydown', (e) => {
                const items = [...container.querySelectorAll(itemSel)];
                if (!items.length) return;
                const current = items.indexOf(document.activeElement.closest(itemSel));

                switch (e.key) {
                    case 'ArrowDown':
                    case 'ArrowUp': {
                        e.preventDefault();
                        const delta = e.key === 'ArrowDown' ? 1 : -1;
                        // Clamped, not wrapped: wrapping from the last row to
                        // the first is disorienting when the list is longer
                        // than the viewport and you cannot see where you went.
                        const next = Math.max(0, Math.min(items.length - 1,
                            current === -1 ? 0 : current + delta));
                        items.forEach(el => el.classList.remove('kb-focus'));
                        items[next].classList.add('kb-focus');
                        items[next].focus();
                        break;
                    }
                    case 'Home':
                    case 'End':
                        e.preventDefault();
                        items[e.key === 'Home' ? 0 : items.length - 1].focus();
                        break;
                    case 'Enter':
                    case ' ':
                        if (current === -1) return;
                        e.preventDefault();
                        items[current].click();
                        break;
                    case 'Delete':
                    case 'Backspace': {
                        if (current === -1 || id !== 'notesList') return;
                        e.preventDefault();
                        // Goes through the same trash path as the context menu,
                        // so it is undoable rather than destructive.
                        const noteId = this._noteIdFromElement(items[current]);
                        if (noteId) this.trashNoteById(noteId);
                        break;
                    }
                }
            });
            container._kbNavWired = true;
        });
    }

    // The row's id lives in its onclick attribute; parsing it back out avoids
    // adding a parallel data attribute that could drift from the handler.
    _noteIdFromElement(el) {
        const m = /selectNote\('([^']+)'\)/.exec(el.getAttribute('onclick') || '');
        return m ? m[1] : null;
    }

    // Line-anchored two-way scroll sync between the editor and the preview.
    //
    // Replaces a proportional mapping (editor scrolled 40% -> preview scrolled
    // 40%). Proportion is correct only at the very top and bottom: anywhere a
    // tall element sits on one side and not the other -- an image, a code
    // block, a table, a long wrapped paragraph -- the two panes drift, and by
    // the middle of a long note they can be paragraphs apart.
    //
    // parseMarkdown stamps `data-src-line` on every block element (step 12b),
    // giving a sparse table of (source line -> preview offset) pairs. Positions
    // between two anchors are linearly interpolated, so the mapping is exact at
    // every block boundary and smooth in between.
    //
    // `syncing` breaks the feedback loop: programmatically scrolling pane B
    // fires B's own scroll event, which would scroll A back, and so on. It is
    // cleared on the next frame rather than synchronously because the scroll
    // event is dispatched asynchronously after scrollTop is set.
    wireScrollSync(cm) {
        const preview = document.getElementById('preview');
        const previewPane = preview && preview.closest('.preview-pane');
        if (!previewPane) return;

        let syncing = false;
        const guard = (fn) => {
            if (syncing) return;
            syncing = true;
            fn();
            requestAnimationFrame(() => { syncing = false; });
        };

        // Only meaningful when both panes are visible; in edit or preview mode
        // one of them is display:none and its scroll height is meaningless.
        const bothVisible = () => this.viewMode === 'split' && !previewPane.classList.contains('hidden');

        // Rebuilt on demand and cached until the preview re-renders, because
        // reading offsetTop for every block forces layout -- doing that on each
        // scroll event would make scrolling janky on a long note.
        const anchors = () => {
            if (this._anchorCache && this._anchorCache.html === preview.innerHTML.length) {
                return this._anchorCache.list;
            }
            const list = [...preview.querySelectorAll('[data-src-line]')]
                .map(el => ({ line: Number(el.dataset.srcLine), top: el.offsetTop }))
                .filter(a => Number.isFinite(a.line))
                .sort((a, b) => a.line - b.line);
            this._anchorCache = { html: preview.innerHTML.length, list };
            return list;
        };

        // Linear interpolation between the two anchors bracketing `value`,
        // reading `from` and writing `to`. Shared by both directions so the
        // forward and reverse mappings cannot disagree about the geometry.
        const interpolate = (list, value, from, to) => {
            if (!list.length) return null;
            if (value <= list[0][from]) return list[0][to];
            const last = list[list.length - 1];
            if (value >= last[from]) return last[to];

            // Linear scan rather than a binary search: a note has tens to
            // hundreds of blocks, and this runs once per scroll event.
            for (let i = 0; i < list.length - 1; i++) {
                const a = list[i], b = list[i + 1];
                if (value < a[from] || value > b[from]) continue;
                const span = b[from] - a[from];
                // Two anchors on the same line carry no gradient; return the
                // first rather than dividing by zero.
                if (span === 0) return a[to];
                return a[to] + ((value - a[from]) / span) * (b[to] - a[to]);
            }
            return last[to];
        };

        cm.on('scroll', () => {
            if (!bothVisible()) return;
            const list = anchors();
            if (!list.length) return;

            // The line at the TOP of the editor viewport is what the preview
            // should be showing, which is what makes this feel like the two
            // panes are showing the same place rather than the same fraction.
            const info = cm.getScrollInfo();
            const topLine = cm.lineAtHeight(info.top, 'local');
            const target = interpolate(list, topLine, 'line', 'top');
            if (target === null) return;

            guard(() => {
                previewPane.scrollTop = Math.max(0, target);
            });
        });

        previewPane.addEventListener('scroll', () => {
            if (!bothVisible()) return;
            const list = anchors();
            if (!list.length) return;

            const targetLine = interpolate(list, previewPane.scrollTop, 'top', 'line');
            if (targetLine === null) return;

            guard(() => {
                // heightAtLine is the inverse of lineAtHeight, so a round trip
                // through both lands back where it started.
                cm.scrollTo(null, cm.heightAtLine(Math.round(targetLine), 'local'));
            });
        }, { passive: true });
    }

    // Makes preview-mode task checkboxes clickable. Maps a checkbox's
    // data-task-index (its position in document order) back to the Nth
    // task line in the CodeMirror source and flips [ ] <-> [x] there.
    // Editing the source (rather than just the DOM) keeps the editor,
    // preview, and saved note as one source of truth -- the resulting
    // 'change' event re-renders the preview normally.
    wireTaskCheckboxes(previewEl) {
        const boxes = previewEl.querySelectorAll('input.task-cb');
        boxes.forEach(box => {
            box.addEventListener('change', (e) => {
                e.preventDefault();
                const target = parseInt(box.dataset.taskIndex, 10);
                if (Number.isNaN(target) || !this.cm) return;

                // Must mirror parseMarkdown's LIST_RE + TASK_RE exactly. If the
                // preview accepts `* [ ]` but this scan only accepts `- [ ]`,
                // every index after the first `*` task points at the wrong
                // line and clicking a checkbox toggles someone else's task.
                const TASK_RE = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/;
                const lines = this.cm.getValue().split('\n');
                let seen = -1;
                let inFence = false;

                for (let i = 0; i < lines.length; i++) {
                    // parseMarkdown pulls fenced blocks out before it reaches
                    // the task-list pass, so a `- [ ]` line inside a fence never
                    // becomes a checkbox. Counting it here would shift every
                    // index after it and toggle the wrong line.
                    if (/^[ \t]*```/.test(lines[i])) { inFence = !inFence; continue; }
                    if (inFence) continue;

                    const m = lines[i].match(TASK_RE);
                    if (!m) continue;
                    seen++;
                    if (seen !== target) continue;

                    const nowDone = m[2].toLowerCase() !== 'x';
                    // Replace only the marker char, preserving the line's
                    // exact indentation and trailing content.
                    this.cm.replaceRange(
                        nowDone ? 'x' : ' ',
                        { line: i, ch: m[1].length },
                        { line: i, ch: m[1].length + 1 }
                    );
                    break;
                }
            });
        });
    }
    
    updateStatusBar() {
        const notebookElem = document.getElementById('statusNotebook');
        const wordCountElem = document.getElementById('statusWordCount');
        const lastSavedElem = document.getElementById('statusLastSaved');
        
        if (this.currentNote) {
            const notebook = this.data.notebooks.find(n => n.id === this.currentNote.notebookId);
            if (notebookElem && notebook) {
                notebookElem.textContent = `${notebook.icon} ${notebook.name}`;
            }
            
            if (wordCountElem) {
                const wordCount = this.currentNote.content.split(/\s+/).filter(w => w.length > 0).length;
                wordCountElem.textContent = `${wordCount} words`;
            }
            
            if (lastSavedElem) {
                lastSavedElem.textContent = 'Saved';
                setTimeout(() => {
                    lastSavedElem.textContent = '';
                }, 2000);
            }
        }

        this.updateNoteInfoCard();
    }

    // Atmosphere's note info card: word count, reading time and last-edited,
    // floating over the bright panel. Reads from this.currentNote.content,
    // which the CodeMirror change handler keeps current between saves — so
    // it tracks typing, not just the last write to disk.
    updateNoteInfoCard() {
        const primary = document.getElementById('nicPrimary');
        const secondary = document.getElementById('nicSecondary');
        if (!primary || !secondary || !this.currentNote) return;

        const content = this.currentNote.content || '';
        const words = content.split(/\s+/).filter(w => w.length > 0).length;
        // 220 wpm — the usual silent-reading figure for prose.
        const minutes = Math.max(1, Math.round(words / 220));

        // Word count deliberately omitted: it is already in the status bar, and
        // showing the same number twice made the card feel like chrome rather
        // than information. Reading time is the part the status bar lacks.
        primary.textContent = `${minutes} min read`;
        secondary.textContent = `edited ${relativeTime(this.currentNote.updated)}`;

        // The card is absolutely positioned over the top-right of the preview,
        // where it covers the first line or two of the note. It fades out while
        // the pane is being scrolled and returns once scrolling settles, so it
        // never permanently hides content the user is trying to read.
        const card = document.getElementById('noteInfoCard');
        if (card && !card._scrollFadeWired) {
            const pane = card.closest('.editor-body');
            const target = pane ? pane.querySelector('.preview-pane') : null;
            if (target) {
                target.addEventListener('scroll', () => {
                    card.classList.add('nic-dimmed');
                    clearTimeout(card._fadeTimer);
                    card._fadeTimer = setTimeout(() => card.classList.remove('nic-dimmed'), 700);
                }, { passive: true });
            }
            card._scrollFadeWired = true;
        }
    }
    
    // Rendering
    render() {
        this.renderTabRail();
        this.renderNotebooksList();
        this.renderNotesList();
        this.renderEditor();
        this.updateStatusBar();
        // Idempotent -- guarded by a flag on the container, which survives the
        // innerHTML replacement that rebuilds the rows inside it.
        this.wireListKeyboardNav();
    }
    
    goHome() {
        this.currentNotebook = null;
        this.currentNote = null;
        this.viewingTrash = false;
        this.render();
    }

    renderTabRail() {
        const container = document.getElementById('tabRail');
        const items = this.data.notebooks.map(nb => {
            const isActive = this.currentNotebook && this.currentNotebook.id === nb.id;
            const glow = isActive ? `, 0 0 18px ${nb.color}88` : '';
            return `<div class="tab-rail-item drag-item ${isActive ? 'active' : ''}"
                         style="background: linear-gradient(160deg, ${nb.color}, ${nb.color}cc); box-shadow: 2px 3px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.3)${glow};"
                         draggable="true"
                         ondragstart="app._onDragStart(event, 'notebook', '${nb.id}')"
                         ondragover="app._onDragOver(event, 'notebook', '${nb.id}')"
                         ondragleave="this.classList.remove('drop-before','drop-after')"
                         ondrop="app._onDrop(event, 'notebook', '${nb.id}')"
                         ondragend="app._clearDropMarkers()"
                         data-notebook-id="${nb.id}"
                         onclick="app.selectNotebook('${nb.id}')" title="${escapeHtml(nb.name)}"></div>`;
        }).join('');
        container.innerHTML =
            `<div class="tab-rail-home" onclick="app.goHome()" title="Home">⌂</div>${items}` +
            `<div class="tab-rail-toggle" id="tabRailToggle" onclick="app.toggleSidebar()">‹</div>`;
        this.applySidebarState();
    }

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
                     oncontextmenu="app.openNotebookContextMenu(event, '${nb.id}')"
                     style="background: linear-gradient(160deg, ${nb.color}33, rgba(255,255,255,.03));">
                    <div>
                        <div class="bento-card-name">${escapeHtml(nb.name)}</div>
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

    renderNotebooksList() {
        const container = document.getElementById('notebooksList');
        
        container.innerHTML = this.data.notebooks.map(notebook => {
            const noteCount = this.data.notes.filter(n => n.notebookId === notebook.id).length;
            const isActive = this.currentNotebook && this.currentNotebook.id === notebook.id;
            
            return `
                <div class="notebook-item drag-item ${isActive ? 'active' : ''}"
                     tabindex="0" role="button"
                     ${this._dragAttrs('notebook', notebook.id).replace('class="drag-item"', '')}
                     data-notebook-id="${notebook.id}"
                     onclick="app.selectNotebook('${notebook.id}')"
                     title="${escapeHtml(notebook.name)} (${noteCount} note${noteCount === 1 ? '' : 's'})">
                    <span class="notebook-icon">${escapeHtml(notebook.icon)}</span>
                    <span class="notebook-name">${escapeHtml(notebook.name)}</span>
                    <span class="notebook-count">${noteCount}</span>
                </div>
            `;
        }).join('');
    }
    
    renderNotesList() {
        const notes = this.viewingTrash ? filterTrashedNotes(this.data.notes) : sortPinnedFirst(this.getFilteredNotes());
        this.renderNotesListWithData(notes);

        const headerTitle = document.getElementById('notesHeaderTitle');
        const notesCount = document.getElementById('notesCount');

        if (headerTitle) {
            headerTitle.textContent = this.viewingTrash ? 'Trash' : (this.currentNotebook ? this.currentNotebook.name : 'All Notes');
        }
        if (notesCount) {
            notesCount.textContent = notes.length.toString();
        }

        const trashCount = document.getElementById('trashCount');
        if (trashCount) trashCount.textContent = filterTrashedNotes(this.data.notes).length.toString();

        const trashNavItem = document.getElementById('trashNavItem');
        if (trashNavItem) trashNavItem.classList.toggle('active', this.viewingTrash);
    }
    
    renderNotesListWithData(notes) {
        const container = document.getElementById('notesList');
        
        if (notes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">${this.viewingTrash ? '🗑' : '📝'}</div>
                    <div class="empty-state-text">${this.viewingTrash ? 'Trash is empty' : 'No notes yet'}</div>
                </div>
            `;
            return;
        }

        if (this.viewingTrash) {
            container.innerHTML = notes.map(note => `
                <div class="note-item note-item-trashed" data-note-id="${note.id}" data-trashed="1">
                    <div class="note-item-header">
                        <div class="note-item-title">${escapeHtml(note.title)}</div>
                    </div>
                    <div class="note-item-footer">
                        <button class="btn-icon" onclick="app.restoreNote('${note.id}')" title="Restore">↩ Restore</button>
                        <button class="btn-icon" onclick="app.permanentlyDeleteNote('${note.id}')" title="Delete Forever">🗑 Delete Forever</button>
                    </div>
                </div>
            `).join('');
            return;
        }

        container.innerHTML = notes.map(note => {
            const preview = this.highlightMatch(escapeHtml(snippetFromMarkdown(note.content)));
            const date = new Date(note.updated).toLocaleDateString();
            const isActive = this.currentNote && this.currentNote.id === note.id;

            return `
                <div class="note-item drag-item ${isActive ? 'active' : ''}"
                     tabindex="0" role="button"
                     ${this._dragAttrs('note', note.id).replace('class="drag-item"', '')}
                     data-note-id="${note.id}"
                     onclick="app.selectNote('${note.id}')">
                    <div class="note-item-header">
                        <div class="note-item-title" title="${escapeHtml(note.title)}">${this.highlightMatch(escapeHtml(note.title))}</div>
                        <button class="btn-icon note-pin-btn ${note.pinned ? 'pinned' : ''}"
                                onclick="event.stopPropagation(); app.togglePinNote('${note.id}')"
                                aria-pressed="${note.pinned ? 'true' : 'false'}"
                                title="${note.pinned ? 'Unpin' : 'Pin'}">
                            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                                <path fill="currentColor" d="M9.5 1a.5.5 0 0 0-.5.5v4.06l-2.7 1.8A2 2 0 0 0 5.4 9h5.1v6a.5.5 0 0 0 1 0V9h.1a2 2 0 0 0-.9-1.64L8 5.56V1.5a.5.5 0 0 0-.5-.5h2z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="note-item-preview">${preview || 'Empty note'}</div>
                    <div class="note-item-footer">
                        <div class="note-item-date">
                            <svg width="12" height="12" viewBox="0 0 16 16" style="opacity: 0.6;">
                                <path fill="currentColor" d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
                                <path fill="currentColor" d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
                            </svg>
                            ${date}
                        </div>
                        ${note.tags.length > 0 ? `
                            <div class="note-item-tags">
                                ${note.tags.map(tag => `<span class="note-tag">${escapeHtml(tag)}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    renderEditor() {
        const container = document.getElementById('editorContainer');
        const welcomeScreen = document.getElementById('welcomeScreen');
        const homeView = document.getElementById('homeView');

        if (!this.currentNotebook && !this.currentNote && !this.viewingTrash) {
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
            if (existingEditor) {
                existingEditor.remove();
            }
            return;
        }
        
        welcomeScreen.style.display = 'none';
        
        const existingEditor = container.querySelector('.editor-wrapper');
        if (existingEditor) {
            existingEditor.remove();
        }
        
        // Plugin toolbar buttons, capped.
        //
        // Plugins register these freely and the row has no overflow handling,
        // so five enabled plugins pushed the built-in controls off the edge of
        // the window. Only the first two get a slot; the rest stay reachable
        // through the plugin menu immediately to their right, which lists every
        // enabled plugin regardless.
        const PLUGIN_BTN_LIMIT = 2;
        const allPluginActions = this._pluginToolbarActions || [];
        const pluginToolbarBtns = allPluginActions.slice(0, PLUGIN_BTN_LIMIT).map(action => `
            <button class="btn-icon plugin-toolbar-btn"
                onclick="app._pluginToolbarActions.find(a=>a.id==='${action.id}')?.onClick()"
                aria-label="${escapeHtml(action.label)}"
                title="${escapeHtml(action.label)}">
                ${action.icon || '\u25C6'}
            </button>
        `).join('');

        // Build enabled plugins list for dropdown
        const enabledPlugins = (this.config && this.config.plugins && this.config.plugins.enabled) || [];
        const pluginMenuItems = enabledPlugins.length > 0
            ? enabledPlugins.map(id => {
                const meta = {
                    'math-renderer':    { icon: '📐', label: 'Math Renderer',   desc: 'Insert LaTeX math' },
                    'terminal':         { icon: '💻', label: 'Terminal',         desc: 'Toggle terminal (Ctrl+`)' },
                    'advanced-search':  { icon: '🔍', label: 'Advanced Search',  desc: 'Search all notes' },
                    'docx-converter':   { icon: '📄', label: 'DOCX Converter',   desc: 'Import Word document' },
                    'excel-integration':{ icon: '📊', label: 'Excel Integration',desc: 'Import spreadsheet' },
                }[id] || { icon: '🧩', label: id, desc: '' };
                return `
                    <div class="plugin-menu-item" onclick="app.activatePlugin('${id}'); document.getElementById('pluginMenuDropdown').style.display='none'">
                        <span class="plugin-menu-icon">${meta.icon}</span>
                        <div class="plugin-menu-text">
                            <span class="plugin-menu-label">${meta.label}</span>
                            <span class="plugin-menu-desc">${meta.desc}</span>
                        </div>
                    </div>`;
              }).join('')
            : '<div style="padding:12px 16px;color:#6c7086;font-size:12px">No plugins enabled.<br>Enable them in Preferences → Plugins.</div>';

        // The open notebook's colour drives the panel's accent rule, its
        // heading colour and its code-block tint — one colour language from
        // the tab rail through to the page (Atmosphere spec, "signature
        // element"). `-ink` is the darkened variant used for text.
        const nb = this.currentNotebook
            || this.data.notebooks.find(n => n.id === this.currentNote.notebookId);
        // nb.color is stored data reaching a style attribute, so it is only
        // used once it parses as a hex colour.
        const accent = (nb && hexToRgb(nb.color)) ? nb.color : '#7c6df0';
        const brightPanel = !(this.config && this.config.theme && this.config.theme.brightPanel === false);
        const ink = shadeHex(accent, -0.55);
        const accentVars = `--nb-accent: ${accent};` + (ink ? ` --nb-accent-ink: ${ink};` : '');

        const editorHTML = `
            <div class="editor-wrapper${brightPanel ? ' bright' : ''}" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; ${accentVars}">
                <div class="editor-toolbar">
                    <input 
                        type="text" 
                        class="editor-title-input" 
                        id="editorTitle"
                        value="${escapeHtml(this.currentNote.title)}"
                        placeholder="Note title..."
                    >
                    <div class="editor-toolbar-actions">
                        ${pluginToolbarBtns}
                        <div class="plugin-menu-wrap" id="pluginMenuWrap">
                            <button class="btn-icon" id="pluginMenuBtn"
                                onclick="app.togglePluginMenu()"
                                aria-label="Plugins"
                                title="Plugins (${enabledPlugins.length} enabled)">
                                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                                    <path fill="currentColor" d="M6 1.5a.5.5 0 0 1 1 0V4h2V1.5a.5.5 0 0 1 1 0V4h.5A1.5 1.5 0 0 1 12 5.5v2.7a4 4 0 0 1-2.6 3.75l-.4.15v2.4a.5.5 0 0 1-1 0v-2.4l-.4-.15A4 4 0 0 1 5 8.2V5.5A1.5 1.5 0 0 1 6.5 4H6V1.5z"/>
                                </svg>
                                ${enabledPlugins.length > 0 ? `<span class="btn-icon-badge">${enabledPlugins.length}</span>` : ''}
                            </button>
                            <div id="pluginMenuDropdown" style="display:none;position:absolute;top:100%;right:0;background:#181825;border:1px solid #313244;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:220px;z-index:9999;overflow:hidden">
                                <div style="padding:8px 12px 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6c7086;border-bottom:1px solid #313244">
                                    Installed Plugins
                                </div>
                                ${pluginMenuItems}
                            </div>
                        </div>
                        <div class="toolbar-sep" role="separator"></div>
                        <div class="view-mode-toggle" role="group" aria-label="View mode">
                            <button class="view-mode-btn ${this.viewMode === 'edit' ? 'active' : ''}" onclick="app.setViewMode('edit')">Edit</button>
                            <button class="view-mode-btn ${this.viewMode === 'split' ? 'active' : ''}" onclick="app.setViewMode('split')">Split</button>
                            <button class="view-mode-btn ${this.viewMode === 'preview' ? 'active' : ''}" onclick="app.setViewMode('preview')">Preview</button>
                        </div>
                        <button class="btn-icon" onclick="app.insertImageFromFile()"
                                aria-label="Insert image"
                                title="Insert image (or paste/drag an image)">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <path fill="currentColor" d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                                <path fill="currentColor" d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="app.showNoteHistory()"
                                aria-label="Version history" title="Version history">
                            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                                <path fill="currentColor" d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3 1.714a.5.5 0 0 0 .496-.868L8 7.71V3.5z"/>
                                <path fill="currentColor" d="M8 0a8 8 0 1 0 8 8 .5.5 0 0 0-1 0A7 7 0 1 1 8 1a.5.5 0 0 0 0-1z"/>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="app.exportCurrentNote()"
                                aria-label="Export note" title="Export">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <path fill="currentColor" d="M8.5 1a.5.5 0 0 0-1 0v8.793L5.354 7.646a.5.5 0 1 0-.708.708l3 3a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 9.793V1z"/>
                                <path fill="currentColor" d="M3 12.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
                            </svg>
                        </button>
                        <div class="toolbar-sep" role="separator"></div>
                        <button class="btn-icon btn-icon-danger" onclick="app.deleteCurrentNote()"
                                aria-label="Move note to trash" title="Move to trash">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <path fill="currentColor" d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                                <path fill="currentColor" fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="editor-body">
                    <div class="note-info-card" id="noteInfoCard">
                        <span class="nic-primary" id="nicPrimary"></span>
                        <span class="nic-secondary" id="nicSecondary"></span>
                    </div>
                    <div class="editor-pane ${this.viewMode === 'preview' ? 'hidden' : ''}">
                        <div class="lined-editor-wrap" id="linedEditorWrap"></div>
                    </div>
                    <div class="preview-pane ${this.viewMode === 'edit' ? 'hidden' : ''}">
                        <div class="preview-content" id="preview">
                            ${parseMarkdown(this.currentNote.content)}
                        </div>
                    </div>
                    <!-- Shown by the toc-open class on <html>; built from the
                         note source, not scraped from the preview, so it works
                         in edit mode too. -->
                    <nav class="toc-panel" id="tocPanel" aria-label="Table of contents"></nav>
                </div>
            </div>
        `;
        
        container.insertAdjacentHTML('beforeend', editorHTML);

        // The preview above is rendered straight into the template string, so
        // it never goes through updatePreview() -- wire its checkboxes here or
        // they stay inert until the first edit.
        const initialPreview = document.getElementById('preview');
        if (initialPreview) this.wireTaskCheckboxes(initialPreview);

        // Add event listeners
        const titleInput = document.getElementById('editorTitle');
        const cmHost = document.getElementById('linedEditorWrap');

        if (titleInput) {
            titleInput.addEventListener('input', () => {
                this.currentNote.title = titleInput.value;
            });
        }

        // Coalesce updatePreview() calls to once per frame -- typing can
        // fire 'change' faster than the browser repaints, and a full
        // parseMarkdown() + innerHTML swap on every keystroke was the
        // main source of the Enter-key stutter in TODO_FIX.md.
        let previewFrameScheduled = false;
        const schedulePreviewUpdate = () => {
            if (previewFrameScheduled) return;
            previewFrameScheduled = true;
            requestAnimationFrame(() => {
                previewFrameScheduled = false;
                this.updatePreview();
            });
        };

        if (cmHost) {
            const relativeNums = () => this.config && this.config.editor && this.config.editor.relativeLineNumbers;
            // Referenced by the formatter below; CodeMirror calls it during
            // its own constructor, before `cm` is assigned, hence the guard.
            let cm;
            const lineNumberFormatter = (line) => {
                if (!cm || !relativeNums()) return String(line);
                const cursorLine = cm.getCursor().line + 1;
                return String(line === cursorLine ? line : Math.abs(line - cursorLine));
            };

            const nvim = (this.config && this.config.nvim) || {};
            const tabSize = nvim.tabSize || 2;

            cm = CodeMirror(cmHost, {
                value: this.currentNote.content || '',
                lineNumbers: !(this.config && this.config.editor && this.config.editor.lineNumbers === false),
                viewportMargin: 10,
                lineWrapping: !!(this.config && this.config.editor && this.config.editor.wordWrap),
                spellcheck: !!(this.config && this.config.editor && this.config.editor.spellCheck),
                lineNumberFormatter,
                keyMap: (this.config && this.config.editor && this.config.editor.vimMode) ? 'vim' : 'default',
                // highlightFormatting/strikethrough/taskLists all default to
                // false in CM's markdown mode -- without them the cm-formatting,
                // cm-strikethrough and task-marker rules in main.css never fire.
                mode: nvim.syntaxHighlight === false ? null : {
                    name: 'markdown',
                    highlightFormatting: true,
                    strikethrough: true,
                    taskLists: true,
                },
                styleActiveLine: nvim.highlightActiveLine !== false,
                matchBrackets: nvim.showMatchingBrackets !== false,
                autoCloseBrackets: nvim.autoCloseBrackets !== false,
                indentUnit: tabSize,
                tabSize,
                indentWithTabs: !!nvim.indentWithTabs,
            });
            this.cm = cm;
            this._historyBaseline = { noteId: this.currentNote.id, content: this.currentNote.content || '' };

            if (this.config && this.config.editor && this.config.editor.vimMode) {
                this.applyVimKeybindings();
            }

            // Relative line numbers need the gutter to repaint on cursor
            // move alone (no content change) -- cm.refresh() is what
            // actually re-invokes lineNumberFormatter per visible line;
            // toggling the `lineNumbers` option back to its own value
            // silently no-ops. Skip it unless the cursor's line (or the
            // line count) actually changed, same guard the old
            // updateLineNumbers() DOM rebuild used, so plain typing on one
            // line doesn't force a redraw on every keystroke.
            let lastCursorLine = -1;
            let lastLineCount = -1;
            cm.on('cursorActivity', () => {
                if (!relativeNums()) return;
                const cursorLine = cm.getCursor().line;
                const lineCount = cm.lineCount();
                if (cursorLine === lastCursorLine && lineCount === lastLineCount) return;
                lastCursorLine = cursorLine;
                lastLineCount = lineCount;
                cm.refresh();
            });

            cm.on('change', () => {
                this.currentNote.content = cm.getValue();
                schedulePreviewUpdate();
                this.updateNoteInfoCard();
                // Only when the panel is actually open -- reparsing every
                // heading in the note on each keystroke is pure waste while it
                // is hidden.
                if (this._tocOpen) this.renderTableOfContents();
            });

            this.wireScrollSync(cm);

            // ── Image paste (Ctrl/Cmd+V with image in clipboard) ──
            cm.on('paste', (instance, e) => {
                const items = e.clipboardData && e.clipboardData.items;
                if (!items) return;
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        const blob = item.getAsFile();
                        const ext  = (item.type.split('/')[1] || 'png').replace('+xml', '');
                        this.attachImageBlob(blob, `pasted-image.${ext}`)
                            .catch(err => console.error('[NoteHub] paste failed:', err));
                        break;
                    }
                }
            });

            // ── Image drag & drop onto editor ──
            const wrapperEl = cm.getWrapperElement();
            wrapperEl.addEventListener('dragover', (e) => { e.preventDefault(); wrapperEl.style.background = 'rgba(203,166,247,.08)'; });
            wrapperEl.addEventListener('dragleave', () => { wrapperEl.style.background = ''; });
            wrapperEl.addEventListener('drop', (e) => {
                e.preventDefault();
                wrapperEl.style.background = '';
                const files = e.dataTransfer.files;
                for (const file of files) {
                    if (!file.type.startsWith('image/')) continue;
                    this.attachImageBlob(file, file.name)
                        .catch(err => console.error('[NoteHub] drop failed:', err));
                }
            });
        }
    }

    // Wires config.editor.vimKeybindings (Vim-mode key sequence -> a
    // command-palette action id) into CodeMirror's Vim addon. Vim.map is
    // global to the addon, not per-CodeMirror-instance, so mapclear first
    // to avoid piling up stale mappings across re-renders.
    //
    // Multi-key sequences whose first character already has a normal-mode
    // binding (almost every plain letter does -- h/j/k/l/d/y/g.../etc.)
    // will fire that existing command immediately instead of waiting for
    // the rest of the sequence: CodeMirror 5's Vim addon always prefers an
    // immediate full match over waiting on a longer partial one, unlike
    // real Vim's `timeoutlen` disambiguation. That conflict doesn't exist
    // in insert mode (plain typing doesn't go through this match table at
    // all), which is why the classic "jj -> Escape" idiom only ever works
    // there -- so insert-mode is the reliable context for prefix-colliding
    // sequences; normal-mode is fine for keys with no existing binding
    // (rare among plain letters) or Ctrl/Cmd-modified combos.
    applyVimKeybindings() {
        if (!window.CodeMirror || !window.CodeMirror.Vim) return;
        const Vim = window.CodeMirror.Vim;
        ['normal', 'insert', 'visual'].forEach(ctx => Vim.mapclear(ctx));

        const bindings = (this.config && this.config.editor && this.config.editor.vimKeybindings) || [];
        const cmds = this._buildPaletteCommands();
        bindings.forEach((kb, i) => {
            const cmd = cmds.find(c => c.id === kb.action);
            if (!cmd || !kb.keys) return;
            const exName = 'nhCmd' + i;
            const mode = kb.mode || 'normal';
            try {
                // Defer the action to a microtask. The CM5 vim addon strips the
                // typed trigger sequence from the buffer as part of dispatching
                // the mapping, but that deletion's change event hasn't settled
                // into currentNote.content yet when the ex command runs inline.
                // Actions that recreate the editor (view switches, etc.) would
                // otherwise reload the pre-cleanup text and leave the sequence's
                // first char stuck in the note. Running on the next microtask
                // lets the cleanup sync first, so no trigger char leaks.
                Vim.defineEx(exName, '', () => Promise.resolve().then(() => cmd.run()));
                // rhs starting with ':' is executed directly as an ex command
                // (not replayed as keystrokes), so no trailing <CR> here.
                Vim.map(kb.keys, ':' + exName, mode);
            } catch (e) {
                console.warn('[NoteHub] Skipping invalid Vim keybinding', kb, e.message);
            }
        });
    }

    showWelcome() {
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (!welcomeScreen) return;
        welcomeScreen.style.display = 'flex';

        // Update text based on whether user has existing notes
        const hasNotes = this.data.notes.length > 0;
        const titleEl  = document.getElementById('welcomeTitle');
        const subEl    = document.getElementById('welcomeSubtitle');
        const btnEl    = document.getElementById('welcomeNewNoteBtn');

        if (hasNotes) {
            if (titleEl) titleEl.textContent = 'NoteHub';
            if (subEl)   subEl.textContent = `You have ${this.data.notes.length} note${this.data.notes.length !== 1 ? 's' : ''}. Select one from the sidebar or create a new one.`;
            if (btnEl)   btnEl.textContent = '+ New Note';
        } else {
            if (titleEl) titleEl.textContent = 'Welcome to NoteHub';
            if (subEl)   subEl.textContent = 'Create a new note or select one from the sidebar to get started.';
            if (btnEl)   btnEl.textContent = 'Create Your First Note';
        }
    }

    async insertImageFromFile() {
        const result = await window.electron.importImage();
        if (!result || !result.success) return;
        this.insertImageRef(result.ref, result.name);
    }

    // Single insertion path for the picker, paste and drop, so all three
    // produce the same `![alt](notehub-attachment:<id>)` reference rather than
    // three near-identical blocks each inlining base64 their own way.
    insertImageRef(ref, name) {
        if (!this.cm || !ref) return;
        this.cm.replaceSelection(`\n![${(name || 'image').replace(/[[\]]/g, '')}](${ref})\n`);
        this.currentNote.content = this.cm.getValue();
        this.updatePreview();
    }

    // Hands a Blob or File to the attachment store and inserts the reference.
    // Falls back to inlining the data URL if the store rejects it -- losing the
    // pasted image entirely would be a worse outcome than an oversized note.
    async attachImageBlob(blob, name) {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = (ev) => resolve(ev.target.result);
            reader.onerror = () => reject(new Error('could not read image'));
            reader.readAsDataURL(blob);
        });
        const stored = await window.electron.saveAttachment(dataUrl);
        if (stored && stored.success) this.insertImageRef(stored.ref, name);
        else {
            console.warn('[NoteHub] attachment store failed, inlining:', stored && stored.error);
            this.insertImageRef(dataUrl, name);
        }
    }

    togglePluginMenu() {
        const dd = document.getElementById('pluginMenuDropdown');
        if (!dd) return;
        const isOpen = dd.style.display !== 'none';
        dd.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) {
            // Close when clicking outside
            const close = (e) => {
                if (!e.target.closest('#pluginMenuWrap')) {
                    dd.style.display = 'none';
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
        }
    }

    // Called when user clicks a plugin in the dropdown
    activatePlugin(pluginId) {
        const triggers = {
            'terminal':          () => { const btn = document.querySelector('.terminal-toggle-btn'); if (btn) btn.click(); else window.dispatchEvent(new CustomEvent('notehub:toggle-terminal')); },
            'advanced-search':   () => { window.dispatchEvent(new CustomEvent('notehub:open-search')); const btn = document.querySelector('.advanced-search-btn'); if (btn) btn.click(); },
            'math-renderer':     () => { window.dispatchEvent(new CustomEvent('notehub:math-help')); const btn = document.querySelector('.math-help-btn'); if (btn) btn.click(); },
            'docx-converter':    () => { window.dispatchEvent(new CustomEvent('notehub:import-docx')); const btn = document.querySelector('.docx-import-btn'); if (btn) btn.click(); },
            'excel-integration': () => { window.dispatchEvent(new CustomEvent('notehub:import-excel')); const btn = document.querySelector('.excel-import-btn'); if (btn) btn.click(); },
        };
        const trigger = triggers[pluginId];
        if (trigger) { trigger(); }
        else { this.showModal('Plugin', `<p style="color:#cdd6f4">The <strong>${pluginId}</strong> plugin is active. Use its toolbar button or keyboard shortcut to interact with it.</p>`, [{ label: 'OK', class: 'btn-primary', onClick: () => this.closeModal() }]); }
    }

    // ── Context Menu ─────────────────────────────────────────────────────────
    // The widget itself lives in context-menu.js, which builds real DOM nodes
    // and sets every label with textContent. That is deliberate: the stored-XSS
    // fixed in 81581cd -- notebook names reaching innerHTML unescaped -- cannot
    // recur by construction there, whereas the string-building version it
    // replaces needed an escapeHtml() call at each interpolation to stay safe.
    //
    // These two methods remain the app-facing seam, so the sidebar menus below
    // read exactly as they did and keep their item shape ({ separator: true },
    // { submenu: [...] }), which context-menu.js accepts alongside its own.
    openContextMenu(e, items) {
        if (e && e.preventDefault) { e.preventDefault(); e.stopPropagation(); }
        window.NHContextMenu.show(items, e.clientX, e.clientY);
    }

    closeContextMenu() {
        window.NHContextMenu.close();
    }

    openNoteContextMenu(e, noteId) {
        const note = this.data.notes.find(n => n.id === noteId);
        if (!note) return;

        const moveTargets = this.data.notebooks
            .filter(nb => nb.id !== note.notebookId)
            .map(nb => ({ icon: nb.icon, label: nb.name, run: () => this.moveNoteToNotebook(noteId, nb.id) }));

        this.openContextMenu(e, [
            { icon: '✏️', label: 'Rename',                          run: () => this.renameNote(noteId) },
            { icon: '📌', label: note.pinned ? 'Unpin' : 'Pin',      run: () => this.togglePinNote(noteId) },
            { icon: '📄', label: 'Duplicate',                        run: () => this.duplicateNote(noteId) },
            ...(moveTargets.length ? [{ icon: '➡️', label: 'Move to Notebook', submenu: moveTargets }] : []),
            { separator: true },
            { icon: '🗑', label: 'Move to Trash', danger: true,      run: () => this.trashNoteById(noteId) },
        ]);
    }

    openTrashedNoteContextMenu(e, noteId) {
        this.openContextMenu(e, [
            { icon: '↩', label: 'Restore',                     run: () => this.restoreNote(noteId) },
            { icon: '🗑', label: 'Delete Forever', danger: true, run: () => this.permanentlyDeleteNote(noteId) },
        ]);
    }

    openNotebookContextMenu(e, notebookId) {
        this.openContextMenu(e, [
            { icon: '✏️', label: 'Rename',                run: () => this.renameNotebook(notebookId) },
            { icon: '🎨', label: 'Change Colour…',        run: () => this.changeNotebookColor(notebookId) },
            { separator: true },
            { icon: '🗑', label: 'Delete Notebook', danger: true, run: () => this.deleteNotebook(notebookId) },
        ]);
    }

    // ── Toasts ──────────────────────────────────────────────────────────────
    //
    // Transient, non-blocking feedback, optionally with one action attached.
    //
    // The action slot exists mainly for undo. Trashing a note is recoverable --
    // it goes to trash, not to oblivion -- but nothing said so at the moment the
    // user needed to know, which makes a reversible action feel permanent. A
    // confirmation dialog would be the obvious alternative and is worse: it
    // interrupts every deletion, including the intended ones, to guard against
    // the rare mistake.
    //
    // One toast at a time. Stacking them turns a corner of the window into a
    // log nobody reads, and the newest message is invariably the relevant one.
    showToast(message, { actionLabel, onAction, duration = 5000 } = {}) {
        const existing = document.getElementById('nhToast');
        if (existing) {
            clearTimeout(existing._timer);
            existing.remove();
        }

        const toast = document.createElement('div');
        toast.id = 'nhToast';
        toast.className = 'nh-toast';
        toast.setAttribute('role', 'status');
        // polite, not assertive: a toast is informational and should not
        // interrupt whatever a screen reader is currently saying.
        toast.setAttribute('aria-live', 'polite');

        const text = document.createElement('span');
        text.className = 'nh-toast-msg';
        text.textContent = message;          // textContent, never innerHTML --
        toast.appendChild(text);             // messages carry note titles

        const dismiss = () => {
            toast.classList.remove('visible');
            // Removed only after the fade finishes, so the element does not
            // vanish mid-transition.
            setTimeout(() => toast.remove(), 200);
        };

        if (actionLabel && onAction) {
            const btn = document.createElement('button');
            btn.className = 'nh-toast-action';
            btn.textContent = actionLabel;
            btn.onclick = () => {
                clearTimeout(toast._timer);
                dismiss();
                onAction();
            };
            toast.appendChild(btn);
        }

        const close = document.createElement('button');
        close.className = 'nh-toast-close';
        close.setAttribute('aria-label', 'Dismiss');
        close.textContent = '\u00D7';
        close.onclick = () => { clearTimeout(toast._timer); dismiss(); };
        toast.appendChild(close);

        document.body.appendChild(toast);
        // Next frame, so the element is in the DOM with its initial styles
        // before the class that transitions it is added -- otherwise the
        // browser has nothing to animate from and it simply appears.
        requestAnimationFrame(() => toast.classList.add('visible'));
        toast._timer = setTimeout(dismiss, duration);
        return toast;
    }

    // ── Zen mode ────────────────────────────────────────────────────────────
    //
    // Hides the tab rail, sidebar, toolbar and status bar and centres the
    // editor at a readable measure. Everything is driven by ONE class on
    // <html> plus one flag, rather than by four independent toggles.
    //
    // That distinction matters more than it looks. With four toggles, leaving
    // zen means restoring four remembered values, and any of them changed
    // while zen was active (via the palette, a shortcut, Preferences) gets
    // clobbered on the way out. One reversible state has nothing to remember:
    // the underlying config is never written, so exiting simply stops
    // overriding it and whatever the user set is what comes back.
    //
    // Deliberately NOT persisted. Zen is a mode you are in right now, not a
    // preference; launching into it after a restart, with no visible chrome
    // and no obvious way out, is a genuinely alarming first impression.
    toggleZenMode(force) {
        const next = force === undefined ? !this._zenMode : !!force;
        if (next === this._zenMode) return;
        this._zenMode = next;

        document.documentElement.classList.toggle('zen-mode', next);

        // CodeMirror caches its viewport dimensions and does not observe the
        // element it lives in. Without a refresh after the layout changes, the
        // cursor lands in the wrong place and the gutter misaligns until the
        // next keystroke forces a redraw.
        if (this.cm) requestAnimationFrame(() => this.cm.refresh());

        if (next) this.showToast('Zen mode — press Esc or ⌘. to exit');
    }

    // ── Table of contents ───────────────────────────────────────────────────
    //
    // Built from the note's headings. Parsed from the SOURCE rather than
    // scraped from the rendered preview, so it works in edit mode where there
    // is no preview to scrape, and so clicking an entry can move the editor
    // cursor to a real line number.
    //
    // Fenced code is skipped: `# comment` inside a shell block is a comment,
    // not a heading, and the parser already treats it that way.
    buildTableOfContents(source) {
        const lines = String(source || '').split('\n');
        const out = [];
        let inFence = false;

        lines.forEach((line, i) => {
            if (/^[ \t]*```/.test(line)) { inFence = !inFence; return; }
            if (inFence) return;

            const atx = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/.exec(line);
            if (atx) { out.push({ level: atx[1].length, text: atx[2].trim(), line: i }); return; }

            // Setext: the underline is on the FOLLOWING line, so the heading is
            // recognised one line late and has to point back at its own line.
            const prev = lines[i - 1];
            if (prev && prev.trim() && !/^[#>\-*+]/.test(prev.trim())) {
                if (/^[ \t]*=+[ \t]*$/.test(line)) out.push({ level: 1, text: prev.trim(), line: i - 1 });
                else if (/^[ \t]*-{2,}[ \t]*$/.test(line)) out.push({ level: 2, text: prev.trim(), line: i - 1 });
            }
        });
        return out;
    }

    renderTableOfContents() {
        const panel = document.getElementById('tocPanel');
        if (!panel) return;

        const entries = this.currentNote ? this.buildTableOfContents(this.currentNote.content) : [];
        if (!entries.length) {
            panel.innerHTML = '<div class="toc-empty">No headings in this note</div>';
            return;
        }

        // Indentation is relative to the note's own shallowest heading, so a
        // note whose top level is h2 does not render every entry inset by one
        // step for no reason.
        const base = Math.min(...entries.map(e => e.level));
        panel.innerHTML = entries.map(e => `
            <button class="toc-item toc-level-${Math.min(e.level - base, 3)}"
                    onclick="app.jumpToLine(${e.line})"
                    title="${escapeHtml(e.text)}">${escapeHtml(e.text)}</button>
        `).join('');
    }

    // Scrolls the editor to a source line and puts the cursor on it. Used by
    // the table of contents; kept generic because search results will want it.
    jumpToLine(line) {
        if (!this.cm) return;
        this.cm.setCursor({ line, ch: 0 });
        // Centres the target rather than leaving it at the very top edge, where
        // it is technically visible but has no context above it.
        const coords = this.cm.charCoords({ line, ch: 0 }, 'local');
        const half = this.cm.getScrollInfo().clientHeight / 2;
        this.cm.scrollTo(null, Math.max(0, coords.top - half));
        this.cm.focus();
    }

    toggleTableOfContents(force) {
        const next = force === undefined ? !this._tocOpen : !!force;
        this._tocOpen = next;
        document.documentElement.classList.toggle('toc-open', next);
        if (next) this.renderTableOfContents();
        if (this.cm) requestAnimationFrame(() => this.cm.refresh());
    }

    // ── Command Palette ─────────────────────────────────────────────────────
    _buildPaletteCommands() {
        const enabled = (this.config && this.config.plugins && this.config.plugins.enabled) || [];

        const cmds = [
            // ── Notes ──────────────────────────────────────────
            { id: 'new-note',      icon: '📝', label: 'New Note',             category: 'Notes',     kbd: '⌘N',       run: () => this.createNewNote() },
            { id: 'new-notebook',  icon: '📓', label: 'New Notebook',         category: 'Notes',     kbd: '⌘⇧N',      run: () => this.createNewNotebook() },
            { id: 'export-note',   icon: '⬇',  label: 'Export Current Note',  category: 'Notes',     kbd: '⌘E',       run: () => this.exportCurrentNote() },
            { id: 'delete-note',   icon: '🗑',  label: 'Delete Current Note',  category: 'Notes',                      run: () => this.deleteCurrentNote() },
            { id: 'note-history',  icon: '🕘', label: 'Note History',          category: 'Notes',                      run: () => this.showNoteHistory() },

            // ── View ───────────────────────────────────────────
            { id: 'view-edit',     icon: '✏️',  label: 'Editor: Edit Mode',    category: 'View',      kbd: '⌘1',       run: () => this.setViewMode('edit') },
            { id: 'view-split',    icon: '⬛',  label: 'Editor: Split Mode',   category: 'View',      kbd: '⌘2',       run: () => this.setViewMode('split') },
            { id: 'view-preview',  icon: '👁',  label: 'Editor: Preview Mode', category: 'View',      kbd: '⌘3',       run: () => this.setViewMode('preview') },
            { id: 'toggle-sidebar', icon: '◧', label: 'Toggle Sidebar',        category: 'View',      kbd: '⌘B',       run: () => this.toggleSidebar() },
            { id: 'zen-mode',       icon: '◎', label: 'Toggle Zen Mode',        category: 'View',      kbd: '⌘.',       run: () => this.toggleZenMode() },
            { id: 'toggle-toc',     icon: '☰', label: 'Toggle Table of Contents', category: 'View',    kbd: '⌘/',       run: () => this.toggleTableOfContents() },
            { id: 'quick-switch',   icon: '⌕', label: 'Quick Switch to Note…',  category: 'View',      kbd: '⌘K',       run: () => this.openCommandPalette('notes') },
            { id: 'toggle-notebooks', icon: '📚', label: 'Toggle Notebooks Section', category: 'View',                 run: () => this.toggleSidebarSection('notebooks') },
            { id: 'toggle-notes-sec', icon: '🗂', label: 'Toggle Notes Section',     category: 'View',                 run: () => this.toggleSidebarSection('notes') },
            { id: 'next-note',      icon: '→',  label: 'Next Note',              category: 'View',      kbd: '⌃Tab',     run: () => this.cycleNote(1) },
            { id: 'prev-note',      icon: '←',  label: 'Previous Note',          category: 'View',                      run: () => this.cycleNote(-1) },
            { id: 'next-notebook',  icon: '⇥',  label: 'Next Notebook',          category: 'View',      kbd: '⌃⇧Tab',    run: () => this.cycleNotebook(1) },
            { id: 'prev-notebook',  icon: '⇤',  label: 'Previous Notebook',      category: 'View',                      run: () => this.cycleNotebook(-1) },
            { id: 'toggle-bright',  icon: '☀', label: 'Toggle Bright Editor Panel', category: 'View',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                cfg.theme.brightPanel = cfg.theme.brightPanel === false;
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },

            // ── Editor settings ────────────────────────────────
            { id: 'toggle-wrap',   icon: '↩',  label: 'Toggle Word Wrap',     category: 'Editor',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                cfg.editor.wordWrap = !cfg.editor.wordWrap;
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },
            { id: 'toggle-lnum',   icon: '#',  label: 'Toggle Line Numbers',   category: 'Editor',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                cfg.editor.lineNumbers = !(cfg.editor.lineNumbers !== false);
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },
            { id: 'toggle-rel-lnum', icon: '↕',  label: 'Toggle Relative Line Numbers', category: 'Editor',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                cfg.editor.relativeLineNumbers = !cfg.editor.relativeLineNumbers;
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },
            { id: 'toggle-spell',  icon: '🔤', label: 'Toggle Spell Check',   category: 'Editor',
              run: async () => {
                const cfg = JSON.parse(JSON.stringify(this.config));
                cfg.editor.spellCheck = !cfg.editor.spellCheck;
                await this.applyConfigLive(cfg);
                await window.electron.saveConfig(cfg);
              }
            },

            // ── Plugins ────────────────────────────────────────
            { id: 'open-terminal',  icon: '💻', label: 'Open Terminal',         category: 'Plugins',   kbd: '⌃`',       run: () => { if (window.nhTermToggle) window.nhTermToggle(); } },
            { id: 'open-search',    icon: '🔍', label: 'Advanced Search',       category: 'Plugins',   kbd: '⌘⇧F',      run: () => window.dispatchEvent(new CustomEvent('notehub:open-search')) },
            { id: 'open-excel',     icon: '📊', label: 'Open Spreadsheet',      category: 'Plugins',   kbd: '⌘⇧X',      run: () => { if (window.xlOpen) window.xlOpen(); } },
            { id: 'insert-image',   icon: '🖼',  label: 'Insert Image',          category: 'Plugins',                     run: () => this.insertImageFromFile() },
            { id: 'open-git',       icon: '🔀', label: 'Git Integration',       category: 'Plugins',   kbd: '⌘⇧G',      run: () => { if (window.gitOpen) window.gitOpen(); } },

            // ── Settings ───────────────────────────────────────
            { id: 'open-prefs',     icon: '⚙️',  label: 'Open Preferences',     category: 'Settings',  kbd: '⌘,',       run: () => window.electron.openPreferences && window.electron.openPreferences() },
            { id: 'help-plugins',   icon: '📖',  label: 'Plugin Guide',          category: 'Help',                        run: () => this.showHelpModal('plugins') },
            { id: 'help-shortcuts', icon: '⌨️',  label: 'Keyboard Shortcuts',   category: 'Help',                        run: () => this.showHelpModal('shortcuts') },
            { id: 'help-about',     icon: '📋',  label: 'About NoteHub',         category: 'Help',                        run: () => this.showHelpModal('about') },
        ];

        // Add registered plugin actions dynamically
        (this._pluginToolbarActions || []).forEach(a => {
            if (!cmds.find(c => c.id === a.id)) {
                cmds.push({ id: a.id, icon: a.icon || '🧩', label: a.label, category: 'Plugins', run: a.onClick });
            }
        });

        return cmds;
    }

    // One palette entry per note, for the quick switcher.
    //
    // Rebuilt on every open rather than cached: notes are created, renamed and
    // trashed constantly, and a stale list here means Enter opens the wrong
    // note or a note that no longer exists.
    //
    // Capped, because the palette renders every entry it is given into innerHTML
    // and a library of several thousand notes would build a very large string on
    // each keystroke. The cap is on the UNFILTERED list; typing narrows from the
    // full set, so a note past the cap is still reachable by name.
    _buildNotePaletteEntries(limit = 200) {
        const notes = sortPinnedFirst(filterActiveNotes(this.data.notes || []));
        return notes.slice(0, limit).map(note => {
            const notebook = (this.data.notebooks || []).find(nb => nb.id === note.notebookId);
            return {
                id: `note:${note.id}`,
                icon: note.pinned ? '\u2605' : '\u25CB',
                label: note.title || 'Untitled',
                // The notebook name is the category, so the palette groups notes
                // by where they live and the grouping headers stay meaningful.
                category: notebook ? notebook.name : 'Notes',
                run: () => this.selectNote(note.id),
            };
        });
    }

    toggleCommandPalette() {
        const existing = document.getElementById('cmdPalette');
        if (existing && existing.classList.contains('open')) {
            this.closeCommandPalette();
        } else {
            this.openCommandPalette();
        }
    }

    // `mode` selects what the palette is a list OF:
    //   'commands' (default) -- actions, with notes appended below them
    //   'notes'              -- the quick switcher, notes only
    //
    // One component rather than two, because a second overlay would duplicate
    // the filtering, keyboard handling, scroll-into-view and focus-restore
    // logic already solved here -- and would inevitably drift from it.
    openCommandPalette(mode = 'commands') {
        // Remove stale instance
        const old = document.getElementById('cmdPalette');
        if (old) old.remove();

        const noteCmds = this._buildNotePaletteEntries();
        const cmds = mode === 'notes'
            ? noteCmds
            : [...this._buildPaletteCommands(), ...noteCmds];
        let filtered = cmds;
        let selIdx   = 0;

        const renderList = (list) => {
            const ul = document.getElementById('cmdPaletteList');
            if (!ul) return;
            if (!list.length) {
                ul.innerHTML = '<div class="cmd-empty">No commands found</div>';
                return;
            }
            let lastCat = null;
            ul.innerHTML = list.map((c, i) => {
                let header = '';
                if (c.category !== lastCat) {
                    header = `<div class="cmd-cat">${c.category}</div>`;
                    lastCat = c.category;
                }
                return `${header}<div class="cmd-item ${i === selIdx ? 'sel' : ''}" data-idx="${i}"
                    onmouseenter="this.closest('#cmdPalette').__sel=${i};document.querySelectorAll('.cmd-item').forEach((el,j)=>el.classList.toggle('sel',j===${i}))"
                    onclick="app._runCmdPaletteItem(${i})">
                    <span class="cmd-icon">${c.icon}</span>
                    <span class="cmd-label">${c.label}</span>
                    ${c.kbd ? `<span class="cmd-kbd">${c.kbd}</span>` : ''}
                </div>`;
            }).join('');
            // Scroll selected item into view
            const selEl = ul.querySelector('.cmd-item.sel');
            if (selEl) selEl.scrollIntoView({ block: 'nearest' });
        };

        const pal = document.createElement('div');
        pal.id        = 'cmdPalette';
        pal.className = 'cmd-palette open';
        pal.__cmds    = cmds;
        pal.__sel     = 0;
        pal.innerHTML = `
            <div class="cmd-backdrop" onclick="app.closeCommandPalette()"></div>
            <div class="cmd-box">
                <div class="cmd-search-row">
                    <span class="cmd-search-icon">⌘</span>
                    <input class="cmd-input" id="cmdInput" placeholder="${mode === 'notes' ? 'Jump to note…' : 'Type a command or note title…'}" autocomplete="off" spellcheck="false">
                    <span class="cmd-hint">↑↓ navigate · Enter run · Esc close</span>
                </div>
                <div class="cmd-list" id="cmdPaletteList"></div>
            </div>`;
        document.body.appendChild(pal);

        // Store filtered list on element for key handlers
        pal.__filtered = filtered;

        renderList(filtered);

        const input = document.getElementById('cmdInput');
        if (input) {
            input.focus();
            input.addEventListener('input', () => {
                const q = input.value.toLowerCase().trim();
                filtered = q
                    ? cmds.filter(c => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
                    : cmds;
                selIdx = 0;
                pal.__filtered = filtered;
                pal.__sel      = 0;
                renderList(filtered);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selIdx = Math.min(selIdx + 1, filtered.length - 1);
                    pal.__sel = selIdx;
                    renderList(filtered);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selIdx = Math.max(selIdx - 1, 0);
                    pal.__sel = selIdx;
                    renderList(filtered);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this._runCmdPaletteItem(selIdx);
                } else if (e.key === 'Escape') {
                    this.closeCommandPalette();
                }
            });
        }
    }

    _runCmdPaletteItem(idx) {
        const pal = document.getElementById('cmdPalette');
        if (!pal) return;
        const list = pal.__filtered || pal.__cmds || [];
        const cmd  = list[idx || pal.__sel || 0];
        this.closeCommandPalette();
        if (cmd && cmd.run) {
            try { cmd.run(); } catch(e) { console.error('[Palette]', e); }
        }
    }

    closeCommandPalette() {
        const pal = document.getElementById('cmdPalette');
        if (pal) {
            pal.classList.remove('open');
            setTimeout(() => pal.remove(), 150);
        }
    }

    // ── Help Modal ──────────────────────────────────────────────────────────
    showHelpModal(section = 'plugins') {
        const sections = {
            plugins: {
                title: '🔌 Plugin Guide',
                body: `
<div class="help-content">
  <div class="help-tabs">
    <button class="help-tab active" onclick="switchHelpTab('math')">📐 Math</button>
    <button class="help-tab" onclick="switchHelpTab('terminal')">💻 Terminal</button>
    <button class="help-tab" onclick="switchHelpTab('search')">🔍 Search</button>
    <button class="help-tab" onclick="switchHelpTab('docx')">📄 DOCX</button>
    <button class="help-tab" onclick="switchHelpTab('excel')">📊 Excel</button>
  </div>
  <div id="help-math" class="help-section active">
    <h3>📐 Math Renderer</h3>
    <p>Renders LaTeX math equations using KaTeX directly in the preview pane.</p>
    <h4>How to use</h4>
    <p>Enable in Preferences → Plugins, then use the toolbar <strong>📐</strong> button or click <strong>🔌 Plugins → Math Renderer</strong>.</p>
    <h4>Syntax</h4>
    <table class="help-table"><tr><th>Type</th><th>Syntax</th><th>Example</th></tr>
    <tr><td>Inline math</td><td><code>$...$</code></td><td><code>$x^2 + y^2 = r^2$</code></td></tr>
    <tr><td>Block math</td><td><code>$$...$$</code></td><td><code>$$\int_0^\infty e^{-x}dx$$</code></td></tr>
    </table>
    <h4>Common operators</h4>
    <table class="help-table"><tr><th>LaTeX</th><th>Result</th></tr>
    <tr><td><code>x^{2}</code></td><td>Superscript</td></tr>
    <tr><td><code>x_{i}</code></td><td>Subscript</td></tr>
    <tr><td><code>\frac{a}{b}</code></td><td>Fraction</td></tr>
    <tr><td><code>\sqrt{x}</code></td><td>Square root</td></tr>
    <tr><td><code>\sum_{i=1}^{n}</code></td><td>Summation</td></tr>
    <tr><td><code>\alpha \beta \gamma</code></td><td>Greek letters</td></tr>
    </table>
  </div>
  <div id="help-terminal" class="help-section" style="display:none">
    <h3>💻 Terminal</h3>
    <p>An integrated command-line panel at the bottom of the editor for NoteHub commands.</p>
    <h4>How to open</h4>
    <p>Click <strong>🔌 Plugins → Terminal</strong> or press <kbd>Ctrl+\`</kbd> / <kbd>Cmd+\`</kbd></p>
    <h4>Available commands</h4>
    <table class="help-table"><tr><th>Command</th><th>Description</th></tr>
    <tr><td><code>help</code></td><td>List all commands</td></tr>
    <tr><td><code>notes</code></td><td>List all notes</td></tr>
    <tr><td><code>notebooks</code></td><td>List all notebooks</td></tr>
    <tr><td><code>search &lt;query&gt;</code></td><td>Search notes by text</td></tr>
    <tr><td><code>new &lt;title&gt;</code></td><td>Create a new note</td></tr>
    <tr><td><code>export</code></td><td>Export current note</td></tr>
    <tr><td><code>clear</code></td><td>Clear the terminal</td></tr>
    <tr><td><code>date</code></td><td>Show current date/time</td></tr>
    </table>
    <h4>Tips</h4>
    <p>Use ↑ / ↓ arrow keys to navigate command history.</p>
  </div>
  <div id="help-search" class="help-section" style="display:none">
    <h3>🔍 Advanced Search</h3>
    <p>Full-text search across all notes with filters and highlighted results.</p>
    <h4>How to open</h4>
    <p>Click <strong>🔌 Plugins → Advanced Search</strong> or press <kbd>Ctrl+Shift+F</kbd> / <kbd>Cmd+Shift+F</kbd></p>
    <h4>Filter options</h4>
    <table class="help-table"><tr><th>Filter</th><th>Description</th></tr>
    <tr><td>All Notes</td><td>Search across every notebook</td></tr>
    <tr><td>Current Notebook</td><td>Limit to the open notebook</td></tr>
    <tr><td>Title Only</td><td>Only match note titles</td></tr>
    </table>
    <h4>Tips</h4>
    <p>Click any result to open that note. Results show context around the match.</p>
  </div>
  <div id="help-docx" class="help-section" style="display:none">
    <h3>📄 DOCX Converter</h3>
    <p>Import Microsoft Word documents and convert them to Markdown automatically.</p>
    <h4>How to use</h4>
    <p>Click <strong>🔌 Plugins → DOCX Converter</strong> or the upload toolbar button, then select a .docx file.</p>
    <h4>What gets converted</h4>
    <table class="help-table"><tr><th>Word element</th><th>Markdown output</th></tr>
    <tr><td>Heading 1–6</td><td><code># H1</code> through <code>###### H6</code></td></tr>
    <tr><td>Bold text</td><td><code>**bold**</code></td></tr>
    <tr><td>Italic text</td><td><code>*italic*</code></td></tr>
    <tr><td>Bullet lists</td><td><code>- item</code></td></tr>
    <tr><td>Numbered lists</td><td><code>1. item</code></td></tr>
    <tr><td>Tables</td><td>Markdown table format</td></tr>
    <tr><td>Hyperlinks</td><td><code>[text](url)</code></td></tr>
    <tr><td>Code blocks</td><td>Fenced code blocks</td></tr>
    </table>
  </div>
  <div id="help-excel" class="help-section" style="display:none">
    <h3>📊 Excel Integration</h3>
    <p>Import Excel / CSV spreadsheets as Markdown tables, or create tables from scratch.</p>
    <h4>How to import</h4>
    <p>Click <strong>🔌 Plugins → Excel Integration</strong> or the toolbar button, then select an .xlsx, .xls, or .csv file.</p>
    <h4>Features</h4>
    <table class="help-table"><tr><th>Feature</th><th>Details</th></tr>
    <tr><td>Multi-sheet</td><td>Each sheet becomes an <code>## H2</code> section</td></tr>
    <tr><td>Preview</td><td>Preview table before inserting</td></tr>
    <tr><td>Table creator</td><td>Create blank table with custom rows/cols</td></tr>
    <tr><td>Auto-tags</td><td>Note is tagged with "excel" and "table"</td></tr>
    </table>
  </div>
</div>`
            },
            shortcuts: {
                title: '⌨️  Keyboard Shortcuts',
                body: `
<div class="help-content">
  <h3>Global</h3>
  <table class="help-table"><tr><th>Shortcut</th><th>Action</th></tr>
  <tr><td><kbd>Cmd/Ctrl + N</kbd></td><td>New note</td></tr>
  <tr><td><kbd>Cmd/Ctrl + Shift + N</kbd></td><td>New notebook</td></tr>
  <tr><td><kbd>Cmd/Ctrl + E</kbd></td><td>Export current note</td></tr>
  <tr><td><kbd>Cmd/Ctrl + ,</kbd></td><td>Open Preferences</td></tr>
  <tr><td><kbd>Cmd/Ctrl + R</kbd></td><td>Reload config</td></tr>
  </table>
  <h3>Editor View</h3>
  <table class="help-table"><tr><th>Shortcut</th><th>Action</th></tr>
  <tr><td><kbd>Cmd/Ctrl + 1</kbd></td><td>Edit mode</td></tr>
  <tr><td><kbd>Cmd/Ctrl + 2</kbd></td><td>Split mode</td></tr>
  <tr><td><kbd>Cmd/Ctrl + 3</kbd></td><td>Preview mode</td></tr>
  </table>
  <h3>Plugins</h3>
  <table class="help-table"><tr><th>Shortcut</th><th>Action</th></tr>
  <tr><td><kbd>Ctrl/Cmd + \`</kbd></td><td>Toggle Terminal</td></tr>
  <tr><td><kbd>Ctrl/Cmd + Shift + F</kbd></td><td>Advanced Search</td></tr>
  </table>
</div>`
            },
            theming: {
                title: '🎨 Theming Guide',
                body: `
<div class="help-content">
  <h3>Changing the theme</h3>
  <p>Go to <strong>Preferences → Appearance</strong> to set accent color, UI font, and editor font. Hit ⚡ Apply to see changes live.</p>
  <h3>Catppuccin accent colors</h3>
  <table class="help-table"><tr><th>Name</th><th>Hex</th></tr>
  <tr><td>Mauve (default)</td><td><code>#cba6f7</code></td></tr>
  <tr><td>Blue</td><td><code>#89b4fa</code></td></tr>
  <tr><td>Green</td><td><code>#a6e3a1</code></td></tr>
  <tr><td>Pink</td><td><code>#f5c2e7</code></td></tr>
  <tr><td>Peach</td><td><code>#fab387</code></td></tr>
  </table>
  <h3>Config file location</h3>
  <p><strong>macOS:</strong> <code>~/Library/Application Support/notehub/config.json</code><br>
  <strong>Linux:</strong> <code>~/.config/notehub/config.json</code><br>
  <strong>Windows:</strong> <code>%APPDATA%\notehub\config.json</code></p>
</div>`
            },
            devplugins: {
                title: '🔌 Plugin Development',
                body: `
<div class="help-content">
  <h3>Creating a plugin</h3>
  <p>Create a folder in <code>notehub/plugins/your-plugin-name/</code> with two files:</p>
  <h4>manifest.json</h4>
  <pre class="help-pre">{"name":"My Plugin","version":"1.0.0","description":"What it does","author":"You","main":"index.js"}</pre>
  <h4>index.js</h4>
  <pre class="help-pre">// 'app' is the NoteHubApp instance
console.log('[MyPlugin] Loading...');

// Add a toolbar button
app.registerPluginAction('my-plugin', 'My Plugin', '🧩', () => {
  app.showModal('My Plugin', '&lt;p&gt;Hello from my plugin!&lt;/p&gt;', [
    { label: 'OK', class: 'btn-primary', onClick: () => app.closeModal() }
  ]);
});

// Listen for custom events
window.addEventListener('notehub:my-plugin', () => { /* handle */ });

console.log('[MyPlugin] Ready!');</pre>
  <h3>Available app methods</h3>
  <table class="help-table"><tr><th>Method</th><th>Description</th></tr>
  <tr><td><code>app.showModal(title, html, buttons)</code></td><td>Show a modal dialog</td></tr>
  <tr><td><code>app.closeModal()</code></td><td>Close the modal</td></tr>
  <tr><td><code>app.createNewNote()</code></td><td>Create a new note</td></tr>
  <tr><td><code>app.currentNote</code></td><td>Currently open note object</td></tr>
  <tr><td><code>app.data.notes</code></td><td>All notes array</td></tr>
  <tr><td><code>app.data.notebooks</code></td><td>All notebooks array</td></tr>
  <tr><td><code>app.saveData()</code></td><td>Persist data to disk</td></tr>
  <tr><td><code>app.render()</code></td><td>Re-render the entire UI</td></tr>
  <tr><td><code>app.renderEditor()</code></td><td>Re-render editor only</td></tr>
  <tr><td><code>app.registerPluginAction(id,label,icon,fn)</code></td><td>Add toolbar button</td></tr>
  </table>
  <p>See <code>PLUGIN_DEVELOPMENT.md</code> for the full guide.</p>
</div>`
            },
            about: {
                title: '📋 About NoteHub',
                body: `
<div class="help-content" style="text-align:center;padding:20px 0">
  <div style="font-size:64px;margin-bottom:16px">📓</div>
  <h2 style="font-size:24px;margin-bottom:8px;background:linear-gradient(90deg,#cba6f7,#f5c2e7);-webkit-background-clip:text;-webkit-text-fill-color:transparent">NoteHub</h2>
  <p style="color:#bac2de;margin-bottom:24px">A hackable, plugin-powered Markdown note-taking app</p>
  <table class="help-table" style="text-align:left">
    <tr><td>Theme</td><td>Catppuccin Mocha</td></tr>
    <tr><td>Editor</td><td>CodeMirror 6 + Vim</td></tr>
    <tr><td>Platform</td><td>Electron (cross-platform)</td></tr>
    <tr><td>Storage</td><td>Local JSON (no cloud)</td></tr>
    <tr><td>Plugins</td><td>JS-based, hot-reloadable</td></tr>
  </table>
  <p style="margin-top:20px;color:#6c7086;font-size:12px">Open source • Hackable • Yours</p>
</div>`
            }
        };

        const s = sections[section] || sections.plugins;
        this.showModal(s.title, s.body, [
            { label: 'Close', class: 'btn-secondary', onClick: () => this.closeModal() }
        ]);

        // Select first tab if plugins section
        if (section === 'plugins') {
            setTimeout(() => {
                const firstTab = document.querySelector('.help-tab');
                if (firstTab) firstTab.click();
            }, 50);
        }
    }

    // Plugins can call this to register a named toolbar action
    registerPluginAction(id, label, icon, onClick) {
        if (!this._pluginToolbarActions) this._pluginToolbarActions = [];
        // Remove existing with same id
        this._pluginToolbarActions = this._pluginToolbarActions.filter(a => a.id !== id);
        this._pluginToolbarActions.push({ id, label, icon, onClick });
    }
    
    // Modal Management
    showModal(title, body, buttons = []) {
        const overlay     = document.getElementById('modalOverlay');
        const modalTitle  = document.getElementById('modalTitle');
        const modalBody   = document.getElementById('modalBody');
        const modalFooter = document.getElementById('modalFooter');

        // Store callbacks in a registry so arrow functions keep correct 'this'
        window.__modalCallbacks = {};

        modalTitle.textContent = title;
        modalBody.innerHTML    = body;

        modalFooter.innerHTML = buttons.map((btn, i) => {
            window.__modalCallbacks['cb_' + i] = btn.onClick;
            const cls = (btn.class || 'btn-secondary').startsWith('btn-')
                ? btn.class : 'btn-' + btn.class;
            return `<button class="${cls}"
                onclick="window.__modalCallbacks['cb_${i}'] && window.__modalCallbacks['cb_${i}']()"
                >${btn.label}</button>`;
        }).join('');

        overlay.classList.add('active');

        // Focus first input in modal body after render
        setTimeout(() => {
            const first = modalBody.querySelector('input[type=text], input[type=number], textarea');
            if (first) first.focus();
        }, 60);
    }
    
    closeModal() {
        const overlay = document.getElementById('modalOverlay');
        overlay.classList.remove('active');
    }

    // Non-blocking stand-ins for window.confirm()/alert(). Native synchronous dialogs
    // triggered from a context-menu click can desync Chromium's modifier-key state on
    // macOS (Cmd/Ctrl appears stuck for all subsequent typing) — route everything through
    // the in-page modal instead.
    confirmModal(message, onConfirm, { title = 'Confirm', danger = true } = {}) {
        this.showModal(title, `<p style="color:#cdd6f4">${escapeHtml(message)}</p>`, [
            { label: 'Cancel', class: 'btn-secondary', onClick: () => this.closeModal() },
            { label: 'Confirm', class: danger ? 'btn-danger' : 'btn-primary', onClick: () => { this.closeModal(); onConfirm(); } }
        ]);
    }

    alertModal(message, { title = 'Notice' } = {}) {
        this.showModal(title, `<p style="color:#cdd6f4">${escapeHtml(message)}</p>`, [
            { label: 'OK', class: 'btn-primary', onClick: () => this.closeModal() }
        ]);
    }

    showSettings() {
        this.showModal('Settings', `
            <div class="form-group">
                <label class="form-label">Accent Color</label>
                <input type="color" class="form-input" id="settingAccentColor" value="${this.config.theme.accentColor}">
            </div>
            <div class="form-group">
                <label class="form-label">Default View Mode</label>
                <select class="form-input" id="settingViewMode">
                    <option value="edit" ${this.config.editor.defaultView === 'edit' ? 'selected' : ''}>Edit</option>
                    <option value="split" ${this.config.editor.defaultView === 'split' ? 'selected' : ''}>Split</option>
                    <option value="preview" ${this.config.editor.defaultView === 'preview' ? 'selected' : ''}>Preview</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Auto-save Interval (ms)</label>
                <input type="number" class="form-input" id="settingAutoSave" value="${this.config.editor.autoSaveInterval}" min="1000" step="1000">
            </div>
            <p style="font-size: 12px; color: var(--text-muted); margin-top: 20px;">
                For advanced settings, edit the config file directly from the Preferences menu.
            </p>
        `, [
            { label: 'Cancel', class: 'secondary', onClick: () => this.closeModal() },
            { label: 'Save', class: 'primary', onClick: () => this.saveSettings() }
        ]);
    }
    
    async saveSettings() {
        const accentColor = document.getElementById('settingAccentColor').value;
        const viewMode = document.getElementById('settingViewMode').value;
        const autoSave = parseInt(document.getElementById('settingAutoSave').value);
        
        this.config.theme.accentColor = accentColor;
        this.config.editor.defaultView = viewMode;
        this.config.editor.autoSaveInterval = autoSave;
        
        await this.saveConfig();
        this.applyTheme();
        this.closeModal();
        
        // Restart auto-save with new interval
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.setupAutoSave();
        }
    }
    
    showConfigHelp() {
        this.showModal('Configuration Guide', `
            <div style="line-height: 1.8;">
                <p style="margin-bottom: 16px;">
                    NoteHub is fully hackable! You can customize the app by editing the <code>config.json</code> file.
                </p>
                <h3 style="margin-top: 20px; margin-bottom: 12px;">Location</h3>
                <p style="margin-bottom: 16px;">
                    Go to <strong>Preferences → Open Config File</strong> to access your configuration.
                </p>
                <h3 style="margin-top: 20px; margin-bottom: 12px;">What you can customize</h3>
                <ul style="margin-left: 20px; margin-bottom: 16px;">
                    <li>Theme colors and fonts</li>
                    <li>Editor behavior and defaults</li>
                    <li>Enable/disable plugins</li>
                    <li>UI preferences</li>
                </ul>
                <h3 style="margin-top: 20px; margin-bottom: 12px;">Creating Plugins</h3>
                <p style="margin-bottom: 16px;">
                    Create a folder in <code>plugins/</code> with a <code>manifest.json</code> and <code>index.js</code> file.
                    Then enable it in the config!
                </p>
            </div>
        `, [
            { label: 'Close', class: 'primary', onClick: () => this.closeModal() }
        ]);
    }
}

// Initialize app
const app = new NoteHubApp();

// Make app globally available for onclick handlers
window.app = app;


// Global for help tab switching (called from modal innerHTML)
function switchHelpTab(id) {
    document.querySelectorAll('.help-section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
    const section = document.getElementById('help-' + id);
    if (section) section.style.display = 'block';
    event.currentTarget.classList.add('active');
}
