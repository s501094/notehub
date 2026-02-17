// DOCX Converter Plugin - Import Word documents as Markdown
// Uses mammoth.js to convert .docx files to Markdown

console.log('DOCX Converter plugin loaded!');

// Load mammoth.js library
const mammothScript = document.createElement('script');
mammothScript.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js';
mammothScript.onload = () => {
    console.log('Mammoth.js loaded successfully');
};
document.head.appendChild(mammothScript);

// HTML to Markdown converter
function htmlToMarkdown(html) {
    // Create temporary element
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    let markdown = '';
    
    function processNode(node, indent = '') {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }
        
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }
        
        const tag = node.tagName.toLowerCase();
        let result = '';
        
        switch (tag) {
            case 'h1':
                result = '# ' + node.textContent + '\n\n';
                break;
            case 'h2':
                result = '## ' + node.textContent + '\n\n';
                break;
            case 'h3':
                result = '### ' + node.textContent + '\n\n';
                break;
            case 'h4':
                result = '#### ' + node.textContent + '\n\n';
                break;
            case 'h5':
                result = '##### ' + node.textContent + '\n\n';
                break;
            case 'h6':
                result = '###### ' + node.textContent + '\n\n';
                break;
            case 'p':
                result = processChildren(node) + '\n\n';
                break;
            case 'strong':
            case 'b':
                result = '**' + processChildren(node) + '**';
                break;
            case 'em':
            case 'i':
                result = '*' + processChildren(node) + '*';
                break;
            case 'code':
                result = '`' + node.textContent + '`';
                break;
            case 'pre':
                result = '```\n' + node.textContent + '\n```\n\n';
                break;
            case 'a':
                const href = node.getAttribute('href') || '';
                result = '[' + processChildren(node) + '](' + href + ')';
                break;
            case 'ul':
                node.childNodes.forEach(child => {
                    if (child.tagName && child.tagName.toLowerCase() === 'li') {
                        result += '- ' + processChildren(child) + '\n';
                    }
                });
                result += '\n';
                break;
            case 'ol':
                let index = 1;
                node.childNodes.forEach(child => {
                    if (child.tagName && child.tagName.toLowerCase() === 'li') {
                        result += index + '. ' + processChildren(child) + '\n';
                        index++;
                    }
                });
                result += '\n';
                break;
            case 'blockquote':
                const lines = processChildren(node).split('\n');
                result = lines.map(line => line ? '> ' + line : '').join('\n') + '\n\n';
                break;
            case 'hr':
                result = '---\n\n';
                break;
            case 'br':
                result = '  \n';
                break;
            case 'img':
                const src = node.getAttribute('src') || '';
                const alt = node.getAttribute('alt') || '';
                result = '![' + alt + '](' + src + ')';
                break;
            case 'table':
                result = convertTable(node) + '\n\n';
                break;
            default:
                result = processChildren(node);
        }
        
        return result;
    }
    
    function processChildren(node) {
        let result = '';
        node.childNodes.forEach(child => {
            result += processNode(child);
        });
        return result;
    }
    
    function convertTable(table) {
        let markdown = '';
        const rows = table.querySelectorAll('tr');
        
        rows.forEach((row, rowIndex) => {
            const cells = row.querySelectorAll('th, td');
            const cellContents = Array.from(cells).map(cell => cell.textContent.trim());
            
            markdown += '| ' + cellContents.join(' | ') + ' |\n';
            
            // Add header separator after first row
            if (rowIndex === 0) {
                markdown += '| ' + cellContents.map(() => '---').join(' | ') + ' |\n';
            }
        });
        
        return markdown;
    }
    
    return processNode(temp).trim();
}

async function convertDocxToMarkdown(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                
                if (typeof mammoth === 'undefined') {
                    reject(new Error('Mammoth.js not loaded yet'));
                    return;
                }
                
                // Convert DOCX to HTML
                const result = await mammoth.convertToHtml({ arrayBuffer });
                
                // Convert HTML to Markdown
                const markdown = htmlToMarkdown(result.value);
                
                resolve({
                    markdown,
                    messages: result.messages,
                    success: true
                });
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

function showDocxImporter() {
    app.showModal('Import Word Document', `
        <div style="padding: 20px; text-align: center;">
            <input type="file" id="docxFileInput" accept=".docx" style="display: none;" />
            <button class="btn-primary" onclick="document.getElementById('docxFileInput').click()">
                Choose DOCX File
            </button>
            <p style="margin-top: 16px; color: var(--ctp-subtext1); font-size: 13px;">
                Select a Word document (.docx) to import as Markdown
            </p>
            <div id="docxStatus" style="margin-top: 16px;"></div>
        </div>
    `, [
        { label: 'Cancel', class: 'secondary', onClick: () => app.closeModal() }
    ]);
    
    document.getElementById('docxFileInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const status = document.getElementById('docxStatus');
        status.innerHTML = '<p style="color: var(--ctp-blue);">Converting...</p>';
        
        try {
            const result = await convertDocxToMarkdown(file);
            
            // Create new note with converted content
            const notebookId = app.currentNotebook ? app.currentNotebook.id : app.data.notebooks[0].id;
            const fileName = file.name.replace('.docx', '');
            
            const note = {
                id: Date.now().toString(),
                title: fileName,
                content: result.markdown,
                notebookId,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                tags: ['imported']
            };
            
            app.data.notes.unshift(note);
            await app.saveData();
            app.currentNote = note;
            app.render();
            
            status.innerHTML = '<p style="color: var(--ctp-green);">✓ Successfully imported!</p>';
            
            setTimeout(() => {
                app.closeModal();
            }, 1500);
            
        } catch (error) {
            console.error('DOCX conversion error:', error);
            status.innerHTML = `<p style="color: var(--ctp-red);">Error: ${error.message}</p>`;
        }
    });
}

// Add menu item
const originalCreateNewNote = app.createNewNote.bind(app);
app.createNewNote = function() {
    // Show options modal
    app.showModal('Create Note', `
        <div style="display: flex; flex-direction: column; gap: 12px;">
            <button class="btn-primary" onclick="app.closeModal(); setTimeout(() => createBlankNote(), 100);">
                <svg width="16" height="16" viewBox="0 0 16 16" style="display: inline; margin-right: 8px;">
                    <path fill="currentColor" d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2"/>
                </svg>
                Blank Note
            </button>
            <button class="btn-secondary" onclick="app.closeModal(); setTimeout(() => showDocxImporter(), 100);">
                <svg width="16" height="16" viewBox="0 0 16 16" style="display: inline; margin-right: 8px;">
                    <path fill="currentColor" d="M5 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7.5L8.5 3H5z"/>
                </svg>
                Import Word Document
            </button>
        </div>
    `, [
        { label: 'Cancel', class: 'secondary', onClick: () => app.closeModal() }
    ]);
};

window.createBlankNote = function() {
    originalCreateNewNote();
};

window.showDocxImporter = showDocxImporter;

// Add import button to toolbar
const originalRenderEditor = app.renderEditor.bind(app);
app.renderEditor = function() {
    originalRenderEditor();
    
    const toolbar = document.querySelector('.editor-toolbar-actions');
    if (toolbar && app.currentNote && !document.getElementById('docxImportBtn')) {
        const btn = document.createElement('button');
        btn.id = 'docxImportBtn';
        btn.className = 'btn-icon';
        btn.title = 'Import DOCX';
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16">
                <path fill="currentColor" d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path fill="currentColor" d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/>
            </svg>
        `;
        btn.onclick = () => showDocxImporter();
        toolbar.insertBefore(btn, toolbar.firstChild);
    }
};

console.log('DOCX Converter ready! Use "Import Word Document" when creating a note.');
