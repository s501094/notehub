# NoteHub Plugins Guide

NoteHub comes with powerful built-in plugins that extend its functionality. Here's how to use them:

## 🔌 Available Plugins

### 1. **Math Renderer** 📐
Render LaTeX math equations in your notes using KaTeX.

**Features:**
- Inline math: `$E = mc^2$`
- Block math: `$$\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$`
- Full LaTeX support
- Beautiful rendering with Catppuccin colors

**Usage:**
```markdown
The quadratic formula is $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$

For a detailed equation:

$$
\int_{a}^{b} f(x)dx = F(b) - F(a)
$$
```

**Enable:**
```json
{
  "plugins": {
    "enabled": ["math-renderer"]
  }
}
```

---

### 2. **Terminal** 💻
Integrated terminal at the bottom of NoteHub.

**Features:**
- Built-in commands
- Command history (↑/↓ arrows)
- Note management from terminal
- Fast access with keyboard shortcut

**Commands:**
- `help` - Show all commands
- `notes` - List all notes
- `notebooks` - List all notebooks
- `search <term>` - Search notes
- `new` - Create new note
- `export <id>` - Export note by ID
- `clear` - Clear terminal
- `pwd` - Show current directory
- `date` - Show date/time

**Keyboard Shortcut:** `Ctrl/Cmd + \``

**Enable:**
```json
{
  "plugins": {
    "enabled": ["terminal"]
  }
}
```

---

### 3. **Advanced Search** 🔍
Enhanced search with filters and highlighting.

**Features:**
- Search across all notebooks
- Filter by title only or current notebook
- Highlight search terms
- Show context around matches
- Fast keyboard access

**Filters:**
- **All Notes** - Search everything
- **Title Only** - Search only note titles
- **Current Notebook** - Search only current notebook

**Keyboard Shortcut:** `Ctrl/Cmd + Shift + F`

**Enable:**
```json
{
  "plugins": {
    "enabled": ["advanced-search"]
  }
}
```

---

### 4. **DOCX Converter** 📄
Import Word documents and convert to Markdown.

**Features:**
- Import .docx files
- Preserve formatting (headings, bold, italic, lists)
- Convert tables to Markdown tables
- Maintain links and images
- Automatic note creation

**Supported Elements:**
- Headings (H1-H6)
- Bold and italic text
- Lists (ordered and unordered)
- Tables
- Links
- Code blocks
- Blockquotes

**Usage:**
1. Click "New Note" button
2. Select "Import Word Document"
3. Choose your .docx file
4. Markdown note is created automatically

**Enable:**
```json
{
  "plugins": {
    "enabled": ["docx-converter"]
  }
}
```

---

### 5. **Excel Integration** 📊
Import Excel files and work with tables.

**Features:**
- Import .xlsx, .xls, and .csv files
- Convert to Markdown tables
- Multi-sheet support
- Table creator tool
- Preview before import

**Usage:**

**Import Excel:**
1. Click the Excel import button in toolbar
2. Select your Excel file
3. Preview the conversion
4. Click Import

**Create Table:**
1. Click the table button in toolbar
2. Set rows and columns
3. Choose if first row is headers
4. Table is inserted at cursor

**Enable:**
```json
{
  "plugins": {
    "enabled": ["excel-integration"]
  }
}
```

---

## 🚀 Enabling Plugins

### Option 1: Enable All Plugins

Edit your `config.json`:

```json
{
  "plugins": {
    "enabled": [
      "math-renderer",
      "terminal",
      "advanced-search",
      "docx-converter",
      "excel-integration"
    ]
  }
}
```

### Option 2: Enable Specific Plugins

Choose only the plugins you need:

```json
{
  "plugins": {
    "enabled": [
      "math-renderer",
      "terminal"
    ]
  }
}
```

### Option 3: Use Settings UI

1. Go to **Preferences → Open Config File**
2. Add plugins to the `enabled` array
3. Save the file
4. Reload NoteHub (`Cmd/Ctrl + R`)

---

## 📍 Plugin Locations

Plugins are stored in:
```
notehub/
└── plugins/
    ├── math-renderer/
    ├── terminal/
    ├── advanced-search/
    ├── docx-converter/
    ├── excel-integration/
    └── example-plugin/
```

---

## 🎯 Plugin Combinations

### For Students/Academics
```json
{
  "plugins": {
    "enabled": ["math-renderer", "advanced-search", "docx-converter"]
  }
}
```

### For Developers
```json
{
  "plugins": {
    "enabled": ["terminal", "advanced-search"]
  }
}
```

### For Data Analysis
```json
{
  "plugins": {
    "enabled": ["excel-integration", "math-renderer", "advanced-search"]
  }
}
```

### All-in-One
```json
{
  "plugins": {
    "enabled": [
      "math-renderer",
      "terminal",
      "advanced-search",
      "docx-converter",
      "excel-integration"
    ]
  }
}
```

---

## 🎨 Plugin UI Elements

When enabled, plugins add buttons to the editor toolbar:

| Plugin | Button | Location |
|--------|--------|----------|
| Math Renderer | ? icon | Left side |
| Terminal | Terminal icon | Left side |
| Advanced Search | Search icon | Left side |
| DOCX Converter | Upload icon | Left side |
| Excel Integration | Excel icon + Table icon | Left side |

---

## ⚡ Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Toggle Terminal | `Ctrl/Cmd + \`` |
| Advanced Search | `Ctrl/Cmd + Shift + F` |

---

## 🐛 Troubleshooting

### Plugin Not Loading

1. Check `config.json` syntax is valid
2. Verify plugin name is spelled correctly
3. Reload app (`Cmd/Ctrl + R`)
4. Check console for errors (View → Toggle DevTools)

### Math Not Rendering

1. Wait a few seconds for KaTeX to load
2. Check internet connection (loads from CDN)
3. Verify math syntax is correct

### Terminal Not Opening

1. Check keyboard shortcut isn't conflicting
2. Try clicking the terminal button
3. Reload the app

### DOCX Import Failing

1. Verify file is .docx format (not .doc)
2. Check file isn't corrupted
3. Try opening in Word first

### Excel Tables Look Wrong

1. Verify Excel file structure
2. Check for merged cells (not supported)
3. Try saving as .csv first

---

## 📝 Creating Custom Plugins

See [PLUGIN_DEVELOPMENT.md](../PLUGIN_DEVELOPMENT.md) for a complete guide on creating your own plugins.

---

## 🎁 Plugin Ideas

Want more plugins? Here are some ideas:

- **Git Integration** - Commit notes to git
- **Cloud Sync** - Sync to Dropbox/Google Drive
- **PDF Export** - Export notes as PDFs
- **Diagram Renderer** - Mermaid diagram support
- **Code Runner** - Execute code blocks
- **Daily Notes** - Auto-create daily note templates
- **Word Count Goals** - Track writing progress
- **Vim Mode** - Vim keybindings in editor
- **Spellcheck** - Grammar and spell checking
- **Themes** - Additional color themes

---

**Enjoy your enhanced NoteHub! 🚀**
