// Advanced Search Plugin - Enhanced search functionality
// Search across all notebooks with filters and highlighting

console.log('Advanced Search plugin loaded!');

let searchModalOpen = false;

// Add search modal CSS
const searchStyles = document.createElement('style');
searchStyles.textContent = `
    .search-modal-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    
    .search-filters {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }
    
    .search-filter {
        padding: 6px 12px;
        background: var(--ctp-surface0);
        border: 1px solid var(--ctp-surface1);
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
    }
    
    .search-filter.active {
        background: var(--ctp-mauve);
        color: var(--ctp-crust);
        border-color: var(--ctp-mauve);
    }
    
    .search-results {
        max-height: 400px;
        overflow-y: auto;
    }
    
    .search-result-item {
        padding: 12px;
        background: var(--ctp-surface0);
        border: 1px solid var(--ctp-surface1);
        border-radius: 8px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.2s;
    }
    
    .search-result-item:hover {
        background: var(--ctp-surface1);
        border-color: var(--ctp-mauve);
        transform: translateX(4px);
    }
    
    .search-result-title {
        font-weight: 600;
        color: var(--ctp-text);
        margin-bottom: 4px;
    }
    
    .search-result-notebook {
        font-size: 11px;
        color: var(--ctp-overlay1);
        margin-bottom: 6px;
    }
    
    .search-result-preview {
        font-size: 13px;
        color: var(--ctp-subtext1);
        line-height: 1.5;
    }
    
    .search-highlight {
        background: rgba(203, 166, 247, 0.3);
        padding: 2px 4px;
        border-radius: 3px;
        font-weight: 600;
        color: var(--ctp-mauve);
    }
    
    .search-stats {
        font-size: 12px;
        color: var(--ctp-overlay1);
        text-align: center;
        padding: 12px;
    }
`;
document.head.appendChild(searchStyles);

function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
}

function getNotebookName(notebookId) {
    const notebook = app.data.notebooks.find(nb => nb.id === notebookId);
    return notebook ? `${notebook.icon} ${notebook.name}` : 'Unknown';
}

function performSearch(query, filters) {
    if (!query.trim()) return [];
    
    const searchTerm = query.toLowerCase();
    let results = [];
    
    app.data.notes.forEach(note => {
        const titleMatch = note.title.toLowerCase().includes(searchTerm);
        const contentMatch = note.content.toLowerCase().includes(searchTerm);
        
        if (titleMatch || contentMatch) {
            // Get context around the match
            let preview = '';
            if (contentMatch) {
                const index = note.content.toLowerCase().indexOf(searchTerm);
                const start = Math.max(0, index - 50);
                const end = Math.min(note.content.length, index + searchTerm.length + 50);
                preview = (start > 0 ? '...' : '') + 
                         note.content.substring(start, end) + 
                         (end < note.content.length ? '...' : '');
            } else {
                preview = note.content.substring(0, 100) + (note.content.length > 100 ? '...' : '');
            }
            
            results.push({
                note,
                preview,
                titleMatch,
                contentMatch
            });
        }
    });
    
    // Apply filters
    if (filters.titleOnly) {
        results = results.filter(r => r.titleMatch);
    }
    if (filters.currentNotebook && app.currentNotebook) {
        results = results.filter(r => r.note.notebookId === app.currentNotebook.id);
    }
    
    // Sort by relevance (title matches first)
    results.sort((a, b) => {
        if (a.titleMatch && !b.titleMatch) return -1;
        if (!a.titleMatch && b.titleMatch) return 1;
        return 0;
    });
    
    return results;
}

function showAdvancedSearch() {
    searchModalOpen = true;
    
    app.showModal('Advanced Search', `
        <div class="search-modal-content">
            <div class="form-group">
                <input 
                    type="text" 
                    id="advSearchInput" 
                    class="form-input" 
                    placeholder="Search notes..."
                    autofocus
                />
            </div>
            
            <div class="search-filters">
                <button class="search-filter" data-filter="titleOnly">
                    Title Only
                </button>
                <button class="search-filter" data-filter="currentNotebook">
                    Current Notebook
                </button>
                <button class="search-filter active" data-filter="all">
                    All Notes
                </button>
            </div>
            
            <div id="searchResults" class="search-results">
                <div class="search-stats">
                    Enter a search term to find notes
                </div>
            </div>
        </div>
    `, [
        { label: 'Close', class: 'secondary', onClick: () => { searchModalOpen = false; app.closeModal(); } }
    ]);
    
    // Setup filter buttons
    const filters = {
        titleOnly: false,
        currentNotebook: false,
        all: true
    };
    
    document.querySelectorAll('.search-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;
            
            // Toggle filters
            document.querySelectorAll('.search-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if (filter === 'titleOnly') {
                filters.titleOnly = true;
                filters.currentNotebook = false;
                filters.all = false;
            } else if (filter === 'currentNotebook') {
                filters.titleOnly = false;
                filters.currentNotebook = true;
                filters.all = false;
            } else {
                filters.titleOnly = false;
                filters.currentNotebook = false;
                filters.all = true;
            }
            
            // Re-run search
            const query = document.getElementById('advSearchInput').value;
            if (query) {
                updateSearchResults(query, filters);
            }
        });
    });
    
    // Setup search input
    const searchInput = document.getElementById('advSearchInput');
    let searchTimeout;
    
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            updateSearchResults(e.target.value, filters);
        }, 300);
    });
    
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchModalOpen = false;
            app.closeModal();
        }
    });
}

function updateSearchResults(query, filters) {
    const resultsDiv = document.getElementById('searchResults');
    
    if (!query.trim()) {
        resultsDiv.innerHTML = '<div class="search-stats">Enter a search term to find notes</div>';
        return;
    }
    
    const results = performSearch(query, filters);
    
    if (results.length === 0) {
        resultsDiv.innerHTML = '<div class="search-stats">No notes found</div>';
        return;
    }
    
    const html = results.map(result => `
        <div class="search-result-item" onclick="openSearchResult('${result.note.id}')">
            <div class="search-result-title">
                ${highlightText(result.note.title, query)}
            </div>
            <div class="search-result-notebook">
                ${getNotebookName(result.note.notebookId)}
            </div>
            <div class="search-result-preview">
                ${highlightText(result.preview, query)}
            </div>
        </div>
    `).join('');
    
    resultsDiv.innerHTML = `
        <div class="search-stats">Found ${results.length} note(s)</div>
        ${html}
    `;
}

window.openSearchResult = function(noteId) {
    app.selectNote(noteId);
    searchModalOpen = false;
    app.closeModal();
};

// Add search button to toolbar
const originalRenderEditor = app.renderEditor.bind(app);
app.renderEditor = function() {
    originalRenderEditor();
    
    const toolbar = document.querySelector('.editor-toolbar-actions');
    if (toolbar && app.currentNote && !document.getElementById('advSearchBtn')) {
        const btn = document.createElement('button');
        btn.id = 'advSearchBtn';
        btn.className = 'btn-icon';
        btn.title = 'Advanced Search (Ctrl+Shift+F)';
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16">
                <path fill="currentColor" d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
            </svg>
        `;
        btn.onclick = () => showAdvancedSearch();
        toolbar.insertBefore(btn, toolbar.firstChild);
    }
};

// Override sidebar search to use advanced search
const originalHandleSearch = app.handleSearch.bind(app);
app.handleSearch = function(query) {
    // Still use the basic search for sidebar
    originalHandleSearch(query);
};

// Keyboard shortcut: Ctrl/Cmd + Shift + F
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        showAdvancedSearch();
    }
});

console.log('Advanced Search ready! Press Ctrl/Cmd+Shift+F to search.');
