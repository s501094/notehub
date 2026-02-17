// Math Renderer Plugin - LaTeX/KaTeX support for NoteHub
// Renders inline math ($...$) and block math ($$...$$) using KaTeX

console.log('Math Renderer plugin loaded!');

// Inject KaTeX CSS
const katexCSS = document.createElement('link');
katexCSS.rel = 'stylesheet';
katexCSS.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
document.head.appendChild(katexCSS);

// Load KaTeX library
const katexScript = document.createElement('script');
katexScript.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
katexScript.onload = () => {
    console.log('KaTeX loaded successfully');
};
document.head.appendChild(katexScript);

// Override the markdown parser to handle math
const originalParseMarkdown = window.parseMarkdown;

window.parseMarkdown = function(text) {
    if (!text) return '';
    
    // Store math blocks temporarily to avoid markdown processing
    const mathBlocks = [];
    const mathInlines = [];
    
    // Extract block math ($$...$$)
    text = text.replace(/\$\$([^\$]+)\$\$/g, (match, math) => {
        mathBlocks.push(math.trim());
        return `__MATH_BLOCK_${mathBlocks.length - 1}__`;
    });
    
    // Extract inline math ($...$)
    text = text.replace(/\$([^\$\n]+)\$/g, (match, math) => {
        mathInlines.push(math.trim());
        return `__MATH_INLINE_${mathInlines.length - 1}__`;
    });
    
    // Process markdown normally
    let html = originalParseMarkdown(text);
    
    // Restore and render math blocks
    html = html.replace(/__MATH_BLOCK_(\d+)__/g, (match, index) => {
        const math = mathBlocks[parseInt(index)];
        try {
            if (typeof katex !== 'undefined') {
                return `<div class="math-block">${katex.renderToString(math, {
                    displayMode: true,
                    throwOnError: false
                })}</div>`;
            }
        } catch (e) {
            console.error('KaTeX error:', e);
        }
        return `<div class="math-block-error">$$${math}$$</div>`;
    });
    
    // Restore and render inline math
    html = html.replace(/__MATH_INLINE_(\d+)__/g, (match, index) => {
        const math = mathInlines[parseInt(index)];
        try {
            if (typeof katex !== 'undefined') {
                return `<span class="math-inline">${katex.renderToString(math, {
                    displayMode: false,
                    throwOnError: false
                })}</span>`;
            }
        } catch (e) {
            console.error('KaTeX error:', e);
        }
        return `<span class="math-inline-error">$${math}$</span>`;
    });
    
    return html;
};

// Add custom CSS for math rendering
const mathStyles = document.createElement('style');
mathStyles.textContent = `
    .math-block {
        margin: 20px 0;
        padding: 16px;
        background: var(--ctp-surface0);
        border-radius: 8px;
        overflow-x: auto;
        text-align: center;
    }
    
    .math-inline {
        padding: 2px 4px;
        background: var(--ctp-surface0);
        border-radius: 4px;
    }
    
    .math-block-error,
    .math-inline-error {
        color: var(--ctp-red);
        font-family: var(--font-mono);
    }
    
    /* KaTeX color overrides for Catppuccin */
    .katex {
        color: var(--ctp-text);
    }
    
    .katex .base {
        color: var(--ctp-text);
    }
`;
document.head.appendChild(mathStyles);

// Add help button to toolbar
const originalRenderEditor = app.renderEditor.bind(app);
app.renderEditor = function() {
    originalRenderEditor();
    
    const toolbar = document.querySelector('.editor-toolbar-actions');
    if (toolbar && app.currentNote && !document.getElementById('mathHelpBtn')) {
        const btn = document.createElement('button');
        btn.id = 'mathHelpBtn';
        btn.className = 'btn-icon';
        btn.title = 'Math Help';
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16">
                <path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path fill="currentColor" d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
            </svg>
        `;
        btn.onclick = () => showMathHelp();
        toolbar.insertBefore(btn, toolbar.firstChild);
    }
};

function showMathHelp() {
    app.showModal('Math Help', `
        <div style="line-height: 1.8;">
            <h3 style="margin-bottom: 12px;">LaTeX Math Syntax</h3>
            
            <h4 style="margin-top: 16px; margin-bottom: 8px;">Inline Math</h4>
            <p>Use single dollar signs: <code>$E = mc^2$</code></p>
            <p>Result: <span style="font-style: italic;">E = mc²</span></p>
            
            <h4 style="margin-top: 16px; margin-bottom: 8px;">Block Math</h4>
            <p>Use double dollar signs:</p>
            <pre style="background: var(--ctp-surface0); padding: 12px; border-radius: 6px; margin: 8px 0;">$$
\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$</pre>
            
            <h4 style="margin-top: 16px; margin-bottom: 8px;">Common Symbols</h4>
            <ul style="margin-left: 20px; margin-top: 8px;">
                <li><code>\\frac{a}{b}</code> - Fraction</li>
                <li><code>\\sqrt{x}</code> - Square root</li>
                <li><code>x^2</code> - Superscript</li>
                <li><code>x_i</code> - Subscript</li>
                <li><code>\\sum_{i=1}^{n}</code> - Summation</li>
                <li><code>\\int_{a}^{b}</code> - Integral</li>
                <li><code>\\alpha, \\beta, \\gamma</code> - Greek letters</li>
                <li><code>\\infty</code> - Infinity</li>
            </ul>
            
            <h4 style="margin-top: 16px; margin-bottom: 8px;">Example</h4>
            <pre style="background: var(--ctp-surface0); padding: 12px; border-radius: 6px; margin: 8px 0;">The quadratic formula is:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

Where $a$, $b$, and $c$ are coefficients.</pre>
            
            <p style="margin-top: 16px;">
                <a href="https://katex.org/docs/supported.html" target="_blank" style="color: var(--ctp-sapphire);">
                    View full KaTeX documentation →
                </a>
            </p>
        </div>
    `, [
        { label: 'Close', class: 'primary', onClick: () => app.closeModal() }
    ]);
}

// Expose plugin API
window.mathRenderer = {
    version: '1.0.0',
    renderMath: (text) => {
        if (typeof katex !== 'undefined') {
            return katex.renderToString(text, { throwOnError: false });
        }
        return text;
    }
};
