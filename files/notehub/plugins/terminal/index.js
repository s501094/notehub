// Terminal Plugin - Integrated terminal for NoteHub
// Adds a terminal panel at the bottom of the editor

console.log('Terminal plugin loaded!');

let terminalVisible = false;
let terminalHistory = [];
let historyIndex = -1;

// Add terminal CSS
const terminalStyles = document.createElement('style');
terminalStyles.textContent = `
    .terminal-container {
        position: fixed;
        bottom: 0;
        left: 280px;
        right: 0;
        height: 300px;
        background: var(--ctp-crust);
        border-top: 2px solid var(--ctp-surface0);
        display: none;
        flex-direction: column;
        z-index: 100;
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.5);
    }
    
    .terminal-container.visible {
        display: flex;
    }
    
    .terminal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        background: var(--ctp-mantle);
        border-bottom: 1px solid var(--ctp-surface0);
    }
    
    .terminal-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--ctp-text);
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .terminal-actions {
        display: flex;
        gap: 8px;
    }
    
    .terminal-output {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        font-family: var(--font-mono);
        font-size: 13px;
        line-height: 1.5;
        color: var(--ctp-text);
    }
    
    .terminal-line {
        margin-bottom: 4px;
        white-space: pre-wrap;
        word-break: break-all;
    }
    
    .terminal-command {
        color: var(--ctp-green);
    }
    
    .terminal-output-text {
        color: var(--ctp-text);
    }
    
    .terminal-error {
        color: var(--ctp-red);
    }
    
    .terminal-input-line {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        background: var(--ctp-mantle);
        border-top: 1px solid var(--ctp-surface0);
        gap: 8px;
    }
    
    .terminal-prompt {
        color: var(--ctp-mauve);
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
    }
    
    .terminal-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: var(--ctp-text);
        font-family: var(--font-mono);
        font-size: 13px;
    }
    
    .editor-area.terminal-open {
        padding-bottom: 300px;
    }
`;
document.head.appendChild(terminalStyles);

// Create terminal HTML
const terminalHTML = `
    <div id="terminal-container" class="terminal-container">
        <div class="terminal-header">
            <div class="terminal-title">
                <svg width="14" height="14" viewBox="0 0 16 16">
                    <path fill="currentColor" d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm9.5 10.5h2a.5.5 0 0 0 0-1h-2a.5.5 0 0 0 0 1zm-6.354-5.354a.5.5 0 0 0 0 .708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 1 0-.708-.708L5.5 8.793 3.854 7.146a.5.5 0 0 0-.708 0z"/>
                </svg>
                Terminal
            </div>
            <div class="terminal-actions">
                <button class="btn-icon" onclick="clearTerminal()" title="Clear">
                    <svg width="14" height="14" viewBox="0 0 16 16">
                        <path fill="currentColor" d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    </svg>
                </button>
                <button class="btn-icon" onclick="toggleTerminal()" title="Close">
                    <svg width="14" height="14" viewBox="0 0 16 16">
                        <path fill="currentColor" d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
                    </svg>
                </button>
            </div>
        </div>
        <div id="terminal-output" class="terminal-output"></div>
        <div class="terminal-input-line">
            <span class="terminal-prompt">$</span>
            <input type="text" id="terminal-input" class="terminal-input" placeholder="Type a command..." />
        </div>
    </div>
`;

// Inject terminal into DOM
document.body.insertAdjacentHTML('beforeend', terminalHTML);

// Terminal functions
function toggleTerminal() {
    terminalVisible = !terminalVisible;
    const terminal = document.getElementById('terminal-container');
    const editorArea = document.querySelector('.editor-area');
    
    if (terminalVisible) {
        terminal.classList.add('visible');
        if (editorArea) editorArea.classList.add('terminal-open');
        document.getElementById('terminal-input').focus();
        addTerminalLine('Terminal ready. Type "help" for available commands.', 'output');
    } else {
        terminal.classList.remove('visible');
        if (editorArea) editorArea.classList.remove('terminal-open');
    }
}

function clearTerminal() {
    document.getElementById('terminal-output').innerHTML = '';
    addTerminalLine('Terminal cleared.', 'output');
}

function addTerminalLine(text, type = 'output') {
    const output = document.getElementById('terminal-output');
    const line = document.createElement('div');
    line.className = 'terminal-line';
    
    if (type === 'command') {
        line.innerHTML = `<span class="terminal-prompt">$</span> <span class="terminal-command">${text}</span>`;
    } else if (type === 'error') {
        line.innerHTML = `<span class="terminal-error">${text}</span>`;
    } else {
        line.innerHTML = `<span class="terminal-output-text">${text}</span>`;
    }
    
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

async function executeCommand(command) {
    command = command.trim();
    if (!command) return;
    
    addTerminalLine(command, 'command');
    terminalHistory.unshift(command);
    historyIndex = -1;
    
    // Built-in commands
    if (command === 'help') {
        addTerminalLine('Available commands:');
        addTerminalLine('  help          - Show this help');
        addTerminalLine('  clear         - Clear terminal');
        addTerminalLine('  notes         - List all notes');
        addTerminalLine('  notebooks     - List all notebooks');
        addTerminalLine('  export <id>   - Export note by ID');
        addTerminalLine('  search <term> - Search notes');
        addTerminalLine('  new           - Create new note');
        addTerminalLine('  pwd           - Show current directory');
        addTerminalLine('  date          - Show current date/time');
        return;
    }
    
    if (command === 'clear') {
        clearTerminal();
        return;
    }
    
    if (command === 'notes') {
        if (app.data.notes.length === 0) {
            addTerminalLine('No notes found.');
        } else {
            addTerminalLine(`Found ${app.data.notes.length} notes:`);
            app.data.notes.forEach((note, i) => {
                addTerminalLine(`  ${i + 1}. [${note.id}] ${note.title}`);
            });
        }
        return;
    }
    
    if (command === 'notebooks') {
        addTerminalLine(`Found ${app.data.notebooks.length} notebooks:`);
        app.data.notebooks.forEach((nb, i) => {
            const count = app.data.notes.filter(n => n.notebookId === nb.id).length;
            addTerminalLine(`  ${i + 1}. ${nb.icon} ${nb.name} (${count} notes)`);
        });
        return;
    }
    
    if (command.startsWith('search ')) {
        const term = command.substring(7).trim().toLowerCase();
        const results = app.data.notes.filter(note => 
            note.title.toLowerCase().includes(term) || 
            note.content.toLowerCase().includes(term)
        );
        
        if (results.length === 0) {
            addTerminalLine(`No notes found matching "${term}"`);
        } else {
            addTerminalLine(`Found ${results.length} note(s) matching "${term}":`);
            results.forEach((note, i) => {
                addTerminalLine(`  ${i + 1}. ${note.title}`);
            });
        }
        return;
    }
    
    if (command === 'new') {
        app.createNewNote();
        addTerminalLine('Created new note.');
        return;
    }
    
    if (command === 'pwd') {
        addTerminalLine(window.location.href);
        return;
    }
    
    if (command === 'date') {
        addTerminalLine(new Date().toString());
        return;
    }
    
    if (command.startsWith('export ')) {
        const noteId = command.substring(7).trim();
        const note = app.data.notes.find(n => n.id === noteId);
        if (note) {
            await app.exportNote(note);
            addTerminalLine(`Exported: ${note.title}`);
        } else {
            addTerminalLine(`Note not found: ${noteId}`, 'error');
        }
        return;
    }
    
    // Unknown command
    addTerminalLine(`Command not found: ${command}`, 'error');
    addTerminalLine('Type "help" for available commands.');
}

// Setup input handlers
const terminalInput = document.getElementById('terminal-input');

terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const command = terminalInput.value;
        terminalInput.value = '';
        executeCommand(command);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIndex < terminalHistory.length - 1) {
            historyIndex++;
            terminalInput.value = terminalHistory[historyIndex];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0) {
            historyIndex--;
            terminalInput.value = terminalHistory[historyIndex];
        } else if (historyIndex === 0) {
            historyIndex = -1;
            terminalInput.value = '';
        }
    }
});

// Add terminal button to toolbar
const originalRenderEditor = app.renderEditor.bind(app);
app.renderEditor = function() {
    originalRenderEditor();
    
    const toolbar = document.querySelector('.editor-toolbar-actions');
    if (toolbar && app.currentNote && !document.getElementById('terminalBtn')) {
        const btn = document.createElement('button');
        btn.id = 'terminalBtn';
        btn.className = 'btn-icon';
        btn.title = 'Toggle Terminal';
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16">
                <path fill="currentColor" d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm9.5 10.5h2a.5.5 0 0 0 0-1h-2a.5.5 0 0 0 0 1zm-6.354-5.354a.5.5 0 0 0 0 .708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 1 0-.708-.708L5.5 8.793 3.854 7.146a.5.5 0 0 0-.708 0z"/>
            </svg>
        `;
        btn.onclick = () => toggleTerminal();
        toolbar.insertBefore(btn, toolbar.firstChild);
    }
};

// Make functions global
window.toggleTerminal = toggleTerminal;
window.clearTerminal = clearTerminal;

// Keyboard shortcut: Ctrl/Cmd + `
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        toggleTerminal();
    }
});

console.log('Terminal plugin ready! Press Ctrl/Cmd+` to toggle.');
