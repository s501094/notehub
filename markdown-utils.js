// Markdown -> HTML for the preview pane.
//
// This is a purpose-built parser, not `marked`. It exists as its own module so
// it can be unit tested directly (see tests/markdown.test.js) rather than only
// through the renderer, which needs a DOM and an Electron bridge to load.
//
// ORDER IS THE WHOLE DESIGN. Each numbered step below assumes the ones before
// it have already run, and several are only correct in their current position:
//
//   1  fenced code is lifted out to placeholders FIRST, so nothing inside a
//      fence is ever interpreted as markdown
//   2  inline code likewise, before escaping
//   3  HTML escaping, after code extraction so code keeps its literal angle
//      brackets, and before anything that emits tags of its own
//   6b setext headings BEFORE horizontal rules, or a `---` underline is eaten
//      as an <hr> and its title is orphaned
//   9  images before links, since `![x](y)` also matches the link pattern
//   10b autolinks after explicit links, so a URL already inside an <a> is not
//      wrapped a second time
//   11 lists after inline formatting, because list bodies contain it
//   14 code placeholders are restored LAST, inline before block
//
// Moving a step is very unlikely to be safe. Add tests before you try.

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Plain-text snippet for a note-list card.
//
// Constructs are removed whole, in an order that stops one pass producing
// syntax the next would mangle: embeds first (before their bracket syntax is
// touched), then links reduced to their text, then markers. A previous version
// stripped bare `#*`[]` characters, which left image embeds intact -- a note
// opening with a screenshot showed its card preview as the literal filename.
function snippetFromMarkdown(content, limit = 150) {
    let t = String(content || '');
    t = t.replace(/^---[\s\S]*?^---\s*/m, '');       // YAML front matter
    t = t.replace(/```[\s\S]*?```/g, ' ');            // fenced code
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');      // image embeds
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');   // links -> link text
    t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');        // heading markers
    t = t.replace(/^\s{0,3}>\s?/gm, '');             // quote markers
    t = t.replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s*)?/gm, ''); // list + task markers
    t = t.replace(/[*_~`]/g, '');                    // inline emphasis marks
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > limit ? t.slice(0, limit).trimEnd() + '\u2026' : t;
}

// Value validators for the inline-HTML allowlist in parseMarkdown().
// Deliberately narrow: a value that doesn't match here leaves the whole tag
// escaped rather than being sanitized into something almost-right. `url(...)`
// and `expression(...)` can't survive these patterns, which is the point.
const CSS_NAMED_COLORS_RE = /^[a-z]{3,20}$/;   // red, rebeccapurple, transparent…

function isSafeColor(v) {
    const s = String(v).trim();
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
    if (/^rgba?\(\s*[\d.%\s,\/]+\)$/i.test(s)) return true;
    if (/^hsla?\(\s*[\d.%\sdegra,\/]+\)$/i.test(s)) return true;
    if (/^var\(\s*--[a-z0-9-]{1,40}\s*\)$/i.test(s)) return true;
    return CSS_NAMED_COLORS_RE.test(s);
}

function isSafeLength(v) {
    const m = String(v).trim().match(/^(\d{1,4}(?:\.\d{1,3})?)(px|pt|em|rem|%)$/i);
    if (!m) return /^(x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i.test(String(v).trim());
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    // Keep a stray "font-size:9000px" from blowing up the preview layout.
    const max = { px: 200, pt: 150, em: 12, rem: 12, '%': 800 }[unit];
    return n > 0 && n <= max;
}

function parseMarkdown(text) {
    if (!text) return '';

    // 1. Extract and protect fenced code blocks FIRST (before any escaping)
    const codeBlocks = [];
    text = text.replace(/```([\w-]*)[ \t]*\r?\n([\s\S]*?)```/g, (_, lang, code) => {
        const i   = codeBlocks.length;
        const esc = code.trimEnd()
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        // Add line numbers to code block
        const lines = esc.split('\n');
        const numbered = lines.map((l, n) =>
            `<span class="code-line"><span class="code-ln">${n+1}</span>${l}</span>`
        ).join('\n');
        codeBlocks.push(
            `<pre class="md-pre" data-lang="${lang||''}">`+
            `<div class="code-lang-badge">${lang||'text'}</div>`+
            `<code class="language-${lang||''}">${numbered}</code></pre>`
        );
        // Padded back to the line count of the block it replaced.
        //
        // Every downstream pass that records a source line number (headings,
        // quotes, lists, paragraphs -- see the anchors in step 12b) counts
        // lines to know where it is. Collapsing a 30-line fence to a one-line
        // token would shift every anchor after it by 29 lines, which is
        // precisely the drift the anchors exist to eliminate. The padding is
        // stripped again when placeholders are restored in step 14.
        const consumed = (_.match(/\n/g) || []).length;
        return `\x00CODE${i}\x00` + '\n'.repeat(consumed);
    });

    // 2. Protect inline code (backtick)
    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
        const i = inlineCodes.length;
        inlineCodes.push(`<code class="md-code">${code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>`);
        return `\x00INLINE${i}\x00`;
    });

    // 3. Escape HTML in the rest of the text
    text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // 3b. Re-admit a narrow allowlist of inline HTML.
    //
    // Markdown has no syntax for colour or text size, so the Format menu
    // writes the portable thing -- <span style="color:#f38ba8">, <mark> --
    // which GitHub, Obsidian and VS Code's preview all render too. Step 3
    // above has already escaped every angle bracket in the document; this
    // pass finds the escaped form of an allowed tag and puts a *rebuilt*
    // tag back. Nothing from the note is ever passed through verbatim: the
    // tag name comes from the table below and each style declaration is
    // re-emitted from a matched property/value pair, so an attribute that
    // doesn't validate (or any tag not listed) simply stays escaped and
    // shows up literally, which is the right feedback for a typo.
    //
    // Allowed tags are stashed as placeholders rather than inlined so the
    // rules below can't chew on a style attribute -- same trick as the code
    // blocks above.
    const htmlBits = [];
    const stash = (html) => {
        const i = htmlBits.length;
        htmlBits.push(html);
        return `\x00HTML${i}\x00`;
    };
    const VOID_INLINE_TAGS = ['br', 'wbr'];
    const PAIRED_INLINE_TAGS = ['span', 'mark', 'u', 'sub', 'sup', 'kbd', 'small'];
    const ALL_INLINE_TAGS = [...PAIRED_INLINE_TAGS, ...VOID_INLINE_TAGS];

    // Only `style` is honoured as an attribute, and only these properties.
    const STYLE_RULES = {
        'color':            isSafeColor,
        'background-color': isSafeColor,
        'background':       isSafeColor,
        'font-size':        isSafeLength,
        'font-weight':      v => /^(normal|bold|lighter|bolder|[1-9]00)$/i.test(v),
        'font-style':       v => /^(normal|italic|oblique)$/i.test(v),
        'text-decoration':  v => /^(none|underline|line-through|overline)$/i.test(v),
    };

    // Rebuild an opening tag from validated parts, or return null to leave
    // the original escaped.
    const acceptOpenTag = (tag, rawAttrs) => {
        const attrs = (rawAttrs || '').trim();
        if (!attrs) return `<${tag}>`;

        // Exactly one attribute, a quoted style="...", is accepted.
        const styleMatch = attrs.match(/^style\s*=\s*(?:"([^"]*)"|'([^']*)')$/i);
        if (!styleMatch) return null;

        const safe = [];
        for (const decl of (styleMatch[1] ?? styleMatch[2]).split(';')) {
            if (!decl.trim()) continue;
            const sep = decl.indexOf(':');
            if (sep === -1) return null;
            const prop = decl.slice(0, sep).trim().toLowerCase();
            const val  = decl.slice(sep + 1).trim();
            const check = STYLE_RULES[prop];
            if (!check || !check(val)) return null;
            safe.push(`${prop}:${val}`);
        }
        return safe.length ? `<${tag} style="${safe.join(';')}">` : `<${tag}>`;
    };

    // One pass over the escaped text, tracking which tags are actually open.
    // A closing tag is admitted only when it matches an opening tag that was
    // admitted -- otherwise rejecting `<span onclick=…>` would still emit its
    // `</span>`, leaving an orphan close tag in the preview.
    const TAG_RE = new RegExp(
        `&lt;(/?)(${ALL_INLINE_TAGS.join('|')})((?:\\s+[^&]*?)?)\\s*(/?)&gt;`, 'gi'
    );
    const openStack = [];
    text = text.replace(TAG_RE, (whole, slash, rawTag, rawAttrs, selfClose) => {
        const tag = rawTag.toLowerCase();

        if (slash) {
            const at = openStack.lastIndexOf(tag);
            if (at === -1) return whole;          // never opened -- show literally
            openStack.splice(at, 1);
            return stash(`</${tag}>`);
        }
        if (VOID_INLINE_TAGS.includes(tag)) return stash(`<${tag}>`);

        const open = acceptOpenTag(tag, rawAttrs);
        if (open === null) return whole;
        if (!selfClose) openStack.push(tag);
        return stash(selfClose ? `${open}</${tag}>` : open);
    });


    // 4. Headers
    text = text.replace(/^######[ \t](.*)$/gm, '<h6>$1</h6>');
    text = text.replace(/^#####[ \t](.*)$/gm,  '<h5>$1</h5>');
    text = text.replace(/^####[ \t](.*)$/gm,   '<h4>$1</h4>');
    text = text.replace(/^###[ \t](.*)$/gm,    '<h3>$1</h3>');
    text = text.replace(/^##[ \t](.*)$/gm,     '<h2>$1</h2>');
    text = text.replace(/^#[ \t](.*)$/gm,      '<h1>$1</h1>');

    // 5. Tables
    text = text.replace(/((?:^\|.+\|[ \t]*\r?\n)+)/gm, (block) => {
        const rawLines = block.trim().split('\n').filter(l => l.trim());
        if (rawLines.length < 2) return block;
        const isSep = l => /^[\|\s\-:]+$/.test(l.trim());
        const sepIdx = rawLines.findIndex(isSep);
        if (sepIdx < 1) return block;
        const parseRow = l =>
            l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c => c.trim());
        const headers = parseRow(rawLines[0]);
        const aligns  = parseRow(rawLines[sepIdx]).map(c =>
            /^:-+:$/.test(c) ? 'center' : /:-+$/.test(c) ? 'right' : 'left');
        const rows = rawLines.slice(sepIdx + 1).map(parseRow);
        let t = '<table class="md-table"><thead><tr>';
        headers.forEach((h,i) => t += `<th style="text-align:${aligns[i]||'left'}">${h}</th>`);
        t += '</tr></thead><tbody>';
        rows.forEach(row => {
            t += '<tr>';
            row.forEach((c,i) => t += `<td style="text-align:${aligns[i]||'left'}">${c}</td>`);
            t += '</tr>';
        });
        // Same line-count padding as fenced code, for the same reason: a table
        // collapses many source lines into one element, and anchors after it
        // would otherwise all point too early.
        //
        // Counted from the matched text rather than from rawLines.length: this
        // pattern captures each row's trailing newline as well, so the block
        // spans one more line terminator than it has rows.
        const consumed = (block.match(/\n/g) || []).length;
        return t + '</tbody></table>' + '\n'.repeat(consumed);
    });

    // 6. Blockquotes
    //
    // Consecutive `>` lines form ONE blockquote. The per-line replace this
    // used to do emitted a separate <blockquote> element per line, so a
    // three-line quote rendered as three stacked boxes each with its own
    // border and margin.
    //
    // Nesting is by marker depth: `>>` opens a quote inside a quote. A blank
    // line, or any non-quote line, closes everything currently open.
    {
        const QUOTE_RE = /^((?:&gt;[ \t]?)+)(.*)$/;
        const qLines = text.split('\n');
        const qOut = [];
        let depth = 0;
        const closeTo = (target) => { while (depth > target) { qOut.push('</blockquote>'); depth--; } };

        for (const line of qLines) {
            const m = QUOTE_RE.exec(line);
            if (!m) { closeTo(0); qOut.push(line); continue; }
            // Each `&gt;` (optionally followed by one space) is one level.
            const want = (m[1].match(/&gt;/g) || []).length;
            closeTo(want);
            while (depth < want) { qOut.push('<blockquote>'); depth++; }
            qOut.push(m[2]);
        }
        closeTo(0);
        text = qOut.join('\n');
    }

    // 6b. Setext headings (`Title` underlined with === or ---).
    //
    // Must run BEFORE horizontal rules, or the `---` underline is consumed as
    // an <hr> and the title above it is left as a bare paragraph. The lookahead
    // requires a non-blank, non-marker line above the underline so a standalone
    // `---` between paragraphs is still a rule.
    text = text.replace(/^(?!\s*$)(?![#>\-*+\d])([^\n]+)\n[ \t]*=+[ \t]*$/gm, '<h1>$1</h1>');
    text = text.replace(/^(?!\s*$)(?![#>\-*+\d])([^\n]+)\n[ \t]*-{2,}[ \t]*$/gm, '<h2>$1</h2>');

    // 7. Horizontal rules
    text = text.replace(/^[ \t]*(---+|\*\*\*+|___+)[ \t]*$/gm, '<hr>');

    // 8. Inline formatting
    // Emphasis delimiters must not sit *inside* a word. Without that guard
    // `USE1PRES1012_OsDisk_1_8d58` becomes `USE1PRES1012<em>OsDisk</em>1_8d58`,
    // which mangles every hostname, snake_case identifier and file path in a
    // note. CommonMark's real rule is left/right-flanking runs; the practical
    // subset here is: the opening delimiter may not be preceded by a word
    // character, and the closing one may not be followed by one.
    //
    // `(^|[^\w*])` / `(^|[^\w_])` capture that preceding character so it can
    // be put back in the replacement -- a lookbehind would be cleaner but is
    // avoided for consistency with the rest of this parser.
    text = text.replace(/(^|[^\w*])\*\*\*([^*\n]+?)\*\*\*(?!\w)/g, '$1<strong><em>$2</em></strong>');
    text = text.replace(/(^|[^\w*])\*\*([^*\n]+?)\*\*(?!\w)/g,      '$1<strong>$2</strong>');
    text = text.replace(/(^|[^\w_])___([^_\n]+?)___(?!\w)/g,          '$1<strong><em>$2</em></strong>');
    text = text.replace(/(^|[^\w_])__([^_\n]+?)__(?!\w)/g,            '$1<strong>$2</strong>');
    text = text.replace(/(^|[^\w*])\*([^*\n]+?)\*(?!\w)/g,           '$1<em>$2</em>');
    text = text.replace(/(^|[^\w_])_([^_\n]+?)_(?!\w)/g,              '$1<em>$2</em>');
    text = text.replace(/~~([^~\n]+?)~~/g,                            '<del>$1</del>');

    // 9. Images (before links)
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        '<img src="$2" alt="$1" class="md-img">');

    // 10. Links
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 10b. Autolinks.
    //
    // `<https://x>` first: the angle brackets were HTML-escaped in step 3, so
    // by now it reads as `&lt;https://x&gt;` and never matched anything.
    text = text.replace(/&lt;((?:https?|mailto):[^\s&<>]+)&gt;/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // Then bare URLs. The negative lookbehind keeps this from re-linking a URL
    // that is already inside an href or the text of a link produced above --
    // without it, `[docs](https://x)` gets a second <a> nested in its label.
    // Trailing punctuation is excluded from the match so a URL ending a
    // sentence does not swallow the full stop.
    text = text.replace(
        /(^|[\s(])((?:https?:\/\/|www\.)[^\s<>"')\]]*[^\s<>"')\].,;:!?])/g,
        (whole, lead, url) => {
            const href = url.startsWith('www.') ? `https://${url}` : url;
            return `${lead}<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });

    // 11 + 12. Lists (task, unordered and ordered) -- one indentation-aware
    // pass instead of the previous flat regexes.
    //
    // Why a line walk rather than more .replace() calls: the old version
    // stripped `^[ \t]*` from every marker, so nesting was thrown away before
    // anything could act on it, and it grouped <li> runs with a lazy
    // `[\s\S]*?` that could staple together ordered items separated by whole
    // paragraphs. Depth has to be tracked across lines, which regex-per-line
    // fundamentally cannot do.
    //
    // Task-index contract (do not change casually): `data-task-index` is the
    // ordinal of the checkbox in *document order*, and toggleTaskAtIndex()
    // walks the source counting `- [ ]` lines to find the matching line. Both
    // sides must skip fenced code identically. That holds here because fenced
    // blocks were already lifted out to \x00CODE placeholders in step 1, and
    // because this loop runs top to bottom so the counter cannot desync.
    const LIST_RE = /^([ \t]*)(?:([-*+])|(\d+)[.)])[ \t]+(.*)$/;
    const TASK_RE = /^\[([ xX])\](?:[ \t]+(.*))?$/;
    // Tabs count as 4 columns so tab- and space-indented notes nest alike.
    const indentWidth = (ws) => ws.replace(/\t/g, '    ').length;

    let taskIndex = 0;
    {
        const src   = text.split('\n');
        const out   = [];
        const stack = [];        // open lists, outermost first: {tag, indent, itemOpen}
        let   pendingBlanks = [];

        // Closing an item is separate from closing its list: a nested list
        // lives *inside* its parent <li>, so popping the child must leave the
        // parent item open for its next sibling.
        // Tags are accumulated into `line`, the output for the CURRENT source
        // line, rather than pushed as separate array entries.
        //
        // This keeps the pass line-count-preserving: one input line produces
        // exactly one output line. That is what lets step 12b stamp accurate
        // source line numbers on everything after a list -- an expanding pass
        // here would shift every later anchor by however many tags it emitted.
        let line = '';
        const emit = (html) => { line += html; };

        const closeItem = (entry) => {
            if (entry && entry.itemOpen) { emit('</li>'); entry.itemOpen = false; }
        };
        const popList = () => {
            const entry = stack.pop();
            closeItem(entry);
            emit(`</${entry.tag}>`);
        };
        const closeAll = () => { while (stack.length) popList(); };

        for (let i = 0; i < src.length; i++) {
            const m = LIST_RE.exec(src[i]);

            if (!m) {
                // A blank line inside a list is held back rather than acted on:
                // if the next line resumes the list it is a loose-list spacer
                // and the list continues; if not, it terminates the list. This
                // is what keeps a note's `- a\n\n- b` reading as one list.
                //
                // Held-back blanks are still emitted (as empty lines) when the
                // list ends, so the line count is preserved either way.
                if (!src[i].trim() && stack.length) { pendingBlanks.push(''); continue; }
                line = '';
                closeAll();
                // Any close tags land on the first pending blank line rather
                // than being prepended to this one, so counts stay exact.
                if (pendingBlanks.length) {
                    out.push(line + pendingBlanks[0]);
                    for (let k = 1; k < pendingBlanks.length; k++) out.push('');
                    out.push(src[i]);
                } else {
                    out.push(line + src[i]);
                }
                line = '';
                pendingBlanks = [];
                continue;
            }

            // The list resumed, so the spacers were loose-list separators. They
            // are still emitted as blank lines to hold the line count.
            for (const blank of pendingBlanks) out.push(blank);
            pendingBlanks = [];
            const indent = indentWidth(m[1]);
            const tag    = m[2] ? 'ul' : 'ol';
            const body   = m[4];

            // Unwind any list indented deeper than this marker.
            while (stack.length && indent < stack[stack.length - 1].indent) popList();

            const top = stack[stack.length - 1];
            if (!top || indent > top.indent) {
                // Deeper than the current list (or the first list): open a new
                // one. The parent's <li> stays open so the nested list is a
                // child of it, which is what browsers indent correctly.
                const attr = tag === 'ol' && m[3] && m[3] !== '1' ? ` start="${m[3]}"` : '';
                emit(`<${tag}${attr}>`);
                stack.push({ tag, indent, itemOpen: false });
            } else if (top.tag !== tag) {
                // Same depth, different kind (`- a` then `1. b`): the current
                // list ends and a sibling list of the other kind begins.
                popList();
                const attr = tag === 'ol' && m[3] && m[3] !== '1' ? ` start="${m[3]}"` : '';
                emit(`<${tag}${attr}>`);
                stack.push({ tag, indent, itemOpen: false });
            } else {
                closeItem(top);                 // plain sibling
            }

            const entry = stack[stack.length - 1];
            // `- [x]`, `* [ ]`, `+ [x]` and `1. [ ]` all count as tasks -- the
            // old parser accepted only `- [ ]`, so notes that mix bullet
            // characters silently lost half their checkboxes.
            const t = TASK_RE.exec(body);
            if (t) {
                const done = t[1].toLowerCase() === 'x';
                emit(
                    `<li class="task ${done ? 'done' : 'open'}">` +
                    `<input type="checkbox" class="task-cb" data-task-index="${taskIndex++}"` +
                    `${done ? ' checked' : ''}><span class="task-label">${t[2] || ''}</span>`
                );
            } else {
                emit(`<li>${body}`);
            }
            entry.itemOpen = true;
            out.push(line);
            line = '';
        }

        line = '';
        closeAll();
        // Trailing closes ride on the last emitted line rather than adding one.
        if (line) out[out.length - 1] = (out[out.length - 1] || '') + line;
        for (const blank of pendingBlanks) out.push(blank);
        text = out.join('\n');
    }

    // 12b. Source-line anchors.
    //
    // Stamps each block-level element with the source line it came from, so
    // split-view scroll sync can map editor position to preview position
    // exactly instead of by proportion. Proportional mapping is correct only at
    // the very top and bottom; anywhere a tall element (an image, a code block,
    // a table) sits on one side and not the other, the two panes drift.
    //
    // Line numbers are recovered by counting newlines, which works because
    // every pass up to here is either line-preserving or emits its output on
    // the same line it consumed. The code placeholders inserted in step 1 are
    // single-line tokens and are not restored until step 14, so they contribute
    // exactly one line each here -- which is what keeps the count honest.
    {
        const anchorLines = text.split('\n');
        let sourceLine = 0;
        text = anchorLines.map((line) => {
            const m = /^(<(?:h[1-6]|p|ul|ol|li|blockquote|table|pre|hr)\b)/i.exec(line);
            const stamped = m
                ? line.replace(m[1], `${m[1]} data-src-line="${sourceLine}"`)
                : line;
            sourceLine++;
            return stamped;
        }).join('\n');
    }

    // 13. Paragraph wrapping (line-by-line state machine)
    // Closing tags matter as much as opening ones here: the list builder emits
    // `</li>`, `</ul>` and `</ol>` on their own lines, and without `</` in this
    // alternation they would be buffered as prose and wrapped in <p>.
    const BLOCK_RE = /^(<\/|<h[1-6][\s>]|<ul|<ol|<li|<pre|<blockquote|<hr|<table|<tbody|<thead|<tr|<div|\x00CODE)/i;
    const lines = text.split('\n');
    const out   = [];
    let   buf   = [];
    const flush = () => { if (buf.length) { out.push('<p>' + buf.join(' ') + '</p>'); buf = []; } };
    for (const line of lines) {
        const t = line.trim();
        if (!t)              { flush(); }
        else if (BLOCK_RE.test(t)) { flush(); out.push(line); }
        else                 { buf.push(line); }
    }
    flush();
    text = out.join('\n');

    // 14. Restore allowlisted inline HTML, then inline codes, then block codes
    htmlBits.forEach((v, i) => { text = text.split(`\x00HTML${i}\x00`).join(v); });
    inlineCodes.forEach((v, i) => { text = text.split(`\x00INLINE${i}\x00`).join(v); });
    // Consumes the blank-line padding added in step 1 along with the token, so
    // the restored block does not leave a run of empty lines behind it.
    codeBlocks.forEach((v, i) => {
        text = text.replace(new RegExp(`\\x00CODE${i}\\x00(?:\\n[ \\t]*)*`), v);
    });

    return text;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseMarkdown, escapeHtml, snippetFromMarkdown, isSafeColor, isSafeLength };
}
